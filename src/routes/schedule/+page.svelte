<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import Nav from '$lib/Nav.svelte'
  
  let user = null
  let profile = null
  let currentWeekStart = null
  let shifts = []
  let loading = true
  let showAddShift = false
  let nannies = []
  let debugMode = true // Add debug mode for troubleshooting
  
  let shiftForm = {
    nannyId: null,
    date: '',
    startTime: '09:00',
    endTime: '17:00',
    notes: ''
  }
  
  onMount(async () => {
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    if (!currentUser) {
      window.location.href = '/'
      return
    }
    
    user = currentUser
    
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    
    profile = profileData
    
    // Load nannies for family/admin
    if (profile?.role === 'family' || profile?.role === 'admin') {
      const { data: nanniesData } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'nanny')
        .order('full_name')
      
      nannies = nanniesData || []
      if (nannies.length > 0) {
        shiftForm.nannyId = nannies[0].id
      }
    }
    
    setCurrentWeek(0)
    loading = false
  })
  
  function setCurrentWeek(offset) {
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay() + (offset * 7))
    weekStart.setHours(0, 0, 0, 0)
    currentWeekStart = weekStart
    loadShifts()
  }

  function ymd(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  function normalizeDateValue(value) {
    if (!value) return ''
    if (value instanceof Date) {
      return ymd(value)
    }
    if (typeof value === 'string') {
      return value.length > 10 ? value.slice(0, 10) : value
    }

    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? '' : ymd(parsed)
  }

  function getNannyName(shift) {
    // First check if we have the nanny data from the join
    if (shift.nanny && shift.nanny.full_name) {
      return shift.nanny.full_name
    }
    
    // Fallback to looking up in the nannies array
    const n = nannies.find(x => x.id === shift.nanny_id)
    return n ? n.full_name : 'Nanny'
  }

  async function loadShifts() {
    if (!currentWeekStart) return
    
    const weekEnd = new Date(currentWeekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    
    try {
      console.log('Loading shifts for:', ymd(currentWeekStart), 'to', ymd(weekEnd))
      
      // Query with profile information joined
      const { data, error } = await supabase
        .from('schedules')
        .select(`
          *,
          nanny:profiles!schedules_nanny_id_fkey(id, full_name, hourly_rate)
        `)
        .gte('date', ymd(currentWeekStart))
        .lte('date', ymd(weekEnd))
        .order('date', { ascending: true })
        .order('start_time', { ascending: true })

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }
      
      // Debug: Log raw data
      console.log('Raw data from Supabase:', data)
      
      shifts = (data || []).map((shift) => {
        const normalized = {
          ...shift,
          date: normalizeDateValue(shift.date)
        }
        console.log('Normalized shift:', normalized)
        return normalized
      })
      
      console.log('All shifts loaded:', shifts)
      
    } catch (err) {
      console.error('Error loading schedules:', err)
      shifts = []
    }
  }

  async function saveShift() {
    if (!shiftForm.nannyId) {
      alert('Please select a nanny')
      return
    }
    
    try {
      const insertData = {
        nanny_id: shiftForm.nannyId,
        date: shiftForm.date,
        start_time: shiftForm.startTime,
        end_time: shiftForm.endTime,
        notes: shiftForm.notes || null,
        created_by: user.id
      }
      
      console.log('Saving shift with data:', insertData)
      
      const { data: inserted, error } = await supabase
        .from('schedules')
        .insert(insertData)
        .select(`
          *,
          nanny:profiles!schedules_nanny_id_fkey(id, full_name, hourly_rate)
        `)
        .single()
      
      if (error) {
        console.error('Insert error:', error)
        throw error
      }
      
      console.log('Successfully inserted:', inserted)
      
      // Reset form
      shiftForm = {
        nannyId: nannies.length > 0 ? nannies[0].id : null,
        date: '',
        startTime: '09:00',
        endTime: '17:00',
        notes: ''
      }
      
      showAddShift = false
      await loadShifts() // Reload shifts after saving
      
    } catch (err) {
      console.error('Error saving:', err)
      alert('Error: ' + err.message)
    }
  }
  
  function getWeekDays() {
    if (!currentWeekStart) return []
    
    const days = []
    for (let i = 0; i < 7; i++) {
      const day = new Date(currentWeekStart)
      day.setDate(day.getDate() + i)
      days.push(day)
    }
    return days
  }
  
  function getShiftsForDay(date) {
    const dateStr = ymd(date)
    console.log('Getting shifts for date:', dateStr)
    const dayShifts = shifts.filter(s => {
      const shiftDate = normalizeDateValue(s.date)
      console.log('Comparing:', shiftDate, '===', dateStr, shiftDate === dateStr)
      return shiftDate === dateStr
    })
    console.log('Found shifts for', dateStr, ':', dayShifts)
    return dayShifts
  }
  
  function formatTime(timeStr) {
    if (!timeStr) return ''
    // Handle both HH:MM and HH:MM:SS formats
    return timeStr.slice(0, 5)
  }
  
  function openAddShift(date) {
    // Require at least one nanny for family/admin users
    if ((profile?.role === 'family' || profile?.role === 'admin') && (!nannies || nannies.length === 0)) {
      alert('No nannies found. Please create a nanny profile first (via Admin).')
      return
    }
    shiftForm.date = ymd(date)
    // If exactly one nanny, preselect it
    if (!shiftForm.nannyId && nannies && nannies.length === 1) {
      shiftForm.nannyId = nannies[0].id
    }
    showAddShift = true
  }
  
  function changeWeek(direction) {
    const offset = direction === 'prev' ? -1 : 1
    const newStart = new Date(currentWeekStart)
    newStart.setDate(newStart.getDate() + (offset * 7))
    currentWeekStart = newStart
    loadShifts()
  }
  
  async function deleteShift(shiftId) {
    if (!confirm('Delete this shift?')) return
    
    try {
      const { error } = await supabase
        .from('schedules')
        .delete()
        .eq('id', shiftId)
      
      if (error) throw error
      
      await loadShifts()
    } catch (err) {
      console.error('Error deleting shift:', err)
      alert('Error deleting shift')
    }
  }
</script>

<Nav currentPage="schedule" />

<div class="container">
  {#if loading}
    <div class="loading">Loading...</div>
  {:else}
    <div class="card">
      <div class="header">
        <h2>📅 Weekly Schedule</h2>
        <div class="week-nav">
          <button on:click={() => changeWeek('prev')}>←</button>
          <span>
            {currentWeekStart?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - 
            {new Date(currentWeekStart?.getTime() + 6 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
          <button on:click={() => changeWeek('next')}>→</button>
        </div>
      </div>
      
      <!-- Debug info (remove in production) -->
      {#if debugMode}
        <div class="debug-info">
          <details>
            <summary>Debug Info (click to expand)</summary>
            <pre>{JSON.stringify({ 
              totalShifts: shifts.length,
              weekStart: ymd(currentWeekStart),
              shifts: shifts.map(s => ({
                id: s.id,
                date: s.date,
                nanny_id: s.nanny_id,
                start: s.start_time,
                end: s.end_time
              }))
            }, null, 2)}</pre>
          </details>
        </div>
      {/if}
      
      <div class="calendar">
        {#each getWeekDays() as day}
          <div class="day-column">
            <div class="day-header">
              <div class="day-name">{day.toLocaleDateString('en-US', { weekday: 'short' })}</div>
              <div class="day-date">{day.getDate()}</div>
            </div>
            
            <div class="day-content">
              {#each getShiftsForDay(day) as shift}
                <div class="shift-block">
                  <div class="shift-nanny">{getNannyName(shift)}</div>
                  <div class="shift-time">
                    {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
                  </div>
                  {#if shift.notes}
                    <div class="shift-notes">{shift.notes}</div>
                  {/if}
                  {#if profile?.role === 'family' || profile?.role === 'admin'}
                    <button class="delete-btn" on:click={() => deleteShift(shift.id)}>×</button>
                  {/if}
                </div>
              {:else}
                <div class="no-coverage">No coverage</div>
              {/each}
              
              {#if profile?.role === 'family' || profile?.role === 'admin'}
                <button class="add-shift-btn" on:click={() => openAddShift(day)}>
                  + Add
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

{#if showAddShift}
  <div class="modal-overlay" on:click={() => showAddShift = false}>
    <div class="modal-content" on:click|stopPropagation>
      <h3>Add Shift</h3>
      
      <form on:submit|preventDefault={saveShift}>
        <div class="form-group">
          <label>Nanny</label>
          <select bind:value={shiftForm.nannyId} required>
            <option value={null} disabled>Select a nanny</option>
            {#each nannies as nanny}
              <option value={nanny.id}>{nanny.full_name}</option>
            {/each}
          </select>
        </div>
        
        <div class="form-group">
          <label>Date</label>
          <input type="date" bind:value={shiftForm.date} required />
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label>Start</label>
            <input type="time" bind:value={shiftForm.startTime} required />
          </div>
          <div class="form-group">
            <label>End</label>
            <input type="time" bind:value={shiftForm.endTime} required />
          </div>
        </div>
        
        <div class="form-group">
          <label>Notes</label>
          <input type="text" bind:value={shiftForm.notes} placeholder="Optional" />
        </div>
        
        <div class="button-row">
          <button type="submit" class="btn btn-primary">Save</button>
          <button type="button" class="btn btn-secondary" on:click={() => showAddShift = false}>Cancel</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .container {
    min-height: 100vh;
    background: #f7fafc;
    padding: 40px 20px;
    max-width: 1400px;
    margin: 0 auto;
  }
  
  .card {
    background: white;
    border-radius: 15px;
    padding: 30px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  }
  
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 30px;
  }
  
  h2 {
    margin: 0;
    color: #2d3748;
  }
  
  .week-nav {
    display: flex;
    gap: 15px;
    align-items: center;
  }
  
  .week-nav button {
    padding: 8px 16px;
    background: white;
    border: 2px solid #e2e8f0;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.2s;
  }
  
  .week-nav button:hover {
    background: #f7fafc;
    border-color: #cbd5e0;
  }
  
  .calendar {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 15px;
  }
  
  @media (max-width: 1024px) {
    .calendar {
      grid-template-columns: repeat(4, 1fr);
    }
  }
  
  @media (max-width: 768px) {
    .calendar {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  
  @media (max-width: 480px) {
    .calendar {
      grid-template-columns: 1fr;
    }
  }
  
  .day-column {
    border: 2px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
    min-height: 250px;
  }
  
  .day-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 15px;
    text-align: center;
  }
  
  .day-name {
    font-weight: 600;
    font-size: 0.9em;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .day-date {
    font-size: 1.5em;
    font-weight: bold;
    margin-top: 5px;
  }
  
  .day-content {
    padding: 15px;
    min-height: 150px;
  }
  
  .shift-block {
    background: #c6f6d5;
    border: 1px solid #48bb78;
    border-radius: 8px;
    padding: 10px;
    margin-bottom: 10px;
    position: relative;
    animation: slideIn 0.3s ease;
  }
  
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  .shift-nanny {
    font-weight: 600;
    color: #22543d;
    margin-bottom: 5px;
  }
  
  .shift-time {
    font-size: 0.9em;
    color: #2d3748;
  }
  
  .shift-notes {
    font-size: 0.85em;
    color: #718096;
    margin-top: 5px;
    font-style: italic;
  }
  
  .delete-btn {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 20px;
    height: 20px;
    border: none;
    background: rgba(239, 68, 68, 0.8);
    color: white;
    border-radius: 50%;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }
  
  .delete-btn:hover {
    background: rgba(239, 68, 68, 1);
    transform: scale(1.1);
  }
  
  .no-coverage {
    color: #a0aec0;
    font-style: italic;
    text-align: center;
    padding: 20px 0;
  }
  
  .add-shift-btn {
    width: 100%;
    padding: 8px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    margin-top: 10px;
    transition: all 0.2s;
  }
  
  .add-shift-btn:hover {
    background: #5568d3;
    transform: translateY(-1px);
  }
  
  .loading {
    text-align: center;
    padding: 60px;
    color: #718096;
    font-size: 1.1em;
  }
  
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
    animation: fadeIn 0.2s ease;
  }
  
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  .modal-content {
    background: white;
    padding: 30px;
    border-radius: 15px;
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
    animation: slideUp 0.3s ease;
  }
  
  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  .modal-content h3 {
    margin-top: 0;
    margin-bottom: 20px;
    color: #2d3748;
  }
  
  .form-group {
    margin-bottom: 15px;
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
  
  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  }
  
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
  }
  
  .button-row {
    display: flex;
    gap: 10px;
    margin-top: 20px;
  }
  
  .btn {
    flex: 1;
    padding: 12px;
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
  
  /* Debug info styles */
  .debug-info {
    background: #f7fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 15px;
    margin-bottom: 20px;
  }
  
  .debug-info summary {
    cursor: pointer;
    font-weight: 600;
    color: #4a5568;
  }
  
  .debug-info pre {
    margin-top: 10px;
    padding: 10px;
    background: white;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.85em;
  }
</style>