<script>
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { toast } from '$lib/stores/toast.js';
	import { errorMessage } from '$lib/errors.js';
	import { localDateString } from '$lib/time.js';
	import Icon from '$lib/icons/Icon.svelte';

	/*
	 * Today's wrap-up, once the shift that wrote it has closed: the evening
	 * card on Care → Today. The parents ♥ it — one tap, no comment threads.
	 */

	/** @type {any} */
	export let user = null;
	/** @type {any} */
	export let profile = null;
	/** The running shift, if any. The wrap-up waits for it to close. */
	/** @type {any} */
	export let activeShift = null;

	/** @type {any} */
	let wrapUp = null;
	/** @type {any[]} */
	let heartReacts = [];
	let hearting = false;
	/** @type {Record<string, string>} */
	let namesById = {};

	/** @type {ReturnType<typeof setInterval> | null} */
	let pollInterval = null;
	/** @type {ReturnType<typeof supabase.channel> | null} */
	let channel = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let resyncTimer = null;
	/** @type {string | null} */
	let seenShiftId = null;

	$: canHeart = profile?.role === 'family' || profile?.role === 'admin';
	$: myHeart = heartReacts.find((r) => r.user_id === user?.id) || null;

	onMount(() => {
		init();
	});

	onDestroy(() => {
		if (pollInterval) clearInterval(pollInterval);
		if (resyncTimer) clearTimeout(resyncTimer);
		if (channel) supabase.removeChannel(channel);
	});

	async function init() {
		try {
			const { data: people } = await supabase.from('profiles').select('id, full_name');
			namesById = Object.fromEntries((people || []).map((p) => [p.id, p.full_name || '']));

			await loadWrapUp();

			if (!channel) {
				channel = supabase
					.channel('wrap-up')
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
			if (!pollInterval) {
				// This card is what greets the parents in the evening; a slow poll
				// keeps the wrap-up and hearts current when no event arrives.
				pollInterval = setInterval(() => {
					if (typeof document === 'undefined' || document.visibilityState === 'hidden') return;
					scheduleResync();
				}, 60000);
			}
		} catch (err) {
			console.warn('Wrap-up failed to load:', errorMessage(err));
		}
	}

	// A shift closing is exactly when the wrap-up appears.
	$: if ((activeShift?.id || null) !== seenShiftId) {
		seenShiftId = activeShift?.id || null;
		scheduleResync();
	}

	function scheduleResync() {
		if (resyncTimer) clearTimeout(resyncTimer);
		resyncTimer = setTimeout(() => {
			resyncTimer = null;
			loadWrapUp().catch((err) => {
				console.warn('Wrap-up refresh failed:', errorMessage(err));
			});
		}, 300);
	}

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
</script>

<svelte:window on:focus={() => scheduleResync()} />

{#if wrapUp && !activeShift}
	<section class="card arcana wrapup-card">
		<div class="wu-head">
			<Icon name="grimoire" size={14} />
			<span class="wu-label">The day's wrap-up</span>
			{#if namesById[wrapUp.author_id]}
				<span class="wu-author">by {namesById[wrapUp.author_id].split(' ')[0]}</span>
			{/if}
		</div>
		<p class="wu-body">{wrapUp.body}</p>
		<div class="wu-foot">
			{#if canHeart}
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
			{:else if heartReacts.length > 0}
				<span class="heart-btn hearted">
					<Icon name="heart" size={15} />
					{heartReacts.length}<span class="visually-hidden"> hearts</span>
				</span>
			{/if}
			<span class="wu-hint">
				{heartReacts.length > 0
					? 'The day has been loved'
					: canHeart
						? 'One tap says it all — no comment threads'
						: 'Written into the Journal'}
			</span>
		</div>
	</section>
{/if}

<style>
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

	button.heart-btn:hover:not(:disabled) {
		color: var(--danger);
		border-color: var(--danger);
		background: var(--danger-dim);
	}

	.heart-btn.hearted {
		color: var(--danger);
		border-color: rgba(224, 102, 78, 0.45);
		background: var(--danger-dim);
	}

	span.heart-btn {
		cursor: default;
	}

	.wu-hint {
		font-size: 0.78rem;
		font-style: italic;
		color: var(--text-faint);
	}
</style>
