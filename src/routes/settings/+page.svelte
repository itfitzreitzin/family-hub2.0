<script>
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { goto } from '$app/navigation';
	import { toast, prompt as promptModal } from '$lib/stores/toast.js';
	import Nav from '$lib/Nav.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import MoonPhase from '$lib/components/MoonPhase.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	/** @type {Record<string, string>} */
	const ROLE_TITLES = {
		admin: 'The Keeper',
		family: 'The Household',
		nanny: 'The Guardian'
	};

	let user = null;
	/** @type {any} */
	let profile = null;
	let loading = true;
	let saving = false;

	// Form fields
	let fullName = '';
	let hourlyRate = 20;
	let venmoUsername = '';
	let role = 'nanny';

	onMount(async () => {
		const {
			data: { user: currentUser }
		} = await supabase.auth.getUser();

		if (!currentUser) {
			goto('/');
			return;
		}

		user = currentUser;

		// Get profile
		const { data: profileData } = await supabase
			.from('profiles')
			.select('*')
			.eq('id', user.id)
			.maybeSingle();

		profile = profileData;

		// Populate form
		if (profile) {
			fullName = profile.full_name || '';
			hourlyRate = profile.hourly_rate || 20;
			venmoUsername = profile.venmo_username || '';
			role = profile.role || 'nanny';
		}

		loading = false;
	});

	async function saveSettings() {
		saving = true;

		try {
			const updateData = {
				full_name: fullName
			};

			// Only update these fields for nannies or admins
			if (profile?.role === 'nanny' || profile?.role === 'admin') {
				updateData.hourly_rate = hourlyRate;
				updateData.venmo_username = venmoUsername;
			}

			// Only admin can change role
			if (profile?.role === 'admin') {
				updateData.role = role;
			}

			const { error } = await supabase.from('profiles').update(updateData).eq('id', user.id);

			if (error) throw error;

			toast.success('Settings saved!');

			// Reload profile
			const { data: updatedProfile } = await supabase
				.from('profiles')
				.select('*')
				.eq('id', user.id)
				.maybeSingle();

			profile = updatedProfile;
		} catch (err) {
			toast.error('Error saving settings: ' + err.message);
		} finally {
			saving = false;
		}
	}

	async function changePassword() {
		const newPassword = await promptModal.show({
			title: 'Change Password',
			message: 'Enter your new password (min 6 characters):',
			placeholder: 'New password',
			inputType: 'password'
		});

		if (!newPassword || newPassword.length < 6) {
			toast.error('Password must be at least 6 characters');
			return;
		}

		try {
			const { error } = await supabase.auth.updateUser({
				password: newPassword
			});

			if (error) throw error;

			toast.success('Password changed!');
		} catch (err) {
			toast.error('Error changing password: ' + err.message);
		}
	}
</script>

<Nav currentPage="settings" />

{#if loading}
	<div class="container"><Skeleton variant="card" count={2} /></div>
{:else}
	<div class="container">
		<header class="page-head">
			<div>
				<h1>Settings</h1>
				<p class="lede">The Self — your name, your rate, your candle.</p>
			</div>
			<ThemeToggle />
		</header>

		<div class="card arcana">
			<h2>Your Card</h2>

			<div class="identity">
				<span class="sigil" aria-hidden="true"><Icon name="candle" size={28} /></span>
				<div class="identity-body">
					<p class="identity-email">{user.email}</p>
					<div class="identity-badges">
						<span class="badge badge-gilt">{ROLE_TITLES[profile?.role] || profile?.role}</span>
						{#if profile?.role === 'admin'}
							<span class="badge badge-arcane"><Icon name="key" size={16} /> Keys</span>
						{/if}
					</div>
				</div>
			</div>

			<form on:submit|preventDefault={saveSettings}>
				<div class="form-group">
					<label for="fullName">Full name</label>
					<input
						id="fullName"
						type="text"
						bind:value={fullName}
						placeholder="Your full name"
						required
					/>
				</div>

				{#if profile?.role === 'admin'}
					<div class="form-group">
						<label for="role">Role</label>
						<select id="role" bind:value={role}>
							<option value="nanny">Nanny — The Guardian</option>
							<option value="family">Family — The Household</option>
							<option value="admin">Admin — The Keeper</option>
						</select>
						<small>Keepers may change their own role.</small>
					</div>
				{/if}

				{#if profile?.role === 'nanny' || profile?.role === 'admin'}
					<div class="form-group">
						<label for="hourlyRate">Hourly rate ($)</label>
						<input
							id="hourlyRate"
							type="number"
							bind:value={hourlyRate}
							min="0"
							step="0.50"
							required
						/>
						{#if profile?.role === 'admin'}
							<small>Your personal rate, for testing.</small>
						{/if}
					</div>

					<div class="form-group">
						<label for="venmo">Venmo username</label>
						<input id="venmo" type="text" bind:value={venmoUsername} placeholder="@username" />
						<small>Used when generating payments.</small>
					</div>
				{/if}

				<button type="submit" class="btn btn-primary" disabled={saving}>
					<Icon name="check" size={16} />
					{saving ? 'Saving…' : 'Save'}
				</button>
			</form>
		</div>

		<div class="card arcana">
			<h2>Wards</h2>
			<p class="section-note">Change the password that guards your account.</p>
			<button class="btn btn-secondary" on:click={changePassword}>
				<Icon name="key" size={16} /> Change password
			</button>
		</div>

		<div class="card arcana about">
			<h2>Colophon</h2>
			<div class="about-body">
				<MoonPhase size={30} showLabel />
				<p>Family Hub — a hearth for schedules, shifts and small magics.</p>
				<p class="version">Version 1.0.0</p>
			</div>
		</div>
	</div>
{/if}

<style>
	.page-head h1 {
		color: var(--accent-bright);
	}

	.lede {
		color: var(--text-faint);
		font-size: 0.95rem;
		margin-top: 0.2rem;
	}

	.identity {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1.1rem;
		margin-bottom: 1.5rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--card-radius);
	}

	.sigil {
		display: grid;
		place-items: center;
		width: 52px;
		height: 52px;
		flex-shrink: 0;
		border: 1px solid var(--border-gilt);
		border-radius: 50%;
		background: var(--accent-tint);
		color: var(--text-faint);
		--icon-accent: var(--accent);
	}

	/* Body face, not Cinzel — an inscriptional roman mangles an email address. */
	.identity-email {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
		margin-bottom: 0.4rem;
		word-break: break-word;
	}

	.identity-badges {
		display: flex;
		gap: 0.45rem;
		flex-wrap: wrap;
		--icon-accent: var(--arcane);
	}

	.section-note {
		color: var(--text-muted);
		font-size: 0.92rem;
		margin-bottom: 1rem;
	}

	.about-body {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		text-align: center;
		color: var(--text-muted);
		font-size: 0.92rem;
	}

	.version {
		font-variant-numeric: tabular-nums;
		color: var(--text-faint);
		font-size: 0.85rem;
	}
</style>
