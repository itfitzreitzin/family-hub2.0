<script>
	import { onMount, onDestroy } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { supabase } from '$lib/supabase';
	import { errorMessage } from '$lib/errors.js';
	import {
		localDateString,
		parseLocalDate,
		buildMonthGrid,
		getMonthGridRange,
		addMonths
	} from '$lib/time.js';
	import {
		eventItems,
		birthdayItems,
		groupByDay,
		timeLabel,
		itemState,
		syncStale,
		needsMigration,
		calendarWho,
		firstName,
		agoLabel
	} from '$lib/familyCalendar.js';
	import Icon from '$lib/icons/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import MonthGrid from '$lib/components/MonthGrid.svelte';
	import FamilyCalendars from '$lib/components/FamilyCalendars.svelte';

	/*
	 * Home → Calendar: the family's month. Each parent's Google calendar and
	 * the family's shared one, in their own colors, with the roster's
	 * birthdays; the calendar settings (connect, show on Home, what the nanny
	 * sees) open from here. The old shift planner still lives at /schedule.
	 */

	const MONTH_NAMES = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];

	/** @type {any} */
	let user = null;
	/** @type {any} */
	let profile = null;
	let initializing = true;
	/** @type {string | null} */
	let initError = null;
	let missingSetup = false;

	/** @type {any[]} */
	let people = [];
	/** @type {any[]} every calendar row the parent can see */
	let calendars = [];
	/** @type {any[]} */
	let members = [];
	/** @type {import('$lib/familyCalendar.js').FamilyItem[]} */
	let items = [];
	let monthLoading = false;
	/** @type {string | null} */
	let monthError = null;
	let loadToken = 0;

	const today = new Date();
	let monthYear = today.getFullYear();
	let monthMonth = today.getMonth();
	let selectedDateStr = localDateString(today);
	let now = Date.now();

	let showManager = false;
	let connectFirst = false;
	let syncing = false;

	/** @type {ReturnType<typeof setInterval> | null} */
	let tickInterval = null;

	onMount(() => {
		init();
		tickInterval = setInterval(() => (now = Date.now()), 60000);
	});

	onDestroy(() => {
		if (tickInterval) clearInterval(tickInterval);
	});

	async function init() {
		initializing = true;
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

			// The family calendar is the parents'; the nanny sees their busy
			// times on Care → Today.
			if (profile?.role === 'nanny') {
				goto(resolve('/care'), { replaceState: true });
				return;
			}

			await loadAll();
			initializing = false;

			if (!missingSetup && new URLSearchParams(window.location.search).get('connect')) {
				openManager(true);
			}
			freshen();
		} catch (err) {
			initError = errorMessage(err);
			initializing = false;
		}
	}

	async function loadAll() {
		const [peopleRes, calendarsRes, membersRes] = await Promise.all([
			supabase.from('profiles').select('id, full_name, role'),
			supabase.from('parent_calendars').select('*').order('created_at'),
			supabase
				.from('family_members')
				.select('id, name, kind, birthdate')
				.not('birthdate', 'is', null)
		]);
		if (peopleRes.error) throw peopleRes.error;
		if (calendarsRes.error) throw calendarsRes.error;
		people = peopleRes.data || [];
		calendars = calendarsRes.data || [];
		members = membersRes.error ? [] : membersRes.data || [];

		// Before supabase/family_calendar.sql has run, the settings columns
		// aren't there: say so instead of offering a form that can't save.
		if (calendars.length > 0) {
			missingSetup = !('show_on_home' in calendars[0]);
		} else {
			const probe = await supabase.from('parent_calendars').select('show_on_home').limit(1);
			missingSetup = !!probe.error && needsMigration(probe.error);
		}

		await loadMonth();
	}

	/**
	 * The feeds that belong to the family calendar: a parent's, with an
	 * address. (The nanny's availability calendars and the old planner's
	 * manual entries stay with the schedule page.) Plain functions rather
	 * than only `$:` values, so the loaders read fresh rows the moment
	 * they're assigned.
	 * @param {any[]} rows
	 * @param {any[]} everyone
	 */
	function familyCalendarsOf(rows, everyone) {
		const ids = new Set(
			everyone.filter((p) => p.role === 'family' || p.role === 'admin').map((p) => p.id)
		);
		return rows.filter((c) => c.calendar_url && ids.has(c.user_id));
	}

	/** @param {any[]} everyone @returns {Record<string, string>} */
	function namesOf(everyone) {
		return Object.fromEntries(everyone.map((p) => [p.id, p.full_name || '']));
	}

	async function loadMonth() {
		const token = ++loadToken;
		monthLoading = true;
		monthError = null;
		try {
			const { gridStart, gridEnd } = getMonthGridRange(monthYear, monthMonth);
			const rangeEnd = new Date(gridEnd.getTime() + 1);
			const shown = missingSetup
				? []
				: familyCalendarsOf(calendars, people).filter((c) => c.show_on_home);

			/** @type {any[]} */
			let events = [];
			if (shown.length > 0) {
				const { data, error } = await supabase
					.from('calendar_events')
					.select('id, calendar_id, title, start_time, end_time, all_day')
					.in(
						'calendar_id',
						shown.map((c) => c.id)
					)
					.lt('start_time', rangeEnd.toISOString())
					.gt('end_time', gridStart.toISOString())
					.order('start_time');
				if (error) throw error;
				events = data || [];
			}
			if (token !== loadToken) return;

			items = [
				...eventItems(events, new Map(shown.map((c) => [c.id, c])), namesOf(people)),
				...birthdayItems(members, gridStart, rangeEnd)
			];
		} catch (err) {
			if (token !== loadToken) return;
			monthError = errorMessage(err);
		} finally {
			if (token === loadToken) monthLoading = false;
		}
	}

	/** Re-sync anything shown here or shared with the nanny that's gone stale. */
	async function freshen() {
		if (missingSetup) return;
		const due = familyCalendarsOf(calendars, people).filter(
			(c) => c.show_on_home || c.nanny_sees !== 'nothing'
		);
		if (due.length === 0) return;
		syncing = true;
		try {
			if (await syncStale(supabase, due)) await reload();
		} finally {
			syncing = false;
		}
	}

	async function reload() {
		try {
			await loadAll();
		} catch (err) {
			monthError = errorMessage(err);
		}
	}

	/** @param {boolean} connect */
	function openManager(connect) {
		connectFirst = connect;
		showManager = true;
	}

	function closeManager() {
		showManager = false;
		if (connectFirst && window.location.search) {
			// Drop ?connect=1 so a refresh doesn't reopen the form.
			replaceState(resolve('/home/calendar'), {});
		}
	}

	/** @param {-1 | 1} delta */
	function changeMonth(delta) {
		const next = addMonths(monthYear, monthMonth, delta);
		monthYear = next.year;
		monthMonth = next.month;
		loadMonth();
	}

	function goToday() {
		const d = new Date();
		monthYear = d.getFullYear();
		monthMonth = d.getMonth();
		selectedDateStr = localDateString(d);
		loadMonth();
	}

	/** @param {CustomEvent<{ dateStr: string }>} event */
	function selectDay(event) {
		selectedDateStr = event.detail.dateStr;
	}

	$: parents = people.filter((p) => p.role === 'family' || p.role === 'admin');
	$: namesById = namesOf(people);
	$: familyCalendars = familyCalendarsOf(calendars, people);
	$: homeCalendars = familyCalendars.filter((c) => c.show_on_home);
	$: nannies = people.filter((p) => p.role === 'nanny');
	$: nannyName =
		nannies.length === 1 ? firstName(nannies[0].full_name) || 'The nanny' : 'The nanny';

	$: grid = getMonthGridRange(monthYear, monthMonth);
	$: weeks = buildMonthGrid(monthYear, monthMonth, localDateString(new Date(now)));
	$: itemsByDay = groupByDay(items, grid.gridStart, grid.gridEnd);
	$: selectedItems = itemsByDay[selectedDateStr] || [];
	$: todayStr = localDateString(new Date(now));
	$: dayHeading =
		selectedDateStr === todayStr
			? 'Today'
			: parseLocalDate(selectedDateStr).toLocaleDateString('en-US', {
					weekday: 'long',
					month: 'long',
					day: 'numeric'
				});
	$: oldestSync = homeCalendars
		.map((c) => c.last_synced)
		.filter(Boolean)
		.sort()[0];
</script>

<div class="container">
	{#if initializing}
		<Skeleton variant="card" count={2} />
	{:else if initError}
		<div class="card arcana">
			<EmptyState icon="warning" title="The calendar won't open" hint={initError}>
				<button class="btn btn-primary" on:click={init}>
					<Icon name="star" size={16} /> Try again
				</button>
			</EmptyState>
		</div>
	{:else}
		<div class="page-head">
			<div>
				<h1>Calendar</h1>
				<p class="lede">The family's month — every calendar in one place.</p>
			</div>
			{#if !missingSetup}
				<button
					type="button"
					class="btn btn-secondary settings-btn"
					on:click={() => openManager(false)}
				>
					<Icon name="calendar" size={15} /> Calendars
				</button>
			{/if}
		</div>

		{#if missingSetup}
			<div class="card arcana">
				<EmptyState
					icon="calendar"
					title="One step left"
					hint="Run supabase/family_calendar.sql once in the Supabase SQL editor, then connect your calendars here."
				/>
			</div>
		{:else}
			{#if familyCalendars.length === 0}
				<div class="card arcana connect-card">
					<EmptyState
						icon="calendar"
						title="No calendars yet"
						hint="Connect each of your Google calendars and the family's, and the month fills in — on here and on the front page."
					>
						<button class="btn btn-primary" on:click={() => openManager(true)}>
							<Icon name="plus" size={15} /> Connect a calendar
						</button>
					</EmptyState>
				</div>
			{/if}

			<div class="month-layout">
				<div class="month-main">
					<div class="month-nav">
						<h2 class="month-title">{MONTH_NAMES[monthMonth]} {monthYear}</h2>
						<div class="month-arrows">
							<button
								type="button"
								class="icon-btn"
								aria-label="Previous month"
								on:click={() => changeMonth(-1)}
							>
								<Icon name="chevron-left" size={14} />
							</button>
							<button type="button" class="btn-small" on:click={goToday}>Today</button>
							<button
								type="button"
								class="icon-btn"
								aria-label="Next month"
								on:click={() => changeMonth(1)}
							>
								<Icon name="chevron-right" size={14} />
							</button>
						</div>
					</div>

					{#if monthError}
						<p class="month-error"><Icon name="warning" size={13} /> {monthError}</p>
					{/if}

					<div class="grid-wrap" class:dim={monthLoading}>
						<MonthGrid {weeks} {itemsByDay} {selectedDateStr} on:selectday={selectDay} />
					</div>
				</div>

				<aside class="day-panel">
					<section class="panel-card">
						<h2 class="panel-title">{dayHeading}</h2>
						{#if selectedItems.length === 0}
							<p class="panel-quiet">Nothing on the calendar.</p>
						{:else}
							<ul class="day-list">
								{#each selectedItems as item (item.id)}
									{@const state = selectedDateStr === todayStr ? itemState(item, now) : 'upcoming'}
									<li
										class="day-row"
										class:past={!item.allDay && state === 'past'}
										class:birthday={item.kind === 'birthday'}
										style:--cal={item.color || null}
									>
										<span class="day-bar" aria-hidden="true"></span>
										<span class="day-text">
											<span class="day-title">
												{#if item.kind === 'birthday'}<Icon name="star" size={12} />{/if}
												{item.title}
											</span>
											<span class="day-time"
												>{timeLabel(item, parseLocalDate(selectedDateStr))}</span
											>
										</span>
										{#if item.who}<span class="day-who">{item.who}</span>{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</section>

					{#if familyCalendars.length > 0}
						<section class="panel-card">
							<h2 class="panel-title">On Home</h2>
							{#if homeCalendars.length === 0}
								<p class="panel-quiet">No calendar is switched on for Home.</p>
							{:else}
								<ul class="legend">
									{#each homeCalendars as cal (cal.id)}
										<li style:--cal={cal.color || null}>
											<span class="legend-dot" aria-hidden="true"></span>
											<span class="legend-name">{cal.calendar_name}</span>
											<span class="legend-who">{calendarWho(cal, namesById)}</span>
										</li>
									{/each}
								</ul>
							{/if}
							<p class="panel-foot">
								{#if syncing}
									Syncing…
								{:else if oldestSync}
									Synced {agoLabel(oldestSync, now)}
								{/if}
							</p>
							<button type="button" class="btn-small" on:click={() => openManager(false)}>
								Calendar settings
							</button>
						</section>
					{/if}
				</aside>
			</div>
		{/if}
	{/if}
</div>

{#if showManager}
	<FamilyCalendars
		{calendars}
		{parents}
		{user}
		{nannyName}
		startWithConnect={connectFirst}
		onclose={closeManager}
		onchange={reload}
	/>
{/if}

<style>
	.page-head h1 {
		color: var(--accent-bright);
	}

	.lede {
		color: var(--text-faint);
		font-size: 0.95rem;
		margin-top: 0.2rem;
	}

	.settings-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}

	.connect-card {
		padding: 0.5rem;
	}

	.month-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: var(--grid-gap);
		align-items: start;
	}

	.month-main {
		min-width: 0;
	}

	.month-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.month-title {
		margin: 0;
		font-size: 1.2rem;
		color: var(--text);
	}

	.month-arrows {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.month-error {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 0 0.75rem;
		font-size: 0.88rem;
		color: var(--danger);
	}

	.grid-wrap {
		transition: opacity var(--transition-fast);
	}

	.grid-wrap.dim {
		opacity: 0.6;
	}

	.day-panel {
		display: flex;
		flex-direction: column;
		gap: var(--grid-gap);
	}

	.panel-card {
		padding: 1.1rem 1.15rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		box-shadow: var(--shadow-md);
	}

	.panel-title {
		margin: 0 0 0.75rem;
		font-size: 1rem;
		color: var(--accent-bright);
	}

	.panel-quiet {
		margin: 0;
		font-style: italic;
		color: var(--text-faint);
	}

	.day-list {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.day-row {
		display: flex;
		align-items: stretch;
		gap: 0.6rem;
	}

	.day-row.past {
		opacity: 0.5;
	}

	.day-bar {
		width: 4px;
		flex-shrink: 0;
		border-radius: 2px;
		background: var(--cal, var(--arcane));
	}

	.day-row.birthday .day-bar {
		background: var(--accent);
	}

	.day-text {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.day-title {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-weight: 600;
		color: var(--text);
		overflow-wrap: anywhere;
		--icon-accent: var(--accent-bright);
	}

	.day-row.birthday .day-title {
		color: var(--accent-bright);
	}

	.day-time {
		font-size: 0.84rem;
		font-variant-numeric: lining-nums tabular-nums;
		color: var(--text-muted);
	}

	.day-who {
		align-self: center;
		flex-shrink: 0;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text-faint);
	}

	.legend {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0 0 0.6rem;
		padding: 0;
		list-style: none;
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}

	.legend-dot {
		width: 10px;
		height: 10px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--cal, var(--arcane));
	}

	.legend-name {
		flex: 1;
		min-width: 0;
		color: var(--text);
		overflow-wrap: anywhere;
	}

	.legend-who {
		font-size: 0.78rem;
		color: var(--text-faint);
	}

	.panel-foot {
		margin: 0 0 0.6rem;
		font-size: 0.8rem;
		color: var(--text-faint);
	}

	@media (max-width: 900px) {
		.month-layout {
			grid-template-columns: 1fr;
		}
	}
</style>
