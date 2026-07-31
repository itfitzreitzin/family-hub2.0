<script>
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabase';
	import Nav from '$lib/Nav.svelte';
	import { goto } from '$app/navigation';
	import { toast, confirm as confirmModal } from '$lib/stores/toast.js';
	import { getWeekBounds, localDateString, formatTime } from '$lib/time.js';
	import { errorMessage } from '$lib/errors.js';
	import Icon from '$lib/icons/Icon.svelte';
	import MoonPhase from '$lib/components/MoonPhase.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	// Roles, retitled as the household's arcana.
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
	let now = Date.now();
	let showAddNanny = false;
	let selectedNanny = null;
	let nannyEmail = '';
	let nannyName = '';
	let nannyRate = 20;
	let nannyVenmo = '';
	let nannyPassword = '';

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
				// Update existing nanny
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
				// Create new nanny
				if (!nannyEmail || !nannyPassword) {
					toast.error('Email and password required for new nanny');
					return;
				}

				const { data: authData, error: authError } = await supabase.auth.signUp({
					email: nannyEmail,
					password: nannyPassword
				});

				if (authError) throw authError;

				// Create profile
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
			// Delete time entries first
			await supabase.from('time_entries').delete().eq('nanny_id', nanny.id);

			// Delete profile
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

		tickInterval = setInterval(() => {
			now = Date.now();
		}, 1000);

		// Fallback refresh in case a realtime event is missed or unavailable
		pollInterval = setInterval(() => {
			reloadDashboard();
		}, 30000);
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
			const {
				data: { user: currentUser }
			} = await supabase.auth.getUser();

			if (!currentUser) {
				goto('/');
				return;
			}

			user = currentUser;

			const { data: profileData, error: profileError } = await supabase
				.from('profiles')
				.select('*')
				.eq('id', user.id)
				.maybeSingle();

			if (profileError) throw profileError;
			profile = profileData;

			// If no profile or missing role, send to setup
			if (!profile || !profile.role) {
				goto('/setup');
				return;
			}

			if (profile?.role === 'family' || profile?.role === 'admin') {
				await loadFamilyDashboard();
			} else if (profile?.role === 'nanny') {
				await loadNannyDashboard();
			}

			if (!dashChannel) {
				subscribeToShifts();
			}

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
			// Background refresh: keep showing the last good data
			console.warn('Dashboard refresh failed:', errorMessage(err));
		}
	}

	function scheduleReload() {
		if (reloadTimer) clearTimeout(reloadTimer);
		reloadTimer = setTimeout(() => {
			reloadTimer = null;
			reloadDashboard();
		}, 300);
	}

	function handleVisibilityChange() {
		if (document.visibilityState === 'visible' && !loading) {
			scheduleReload();
		}
	}

	async function loadFamilyDashboard() {
		// Get all nannies
		const { data: nanniesData, error: nanniesError } = await supabase
			.from('profiles')
			.select('*')
			.eq('role', 'nanny')
			.order('full_name');

		if (nanniesError) throw nanniesError;
		nannies = nanniesData || [];

		// Get active shifts (not clocked out)
		const { data: shiftsData, error: shiftsError } = await supabase
			.from('time_entries')
			.select('*')
			.is('clock_out', null);

		if (shiftsError) throw shiftsError;
		activeShifts = shiftsData || [];

		// This week's entries, all nannies — the stat tiles derive from these
		const bounds = getWeekBounds(0);
		const { data: weekData, error: weekError } = await supabase
			.from('time_entries')
			.select('*')
			.gte('clock_in', bounds.start.toISOString())
			.lte('clock_in', bounds.end.toISOString());

		if (weekError) throw weekError;
		weekEntries = weekData || [];
	}

	async function loadNannyDashboard() {
		// Get nanny's active shift
		const { data: shiftData, error } = await supabase
			.from('time_entries')
			.select('*')
			.eq('nanny_id', user.id)
			.is('clock_out', null)
			.order('clock_in', { ascending: false })
			.limit(1)
			.maybeSingle();

		if (error) throw error;

		if (shiftData) {
			activeShifts = [shiftData];
		} else {
			activeShifts = [];
		}
	}

	function subscribeToShifts() {
		// Subscribe without a clock_out filter: a clock-out UPDATE removes the row
		// from the filtered set, so filtered subscriptions never deliver it.
		dashChannel = supabase
			.channel('active_shifts')
			.on(
				'postgres_changes',
				{
					event: '*',
					schema: 'public',
					table: 'time_entries'
				},
				() => {
					scheduleReload();
				}
			)
			.subscribe();
	}
	function isNannyActive(nannyId) {
		return activeShifts.some((shift) => shift.nanny_id === nannyId);
	}

	function getActiveShift(nannyId) {
		return activeShifts.find((shift) => shift.nanny_id === nannyId);
	}

	/**
	 * @param {string} dateString
	 * @param {number} nowMs
	 */
	function getTimeSince(dateString, nowMs) {
		const diff = Math.max(0, nowMs - new Date(dateString).getTime());

		const hours = Math.floor(diff / (1000 * 60 * 60));
		const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

		return `${hours}h ${minutes}m`;
	}

	/**
	 * @param {any} entry
	 * @param {number} nowMs
	 */
	function entryHours(entry, nowMs) {
		if (entry.clock_out) return parseFloat(entry.hours) || 0;
		return (nowMs - new Date(entry.clock_in).getTime()) / (1000 * 60 * 60);
	}

	// Hours worked today across all nannies: completed shifts keep their value
	// after clock-out, open shifts tick up live.
	$: hoursToday = weekEntries
		.filter((e) => localDateString(new Date(e.clock_in)) === localDateString(new Date(now)))
		.reduce((sum, e) => sum + entryHours(e, now), 0)
		.toFixed(1);

	// Total cost of this week's shifts (completed + in progress) at each
	// nanny's rate.
	$: weeklyTotal = weekEntries
		.reduce((sum, e) => {
			const rate = nannies.find((n) => n.id === e.nanny_id)?.hourly_rate || 20;
			return sum + entryHours(e, now) * rate;
		}, 0)
		.toFixed(2);

	// Greeting shifts with the hour, so the hearth feels awake at the right times.
	$: greeting = (() => {
		const hour = new Date(now).getHours();
		if (hour < 5) return 'Still awake';
		if (hour < 12) return 'Good morning';
		if (hour < 17) return 'Good afternoon';
		if (hour < 21) return 'Good evening';
		return 'Good night';
	})();
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
		<!-- ── Greeting ─────────────────────────────────────── -->
		<header class="welcome">
			<div class="welcome-text">
				<p class="greeting">{greeting}</p>
				<h1>{profile?.full_name || 'friend'}</h1>
				<div class="welcome-meta">
					<span class="badge badge-gilt">{ROLE_TITLES[profile?.role] || profile?.role}</span>
					<MoonPhase size={16} showLabel />
				</div>
			</div>
			<div class="welcome-glyph" aria-hidden="true">
				<Icon name={profile?.role === 'nanny' ? 'sprout' : 'cottage'} size={72} />
			</div>
		</header>

		{#if profile?.role === 'family' || profile?.role === 'admin'}
			<!-- ── The four suits ─────────────────────────────── -->
			<div class="stats-row rise-in">
				{#each [{ icon: 'person', value: nannies.length, label: 'Keepers', numeral: 'I' }, { icon: 'sprout', value: activeShifts.length, label: 'On the clock', numeral: 'II', live: activeShifts.length > 0 }, { icon: 'hourglass', value: hoursToday, label: 'Hours today', numeral: 'III' }, { icon: 'coin', value: '$' + weeklyTotal, label: 'Week total', numeral: 'IV' }] as stat (stat.numeral)}
					<div class="stat-card" class:live={stat.live}>
						<span class="numeral" aria-hidden="true">{stat.numeral}</span>
						<span class="stat-icon"><Icon name={stat.icon} size={26} /></span>
						<span class="stat-value">{stat.value}</span>
						<span class="stat-label">{stat.label}</span>
					</div>
				{/each}
			</div>

			<!-- ── Nanny roster ───────────────────────────────── -->
			<div class="card arcana">
				<div class="card-header">
					<h2>The Keepers</h2>
					<button class="btn btn-primary btn-small" on:click={() => (showAddNanny = true)}>
						<Icon name="plus" size={13} /> Add
					</button>
				</div>

				{#if nannies.length === 0}
					<EmptyState
						icon="cauldron"
						title="The cauldron is cold"
						hint="No keepers have joined the hearth yet. Add the first and their hours will start filling this ledger."
					>
						<button class="btn btn-primary" on:click={() => (showAddNanny = true)}>
							<Icon name="plus" size={14} /> Add your first keeper
						</button>
					</EmptyState>
				{:else}
					<div class="nanny-grid rise-in">
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
									<div>
										<dt>Rate</dt>
										<dd>${nanny.hourly_rate}/hr</dd>
									</div>
									{#if nanny.venmo_username}
										<div>
											<dt>Venmo</dt>
											<dd>@{nanny.venmo_username}</dd>
										</div>
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
										<Icon name="scroll" size={13} /> Ledger
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

			<!-- ── Quick actions ──────────────────────────────── -->
			<section class="quick-actions">
				<h2>The Ways</h2>
				<div class="action-grid rise-in">
					<a href="/history" class="action-card">
						<Icon name="scroll" size={36} />
						<span class="action-title">The Ledger</span>
						<span class="action-desc">Every shift, recorded</span>
					</a>
					{#if profile?.role === 'admin'}
						<a href="/admin" class="action-card">
							<Icon name="key" size={36} />
							<span class="action-title">The Keys</span>
							<span class="action-desc">Manage the household</span>
						</a>
					{/if}
					<a href="/settings" class="action-card">
						<Icon name="candle" size={36} />
						<span class="action-title">The Self</span>
						<span class="action-desc">Tend your own profile</span>
					</a>
				</div>
			</section>
		{:else if profile?.role === 'nanny'}
			<!-- ── Nanny view ─────────────────────────────────── -->
			<div class="card arcana">
				<h2>Your Watch</h2>

				{#if activeShifts.length > 0}
					{@const shift = activeShifts[0]}
					<div class="watch-banner active">
						<div class="watch-glyph" aria-hidden="true"><Icon name="hourglass" size={48} /></div>
						<span class="badge badge-live"><span class="live-dot"></span> On the clock</span>
						<p class="watch-elapsed">{getTimeSince(shift.clock_in, now)}</p>
						<p class="watch-since">Since {formatTime(shift.clock_in)}</p>
						<a href="/tracker" class="btn btn-primary">
							<Icon name="hourglass" size={15} /> Go to the tracker
						</a>
					</div>
				{:else}
					<div class="watch-banner">
						<div class="watch-glyph" aria-hidden="true"><Icon name="candle" size={48} /></div>
						<span class="badge">Not clocked in</span>
						<p class="watch-elapsed dim">00:00:00</p>
						<p class="watch-since">Ready when you are</p>
						<a href="/tracker" class="btn btn-success">
							<Icon name="sprout" size={15} /> Begin your shift
						</a>
					</div>
				{/if}
			</div>

			<section class="quick-actions">
				<h2>The Ways</h2>
				<div class="action-grid rise-in">
					<a href="/tracker" class="action-card">
						<Icon name="hourglass" size={36} />
						<span class="action-title">The Hours</span>
						<span class="action-desc">Clock in and out</span>
					</a>
					<a href="/history" class="action-card">
						<Icon name="scroll" size={36} />
						<span class="action-title">Your Ledger</span>
						<span class="action-desc">Shifts and earnings</span>
					</a>
					<a href="/settings" class="action-card">
						<Icon name="candle" size={36} />
						<span class="action-title">The Self</span>
						<span class="action-desc">Rate, name and Venmo</span>
					</a>
				</div>
			</section>
		{/if}
	</div>
{/if}

<!-- ── Add / edit keeper ──────────────────────────────── -->
{#if showAddNanny}
	<div class="modal-overlay" on:click={cancelNannyForm} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>{selectedNanny ? 'Edit keeper' : 'Add a keeper'}</h2>

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
						{selectedNanny ? 'Save changes' : 'Add to the hearth'}
					</button>
					<button type="button" class="btn btn-secondary" on:click={cancelNannyForm}>Cancel</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	/* ── Greeting ──────────────────────────────────────────── */
	.welcome {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		margin-bottom: var(--section-gap);
		padding-bottom: 1.25rem;
		border-bottom: 1px solid var(--border-soft);
	}

	.greeting {
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--text-faint);
		margin-bottom: 0.15rem;
	}

	.welcome h1 {
		font-family: var(--font-display);
		color: var(--text);
		margin-bottom: 0.6rem;
	}

	.welcome-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.welcome-glyph {
		flex-shrink: 0;
		color: var(--text-faint);
		opacity: 0.55;
		--icon-accent: var(--accent);
		animation: flicker 5s ease-in-out infinite;
	}

	/* ── Stat cards: the four suits ────────────────────────── */
	.stats-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: var(--grid-gap);
		margin-bottom: var(--section-gap);
	}

	.stat-card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 1.4rem 1rem 1.1rem;
		background: var(--surface);
		background-image: linear-gradient(160deg, var(--accent-tint), transparent 55%);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		box-shadow: var(--shadow-md);
		color: var(--text-faint);
		transition: all var(--transition-normal);
		--icon-accent: var(--accent);
	}

	.stat-card:hover {
		transform: translateY(-3px);
		border-color: var(--border-gilt);
		box-shadow: var(--shadow-lg);
	}

	.stat-card.live {
		border-color: rgba(111, 191, 115, 0.45);
		box-shadow: var(--glow-moss);
		--icon-accent: var(--growing);
	}

	.stat-card.live .stat-value {
		color: var(--growing);
	}

	.numeral {
		position: absolute;
		top: 0.55rem;
		left: 0.8rem;
		font-family: var(--font-display);
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: var(--accent);
		opacity: 0.55;
	}

	.stat-icon {
		display: grid;
		place-items: center;
		margin-bottom: 0.3rem;
	}

	/*
   * Tabular body figures, not the pixel face: these are money and hours the
   * household acts on, and Pixelify's 5 and 8 are too alike to risk here. The
   * pixel face stays on the big shift timer, where size removes any doubt.
   */
	.stat-value {
		font-size: clamp(1.45rem, 3.5vw, 1.85rem);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
		color: var(--text);
	}

	.stat-label {
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
	}

	/* ── Keeper cards ──────────────────────────────────────── */
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

	/* An active keeper's card grows a soft moss glow and a creeping top edge. */
	.nanny-card.active {
		border-color: rgba(111, 191, 115, 0.45);
		box-shadow: var(--glow-moss);
	}

	.nanny-card.active::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		background: linear-gradient(90deg, transparent, var(--growing), transparent);
		animation: creep 3s ease-in-out infinite;
	}

	@keyframes creep {
		0%,
		100% {
			opacity: 0.35;
			transform: translateX(-30%);
		}
		50% {
			opacity: 1;
			transform: translateX(30%);
		}
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

	/* ── Quick actions ─────────────────────────────────────── */
	.quick-actions {
		margin-top: var(--section-gap);
	}

	.quick-actions h2 {
		margin-bottom: 0.9rem;
		color: var(--accent-bright);
		font-size: 1rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.action-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr));
		gap: var(--grid-gap);
	}

	.action-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 1.6rem 1rem;
		text-align: center;
		text-decoration: none;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		color: var(--text-faint);
		transition: all var(--transition-normal);
		--icon-accent: var(--accent);
	}

	.action-card:hover {
		transform: translateY(-4px);
		border-color: var(--border-gilt);
		box-shadow: var(--shadow-lg);
		background-image: linear-gradient(160deg, var(--accent-tint), transparent 60%);
	}

	.action-title {
		font-family: var(--font-display);
		font-size: 0.98rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--text);
		margin-top: 0.4rem;
	}

	.action-desc {
		font-size: 0.85rem;
	}

	/* ── Nanny watch banner ────────────────────────────────── */
	.watch-banner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.55rem;
		padding: clamp(1.75rem, 6vw, 2.75rem) 1.25rem;
		text-align: center;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
	}

	.watch-banner.active {
		border-color: rgba(111, 191, 115, 0.45);
		box-shadow: var(--glow-moss);
		background-image: radial-gradient(60% 80% at 50% 0%, var(--growing-dim), transparent 70%);
	}

	.watch-glyph {
		color: var(--text-faint);
		--icon-accent: var(--accent);
		margin-bottom: 0.35rem;
	}

	.watch-banner.active .watch-glyph {
		color: var(--growing);
		--icon-accent: var(--growing);
	}

	.watch-elapsed {
		font-family: var(--font-pixel);
		font-size: clamp(2rem, 8vw, 3rem);
		font-weight: 600;
		letter-spacing: 0.03em;
		color: var(--growing);
		text-shadow: 0 0 26px var(--growing-dim);
	}

	.watch-elapsed.dim {
		color: var(--text-faint);
		text-shadow: none;
	}

	.watch-since {
		font-size: 0.9rem;
		color: var(--text-muted);
		margin-bottom: 0.75rem;
	}

	/* ── Misc ──────────────────────────────────────────────── */
	.error-card {
		padding: 0;
	}

	.hint {
		text-transform: none;
		letter-spacing: normal;
		font-weight: 400;
		opacity: 0.7;
	}

	@media (max-width: 768px) {
		.welcome-glyph {
			display: none;
		}

		.stats-row {
			grid-template-columns: repeat(2, 1fr);
		}

		.nanny-actions {
			gap: 0.35rem;
		}
	}
</style>
