<script>
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { goto } from '$app/navigation';
	import { toast, confirm as confirmModal } from '$lib/stores/toast.js';
	import Nav from '$lib/Nav.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	let user = null;
	let profile = null;
	let loading = true;
	let nannies = [];
	let selectedNanny = null;
	let showAddNanny = false;

	// Add/Edit nanny form
	let nannyEmail = '';
	let nannyName = '';
	let nannyRate = 20;
	let nannyVenmo = '';
	let nannyPassword = '';

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

		// Only admin can access this page
		if (profile?.role !== 'admin') {
			toast.error('Access denied. Admin only.');
			goto('/dashboard');
			return;
		}

		await loadNannies();
		loading = false;
	});

	async function loadNannies() {
		const { data } = await supabase
			.from('profiles')
			.select('*')
			.eq('role', 'nanny')
			.order('full_name');

		nannies = data || [];
	}

	function editNanny(nanny) {
		selectedNanny = nanny;
		nannyName = nanny.full_name;
		nannyRate = nanny.hourly_rate;
		nannyVenmo = nanny.venmo_username || '';
		nannyEmail = ''; // Can't change email easily
		nannyPassword = '';
		showAddNanny = true;
	}

	async function saveNanny() {
		if (!nannyName) {
			toast.error('Name is required');
			return;
		}

		try {
			if (selectedNanny) {
				// Update existing nanny
				const { error } = await supabase
					.from('profiles')
					.update({
						full_name: nannyName,
						hourly_rate: nannyRate,
						venmo_username: nannyVenmo
					})
					.eq('id', selectedNanny.id);

				if (error) throw error;

				toast.success('Nanny updated!');
			} else {
				// Create new nanny - need to create auth user first
				if (!nannyEmail || !nannyPassword) {
					toast.error('Email and password required for new nanny');
					return;
				}

				// Note: In production, you'd want to do this via an admin API
				// For now, this creates an account that needs email confirmation
				const { data: authData, error: authError } = await supabase.auth.signUp({
					email: nannyEmail,
					password: nannyPassword
				});

				if (authError) throw authError;

				// Create profile
				const { error: profileError } = await supabase.from('profiles').insert({
					id: authData.user.id,
					role: 'nanny',
					full_name: nannyName,
					hourly_rate: nannyRate,
					venmo_username: nannyVenmo
				});

				if (profileError) throw profileError;

				toast.success('Nanny created! They can log in with: ' + nannyEmail);
			}

			cancelNannyForm();
			await loadNannies();
		} catch (err) {
			toast.error('Error: ' + err.message);
		}
	}

	async function deleteNanny(nanny) {
		const confirmed = await confirmModal.show({
			title: 'Delete Nanny',
			message: `Delete ${nanny.full_name}? This will also delete all their time entries.`,
			confirmText: 'Delete',
			danger: true
		});
		if (!confirmed) return;

		try {
			// Delete time entries first
			await supabase.from('time_entries').delete().eq('nanny_id', nanny.id);

			// Delete profile
			const { error } = await supabase.from('profiles').delete().eq('id', nanny.id);

			if (error) throw error;

			toast.success('Nanny deleted');
			await loadNannies();
		} catch (err) {
			toast.error('Error deleting: ' + err.message);
		}
	}

	function cancelNannyForm() {
		showAddNanny = false;
		selectedNanny = null;
		nannyEmail = '';
		nannyName = '';
		nannyRate = 20;
		nannyVenmo = '';
		nannyPassword = '';
	}

	async function viewNannyHistory(nanny) {
		// Redirect to history page with filter (we'll add this feature next)
		goto(`/history?nanny=${nanny.id}`);
	}
</script>

<Nav currentPage="admin" />

{#if loading}
	<div class="container"><Skeleton variant="card" count={3} /></div>
{:else}
	<div class="container">
		<header class="page-head">
			<div>
				<h1>Admin</h1>
				<p class="lede">The Keys — everything the household can change.</p>
			</div>
			<button class="btn btn-primary" on:click={() => (showAddNanny = true)}>
				<Icon name="plus" size={16} /> Add a keeper
			</button>
		</header>

		<div class="card arcana">
			<h2>Keepers ({nannies.length})</h2>

			{#if nannies.length === 0}
				<EmptyState
					icon="cauldron"
					title="No keepers yet"
					hint="Add someone and their hours, rate and payments all become manageable from here."
				>
					<button class="btn btn-primary" on:click={() => (showAddNanny = true)}>
						<Icon name="plus" size={16} /> Add the first
					</button>
				</EmptyState>
			{:else}
				<div class="nanny-grid rise-in">
					{#each nannies as nanny (nanny.id)}
						<article class="nanny-card">
							<div class="nanny-top">
								<span class="sigil" aria-hidden="true"><Icon name="person" size={24} /></span>
								<div class="nanny-info">
									<h3>{nanny.full_name}</h3>
									<p class="rate">${nanny.hourly_rate}/hour</p>
									{#if nanny.venmo_username}
										<p class="venmo">@{nanny.venmo_username}</p>
									{/if}
								</div>
							</div>

							<div class="nanny-actions">
								<button class="btn-small" on:click={() => viewNannyHistory(nanny)}>
									<Icon name="scroll" size={16} /> Ledger
								</button>
								<button class="btn-small" on:click={() => editNanny(nanny)}>
									<Icon name="quill" size={16} /> Edit
								</button>
								<button class="btn-small danger" on:click={() => deleteNanny(nanny)}>
									<Icon name="urn" size={16} />
									<span class="visually-hidden">Delete {nanny.full_name}</span>
								</button>
							</div>
						</article>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	{#if showAddNanny}
		<div class="modal-overlay" on:click={cancelNannyForm} role="presentation">
			<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
				<h2>{selectedNanny ? 'Edit keeper' : 'Add a keeper'}</h2>

				<form on:submit|preventDefault={saveNanny}>
					<div class="form-group">
						<label for="an">Full name *</label>
						<input id="an" type="text" bind:value={nannyName} required />
					</div>

					{#if !selectedNanny}
						<div class="form-group">
							<label for="ae">Email *</label>
							<input id="ae" type="email" bind:value={nannyEmail} required />
						</div>

						<div class="form-group">
							<label for="ap">Password * <span class="hint">(min 6 characters)</span></label>
							<input id="ap" type="password" bind:value={nannyPassword} minlength="6" required />
						</div>
					{/if}

					<div class="form-group">
						<label for="ar">Hourly rate ($)</label>
						<input id="ar" type="number" bind:value={nannyRate} min="0" step="0.50" />
					</div>

					<div class="form-group">
						<label for="av">Venmo username</label>
						<input id="av" type="text" bind:value={nannyVenmo} placeholder="@username" />
					</div>

					<div class="button-row">
						<button type="submit" class="btn btn-primary">
							<Icon name="check" size={16} />
							{selectedNanny ? 'Save changes' : 'Add to the hearth'}
						</button>
						<button type="button" class="btn btn-secondary" on:click={cancelNannyForm}
							>Cancel</button
						>
					</div>
				</form>
			</div>
		</div>
	{/if}
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

	.nanny-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
		gap: var(--grid-gap);
	}

	.nanny-card {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.15rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		transition: all var(--transition-normal);
	}

	.nanny-card:hover {
		transform: translateY(-2px);
		border-color: var(--border-gilt);
		box-shadow: var(--shadow-md);
	}

	.nanny-top {
		display: flex;
		align-items: flex-start;
		gap: 0.85rem;
	}

	.sigil {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		flex-shrink: 0;
		border: 1px solid var(--border-soft);
		border-radius: 50%;
		background: var(--accent-tint);
		color: var(--text-faint);
		--icon-accent: var(--accent);
	}

	.nanny-info h3 {
		font-family: var(--font-display);
		font-size: 1.02rem;
		color: var(--text);
	}

	.rate {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--accent-bright);
		font-size: 0.95rem;
	}

	.venmo {
		font-size: 0.85rem;
		color: var(--text-faint);
	}

	.nanny-actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.nanny-actions .danger:hover {
		color: var(--danger);
		border-color: var(--danger);
		background: var(--danger-dim);
	}

	.hint {
		text-transform: none;
		letter-spacing: normal;
		font-weight: 400;
		opacity: 0.7;
	}
</style>
