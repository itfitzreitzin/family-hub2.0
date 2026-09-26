<script>
	import { onMount, onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import { supabase } from '$lib/supabase';
	import { errorMessage } from '$lib/errors.js';
	import { formatTime } from '$lib/time.js';
	import { ART } from '$lib/art.js';
	import Icon from '$lib/icons/Icon.svelte';
	import PixelArt from './PixelArt.svelte';
	import {
		loadHomeCalendar,
		agenda,
		itemState,
		timeLabel,
		syncStale,
		isStale,
		needsMigration,
		dayBounds,
		addDays
	} from '$lib/familyCalendar.js';

	/*
	 * Home's calendar card: today in full — the family's own calendars and
	 * the roster's birthdays — then tomorrow and what's coming. Feeds that
	 * haven't synced in a while re-sync quietly while it's open; the month and
	 * the calendar settings live on Home → Calendar.
	 */

	/** How often the card re-reads, and re-syncs anything gone stale. */
	const REFRESH_MS = 5 * 60 * 1000;
	/** How far ahead "Coming up" looks. */
	const LOOKAHEAD_DAYS = 14;

	/** @type {any[]} */
	let calendars = [];
	/** @type {import('$lib/familyCalendar.js').FamilyItem[]} */
	let items = [];
	let loaded = false;
	let missingSetup = false;
	/** @type {string | null} */
	let loadError = null;
	let syncing = false;
	let now = Date.now();

	/** @type {ReturnType<typeof setInterval> | null} */
	let tickInterval = null;
	/** @type {ReturnType<typeof setInterval> | null} */
	let refreshInterval = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let refreshTimer = null;
	let loadToken = 0;

	onMount(() => {
		refresh().then(() => freshen());
		tickInterval = setInterval(() => (now = Date.now()), 30000);
		refreshInterval = setInterval(() => {
			if (document.visibilityState === 'hidden') return;
			refresh().then(() => freshen());
		}, REFRESH_MS);
	});

	onDestroy(() => {
		if (tickInterval) clearInterval(tickInterval);
		if (refreshInterval) clearInterval(refreshInterval);
		if (refreshTimer) clearTimeout(refreshTimer);
	});

	async function refresh() {
		const token = ++loadToken;
		const { start } = dayBounds(new Date());
		try {
			const home = await loadHomeCalendar(supabase, start, addDays(start, LOOKAHEAD_DAYS + 2));
			if (token !== loadToken) return;
			calendars = home.calendars;
			items = home.items;
			missingSetup = false;
			loadError = null;
		} catch (err) {
			if (token !== loadToken) return;
			if (needsMigration(err)) missingSetup = true;
			else loadError = errorMessage(err);
		} finally {
			if (token === loadToken) {
				loaded = true;
				now = Date.now();
			}
		}
	}

	/** Re-sync any feed gone stale, then re-read if something came back. */
	async function freshen() {
		if (missingSetup || !calendars.some((c) => c.calendar_url && isStale(c, Date.now()))) return;
		syncing = true;
		try {
			const due = calendars.filter((c) => c.calendar_url);
			if (await syncStale(supabase, due)) await refresh();
		} finally {
			syncing = false;
		}
	}

	function scheduleRefresh() {
		if (refreshTimer) clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			refreshTimer = null;
			refresh();
		}, 300);
	}

	$: ag = agenda(items, new Date(now), { laterDays: LOOKAHEAD_DAYS });
	$: todayAllDay = ag.today.filter((i) => i.allDay);
	$: todayTimed = ag.today.filter((i) => !i.allDay);
	$: broken = calendars.filter((c) => c.sync_error);
	$: dateLabel = new Date(now).toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric'
	});

	/** @param {Date} d */
	function dayLabel(d) {
		return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
	}
</script>

<svelte:window on:focus={scheduleRefresh} />

<section class="today-card" aria-labelledby="family-today-title">
	<header class="today-head">
		<PixelArt src={ART.navCalendar} size={24} />
		<div class="today-titles">
			<h2 id="family-today-title">Today</h2>
			<span class="today-date">{dateLabel}</span>
		</div>
		{#if syncing}
			<span class="today-sync" role="status">Syncing…</span>
		{/if}
	</header>

	{#if !loaded}
		<div class="skeleton skeleton-line" style="width: 70%"></div>
		<div class="skeleton skeleton-line medium"></div>
		<div class="skeleton skeleton-line short"></div>
	{:else if missingSetup}
		<p class="today-quiet">
			The family calendar is almost ready: run <code>supabase/family_calendar.sql</code> once in Supabase,
			then connect your calendars here.
		</p>
	{:else if loadError}
		<p class="today-quiet">The calendar wouldn't open just now — {loadError}</p>
	{:else}
		{#if todayAllDay.length > 0}
			<ul class="allday" aria-label="All day">
				{#each todayAllDay as item (item.id)}
					<li
						class="allday-chip"
						class:birthday={item.kind === 'birthday'}
						style:--cal={item.color || null}
					>
						{#if item.kind === 'birthday'}<Icon name="star" size={12} />{/if}
						<span class="allday-title">{item.title}</span>
						{#if item.who}<span class="allday-who">{item.who}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if todayTimed.length > 0}
			<ul class="agenda">
				{#each todayTimed as item (item.id)}
					{@const state = itemState(item, now)}
					<li
						class="agenda-row"
						class:past={state === 'past'}
						class:now={state === 'now'}
						style:--cal={item.color || null}
					>
						<span class="agenda-bar" aria-hidden="true"></span>
						<span class="agenda-text">
							<span class="agenda-title">{item.title}</span>
							<span class="agenda-time">{timeLabel(item, new Date(now))}</span>
						</span>
						{#if state === 'now'}
							<span class="badge badge-live">Now</span>
						{/if}
						{#if item.who}<span class="agenda-who">{item.who}</span>{/if}
					</li>
				{/each}
			</ul>
		{:else if calendars.length > 0 && todayAllDay.length === 0}
			<p class="today-quiet">Nothing on the calendar today.</p>
		{/if}

		{#if calendars.length === 0}
			<div class="connect">
				<p>
					The family calendar lives here. Connect your Google calendars — each of yours and the
					family's — and the day shows up on the front page.
				</p>
				<a href="{resolve('/home/calendar')}?connect=1" class="btn btn-primary btn-connect">
					<Icon name="plus" size={14} /> Connect a calendar
				</a>
			</div>
		{/if}

		{#if ag.tomorrow.length > 0}
			<h3 class="agenda-label">Tomorrow</h3>
			<ul class="agenda compact">
				{#each ag.tomorrow as item (item.id)}
					<li
						class="agenda-row"
						class:birthday={item.kind === 'birthday'}
						style:--cal={item.color || null}
					>
						<span class="agenda-bar" aria-hidden="true"></span>
						<span class="agenda-when">{timeLabel(item, new Date(now))}</span>
						<span class="agenda-title">{item.title}</span>
						{#if item.who}<span class="agenda-who">{item.who}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if ag.later.length > 0}
			<h3 class="agenda-label">Coming up</h3>
			<ul class="agenda compact">
				{#each ag.later as item (item.id)}
					<li
						class="agenda-row"
						class:birthday={item.kind === 'birthday'}
						style:--cal={item.color || null}
					>
						<span class="agenda-bar" aria-hidden="true"></span>
						<span class="agenda-when"
							>{dayLabel(item.start)}{item.allDay ? '' : ` · ${formatTime(item.start)}`}</span
						>
						<span class="agenda-title">{item.title}</span>
						{#if item.who}<span class="agenda-who">{item.who}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if broken.length > 0}
			<p class="today-warn">
				<Icon name="warning" size={13} />
				{broken.length === 1
					? `"${broken[0].calendar_name}" isn't updating`
					: `${broken.length} calendars aren't updating`} — see Calendar.
			</p>
		{/if}
	{/if}

	<div class="today-foot">
		<a href={resolve('/home/calendar')} class="today-action">
			<Icon name="calendar" size={12} /> Open the calendar
		</a>
		<!-- The cat and its books keep watch beside the button, as they did on the month card. -->
		<img
			class="today-still"
			src={ART.stillBooksCat}
			alt=""
			aria-hidden="true"
			loading="lazy"
			draggable="false"
		/>
	</div>
</section>

<style>
	.today-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		height: 100%;
		padding: var(--card-padding);
		background: var(--surface);
		background-image: linear-gradient(160deg, var(--accent-tint), transparent 50%);
		border: 1px solid var(--border-gilt);
		border-radius: var(--card-radius);
		box-shadow: var(--shadow-md);
		overflow: hidden;
	}

	.today-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		color: var(--text-faint);
		--icon-accent: var(--accent);
	}

	.today-titles {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.2rem 0.65rem;
		flex: 1;
		min-width: 0;
	}

	.today-titles h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.1rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--accent-bright);
	}

	.today-date {
		font-size: 0.92rem;
		color: var(--text-muted);
	}

	.today-sync {
		font-size: 0.78rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.today-quiet {
		margin: 0;
		font-size: 0.95rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.today-quiet code {
		font-style: normal;
		font-size: 0.85em;
		color: var(--text-muted);
	}

	/* ── All-day chips ─────────────────────────── */

	.allday {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.allday-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		max-width: 100%;
		padding: 0.3rem 0.75rem 0.3rem 0.6rem;
		background: color-mix(in srgb, var(--cal, var(--arcane)) 16%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--cal, var(--arcane)) 45%, transparent);
		border-left: 4px solid var(--cal, var(--arcane));
		border-radius: 999px;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text);
	}

	.allday-chip.birthday {
		background: var(--accent-dim);
		border-color: var(--border-gilt);
		border-left-color: var(--accent);
		color: var(--accent-bright);
		--icon-accent: var(--accent-bright);
	}

	.allday-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.allday-who {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-faint);
	}

	/* ── The day's running order ───────────────── */

	.agenda {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.agenda-row {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-height: 44px;
		padding: 0.4rem 0.6rem 0.4rem 0;
		border-radius: var(--radius-sm);
		transition: opacity var(--transition-fast);
	}

	.agenda-bar {
		align-self: stretch;
		width: 4px;
		flex-shrink: 0;
		border-radius: 2px;
		background: var(--cal, var(--arcane));
	}

	.agenda-row.birthday .agenda-bar {
		background: var(--accent);
	}

	.agenda-text {
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		flex: 1;
		min-width: 0;
	}

	.agenda-title {
		flex: 1;
		min-width: 0;
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.3;
		color: var(--text);
		overflow-wrap: anywhere;
	}

	.agenda-time,
	.agenda-when {
		font-size: 0.84rem;
		font-variant-numeric: lining-nums tabular-nums;
		color: var(--text-muted);
	}

	.agenda-who {
		flex-shrink: 0;
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--text-faint);
	}

	.agenda-row.past {
		opacity: 0.5;
	}

	.agenda-row.now {
		background-image: linear-gradient(90deg, var(--growing-dim), transparent 75%);
	}

	.agenda-row.now .agenda-bar {
		background: var(--growing);
	}

	.agenda-row .badge {
		flex-shrink: 0;
		font-size: 0.62rem;
		padding: 0.15rem 0.5rem;
	}

	.agenda-label {
		margin: 0.35rem 0 -0.35rem;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.agenda.compact .agenda-row {
		min-height: 0;
		padding: 0.2rem 0.4rem 0.2rem 0;
	}

	.agenda.compact .agenda-when {
		flex-shrink: 0;
		min-width: 7.5rem;
	}

	.agenda.compact .agenda-title {
		font-size: 0.92rem;
		font-weight: 500;
	}

	/* ── Getting started, and warnings ─────────── */

	.connect {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.9rem 1rem;
		background: var(--accent-tint);
		border: 1px dashed var(--border-gilt);
		border-radius: var(--radius-sm);
	}

	.connect p {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.5;
		color: var(--text-muted);
	}

	.btn-connect {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		text-decoration: none;
	}

	.today-warn {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		font-size: 0.82rem;
		color: var(--danger);
	}

	.today-foot {
		display: flex;
		align-items: flex-end;
		gap: 0.75rem;
		margin-top: auto;
	}

	.today-action {
		display: inline-flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
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
		--icon-accent: var(--accent);
	}

	.today-action:hover {
		border-color: var(--accent);
		background: var(--accent-tint);
		color: var(--accent-bright);
	}

	.today-still {
		height: 52px;
		width: auto;
		flex-shrink: 0;
		pointer-events: none;
		user-select: none;
		-webkit-user-drag: none;
	}

	@media (max-width: 720px) {
		.today-still {
			display: none;
		}

		.agenda.compact .agenda-row {
			flex-wrap: wrap;
			row-gap: 0;
		}

		.agenda.compact .agenda-when {
			min-width: 0;
		}
	}
</style>
