<script>
	import { createEventDispatcher } from 'svelte';
	import { formatDateWeekday, parseLocalDate, formatTime } from '$lib/time.js';

	/** @type {{ day: number, current: boolean, dateStr: string, isToday: boolean }[][]} */
	export let weeks = [];
	/** @type {Record<string, import('$lib/calendar.js').CalendarItem[]>} */
	export let itemsByDay = {};
	/** @type {string | null} */
	export let selectedDateStr = null;
	/** Max pills per cell before collapsing into "+N more" */
	export let maxPills = 3;

	const dispatch = createEventDispatcher();

	const DAY_HEADERS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

	/** @param {string} dateStr */
	function selectDay(dateStr) {
		dispatch('selectday', { dateStr });
	}

	/** @param {import('$lib/calendar.js').CalendarItem} item */
	function pillText(item) {
		if (item.kind === 'shift') {
			return `${formatTime(item.start).replace(' ', '').toLowerCase()} ${item.title}`;
		}
		return item.title;
	}

	/** @param {string} dateStr */
	function cellLabel(dateStr) {
		const n = (itemsByDay[dateStr] || []).length;
		const date = formatDateWeekday(parseLocalDate(dateStr));
		if (n === 0) return date;
		return `${date}, ${n} ${n === 1 ? 'event' : 'events'}`;
	}
</script>

<div class="month-grid">
	<div class="grid-days" aria-hidden="true">
		{#each DAY_HEADERS as d (d)}
			<span class="day-header">{d}</span>
		{/each}
	</div>

	{#each weeks as week, wi (wi)}
		<div class="grid-week">
			{#each week as cell (cell.dateStr)}
				{@const items = itemsByDay[cell.dateStr] || []}
				<button
					type="button"
					class="day-cell"
					class:outside={!cell.current}
					class:today={cell.isToday}
					class:selected={selectedDateStr === cell.dateStr}
					aria-current={cell.isToday ? 'date' : undefined}
					aria-pressed={selectedDateStr === cell.dateStr}
					on:click={() => selectDay(cell.dateStr)}
				>
					<span class="visually-hidden">{cellLabel(cell.dateStr)}</span>
					<span class="cell-num" aria-hidden="true">{cell.day}</span>
					<span class="cell-pills" aria-hidden="true">
						{#each items.slice(0, maxPills) as item (item.id + ':' + cell.dateStr)}
							<span class="pill pill-{item.kind}">{pillText(item)}</span>
						{/each}
						{#if items.length > maxPills}
							<span class="pill-more">+{items.length - maxPills} more</span>
						{/if}
					</span>
				</button>
			{/each}
		</div>
	{/each}
</div>

<style>
	.month-grid {
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		box-shadow: var(--shadow-md);
		overflow: hidden;
	}

	.grid-days {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		border-bottom: 1px solid var(--border-gilt);
		background: var(--surface-2);
	}

	.day-header {
		padding: 0.55rem 0.25rem;
		font-family: var(--font-body);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		text-align: center;
		color: var(--text-faint);
	}

	.grid-week {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		border-bottom: 1px solid var(--border-soft);
	}

	.grid-week:last-child {
		border-bottom: none;
	}

	.day-cell {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.25rem;
		min-height: 92px;
		padding: 0.4rem 0.3rem;
		background: none;
		border: none;
		border-right: 1px solid var(--border-soft);
		border-radius: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		transition: background var(--transition-fast);
		min-width: 0;
	}

	.day-cell:last-child {
		border-right: none;
	}

	.day-cell:hover {
		background: var(--accent-tint);
	}

	.day-cell:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	.day-cell.selected {
		background: var(--accent-tint);
		box-shadow: inset 0 0 0 1px var(--border-gilt);
	}

	.day-cell.outside {
		background-image: linear-gradient(0deg, rgba(0, 0, 0, 0.04), rgba(0, 0, 0, 0.04));
	}

	.cell-num {
		align-self: flex-start;
		width: 24px;
		height: 24px;
		line-height: 24px;
		text-align: center;
		border-radius: 50%;
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.outside .cell-num {
		color: var(--text-faint);
		opacity: 0.55;
	}

	.today .cell-num {
		background: var(--accent);
		color: var(--text-on-accent);
		font-weight: 700;
	}

	.cell-pills {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.pill {
		display: block;
		padding: 1px 5px;
		border-radius: 4px;
		font-family: var(--font-body);
		font-size: 0.66rem;
		font-weight: 600;
		line-height: 1.5;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		border-left: 2px solid transparent;
	}

	.pill-shift {
		background: var(--growing-dim);
		color: var(--growing);
		border-left-color: var(--growing);
	}

	.pill-family {
		background: var(--arcane-dim);
		color: var(--arcane);
		border-left-color: var(--arcane);
	}

	.pill-nanny-busy {
		background: var(--danger-dim);
		color: var(--danger);
		border-left-color: var(--danger);
	}

	.pill-payment {
		background: var(--accent-dim);
		color: var(--accent-bright);
		border-left-color: var(--accent);
	}

	.pill-more {
		padding: 1px 5px;
		font-family: var(--font-body);
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--text-faint);
	}

	/* Narrow screens: pills collapse to colour bars */
	@media (max-width: 640px) {
		.day-cell {
			min-height: 58px;
			padding: 0.3rem 0.2rem;
		}

		.pill {
			height: 4px;
			padding: 0;
			border-radius: 2px;
			border-left: none;
			font-size: 0;
		}

		.pill-shift {
			background: var(--growing);
		}
		.pill-family {
			background: var(--arcane);
		}
		.pill-nanny-busy {
			background: var(--danger);
		}
		.pill-payment {
			background: var(--accent);
		}

		.pill-more {
			padding: 0;
			font-size: 0.55rem;
			line-height: 1;
		}
	}
</style>
