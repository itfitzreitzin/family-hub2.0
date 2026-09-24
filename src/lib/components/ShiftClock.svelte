<script>
	import { onMount, onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import { supabase } from '$lib/supabase';
	import { toast } from '$lib/stores/toast.js';
	import { errorMessage } from '$lib/errors.js';
	import {
		localDateString,
		localTimeString,
		combineLocalDateTime,
		formatDuration,
		hoursBetween,
		formatTime
	} from '$lib/time.js';
	import { draftWrapUp } from '$lib/care.js';
	import { avatarFor } from '$lib/art.js';
	import Icon from '$lib/icons/Icon.svelte';

	/*
	 * Clocking in and out, at the top of Care → Today. The nanny clocks their
	 * own shifts; a parent sees whoever is on the clock and can clock them in
	 * or out. Only one nanny is on the clock at a time, so "the shift" is the one
	 * open time entry. It's bound up to the page, which hands it to the Care
	 * Day so moments logged during it ride along to the wrap-up.
	 */

	/** @type {any} */
	export let user = null;
	/** @type {any} */
	export let profile = null;
	/** The open time_entries row, or null when no one is on the clock. */
	/** @type {any} */
	export let shift = null;

	/** @type {any[]} */
	let nannies = [];
	let loading = true;
	let timerDisplay = '00:00:00';
	/** @type {ReturnType<typeof setInterval> | null} */
	let timerInterval = null;
	/** @type {ReturnType<typeof supabase.channel> | null} */
	let channel = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let resyncTimer = null;
	let shiftToken = 0;

	let clockingIn = false;
	let clockingOut = false;
	let showClockIn = false;
	let clockInTime = '09:00';
	/** @type {string | null} */
	let clockInNannyId = null;
	let showClockOut = false;
	let clockOutTime = '17:00';
	// The wrap-up: pre-drafted from the shift's moments, garnished by hand,
	// written into the Chronicle at clock-out.
	let wrapDraft = '';
	let wrapLine = '';
	/** @type {string[]} */
	let wrapKidIds = [];

	$: isNanny = profile?.role === 'nanny';
	$: isParent = profile?.role === 'family' || profile?.role === 'admin';

	onMount(() => {
		init();
	});

	onDestroy(() => {
		if (timerInterval) clearInterval(timerInterval);
		if (resyncTimer) clearTimeout(resyncTimer);
		if (channel) supabase.removeChannel(channel);
	});

	async function init() {
		try {
			if (isParent) {
				const { data, error } = await supabase
					.from('profiles')
					.select('*')
					.eq('role', 'nanny')
					.order('full_name');

				if (error) throw error;
				nannies = data || [];
			}

			await loadShift();

			if (!channel) {
				// Unfiltered on purpose: a clock-out UPDATE leaves the
				// clock_out=is.null set (filtered subscriptions never see it),
				// and DELETE events can't be filtered by non-key columns at all.
				channel = supabase
					.channel('shift-clock')
					.on(
						'postgres_changes',
						{ event: '*', schema: 'public', table: 'time_entries' },
						handleTimeEntryEvent
					)
					.subscribe();
			}
		} catch (err) {
			toast.error('Error loading the shift: ' + errorMessage(err));
		} finally {
			loading = false;
		}
	}

	async function loadShift() {
		// Tokens drop responses that arrive after a newer request, so a slow
		// fetch can't bring back a shift that has since ended.
		const token = ++shiftToken;

		let query = supabase
			.from('time_entries')
			.select('*')
			.is('clock_out', null)
			.order('clock_in', { ascending: false })
			.limit(1);
		if (isNanny) query = query.eq('nanny_id', user.id);

		const { data, error } = await query.maybeSingle();

		if (error) throw error;
		if (token !== shiftToken) return;

		if (data) {
			shift = data;
			startTimer();
		} else {
			shift = null;
			stopTimer();
		}
	}

	/** @param {any} payload */
	function handleTimeEntryEvent(payload) {
		const row = payload.new || {};

		// Fast paths keep the timer honest before the refetch lands
		if (payload.eventType === 'UPDATE' && shift && row.id === shift.id && row.clock_out) {
			shift = null;
			stopTimer();
			toast.info('Shift was clocked out on another device');
		} else if (
			payload.eventType === 'INSERT' &&
			!row.clock_out &&
			(isParent || row.nanny_id === user?.id)
		) {
			shift = row;
			startTimer();
		}

		scheduleResync();
	}

	// Collapse event bursts (a clock-out closing stray duplicates) into one refetch.
	function scheduleResync() {
		if (resyncTimer) clearTimeout(resyncTimer);
		resyncTimer = setTimeout(() => {
			resyncTimer = null;
			loadShift().catch((err) => {
				// Background sync: keep showing the last good state
				console.warn('Shift resync failed:', errorMessage(err));
			});
		}, 250);
	}

	function handleVisibility() {
		if (document.visibilityState !== 'visible' || loading) return;
		updateTimerDisplay();
		scheduleResync();
	}

	function updateTimerDisplay() {
		if (!shift) return;
		timerDisplay = formatDuration(Date.now() - new Date(shift.clock_in).getTime());
	}

	function startTimer() {
		if (timerInterval) clearInterval(timerInterval);
		updateTimerDisplay();
		timerInterval = setInterval(updateTimerDisplay, 1000);
	}

	function stopTimer() {
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = null;
		}
		timerDisplay = '00:00:00';
	}

	/** @param {string | null | undefined} nannyId */
	function nannyName(nannyId) {
		if (isNanny) return 'You';
		return nannies.find((n) => n.id === nannyId)?.full_name || 'The nanny';
	}

	// ── Clocking in ─────────────────────────────────────────

	function clockIn() {
		if (isParent && nannies.length === 0) {
			toast.error('Add a nanny first, in Settings → Accounts');
			return;
		}
		clockInNannyId = isNanny ? user.id : clockInNannyId || nannies[0].id;
		clockInTime = localTimeString();
		showClockIn = true;
	}

	async function confirmClockIn() {
		if (clockingIn || !clockInNannyId) return;
		clockingIn = true;

		try {
			const { data: activeEntry } = await supabase
				.from('time_entries')
				.select('*, profiles!time_entries_nanny_id_fkey(full_name)')
				.is('clock_out', null)
				.limit(1)
				.maybeSingle();

			if (activeEntry) {
				toast.error(
					`${activeEntry.profiles?.full_name || 'Another nanny'} is already clocked in. Only one nanny can be on the clock at a time.`
				);
				showClockIn = false;
				return;
			}

			const clockInDateTime = combineLocalDateTime(localDateString(), clockInTime);

			if (clockInDateTime.getTime() > Date.now() + 60 * 1000) {
				toast.error("Clock-in time can't be in the future");
				return;
			}

			const { data, error } = await supabase
				.from('time_entries')
				.insert({
					nanny_id: clockInNannyId,
					clock_in: clockInDateTime.toISOString()
				})
				.select()
				.single();

			if (error) throw error;

			shift = data;
			startTimer();
			showClockIn = false;
		} catch (err) {
			if (/** @type {any} */ (err).code === '23505') {
				// Unique index one_open_shift_per_nanny: an open shift already exists
				toast.error('This nanny is already clocked in.');
				showClockIn = false;
				await loadShift().catch(() => {});
			} else {
				toast.error('Error clocking in: ' + errorMessage(err));
			}
		} finally {
			clockingIn = false;
		}
	}

	// ── Clocking out ────────────────────────────────────────

	function clockOut() {
		if (!shift) return;
		clockOutTime = localTimeString();
		showClockOut = true;
		// Draft fills in as it arrives; the modal never waits on it.
		prepareWrapUp();
	}

	// Compose the wrap-up draft from whatever was logged this shift.
	// Best-effort: a failed fetch just means an empty draft.
	async function prepareWrapUp() {
		wrapDraft = '';
		wrapLine = '';
		wrapKidIds = [];
		if (!shift) return;

		try {
			const [momentsRes, kidsRes] = await Promise.all([
				supabase.from('care_moments').select('*').eq('shift_id', shift.id),
				supabase.from('family_members').select('*').eq('kind', 'child')
			]);

			if (momentsRes.error || kidsRes.error) return;

			const moments = momentsRes.data || [];
			const kids = kidsRes.data || [];
			const kidsById = new Map(kids.map((k) => [k.id, k]));

			wrapDraft = draftWrapUp(moments, kidsById, kids.length);
			wrapKidIds = [...new Set(moments.flatMap((/** @type {any} */ m) => m.kid_ids || []))];
		} catch {
			// The clock-out itself never waits on the chronicle
		}
	}

	// The day becomes a Chronicle entry: the tapped draft plus whatever was
	// added by hand, auto-linked to the shift. Empty days write nothing —
	// no guilt for quiet days.
	/** @param {any} closedRow */
	async function writeWrapUp(closedRow) {
		const line = wrapLine.trim();
		const body = [wrapDraft, line].filter(Boolean).join('\n\n');
		if (!body) return;

		try {
			const { error } = await supabase.from('chronicle_entries').insert({
				author_id: user.id,
				shift_id: closedRow.id,
				entry_date: localDateString(new Date(closedRow.clock_in)),
				body,
				tags: ['wrapup'],
				kid_ids: wrapKidIds
			});

			if (error) throw error;
			toast.success('The day is written into the Chronicle');
		} catch (err) {
			toast.error('Clocked out, but the wrap-up failed to save: ' + errorMessage(err));
		}
	}

	/** @param {Date} endTime */
	async function performClockOut(endTime) {
		if (clockingOut || !shift) return null;
		clockingOut = true;
		const nannyId = shift.nanny_id;

		try {
			// Fetch ALL open shifts for this nanny. Duplicates can exist (e.g. from
			// a double-tapped clock-in), and a single-row query errors on them.
			const { data: openEntries, error: fetchError } = await supabase
				.from('time_entries')
				.select('*')
				.eq('nanny_id', nannyId)
				.is('clock_out', null)
				.order('clock_in', { ascending: false });

			if (fetchError) throw fetchError;

			if (!openEntries || openEntries.length === 0) {
				toast.error('No active shift found for this nanny');
				return null;
			}

			// The newest open entry is the shift the timer displays; any older open
			// entries are stray duplicates. Close the strays first with 0 hours so
			// they can't inflate the week total or block future clock-ins — if that
			// fails, the real shift is still open and clock-out can be retried.
			const [activeEntry, ...staleEntries] = openEntries;

			for (const stale of staleEntries) {
				const { error: staleError } = await supabase
					.from('time_entries')
					.update({
						clock_out: stale.clock_in,
						hours: '0.00'
					})
					.eq('id', stale.id);

				if (staleError) throw staleError;
			}

			const hours = hoursBetween(new Date(activeEntry.clock_in), endTime);

			const { data: closedRow, error: updateError } = await supabase
				.from('time_entries')
				.update({
					clock_out: endTime.toISOString(),
					hours: hours.toFixed(2)
				})
				.eq('id', activeEntry.id)
				.select()
				.single();

			if (updateError) throw updateError;

			toast.success(`Clocked out! Worked ${hours.toFixed(2)} hours`);

			shift = null;
			stopTimer();
			return closedRow;
		} catch (err) {
			toast.error('Error clocking out: ' + errorMessage(err));
			return null;
		} finally {
			clockingOut = false;
		}
	}

	async function confirmClockOut() {
		if (!shift) return;

		const end = combineLocalDateTime(localDateString(), clockOutTime);
		const start = new Date(shift.clock_in);

		if (end.getTime() <= start.getTime()) {
			toast.error(`End time must be after clock-in (${formatTime(shift.clock_in)})`);
			return;
		}

		if (end.getTime() > Date.now() + 60 * 1000) {
			toast.error("Clock-out time can't be in the future");
			return;
		}

		const closedRow = await performClockOut(end);
		if (closedRow) {
			showClockOut = false;
			await writeWrapUp(closedRow);
		}
	}

	// A shift ended elsewhere (another device, a resync) takes its clock-out
	// prompt with it, so it can't resurface over the next shift.
	$: if (!shift && showClockOut) showClockOut = false;

	/** @param {KeyboardEvent} event */
	function handleKeydown(event) {
		if (event.key !== 'Escape') return;
		if (showClockOut) showClockOut = false;
		else if (showClockIn) showClockIn = false;
	}
</script>

<svelte:document on:visibilitychange={handleVisibility} />
<svelte:window on:focus={handleVisibility} on:keydown={handleKeydown} />

<section class="shift-clock">
	{#if loading}
		<div class="clock-idle">
			<div class="skeleton skeleton-line" style="width: 45%"></div>
		</div>
	{:else if shift}
		<!-- On the clock: a moss strip, and the Care Day below owns the screen. -->
		<div class="timer-strip">
			<span class="strip-glyph" aria-hidden="true"><Icon name="hourglass" size={22} /></span>
			{#if isParent}
				<img
					class="strip-face"
					src={avatarFor(shift.nanny_id)}
					alt=""
					width="28"
					height="28"
					draggable="false"
				/>
				<span class="strip-name">{nannyName(shift.nanny_id)}</span>
			{/if}
			<span class="badge badge-live"><span class="live-dot"></span> On the clock</span>
			<span class="strip-timer">{timerDisplay}</span>
			<span class="strip-since">since {formatTime(shift.clock_in)}</span>
			<button class="btn btn-danger btn-small strip-out" on:click={clockOut} disabled={clockingOut}>
				<Icon name="close" size={14} />
				{clockingOut ? 'Clocking out…' : 'Clock out'}
			</button>
		</div>
	{:else}
		<div class="clock-idle">
			<span class="idle-glyph" aria-hidden="true"><Icon name="candle" size={28} /></span>
			<div class="idle-text">
				<span class="idle-title">{isNanny ? 'Not clocked in' : 'No one on the clock'}</span>
				<span class="idle-hint">
					{#if isNanny}
						The hours are yours to begin
					{:else if nannies.length === 0}
						Add a nanny in <a href={resolve('/settings/accounts')}>Settings → Accounts</a> to clock them
						in
					{:else}
						Clock {nannies.length === 1 ? nannies[0].full_name : 'a nanny'} in when they arrive
					{/if}
				</span>
			</div>
			{#if isNanny || nannies.length > 0}
				<button class="btn btn-success idle-in" on:click={clockIn} disabled={clockingIn}>
					<Icon name="sprout" size={16} />
					{clockingIn ? 'Clocking in…' : 'Clock in'}
				</button>
			{/if}
		</div>
	{/if}
</section>

<!-- ── Clock in ───────────────────────────────────────── -->
{#if showClockIn}
	<div class="modal-overlay" on:click={() => (showClockIn = false)} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>Begin the shift</h2>

			{#if isParent && nannies.length > 1}
				<div class="form-group">
					<label for="sc-who">Clocking in</label>
					<select id="sc-who" bind:value={clockInNannyId}>
						{#each nannies as nanny (nanny.id)}
							<option value={nanny.id}>{nanny.full_name}</option>
						{/each}
					</select>
				</div>
			{:else}
				<p class="modal-lede">Clocking in <strong>{nannyName(clockInNannyId)}</strong></p>
			{/if}

			<div class="form-group">
				<label for="sc-in">Clock in time</label>
				<input id="sc-in" type="time" bind:value={clockInTime} />
				<small>Adjust if they started earlier or later.</small>
			</div>

			<div class="button-row">
				<button class="btn btn-success" on:click={confirmClockIn} disabled={clockingIn}>
					<Icon name="sprout" size={16} />
					{clockingIn ? 'Clocking in…' : 'Confirm'}
				</button>
				<button
					class="btn btn-secondary"
					on:click={() => (showClockIn = false)}
					disabled={clockingIn}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ── Clock out ──────────────────────────────────────── -->
{#if showClockOut && shift}
	<div class="modal-overlay" on:click={() => (showClockOut = false)} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>End the shift</h2>
			<p class="modal-lede">Clocking out <strong>{nannyName(shift.nanny_id)}</strong></p>
			<p class="modal-note">
				Started at {formatTime(shift.clock_in)} · {timerDisplay} elapsed
			</p>

			<div class="form-group">
				<label for="sc-out">Clock out time</label>
				<input id="sc-out" type="time" bind:value={clockOutTime} />
				<small>Adjust if they actually finished earlier.</small>
			</div>

			{#if wrapDraft}
				<div class="wrap-draft">
					<span class="wrap-label"><Icon name="grimoire" size={13} /> The day, as tapped</span>
					<p class="wrap-text">{wrapDraft}</p>
				</div>
			{/if}

			<div class="form-group">
				<label for="sc-wrap">In your own words</label>
				<textarea
					id="sc-wrap"
					rows="3"
					bind:value={wrapLine}
					placeholder="A line or two to top off the day — optional, dictation welcome."
				></textarea>
				<small>
					{wrapDraft
						? 'The tapped day plus your words become the Chronicle entry.'
						: 'Anything written here becomes the day’s Chronicle entry.'}
				</small>
			</div>

			<div class="button-row">
				<button class="btn btn-primary" on:click={confirmClockOut} disabled={clockingOut}>
					<Icon name="check" size={16} />
					{clockingOut ? 'Clocking out…' : 'Confirm'}
				</button>
				<button
					class="btn btn-secondary"
					on:click={() => (showClockOut = false)}
					disabled={clockingOut}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.shift-clock {
		margin-bottom: var(--section-gap);
	}

	/* ── Off the clock ────────────────────────────────────── */
	.clock-idle {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.85rem;
		padding: 0.95rem 1.1rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--card-radius);
	}

	.idle-glyph {
		display: grid;
		place-items: center;
		color: var(--text-faint);
		--icon-accent: var(--accent);
	}

	.idle-text {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 12rem;
	}

	.idle-title {
		font-family: var(--font-display);
		font-size: 0.95rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		color: var(--text);
	}

	.idle-hint {
		font-size: 0.86rem;
		color: var(--text-muted);
	}

	/* ── On the clock ─────────────────────────────────────── */
	.timer-strip {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.7rem;
		padding: 0.85rem 1rem;
		background: var(--surface-2);
		background-image: linear-gradient(90deg, var(--growing-dim), transparent 62%);
		border: 1px solid rgba(111, 191, 115, 0.4);
		border-radius: var(--card-radius);
	}

	.strip-glyph {
		display: grid;
		place-items: center;
		color: var(--growing);
		--icon-accent: var(--growing);
		animation: flicker 4s ease-in-out infinite;
	}

	.strip-face {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 1px solid var(--border-gilt);
		background: var(--surface-2);
		user-select: none;
		-webkit-user-drag: none;
	}

	.strip-name {
		font-family: var(--font-display);
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text);
	}

	.strip-timer {
		font-family: var(--font-body);
		font-variant-numeric: lining-nums tabular-nums;
		font-size: 1.6rem;
		font-weight: 700;
		line-height: 1;
		color: var(--growing);
		text-shadow: 0 0 22px var(--growing-dim);
	}

	.strip-since {
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.strip-out,
	.idle-in {
		margin-left: auto;
	}

	/* ── Modals ───────────────────────────────────────────── */
	.wrap-draft {
		padding: 0.75rem 0.9rem;
		margin-bottom: 1.1rem;
		background: var(--accent-tint);
		border: 1px solid var(--border-gilt);
		border-radius: var(--radius-sm);
	}

	.wrap-label {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
		--icon-accent: var(--accent);
	}

	.wrap-text {
		margin: 0.4rem 0 0;
		font-size: 0.92rem;
		line-height: 1.5;
		color: var(--text);
		overflow-wrap: anywhere;
	}

	textarea {
		resize: vertical;
		min-height: 84px;
	}

	.modal-lede {
		color: var(--text-muted);
		margin-bottom: 0.4rem;
	}

	.modal-note {
		font-size: 0.88rem;
		color: var(--text-faint);
		margin-bottom: 1.15rem;
	}

	@media (max-width: 768px) {
		.idle-in,
		.strip-out {
			width: 100%;
			margin-left: 0;
		}
	}
</style>
