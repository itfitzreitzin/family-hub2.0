<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  
  let user = null
  let fullName = ''
  let role = ''
  let hourlyRate = 20
  let venmoUsername = ''
  let loading = false
  
  onMount(async () => {
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    
    if (!currentUser) {
      window.location.href = '/'
      return
    }
    
    user = currentUser
    
    // Pre-fill email as name suggestion
    fullName = currentUser.email.split('@')[0]
  })
  
  async function completeSetup() {
    if (!role) {
      alert('Please select your role')
      return
    }
    
    if (!fullName) {
      alert('Please enter your name')
      return
    }
    
    loading = true
    
    try {
      const { error } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          role,
          full_name: fullName,
          hourly_rate: role === 'nanny' ? hourlyRate : null,
          venmo_username: role === 'nanny' ? venmoUsername : null
        })
      
      if (error) throw error
      
      // Redirect to dashboard
      window.location.href = '/dashboard'
    } catch (err) {
      alert('Error: ' + err.message)
      loading = false
    }
  }
</script>

<div class="container">
  <div class="card">
    <h1>👶 Welcome to Family Hub!</h1>
    <h2>Let's get you set up</h2>
    
    <div class="role-selection">
      <p style="margin-bottom: 20px; color: #4a5568;">Who are you?</p>
      
      <label class="role-card" class:selected={role === 'family'}>
        <input type="radio" bind:group={role} value="family" />
        <div class="role-content">
          <div class="role-icon">👨‍👩‍👧</div>
          <div class="role-name">Family Member</div>
          <div class="role-desc">Parents, manage schedules & payments</div>
        </div>
      </label>
      
      <label class="role-card" class:selected={role === 'nanny'}>
        <input type="radio" bind:group={role} value="nanny" />
        <div class="role-content">
          <div class="role-icon">👶</div>
          <div class="role-name">Nanny / Caregiver</div>
          <div class="role-desc">Track hours and view payments</div>
        </div>
      </label>
    </div>
    
    {#if role}
      <div class="details-form">
        <div class="input-group">
          <label for="name">Full Name</label>
          <input
            id="name"
            type="text"
            bind:value={fullName}
            placeholder="Your name"
            required
          />
        </div>
        
        {#if role === 'nanny'}
          <div class="input-group">
            <label for="rate">Hourly Rate ($)</label>
            <input
              id="rate"
              type="number"
              bind:value={hourlyRate}
              placeholder="20"
              min="0"
              step="0.50"
            />
          </div>
          
          <div class="input-group">
            <label for="venmo">Venmo Username (optional)</label>
            <input
              id="venmo"
              type="text"
              bind:value={venmoUsername}
              placeholder="@username"
            />
          </div>
        {/if}
        
        <button on:click={completeSetup} disabled={loading}>
          {loading ? 'Setting up...' : 'Complete Setup'}
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .container {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 20px;
  }
  
  .card {
    background: white;
    padding: 40px;
    border-radius: 15px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    max-width: 500px;
    width: 100%;
  }
  
  h1 {
    text-align: center;
    font-size: 2em;
    margin-bottom: 10px;
    color: #667eea;
  }
  
  h2 {
    text-align: center;
    color: #4a5568;
    margin-bottom: 30px;
    font-size: 1.3em;
  }
  
  .role-selection {
    margin-bottom: 30px;
  }
  
  .role-card {
    display: block;
    position: relative;
    margin-bottom: 15px;
    cursor: pointer;
  }
  
  .role-card input[type="radio"] {
    position: absolute;
    opacity: 0;
  }
  
  .role-content {
    padding: 20px;
    border: 2px solid #e2e8f0;
    border-radius: 10px;
    transition: all 0.3s;
    text-align: center;
  }
  
  .role-card:hover .role-content {
    border-color: #667eea;
    background: #f7fafc;
  }
  
  .role-card.selected .role-content {
    border-color: #667eea;
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
  }
  
  .role-icon {
    font-size: 3em;
    margin-bottom: 10px;
  }
  
  .role-name {
    font-size: 1.2em;
    font-weight: 600;
    color: #2d3748;
    margin-bottom: 5px;
  }
  
  .role-desc {
    font-size: 0.9em;
    color: #718096;
  }
  
  .details-form {
    border-top: 2px solid #e2e8f0;
    padding-top: 30px;
  }
  
  .input-group {
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
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-size: 1em;
  }
  
  input:focus {
    outline: none;
    border-color: #667eea;
  }
  
  button {
    width: 100%;
    padding: 14px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 1.1em;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.2s;
  }
  
  button:hover:not(:disabled) {
    transform: translateY(-2px);
  }
  
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
