<script>
	import '../fonts.css';
	import '../app.css';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { supabase } from '$lib/supabase';
	import { landingFor } from '$lib/nav.js';
	import favicon from '$lib/assets/favicon.svg';
	import Nav from '$lib/Nav.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import OrnateFrame from '$lib/components/OrnateFrame.svelte';

	let { children } = $props();

	/** @type {string | null} */
	let cachedRole = null;

	// The sign-in gate and the waiting room stand outside the app; every
	// other page shares one nav.
	const OUTSIDE = ['/', '/setup'];
	let showNav = $derived(!OUTSIDE.includes(page.url.pathname));

	/** @param {string} pathname */
	async function guard(pathname) {
		try {
			const {
				data: { user }
			} = await supabase.auth.getUser();
			if (!user) {
				cachedRole = null;
				return;
			}

			// No role yet means waiting to be let in: ask again each time, so
			// the first page after an admin says yes picks it up.
			if (!cachedRole) {
				const { data: profile, error } = await supabase
					.from('profiles')
					.select('role')
					.eq('id', user.id)
					.maybeSingle();

				if (error) return;
				cachedRole = profile?.role || null;
			}

			if (!cachedRole) {
				if (pathname !== '/setup') goto(resolve('/setup'));
				return;
			}

			if (pathname === '/') goto(resolve(landingFor(cachedRole)));
		} catch {
			// Swallow guard errors to avoid blocking rendering
		}
	}

	$effect(() => {
		guard(page.url.pathname);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!-- A whisper of grain over the whole app, so flat colour never looks flat. -->
<div class="grain-overlay" aria-hidden="true"></div>

<!-- Gilt rule and filigree corners, framing every page. -->
<OrnateFrame />

<Toast />
<ConfirmModal />

{#if showNav}
	<Nav />
{/if}

{@render children?.()}
