<script>
	import { onMount, onDestroy } from 'svelte';
	import { localDateString } from '$lib/time.js';
	import { boardFor, whenGroup } from '$lib/chores.js';
	import { choreBoard } from '$lib/stores/choreBoard.js';
	import ChoreRow from './ChoreRow.svelte';

	/*
	 * The nanny's side of the chores, on Care → Today: what the parents have
	 * asked them to do ("switch the laundry over"), ticked off right here. The
	 * database only shows the nanny the chores that are theirs; the card stays
	 * away when there aren't any.
	 */

	const board = choreBoard('care-chores');
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

	$: today = localDateString(new Date(now));
	$: mine = boardFor($board.chores, $board.completions, today).filter(
		(i) => i.chore.assigned_to === $board.userId && whenGroup(i, today) !== 'later'
	);
	$: parents = $board.people.filter((p) => p.role !== 'nanny').map((p) => p.name);
	$: from = parents.length === 2 ? `from ${parents[0]} and ${parents[1]}` : 'from the parents';
</script>

{#if $board.ready && !$board.missing && mine.length > 0}
	<section class="card arcana chore-asks">
		<div class="card-header">
			<h2>Could You…?</h2>
			<span class="rune-label">{from}</span>
		</div>
		<ul class="chore-list">
			{#each mine as item (item.chore.id)}
				<ChoreRow {item} {today} people={$board.people} showWho={false} ontoggle={board.toggle} />
			{/each}
		</ul>
	</section>
{/if}

<style>
	.chore-list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
