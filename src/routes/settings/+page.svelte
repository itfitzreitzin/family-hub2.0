<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import Nav from '$lib/Nav.svelte'
  
  let user = null
  let profile = null
  let loading = true
  let saving = false
  
  // Form fields
  let fullName = ''
  let hourlyRate = 20
  let venmoUsername = ''
  let role = 'nanny'
  
  onMount(async () => {
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

    // Populate form
    if (profile) {
      fullName = profile.full_name || ''
      hourlyRate = profile.hourly_rate || 20
      venmoUsername = profile.venmo_username || ''
      role = profile.role || 'nanny'
    }
    
    loading = false
  })
  
  async function saveSettings() {
    saving = true
    
    try {
      const updateData = {
        full_name: fullName
      }
      
      // Only update these fields for nannies or admins
      if (profile?.role === 'nanny' || profile?.role === 'admin') {
        updateData.hourly_rate = hourlyRate
        updateData.venmo_username = venmoUsername
      }
      
      // Only admin can change role
      if (profile?.role === 'admin') {
        updateData.role = role
      }
      
      const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', user.id)
      
      if (error) throw error
      
      alert('Settings saved successfully!')
      
      // Reload profile
      const { data: updatedProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()
      
      profile = updatedProfile
    } catch (err) {
      alert('Error saving settings: ' + err.message)
    } finally {
      saving = false
    }
  }
  
  async function changePassword() {
    const newPassword = prompt('Enter your new password (min 6 characters):')
    
    if (!newPassword || newPassword.length < 6) {
      alert('Password must be at least 6 characters')
      return
    }
    
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })
      
      if (error) throw error
      
      alert('Password changed successfully!')
    } catch (err) {
      alert('Error changing password: ' + err.message)
    }
  }
</script>

<Nav currentPage="settings" />

{#if loading}
  <div class="loading">Loading...</div>
{:else}
  <div class="container">
    <div class="card">
      <h2>Profile Settings</h2>
      
      <div class="info-box">
        <strong>Email:</strong> {user.email}
        <br>
        <strong>Role:</strong> {profile?.role}
        {#if profile?.role === 'admin'}
          <span class="admin-badge">ADMIN</span>
        {/if}
      </div>
      
      <form on:submit|preventDefault={saveSettings}>
        <div class="form-group">
          <label for="fullName">Full Name</label>
          <input
            id="fullName"
            type="text"
            bind:value={fullName}
            placeholder="Your full name"
            required
          />
        </div>
        
        {#if profile?.role === 'admin'}
          <div class="form-group">
            <label for="role">Role</label>
            <select id="role" bind:value={role}>
              <option value="nanny">Nanny</option>
              <option value="family">Family</option>
              <option value="admin">Admin</option>
            </select>
            <small>Admin can change their own role</small>
          </div>
        {/if}
        
        {#if profile?.role === 'nanny' || profile?.role === 'admin'}
          <div class="form-group">
            <label for="hourlyRate">Hourly Rate ($)</label>
            <input
              id="hourlyRate"
              type="number"
              bind:value={hourlyRate}
              min="0"
              step="0.50"
              required
            />
            {#if profile?.role === 'admin'}
              <small>Your personal rate (for testing)</small>
            {/if}
          </div>
          
          <div class="form-group">
            <label for="venmo">Venmo Username</label>
            <input
              id="venmo"
              type="text"
              bind:value={venmoUsername}
              placeholder="@username"
            />
            <small>Used for payment generation</small>
          </div>
        {/if}
        
        <button type="submit" class="btn btn-primary" disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
    
    <div class="card">
      <h2>Security</h2>
      
      <button class="btn btn-secondary" on:click={changePassword}>
        Change Password
      </button>
    </div>
    
    <div class="card">
      <h2>About</h2>
      <p>Family Hub - Nanny Time Tracker</p>
      <p style="color: #718096; font-size: 0.9em;">Version 1.0.0</p>
    </div>
  </div>
{/if}

<style>
  .container {
    min-height: 100vh;
    background: #f7fafc;
    padding: 40px 20px;
  }
  
  .card {
    max-width: 600px;
    margin: 0 auto 30px;
    background: white;
    border-radius: 15px;
    padding: 30px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  }
  
  h2 {
    margin: 0 0 20px 0;
    color: #2d3748;
    padding-bottom: 10px;
    border-bottom: 2px solid #e2e8f0;
  }
  
  .info-box {
    background: #f7fafc;
    padding: clamp(1rem, 3vw, 1.5rem);
    border-radius: 0.75rem;
    margin-bottom: 2rem;
    color: #4a5568;
    line-height: 1.7;
  }
  
  .admin-badge {
    display: inline-block;
    margin-left: 10px;
    padding: 2px 10px;
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    color: white;
    border-radius: 12px;
    font-size: 0.8em;
    font-weight: bold;
  }
  
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  label {
    color: #4a5568;
    font-weight: 500;
  }

  input, select {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid #e2e8f0;
    border-radius: 0.75rem;
    font-size: 1rem;
  }

  input:focus, select:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
  }
  
  small {
    display: block;
    margin-top: 5px;
    color: #718096;
    font-size: 0.85em;
  }
  
  .btn {
    padding: clamp(0.75rem, 3vw, 1rem) clamp(1.5rem, 4vw, 2rem);
    border: none;
    border-radius: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .btn-primary {
    width: 100%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    font-size: clamp(1rem, 2vw, 1.15rem);
  }
  
  .btn-primary:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
  }
  
  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: white;
    color: #667eea;
    border: 2px solid #667eea;
  }

  .btn-secondary:hover {
    background: #f7fafc;
  }

  .loading {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f7fafc;
    color: #718096;
  }
</style>
