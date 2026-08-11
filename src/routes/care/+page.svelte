<script>
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { goto } from '$app/navigation';
	import { toast } from '$lib/stores/toast.js';
	import Nav from '$lib/Nav.svelte';
	import { errorMessage } from '$lib/errors.js';
	import { formatDateShort } from '$lib/time.js';
	import { memberPortrait, ageLabel } from '$lib/family.js';
	import Icon from '$lib/icons/Icon.svelte';
	import PixelArt from '$lib/components/PixelArt.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { ART } from '$lib/art.js';

	/** @type {any} */
	let user = null;
	/** @type {any} */
	let profile = null;
	/** @type {any} */
	let sheet = null;
	/** @type {any[]} */
	let kids = [];
	/** @type {Record<string, string>} */
	let namesById = {};

	let initializing = true;
	/** @type {string | null} */
	let initError = null;
	let saving = false;

	// Section editors. Which one is open, and its working copy.
	/** @type {'contacts' | 'pickups' | 'notes' | null} */
	let editingSection = null;
	/** @type {any[]} */
	let rowsDraft = [];
	let notesDraft = '';

	// Per-kid editor
	/** @type {any} */
	let editingKid = null;
	let kidDraft = { allergies: '', routines: '', dosing: /** @type {any[]} */ ([]) };

	onMount(() => {
		initSheet();
	});

	async function initSheet() {
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

			const { data: people } = await supabase.from('profiles').select('id, full_name');
			namesById = Object.fromEntries((people || []).map((p) => [p.id, p.full_name || '']));

			await Promise.all([loadSheet(), loadKids()]);

			initializing = false;
		} catch (err) {
			initError = errorMessage(err);
			initializing = false;
		}
	}

	async function loadSheet() {
		const { data, error } = await supabase.from('care_sheet').select('*').maybeSingle();

		if (error) throw error;
		sheet = data;
	}

	async function loadKids() {
		const { data, error } = await supabase.from('family_members').select('*').eq('kind', 'child');

		if (error) throw error;
		kids = (data || []).sort((a, b) =>
			(a.birthdate || '9999').localeCompare(b.birthdate || '9999')
		);
	}

	$: canManage = profile?.role === 'family' || profile?.role === 'admin';
	$: contacts = asArray(sheet?.contacts);
	$: pickups = asArray(sheet?.pickups);

	/** @param {any} v */
	function asArray(v) {
		return Array.isArray(v) ? v : [];
	}

	/** Free text stored in the jsonb routines column (a bare JSON string). */
	/** @param {any} v */
	function asText(v) {
		return typeof v === 'string' ? v : '';
	}

	/** @param {string} phone */
	function telHref(phone) {
		return 'tel:' + String(phone).replace(/[^\d+]/g, '');
	}

	// ── Household sections ──────────────────────────────────

	/** @param {'contacts' | 'pickups'} section */
	function openRowsEditor(section) {
		editingSection = section;
		const current = section === 'contacts' ? contacts : pickups;
		rowsDraft = current.length
			? current.map((r) => ({ ...r }))
			: [
					section === 'contacts'
						? { name: '', relation: '', phone: '' }
						: { name: '', relation: '', note: '' }
				];
	}

	function addRow() {
		rowsDraft = [
			...rowsDraft,
			editingSection === 'contacts'
				? { name: '', relation: '', phone: '' }
				: { name: '', relation: '', note: '' }
		];
	}

	/** @param {number} i */
	function removeRow(i) {
		rowsDraft = rowsDraft.filter((_, idx) => idx !== i);
	}

	function openNotesEditor() {
		editingSection = 'notes';
		notesDraft = sheet?.house_notes || '';
	}

	async function saveSection() {
		if (saving || !editingSection) return;
		saving = true;

		try {
			/** @type {any} */
			const patch = { updated_at: new Date().toISOString(), updated_by: user.id };

			if (editingSection === 'notes') {
				patch.house_notes = notesDraft.trim() || null;
			} else {
				const cleaned = rowsDraft
					.map((r) => ({
						name: (r.name || '').trim(),
						relation: (r.relation || '').trim(),
						...(editingSection === 'contacts'
							? { phone: (r.phone || '').trim() }
							: { note: (r.note || '').trim() })
					}))
					.filter((r) => r.name);
				patch[editingSection] = cleaned;
			}

			// The singleton row exists from the migration; upsert covers a
			// fresh database where it doesn't yet.
			const { data, error } = await supabase
				.from('care_sheet')
				.upsert({ one: true, ...patch }, { onConflict: 'one' })
				.select()
				.single();

			if (error) throw error;

			sheet = data;
			editingSection = null;
			toast.success('The sheet is updated');
		} catch (err) {
			toast.error('Error saving: ' + errorMessage(err));
		} finally {
			saving = false;
		}
	}

	// ── Per-kid sections ────────────────────────────────────

	/** @param {any} kid */
	function openKidEditor(kid) {
		editingKid = kid;
		kidDraft = {
			allergies: kid.allergies || '',
			routines: asText(kid.routines),
			dosing: asArray(kid.dosing).length
				? asArray(kid.dosing).map((d) => ({ ...d }))
				: [{ medicine: '', dose: '', every: '' }]
		};
	}

	function addDose() {
		kidDraft.dosing = [...kidDraft.dosing, { medicine: '', dose: '', every: '' }];
	}

	/** @param {number} i */
	function removeDose(i) {
		kidDraft.dosing = kidDraft.dosing.filter((_, idx) => idx !== i);
	}

	async function saveKid() {
		if (saving || !editingKid) return;
		saving = true;

		try {
			const dosing = kidDraft.dosing
				.map((d) => ({
					medicine: (d.medicine || '').trim(),
					dose: (d.dose || '').trim(),
					every: (d.every || '').trim()
				}))
				.filter((d) => d.medicine);

			const { error } = await supabase
				.from('family_members')
				.update({
					allergies: kidDraft.allergies.trim() || null,
					routines: kidDraft.routines.trim() || null,
					dosing
				})
				.eq('id', editingKid.id);

			if (error) throw error;

			toast.success(`${editingKid.name}'s sheet is updated`);
			editingKid = null;
			await loadKids();
		} catch (err) {
			toast.error('Error saving: ' + errorMessage(err));
		} finally {
			saving = false;
		}
	}

	function printSheet() {
		window.print();
	}

	/** @param {KeyboardEvent} event */
	function handleModalKeydown(event) {
		if (event.key !== 'Escape') return;
		if (editingSection) editingSection = null;
		else if (editingKid) editingKid = null;
	}
</script>

<svelte:window on:keydown={handleModalKeydown} />

<Nav currentPage="care" />

<div class="container">
	{#if initializing}
		<Skeleton variant="card" count={3} />
	{:else if initError}
		<div class="card arcana">
			<EmptyState icon="warning" title="The sheet won't open" hint={initError}>
				<button class="btn btn-primary" on:click={initSheet}>
					<Icon name="star" size={16} /> Try again
				</button>
			</EmptyState>
		</div>
	{:else}
		<!-- ── Head ─────────────────────────────────────────── -->
		<div class="page-head">
			<div>
				<h1>The Care Sheet</h1>
				<p class="lede">
					The one page a sitter needs — allergies, doses, contacts, and how the days run.
				</p>
			</div>
			<div class="head-actions">
				<button class="btn btn-secondary" on:click={printSheet}>
					<Icon name="scroll" size={16} /> Print
				</button>
			</div>
		</div>

		{#if sheet?.updated_at}
			<p class="updated-line">
				Last touched {formatDateShort(sheet.updated_at)}
				{#if sheet.updated_by && namesById[sheet.updated_by]}
					by {namesById[sheet.updated_by].split(' ')[0]}
				{/if}
			</p>
		{/if}

		<!-- ── Emergency contacts ───────────────────────────── -->
		<div class="card arcana">
			<div class="card-header">
				<h2>Emergency Contacts</h2>
				{#if canManage}
					<button class="btn-small" on:click={() => openRowsEditor('contacts')}>
						<Icon name="quill" size={13} /> Amend
					</button>
				{/if}
			</div>

			{#if contacts.length === 0}
				<p class="section-empty">
					No contacts written down yet{canManage ? ' — add the numbers that matter.' : '.'}
				</p>
			{:else}
				<div class="contact-rows">
					{#each contacts as c (c.name + (c.phone || ''))}
						<div class="contact-row">
							<div class="contact-who">
								<span class="contact-name">{c.name}</span>
								{#if c.relation}<span class="contact-relation">{c.relation}</span>{/if}
							</div>
							{#if c.phone}
								<a class="contact-phone" href={telHref(c.phone)}>{c.phone}</a>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- ── Authorized pickups ───────────────────────────── -->
		<div class="card arcana">
			<div class="card-header">
				<h2>Authorized Pickups</h2>
				{#if canManage}
					<button class="btn-small" on:click={() => openRowsEditor('pickups')}>
						<Icon name="quill" size={13} /> Amend
					</button>
				{/if}
			</div>

			{#if pickups.length === 0}
				<p class="section-empty">
					No one listed yet{canManage
						? ' — name the people allowed to collect the kids.'
						: ' — only the household collects the kids.'}
				</p>
			{:else}
				<div class="pickup-rows">
					{#each pickups as p (p.name)}
						<div class="pickup-row">
							<Icon name="person" size={16} />
							<span class="pickup-name">{p.name}</span>
							{#if p.relation}<span class="pickup-relation">{p.relation}</span>{/if}
							{#if p.note}<span class="pickup-note">{p.note}</span>{/if}
						</div>
					{/each}
				</div>
				<p class="pickup-warning">No one else — when in doubt, call first.</p>
			{/if}
		</div>

		<!-- ── Per kid ──────────────────────────────────────── -->
		{#if kids.length === 0}
			<div class="card arcana">
				<EmptyState
					icon="heart"
					title="No kids on the roster yet"
					hint="Add them on the Family page and their sheets appear here."
				>
					{#if canManage}
						<a class="btn btn-primary" href="/family">
							<Icon name="plus" size={16} /> Add the kids
						</a>
					{/if}
				</EmptyState>
			</div>
		{:else}
			{#each kids as kid (kid.id)}
				{@const dosing = asArray(kid.dosing)}
				{@const routines = asText(kid.routines)}
				<div class="card arcana kid-card">
					<div class="card-header">
						<div class="kid-title">
							<img
								class="kid-portrait"
								src={memberPortrait(kid)}
								alt=""
								width="40"
								height="40"
								loading="lazy"
								draggable="false"
							/>
							<h2>{kid.name}</h2>
							{#if ageLabel(kid.birthdate)}
								<span class="kid-age">{ageLabel(kid.birthdate)}</span>
							{/if}
						</div>
						{#if canManage}
							<button class="btn-small" on:click={() => openKidEditor(kid)}>
								<Icon name="quill" size={13} /> Amend
							</button>
						{/if}
					</div>

					<!-- Safety first, plainly. -->
					<div class="kid-section allergies" class:has-allergies={kid.allergies}>
						<span class="section-label">
							<Icon name="warning" size={13} /> Allergies &amp; safety
						</span>
						{#if kid.allergies}
							<p class="allergy-text">{kid.allergies}</p>
						{:else}
							<p class="section-quiet">No known allergies written down.</p>
						{/if}
					</div>

					<div class="kid-section">
						<span class="section-label">
							<Icon name="potion" size={13} /> Dosing chart
						</span>
						{#if dosing.length === 0}
							<p class="section-quiet">
								Nothing charted{canManage ? ' — add the usual medicines and doses.' : '.'}
							</p>
						{:else}
							<div class="desktop-table dose-table">
								<table>
									<thead>
										<tr><th>Medicine</th><th>Dose</th><th>Every</th></tr>
									</thead>
									<tbody>
										{#each dosing as d (d.medicine)}
											<tr>
												<td>{d.medicine}</td>
												<td class="num">{d.dose || '—'}</td>
												<td>{d.every || '—'}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
							<p class="dose-note">
								Every dose given gets logged on the cockpit's Meds button — it shows the last dose
								so nothing doubles up.
							</p>
						{/if}
					</div>

					<div class="kid-section">
						<span class="section-label">
							<Icon name="sun" size={13} /> Routines
						</span>
						{#if routines}
							<p class="routine-text">{routines}</p>
						{:else}
							<p class="section-quiet">
								Nothing written{canManage ? ' — naps, meals, comfort objects, the works.' : '.'}
							</p>
						{/if}
					</div>

					{#if kid.current_focus}
						<div class="kid-section">
							<span class="section-label"><Icon name="sprout" size={13} /> Current focus</span>
							<p class="routine-text">{kid.current_focus}</p>
						</div>
					{/if}
				</div>
			{/each}
		{/if}

		<!-- ── House notes ──────────────────────────────────── -->
		<div class="card arcana">
			<div class="card-header">
				<h2>House Notes</h2>
				{#if canManage}
					<button class="btn-small" on:click={openNotesEditor}>
						<Icon name="quill" size={13} /> Amend
					</button>
				{/if}
			</div>
			{#if sheet?.house_notes}
				<p class="house-notes">{sheet.house_notes}</p>
			{:else}
				<p class="section-empty">
					Nothing yet{canManage
						? ' — where things live, how the door sticks, what the cat is owed.'
						: '.'}
				</p>
			{/if}
		</div>

		<div class="sheet-foot">
			<PixelArt src={ART.iconClipboard} size={28} />
			<span>Kept by the household · the cockpit links here in one tap</span>
		</div>
	{/if}
</div>

<!-- ── Rows editor (contacts / pickups) ───────────────── -->
{#if editingSection === 'contacts' || editingSection === 'pickups'}
	<div class="modal-overlay" on:click={() => (editingSection = null)} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>{editingSection === 'contacts' ? 'Emergency contacts' : 'Authorized pickups'}</h2>

			<form on:submit|preventDefault={saveSection}>
				{#each rowsDraft as row, i (i)}
					<div class="editor-row">
						<input type="text" placeholder="Name" bind:value={row.name} />
						<input type="text" placeholder="Relation" bind:value={row.relation} />
						{#if editingSection === 'contacts'}
							<input type="tel" placeholder="Phone" bind:value={row.phone} />
						{:else}
							<input type="text" placeholder="Note (optional)" bind:value={row.note} />
						{/if}
						<button
							type="button"
							class="icon-btn danger"
							on:click={() => removeRow(i)}
							aria-label="Remove row"
						>
							<Icon name="urn" size={14} />
						</button>
					</div>
				{/each}

				<button type="button" class="btn-small add-row" on:click={addRow}>
					<Icon name="plus" size={13} /> Add another
				</button>

				<div class="button-row">
					<button type="submit" class="btn btn-primary" disabled={saving}>
						<Icon name="check" size={16} />
						{saving ? 'Saving…' : 'Save'}
					</button>
					<button type="button" class="btn btn-secondary" on:click={() => (editingSection = null)}>
						Cancel
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- ── House notes editor ─────────────────────────────── -->
{#if editingSection === 'notes'}
	<div class="modal-overlay" on:click={() => (editingSection = null)} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>House notes</h2>

			<form on:submit|preventDefault={saveSection}>
				<div class="form-group">
					<label for="cs-notes">The notes</label>
					<textarea
						id="cs-notes"
						rows="6"
						bind:value={notesDraft}
						placeholder="Where the first-aid kit lives, the trick to the back door, when the cat eats — anything the house expects everyone to know."
					></textarea>
					<small>Room to ramble — dictation welcome.</small>
				</div>

				<div class="button-row">
					<button type="submit" class="btn btn-primary" disabled={saving}>
						<Icon name="check" size={16} />
						{saving ? 'Saving…' : 'Save'}
					</button>
					<button type="button" class="btn btn-secondary" on:click={() => (editingSection = null)}>
						Cancel
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- ── Per-kid editor ─────────────────────────────────── -->
{#if editingKid}
	<div class="modal-overlay" on:click={() => (editingKid = null)} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>{editingKid.name}'s sheet</h2>

			<form on:submit|preventDefault={saveKid}>
				<div class="form-group">
					<label for="ck-allergies">Allergies &amp; safety</label>
					<textarea
						id="ck-allergies"
						rows="2"
						bind:value={kidDraft.allergies}
						placeholder="e.g. tree nuts — epi-pen in the hall drawer; no whole grapes"
					></textarea>
					<small>The serious stuff, stated plainly.</small>
				</div>

				<div class="form-group">
					<span class="field-label">Dosing chart</span>
					{#each kidDraft.dosing as d, i (i)}
						<div class="editor-row dose-row">
							<input type="text" placeholder="Medicine" bind:value={d.medicine} />
							<input type="text" placeholder="Dose" bind:value={d.dose} />
							<input type="text" placeholder="Every" bind:value={d.every} />
							<button
								type="button"
								class="icon-btn danger"
								on:click={() => removeDose(i)}
								aria-label="Remove medicine"
							>
								<Icon name="urn" size={14} />
							</button>
						</div>
					{/each}
					<button type="button" class="btn-small add-row" on:click={addDose}>
						<Icon name="plus" size={13} /> Add a medicine
					</button>
				</div>

				<div class="form-group">
					<label for="ck-routines">Routines</label>
					<textarea
						id="ck-routines"
						rows="4"
						bind:value={kidDraft.routines}
						placeholder="e.g. nap after lunch with the rabbit lovey · no screens before dinner · bath at 6:30, two books, lights out by 7:15"
					></textarea>
				</div>

				<div class="button-row">
					<button type="submit" class="btn btn-primary" disabled={saving}>
						<Icon name="check" size={16} />
						{saving ? 'Saving…' : 'Save'}
					</button>
					<button type="button" class="btn btn-secondary" on:click={() => (editingKid = null)}>
						Cancel
					</button>
				</div>
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

	.head-actions {
		display: flex;
		gap: 0.5rem;
	}

	.updated-line {
		margin: -0.5rem 0 var(--section-gap);
		font-size: 0.78rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.section-empty {
		margin: 0;
		font-size: 0.92rem;
		font-style: italic;
		color: var(--text-faint);
	}

	/* ── Contacts ─────────────────────────────────────────── */
	.contact-rows {
		display: flex;
		flex-direction: column;
	}

	.contact-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.6rem 0.25rem;
		border-bottom: 1px solid var(--border-soft);
	}

	.contact-row:last-child {
		border-bottom: none;
	}

	.contact-who {
		display: flex;
		align-items: baseline;
		gap: 0.55rem;
		min-width: 0;
	}

	.contact-name {
		font-family: var(--font-display);
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
	}

	.contact-relation {
		font-size: 0.8rem;
		color: var(--text-faint);
	}

	/* Big, obvious, tappable — this is the row someone uses in a hurry. */
	.contact-phone {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 40px;
		padding: 0.3rem 0.9rem;
		background: var(--surface-2);
		border: 1px solid var(--border-gilt);
		border-radius: 999px;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		color: var(--accent-bright);
		--icon-accent: var(--accent);
	}

	.contact-phone:hover {
		background: var(--accent-dim);
	}

	/* ── Pickups ──────────────────────────────────────────── */
	.pickup-rows {
		display: flex;
		flex-direction: column;
	}

	.pickup-row {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.5rem 0.25rem;
		border-bottom: 1px solid var(--border-soft);
		color: var(--text-muted);
		--icon-accent: var(--accent);
	}

	.pickup-row:last-child {
		border-bottom: none;
	}

	.pickup-name {
		font-family: var(--font-display);
		font-weight: 600;
		color: var(--text);
	}

	.pickup-relation {
		font-size: 0.8rem;
		color: var(--text-faint);
	}

	.pickup-note {
		font-size: 0.85rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.pickup-warning {
		margin: 0.65rem 0 0;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--danger);
	}

	/* ── Kid cards ────────────────────────────────────────── */
	.kid-title {
		display: flex;
		align-items: center;
		gap: 0.65rem;
	}

	.kid-title h2 {
		margin: 0;
	}

	.kid-portrait {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: 2px solid var(--border-gilt);
		object-fit: cover;
	}

	.kid-age {
		font-size: 0.8rem;
		color: var(--text-faint);
	}

	.kid-section {
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--border-soft);
	}

	.kid-section:last-child {
		border-bottom: none;
	}

	.section-label {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
		--icon-accent: var(--accent);
	}

	/* Allergies read plainly and loudly when present — no whimsy here. */
	.kid-section.has-allergies .section-label {
		color: var(--danger);
		--icon-accent: var(--danger);
	}

	.allergy-text {
		margin: 0.4rem 0 0;
		padding: 0.6rem 0.8rem;
		background: var(--danger-dim);
		border: 1px solid rgba(224, 102, 78, 0.45);
		border-radius: var(--radius-sm);
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.section-quiet {
		margin: 0.35rem 0 0;
		font-size: 0.88rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.dose-table {
		margin-top: 0.5rem;
	}

	.dose-table table {
		min-width: 0;
	}

	.dose-note {
		margin: 0.5rem 0 0;
		font-size: 0.8rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.routine-text {
		margin: 0.4rem 0 0;
		font-size: 0.95rem;
		line-height: 1.55;
		color: var(--text);
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.house-notes {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.6;
		color: var(--text);
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.sheet-foot {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 0.5rem 0 1rem;
		font-size: 0.78rem;
		font-style: italic;
		color: var(--text-faint);
	}

	/* ── Editors ──────────────────────────────────────────── */
	.editor-row {
		display: grid;
		grid-template-columns: 1.2fr 0.9fr 1fr auto;
		gap: 0.45rem;
		margin-bottom: 0.55rem;
		align-items: center;
	}

	.add-row {
		margin-bottom: 0.5rem;
	}

	.field-label {
		display: block;
		margin-bottom: 0.4rem;
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	textarea {
		resize: vertical;
	}

	@media (max-width: 768px) {
		.page-head {
			flex-direction: column;
			align-items: stretch;
		}

		.editor-row {
			grid-template-columns: 1fr 1fr;
		}

		.editor-row .icon-btn {
			justify-self: end;
		}

		.contact-row {
			flex-direction: column;
			align-items: stretch;
		}

		.contact-phone {
			justify-content: center;
		}
	}

	@media print {
		.updated-line,
		.sheet-foot {
			display: block;
			color: black;
		}
	}
</style>
