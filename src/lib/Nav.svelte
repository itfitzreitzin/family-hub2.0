<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { supabase } from '$lib/supabase';
	import { browser } from '$app/environment';
	import Icon from '$lib/icons/Icon.svelte';
	import MoonPhase from '$lib/components/MoonPhase.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import PixelArt from '$lib/components/PixelArt.svelte';
	import { SECTIONS, landingFor, visibleTo, sectionFor, tabIsActive } from '$lib/nav.js';

	/** @type {string | null} */
	let userRole = null;
	let mobileMenuOpen = false;
	let isMobile = false;
	let scrollY = 0;
	let lastScrollY = 0;
	let hideNav = false;

	// Three sections up top, and the open section's pages as tabs beneath.
	// The layout renders this once for every signed-in page, so the active
	// state comes from the URL rather than from each page. (resolve() is
	// typed one route at a time and the tree's hrefs are a union of them,
	// hence the casts on its links.)
	$: pathname = $page.url.pathname;
	$: sections = SECTIONS.filter((s) => visibleTo(s, userRole));
	$: current = sectionFor(pathname);
	$: tabs = (current?.tabs || []).filter((t) => visibleTo(t, userRole));
	$: home = landingFor(userRole);

	onMount(() => {
		checkMobile();
		window.addEventListener('resize', checkMobile);
		loadRole();

		// Slide the mobile bar out of the way when scrolling down a long ledger.
		let ticking = false;
		function handleScroll() {
			if (!ticking) {
				window.requestAnimationFrame(() => {
					scrollY = window.scrollY;
					if (isMobile && !mobileMenuOpen) {
						hideNav = scrollY > 100 && scrollY > lastScrollY;
						lastScrollY = scrollY;
					}
					ticking = false;
				});
				ticking = true;
			}
		}

		window.addEventListener('scroll', handleScroll, { passive: true });

		return () => {
			window.removeEventListener('resize', checkMobile);
			window.removeEventListener('scroll', handleScroll);
			if (mobileMenuOpen) unlockBody();
		};
	});

	async function loadRole() {
		const {
			data: { user }
		} = await supabase.auth.getUser();
		if (!user) return;

		const { data: profile } = await supabase
			.from('profiles')
			.select('role')
			.eq('id', user.id)
			.maybeSingle();

		userRole = profile?.role || null;
	}

	function checkMobile() {
		isMobile = window.innerWidth < 768;
		if (!isMobile && mobileMenuOpen) toggleMobileMenu();
	}

	function buzz() {
		if (browser && window.navigator?.vibrate) window.navigator.vibrate(10);
	}

	function lockBody() {
		document.body.style.overflow = 'hidden';
		document.body.style.position = 'fixed';
		document.body.style.top = `-${scrollY}px`;
		document.body.style.width = '100%';
	}

	function unlockBody() {
		const top = document.body.style.top;
		document.body.style.overflow = '';
		document.body.style.position = '';
		document.body.style.top = '';
		document.body.style.width = '';
		window.scrollTo(0, parseInt(top || '0') * -1);
	}

	async function signOut() {
		buzz();
		await supabase.auth.signOut();
		goto(resolve('/'));
	}

	function toggleMobileMenu() {
		mobileMenuOpen = !mobileMenuOpen;
		if (browser) {
			if (mobileMenuOpen) lockBody();
			else unlockBody();
		}
		buzz();
	}

	function handleNavClick() {
		if (isMobile && mobileMenuOpen) {
			mobileMenuOpen = false;
			unlockBody();
		}
		buzz();
	}

	/** @param {KeyboardEvent} event */
	function handleKeydown(event) {
		if (event.key === 'Escape' && mobileMenuOpen) toggleMobileMenu();
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if !isMobile}
	<!-- ── Desktop ─────────────────────────────────────────── -->
	<nav class="desktop-nav" aria-label="Main navigation">
		<div class="nav-content">
			<a href={resolve(home)} class="logo" aria-label="Family Hub — go to the hearth">
				<MoonPhase size={20} />
				<span class="wordmark">Family Hub</span>
			</a>

			<div class="nav-links">
				{#each sections as section (section.key)}
					{@const active = current?.key === section.key}
					<a
						href={resolve(/** @type {any} */ (section.href))}
						class:active
						aria-current={pathname === section.href ? 'page' : active ? 'true' : undefined}
					>
						<PixelArt src={section.art} size={22} loading="eager" />
						<span>{section.label}</span>
					</a>
				{/each}
			</div>

			<div class="nav-tail">
				<ThemeToggle compact />
				<button on:click={signOut} class="sign-out" aria-label="Sign out">
					<Icon name="door" size={16} />
					<span>Leave</span>
				</button>
			</div>
		</div>

		{#if current && tabs.length > 1}
			<div class="section-tabs">
				{#each tabs as tab (tab.href)}
					{@const active = tabIsActive(current, tab, pathname)}
					<a
						href={resolve(/** @type {any} */ (tab.href))}
						class:active
						aria-current={active ? 'page' : undefined}
						on:click={buzz}>{tab.label}</a
					>
				{/each}
			</div>
		{/if}
	</nav>
{:else}
	<!-- ── Mobile top bar ──────────────────────────────────── -->
	<nav class="mobile-nav" class:hide={hideNav} aria-label="Main navigation">
		<div class="mobile-nav-header">
			<a
				href={resolve(home)}
				class="logo"
				on:click={handleNavClick}
				aria-label="Family Hub — go to the hearth"
			>
				<MoonPhase size={18} />
				<span class="wordmark">Family Hub</span>
			</a>
			<ThemeToggle compact />
		</div>
	</nav>

	<!-- The open section's pages, in the flow just under the fixed bar. -->
	{#if current && tabs.length > 1}
		<nav class="mobile-tabs" aria-label="{current.label} pages">
			{#each tabs as tab (tab.href)}
				{@const active = tabIsActive(current, tab, pathname)}
				<a
					href={resolve(/** @type {any} */ (tab.href))}
					class:active
					aria-current={active ? 'page' : undefined}
					on:click={buzz}>{tab.label}</a
				>
			{/each}
		</nav>
	{/if}

	{#if mobileMenuOpen}
		<div
			class="mobile-menu-overlay"
			on:click={toggleMobileMenu}
			role="presentation"
			aria-hidden="true"
		></div>

		<div class="mobile-menu" role="dialog" aria-label="Navigation menu" aria-modal="true">
			<div class="mobile-menu-header">
				<span class="menu-title">The Ways</span>
				<button class="close-menu" on:click={toggleMobileMenu} aria-label="Close menu">
					<Icon name="close" size={16} />
				</button>
			</div>

			<nav class="mobile-menu-links" aria-label="Page navigation">
				{#each sections as section (section.key)}
					{@const sectionTabs = (section.tabs || []).filter((t) => visibleTo(t, userRole))}
					{@const here = pathname === section.href}
					<a
						href={resolve(/** @type {any} */ (section.href))}
						class:active={here}
						on:click={handleNavClick}
						aria-current={here ? 'page' : undefined}
					>
						<PixelArt src={section.art} size={22} loading="eager" />
						<span>{section.label}</span>
						{#if here}
							<span class="active-indicator" aria-hidden="true"><Icon name="star" size={12} /></span
							>
						{/if}
					</a>
					<!-- The first tab is the section itself; list the rest beneath it. -->
					{#each sectionTabs.slice(1) as tab (tab.href)}
						{@const tabHere = tabIsActive(section, tab, pathname)}
						<a
							href={resolve(/** @type {any} */ (tab.href))}
							class="sub-link"
							class:active={tabHere}
							on:click={handleNavClick}
							aria-current={tabHere ? 'page' : undefined}
						>
							<span>{tab.label}</span>
							{#if tabHere}
								<span class="active-indicator" aria-hidden="true"
									><Icon name="star" size={12} /></span
								>
							{/if}
						</a>
					{/each}
				{/each}
			</nav>

			<div class="menu-foot">
				<MoonPhase size={18} showLabel />
				<button class="mobile-sign-out" on:click={signOut}>
					<Icon name="door" size={18} />
					<span>Leave the Hearth</span>
				</button>
			</div>
		</div>
	{/if}

	<!-- ── Mobile bottom bar ───────────────────────────────── -->
	<nav class="mobile-bottom-nav" aria-label="Quick navigation">
		{#each sections as section (section.key)}
			{@const active = current?.key === section.key}
			<a
				href={resolve(/** @type {any} */ (section.href))}
				class:active
				on:click={handleNavClick}
				aria-current={pathname === section.href ? 'page' : active ? 'true' : undefined}
			>
				<PixelArt src={section.art} size={24} loading="eager" />
				<span class="bottom-label">{section.label}</span>
			</a>
		{/each}
		<button class="menu-trigger" on:click={toggleMobileMenu} aria-label="More options">
			<Icon name="menu" size={20} />
			<span class="bottom-label">More</span>
		</button>
	</nav>
{/if}

<style>
	/* ── Shared wordmark ───────────────────────────────────── */
	.logo {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		text-decoration: none;
		-webkit-tap-highlight-color: transparent;
	}

	.wordmark {
		font-family: var(--font-wordmark);
		font-size: 1.05rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--accent-bright);
		text-shadow: 0 0 18px var(--accent-dim);
	}

	/* ── Desktop ───────────────────────────────────────────── */
	.desktop-nav {
		position: sticky;
		top: 0;
		z-index: 1000;
		background: var(--surface-glass);
		backdrop-filter: blur(14px) saturate(140%);
		-webkit-backdrop-filter: blur(14px) saturate(140%);
		border-bottom: 1px solid var(--border-soft);
		box-shadow: 0 1px 0 var(--border-gilt);
	}

	.nav-content {
		max-width: var(--page-max-width);
		margin: 0 auto;
		padding: 0.6rem clamp(1rem, 4vw, 2rem);
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1.25rem;
	}

	.nav-links {
		display: flex;
		gap: 0.35rem;
		flex: 1;
		justify-content: center;
	}

	.nav-links a {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		font-family: var(--font-display);
		font-size: 0.88rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-decoration: none;
		white-space: nowrap;
		transition: all var(--transition-normal);
		--icon-accent: var(--text-faint);
	}

	.nav-links a:hover {
		color: var(--accent-bright);
		background: var(--accent-tint);
		--icon-accent: var(--accent);
	}

	.nav-links a.active {
		color: var(--accent-bright);
		background: var(--accent-dim);
		--icon-accent: var(--accent-bright);
	}

	/* A gilt underline that grows in on the active section */
	.nav-links a.active::after {
		content: '';
		position: absolute;
		left: 50%;
		bottom: 2px;
		width: 18px;
		height: 2px;
		background: var(--accent);
		border-radius: 2px;
		transform: translateX(-50%);
		animation: grow-underline 0.35s var(--ease-out-expo);
	}

	@keyframes grow-underline {
		from {
			width: 0;
			opacity: 0;
		}
		to {
			width: 18px;
			opacity: 1;
		}
	}

	.nav-tail {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.sign-out {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 38px;
		padding: 0.35rem 0.85rem;
		background: transparent;
		color: var(--text-faint);
		border: 1px solid var(--border);
		border-radius: 999px;
		cursor: pointer;
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		transition: all var(--transition-fast);
		--icon-accent: var(--text-faint);
	}

	.sign-out:hover {
		color: var(--danger);
		border-color: var(--danger);
		background: var(--danger-dim);
		--icon-accent: var(--danger);
	}

	/* The open section's pages, a quieter row under the three sections. */
	.section-tabs {
		display: flex;
		justify-content: center;
		gap: 0.3rem;
		max-width: var(--page-max-width);
		margin: 0 auto;
		padding: 0 clamp(1rem, 4vw, 2rem) 0.55rem;
	}

	.section-tabs a,
	.mobile-tabs a {
		padding: 0.4rem 0.9rem;
		border-radius: 999px;
		color: var(--text-faint);
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		text-decoration: none;
		white-space: nowrap;
		transition: all var(--transition-fast);
	}

	.section-tabs a:hover {
		color: var(--accent-bright);
		background: var(--accent-tint);
	}

	.section-tabs a.active,
	.mobile-tabs a.active {
		color: var(--accent-bright);
		background: var(--accent-dim);
	}

	@media (max-width: 900px) {
		.desktop-nav .wordmark {
			display: none;
		}

		.sign-out span {
			display: none;
		}

		.sign-out {
			width: 38px;
			padding: 0;
			justify-content: center;
		}
	}

	/* ── Mobile top bar ────────────────────────────────────── */
	.mobile-nav {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 1000;
		background: var(--surface-glass);
		backdrop-filter: blur(14px) saturate(140%);
		-webkit-backdrop-filter: blur(14px) saturate(140%);
		border-bottom: 1px solid var(--border-gilt);
		padding-top: var(--safe-top);
		transition: transform 0.3s var(--ease-out-expo);
	}

	.mobile-nav.hide {
		transform: translateY(-100%);
	}

	.mobile-nav-header {
		height: 56px;
		padding: 0 1rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	/* A segmented strip; scrolls sideways rather than wrapping if a narrow
	   phone can't fit every label. */
	.mobile-tabs {
		display: flex;
		gap: 0.25rem;
		margin: 0.75rem var(--page-padding-x) 0;
		padding: 0.25rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: 999px;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.mobile-tabs::-webkit-scrollbar {
		display: none;
	}

	.mobile-tabs a {
		flex: 1 0 auto;
		display: grid;
		place-items: center;
		min-height: 36px;
		padding: 0.3rem 0.7rem;
		font-size: 0.66rem;
		letter-spacing: 0.07em;
		-webkit-tap-highlight-color: transparent;
	}

	/* ── Drawer ────────────────────────────────────────────── */
	.mobile-menu-overlay {
		position: fixed;
		inset: 0;
		z-index: 1001;
		background: rgba(8, 5, 15, 0.65);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		animation: veil-in 0.25s ease;
	}

	@keyframes veil-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.mobile-menu {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 1002;
		width: min(300px, 84vw);
		display: flex;
		flex-direction: column;
		background: var(--surface);
		background-image: linear-gradient(200deg, var(--accent-tint), transparent 40%);
		border-left: 1px solid var(--border-gilt);
		box-shadow: var(--shadow-xl);
		padding-top: var(--safe-top);
		padding-bottom: var(--safe-bottom);
		animation: slide-in 0.3s var(--ease-out-expo);
	}

	@keyframes slide-in {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(0);
		}
	}

	.mobile-menu-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1.1rem 1.25rem;
		border-bottom: 1px solid var(--border-soft);
	}

	.menu-title {
		font-family: var(--font-display);
		font-size: 0.95rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--accent-bright);
	}

	.close-menu {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		min-height: 40px;
		background: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.close-menu:hover {
		color: var(--danger);
		border-color: var(--danger);
	}

	.mobile-menu-links {
		flex: 1;
		padding: 0.75rem 0;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}

	.mobile-menu-links a {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 0.85rem 1.25rem;
		color: var(--text-muted);
		font-family: var(--font-display);
		font-size: 0.95rem;
		letter-spacing: 0.03em;
		text-decoration: none;
		border-left: 3px solid transparent;
		transition: all var(--transition-fast);
		--icon-accent: var(--text-faint);
	}

	/* A section's other pages, tucked under it and lined up with its label. */
	.mobile-menu-links a.sub-link {
		padding: 0.6rem 1.25rem 0.6rem calc(1.25rem + 22px + 0.9rem);
		font-family: var(--font-body);
		font-size: 0.9rem;
	}

	.mobile-menu-links a:active {
		background: var(--surface-2);
	}

	.mobile-menu-links a.active {
		color: var(--accent-bright);
		background: linear-gradient(90deg, var(--accent-dim), transparent);
		border-left-color: var(--accent);
		--icon-accent: var(--accent-bright);
	}

	.active-indicator {
		margin-left: auto;
		color: var(--accent);
		--icon-accent: var(--accent-bright);
		animation: flicker 3s ease-in-out infinite;
	}

	.menu-foot {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 1.1rem 1.25rem;
		border-top: 1px solid var(--border-soft);
	}

	.mobile-sign-out {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.8rem;
		background: transparent;
		color: var(--danger);
		border: 1px solid var(--danger);
		border-radius: var(--radius-sm);
		font-family: var(--font-display);
		font-size: 0.9rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		cursor: pointer;
		transition: all var(--transition-fast);
		--icon-accent: var(--danger);
	}

	.mobile-sign-out:active {
		background: var(--danger-dim);
		transform: scale(0.98);
	}

	/* ── Bottom bar ────────────────────────────────────────── */
	.mobile-bottom-nav {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 999;
		display: flex;
		justify-content: space-around;
		padding: 0.4rem 0;
		padding-bottom: calc(0.4rem + var(--safe-bottom));
		background: var(--surface-glass);
		backdrop-filter: blur(14px) saturate(140%);
		-webkit-backdrop-filter: blur(14px) saturate(140%);
		border-top: 1px solid var(--border-gilt);
	}

	.mobile-bottom-nav a,
	.mobile-bottom-nav .menu-trigger {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		padding: 0.4rem 0;
		min-height: 52px;
		background: none;
		border: none;
		color: var(--text-faint);
		text-decoration: none;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition: color var(--transition-fast);
		--icon-accent: var(--text-faint);
	}

	.mobile-bottom-nav a:active,
	.mobile-bottom-nav .menu-trigger:active {
		transform: scale(0.94);
	}

	.mobile-bottom-nav a.active {
		color: var(--accent-bright);
		--icon-accent: var(--accent-bright);
	}

	/* A small gilt lantern above the active tab */
	.mobile-bottom-nav a.active::before {
		content: '';
		position: absolute;
		top: -1px;
		left: 50%;
		transform: translateX(-50%);
		width: 22px;
		height: 2px;
		background: var(--accent);
		border-radius: 0 0 2px 2px;
		box-shadow: 0 0 10px var(--accent);
	}

	.bottom-label {
		font-family: var(--font-body);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		white-space: nowrap;
	}
</style>
