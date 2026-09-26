<script>
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		getWeekBounds,
		localDateString,
		normalizeDateValue,
		getMonthGridRange
	} from '$lib/time.js';
	import { formatMoney } from '$lib/money.js';
	import { outstandingBalance, LEDGER_WEEKS } from '$lib/ledger.js';
	import { errorMessage } from '$lib/errors.js';
	import Icon from '$lib/icons/Icon.svelte';
	import MoonPhase from '$lib/components/MoonPhase.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import MiniCalendar from '$lib/components/MiniCalendar.svelte';
	import ShelfFooter from '$lib/components/ShelfFooter.svelte';
	import PixelArt from '$lib/components/PixelArt.svelte';
	import CareGlance from '$lib/components/CareGlance.svelte';
	import { ART } from '$lib/art.js';

	/*
	 * Home: the household's page. For now the hearth, a window onto Care, the
	 * week's money and the month; the grocery list, chores and the family
	 * calendar land here next. The nanny's landing page is Care, so /home
	 * sends them there.
	 */

	/** @type {Record<string, string>} */
	const ROLE_TITLES = {
		admin: 'The Keeper',
		family: 'The Household',
		nanny: 'The Guardian'
	};

	/** @type {any} */
	let user = null;
	/** @type {any} */
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
	/** @type {string[]} */
	let monthShiftDates = [];
	/** @type {{ startStr: string, endStr: string } | null} */
	let monthRange = null;
	/** Completed entries and payment rows behind the owed balance (see outstandingBalance). */
	/** @type {any[]} */
	let owedEntries = [];
	/** @type {any[]} */
	let owedPayments = [];
	let owedSince = '';
	/** What's on the grocery list now; null until it loads (or if the table isn't there yet). */
	/** @type {any[] | null} */
	let groceries = null;
	/** @type {any[]} */
	let groceryLists = [];
	let now = Date.now();

	/** @type {ReturnType<typeof supabase.channel> | null} */
	let homeChannel = null;
	/** @type {ReturnType<typeof setInterval> | null} */
	let pollInterval = null;
	/** @type {ReturnType<typeof setInterval> | null} */
	let tickInterval = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let reloadTimer = null;

	onMount(() => {
		initHome();
		// The running shift's hours climb on the minute, not the second.
		tickInterval = setInterval(() => {
			now = Date.now();
		}, 30000);
		pollInterval = setInterval(() => {
			reloadHome();
		}, 30000);
	});

	onDestroy(() => {
		if (homeChannel) supabase.removeChannel(homeChannel);
		if (pollInterval) clearInterval(pollInterval);
		if (tickInterval) clearInterval(tickInterval);
		if (reloadTimer) clearTimeout(reloadTimer);
	});

	async function initHome() {
		loading = true;
		initError = null;

		try {
			const {
				data: { user: currentUser }
			} = await supabase.auth.getUser();
			if (!currentUser) {
				goto(resolve('/'));
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

			if (!profile || !profile.role) {
				goto(resolve('/setup'));
				return;
			}

			if (profile.role === 'nanny') {
				goto(resolve('/care'), { replaceState: true });
				return;
			}

			await loadHome();

			if (!homeChannel) subscribeToShifts();
			loading = false;
		} catch (err) {
			initError = errorMessage(err);
			loading = false;
		}
	}

	async function reloadHome() {
		if (!profile || profile.role === 'nanny') return;
		try {
			await loadHome();
		} catch (err) {
			console.warn('Home refresh failed:', errorMessage(err));
		}
	}

	function scheduleReload() {
		if (reloadTimer) clearTimeout(reloadTimer);
		reloadTimer = setTimeout(() => {
			reloadTimer = null;
			reloadHome();
		}, 300);
	}

	function handleVisibilityChange() {
		if (document.visibilityState === 'visible' && !loading) scheduleReload();
	}

	async function loadHome() {
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

		await Promise.all([loadMonthShifts(), loadOwed(), loadGroceries()]);
	}

	async function loadMonthShifts() {
		if (!monthRange) {
			const d = new Date();
			monthRange = getMonthGridRange(d.getFullYear(), d.getMonth());
		}
		try {
			const { data, error } = await supabase
				.from('schedules')
				.select('date')
				.gte('date', monthRange.startStr)
				.lte('date', monthRange.endStr);

			if (error) throw error;
			monthShiftDates = (data || []).map((s) => normalizeDateValue(s.date));
		} catch (err) {
			console.warn('Month shifts load failed:', errorMessage(err));
			monthShiftDates = [];
		}
	}

	async function loadGroceries() {
		try {
			const [listsRes, itemsRes] = await Promise.all([
				supabase
					.from('grocery_lists')
					.select('id, name')
					.order('position', { ascending: true })
					.order('created_at', { ascending: true }),
				supabase
					.from('grocery_items')
					.select('id, name, list_id')
					.is('checked_at', null)
					.order('added_at', { ascending: true })
			]);
			if (listsRes.error) throw listsRes.error;
			if (itemsRes.error) throw itemsRes.error;
			groceryLists = listsRes.data || [];
			groceries = itemsRes.data || [];
		} catch (err) {
			// Before supabase/grocery_items.sql has run, the card just stays away.
			console.warn('Grocery list load failed:', errorMessage(err));
			groceries = null;
		}
	}

	/** @param {CustomEvent<{ year: number, month: number, startStr: string, endStr: string }>} event */
	function handleMonthChange(event) {
		monthRange = event.detail;
		loadMonthShifts();
	}

	// The owed balance reads the same window and rules as the Purse on
	// Hours & Pay: a week worked but never recorded is owed, not just rows
	// marked unpaid.
	async function loadOwed() {
		try {
			const since = getWeekBounds(-(LEDGER_WEEKS - 1)).start;
			const [entriesRes, paymentsRes] = await Promise.all([
				supabase
					.from('time_entries')
					.select('nanny_id, clock_in, hours')
					.not('clock_out', 'is', null)
					.gte('clock_in', since.toISOString()),
				supabase.from('payments').select('*')
			]);
			if (entriesRes.error) throw entriesRes.error;
			if (paymentsRes.error) throw paymentsRes.error;
			owedEntries = entriesRes.data || [];
			owedPayments = paymentsRes.data || [];
			owedSince = localDateString(since);
		} catch (err) {
			console.warn('Owed balance load failed:', errorMessage(err));
			owedEntries = [];
			owedPayments = [];
		}
	}

	function subscribeToShifts() {
		homeChannel = supabase
			.channel('home-shifts')
			.on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, () => {
				scheduleReload();
			})
			.on('postgres_changes', { event: '*', schema: 'public', table: 'grocery_items' }, () => {
				scheduleReload();
			})
			.subscribe();
	}

	/** @param {any} entry @param {number} nowMs */
	function entryHours(entry, nowMs) {
		if (entry.clock_out) return parseFloat(entry.hours) || 0;
		return (nowMs - new Date(entry.clock_in).getTime()) / (1000 * 60 * 60);
	}

	$: hoursToday = weekEntries
		.filter((e) => localDateString(new Date(e.clock_in)) === localDateString(new Date(now)))
		.reduce((sum, e) => sum + entryHours(e, now), 0)
		.toFixed(1);

	$: weeklyTotal = weekEntries.reduce((sum, e) => {
		const rate = nannies.find((n) => n.id === e.nanny_id)?.hourly_rate || 20;
		return sum + entryHours(e, now) * rate;
	}, 0);

	// Finished weeks only: the week in progress is already the "this week" tile.
	$: owed = outstandingBalance(
		owedEntries,
		owedPayments,
		(id) => nannies.find((n) => n.id === id)?.hourly_rate || 20,
		owedSince,
		localDateString(getWeekBounds(0).start)
	);

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

{#if loading}
	<div class="container">
		<div class="welcome">
			<div class="skeleton skeleton-line" style="width: 40%; height: 2rem"></div>
		</div>
		<Skeleton variant="card" count={3} />
	</div>
{:else if initError}
	<div class="container">
		<div class="card arcana error-card">
			<EmptyState icon="warning" title="The scrying pool is clouded" hint={initError}>
				<button class="btn btn-primary" on:click={initHome}>
					<Icon name="star" size={14} /> Try again
				</button>
			</EmptyState>
		</div>
	</div>
{:else}
	<div class="container">
		<div class="today-grid">
			<!-- ── Hero: The Hearth ──────────────────────── -->
			<section class="tcard hero-card">
				<div class="hero-badge">THE HEARTH</div>
				<h1 class="hero-greeting">{greeting},<br />{profile?.full_name || 'friend'}!</h1>
				<p class="hero-subtitle">Here's what's happening at home today.</p>
				<div class="hero-scene" aria-hidden="true">
					<img
						src={ART.heroFamily}
						alt=""
						class="hero-art"
						width="768"
						height="768"
						fetchpriority="high"
						decoding="async"
						draggable="false"
					/>
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

			<!-- ── Right now: a window onto Care ─────────── -->
			<div class="glance-slot">
				<CareGlance />
			</div>

			<!-- ── Hours / Payment Summary ──────────────── -->
			<section class="tcard approval-card">
				<div class="tcard-header">
					<PixelArt src={ART.iconClock} size={24} />
					<h2>Hours &amp; Pay</h2>
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
						<span class="approval-big">{formatMoney(weeklyTotal)}</span>
						<span class="approval-label">this week</span>
					</div>
					<img
						class="approval-still"
						src={ART.stillClipboard}
						alt=""
						aria-hidden="true"
						loading="lazy"
						draggable="false"
					/>
				</div>

				{#if owed.amount >= 0.01}
					<div class="approval-alert unpaid">
						{formatMoney(owed.amount)} unpaid ({owed.hours.toFixed(1)} hrs)
					</div>
				{/if}

				<a href={resolve('/care/hours')} class="tcard-action accent">
					<Icon name="coin" size={12} /> Hours &amp; Pay
				</a>
			</section>

			<!-- ── The month ────────────────────────────── -->
			<section class="tcard calendar-card" class:wide={!groceries}>
				<div class="tcard-header">
					<PixelArt src={ART.navCalendar} size={24} />
					<h2>This Month</h2>
				</div>
				<MiniCalendar shiftDates={monthShiftDates} on:monthchange={handleMonthChange} />
				<!-- The cat and its books keep watch from the corner, beside the legend. -->
				<img
					class="calendar-still"
					src={ART.stillBooksCat}
					alt=""
					aria-hidden="true"
					loading="lazy"
					draggable="false"
				/>
			</section>

			<!-- ── The grocery list ─────────────────────── -->
			{#if groceries}
				<section class="tcard grocery-card">
					<div class="tcard-header">
						<PixelArt src={ART.iconCauldron} size={24} />
						<h2>Groceries</h2>
						<span class="grocery-count">{groceries.length}</span>
					</div>
					{#if groceryLists.length > 1}
						<p class="grocery-lists">
							{groceryLists
								.map((l) => `${l.name} ${groceries?.filter((g) => g.list_id === l.id).length || 0}`)
								.join(' · ')}
						</p>
					{/if}
					{#if groceries.length === 0}
						<p class="grocery-empty">Nothing on the list — the larder is full.</p>
					{:else}
						<ul class="grocery-peek">
							{#each groceries.slice(0, 6) as item (item.id)}
								<li>{item.name}</li>
							{/each}
						</ul>
						{#if groceries.length > 6}
							<p class="grocery-more">+ {groceries.length - 6} more</p>
						{/if}
					{/if}
					<a href={resolve('/home/groceries')} class="tcard-action accent">
						<Icon name="check" size={12} /> Open the list
					</a>
				</section>
			{/if}
		</div>

		<!-- The shelf grounds the page, and carries the outstanding balance. -->
		<ShelfFooter
			balanceDue={owed.amount >= 0.01 ? owed.amount : null}
			balanceLabel="Unpaid to date"
			note={owed.amount >= 0.01
				? `${owed.hours.toFixed(1)} hours across ${owed.weeks} past ${owed.weeks === 1 ? 'week' : 'weeks'} still to settle.`
				: ''}
			onBalanceClick={() => goto(resolve('/care/hours'))}
		/>
	</div>
{/if}

<style>
	/* ═══════════════════════════════════════════════════════
	   HOME GRID
	   ═══════════════════════════════════════════════════════ */

	.today-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--grid-gap);
		margin-bottom: var(--section-gap);
	}

	.hero-card {
		grid-column: 1;
		grid-row: 1;
	}
	.glance-slot {
		grid-column: 2;
		grid-row: 1;
		display: flex;
		flex-direction: column;
	}
	.approval-card {
		grid-column: 3;
		grid-row: 1;
	}
	.calendar-card {
		grid-column: 1 / 3;
		grid-row: 2;
	}
	.calendar-card.wide {
		grid-column: 1 / 4;
	}
	.grocery-card {
		grid-column: 3;
		grid-row: 2;
	}

	@media (max-width: 1024px) {
		.today-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.hero-card {
			grid-column: 1 / 3;
		}
		.glance-slot {
			grid-column: 1;
			grid-row: 2;
		}
		.approval-card {
			grid-column: 2;
			grid-row: 2;
		}
		.grocery-card {
			grid-column: 1 / 3;
			grid-row: 3;
		}
		.calendar-card,
		.calendar-card.wide {
			grid-column: 1 / 3;
			grid-row: 4;
		}
	}

	@media (max-width: 640px) {
		.today-grid {
			grid-template-columns: 1fr;
		}

		.hero-card,
		.glance-slot,
		.approval-card,
		.grocery-card,
		.calendar-card {
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

	/* The hearth scene. Cropped to a letterbox rather than shown square: the
	   cottage and the family sit in the lower two thirds of the painting, so a
	   square crop wastes the card's height on empty night sky. */
	.hero-scene {
		margin: 0.85rem calc(-1 * var(--card-padding, 1.25rem)) 0.9rem;
		height: 152px;
		overflow: hidden;
		border-block: 1px solid var(--border-gilt);
		background: var(--bg-deep);
	}

	.hero-art {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center 62%;
		user-select: none;
		-webkit-user-drag: none;
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
	   APPROVAL / PAYMENT CARD
	   ═══════════════════════════════════════════════════════ */

	.approval-stats {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.85rem;
	}

	/* The clipboard leans against the numbers, the way it does on the shelf. */
	.approval-still {
		width: 60px;
		height: 60px;
		flex-shrink: 0;
		object-fit: contain;
		user-select: none;
		-webkit-user-drag: none;
	}

	@media (max-width: 380px) {
		.approval-still {
			display: none;
		}
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
	   GROCERY CARD
	   ═══════════════════════════════════════════════════════ */

	.grocery-count {
		min-width: 1.6rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--accent-dim);
		color: var(--accent-bright);
		font-size: 0.8rem;
		font-weight: 700;
		text-align: center;
	}

	.grocery-peek {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0 0 0.85rem;
		padding: 0;
		list-style: none;
	}

	.grocery-peek li {
		padding-left: 1rem;
		position: relative;
		font-size: 0.95rem;
		color: var(--text);
	}

	.grocery-peek li::before {
		content: '';
		position: absolute;
		left: 0.2rem;
		top: 0.55em;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
	}

	.grocery-lists {
		margin: -0.35rem 0 0.7rem;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--text-faint);
	}

	.grocery-empty,
	.grocery-more {
		margin: 0 0 0.85rem;
		font-size: 0.88rem;
		font-style: italic;
		color: var(--text-faint);
	}

	/* ═══════════════════════════════════════════════════════
	   CALENDAR CARD
	   ═══════════════════════════════════════════════════════ */

	.calendar-card {
		min-height: 280px;
		position: relative;
	}

	/* Sits in the corner beside the legend row, which is left-aligned and
	   leaves this spot empty. The card clips overflow, so it stays inside. */
	.calendar-still {
		position: absolute;
		right: 14px;
		bottom: 10px;
		height: 52px;
		width: auto;
		pointer-events: none;
		user-select: none;
		-webkit-user-drag: none;
	}

	@media (max-width: 720px) {
		.calendar-still {
			display: none;
		}
	}

	/* ═══════════════════════════════════════════════════════
	   MISC
	   ═══════════════════════════════════════════════════════ */

	/* The loading skeleton's title bar still uses this class. */
	.welcome {
		margin-bottom: var(--section-gap);
	}

	.error-card {
		padding: 0;
	}
</style>
