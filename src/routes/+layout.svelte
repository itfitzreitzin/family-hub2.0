<script>
    import { onMount } from 'svelte'
    import { page } from '$app/stores'
    import { goto } from '$app/navigation'
    import { supabase } from '$lib/supabase'
    import favicon from '$lib/assets/favicon.svg'
    import Toast from '$lib/components/Toast.svelte'
    import ConfirmModal from '$lib/components/ConfirmModal.svelte'

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
                if (pathname === '/') {
                    goto('/dashboard')
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
                goto('/setup')
                return
            }

            if (hasRole && pathname === '/') {
                goto('/dashboard')
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

<Toast />
<ConfirmModal />

{@render children?.()}
