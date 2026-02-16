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
    position: relative;
  }

  /* Subtle pattern overlay */
  .container::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 20% 50%, rgba(255,255,255,0.08) 0%, transparent 50%),
                radial-gradient(circle at 80% 20%, rgba(255,255,255,0.06) 0%, transparent 40%),
                radial-gradient(circle at 50% 80%, rgba(255,255,255,0.04) 0%, transparent 50%);
    pointer-events: none;
  }

  .card {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    padding: 44px;
    border-radius: 1.25rem;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255,255,255,0.1);
    max-width: 420px;
    width: 100%;
    position: relative;
    z-index: 1;
    animation: cardEntrance 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes cardEntrance {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  h1 {
    text-align: center;
    font-size: 2.25em;
    margin-bottom: 6px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -0.03em;
  }

  h2 {
    text-align: center;
    color: var(--color-gray-500);
    margin-bottom: 32px;
    font-weight: 400;
    font-size: 1.05em;
    letter-spacing: -0.01em;
  }

  .error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #dc2626;
    padding: 12px 16px;
    border-radius: 10px;
    margin-bottom: 20px;
    font-size: 0.9em;
    font-weight: 500;
  }

  .input-group {
    margin-bottom: 20px;
  }

  label {
    display: block;
    margin-bottom: 6px;
    color: var(--color-gray-700);
    font-weight: 500;
    font-size: 0.9em;
  }

  input {
    width: 100%;
    padding: 12px 14px;
    border: 1.5px solid var(--color-gray-200);
    border-radius: 10px;
    font-size: 1em;
    background: var(--color-gray-50);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
    background: white;
  }

  button[type="submit"] {
    width: 100%;
    padding: 14px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 10px;
    font-size: 1.05em;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    letter-spacing: 0.01em;
    margin-top: 4px;
  }

  button[type="submit"]:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
  }

  button[type="submit"]:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
  }

  button[type="submit"]:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .toggle {
    text-align: center;
    margin-top: 24px;
    color: var(--color-gray-500);
    font-size: 0.9em;
  }

  .link {
    background: none;
    border: none;
    color: var(--color-primary);
    cursor: pointer;
    font-weight: 600;
    text-decoration: none;
    transition: color 0.15s;
  }

  .link:hover {
    color: var(--color-primary-dark);
    text-decoration: underline;
  }

  /* Mobile adjustments */
  @media (max-width: 768px) {
    .card {
      padding: 32px 24px;
    }

    h1 {
      font-size: 2rem;
    }

    h2 {
      font-size: 1rem;
      margin-bottom: 28px;
    }
  }

  @media (max-width: 375px) {
    .card {
      padding: 28px 20px;
    }

    h1 {
      font-size: 1.75rem;
    }
  }
</style>