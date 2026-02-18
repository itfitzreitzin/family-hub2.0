<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import { toast, confirm as confirmModal } from '$lib/stores/toast.js'

  export let userId
  export let onUpdate = () => {}

  let calendars = []
  let showAddCalendar = false
  let showManualEntry = false
  let loading = false
  let syncingId = null

  let calendarForm = {
    calendar_name: '',
    calendar_type: 'ical',
    calendar_url: '',
    calendar_id: '',
    color: '#667eea'
  }

  let manualForm = {
    title: '',
    date: '',
    startTime: '',
    endTime: '',
    recurring: false,
    recurringPattern: 'weekly',
    recurringDays: [],
    recurringUntil: ''
  }

  const calendarColors = [
    '#667eea', '#f56565', '#48bb78', '#ed8936',
    '#9f7aea', '#38b2ac', '#fc8181', '#4299e1'
  ]

  const weekDays = [
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  ]

  onMount(() => {
    loadCalendars()
  })

  async function loadCalendars() {
    loading = true
    try {
      const { data, error } = await supabase
        .from('parent_calendars')
        .select('*')
        .eq('user_id', userId)
        .order('created_at')

      if (error) throw error
      calendars = data || []
    } catch (err) {
      toast.error('Failed to load calendars')
    }
    loading = false
  }

  async function addCalendar() {
    if (!calendarForm.calendar_name.trim()) {
      toast.error('Please enter a calendar name')
      return
    }

    if (['ical', 'google', 'outlook'].includes(calendarForm.calendar_type) && !calendarForm.calendar_url.trim()) {
      toast.error('Please provide an iCal feed URL')
      return
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
        .single()

      if (error) throw error

      showAddCalendar = false
      resetCalendarForm()
      await loadCalendars()

      // Auto-sync if it has a URL
      if (data && data.calendar_url) {
        await syncCalendar(data.id)
      }

      onUpdate()
    } catch (err) {
      toast.error('Failed to add calendar: ' + err.message)
    }
  }

  async function toggleCalendar(calendarId, enabled) {
    try {
      const { error } = await supabase
        .from('parent_calendars')
        .update({ sync_enabled: enabled })
        .eq('id', calendarId)

      if (error) throw error

      await loadCalendars()
      onUpdate()
    } catch (err) {
      toast.error('Failed to toggle calendar')
    }
  }

  async function deleteCalendar(calendarId) {
    const confirmed = await confirmModal.show({ title: 'Delete Calendar', message: 'Delete this calendar? All associated events will be removed.', confirmText: 'Delete', danger: true })
    if (!confirmed) return

    try {
      const { error } = await supabase
        .from('parent_calendars')
        .delete()
        .eq('id', calendarId)

      if (error) throw error

      await loadCalendars()
      onUpdate()
    } catch (err) {
      toast.error('Failed to delete calendar')
    }
  }

  async function syncCalendar(calendarId) {
    syncingId = calendarId

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        toast.error('Not authenticated')
        return
      }

      const response = await fetch('/api/calendar/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ calendarId })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Sync failed')
      }

      toast.success(`Synced ${result.synced} events`)
      await loadCalendars()
      onUpdate()
    } catch (err) {
      toast.error('Sync failed: ' + err.message)
    } finally {
      syncingId = null
    }
  }

  async function syncAllCalendars() {
    const syncable = calendars.filter(c => c.calendar_url && c.sync_enabled)
    if (syncable.length === 0) {
      toast.info('No calendars with feed URLs to sync')
      return
    }

    for (const cal of syncable) {
      await syncCalendar(cal.id)
    }
  }

  async function addManualBusyTime() {
    if (!manualForm.title.trim()) {
      toast.error('Please enter a title')
      return
    }

    try {
      const startDateTime = `${manualForm.date}T${manualForm.startTime}:00`
      const endDateTime = `${manualForm.date}T${manualForm.endTime}:00`

      if (manualForm.recurring) {
        const { error } = await supabase
          .from('manual_busy_times')
          .insert({
            user_id: userId,
            title: manualForm.title,
            start_time: startDateTime,
            end_time: endDateTime,
            recurring: true,
            recurring_pattern: manualForm.recurringPattern,
            recurring_days: manualForm.recurringDays,
            recurring_until: manualForm.recurringUntil || null
          })

        if (error) throw error
      } else {
        // Single event — add to calendar_events via a manual calendar
        let manualCalendar = calendars.find(c => c.calendar_type === 'manual')

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
            .single()

          if (error) throw error
          manualCalendar = data
          await loadCalendars()
        }

        const { error } = await supabase
          .from('calendar_events')
          .insert({
            calendar_id: manualCalendar.id,
            user_id: userId,
            event_id: `manual_${Date.now()}`,
            title: manualForm.title,
            start_time: startDateTime,
            end_time: endDateTime,
            is_busy: true
          })

        if (error) throw error
      }

      showManualEntry = false
      resetManualForm()
      onUpdate()
      toast.success('Busy time added')
    } catch (err) {
      toast.error('Failed to add busy time')
    }
  }

  function resetCalendarForm() {
    calendarForm = {
      calendar_name: '',
      calendar_type: 'ical',
      calendar_url: '',
      calendar_id: '',
      color: '#667eea'
    }
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
    }
  }

  function getCalendarTypeLabel(type) {
    switch(type) {
      case 'google': return 'Google'
      case 'outlook': return 'Outlook'
      case 'ical': return 'iCal Feed'
      case 'manual': return 'Manual'
      default: return type
    }
  }

  function getEventCount(calendarId) {
    // This is a display hint — we load counts async
    return ''
  }

  function timeSince(dateStr) {
    if (!dateStr) return 'Never synced'
    const d = new Date(dateStr)
    const now = new Date()
    const diff = Math.floor((now - d) / 1000)
    if (diff < 60) return 'Just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
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
      {#if calendars.some(c => c.calendar_url && c.sync_enabled)}
        <button class="action-btn sync-all" on:click={syncAllCalendars}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Sync All
        </button>
      {/if}
      <button class="action-btn add-cal" on:click={() => showAddCalendar = true}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Calendar
      </button>
      <button class="action-btn add-busy" on:click={() => showManualEntry = true}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
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
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#a0aec0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </div>
      <p class="empty-title">No calendars connected</p>
      <p class="empty-hint">Connect your Google Calendar, Outlook, or any iCal feed to automatically detect when you're busy and find coverage gaps.</p>
      <button class="action-btn add-cal" on:click={() => showAddCalendar = true}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
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
                <svg class="sync-icon" class:spinning={syncingId === calendar.id} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              </button>
            {/if}

            <button class="icon-btn delete" on:click={() => deleteCalendar(calendar.id)} title="Remove">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Add Calendar Sheet -->
{#if showAddCalendar}
  <div class="sheet-overlay" on:click={() => showAddCalendar = false}>
    <div class="sheet" on:click|stopPropagation>
      <div class="sheet-handle"></div>
      <h3>Connect a Calendar</h3>
      <p class="sheet-desc">Add an iCal feed URL to automatically sync your busy times. You can find this in your calendar app's sharing settings.</p>

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
            on:click={() => calendarForm.calendar_type = 'ical'}>
            iCal Feed
          </button>
          <button
            class="source-tab"
            class:active={calendarForm.calendar_type === 'google'}
            on:click={() => calendarForm.calendar_type = 'google'}>
            Google
          </button>
          <button
            class="source-tab"
            class:active={calendarForm.calendar_type === 'outlook'}
            on:click={() => calendarForm.calendar_type = 'outlook'}>
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
          <span class="field-hint">Paste the secret iCal URL from your calendar's sharing settings</span>
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
            <li>Under "Publish a calendar", select your calendar and click <strong>Publish</strong></li>
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
              on:click={() => calendarForm.color = color}
            ></button>
          {/each}
        </div>
      </div>

      <div class="sheet-buttons">
        <button class="btn-primary" on:click={addCalendar}>
          Connect Calendar
        </button>
        <button class="btn-ghost" on:click={() => showAddCalendar = false}>
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Manual Busy Time Sheet -->
{#if showManualEntry}
  <div class="sheet-overlay" on:click={() => showManualEntry = false}>
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
                      manualForm.recurringDays = manualForm.recurringDays.filter(d => d !== day)
                    } else {
                      manualForm.recurringDays = [...manualForm.recurringDays, day]
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
        <button class="btn-primary" on:click={addManualBusyTime}>
          Add Busy Time
        </button>
        <button class="btn-ghost" on:click={() => showManualEntry = false}>
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .cal-mgr {
    padding: 4px 0;
  }

  /* Header */
  .mgr-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 20px;
    gap: 12px;
    flex-wrap: wrap;
  }

  .mgr-title h3 {
    margin: 0;
    font-size: 1.1em;
    font-weight: 700;
    color: #1a202c;
  }

  .cal-count {
    font-size: 0.8em;
    color: #a0aec0;
    font-weight: 500;
  }

  .mgr-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: none;
    border-radius: 8px;
    font-size: 0.85em;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn.add-cal {
    background: #667eea;
    color: white;
  }

  .action-btn.add-cal:hover {
    background: #5a6fd6;
  }

  .action-btn.add-busy {
    background: #edf2f7;
    color: #4a5568;
  }

  .action-btn.add-busy:hover {
    background: #e2e8f0;
  }

  .action-btn.sync-all {
    background: #edf2f7;
    color: #4a5568;
  }

  .action-btn.sync-all:hover {
    background: #e2e8f0;
  }

  /* Loading */
  .loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px;
    color: #718096;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid #e2e8f0;
    border-top-color: #667eea;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Empty State */
  .empty-state {
    text-align: center;
    padding: 40px 20px;
  }

  .empty-icon {
    margin-bottom: 16px;
    opacity: 0.5;
  }

  .empty-title {
    font-size: 1em;
    font-weight: 600;
    color: #4a5568;
    margin: 0 0 8px 0;
  }

  .empty-hint {
    font-size: 0.9em;
    color: #a0aec0;
    margin: 0 0 20px 0;
    max-width: 360px;
    margin-left: auto;
    margin-right: auto;
    line-height: 1.5;
  }

  /* Calendar Cards */
  .calendar-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .cal-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: #f8fafc;
    border-radius: 10px;
    transition: all 0.15s;
  }

  .cal-card:hover {
    background: #f1f5f9;
  }

  .cal-card.disabled {
    opacity: 0.5;
  }

  .cal-color {
    width: 4px;
    height: 36px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .cal-info {
    flex: 1;
    min-width: 0;
  }

  .cal-name {
    font-weight: 600;
    font-size: 0.95em;
    color: #1a202c;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cal-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
  }

  .cal-type-badge {
    font-size: 0.75em;
    padding: 1px 8px;
    background: #e2e8f0;
    border-radius: 10px;
    color: #64748b;
    font-weight: 500;
  }

  .cal-synced {
    font-size: 0.75em;
    color: #a0aec0;
  }

  .cal-synced.never {
    color: #ed8936;
  }

  .cal-controls {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  /* Toggle Switch */
  .toggle {
    position: relative;
    display: inline-block;
    cursor: pointer;
  }

  .toggle input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-track {
    display: block;
    width: 40px;
    height: 22px;
    background: #cbd5e0;
    border-radius: 11px;
    transition: background 0.2s;
    position: relative;
  }

  .toggle input:checked + .toggle-track {
    background: #48bb78;
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.15);
  }

  .toggle input:checked + .toggle-track .toggle-thumb {
    transform: translateX(18px);
  }

  .toggle.small .toggle-track {
    width: 36px;
    height: 20px;
  }

  .toggle.small .toggle-thumb {
    width: 16px;
    height: 16px;
  }

  .toggle.small input:checked + .toggle-track .toggle-thumb {
    transform: translateX(16px);
  }

  /* Icon Buttons */
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: none;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    color: #a0aec0;
    transition: all 0.15s;
  }

  .icon-btn:hover {
    background: #edf2f7;
    color: #4a5568;
  }

  .icon-btn.delete:hover {
    background: #fed7d7;
    color: #e53e3e;
  }

  .icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sync-icon.spinning {
    animation: spin 0.8s linear infinite;
  }

  /* Sheet Overlay (modal replacement) */
  .sheet-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.4);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 1100;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .sheet {
    background: white;
    width: 100%;
    max-width: 480px;
    max-height: 85vh;
    border-radius: 20px 20px 0 0;
    padding: 20px 24px 30px;
    overflow-y: auto;
    animation: slideUp 0.3s ease;
  }

  @media (min-width: 640px) {
    .sheet-overlay {
      align-items: center;
    }
    .sheet {
      border-radius: 20px;
      max-height: 80vh;
    }
  }

  @keyframes slideUp {
    from { transform: translateY(100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .sheet-handle {
    width: 36px;
    height: 4px;
    background: #e2e8f0;
    border-radius: 2px;
    margin: 0 auto 16px;
  }

  @media (min-width: 640px) {
    .sheet-handle { display: none; }
  }

  .sheet h3 {
    margin: 0 0 4px 0;
    font-size: 1.2em;
    font-weight: 700;
    color: #1a202c;
  }

  .sheet-desc {
    margin: 0 0 20px 0;
    font-size: 0.9em;
    color: #718096;
    line-height: 1.5;
  }

  /* Form Fields */
  .form-field {
    margin-bottom: 16px;
  }

  .form-field label {
    display: block;
    font-size: 0.85em;
    font-weight: 600;
    color: #4a5568;
    margin-bottom: 6px;
  }

  .form-field input,
  .form-field select {
    width: 100%;
    padding: 10px 12px;
    border: 1.5px solid #e2e8f0;
    border-radius: 8px;
    font-size: 0.95em;
    color: #1a202c;
    transition: border-color 0.15s;
    background: white;
  }

  .form-field input:focus,
  .form-field select:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  }

  .form-field input::placeholder {
    color: #cbd5e0;
  }

  .field-hint {
    display: block;
    margin-top: 4px;
    font-size: 0.8em;
    color: #a0aec0;
  }

  .form-row-inline {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin-bottom: 16px;
  }

  .form-row-inline .form-field {
    flex: 1;
    margin-bottom: 0;
  }

  .time-dash {
    padding-bottom: 10px;
    color: #a0aec0;
    font-weight: 600;
  }

  /* Source Tabs */
  .source-tabs {
    display: flex;
    gap: 4px;
    background: #f1f5f9;
    border-radius: 8px;
    padding: 3px;
  }

  .source-tab {
    flex: 1;
    padding: 8px 12px;
    border: none;
    background: transparent;
    border-radius: 6px;
    font-size: 0.85em;
    font-weight: 600;
    color: #64748b;
    cursor: pointer;
    transition: all 0.15s;
  }

  .source-tab.active {
    background: white;
    color: #1a202c;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }

  .source-tab:hover:not(.active) {
    color: #4a5568;
  }

  /* Setup Guide */
  .setup-guide {
    background: #f8fafc;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .setup-guide p {
    margin: 0 0 10px 0;
    font-size: 0.9em;
    color: #4a5568;
  }

  .setup-guide ol {
    margin: 0 0 16px 0;
    padding-left: 20px;
    font-size: 0.85em;
    color: #64748b;
    line-height: 1.8;
  }

  .setup-guide .form-field {
    margin-bottom: 0;
  }

  /* Color Picker */
  .color-row {
    display: flex;
    gap: 8px;
  }

  .color-dot {
    width: 32px;
    height: 32px;
    border: 2px solid transparent;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.15s;
  }

  .color-dot:hover {
    transform: scale(1.15);
  }

  .color-dot.active {
    border-color: #1a202c;
    box-shadow: 0 0 0 2px white, 0 0 0 4px #1a202c;
  }

  /* Toggle Label Row */
  .toggle-label {
    display: flex !important;
    align-items: center;
    justify-content: space-between;
  }

  /* Recurring Section */
  .recurring-section {
    background: #f8fafc;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 16px;
    animation: fadeIn 0.2s ease;
  }

  .day-pills {
    display: flex;
    gap: 6px;
  }

  .day-pill {
    width: 36px;
    height: 36px;
    border: 1.5px solid #e2e8f0;
    border-radius: 50%;
    background: white;
    font-size: 0.85em;
    font-weight: 600;
    color: #64748b;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .day-pill:hover {
    border-color: #667eea;
    color: #667eea;
  }

  .day-pill.active {
    background: #667eea;
    border-color: #667eea;
    color: white;
  }

  /* Sheet Buttons */
  .sheet-buttons {
    display: flex;
    gap: 10px;
    margin-top: 24px;
  }

  .btn-primary {
    flex: 1;
    padding: 12px 20px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 10px;
    font-size: 0.95em;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-primary:hover {
    background: #5a6fd6;
  }

  .btn-ghost {
    padding: 12px 20px;
    background: transparent;
    color: #64748b;
    border: none;
    border-radius: 10px;
    font-size: 0.95em;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-ghost:hover {
    background: #f1f5f9;
    color: #4a5568;
  }
</style>
