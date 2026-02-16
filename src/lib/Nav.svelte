<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import { browser } from '$app/environment'
  
  export let currentPage = ''
  
  let isAdmin = false
  let userRole = null
  let mobileMenuOpen = false
  let isMobile = false
  let scrollY = 0
  let lastScrollY = 0
  let hideNav = false
  
  onMount(async () => {
    // Check if mobile
    checkMobile()
    window.addEventListener('resize', checkMobile)
    
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      
      isAdmin = profile?.role === 'admin'
      userRole = profile?.role || null
    }
    
    // Auto-hide nav on scroll down (mobile only)
    let ticking = false
    function handleScroll() {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          scrollY = window.scrollY
          if (isMobile && !mobileMenuOpen) {
            hideNav = scrollY > 100 && scrollY > lastScrollY
            lastScrollY = scrollY
          }
          ticking = false
        })
        ticking = true
      }
    }
    
    window.addEventListener('scroll', handleScroll, { passive: true })
    
    return () => {
      window.removeEventListener('resize', checkMobile)
      window.removeEventListener('scroll', handleScroll)
      // Clean up body scroll lock if menu is open
      if (mobileMenuOpen) {
        document.body.style.overflow = ''
      }
    }
  })
  
  function checkMobile() {
    isMobile = window.innerWidth < 768
    // Close menu when switching to desktop
    if (!isMobile && mobileMenuOpen) {
      toggleMobileMenu()
    }
  }
  
  async function signOut() {
    // Haptic feedback
    if (browser && window.navigator?.vibrate) {
      window.navigator.vibrate(10)
    }
    await supabase.auth.signOut()
    window.location.href = '/'
  }
  
  let savedScrollY = 0

  function toggleMobileMenu() {
    mobileMenuOpen = !mobileMenuOpen

    if (browser) {
      if (mobileMenuOpen) {
        savedScrollY = window.scrollY
        document.body.style.overflow = 'hidden'
        document.body.style.position = 'fixed'
        document.body.style.top = `-${savedScrollY}px`
        document.body.style.width = '100%'
      } else {
        document.body.style.overflow = ''
        document.body.style.position = ''
        document.body.style.top = ''
        document.body.style.width = ''
        window.scrollTo(0, savedScrollY)
      }
    }

    if (browser && window.navigator?.vibrate) {
      window.navigator.vibrate(10)
    }
  }
  
  function handleNavClick() {
    if (isMobile && mobileMenuOpen) {
      mobileMenuOpen = false
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      window.scrollTo(0, savedScrollY)
    }
    
    // Haptic feedback
    if (browser && window.navigator?.vibrate) {
      window.navigator.vibrate(10)
    }
  }
</script>

<!-- Desktop Navigation -->
{#if !isMobile}
<nav class="desktop-nav" aria-label="Main navigation">
  <div class="nav-content">
    <a href="/dashboard" class="logo">👶 Family Hub</a>

    <div class="nav-links" role="list">
      <a href="/dashboard" class:active={currentPage === 'dashboard'} aria-current={currentPage === 'dashboard' ? 'page' : undefined}>Dashboard</a>
      <a href="/tracker" class:active={currentPage === 'tracker'} aria-current={currentPage === 'tracker' ? 'page' : undefined}>Time Tracker</a>
      {#if userRole === 'family' || userRole === 'admin'}
        <a href="/schedule" class:active={currentPage === 'schedule'} aria-current={currentPage === 'schedule' ? 'page' : undefined}>Schedule</a>
      {/if}
      <a href="/history" class:active={currentPage === 'history'} aria-current={currentPage === 'history' ? 'page' : undefined}>History</a>
      {#if isAdmin}
        <a href="/admin" class:active={currentPage === 'admin'} class="admin-link" aria-current={currentPage === 'admin' ? 'page' : undefined}>Admin</a>
      {/if}
      <a href="/settings" class:active={currentPage === 'settings'} aria-current={currentPage === 'settings' ? 'page' : undefined}>Settings</a>
    </div>

    <button on:click={signOut} class="sign-out">Sign Out</button>
  </div>
</nav>

<!-- Mobile Navigation -->
{:else}
<nav class="mobile-nav" class:hide={hideNav} aria-label="Main navigation">
  <div class="mobile-nav-header safe-top">
    <a href="/dashboard" class="mobile-logo" on:click={handleNavClick}>👶 Family Hub</a>
  </div>
</nav>

<!-- Mobile Menu Overlay -->
{#if mobileMenuOpen}
  <div class="mobile-menu-overlay" on:click={toggleMobileMenu} aria-hidden="true"></div>
  <div class="mobile-menu safe-top" role="dialog" aria-modal="true" aria-label="Navigation menu">
    <div class="mobile-menu-header">
      <h3>Menu</h3>
      <button class="close-menu touch-target" on:click={toggleMobileMenu} aria-label="Close menu">✕</button>
    </div>
    
    <div class="mobile-menu-links">
      <a href="/dashboard" class:active={currentPage === 'dashboard'} on:click={handleNavClick}>
        <span class="icon">🏠</span>
        <span>Dashboard</span>
        {#if currentPage === 'dashboard'}
          <span class="active-indicator">•</span>
        {/if}
      </a>
      <a href="/tracker" class:active={currentPage === 'tracker'} on:click={handleNavClick}>
        <span class="icon">⏰</span>
        <span>Time Tracker</span>
        {#if currentPage === 'tracker'}
          <span class="active-indicator">•</span>
        {/if}
      </a>
      {#if userRole === 'family' || userRole === 'admin'}
        <a href="/schedule" class:active={currentPage === 'schedule'} on:click={handleNavClick}>
          <span class="icon">📅</span>
          <span>Schedule</span>
          {#if currentPage === 'schedule'}
            <span class="active-indicator">•</span>
          {/if}
        </a>
      {/if}
      <a href="/history" class:active={currentPage === 'history'} on:click={handleNavClick}>
        <span class="icon">📊</span>
        <span>History</span>
        {#if currentPage === 'history'}
          <span class="active-indicator">•</span>
        {/if}
      </a>
      {#if isAdmin}
        <a href="/admin" class:active={currentPage === 'admin'} class="admin-link-mobile" on:click={handleNavClick}>
          <span class="icon">⚙️</span>
          <span>Admin</span>
          {#if currentPage === 'admin'}
            <span class="active-indicator">•</span>
          {/if}
        </a>
      {/if}
      <a href="/settings" class:active={currentPage === 'settings'} on:click={handleNavClick}>
        <span class="icon">👤</span>
        <span>Settings</span>
        {#if currentPage === 'settings'}
          <span class="active-indicator">•</span>
        {/if}
      </a>
    </div>
    
    <button class="mobile-sign-out touch-target" on:click={signOut}>
      <span class="icon">🚪</span>
      <span>Sign Out</span>
    </button>
  </div>
{/if}

<!-- Mobile Bottom Navigation -->
{#if isMobile}
<div class="mobile-bottom-nav safe-bottom" role="navigation" aria-label="Quick navigation">
  <a 
    href="/dashboard" 
    class:active={currentPage === 'dashboard'}
    on:click={handleNavClick}
  >
    <span class="bottom-icon">🏠</span>
    <span class="bottom-label">Home</span>
  </a>
  <a 
    href="/tracker" 
    class:active={currentPage === 'tracker'}
    on:click={handleNavClick}
  >
    <span class="bottom-icon">⏰</span>
    <span class="bottom-label">Track</span>
  </a>
  <a 
    href="/history" 
    class:active={currentPage === 'history'}
    on:click={handleNavClick}
  >
    <span class="bottom-icon">📊</span>
    <span class="bottom-label">History</span>
  </a>
  <button 
    class="menu-trigger touch-target" 
    on:click={toggleMobileMenu}
    aria-label="More options"
  >
    <span class="bottom-icon">☰</span>
    <span class="bottom-label">More</span>
  </button>
</div>
{/if}
{/if}

<style>
  /* Desktop Navigation Styles */
  .desktop-nav {
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
  
  .logo, .mobile-logo {
    font-size: 1.3em;
    font-weight: bold;
    color: #667eea;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
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
  
  .sign-out {
    padding: 8px 16px;
    background: #f56565;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.2s;
  }
  
  .sign-out:hover {
    background: #e53e3e;
  }
  
  /* Mobile Navigation Styles */
  .mobile-nav {
    background: white;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    transition: transform 0.3s ease-in-out;
  }
  
  .mobile-nav.hide {
    transform: translateY(-100%);
  }
  
  .mobile-nav-header {
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .mobile-logo {
    font-size: 1.1em;
    font-weight: bold;
    color: #667eea;
    text-decoration: none;
  }
  
  /* Safe area utilities */
  .safe-top {
    padding-top: env(safe-area-inset-top, 0);
  }
  
  .safe-bottom {
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  
  /* Touch target utilities */
  .touch-target {
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-tap-highlight-color: transparent;
  }
  
  /* Hamburger Menu */
  .hamburger {
    width: 30px;
    height: 24px;
    position: relative;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  
  .hamburger span {
    display: block;
    position: absolute;
    height: 3px;
    width: 100%;
    background: #667eea;
    border-radius: 3px;
    opacity: 1;
    left: 0;
    transform: rotate(0deg);
    transition: 0.25s ease-in-out;
  }
  
  .hamburger span:nth-child(1) {
    top: 0;
  }
  
  .hamburger span:nth-child(2) {
    top: 10px;
  }
  
  .hamburger span:nth-child(3) {
    top: 20px;
  }
  
  .hamburger.open span:nth-child(1) {
    top: 10px;
    transform: rotate(135deg);
  }
  
  .hamburger.open span:nth-child(2) {
    opacity: 0;
    left: -30px;
  }
  
  .hamburger.open span:nth-child(3) {
    top: 10px;
    transform: rotate(-135deg);
  }
  
  /* Mobile Menu Overlay */
  .mobile-menu-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 1001;
    animation: fadeIn 0.3s ease;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  
  /* Mobile Slide Menu */
  .mobile-menu {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(280px, 80vw);
    background: white;
    z-index: 1002;
    animation: slideIn 0.3s ease;
    display: flex;
    flex-direction: column;
    box-shadow: -5px 0 15px rgba(0,0,0,0.1);
  }
  
  .mobile-menu-header {
    padding: 20px;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .mobile-menu-header h3 {
    margin: 0;
    color: #2d3748;
  }
  
  .close-menu {
    background: none;
    border: none;
    font-size: 24px;
    color: #718096;
    cursor: pointer;
    padding: 0;
  }
  
  .mobile-menu-links {
    flex: 1;
    padding: 20px 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  .mobile-menu-links a {
    display: flex;
    align-items: center;
    gap: 15px;
    padding: 15px 20px;
    color: #4a5568;
    text-decoration: none;
    font-weight: 500;
    transition: all 0.2s;
    position: relative;
    -webkit-tap-highlight-color: transparent;
  }
  
  .mobile-menu-links a:active {
    background: #f7fafc;
    transform: scale(0.98);
  }
  
  .mobile-menu-links a.active {
    background: linear-gradient(to right, #667eea08, transparent);
    color: #667eea;
    border-left: 3px solid #667eea;
  }
  
  .active-indicator {
    position: absolute;
    right: 20px;
    color: #667eea;
    font-size: 1.5em;
  }
  
  .mobile-menu-links .icon {
    font-size: 1.2em;
    width: 30px;
    text-align: center;
  }
  
  .admin-link-mobile {
    background: linear-gradient(135deg, #f59e0b15 0%, #d9770615 100%);
    color: #d97706 !important;
    margin: 10px 20px;
    border-radius: 8px;
  }
  
  .mobile-sign-out {
    margin: 20px;
    padding: 15px;
    background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 1em;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    transition: all 0.2s;
  }
  
  .mobile-sign-out:active {
    transform: scale(0.98);
  }
  
  /* Mobile Bottom Navigation */
  .mobile-bottom-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: white;
    box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
    display: flex;
    justify-content: space-around;
    padding: 8px 0;
    z-index: 999;
  }
  
  .mobile-bottom-nav a,
  .mobile-bottom-nav .menu-trigger {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 0;
    text-decoration: none;
    color: #718096;
    background: none;
    border: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: all 0.2s;
  }
  
  .mobile-bottom-nav a:active,
  .mobile-bottom-nav .menu-trigger:active {
    transform: scale(0.95);
  }
  
  .mobile-bottom-nav a.active {
    color: #667eea;
  }
  
  .bottom-icon {
    font-size: 1.3em;
  }
  
  .bottom-label {
    font-size: 0.75em;
    font-weight: 600;
  }
  
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  @keyframes slideIn {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  
  /* Accessibility improvements */
  @media (prefers-reduced-motion: reduce) {
    * {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
</style>