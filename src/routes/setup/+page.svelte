<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { toast } from '$lib/stores/toast.js';
	import { supabase } from '$lib/supabase';
	import Icon from '$lib/icons/Icon.svelte';
	import MoonPhase from '$lib/components/MoonPhase.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	// The two roles, dressed as minor arcana.
	const ROLES = [
		{
			value: 'family',
			name: 'Family Member',
			title: 'The Household',
			desc: 'Keep the schedules, settle the accounts, mind the calendar.',
			icon: 'cottage',
			numeral: 'I'
		},
		{
			value: 'nanny',
			name: 'Nanny / Caregiver',
			title: 'The Guardian',
			desc: 'Track your hours, watch the little ones, collect your due.',
			icon: 'sprout',
			numeral: 'II'
		}
	];

	let user = null;
	let fullName = '';
	let role = '';
	let hourlyRate = 20;
	let venmoUsername = '';
	let loading = false;

	onMount(async () => {
		const {
			data: { user: currentUser }
		} = await supabase.auth.getUser();

		if (!currentUser) {
			goto('/');
			return;
		}

		user = currentUser;

		// Pre-fill email as name suggestion
		fullName = currentUser.email.split('@')[0];
	});

	async function completeSetup() {
		if (!role) {
			toast.error('Please select your role');
			return;
		}

		if (!fullName) {
			toast.error('Please enter your name');
			return;
		}

		loading = true;

		try {
			const { error } = await supabase.from('profiles').upsert({
				id: user.id,
				role,
				full_name: fullName,
				hourly_rate: role === 'nanny' ? hourlyRate : null,
				venmo_username: role === 'nanny' ? venmoUsername : null
			});

			if (error) throw error;

			// Redirect to dashboard
			goto('/dashboard');
		} catch (err) {
			toast.error('Error: ' + err.message);
			loading = false;
		}
	}
</script>

<div class="gate">
	<div class="gate-corner">
		<ThemeToggle compact />
	</div>

	<div class="arcanum">
		<header class="crest">
			<MoonPhase size={34} />
			<h1>Choose your card</h1>
			<p class="motto">Every hearth needs its keepers</p>
		</header>

		<div class="rule" aria-hidden="true"><Icon name="star" size={11} /></div>

		<div class="role-selection">
			{#each ROLES as option (option.value)}
				<label class="role-card" class:selected={role === option.value}>
					<input type="radio" bind:group={role} value={option.value} />
					<span class="numeral" aria-hidden="true">{option.numeral}</span>
					<span class="role-icon"><Icon name={option.icon} size={40} /></span>
					<span class="role-body">
						<span class="role-name">{option.name}</span>
						<span class="role-title">{option.title}</span>
						<span class="role-desc">{option.desc}</span>
					</span>
					<span class="tick" aria-hidden="true"><Icon name="check" size={14} /></span>
				</label>
			{/each}
		</div>

		{#if role}
			<div class="details-form">
				<div class="rule" aria-hidden="true"><Icon name="quill" size={11} /></div>

				<div class="input-group">
					<label for="name">Full name</label>
					<input id="name" type="text" bind:value={fullName} placeholder="Your name" required />
				</div>

				{#if role === 'nanny'}
					<div class="input-group">
						<label for="rate">Hourly rate ($)</label>
						<input
							id="rate"
							type="number"
							bind:value={hourlyRate}
							placeholder="20"
							min="0"
							step="0.50"
						/>
					</div>

					<div class="input-group">
						<label for="venmo">Venmo username <span class="optional">(optional)</span></label>
						<input id="venmo" type="text" bind:value={venmoUsername} placeholder="@username" />
					</div>
				{/if}

				<button class="btn btn-primary btn-large seal" on:click={completeSetup} disabled={loading}>
					{#if loading}
						<span class="wisp" aria-hidden="true"></span>
						<span>Setting the table…</span>
					{:else}
						<Icon name="key" size={16} />
						<span>Take your place</span>
					{/if}
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

	/* ── Role cards: two minor arcana to choose between ── */
	.role-selection {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.role-card {
		position: relative;
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: 0;
		padding: 1rem 1.1rem;
		text-transform: none;
		letter-spacing: normal;
		font-size: 1rem;
		font-weight: 400;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		cursor: pointer;
		transition: all var(--transition-normal);
		--icon-accent: var(--text-faint);
		color: var(--text-muted);
	}

	.role-card:hover {
		border-color: var(--border-gilt);
		transform: translateY(-2px);
		--icon-accent: var(--accent);
	}

	.role-card.selected {
		border-color: var(--accent);
		background: var(--accent-tint);
		box-shadow: var(--glow-gilt);
		--icon-accent: var(--accent-bright);
	}

	.role-card input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}

	.numeral {
		position: absolute;
		top: 0.45rem;
		right: 0.65rem;
		font-family: var(--font-display);
		font-size: 0.72rem;
		letter-spacing: 0.1em;
		color: var(--border-gilt);
	}

	.role-icon {
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	.role-body {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.role-name {
		font-family: var(--font-display);
		font-size: 1.02rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		color: var(--text);
	}

	.role-title {
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.role-desc {
		font-size: 0.88rem;
		color: var(--text-faint);
		line-height: 1.4;
	}

	.tick {
		margin-left: auto;
		flex-shrink: 0;
		color: var(--accent-bright);
		opacity: 0;
		transform: scale(0.6);
		transition: all var(--transition-normal);
	}

	.role-card.selected .tick {
		opacity: 1;
		transform: scale(1);
	}

	.details-form {
		animation: rise 0.4s var(--ease-out-expo);
	}

	.optional {
		text-transform: none;
		letter-spacing: normal;
		font-weight: 400;
		opacity: 0.7;
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
