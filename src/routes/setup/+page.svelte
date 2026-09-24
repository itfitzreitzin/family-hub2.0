<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from '$lib/stores/toast.js';
	import { supabase } from '$lib/supabase';
	import { errorMessage } from '$lib/errors.js';
	import { landingFor } from '$lib/nav.js';
	import Icon from '$lib/icons/Icon.svelte';
	import MoonPhase from '$lib/components/MoonPhase.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	/*
	 * A new account doesn't choose its own role: an admin lets people in
	 * (Settings → Accounts → Waiting to be let in), and the database refuses a role set any
	 * other way (supabase/household_access.sql). Until then this is where a
	 * new account waits: leave a name so the admin knows who is knocking.
	 */

	/** @type {any} */
	let user = null;
	let fullName = '';
	let saved = false;
	let loading = false;
	let checking = false;

	onMount(async () => {
		const {
			data: { user: currentUser }
		} = await supabase.auth.getUser();

		if (!currentUser) {
			goto(resolve('/'));
			return;
		}

		user = currentUser;

		const { data: profile } = await supabase
			.from('profiles')
			.select('role, full_name')
			.eq('id', user.id)
			.maybeSingle();

		if (profile?.role) {
			goto(resolve(landingFor(profile.role)));
			return;
		}

		saved = !!profile?.full_name;
		// Pre-fill email as name suggestion
		fullName = profile?.full_name || currentUser.email.split('@')[0];
	});

	async function saveName() {
		const name = fullName.trim();
		if (!name) {
			toast.error('Please enter your name');
			return;
		}

		loading = true;
		try {
			const { error } = await supabase.from('profiles').upsert({ id: user.id, full_name: name });
			if (error) throw error;
			saved = true;
		} catch (err) {
			toast.error('Error: ' + errorMessage(err));
		} finally {
			loading = false;
		}
	}

	async function checkAgain() {
		checking = true;
		try {
			const { data: profile } = await supabase
				.from('profiles')
				.select('role')
				.eq('id', user.id)
				.maybeSingle();
			if (profile?.role) {
				goto(resolve(landingFor(profile.role)));
			} else {
				toast.info('Not yet — ask an admin to let you in.');
			}
		} finally {
			checking = false;
		}
	}

	async function signOut() {
		await supabase.auth.signOut();
		goto(resolve('/'));
	}
</script>

<div class="gate">
	<div class="gate-corner">
		<ThemeToggle compact />
	</div>

	<div class="arcanum">
		<header class="crest">
			<MoonPhase size={34} />
			<h1>Almost in</h1>
			<p class="motto">An admin lets new people in</p>
		</header>

		<div class="rule" aria-hidden="true"><Icon name="star" size={11} /></div>

		{#if !saved}
			<p class="waiting-note">
				Leave your name so they know who's knocking. Once they've let you in, this opens the app.
			</p>

			<div class="details-form">
				<div class="input-group">
					<label for="name">Full name</label>
					<input id="name" type="text" bind:value={fullName} placeholder="Your name" required />
				</div>

				<button class="btn btn-primary btn-large seal" on:click={saveName} disabled={loading}>
					{#if loading}
						<span class="wisp" aria-hidden="true"></span>
						<span>Saving…</span>
					{:else}
						<Icon name="door" size={16} />
						<span>Knock</span>
					{/if}
				</button>
			</div>
		{:else}
			<p class="waiting-note">
				Thanks, <strong>{fullName}</strong>. Ask whoever runs Family Hub for your household to let
				you in from Settings → Accounts, then check again.
			</p>

			<div class="after-actions">
				<button class="btn btn-primary" on:click={checkAgain} disabled={checking}>
					<Icon name="key" size={16} />
					{checking ? 'Checking…' : 'Check again'}
				</button>
				<button class="btn btn-secondary" on:click={signOut}>
					<Icon name="door" size={16} />
					Sign out
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
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

	.arcanum {
		position: relative;
		width: 100%;
		max-width: 480px;
		padding: clamp(1.75rem, 6vw, 2.5rem);
		background: var(--surface);
		background-image: linear-gradient(165deg, var(--accent-tint), transparent 55%);
		border: 1px solid var(--border-gilt);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-xl);
		animation: deal 0.6s var(--ease-out-expo);
	}

	.arcanum::before {
		content: '';
		position: absolute;
		inset: 7px;
		border: 1px solid var(--border-soft);
		border-radius: calc(var(--radius-lg) - 5px);
		pointer-events: none;
	}

	@keyframes deal {
		from {
			opacity: 0;
			transform: translateY(20px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.crest {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		text-align: center;
	}

	h1 {
		font-family: var(--font-display);
		font-size: clamp(1.4rem, 5vw, 1.8rem);
		font-weight: 700;
		letter-spacing: 0.05em;
		color: var(--accent-bright);
	}

	.motto {
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.details-form {
		animation: rise 0.4s var(--ease-out-expo);
	}

	.waiting-note {
		margin: 0 0 1.1rem;
		font-size: 0.98rem;
		line-height: 1.55;
		color: var(--text-muted);
		text-align: center;
	}

	.waiting-note strong {
		color: var(--text);
	}

	.after-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 0.75rem;
	}

	.after-actions .btn {
		flex: 1;
	}

	.seal {
		width: 100%;
		margin-top: 0.5rem;
	}

	.wisp {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(0, 0, 0, 0.25);
		border-top-color: var(--text-on-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
</style>
