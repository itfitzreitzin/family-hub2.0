<script>
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { goto } from '$app/navigation';
	import { toast } from '$lib/stores/toast.js';
	import { confirm as confirmModal } from '$lib/stores/toast.js';
	import Nav from '$lib/Nav.svelte';
	import { errorMessage } from '$lib/errors.js';
	import { MEMBER_KINDS, memberPortrait, ageLabel } from '$lib/family.js';
	import Icon from '$lib/icons/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	/** @type {any} */
	let user = null;
	/** @type {any} */
	let profile = null;
	/** @type {any[]} */
	let members = [];
	/** @type {any[]} */
	let householdProfiles = [];

	let initializing = true;
	/** @type {string | null} */
	let initError = null;
	let saving = false;

	// Add / edit modal
	let showMemberModal = false;
	/** @type {any} */
	let editingMember = null;
	let memberForm = {
		kind: 'child',
		name: '',
		birthdate: '',
		current_focus: '',
		species: '',
		avatar_url: '',
		profile_id: /** @type {string | null} */ (null),
		notes: ''
	};

	onMount(() => {
		initFamily();
	});

	async function initFamily() {
		initializing = true;
		initError = null;

		try {
			const {
				data: { user: currentUser }
			} = await supabase.auth.getUser();

			if (!currentUser) {
				goto('/');
				return;
			}

			user = currentUser;

			const { data: profileData, error: profileError } = await supabase
				.from('profiles')
				.select('*')
				.eq('id', user.id)
				.maybeSingle();

			if (profileError) throw profileError;
			profile = profileData;

			await Promise.all([loadMembers(), loadProfiles()]);

			initializing = false;
		} catch (err) {
			initError = errorMessage(err);
			initializing = false;
		}
	}

	async function loadMembers() {
		const { data, error } = await supabase.from('family_members').select('*');

		if (error) throw error;

		// Oldest first within each kind reads naturally on the cards; members
		// without a birthdate sink to the end, then names break ties.
		members = (data || []).sort((a, b) => {
			const ad = a.birthdate || '9999-12-31';
			const bd = b.birthdate || '9999-12-31';
			if (ad !== bd) return ad.localeCompare(bd);
			return (a.name || '').localeCompare(b.name || '');
		});
	}

	// Parent accounts, for the "holds a key" link. Nanny profiles stay out —
	// caregivers are payroll, not family_members.
	async function loadProfiles() {
		const { data, error } = await supabase
			.from('profiles')
			.select('id, full_name, role')
			.in('role', ['family', 'admin'])
			.order('full_name');

		if (error) throw error;
		householdProfiles = data || [];
	}

	$: canManage = profile?.role === 'family' || profile?.role === 'admin';
	$: sections = MEMBER_KINDS.map((k) => ({
		...k,
		members: members.filter((m) => m.kind === k.kind)
	}));
	// Accounts offered by the link select: unlinked ones, plus whichever the
	// member being edited already holds.
	$: linkableProfiles = householdProfiles.filter(
		(p) => !members.some((m) => m.profile_id === p.id && m.id !== editingMember?.id)
	);

	/** @param {any} p */
	function profileName(p) {
		return p?.full_name || 'Unnamed account';
	}

	/** @param {string} kind */
	function openAddMember(kind = 'child') {
		editingMember = null;
		memberForm = {
			kind,
			name: '',
			birthdate: '',
			current_focus: '',
			species: '',
			avatar_url: '',
			profile_id: null,
			notes: ''
		};
		showMemberModal = true;
	}

	/** @param {any} member */
	function openEditMember(member) {
		editingMember = member;
		memberForm = {
			kind: member.kind,
			name: member.name || '',
			birthdate: member.birthdate || '',
			current_focus: member.current_focus || '',
			species: member.species || '',
			avatar_url: member.avatar_url || '',
			profile_id: member.profile_id || null,
			notes: member.notes || ''
		};
		showMemberModal = true;
	}

	async function saveMember() {
		if (saving) return;

		const name = memberForm.name.trim();
		if (!name) {
			toast.error('The member needs a name');
			return;
		}

		// Kind-specific fields don't survive a kind change: a pet keeps no
		// account link, a parent no species.
		const row = {
			kind: memberForm.kind,
			name,
			birthdate: memberForm.birthdate || null,
			avatar_url: memberForm.avatar_url.trim() || null,
			current_focus: memberForm.kind === 'child' ? memberForm.current_focus.trim() || null : null,
			species: memberForm.kind === 'pet' ? memberForm.species.trim() || null : null,
			profile_id: memberForm.kind === 'parent' ? memberForm.profile_id || null : null,
			notes: memberForm.notes.trim() || null
		};

		saving = true;

		try {
			if (editingMember) {
				const { error } = await supabase
					.from('family_members')
					.update(row)
					.eq('id', editingMember.id);

				if (error) throw error;
				toast.success(`${name} updated`);
			} else {
				const { error } = await supabase.from('family_members').insert(row);

				if (error) throw error;
				toast.success(`${name} joins the family`);
			}

			showMemberModal = false;
			await loadMembers();
		} catch (err) {
			if (/** @type {any} */ (err).code === '23505') {
				// Unique index one_member_per_profile
				toast.error('That account is already linked to another member.');
			} else {
				toast.error('Error saving: ' + errorMessage(err));
			}
		} finally {
			saving = false;
		}
	}

	async function deleteMember() {
		if (!editingMember || saving) return;

		const confirmed = await confirmModal.show({
			title: 'Remove Member',
			message: `Remove ${editingMember.name} from the family roster? This cannot be undone.`,
			confirmText: 'Remove',
			danger: true
		});
		if (!confirmed) return;

		saving = true;

		try {
			const { error } = await supabase.from('family_members').delete().eq('id', editingMember.id);

			if (error) throw error;

			toast.success(`${editingMember.name} removed`);
			showMemberModal = false;
			editingMember = null;
			await loadMembers();
		} catch (err) {
			toast.error('Error removing: ' + errorMessage(err));
		} finally {
			saving = false;
		}
	}

	/** @param {KeyboardEvent} event */
	function handleModalKeydown(event) {
		if (event.key === 'Escape' && showMemberModal) showMemberModal = false;
	}
</script>

<svelte:window on:keydown={handleModalKeydown} />

<Nav currentPage="family" />

<div class="container">
	{#if initializing}
		<Skeleton variant="card" count={3} />
	{:else if initError}
		<div class="card arcana">
			<EmptyState icon="warning" title="The roster won't open" hint={initError}>
				<button class="btn btn-primary" on:click={initFamily}>
					<Icon name="star" size={16} /> Try again
				</button>
			</EmptyState>
		</div>
	{:else}
		<!-- ── Head ─────────────────────────────────────────── -->
		<div class="page-head">
			<div>
				<h1>The Family</h1>
				<p class="lede">Everyone the hearth keeps — parents, kids, and pets.</p>
			</div>
			{#if canManage}
				<button class="btn btn-primary" on:click={() => openAddMember('child')}>
					<Icon name="plus" size={16} /> Add member
				</button>
			{/if}
		</div>

		{#if members.length === 0}
			<div class="card arcana">
				<EmptyState
					icon="heart"
					title="The hearth stands empty"
					hint={canManage
						? 'Add the family — the Chronicle and the Care Day will anchor to them.'
						: 'Once the household adds the family, everyone appears here.'}
				>
					{#if canManage}
						<button class="btn btn-primary" on:click={() => openAddMember('parent')}>
							<Icon name="plus" size={16} /> Add the first member
						</button>
					{/if}
				</EmptyState>
			</div>
		{:else}
			{#each sections as section (section.kind)}
				<div class="card arcana">
					<div class="card-header">
						<h2>{section.plural}</h2>
						<span class="rune-label">
							{section.members.length || 'none yet'}
						</span>
					</div>

					{#if section.members.length === 0}
						<div class="section-empty">
							<p>
								{#if section.kind === 'child'}
									No kids on the roster yet — add the little ones the Chronicle will follow.
								{:else if section.kind === 'pet'}
									No pets yet, and every hearth deserves a cat.
								{:else}
									No parents on the roster yet.
								{/if}
							</p>
							{#if canManage}
								<button class="btn-small" on:click={() => openAddMember(section.kind)}>
									<Icon name="plus" size={14} /> Add {section.label.toLowerCase()}
								</button>
							{/if}
						</div>
					{:else}
						<div class="member-grid">
							{#each section.members as member (member.id)}
								{@const portrait = memberPortrait(member)}
								{@const age = ageLabel(member.birthdate)}
								<div class="member-card">
									{#if canManage}
										<button
											class="icon-btn member-edit"
											on:click={() => openEditMember(member)}
											aria-label={`Edit ${member.name}`}
										>
											<Icon name="quill" size={14} />
										</button>
									{/if}

									{#if portrait}
										<img
											class="member-portrait"
											src={portrait}
											alt=""
											width="64"
											height="64"
											loading="lazy"
											draggable="false"
										/>
									{:else}
										<span class="member-portrait sprite">
											<Icon name="cat" size={34} />
										</span>
									{/if}

									<div class="member-name">
										<span class="member-title">{member.name}</span>
										{#if age}<span class="member-age">{age}</span>{/if}
									</div>

									<div class="member-badges">
										{#if member.kind === 'parent' && member.profile_id}
											<span class="badge badge-gilt" title="Has a login">
												<Icon name="key" size={11} /> Holds a key
											</span>
										{/if}
										{#if member.kind === 'child' && member.current_focus}
											<span class="badge badge-live" title="Current focus">
												<Icon name="sprout" size={11} />
												{member.current_focus}
											</span>
										{/if}
										{#if member.kind === 'pet' && member.species}
											<span class="badge">{member.species}</span>
										{/if}
									</div>

									{#if member.notes}
										<p class="member-notes">{member.notes}</p>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	{/if}
</div>

<!-- ── Add / edit a member ────────────────────────────── -->
{#if showMemberModal}
	<div class="modal-overlay" on:click={() => (showMemberModal = false)} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>{editingMember ? `About ${editingMember.name}` : 'A new member'}</h2>

			<form on:submit|preventDefault={saveMember}>
				<div class="form-group">
					<label for="fm-kind">Who are they</label>
					<select id="fm-kind" bind:value={memberForm.kind}>
						{#each MEMBER_KINDS as k (k.kind)}
							<option value={k.kind}>{k.label}</option>
						{/each}
					</select>
				</div>

				<div class="form-group">
					<label for="fm-name">Name</label>
					<input id="fm-name" type="text" bind:value={memberForm.name} required />
				</div>

				<div class="form-group">
					<label for="fm-bday">Birthdate</label>
					<input id="fm-bday" type="date" bind:value={memberForm.birthdate} />
					<small>Optional — shows an age beside the name.</small>
				</div>

				{#if memberForm.kind === 'child'}
					<div class="form-group">
						<label for="fm-focus">Current focus</label>
						<input
							id="fm-focus"
							type="text"
							bind:value={memberForm.current_focus}
							placeholder="e.g. potty training"
						/>
						<small>The one habit in focus right now — the care cockpit will give it a button.</small
						>
					</div>
				{/if}

				{#if memberForm.kind === 'pet'}
					<div class="form-group">
						<label for="fm-species">Species</label>
						<input
							id="fm-species"
							type="text"
							bind:value={memberForm.species}
							placeholder="e.g. cat"
						/>
					</div>
				{/if}

				{#if memberForm.kind === 'parent'}
					<div class="form-group">
						<label for="fm-account">Their login</label>
						<select id="fm-account" bind:value={memberForm.profile_id}>
							<option value={null}>No account</option>
							{#each linkableProfiles as p (p.id)}
								<option value={p.id}>{profileName(p)}</option>
							{/each}
						</select>
						<small>Linking a parent to their account keeps one record per person.</small>
					</div>
				{/if}

				<div class="form-group">
					<label for="fm-avatar">Portrait URL</label>
					<input
						id="fm-avatar"
						type="url"
						bind:value={memberForm.avatar_url}
						placeholder="https://…"
					/>
					<small>Optional — until then a painted portrait stands in.</small>
				</div>

				<div class="form-group">
					<label for="fm-notes">Notes</label>
					<textarea
						id="fm-notes"
						rows="3"
						bind:value={memberForm.notes}
						placeholder="Anything the household should know — allergies, quirks, the important small things."
					></textarea>
				</div>

				<div class="button-row">
					<button type="submit" class="btn btn-primary" disabled={saving}>
						<Icon name="check" size={16} />
						{saving ? 'Saving…' : 'Save'}
					</button>
					<button
						type="button"
						class="btn btn-secondary"
						on:click={() => (showMemberModal = false)}
					>
						Cancel
					</button>
				</div>

				{#if editingMember}
					<button
						type="button"
						class="btn btn-danger remove-member"
						on:click={deleteMember}
						disabled={saving}
					>
						<Icon name="urn" size={16} /> Remove {editingMember.name} from the roster
					</button>
				{/if}
			</form>
		</div>
	</div>
{/if}

<style>
	.lede {
		margin-top: 0.3rem;
		color: var(--text-muted);
		font-size: 0.95rem;
	}

	/* ── Section empties ──────────────────────────────────── */
	.section-empty {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		background: var(--surface-2);
		border: 1px dashed var(--border);
		border-radius: var(--radius-sm);
	}

	.section-empty p {
		margin: 0;
		font-size: 0.92rem;
		font-style: italic;
		color: var(--text-faint);
	}

	/* ── Member cards ─────────────────────────────────────── */
	.member-grid {
		display: grid;
		gap: var(--grid-gap);
		grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
	}

	.member-card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.55rem;
		padding: 1.15rem 1rem 1rem;
		text-align: center;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
		transition:
			border-color var(--transition-normal),
			box-shadow var(--transition-normal);
	}

	.member-card:hover {
		border-color: var(--border-gilt);
		box-shadow: var(--shadow-sm);
	}

	.member-edit {
		position: absolute;
		top: 0.55rem;
		right: 0.55rem;
		width: 30px;
		height: 30px;
		min-height: 30px;
	}

	.member-portrait {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		border: 2px solid var(--border-gilt);
		object-fit: cover;
	}

	.member-portrait.sprite {
		display: grid;
		place-items: center;
		background: radial-gradient(circle at 50% 40%, var(--accent-tint), transparent 72%);
		color: var(--text-muted);
		--icon-accent: var(--accent);
	}

	.member-name {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.45rem;
		flex-wrap: wrap;
	}

	.member-title {
		font-family: var(--font-display);
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--text);
	}

	.member-age {
		font-size: 0.8rem;
		color: var(--text-faint);
	}

	.member-badges {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.35rem;
		--icon-accent: currentColor;
	}

	.member-badges:empty {
		display: none;
	}

	.member-notes {
		margin: 0;
		font-size: 0.85rem;
		font-style: italic;
		color: var(--text-muted);
		line-height: 1.45;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}

	/* ── Modal extras ─────────────────────────────────────── */
	textarea {
		resize: vertical;
		min-height: 84px;
	}

	.remove-member {
		width: 100%;
		margin-top: 1.1rem;
	}

	@media (max-width: 768px) {
		.page-head {
			flex-direction: column;
			align-items: stretch;
		}

		.member-grid {
			grid-template-columns: repeat(auto-fill, minmax(min(160px, 100%), 1fr));
		}
	}
</style>
