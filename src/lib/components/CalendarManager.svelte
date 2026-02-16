<!-- This file goes in: src/lib/components/CalendarManager.svelte -->

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
  
  let calendarForm = {
    calendar_name: '',
    calendar_type: 'google',
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
    try {
      // For Google Calendar integration
      if (calendarForm.calendar_type === 'google') {
        // This would trigger OAuth flow in production
        await connectGoogleCalendar()
        return
      }
      
      // For iCal URL feeds
      if (calendarForm.calendar_type === 'ical') {
        if (!calendarForm.calendar_url) {
          toast.error('Please provide an iCal feed URL')
          return
        }
      }
      
      const { error } = await supabase
        .from('parent_calendars')
        .insert({
          user_id: userId,
          ...calendarForm
        })
      
      if (error) throw error
      
      showAddCalendar = false
      resetCalendarForm()
      await loadCalendars()
      onUpdate()
      
    } catch (err) {
      toast.error('Failed to add calendar')
    }
  }
  
  async function connectGoogleCalendar() {
    // In production, this would initiate OAuth flow
    toast.info('Google Calendar integration coming soon. For now, use a manual calendar ID or iCal feed URL from your calendar settings.', 8000)
    
    calendarForm.calendar_type = 'manual'
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
    // This would trigger a sync with the calendar source
    toast.info('Sync functionality would fetch latest events from the calendar source')
    
    try {
      const { error } = await supabase
        .from('parent_calendars')
        .update({ last_synced: new Date().toISOString() })
        .eq('id', calendarId)
      
      if (error) throw error
      await loadCalendars()
    } catch (err) {
      toast.error('Failed to sync calendar')
    }
  }
  
  async function addManualBusyTime() {
    try {
      const startDateTime = `${manualForm.date}T${manualForm.startTime}:00`
      const endDateTime = `${manualForm.date}T${manualForm.endTime}:00`
      
      if (manualForm.recurring) {
        // Handle recurring events
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
        // Single event - add to calendar_events
        let manualCalendar = calendars.find(c => c.calendar_type === 'manual')
        
        // Create manual calendar if doesn't exist
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
      
    } catch (err) {
      toast.error('Failed to add busy time')
    }
  }
  
  function resetCalendarForm() {
    calendarForm = {
      calendar_name: '',
      calendar_type: 'google',
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
  
  function getCalendarTypeIcon(type) {
    switch(type) {
      case 'google': return '🗓️'
      case 'outlook': return '📅'
      case 'ical': return '📆'
      case 'manual': return '✏️'
      default: return '📅'
    }
  }
</script>

<div class="calendar-manager">
  <div class="header">
    <h3>📅 Your Calendars</h3>
    <div class="header-buttons">
      <button class="btn btn-primary" on:click={() => showAddCalendar = true}>
        + Add Calendar
      </button>
      <button class="btn btn-secondary" on:click={() => showManualEntry = true}>
        + Add Busy Time
      </button>
    </div>
  </div>
  
  {#if loading}
    <div class="loading">Loading calendars...</div>
  {:else if calendars.length === 0}
    <div class="empty-state">
      <p>No calendars connected yet</p>
      <p class="hint">Add your work, personal, and other calendars to automatically detect when you're busy</p>
    </div>
  {:else}
    <div class="calendar-list">
      {#each calendars as calendar}
        <div class="calendar-item" style="border-left: 4px solid {calendar.color}">
          <div class="calendar-info">
            <div class="calendar-header">
              <span class="calendar-icon">{getCalendarTypeIcon(calendar.calendar_type)}</span>
              <span class="calendar-name">{calendar.calendar_name}</span>
              <span class="calendar-type">{calendar.calendar_type}</span>
            </div>
            {#if calendar.last_synced}
              <div class="sync-info">
                Last synced: {new Date(calendar.last_synced).toLocaleString()}
              </div>
            {/if}
          </div>
          
          <div class="calendar-actions">
            <label class="toggle">
              <input 
                type="checkbox" 
                checked={calendar.sync_enabled}
                on:change={(e) => toggleCalendar(calendar.id, e.target.checked)}
              />
              <span class="toggle-slider"></span>
            </label>
            
            {#if calendar.calendar_type !== 'manual'}
              <button class="icon-btn" on:click={() => syncCalendar(calendar.id)} title="Sync now">
                🔄
              </button>
            {/if}
            
            <button class="icon-btn delete" on:click={() => deleteCalendar(calendar.id)} title="Delete">
              🗑️
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Add Calendar Modal -->
{#if showAddCalendar}
  <div class="modal-overlay" on:click={() => showAddCalendar = false}>
    <div class="modal-content" on:click|stopPropagation>
      <h3>Add Calendar</h3>
      
      <div class="form-group">
        <label>Calendar Name</label>
        <input 
          type="text" 
          bind:value={calendarForm.calendar_name}
          placeholder="e.g., Work Calendar, Personal, EMBA"
          required
        />
      </div>
      
      <div class="form-group">
        <label>Calendar Type</label>
        <div class="calendar-type-grid">
          <button 
            class="type-btn" 
            class:selected={calendarForm.calendar_type === 'google'}
            on:click={() => calendarForm.calendar_type = 'google'}>
            <span>🗓️</span>
            Google Calendar
          </button>
          <button 
            class="type-btn" 
            class:selected={calendarForm.calendar_type === 'outlook'}
            on:click={() => calendarForm.calendar_type = 'outlook'}>
            <span>📅</span>
            Outlook
          </button>
          <button 
            class="type-btn" 
            class:selected={calendarForm.calendar_type === 'ical'}
            on:click={() => calendarForm.calendar_type = 'ical'}>
            <span>📆</span>
            iCal URL
          </button>
          <button 
            class="type-btn" 
            class:selected={calendarForm.calendar_type === 'manual'}
            on:click={() => calendarForm.calendar_type = 'manual'}>
            <span>✏️</span>
            Manual ID
          </button>
        </div>
      </div>
      
      {#if calendarForm.calendar_type === 'ical'}
        <div class="form-group">
          <label>iCal Feed URL</label>
          <input 
            type="url" 
            bind:value={calendarForm.calendar_url}
            placeholder="https://calendar.google.com/calendar/ical/..."
          />
          <small>You can find this in your calendar settings under "Secret address in iCal format"</small>
        </div>
      {/if}
      
      {#if calendarForm.calendar_type === 'manual'}
        <div class="form-group">
          <label>Calendar ID</label>
          <input 
            type="text" 
            bind:value={calendarForm.calendar_id}
            placeholder="your-email@gmail.com or calendar ID"
          />
          <small>For Google Calendar, find this in Settings → Calendar ID</small>
        </div>
      {/if}
      
      <div class="form-group">
        <label>Display Color</label>
        <div class="color-picker">
          {#each calendarColors as color}
            <button 
              class="color-btn" 
              style="background: {color}"
              class:selected={calendarForm.color === color}
              on:click={() => calendarForm.color = color}
            ></button>
          {/each}
        </div>
      </div>
      
      <div class="button-row">
        <button class="btn btn-primary" on:click={addCalendar}>
          Add Calendar
        </button>
        <button class="btn btn-secondary" on:click={() => showAddCalendar = false}>
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Manual Busy Time Modal -->
{#if showManualEntry}
  <div class="modal-overlay" on:click={() => showManualEntry = false}>
    <div class="modal-content" on:click|stopPropagation>
      <h3>Add Busy Time</h3>
      
      <div class="form-group">
        <label>Title</label>
        <input 
          type="text" 
          bind:value={manualForm.title}
          placeholder="e.g., Client Meeting, Doctor Appointment"
          required
        />
      </div>
      
      <div class="form-group">
        <label>Date</label>
        <input type="date" bind:value={manualForm.date} required />
      </div>
      
      <div class="form-row">
        <div class="form-group">
          <label>Start Time</label>
          <input type="time" bind:value={manualForm.startTime} required />
        </div>
        <div class="form-group">
          <label>End Time</label>
          <input type="time" bind:value={manualForm.endTime} required />
        </div>
      </div>
      
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={manualForm.recurring} />
          Recurring event
        </label>
      </div>
      
      {#if manualForm.recurring}
        <div class="recurring-options">
          <div class="form-group">
            <label>Repeat Pattern</label>
            <select bind:value={manualForm.recurringPattern}>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          
          {#if manualForm.recurringPattern === 'weekly' || manualForm.recurringPattern === 'biweekly'}
            <div class="form-group">
              <label>Repeat on days</label>
              <div class="day-selector">
                {#each weekDays as day}
                  <label class="day-checkbox">
                    <input 
                      type="checkbox" 
                      value={day}
                      on:change={(e) => {
                        if (e.target.checked) {
                          manualForm.recurringDays = [...manualForm.recurringDays, day]
                        } else {
                          manualForm.recurringDays = manualForm.recurringDays.filter(d => d !== day)
                        }
                      }}
                    />
                    <span>{day.slice(0, 3)}</span>
                  </label>
                {/each}
              </div>
            </div>
          {/if}
          
          <div class="form-group">
            <label>End recurring on (optional)</label>
            <input type="date" bind:value={manualForm.recurringUntil} />
          </div>
        </div>
      {/if}
      
      <div class="button-row">
        <button class="btn btn-primary" on:click={addManualBusyTime}>
          Add Busy Time
        </button>
        <button class="btn btn-secondary" on:click={() => showManualEntry = false}>
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ALL THE CSS STYLES FROM THE ORIGINAL COMPONENT GO HERE */
  .calendar-manager {
    background: white;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 20px;
  }
  
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }
  
  .header h3 {
    margin: 0;
    color: #2d3748;
  }
  
  .header-buttons {
    display: flex;
    gap: 10px;
  }
  
  .btn {
    padding: 10px 20px;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }
  
  .btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
  }
  
  .btn-secondary {
    background: #718096;
    color: white;
  }
  
  .btn-secondary:hover {
    background: #5a677d;
  }
  
  .loading {
    text-align: center;
    padding: 40px;
    color: #718096;
  }
  
  .empty-state {
    text-align: center;
    padding: 40px;
    color: #718096;
  }
  
  .empty-state .hint {
    font-size: 0.9em;
    margin-top: 10px;
    color: #a0aec0;
  }
  
  .calendar-list {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }
  
  .calendar-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px;
    background: #f7fafc;
    border-radius: 8px;
    transition: all 0.2s;
  }
  
  .calendar-item:hover {
    background: #edf2f7;
  }
  
  .calendar-info {
    flex: 1;
  }
  
  .calendar-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 5px;
  }
  
  .calendar-icon {
    font-size: 1.2em;
  }
  
  .calendar-name {
    font-weight: 600;
    color: #2d3748;
  }
  
  .calendar-type {
    font-size: 0.85em;
    padding: 2px 8px;
    background: white;
    border-radius: 12px;
    color: #718096;
  }
  
  .sync-info {
    font-size: 0.85em;
    color: #718096;
    margin-left: 35px;
  }
  
  .calendar-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  
  /* Toggle Switch */
  .toggle {
    position: relative;
    display: inline-block;
    width: 50px;
    height: 24px;
  }
  
  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  
  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #cbd5e0;
    transition: 0.3s;
    border-radius: 24px;
  }
  
  .toggle-slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
  }
  
  .toggle input:checked + .toggle-slider {
    background-color: #48bb78;
  }
  
  .toggle input:checked + .toggle-slider:before {
    transform: translateX(26px);
  }
  
  .icon-btn {
    background: none;
    border: none;
    font-size: 1.2em;
    cursor: pointer;
    padding: 5px;
    transition: all 0.2s;
  }
  
  .icon-btn:hover {
    transform: scale(1.1);
  }
  
  .icon-btn.delete:hover {
    filter: grayscale(0%) saturate(2);
  }
  
  /* Modal */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  
  .modal-content {
    background: white;
    padding: 30px;
    border-radius: 15px;
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
  }
  
  .modal-content h3 {
    margin-top: 0;
    margin-bottom: 20px;
    color: #2d3748;
  }
  
  .form-group {
    margin-bottom: 20px;
  }
  
  .form-group label {
    display: block;
    margin-bottom: 5px;
    font-weight: 600;
    color: #4a5568;
  }
  
  .form-group input,
  .form-group select {
    width: 100%;
    padding: 10px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 1em;
  }
  
  .form-group small {
    display: block;
    margin-top: 5px;
    color: #718096;
    font-size: 0.85em;
  }
  
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
  }
  
  .calendar-type-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  
  .type-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 15px;
    background: #f7fafc;
    border: 2px solid #e2e8f0;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .type-btn span {
    font-size: 1.5em;
  }
  
  .type-btn:hover {
    background: #edf2f7;
  }
  
  .type-btn.selected {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-color: #667eea;
  }
  
  .color-picker {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  
  .color-btn {
    width: 40px;
    height: 40px;
    border: 2px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .color-btn:hover {
    transform: scale(1.1);
  }
  
  .color-btn.selected {
    border-color: #2d3748;
    box-shadow: 0 0 0 2px white, 0 0 0 4px #2d3748;
  }
  
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }
  
  .checkbox-label input {
    width: auto;
  }
  
  .recurring-options {
    padding: 15px;
    background: #f7fafc;
    border-radius: 8px;
    margin-bottom: 15px;
  }
  
  .day-selector {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }
  
  .day-checkbox {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px;
    background: white;
    border: 2px solid #e2e8f0;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .day-checkbox:hover {
    background: #f7fafc;
  }
  
  .day-checkbox input:checked + span {
    color: #667eea;
    font-weight: 600;
  }
  
  .button-row {
    display: flex;
    gap: 10px;
    margin-top: 20px;
  }
  
  .button-row .btn {
    flex: 1;
  }
</style>