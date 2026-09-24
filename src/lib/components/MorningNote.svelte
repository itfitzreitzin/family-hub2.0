<script>
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { toast } from '$lib/stores/toast.js';
	import { errorMessage } from '$lib/errors.js';
	import {
		localDateString,
		formatTime,
		formatDateWeekday,
		parseLocalDate,
		normalizeDateValue
	} from '$lib/time.js';
	import { defaultMorningNoteDate } from '$lib/care.js';
	import Icon from '$lib/icons/Icon.svelte';

	/*
	 * The parents' note for the morning, pinned at the top of Care → Today.
	 * Parents write it (the night before, after five); the nanny stamps it
	 * Seen, and the parents see when.
	 */

	/** @type {any} */
	export let user = null;
	/** @type {any} */
	export let profile = null;

	/** @type {any} */
	let morningNote = null;
	/** @type {any} */
	let seenReact = null;
	/** Tomorrow's note, once it's evening and that's the one being written. */
	/** @type {any} */
	let nextNote = null;
	/** @type {string[]} */
	let kidIds = [];
	/** @type {Record<string, string>} */
	let namesById = {};
	let markingSeen = false;

	let now = Date.now();
	/** @type {ReturnType<typeof setInterval> | null} */
	let nowInterval = null;
	/** @type {ReturnType<typeof setInterval> | null} */
	let pollInterval = null;
	/** @type {ReturnType<typeof supabase.channel> | null} */
	let channel = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let resyncTimer = null;

	let showNoteModal = false;
	let noteSaving = false;
	/** `id` set = amending that note; null = writing a new one. */
	/** @type {{ id: any, date: string, body: string }} */
	let noteForm = { id: null, date: localDateString(), body: '' };

	$: canManage = profile?.role === 'family' || profile?.role === 'admin';

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
				supabase.from('family_members').select('id').eq('kind', 'child')
			]);
			namesById = Object.fromEntries((peopleRes.data || []).map((p) => [p.id, p.full_name || '']));
			kidIds = (kidsRes.data || []).map((k) => k.id);

			await loadMorningNote();

			if (!channel) {
				channel = supabase
					.channel('morning-note')
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
				// The evening switch to tomorrow's note is hour-grained.
				nowInterval = setInterval(() => (now = Date.now()), 60000);
			}
			if (!pollInterval) {
				// Realtime isn't guaranteed on every table; a slow poll keeps the
				// Seen receipt from going stale when no event ever arrives.
				pollInterval = setInterval(() => {
					if (typeof document === 'undefined' || document.visibilityState === 'hidden') return;
					scheduleResync();
				}, 60000);
			}
		} catch (err) {
			console.warn('Morning note failed to load:', errorMessage(err));
		}
	}

	function scheduleResync() {
		if (resyncTimer) clearTimeout(resyncTimer);
		resyncTimer = setTimeout(() => {
			resyncTimer = null;
			loadMorningNote().catch((err) => {
				console.warn('Morning note refresh failed:', errorMessage(err));
			});
		}, 300);
	}

	async function loadMorningNote() {
		const today = localDateString();
		const target = defaultMorningNoteDate(Date.now());
		const { data, error } = await supabase
			.from('chronicle_entries')
			.select('*')
			.in('entry_date', target === today ? [today] : [today, target])
			.contains('tags', ['morning']);

		if (error) throw error;
		const notes = data || [];
		morningNote = notes.find((n) => normalizeDateValue(n.entry_date) === today) || null;
		nextNote =
			target === today
				? null
				: notes.find((n) => normalizeDateValue(n.entry_date) === target) || null;

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

	// The receipt the parents can see: a react row owned by the reader, so
	// the nanny can stamp it without edit rights to the note itself.
	async function markNoteSeen() {
		if (!morningNote || markingSeen) return;
		markingSeen = true;

		try {
			const { error } = await supabase
				.from('chronicle_reacts')
				.upsert(
					{ entry_id: morningNote.id, user_id: user.id, kind: 'seen' },
					{ onConflict: 'entry_id,user_id,kind', ignoreDuplicates: true }
				);

			if (error) throw error;
			await loadMorningNote();
		} catch (err) {
			toast.error('Error marking seen: ' + errorMessage(err));
		} finally {
			markingSeen = false;
		}
	}

	// Before five the button tends this morning's note; after five it writes
	// (or amends) tomorrow's — the habit is writing it the night before, and
	// today's note has already been seen.
	$: noteTarget = defaultMorningNoteDate(now);
	$: eveningNote = noteTarget !== localDateString(new Date(now));

	function openNoteModal() {
		const existing = eveningNote ? nextNote : morningNote;
		noteForm = existing
			? { id: existing.id, date: normalizeDateValue(existing.entry_date), body: existing.body }
			: { id: null, date: noteTarget, body: '' };
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
			if (noteForm.id) {
				const { error } = await supabase
					.from('chronicle_entries')
					.update({ body, entry_date: noteForm.date })
					.eq('id', noteForm.id);

				if (error) throw error;
				toast.success('Morning note amended');
			} else {
				const { error } = await supabase.from('chronicle_entries').insert({
					author_id: user.id,
					entry_date: noteForm.date,
					body,
					tags: ['morning'],
					kid_ids: kidIds
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
				// Unique index one_morning_note_per_day. Point the form at that
				// note (keeping what was typed) so a second Pin amends it.
				const { data: clash } = await supabase
					.from('chronicle_entries')
					.select('id')
					.eq('entry_date', noteForm.date)
					.contains('tags', ['morning'])
					.maybeSingle();
				if (clash) {
					noteForm = { ...noteForm, id: clash.id };
					toast.info('That morning already has a note — pin again to replace it with this.');
				} else {
					toast.error('That morning already has a note.');
				}
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

<!-- Coming back to the tab is the other moment staleness shows. -->
<svelte:window on:keydown={handleKeydown} on:focus={() => scheduleResync()} />

<!-- The nanny only sees a note once there is one; the parents always see
     the slot, since it's where they write it. -->
{#if canManage || morningNote}
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
				{:else if !canManage}
					<button
						class="btn-small growing mn-action"
						on:click={markNoteSeen}
						disabled={markingSeen}
					>
						<Icon name="check" size={13} />
						{markingSeen ? 'Marking…' : 'Seen ✓'}
					</button>
				{:else}
					<span class="badge">Awaiting eyes</span>
				{/if}
			{/if}
			{#if canManage}
				<button class="btn-small mn-action" on:click={openNoteModal}>
					<Icon name="quill" size={13} />
					{#if eveningNote}
						{nextNote ? "Amend tomorrow's" : "Write tomorrow's"}
					{:else}
						{morningNote ? 'Amend' : 'Write'}
					{/if}
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
		{#if canManage && eveningNote}
			<p class="mn-next">
				<span class="mn-label">Tomorrow</span>
				{nextNote ? nextNote.body : 'Not written yet.'}
			</p>
		{/if}
	</div>
{/if}

<!-- ── Write / amend the morning note ─────────────────── -->
{#if showNoteModal}
	<div class="modal-overlay" on:click={() => (showNoteModal = false)} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>The morning note</h2>
			<p class="modal-lede">
				Pinned at the top of Care → Today until it's been seen. One note per morning.
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
						placeholder="e.g. Indigo was up at 5 — expect an early nap. The library book is due, it's in the blue bag. Leftover soup for lunch."
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
	.morning-block {
		padding: 0.85rem 1rem;
		margin-bottom: var(--section-gap);
		background: var(--accent-tint);
		border: 1px solid var(--border-gilt);
		border-radius: var(--card-radius);
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

	.mn-action {
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

	.mn-next {
		margin: 0.6rem 0 0;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-soft);
		font-size: 0.88rem;
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}

	.mn-next .mn-label {
		margin-right: 0.4rem;
	}

	.mn-empty {
		margin: 0.45rem 0 0;
		font-size: 0.88rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.btn-small.growing {
		color: var(--growing);
		border-color: rgba(111, 191, 115, 0.4);
		--icon-accent: var(--growing);
	}

	.btn-small.growing:hover:not(:disabled) {
		background: var(--growing-dim);
		border-color: var(--growing);
		color: var(--growing);
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
