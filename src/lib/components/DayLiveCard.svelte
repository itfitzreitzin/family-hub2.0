<script>
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { toast } from '$lib/stores/toast.js';
	import { errorMessage } from '$lib/errors.js';
	import { localDateString, formatTime, formatDateWeekday, parseLocalDate } from '$lib/time.js';
	import {
		momentKind,
		momentSummary,
		momentKidsLabel,
		composeDayStatus,
		defaultMorningNoteDate,
		spanLabel,
		napLengthMs
	} from '$lib/care.js';
	import Icon from '$lib/icons/Icon.svelte';
	import PixelArt from './PixelArt.svelte';
	import { ART } from '$lib/art.js';

	/** @type {any} */
	export let user = null;
	/** @type {any} */
	export let profile = null;
	/** The open time_entries row being watched, if a shift is running. */
	/** @type {any} */
	export let activeShift = null;

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
	/** @type {any} */
	let wrapUp = null;
	/** @type {any[]} */
	let heartReacts = [];
	let hearting = false;
	/** @type {Record<string, string>} */
	let namesById = {};

	let now = Date.now();
	/** @type {ReturnType<typeof setInterval> | null} */
	let nowInterval = null;
	/** @type {ReturnType<typeof supabase.channel> | null} */
	let channel = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let resyncTimer = null;
	/** @type {string | null} */
	let loadedShiftId = null;

	// Morning-note modal
	let showNoteModal = false;
	let noteSaving = false;
	let noteForm = { date: localDateString(), body: '' };

	onMount(() => {
		init();
	});

	onDestroy(() => {
		if (nowInterval) clearInterval(nowInterval);
		if (resyncTimer) clearTimeout(resyncTimer);
		if (channel) supabase.removeChannel(channel);
	});

	async function init() {
		try {
			const { data: people } = await supabase.from('profiles').select('id, full_name');
			namesById = Object.fromEntries((people || []).map((p) => [p.id, p.full_name || '']));

			const { data: kidRows } = await supabase
				.from('family_members')
				.select('*')
				.eq('kind', 'child');
			kids = kidRows || [];

			await Promise.all([loadFeed(), loadMorningNote(), loadWrapUp()]);

			if (!channel) {
				channel = supabase
					.channel('day-live')
					.on('postgres_changes', { event: '*', schema: 'public', table: 'care_moments' }, () =>
						scheduleResync()
					)
					.on(
						'postgres_changes',
						{ event: '*', schema: 'public', table: 'chronicle_entries' },
						() => scheduleResync()
					)
					.on('postgres_changes', { event: '*', schema: 'public', table: 'chronicle_reacts' }, () =>
						scheduleResync()
					)
					.subscribe();
			}
			if (!nowInterval) {
				nowInterval = setInterval(() => (now = Date.now()), 30000);
			}
		} catch (err) {
			const msg = errorMessage(err);
			if (msg.includes('care_moments')) {
				console.warn(
					'Live card disabled: the care_moments table is missing. Run supabase/care_moments.sql in the Supabase SQL editor (see CHRONICLE_CARE_DAY.md).'
				);
			} else {
				console.warn('Live card init failed:', msg);
			}
		}
	}

	// The dashboard's realtime layer can change the active shift under us.
	$: if ((activeShift?.id || null) !== loadedShiftId) {
		loadFeed().catch(() => {});
	}

	function scheduleResync() {
		if (resyncTimer) clearTimeout(resyncTimer);
		resyncTimer = setTimeout(() => {
			resyncTimer = null;
			Promise.all([loadFeed(), loadMorningNote(), loadWrapUp()]).catch((err) => {
				console.warn('Live card resync failed:', errorMessage(err));
			});
		}, 300);
	}

	// Once the shift closes, its wrap-up takes the feed's place for the
	// evening — and the parents ♥ it.
	async function loadWrapUp() {
		const { data, error } = await supabase
			.from('chronicle_entries')
			.select('*')
			.eq('entry_date', localDateString())
			.contains('tags', ['wrapup'])
			.order('created_at', { ascending: false })
			.limit(1);

		if (error) throw error;
		wrapUp = (data || [])[0] || null;

		if (wrapUp) {
			const { data: reacts } = await supabase
				.from('chronicle_reacts')
				.select('*')
				.eq('entry_id', wrapUp.id)
				.eq('kind', 'heart');
			heartReacts = reacts || [];
		} else {
			heartReacts = [];
		}
	}

	async function toggleHeart() {
		if (!wrapUp || hearting || !user) return;
		hearting = true;

		try {
			if (myHeart) {
				const { error } = await supabase
					.from('chronicle_reacts')
					.delete()
					.match({ entry_id: wrapUp.id, user_id: user.id, kind: 'heart' });

				if (error) throw error;
			} else {
				const { error } = await supabase
					.from('chronicle_reacts')
					.upsert(
						{ entry_id: wrapUp.id, user_id: user.id, kind: 'heart' },
						{ onConflict: 'entry_id,user_id,kind', ignoreDuplicates: true }
					);

				if (error) throw error;
			}
			await loadWrapUp();
		} catch (err) {
			toast.error('Error: ' + errorMessage(err));
		} finally {
			hearting = false;
		}
	}

	async function loadFeed() {
		loadedShiftId = activeShift?.id || null;

		if (!loadedShiftId) {
			moments = [];
			openNaps = [];
			return;
		}

		const [momentsRes, napsRes] = await Promise.all([
			supabase
				.from('care_moments')
				.select('*')
				.eq('shift_id', loadedShiftId)
				.order('started_at', { ascending: false }),
			supabase.from('care_moments').select('*').eq('kind', 'nap').is('ended_at', null)
		]);

		if (momentsRes.error) throw momentsRes.error;
		if (napsRes.error) throw napsRes.error;
		moments = momentsRes.data || [];
		openNaps = napsRes.data || [];
	}

	async function loadMorningNote() {
		const { data, error } = await supabase
			.from('chronicle_entries')
			.select('*')
			.eq('entry_date', localDateString())
			.contains('tags', ['morning'])
			.maybeSingle();

		if (error) throw error;
		morningNote = data;

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
	$: feed = moments.slice(0, 6);
	$: canManage = profile?.role === 'family' || profile?.role === 'admin';
	$: myHeart = heartReacts.find((r) => r.user_id === user?.id) || null;

	function openNoteModal() {
		if (morningNote) {
			noteForm = { date: morningNote.entry_date, body: morningNote.body };
		} else {
			// Writing after five in the evening usually means tomorrow's note.
			noteForm = { date: defaultMorningNoteDate(now), body: '' };
		}
		showNoteModal = true;
	}

	async function saveNote() {
		if (noteSaving) return;

		const body = noteForm.body.trim();
		if (!body) {
			toast.error('Write the note first');
			return;
		}
		if (!noteForm.date) {
			toast.error('Pick a morning for it');
			return;
		}

		noteSaving = true;

		try {
			if (morningNote && morningNote.entry_date === noteForm.date) {
				const { error } = await supabase
					.from('chronicle_entries')
					.update({ body })
					.eq('id', morningNote.id);

				if (error) throw error;
				toast.success('Morning note amended');
			} else {
				const { error } = await supabase.from('chronicle_entries').insert({
					author_id: user.id,
					entry_date: noteForm.date,
					body,
					tags: ['morning'],
					kid_ids: kids.map((k) => k.id)
				});

				if (error) throw error;
				toast.success(
					noteForm.date === localDateString()
						? 'Morning note pinned for the shift'
						: `Note written for ${formatDateWeekday(parseLocalDate(noteForm.date))}`
				);
			}

			showNoteModal = false;
			await loadMorningNote();
		} catch (err) {
			if (/** @type {any} */ (err).code === '23505') {
				// Unique index one_morning_note_per_day
				toast.error('That morning already has a note — amend it instead.');
				loadMorningNote().catch(() => {});
			} else {
				toast.error('Error saving note: ' + errorMessage(err));
			}
		} finally {
			noteSaving = false;
		}
	}

	/** @param {KeyboardEvent} event */
	function handleKeydown(event) {
		if (event.key === 'Escape' && showNoteModal) showNoteModal = false;
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<section class="card arcana live-root">
	<div class="card-header">
		<div class="live-title">
			<PixelArt src={ART.navCare} size={24} />
			<h2>The Day{activeShift ? ' — live' : ''}</h2>
			{#if activeShift}
				<span class="live-dot" title="A shift is running"></span>
			{/if}
		</div>
		<a href="/tracker" class="header-link">
			Open the cockpit <Icon name="chevron-right" size={10} />
		</a>
	</div>

	<!-- ── Morning note ─────────────────────────────────── -->
	<div class="morning-block" class:seen={seenReact}>
		<div class="mn-head">
			<Icon name="scroll" size={14} />
			<span class="mn-label">Morning note</span>
			{#if morningNote}
				{#if seenReact}
					<span class="badge badge-live">
						<Icon name="check" size={11} />
						Seen {formatTime(seenReact.created_at)}
					</span>
				{:else}
					<span class="badge">Awaiting eyes</span>
				{/if}
			{/if}
			{#if canManage}
				<button class="btn-small mn-write" on:click={openNoteModal}>
					<Icon name="quill" size={13} />
					{morningNote ? 'Amend' : 'Write'}
				</button>
			{/if}
		</div>
		{#if morningNote}
			<p class="mn-body">{morningNote.body}</p>
			{#if namesById[morningNote.author_id]}
				<span class="mn-author">— {namesById[morningNote.author_id].split(' ')[0]}</span>
			{/if}
		{:else}
			<p class="mn-empty">
				Nothing pinned for this morning — a note here greets the shift and skips the text thread.
			</p>
		{/if}
	</div>

	<!-- ── The live feed ────────────────────────────────── -->
	{#if activeShift}
		{#if statusLine}
			<p class="status-line">{statusLine}</p>
		{:else}
			<p class="status-line quiet">Quiet so far — the day is young.</p>
		{/if}

		{#if feed.length > 0}
			<div class="live-feed">
				{#each feed as m (m.id)}
					{@const mk = momentKind(m.kind)}
					{@const openNap = m.kind === 'nap' && !m.ended_at}
					<div class="lf-row" class:flagged={m.kind === 'headsup'}>
						<span class="lf-time">{formatTime(m.started_at)}</span>
						<span class="lf-icon">
							{#if mk.art}
								<PixelArt src={mk.art} size={14} />
							{:else}
								<Icon name={mk.sprite || 'star'} size={14} />
							{/if}
						</span>
						<span class="lf-text">
							{#if kids.length > 1 && momentKidsLabel(m, kidsById, kids.length)}
								<b>{momentKidsLabel(m, kidsById, kids.length)}</b> ·
							{/if}
							{momentSummary(m)}
							{#if openNap}
								<span class="lf-live">asleep · {spanLabel(napLengthMs(m, now))}</span>
							{/if}
						</span>
					</div>
				{/each}
				{#if moments.length > feed.length}
					<span class="lf-more">+ {moments.length - feed.length} earlier</span>
				{/if}
			</div>
		{/if}
	{:else if wrapUp}
		<div class="wrapup-block">
			<div class="wu-head">
				<Icon name="grimoire" size={14} />
				<span class="wu-label">The day's wrap-up</span>
				{#if namesById[wrapUp.author_id]}
					<span class="wu-author">by {namesById[wrapUp.author_id].split(' ')[0]}</span>
				{/if}
			</div>
			<p class="wu-body">{wrapUp.body}</p>
			<div class="wu-foot">
				<button
					class="heart-btn"
					class:hearted={myHeart}
					on:click={toggleHeart}
					disabled={hearting}
					aria-label={myHeart ? 'Remove your heart' : 'Heart the day'}
				>
					<Icon name="heart" size={15} />
					{heartReacts.length > 0 ? heartReacts.length : ''}
				</button>
				<span class="wu-hint">
					{heartReacts.length > 0
						? 'The day has been loved'
						: 'One tap says it all — no comment threads'}
				</span>
			</div>
		</div>
	{:else}
		<div class="no-shift">
			<PixelArt src={ART.iconOrb} size={36} />
			<p>No shift underway — the day's record begins at clock-in.</p>
		</div>
	{/if}
</section>

<!-- ── Write / amend the morning note ─────────────────── -->
{#if showNoteModal}
	<div class="modal-overlay" on:click={() => (showNoteModal = false)} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>The morning note</h2>
			<p class="modal-lede">
				Pinned at the top of the shift screen until it's been seen. One note per morning.
			</p>

			<form on:submit|preventDefault={saveNote}>
				<div class="form-group">
					<label for="mn-date">For the morning of</label>
					<input id="mn-date" type="date" bind:value={noteForm.date} required />
				</div>

				<div class="form-group">
					<label for="mn-body">The note</label>
					<textarea
						id="mn-body"
						rows="5"
						bind:value={noteForm.body}
						placeholder="e.g. Indigo was up at 5 — expect an early nap. Juniper's library book is due, it's in the blue bag. Leftover soup for lunch."
						required
					></textarea>
					<small>Room to ramble — dictation welcome.</small>
				</div>

				<div class="button-row">
					<button type="submit" class="btn btn-primary" disabled={noteSaving}>
						<Icon name="quill" size={16} />
						{noteSaving ? 'Pinning…' : 'Pin it'}
					</button>
					<button type="button" class="btn btn-secondary" on:click={() => (showNoteModal = false)}>
						Cancel
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	.live-root {
		height: 100%;
		margin-bottom: 0;
	}

	.live-title {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	.live-title h2 {
		margin: 0;
	}

	.header-link {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.header-link:hover {
		color: var(--accent-bright);
	}

	/* ── Morning note ─────────────────────────────────────── */
	.morning-block {
		padding: 0.85rem 1rem;
		margin-bottom: 1rem;
		background: var(--accent-tint);
		border: 1px solid var(--border-gilt);
		border-radius: var(--radius-sm);
	}

	.morning-block.seen {
		background: var(--surface-2);
		border-color: var(--border-soft);
	}

	.mn-head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		color: var(--accent);
		--icon-accent: var(--accent);
	}

	.mn-label {
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.mn-write {
		margin-left: auto;
	}

	.mn-body {
		margin: 0.5rem 0 0;
		font-size: 0.95rem;
		line-height: 1.5;
		color: var(--text);
		overflow-wrap: anywhere;
	}

	.mn-author {
		display: block;
		margin-top: 0.25rem;
		font-size: 0.78rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.mn-empty {
		margin: 0.45rem 0 0;
		font-size: 0.88rem;
		font-style: italic;
		color: var(--text-faint);
	}

	/* ── Status + feed ────────────────────────────────────── */
	.status-line {
		margin: 0 0 0.75rem;
		font-family: var(--font-display);
		font-size: 1rem;
		line-height: 1.45;
		color: var(--text);
	}

	.status-line.quiet {
		color: var(--text-faint);
		font-style: italic;
	}

	.live-feed {
		display: flex;
		flex-direction: column;
	}

	.lf-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.4rem 0.2rem;
		border-bottom: 1px solid var(--border-soft);
		font-size: 0.88rem;
	}

	.lf-row:last-of-type {
		border-bottom: none;
	}

	.lf-row.flagged {
		background: linear-gradient(90deg, var(--danger-dim), transparent 70%);
		border-radius: var(--radius-sm);
	}

	.lf-time {
		flex-shrink: 0;
		width: 62px;
		font-variant-numeric: tabular-nums;
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--text-faint);
		text-align: right;
		padding-top: 0.1rem;
	}

	.lf-icon {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		color: var(--text-muted);
		--icon-accent: var(--accent);
	}

	.lf-text {
		flex: 1;
		min-width: 0;
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}

	.lf-text b {
		color: var(--accent-bright);
		font-family: var(--font-display);
		font-weight: 600;
	}

	.lf-live {
		margin-left: 0.35rem;
		color: var(--growing);
		font-variant-numeric: tabular-nums;
	}

	.lf-more {
		padding-top: 0.45rem;
		font-size: 0.75rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	/* ── The evening wrap-up ──────────────────────────────── */
	.wrapup-block {
		padding: 0.85rem 1rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
	}

	.wu-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--accent);
		--icon-accent: var(--accent);
	}

	.wu-label {
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.wu-author {
		margin-left: auto;
		font-size: 0.78rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.wu-body {
		margin: 0.5rem 0 0.65rem;
		font-size: 0.95rem;
		line-height: 1.55;
		color: var(--text);
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.wu-foot {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.heart-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 36px;
		padding: 0.3rem 0.75rem;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--text-faint);
		font-size: 0.85rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition: all var(--transition-fast);
		--icon-accent: currentColor;
	}

	.heart-btn:hover:not(:disabled) {
		color: var(--danger);
		border-color: var(--danger);
		background: var(--danger-dim);
	}

	.heart-btn.hearted {
		color: var(--danger);
		border-color: rgba(224, 102, 78, 0.45);
		background: var(--danger-dim);
	}

	.wu-hint {
		font-size: 0.78rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.no-shift {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1.25rem 1rem;
		text-align: center;
	}

	.no-shift p {
		margin: 0;
		font-size: 0.9rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.modal-lede {
		color: var(--text-muted);
		margin-bottom: 1rem;
	}

	textarea {
		resize: vertical;
		min-height: 110px;
	}
</style>
