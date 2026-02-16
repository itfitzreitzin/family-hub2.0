<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import { toast } from '$lib/stores/toast.js'
  import Nav from '$lib/Nav.svelte'
  
  // Round hours to nearest 15 minutes (0.25 hour increments)
  function roundToQuarter(hours) {
    return Math.round(hours * 4) / 4
  }

  let user = null
  let profile = null
  let entries = []
  let loading = true
  let nannies = [] // List of all nannies
  let selectedNannyId = null // Filter
  
  // Week filter
  let showingWeek = 'current' // 'current' or 'all'
  
  // Check URL params for nanny filter
  onMount(async () => {
    const urlParams = new URLSearchParams(window.location.search)
    const nannyParam = urlParams.get('nanny')
    if (nannyParam) {
      selectedNannyId = nannyParam
    }
    
    await initialize()
  })
  
  async function initialize() {
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    
    if (!currentUser) {
      window.location.href = '/'
      return
    }
    
    user = currentUser
    
    // Get profile
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()

    profile = profileData

    // If family or admin, load all nannies for the filter dropdown
    if (profile?.role === 'family' || profile?.role === 'admin') {
      const { data: nanniesData } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'nanny')
        .order('full_name')
      
      nannies = nanniesData || []
    }
    
    // Load time entries
    await loadEntries()
    
    loading = false
  }
  
  $: filteredEntries = showingWeek === 'current'
    ? entries.filter(e => isCurrentWeek(e.clock_in))
    : entries

  $: weekTotal = filteredEntries.reduce((sum, e) => sum + roundToQuarter(parseFloat(e.hours) || 0), 0)
  $: weekPay = filteredEntries.reduce((sum, e) => {
    const hours = roundToQuarter(parseFloat(e.hours) || 0)
    return sum + hours * getRateForEntry(e)
  }, 0)
  $: isFamilyOrAdmin = profile?.role === 'family' || profile?.role === 'admin'

  function getRateForEntry(entry) {
    if (profile?.role === 'nanny') return profile?.hourly_rate || 20
    const nanny = nannies.find(n => n.id === entry.nanny_id)
    return nanny?.hourly_rate || 20
  }

  function getNannyName(entry) {
    const nanny = nannies.find(n => n.id === entry.nanny_id)
    return nanny?.full_name || 'Unknown'
  }
  
  function isCurrentWeek(dateString) {
    const date = new Date(dateString)
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay()) // Sunday
    weekStart.setHours(0, 0, 0, 0)
    
    return date >= weekStart
  }
  
  async function loadEntries() {
    let query = supabase
      .from('time_entries')
      .select('*')
      .order('clock_in', { ascending: false })
    
    // Filter by selected nanny
    if (selectedNannyId) {
      query = query.eq('nanny_id', selectedNannyId)
    } else if (profile?.role === 'nanny') {
      // Nannies only see their own
      query = query.eq('nanny_id', user.id)
    }
    // Family/admin see all (unless filtered)
    
    const { data } = await query
    
    // Only show completed entries (with clock_out)
    entries = (data || []).filter(e => e.clock_out)
  }
  
  async function changeNannyFilter(nannyId) {
    selectedNannyId = nannyId
    await loadEntries()
    
    // Update URL without reload
    const url = new URL(window.location)
    if (nannyId) {
      url.searchParams.set('nanny', nannyId)
    } else {
      url.searchParams.delete('nanny')
    }
    window.history.pushState({}, '', url)
  }
  
  function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    })
  }
  
  function formatTime(dateString) {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  function generateVenmoPayment() {
    const selectedNanny = selectedNannyId ? nannies.find(n => n.id === selectedNannyId) : null
    const venmo = (selectedNanny?.venmo_username || profile?.venmo_username || '').replace(/@/g, '').trim().split(/[\s,;]+/)[0] || 'username'
    const nannyName = selectedNanny?.full_name || profile?.full_name

    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())

    const note = `Weekly childcare payment for ${nannyName}
Week of ${weekStart.toLocaleDateString()}
Hours: ${weekTotal.toFixed(2)}
Total: $${weekPay.toFixed(2)}`
    
    // Check if mobile
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    
    if (isMobile) {
      const venmoUrl = `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(venmo)}&amount=${weekPay.toFixed(2)}&note=${encodeURIComponent(note)}`
      
      if (confirm(`Pay $${weekPay.toFixed(2)} to @${venmo} via Venmo?`)) {
        window.location.href = venmoUrl
      }
    } else {
      // Desktop - copy to clipboard
      navigator.clipboard.writeText(note).then(() => {
        toast.success('Payment details copied! Paste into Venmo when sending to @' + venmo)
      })
    }
  }
  
  function exportCSV() {
    const headers = isFamilyOrAdmin
      ? ['Nanny', 'Date', 'Clock In', 'Clock Out', 'Hours', 'Rate', 'Earnings', 'Notes']
      : ['Date', 'Clock In', 'Clock Out', 'Hours', 'Earnings', 'Notes']
    const rows = filteredEntries.map(e => {
      const hours = roundToQuarter(parseFloat(e.hours) || 0)
      const rate = getRateForEntry(e)
      const base = [
        formatDate(e.clock_in),
        formatTime(e.clock_in),
        formatTime(e.clock_out),
        hours.toFixed(2),
      ]
      if (isFamilyOrAdmin) {
        return [getNannyName(e), ...base, rate.toFixed(2), (hours * rate).toFixed(2), e.notes || '']
      }
      return [...base, (hours * rate).toFixed(2), e.notes || '']
    })
    
    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')
    
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `timesheet-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }
  
  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/'
  }
</script>
<Nav currentPage="history" />
<div class="container">
   <!-- Nanny Filter (only show for family/admin) -->
  {#if (profile?.role === 'family' || profile?.role === 'admin') && nannies.length > 0}
    <div class="filter-bar">
      <label>Filter by Nanny:</label>
      <select bind:value={selectedNannyId} on:change={() => changeNannyFilter(selectedNannyId)}>
        <option value={null}>All Nannies</option>
        {#each nannies as nanny}
          <option value={nanny.id}>{nanny.full_name}</option>
        {/each}
      </select>
    </div>
  {/if}
  <div class="content">
    {#if loading}
      <div class="loading">Loading...</div>
      
    {:else}
      <!-- Week Summary -->
      <div class="summary-card">
        <div class="summary-header">
          <h2>This Week's Summary</h2>
          <div class="week-toggle">
            <button 
              class:active={showingWeek === 'current'}
              on:click={() => showingWeek = 'current'}
            >
              This Week
            </button>
            <button 
              class:active={showingWeek === 'all'}
              on:click={() => showingWeek = 'all'}
            >
              All Time
            </button>
          </div>
        </div>
        
        <div class="summary-stats">
          <div class="stat">
            <div class="stat-value">{weekTotal.toFixed(1)}</div>
            <div class="stat-label">Hours</div>
          </div>
          <div class="stat">
            <div class="stat-value">${weekPay.toFixed(2)}</div>
            <div class="stat-label">Total Pay</div>
          </div>
          {#if !isFamilyOrAdmin || selectedNannyId}
            {@const rate = selectedNannyId ? (nannies.find(n => n.id === selectedNannyId)?.hourly_rate || 20) : (profile?.hourly_rate || 20)}
            <div class="stat">
              <div class="stat-value">${rate}/hr</div>
              <div class="stat-label">Rate</div>
            </div>
          {:else}
            <div class="stat">
              <div class="stat-value">{filteredEntries.length}</div>
              <div class="stat-label">Shifts</div>
            </div>
          {/if}
        </div>
        
        <div class="summary-actions">
          {#if profile?.role === 'family' && showingWeek === 'current'}
            <button class="btn-primary" on:click={generateVenmoPayment}>
              💸 Generate Venmo Payment
            </button>
          {/if}
          <button class="btn-secondary" on:click={exportCSV}>
            📥 Export CSV
          </button>
        </div>
      </div>
      
      <!-- Entries Table -->
      <div class="table-card">
        <h3>{filteredEntries.length} Shifts</h3>
        
        {#if filteredEntries.length === 0}
          <div class="empty-state">
            <p>No completed shifts yet</p>
            <a href="/tracker">Go to Time Tracker →</a>
          </div>
        {:else}
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  {#if isFamilyOrAdmin && !selectedNannyId}
                    <th>Nanny</th>
                  {/if}
                  <th>Date</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                  <th>Hours</th>
                  <th>Earnings</th>
                  <th class="hide-mobile">Notes</th>
                </tr>
              </thead>
              <tbody>
                {#each filteredEntries as entry}
                  {@const hours = roundToQuarter(parseFloat(entry.hours) || 0)}
                  {@const earnings = hours * getRateForEntry(entry)}
                  <tr>
                    {#if isFamilyOrAdmin && !selectedNannyId}
                      <td>{getNannyName(entry)}</td>
                    {/if}
                    <td>{formatDate(entry.clock_in)}</td>
                    <td>{formatTime(entry.clock_in)}</td>
                    <td>{formatTime(entry.clock_out)}</td>
                    <td>{hours.toFixed(2)}</td>
                    <td>${earnings.toFixed(2)}</td>
                    <td class="notes hide-mobile">{entry.notes || '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
      
      <div class="quick-links">
        <a href="/dashboard">← Back to Dashboard</a>
        <a href="/tracker">Time Tracker →</a>
      </div>
    {/if}
  </div>
</div>

<style>
  .container {
    min-height: 100vh;
    background: #f7fafc;
  }
  
  .header {
    background: white;
    padding: 20px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  h1 {
    margin: 0;
    color: #667eea;
  }
  
  .user-info {
    display: flex;
    align-items: center;
    gap: 15px;
  }
  
  .user-info button {
    padding: 8px 16px;
    background: #f56565;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
  }
  
  .content {
    max-width: 1200px;
    margin: 0 auto;
    padding: 40px 20px;
  }
  
  .summary-card {
    background: white;
    border-radius: 15px;
    padding: 30px;
    margin-bottom: 30px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  }
  
  .summary-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 30px;
    flex-wrap: wrap;
    gap: 20px;
  }
  
  h2 {
    margin: 0;
    color: #2d3748;
  }
  
  .week-toggle {
    display: flex;
    gap: 10px;
  }
  
  .week-toggle button {
    padding: 8px 16px;
    border: 2px solid #e2e8f0;
    background: white;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    color: #4a5568;
    transition: all 0.2s;
  }
  
  .week-toggle button.active {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-color: #667eea;
  }
  
  .summary-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 20px;
    margin-bottom: 30px;
  }
  
  .stat {
    text-align: center;
    padding: 20px;
    background: #f7fafc;
    border-radius: 10px;
  }
  
  .stat-value {
    font-size: 2.5em;
    font-weight: bold;
    color: #667eea;
    margin-bottom: 5px;
  }
  
  .stat-label {
    color: #718096;
    font-size: 0.9em;
  }
  
  .summary-actions {
    display: flex;
    gap: 15px;
    flex-wrap: wrap;
  }
  
  .btn-primary,
  .btn-secondary {
    padding: 12px 24px;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }
  
  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
  }
  
  .btn-secondary {
    background: white;
    color: #667eea;
    border: 2px solid #667eea;
  }
  
  .btn-secondary:hover {
    background: #f7fafc;
  }
  
  .table-card {
    background: white;
    border-radius: 15px;
    padding: 30px;
    margin-bottom: 30px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  }
  
  h3 {
    margin: 0 0 20px 0;
    color: #2d3748;
  }
  
  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: #718096;
  }
  
  .empty-state p {
    font-size: 1.2em;
    margin-bottom: 20px;
  }
  
  .empty-state a {
    color: #667eea;
    text-decoration: none;
    font-weight: 600;
  }
  
  .table-container {
    overflow-x: auto;
  }
  
  table {
    width: 100%;
    border-collapse: collapse;
  }
  
  th {
    background: #f7fafc;
    padding: 12px;
    text-align: left;
    color: #4a5568;
    font-weight: 600;
    border-bottom: 2px solid #e2e8f0;
  }
  
  td {
    padding: 12px;
    border-bottom: 1px solid #e2e8f0;
    color: #2d3748;
  }
  
  tr:hover {
    background: #f7fafc;
  }
  
  .notes {
    color: #718096;
    font-style: italic;
  }
  
  .quick-links {
    display: flex;
    justify-content: space-between;
    padding: 0 20px;
  }
  
  .quick-links a {
    color: #667eea;
    text-decoration: none;
    font-weight: 600;
  }
  
  .quick-links a:hover {
    text-decoration: underline;
  }
  
  .loading {
    text-align: center;
    padding: 60px;
    color: #718096;
  }
  .filter-bar {
  max-width: 1200px;
  margin: 20px auto;
  padding: 15px 20px;
  background: white;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  display: flex;
  align-items: center;
  gap: 15px;
}

.filter-bar label {
  font-weight: 600;
  color: #4a5568;
}

.filter-bar select {
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 1em;
  cursor: pointer;
}
</style>