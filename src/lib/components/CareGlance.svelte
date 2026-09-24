<script>
	import { onMount, onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import { supabase } from '$lib/supabase';
	import { errorMessage } from '$lib/errors.js';
	import { localDateString, formatTime } from '$lib/time.js';
	import { composeDayStatus, dayWindowStartMs, spanLabel } from '$lib/care.js';
	import { ART, avatarFor } from '$lib/art.js';
	import Icon from '$lib/icons/Icon.svelte';
	import PixelArt from './PixelArt.svelte';

	/*
	 * Home's window onto Care: who's on the clock, the kids' day in one line,
	 * and whether this morning's note has been seen. Everything it shows is
	 * a tap away on Care → Today.
	 */

	/** @type {any} */
	let shift = null;
	/** @type {Record<string, string>} */
	let namesById = {};
	/** @type {any[]} */
	let kids = [];
	/** @type {any[]} */
	let moments = [];
	/** @type {any[]} */
	let openNaps = [];
	/** @type {any} */
	let morningNote = null;
	/** @type {any} */
	let seenReact = null;
	let loaded = false;

	let now = Date.now();
	/** @type {ReturnType<typeof setInterval> | null} */
	let nowInterval = null;
	/** @type {ReturnType<typeof setInterval> | null} */
	let pollInterval = null;
	/** @type {ReturnType<typeof supabase.channel> | null} */
	let channel = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let resyncTimer = null;

	onMount(() => {
		init();
	});

	onDestroy(() => {
		if (nowInterval) clearInterval(nowInterval);
		if (pollInterval) clearInterval(pollInterval);
		if (resyncTimer) clearTimeout(resyncTimer);
		if (channel) supabase.removeChannel(channel);
	});

	async function init() {
		try {
			const [peopleRes, kidsRes] = await Promise.all([
				supabase.from('profiles').select('id, full_name'),
				supabase.from('family_members').select('*').eq('kind', 'child')
			]);
			namesById = Object.fromEntries((peopleRes.data || []).map((p) => [p.id, p.full_name || '']));
			kids = kidsRes.data || [];

			await refresh();

			if (!channel) {
				channel = supabase
					.channel('care-glance')
					.on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, () =>
						scheduleResync()
					)
					.on('postgres_changes', { event: '*', schema: 'public', table: 'care_moments' }, () =>
						scheduleResync()
					)
					.on('postgres_changes', { event: '*', schema: 'public', table: 'chronicle_reacts' }, () =>
						scheduleResync()
					)
					.subscribe();
			}
			if (!nowInterval) {
				nowInterval = setInterval(() => (now = Date.now()), 30000);
			}
			if (!pollInterval) {
				// Realtime isn't guaranteed on every table; a slow poll keeps
				// the glance honest when no event arrives.
				pollInterval = setInterval(() => {
					if (typeof document === 'undefined' || document.visibilityState === 'hidden') return;
					scheduleResync();
				}, 60000);
			}
		} catch (err) {
			console.warn('Care glance failed to load:', errorMessage(err));
		} finally {
			loaded = true;
		}
	}

	function scheduleResync() {
		if (resyncTimer) clearTimeout(resyncTimer);
		resyncTimer = setTimeout(() => {
			resyncTimer = null;
			refresh().catch((err) => console.warn('Care glance refresh failed:', errorMessage(err)));
		}, 300);
	}

	async function refresh() {
		const { data: open, error: shiftError } = await supabase
			.from('time_entries')
			.select('*')
			.is('clock_out', null)
			.order('clock_in', { ascending: false })
			.limit(1)
			.maybeSingle();

		if (shiftError) throw shiftError;
		shift = open;

		const since = new Date(dayWindowStartMs(Date.now(), shift)).toISOString();
		const [momentsRes, napsRes, noteRes] = await Promise.all([
			supabase
				.from('care_moments')
				.select('*')
				.gte('started_at', since)
				.order('started_at', { ascending: false }),
			supabase.from('care_moments').select('*').eq('kind', 'nap').is('ended_at', null),
			supabase
				.from('chronicle_entries')
				.select('id, author_id')
				.eq('entry_date', localDateString())
				.contains('tags', ['morning'])
				.maybeSingle()
		]);

		if (momentsRes.error) throw momentsRes.error;
		if (napsRes.error) throw napsRes.error;
		moments = momentsRes.data || [];
		openNaps = napsRes.data || [];
		morningNote = noteRes.data || null;

		if (morningNote) {
			const { data: reacts } = await supabase
				.from('chronicle_reacts')
				.select('*')
				.eq('entry_id', morningNote.id)
				.eq('kind', 'seen');
			seenReact = (reacts || [])[0] || null;
		} else {
			seenReact = null;
		}
	}

	$: kidsById = new Map(kids.map((k) => [k.id, k]));
	$: statusLine = composeDayStatus(moments, openNaps, kidsById);
	$: elapsed = shift ? spanLabel(Math.max(0, now - new Date(shift.clock_in).getTime())) : '';
</script>

<svelte:window on:focus={() => scheduleResync()} />

<section class="glance-card">
	<div class="glance-head">
		<PixelArt src={ART.navCare} size={24} />
		<h2>Right now</h2>
	</div>

	{#if !loaded}
		<div class="skeleton skeleton-line" style="width: 60%"></div>
		<div class="skeleton skeleton-line medium"></div>
	{:else}
		<div class="glance-row" class:on={shift}>
			{#if shift}
				<img
					class="glance-face"
					src={avatarFor(shift.nanny_id)}
					alt=""
					width="28"
					height="28"
					draggable="false"
				/>
				<span>
					<b>{namesById[shift.nanny_id]?.split(' ')[0] || 'The nanny'}</b> on the clock since
					{formatTime(shift.clock_in)}
				</span>
				<span class="badge badge-live"><span class="live-dot"></span> {elapsed}</span>
			{:else}
				<span class="glance-glyph" aria-hidden="true"><Icon name="candle" size={18} /></span>
				<span>No one on the clock</span>
			{/if}
		</div>

		{#if kids.length === 0}
			<p class="status-line quiet">
				Add the kids in <a href={resolve('/settings/household')}>Settings → Household</a> and their day
				shows up here.
			</p>
		{:else if statusLine}
			<p class="status-line">{statusLine}</p>
		{:else}
			<p class="status-line quiet">Quiet so far — the day is young.</p>
		{/if}

		<div class="glance-row note">
			<Icon name="scroll" size={14} />
			{#if !morningNote}
				<span>No morning note today</span>
			{:else if seenReact}
				<span>Morning note seen {formatTime(seenReact.created_at)}</span>
			{:else}
				<span>Morning note awaiting eyes</span>
			{/if}
		</div>
	{/if}

	<a href={resolve('/care')} class="glance-action">
		<Icon name="heart" size={12} /> Open Care
	</a>
</section>

<style>
	.glance-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		height: 100%;
		padding: var(--card-padding);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		box-shadow: var(--shadow-md);
	}

	.glance-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-faint);
		--icon-accent: var(--accent);
	}

	.glance-head h2 {
		flex: 1;
		margin: 0;
		font-family: var(--font-display);
		font-size: 0.92rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--text);
	}

	/* Pinned to the foot like the Hours & Pay card's button beside it, in
	   the quieter surface style so the page keeps one gilt call to action. */
	.glance-action {
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
		--icon-accent: var(--accent);
	}

	.glance-action:hover {
		border-color: var(--accent);
		background: var(--accent-tint);
		color: var(--accent-bright);
	}

	.glance-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.55rem;
		padding: 0.6rem 0.75rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
		font-size: 0.9rem;
		color: var(--text-muted);
		--icon-accent: var(--accent);
	}

	.glance-row.on {
		background-image: linear-gradient(90deg, var(--growing-dim), transparent 70%);
		border-color: rgba(111, 191, 115, 0.4);
	}

	.glance-row b {
		font-family: var(--font-display);
		font-weight: 600;
		color: var(--text);
	}

	.glance-row.note {
		padding: 0;
		background: none;
		border: none;
		font-size: 0.84rem;
		color: var(--text-faint);
	}

	.glance-face {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 1px solid var(--border-gilt);
		background: var(--surface-2);
		user-select: none;
		-webkit-user-drag: none;
	}

	.glance-glyph {
		display: grid;
		place-items: center;
		color: var(--text-faint);
	}

	/* A sentence, so the body face — Cinzel has no lowercase and turns a
	   whole status line into shouting capitals. */
	.status-line {
		margin: 0;
		font-family: var(--font-body);
		font-size: 1.05rem;
		font-weight: 500;
		line-height: 1.5;
		color: var(--text);
	}

	.status-line.quiet {
		font-size: 0.95rem;
		font-style: italic;
		color: var(--text-faint);
	}
</style>
