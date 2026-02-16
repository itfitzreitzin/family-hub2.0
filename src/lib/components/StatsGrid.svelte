<script>
  export let entries = [];
  export let hourlyRate = 20;
  
  $: stats = calculateStats(entries);
  
  function calculateStats(entries) {
    const completed = entries.filter(e => e.clock_out);
    const totalHours = completed.reduce((sum, e) => sum + (e.hours || 0), 0);
    const uniqueDays = new Set(completed.map(e => 
      new Date(e.clock_in).toDateString()
    )).size;
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
    gap: 0.875rem;
    margin: 1.5rem 0;
  }

  .stat-card {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 1.25rem 1rem;
    border-radius: 14px;
    text-align: center;
    box-shadow: 0 4px 14px rgba(102, 126, 234, 0.25);
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .stat-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
  }

  .stat-value {
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .stat-label {
    font-size: 0.8rem;
    opacity: 0.85;
    margin-top: 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 500;
  }
</style>