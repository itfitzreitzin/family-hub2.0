<script>
    import { onMount } from 'svelte'
    import { page } from '$app/stores'
    import { supabase } from '$lib/supabase'
    import favicon from '$lib/assets/favicon.svg'

    let { children } = $props()

    let cachedHasRole = null

    async function guard(pathname) {
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                cachedHasRole = null
                return
            }

            if (cachedHasRole === true) {
                // If user already confirmed to have a role and is on home, send to dashboard
                if (pathname === '/') {
                    window.location.href = '/dashboard'
                }
                return
            }

            const { data: profile, error } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .maybeSingle()

            if (error) return

            const hasRole = !!(profile && profile.role)
            cachedHasRole = hasRole

            if (!hasRole && pathname !== '/setup') {
                window.location.href = '/setup'
                return
            }

            // If has role and hits root, go to dashboard
            if (hasRole && pathname === '/') {
                window.location.href = '/dashboard'
            }
        } catch (e) {
            // Swallow guard errors to avoid blocking rendering
        }
    }

    onMount(() => {
        const unsubscribe = page.subscribe(($page) => {
            guard($page.url.pathname)
        })
        return () => unsubscribe()
    })
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children?.()}
