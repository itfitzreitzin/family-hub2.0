<script>
  import { supabase } from '$lib/supabase'
  import { goto } from '$app/navigation'
  import { toast } from '$lib/stores/toast.js'
  
  let email = ''
  let password = ''
  let loading = false
  let error = ''
  let mode = 'login' // 'login' or 'signup'

  async function handleAuth() {
    loading = true
    error = ''
    
    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        })
        
        if (signUpError) throw signUpError
        
        toast.success('Check your email for the confirmation link!')
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        
        if (signInError) throw signInError

        // After login, check if user has a profile/role
        const { data: userData } = await supabase.auth.getUser()
        const uid = userData?.user?.id

        if (uid) {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', uid)
            .maybeSingle()

          if (profileError) throw profileError

          // If no profile or no role yet, send to setup
          if (!profile || !profile.role) {
            goto('/setup')
            return
          }
        }

        // Otherwise go to dashboard
        goto('/dashboard')
      }
    } catch (err) {
      error = err.message
    } finally {
      loading = false
    }
  }
</script>

<div class="login-page">
  <div class="container">
    <div class="card">
      <h1>Family Hub</h1>
      <h2>{mode === 'login' ? 'Welcome Back' : 'Create Account'}</h2>
      
      {#if error}
        <div class="error">{error}</div>
      {/if}
      
      <form on:submit|preventDefault={handleAuth}>
        <div class="input-group">
          <label for="email">Email</label>
          <input
            id="email"
            type="email"
            bind:value={email}
            placeholder="you@example.com"
            required
          />
        </div>
        
        <div class="input-group">
          <label for="password">Password</label>
          <input
            id="password"
            type="password"
            bind:value={password}
            placeholder="••••••••"
            required
          />
        </div>
        
        <button type="submit" disabled={loading}>
          {loading ? 'Loading...' : mode === 'login' ? 'Sign In' : 'Sign Up'}
        </button>
      </form>
      
      <p class="toggle">
        {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
        <button class="link" on:click={() => mode = mode === 'login' ? 'signup' : 'login'}>
          {mode === 'login' ? 'Sign Up' : 'Sign In'}
        </button>
      </p>
    </div>
  </div>
</div>

<style>
  /* Override body padding for login page only */
  :global(body) {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
  }

  .login-page {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

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
    max-width: 400px;
    width: 100%;
  }
  
  h1 {
    text-align: center;
    font-size: 2.5em;
    margin-bottom: 10px;
    color: #667eea;
  }
  
  h2 {
    text-align: center;
    color: #4a5568;
    margin-bottom: 30px;
  }
  
  .error {
    background: #fff2f0;
    border: 1px solid #ffccc7;
    color: #a8071a;
    padding: 12px;
    border-radius: 8px;
    margin-bottom: 20px;
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
  
  button[type="submit"] {
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
  
  button[type="submit"]:hover:not(:disabled) {
    transform: translateY(-2px);
  }
  
  button[type="submit"]:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .toggle {
    text-align: center;
    margin-top: 20px;
    color: #718096;
  }
  
  .link {
    background: none;
    border: none;
    color: #667eea;
    cursor: pointer;
    font-weight: 600;
    text-decoration: underline;
  }

  /* Mobile adjustments */
  @media (max-width: 768px) {
    .card {
      padding: 30px 24px;
    }
    
    h1 {
      font-size: 2rem;
    }
    
    h2 {
      font-size: 1.2rem;
    }
  }

  @media (max-width: 375px) {
    .card {
      padding: 24px 20px;
    }
    
    h1 {
      font-size: 1.75rem;
    }
  }
</style>