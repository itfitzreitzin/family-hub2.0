<script>
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { errorMessage } from '$lib/errors.js';
	import { formatTime, localDateString } from '$lib/time.js';
	import { avatarFor } from '$lib/art.js';
	import { memberPortrait } from '$lib/family.js';
	import Icon from '$lib/icons/Icon.svelte';
	import {
		dayBounds,
		splitBusy,
		busyStatus,
		statusLabel,
		clockRange,
		firstName,
		syncStale,
		agoLabel
	} from '$lib/familyCalendar.js';

	/*
	 * For the nanny, on Care → Today: whether each parent is busy right now,
	 * and when, from the calendars they've chosen to share. A calendar shared
	 * as "busy times" gives only the times; one shared in full gives the
	 * events too. Until a parent shares something, this card isn't there.
	 */

	/** How often it re-reads (and re-syncs a stale shared calendar). */
	const REFRESH_MS = 5 * 60 * 1000;
	/** The strip always covers at least the working day. */
	const STRIP_FROM = 7;
	const STRIP_TO = 19;

	/** @type {{ calendar_id: number, owner_id: string, is_family: boolean, nanny_sees: string, last_synced: string | null }[]} */
	let shared = [];
	/** @type {import('$lib/familyCalendar.js').BusyRow[]} */
	let rows = [];
	/** @type {Record<string, string>} */
	let namesById = {};
	/** Each parent's portrait from the household roster, by profile id. */
	/** @type {Record<string, string>} */
	let portraitsById = {};
	let loaded = false;
	let now = Date.now();
	let loadToken = 0;

	/** @type {ReturnType<typeof setInterval> | null} */
	let tickInterval = null;
	/** @type {ReturnType<typeof setInterval> | null} */
	let refreshInterval = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let refreshTimer = null;

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
		const { start, end } = dayBounds(new Date());
		try {
			const [sharedRes, busyRes, peopleRes, membersRes] = await Promise.all([
				supabase.rpc('household_shared_calendars'),
				supabase.rpc('household_busy', {
					range_start: start.toISOString(),
					range_end: end.toISOString()
				}),
				supabase.from('profiles').select('id, full_name'),
				supabase
					.from('family_members')
					.select('id, name, kind, avatar_url, profile_id')
					.not('profile_id', 'is', null)
			]);
			if (token !== loadToken) return;
			// Before supabase/family_calendar.sql has run there's nothing to
			// show, and nothing the nanny could do about it — stay away quietly.
			if (sharedRes.error) throw sharedRes.error;
			if (busyRes.error) throw busyRes.error;
			shared = sharedRes.data || [];
			rows = busyRes.data || [];
			namesById = Object.fromEntries(
				(peopleRes.data || []).map((/** @type {any} */ p) => [p.id, p.full_name || ''])
			);
			portraitsById = Object.fromEntries(
				(membersRes.data || []).map((/** @type {any} */ m) => [
					m.profile_id,
					memberPortrait(m) || ''
				])
			);
		} catch (err) {
			if (token !== loadToken) return;
			console.warn("Parents' day failed to load:", errorMessage(err));
			shared = [];
			rows = [];
		} finally {
			if (token === loadToken) {
				loaded = true;
				now = Date.now();
			}
		}
	}

	/** Ask for a fresh copy of any shared calendar gone stale (best effort). */
	async function freshen() {
		if (shared.length === 0) return;
		const due = shared.map((c) => ({ id: c.calendar_id, last_synced: c.last_synced }));
		if (await syncStale(supabase, due)) await refresh();
	}

	function scheduleRefresh() {
		if (refreshTimer) clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			refreshTimer = null;
			refresh();
		}, 300);
	}

	$: day = dayBounds(new Date(now));
	$: split = splitBusy(rows, day.start, day.end);
	$: owners = [...new Set(shared.filter((c) => !c.is_family).map((c) => c.owner_id))].sort((a, b) =>
		(namesById[a] || '').localeCompare(namesById[b] || '')
	);
	$: familyShared = shared.some((c) => c.is_family);
	$: people = owners.map((id) => {
		const blocks = split.byOwner.get(id) || [];
		return {
			id,
			name: firstName(namesById[id]) || 'A parent',
			blocks,
			entries: split.entriesByOwner.get(id) || [],
			busy: busyStatus(blocks, new Date(now)).busy,
			status: statusLabel(blocks, new Date(now), day.end)
		};
	});
	$: title =
		people.length > 0 ? people.map((p) => p.name).join(' & ') + ' today' : 'The family today';
	$: oldest = shared
		.map((c) => c.last_synced)
		.filter(Boolean)
		.sort()[0];

	// The strip: the working day, stretched to take in anything earlier or later.
	$: stripFrom = Math.min(
		STRIP_FROM,
		...people.flatMap((p) => p.blocks.filter((b) => !b.allDay).map((b) => b.start.getHours()))
	);
	$: stripTo = Math.max(
		STRIP_TO,
		...people.flatMap((p) =>
			p.blocks
				.filter((b) => !b.allDay)
				.map((b) => (b.end >= day.end ? 24 : b.end.getHours() + (b.end.getMinutes() > 0 ? 1 : 0)))
		)
	);
	$: ticks = hourTicks(stripFrom, stripTo);

	/**
	 * @param {Date} d
	 * @returns {number} percent across the strip
	 */
	function at(d) {
		const hours = (d.getTime() - day.start.getTime()) / 3600000;
		return Math.min(100, Math.max(0, ((hours - stripFrom) / (stripTo - stripFrom)) * 100));
	}

	/** @param {number} from @param {number} to */
	function hourTicks(from, to) {
		/** @type {{ h: number, label: string, left: number }[]} */
		const out = [];
		for (let h = Math.ceil(from / 3) * 3; h <= to; h += 3) {
			if (h === from || h === to) continue;
			const label =
				h === 0 || h === 24 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;
			out.push({ h, label, left: ((h - from) / (to - from)) * 100 });
		}
		return out;
	}

	/** @param {import('$lib/familyCalendar.js').DayEntry} entry */
	function entryText(entry) {
		const when = entry.allDay ? 'All day' : clockRange(entry.start, entry.end);
		return entry.title ? `${entry.title} · ${when}` : when;
	}

	/** @param {string | null | undefined} iso */
	function freshLabel(iso) {
		if (!iso) return 'Not synced yet';
		const d = new Date(iso);
		return localDateString(d) === localDateString(new Date(now))
			? `Updated ${formatTime(d)}`
			: `Updated ${agoLabel(iso, now)}`;
	}
</script>

<svelte:window on:focus={scheduleRefresh} />

{#if loaded && shared.length > 0}
	<section class="card arcana parents-day">
		<div class="card-header">
			<h2>{title}</h2>
			<span class="rune-label">{freshLabel(oldest)}</span>
		</div>

		{#if people.length > 0}
			<ul class="parents">
				{#each people as person (person.id)}
					<li class="parent" class:busy={person.busy}>
						<img
							class="parent-face"
							src={portraitsById[person.id] || avatarFor(person.id)}
							alt=""
							width="36"
							height="36"
							draggable="false"
						/>
						<div class="parent-main">
							<div class="parent-line">
								<span class="parent-name">{person.name}</span>
								<span class="parent-status">
									<span class="status-dot" aria-hidden="true"></span>
									{person.status}
								</span>
							</div>

							<div class="strip" aria-hidden="true">
								{#each person.blocks as block, i (i)}
									<span
										class="strip-block"
										class:past={block.end.getTime() <= now}
										style:left="{at(block.start)}%"
										style:width="{Math.max(0.8, at(block.end) - at(block.start))}%"
									></span>
								{/each}
								{#if now >= day.start.getTime() + stripFrom * 3600000 && now <= day.start.getTime() + stripTo * 3600000}
									<span class="strip-now" style:left="{at(new Date(now))}%"></span>
								{/if}
								{#each ticks as tick (tick.h)}
									<span class="strip-tick" style:left="{tick.left}%">{tick.label}</span>
								{/each}
							</div>

							{#if person.entries.length > 0}
								<ul class="blocks">
									{#each person.entries as entry, i (i)}
										<li class:past={!entry.allDay && entry.end.getTime() <= now}>
											{entryText(entry)}
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if familyShared}
			<div class="family">
				<h3 class="family-label"><Icon name="cottage" size={13} /> On the family calendar</h3>
				{#if split.family.length === 0}
					<p class="family-quiet">Nothing today.</p>
				{:else}
					<ul class="family-list">
						{#each split.family as event, i (i)}
							<li class:past={!event.allDay && event.end.getTime() <= now}>
								<span class="family-when">{event.allDay ? 'All day' : formatTime(event.start)}</span
								>
								<span class="family-title">{event.title}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</section>
{/if}

<style>
	.parents {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.parent {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.parent-face {
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		border-radius: 50%;
		border: 1px solid var(--border-gilt);
		background: var(--surface-2);
		user-select: none;
		-webkit-user-drag: none;
	}

	.parent-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.parent-line {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
	}

	.parent-name {
		font-family: var(--font-display);
		font-weight: 600;
		color: var(--text);
	}

	.parent-status {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.98rem;
		font-weight: 600;
		font-variant-numeric: lining-nums;
		color: var(--growing);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
	}

	.parent.busy .parent-status {
		color: var(--arcane);
	}

	/* ── The day strip ─────────────────────────── */

	.strip {
		position: relative;
		height: 14px;
		margin-bottom: 1rem;
		background: var(--growing-dim);
		border: 1px solid var(--border-soft);
		border-radius: 4px;
	}

	.strip-block {
		position: absolute;
		top: 0;
		bottom: 0;
		background: var(--arcane);
		border-radius: 3px;
	}

	.strip-block.past {
		opacity: 0.45;
	}

	.strip-now {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 2px;
		margin-left: -1px;
		background: var(--accent-bright);
		border-radius: 1px;
	}

	.strip-tick {
		position: absolute;
		top: 100%;
		margin-top: 2px;
		transform: translateX(-50%);
		font-size: 0.66rem;
		font-variant-numeric: lining-nums;
		color: var(--text-faint);
		pointer-events: none;
	}

	.blocks {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.9rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.86rem;
		font-variant-numeric: lining-nums tabular-nums;
		color: var(--text-muted);
	}

	.blocks li.past {
		opacity: 0.55;
	}

	/* ── The family calendar, when shared in full ── */

	.family {
		margin-top: 1.1rem;
		padding-top: 0.9rem;
		border-top: 1px solid var(--border-soft);
	}

	.family-label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 0 0.5rem;
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.family-quiet {
		margin: 0;
		font-style: italic;
		color: var(--text-faint);
	}

	.family-list {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.family-list li {
		display: flex;
		gap: 0.75rem;
	}

	.family-list li.past {
		opacity: 0.55;
	}

	.family-when {
		min-width: 4.5rem;
		font-size: 0.86rem;
		font-variant-numeric: lining-nums tabular-nums;
		color: var(--text-muted);
	}

	.family-title {
		font-weight: 600;
		color: var(--text);
	}
</style>
