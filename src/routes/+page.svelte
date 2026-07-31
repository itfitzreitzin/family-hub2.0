<script>
	import { supabase } from '$lib/supabase';
	import { goto } from '$app/navigation';
	import { toast } from '$lib/stores/toast.js';
	import Icon from '$lib/icons/Icon.svelte';
	import MoonPhase from '$lib/components/MoonPhase.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { moonPhase } from '$lib/moon.js';

	let email = '';
	let password = '';
	let loading = false;
	let error = '';
	let mode = 'login'; // 'login' or 'signup'

	const phase = moonPhase();

	async function handleAuth() {
		loading = true;
		error = '';

		try {
			if (mode === 'signup') {
				const { error: signUpError } = await supabase.auth.signUp({
					email,
					password
				});

				if (signUpError) throw signUpError;

				toast.success('Check your email for the confirmation link!');
			} else {
				const { error: signInError } = await supabase.auth.signInWithPassword({
					email,
					password
				});

				if (signInError) throw signInError;

				// After login, check if user has a profile/role
				const { data: userData } = await supabase.auth.getUser();
				const uid = userData?.user?.id;

				if (uid) {
					const { data: profile, error: profileError } = await supabase
						.from('profiles')
						.select('*')
						.eq('id', uid)
						.maybeSingle();

					if (profileError) throw profileError;

					// If no profile or no role yet, send to setup
					if (!profile || !profile.role) {
						goto('/setup');
						return;
					}
				}

				// Otherwise go to dashboard
				goto('/dashboard');
			}
		} catch (err) {
			error = err.message;
		} finally {
			loading = false;
		}
	}
</script>

<div class="gate">
	<div class="gate-corner">
		<ThemeToggle compact />
	</div>

	<!-- The card itself: a piece of major arcana. -->
	<div class="arcanum">
		<span class="numeral" aria-hidden="true">0</span>

		<header class="crest">
			<MoonPhase size={38} />
			<h1>Family Hub</h1>
			<p class="motto">{phase.name} &mdash; {phase.meaning}</p>
		</header>

		<div class="rule" aria-hidden="true"><Icon name="star" size={11} /></div>

		<h2>{mode === 'login' ? 'Welcome back to the hearth' : 'Take your place at the hearth'}</h2>

		{#if error}
			<div class="error" role="alert">
				<Icon name="warning" size={16} />
				<span>{error}</span>
			</div>
		{/if}

		<form on:submit|preventDefault={handleAuth}>
			<div class="input-group">
				<label for="email">Email</label>
				<input id="email" type="email" bind:value={email} placeholder="you@example.com" required />
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

			<button type="submit" class="btn btn-primary btn-large enter" disabled={loading}>
				{#if loading}
					<span class="wisp" aria-hidden="true"></span>
					<span>Opening…</span>
				{:else}
					<Icon name={mode === 'login' ? 'door' : 'candle'} size={16} />
					<span>{mode === 'login' ? 'Enter' : 'Light a candle'}</span>
				{/if}
			</button>
		</form>

		<p class="toggle">
			{mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
			<button class="link" on:click={() => (mode = mode === 'login' ? 'signup' : 'login')}>
				{mode === 'login' ? 'Sign up' : 'Sign in'}
			</button>
		</p>
	</div>
</div>

<style>
	/* The login page owns the full viewport — no nav, no chrome. */
	:global(body) {
		padding-top: 0 !important;
		padding-bottom: 0 !important;
	}

	.gate {
		position: relative;
		min-height: 100vh;
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: clamp(1rem, 5vw, 2.5rem);
		padding-top: calc(clamp(1rem, 5vw, 2.5rem) + var(--safe-top));
		padding-bottom: calc(clamp(1rem, 5vw, 2.5rem) + var(--safe-bottom));
	}

	.gate-corner {
		position: absolute;
		top: calc(1rem + var(--safe-top));
		right: 1rem;
	}

	/* ── The card ───────────────────────────────────────────── */
	.arcanum {
		position: relative;
		width: 100%;
		max-width: 420px;
		padding: clamp(1.75rem, 6vw, 2.75rem);
		background: var(--surface);
		background-image: linear-gradient(165deg, var(--accent-tint), transparent 55%);
		border: 1px solid var(--border-gilt);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-xl);
		animation: deal 0.6s var(--ease-out-expo);
	}

	/* Inner rule — the second line of the tarot frame */
	.arcanum::before {
		content: '';
		position: absolute;
		inset: 7px;
		border: 1px solid var(--border-soft);
		border-radius: calc(var(--radius-lg) - 5px);
		pointer-events: none;
	}

	/* Gilt corner brackets */
	.arcanum::after {
		content: '';
		position: absolute;
		inset: 15px;
		pointer-events: none;
		background:
			linear-gradient(var(--border-gilt), var(--border-gilt)) 0 0 / 14px 1px no-repeat,
			linear-gradient(var(--border-gilt), var(--border-gilt)) 0 0 / 1px 14px no-repeat,
			linear-gradient(var(--border-gilt), var(--border-gilt)) 100% 0 / 14px 1px no-repeat,
			linear-gradient(var(--border-gilt), var(--border-gilt)) 100% 0 / 1px 14px no-repeat,
			linear-gradient(var(--border-gilt), var(--border-gilt)) 0 100% / 14px 1px no-repeat,
			linear-gradient(var(--border-gilt), var(--border-gilt)) 0 100% / 1px 14px no-repeat,
			linear-gradient(var(--border-gilt), var(--border-gilt)) 100% 100% / 14px 1px no-repeat,
			linear-gradient(var(--border-gilt), var(--border-gilt)) 100% 100% / 1px 14px no-repeat;
	}

	@keyframes deal {
		from {
			opacity: 0;
			transform: translateY(20px) rotate(-1.5deg) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) rotate(0) scale(1);
		}
	}

	/* Card number, like a real arcanum */
	.numeral {
		position: absolute;
		top: 1.15rem;
		left: 1.35rem;
		font-family: var(--font-display);
		font-size: 0.85rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: var(--border-gilt);
	}

	.crest {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		text-align: center;
	}

	h1 {
		font-family: var(--font-wordmark);
		font-size: clamp(1.75rem, 7vw, 2.25rem);
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--accent-bright);
		text-shadow: 0 0 30px var(--accent-dim);
	}

	.motto {
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	h2 {
		text-align: center;
		font-family: var(--font-body);
		font-size: 0.98rem;
		font-weight: 400;
		font-style: italic;
		letter-spacing: 0.01em;
		color: var(--text-muted);
		margin-bottom: 1.75rem;
	}

	.error {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.7rem 0.9rem;
		margin-bottom: 1.25rem;
		background: var(--danger-dim);
		border: 1px solid var(--danger);
		border-radius: var(--radius-sm);
		color: var(--danger);
		font-size: 0.9rem;
		--icon-accent: var(--danger);
	}

	form {
		position: relative;
		z-index: 1;
	}

	.enter {
		width: 100%;
		margin-top: 0.5rem;
	}

	/* A little will-o'-the-wisp while the door opens */
	.wisp {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(0, 0, 0, 0.25);
		border-top-color: var(--text-on-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.toggle {
		text-align: center;
		margin-top: 1.5rem;
		font-size: 0.9rem;
		color: var(--text-faint);
	}

	.link {
		min-height: auto;
		padding: 0;
		background: none;
		border: none;
		color: var(--accent-bright);
		font-family: inherit;
		font-size: inherit;
		font-weight: 700;
		cursor: pointer;
		border-bottom: 1px solid var(--border-gilt);
		transition: all var(--transition-fast);
	}

	.link:hover {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}
</style>
