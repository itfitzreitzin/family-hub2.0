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
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
    margin: 1.5rem 0;
  }
  
  .stat-card {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 1.25rem;
    border-radius: 0.75rem;
    text-align: center;
    box-shadow: 0 10px 30px rgba(0,0,0,0.1);
  }
  
  .stat-value {
    font-size: 2rem;
    font-weight: bold;
  }
  
  .stat-label {
    font-size: 0.9rem;
    opacity: 0.9;
    margin-top: 0.25rem;
  }
</style>