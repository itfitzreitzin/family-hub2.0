<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import { toast } from '$lib/stores/toast.js'
  import Nav from '$lib/Nav.svelte'
  import CalendarManager from '$lib/components/CalendarManager.svelte'
  
  let user = null
  let profile = null
  let currentWeekStart = null
  let shifts = []
  let loading = true
  let showAddShift = false
  let showCalendarManager = false // New state for calendar manager modal
  let nannies = []
  
  let shiftForm = {
    nannyId: null,
    date: '',
    startTime: '09:00',
    endTime: '17:00',
    notes: ''
  }
  let weekSummary = null
  let showInsights = false
  let viewMode = 'grid' // 'grid' or 'coverage'
  
  // Real calendar data
  let parentCalendarEvents = {
    you: [],
    partner: []
  }
  let familyMembers = [] // Store family member profiles
  
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
      .maybeSingle()

    profile = profileData

    if (profile?.role === 'family' || profile?.role === 'admin') {
      await loadFamilyMembers()
      
      const { data: nanniesData } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'nanny')
        .order('full_name')
      
      nannies = nanniesData || []
      if (nannies.length > 0) {
        shiftForm.nannyId = nannies[0].id
      }
    } else if (profile?.role === 'nanny') {
      nannies = profile ? [profile] : []
      shiftForm.nannyId = profile?.id || null
    }

    setCurrentWeek(0)
    loading = false
  })
  
  async function loadFamilyMembers() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'family')
      .order('created_at')
    
    if (error) {
      console.error('Error loading family members:', error)
      return
    }
    
    familyMembers = data || []
    console.log('Family members loaded:', familyMembers)
  }
  
  async function loadParentCalendarEvents() {
    if (!currentWeekStart || familyMembers.length === 0) return
    
    const weekEnd = new Date(currentWeekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    
    try {
      // Load calendar events for all family members
      const { data: events, error } = await supabase
        .from('calendar_events')
        .select(`
          *,
          parent_calendars!inner (
            calendar_name,
            color,
            sync_enabled,
            user_id
          )
        `)
        .gte('start_time', currentWeekStart.toISOString())
        .lte('start_time', weekEnd.toISOString())
        .eq('is_busy', true)
        .eq('parent_calendars.sync_enabled', true)
        .order('start_time')
      
      if (error) throw error
      
      // Also load manual busy times
      const { data: manualTimes, error: manualError } = await supabase
        .from('manual_busy_times')
        .select('*')
        .gte('start_time', currentWeekStart.toISOString())
        .lte('start_time', weekEnd.toISOString())
      
      if (manualError) throw manualError
      
      // Process recurring manual times
      const recurringEvents = await processRecurringEvents(manualTimes || [], currentWeekStart, weekEnd)
      
      // Organize events by family member
      parentCalendarEvents = {
        you: [],
        partner: []
      }
      
      // Determine which user is "you" and which is "partner"
      const youId = user.id
      const partnerId = familyMembers.find(m => m.id !== youId)?.id
      
      // Sort calendar events
      (events || []).forEach(event => {
        const eventData = {
          title: event.title,
          startTime: new Date(event.start_time),
          endTime: new Date(event.end_time),
          color: event.parent_calendars.color,
          calendarName: event.parent_calendars.calendar_name
        }
        
        if (event.parent_calendars.user_id === youId) {
          parentCalendarEvents.you.push(eventData)
        } else if (event.parent_calendars.user_id === partnerId) {
          parentCalendarEvents.partner.push(eventData)
        }
      })
      
      // Add recurring manual events
      recurringEvents.forEach(event => {
        const eventData = {
          title: event.title,
          startTime: new Date(event.start_time),
          endTime: new Date(event.end_time),
          color: '#718096',
          calendarName: 'Manual Entry'
        }
        
        if (event.user_id === youId) {
          parentCalendarEvents.you.push(eventData)
        } else if (event.user_id === partnerId) {
          parentCalendarEvents.partner.push(eventData)
        }
      })
      
      console.log('Calendar events loaded:', parentCalendarEvents)
      
    } catch (err) {
      console.error('Error loading calendar events:', err)
    }
  }
  
  async function processRecurringEvents(manualTimes, weekStart, weekEnd) {
    const recurringEvents = []
    
    for (const manual of manualTimes.filter(m => m.recurring)) {
      // Generate instances for this week
      const instances = generateRecurringInstances(manual, weekStart, weekEnd)
      recurringEvents.push(...instances)
    }
    
    return recurringEvents
  }
  
  function generateRecurringInstances(event, weekStart, weekEnd) {
    const instances = []
    const startDate = new Date(event.start_time)
    const endDate = new Date(event.end_time)
    const duration = endDate - startDate
    
    // For weekly/biweekly patterns
    if (event.recurring_pattern === 'weekly' || event.recurring_pattern === 'biweekly') {
      const interval = event.recurring_pattern === 'weekly' ? 7 : 14
      
      for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
        const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
        
        if (event.recurring_days && event.recurring_days.includes(dayName)) {
          // Check if this instance should occur based on the pattern
          const weeksDiff = Math.floor((d - startDate) / (7 * 24 * 60 * 60 * 1000))
          
          if (event.recurring_pattern === 'weekly' || weeksDiff % 2 === 0) {
            // Check if within recurring period
            if (!event.recurring_until || d <= new Date(event.recurring_until)) {
              const instanceStart = new Date(d)
              instanceStart.setHours(startDate.getHours(), startDate.getMinutes(), 0)
              
              const instanceEnd = new Date(instanceStart.getTime() + duration)
              
              instances.push({
                ...event,
                start_time: instanceStart.toISOString(),
                end_time: instanceEnd.toISOString()
              })
            }
          }
        }
      }
    }
    
    return instances
  }
  
  function setCurrentWeek(offset) {
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay() + (offset * 7))
    weekStart.setHours(0, 0, 0, 0)
    currentWeekStart = weekStart
    loadShifts()
    if (profile?.role === 'family' || profile?.role === 'admin') {
      loadParentCalendarEvents() // Load calendar events when week changes
    }
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

  function getNannyName(id) {
    const nanny = nannies.find(x => x.id === id)
    if (nanny) {
      if (profile?.role === 'nanny' && nanny.id === profile?.id) {
        return nanny.full_name || 'You'
      }
      return nanny.full_name
    }
    if (profile?.role === 'nanny' && id === profile?.id) {
      return profile.full_name || 'You'
    }
    return 'Nanny'
  }

  async function loadShifts() {
    if (!currentWeekStart) return
    
    const weekEnd = new Date(currentWeekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    
    try {
      let query = supabase
        .from('schedules')
        .select('*')
        .gte('date', ymd(currentWeekStart))
        .lte('date', ymd(weekEnd))
        .order('date', { ascending: true })
        .order('start_time', { ascending: true })
      
      if (profile?.role === 'nanny') {
        query = query.eq('nanny_id', user.id)
      }
      
      const { data, error } = await query

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }
      
      shifts = (data || []).map((shift) => ({
        ...shift,
        date: normalizeDateValue(shift.date)
      }))
      
      if (profile?.role === 'family' || profile?.role === 'admin') {
        await loadWeekSummary()
      } else {
        weekSummary = null
      }

    } catch (err) {
      console.error('Error loading schedules:', err)
      shifts = []
    }
  }

  async function loadWeekSummary() {
    if (!currentWeekStart) return
    
    const weekStartDate = new Date(currentWeekStart)
    weekStartDate.setHours(0, 0, 0, 0)
    
    const { data, error } = await supabase
      .from('weekly_coverage_summary')
      .select('*')
      .gte('week_start', weekStartDate.toISOString())
      .lt('week_start', new Date(weekStartDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString())
      .maybeSingle()
    
    if (error) {
      console.error('Error loading week summary:', error)
    }
    
    weekSummary = data
  }

  async function saveShift() {
    if (!shiftForm.nannyId) {
      toast.warning('Please select a nanny')
      return
    }

    try {
      const { data: inserted, error } = await supabase
        .from('schedules')
        .insert({
          nanny_id: shiftForm.nannyId,
          date: shiftForm.date,
          start_time: shiftForm.startTime,
          end_time: shiftForm.endTime,
          notes: shiftForm.notes || '',
          created_by: user.id
        })
        .select('*')
        .single()
      
      if (error) throw error
      
      // Reset form
      shiftForm = {
        nannyId: nannies.length > 0 ? nannies[0].id : null,
        date: '',
        startTime: '09:00',
        endTime: '17:00',
        notes: ''
      }
      
      showAddShift = false
      await loadShifts()
      
    } catch (err) {
      console.error('Error saving:', err)
      toast.error('Error: ' + err.message)
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
    return shifts.filter(s => normalizeDateValue(s.date) === dateStr)
  }
  
  function formatTime(timeStr) {
    if (!timeStr) return ''
    return timeStr.slice(0, 5)
  }
  
  function openAddShift(date) {
    if ((profile?.role === 'family' || profile?.role === 'admin') && (!nannies || nannies.length === 0)) {
      toast.warning('No nannies found. Please create a nanny profile first.')
      return
    }
    shiftForm.date = ymd(date)
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
    if (profile?.role === 'family' || profile?.role === 'admin') {
      loadParentCalendarEvents() // Reload calendar events for new week
    }
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
      toast.error('Error deleting shift')
    }
  }

  function getCoverageStats() {
    let totalHours = 0
    let coveredHours = 0
    let nannyHours = 0
    let yourHours = 0
    let partnerHours = 0
    
    const days = getWeekDays()
    
    days.forEach(day => {
      if (day.getDay() === 0 || day.getDay() === 6) return // Skip weekends
      
      for (let hour = 8; hour < 18; hour++) {
        totalHours++
        const responsible = getResponsibleParty(day, hour)
        
        if (responsible.type !== 'gap') {
          coveredHours++
        }
        
        if (responsible.type === 'nanny') nannyHours++
        else if (responsible.type === 'you') yourHours++
        else if (responsible.type === 'partner') partnerHours++
      }
    })
    
    return {
      coverageRate: Math.round((coveredHours / totalHours) * 100),
      nannyHours,
      yourHours,
      partnerHours,
      gaps: findCoverageGaps().length,
      estimatedCost: nannyHours * 20
    }
  }
  
  function getHourRange() {
    const hours = []
    for (let h = 7; h <= 19; h++) {
      hours.push(h)
    }
    return hours
  }
  
  function getResponsibleParty(day, hour) {
    // Check if nanny is scheduled
    const nannyShift = shifts.find(s => {
      const shiftDate = new Date(s.date)
      if (shiftDate.toDateString() !== day.toDateString()) return false
      
      const start = parseInt(s.start_time.split(':')[0])
      const end = parseInt(s.end_time.split(':')[0])
      return hour >= start && hour < end
    })
    
    if (nannyShift) {
      return { 
        type: 'nanny', 
        name: getNannyName(nannyShift.nanny_id), 
        color: 'bg-green-100 border-green-400 text-green-900' 
      }
    }
    
    // Check real calendar data for parent availability
    const checkTime = new Date(day)
    checkTime.setHours(hour, 0, 0, 0)
    const checkTimeEnd = new Date(day)
    checkTimeEnd.setHours(hour + 1, 0, 0, 0)
    
    // Check if "you" are busy
    const youBusy = parentCalendarEvents.you.some(event => {
      return checkTime < event.endTime && checkTimeEnd > event.startTime
    })
    
    // Check if partner is busy
    const partnerBusy = parentCalendarEvents.partner.some(event => {
      return checkTime < event.endTime && checkTimeEnd > event.startTime
    })
    
    // Get partner name
    const partnerName = familyMembers.find(m => m.id !== user.id)?.full_name || 'Partner'
    
    // Determine who's responsible
    if (youBusy && partnerBusy) {
      return { 
        type: 'gap', 
        name: '⚠️ GAP', 
        color: 'bg-red-100 border-red-400 text-red-900 font-bold' 
      }
    } else if (youBusy) {
      return { 
        type: 'partner', 
        name: partnerName, 
        color: 'bg-purple-100 border-purple-400 text-purple-900' 
      }
    } else if (partnerBusy) {
      return { 
        type: 'you', 
        name: 'You', 
        color: 'bg-blue-100 border-blue-400 text-blue-900' 
      }
    } else {
      return { 
        type: 'both', 
        name: 'Both Available', 
        color: 'bg-gray-50 border-gray-300 text-gray-600' 
      }
    }
  }
  
  function findCoverageGaps() {
    const gaps = []
    const days = getWeekDays()
    
    days.forEach(day => {
      if (day.getDay() === 0 || day.getDay() === 6) return // Skip weekends
      
      for (let hour = 8; hour < 18; hour++) {
        const responsible = getResponsibleParty(day, hour)
        if (responsible.type === 'gap') {
          const lastGap = gaps[gaps.length - 1]
          if (lastGap && lastGap.day.toDateString() === day.toDateString() && lastGap.endHour === hour) {
            lastGap.endHour = hour + 1
          } else {
            gaps.push({
              day: day,
              startHour: hour,
              endHour: hour + 1
            })
          }
        }
      }
    })
    
    return gaps
  }
  
  async function requestCoverage(gap) {
    if ((profile?.role === 'family' || profile?.role === 'admin') && (!nannies || nannies.length === 0)) {
      toast.warning('No nannies found. Please create a nanny profile first.')
      return
    }

    shiftForm.date = ymd(gap.day)
    shiftForm.startTime = `${gap.startHour.toString().padStart(2, '0')}:00`
    shiftForm.endTime = `${gap.endHour.toString().padStart(2, '0')}:00`
    shiftForm.notes = 'Coverage gap - both parents unavailable'
    
    if (nannies && nannies.length === 1) {
      shiftForm.nannyId = nannies[0].id
    }
    
    showAddShift = true
  }
  
  // Callback when calendars are updated
  function handleCalendarUpdate() {
    if (profile?.role === 'family' || profile?.role === 'admin') {
      loadParentCalendarEvents()
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
        <div class="header-controls">
          {#if profile?.role === 'family' || profile?.role === 'admin'}
            <button class="btn btn-secondary" on:click={() => showCalendarManager = true}>
              ⚙️ Manage Calendars
            </button>
          {/if}
          <div class="week-nav">
            <button on:click={() => changeWeek('prev')}>←</button>
            <span>
              {currentWeekStart?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - 
              {new Date(currentWeekStart?.getTime() + 6 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
            <button on:click={() => changeWeek('next')}>→</button>
          </div>
        </div>
      </div>
      
      <!-- View Toggle Buttons -->
      <div class="view-toggle">
        <button 
          class="view-btn" 
          class:active={viewMode === 'grid'}
          on:click={() => viewMode = 'grid'}>
          📅 Schedule Grid
        </button>
        {#if profile?.role === 'family' || profile?.role === 'admin'}
          <button 
            class="view-btn" 
            class:active={viewMode === 'coverage'}
            on:click={() => viewMode = 'coverage'}>
            👶 Coverage View
          </button>
        {/if}
      </div>

      <!-- Planning Insights -->
      {#if weekSummary && (profile?.role === 'family' || profile?.role === 'admin')}
        <button class="insights-btn" on:click={() => showInsights = !showInsights}>
          {showInsights ? '📊 Hide' : '📊 Show'} Week Summary
        </button>
        
        {#if showInsights}
          <div class="insights-box">
            <div class="insights-row">
              <div class="insight-item">
                <span class="insight-label">Scheduled:</span>
                <span class="insight-value">{weekSummary.hours_scheduled || 0} hrs</span>
              </div>
              <div class="insight-item">
                <span class="insight-label">Actually Used:</span>
                <span class="insight-value">{weekSummary.hours_worked?.toFixed(1) || 0} hrs</span>
              </div>
              {#if weekSummary.unscheduled_shifts > 0}
                <div class="insight-item">
                  <span class="insight-label">Extra Help:</span>
                  <span class="insight-value">{weekSummary.unscheduled_shifts} times</span>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {/if}

      <!-- Schedule Grid View -->
      {#if viewMode === 'grid'}
        <div class="calendar">
          {#each getWeekDays() as day}
            <div class="day-column">
              <div class="day-header">
                <div class="day-name">{day.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                <div class="day-date">{day.getDate()}</div>
              </div>
              
              <div class="day-content">
                <!-- Show parent events for context -->
                {#if parentCalendarEvents.you.length > 0 || parentCalendarEvents.partner.length > 0}
                  {@const dayEvents = [
                    ...parentCalendarEvents.you.filter(e => 
                      e.startTime.toDateString() === day.toDateString()
                    ).map(e => ({...e, owner: 'You'})),
                    ...parentCalendarEvents.partner.filter(e => 
                      e.startTime.toDateString() === day.toDateString()
                    ).map(e => ({...e, owner: familyMembers.find(m => m.id !== user.id)?.full_name || 'Partner'}))
                  ].sort((a, b) => a.startTime - b.startTime)}
                  
                  {#each dayEvents as event}
                    <div class="parent-event" style="border-left: 3px solid {event.color}">
                      <div class="event-time">
                        {event.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div class="event-title">{event.owner}: {event.title}</div>
                    </div>
                  {/each}
                {/if}
                
                <!-- Nanny shifts -->
                {#each getShiftsForDay(day) as shift}
                  <div class="shift-block">
                    <div class="shift-nanny">{getNannyName(shift.nanny_id)}</div>
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
                  <div class="no-coverage">No nanny scheduled</div>
                {/each}
                
                {#if profile?.role === 'family' || profile?.role === 'admin'}
                  <button class="add-shift-btn" on:click={() => openAddShift(day)}>
                    + Add Nanny
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Coverage View -->
      {#if viewMode === 'coverage' && (profile?.role === 'family' || profile?.role === 'admin')}
        {@const stats = getCoverageStats()}
        
        <!-- Coverage Stats -->
        <div class="coverage-stats">
          <div class="stat-card">
            <div class="stat-label">Coverage Rate</div>
            <div class="stat-value">{stats.coverageRate}%</div>
          </div>
          <div class="stat-card" class:warning={stats.gaps > 0}>
            <div class="stat-label">Coverage Gaps</div>
            <div class="stat-value">{stats.gaps}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Nanny Hours</div>
            <div class="stat-value">{stats.nannyHours}h</div>
            <div class="stat-detail">${stats.estimatedCost}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Your Hours</div>
            <div class="stat-value">{stats.yourHours}h</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">
              {familyMembers.find(m => m.id !== user.id)?.full_name || 'Partner'}'s Hours
            </div>
            <div class="stat-value">{stats.partnerHours}h</div>
          </div>
        </div>
        
        <!-- Gap Alerts -->
        {#if findCoverageGaps().length > 0}
          <div class="gap-alert">
            <h3>⚠️ Coverage Gaps Detected</h3>
            <p class="gap-description">Both parents have conflicts at these times:</p>
            <div class="gap-list">
              {#each findCoverageGaps() as gap}
                <div class="gap-item">
                  <div>
                    <strong>{gap.day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
                    <span class="gap-time">{gap.startHour}:00 - {gap.endHour}:00</span>
                  </div>
                  <button class="request-btn" on:click={() => requestCoverage(gap)}>
                    Request Nanny
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/if}
        
        <!-- Coverage Grid -->
        <div class="coverage-grid-container">
          <h3>Hour-by-Hour Coverage</h3>
          <div class="coverage-grid">
            <!-- Header -->
            <div class="grid-header">
              <div class="time-label"></div>
              {#each getWeekDays() as day}
                <div class="day-header">
                  {day.toLocaleDateString('en-US', { weekday: 'short' })}
                  <div class="day-date">{day.getDate()}</div>
                </div>
              {/each}
            </div>
            
            <!-- Hour rows -->
            {#each getHourRange() as hour}
              <div class="grid-row">
                <div class="time-label">{hour > 12 ? hour - 12 : hour} {hour >= 12 ? 'PM' : 'AM'}</div>
                {#each getWeekDays() as day}
                  {@const responsible = getResponsibleParty(day, hour)}
                  <div class="coverage-cell {responsible.color}">
                    {responsible.name}
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        </div>
        
        <!-- Legend -->
        <div class="coverage-legend">
          <div class="legend-item">
            <div class="legend-color bg-green-100 border-green-400"></div>
            <span>Nanny Coverage</span>
          </div>
          <div class="legend-item">
            <div class="legend-color bg-blue-100 border-blue-400"></div>
            <span>You're on duty</span>
          </div>
          <div class="legend-item">
            <div class="legend-color bg-purple-100 border-purple-400"></div>
            <span>{familyMembers.find(m => m.id !== user.id)?.full_name || 'Partner'}'s on duty</span>
          </div>
          <div class="legend-item">
            <div class="legend-color bg-gray-50 border-gray-300"></div>
            <span>Both available</span>
          </div>
          <div class="legend-item">
            <div class="legend-color bg-red-100 border-red-400"></div>
            <span><strong>Coverage Gap!</strong></span>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- Calendar Manager Modal -->
{#if showCalendarManager}
  <div class="modal-overlay" on:click={() => showCalendarManager = false}>
    <div class="modal-content large" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Manage Your Calendars</h2>
        <button class="close-btn" on:click={() => showCalendarManager = false}>×</button>
      </div>
      
      <!-- Show calendar manager for current user -->
      <CalendarManager 
        userId={user.id} 
        onUpdate={handleCalendarUpdate}
      />
      
      <!-- If there's a partner, show their section too -->
      {#if familyMembers.length > 1}
        {@const partner = familyMembers.find(m => m.id !== user.id)}
        {#if partner}
          <div class="partner-section">
            <h3>{partner.full_name}'s Calendars</h3>
            <CalendarManager 
              userId={partner.id} 
              onUpdate={handleCalendarUpdate}
            />
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<!-- Add Shift Modal -->
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
    flex-wrap: wrap;
    gap: 15px;
  }
  
  h2 {
    margin: 0;
    color: #2d3748;
  }
  
  .header-controls {
    display: flex;
    align-items: center;
    gap: 15px;
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

  /* View Toggle */
  .view-toggle {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
  }
  
  .view-btn {
    padding: 10px 20px;
    background: white;
    border: 2px solid #e2e8f0;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.2s;
  }
  
  .view-btn.active {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-color: #667eea;
  }
  
  .view-btn:hover:not(.active) {
    background: #f7fafc;
  }
  
  /* Calendar Grid */
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
  
  /* Parent Events */
  .parent-event {
    background: #f7fafc;
    border-radius: 6px;
    padding: 8px;
    margin-bottom: 8px;
    font-size: 0.85em;
  }
  
  .event-time {
    font-weight: 600;
    color: #4a5568;
  }
  
  .event-title {
    color: #718096;
    margin-top: 2px;
    font-size: 0.9em;
  }
  
  /* Nanny Shifts */
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

  /* Coverage View Styles */
  .coverage-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 15px;
    margin-bottom: 20px;
  }

  .stat-card {
    background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
    border: 2px solid #0284c7;
    border-radius: 12px;
    padding: 20px;
    text-align: center;
  }

  .stat-card.warning {
    background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
    border-color: #dc2626;
  }

  .stat-label {
    font-size: 0.85em;
    color: #64748b;
    margin-bottom: 8px;
  }

  .stat-value {
    font-size: 2em;
    font-weight: bold;
    color: #1e293b;
  }

  .stat-detail {
    font-size: 0.85em;
    color: #64748b;
    margin-top: 5px;
  }

  .gap-alert {
    background: #fef2f2;
    border: 2px solid #dc2626;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 20px;
  }

  .gap-alert h3 {
    color: #991b1b;
    margin: 0 0 10px 0;
  }
  
  .gap-description {
    color: #7f1d1d;
    margin: 0 0 15px 0;
  }

  .gap-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .gap-item {
    background: white;
    padding: 12px;
    border-radius: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .gap-time {
    font-weight: 600;
    color: #dc2626;
    margin-left: 10px;
  }

  .request-btn {
    background: #dc2626;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9em;
    font-weight: 600;
  }

  .request-btn:hover {
    background: #b91c1c;
  }

  .coverage-grid-container {
    background: #f8fafc;
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 20px;
    overflow-x: auto;
  }

  .coverage-grid-container h3 {
    margin: 0 0 15px 0;
    color: #2d3748;
  }

  .coverage-grid {
    min-width: 800px;
  }

  .grid-header {
    display: grid;
    grid-template-columns: 80px repeat(7, 1fr);
    gap: 2px;
    margin-bottom: 4px;
  }

  .grid-row {
    display: grid;
    grid-template-columns: 80px repeat(7, 1fr);
    gap: 2px;
    margin-bottom: 2px;
  }

  .time-label {
    padding: 8px;
    font-size: 0.85em;
    color: #64748b;
    text-align: right;
    font-weight: 600;
  }

  .day-header {
    background: white;
    padding: 12px;
    text-align: center;
    border-radius: 8px;
    font-weight: 600;
    color: #2d3748;
  }

  .day-date {
    font-size: 0.8em;
    color: #64748b;
    font-weight: normal;
  }

  .coverage-cell {
    padding: 8px;
    text-align: center;
    border-radius: 4px;
    font-size: 0.85em;
    font-weight: 500;
    border: 1px solid;
  }

  /* Cell color classes */
  .bg-green-100 {
    background: #dcfce7;
    border-color: #86efac !important;
    color: #14532d;
  }

  .bg-blue-100 {
    background: #dbeafe;
    border-color: #93c5fd !important;
    color: #1e3a8a;
  }

  .bg-purple-100 {
    background: #f3e8ff;
    border-color: #d8b4fe !important;
    color: #581c87;
  }

  .bg-gray-50 {
    background: #f9fafb;
    border-color: #e5e7eb !important;
    color: #6b7280;
  }

  .bg-red-100 {
    background: #fee2e2;
    border-color: #fca5a5 !important;
    color: #991b1b;
    font-weight: 700;
  }

  .coverage-legend {
    display: flex;
    gap: 20px;
    justify-content: center;
    flex-wrap: wrap;
    padding: 20px;
    background: white;
    border-radius: 12px;
    border: 2px solid #e5e7eb;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .legend-color {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: 2px solid;
  }

  /* Button Styles */
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

  /* Modal */
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
  
  .modal-content.large {
    max-width: 900px;
  }
  
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }
  
  .modal-header h2 {
    margin: 0;
  }
  
  .close-btn {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: #718096;
    padding: 0;
    width: 30px;
    height: 30px;
  }
  
  .close-btn:hover {
    color: #2d3748;
  }
  
  .partner-section {
    margin-top: 30px;
    padding-top: 30px;
    border-top: 2px solid #e2e8f0;
  }
  
  .partner-section h3 {
    margin: 0 0 20px 0;
    color: #4a5568;
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
  
  .button-row .btn {
    flex: 1;
  }

  /* Insights */
  .insights-btn {
    margin-bottom: 15px;
    padding: 10px 20px;
    background: white;
    color: #667eea;
    border: 2px solid #667eea;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .insights-btn:hover {
    background: #667eea;
    color: white;
  }

  .insights-box {
    background: #f8fafc;
    border-radius: 10px;
    padding: 20px;
    margin-bottom: 20px;
    border: 1px solid #e2e8f0;
  }

  .insights-row {
    display: flex;
    gap: 30px;
    flex-wrap: wrap;
  }

  .insight-item {
    display: flex;
    flex-direction: column;
  }

  .insight-label {
    font-size: 0.85em;
    color: #718096;
    margin-bottom: 4px;
  }

  .insight-value {
    font-size: 1.3em;
    font-weight: bold;
    color: #2d3748;
  }
</style>


