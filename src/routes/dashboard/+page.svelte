<script>
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabase';
	import Nav from '$lib/Nav.svelte';
	import { goto } from '$app/navigation';
	import { toast, confirm as confirmModal } from '$lib/stores/toast.js';
	import { getWeekBounds, localDateString, formatTime, formatDateWeekday, parseLocalDate } from '$lib/time.js';
	import { errorMessage } from '$lib/errors.js';
	import Icon from '$lib/icons/Icon.svelte';
	import MoonPhase from '$lib/components/MoonPhase.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import MiniCalendar from '$lib/components/MiniCalendar.svelte';

	/** @type {Record<string, string>} */
	const ROLE_TITLES = {
		admin: 'The Keeper',
		family: 'The Household',
		nanny: 'The Guardian'
	};

	let user = null;
	let profile = null;
	let loading = true;
	/** @type {string | null} */
	let initError = null;
	/** @type {any[]} */
	let nannies = [];
	/** @type {any[]} */
	let activeShifts = [];
	/** @type {any[]} */
	let weekEntries = [];
	/** @type {any} */
	let upcomingShift = null;
	/** @type {string[]} */
	let monthShiftDates = [];
	/** @type {any[]} */
	let unpaidPayments = [];
	let now = Date.now();
	let showAddNanny = false;
	let selectedNanny = null;
	let nannyEmail = '';
	let nannyName = '';
	let nannyRate = 20;
	let nannyVenmo = '';
	let nannyPassword = '';
	let showRoster = false;

	/** @type {ReturnType<typeof supabase.channel> | null} */
	let dashChannel = null;
	/** @type {ReturnType<typeof setInterval> | null} */
	let pollInterval = null;
	/** @type {ReturnType<typeof setInterval> | null} */
	let tickInterval = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let reloadTimer = null;

	function editNanny(nanny) {
		selectedNanny = nanny;
		nannyName = nanny.full_name;
		nannyRate = nanny.hourly_rate;
		nannyVenmo = nanny.venmo_username || '';
		nannyEmail = '';
		nannyPassword = '';
		showAddNanny = true;
	}

	async function saveNanny() {
		if (!nannyName) {
			toast.error('Name is required');
			return;
		}

		try {
			if (selectedNanny) {
				const { error } = await supabase
					.from('profiles')
					.update({
						full_name: nannyName,
						hourly_rate: nannyRate,
						venmo_username: nannyVenmo
					})
					.eq('id', selectedNanny.id);

				if (error) throw error;
				toast.success('Nanny updated!');
			} else {
				if (!nannyEmail || !nannyPassword) {
					toast.error('Email and password required for new nanny');
					return;
				}

				const { data: authData, error: authError } = await supabase.auth.signUp({
					email: nannyEmail,
					password: nannyPassword
				});

				if (authError) throw authError;

				const { error: profileError } = await supabase.from('profiles').insert({
					id: authData.user.id,
					role: 'nanny',
					full_name: nannyName,
					hourly_rate: nannyRate,
					venmo_username: nannyVenmo
				});

				if (profileError) throw profileError;
				toast.success('Nanny created! They can log in with: ' + nannyEmail);
			}

			cancelNannyForm();
			await loadFamilyDashboard();
		} catch (err) {
			toast.error('Error: ' + err.message);
		}
	}

	async function deleteNanny(nanny) {
		const confirmed = await confirmModal.show({
			title: 'Delete Nanny',
			message: `Delete ${nanny.full_name}? This will also delete all their time entries.`,
			confirmText: 'Delete',
			danger: true
		});
		if (!confirmed) return;

		try {
			await supabase.from('time_entries').delete().eq('nanny_id', nanny.id);
			const { error } = await supabase.from('profiles').delete().eq('id', nanny.id);

			if (error) throw error;
			toast.success('Nanny deleted');
			await loadFamilyDashboard();
		} catch (err) {
			toast.error('Error deleting: ' + err.message);
		}
	}

	function cancelNannyForm() {
		showAddNanny = false;
		selectedNanny = null;
		nannyEmail = '';
		nannyName = '';
		nannyRate = 20;
		nannyVenmo = '';
		nannyPassword = '';
	}

	onMount(() => {
		initDashboard();
		tickInterval = setInterval(() => { now = Date.now(); }, 1000);
		pollInterval = setInterval(() => { reloadDashboard(); }, 30000);
	});

	onDestroy(() => {
		if (dashChannel) supabase.removeChannel(dashChannel);
		if (pollInterval) clearInterval(pollInterval);
		if (tickInterval) clearInterval(tickInterval);
		if (reloadTimer) clearTimeout(reloadTimer);
	});

	async function initDashboard() {
		loading = true;
		initError = null;

		try {
			const { data: { user: currentUser } } = await supabase.auth.getUser();
			if (!currentUser) { goto('/'); return; }

			user = currentUser;

			const { data: profileData, error: profileError } = await supabase
				.from('profiles')
				.select('*')
				.eq('id', user.id)
				.maybeSingle();

			if (profileError) throw profileError;
			profile = profileData;

			if (!profile || !profile.role) { goto('/setup'); return; }

			if (profile?.role === 'family' || profile?.role === 'admin') {
				await loadFamilyDashboard();
			} else if (profile?.role === 'nanny') {
				await loadNannyDashboard();
			}

			if (!dashChannel) subscribeToShifts();
			loading = false;
		} catch (err) {
			initError = errorMessage(err);
			loading = false;
		}
	}

	async function reloadDashboard() {
		if (!profile) return;
		try {
			if (profile.role === 'family' || profile.role === 'admin') {
				await loadFamilyDashboard();
			} else if (profile.role === 'nanny') {
				await loadNannyDashboard();
			}
		} catch (err) {
			console.warn('Dashboard refresh failed:', errorMessage(err));
		}
	}

	function scheduleReload() {
		if (reloadTimer) clearTimeout(reloadTimer);
		reloadTimer = setTimeout(() => { reloadTimer = null; reloadDashboard(); }, 300);
	}

	function handleVisibilityChange() {
		if (document.visibilityState === 'visible' && !loading) scheduleReload();
	}

	async function loadFamilyDashboard() {
		const { data: nanniesData, error: nanniesError } = await supabase
			.from('profiles')
			.select('*')
			.eq('role', 'nanny')
			.order('full_name');

		if (nanniesError) throw nanniesError;
		nannies = nanniesData || [];

		const { data: shiftsData, error: shiftsError } = await supabase
			.from('time_entries')
			.select('*')
			.is('clock_out', null);

		if (shiftsError) throw shiftsError;
		activeShifts = shiftsData || [];

		const bounds = getWeekBounds(0);
		const { data: weekData, error: weekError } = await supabase
			.from('time_entries')
			.select('*')
			.gte('clock_in', bounds.start.toISOString())
			.lte('clock_in', bounds.end.toISOString());

		if (weekError) throw weekError;
		weekEntries = weekData || [];

		await Promise.all([
			loadUpcomingShift(),
			loadMonthShifts(),
			loadUnpaidPayments()
		]);
	}

	async function loadUpcomingShift() {
		const todayStr = localDateString();
		try {
			const { data, error } = await supabase
				.from('schedules')
				.select('*')
				.gte('date', todayStr)
				.order('date', { ascending: true })
				.order('start_time', { ascending: true })
				.limit(1)
				.maybeSingle();

			if (error) throw error;
			upcomingShift = data;
		} catch {
			upcomingShift = null;
		}
	}

	async function loadMonthShifts() {
		const d = new Date();
		const monthStart = localDateString(new Date(d.getFullYear(), d.getMonth(), 1));
		const monthEnd = localDateString(new Date(d.getFullYear(), d.getMonth() + 1, 0));
		try {
			const { data, error } = await supabase
				.from('schedules')
				.select('date')
				.gte('date', monthStart)
				.lte('date', monthEnd);

			if (error) throw error;
			monthShiftDates = (data || []).map(s => s.date);
		} catch {
			monthShiftDates = [];
		}
	}

	async function loadUnpaidPayments() {
		try {
			const { data, error } = await supabase
				.from('payments')
				.select('*')
				.eq('is_paid', false);

			if (error) throw error;
			unpaidPayments = data || [];
		} catch {
			unpaidPayments = [];
		}
	}

	async function loadNannyDashboard() {
		const { data: shiftData, error } = await supabase
			.from('time_entries')
			.select('*')
			.eq('nanny_id', user.id)
			.is('clock_out', null)
			.order('clock_in', { ascending: false })
			.limit(1)
			.maybeSingle();

		if (error) throw error;
		activeShifts = shiftData ? [shiftData] : [];

		await loadUpcomingShift();
	}

	function subscribeToShifts() {
		dashChannel = supabase
			.channel('active_shifts')
			.on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, () => { scheduleReload(); })
			.subscribe();
	}

	function isNannyActive(nannyId) {
		return activeShifts.some((shift) => shift.nanny_id === nannyId);
	}

	function getActiveShift(nannyId) {
		return activeShifts.find((shift) => shift.nanny_id === nannyId);
	}

	/** @param {string} dateString @param {number} nowMs */
	function getTimeSince(dateString, nowMs) {
		const diff = Math.max(0, nowMs - new Date(dateString).getTime());
		const hours = Math.floor(diff / (1000 * 60 * 60));
		const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
		return `${hours}h ${minutes}m`;
	}

	/** @param {any} entry @param {number} nowMs */
	function entryHours(entry, nowMs) {
		if (entry.clock_out) return parseFloat(entry.hours) || 0;
		return (nowMs - new Date(entry.clock_in).getTime()) / (1000 * 60 * 60);
	}

	function getNannyName(nannyId) {
		return nannies.find(n => n.id === nannyId)?.full_name || 'Nanny';
	}

	function formatShiftTime(timeStr) {
		if (!timeStr) return '';
		const [h, m] = timeStr.split(':').map(Number);
		const ampm = h >= 12 ? 'PM' : 'AM';
		const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
		return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
	}

	function shiftDuration(start, end) {
		if (!start || !end) return '';
		const [sh, sm] = start.split(':').map(Number);
		const [eh, em] = end.split(':').map(Number);
		const hours = (eh * 60 + em - sh * 60 - sm) / 60;
		return hours > 0 ? `${hours.toFixed(0)} hours` : '';
	}

	$: hoursToday = weekEntries
		.filter((e) => localDateString(new Date(e.clock_in)) === localDateString(new Date(now)))
		.reduce((sum, e) => sum + entryHours(e, now), 0)
		.toFixed(1);

	$: weeklyTotal = weekEntries
		.reduce((sum, e) => {
			const rate = nannies.find((n) => n.id === e.nanny_id)?.hourly_rate || 20;
			return sum + entryHours(e, now) * rate;
		}, 0)
		.toFixed(2);

	$: unpaidHours = unpaidPayments.reduce((sum, p) => sum + (parseFloat(p.hours) || 0), 0);
	$: unpaidAmount = unpaidPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

	$: greeting = (() => {
		const hour = new Date(now).getHours();
		if (hour < 5) return 'Still awake';
		if (hour < 12) return 'Good morning';
		if (hour < 17) return 'Good afternoon';
		if (hour < 21) return 'Good evening';
		return 'Good night';
	})();

	$: todayFormatted = new Date(now).toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric'
	});
</script>

<svelte:document on:visibilitychange={handleVisibilityChange} />

<Nav currentPage="dashboard" />

{#if loading}
	<div class="container">
		<div class="welcome">
			<div class="skeleton skeleton-line" style="width: 40%; height: 2rem"></div>
		</div>
		<Skeleton variant="stats" count={4} />
		<div style="height: var(--section-gap)"></div>
		<Skeleton variant="card" count={3} />
	</div>
{:else if initError}
	<div class="container">
		<div class="card arcana error-card">
			<EmptyState icon="warning" title="The scrying pool is clouded" hint={initError}>
				<button class="btn btn-primary" on:click={initDashboard}>
					<Icon name="star" size={14} /> Try again
				</button>
			</EmptyState>
		</div>
	</div>
{:else}
	<div class="container">
		{#if profile?.role === 'family' || profile?.role === 'admin'}

			<!-- ═══════════════════════════════════════════════
			     TODAY GRID — Family / Admin view
			     ═══════════════════════════════════════════════ -->
			<div class="today-grid">

				<!-- ── Hero: The Hearth ──────────────────────── -->
				<section class="tcard hero-card">
					<div class="hero-badge">THE HEARTH</div>
					<h1 class="hero-greeting">{greeting},<br />{profile?.full_name || 'friend'}!</h1>
					<p class="hero-subtitle">Here's what's happening with your family today.</p>
					<div class="hero-scene" aria-hidden="true">
						<Icon name="cottage" size={64} />
					</div>
					<div class="hero-meta">
						<MoonPhase size={14} showLabel />
						<span class="badge badge-gilt">{ROLE_TITLES[profile?.role] || profile?.role}</span>
					</div>
					<div class="hero-message">
						<Icon name="star" size={12} />
						<span>Thanks for all you do to keep our family shining!</span>
					</div>
				</section>

				<!-- ── Upcoming Nanny Shift ──────────────────── -->
				<section class="tcard shift-card">
					<div class="tcard-header">
						<Icon name="calendar" size={16} />
						<h2>Upcoming Nanny Shift</h2>
					</div>

					{#if upcomingShift}
						<div class="shift-date-pill">
							{formatDateWeekday(parseLocalDate(upcomingShift.date))}
						</div>
						<div class="shift-info">
							<div class="shift-info-row">
								<Icon name="clock" size={14} />
								<span class="shift-time-range">
									{formatShiftTime(upcomingShift.start_time)} &ndash; {formatShiftTime(upcomingShift.end_time)}
								</span>
							</div>
							<span class="shift-duration">{shiftDuration(upcomingShift.start_time, upcomingShift.end_time)}</span>
							{#if upcomingShift.nanny_id}
								<div class="shift-info-row">
									<Icon name="person" size={14} />
									<span>{getNannyName(upcomingShift.nanny_id)}</span>
								</div>
							{/if}
							{#if upcomingShift.notes}
								<div class="shift-info-row">
									<Icon name="scroll" size={14} />
									<span class="shift-notes">{upcomingShift.notes}</span>
								</div>
							{/if}
						</div>
						<a href="/schedule" class="tcard-action">
							View Full Schedule <Icon name="chevron-right" size={12} />
						</a>
					{:else}
						<div class="tcard-empty">
							<Icon name="moon" size={32} />
							<p>No upcoming shifts scheduled</p>
							<a href="/schedule" class="tcard-action">Schedule a shift <Icon name="chevron-right" size={12} /></a>
						</div>
					{/if}
				</section>

				<!-- ── Hours / Payment Summary ──────────────── -->
				<section class="tcard approval-card">
					<div class="tcard-header">
						<Icon name="hourglass" size={16} />
						<h2>Hours &amp; Payments</h2>
					</div>

					{#if activeShifts.length > 0}
						<div class="approval-alert live">
							<span class="live-dot"></span>
							{activeShifts.length} shift{activeShifts.length > 1 ? 's' : ''} in progress
						</div>
					{/if}

					<div class="approval-stats">
						<div class="approval-stat">
							<span class="approval-big">{hoursToday}</span>
							<span class="approval-label">hours today</span>
						</div>
						<div class="approval-stat">
							<span class="approval-big">${weeklyTotal}</span>
							<span class="approval-label">this week</span>
						</div>
					</div>

					{#if unpaidPayments.length > 0}
						<div class="approval-alert unpaid">
							${unpaidAmount.toFixed(2)} unpaid ({unpaidHours.toFixed(1)} hrs)
						</div>
					{/if}

					<a href="/tracker" class="tcard-action accent">
						<Icon name="hourglass" size={12} /> Go to Tracker
					</a>
				</section>

				<!-- ── Calendar Preview ─────────────────────── -->
				<section class="tcard calendar-card">
					<div class="tcard-header">
						<Icon name="calendar" size={16} />
						<h2>Calendar Preview</h2>
						<a href="/schedule" class="header-link">View Calendar <Icon name="chevron-right" size={10} /></a>
					</div>
					<MiniCalendar shiftDates={monthShiftDates} />
				</section>

				<!-- ── Quick Actions ────────────────────────── -->
				<section class="tcard actions-card">
					<div class="tcard-header">
						<Icon name="star" size={16} />
						<h2>Quick Actions</h2>
					</div>
					<div class="action-list">
						<a href="/tracker" class="action-row start">
							<span class="action-icon"><Icon name="sprout" size={20} /></span>
							<div class="action-text">
								<span class="action-name">Start Shift</span>
								<span class="action-hint">Begin today's shift</span>
							</div>
							<Icon name="chevron-right" size={12} />
						</a>
						<a href="/tracker" class="action-row approve">
							<span class="action-icon"><Icon name="check" size={20} /></span>
							<div class="action-text">
								<span class="action-name">Approve Hours</span>
								<span class="action-hint">Review and approve time</span>
							</div>
							<Icon name="chevron-right" size={12} />
						</a>
						<a href="/tracker" class="action-row pay">
							<span class="action-icon"><Icon name="coin" size={20} /></span>
							<div class="action-text">
								<span class="action-name">Pay Nanny</span>
								<span class="action-hint">Send payment securely</span>
							</div>
							<Icon name="chevron-right" size={12} />
						</a>
					</div>
				</section>
			</div>

			<!-- ── Nanny Roster (collapsible) ──────────────── -->
			<section class="roster-section">
				<button class="roster-toggle" on:click={() => showRoster = !showRoster}>
					<Icon name="person" size={16} />
					<span>Nanny Roster ({nannies.length})</span>
					<span class="roster-chevron" class:open={showRoster}>
						<Icon name="chevron-right" size={12} />
					</span>
				</button>

				{#if showRoster}
					<div class="roster-body rise-in">
						<div class="roster-controls">
							<button class="btn btn-primary btn-small" on:click={() => (showAddNanny = true)}>
								<Icon name="plus" size={13} /> Add Nanny
							</button>
						</div>

						{#if nannies.length === 0}
							<EmptyState
								icon="cauldron"
								title="No nannies yet"
								hint="Add your first nanny to get started."
							>
								<button class="btn btn-primary" on:click={() => (showAddNanny = true)}>
									<Icon name="plus" size={14} /> Add your first nanny
								</button>
							</EmptyState>
						{:else}
							<div class="nanny-grid">
								{#each nannies as nanny (nanny.id)}
									{@const activeShift = getActiveShift(nanny.id)}
									{@const isActive = isNannyActive(nanny.id)}

									<article class="nanny-card" class:active={isActive}>
										<header class="nanny-header">
											<h3>{nanny.full_name}</h3>
											{#if isActive}
												<span class="badge badge-live"><span class="live-dot"></span> On clock</span>
											{:else}
												<span class="badge">Resting</span>
											{/if}
										</header>

										<dl class="nanny-details">
											<div><dt>Rate</dt><dd>${nanny.hourly_rate}/hr</dd></div>
											{#if nanny.venmo_username}
												<div><dt>Venmo</dt><dd>@{nanny.venmo_username}</dd></div>
											{/if}
										</dl>

										{#if isActive && activeShift}
											<div class="active-shift">
												<Icon name="hourglass" size={18} />
												<div>
													<span class="shift-since">Since {formatTime(activeShift.clock_in)}</span>
													<span class="shift-elapsed">{getTimeSince(activeShift.clock_in, now)}</span>
												</div>
											</div>
										{/if}

										<footer class="nanny-actions">
											<a href="/history?nanny={nanny.id}" class="btn-small">
												<Icon name="scroll" size={13} /> History
											</a>
											<button class="btn-small" on:click={() => editNanny(nanny)}>
												<Icon name="quill" size={13} /> Edit
											</button>
											<button class="btn-small danger" on:click={() => deleteNanny(nanny)}>
												<Icon name="urn" size={13} />
												<span class="visually-hidden">Delete {nanny.full_name}</span>
											</button>
										</footer>
									</article>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</section>

		{:else if profile?.role === 'nanny'}

			<!-- ═══════════════════════════════════════════════
			     TODAY GRID — Nanny view
			     ═══════════════════════════════════════════════ -->
			<div class="today-grid nanny-grid-layout">

				<!-- ── Hero ─────────────────────────────────── -->
				<section class="tcard hero-card">
					<div class="hero-badge">YOUR HEARTH</div>
					<h1 class="hero-greeting">{greeting},<br />{profile?.full_name || 'friend'}!</h1>
					<p class="hero-subtitle">Here's your day at a glance.</p>
					<div class="hero-scene" aria-hidden="true">
						<Icon name="sprout" size={64} />
					</div>
					<div class="hero-meta">
						<MoonPhase size={14} showLabel />
						<span class="badge badge-gilt">{ROLE_TITLES[profile?.role]}</span>
					</div>
				</section>

				<!-- ── Current Shift Status ─────────────────── -->
				<section class="tcard shift-card nanny-shift">
					<div class="tcard-header">
						<Icon name="hourglass" size={16} />
						<h2>Your Shift</h2>
					</div>

					{#if activeShifts.length > 0}
						{@const shift = activeShifts[0]}
						<div class="nanny-watch active">
							<div class="watch-status">
								<span class="badge badge-live"><span class="live-dot"></span> On the clock</span>
							</div>
							<p class="watch-elapsed">{getTimeSince(shift.clock_in, now)}</p>
							<p class="watch-since">Since {formatTime(shift.clock_in)}</p>
							<a href="/tracker" class="tcard-action accent">
								<Icon name="hourglass" size={12} /> Go to Tracker
							</a>
						</div>
					{:else}
						<div class="nanny-watch">
							<div class="watch-status">
								<span class="badge">Not clocked in</span>
							</div>
							<p class="watch-elapsed dim">00:00</p>
							<p class="watch-since">Ready when you are</p>
							<a href="/tracker" class="tcard-action growing">
								<Icon name="sprout" size={12} /> Begin your shift
							</a>
						</div>
					{/if}
				</section>

				<!-- ── Quick Actions ────────────────────────── -->
				<section class="tcard actions-card">
					<div class="tcard-header">
						<Icon name="star" size={16} />
						<h2>Quick Actions</h2>
					</div>
					<div class="action-list">
						<a href="/tracker" class="action-row start">
							<span class="action-icon"><Icon name="hourglass" size={20} /></span>
							<div class="action-text">
								<span class="action-name">The Hours</span>
								<span class="action-hint">Clock in and out</span>
							</div>
							<Icon name="chevron-right" size={12} />
						</a>
						<a href="/history" class="action-row">
							<span class="action-icon"><Icon name="scroll" size={20} /></span>
							<div class="action-text">
								<span class="action-name">Your Ledger</span>
								<span class="action-hint">Shifts and earnings</span>
							</div>
							<Icon name="chevron-right" size={12} />
						</a>
						<a href="/settings" class="action-row">
							<span class="action-icon"><Icon name="candle" size={20} /></span>
							<div class="action-text">
								<span class="action-name">Settings</span>
								<span class="action-hint">Rate, name and Venmo</span>
							</div>
							<Icon name="chevron-right" size={12} />
						</a>
					</div>
				</section>
			</div>

		{/if}
	</div>
{/if}

<!-- ── Add / Edit Nanny Modal ────────────────────────── -->
{#if showAddNanny}
	<div class="modal-overlay" on:click={cancelNannyForm} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>{selectedNanny ? 'Edit nanny' : 'Add a nanny'}</h2>

			<form on:submit|preventDefault={saveNanny}>
				<div class="form-group">
					<label for="nn">Full name *</label>
					<input id="nn" type="text" bind:value={nannyName} required />
				</div>

				{#if !selectedNanny}
					<div class="form-group">
						<label for="ne">Email *</label>
						<input id="ne" type="email" bind:value={nannyEmail} required />
					</div>

					<div class="form-group">
						<label for="np">Password * <span class="hint">(min 6 characters)</span></label>
						<input id="np" type="password" bind:value={nannyPassword} minlength="6" required />
					</div>
				{/if}

				<div class="form-group">
					<label for="nr">Hourly rate ($)</label>
					<input id="nr" type="number" bind:value={nannyRate} min="0" step="0.50" />
				</div>

				<div class="form-group">
					<label for="nv">Venmo username</label>
					<input id="nv" type="text" bind:value={nannyVenmo} placeholder="@username" />
				</div>

				<div class="button-row">
					<button type="submit" class="btn btn-primary">
						<Icon name="check" size={14} />
						{selectedNanny ? 'Save changes' : 'Add nanny'}
					</button>
					<button type="button" class="btn btn-secondary" on:click={cancelNannyForm}>Cancel</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	/* ═══════════════════════════════════════════════════════
	   TODAY GRID
	   ═══════════════════════════════════════════════════════ */

	.today-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		grid-template-rows: auto auto;
		gap: var(--grid-gap);
		margin-bottom: var(--section-gap);
	}

	.hero-card     { grid-column: 1; grid-row: 1; }
	.shift-card    { grid-column: 2; grid-row: 1; }
	.approval-card { grid-column: 3; grid-row: 1; }
	.calendar-card { grid-column: 1 / 3; grid-row: 2; }
	.actions-card  { grid-column: 3; grid-row: 2; }

	/* Nanny view uses a simpler 2+1 layout */
	.nanny-grid-layout {
		grid-template-columns: 1fr 1fr;
	}

	.nanny-grid-layout .hero-card    { grid-column: 1; grid-row: 1; }
	.nanny-grid-layout .shift-card   { grid-column: 2; grid-row: 1; }
	.nanny-grid-layout .actions-card { grid-column: 1 / 3; grid-row: 2; }

	@media (max-width: 1024px) {
		.today-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.hero-card     { grid-column: 1 / 3; }
		.shift-card    { grid-column: 1; grid-row: 2; }
		.approval-card { grid-column: 2; grid-row: 2; }
		.calendar-card { grid-column: 1 / 3; grid-row: 3; }
		.actions-card  { grid-column: 1 / 3; grid-row: 4; }
	}

	@media (max-width: 640px) {
		.today-grid,
		.nanny-grid-layout {
			grid-template-columns: 1fr;
		}

		.hero-card, .shift-card, .approval-card,
		.calendar-card, .actions-card {
			grid-column: 1 !important;
			grid-row: auto !important;
		}
	}

	/* ═══════════════════════════════════════════════════════
	   TODAY CARD — shared base
	   ═══════════════════════════════════════════════════════ */

	.tcard {
		display: flex;
		flex-direction: column;
		padding: var(--card-padding);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		box-shadow: var(--shadow-md);
		overflow: hidden;
	}

	.tcard-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.85rem;
		color: var(--text-faint);
		--icon-accent: var(--accent);
	}

	.tcard-header h2 {
		font-family: var(--font-display);
		font-size: 0.92rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--text);
		flex: 1;
	}

	.header-link {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--accent);
		white-space: nowrap;
		transition: color var(--transition-fast);
	}

	.header-link:hover {
		color: var(--accent-bright);
	}

	.tcard-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		margin-top: auto;
		padding: 0.65rem 1rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-family: var(--font-display);
		font-size: 0.82rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-decoration: none;
		color: var(--text);
		transition: all var(--transition-fast);
	}

	.tcard-action:hover {
		border-color: var(--accent);
		background: var(--accent-tint);
		color: var(--accent-bright);
	}

	.tcard-action.accent {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent);
	}

	.tcard-action.accent:hover {
		background: var(--accent-bright);
	}

	.tcard-action.growing {
		background: var(--growing);
		border-color: var(--growing);
		color: #fff;
	}

	.tcard-action.growing:hover {
		background: var(--moss-deep, var(--growing));
	}

	.tcard-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1.5rem 0;
		text-align: center;
		color: var(--text-faint);
		--icon-accent: var(--text-faint);
		flex: 1;
	}

	.tcard-empty p {
		font-size: 0.88rem;
		margin-bottom: 0.5rem;
	}

	/* ═══════════════════════════════════════════════════════
	   HERO CARD — The Hearth
	   ═══════════════════════════════════════════════════════ */

	.hero-card {
		background-image: linear-gradient(160deg, var(--accent-dim), transparent 55%);
		border-color: var(--border-gilt);
		position: relative;
	}

	.hero-badge {
		display: inline-block;
		font-family: var(--font-display);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--accent);
		margin-bottom: 0.6rem;
	}

	.hero-greeting {
		font-family: var(--font-display);
		font-size: clamp(1.25rem, 3vw, 1.65rem);
		font-weight: 700;
		line-height: 1.25;
		color: var(--text);
		margin-bottom: 0.35rem;
	}

	.hero-subtitle {
		font-size: 0.88rem;
		color: var(--text-muted);
		margin-bottom: 0.75rem;
	}

	.hero-scene {
		display: flex;
		justify-content: center;
		padding: 0.75rem 0;
		color: var(--text-faint);
		opacity: 0.45;
		--icon-accent: var(--accent);
		animation: flicker 5s ease-in-out infinite;
	}

	.hero-meta {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	.hero-message {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.6rem 0.8rem;
		background: var(--accent-tint);
		border: 1px solid var(--border-gilt);
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
		color: var(--accent);
		--icon-accent: var(--accent-bright);
	}

	.hero-message span {
		line-height: 1.35;
	}

	/* ═══════════════════════════════════════════════════════
	   SHIFT CARD
	   ═══════════════════════════════════════════════════════ */

	.shift-date-pill {
		display: inline-block;
		padding: 0.3rem 0.7rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin-bottom: 0.75rem;
		align-self: flex-start;
	}

	.shift-info {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex: 1;
		margin-bottom: 0.85rem;
	}

	.shift-info-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		color: var(--text-muted);
		--icon-accent: var(--accent);
	}

	.shift-info-row span {
		font-size: 0.88rem;
		line-height: 1.3;
	}

	.shift-time-range {
		font-weight: 600;
		color: var(--text);
	}

	.shift-duration {
		font-size: 0.78rem;
		color: var(--text-faint);
		margin-left: 1.6rem;
	}

	.shift-notes {
		font-style: italic;
		color: var(--text-faint);
	}

	/* ═══════════════════════════════════════════════════════
	   APPROVAL / PAYMENT CARD
	   ═══════════════════════════════════════════════════════ */

	.approval-stats {
		display: flex;
		gap: 1rem;
		margin-bottom: 0.85rem;
	}

	.approval-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex: 1;
		padding: 0.75rem 0.5rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.approval-big {
		font-size: clamp(1.35rem, 3vw, 1.75rem);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
		color: var(--text);
	}

	.approval-label {
		font-family: var(--font-body);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
		margin-top: 0.2rem;
	}

	.approval-alert {
		padding: 0.45rem 0.7rem;
		border-radius: var(--radius-sm);
		font-family: var(--font-body);
		font-size: 0.78rem;
		font-weight: 600;
		margin-bottom: 0.75rem;
	}

	.approval-alert.live {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		background: var(--growing-dim);
		color: var(--growing);
		border: 1px solid rgba(111, 191, 115, 0.25);
		margin-bottom: 0.65rem;
	}

	.approval-alert.unpaid {
		background: var(--danger-dim);
		color: var(--danger);
		border: 1px solid rgba(224, 102, 78, 0.2);
	}

	/* ═══════════════════════════════════════════════════════
	   CALENDAR CARD
	   ═══════════════════════════════════════════════════════ */

	.calendar-card {
		min-height: 280px;
	}

	/* ═══════════════════════════════════════════════════════
	   QUICK ACTIONS CARD
	   ═══════════════════════════════════════════════════════ */

	.action-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.action-row {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.7rem 0.75rem;
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: var(--text);
		transition: all var(--transition-fast);
		border: 1px solid transparent;
	}

	.action-row:hover {
		background: var(--surface-2);
		border-color: var(--border);
	}

	.action-icon {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}

	.action-row.start .action-icon {
		background: var(--growing-dim);
		color: var(--growing);
		--icon-accent: var(--growing);
	}

	.action-row.approve .action-icon {
		background: var(--accent-dim);
		color: var(--accent);
		--icon-accent: var(--accent);
	}

	.action-row.pay .action-icon {
		background: var(--arcane-dim);
		color: var(--arcane);
		--icon-accent: var(--arcane);
	}

	.action-text {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.action-name {
		font-family: var(--font-display);
		font-size: 0.88rem;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.action-hint {
		font-size: 0.75rem;
		color: var(--text-faint);
	}

	/* ═══════════════════════════════════════════════════════
	   NANNY WATCH (nanny role)
	   ═══════════════════════════════════════════════════════ */

	.nanny-watch {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1.25rem 0.75rem;
		text-align: center;
		flex: 1;
	}

	.nanny-watch.active {
		background: radial-gradient(60% 80% at 50% 0%, var(--growing-dim), transparent 70%);
		border-radius: var(--radius-sm);
	}

	.watch-status {
		margin-bottom: 0.35rem;
	}

	.watch-elapsed {
		font-family: var(--font-pixel);
		font-size: clamp(1.75rem, 6vw, 2.5rem);
		font-weight: 600;
		color: var(--growing);
		text-shadow: 0 0 20px var(--growing-dim);
	}

	.watch-elapsed.dim {
		color: var(--text-faint);
		text-shadow: none;
	}

	.watch-since {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-bottom: 0.65rem;
	}

	/* ═══════════════════════════════════════════════════════
	   ROSTER SECTION (collapsible)
	   ═══════════════════════════════════════════════════════ */

	.roster-section {
		margin-bottom: var(--section-gap);
	}

	.roster-toggle {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		padding: 0.85rem 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		cursor: pointer;
		font-family: var(--font-display);
		font-size: 0.88rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		transition: all var(--transition-fast);
		--icon-accent: var(--accent);
	}

	.roster-toggle:hover {
		border-color: var(--accent);
		color: var(--text);
	}

	.roster-chevron {
		margin-left: auto;
		color: var(--text-faint);
		transition: transform var(--transition-normal);
		display: grid;
		place-items: center;
	}

	.roster-chevron.open {
		transform: rotate(90deg);
	}

	.roster-body {
		margin-top: 0.65rem;
		padding: var(--card-padding);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		box-shadow: var(--shadow-md);
	}

	.roster-controls {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 0.85rem;
	}

	/* ═══════════════════════════════════════════════════════
	   NANNY CARDS (inside roster)
	   ═══════════════════════════════════════════════════════ */

	.nanny-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(290px, 100%), 1fr));
		gap: var(--grid-gap);
	}

	.nanny-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		padding: 1.15rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		transition: all var(--transition-normal);
		overflow: hidden;
	}

	.nanny-card:hover {
		transform: translateY(-2px);
		border-color: var(--border-gilt);
		box-shadow: var(--shadow-md);
	}

	.nanny-card.active {
		border-color: rgba(111, 191, 115, 0.45);
		box-shadow: var(--glow-moss);
	}

	.nanny-card.active::before {
		content: '';
		position: absolute;
		top: 0; left: 0; right: 0;
		height: 2px;
		background: linear-gradient(90deg, transparent, var(--growing), transparent);
		animation: creep 3s ease-in-out infinite;
	}

	@keyframes creep {
		0%, 100% { opacity: 0.35; transform: translateX(-30%); }
		50% { opacity: 1; transform: translateX(30%); }
	}

	.nanny-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.nanny-header h3 {
		font-family: var(--font-display);
		font-size: 1.02rem;
		color: var(--text);
	}

	.nanny-details {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1.25rem;
		font-size: 0.9rem;
	}

	.nanny-details div {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
	}

	.nanny-details dt {
		font-family: var(--font-body);
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.11em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.nanny-details dd {
		color: var(--text-muted);
	}

	.active-shift {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.65rem 0.8rem;
		background: var(--growing-dim);
		border-left: 2px solid var(--growing);
		border-radius: var(--radius-sm);
		color: var(--growing);
		--icon-accent: var(--growing);
	}

	.active-shift div {
		display: flex;
		flex-direction: column;
	}

	.shift-since {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		opacity: 0.75;
	}

	.shift-elapsed {
		font-size: 1.05rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.nanny-actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		margin-top: auto;
	}

	.nanny-actions .danger:hover {
		color: var(--danger);
		border-color: var(--danger);
		background: var(--danger-dim);
	}

	/* ═══════════════════════════════════════════════════════
	   MISC
	   ═══════════════════════════════════════════════════════ */

	.error-card {
		padding: 0;
	}
</style>
