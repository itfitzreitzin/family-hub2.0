<script>
	import { onMount, onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import { localDateString } from '$lib/time.js';
	import { boardFor, daysBetween } from '$lib/chores.js';
	import { choreBoard } from '$lib/stores/choreBoard.js';
	import { ART } from '$lib/art.js';
	import Icon from '$lib/icons/Icon.svelte';
	import PixelArt from './PixelArt.svelte';
	import ChoreRow from './ChoreRow.svelte';

	/*
	 * Home's chore card: a column for each parent, then anyone's, then the
	 * nanny's when they've been asked for something — what's due now and
	 * tomorrow, ticked off right here. The whole board is a tap away on Home
	 * → Chores. Stays away until supabase/chores.sql has run.
	 */

	/** Whether there's a card to show; the Home grid hides the slot when not. */
	export let shown = false;

	const board = choreBoard('home-chores');
	let now = Date.now();
	/** @type {ReturnType<typeof setInterval> | null} */
	let nowInterval = null;

	onMount(() => {
		board.start();
		nowInterval = setInterval(() => (now = Date.now()), 60000);
	});

	onDestroy(() => {
		board.stop();
		if (nowInterval) clearInterval(nowInterval);
	});

	function handleVisibilityChange() {
		if (document.visibilityState === 'visible') board.refresh();
	}

	$: today = localDateString(new Date(now));
	$: shown = $board.ready && !$board.missing && !$board.error;
	// Now and tomorrow; the rest of the week is on the board.
	$: soon = boardFor($board.chores, $board.completions, today).filter(
		(i) => !i.due || daysBetween(today, i.due) <= 1
	);
	$: columns = [
		...$board.people
			.filter((p) => p.role !== 'nanny')
			.map((p) => ({ key: p.id, name: p.name, color: p.color, always: true })),
		{ key: 'anyone', name: 'Anyone', color: null, always: false },
		...$board.people
			.filter((p) => p.role === 'nanny')
			.map((p) => ({ key: p.id, name: p.name, color: p.color, always: false }))
	]
		.map((col) => ({
			...col,
			items: soon.filter((i) =>
				col.key === 'anyone' ? !i.chore.assigned_to : i.chore.assigned_to === col.key
			)
		}))
		.filter((col) => col.always || col.items.length > 0);
	$: open = soon.filter((i) => i.state !== 'done').length;
</script>

<svelte:document on:visibilitychange={handleVisibilityChange} />

{#if shown}
	<section class="chores-card" aria-labelledby="home-chores-title">
		<div class="chores-head">
			<PixelArt src={ART.iconRituals} size={24} />
			<h2 id="home-chores-title">Chores</h2>
			{#if soon.length > 0}
				<span class="chores-count" class:clear={open === 0}>{open === 0 ? 'all done' : open}</span>
			{/if}
		</div>

		{#if $board.chores.length === 0}
			<p class="chores-empty">
				Nothing on the board yet — trash day, the plants, a favor for the nanny.
			</p>
		{:else}
			<div class="chores-cols">
				{#each columns as col (col.key)}
					<div class="chores-col">
						<h3 class="col-name" style:--who={col.color}>
							{col.name}
							{#if col.items.length > 0}
								<span class="col-count"
									>{col.items.filter((i) => i.state !== 'done').length || '✓'}</span
								>
							{/if}
						</h3>
						{#if col.items.length === 0}
							<p class="col-empty">Nothing due.</p>
						{:else}
							<ul class="chore-list">
								{#each col.items as item (item.chore.id)}
									<ChoreRow
										{item}
										{today}
										people={$board.people}
										showWho={false}
										compact
										ontoggle={board.toggle}
									/>
								{/each}
							</ul>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<a href={resolve('/home/chores')} class="chores-action">
			<Icon name="scroll" size={12} />
			{$board.chores.length === 0 ? 'Set up chores' : 'All chores'}
		</a>
	</section>
{/if}

<style>
	.chores-card {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		height: 100%;
		padding: var(--card-padding);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		box-shadow: var(--shadow-md);
	}

	.chores-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-faint);
		--icon-accent: var(--accent);
	}

	.chores-head h2 {
		flex: 1;
		margin: 0;
		font-family: var(--font-display);
		font-size: 0.92rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--text);
	}

	.chores-count {
		min-width: 1.6rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--accent-dim);
		color: var(--accent-bright);
		font-size: 0.8rem;
		font-weight: 700;
		text-align: center;
	}

	.chores-count.clear {
		background: var(--growing-dim);
		color: var(--growing);
	}

	.chores-empty {
		margin: 0;
		font-size: 0.92rem;
		font-style: italic;
		color: var(--text-faint);
	}

	/* A column a person — the kitchen screen's chore chart. */
	.chores-cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
		gap: 0.6rem 1.25rem;
	}

	.chores-col {
		min-width: 0;
	}

	.col-name {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0 0 0.15rem;
		padding-bottom: 0.4rem;
		border-bottom: 2px solid var(--who, var(--border-gilt));
		font-family: var(--font-body);
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.col-count {
		margin-left: auto;
		color: var(--text-faint);
		font-variant-numeric: lining-nums tabular-nums;
		letter-spacing: 0;
	}

	.col-empty {
		margin: 0.5rem 0;
		font-size: 0.88rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.chore-list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* Pinned to the foot, in the quieter surface style beside the page's gilt
	   calls to action. */
	.chores-action {
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

	.chores-action:hover {
		border-color: var(--accent);
		background: var(--accent-tint);
		color: var(--accent-bright);
	}
</style>
