<script>
  import { onMount, onDestroy } from 'svelte'
  import { supabase } from '$lib/supabase'
  import Nav from '$lib/Nav.svelte'
  import { goto } from '$app/navigation'
  import { toast, confirm as confirmModal } from '$lib/stores/toast.js'
  import { getWeekBounds, localDateString, formatTime } from '$lib/time.js'
  import { errorMessage } from '$lib/errors.js'

  let user = null
  let profile = null
  let loading = true
  /** @type {string | null} */
  let initError = null
  /** @type {any[]} */
  let nannies = []
  /** @type {any[]} */
  let activeShifts = []
  /** @type {any[]} */
  let weekEntries = []
  let now = Date.now()
  let showAddNanny = false
  let selectedNanny = null
  let nannyEmail = ''
  let nannyName = ''
  let nannyRate = 20
  let nannyVenmo = ''
  let nannyPassword = ''

  /** @type {ReturnType<typeof supabase.channel> | null} */
  let dashChannel = null
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollInterval = null
  /** @type {ReturnType<typeof setInterval> | null} */
  let tickInterval = null
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reloadTimer = null

  function editNanny(nanny) {
    selectedNanny = nanny
    nannyName = nanny.full_name
    nannyRate = nanny.hourly_rate
    nannyVenmo = nanny.venmo_username || ''
    nannyEmail = ''
    nannyPassword = ''
    showAddNanny = true
  }
  
  async function saveNanny() {
    if (!nannyName) {
      toast.error('Name is required')
      return
    }
    
    try {
      if (selectedNanny) {
        // Update existing nanny
        const { error } = await supabase
          .from('profiles')
          .update({
            full_name: nannyName,
            hourly_rate: nannyRate,
            venmo_username: nannyVenmo
          })
          .eq('id', selectedNanny.id)
        
        if (error) throw error
        
        toast.success('Nanny updated!')
      } else {
        // Create new nanny
        if (!nannyEmail || !nannyPassword) {
          toast.error('Email and password required for new nanny')
          return
        }
        
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: nannyEmail,
          password: nannyPassword
        })
        
        if (authError) throw authError
        
        // Create profile
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: authData.user.id,
            role: 'nanny',
            full_name: nannyName,
            hourly_rate: nannyRate,
            venmo_username: nannyVenmo
          })
        
        if (profileError) throw profileError
        
        toast.success('Nanny created! They can log in with: ' + nannyEmail)
      }
      
      cancelNannyForm()
      await loadFamilyDashboard()
    } catch (err) {
      toast.error('Error: ' + err.message)
    }
  }
  
  async function deleteNanny(nanny) {
    const confirmed = await confirmModal.show({
      title: 'Delete Nanny',
      message: `Delete ${nanny.full_name}? This will also delete all their time entries.`,
      confirmText: 'Delete',
      danger: true
    })
    if (!confirmed) return
    
    try {
      // Delete time entries first
      await supabase
        .from('time_entries')
        .delete()
        .eq('nanny_id', nanny.id)
      
      // Delete profile
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', nanny.id)
      
      if (error) throw error
      
      toast.success('Nanny deleted')
      await loadFamilyDashboard()
    } catch (err) {
      toast.error('Error deleting: ' + err.message)
    }
  }
  
  function cancelNannyForm() {
    showAddNanny = false
    selectedNanny = null
    nannyEmail = ''
    nannyName = ''
    nannyRate = 20
    nannyVenmo = ''
    nannyPassword = ''
  }
onMount(() => {
  initDashboard()

  tickInterval = setInterval(() => {
    now = Date.now()
  }, 1000)

  // Fallback refresh in case a realtime event is missed or unavailable
  pollInterval = setInterval(() => {
    reloadDashboard()
  }, 30000)
})

onDestroy(() => {
  if (dashChannel) supabase.removeChannel(dashChannel)
  if (pollInterval) clearInterval(pollInterval)
  if (tickInterval) clearInterval(tickInterval)
  if (reloadTimer) clearTimeout(reloadTimer)
})

async function initDashboard() {
  loading = true
  initError = null

  try {
    const { data: { user: currentUser } } = await supabase.auth.getUser()

    if (!currentUser) {
      goto('/')
      return
    }

    user = currentUser

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) throw profileError
    profile = profileData

    // If no profile or missing role, send to setup
    if (!profile || !profile.role) {
      goto('/setup')
      return
    }

    if (profile?.role === 'family' || profile?.role === 'admin') {
      await loadFamilyDashboard()
    } else if (profile?.role === 'nanny') {
      await loadNannyDashboard()
    }

    if (!dashChannel) {
      subscribeToShifts()
    }

    loading = false
  } catch (err) {
    initError = errorMessage(err)
    loading = false
  }
}

async function reloadDashboard() {
  if (!profile) return

  try {
    if (profile.role === 'family' || profile.role === 'admin') {
      await loadFamilyDashboard()
    } else if (profile.role === 'nanny') {
      await loadNannyDashboard()
    }
  } catch (err) {
    // Background refresh: keep showing the last good data
    console.warn('Dashboard refresh failed:', errorMessage(err))
  }
}

function scheduleReload() {
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    reloadDashboard()
  }, 300)
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible' && !loading) {
    scheduleReload()
  }
}

async function loadFamilyDashboard() {
  // Get all nannies
  const { data: nanniesData, error: nanniesError } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'nanny')
    .order('full_name')

  if (nanniesError) throw nanniesError
  nannies = nanniesData || []

  // Get active shifts (not clocked out)
  const { data: shiftsData, error: shiftsError } = await supabase
    .from('time_entries')
    .select('*')
    .is('clock_out', null)

  if (shiftsError) throw shiftsError
  activeShifts = shiftsData || []

  // This week's entries, all nannies — the stat tiles derive from these
  const bounds = getWeekBounds(0)
  const { data: weekData, error: weekError } = await supabase
    .from('time_entries')
    .select('*')
    .gte('clock_in', bounds.start.toISOString())
    .lte('clock_in', bounds.end.toISOString())

  if (weekError) throw weekError
  weekEntries = weekData || []
}

  async function loadNannyDashboard() {
    // Get nanny's active shift
    const { data: shiftData, error } = await supabase
      .from('time_entries')
      .select('*')
      .eq('nanny_id', user.id)
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error

    if (shiftData) {
      activeShifts = [shiftData]
    } else {
      activeShifts = []
    }
  }

function subscribeToShifts() {
  // Subscribe without a clock_out filter: a clock-out UPDATE removes the row
  // from the filtered set, so filtered subscriptions never deliver it.
  dashChannel = supabase
    .channel('active_shifts')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'time_entries'
    }, () => {
      scheduleReload()
    })
    .subscribe()
}
  function isNannyActive(nannyId) {
    return activeShifts.some(shift => shift.nanny_id === nannyId)
  }
  
  function getActiveShift(nannyId) {
    return activeShifts.find(shift => shift.nanny_id === nannyId)
  }
  
  /**
   * @param {string} dateString
   * @param {number} nowMs
   */
  function getTimeSince(dateString, nowMs) {
    const diff = Math.max(0, nowMs - new Date(dateString).getTime())

    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

    return `${hours}h ${minutes}m`
  }

  /**
   * @param {any} entry
   * @param {number} nowMs
   */
  function entryHours(entry, nowMs) {
    if (entry.clock_out) return parseFloat(entry.hours) || 0
    return (nowMs - new Date(entry.clock_in).getTime()) / (1000 * 60 * 60)
  }

  // Hours worked today across all nannies: completed shifts keep their value
  // after clock-out, open shifts tick up live.
  $: hoursToday = weekEntries
    .filter(e => localDateString(new Date(e.clock_in)) === localDateString(new Date(now)))
    .reduce((sum, e) => sum + entryHours(e, now), 0)
    .toFixed(1)

  // Total cost of this week's shifts (completed + in progress) at each
  // nanny's rate.
  $: weeklyTotal = weekEntries
    .reduce((sum, e) => {
      const rate = nannies.find(n => n.id === e.nanny_id)?.hourly_rate || 20
      return sum + entryHours(e, now) * rate
    }, 0)
    .toFixed(2)
</script>

<svelte:document on:visibilitychange={handleVisibilityChange} />

<Nav currentPage="dashboard" />

{#if loading}
  <div class="loading-screen">
    <div class="spinner"></div>
    <p>Loading...</p>
  </div>
{:else if initError}
  <div class="container">
    <div class="content">
      <div class="card error-card">
        <h2>Couldn't load the dashboard</h2>
        <p>{initError}</p>
        <button class="btn btn-primary" on:click={initDashboard}>Retry</button>
      </div>
    </div>
  </div>
{:else}
  <div class="container">
    <div class="content">
      <div class="welcome">
        <h1>Welcome back, {profile?.full_name || 'there'}!</h1>
        <p class="role-badge">{profile?.role}</p>
      </div>
            <!-- Add after the welcome section -->
{#if profile?.role === 'family' || profile?.role === 'admin'}
  <div class="stats-row">
    <div class="stat-card">
      <div class="stat-icon">👥</div>
      <div class="stat-value">{nannies.length}</div>
      <div class="stat-label">Total Nannies</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">🟢</div>
      <div class="stat-value">{activeShifts.length}</div>
      <div class="stat-label">Currently Active</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">⏱️</div>
      <div class="stat-value">{hoursToday}</div>
      <div class="stat-label">Hours Today</div>
    </div>
    <div class="stat-card">
    <div class="stat-icon">💰</div>
     <div class="stat-value">${weeklyTotal}</div>
      <div class="stat-label">Week Total</div>
    </div>
  </div>
{/if}
     {#if profile?.role === 'family' || profile?.role === 'admin'}
  <!-- Family/Admin View -->
  <div class="card">
    <div class="card-header">
      <h2>Nanny Status</h2>
      {#if profile?.role === 'family' || profile?.role === 'admin'}
        <button class="btn btn-primary" on:click={() => showAddNanny = true}>
          + Add Nanny
        </button>
      {/if}
    </div>
    
    {#if nannies.length === 0}
      <div class="empty-state">
        <p>No nannies added yet</p>
        <button class="btn btn-primary" on:click={() => showAddNanny = true}>
          Add Your First Nanny
        </button>
      </div>
    {:else}
      <div class="nanny-grid">
        {#each nannies as nanny}
          {@const activeShift = getActiveShift(nanny.id)}
          {@const isActive = isNannyActive(nanny.id)}
          
          <div class="nanny-status-card" class:active={isActive}>
            <div class="nanny-header">
              <h3>{nanny.full_name}</h3>
              <span class="status-indicator" class:on={isActive}>
                {isActive ? '🟢 On Clock' : '⚪ Off Clock'}
              </span>
            </div>
            
            <div class="nanny-details">
              <p><strong>Rate:</strong> ${nanny.hourly_rate}/hr</p>
              {#if nanny.venmo_username}
                <p><strong>Venmo:</strong> @{nanny.venmo_username}</p>
              {/if}
            </div>
            
            {#if isActive && activeShift}
              <div class="active-shift">
                <p><strong>Clocked in:</strong> {formatTime(activeShift.clock_in)}</p>
                <p><strong>Duration:</strong> {getTimeSince(activeShift.clock_in, now)}</p>
              </div>
            {/if}
            
            <div class="nanny-actions">
              <a href="/history?nanny={nanny.id}" class="btn-small">View History</a>
              <button class="btn-small btn-edit" on:click={() => editNanny(nanny)}>Edit</button>
              <button class="btn-small btn-delete" on:click={() => deleteNanny(nanny)}>Delete</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
        
        <div class="quick-actions">
          <h2>Quick Actions</h2>
          <div class="action-grid">
            <a href="/history" class="action-card">
              <div class="action-icon">📊</div>
              <div class="action-title">View All History</div>
              <div class="action-desc">See all time entries</div>
            </a>
            {#if profile?.role === 'admin'}
              <a href="/admin" class="action-card">
                <div class="action-icon">⚙️</div>
                <div class="action-title">Admin Dashboard</div>
                <div class="action-desc">Manage nannies</div>
              </a>
            {/if}
            <a href="/settings" class="action-card">
              <div class="action-icon">👤</div>
              <div class="action-title">Settings</div>
              <div class="action-desc">Update your profile</div>
            </a>
          </div>
        </div>
        
      {:else if profile?.role === 'nanny'}
        <!-- Nanny View -->
        <div class="card">
          <h2>Your Status</h2>
          
          {#if activeShifts.length > 0}
            {@const shift = activeShifts[0]}
            <div class="active-shift-banner">
              <div class="shift-info">
                <h3>🟢 Currently On Clock</h3>
                <p><strong>Clocked in:</strong> {formatTime(shift.clock_in)}</p>
                <p><strong>Duration:</strong> {getTimeSince(shift.clock_in, now)}</p>
              </div>
              <a href="/tracker" class="btn btn-large btn-primary">Go to Tracker</a>
            </div>
          {:else}
            <div class="inactive-shift-banner">
              <h3>⚪ Not Clocked In</h3>
              <p>Ready to start your shift?</p>
              <a href="/tracker" class="btn btn-large btn-success">Clock In</a>
            </div>
          {/if}
        </div>
        
        <div class="quick-actions">
          <h2>Quick Actions</h2>
          <div class="action-grid">
            <a href="/tracker" class="action-card">
              <div class="action-icon">⏰</div>
              <div class="action-title">Time Tracker</div>
              <div class="action-desc">Clock in/out</div>
            </a>
            <a href="/history" class="action-card">
              <div class="action-icon">📊</div>
              <div class="action-title">Your History</div>
              <div class="action-desc">View your shifts</div>
            </a>
            <a href="/settings" class="action-card">
              <div class="action-icon">👤</div>
              <div class="action-title">Settings</div>
              <div class="action-desc">Update your profile</div>
            </a>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
{#if showAddNanny}
  <div class="modal" on:click={cancelNannyForm}>
    <div class="modal-content" on:click|stopPropagation>
      <h2>{selectedNanny ? 'Edit Nanny' : 'Add New Nanny'}</h2>
      
      <form on:submit|preventDefault={saveNanny}>
        <div class="form-group">
          <label>Full Name *</label>
          <input type="text" bind:value={nannyName} required />
        </div>
        
        {#if !selectedNanny}
          <div class="form-group">
            <label>Email *</label>
            <input type="email" bind:value={nannyEmail} required />
          </div>
          
          <div class="form-group">
            <label>Password * (min 6 characters)</label>
            <input type="password" bind:value={nannyPassword} minlength="6" required />
          </div>
        {/if}
        
        <div class="form-group">
          <label>Hourly Rate ($)</label>
          <input type="number" bind:value={nannyRate} min="0" step="0.50" />
        </div>
        
        <div class="form-group">
          <label>Venmo Username</label>
          <input type="text" bind:value={nannyVenmo} placeholder="@username" />
        </div>
        
        <div class="button-row">
          <button type="submit" class="btn btn-primary">
            {selectedNanny ? 'Save Changes' : 'Create Nanny'}
          </button>
          <button type="button" class="btn btn-secondary" on:click={cancelNannyForm}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}


<style>
.loading-screen {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .spinner {
    width: 44px;
    height: 44px;
    border: 3px solid rgba(255,255,255,0.25);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .container {
    min-height: 100vh;
    background: var(--surface-page, #f0f2f8);
  }

  .content {
    max-width: 1200px;
    margin: 0 auto;
    padding: 36px 20px;
  }

  .welcome {
    margin-bottom: 32px;
  }

  .welcome h1 {
    color: var(--color-gray-900, #1a202c);
    margin-bottom: 8px;
    font-size: clamp(1.5rem, 3vw, 2rem);
    letter-spacing: -0.025em;
  }

  .role-badge {
    display: inline-block;
    padding: 4px 14px;
    background: var(--gradient-subtle, rgba(102, 126, 234, 0.1));
    color: var(--color-primary, #667eea);
    border-radius: 20px;
    font-size: 0.85em;
    font-weight: 600;
    text-transform: capitalize;
    border: 1px solid rgba(102, 126, 234, 0.15);
  }

  .card {
    background: var(--surface-card, white);
    border-radius: 1rem;
    padding: 28px;
    margin-bottom: 24px;
    box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.07));
    border: 1px solid rgba(0, 0, 0, 0.04);
  }

  h2 {
    margin: 0 0 20px 0;
    color: var(--color-gray-800, #2d3748);
    padding-bottom: 12px;
    border-bottom: 1px solid var(--color-gray-200, #e2e8f0);
    font-size: 1.2em;
    letter-spacing: -0.015em;
  }

  .empty-state {
    text-align: center;
    padding: 48px 20px;
    color: var(--color-gray-500, #718096);
  }

  .nanny-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
  }

  .nanny-status-card {
    background: var(--surface-card, white);
    padding: 20px;
    border-radius: 12px;
    border: 1.5px solid var(--color-gray-200, #e2e8f0);
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    position: relative;
  }

  .nanny-status-card:hover {
    box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.08));
    transform: translateY(-1px);
  }

  .nanny-status-card.active {
    border-color: rgba(72, 187, 120, 0.4);
    background: linear-gradient(to bottom, #f0fff4, #ffffff);
    box-shadow: 0 4px 16px rgba(72, 187, 120, 0.12);
  }

  .nanny-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }

  .nanny-header h3 {
    margin: 0;
    color: var(--color-gray-800, #2d3748);
    font-size: 1.05em;
  }

  .status-indicator {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 0.8em;
    font-weight: 600;
    background: var(--surface-sunken, #eef1f8);
    color: var(--color-gray-500, #718096);
  }

  .status-indicator.on {
    background: linear-gradient(135deg, #48bb78, #38a169);
    color: white;
    box-shadow: 0 2px 8px rgba(72, 187, 120, 0.3);
    animation: subtlePulse 2.5s ease-in-out infinite;
  }

  @keyframes subtlePulse {
    0%, 100% { box-shadow: 0 2px 8px rgba(72, 187, 120, 0.3); }
    50% { box-shadow: 0 2px 12px rgba(72, 187, 120, 0.5); }
  }

  .nanny-details {
    margin-bottom: 14px;
    color: var(--color-gray-700, #4a5568);
    font-size: 0.9em;
  }

  .nanny-details p {
    margin: 4px 0;
  }

  .active-shift {
    background: var(--surface-sunken, #eef1f8);
    padding: 10px 12px;
    border-radius: 8px;
    margin-bottom: 14px;
    border-left: 3px solid #48bb78;
  }

  .active-shift p {
    margin: 4px 0;
    color: var(--color-gray-800, #2d3748);
    font-size: 0.9em;
  }

  .nanny-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .btn-small {
    padding: 6px 14px;
    background: var(--surface-card, white);
    color: var(--color-primary, #667eea);
    border: 1.5px solid var(--color-gray-200, #e2e8f0);
    border-radius: 8px;
    text-decoration: none;
    font-weight: 500;
    font-size: 0.85em;
    transition: all 0.2s;
  }

  .btn-small:hover {
    border-color: var(--color-primary, #667eea);
    background: rgba(102, 126, 234, 0.04);
  }

  .active-shift-banner, .inactive-shift-banner {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 32px;
    border-radius: 14px;
    text-align: center;
    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.25);
  }

  .inactive-shift-banner {
    background: linear-gradient(135deg, #64748b 0%, #475569 100%);
    box-shadow: 0 8px 24px rgba(71, 85, 105, 0.2);
  }

  .shift-info h3, .inactive-shift-banner h3 {
    margin: 0 0 14px 0;
    font-size: 1.4em;
    letter-spacing: -0.02em;
  }

  .shift-info p {
    margin: 4px 0;
    opacity: 0.9;
  }

  .btn {
    padding: 12px 24px;
    border: none;
    border-radius: 10px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
    margin-top: 20px;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .btn-large {
    padding: 14px 32px;
    font-size: 1.05em;
  }

  .btn-primary {
    background: white;
    color: var(--color-primary, #667eea);
  }

  .btn-primary:hover {
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    transform: translateY(-1px);
  }

  .btn-success {
    background: #48bb78;
    color: white;
  }

  .quick-actions {
    margin-top: 28px;
  }

  .quick-actions h2 {
    border-bottom: none;
    padding-bottom: 0;
    margin-bottom: 16px;
    font-size: 1.15em;
  }

  .action-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 14px;
    margin-top: 0;
  }

  .action-card {
    background: var(--surface-card, white);
    padding: 24px 18px;
    border-radius: 12px;
    text-align: center;
    text-decoration: none;
    border: 1.5px solid var(--color-gray-200, #e2e8f0);
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .action-card:hover {
    border-color: var(--color-primary, #667eea);
    transform: translateY(-3px);
    box-shadow: var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.08));
  }

  .action-icon {
    font-size: 2.5em;
    margin-bottom: 8px;
  }

  .action-title {
    font-size: 1em;
    font-weight: 600;
    color: var(--color-gray-800, #2d3748);
    margin-bottom: 4px;
  }

  .action-desc {
    font-size: 0.85em;
    color: var(--color-gray-500, #718096);
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  .card-header h2 {
    margin: 0;
    padding: 0;
    border: none;
  }

  .btn-edit {
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 8px;
  }

  .btn-delete {
    background: transparent;
    color: #ef4444;
    border: 1.5px solid #fecaca;
  }

  .btn-delete:hover {
    background: #fef2f2;
  }

  .modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.45);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal-content {
    background: white;
    padding: 30px;
    border-radius: 1.125rem;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: var(--shadow-xl, 0 20px 40px rgba(0,0,0,0.15));
    animation: modalSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes modalSlideUp {
    from { opacity: 0; transform: translateY(10px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .form-group {
    margin-bottom: 18px;
  }

  .form-group label {
    display: block;
    margin-bottom: 6px;
    color: var(--color-gray-700, #4a5568);
    font-weight: 500;
    font-size: 0.9em;
  }

  .form-group input {
    width: 100%;
    padding: 11px 14px;
    border: 1.5px solid var(--color-gray-200, #e2e8f0);
    border-radius: 10px;
    font-size: 1em;
    background: var(--color-gray-50, #f7fafc);
    transition: all 0.2s;
  }

  .form-group input:focus {
    outline: none;
    border-color: var(--color-primary, #667eea);
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
    background: white;
  }

  .button-row {
    display: flex;
    gap: 10px;
  }

  .button-row .btn {
    flex: 1;
  }

  .btn-secondary {
    background: var(--surface-card, white);
    color: var(--color-primary, #667eea);
    border: 1.5px solid var(--color-gray-200, #e2e8f0);
  }

  /* ── Stat Cards ── */
  .stats-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 14px;
    margin-bottom: 24px;
  }

  .stat-card {
    background: var(--surface-card, white);
    border-radius: 14px;
    padding: 20px 16px;
    box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.06));
    border: 1px solid rgba(0, 0, 0, 0.04);
    text-align: center;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .stat-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.08));
  }

  .stat-icon {
    font-size: 1.5em;
    margin-bottom: 8px;
    opacity: 0.9;
  }

  .stat-value {
    font-size: 1.75em;
    font-weight: 700;
    color: var(--color-gray-900, #1a202c);
    margin-bottom: 4px;
    letter-spacing: -0.02em;
  }

  .stat-label {
    color: var(--color-gray-500, #718096);
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 500;
  }

  @media (max-width: 768px) {
    .stat-card {
      padding: 16px 12px;
    }

    .stat-icon {
      font-size: 1.3em;
    }

    .stat-value {
      font-size: 1.5em;
    }

    .content {
      padding: 24px 16px;
    }
  }

  .error-card {
    text-align: center;
    padding: 40px 30px;
  }

  .error-card p {
    color: #718096;
    margin: 10px 0 20px;
  }
</style>
