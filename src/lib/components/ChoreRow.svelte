<script>
	import Icon from '$lib/icons/Icon.svelte';
	import { cadenceLabel, dueLabel, doneWhen } from '$lib/chores.js';

	/*
	 * One chore on the board: tap the row to tick it off — a gilt line inks
	 * through it and it stays where it is, done, saying who did it — and tap
	 * again to take the tick back. Used by Home → Chores, Home's card and the
	 * nanny's card on Care, each inside its own <ul>.
	 */

	/** @type {import('$lib/chores.js').ChoreNow} */
	export let item;
	/** 'YYYY-MM-DD' */
	export let today = '';
	/** @type {{ id: string, name: string, color: string }[]} */
	export let people = [];
	/** Show whose it is (off where the column already says). */
	export let showWho = true;
	/** Home's card: no note, no cadence. */
	export let compact = false;
	/** @type {(item: import('$lib/chores.js').ChoreNow) => void} */
	export let ontoggle = () => {};
	/** @type {((chore: import('$lib/chores.js').Chore) => void) | null} */
	export let onedit = null;

	$: chore = item.chore;
	$: done = item.state === 'done';
	$: who = people.find((p) => p.id === chore.assigned_to) || null;
	$: doer = item.done ? people.find((p) => p.id === item.done?.done_by) || null : null;
	$: due = dueLabel(item, today);
	$: cadence = compact ? '' : cadenceLabel(chore);
</script>

<li
	class="c-item"
	class:done
	class:late={item.state === 'late'}
	class:ahead={item.state === 'upcoming'}
	class:compact
>
	<button
		class="c-tap"
		on:click={() => ontoggle(item)}
		aria-pressed={done}
		aria-label={done ? `${chore.title}, done — tap to take it back` : `Tick off ${chore.title}`}
	>
		<span class="c-box" aria-hidden="true"><Icon name="check" size={14} /></span>
		<span class="c-text">
			<span class="c-title">
				{chore.title}
				<span class="c-ink" aria-hidden="true"></span>
			</span>
			<span class="c-meta">
				{#if showWho}
					<span class="c-who" style:--who={who?.color || null}>{who ? who.name : 'Anyone'}</span>
				{/if}
				{#if done && item.done}
					<span class="c-done"
						><Icon name="check" size={11} />
						{doer?.name || 'done'} · {doneWhen(item.done.done_at, today)}</span
					>
				{:else if due}
					<span class="c-due">{due}</span>
				{/if}
				{#if cadence}<span class="c-cadence">{cadence}</span>{/if}
				{#if item.streak >= 2}
					<span class="c-streak" title="{item.streak} in a row">
						<Icon name="candle" size={12} />{item.streak}
						<span class="visually-hidden">in a row</span>
					</span>
				{/if}
			</span>
			{#if chore.note && !compact}<span class="c-note">{chore.note}</span>{/if}
		</span>
	</button>
	{#if onedit}
		<button
			class="icon-btn c-edit"
			on:click={() => onedit?.(chore)}
			aria-label="Edit {chore.title}"
		>
			<Icon name="quill" size={14} />
		</button>
	{/if}
</li>

<style>
	.c-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		border-bottom: 1px solid var(--border-soft);
	}

	.c-item:last-child {
		border-bottom: none;
	}

	/* The whole row is the tap target — a wet hand at the kitchen screen. */
	.c-tap {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.85rem;
		min-height: 58px;
		padding: 0.5rem 0.25rem;
		background: none;
		border: none;
		color: inherit;
		text-align: left;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.compact .c-tap {
		min-height: 50px;
		gap: 0.7rem;
		padding: 0.4rem 0.1rem;
	}

	.c-box {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		border: 1.5px solid var(--border-gilt);
		border-radius: 50%;
		color: transparent;
		--icon-accent: transparent;
		transition: all var(--transition-fast);
	}

	.c-tap:hover .c-box {
		background: var(--accent-tint);
	}

	.late .c-box {
		border-color: var(--danger);
	}

	.done .c-box {
		background: var(--growing-dim);
		border-color: var(--growing);
		color: var(--growing);
		--icon-accent: var(--growing);
	}

	.c-text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.c-title {
		position: relative;
		align-self: flex-start;
		font-family: var(--font-body);
		font-size: 1.08rem;
		font-weight: 600;
		color: var(--text);
		overflow-wrap: anywhere;
		transition: color var(--transition-normal);
	}

	.compact .c-title {
		font-size: 1rem;
	}

	.ahead .c-title {
		color: var(--text-muted);
	}

	.done .c-title {
		color: var(--text-faint);
	}

	/* The gilt line inked through a done chore, drawn left to right. */
	.c-ink {
		position: absolute;
		left: -3px;
		right: -3px;
		top: 52%;
		height: 2.5px;
		border-radius: 3px;
		background: linear-gradient(90deg, var(--accent), var(--accent-bright));
		box-shadow: 0 0 8px var(--accent-dim);
		transform: scaleX(0);
		transform-origin: left center;
		transition: transform 0.5s var(--ease-out-expo);
		pointer-events: none;
	}

	.done .c-ink {
		transform: scaleX(1);
	}

	.c-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 0.45rem;
		row-gap: 0.15rem;
		font-size: 0.8rem;
		color: var(--text-faint);
	}

	.c-meta > * + *::before {
		content: '·';
		margin-right: 0.45rem;
		color: var(--text-faint);
	}

	.c-who {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-weight: 700;
		color: var(--text-muted);
	}

	/* The person's dot; gilt for anyone's. */
	.c-who::after {
		content: '';
		order: -1;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--who, var(--accent));
	}

	.c-due {
		font-weight: 600;
		color: var(--text-muted);
	}

	.late .c-due {
		color: var(--danger);
	}

	.c-done {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--growing);
		font-weight: 600;
		--icon-accent: var(--growing);
	}

	.c-streak {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		color: var(--accent-bright);
		font-weight: 700;
		font-variant-numeric: lining-nums tabular-nums;
		--icon-accent: var(--accent-bright);
	}

	.c-note {
		font-size: 0.86rem;
		color: var(--text-muted);
	}

	.c-edit {
		flex-shrink: 0;
		opacity: 0.6;
	}

	.c-edit:hover {
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.c-ink {
			transition: none;
		}
	}
</style>
