<script>
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { toast, confirm as confirmModal } from '$lib/stores/toast.js';
	import { errorMessage } from '$lib/errors.js';
	import { localDateString, parseLocalDate } from '$lib/time.js';
	import {
		WEEKDAYS,
		WEEK_CHOICES,
		addDays,
		daysBetween,
		nextWeekday,
		weekdayOf,
		scheduleAround,
		cleanChoreTitle
	} from '$lib/chores.js';
	import Icon from '$lib/icons/Icon.svelte';

	/*
	 * Making or changing a chore: what, whose, and how often — once (by a day,
	 * or whenever), on a schedule (trash every Friday, recycling every other),
	 * or every so often (the plants, three days after they were last watered).
	 * Parents only; the nanny ticks chores off but doesn't make them.
	 */

	/** @type {any} */
	export let user = null;
	/** @type {{ id: string, name: string, color: string }[]} */
	export let people = [];
	/** The chore being changed; null for a new one. @type {import('$lib/chores.js').Chore | null} */
	export let chore = null;
	/** What a new one starts as — a starter chip, or the quick add's words. */
	/** @type {{ title?: string, assigned_to?: string | null, cadence?: string, every?: number, weekday?: number } | null} */
	export let draft = null;
	/** Whether the chore has been done before (a 'days' chore then counts from that). */
	export let hasRecord = false;
	/** @type {(chore: any) => void} */
	export let onsaved = () => {};
	/** @type {(id: number) => void} */
	export let onremoved = () => {};
	/** @type {() => void} */
	export let onclose = () => {};

	const today = localDateString();
	const tomorrow = addDays(today, 1);
	const start = chore || draft || {};

	let title = start.title || '';
	let who = (chore ? chore.assigned_to : draft?.assigned_to) || '';
	let cadence = start.cadence || 'weeks';
	let weeks = start.cadence === 'weeks' ? start.every || 1 : 1;
	let days = start.cadence === 'days' ? start.every || 3 : 3;
	let weekday =
		chore?.cadence === 'weeks' && chore.due_on
			? weekdayOf(chore.due_on)
			: (draft?.weekday ?? weekdayOf(today));
	/** For a schedule: the date of the next one, which fixes the weeks. */
	let nextOne = chore?.cadence === 'weeks' && chore.due_on ? scheduleAround(chore, today).next : '';
	/** For a one-off. */
	let by = 'whenever';
	let byDay = '';
	if (chore?.cadence === 'once' && chore.due_on) {
		if (chore.due_on === today) by = 'today';
		else if (chore.due_on === tomorrow) by = 'tomorrow';
		else {
			by = 'day';
			byDay = chore.due_on;
		}
	}
	/** For every so often: the first time it's due. */
	let firstDue = chore?.cadence === 'days' && chore.due_on ? chore.due_on : today;
	let note = chore?.note || '';
	let saving = false;

	/** @type {HTMLInputElement | null} */
	let titleInput = null;

	onMount(() => {
		if (!chore && !title) titleInput?.focus();
	});

	const BY_CHOICES = [
		{ value: 'whenever', label: 'Whenever' },
		{ value: 'today', label: 'Today' },
		{ value: 'tomorrow', label: 'Tomorrow' },
		{ value: 'day', label: 'A day…' }
	];

	const CADENCES = [
		{ value: 'once', label: 'Once' },
		{ value: 'weeks', label: 'On a schedule' },
		{ value: 'days', label: 'Every so often' }
	];

	/** @param {number} n */
	function everyWeeksLabel(n) {
		if (n === 1) return 'Every week';
		if (n === 2) return 'Every other week';
		return `Every ${n} weeks`;
	}

	/** @param {string} day */
	function dateLabel(day) {
		return parseLocalDate(day).toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	}

	// The next few of that weekday — one per week of the cycle, so "every
	// other Friday" can start this Friday or next.
	$: nextChoices = Array.from({ length: weeks }, (_, i) =>
		addDays(nextWeekday(today, weekday), 7 * i)
	);
	$: if (!nextChoices.includes(nextOne)) nextOne = nextChoices[0];

	$: cleanTitle = cleanChoreTitle(title);
	// A change in progress isn't lost to a stray tap outside: only a new,
	// still-empty sheet closes that way.
	$: dirty = !!chore || !!cleanTitle;

	/** @param {string} value */
	function pickCadence(value) {
		cadence = value;
	}

	function dueOn() {
		if (cadence === 'once') {
			if (by === 'today') return today;
			if (by === 'tomorrow') return tomorrow;
			if (by === 'day') return byDay || null;
			return null;
		}
		if (cadence === 'weeks') {
			// Keep the old start when the schedule is the same one, so its
			// record and streak still line up.
			if (chore?.cadence === 'weeks' && chore.due_on && chore.every === weeks) {
				const diff = daysBetween(chore.due_on, nextOne);
				if (diff >= 0 && diff % (7 * weeks) === 0) return chore.due_on;
			}
			return nextOne;
		}
		if (chore?.cadence === 'days' && hasRecord && chore.due_on) return chore.due_on;
		return firstDue || today;
	}

	async function save() {
		if (saving || !cleanTitle) return;
		const every = cadence === 'weeks' ? weeks : cadence === 'days' ? Math.round(days) : null;
		if (cadence === 'days' && (!every || every < 1 || every > 365)) {
			toast.error('Every so often is between 1 and 365 days.');
			return;
		}
		if (cadence === 'once' && by === 'day' && !byDay) {
			toast.error('Pick the day, or choose Whenever.');
			return;
		}

		const row = {
			title: cleanTitle,
			note: note.trim() || null,
			assigned_to: who || null,
			cadence,
			every,
			due_on: dueOn()
		};

		saving = true;
		try {
			const query = chore
				? supabase.from('chores').update(row).eq('id', chore.id)
				: supabase.from('chores').insert({ ...row, created_by: user?.id });
			const { data, error } = await query.select().single();
			if (error) throw error;
			onsaved(data);
			onclose();
		} catch (err) {
			toast.error('Error saving the chore: ' + errorMessage(err));
		} finally {
			saving = false;
		}
	}

	async function remove() {
		if (!chore) return;
		const ok = await confirmModal.show({
			title: 'Remove this chore',
			message: `Take "${chore.title}" off the board? What's been done stays in the record.`,
			confirmText: 'Remove',
			danger: true
		});
		if (!ok) return;
		try {
			const { error } = await supabase
				.from('chores')
				.update({ archived_at: new Date().toISOString() })
				.eq('id', chore.id);
			if (error) throw error;
			onremoved(chore.id);
			onclose();
		} catch (err) {
			toast.error('Error removing the chore: ' + errorMessage(err));
		}
	}

	/** @param {KeyboardEvent} event */
	function handleKeydown(event) {
		if (event.key === 'Escape') onclose();
	}

	// Tapping outside closes the sheet only when there's nothing to lose.
	function veil() {
		if (!dirty) onclose();
	}
</script>

<div class="modal-overlay" on:click={veil} role="presentation">
	<div
		class="modal-content chore-sheet"
		on:click|stopPropagation
		on:keydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="cs-title"
		tabindex="-1"
	>
		<h2 id="cs-title">{chore ? 'Change the chore' : 'A new chore'}</h2>

		<form on:submit|preventDefault={save}>
			<div class="form-group">
				<label for="cs-what">What needs doing</label>
				<input
					id="cs-what"
					type="text"
					maxlength="80"
					autocomplete="off"
					placeholder="Trash out"
					bind:this={titleInput}
					bind:value={title}
					required
				/>
			</div>

			<fieldset class="form-group">
				<legend>Whose</legend>
				<div class="seg">
					<button type="button" class:active={!who} aria-pressed={!who} on:click={() => (who = '')}
						>Anyone</button
					>
					{#each people as p (p.id)}
						<button
							type="button"
							class="person"
							style:--who={p.color}
							class:active={who === p.id}
							aria-pressed={who === p.id}
							on:click={() => (who = p.id)}>{p.name}</button
						>
					{/each}
				</div>
			</fieldset>

			<fieldset class="form-group">
				<legend>How often</legend>
				<div class="seg">
					{#each CADENCES as c (c.value)}
						<button
							type="button"
							class:active={cadence === c.value}
							aria-pressed={cadence === c.value}
							on:click={() => pickCadence(c.value)}>{c.label}</button
						>
					{/each}
				</div>

				{#if cadence === 'once'}
					<div class="sub">
						<span class="sub-label">By</span>
						<div class="seg">
							{#each BY_CHOICES as b (b.value)}
								<button
									type="button"
									class:active={by === b.value}
									aria-pressed={by === b.value}
									on:click={() => (by = b.value)}>{b.label}</button
								>
							{/each}
						</div>
						{#if by === 'day'}
							<input class="date" type="date" min={today} bind:value={byDay} aria-label="Done by" />
						{/if}
					</div>
				{:else if cadence === 'weeks'}
					<div class="sub">
						<div class="seg">
							{#each WEEK_CHOICES as n (n)}
								<button
									type="button"
									class:active={weeks === n}
									aria-pressed={weeks === n}
									on:click={() => (weeks = n)}>{everyWeeksLabel(n)}</button
								>
							{/each}
						</div>
						<span class="sub-label">On</span>
						<div class="seg days" role="group" aria-label="Which day">
							{#each WEEKDAYS as day, i (day)}
								<button
									type="button"
									class:active={weekday === i}
									aria-pressed={weekday === i}
									aria-label={day}
									on:click={() => (weekday = i)}>{day.slice(0, 3)}</button
								>
							{/each}
						</div>
						{#if weeks > 1}
							<span class="sub-label">Next one</span>
							<div class="seg">
								{#each nextChoices as day (day)}
									<button
										type="button"
										class:active={nextOne === day}
										aria-pressed={nextOne === day}
										on:click={() => (nextOne = day)}>{dateLabel(day)}</button
									>
								{/each}
							</div>
						{/if}
						<small
							>Due that day whether or not the last one got done — trash day, recycling. Ticked off
							any time before, or the day after.</small
						>
					</div>
				{:else}
					<div class="sub">
						<div class="every">
							<span>Every</span>
							<input
								type="number"
								inputmode="numeric"
								min="1"
								max="365"
								bind:value={days}
								aria-label="Every how many days"
							/>
							<span>{days === 1 ? 'day' : 'days'}</span>
						</div>
						{#if chore?.cadence === 'days' && hasRecord}
							<small>Counts from the last time it was done.</small>
						{:else}
							<label class="sub-label" for="cs-first">First due</label>
							<input id="cs-first" class="date" type="date" bind:value={firstDue} />
							<small
								>After that, the clock starts over each time it's done — the plants, the sheets.</small
							>
						{/if}
					</div>
				{/if}
			</fieldset>

			<div class="form-group">
				<label for="cs-note">Note <span class="optional">(optional)</span></label>
				<input
					id="cs-note"
					type="text"
					maxlength="200"
					placeholder="Bins by the side gate"
					bind:value={note}
				/>
			</div>

			<div class="button-row">
				<button type="submit" class="btn btn-primary" disabled={saving || !cleanTitle}>
					{saving ? 'Saving…' : chore ? 'Save' : 'Add the chore'}
				</button>
				<button type="button" class="btn btn-secondary" on:click={onclose}>Cancel</button>
			</div>

			{#if chore}
				<button type="button" class="remove" on:click={remove}>
					<Icon name="urn" size={14} /> Remove this chore
				</button>
			{/if}
		</form>
	</div>
</div>

<style>
	.chore-sheet {
		max-width: min(560px, calc(100vw - 2rem));
	}

	.chore-sheet:focus {
		outline: none;
	}

	/* Unset the browser's fieldset frame; .form-group spaces them. */
	fieldset {
		margin-top: 0;
		margin-inline: 0;
		padding: 0;
		border: none;
		min-width: 0;
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
		min-height: 38px;
		padding: 0.3rem 0.85rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--text-muted);
		font-size: 0.9rem;
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

	/* A person's choice carries their dot. */
	.seg button.person::before {
		content: '';
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 0.4rem;
		border-radius: 50%;
		background: var(--who);
		vertical-align: 0.05em;
	}

	.seg.days button {
		min-width: 3.1rem;
		padding-inline: 0.5rem;
	}

	.sub {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		margin-top: 0.75rem;
		padding: 0.8rem 0.9rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
	}

	.sub-label {
		margin: 0.2rem 0 0;
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.sub small {
		font-size: 0.82rem;
		line-height: 1.45;
		color: var(--text-faint);
	}

	.date {
		max-width: 12rem;
	}

	.every {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		color: var(--text);
		font-weight: 600;
	}

	.every input {
		width: 5rem;
		text-align: center;
		font-variant-numeric: lining-nums tabular-nums;
	}

	.optional {
		font-weight: 400;
		letter-spacing: 0.04em;
		text-transform: none;
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
