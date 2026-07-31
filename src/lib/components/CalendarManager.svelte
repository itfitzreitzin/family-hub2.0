<script>
	import Icon from '$lib/icons/Icon.svelte';
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { toast, confirm as confirmModal } from '$lib/stores/toast.js';

	export let userId;
	export let onUpdate = () => {};

	let calendars = [];
	let showAddCalendar = false;
	let showManualEntry = false;
	let loading = false;
	let syncingId = null;

	let calendarForm = {
		calendar_name: '',
		calendar_type: 'ical',
		calendar_url: '',
		calendar_id: '',
		color: '#a877e8'
	};

	let manualForm = {
		title: '',
		date: '',
		startTime: '',
		endTime: '',
		recurring: false,
		recurringPattern: 'weekly',
		recurringDays: [],
		recurringUntil: ''
	};

	const calendarColors = [
		'#a877e8',
		'#e0664e',
		'#6fbf73',
		'#d9a441',
		'#8b9ef5',
		'#4fb8a8',
		'#e88ba7',
		'#5a7bd6'
	];

	const weekDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

	onMount(() => {
		loadCalendars();
	});

	async function loadCalendars() {
		loading = true;
		try {
			const { data, error } = await supabase
				.from('parent_calendars')
				.select('*')
				.eq('user_id', userId)
				.order('created_at');

			if (error) throw error;
			calendars = data || [];
		} catch (err) {
			toast.error('Failed to load calendars');
		}
		loading = false;
	}

	async function addCalendar() {
		if (!calendarForm.calendar_name.trim()) {
			toast.error('Please enter a calendar name');
			return;
		}

		if (
			['ical', 'google', 'outlook'].includes(calendarForm.calendar_type) &&
			!calendarForm.calendar_url.trim()
		) {
			toast.error('Please provide an iCal feed URL');
			return;
		}

		try {
			const { data, error } = await supabase
				.from('parent_calendars')
				.insert({
					user_id: userId,
					calendar_name: calendarForm.calendar_name,
					calendar_type: calendarForm.calendar_type,
					calendar_url: calendarForm.calendar_url || null,
					calendar_id: calendarForm.calendar_id || null,
					color: calendarForm.color,
					sync_enabled: true
				})
				.select()
				.single();

			if (error) throw error;

			showAddCalendar = false;
			resetCalendarForm();
			await loadCalendars();

			// Auto-sync if it has a URL
			if (data && data.calendar_url) {
				await syncCalendar(data.id);
			}

			onUpdate();
		} catch (err) {
			toast.error('Failed to add calendar: ' + err.message);
		}
	}

	async function toggleCalendar(calendarId, enabled) {
		try {
			const { error } = await supabase
				.from('parent_calendars')
				.update({ sync_enabled: enabled })
				.eq('id', calendarId);

			if (error) throw error;

			await loadCalendars();
			onUpdate();
		} catch (err) {
			toast.error('Failed to toggle calendar');
		}
	}

	async function deleteCalendar(calendarId) {
		const confirmed = await confirmModal.show({
			title: 'Delete Calendar',
			message: 'Delete this calendar? All associated events will be removed.',
			confirmText: 'Delete',
			danger: true
		});
		if (!confirmed) return;

		try {
			const { error } = await supabase.from('parent_calendars').delete().eq('id', calendarId);

			if (error) throw error;

			await loadCalendars();
			onUpdate();
		} catch (err) {
			toast.error('Failed to delete calendar');
		}
	}

	async function syncCalendar(calendarId) {
		syncingId = calendarId;

		try {
			const {
				data: { session }
			} = await supabase.auth.getSession();
			if (!session) {
				toast.error('Not authenticated');
				return;
			}

			const response = await fetch('/api/calendar/sync', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session.access_token}`
				},
				body: JSON.stringify({ calendarId })
			});

			const result = await response.json();

			if (!response.ok) {
				throw new Error(result.error || 'Sync failed');
			}

			toast.success(`Synced ${result.synced} events`);
			await loadCalendars();
			onUpdate();
		} catch (err) {
			toast.error('Sync failed: ' + err.message);
		} finally {
			syncingId = null;
		}
	}

	async function syncAllCalendars() {
		const syncable = calendars.filter((c) => c.calendar_url && c.sync_enabled);
		if (syncable.length === 0) {
			toast.info('No calendars with feed URLs to sync');
			return;
		}

		for (const cal of syncable) {
			await syncCalendar(cal.id);
		}
	}

	async function addManualBusyTime() {
		if (!manualForm.title.trim()) {
			toast.error('Please enter a title');
			return;
		}

		try {
			const startDateTime = `${manualForm.date}T${manualForm.startTime}:00`;
			const endDateTime = `${manualForm.date}T${manualForm.endTime}:00`;

			if (manualForm.recurring) {
				const { error } = await supabase.from('manual_busy_times').insert({
					user_id: userId,
					title: manualForm.title,
					start_time: startDateTime,
					end_time: endDateTime,
					recurring: true,
					recurring_pattern: manualForm.recurringPattern,
					recurring_days: manualForm.recurringDays,
					recurring_until: manualForm.recurringUntil || null
				});

				if (error) throw error;
			} else {
				// Single event — add to calendar_events via a manual calendar
				let manualCalendar = calendars.find((c) => c.calendar_type === 'manual');

				if (!manualCalendar) {
					const { data, error } = await supabase
						.from('parent_calendars')
						.insert({
							user_id: userId,
							calendar_name: 'Manual Entries',
							calendar_type: 'manual',
							color: '#718096'
						})
						.select()
						.single();

					if (error) throw error;
					manualCalendar = data;
					await loadCalendars();
				}

				const { error } = await supabase.from('calendar_events').insert({
					calendar_id: manualCalendar.id,
					user_id: userId,
					event_id: `manual_${Date.now()}`,
					title: manualForm.title,
					start_time: startDateTime,
					end_time: endDateTime,
					is_busy: true
				});

				if (error) throw error;
			}

			showManualEntry = false;
			resetManualForm();
			onUpdate();
			toast.success('Busy time added');
		} catch (err) {
			toast.error('Failed to add busy time');
		}
	}

	function resetCalendarForm() {
		calendarForm = {
			calendar_name: '',
			calendar_type: 'ical',
			calendar_url: '',
			calendar_id: '',
			color: '#a877e8'
		};
	}

	function resetManualForm() {
		manualForm = {
			title: '',
			date: '',
			startTime: '',
			endTime: '',
			recurring: false,
			recurringPattern: 'weekly',
			recurringDays: [],
			recurringUntil: ''
		};
	}

	function getCalendarTypeLabel(type) {
		switch (type) {
			case 'google':
				return 'Google';
			case 'outlook':
				return 'Outlook';
			case 'ical':
				return 'iCal Feed';
			case 'manual':
				return 'Manual';
			default:
				return type;
		}
	}

	function getEventCount(calendarId) {
		// This is a display hint — we load counts async
		return '';
	}

	function timeSince(dateStr) {
		if (!dateStr) return 'Never synced';
		const d = new Date(dateStr);
		const now = new Date();
		const diff = Math.floor((now - d) / 1000);
		if (diff < 60) return 'Just now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		return `${Math.floor(diff / 86400)}d ago`;
	}
</script>

<div class="cal-mgr">
	<!-- Header -->
	<div class="mgr-header">
		<div class="mgr-title">
			<h3>Calendars</h3>
			<span class="cal-count">{calendars.length} connected</span>
		</div>
		<div class="mgr-actions">
			{#if calendars.some((c) => c.calendar_url && c.sync_enabled)}
				<button class="action-btn sync-all" on:click={syncAllCalendars}>
					<Icon name="star" size={16} />
					Sync All
				</button>
			{/if}
			<button class="action-btn add-cal" on:click={() => (showAddCalendar = true)}>
				<Icon name="plus" size={16} />
				Add Calendar
			</button>
			<button class="action-btn add-busy" on:click={() => (showManualEntry = true)}>
				<Icon name="grimoire" size={16} />
				Add Busy Time
			</button>
		</div>
	</div>

	{#if loading}
		<div class="loading-state">
			<div class="spinner"></div>
			<span>Loading calendars...</span>
		</div>
	{:else if calendars.length === 0}
		<div class="empty-state">
			<div class="empty-icon">
				<Icon name="grimoire" size={48} />
			</div>
			<p class="empty-title">No calendars connected</p>
			<p class="empty-hint">
				Connect your Google Calendar, Outlook, or any iCal feed to automatically detect when you're
				busy and find coverage gaps.
			</p>
			<button class="action-btn add-cal" on:click={() => (showAddCalendar = true)}>
				<Icon name="plus" size={16} />
				Add Your First Calendar
			</button>
		</div>
	{:else}
		<div class="calendar-list">
			{#each calendars as calendar}
				<div class="cal-card" class:disabled={!calendar.sync_enabled}>
					<div class="cal-color" style="background: {calendar.color}"></div>
					<div class="cal-info">
						<div class="cal-name">{calendar.calendar_name}</div>
						<div class="cal-meta">
							<span class="cal-type-badge">{getCalendarTypeLabel(calendar.calendar_type)}</span>
							{#if calendar.last_synced}
								<span class="cal-synced">Synced {timeSince(calendar.last_synced)}</span>
							{:else if calendar.calendar_url}
								<span class="cal-synced never">Not yet synced</span>
							{/if}
						</div>
					</div>
					<div class="cal-controls">
						<label class="toggle" title={calendar.sync_enabled ? 'Enabled' : 'Disabled'}>
							<input
								type="checkbox"
								checked={calendar.sync_enabled}
								on:change={(e) => toggleCalendar(calendar.id, e.target.checked)}
							/>
							<span class="toggle-track">
								<span class="toggle-thumb"></span>
							</span>
						</label>

						{#if calendar.calendar_url}
							<button
								class="icon-btn"
								on:click={() => syncCalendar(calendar.id)}
								title="Sync now"
								disabled={syncingId === calendar.id}
							>
								<span class="sync-icon" class:spinning={syncingId === calendar.id}
									><Icon name="star" size={16} /></span
								>
							</button>
						{/if}

						<button
							class="icon-btn delete"
							on:click={() => deleteCalendar(calendar.id)}
							title="Remove"
						>
							<Icon name="urn" size={16} />
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Add Calendar Sheet -->
{#if showAddCalendar}
	<div class="sheet-overlay" on:click={() => (showAddCalendar = false)}>
		<div class="sheet" on:click|stopPropagation>
			<div class="sheet-handle"></div>
			<h3>Connect a Calendar</h3>
			<p class="sheet-desc">
				Add an iCal feed URL to automatically sync your busy times. You can find this in your
				calendar app's sharing settings.
			</p>

			<div class="form-field">
				<label>Name</label>
				<input
					type="text"
					bind:value={calendarForm.calendar_name}
					placeholder="e.g., Work, Personal, School"
				/>
			</div>

			<div class="form-field">
				<label>Source</label>
				<div class="source-tabs">
					<button
						class="source-tab"
						class:active={calendarForm.calendar_type === 'ical'}
						on:click={() => (calendarForm.calendar_type = 'ical')}
					>
						iCal Feed
					</button>
					<button
						class="source-tab"
						class:active={calendarForm.calendar_type === 'google'}
						on:click={() => (calendarForm.calendar_type = 'google')}
					>
						Google
					</button>
					<button
						class="source-tab"
						class:active={calendarForm.calendar_type === 'outlook'}
						on:click={() => (calendarForm.calendar_type = 'outlook')}
					>
						Outlook
					</button>
				</div>
			</div>

			{#if calendarForm.calendar_type === 'ical'}
				<div class="form-field">
					<label>iCal Feed URL</label>
					<input
						type="text"
						bind:value={calendarForm.calendar_url}
						placeholder="https://calendar.google.com/calendar/ical/..."
					/>
					<span class="field-hint"
						>Paste the secret iCal URL from your calendar's sharing settings</span
					>
				</div>
			{:else if calendarForm.calendar_type === 'google'}
				<div class="setup-guide">
					<p><strong>To get your Google Calendar iCal URL:</strong></p>
					<ol>
						<li>Open <strong>Google Calendar</strong> on the web</li>
						<li>Click the gear icon, then <strong>Settings</strong></li>
						<li>Select your calendar on the left</li>
						<li>Scroll to <strong>"Secret address in iCal format"</strong></li>
						<li>Copy the URL and paste it below</li>
					</ol>
					<div class="form-field">
						<label>iCal Feed URL</label>
						<input
							type="text"
							bind:value={calendarForm.calendar_url}
							placeholder="https://calendar.google.com/calendar/ical/..."
						/>
					</div>
				</div>
			{:else if calendarForm.calendar_type === 'outlook'}
				<div class="setup-guide">
					<p><strong>To get your Outlook Calendar iCal URL:</strong></p>
					<ol>
						<li>Open <strong>Outlook Calendar</strong> on the web</li>
						<li>Click the gear icon, then <strong>View all Outlook settings</strong></li>
						<li>Go to <strong>Calendar > Shared calendars</strong></li>
						<li>
							Under "Publish a calendar", select your calendar and click <strong>Publish</strong>
						</li>
						<li>Copy the <strong>ICS link</strong></li>
					</ol>
					<div class="form-field">
						<label>iCal Feed URL</label>
						<input
							type="text"
							bind:value={calendarForm.calendar_url}
							placeholder="https://outlook.live.com/owa/calendar/..."
						/>
					</div>
				</div>
			{/if}

			<div class="form-field">
				<label>Color</label>
				<div class="color-row">
					{#each calendarColors as color}
						<button
							class="color-dot"
							style="background: {color}"
							class:active={calendarForm.color === color}
							on:click={() => (calendarForm.color = color)}
						></button>
					{/each}
				</div>
			</div>

			<div class="sheet-buttons">
				<button class="btn-primary" on:click={addCalendar}> Connect Calendar </button>
				<button class="btn-ghost" on:click={() => (showAddCalendar = false)}> Cancel </button>
			</div>
		</div>
	</div>
{/if}

<!-- Manual Busy Time Sheet -->
{#if showManualEntry}
	<div class="sheet-overlay" on:click={() => (showManualEntry = false)}>
		<div class="sheet" on:click|stopPropagation>
			<div class="sheet-handle"></div>
			<h3>Add Busy Time</h3>
			<p class="sheet-desc">Block off time when you're unavailable for childcare.</p>

			<div class="form-field">
				<label>What's happening?</label>
				<input
					type="text"
					bind:value={manualForm.title}
					placeholder="e.g., Client meeting, Doctor appointment"
				/>
			</div>

			<div class="form-field">
				<label>Date</label>
				<input type="date" bind:value={manualForm.date} />
			</div>

			<div class="form-row-inline">
				<div class="form-field">
					<label>Start</label>
					<input type="time" bind:value={manualForm.startTime} />
				</div>
				<div class="time-dash">-</div>
				<div class="form-field">
					<label>End</label>
					<input type="time" bind:value={manualForm.endTime} />
				</div>
			</div>

			<div class="form-field">
				<label class="toggle-label">
					<span>Repeats</span>
					<label class="toggle small">
						<input type="checkbox" bind:checked={manualForm.recurring} />
						<span class="toggle-track">
							<span class="toggle-thumb"></span>
						</span>
					</label>
				</label>
			</div>

			{#if manualForm.recurring}
				<div class="recurring-section">
					<div class="form-field">
						<label>Frequency</label>
						<select bind:value={manualForm.recurringPattern}>
							<option value="weekly">Every week</option>
							<option value="biweekly">Every 2 weeks</option>
						</select>
					</div>

					<div class="form-field">
						<label>On these days</label>
						<div class="day-pills">
							{#each weekDays as day}
								<button
									class="day-pill"
									class:active={manualForm.recurringDays.includes(day)}
									on:click={() => {
										if (manualForm.recurringDays.includes(day)) {
											manualForm.recurringDays = manualForm.recurringDays.filter((d) => d !== day);
										} else {
											manualForm.recurringDays = [...manualForm.recurringDays, day];
										}
									}}
								>
									{day.slice(0, 1).toUpperCase()}
								</button>
							{/each}
						</div>
					</div>

					<div class="form-field">
						<label>Until (optional)</label>
						<input type="date" bind:value={manualForm.recurringUntil} />
					</div>
				</div>
			{/if}

			<div class="sheet-buttons">
				<button class="btn-primary" on:click={addManualBusyTime}> Add Busy Time </button>
				<button class="btn-ghost" on:click={() => (showManualEntry = false)}> Cancel </button>
			</div>
		</div>
	</div>
{/if}

<style>
	.cal-mgr {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.mgr-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.mgr-title h3 {
		font-family: var(--font-display);
		font-size: 1rem;
		letter-spacing: 0.04em;
		color: var(--text);
	}

	.cal-count {
		font-family: var(--font-body);
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.mgr-actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 36px;
		padding: 0.35rem 0.75rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		font-family: var(--font-body);
		font-size: 0.76rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		cursor: pointer;
		transition: all var(--transition-fast);
		--icon-accent: var(--accent);
	}

	.action-btn:hover {
		color: var(--accent-bright);
		border-color: var(--border-gilt);
		background: var(--accent-tint);
	}

	.action-btn.add-busy:hover {
		color: var(--danger);
		border-color: var(--danger);
		background: var(--danger-dim);
		--icon-accent: var(--danger);
	}

	.loading-state,
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2rem 1rem;
		text-align: center;
		color: var(--text-faint);
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 1.1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.empty-icon {
		color: var(--text-faint);
		--icon-accent: var(--accent);
		opacity: 0.7;
		margin-bottom: 0.35rem;
	}

	.empty-title {
		font-family: var(--font-display);
		font-size: 1rem;
		letter-spacing: 0.03em;
		color: var(--text-muted);
	}

	.empty-hint {
		font-size: 0.88rem;
		max-width: 36ch;
		line-height: 1.5;
	}

	/* ── Calendar cards ───────────────────────────────────── */
	.calendar-list {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.cal-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.9rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
		transition: all var(--transition-fast);
	}

	.cal-card:hover {
		border-color: var(--border-gilt);
	}

	.cal-card.disabled {
		opacity: 0.5;
	}

	.cal-color {
		width: 10px;
		height: 34px;
		flex-shrink: 0;
		border-radius: 3px;
	}

	.cal-info {
		flex: 1;
		min-width: 0;
	}

	.cal-name {
		font-weight: 700;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cal-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.15rem;
		font-size: 0.76rem;
		color: var(--text-faint);
	}

	.cal-type-badge {
		padding: 0.1rem 0.45rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.cal-synced {
		color: var(--growing);
	}

	.cal-synced.never {
		color: var(--text-faint);
		font-style: italic;
	}

	.cal-controls {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-shrink: 0;
	}

	/* ── Toggle ───────────────────────────────────────────── */
	.toggle {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		cursor: pointer;
		margin: 0;
		text-transform: none;
		letter-spacing: normal;
		font-size: 0.85rem;
		font-weight: 400;
		color: var(--text-muted);
	}

	.toggle input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}

	.toggle-track {
		position: relative;
		width: 40px;
		height: 22px;
		flex-shrink: 0;
		background: var(--surface-hi);
		border: 1px solid var(--border);
		border-radius: 999px;
		transition: all var(--transition-normal);
	}

	.toggle input:checked ~ .toggle-track {
		background: var(--accent-dim);
		border-color: var(--accent);
	}

	.toggle-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--text-faint);
		transition: all var(--transition-normal);
	}

	.toggle input:checked ~ .toggle-track .toggle-thumb {
		transform: translateX(18px);
		background: var(--accent-bright);
		box-shadow: 0 0 8px var(--accent);
	}

	.toggle.small .toggle-track {
		width: 32px;
		height: 18px;
	}

	.toggle.small .toggle-thumb {
		width: 12px;
		height: 12px;
	}

	.toggle.small input:checked ~ .toggle-track .toggle-thumb {
		transform: translateX(14px);
	}

	.toggle-label {
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	/* ── Icon buttons ─────────────────────────────────────── */
	.icon-btn {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		min-height: 34px;
		padding: 0;
		background: none;
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text-faint);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.icon-btn:hover {
		color: var(--accent-bright);
		border-color: var(--border-gilt);
		background: var(--accent-tint);
	}

	.icon-btn.delete:hover {
		color: var(--danger);
		border-color: var(--danger);
		background: var(--danger-dim);
	}

	.icon-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.sync-icon {
		display: inline-grid;
		place-items: center;
	}

	.sync-icon.spinning {
		animation: spin 1s linear infinite;
	}

	/* ── Bottom sheet ─────────────────────────────────────── */
	.sheet-overlay {
		position: fixed;
		inset: 0;
		z-index: 10001;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background: rgba(8, 5, 15, 0.7);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		animation: veil-in 0.22s ease;
	}

	@keyframes veil-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.sheet {
		position: relative;
		width: 100%;
		max-width: min(460px, calc(100vw - 2rem));
		max-height: calc(100vh - 4rem);
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		padding: clamp(1.25rem, 5vw, 1.75rem);
		background: var(--surface);
		background-image: linear-gradient(155deg, var(--accent-tint), transparent 50%);
		border: 1px solid var(--border-gilt);
		border-radius: var(--card-radius);
		box-shadow: var(--shadow-xl);
		animation: conjure 0.3s var(--ease-out-expo);
	}

	@keyframes conjure {
		from {
			opacity: 0;
			transform: translateY(14px) scale(0.97);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.sheet-handle {
		display: none;
	}

	.sheet h3 {
		font-family: var(--font-display);
		font-size: 1.1rem;
		letter-spacing: 0.04em;
		color: var(--accent-bright);
		margin-bottom: 0.5rem;
	}

	.sheet-desc {
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--text-faint);
		margin-bottom: 1.15rem;
	}

	.sheet-buttons {
		display: flex;
		gap: 0.6rem;
		margin-top: 1.25rem;
	}

	.sheet-buttons button,
	.btn-primary,
	.btn-ghost {
		flex: 1;
		min-height: 44px;
	}

	.btn-ghost {
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		font-family: var(--font-body);
		font-size: 0.95rem;
		font-weight: 700;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-ghost:hover {
		border-color: var(--border-gilt);
		color: var(--accent-bright);
		background: var(--accent-tint);
	}

	/* ── Form bits ────────────────────────────────────────── */
	.form-field {
		margin-bottom: 1rem;
	}

	.field-hint {
		display: block;
		margin-top: 0.3rem;
		font-size: 0.8rem;
		color: var(--text-faint);
		line-height: 1.45;
	}

	.form-row-inline {
		display: flex;
		align-items: flex-end;
		gap: 0.6rem;
	}

	.form-row-inline .form-field {
		flex: 1;
	}

	.time-dash {
		padding-bottom: 0.75rem;
		color: var(--text-faint);
	}

	.source-tabs {
		display: flex;
		gap: 0.3rem;
		padding: 0.25rem;
		margin-bottom: 1rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
	}

	.source-tab {
		flex: 1;
		min-height: 38px;
		background: none;
		border: none;
		border-radius: 6px;
		color: var(--text-faint);
		font-family: var(--font-body);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.source-tab.active {
		background: var(--accent-dim);
		color: var(--accent-bright);
	}

	.source-tab:hover:not(.active) {
		color: var(--text-muted);
	}

	.setup-guide {
		padding: 0.9rem 1rem;
		margin-bottom: 1rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-left: 2px solid var(--accent);
		border-radius: var(--radius-sm);
		font-size: 0.86rem;
		line-height: 1.55;
		color: var(--text-muted);
	}

	.setup-guide ol {
		margin: 0.5rem 0 0.5rem 1.1rem;
	}

	.color-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.color-dot {
		width: 30px;
		height: 30px;
		min-height: 30px;
		padding: 0;
		border: 2px solid transparent;
		border-radius: 50%;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.color-dot:hover {
		transform: scale(1.12);
	}

	.color-dot.active {
		border-color: var(--accent-bright);
		box-shadow: 0 0 0 2px var(--accent-dim);
	}

	.recurring-section {
		padding-top: 0.9rem;
		margin-top: 0.5rem;
		border-top: 1px solid var(--border-soft);
	}

	.day-pills {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}

	.day-pill {
		width: 38px;
		height: 38px;
		min-height: 38px;
		padding: 0;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 50%;
		color: var(--text-faint);
		font-size: 0.72rem;
		font-weight: 700;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.day-pill:hover {
		border-color: var(--border-gilt);
		color: var(--accent-bright);
	}

	.day-pill.active {
		background: var(--accent-dim);
		border-color: var(--accent);
		color: var(--accent-bright);
	}

	@media (max-width: 768px) {
		.sheet-overlay {
			padding: 0;
			align-items: flex-end;
		}

		.sheet {
			max-width: 100%;
			max-height: 90vh;
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
			border-bottom: none;
			padding-bottom: calc(1.25rem + var(--safe-bottom));
			animation: sheet-up 0.3s var(--ease-out-expo);
		}

		@keyframes sheet-up {
			from {
				transform: translateY(100%);
			}
			to {
				transform: translateY(0);
			}
		}

		.sheet-handle {
			display: block;
			width: 38px;
			height: 4px;
			margin: 0 auto 0.9rem;
			background: var(--border);
			border-radius: 999px;
		}

		.cal-card {
			flex-wrap: wrap;
		}
	}
</style>
