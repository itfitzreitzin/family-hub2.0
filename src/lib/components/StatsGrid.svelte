<script>
	export let entries = [];
	export let hourlyRate = 20;

	$: stats = calculateStats(entries);

	function calculateStats(entries) {
		const completed = entries.filter((e) => e.clock_out);
		const totalHours = completed.reduce((sum, e) => sum + (e.hours || 0), 0);
		const uniqueDays = new Set(completed.map((e) => new Date(e.clock_in).toDateString())).size;
		const avgHours = uniqueDays > 0 ? totalHours / uniqueDays : 0;
		const totalPay = totalHours * hourlyRate;

		return { totalHours, uniqueDays, avgHours, totalPay };
	}
</script>

<div class="stats-grid">
	<div class="stat-card">
		<div class="stat-value">{stats.totalHours.toFixed(1)}</div>
		<div class="stat-label">Total Hours</div>
	</div>
	<div class="stat-card">
		<div class="stat-value">{stats.uniqueDays}</div>
		<div class="stat-label">Days Worked</div>
	</div>
	<div class="stat-card">
		<div class="stat-value">{stats.avgHours.toFixed(1)}</div>
		<div class="stat-label">Avg Hours/Day</div>
	</div>
	<div class="stat-card">
		<div class="stat-value">${stats.totalPay.toFixed(2)}</div>
		<div class="stat-label">Total Earnings</div>
	</div>
</div>

<style>
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: var(--grid-gap);
		margin: 1.5rem 0;
	}

	.stat-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 1.25rem 1rem;
		text-align: center;
		background: var(--surface-2);
		background-image: linear-gradient(160deg, var(--accent-tint), transparent 60%);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		transition: all var(--transition-normal);
	}

	.stat-card:hover {
		transform: translateY(-2px);
		border-color: var(--border-gilt);
		box-shadow: var(--shadow-md);
	}

	.stat-value {
		font-size: 1.65rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
		color: var(--accent-bright);
	}

	.stat-label {
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
</style>
