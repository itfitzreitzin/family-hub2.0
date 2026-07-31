<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import { goto } from '$app/navigation'
  import { toast, confirm as confirmModal } from '$lib/stores/toast.js'
  import Nav from '$lib/Nav.svelte'
  import { getWeekBounds, formatTime, formatDateWeekday as formatDate } from '$lib/time.js'
  import { normalizeVenmoHandle, isMobileDevice, buildVenmoNote, buildVenmoLink } from '$lib/venmo.js'
  import { buildTimesheetCsv, timesheetFilename, downloadCsv } from '$lib/csv.js'
  import { errorMessage } from '$lib/errors.js'

  let user = null
  let profile = null
  /** @type {any[]} */
  let entries = []
  let loading = true
  /** @type {string | null} */
  let initError = null
  let entriesLoading = false
  let loadToken = 0
  /** @type {any[]} */
  let nannies = [] // List of all nannies
  /** @type {string | null} */
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
    loading = true
    initError = null

    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser()

      if (!currentUser) {
        goto('/')
        return
      }

      user = currentUser

      // Get profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      if (profileError) throw profileError
      profile = profileData

      // If family or admin, load all nannies for the filter dropdown
      if (profile?.role === 'family' || profile?.role === 'admin') {
        const { data: nanniesData, error: nanniesError } = await supabase
          .from('profiles')
          .select('*')
          .eq('role', 'nanny')
          .order('full_name')

        if (nanniesError) throw nanniesError
        nannies = nanniesData || []
      }

      // Load time entries
      await loadEntries()

      loading = false
    } catch (err) {
      initError = errorMessage(err)
      loading = false
    }
  }

  $: filteredEntries = showingWeek === 'current'
    ? entries.filter(e => isCurrentWeek(e.clock_in))
    : entries

  $: nannyById = Object.fromEntries(nannies.map(n => [n.id, n]))
  $: weekTotal = filteredEntries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0)
  $: weekPay = computeWeekPay(filteredEntries, nannyById, profile)
  // The rate shown in the summary: the filtered nanny's rate, or the viewer's
  // own for nannies. Null (shown as —) when "All Nannies" mixes rates.
  $: displayRate = selectedNannyId
    ? (nannyById[selectedNannyId]?.hourly_rate ?? 20)
    : (profile?.role === 'nanny' ? (profile?.hourly_rate ?? 20) : null)

  // Each entry is priced at its own nanny's rate, not the viewer's.
  /**
   * @param {any} entry
   * @param {Record<string, any>} byId
   * @param {any} viewer
   */
  function rateForEntry(entry, byId, viewer) {
    const nannyRate = byId[entry.nanny_id]?.hourly_rate
    if (nannyRate) return nannyRate
    if (viewer?.role === 'nanny' && viewer?.hourly_rate) return viewer.hourly_rate
    return 20
  }

  /**
   * @param {any[]} list
   * @param {Record<string, any>} byId
   * @param {any} viewer
   */
  function computeWeekPay(list, byId, viewer) {
    return list.reduce((sum, e) => sum + (parseFloat(e.hours) || 0) * rateForEntry(e, byId, viewer), 0)
  }

  function isCurrentWeek(dateString) {
    const { start, end } = getWeekBounds(0)
    const date = new Date(dateString)
    return date >= start && date <= end
  }

  async function loadEntries() {
    const token = ++loadToken
    entriesLoading = true

    try {
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

      const { data, error } = await query

      if (error) throw error
      if (token !== loadToken) return

      // Only show completed entries (with clock_out)
      entries = (data || []).filter(e => e.clock_out)
    } finally {
      if (token === loadToken) entriesLoading = false
    }
  }

  async function changeNannyFilter(nannyId) {
    selectedNannyId = nannyId

    try {
      await loadEntries()
    } catch (err) {
      toast.error('Error loading entries: ' + errorMessage(err))
    }

    // Update URL without reload
    const url = new URL(window.location)
    if (nannyId) {
      url.searchParams.set('nanny', nannyId)
    } else {
      url.searchParams.delete('nanny')
    }
    window.history.pushState({}, '', url)
  }

  async function generateVenmoPayment() {
    const nanny = selectedNannyId ? nannyById[selectedNannyId] : null
    if (!nanny) {
      toast.error('Select a single nanny to generate a payment')
      return
    }

    if (weekTotal === 0) {
      toast.error('No completed hours for this week')
      return
    }

    const recipient = normalizeVenmoHandle(nanny.venmo_username)
    if (!recipient) {
      toast.error(`${nanny.full_name} has no Venmo username set. Add it in Settings.`)
      return
    }

    const rate = nanny.hourly_rate || 20
    const note = buildVenmoNote({
      direction: 'pay',
      name: nanny.full_name,
      weekStart: getWeekBounds(0).start,
      hours: weekTotal,
      rate,
      total: weekPay
    })

    if (isMobileDevice()) {
      const confirmed = await confirmModal.show({ title: 'Venmo Payment', message: `Pay $${weekPay.toFixed(2)} to @${recipient} via Venmo?`, confirmText: 'Pay' })
      if (confirmed) {
        window.location.href = buildVenmoLink({ txn: 'pay', recipient, amount: weekPay, note })
      }
    } else {
      // Desktop - copy to clipboard
      try {
        await navigator.clipboard.writeText(note)
        toast.success('Payment details copied. Tip: use the Tracker page to record and track payments.')
      } catch {
        toast.info('Payment details: ' + note, 10000)
      }
    }
  }

  function exportCSV() {
    const nannyName = selectedNannyId
      ? nannyById[selectedNannyId]?.full_name
      : profile?.role === 'nanny'
        ? profile?.full_name
        : null
    const bounds = showingWeek === 'current' ? getWeekBounds(0) : null

    downloadCsv(
      timesheetFilename({
        nannyName,
        weekStart: bounds ? bounds.start : null,
        weekEnd: bounds ? bounds.end : null
      }),
      buildTimesheetCsv(filteredEntries, e => rateForEntry(e, nannyById, profile))
    )
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

    {:else if initError}
      <div class="table-card error-card">
        <h3>Couldn't load history</h3>
        <p>{initError}</p>
        <button class="btn-primary" on:click={initialize}>Retry</button>
      </div>

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
          <div class="stat">
            <div class="stat-value">{displayRate !== null ? '$' + displayRate + '/hr' : '—'}</div>
            <div class="stat-label">Rate</div>
          </div>
        </div>
        
        <div class="summary-actions">
          {#if (profile?.role === 'family' || profile?.role === 'admin') && showingWeek === 'current' && selectedNannyId}
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
          <div class="table-container" class:refreshing={entriesLoading}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                  <th>Hours</th>
                  <th>Earnings</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {#each filteredEntries as entry}
                  <tr>
                    <td>{formatDate(entry.clock_in)}</td>
                    <td>{formatTime(entry.clock_in)}</td>
                    <td>{formatTime(entry.clock_out)}</td>
                    <td>{(parseFloat(entry.hours) || 0).toFixed(2)}</td>
                    <td>${((parseFloat(entry.hours) || 0) * rateForEntry(entry, nannyById, profile)).toFixed(2)}</td>
                    <td class="notes">{entry.notes || '—'}</td>
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
    background: var(--surface-page, #f0f2f8);
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
    border-radius: 1rem;
    padding: 30px;
    margin-bottom: 30px;
    box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.07));
    border: 1px solid rgba(0, 0, 0, 0.04);
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
    background: var(--surface-sunken, #eef1f8);
    border-radius: 12px;
  }
  
  .stat-value {
    font-size: 2.25em;
    font-weight: bold;
    color: var(--color-primary, #667eea);
    letter-spacing: -0.02em;
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
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.35);
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
    border-radius: 1rem;
    padding: 30px;
    margin-bottom: 30px;
    box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.07));
    border: 1px solid rgba(0, 0, 0, 0.04);
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
    color: var(--color-primary, #667eea);
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
    background: var(--surface-sunken, #eef1f8);
    padding: 12px;
    text-align: left;
    color: #4a5568;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.8rem;
    border-bottom: 1px solid var(--color-gray-200, #e2e8f0);
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
    color: var(--color-primary, #667eea);
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
  border-radius: 12px;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.06));
  border: 1px solid rgba(0, 0, 0, 0.04);
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

.table-container.refreshing {
  opacity: 0.55;
  transition: opacity 0.15s;
}

.error-card {
  text-align: center;
}

.error-card p {
  color: #718096;
  margin: 10px 0 20px;
}
</style>