<script>
	import { createEventDispatcher } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import {
		formatTime,
		formatDateShort,
		formatDateWeekday,
		formatShiftLength,
		parseLocalDate
	} from '$lib/time.js';

	/** @type {string} 'YYYY-MM-DD' */
	export let selectedDateStr;
	/** @type {import('$lib/calendar.js').CalendarItem[]} */
	export let selectedItems = [];
	/** @type {import('$lib/calendar.js').CalendarItem[]} */
	export let upcoming = [];
	/** @type {string} */
	export let todayStr = '';
	/** Family/admin can add and edit shifts */
	export let canEdit = false;

	const dispatch = createEventDispatcher();

	const LEGEND = [
		{ kind: 'shift', label: 'Nanny shift' },
		{ kind: 'family', label: 'Family busy' },
		{ kind: 'nanny-busy', label: 'Nanny unavailable' },
		{ kind: 'payment', label: 'Payment due' }
	];

	$: dayHeading =
		selectedDateStr === todayStr ? 'Today' : formatDateWeekday(parseLocalDate(selectedDateStr));

	/** @param {import('$lib/calendar.js').CalendarItem} item */
	function timeLabel(item) {
		if (item.allDay) return 'All day';
		return `${formatTime(item.start)} – ${formatTime(item.end)}`;
	}
</script>

<aside class="side-panel">
	<!-- ── Selected day ──────────────────────────────── -->
	<section class="panel-card">
		<header class="panel-header">
			<span class="panel-glyph"><Icon name="sun" size={16} /></span>
			<div class="panel-titles">
				<h2>{dayHeading}</h2>
				<span class="panel-sub">{formatDateWeekday(parseLocalDate(selectedDateStr))}</span>
			</div>
		</header>

		{#if selectedItems.length === 0}
			<p class="panel-quiet">Nothing scheduled.</p>
		{:else}
			<ul class="item-list">
				{#each selectedItems as item (item.id)}
					<li>
						{#if canEdit && item.kind === 'shift'}
							<button
								type="button"
								class="item-row editable"
								on:click={() => dispatch('edititem', { item })}
							>
								<span class="kind-dot dot-{item.kind}" aria-hidden="true"></span>
								<span class="item-body">
									<span class="item-title">{item.title}</span>
									<span class="item-time">{timeLabel(item)}</span>
									{#if item.kind === 'shift' && item.raw?.start_time && item.raw?.end_time}
										<span class="item-meta"
											>{formatShiftLength(item.raw.start_time, item.raw.end_time)}</span
										>
									{/if}
									{#if item.raw?.notes}
										<span class="item-notes">{item.raw.notes}</span>
									{/if}
								</span>
								<Icon name="quill" size={12} />
							</button>
						{:else}
							<div class="item-row">
								<span class="kind-dot dot-{item.kind}" aria-hidden="true"></span>
								<span class="item-body">
									<span class="item-title">{item.title}</span>
									<span class="item-time">{timeLabel(item)}</span>
									{#if item.calendarName}
										<span class="item-meta">{item.calendarName}</span>
									{/if}
									{#if item.raw?.notes}
										<span class="item-notes">{item.raw.notes}</span>
									{/if}
								</span>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if canEdit}
			<button
				type="button"
				class="btn btn-primary btn-small add-btn"
				on:click={() => dispatch('addshift', { dateStr: selectedDateStr })}
			>
				<Icon name="plus" size={13} /> Add shift
			</button>
		{/if}
	</section>

	<!-- ── Upcoming ──────────────────────────────────── -->
	<section class="panel-card">
		<header class="panel-header">
			<span class="panel-glyph"><Icon name="hourglass" size={16} /></span>
			<div class="panel-titles">
				<h2>Upcoming</h2>
			</div>
		</header>

		{#if upcoming.length === 0}
			<p class="panel-quiet">Nothing on the horizon.</p>
		{:else}
			<ul class="item-list">
				{#each upcoming as item (item.id)}
					<li>
						<div class="item-row compact">
							<span class="kind-dot dot-{item.kind}" aria-hidden="true"></span>
							<span class="item-body">
								<span class="item-title">{item.title}</span>
								<span class="item-time">
									{formatDateShort(item.start)}{item.allDay ? '' : ` · ${formatTime(item.start)}`}
								</span>
							</span>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- ── Legend ────────────────────────────────────── -->
	<footer class="panel-legend">
		{#each LEGEND as entry (entry.kind)}
			<span class="legend-item">
				<span class="kind-dot dot-{entry.kind}" aria-hidden="true"></span>
				{entry.label}
			</span>
		{/each}
	</footer>
</aside>

<style>
	.side-panel {
		display: flex;
		flex-direction: column;
		gap: var(--grid-gap);
		min-width: 0;
	}

	.panel-card {
		padding: 1.1rem 1.2rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		box-shadow: var(--shadow-md);
	}

	.panel-header {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-bottom: 0.75rem;
	}

	.panel-glyph {
		display: grid;
		place-items: center;
		color: var(--text-faint);
		--icon-accent: var(--accent);
	}

	.panel-titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.panel-titles h2 {
		font-family: var(--font-display);
		font-size: 0.98rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		color: var(--text);
	}

	.panel-sub {
		font-size: 0.72rem;
		color: var(--text-faint);
	}

	.panel-quiet {
		font-size: 0.85rem;
		color: var(--text-faint);
		font-style: italic;
	}

	.item-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
	}

	.item-row {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		width: 100%;
		padding: 0.5rem 0.55rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
		text-align: left;
		font: inherit;
		color: inherit;
	}

	.item-row.editable {
		cursor: pointer;
		transition: border-color var(--transition-fast);
		--icon-accent: var(--text-faint);
	}

	.item-row.editable:hover {
		border-color: var(--border-gilt);
		--icon-accent: var(--accent);
	}

	.item-row.compact {
		padding: 0.4rem 0.5rem;
	}

	.kind-dot {
		flex-shrink: 0;
		width: 8px;
		height: 8px;
		margin-top: 0.35rem;
		border-radius: 50%;
	}

	.dot-shift {
		background: var(--growing);
	}
	.dot-family {
		background: var(--arcane);
	}
	.dot-nanny-busy {
		background: var(--danger);
	}
	.dot-payment {
		background: var(--accent);
	}

	.item-body {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		flex: 1;
		min-width: 0;
	}

	.item-title {
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-time {
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}

	.item-meta {
		font-size: 0.72rem;
		color: var(--text-faint);
	}

	.item-notes {
		font-size: 0.78rem;
		font-style: italic;
		color: var(--text-faint);
	}

	.add-btn {
		margin-top: 0.75rem;
	}

	.panel-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1rem;
		padding: 0.8rem 1.2rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
	}

	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--text-faint);
	}

	.legend-item .kind-dot {
		margin-top: 0;
	}
</style>
