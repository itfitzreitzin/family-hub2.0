<!-- src/routes/dashboard/+page.svelte -->
<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import Nav from '$lib/Nav.svelte'
  
  let user = null
  let profile = null
  let loading = true
  let nannies = []
  let activeShifts = []
  let showAddNanny = false
  let selectedNanny = null
  let nannyEmail = ''
  let nannyName = ''
  let nannyRate = 20
  let nannyVenmo = ''
  let nannyPassword = ''
  let isMobile = false
  
  onMount(async () => {
    checkMobile()
    window.addEventListener('resize', checkMobile)
    
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    
    if (!currentUser) {
      window.location.href = '/'
      return
    }
    
    user = currentUser
    
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    
    profile = profileData

    if (!profile || !profile.role) {
      window.location.href = '/setup'
      return
    }
    
    if (profile?.role === 'family' || profile?.role === 'admin') {
      await loadFamilyDashboard()
    } else if (profile?.role === 'nanny') {
      await loadNannyDashboard()
    }
    
    loading = false
    
    return () => {
      window.removeEventListener('resize', checkMobile)
    }
  })
  
  function checkMobile() {
    isMobile = window.innerWidth < 768
  }
  
  async function loadFamilyDashboard() {
    const { data: nanniesData } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'nanny')
      .order('full_name')
    
    nannies = nanniesData || []
    
    const { data: shiftsData } = await supabase
      .from('time_entries')
      .select('*')
      .is('clock_out', null)
    
    activeShifts = shiftsData || []
  }
  
  async function loadNannyDashboard() {
    const { data: shiftData } = await supabase
      .from('time_entries')
      .select('*')
      .eq('nanny_id', user.id)
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .limit(1)
      .single()
    
    if (shiftData) {
      activeShifts = [shiftData]
    }
  }
  
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
      alert('Name is required')
      return
    }
    
    try {
      if (selectedNanny) {
        const { error } = await supabase
          .from('profiles')
          .update({
            full_name: nannyName,
            hourly_rate: nannyRate,
            venmo_username: nannyVenmo
          })
          .eq('id', selectedNanny.id)
        
        if (error) throw error
        
        alert('Nanny updated!')
      } else {
        if (!nannyEmail || !nannyPassword) {
          alert('Email and password required for new nanny')
          return
        }
        
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: nannyEmail,
          password: nannyPassword
        })
        
        if (authError) throw authError
        
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
        
        alert('Nanny created! They can log in with: ' + nannyEmail)
      }
      
      cancelNannyForm()
      await loadFamilyDashboard()
    } catch (err) {
      alert('Error: ' + err.message)
    }
  }
  
  async function deleteNanny(nanny) {
    if (!confirm(`Delete ${nanny.full_name}? This will also delete all their time entries.`)) {
      return
    }
    
    try {
      await supabase
        .from('time_entries')
        .delete()
        .eq('nanny_id', nanny.id)
      
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', nanny.id)
      
      if (error) throw error
      
      alert('Nanny deleted')
      await loadFamilyDashboard()
    } catch (err) {
      alert('Error deleting: ' + err.message)
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
  
  function isNannyActive(nannyId) {
    return activeShifts.some(shift => shift.nanny_id === nannyId)
  }
  
  function getActiveShift(nannyId) {
    return activeShifts.find(shift => shift.nanny_id === nannyId)
  }
  
  function formatTime(dateString) {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  function getTimeSince(dateString) {
    const start = new Date(dateString)
    const now = new Date()
    const diff = now - start
    
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    
    return `${hours}h ${minutes}m`
  }
</script>

<Nav currentPage="dashboard" />

{#if loading}
  <div class="loading-screen">
    <div class="spinner"></div>
    <p>Loading...</p>
  </div>
{:else}
  <div class="container" class:mobile-container={isMobile}>
    <div class="content">
      <!-- Welcome Section -->
      <div class="welcome" class:mobile-welcome={isMobile}>
        <h1>{isMobile ? 'Welcome!' : `Welcome back, ${profile?.full_name || 'there'}!`}</h1>
        <p class="role-badge">{profile?.role}</p>
      </div>
      
      {#if profile?.role === 'family' || profile?.role === 'admin'}
        <!-- Family/Admin Desktop View -->
        {#if !isMobile}
          <div class="card">
            <div class="card-header">
              <h2>Nanny Status</h2>
              <button class="btn btn-primary" on:click={() => showAddNanny = true}>
                + Add Nanny
              </button>
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
                        <p><strong>Duration:</strong> {getTimeSince(activeShift.clock_in)}</p>
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
        
        <!-- Family/Admin Mobile View -->
        {:else}
          <div class="mobile-section">
            <div class="section-header">
              <h2>Your Nannies</h2>
              <button class="mobile-add-btn" on:click={() => showAddNanny = true}>
                +
              </button>
            </div>
            
            {#if nannies.length === 0}
              <div class="mobile-empty-state">
                <p>No nannies yet</p>
                <button class="btn btn-primary btn-full" on:click={() => showAddNanny = true}>
                  Add First Nanny
                </button>
              </div>
            {:else}
              <div class="mobile-nanny-list">
                {#each nannies as nanny}
                  {@const activeShift = getActiveShift(nanny.id)}
                  {@const isActive = isNannyActive(nanny.id)}
                  
                  <div class="mobile-nanny-card" class:active={isActive}>
                    <div class="mobile-nanny-main">
                      <div class="mobile-nanny-info">
                        <h3>{nanny.full_name}</h3>
                        <p class="rate">${nanny.hourly_rate}/hr</p>
                      </div>
                      <div class="mobile-status" class:active={isActive}>
                        {isActive ? 'ON' : 'OFF'}
                      </div>
                    </div>
                    
                    {#if isActive && activeShift}
                      <div class="mobile-shift-info">
                        <span>Started: {formatTime(activeShift.clock_in)}</span>
                        <span>{getTimeSince(activeShift.clock_in)}</span>
                      </div>
                    {/if}
                    
                    <div class="mobile-nanny-actions">
                      <a href="/history?nanny={nanny.id}" class="mobile-action-btn">History</a>
                      <button class="mobile-action-btn" on:click={() => editNanny(nanny)}>Edit</button>
                      <button class="mobile-action-btn danger" on:click={() => deleteNanny(nanny)}>Delete</button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        
        <!-- Quick Actions Desktop -->
        {#if !isMobile}
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
        {/if}
        
      {:else if profile?.role === 'nanny'}
        <!-- Nanny Desktop View -->
        {#if !isMobile}
          <div class="card">
            <h2>Your Status</h2>
            
            {#if activeShifts.length > 0}
              {@const shift = activeShifts[0]}
              <div class="active-shift-banner">
                <div class="shift-info">
                  <h3>🟢 Currently On Clock</h3>
                  <p><strong>Clocked in:</strong> {formatTime(shift.clock_in)}</p>
                  <p><strong>Duration:</strong> {getTimeSince(shift.clock_in)}</p>
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
        
        <!-- Nanny Mobile View -->
        {:else}
          <div class="mobile-nanny-status">
            {#if activeShifts.length > 0}
              {@const shift = activeShifts[0]}
              <div class="mobile-status-card active">
                <div class="status-icon">🟢</div>
                <h3>Currently Working</h3>
                <p>Since {formatTime(shift.clock_in)}</p>
                <div class="duration-display">{getTimeSince(shift.clock_in)}</div>
                <a href="/tracker" class="btn btn-full btn-primary">View Tracker</a>
              </div>
            {:else}
              <div class="mobile-status-card">
                <div class="status-icon">⚪</div>
                <h3>Off Clock</h3>
                <p>Ready to work?</p>
                <a href="/tracker" class="btn btn-full btn-success">Clock In Now</a>
              </div>
            {/if}
          </div>
        {/if}
        
        <!-- Quick Actions for Nannies -->
        {#if !isMobile}
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
      {/if}
      
      <!-- Mobile Quick Actions Grid -->
      {#if isMobile}
        <div class="mobile-actions">
          <a href="/tracker" class="mobile-action-card">
            <span class="icon">⏰</span>
            <span>Tracker</span>
          </a>
          <a href="/history" class="mobile-action-card">
            <span class="icon">📊</span>
            <span>History</span>
          </a>
          {#if profile?.role === 'family' || profile?.role === 'admin'}
            <a href="/schedule" class="mobile-action-card">
              <span class="icon">📅</span>
              <span>Schedule</span>
            </a>
          {/if}
          <a href="/settings" class="mobile-action-card">
            <span class="icon">⚙️</span>
            <span>Settings</span>
          </a>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Add/Edit Nanny Modal -->
{#if showAddNanny}
  <div class="modal" class:mobile-modal={isMobile} on:click={cancelNannyForm}>
    <div class="modal-content" class:mobile-modal-content={isMobile} on:click|stopPropagation>
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
        
        <div class="button-row" class:mobile-button-row={isMobile}>
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
  /* Loading Screen */
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
    width: 50px;
    height: 50px;
    border: 4px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  /* Container */
  .container {
    min-height: 100vh;
    background: #f7fafc;
  }
  
  .mobile-container {
    padding-top: 60px;
    padding-bottom: 80px;
  }
  
  .content {
    max-width: 1200px;
    margin: 0 auto;
    padding: 40px 20px;
  }
  
  .mobile-container .content {
    padding: 20px 16px;
  }
  
  /* Welcome Section */
  .welcome {
    margin-bottom: 40px;
  }
  
  .mobile-welcome {
    margin-bottom: 20px;
  }
  
  .welcome h1 {
    color: #2d3748;
    margin-bottom: 10px;
  }
  
  .mobile-welcome h1 {
    font-size: 1.5em;
  }
  
  .role-badge {
    display: inline-block;
    padding: 5px 15px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 20px;
    font-size: 0.9em;
    font-weight: 600;
    text-transform: capitalize;
  }
  
  /* Desktop Card */
  .card {
    background: white;
    border-radius: 15px;
    padding: 30px;
    margin-bottom: 30px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
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
  
  h2 {
    margin: 0 0 20px 0;
    color: #2d3748;
    padding-bottom: 10px;
    border-bottom: 2px solid #e2e8f0;
  }
  
  /* Mobile Section */
  .mobile-section {
    background: white;
    border-radius: 12px;
    padding: 20px 16px;
    margin-bottom: 20px;
  }
  
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  
  .section-header h2 {
    font-size: 1.2em;
    margin: 0;
    padding: 0;
    border: none;
  }
  
  .mobile-add-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    font-size: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  
  /* Empty States */
  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: #718096;
  }
  
  .mobile-empty-state {
    text-align: center;
    padding: 30px 10px;
    color: #718096;
  }
  
  /* Desktop Nanny Grid */
  .nanny-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
  }
  
  .nanny-status-card {
    background: #f7fafc;
    padding: 20px;
    border-radius: 10px;
    border: 2px solid #e2e8f0;
    transition: all 0.3s;
  }
  
  .nanny-status-card.active {
    border-color: #48bb78;
    background: #f0fff4;
  }
  
  .nanny-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
  }
  
  .nanny-header h3 {
    margin: 0;
    color: #2d3748;
  }
  
  .status-indicator {
    font-size: 0.85em;
    padding: 4px 12px;
    border-radius: 12px;
    background: #e2e8f0;
    color: #4a5568;
    font-weight: 600;
  }
  
  .status-indicator.on {
    background: #c6f6d5;
    color: #22543d;
  }
  
  .nanny-details {
    margin-bottom: 15px;
    color: #4a5568;
  }
  
  .nanny-details p {
    margin: 5px 0;
  }
  
  .active-shift {
    background: white;
    padding: 10px;
    border-radius: 8px;
    margin-bottom: 15px;
    border-left: 3px solid #48bb78;
  }
  
  .active-shift p {
    margin: 5px 0;
    color: #2d3748;
  }
  
  .nanny-actions {
    display: flex;
    gap: 10px;
  }
  
  /* Mobile Nanny List */
  .mobile-nanny-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .mobile-nanny-card {
    background: #f7fafc;
    border-radius: 10px;
    padding: 16px;
    border: 2px solid #e2e8f0;
  }
  
  .mobile-nanny-card.active {
    border-color: #48bb78;
    background: #f0fff4;
  }
  
  .mobile-nanny-main {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  
  .mobile-nanny-info h3 {
    margin: 0 0 4px 0;
    color: #2d3748;
    font-size: 1.1em;
  }
  
  .mobile-nanny-info .rate {
    color: #667eea;
    font-weight: 600;
  }
  
  .mobile-status {
    padding: 6px 12px;
    border-radius: 20px;
    background: #e2e8f0;
    color: #718096;
    font-weight: 700;
    font-size: 0.85em;
  }
  
  .mobile-status.active {
    background: #48bb78;
    color: white;
  }
  
  .mobile-shift-info {
    display: flex;
    justify-content: space-between;
    padding: 10px;
    background: white;
    border-radius: 6px;
    margin-bottom: 12px;
    font-size: 0.9em;
    color: #4a5568;
  }
  
  .mobile-nanny-actions {
    display: flex;
    gap: 8px;
  }
  
  .mobile-action-btn {
    flex: 1;
    padding: 10px;
    background: white;
    color: #667eea;
    border: 1px solid #667eea;
    border-radius: 6px;
    text-align: center;
    font-weight: 600;
    font-size: 0.9em;
    text-decoration: none;
    cursor: pointer;
  }
  
  .mobile-action-btn.danger {
    color: #f56565;
    border-color: #f56565;
  }
  
  /* Mobile Nanny Status */
  .mobile-nanny-status {
    margin-bottom: 20px;
  }
  
  .mobile-status-card {
    background: white;
    border-radius: 12px;
    padding: 24px;
    text-align: center;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  }
  
  .mobile-status-card.active {
    background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
    color: white;
  }
  
  .status-icon {
    font-size: 3em;
    margin-bottom: 12px;
  }
  
  .mobile-status-card h3 {
    margin: 0 0 8px 0;
  }
  
  .mobile-status-card p {
    margin: 0 0 16px 0;
    opacity: 0.9;
  }
  
  .duration-display {
    font-size: 2em;
    font-weight: bold;
    margin: 16px 0;
  }
  
  /* Buttons */
  .btn {
    padding: 12px 24px;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
  }
  
  .btn-full {
    width: 100%;
    display: block;
    text-align: center;
  }
  
  .btn-large {
    padding: 16px 32px;
    font-size: 1.1em;
  }
  
  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }
  
  .btn-success {
    background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
    color: white;
  }
  
  .btn-secondary {
    background: white;
    color: #667eea;
    border: 2px solid #667eea;
  }
  
  .btn-small {
    padding: 8px 16px;
    background: white;
    color: #667eea;
    border: 2px solid #667eea;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    font-size: 0.9em;
    transition: all 0.2s;
    cursor: pointer;
  }
  
  .btn-edit {
    background: #4299e1;
    color: white;
    border: none;
  }
  
  .btn-delete {
    background: #f56565;
    color: white;
    border: none;
  }
  
  /* Desktop Quick Actions */
  .quick-actions {
    margin-top: 30px;
  }
  
  .action-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 20px;
    margin-top: 20px;
  }
  
  .action-card {
    background: white;
    padding: 30px 20px;
    border-radius: 10px;
    text-align: center;
    text-decoration: none;
    border: 2px solid #e2e8f0;
    transition: all 0.3s;
  }
  
  .action-card:hover {
    border-color: #667eea;
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(0,0,0,0.1);
  }
  
  .action-icon {
    font-size: 3em;
    margin-bottom: 10px;
  }
  
  .action-title {
    font-size: 1.1em;
    font-weight: 600;
    color: #2d3748;
    margin-bottom: 5px;
  }
  
  .action-desc {
    font-size: 0.9em;
    color: #718096;
  }
  
  /* Mobile Actions Grid */
  .mobile-actions {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-top: 20px;
  }
  
  .mobile-action-card {
    background: white;
    padding: 20px;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: #4a5568;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    transition: all 0.2s;
  }
  
  .mobile-action-card:active {
    transform: scale(0.95);
    box-shadow: 0 1px 4px rgba(0,0,0,0.1);
  }
  
  .mobile-action-card .icon {
    font-size: 2em;
  }
  
  .mobile-action-card span:last-child {
    font-weight: 600;
    font-size: 0.9em;
  }
  
  /* Active/Inactive Shift Banners */
  .active-shift-banner, .inactive-shift-banner {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 30px;
    border-radius: 10px;
    text-align: center;
  }
  
  .inactive-shift-banner {
    background: linear-gradient(135deg, #718096 0%, #4a5568 100%);
  }
  
  .shift-info h3, .inactive-shift-banner h3 {
    margin: 0 0 15px 0;
    font-size: 1.5em;
  }
  
  .shift-info p {
    margin: 5px 0;
  }
  
  /* Modal */
  .modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  }
  
  .modal-content {
    background: white;
    padding: 30px;
    border-radius: 15px;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
  }
  
  .mobile-modal-content {
    padding: 20px;
    border-radius: 12px 12px 0 0;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    max-width: 100%;
    width: 100%;
    max-height: 70vh;
  }
  
  .form-group {
    margin-bottom: 20px;
  }
  
  .form-group label {
    display: block;
    margin-bottom: 8px;
    color: #4a5568;
    font-weight: 500;
  }
  
  .form-group input {
    width: 100%;
    padding: 12px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-size: 1em;
  }
  
  .button-row {
    display: flex;
    gap: 10px;
  }
  
  .mobile-button-row {
    flex-direction: column;
  }
  
  .button-row .btn {
    flex: 1;
  }
</style>