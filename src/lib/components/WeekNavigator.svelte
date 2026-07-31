<script>
	import { createEventDispatcher } from 'svelte';

	export let currentWeek = new Date();

	const dispatch = createEventDispatcher();

	function changeWeek(direction) {
		const newWeek = new Date(currentWeek);
		newWeek.setDate(newWeek.getDate() + direction * 7);
		dispatch('weekChange', newWeek);
	}

	function formatWeek(date) {
		const start = new Date(date);
		start.setDate(start.getDate() - start.getDay());
		const end = new Date(start);
		end.setDate(end.getDate() + 6);

		return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
	}

	$: isCurrentWeek = () => {
		const now = new Date();
		const weekStart = new Date(currentWeek);
		weekStart.setDate(weekStart.getDate() - weekStart.getDay());
		const nowStart = new Date(now);
		nowStart.setDate(nowStart.getDate() - nowStart.getDay());

		return weekStart.toDateString() === nowStart.toDateString();
	};
</script>

<div class="week-navigator">
	<button on:click={() => changeWeek(-1)}>← Previous</button>
	<div class="week-display">
		<span>{formatWeek(currentWeek)}</span>
		{#if isCurrentWeek()}
			<span class="current-badge">Current Week</span>
		{/if}
	</div>
	<button on:click={() => changeWeek(1)}>Next →</button>
</div>

<style>
	.week-navigator {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding: 0.7rem 0.9rem;
		margin-bottom: 1rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--card-radius);
	}

	.week-navigator button {
		min-height: 36px;
		padding: 0.35rem 0.85rem;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		font-family: var(--font-body);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.week-navigator button:hover {
		color: var(--accent-bright);
		border-color: var(--border-gilt);
		background: var(--accent-tint);
	}

	.week-display {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		flex-wrap: wrap;
		justify-content: center;
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}

	.current-badge {
		padding: 0.2rem 0.6rem;
		border: 1px solid rgba(111, 191, 115, 0.45);
		border-radius: 999px;
		background: var(--growing-dim);
		color: var(--growing);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.11em;
		text-transform: uppercase;
		white-space: nowrap;
	}
</style>
