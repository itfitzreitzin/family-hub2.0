<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import Nav from '$lib/Nav.svelte'
  import CalendarManager from '$lib/components/CalendarManager.svelte'
  import { goto } from '$app/navigation'
  import { toast, confirm as confirmModal } from '$lib/stores/toast.js'

  let user = null
  let profile = null
  let currentWeekStart = null
  let shifts = []
  let loading = true
  let showAddShift = false
  let showCalendarManager = false
  let nannies = []

  let shiftForm = {
    nannyId: null,
    date: '',
    startTime: '09:00',
    endTime: '17:00',
    notes: ''
  }
  let weekSummary = null

  // Calendar data
  let parentCalendarEvents = {
    you: [],
    partner: []
  }
  let nannyCalendarEvents = {} // keyed by nanny_id -> array of events
  let familyMembers = []

  // Time grid config
  const DAY_START_HOUR = 7
  const DAY_END_HOUR = 20
  const TOTAL_HOURS = DAY_END_HOUR - DAY_START_HOUR
  const HOUR_HEIGHT = 60 // px per hour

  onMount(async () => {
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    if (!currentUser) {
      goto('/')
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
    loadCalendarEvents()
  })

  async function loadFamilyMembers() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'family')
      .order('created_at')

    if (error) return
    familyMembers = data || []
  }

  async function loadParentCalendarEvents() {
    if (!currentWeekStart || familyMembers.length === 0) return

    const weekEnd = new Date(currentWeekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)

    try {
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

      const { data: manualTimes, error: manualError } = await supabase
        .from('manual_busy_times')
        .select('*')
        .gte('start_time', currentWeekStart.toISOString())
        .lte('start_time', weekEnd.toISOString())

      if (manualError) throw manualError

      const recurringEvents = await processRecurringEvents(manualTimes || [], currentWeekStart, weekEnd)

      parentCalendarEvents = { you: [], partner: [] }

      const youId = user.id
      const partnerId = familyMembers.find(m => m.id !== youId)?.id

      ;(events || []).forEach(event => {
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
    } catch (err) {
      // silently fail — calendar events are supplementary
    }
  }

  async function loadCalendarEvents() {
    if (profile?.role === 'family' || profile?.role === 'admin') {
      await loadParentCalendarEvents()
      await loadNannyCalendarEvents()
    } else if (profile?.role === 'nanny') {
      await loadNannyCalendarEvents()
    }
  }

  async function loadNannyCalendarEvents() {
    if (!currentWeekStart) return

    const weekEnd = new Date(currentWeekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)

    try {
      // Build the query — family sees all nanny events, nannies see only their own
      let query = supabase
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

      const { data: events, error } = await query
      if (error) throw error

      // Get the set of nanny IDs
      const nannyIds = new Set(nannies.map(n => n.id))

      // Reset and populate nanny events
      const newNannyEvents = {}
      ;(events || []).forEach(event => {
        const ownerId = event.parent_calendars.user_id
        if (!nannyIds.has(ownerId)) return

        if (!newNannyEvents[ownerId]) {
          newNannyEvents[ownerId] = []
        }

        newNannyEvents[ownerId].push({
          title: event.title,
          startTime: new Date(event.start_time),
          endTime: new Date(event.end_time),
          color: event.parent_calendars.color,
          calendarName: event.parent_calendars.calendar_name,
          nannyId: ownerId
        })
      })

      nannyCalendarEvents = newNannyEvents
    } catch (err) {
      // silently fail — nanny calendar events are supplementary
    }
  }

  async function processRecurringEvents(manualTimes, weekStart, weekEnd) {
    const recurringEvents = []
    for (const manual of manualTimes.filter(m => m.recurring)) {
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

    if (event.recurring_pattern === 'weekly' || event.recurring_pattern === 'biweekly') {
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart)
        d.setDate(d.getDate() + i)
        const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()

        if (event.recurring_days && event.recurring_days.includes(dayName)) {
          const weeksDiff = Math.floor((d - startDate) / (7 * 24 * 60 * 60 * 1000))

          if (event.recurring_pattern === 'weekly' || weeksDiff % 2 === 0) {
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
    loadCalendarEvents()
  }

  function ymd(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  function normalizeDateValue(value) {
    if (!value) return ''
    if (value instanceof Date) return ymd(value)
    if (typeof value === 'string') return value.length > 10 ? value.slice(0, 10) : value
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? '' : ymd(parsed)
  }

  function getNannyName(id) {
    const nanny = nannies.find(x => x.id === id)
    if (nanny) {
      if (profile?.role === 'nanny' && nanny.id === profile?.id) return nanny.full_name || 'You'
      return nanny.full_name
    }
    if (profile?.role === 'nanny' && id === profile?.id) return profile.full_name || 'You'
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
      if (error) throw error

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

    if (!error) weekSummary = data
  }

  async function saveShift() {
    if (!shiftForm.nannyId) {
      toast.error('Please select a nanny')
      return
    }

    if (shiftForm.startTime >= shiftForm.endTime) {
      toast.error('End time must be after start time')
      return
    }

    try {
      const { error } = await supabase
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
    const [h, m] = timeStr.slice(0, 5).split(':')
    const hour = parseInt(h)
    const ampm = hour >= 12 ? 'pm' : 'am'
    const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour
    return `${display}:${m}${ampm}`
  }

  function formatHour(hour) {
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour
    return `${display} ${ampm}`
  }

  function openAddShift(date, hour) {
    if ((profile?.role === 'family' || profile?.role === 'admin') && (!nannies || nannies.length === 0)) {
      toast.error('No nannies found. Please create a nanny profile first.')
      return
    }
    shiftForm.date = ymd(date)
    if (hour !== undefined) {
      shiftForm.startTime = `${String(hour).padStart(2, '0')}:00`
      shiftForm.endTime = `${String(Math.min(hour + 2, DAY_END_HOUR)).padStart(2, '0')}:00`
    }
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
    loadCalendarEvents()
  }

  async function deleteShift(shiftId) {
    const confirmed = await confirmModal.show({ title: 'Delete Shift', message: 'Delete this shift?', confirmText: 'Delete', danger: true })
    if (!confirmed) return

    try {
      const { error } = await supabase
        .from('schedules')
        .delete()
        .eq('id', shiftId)
      if (error) throw error
      await loadShifts()
    } catch (err) {
      toast.error('Error deleting shift')
    }
  }

  // --- Time grid positioning helpers ---

  function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number)
    return h * 60 + m
  }

  function eventTop(startTime) {
    const minutes = startTime instanceof Date
      ? startTime.getHours() * 60 + startTime.getMinutes()
      : timeToMinutes(startTime)
    return ((minutes - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT
  }

  function eventHeight(startTime, endTime) {
    let startMin, endMin
    if (startTime instanceof Date) {
      startMin = startTime.getHours() * 60 + startTime.getMinutes()
      endMin = endTime.getHours() * 60 + endTime.getMinutes()
    } else {
      startMin = timeToMinutes(startTime)
      endMin = timeToMinutes(endTime)
    }
    return Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 20)
  }

  function getEventsForDay(day) {
    const youEvents = parentCalendarEvents.you
      .filter(e => e.startTime.toDateString() === day.toDateString())
      .map(e => ({ ...e, owner: 'you' }))

    const partnerEvents = parentCalendarEvents.partner
      .filter(e => e.startTime.toDateString() === day.toDateString())
      .map(e => ({ ...e, owner: 'partner' }))

    return [...youEvents, ...partnerEvents]
  }

  function getNannyEventsForDay(day) {
    const events = []
    for (const [nannyId, nannyEvents] of Object.entries(nannyCalendarEvents)) {
      for (const event of nannyEvents) {
        if (event.startTime.toDateString() === day.toDateString()) {
          events.push({ ...event, nannyName: getNannyName(nannyId) })
        }
      }
    }
    return events
  }

  function getPartnerName() {
    return familyMembers.find(m => m.id !== user?.id)?.full_name || 'Partner'
  }

  function isToday(date) {
    const today = new Date()
    return date.toDateString() === today.toDateString()
  }

  function getCurrentTimePosition() {
    const now = new Date()
    const minutes = now.getHours() * 60 + now.getMinutes()
    return ((minutes - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT
  }

  function getCoverageGaps() {
    const gaps = []
    const days = getWeekDays()

    days.forEach(day => {
      if (day.getDay() === 0 || day.getDay() === 6) return
      const dayShifts = getShiftsForDay(day)
      const dayEvents = getEventsForDay(day)

      for (let hour = 8; hour < 18; hour++) {
        const hasNanny = dayShifts.some(s => {
          const start = parseInt(s.start_time.split(':')[0])
          const end = parseInt(s.end_time.split(':')[0])
          return hour >= start && hour < end
        })

        if (hasNanny) continue

        const checkTime = new Date(day)
        checkTime.setHours(hour, 0, 0, 0)
        const checkEnd = new Date(day)
        checkEnd.setHours(hour + 1, 0, 0, 0)

        const youBusy = parentCalendarEvents.you.some(e =>
          checkTime < e.endTime && checkEnd > e.startTime
        )
        const partnerBusy = parentCalendarEvents.partner.some(e =>
          checkTime < e.endTime && checkEnd > e.startTime
        )

        if (youBusy && partnerBusy) {
          const last = gaps[gaps.length - 1]
          if (last && last.day.toDateString() === day.toDateString() && last.endHour === hour) {
            last.endHour = hour + 1
          } else {
            gaps.push({ day, startHour: hour, endHour: hour + 1 })
          }
        }
      }
    })

    return gaps
  }

  function getShiftConflicts() {
    if (!shiftForm.nannyId || !shiftForm.date || !shiftForm.startTime || !shiftForm.endTime) return []

    const nannyEvents = nannyCalendarEvents[shiftForm.nannyId] || []
    if (nannyEvents.length === 0) return []

    const shiftStart = new Date(`${shiftForm.date}T${shiftForm.startTime}:00`)
    const shiftEnd = new Date(`${shiftForm.date}T${shiftForm.endTime}:00`)

    return nannyEvents.filter(event =>
      event.startTime < shiftEnd && event.endTime > shiftStart
    )
  }

  function handleCalendarUpdate() {
    loadCalendarEvents()
  }

  function goToToday() {
    setCurrentWeek(0)
  }
</script>

<Nav currentPage="schedule" />

<div class="schedule-page">
  {#if loading}
    <div class="loading">
      <div class="loading-spinner"></div>
      <span>Loading schedule...</span>
    </div>
  {:else}
    <!-- Top Bar -->
    <div class="top-bar">
      <div class="top-left">
        <h1>Schedule</h1>
        <span class="week-label">
          {currentWeekStart?.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
      </div>
      <div class="top-right">
        <button class="top-btn" on:click={() => showCalendarManager = true}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          {profile?.role === 'nanny' ? 'My Availability' : 'Calendars'}
        </button>
        <div class="week-nav">
          <button class="nav-btn" on:click={() => changeWeek('prev')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="today-btn" on:click={goToToday}>Today</button>
          <button class="nav-btn" on:click={() => changeWeek('next')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Coverage Gap Alert -->
    {#if (profile?.role === 'family' || profile?.role === 'admin') && getCoverageGaps().length > 0}
      <div class="gap-banner">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span><strong>{getCoverageGaps().length} coverage gap{getCoverageGaps().length > 1 ? 's' : ''}</strong> this week &mdash; both parents busy with no nanny scheduled</span>
      </div>
    {/if}

    <!-- Time Grid Calendar -->
    <div class="calendar-wrapper">
      <div class="time-grid">
        <!-- Day Headers -->
        <div class="grid-header">
          <div class="time-gutter-header"></div>
          {#each getWeekDays() as day}
            <div class="day-col-header" class:today={isToday(day)}>
              <span class="day-label">{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
              <span class="day-num" class:today-num={isToday(day)}>{day.getDate()}</span>
            </div>
          {/each}
        </div>

        <!-- Scrollable Grid Body -->
        <div class="grid-body">
          <!-- Time Gutter -->
          <div class="time-gutter">
            {#each Array(TOTAL_HOURS) as _, i}
              <div class="time-slot" style="height: {HOUR_HEIGHT}px">
                <span class="time-text">{formatHour(DAY_START_HOUR + i)}</span>
              </div>
            {/each}
          </div>

          <!-- Day Columns -->
          {#each getWeekDays() as day, dayIdx}
            <div
              class="day-col"
              class:today-col={isToday(day)}
              on:dblclick={(e) => {
                if (profile?.role !== 'family' && profile?.role !== 'admin') return
                const rect = e.currentTarget.getBoundingClientRect()
                const y = e.clientY - rect.top + e.currentTarget.parentElement.scrollTop
                const hour = Math.floor(y / HOUR_HEIGHT) + DAY_START_HOUR
                openAddShift(day, hour)
              }}
            >
              <!-- Hour grid lines -->
              {#each Array(TOTAL_HOURS) as _, i}
                <div class="hour-line" style="top: {i * HOUR_HEIGHT}px"></div>
              {/each}

              <!-- Current time indicator -->
              {#if isToday(day)}
                <div class="now-line" style="top: {getCurrentTimePosition()}px">
                  <div class="now-dot"></div>
                </div>
              {/if}

              <!-- Parent calendar events (semi-transparent background) -->
              {#each getEventsForDay(day) as event}
                <div
                  class="cal-event"
                  class:cal-event-you={event.owner === 'you'}
                  class:cal-event-partner={event.owner === 'partner'}
                  style="
                    top: {Math.max(eventTop(event.startTime), 0)}px;
                    height: {eventHeight(event.startTime, event.endTime)}px;
                    border-left-color: {event.color};
                  "
                  title="{event.owner === 'you' ? 'You' : getPartnerName()}: {event.title}"
                >
                  <span class="cal-event-owner">{event.owner === 'you' ? 'You' : getPartnerName()}</span>
                  <span class="cal-event-title">{event.title}</span>
                </div>
              {/each}

              <!-- Nanny busy times (orange tinted blocks) -->
              {#each getNannyEventsForDay(day) as nEvent}
                <div
                  class="cal-event cal-event-nanny"
                  style="
                    top: {Math.max(eventTop(nEvent.startTime), 0)}px;
                    height: {eventHeight(nEvent.startTime, nEvent.endTime)}px;
                    border-left-color: {nEvent.color || '#ed8936'};
                  "
                  title="{nEvent.nannyName}: {nEvent.title} (unavailable)"
                >
                  <span class="cal-event-owner">{nEvent.nannyName}</span>
                  <span class="cal-event-title">{nEvent.title}</span>
                </div>
              {/each}

              <!-- Nanny shifts (solid green blocks) -->
              {#each getShiftsForDay(day) as shift}
                <div
                  class="shift-block"
                  style="
                    top: {eventTop(shift.start_time)}px;
                    height: {eventHeight(shift.start_time, shift.end_time)}px;
                  "
                >
                  <div class="shift-content">
                    <span class="shift-name">{getNannyName(shift.nanny_id)}</span>
                    <span class="shift-time">{formatTime(shift.start_time)} - {formatTime(shift.end_time)}</span>
                    {#if shift.notes}
                      <span class="shift-note">{shift.notes}</span>
                    {/if}
                  </div>
                  {#if profile?.role === 'family' || profile?.role === 'admin'}
                    <button class="shift-delete" on:click|stopPropagation={() => deleteShift(shift.id)} title="Remove shift">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  {/if}
                </div>
              {/each}

              <!-- "Add" click hint on hover (family only) -->
              {#if profile?.role === 'family' || profile?.role === 'admin'}
                <button class="add-hint" on:click={() => openAddShift(day)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- Legend -->
    <div class="legend">
      <div class="legend-item">
        <span class="legend-swatch shift-swatch"></span>
        <span>Nanny shift</span>
      </div>
      <div class="legend-item">
        <span class="legend-swatch you-swatch"></span>
        <span>Your busy time</span>
      </div>
      {#if familyMembers.length > 1}
        <div class="legend-item">
          <span class="legend-swatch partner-swatch"></span>
          <span>{getPartnerName()}'s busy time</span>
        </div>
      {/if}
      {#if Object.keys(nannyCalendarEvents).length > 0}
        <div class="legend-item">
          <span class="legend-swatch nanny-busy-swatch"></span>
          <span>Nanny unavailable</span>
        </div>
      {/if}
      {#if profile?.role === 'family' || profile?.role === 'admin'}
        <span class="legend-hint">Double-click a time slot to add a shift</span>
      {/if}
    </div>
  {/if}
</div>

<!-- Calendar Manager Modal -->
{#if showCalendarManager}
  <div class="modal-overlay" on:click={() => showCalendarManager = false}>
    <div class="modal-panel" on:click|stopPropagation>
      <div class="modal-top">
        <h2>{profile?.role === 'nanny' ? 'My Availability' : 'Manage Calendars'}</h2>
        <button class="modal-close" on:click={() => showCalendarManager = false}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {#if profile?.role === 'nanny'}
        <p class="modal-desc">Connect your personal calendar so your family can see when you're unavailable. Only busy/free status is shared — event details stay private.</p>
      {/if}

      <CalendarManager
        userId={user.id}
        onUpdate={handleCalendarUpdate}
      />

      {#if profile?.role === 'family' || profile?.role === 'admin'}
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

        {#if nannies.length > 0}
          <div class="partner-section">
            <h3>Nanny Calendars</h3>
            <p class="section-desc">These calendars are managed by your nannies. Their busy times appear on the schedule grid so you can avoid conflicts.</p>
            {#each nannies as nanny}
              <div class="nanny-cal-section">
                <h4>{nanny.full_name}</h4>
                <CalendarManager
                  userId={nanny.id}
                  onUpdate={handleCalendarUpdate}
                />
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<!-- Add Shift Modal -->
{#if showAddShift}
  <div class="modal-overlay" on:click={() => showAddShift = false}>
    <div class="modal-panel compact" on:click|stopPropagation>
      <div class="modal-top">
        <h2>Add Nanny Shift</h2>
        <button class="modal-close" on:click={() => showAddShift = false}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <form on:submit|preventDefault={saveShift}>
        <div class="form-field">
          <label>Nanny</label>
          <select bind:value={shiftForm.nannyId} required>
            <option value={null} disabled>Select a nanny</option>
            {#each nannies as nanny}
              <option value={nanny.id}>{nanny.full_name}</option>
            {/each}
          </select>
        </div>

        <div class="form-field">
          <label>Date</label>
          <input type="date" bind:value={shiftForm.date} required />
        </div>

        <div class="form-row-2">
          <div class="form-field">
            <label>Start</label>
            <input type="time" bind:value={shiftForm.startTime} required />
          </div>
          <div class="form-field">
            <label>End</label>
            <input type="time" bind:value={shiftForm.endTime} required />
          </div>
        </div>

        {#if getShiftConflicts().length > 0}
          <div class="conflict-warning">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <div class="conflict-text">
              <strong>Heads up</strong> &mdash; {getNannyName(shiftForm.nannyId)} has {getShiftConflicts().length === 1 ? 'something' : `${getShiftConflicts().length} things`} on their calendar during this time:
              <ul class="conflict-list">
                {#each getShiftConflicts() as conflict}
                  <li>"{conflict.title}" ({conflict.startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - {conflict.endTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })})</li>
                {/each}
              </ul>
              <span class="conflict-hint">You may want to check with them before booking this time.</span>
            </div>
          </div>
        {/if}

        <div class="form-field">
          <label>Notes <span class="optional">(optional)</span></label>
          <input type="text" bind:value={shiftForm.notes} placeholder="e.g., Park day, early pickup" />
        </div>

        <div class="form-actions">
          <button type="submit" class="btn-save">Save Shift</button>
          <button type="button" class="btn-cancel" on:click={() => showAddShift = false}>Cancel</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  /* === Page Layout === */
  .schedule-page {
    min-height: 100vh;
    background: var(--surface-page, #f0f2f8);
    padding: 40px 20px;
    max-width: 1400px;
    margin: 0 auto;
  }
  
  .card {
    background: white;
    border-radius: 1rem;
    padding: 30px;
    box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.07));
    border: 1px solid rgba(0, 0, 0, 0.04);
  }

  /* === Top Bar === */
  .top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 24px;
    background: white;
    border-bottom: 1px solid #e2e8f0;
    position: sticky;
    top: 0;
    z-index: 20;
    flex-wrap: wrap;
    gap: 12px;
  }

  .top-left h1 {
    margin: 0;
    font-size: 1.3em;
    font-weight: 700;
    color: #1a202c;
  }

  .week-label {
    font-size: 0.85em;
    color: #a0aec0;
    font-weight: 500;
  }

  .top-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .top-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: #f1f5f9;
    border: none;
    border-radius: 8px;
    font-size: 0.85em;
    font-weight: 600;
    color: #4a5568;
    cursor: pointer;
    transition: all 0.15s;
  }

  .top-btn:hover {
    background: #e2e8f0;
  }

  .week-nav {
    display: flex;
    align-items: center;
    gap: 2px;
    background: #f1f5f9;
    border-radius: 8px;
    padding: 2px;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    color: #4a5568;
    transition: all 0.15s;
  }

  .nav-btn:hover {
    background: #e2e8f0;
  }

  .today-btn {
    padding: 6px 14px;
    background: white;
    border: 2px solid #e2e8f0;
    border-radius: 10px;
    cursor: pointer;
    font-weight: 600;
    color: #4a5568;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0,0,0,0.06);
    transition: all 0.15s;
  }

  .today-btn:hover {
    background: #f8fafc;
  }

  /* === Gap Banner === */
  .gap-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 24px;
    background: #fef2f2;
    border-bottom: 1px solid #fecaca;
    color: #991b1b;
    font-size: 0.9em;
  }

  /* === Calendar Grid === */
  .calendar-wrapper {
    flex: 1;
    overflow: hidden;
  }

  .time-grid {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 130px);
  }

  /* Day Headers */
  .grid-header {
    display: grid;
    grid-template-columns: 60px repeat(7, 1fr);
    border-bottom: 1px solid #e2e8f0;
    background: white;
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .time-gutter-header {
    border-right: 1px solid #e2e8f0;
  }
  
  .day-column {
    border: 1.5px solid var(--color-gray-200, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
    min-height: 250px;
  }
  
  .day-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 15px;
    text-align: center;
    box-shadow: inset 0 -1px 0 rgba(255,255,255,0.1);
  }

  .day-label {
    font-size: 0.75em;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .day-num {
    font-size: 1.3em;
    font-weight: 700;
    color: #334155;
    margin-top: 2px;
    font-size: 0.9em;
  }
  
  /* Nanny Shifts */
  .shift-block {
    background: #c6f6d5;
    border: 1px solid #48bb78;
    border-radius: 10px;
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
    border-radius: 50%;
  }

  .day-num.today-num {
    background: #667eea;
    color: white;
  }

  /* Grid Body */
  .grid-body {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 15px;
    margin-bottom: 20px;
  }

  .stat-card {
    background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
    border: 2px solid #0284c7;
    border-radius: 14px;
    padding: 20px;
    text-align: center;
  }

  /* Time Gutter */
  .time-gutter {
    border-right: 1px solid #e2e8f0;
    background: white;
    position: sticky;
    left: 0;
    z-index: 5;
  }

  .time-slot {
    position: relative;
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    padding-right: 8px;
  }

  .time-text {
    font-size: 0.7em;
    font-weight: 500;
    color: #94a3b8;
    transform: translateY(-7px);
  }

  /* Day Columns */
  .day-col {
    position: relative;
    border-right: 1px solid #f1f5f9;
    height: calc(var(--total-hours) * var(--hour-height));
    min-height: calc(13 * 60px);
    cursor: default;
  }

  .gap-alert {
    background: #fef2f2;
    border: 2px solid #dc2626;
    border-radius: 14px;
    padding: 20px;
    margin-bottom: 20px;
  }

  .hour-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: #f1f5f9;
  }

  /* Current Time Line */
  .now-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: #ef4444;
    z-index: 8;
    pointer-events: none;
  }

  .now-dot {
    position: absolute;
    left: -4px;
    top: -4px;
    width: 10px;
    height: 10px;
    background: #ef4444;
    border-radius: 50%;
  }

  /* Calendar Events */
  .cal-event {
    position: absolute;
    left: 2px;
    right: 50%;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 0.7em;
    overflow: hidden;
    z-index: 2;
    border-left: 3px solid #667eea;
    cursor: default;
  }

  .cal-event-you {
    background: rgba(102, 126, 234, 0.1);
    right: 50%;
    left: 2px;
  }

  .cal-event-partner {
    background: rgba(159, 122, 234, 0.1);
    left: 50%;
    right: 2px;
  }

  .cal-event-nanny {
    background: rgba(237, 137, 54, 0.12);
    border-left-color: #ed8936;
    left: 2px;
    right: 2px;
    z-index: 1;
  }

  .cal-event-owner {
    font-weight: 600;
    color: #4a5568;
    display: block;
    line-height: 1.3;
  }

  .cal-event-title {
    color: #718096;
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Nanny Shift Blocks */
  .shift-block {
    position: absolute;
    left: 3px;
    right: 3px;
    background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
    border: 1.5px solid #34d399;
    border-radius: 6px;
    padding: 6px 8px;
    z-index: 4;
    cursor: default;
    overflow: hidden;
    transition: box-shadow 0.15s;
  }

  .shift-block:hover {
    box-shadow: 0 2px 8px rgba(52, 211, 153, 0.3);
  }

  .shift-content {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .shift-name {
    font-weight: 700;
    font-size: 0.8em;
    color: #065f46;
  }

  .shift-time {
    font-size: 0.7em;
    color: #047857;
    font-weight: 500;
  }

  .shift-note {
    font-size: 0.65em;
    color: #059669;
    font-style: italic;
    margin-top: 2px;
  }

  .shift-delete {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    background: rgba(255,255,255,0.8);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    display: none;
    align-items: center;
    justify-content: center;
    color: #ef4444;
    transition: all 0.15s;
  }

  .shift-block:hover .shift-delete {
    display: flex;
  }

  .shift-delete:hover {
    background: #fee2e2;
  }

  /* Add Hint */
  .add-hint {
    position: absolute;
    bottom: 8px;
    right: 8px;
    width: 28px;
    height: 28px;
    background: white;
    border: 1.5px solid #e2e8f0;
    border-radius: 6px;
    cursor: pointer;
    display: none;
    align-items: center;
    justify-content: center;
    color: #667eea;
    z-index: 6;
    transition: all 0.15s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }

  .day-col:hover .add-hint {
    display: flex;
  }

  .add-hint:hover {
    background: #667eea;
    color: white;
    border-color: #667eea;
  }

  /* === Legend === */
  .legend {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 24px;
    background: white;
    border-radius: 14px;
    border: 2px solid #e5e7eb;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .legend-swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
  }

  .shift-swatch {
    background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
    border: 1px solid #34d399;
  }

  .you-swatch {
    background: rgba(102, 126, 234, 0.15);
    border: 1px solid rgba(102, 126, 234, 0.4);
  }

  .partner-swatch {
    background: rgba(159, 122, 234, 0.15);
    border: 1px solid rgba(159, 122, 234, 0.4);
  }

  .nanny-busy-swatch {
    background: rgba(237, 137, 54, 0.15);
    border: 1px solid rgba(237, 137, 54, 0.4);
  }

  .legend-hint {
    margin-left: auto;
    color: #a0aec0;
    font-style: italic;
  }

  /* === Modals === */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.45);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
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

  .modal-panel {
    background: white;
    padding: 30px;
    border-radius: 1.125rem;
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
    animation: slideUp 0.3s ease;
    box-shadow: var(--shadow-xl, 0 20px 40px rgba(0,0,0,0.15));
  }

  .modal-panel.compact {
    max-width: 440px;
  }

  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.96) translateY(10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .modal-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  .modal-top h2 {
    margin: 0;
    font-size: 1.15em;
    font-weight: 700;
    color: #1a202c;
  }

  .modal-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: #f1f5f9;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    color: #64748b;
    transition: all 0.15s;
  }

  .modal-close:hover {
    background: #e2e8f0;
    color: #1a202c;
  }

  .partner-section {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid #e2e8f0;
  }

  .partner-section h3 {
    margin: 0 0 16px 0;
    font-size: 1em;
    font-weight: 600;
    color: #4a5568;
  }

  .modal-desc {
    margin: -12px 0 20px 0;
    font-size: 0.9em;
    color: #718096;
    line-height: 1.5;
  }

  .section-desc {
    margin: -8px 0 16px 0;
    font-size: 0.85em;
    color: #a0aec0;
    line-height: 1.5;
  }

  .nanny-cal-section {
    margin-bottom: 16px;
  }

  .nanny-cal-section h4 {
    margin: 0 0 8px 0;
    font-size: 0.9em;
    font-weight: 600;
    color: #64748b;
  }

  /* Conflict Warning */
  .conflict-warning {
    display: flex;
    gap: 10px;
    padding: 12px 14px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 10px;
    margin-bottom: 16px;
    color: #92400e;
    font-size: 0.85em;
    line-height: 1.5;
    animation: fadeIn 0.2s ease;
  }

  .conflict-warning svg {
    flex-shrink: 0;
    margin-top: 1px;
    color: #f59e0b;
  }

  .conflict-text strong {
    color: #78350f;
  }

  .conflict-list {
    margin: 6px 0 6px 0;
    padding-left: 18px;
    font-size: 0.95em;
  }

  .conflict-list li {
    margin-bottom: 2px;
  }

  .conflict-hint {
    display: block;
    font-size: 0.9em;
    color: #b45309;
    font-style: italic;
  }

  /* Modal Form Fields */
  .form-field {
    margin-bottom: 14px;
  }

  .form-field label {
    display: block;
    font-size: 0.85em;
    font-weight: 600;
    color: #4a5568;
    margin-bottom: 5px;
  }

  .form-field .optional {
    font-weight: 400;
    color: #a0aec0;
  }

  .form-field input,
  .form-field select {
    width: 100%;
    padding: 10px;
    border: 1.5px solid var(--color-gray-200, #e2e8f0);
    border-radius: 10px;
    font-size: 1em;
    background: var(--color-gray-50, #f7fafc);
  }

  .form-field input:focus,
  .form-field select:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    background: white;
  }

  .form-field input::placeholder {
    color: #cbd5e0;
  }

  .form-row-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .form-actions {
    display: flex;
    gap: 10px;
    margin-top: 20px;
  }

  .btn-save {
    flex: 1;
    padding: 11px 20px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 10px;
    font-size: 0.95em;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-save:hover {
    background: #5a6fd6;
  }

  .btn-cancel {
    padding: 11px 20px;
    background: transparent;
    color: #64748b;
    border: none;
    border-radius: 10px;
    font-size: 0.95em;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-cancel:hover {
    background: #f1f5f9;
  }

  /* === Responsive === */
  @media (max-width: 768px) {
    .top-bar {
      padding: 12px 16px;
    }

    .top-left h1 {
      font-size: 1.1em;
    }

    .grid-header {
      grid-template-columns: 44px repeat(7, 1fr);
    }

    .grid-body {
      grid-template-columns: 44px repeat(7, 1fr);
    }

    .time-text {
      font-size: 0.6em;
    }

    .day-label {
      font-size: 0.65em;
    }

    .day-num {
      font-size: 1em;
      width: 28px;
      height: 28px;
    }

    .cal-event {
      font-size: 0.6em;
      padding: 1px 3px;
    }

    .cal-event-owner {
      display: none;
    }

    .shift-name {
      font-size: 0.7em;
    }

    .shift-time {
      font-size: 0.6em;
    }

    .shift-note {
      display: none;
    }

    .legend {
      padding: 8px 16px;
      font-size: 0.75em;
    }

    .legend-hint {
      display: none;
    }

    .gap-banner {
      padding: 8px 16px;
      font-size: 0.8em;
    }
  }
</style>
