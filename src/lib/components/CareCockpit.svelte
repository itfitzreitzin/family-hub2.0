<script>
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { toast } from '$lib/stores/toast.js';
	import { confirm as confirmModal } from '$lib/stores/toast.js';
	import { errorMessage } from '$lib/errors.js';
	import { localDateString, localTimeString, combineLocalDateTime, formatTime } from '$lib/time.js';
	import {
		MOMENT_KINDS,
		momentKind,
		momentSummary,
		momentKidsLabel,
		spanLabel,
		napLengthMs,
		dayStartMs,
		POTTY_OUTCOMES,
		APPETITES
	} from '$lib/care.js';
	import { memberPortrait } from '$lib/family.js';
	import { ART } from '$lib/art.js';
	import Icon from '$lib/icons/Icon.svelte';
	import PixelArt from './PixelArt.svelte';
	import EmptyState from './EmptyState.svelte';

	/** The open time_entries row this cockpit records against. */
	/** @type {any} */
	export let shift = null;
	/** @type {any} */
	export let user = null;
	/** @type {any} */
	export let profile = null;

	/** @type {any[]} */
	let kids = [];
	/** @type {any[]} */
	let moments = [];
	/** @type {any[]} */
	let openNaps = [];
	/** @type {any[]} */
	let recentMeds = [];
	/** @type {string | null} */
	let scopeKidId = null;
	/** @type {any} */
	let morningNote = null;
	/** @type {any} */
	let seenReact = null;
	let markingSeen = false;
	/** @type {Record<string, string>} */
	let namesById = {};

	let loading = true;
	let now = Date.now();
	/** @type {ReturnType<typeof setInterval> | null} */
	let nowInterval = null;
	/** @type {ReturnType<typeof supabase.channel> | null} */
	let channel = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let resyncTimer = null;
	/** @type {string | null} */
	let loadedShiftId = null;
	let momentsToken = 0;

	// Detail sheets (one per tappable kind; nap never opens one)
	/** @type {string | null} */
	let sheetKind = null;
	let sheetSaving = false;
	/** @type {string[]} */
	let sheetKidIds = [];
	let sheetForm = { time: '12:00', detail: '', appetite: '', name: '', dose: '', text: '' };

	// Edit modal
	/** @type {any} */
	let editingMoment = null;
	let editSaving = false;
	/** @type {string[]} */
	let editKidIds = [];
	let editForm = {
		date: localDateString(),
		time: '12:00',
		endTime: '',
		detail: '',
		appetite: '',
		name: '',
		dose: '',
		text: '',
		outcome: 'tried'
	};

	onMount(() => {
		init();
	});

	onDestroy(() => {
		if (nowInterval) clearInterval(nowInterval);
		if (resyncTimer) clearTimeout(resyncTimer);
		if (channel) supabase.removeChannel(channel);
	});

	async function init() {
		try {
			const { data: people } = await supabase.from('profiles').select('id, full_name');
			namesById = Object.fromEntries((people || []).map((p) => [p.id, p.full_name || '']));

			await loadKids();
			await reloadForShift();

			if (!channel) {
				// Unfiltered like the tracker's channel: nap-end UPDATEs and
				// DELETEs can't be usefully filtered server-side.
				channel = supabase
					.channel('care-cockpit')
					.on('postgres_changes', { event: '*', schema: 'public', table: 'care_moments' }, () =>
						scheduleResync()
					)
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
			if (!nowInterval) {
				// Nap elapsed labels are minute-grained; 30s keeps them honest.
				nowInterval = setInterval(() => (now = Date.now()), 30000);
			}
		} catch (err) {
			console.warn('Cockpit init failed:', errorMessage(err));
		} finally {
			loading = false;
		}
	}

	// The tracker can switch nannies (and so shifts) under us.
	$: if (shift?.id && shift.id !== loadedShiftId) {
		reloadForShift().catch(() => {});
	}

	async function reloadForShift() {
		loadedShiftId = shift?.id || null;
		await Promise.all([loadMoments(), loadOpenNaps(), loadRecentMeds(), loadMorningNote()]);
	}

	function scheduleResync() {
		if (resyncTimer) clearTimeout(resyncTimer);
		resyncTimer = setTimeout(() => {
			resyncTimer = null;
			Promise.all([loadMoments(), loadOpenNaps(), loadRecentMeds(), loadMorningNote()]).catch(
				(err) => {
					console.warn('Cockpit resync failed:', errorMessage(err));
				}
			);
		}, 250);
	}

	// The parents' note for this morning, pinned up top until it's been seen.
	async function loadMorningNote() {
		const { data, error } = await supabase
			.from('chronicle_entries')
			.select('*')
			.eq('entry_date', localDateString())
			.contains('tags', ['morning'])
			.maybeSingle();

		if (error) throw error;
		morningNote = data;

		if (morningNote) {
			const { data: reacts } = await supabase
				.from('chronicle_reacts')
				.select('*')
				.eq('entry_id', morningNote.id)
				.eq('kind', 'seen');
			seenReact = (reacts || [])[0] || null;
		} else {
			seenReact = null;
		}
	}

	// The receipt the parents can see: a react row owned by the reader, so
	// the nanny can stamp it without edit rights to the note itself.
	async function markNoteSeen() {
		if (!morningNote || markingSeen) return;
		markingSeen = true;

		try {
			const { error } = await supabase
				.from('chronicle_reacts')
				.upsert(
					{ entry_id: morningNote.id, user_id: user.id, kind: 'seen' },
					{ onConflict: 'entry_id,user_id,kind', ignoreDuplicates: true }
				);

			if (error) throw error;
			await loadMorningNote();
		} catch (err) {
			toast.error('Error marking seen: ' + errorMessage(err));
		} finally {
			markingSeen = false;
		}
	}

	async function loadKids() {
		const { data, error } = await supabase.from('family_members').select('*').eq('kind', 'child');

		if (error) throw error;
		kids = (data || []).sort((a, b) => {
			const ad = a.birthdate || '9999-12-31';
			const bd = b.birthdate || '9999-12-31';
			if (ad !== bd) return ad.localeCompare(bd);
			return (a.name || '').localeCompare(b.name || '');
		});
		if (scopeKidId && !kids.some((k) => k.id === scopeKidId)) scopeKidId = null;
	}

	async function loadMoments() {
		if (!shift?.id) return;
		const token = ++momentsToken;
		const shiftId = shift.id;

		const { data, error } = await supabase
			.from('care_moments')
			.select('*')
			.eq('shift_id', shiftId)
			.order('started_at', { ascending: false });

		if (error) throw error;
		if (token !== momentsToken || shiftId !== shift?.id) return;
		moments = data || [];
	}

	// Open naps are fetched without a shift window: a nap left running from
	// an earlier shift must still surface its End button here.
	async function loadOpenNaps() {
		const { data, error } = await supabase
			.from('care_moments')
			.select('*')
			.eq('kind', 'nap')
			.is('ended_at', null)
			.order('started_at', { ascending: true });

		if (error) throw error;
		openNaps = data || [];
	}

	// Recent doses feed two things: the button face's "last dose" guard and
	// the name suggestions in the meds sheet. Unscoped to this shift on
	// purpose — the morning Tylenol a parent gave counts.
	async function loadRecentMeds() {
		const { data, error } = await supabase
			.from('care_moments')
			.select('*')
			.eq('kind', 'meds')
			.order('started_at', { ascending: false })
			.limit(20);

		if (error) throw error;
		recentMeds = data || [];
	}

	$: kidsById = new Map(kids.map((k) => [k.id, k]));
	$: scopedKidIds = scopeKidId ? [scopeKidId] : kids.map((k) => k.id);
	$: scopeOpenNaps = openNaps.filter((n) =>
		(n.kid_ids || []).some((/** @type {string} */ id) => scopedKidIds.includes(id))
	);
	// The nap the button acts on directly, when the scope is one kid.
	$: soleScopeNap = scopeKidId
		? openNaps.find((n) => (n.kid_ids || []).includes(scopeKidId))
		: null;
	$: canManage = profile?.role === 'family' || profile?.role === 'admin';

	/** @param {any} m */
	function canTouch(m) {
		return canManage || (user && m.author_id === user.id);
	}

	/** @param {string} kidId */
	function napFor(kidId) {
		return openNaps.find((n) => (n.kid_ids || []).includes(kidId)) || null;
	}

	$: startOfToday = dayStartMs(now);

	// The double-dose guard on the Meds button face: the latest dose today
	// for any kid in scope (shared log, AAP-style).
	$: lastDose = [...moments, ...recentMeds]
		.filter((m) => m.kind === 'meds')
		.filter((m) => new Date(m.started_at).getTime() >= startOfToday)
		.filter(
			(m) =>
				(m.kid_ids || []).length === 0 ||
				(m.kid_ids || []).some((/** @type {string} */ id) => scopedKidIds.includes(id))
		)
		.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];

	$: medNames = [...new Set(recentMeds.map((m) => m.payload?.name).filter(Boolean))];

	/** @param {any} row */
	function mergeMoment(row) {
		if (!row) return;
		const rest = moments.filter((m) => m.id !== row.id);
		if (row.shift_id !== shift?.id) {
			moments = rest;
			return;
		}
		moments = [...rest, row].sort(
			(a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
		);
	}

	// ── Tapping moments ─────────────────────────────────────

	/** @param {string} kind */
	function tapMoment(kind) {
		if (kind === 'nap') {
			handleNapTap();
			return;
		}
		sheetKind = kind;
		sheetKidIds = [...scopedKidIds];
		sheetForm = { time: localTimeString(), detail: '', appetite: '', name: '', dose: '', text: '' };
	}

	function handleNapTap() {
		if (soleScopeNap) {
			endNap(soleScopeNap);
			return;
		}
		const sleepers = new Set(openNaps.flatMap((n) => n.kid_ids || []));
		const toStart = kids.filter((k) => scopedKidIds.includes(k.id) && !sleepers.has(k.id));
		if (toStart.length === 0) {
			toast.info('Everyone in view is already napping — end a nap from its row below.');
			return;
		}
		startNaps(toStart);
	}

	/** @param {any[]} kidList */
	async function startNaps(kidList) {
		const startedNames = [];
		for (const kid of kidList) {
			try {
				const { data, error } = await supabase
					.from('care_moments')
					.insert({
						shift_id: shift.id,
						author_id: user.id,
						kind: 'nap',
						kid_ids: [kid.id],
						started_at: new Date().toISOString()
					})
					.select()
					.single();

				if (error) throw error;
				mergeMoment(data);
				openNaps = [...openNaps, data];
				startedNames.push(kid.name);
			} catch (err) {
				if (/** @type {any} */ (err).code === '23505') {
					// Unique index one_open_nap_per_kid
					toast.error(`${kid.name} already has a nap running.`);
				} else {
					toast.error(`Error starting ${kid.name}'s nap: ` + errorMessage(err));
				}
			}
		}
		if (startedNames.length > 0) {
			toast.success(`${startedNames.join(' & ')} down for a nap`);
		}
		loadOpenNaps().catch(() => {});
	}

	/** @param {any} nap */
	async function endNap(nap) {
		try {
			const { data, error } = await supabase
				.from('care_moments')
				.update({ ended_at: new Date().toISOString() })
				.eq('id', nap.id)
				.select()
				.single();

			if (error) throw error;

			openNaps = openNaps.filter((n) => n.id !== data.id);
			mergeMoment(data);
			const name = kidsById.get((data.kid_ids || [])[0])?.name || 'They';
			toast.success(`${name} awake — slept ${spanLabel(napLengthMs(data, Date.now()))}`);
		} catch (err) {
			toast.error('Error ending the nap: ' + errorMessage(err));
		}
	}

	/** @param {string} kidId */
	function toggleSheetKid(kidId) {
		sheetKidIds = sheetKidIds.includes(kidId)
			? sheetKidIds.filter((id) => id !== kidId)
			: [...sheetKidIds, kidId];
	}

	/**
	 * Point-moment insert shared by every sheet.
	 * @param {any} payload
	 * @param {{ quiet?: boolean }} [opts]
	 */
	async function logMoment(payload, opts = {}) {
		if (sheetSaving) return null;

		if (sheetKidIds.length === 0 && sheetKind !== 'note' && sheetKind !== 'headsup') {
			toast.error('Pick at least one kid');
			return null;
		}

		const startedAt = combineLocalDateTime(localDateString(), sheetForm.time);
		if (startedAt.getTime() > Date.now() + 60 * 1000) {
			toast.error("A moment can't be logged for the future");
			return null;
		}

		sheetSaving = true;

		try {
			const { data, error } = await supabase
				.from('care_moments')
				.insert({
					shift_id: shift.id,
					author_id: user.id,
					kind: sheetKind,
					kid_ids: sheetKidIds,
					started_at: startedAt.toISOString(),
					payload
				})
				.select()
				.single();

			if (error) throw error;

			mergeMoment(data);
			if (!opts.quiet) toast.success('Logged');
			sheetKind = null;
			return data;
		} catch (err) {
			toast.error('Error logging: ' + errorMessage(err));
			return null;
		} finally {
			sheetSaving = false;
		}
	}

	async function saveMealSheet() {
		await logMoment({
			detail: sheetForm.detail.trim() || undefined,
			appetite: sheetForm.appetite || undefined
		});
	}

	/** @param {string} outcome */
	async function savePottySheet(outcome) {
		const row = await logMoment({ outcome }, { quiet: true });
		if (!row) return;
		const names = momentKidsLabel(row, kidsById, kids.length) || 'them';
		if (outcome === 'success') {
			toast.success(`A gold star for ${names}!`);
		} else {
			// Accidents log neutrally: readiness data, not failure.
			toast.success('Potty logged');
		}
	}

	async function saveMedsSheet() {
		const name = sheetForm.name.trim();
		if (!name) {
			toast.error('Write down which medicine');
			return;
		}
		await logMoment({ name, dose: sheetForm.dose.trim() || undefined });
	}

	async function saveTextSheet() {
		const text = sheetForm.text.trim();
		if (!text) {
			toast.error('Write the note first');
			return;
		}
		await logMoment({ text });
	}

	// ── Amending moments ────────────────────────────────────

	/** @param {any} m */
	function editMoment(m) {
		editingMoment = m;
		editKidIds = [...(m.kid_ids || [])];
		const p = m.payload || {};
		editForm = {
			date: localDateString(new Date(m.started_at)),
			time: localTimeString(new Date(m.started_at)),
			endTime: m.ended_at ? localTimeString(new Date(m.ended_at)) : '',
			detail: p.detail || '',
			appetite: p.appetite || '',
			name: p.name || '',
			dose: p.dose || '',
			text: p.text || '',
			outcome: p.outcome || 'tried'
		};
	}

	/** @param {string} kidId */
	function toggleEditKid(kidId) {
		editKidIds = editKidIds.includes(kidId)
			? editKidIds.filter((id) => id !== kidId)
			: [...editKidIds, kidId];
	}

	async function saveEdit() {
		if (!editingMoment || editSaving) return;
		const kind = editingMoment.kind;

		if (kind === 'nap' && editKidIds.length !== 1) {
			toast.error('A nap belongs to one kid');
			return;
		}
		if (editKidIds.length === 0 && kind !== 'note' && kind !== 'headsup') {
			toast.error('Pick at least one kid');
			return;
		}

		const startedAt = combineLocalDateTime(editForm.date, editForm.time);
		if (startedAt.getTime() > Date.now() + 60 * 1000) {
			toast.error("A moment can't be logged for the future");
			return;
		}

		/** @type {string | null} */
		let endedAt = null;
		if (kind === 'nap' && editForm.endTime) {
			let ended = combineLocalDateTime(editForm.date, editForm.endTime);
			if (ended.getTime() === startedAt.getTime()) {
				toast.error('The wake time must differ from the start');
				return;
			}
			// A wake time before the start means the nap crossed midnight
			if (ended.getTime() < startedAt.getTime()) {
				ended = new Date(ended.getTime() + 24 * 60 * 60 * 1000);
			}
			if (ended.getTime() > Date.now() + 60 * 1000) {
				toast.error("The wake time can't be in the future");
				return;
			}
			endedAt = ended.toISOString();
		}

		/** @type {any} */
		let payload = null;
		if (kind === 'meal' || kind === 'snack') {
			payload = {
				detail: editForm.detail.trim() || undefined,
				appetite: editForm.appetite || undefined
			};
		} else if (kind === 'potty') {
			payload = { outcome: editForm.outcome };
		} else if (kind === 'meds') {
			const name = editForm.name.trim();
			if (!name) {
				toast.error('Write down which medicine');
				return;
			}
			payload = { name, dose: editForm.dose.trim() || undefined };
		} else if (kind === 'note' || kind === 'headsup') {
			const text = editForm.text.trim();
			if (!text) {
				toast.error('Write the note first');
				return;
			}
			payload = { text };
		}

		editSaving = true;

		try {
			const { data, error } = await supabase
				.from('care_moments')
				.update({
					kid_ids: editKidIds,
					started_at: startedAt.toISOString(),
					ended_at: kind === 'nap' ? endedAt : null,
					payload
				})
				.eq('id', editingMoment.id)
				.select()
				.single();

			if (error) throw error;

			mergeMoment(data);
			await loadOpenNaps().catch(() => {});
			editingMoment = null;
			toast.success('Moment amended');
		} catch (err) {
			if (/** @type {any} */ (err).code === '23505') {
				toast.error('That kid already has a nap running.');
			} else {
				toast.error('Error saving: ' + errorMessage(err));
			}
		} finally {
			editSaving = false;
		}
	}

	async function deleteEditingMoment() {
		if (!editingMoment || editSaving) return;

		const confirmed = await confirmModal.show({
			title: 'Erase Moment',
			message: 'Erase this moment from the day? This cannot be undone.',
			confirmText: 'Erase',
			danger: true
		});
		if (!confirmed) return;

		editSaving = true;

		try {
			const { error } = await supabase.from('care_moments').delete().eq('id', editingMoment.id);

			if (error) throw error;

			moments = moments.filter((m) => m.id !== editingMoment.id);
			openNaps = openNaps.filter((n) => n.id !== editingMoment.id);
			editingMoment = null;
			toast.success('Moment erased');
		} catch (err) {
			toast.error('Error erasing: ' + errorMessage(err));
		} finally {
			editSaving = false;
		}
	}

	/** @param {KeyboardEvent} event */
	function handleKeydown(event) {
		if (event.key !== 'Escape') return;
		if (sheetKind) sheetKind = null;
		else if (editingMoment) editingMoment = null;
	}

	/** @param {string} kind */
	function sheetTitle(kind) {
		const k = momentKind(kind);
		return k.kind === 'headsup' ? 'Heads-up for the parents' : k.label;
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<section class="card arcana">
	<div class="card-header">
		<h2>The Care Day</h2>
		<a
			class="care-notes-link"
			href="/care"
			title="Allergies, doses, contacts and routines — the Care Sheet"
		>
			<PixelArt src={ART.iconClipboard} size={18} />
			<span>Care Sheet</span>
		</a>
	</div>

	<!-- ── The morning note, pinned until seen ──────────── -->
	{#if morningNote}
		<div class="morning-note" class:seen={seenReact}>
			<div class="mn-head">
				<Icon name="scroll" size={14} />
				<span class="mn-label">Morning note</span>
				{#if seenReact}
					<span class="badge badge-live">
						<Icon name="check" size={11} />
						Seen {formatTime(seenReact.created_at)}
					</span>
				{:else if profile?.role === 'nanny'}
					<button class="btn-small growing mn-seen" on:click={markNoteSeen} disabled={markingSeen}>
						<Icon name="check" size={13} />
						{markingSeen ? 'Marking…' : 'Seen ✓'}
					</button>
				{:else}
					<span class="badge">Awaiting eyes</span>
				{/if}
			</div>
			<p class="mn-body">{morningNote.body}</p>
			{#if morningNote.author_id && namesById[morningNote.author_id]}
				<span class="mn-author">— {namesById[morningNote.author_id].split(' ')[0]}</span>
			{/if}
		</div>
	{/if}

	{#if loading}
		<div class="cockpit-loading">
			<div class="skeleton skeleton-line" style="width: 55%"></div>
			<div class="skeleton skeleton-line medium"></div>
			<div class="skeleton skeleton-line short"></div>
		</div>
	{:else if kids.length === 0}
		<EmptyState
			icon="heart"
			title="No kids on the roster yet"
			hint="Add them on the Family page and the care day starts here."
		>
			{#if canManage}
				<a class="btn btn-primary" href="/family">
					<Icon name="plus" size={16} /> Add the kids
				</a>
			{/if}
		</EmptyState>
	{:else}
		<!-- ── Whose moment? ────────────────────────────────── -->
		{#if kids.length > 1}
			<div class="kid-chips">
				<button
					class="kid-chip"
					class:active={scopeKidId === null}
					on:click={() => (scopeKidId = null)}
				>
					<span class="chip-everyone"><Icon name="heart" size={14} /></span>
					{kids.length === 2 ? 'Both' : 'All'}
				</button>
				{#each kids as kid (kid.id)}
					<button
						class="kid-chip"
						class:active={scopeKidId === kid.id}
						on:click={() => (scopeKidId = kid.id)}
					>
						<img
							class="chip-face"
							src={memberPortrait(kid)}
							alt=""
							width="24"
							height="24"
							loading="eager"
							draggable="false"
						/>
						{kid.name}
						{#if napFor(kid.id)}
							<span class="live-dot" title="Napping"></span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		<!-- ── The moment buttons ───────────────────────────── -->
		<div class="moment-grid">
			{#each MOMENT_KINDS as mk (mk.kind)}
				{@const napRunning = mk.kind === 'nap' && soleScopeNap}
				<button
					class="moment-btn"
					class:growing={mk.tone === 'growing'}
					class:danger={mk.tone === 'danger'}
					class:running={napRunning}
					on:click={() => tapMoment(mk.kind)}
				>
					<span class="moment-icon">
						{#if mk.art}
							<PixelArt src={mk.art} size={20} />
						{:else}
							<Icon name={mk.sprite || 'star'} size={20} />
						{/if}
					</span>
					<span class="moment-label">
						{#if napRunning}End nap{:else}{mk.label}{/if}
					</span>
					<span class="moment-hint">
						{#if napRunning}
							asleep {spanLabel(napLengthMs(soleScopeNap, now))}
						{:else if mk.kind === 'meds' && lastDose}
							last dose {formatTime(lastDose.started_at)}
						{:else}
							{mk.hint}
						{/if}
					</span>
				</button>
			{/each}
		</div>

		<!-- ── Who's asleep right now ───────────────────────── -->
		{#if scopeOpenNaps.length > 0}
			<div class="nap-pills">
				{#each scopeOpenNaps as nap (nap.id)}
					<div class="nap-pill">
						<span class="live-dot"></span>
						<Icon name="moon" size={13} />
						<span class="nap-pill-name">
							{kidsById.get((nap.kid_ids || [])[0])?.name || 'Napping'}
						</span>
						<span class="nap-pill-time">
							{formatTime(nap.started_at)} · {spanLabel(napLengthMs(nap, now))}
						</span>
						<button class="btn-small nap-end" on:click={() => endNap(nap)}>
							<Icon name="sun" size={13} /> End
						</button>
					</div>
				{/each}
			</div>
		{/if}

		<!-- ── The shift's timeline ─────────────────────────── -->
		{#if moments.length === 0}
			<EmptyState
				icon="grimoire"
				title="The day is unwritten"
				hint="Taps build the day — the wrap-up writes itself."
			/>
		{:else}
			<div class="cockpit-timeline">
				{#each moments as m (m.id)}
					{@const mk = momentKind(m.kind)}
					{@const openNap = m.kind === 'nap' && !m.ended_at}
					{@const kidsLabel = momentKidsLabel(m, kidsById, kids.length)}
					<div class="ct-row" class:live={openNap} class:flagged={m.kind === 'headsup'}>
						<span class="ct-time">{formatTime(m.started_at)}</span>
						<span class="ct-icon" title={mk.label}>
							{#if mk.art}
								<PixelArt src={mk.art} size={18} />
							{:else}
								<Icon name={mk.sprite || 'star'} size={18} />
							{/if}
						</span>
						<div class="ct-body">
							{#if kidsLabel && kids.length > 1}
								<span class="ct-kids">{kidsLabel}</span>
							{/if}
							<span class="ct-text">{momentSummary(m)}</span>
							{#if m.kind === 'nap'}
								{#if openNap}
									<span class="badge badge-live">
										<span class="live-dot"></span>
										asleep · {spanLabel(napLengthMs(m, now))}
									</span>
								{:else}
									<span class="ct-sub">
										until {formatTime(m.ended_at)} · {spanLabel(napLengthMs(m, now))}
									</span>
								{/if}
							{/if}
							{#if m.kind === 'potty' && m.payload?.outcome === 'success'}
								<span class="ct-star"><Icon name="star" size={13} /></span>
							{/if}
							{#if m.kind === 'headsup'}
								<span class="badge badge-danger">heads-up</span>
							{/if}
						</div>
						<span class="ct-actions">
							{#if openNap}
								<button class="btn-small growing" on:click={() => endNap(m)}>
									<Icon name="sun" size={13} /> End
								</button>
							{/if}
							{#if canTouch(m)}
								<button
									class="icon-btn ct-edit"
									on:click={() => editMoment(m)}
									aria-label="Edit moment"
								>
									<Icon name="quill" size={14} />
								</button>
							{/if}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</section>

<!-- ── Detail sheets ──────────────────────────────────── -->
{#if sheetKind}
	<div class="modal-overlay" on:click={() => (sheetKind = null)} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>{sheetTitle(sheetKind)}</h2>

			{#if kids.length > 1}
				<div class="sheet-kids">
					{#each kids as kid (kid.id)}
						<button
							type="button"
							class="kid-chip"
							class:active={sheetKidIds.includes(kid.id)}
							on:click={() => toggleSheetKid(kid.id)}
						>
							<img
								class="chip-face"
								src={memberPortrait(kid)}
								alt=""
								width="24"
								height="24"
								draggable="false"
							/>
							{kid.name}
						</button>
					{/each}
				</div>
			{/if}

			{#if sheetKind === 'potty'}
				<!-- Outcome IS the save: one tap logs it. -->
				<div class="potty-options">
					{#each POTTY_OUTCOMES as o (o.value)}
						<button
							type="button"
							class="potty-option"
							class:star={o.value === 'success'}
							disabled={sheetSaving}
							on:click={() => savePottySheet(o.value)}
						>
							{#if o.value === 'success'}<Icon name="star" size={20} />{/if}
							{o.label}
						</button>
					{/each}
				</div>
				<p class="sheet-note">Accidents log plainly — it's readiness data, not a report card.</p>
			{:else}
				<form
					on:submit|preventDefault={() => {
						if (sheetKind === 'meds') saveMedsSheet();
						else if (sheetKind === 'note' || sheetKind === 'headsup') saveTextSheet();
						else saveMealSheet();
					}}
				>
					{#if sheetKind === 'meal' || sheetKind === 'snack'}
						<div class="form-group">
							<label for="cs-detail">What was it</label>
							<input
								id="cs-detail"
								type="text"
								bind:value={sheetForm.detail}
								placeholder="e.g. mac & cheese, most of it"
							/>
						</div>
						<div class="form-group">
							<span class="field-label">Appetite</span>
							<div class="segmented">
								{#each APPETITES as a (a.value)}
									<button
										type="button"
										class:active={sheetForm.appetite === a.value}
										on:click={() =>
											(sheetForm.appetite = sheetForm.appetite === a.value ? '' : a.value)}
									>
										{a.label}
									</button>
								{/each}
							</div>
						</div>
					{:else if sheetKind === 'meds'}
						<div class="form-group">
							<label for="cs-med">Medicine</label>
							<input
								id="cs-med"
								type="text"
								bind:value={sheetForm.name}
								placeholder="e.g. children’s ibuprofen"
								list="cockpit-med-names"
								required
							/>
							<datalist id="cockpit-med-names">
								{#each medNames as name (name)}
									<option value={name}></option>
								{/each}
							</datalist>
						</div>
						<div class="form-group">
							<label for="cs-dose">Dose</label>
							<input id="cs-dose" type="text" bind:value={sheetForm.dose} placeholder="e.g. 5 ml" />
						</div>
						{#if lastDose}
							<p class="sheet-note dose-note">
								Last dose today: {lastDose.payload?.name || 'meds'} at {formatTime(
									lastDose.started_at
								)}
							</p>
						{/if}
					{:else}
						<div class="form-group">
							<label for="cs-text">{sheetKind === 'headsup' ? 'What happened' : 'The note'}</label>
							<textarea
								id="cs-text"
								rows="4"
								bind:value={sheetForm.text}
								placeholder={sheetKind === 'headsup'
									? 'e.g. scraped a knee at the park — cleaned and bandaged, all smiles'
									: 'Anything worth remembering — dictation welcome'}
								required
							></textarea>
							{#if sheetKind === 'headsup'}
								<small
									>The one tier that reaches the parents right away — use it for the scraped-knee
									stuff.</small
								>
							{/if}
						</div>
					{/if}

					<div class="form-group">
						<label for="cs-time">When</label>
						<input id="cs-time" type="time" bind:value={sheetForm.time} required />
					</div>

					<div class="button-row">
						<button
							type="submit"
							class="btn {sheetKind === 'headsup' ? 'btn-danger' : 'btn-primary'}"
							disabled={sheetSaving}
						>
							<Icon name="check" size={16} />
							{sheetSaving ? 'Logging…' : 'Log it'}
						</button>
						<button type="button" class="btn btn-secondary" on:click={() => (sheetKind = null)}>
							Cancel
						</button>
					</div>
				</form>
			{/if}
		</div>
	</div>
{/if}

<!-- ── Amend a moment ─────────────────────────────────── -->
{#if editingMoment}
	{@const ek = momentKind(editingMoment.kind)}
	<div class="modal-overlay" on:click={() => (editingMoment = null)} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>Amend — {ek.label}</h2>

			<form on:submit|preventDefault={saveEdit}>
				{#if kids.length > 1}
					<div class="sheet-kids">
						{#each kids as kid (kid.id)}
							<button
								type="button"
								class="kid-chip"
								class:active={editKidIds.includes(kid.id)}
								on:click={() => toggleEditKid(kid.id)}
							>
								<img
									class="chip-face"
									src={memberPortrait(kid)}
									alt=""
									width="24"
									height="24"
									draggable="false"
								/>
								{kid.name}
							</button>
						{/each}
					</div>
				{/if}

				<div class="form-row">
					<div class="form-group">
						<label for="ce-date">Date</label>
						<input id="ce-date" type="date" bind:value={editForm.date} required />
					</div>
					<div class="form-group">
						<label for="ce-time">{editingMoment.kind === 'nap' ? 'Fell asleep' : 'Time'}</label>
						<input id="ce-time" type="time" bind:value={editForm.time} required />
					</div>
				</div>

				{#if editingMoment.kind === 'nap'}
					<div class="form-group">
						<label for="ce-end">Woke up</label>
						<input id="ce-end" type="time" bind:value={editForm.endTime} />
						<small>Leave empty if they're still asleep.</small>
					</div>
				{:else if editingMoment.kind === 'meal' || editingMoment.kind === 'snack'}
					<div class="form-group">
						<label for="ce-detail">What was it</label>
						<input id="ce-detail" type="text" bind:value={editForm.detail} />
					</div>
					<div class="form-group">
						<span class="field-label">Appetite</span>
						<div class="segmented">
							{#each APPETITES as a (a.value)}
								<button
									type="button"
									class:active={editForm.appetite === a.value}
									on:click={() =>
										(editForm.appetite = editForm.appetite === a.value ? '' : a.value)}
								>
									{a.label}
								</button>
							{/each}
						</div>
					</div>
				{:else if editingMoment.kind === 'potty'}
					<div class="form-group">
						<span class="field-label">Outcome</span>
						<div class="segmented">
							{#each POTTY_OUTCOMES as o (o.value)}
								<button
									type="button"
									class:active={editForm.outcome === o.value}
									on:click={() => (editForm.outcome = o.value)}
								>
									{o.label}
								</button>
							{/each}
						</div>
					</div>
				{:else if editingMoment.kind === 'meds'}
					<div class="form-group">
						<label for="ce-med">Medicine</label>
						<input id="ce-med" type="text" bind:value={editForm.name} required />
					</div>
					<div class="form-group">
						<label for="ce-dose">Dose</label>
						<input id="ce-dose" type="text" bind:value={editForm.dose} />
					</div>
				{:else}
					<div class="form-group">
						<label for="ce-text"
							>{editingMoment.kind === 'headsup' ? 'What happened' : 'The note'}</label
						>
						<textarea id="ce-text" rows="4" bind:value={editForm.text} required></textarea>
					</div>
				{/if}

				<div class="button-row">
					<button type="submit" class="btn btn-primary" disabled={editSaving}>
						<Icon name="quill" size={16} />
						{editSaving ? 'Saving…' : 'Save'}
					</button>
					<button type="button" class="btn btn-secondary" on:click={() => (editingMoment = null)}>
						Cancel
					</button>
				</div>

				<button
					type="button"
					class="btn btn-danger erase-moment"
					on:click={deleteEditingMoment}
					disabled={editSaving}
				>
					<Icon name="urn" size={16} /> Erase this moment
				</button>
			</form>
		</div>
	</div>
{/if}

<style>
	.care-notes-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-body);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.care-notes-link:hover {
		color: var(--accent-bright);
	}

	.cockpit-loading {
		padding: 0.5rem 0;
	}

	/* ── The pinned morning note ──────────────────────────── */
	.morning-note {
		padding: 0.85rem 1rem;
		margin-bottom: 1rem;
		background: var(--accent-tint);
		border: 1px solid var(--border-gilt);
		border-radius: var(--radius-sm);
	}

	.morning-note.seen {
		background: var(--surface-2);
		border-color: var(--border-soft);
	}

	.mn-head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		color: var(--accent);
		--icon-accent: var(--accent);
	}

	.mn-label {
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.mn-seen {
		margin-left: auto;
	}

	.mn-body {
		margin: 0.5rem 0 0;
		font-size: 0.95rem;
		line-height: 1.5;
		color: var(--text);
		overflow-wrap: anywhere;
	}

	.mn-author {
		display: block;
		margin-top: 0.25rem;
		font-size: 0.78rem;
		font-style: italic;
		color: var(--text-faint);
	}

	/* ── Kid chips ────────────────────────────────────────── */
	.kid-chips,
	.sheet-kids {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		margin-bottom: 1rem;
	}

	.kid-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 40px;
		padding: 0.3rem 0.85rem 0.3rem 0.45rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--text-muted);
		font-family: var(--font-display);
		font-size: 0.85rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.kid-chip:hover {
		color: var(--accent-bright);
		border-color: var(--border-gilt);
	}

	.kid-chip.active {
		color: var(--accent-bright);
		border-color: var(--border-gilt);
		background: var(--accent-dim);
	}

	.chip-face {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 1px solid var(--border-gilt);
		object-fit: cover;
		flex-shrink: 0;
	}

	.chip-everyone {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 1px solid var(--border-soft);
		background: var(--accent-tint);
		--icon-accent: var(--accent);
		flex-shrink: 0;
	}

	/* ── Moment buttons ───────────────────────────────────── */
	.moment-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(92px, 100%), 1fr));
		gap: 0.45rem;
		margin-bottom: 1rem;
	}

	.moment-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		min-height: 60px;
		padding: 0.45rem 0.35rem 0.4rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		cursor: pointer;
		transition: all var(--transition-fast);
		--icon-accent: var(--accent);
	}

	.moment-btn:hover {
		border-color: var(--border-gilt);
		background: var(--accent-tint);
		transform: translateY(-1px);
		box-shadow: var(--shadow-sm);
	}

	.moment-btn:active {
		transform: scale(0.97);
	}

	.moment-icon {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
	}

	.moment-label {
		font-family: var(--font-display);
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		color: var(--text);
	}

	.moment-hint {
		font-size: 0.62rem;
		line-height: 1.2;
		text-align: center;
		color: var(--text-faint);
	}

	.moment-btn.danger {
		--icon-accent: var(--danger);
	}

	.moment-btn.danger:hover {
		border-color: var(--danger);
		background: var(--danger-dim);
	}

	.moment-btn.danger .moment-label {
		color: var(--danger);
	}

	/* The nap button borrows the shift timer's moss while running. */
	.moment-btn.running {
		border-color: rgba(111, 191, 115, 0.45);
		background-image: radial-gradient(80% 100% at 50% 0%, var(--growing-dim), transparent 75%);
		--icon-accent: var(--growing);
	}

	.moment-btn.running .moment-label {
		color: var(--growing);
	}

	.moment-btn.running .moment-hint {
		color: var(--growing);
		font-variant-numeric: tabular-nums;
	}

	/* ── Nap pills ────────────────────────────────────────── */
	.nap-pills {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		margin-bottom: 1rem;
	}

	.nap-pill {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.5rem 0.8rem;
		background: linear-gradient(90deg, var(--growing-dim), transparent 70%);
		border: 1px solid rgba(111, 191, 115, 0.35);
		border-radius: 999px;
		color: var(--growing);
		--icon-accent: var(--growing);
	}

	.nap-pill-name {
		font-family: var(--font-display);
		font-size: 0.9rem;
		font-weight: 600;
	}

	.nap-pill-time {
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}

	.nap-end {
		margin-left: auto;
		color: var(--growing);
		border-color: rgba(111, 191, 115, 0.4);
		--icon-accent: var(--growing);
	}

	.nap-end:hover:not(:disabled) {
		background: var(--growing-dim);
		border-color: var(--growing);
		color: var(--growing);
	}

	/* ── Timeline ─────────────────────────────────────────── */
	.cockpit-timeline {
		display: flex;
		flex-direction: column;
	}

	.ct-row {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.6rem 0.25rem;
		border-bottom: 1px solid var(--border-soft);
	}

	.ct-row:last-child {
		border-bottom: none;
	}

	.ct-row.live {
		background: linear-gradient(90deg, var(--growing-dim), transparent 65%);
		border-radius: var(--radius-sm);
	}

	.ct-row.flagged {
		background: linear-gradient(90deg, var(--danger-dim), transparent 65%);
		border-radius: var(--radius-sm);
	}

	.ct-time {
		flex-shrink: 0;
		width: 68px;
		padding-top: 0.1rem;
		font-variant-numeric: tabular-nums;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-faint);
		text-align: right;
	}

	.ct-icon {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 1px solid var(--border-soft);
		background: var(--surface-2);
		color: var(--text-muted);
		--icon-accent: var(--accent);
	}

	.ct-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		padding-top: 0.1rem;
	}

	.ct-kids {
		font-family: var(--font-display);
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--accent-bright);
	}

	.ct-text {
		color: var(--text);
		font-size: 0.95rem;
		overflow-wrap: anywhere;
	}

	.ct-sub {
		font-size: 0.8rem;
		color: var(--text-faint);
	}

	.ct-star {
		color: var(--accent);
		--icon-accent: var(--accent-bright);
	}

	.ct-actions {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	.ct-edit {
		width: 30px;
		height: 30px;
		min-height: 30px;
	}

	.btn-small.growing {
		color: var(--growing);
		border-color: rgba(111, 191, 115, 0.4);
		--icon-accent: var(--growing);
	}

	.btn-small.growing:hover:not(:disabled) {
		background: var(--growing-dim);
		border-color: var(--growing);
		color: var(--growing);
	}

	/* ── Sheets ───────────────────────────────────────────── */
	.potty-options {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.6rem;
		margin: 0.5rem 0 0.75rem;
	}

	.potty-option {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		min-height: 64px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text);
		font-family: var(--font-display);
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.potty-option:hover:not(:disabled) {
		border-color: var(--border-gilt);
		background: var(--accent-tint);
	}

	.potty-option.star {
		color: var(--accent-bright);
		border-color: var(--border-gilt);
		--icon-accent: var(--accent-bright);
	}

	.sheet-note {
		font-size: 0.82rem;
		font-style: italic;
		color: var(--text-faint);
		margin-bottom: 0.5rem;
	}

	.dose-note {
		color: var(--danger);
		font-style: normal;
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

	.segmented {
		display: flex;
		gap: 0.3rem;
		padding: 0.25rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
	}

	.segmented button {
		flex: 1;
		min-height: 40px;
		background: none;
		border: none;
		border-radius: 6px;
		color: var(--text-faint);
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.segmented button.active {
		background: var(--accent-dim);
		color: var(--accent-bright);
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	textarea {
		resize: vertical;
		min-height: 96px;
	}

	.erase-moment {
		width: 100%;
		margin-top: 1.1rem;
	}

	@media (max-width: 768px) {
		.ct-time {
			width: 56px;
			font-size: 0.74rem;
		}

		.potty-options {
			grid-template-columns: 1fr;
		}

		.potty-option {
			min-height: 52px;
			flex-direction: row;
		}
	}
</style>
