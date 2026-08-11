<script>
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { goto } from '$app/navigation';
	import { toast } from '$lib/stores/toast.js';
	import { confirm as confirmModal } from '$lib/stores/toast.js';
	import Nav from '$lib/Nav.svelte';
	import { errorMessage } from '$lib/errors.js';
	import { localDateString, formatTime, parseLocalDate } from '$lib/time.js';
	import { journalDayLabel } from '$lib/care.js';
	import { memberPortrait } from '$lib/family.js';
	import { avatarFor } from '$lib/art.js';
	import Icon from '$lib/icons/Icon.svelte';
	import MoonPhase from '$lib/components/MoonPhase.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	const PAGE_SIZE = 40;

	/** The tags that do work, per the spec — plus the system ones for
	 * filtering. Only the first four are offered when writing. */
	const WORK_TAGS = [
		{ tag: 'needs', label: 'Needs', hint: 'Escapes onto the running list until bought' },
		{ tag: 'health', label: 'Health', hint: 'Filterable per kid, for the pediatrician' },
		{ tag: 'milestone', label: 'Milestone', hint: 'Feeds the greatest-hits view someday' },
		{ tag: 'headsup', label: 'Heads-up', hint: 'The tier that reaches parents' }
	];
	const FILTER_TAGS = [...WORK_TAGS, { tag: 'wrapup', label: 'Wrap-ups', hint: '' }];

	/** @type {any} */
	let user = null;
	/** @type {any} */
	let profile = null;
	/** @type {any[]} */
	let entries = [];
	/** @type {any[]} */
	let needsList = [];
	/** @type {any[]} */
	let kids = [];
	/** @type {any[]} */
	let people = [];
	/** @type {Record<string, any>} */
	let shiftsById = {};
	/** @type {Record<string, any[]>} */
	let heartsByEntry = {};

	let initializing = true;
	/** @type {string | null} */
	let initError = null;
	let feedLoading = false;
	let saving = false;
	/** @type {string | number | null} */
	let busyEntryId = null;
	let hasMore = false;
	let pageEnd = PAGE_SIZE - 1;
	let feedToken = 0;

	// Filters
	let search = '';
	let searchApplied = '';
	/** @type {ReturnType<typeof setTimeout> | null} */
	let searchTimer = null;
	/** @type {string | null} */
	let kidFilter = null;
	/** @type {string | null} */
	let authorFilter = null;
	/** @type {string | null} */
	let tagFilter = null;

	/** @type {ReturnType<typeof supabase.channel> | null} */
	let channel = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let resyncTimer = null;

	// Write / edit modal
	let showEntryModal = false;
	/** @type {any} */
	let editingEntry = null;
	let entryForm = {
		body: '',
		date: localDateString(),
		kidIds: /** @type {string[]} */ ([]),
		tags: /** @type {string[]} */ ([]),
		householdOnly: false
	};

	onMount(() => {
		initChronicle();
	});

	onDestroy(() => {
		if (resyncTimer) clearTimeout(resyncTimer);
		if (searchTimer) clearTimeout(searchTimer);
		if (channel) supabase.removeChannel(channel);
	});

	async function initChronicle() {
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

			const [peopleRes, kidsRes] = await Promise.all([
				supabase.from('profiles').select('id, full_name, role'),
				supabase.from('family_members').select('*').eq('kind', 'child')
			]);

			if (peopleRes.error) throw peopleRes.error;
			people = peopleRes.data || [];
			kids = (kidsRes.data || []).sort((a, b) =>
				(a.birthdate || '9999').localeCompare(b.birthdate || '9999')
			);

			await Promise.all([loadFeed(), loadNeeds()]);

			if (!channel) {
				channel = supabase
					.channel('chronicle-page')
					.on(
						'postgres_changes',
						{ event: '*', schema: 'public', table: 'chronicle_entries' },
						() => scheduleResync()
					)
					.on('postgres_changes', { event: '*', schema: 'public', table: 'chronicle_reacts' }, () =>
						scheduleResync()
					)
					.subscribe();
			}

			initializing = false;
		} catch (err) {
			initError = errorMessage(err);
			initializing = false;
		}
	}

	function scheduleResync() {
		if (resyncTimer) clearTimeout(resyncTimer);
		resyncTimer = setTimeout(() => {
			resyncTimer = null;
			Promise.all([loadFeed(true), loadNeeds()]).catch((err) => {
				console.warn('Chronicle resync failed:', errorMessage(err));
			});
		}, 300);
	}

	async function loadFeed(quiet = false) {
		const token = ++feedToken;
		if (!quiet) feedLoading = true;

		try {
			let query = supabase
				.from('chronicle_entries')
				.select('*')
				.order('entry_date', { ascending: false })
				.order('created_at', { ascending: false })
				.range(0, pageEnd);

			if (kidFilter) query = query.contains('kid_ids', [kidFilter]);
			if (authorFilter) query = query.eq('author_id', authorFilter);
			if (tagFilter) query = query.contains('tags', [tagFilter]);
			if (searchApplied) query = query.ilike('body', `%${searchApplied}%`);

			const { data, error } = await query;

			if (error) throw error;
			if (token !== feedToken) return;

			entries = data || [];
			hasMore = entries.length >= pageEnd + 1;

			await Promise.all([loadHearts(), loadShifts()]);
		} finally {
			if (token === feedToken) feedLoading = false;
		}
	}

	async function loadHearts() {
		const ids = entries.map((e) => e.id);
		if (ids.length === 0) {
			heartsByEntry = {};
			return;
		}

		const { data, error } = await supabase
			.from('chronicle_reacts')
			.select('*')
			.in('entry_id', ids)
			.eq('kind', 'heart');

		if (error) throw error;

		/** @type {Record<string, any[]>} */
		const grouped = {};
		for (const r of data || []) {
			(grouped[r.entry_id] = grouped[r.entry_id] || []).push(r);
		}
		heartsByEntry = grouped;
	}

	// The shift a wrap-up rode in on: fetched for display ("on shift
	// 9:02 AM – 5:04 PM"), auto-attached at clock-out.
	async function loadShifts() {
		const ids = [...new Set(entries.map((e) => e.shift_id).filter(Boolean))];
		if (ids.length === 0) {
			shiftsById = {};
			return;
		}

		const { data, error } = await supabase.from('time_entries').select('*').in('id', ids);

		if (error) throw error;
		shiftsById = Object.fromEntries((data || []).map((s) => [s.id, s]));
	}

	// The killer feature: entries tagged 'needs' escape the journal onto a
	// running list until someone crosses them off.
	async function loadNeeds() {
		const { data, error } = await supabase
			.from('chronicle_entries')
			.select('*')
			.contains('tags', ['needs'])
			.order('created_at', { ascending: false });

		if (error) throw error;
		needsList = data || [];
	}

	function loadOlder() {
		pageEnd += PAGE_SIZE;
		loadFeed().catch((err) => toast.error('Error loading older pages: ' + errorMessage(err)));
	}

	function applyFilters() {
		pageEnd = PAGE_SIZE - 1;
		loadFeed().catch((err) => toast.error('Error loading the chronicle: ' + errorMessage(err)));
	}

	function handleSearchInput() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			searchTimer = null;
			searchApplied = search.trim();
			applyFilters();
		}, 300);
	}

	$: namesById = Object.fromEntries(people.map((p) => [p.id, p.full_name || '']));
	$: kidsById = new Map(kids.map((k) => [k.id, k]));
	$: canManage = profile?.role === 'family' || profile?.role === 'admin';
	// Only people who have actually written appear in the author filter.
	$: authors = people.filter(
		(p) => entries.some((e) => e.author_id === p.id) || p.id === authorFilter
	);

	/** Group the flat feed into dated pages, newest first. */
	$: groups = entries.reduce((/** @type {any[]} */ acc, e) => {
		const last = acc[acc.length - 1];
		if (last && last.date === e.entry_date) {
			last.items.push(e);
		} else {
			acc.push({ date: e.entry_date, items: [e] });
		}
		return acc;
	}, []);

	/** @param {string} dateStr */
	function dayLabel(dateStr) {
		return journalDayLabel(dateStr, Date.now());
	}

	/** @param {any} entry */
	function canTouch(entry) {
		return canManage || (user && entry.author_id === user.id);
	}

	/** @param {any} shift */
	function shiftLabel(shift) {
		if (!shift) return '';
		const start = formatTime(shift.clock_in);
		return shift.clock_out
			? `on shift ${start} – ${formatTime(shift.clock_out)}`
			: `on shift from ${start}`;
	}

	// ── Hearts ──────────────────────────────────────────────

	/** @param {any} entry */
	async function toggleHeart(entry) {
		if (busyEntryId) return;
		busyEntryId = entry.id;

		const mine = (heartsByEntry[entry.id] || []).find((r) => r.user_id === user.id);

		try {
			if (mine) {
				const { error } = await supabase
					.from('chronicle_reacts')
					.delete()
					.match({ entry_id: entry.id, user_id: user.id, kind: 'heart' });

				if (error) throw error;
			} else {
				const { error } = await supabase
					.from('chronicle_reacts')
					.upsert(
						{ entry_id: entry.id, user_id: user.id, kind: 'heart' },
						{ onConflict: 'entry_id,user_id,kind', ignoreDuplicates: true }
					);

				if (error) throw error;
			}
			await loadHearts();
		} catch (err) {
			toast.error('Error: ' + errorMessage(err));
		} finally {
			busyEntryId = null;
		}
	}

	// ── The needs list ──────────────────────────────────────

	// Crossing off = removing the 'needs' tag: the entry keeps its place in
	// the journal, it just stops asking.
	/** @param {any} entry */
	async function crossOffNeed(entry) {
		if (busyEntryId) return;
		busyEntryId = entry.id;

		try {
			const { error } = await supabase
				.from('chronicle_entries')
				.update({ tags: (entry.tags || []).filter((/** @type {string} */ t) => t !== 'needs') })
				.eq('id', entry.id);

			if (error) throw error;

			needsList = needsList.filter((n) => n.id !== entry.id);
			toast.success('Crossed off');
			loadFeed(true).catch(() => {});
		} catch (err) {
			toast.error('Error crossing off: ' + errorMessage(err));
		} finally {
			busyEntryId = null;
		}
	}

	// ── Writing ─────────────────────────────────────────────

	function openWrite() {
		editingEntry = null;
		entryForm = {
			body: '',
			date: localDateString(),
			kidIds: kids.map((k) => k.id),
			tags: [],
			householdOnly: false
		};
		showEntryModal = true;
	}

	/** @param {any} entry */
	function openEdit(entry) {
		editingEntry = entry;
		entryForm = {
			body: entry.body || '',
			date: entry.entry_date,
			kidIds: [...(entry.kid_ids || [])],
			tags: [...(entry.tags || [])],
			householdOnly: !!entry.household_only
		};
		showEntryModal = true;
	}

	/** @param {string} kidId */
	function toggleFormKid(kidId) {
		entryForm.kidIds = entryForm.kidIds.includes(kidId)
			? entryForm.kidIds.filter((id) => id !== kidId)
			: [...entryForm.kidIds, kidId];
	}

	/** @param {string} tag */
	function toggleFormTag(tag) {
		entryForm.tags = entryForm.tags.includes(tag)
			? entryForm.tags.filter((t) => t !== tag)
			: [...entryForm.tags, tag];
	}

	async function saveEntry() {
		if (saving) return;

		const body = entryForm.body.trim();
		if (!body) {
			toast.error('Write the entry first');
			return;
		}
		if (!entryForm.date) {
			toast.error('The entry needs a date');
			return;
		}

		saving = true;

		try {
			if (editingEntry) {
				const { error } = await supabase
					.from('chronicle_entries')
					.update({
						body,
						entry_date: entryForm.date,
						kid_ids: entryForm.kidIds,
						tags: entryForm.tags,
						household_only: canManage ? entryForm.householdOnly : editingEntry.household_only
					})
					.eq('id', editingEntry.id);

				if (error) throw error;
				toast.success('Entry amended');
			} else {
				const { error } = await supabase.from('chronicle_entries').insert({
					author_id: user.id,
					entry_date: entryForm.date,
					body,
					kid_ids: entryForm.kidIds,
					tags: entryForm.tags,
					household_only: canManage ? entryForm.householdOnly : false
				});

				if (error) throw error;
				toast.success('Written into the chronicle');
			}

			showEntryModal = false;
			await Promise.all([loadFeed(true), loadNeeds()]);
		} catch (err) {
			toast.error('Error saving: ' + errorMessage(err));
		} finally {
			saving = false;
		}
	}

	async function deleteEntry() {
		if (!editingEntry || saving) return;

		const confirmed = await confirmModal.show({
			title: 'Erase Entry',
			message: 'Erase this entry from the chronicle? This cannot be undone.',
			confirmText: 'Erase',
			danger: true
		});
		if (!confirmed) return;

		saving = true;

		try {
			const { error } = await supabase.from('chronicle_entries').delete().eq('id', editingEntry.id);

			if (error) throw error;

			toast.success('Entry erased');
			showEntryModal = false;
			editingEntry = null;
			await Promise.all([loadFeed(true), loadNeeds()]);
		} catch (err) {
			toast.error('Error erasing: ' + errorMessage(err));
		} finally {
			saving = false;
		}
	}

	/** @param {KeyboardEvent} event */
	function handleModalKeydown(event) {
		if (event.key === 'Escape' && showEntryModal) showEntryModal = false;
	}
</script>

<svelte:window on:keydown={handleModalKeydown} />

<Nav currentPage="chronicle" />

<div class="container">
	{#if initializing}
		<Skeleton variant="card" count={3} />
	{:else if initError}
		<div class="card arcana">
			<EmptyState icon="warning" title="The chronicle won't open" hint={initError}>
				<button class="btn btn-primary" on:click={initChronicle}>
					<Icon name="star" size={16} /> Try again
				</button>
			</EmptyState>
		</div>
	{:else}
		<!-- ── Head ─────────────────────────────────────────── -->
		<div class="page-head">
			<div>
				<h1>The Chronicle</h1>
				<p class="lede">The family's memory, kept — handoff notes today, their childhood later.</p>
			</div>
			<button class="btn btn-primary" on:click={openWrite}>
				<Icon name="quill" size={16} /> Write an entry
			</button>
		</div>

		<!-- ── The needs list ───────────────────────────────── -->
		{#if needsList.length > 0}
			<div class="card arcana needs-card">
				<div class="card-header">
					<h2>The Needs List</h2>
					<span class="rune-label">{needsList.length} outstanding</span>
				</div>
				<div class="needs-rows">
					{#each needsList as need (need.id)}
						<div class="need-row">
							{#if canTouch(need)}
								<button
									class="need-check"
									on:click={() => crossOffNeed(need)}
									disabled={busyEntryId === need.id}
									aria-label="Cross off"
								>
									<Icon name="check" size={14} />
								</button>
							{:else}
								<span class="need-dot" aria-hidden="true"></span>
							{/if}
							<span class="need-text">{need.body}</span>
							{#if namesById[need.author_id]}
								<span class="need-author">{namesById[need.author_id].split(' ')[0]}</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- ── Filters ──────────────────────────────────────── -->
		<div class="filter-bar">
			<div class="search-wrap">
				<Icon name="eye" size={16} />
				<input
					type="text"
					placeholder="Search the chronicle…"
					bind:value={search}
					on:input={handleSearchInput}
				/>
			</div>

			<div class="chip-rows">
				{#if kids.length > 0}
					<div class="chip-row">
						<button
							class="filter-chip"
							class:active={kidFilter === null}
							on:click={() => {
								kidFilter = null;
								applyFilters();
							}}
						>
							Everyone
						</button>
						{#each kids as kid (kid.id)}
							<button
								class="filter-chip"
								class:active={kidFilter === kid.id}
								on:click={() => {
									kidFilter = kidFilter === kid.id ? null : kid.id;
									applyFilters();
								}}
							>
								<img
									src={memberPortrait(kid)}
									alt=""
									width="18"
									height="18"
									loading="lazy"
									draggable="false"
								/>
								{kid.name}
							</button>
						{/each}
					</div>
				{/if}

				<div class="chip-row">
					{#each FILTER_TAGS as t (t.tag)}
						<button
							class="filter-chip"
							class:active={tagFilter === t.tag}
							title={t.hint}
							on:click={() => {
								tagFilter = tagFilter === t.tag ? null : t.tag;
								applyFilters();
							}}
						>
							{t.label}
						</button>
					{/each}
					{#if authors.length > 1}
						<select
							class="author-select"
							bind:value={authorFilter}
							on:change={applyFilters}
							aria-label="Filter by author"
						>
							<option value={null}>Any hand</option>
							{#each authors as a (a.id)}
								<option value={a.id}>{a.full_name || 'Unnamed'}</option>
							{/each}
						</select>
					{/if}
				</div>
			</div>
		</div>

		<!-- ── The feed ─────────────────────────────────────── -->
		{#if entries.length === 0}
			<div class="card arcana">
				<EmptyState
					icon="grimoire"
					title={searchApplied || kidFilter || tagFilter || authorFilter
						? 'Nothing on these pages'
						: 'The chronicle lies open'}
					hint={searchApplied || kidFilter || tagFilter || authorFilter
						? 'No entries match — loosen the filters or search for something else.'
						: 'The first entry starts the family’s memory. Wrap-ups arrive on their own at clock-out.'}
				/>
			</div>
		{:else}
			<div class="feed" class:refreshing={feedLoading}>
				{#each groups as group (group.date)}
					<div class="day-group">
						<div class="day-head">
							<MoonPhase size={18} date={parseLocalDate(group.date)} />
							<span class="day-title">{dayLabel(group.date)}</span>
							<span class="day-rule"></span>
						</div>

						{#each group.items as entry (entry.id)}
							{@const hearts = heartsByEntry[entry.id] || []}
							{@const mine = hearts.some((r) => r.user_id === user.id)}
							{@const shift = entry.shift_id ? shiftsById[entry.shift_id] : null}
							<article class="entry-card" class:private={entry.household_only}>
								<header class="entry-head">
									<img
										class="entry-avatar"
										src={avatarFor(entry.author_id)}
										alt=""
										width="34"
										height="34"
										loading="lazy"
										draggable="false"
									/>
									<div class="entry-byline">
										<span class="entry-author">
											{namesById[entry.author_id]?.split(' ')[0] || 'Someone'}
										</span>
										<span class="entry-when">
											{formatTime(entry.created_at)}
											{#if shift}
												· {shiftLabel(shift)}
											{/if}
										</span>
									</div>
									<span class="entry-badges">
										{#if entry.household_only}
											<span class="badge badge-arcane" title="Hidden from the nanny">
												<Icon name="key" size={11} /> household only
											</span>
										{/if}
										{#each (entry.tags || []).filter((/** @type {string} */ t) => t !== 'wrapup' && t !== 'morning') as tag (tag)}
											<span class="badge" class:badge-danger={tag === 'headsup'}>{tag}</span>
										{/each}
										{#if (entry.tags || []).includes('wrapup')}
											<span class="badge badge-gilt">wrap-up</span>
										{/if}
										{#if (entry.tags || []).includes('morning')}
											<span class="badge">morning note</span>
										{/if}
									</span>
								</header>

								<p class="entry-body">{entry.body}</p>

								{#if (entry.kid_ids || []).length > 0 && kids.length > 1}
									<div class="entry-kids">
										{#each entry.kid_ids as kidId (kidId)}
											{#if kidsById.get(kidId)}
												<span class="kid-tag">
													<img
														src={memberPortrait(kidsById.get(kidId))}
														alt=""
														width="16"
														height="16"
														loading="lazy"
														draggable="false"
													/>
													{kidsById.get(kidId).name}
												</span>
											{/if}
										{/each}
									</div>
								{/if}

								<footer class="entry-foot">
									<button
										class="heart-btn"
										class:hearted={mine}
										on:click={() => toggleHeart(entry)}
										disabled={busyEntryId === entry.id}
										aria-label={mine ? 'Remove your heart' : 'Heart this entry'}
									>
										<Icon name="heart" size={14} />
										{hearts.length > 0 ? hearts.length : ''}
									</button>
									{#if canTouch(entry)}
										<button
											class="icon-btn entry-edit"
											on:click={() => openEdit(entry)}
											aria-label="Amend entry"
										>
											<Icon name="quill" size={14} />
										</button>
									{/if}
								</footer>
							</article>
						{/each}
					</div>
				{/each}

				{#if hasMore}
					<button class="btn btn-secondary load-older" on:click={loadOlder} disabled={feedLoading}>
						<Icon name="chevron-left" size={14} /> Turn back the pages
					</button>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<!-- ── Write / amend an entry ─────────────────────────── -->
{#if showEntryModal}
	<div class="modal-overlay" on:click={() => (showEntryModal = false)} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>{editingEntry ? 'Amend the entry' : 'Write in the chronicle'}</h2>

			<form on:submit|preventDefault={saveEntry}>
				<div class="form-group">
					<label for="che-body">The entry</label>
					<textarea
						id="che-body"
						rows="5"
						bind:value={entryForm.body}
						placeholder="Pancake Sunday, a first somersault, the thing they said at dinner — room to ramble, dictation welcome."
						required
					></textarea>
				</div>

				<div class="form-group">
					<label for="che-date">Day</label>
					<input id="che-date" type="date" bind:value={entryForm.date} required />
				</div>

				{#if kids.length > 0}
					<div class="form-group">
						<span class="field-label">About</span>
						<div class="modal-chips">
							{#each kids as kid (kid.id)}
								<button
									type="button"
									class="filter-chip"
									class:active={entryForm.kidIds.includes(kid.id)}
									on:click={() => toggleFormKid(kid.id)}
								>
									<img src={memberPortrait(kid)} alt="" width="18" height="18" draggable="false" />
									{kid.name}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<div class="form-group">
					<span class="field-label">Tags that do work</span>
					<div class="modal-chips">
						{#each WORK_TAGS as t (t.tag)}
							<button
								type="button"
								class="filter-chip"
								class:active={entryForm.tags.includes(t.tag)}
								title={t.hint}
								on:click={() => toggleFormTag(t.tag)}
							>
								{t.label}
							</button>
						{/each}
					</div>
					<small>Needs joins the running list · heads-up reaches the parents.</small>
				</div>

				{#if canManage}
					<div class="form-group">
						<label class="toggle-row" for="che-private">
							<input id="che-private" type="checkbox" bind:checked={entryForm.householdOnly} />
							<span>Household only — hidden from the nanny, so you can write candidly</span>
						</label>
					</div>
				{/if}

				<div class="button-row">
					<button type="submit" class="btn btn-primary" disabled={saving}>
						<Icon name="quill" size={16} />
						{saving ? 'Writing…' : editingEntry ? 'Save' : 'Write it down'}
					</button>
					<button type="button" class="btn btn-secondary" on:click={() => (showEntryModal = false)}>
						Cancel
					</button>
				</div>

				{#if editingEntry}
					<button
						type="button"
						class="btn btn-danger erase-entry"
						on:click={deleteEntry}
						disabled={saving}
					>
						<Icon name="urn" size={16} /> Erase this entry
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

	/* ── Needs ────────────────────────────────────────────── */
	.needs-card {
		background-image: linear-gradient(150deg, var(--accent-tint), transparent 42%);
	}

	.needs-rows {
		display: flex;
		flex-direction: column;
	}

	.need-row {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.5rem 0.25rem;
		border-bottom: 1px solid var(--border-soft);
	}

	.need-row:last-child {
		border-bottom: none;
	}

	.need-check {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		min-height: 30px;
		flex-shrink: 0;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 50%;
		color: var(--text-faint);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.need-check:hover:not(:disabled) {
		color: var(--growing);
		border-color: var(--growing);
		background: var(--growing-dim);
	}

	.need-dot {
		width: 8px;
		height: 8px;
		margin: 0 11px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--border-gilt);
	}

	.need-text {
		flex: 1;
		min-width: 0;
		color: var(--text);
		overflow-wrap: anywhere;
	}

	.need-author {
		font-size: 0.78rem;
		font-style: italic;
		color: var(--text-faint);
		flex-shrink: 0;
	}

	/* ── Filters ──────────────────────────────────────────── */
	.filter-bar {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		margin-bottom: var(--section-gap);
	}

	.search-wrap {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0 0.9rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--text-faint);
	}

	.search-wrap input {
		flex: 1;
		border: none;
		background: transparent;
		padding: 0.65rem 0;
	}

	.search-wrap input:focus {
		box-shadow: none;
		background: transparent;
	}

	.chip-rows {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.chip-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}

	.filter-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 36px;
		padding: 0.25rem 0.8rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--text-muted);
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.filter-chip img {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1px solid var(--border-gilt);
		object-fit: cover;
	}

	.filter-chip:hover {
		color: var(--accent-bright);
		border-color: var(--border-gilt);
	}

	.filter-chip.active {
		color: var(--accent-bright);
		border-color: var(--border-gilt);
		background: var(--accent-dim);
	}

	.author-select {
		width: auto;
		min-width: 130px;
		min-height: 36px;
		padding: 0.25rem 2rem 0.25rem 0.8rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-muted);
	}

	/* ── Feed ─────────────────────────────────────────────── */
	.feed {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}

	.day-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.6rem;
	}

	.day-title {
		font-family: var(--font-display);
		font-size: 0.95rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--accent-bright);
		white-space: nowrap;
	}

	.day-rule {
		flex: 1;
		height: 1px;
		background: linear-gradient(90deg, var(--border-gilt), transparent);
	}

	.entry-card {
		position: relative;
		padding: 1rem 1.15rem;
		margin-bottom: 0.65rem;
		background: var(--surface);
		background-image: linear-gradient(150deg, var(--accent-tint), transparent 45%);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		box-shadow: var(--shadow-sm);
	}

	.entry-card.private {
		border-color: rgba(168, 119, 232, 0.4);
	}

	.entry-head {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
	}

	.entry-avatar {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		border: 1px solid var(--border-gilt);
		object-fit: cover;
		flex-shrink: 0;
	}

	.entry-byline {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.entry-author {
		font-family: var(--font-display);
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text);
	}

	.entry-when {
		font-size: 0.75rem;
		color: var(--text-faint);
	}

	.entry-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-left: auto;
		--icon-accent: currentColor;
	}

	.entry-body {
		margin: 0.6rem 0 0;
		font-size: 0.98rem;
		line-height: 1.6;
		color: var(--text);
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.entry-kids {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.6rem;
	}

	.kid-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.15rem 0.6rem 0.15rem 0.25rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-muted);
	}

	.kid-tag img {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1px solid var(--border-gilt);
		object-fit: cover;
	}

	.entry-foot {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.65rem;
	}

	.heart-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 34px;
		padding: 0.25rem 0.7rem;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--text-faint);
		font-size: 0.82rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition: all var(--transition-fast);
		--icon-accent: currentColor;
	}

	.heart-btn:hover:not(:disabled) {
		color: var(--danger);
		border-color: var(--danger);
		background: var(--danger-dim);
	}

	.heart-btn.hearted {
		color: var(--danger);
		border-color: rgba(224, 102, 78, 0.45);
		background: var(--danger-dim);
	}

	.entry-edit {
		width: 32px;
		height: 32px;
		min-height: 32px;
		margin-left: auto;
	}

	.load-older {
		align-self: center;
	}

	/* ── Modal extras ─────────────────────────────────────── */
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

	.modal-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.toggle-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0;
		font-size: 0.85rem;
		font-weight: 400;
		letter-spacing: normal;
		text-transform: none;
		color: var(--text-muted);
		cursor: pointer;
	}

	.toggle-row input {
		width: auto;
		accent-color: var(--accent);
	}

	textarea {
		resize: vertical;
		min-height: 110px;
	}

	.erase-entry {
		width: 100%;
		margin-top: 1.1rem;
	}

	@media (max-width: 768px) {
		.page-head {
			flex-direction: column;
			align-items: stretch;
		}

		.entry-badges {
			margin-left: 0;
			width: 100%;
			order: 3;
		}

		.entry-head {
			flex-wrap: wrap;
		}
	}
</style>
