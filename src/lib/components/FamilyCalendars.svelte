<script>
	import { onMount, tick } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { toast, confirm as confirmModal } from '$lib/stores/toast.js';
	import { errorMessage } from '$lib/errors.js';
	import Icon from '$lib/icons/Icon.svelte';
	import {
		CALENDAR_COLORS,
		firstName,
		feedHost,
		normalizeFeedUrl,
		agoLabel,
		syncCalendar,
		calendarWho
	} from '$lib/familyCalendar.js';

	/*
	 * The calendar settings sheet on Home → Calendar: connect a Google
	 * calendar by its secret iCal address — a parent's own, or the family's —
	 * and choose, per calendar, whether it shows on Home and what the nanny
	 * sees of it. Nothing is written back to Google.
	 */

	/** @type {any[]} every connected calendar the parent can see */
	export let calendars = [];
	/** @type {any[]} the parents' profiles (family and admin) */
	export let parents = [];
	/** @type {any} */
	export let user = null;
	/** Who "the nanny" is on screen: their first name when there's one. */
	export let nannyName = 'The nanny';
	/** Open straight onto the connect form (Home's "Connect a calendar"). */
	export let startWithConnect = false;
	export let onclose = () => {};
	/** @type {() => (Promise<void> | void)} */
	export let onchange = () => {};

	/**
	 * @typedef {{ id: number | null, whose: string, name: string, url: string, color: string, nannySees: string }} CalendarForm
	 */

	/** @type {'list' | 'form'} */
	let mode = 'list';
	/** @type {CalendarForm} */
	let form = blankForm();
	/** The calendar being edited, as stored. */
	/** @type {any} */
	let editing = null;
	/** Whether the name / sharing were chosen by hand (else they follow "whose"). */
	let nameTouched = false;
	let seesTouched = false;
	let saving = false;
	/** @type {number | null} */
	let syncingId = null;
	let now = Date.now();
	/** @type {HTMLElement | null} */
	let sheet = null;

	onMount(() => {
		if (startWithConnect) startConnect();
		sheet?.focus();
	});

	$: parentIds = new Set(parents.map((p) => p.id));
	$: namesById = Object.fromEntries(parents.map((p) => [p.id, p.full_name || '']));
	// The family calendar's own: feeds belonging to a parent. (The nanny's
	// availability calendars and the old planner's manual entries stay on the
	// schedule page.)
	$: familyCalendars = calendars.filter((c) => c.calendar_url && parentIds.has(c.user_id));

	/** @returns {CalendarForm} */
	function blankForm() {
		return { id: null, whose: '', name: '', url: '', color: CALENDAR_COLORS[0], nannySees: 'busy' };
	}

	/** @param {string} whose a parent's id, or 'family' */
	function defaultName(whose) {
		if (whose === 'family') return 'Family';
		const name = firstName(namesById[whose]);
		return name ? `${name}'s calendar` : 'My calendar';
	}

	/** @param {string} whose */
	function pickWhose(whose) {
		const previous = form.whose;
		form.whose = whose;
		if (!nameTouched || !form.name.trim() || form.name === defaultName(previous)) {
			form.name = defaultName(whose);
			nameTouched = false;
		}
		// The family calendar can't be "busy" — it's no one person's time.
		if (!seesTouched) form.nannySees = whose === 'family' ? 'nothing' : 'busy';
		if (whose === 'family' && form.nannySees === 'busy') form.nannySees = 'nothing';
	}

	async function startConnect() {
		editing = null;
		nameTouched = false;
		seesTouched = false;
		const used = new Set(familyCalendars.map((c) => c.color));
		form = {
			...blankForm(),
			color: CALENDAR_COLORS.find((c) => !used.has(c)) || CALENDAR_COLORS[0]
		};
		// Start on "mine" unless this parent already has one; then the family's.
		const mineTaken = familyCalendars.some((c) => c.user_id === user?.id && !c.is_family);
		const familyTaken = familyCalendars.some((c) => c.is_family);
		pickWhose(mineTaken && !familyTaken ? 'family' : user?.id || 'family');
		mode = 'form';
		await tick();
		document.getElementById('fc-url')?.focus();
	}

	/** @param {any} cal */
	async function startEdit(cal) {
		editing = cal;
		nameTouched = true;
		seesTouched = true;
		form = {
			id: cal.id,
			whose: cal.is_family ? 'family' : cal.user_id,
			name: cal.calendar_name || '',
			url: cal.calendar_url || '',
			color: cal.color || CALENDAR_COLORS[0],
			nannySees: cal.nanny_sees || 'nothing'
		};
		mode = 'form';
		await tick();
		document.getElementById('fc-name')?.focus();
	}

	function backToList() {
		mode = 'list';
		editing = null;
	}

	/** @param {string} url */
	function typeFor(url) {
		const host = feedHost(url);
		if (host.endsWith('google.com')) return 'google';
		if (/outlook|office|live\.com/.test(host)) return 'outlook';
		return 'ical';
	}

	async function save() {
		const url = normalizeFeedUrl(form.url);
		if (!/^https?:\/\//i.test(url)) {
			toast.error('Paste the calendar’s secret address — it starts with https:// (or webcal://)');
			return;
		}
		const name = form.name.trim();
		if (!name) {
			toast.error('Give the calendar a name');
			return;
		}
		if (!form.whose) {
			toast.error('Say whose calendar it is');
			return;
		}

		const isFamily = form.whose === 'family';
		/** @type {Record<string, any>} */
		const fields = {
			user_id: isFamily ? editing?.user_id || user.id : form.whose,
			calendar_name: name,
			calendar_url: url,
			calendar_type: typeFor(url),
			color: form.color,
			is_family: isFamily,
			nanny_sees: isFamily && form.nannySees === 'busy' ? 'nothing' : form.nannySees,
			sync_enabled: true
		};

		saving = true;
		try {
			/** @type {number} */
			let id;
			let needsSync = true;
			if (editing) {
				const { data, error } = await supabase
					.from('parent_calendars')
					.update(fields)
					.eq('id', editing.id)
					.select('id');
				if (error) throw error;
				if (!data || data.length === 0) throw new Error('the database refused the change');
				id = editing.id;
				needsSync = normalizeFeedUrl(editing.calendar_url || '') !== url;
			} else {
				// The same address connected before (in the old planner, say):
				// take that one over rather than showing every event twice.
				const existing = familyCalendars.find((c) => normalizeFeedUrl(c.calendar_url) === url);
				const { data, error } = existing
					? await supabase
							.from('parent_calendars')
							.update({ ...fields, show_on_home: true })
							.eq('id', existing.id)
							.select('id')
					: await supabase
							.from('parent_calendars')
							.insert({ ...fields, show_on_home: true })
							.select('id');
				if (error) throw error;
				if (!data || data.length === 0) throw new Error('the database refused the change');
				id = data[0].id;
			}

			backToList();
			await onchange();

			if (needsSync) {
				syncingId = id;
				const result = await syncCalendar(supabase, id);
				syncingId = null;
				if (result.ok) toast.success(`${name} is connected — ${result.synced} events`);
				else toast.error(`${name} is saved, but the first sync failed: ${result.error}`);
				await onchange();
			} else {
				toast.success('Saved');
			}
		} catch (err) {
			toast.error('Couldn’t save the calendar: ' + errorMessage(err));
		} finally {
			saving = false;
			syncingId = null;
		}
	}

	/**
	 * @param {any} cal
	 * @param {'show_on_home' | 'nanny_sees'} field
	 * @param {boolean | string} value
	 */
	async function setField(cal, field, value) {
		const previous = cal[field];
		cal[field] = value;
		calendars = calendars;
		try {
			const { data, error } = await supabase
				.from('parent_calendars')
				.update({ [field]: value })
				.eq('id', cal.id)
				.select('id');
			if (error) throw error;
			if (!data || data.length === 0) throw new Error('the database refused the change');
		} catch (err) {
			cal[field] = previous;
			calendars = calendars;
			toast.error('Couldn’t change that: ' + errorMessage(err));
		}
		await onchange();
	}

	/** @param {any} cal */
	async function syncNow(cal) {
		syncingId = cal.id;
		const result = await syncCalendar(supabase, cal.id);
		syncingId = null;
		if (result.ok) toast.success(`Synced ${result.synced} events`);
		else toast.error('Sync failed: ' + result.error);
		now = Date.now();
		await onchange();
	}

	async function remove() {
		if (!editing) return;
		const cal = editing;
		const ok = await confirmModal.show({
			title: 'Remove calendar',
			message: `Remove "${cal.calendar_name}"? Its events leave Home and ${nannyName}'s view. Nothing changes in Google.`,
			confirmText: 'Remove',
			danger: true
		});
		if (!ok) return;
		try {
			const { data, error } = await supabase
				.from('parent_calendars')
				.delete()
				.eq('id', cal.id)
				.select('id');
			if (error) throw error;
			if (!data || data.length === 0) throw new Error('the database refused the delete');
			backToList();
			toast.success(`${cal.calendar_name} removed`);
			await onchange();
		} catch (err) {
			toast.error('Couldn’t remove it: ' + errorMessage(err));
		}
	}

	/** @param {{ is_family?: boolean }} cal */
	function seesOptions(cal) {
		return cal.is_family
			? [
					{ value: 'nothing', label: 'Nothing' },
					{ value: 'details', label: 'Everything' }
				]
			: [
					{ value: 'nothing', label: 'Nothing' },
					{ value: 'busy', label: 'Busy times' },
					{ value: 'details', label: 'Everything' }
				];
	}

	/**
	 * @param {string} sees
	 * @param {boolean} isFamily
	 * @param {string} who
	 */
	function seesHint(sees, isFamily, who) {
		if (sees === 'busy') return `${nannyName} sees when ${who} is busy — never what.`;
		if (sees === 'details')
			return isFamily
				? `${nannyName} sees the family's events, names and all.`
				: `${nannyName} sees ${who}'s events, names and all.`;
		return `${nannyName} doesn't see this calendar.`;
	}

	/** @param {KeyboardEvent} event */
	function handleKeydown(event) {
		if (event.key !== 'Escape') return;
		if (mode === 'form' && !startWithConnect) backToList();
		else onclose();
	}

	$: formIsFamily = form.whose === 'family';
	$: formWho = formIsFamily ? 'the family' : firstName(namesById[form.whose]) || 'they';
</script>

<div class="modal-overlay" on:click={onclose} role="presentation">
	<div
		class="modal-content cal-sheet"
		bind:this={sheet}
		on:click|stopPropagation
		on:keydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="fc-title"
		tabindex="-1"
	>
		{#if mode === 'list'}
			<h2 id="fc-title">Calendars</h2>
			<p class="sheet-lede">
				Each of you connects your own Google calendar, and one of you connects the family's. Only
				its secret address is needed, and nothing is ever written back to Google.
			</p>

			{#if familyCalendars.length === 0}
				<p class="sheet-quiet">No calendars connected yet.</p>
			{:else}
				<ul class="cal-list">
					{#each familyCalendars as cal (cal.id)}
						{@const who = calendarWho(cal, namesById)}
						<li class="cal-card" style:--cal={cal.color || null}>
							<div class="cal-top">
								<span class="cal-swatch" aria-hidden="true"></span>
								<div class="cal-names">
									<span class="cal-name">{cal.calendar_name}</span>
									<span class="cal-meta">{who} · {feedHost(cal.calendar_url)}</span>
								</div>
								<button
									type="button"
									class="icon-btn"
									on:click={() => startEdit(cal)}
									aria-label="Edit {cal.calendar_name}"
								>
									<Icon name="quill" size={15} />
								</button>
							</div>

							<div class="cal-fresh" class:bad={cal.sync_error}>
								<span>
									{#if syncingId === cal.id}
										Syncing…
									{:else if cal.sync_error}
										Last sync failed: {cal.sync_error}
									{:else}
										Synced {agoLabel(cal.last_synced, now)}
									{/if}
								</span>
								<button
									type="button"
									class="btn-small"
									disabled={syncingId !== null}
									on:click={() => syncNow(cal)}>Sync now</button
								>
							</div>

							<label class="switch">
								<input
									type="checkbox"
									checked={!!cal.show_on_home}
									on:change={(e) => setField(cal, 'show_on_home', e.currentTarget.checked)}
								/>
								<span class="switch-track" aria-hidden="true"></span>
								<span class="switch-label">Show on Home</span>
							</label>

							<fieldset class="sees">
								<legend>{nannyName} sees</legend>
								<div class="seg">
									{#each seesOptions(cal) as opt (opt.value)}
										<button
											type="button"
											class:active={cal.nanny_sees === opt.value}
											aria-pressed={cal.nanny_sees === opt.value}
											on:click={() => setField(cal, 'nanny_sees', opt.value)}>{opt.label}</button
										>
									{/each}
								</div>
								<small>{seesHint(cal.nanny_sees, !!cal.is_family, who)}</small>
							</fieldset>
						</li>
					{/each}
				</ul>
			{/if}

			<div class="button-row">
				<button type="button" class="btn btn-primary" on:click={startConnect}>
					<Icon name="plus" size={15} /> Connect a calendar
				</button>
				<button type="button" class="btn btn-secondary" on:click={onclose}>Done</button>
			</div>
		{:else}
			<h2 id="fc-title">{editing ? 'Edit calendar' : 'Connect a calendar'}</h2>

			<form on:submit|preventDefault={save}>
				<fieldset class="form-group whose">
					<legend>Whose calendar</legend>
					<div class="seg">
						{#each parents as p (p.id)}
							<button
								type="button"
								class:active={form.whose === p.id}
								aria-pressed={form.whose === p.id}
								on:click={() => pickWhose(p.id)}>{firstName(p.full_name) || 'Parent'}</button
							>
						{/each}
						<button
							type="button"
							class:active={formIsFamily}
							aria-pressed={formIsFamily}
							on:click={() => pickWhose('family')}>The family's</button
						>
					</div>
				</fieldset>

				<div class="form-group">
					<label for="fc-url">Secret address in iCal format</label>
					<input
						id="fc-url"
						type="url"
						inputmode="url"
						autocomplete="off"
						spellcheck="false"
						bind:value={form.url}
						placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
						required
					/>
					<details class="howto">
						<summary>Where do I find it?</summary>
						<ol>
							<li>Open Google Calendar on a computer (the phone app doesn't show it).</li>
							<li>
								Settings (the gear) → under <em>Settings for my calendars</em>, pick the calendar.
							</li>
							<li>
								Scroll to <em>Integrate calendar</em> and copy
								<em>Secret address in iCal format</em>.
							</li>
						</ol>
						<p>
							Anyone with that address can read the calendar, so it's kept where only the two of you
							can see it. Outlook and iCloud work too — use their published ICS or webcal link.
						</p>
					</details>
				</div>

				<div class="form-group">
					<label for="fc-name">Name</label>
					<input
						id="fc-name"
						type="text"
						maxlength="60"
						bind:value={form.name}
						on:input={() => (nameTouched = true)}
						required
					/>
				</div>

				<fieldset class="form-group">
					<legend>Color</legend>
					<div class="swatches">
						{#each CALENDAR_COLORS as color (color)}
							<button
								type="button"
								class="swatch"
								class:active={form.color === color}
								style:--cal={color}
								aria-label="Color {color}"
								aria-pressed={form.color === color}
								on:click={() => (form.color = color)}
							></button>
						{/each}
					</div>
				</fieldset>

				<fieldset class="form-group sees">
					<legend>{nannyName} sees</legend>
					<div class="seg">
						{#each seesOptions({ is_family: formIsFamily }) as opt (opt.value)}
							<button
								type="button"
								class:active={form.nannySees === opt.value}
								aria-pressed={form.nannySees === opt.value}
								on:click={() => {
									form.nannySees = opt.value;
									seesTouched = true;
								}}>{opt.label}</button
							>
						{/each}
					</div>
					<small>{seesHint(form.nannySees, formIsFamily, formWho)}</small>
				</fieldset>

				<div class="button-row">
					<button type="submit" class="btn btn-primary" disabled={saving}>
						{saving ? 'Connecting…' : editing ? 'Save' : 'Connect'}
					</button>
					<button
						type="button"
						class="btn btn-secondary"
						on:click={startWithConnect && !editing ? onclose : backToList}>Cancel</button
					>
				</div>

				{#if editing}
					<button type="button" class="remove" on:click={remove}>
						<Icon name="urn" size={14} /> Remove this calendar
					</button>
				{/if}
			</form>
		{/if}
	</div>
</div>

<style>
	.cal-sheet {
		max-width: min(560px, calc(100vw - 2rem));
	}

	.cal-sheet:focus {
		outline: none;
	}

	.sheet-lede {
		margin: -0.4rem 0 1rem;
		font-size: 0.92rem;
		line-height: 1.5;
		color: var(--text-muted);
	}

	.sheet-quiet {
		margin: 0 0 0.5rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.cal-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.cal-card {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding: 0.85rem 0.95rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-left: 4px solid var(--cal, var(--arcane));
		border-radius: var(--radius-sm);
	}

	.cal-top {
		display: flex;
		align-items: center;
		gap: 0.65rem;
	}

	.cal-swatch {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--cal, var(--arcane));
	}

	.cal-names {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.cal-name {
		font-weight: 700;
		color: var(--text);
		overflow-wrap: anywhere;
	}

	.cal-meta {
		font-size: 0.8rem;
		color: var(--text-faint);
		overflow-wrap: anywhere;
	}

	.cal-fresh {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		font-size: 0.82rem;
		color: var(--text-muted);
	}

	.cal-fresh.bad {
		color: var(--danger);
	}

	.cal-fresh .btn-small {
		flex-shrink: 0;
	}

	/* ── The Show-on-Home switch ───────────────── */

	.switch {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0;
		min-height: 36px;
		cursor: pointer;
		text-transform: none;
		letter-spacing: 0;
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--text);
	}

	.switch input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}

	.switch-track {
		position: relative;
		width: 40px;
		height: 22px;
		flex-shrink: 0;
		border-radius: 999px;
		background: var(--surface);
		border: 1px solid var(--border);
		transition: background var(--transition-fast);
	}

	.switch-track::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--text-faint);
		transition: transform var(--transition-fast);
	}

	.switch input:checked + .switch-track {
		background: var(--accent-dim);
		border-color: var(--accent);
	}

	.switch input:checked + .switch-track::after {
		transform: translateX(18px);
		background: var(--accent);
	}

	.switch input:focus-visible + .switch-track {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	/* ── Segmented choices ─────────────────────── */

	/* Unset the browser's fieldset frame; in the form, .form-group spaces them. */
	fieldset {
		margin-top: 0;
		margin-inline: 0;
		padding: 0;
		border: none;
		min-width: 0;
	}

	.cal-card fieldset {
		margin-bottom: 0;
	}

	legend {
		margin-bottom: 0.4rem;
		padding: 0;
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.seg {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.seg button {
		min-height: 36px;
		padding: 0.3rem 0.85rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--text-muted);
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.seg button:hover {
		border-color: var(--border-gilt);
		color: var(--text);
	}

	.seg button.active {
		background: var(--accent-dim);
		border-color: var(--accent);
		color: var(--accent-bright);
	}

	.sees small {
		display: block;
		margin-top: 0.4rem;
		font-size: 0.82rem;
		color: var(--text-faint);
	}

	/* ── The connect form ──────────────────────── */

	.howto {
		margin-top: 0.5rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.howto summary {
		cursor: pointer;
		color: var(--accent-bright);
		font-weight: 600;
	}

	.howto ol {
		margin: 0.5rem 0 0.4rem;
		padding-left: 1.2rem;
		line-height: 1.5;
	}

	.howto p {
		margin: 0;
		line-height: 1.5;
		color: var(--text-faint);
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.swatch {
		width: 36px;
		height: 36px;
		min-height: 36px;
		padding: 0;
		border-radius: 50%;
		border: 2px solid var(--surface);
		background: var(--cal);
		box-shadow: 0 0 0 1px var(--border);
		cursor: pointer;
	}

	.swatch.active {
		box-shadow: 0 0 0 2px var(--accent-bright);
	}

	.remove {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 1rem;
		padding: 0.4rem 0;
		min-height: 36px;
		background: none;
		border: none;
		color: var(--danger);
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
	}
</style>
