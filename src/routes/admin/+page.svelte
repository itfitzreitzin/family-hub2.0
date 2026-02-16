<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import { goto } from '$app/navigation'
  import { toast, confirm as confirmModal } from '$lib/stores/toast.js'
  import Nav from '$lib/Nav.svelte'
  
  let user = null
  let profile = null
  let loading = true
  let nannies = []
  let selectedNanny = null
  let showAddNanny = false
  
  // Add/Edit nanny form
  let nannyEmail = ''
  let nannyName = ''
  let nannyRate = 20
  let nannyVenmo = ''
  let nannyPassword = ''
  
  onMount(async () => {
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    
    if (!currentUser) {
      goto('/')
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

    // Only admin can access this page
    if (profile?.role !== 'admin') {
      toast.error('Access denied. Admin only.')
      goto('/dashboard')
      return
    }
    
    await loadNannies()
    loading = false
  })
  
  async function loadNannies() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'nanny')
      .order('full_name')
    
    nannies = data || []
  }
  
  function editNanny(nanny) {
    selectedNanny = nanny
    nannyName = nanny.full_name
    nannyRate = nanny.hourly_rate
    nannyVenmo = nanny.venmo_username || ''
    nannyEmail = '' // Can't change email easily
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
        // Create new nanny - need to create auth user first
        if (!nannyEmail || !nannyPassword) {
          toast.error('Email and password required for new nanny')
          return
        }
        
        // Note: In production, you'd want to do this via an admin API
        // For now, this creates an account that needs email confirmation
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
      await loadNannies()
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
      await loadNannies()
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
  
  async function viewNannyHistory(nanny) {
    // Redirect to history page with filter (we'll add this feature next)
    goto(`/history?nanny=${nanny.id}`)
  }
</script>

<Nav currentPage="dashboard" />

{#if loading}
  <div class="loading">Loading...</div>
{:else}
  <div class="container">
    <div class="header-bar">
      <h1>Admin Dashboard</h1>
      <button class="btn btn-primary" on:click={() => showAddNanny = true}>
        + Add Nanny
      </button>
    </div>
    
    <div class="card">
      <h2>Manage Nannies ({nannies.length})</h2>
      
      {#if nannies.length === 0}
        <div class="empty-state">
          <p>No nannies yet. Click "Add Nanny" to get started.</p>
        </div>
      {:else}
        <div class="nanny-grid">
          {#each nannies as nanny}
            <div class="nanny-card">
              <div class="nanny-info">
                <h3>{nanny.full_name}</h3>
                <p class="rate">${nanny.hourly_rate}/hour</p>
                {#if nanny.venmo_username}
                  <p class="venmo">Venmo: @{nanny.venmo_username}</p>
                {/if}
              </div>
              <div class="nanny-actions">
                <button class="btn-small btn-secondary" on:click={() => viewNannyHistory(nanny)}>
                  View History
                </button>
                <button class="btn-small btn-primary" on:click={() => editNanny(nanny)}>
                  Edit
                </button>
                <button class="btn-small btn-danger" on:click={() => deleteNanny(nanny)}>
                  Delete
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
  
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
{/if}

<style>
  .container {
    min-height: 100vh;
    background: var(--surface-page, #f0f2f8);
    padding: 40px 20px;
    max-width: 1200px;
    margin: 0 auto;
  }
  
  .header-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 30px;
    flex-wrap: wrap;
    gap: 20px;
  }
  
  h1 {
    color: #2d3748;
    margin: 0;
  }
  
  .card {
    background: white;
    border-radius: 1rem;
    padding: 30px;
    box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.07));
    border: 1px solid rgba(0, 0, 0, 0.04);
  }
  
  h2 {
    margin: 0 0 20px 0;
    color: var(--color-gray-800, #2d3748);
    padding-bottom: 10px;
    border-bottom: 1px solid var(--color-gray-200, #e2e8f0);
  }
  
  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: #718096;
  }
  
  .nanny-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
  }
  
  .nanny-card {
    background: var(--surface-sunken, #eef1f8);
    padding: 20px;
    border-radius: 12px;
    border: 1.5px solid var(--color-gray-200, #e2e8f0);
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .nanny-card:hover {
    box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.08));
    transform: translateY(-1px);
  }
  
  .nanny-info h3 {
    margin: 0 0 10px 0;
    color: #2d3748;
  }
  
  .rate {
    font-size: 1.2em;
    font-weight: bold;
    color: var(--color-primary, #667eea);
    margin: 5px 0;
  }
  
  .venmo {
    color: #718096;
    font-size: 0.9em;
    margin: 5px 0;
  }
  
  .nanny-actions {
    display: flex;
    gap: 8px;
    margin-top: 15px;
    flex-wrap: wrap;
  }
  
  .btn, .btn-small {
    padding: 12px 24px;
    border: none;
    border-radius: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .btn-small {
    padding: 8px 16px;
    font-size: 0.9em;
  }
  
  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }
  
  .btn-secondary {
    background: white;
    color: #667eea;
    border: 2px solid #667eea;
  }
  
  .btn-danger {
    background: #f56565;
    color: white;
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
  }
  
  .form-group {
    margin-bottom: 20px;
  }
  
  label {
    display: block;
    margin-bottom: 8px;
    color: #4a5568;
    font-weight: 500;
  }
  
  input {
    width: 100%;
    padding: 12px;
    border: 1.5px solid var(--color-gray-200, #e2e8f0);
    border-radius: 10px;
    font-size: 1em;
  }
  
  .button-row {
    display: flex;
    gap: 10px;
  }
  
  .button-row .btn {
    flex: 1;
  }
  
  .loading {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-page, #f0f2f8);
    color: #718096;
  }
</style>