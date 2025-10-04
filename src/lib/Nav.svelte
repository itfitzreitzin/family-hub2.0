<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
 
  export let currentPage = ''
 
  let isAdmin = false
 
  onMount(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    console.log('Nav: Current user:', user?.id)
   
    if (user) {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
     
      console.log('Nav: Profile data:', profile)
      console.log('Nav: Profile error:', error)
      console.log('Nav: Role:', profile?.role)
     
      isAdmin = profile?.role === 'admin'
      console.log('Nav: isAdmin:', isAdmin)
    }
  })
 
  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/'
  }
</script>

<nav>
  <div class="nav-content">
    <a href="/dashboard" class="logo">👶 Family Hub</a>
    
    <div class="nav-links">
      <a href="/dashboard" class:active={currentPage === 'dashboard'}>Dashboard</a>
      <a href="/tracker" class:active={currentPage === 'tracker'}>Time Tracker</a>
      <a href="/history" class:active={currentPage === 'history'}>History</a>
      {#if isAdmin}
        <a href="/admin" class:active={currentPage === 'admin'} class="admin-link">Admin</a>
      {/if}
      <a href="/settings" class:active={currentPage === 'settings'}>Settings</a>
    </div>
    
    <button on:click={signOut} class="sign-out">Sign Out</button>
  </div>
</nav>

<style>
  nav {
    background: white;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    position: sticky;
    top: 0;
    z-index: 1000;
  }
  
  .nav-content {
    max-width: 1200px;
    margin: 0 auto;
    padding: 15px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
  }
  
  .logo {
    font-size: 1.3em;
    font-weight: bold;
    color: #667eea;
    text-decoration: none;
  }
  
  .nav-links {
    display: flex;
    gap: 25px;
    flex: 1;
    justify-content: center;
  }
  
  .nav-links a {
    color: #4a5568;
    text-decoration: none;
    font-weight: 600;
    padding: 8px 0;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }
  
  .nav-links a:hover {
    color: #667eea;
  }
  
  .nav-links a.active {
    color: #667eea;
    border-bottom-color: #667eea;
  }
  
  .admin-link {
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    color: white !important;
    padding: 8px 16px !important;
    border-radius: 6px;
    border-bottom: none !important;
  }
  
  .admin-link:hover {
    transform: translateY(-1px);
  }
  
  .sign-out {
    padding: 8px 16px;
    background: #f56565;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
  }
  
  .sign-out:hover {
    background: #e53e3e;
  }
  
  @media (max-width: 768px) {
    .nav-content {
      flex-wrap: wrap;
    }
    
    .nav-links {
      order: 3;
      width: 100%;
      justify-content: space-around;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
    }
  }
</style>