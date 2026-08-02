<script>
	import { createEventDispatcher } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { localDateString, buildMonthGrid, getMonthGridRange } from '$lib/time.js';

	/** @type {string[]} dates in YYYY-MM-DD format that have shifts */
	export let shiftDates = [];

	const dispatch = createEventDispatcher();

	const DAY_HEADERS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
	const MONTH_NAMES = [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'
	];

	let today = new Date();
	let viewYear = today.getFullYear();
	let viewMonth = today.getMonth();

	$: todayStr = localDateString(today);
	$: monthLabel = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
	/*
	 * Dependencies must appear in the reactive statement itself: reads inside
	 * an extracted function body are invisible to legacy dependency tracking,
	 * which is exactly how the shift dots previously went stale.
	 */
	$: weeks = buildMonthGrid(viewYear, viewMonth, todayStr);
	$: shiftSet = new Set(shiftDates);

	function notifyMonth() {
		const { startStr, endStr } = getMonthGridRange(viewYear, viewMonth);
		dispatch('monthchange', { year: viewYear, month: viewMonth, startStr, endStr });
	}

	function prevMonth() {
		if (viewMonth === 0) { viewYear--; viewMonth = 11; }
		else viewMonth--;
		notifyMonth();
	}

	function nextMonth() {
		if (viewMonth === 11) { viewYear++; viewMonth = 0; }
		else viewMonth++;
		notifyMonth();
	}

	function goToday() {
		today = new Date();
		viewYear = today.getFullYear();
		viewMonth = today.getMonth();
		notifyMonth();
	}
</script>

<div class="mini-cal">
	<div class="cal-nav">
		<span class="cal-month">{monthLabel}</span>
		<div class="cal-arrows">
			<button type="button" on:click={prevMonth} aria-label="Previous month" class="cal-arrow">
				<Icon name="chevron-left" size={12} />
			</button>
			<button type="button" on:click={goToday} class="cal-today-btn">Today</button>
			<button type="button" on:click={nextMonth} aria-label="Next month" class="cal-arrow">
				<Icon name="chevron-right" size={12} />
			</button>
		</div>
	</div>

	<table class="cal-grid" aria-label={'Calendar, ' + monthLabel}>
		<thead>
			<tr>
				{#each DAY_HEADERS as d (d)}
					<th scope="col">{d}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each weeks as week, wi (wi)}
				<tr>
					{#each week as cell (cell.dateStr)}
						<td
							class:outside={!cell.current}
							class:today={cell.isToday}
						>
							<span class="day-num">{cell.day}</span>
							{#if shiftSet.has(cell.dateStr)}
								<span class="dot shift-dot" aria-hidden="true"></span>
								<span class="visually-hidden">Nanny shift</span>
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>

	<div class="cal-legend">
		<span class="legend-item"><span class="dot shift-dot" aria-hidden="true"></span> Nanny Shift</span>
	</div>
</div>

<style>
	.mini-cal {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.cal-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.cal-month {
		font-family: var(--font-display);
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
	}

	.cal-arrows {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.cal-arrow {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		background: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.cal-arrow:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-tint);
	}

	.cal-today-btn {
		padding: 0.25rem 0.6rem;
		background: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.cal-today-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.cal-grid {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}

	.cal-grid th {
		padding: 0.3rem 0;
		font-family: var(--font-body);
		font-size: 0.58rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		text-align: center;
		color: var(--text-faint);
	}

	.cal-grid td {
		position: relative;
		padding: 0.35rem 0;
		text-align: center;
		vertical-align: top;
	}

	.day-num {
		display: inline-block;
		width: 26px;
		height: 26px;
		line-height: 26px;
		border-radius: 50%;
		font-family: var(--font-body);
		font-size: 0.78rem;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		color: var(--text);
		transition: all var(--transition-fast);
	}

	.outside .day-num {
		color: var(--text-faint);
		opacity: 0.5;
	}

	.today .day-num {
		background: var(--accent);
		color: var(--text-on-accent);
		font-weight: 700;
	}

	.dot {
		display: block;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		margin: 2px auto 0;
	}

	.shift-dot {
		background: var(--growing);
	}

	.outside .dot {
		opacity: 0.35;
	}

	.cal-legend {
		display: flex;
		gap: 1rem;
		padding-top: 0.4rem;
		border-top: 1px solid var(--border-soft);
	}

	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--text-faint);
		letter-spacing: 0.05em;
	}

	.legend-item .dot {
		margin: 0;
	}
</style>
