<script>
	import Icon from '$lib/icons/Icon.svelte';
	import { localDateString } from '$lib/time.js';

	/** @type {string[]} dates in YYYY-MM-DD format that have shifts */
	export let shiftDates = [];

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
	$: weeks = buildWeeks(viewYear, viewMonth);

	/** @param {number} year @param {number} month */
	function buildWeeks(year, month) {
		const firstDay = new Date(year, month, 1).getDay();
		const daysInMonth = new Date(year, month + 1, 0).getDate();
		const daysInPrev = new Date(year, month, 0).getDate();

		/** @type {{ day: number, current: boolean, dateStr: string, isToday: boolean, hasShift: boolean }[]} */
		const cells = [];

		for (let i = firstDay - 1; i >= 0; i--) {
			const d = daysInPrev - i;
			const m = month === 0 ? 12 : month;
			const y = month === 0 ? year - 1 : year;
			const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
			cells.push({ day: d, current: false, dateStr: ds, isToday: false, hasShift: shiftDates.includes(ds) });
		}

		for (let d = 1; d <= daysInMonth; d++) {
			const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
			cells.push({ day: d, current: true, dateStr: ds, isToday: ds === todayStr, hasShift: shiftDates.includes(ds) });
		}

		const remaining = 7 - (cells.length % 7);
		if (remaining < 7) {
			const nm = month === 11 ? 1 : month + 2;
			const ny = month === 11 ? year + 1 : year;
			for (let d = 1; d <= remaining; d++) {
				const ds = `${ny}-${String(nm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
				cells.push({ day: d, current: false, dateStr: ds, isToday: false, hasShift: shiftDates.includes(ds) });
			}
		}

		/** @type {typeof cells[]} */
		const rows = [];
		for (let i = 0; i < cells.length; i += 7) {
			rows.push(cells.slice(i, i + 7));
		}
		return rows;
	}

	function prevMonth() {
		if (viewMonth === 0) { viewYear--; viewMonth = 11; }
		else viewMonth--;
	}

	function nextMonth() {
		if (viewMonth === 11) { viewYear++; viewMonth = 0; }
		else viewMonth++;
	}

	function goToday() {
		today = new Date();
		viewYear = today.getFullYear();
		viewMonth = today.getMonth();
	}
</script>

<div class="mini-cal">
	<div class="cal-nav">
		<span class="cal-month">{monthLabel}</span>
		<div class="cal-arrows">
			<button on:click={prevMonth} aria-label="Previous month" class="cal-arrow">
				<Icon name="chevron-left" size={12} />
			</button>
			<button on:click={goToday} class="cal-today-btn">Today</button>
			<button on:click={nextMonth} aria-label="Next month" class="cal-arrow">
				<Icon name="chevron-right" size={12} />
			</button>
		</div>
	</div>

	<table class="cal-grid" aria-label="Calendar">
		<thead>
			<tr>
				{#each DAY_HEADERS as d}
					<th>{d}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each weeks as week}
				<tr>
					{#each week as cell}
						<td
							class:outside={!cell.current}
							class:today={cell.isToday}
						>
							<span class="day-num">{cell.day}</span>
							{#if cell.hasShift}
								<span class="dot shift-dot" aria-label="Nanny shift"></span>
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>

	<div class="cal-legend">
		<span class="legend-item"><span class="dot shift-dot"></span> Nanny Shift</span>
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
