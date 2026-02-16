<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import { toast } from '$lib/stores/toast.js'
  
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
      toast.warning('Please select your role')
      return
    }

    if (!fullName) {
      toast.warning('Please enter your name')
      return
    }
    
    loading = true
    
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
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
      toast.error('Error: ' + err.message)
      loading = false
    }
  }
</script>

<div class="setup-screen">
  <div class="setup-card">
    <h1>Welcome to Family Hub!</h1>
    <h2>Let's get you set up</h2>
    
    <div class="role-selection">
      <p style="margin-bottom: 20px; color: #4a5568;">Who are you?</p>
      
      <label class="role-card" class:selected={role === 'family'}>
        <input type="radio" bind:group={role} value="family" />
        <div class="role-content">
          <div class="role-icon">👨‍👩‍👧‍👦</div>
          <div class="role-name">Family Member</div>
          <div class="role-desc">Parents, manage schedules & payments</div>
        </div>
      </label>
      
      <label class="role-card" class:selected={role === 'nanny'}>
        <input type="radio" bind:group={role} value="nanny" />
        <div class="role-content">
          <div class="role-icon">🧑‍🍼</div>
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
  .setup-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: clamp(1.5rem, 6vw, 3rem);
  }

  .setup-card {
    background: white;
    padding: clamp(1.75rem, 6vw, 3rem);
    border-radius: clamp(0.75rem, 3vw, 1.25rem);
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    max-width: 520px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
  }

  h1 {
    text-align: center;
    font-size: clamp(1.9rem, 3vw, 2.4rem);
    margin-bottom: 0.25rem;
    color: #667eea;
  }

  h2 {
    text-align: center;
    color: #4a5568;
    font-size: clamp(1.1rem, 2vw, 1.4rem);
  }

  .role-selection {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .role-card {
    position: relative;
    cursor: pointer;
  }

  .role-card input[type="radio"] {
    position: absolute;
    opacity: 0;
  }

  .role-content {
    padding: 1.25rem;
    border: 2px solid #e2e8f0;
    border-radius: 0.75rem;
    transition: all 0.3s;
    text-align: center;
  }

  .role-card:hover .role-content {
    border-color: #667eea;
    background: #f7fafc;
  }

  .role-card.selected .role-content {
    border-color: #667eea;
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.12) 0%, rgba(118, 75, 162, 0.12) 100%);
  }

  .role-icon {
    font-size: clamp(2.25rem, 6vw, 3rem);
    margin-bottom: 0.75rem;
  }

  .role-name {
    font-size: clamp(1.1rem, 2.5vw, 1.3rem);
    font-weight: 600;
    color: #2d3748;
    margin-bottom: 0.25rem;
  }

  .role-desc {
    font-size: 0.9rem;
    color: #718096;
  }

  .details-form {
    border-top: 2px solid #e2e8f0;
    padding-top: 1.75rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  label {
    color: #4a5568;
    font-weight: 500;
  }

  input {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid #e2e8f0;
    border-radius: 0.75rem;
    font-size: 1rem;
  }

  input:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
  }

  button {
    width: 100%;
    padding: clamp(0.85rem, 3vw, 1rem);
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 0.75rem;
    font-size: clamp(1rem, 2vw, 1.15rem);
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

