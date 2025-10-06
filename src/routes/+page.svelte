<script>
  import { supabase } from '$lib/supabase'
  
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
        
        alert('Check your email for the confirmation link!')
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
            window.location.href = '/setup'
            return
          }
        }

        // Otherwise go to dashboard
        window.location.href = '/dashboard'
      }
    } catch (err) {
      error = err.message
    } finally {
      loading = false
    }
  }
</script>

<div class="auth-screen">
  <div class="auth-card">
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

<style>
  .auth-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: clamp(1.5rem, 6vw, 3rem);
  }

  .auth-card {
    background: white;
    padding: clamp(1.75rem, 6vw, 2.75rem);
    border-radius: clamp(0.75rem, 3vw, 1.25rem);
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    max-width: 420px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  h1 {
    text-align: center;
    font-size: clamp(2rem, 4vw, 2.6rem);
    color: #667eea;
  }

  h2 {
    text-align: center;
    color: #4a5568;
    font-size: clamp(1.1rem, 2vw, 1.4rem);
  }

  .error {
    background: #fff2f0;
    border: 1px solid #ffccc7;
    color: #a8071a;
    padding: 0.75rem;
    border-radius: 0.75rem;
  }

  form {
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

  button[type="submit"] {
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

  button[type="submit"]:hover:not(:disabled) {
    transform: translateY(-2px);
  }

  button[type="submit"]:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .toggle {
    text-align: center;
    color: #718096;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.95rem;
  }

  .link {
    background: none;
    border: none;
    color: #667eea;
    cursor: pointer;
    font-weight: 600;
    text-decoration: underline;
    font-size: 1rem;
  }
</style>

