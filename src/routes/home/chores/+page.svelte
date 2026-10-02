<script>
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { supabase } from '$lib/supabase';
	import { toast } from '$lib/stores/toast.js';
	import { errorMessage } from '$lib/errors.js';
	import { localDateString, getWeekBounds } from '$lib/time.js';
	import {
		STARTERS,
		boardFor,
		whenGroup,
		weekTally,
		doneWhen,
		cadenceLabel,
		cleanChoreTitle,
		nextWeekday
	} from '$lib/chores.js';
	import { choreBoard } from '$lib/stores/choreBoard.js';
	import Icon from '$lib/icons/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import ChoreRow from '$lib/components/ChoreRow.svelte';
	import ChoreSheet from '$lib/components/ChoreSheet.svelte';

	/*
	 * Home → Chores: what the house needs doing, and who's on it. One-offs go
	 * in at the top ("switch the laundry over", for Daniela); the ones that
	 * come round — trash every Friday, the plants every few days — through
	 * the + Chore sheet. Tap a chore to tick it off; it stays put, inked
	 * through, saying who did it, and tapping again takes it back. Whoever
	 * does it gets the credit, and the week's tally says who did what.
	 */

	const board = choreBoard('chores-page');

	/** @type {any} */
	let user = null;
	let checking = true;
	let leaving = false;
	let now = Date.now();
	/** 'all', 'anyone', or a person's id. */
	let filter = 'all';
	/** The sheet, while it's open. */
	/** @type {{ chore: any, draft: any } | null} */
	let sheet = null;
	let quick = '';
	let quickWho = '';
	let adding = false;

	/** @type {ReturnType<typeof setInterval> | null} */
	let nowInterval = null;

	onMount(async () => {
		const {
			data: { user: currentUser }
		} = await supabase.auth.getUser();
		if (!currentUser) {
			goto(resolve('/'));
			return;
		}
		user = currentUser;
		checking = false;
		await board.start();
		nowInterval = setInterval(() => (now = Date.now()), 60000);
	});

	onDestroy(() => {
		board.stop();
		if (nowInterval) clearInterval(nowInterval);
	});

	// The nanny's chores are on Care → Today; the board is the parents'.
	$: if ($board.ready && $board.role === 'nanny' && !leaving) {
		leaving = true;
		goto(resolve('/care'), { replaceState: true });
	}

	$: today = localDateString(new Date(now));
	$: people = $board.people;
	$: items = boardFor($board.chores, $board.completions, today);
	$: shown = items.filter((i) =>
		filter === 'all'
			? true
			: filter === 'anyone'
				? !i.chore.assigned_to
				: i.chore.assigned_to === filter
	);
	$: groups = [
		{ key: 'now', title: 'Now', items: shown.filter((i) => whenGroup(i, today) === 'now') },
		{ key: 'week', title: 'This Week', items: shown.filter((i) => whenGroup(i, today) === 'week') },
		{ key: 'later', title: 'Later', items: shown.filter((i) => whenGroup(i, today) === 'later') }
	];
	$: tally = weekTally($board.completions, getWeekBounds(0, new Date(now)).start);
	$: lately = $board.completions.filter((c) => c.id > 0).slice(0, 8);
	$: titles = new Set($board.chores.map((c) => c.title.toLowerCase()));
	$: starters =
		$board.chores.filter((c) => c.cadence !== 'once').length < 3
			? STARTERS.filter((s) => !titles.has(s.title.toLowerCase()))
			: [];

	/** @param {string | null | undefined} id */
	function person(id) {
		return people.find((p) => p.id === id) || null;
	}

	/** @param {any[]} list */
	function openCount(list) {
		const open = list.filter((i) => i.state !== 'done').length;
		if (open === 0) return 'all done';
		return `${open} to do`;
	}

	/**
	 * @param {any} chore
	 * @param {any} draft
	 */
	function openSheet(chore, draft) {
		sheet = { chore, draft };
	}

	/** @param {(typeof STARTERS)[number]} s */
	function starterLabel(s) {
		return cadenceLabel({
			id: 0,
			title: s.title,
			assigned_to: null,
			cadence: s.cadence,
			every: s.every,
			due_on: s.weekday === undefined ? today : nextWeekday(today, s.weekday),
			created_at: ''
		});
	}

	async function quickAdd() {
		const title = cleanChoreTitle(quick);
		if (!title || adding) return;
		adding = true;
		try {
			const { data, error } = await supabase
				.from('chores')
				.insert({ title, assigned_to: quickWho || null, cadence: 'once', created_by: user.id })
				.select()
				.single();
			if (error) throw error;
			board.putChore(data);
			quick = '';
		} catch (err) {
			toast.error('Error adding it: ' + errorMessage(err));
		} finally {
			adding = false;
		}
	}
</script>

<svelte:window on:focus={() => !checking && board.refresh()} />

<div class="container">
	{#if checking || !$board.ready}
		<Skeleton variant="card" count={2} />
	{:else if $board.missing}
		<div class="card arcana">
			<EmptyState
				icon="scroll"
				title="The chore board isn't set up yet"
				hint="Run supabase/chores.sql in Supabase, then come back."
			/>
		</div>
	{:else if $board.error}
		<div class="card arcana">
			<EmptyState icon="warning" title="The board won't unroll" hint={$board.error}>
				<button class="btn btn-primary" on:click={() => board.start()}>
					<Icon name="star" size={16} /> Try again
				</button>
			</EmptyState>
		</div>
	{:else}
		<div class="page-head chores-head">
			<div>
				<h1>Chores</h1>
				<p class="lede">What the house needs doing, and who's on it.</p>
			</div>
			<button class="btn btn-secondary chore-new" on:click={() => openSheet(null, null)}>
				<Icon name="plus" size={16} /> Chore
			</button>
		</div>

		<!-- ── Ask for something ──────────────────────────── -->
		<section class="card arcana">
			<form class="quick" on:submit|preventDefault={quickAdd}>
				<div class="quick-row">
					<input
						type="text"
						maxlength="80"
						autocomplete="off"
						placeholder="Switch the laundry over"
						aria-label="Ask for something"
						bind:value={quick}
					/>
					<button type="submit" class="btn btn-primary" disabled={!quick.trim() || adding}>
						<Icon name="plus" size={15} /> Add
					</button>
				</div>
				<div class="seg" role="group" aria-label="Whose">
					<button
						type="button"
						class:active={!quickWho}
						aria-pressed={!quickWho}
						on:click={() => (quickWho = '')}>Anyone</button
					>
					{#each people as p (p.id)}
						<button
							type="button"
							class="person"
							style:--who={p.color}
							class:active={quickWho === p.id}
							aria-pressed={quickWho === p.id}
							on:click={() => (quickWho = p.id)}>{p.name}</button
						>
					{/each}
					<button
						type="button"
						class="more"
						on:click={() =>
							openSheet(null, { title: quick, assigned_to: quickWho || null, cadence: 'once' })}
					>
						<Icon name="calendar" size={13} /> A day, or repeats…
					</button>
				</div>
			</form>
		</section>

		{#if items.length > 0 && people.length > 1}
			<div class="filters seg" role="group" aria-label="Show whose">
				<button
					class:active={filter === 'all'}
					aria-pressed={filter === 'all'}
					on:click={() => (filter = 'all')}>Everyone</button
				>
				{#each people as p (p.id)}
					<button
						class="person"
						style:--who={p.color}
						class:active={filter === p.id}
						aria-pressed={filter === p.id}
						on:click={() => (filter = p.id)}>{p.name}</button
					>
				{/each}
				<button
					class:active={filter === 'anyone'}
					aria-pressed={filter === 'anyone'}
					on:click={() => (filter = 'anyone')}>Anyone's</button
				>
			</div>
		{/if}

		<!-- ── The board ─────────────────────────────────── -->
		{#each groups as group (group.key)}
			{#if group.items.length > 0 || group.key === 'now'}
				<section class="card arcana">
					<div class="card-header">
						<h2>{group.title}</h2>
						{#if group.items.length > 0}
							<span class="rune-label"
								>{group.key === 'now' ? openCount(group.items) : group.items.length}</span
							>
						{/if}
					</div>
					{#if group.items.length === 0}
						{#if items.length === 0}
							<EmptyState
								icon="scroll"
								title="Nothing on the board"
								hint="Ask for something above, or start with trash day below."
							/>
						{:else}
							<p class="quiet">
								<Icon name="sprout" size={14} /> Nothing due{filter === 'all' ? '' : ' here'} — all caught
								up.
							</p>
						{/if}
					{:else}
						<ul class="chore-list">
							{#each group.items as item (item.chore.id)}
								<ChoreRow
									{item}
									{today}
									{people}
									showWho={filter === 'all'}
									ontoggle={board.toggle}
									onedit={(chore) => openSheet(chore, null)}
								/>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		{/each}

		<!-- ── Starting out ─────────────────────────────── -->
		{#if starters.length > 0}
			<section class="card arcana">
				<div class="card-header">
					<h2>Start the Board</h2>
					<span class="rune-label">tap one to set it up</span>
				</div>
				<div class="starters">
					{#each starters as s (s.title)}
						<button
							class="starter"
							on:click={() =>
								openSheet(null, {
									title: s.title,
									cadence: s.cadence,
									every: s.every,
									weekday: s.weekday
								})}
						>
							<span class="starter-title">{s.title}</span>
							<span class="starter-when">{starterLabel(s)}</span>
						</button>
					{/each}
				</div>
			</section>
		{/if}

		<!-- ── Who did what ─────────────────────────────── -->
		{#if lately.length > 0}
			<section class="card arcana">
				<div class="card-header">
					<h2>Who Did What</h2>
					<span class="rune-label">this week</span>
				</div>
				{#if tally.length > 0}
					<div class="tally">
						{#each tally as t (t.id)}
							<span class="tally-chip" style:--who={person(t.id)?.color || null}>
								<span class="tally-count">{t.count}</span>
								{person(t.id)?.name || 'Someone'}
							</span>
						{/each}
					</div>
				{:else}
					<p class="quiet">Nothing ticked off yet this week.</p>
				{/if}
				<ul class="lately">
					{#each lately as c (c.id)}
						<li>
							<span class="lately-who" style:--who={person(c.done_by)?.color || null}
								>{person(c.done_by)?.name || 'Someone'}</span
							>
							<span class="lately-what">{c.chore?.title || 'a chore'}</span>
							<span class="lately-when">{doneWhen(c.done_at, today)}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}

	{#if sheet}
		<ChoreSheet
			{user}
			{people}
			chore={sheet.chore}
			draft={sheet.draft}
			hasRecord={!!sheet.chore && $board.completions.some((c) => c.chore_id === sheet?.chore?.id)}
			onsaved={(chore) => {
				board.putChore(chore);
				if (sheet && !sheet.chore && sheet.draft?.title === quick) quick = '';
			}}
			onremoved={board.dropChore}
			onclose={() => (sheet = null)}
		/>
	{/if}
</div>

<style>
	.page-head h1 {
		color: var(--accent-bright);
	}

	.lede {
		color: var(--text-faint);
		font-size: 0.95rem;
		margin-top: 0.2rem;
	}

	/* + Chore sits beside the title, so the board keeps a phone's first screen. */
	.chores-head {
		flex-wrap: nowrap;
		align-items: flex-start;
	}

	.chore-new {
		flex-shrink: 0;
		padding: 0.55rem 1rem;
	}

	/* ── Ask for something ─────────────────────────────── */
	.quick {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.quick-row {
		display: flex;
		gap: 0.5rem;
	}

	.quick-row input {
		flex: 1;
		min-width: 0;
		font-size: 1.05rem;
	}

	.quick-row .btn {
		flex-shrink: 0;
	}

	.seg {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.seg button {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 38px;
		padding: 0.3rem 0.85rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--text-muted);
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.seg button:hover {
		border-color: var(--border-gilt);
		color: var(--text);
	}

	.seg button.active {
		background: var(--accent-dim);
		border-color: var(--accent);
		color: var(--accent-bright);
	}

	/* A person's choice carries their dot. */
	.seg button.person::before {
		content: '';
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--who);
	}

	.seg button.more {
		border-style: dashed;
		color: var(--text-faint);
	}

	.filters {
		margin-bottom: var(--section-gap);
	}

	/* ── The board ─────────────────────────────────────── */
	.chore-list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.quiet {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		font-size: 0.92rem;
		font-style: italic;
		color: var(--text-faint);
		--icon-accent: var(--growing);
	}

	/* ── Starting out ──────────────────────────────────── */
	.starters {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(190px, 100%), 1fr));
		gap: 0.5rem;
	}

	.starter {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1rem;
		padding: 0.65rem 0.85rem;
		background: var(--surface-2);
		border: 1px dashed var(--border-gilt);
		border-radius: var(--radius-sm);
		text-align: left;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.starter:hover {
		border-style: solid;
		background: var(--accent-tint);
	}

	.starter-title {
		font-weight: 700;
		color: var(--text);
	}

	.starter-when {
		font-size: 0.82rem;
		color: var(--text-faint);
	}

	/* ── Who did what ─────────────────────────────────── */
	.tally {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.85rem;
	}

	.tally-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0.85rem 0.3rem 0.35rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		font-weight: 600;
		color: var(--text);
	}

	.tally-count {
		display: grid;
		place-items: center;
		min-width: 1.75rem;
		height: 1.75rem;
		padding: 0 0.35rem;
		border-radius: 999px;
		background: var(--who, var(--accent));
		color: #1b1206;
		font-weight: 800;
		font-variant-numeric: lining-nums tabular-nums;
	}

	.lately {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.92rem;
	}

	.lately li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}

	.lately-who {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		flex-shrink: 0;
		font-weight: 700;
		color: var(--text-muted);
	}

	.lately-who::before {
		content: '';
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--who, var(--accent));
	}

	.lately-what {
		flex: 1;
		min-width: 0;
		color: var(--text);
		overflow-wrap: anywhere;
	}

	.lately-when {
		flex-shrink: 0;
		font-size: 0.82rem;
		color: var(--text-faint);
	}
</style>
