<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import Nav from '$lib/Nav.svelte'
  
  let user = null
  let profile = null
  let nannies = []
  let selectedNannyId = null
  let currentEntry = null
  let timerDisplay = '00:00:00'
  let timerInterval = null
  let loading = true
  let entries = []
  let payments = []
  let showClockInConfirm = false
let clockInTime = '09:00'
  // Week filter
  let currentWeekOffset = 0
  let currentWeekStart = null
  let currentWeekEnd = null
  let todaySchedules = []
  let currentSchedule = null

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
        selectedNannyId = nannies[0].id
      }
    } else if (profile?.role === 'nanny') {
      selectedNannyId = user.id
    }
    
    await checkCurrentEntry()
    await loadWeekData()
    loading = false
    await loadTodaySchedule()
  })
  
 async function handleNannyChange() {
  await checkCurrentEntry()
  await loadWeekData()
  await loadTodaySchedule() 
}
  
  $: filteredEntries = entries.filter(e => e.clock_out)
  $: weekTotal = filteredEntries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0)
  $: selectedNanny = nannies.find(n => n.id === selectedNannyId) || profile
  $: weekPay = weekTotal * (selectedNanny?.hourly_rate || 20)
  
  async function checkCurrentEntry() {
    if (!selectedNannyId) return
    
    const { data } = await supabase
      .from('time_entries')
      .select('*')
      .eq('nanny_id', selectedNannyId)
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .limit(1)
      .maybeSingle()
    
    if (data) {
      currentEntry = data
      startTimer()
    } else {
      currentEntry = null
      stopTimer()
    }
  }
  async function loadTodaySchedule() {
  if (!selectedNannyId) return
  
  const today = new Date().toISOString().split('T')[0]
  
  try {
    const { data, error } = await supabase
      .from('schedules')
      .select('*')
      .eq('nanny_id', selectedNannyId)
      .eq('date', today)
      .order('start_time')
    
    if (error) throw error
    
    todaySchedules = data || []
    
    // Find the current or next upcoming shift
    const now = new Date().toTimeString().slice(0, 5)
    currentSchedule = todaySchedules.find(s => {
      const endTime = s.end_time.slice(0, 5)
      return endTime > now && (s.status === 'scheduled' || s.status === 'in_progress')
    })
    
    console.log('Today schedules:', todaySchedules)
    console.log('Current/next schedule:', currentSchedule)
  } catch (err) {
    console.error('Error loading today schedule:', err)
    todaySchedules = []
    currentSchedule = null
  }
}
async function clockInWithSchedule(scheduleId = null) {
  if (!selectedNannyId) {
    alert('Please select a nanny')
    return
  }
  
  if (profile?.role !== 'nanny' && selectedNannyId === user.id) {
    alert('You cannot clock yourself in. Please select a nanny.')
    return
  }
  
  loading = true
  
  try {
    // Check if anyone is already clocked in
    const { data: activeEntry } = await supabase
      .from('time_entries')
      .select('*, profiles!time_entries_nanny_id_fkey(full_name)')
      .is('clock_out', null)
      .limit(1)
      .maybeSingle()
    
    if (activeEntry) {
      alert(`${activeEntry.profiles.full_name} is already clocked in. Only one nanny can be on the clock at a time.`)
      loading = false
      return
    }
    
    // Prepare clock-in data
    const clockInData = {
      nanny_id: selectedNannyId,
      clock_in: new Date().toISOString()
    }
    
    // Add schedule_id if clocking in for a specific schedule
    if (scheduleId) {
      clockInData.schedule_id = scheduleId
      
      // Update schedule status to in_progress
      await supabase
        .from('schedules')
        .update({ status: 'in_progress' })
        .eq('id', scheduleId)
    }
    
    const { data, error } = await supabase
      .from('time_entries')
      .insert(clockInData)
      .select()
      .single()
    
    if (error) throw error
    
    currentEntry = data
    startTimer()
    await loadWeekData()
    await loadTodaySchedule()
    
    if (scheduleId && currentSchedule) {
      alert(`Clocked in for scheduled shift: ${currentSchedule.start_time.slice(0,5)} - ${currentSchedule.end_time.slice(0,5)}`)
    }
  } catch (err) {
    alert('Error clocking in: ' + err.message)
  } finally {
    loading = false
  }
}
  async function loadWeekData() {
    if (!selectedNannyId) return
    
    const bounds = getWeekBounds(currentWeekOffset)
    currentWeekStart = bounds.start
    currentWeekEnd = bounds.end
    
    const { data } = await supabase
      .from('time_entries')
      .select('*')
      .eq('nanny_id', selectedNannyId)
      .gte('clock_in', bounds.start.toISOString())
      .lte('clock_in', bounds.end.toISOString())
      .order('clock_in', { ascending: false })
    
    entries = data || []
    
    // Load payments for this nanny
    await loadPayments()
  }
  
  async function loadPayments() {
    if (!selectedNannyId) return
    
    const { data } = await supabase
      .from('payments')
      .select('*')
      .eq('nanny_id', selectedNannyId)
      .order('week_start', { ascending: false })
      .limit(20)
    
    payments = data || []
  }
  
  function getWeekBounds(offset = 0) {
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay())
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() + (offset * 7))
    
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    weekEnd.setHours(23, 59, 59, 999)
    
    return { start: weekStart, end: weekEnd }
  }
  function formatTime(dateString) {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  })
}
function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric'
  })
}
  function changeWeek(direction) {
    currentWeekOffset += direction
    loadWeekData()
  }
  
  function formatWeekDisplay(start, end) {
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${start.getFullYear()}`
  }
  
  function startTimer() {
    if (timerInterval) clearInterval(timerInterval)
    
    timerInterval = setInterval(() => {
      if (!currentEntry) return
      
      const clockInTime = new Date(currentEntry.clock_in)
      const now = new Date()
      const diff = now - clockInTime
      
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)
      
      timerDisplay = 
        String(hours).padStart(2, '0') + ':' +
        String(minutes).padStart(2, '0') + ':' +
        String(seconds).padStart(2, '0')
    }, 1000)
  }
  
  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval)
      timerInterval = null
    }
    timerDisplay = '00:00:00'
  }
  
  async function clockIn() {
  if (!selectedNannyId) {
    alert('Please select a nanny')
    return
  }
  
  if (profile?.role !== 'nanny' && selectedNannyId === user.id) {
    alert('You cannot clock yourself in. Please select a nanny.')
    return
  }
  
  // Show confirmation modal instead of immediately clocking in
  showClockInConfirm = true
  clockInTime = new Date().toTimeString().slice(0, 5) // HH:MM format
 
  // If there's a current schedule, offer to clock in for it
  if (currentSchedule) {
    if (confirm(`Clock in for scheduled shift ${currentSchedule.start_time.slice(0,5)} - ${currentSchedule.end_time.slice(0,5)}?`)) {
      await clockInWithSchedule(currentSchedule.id)
    } else {
      await clockInWithSchedule(null) // Clock in without schedule
    }
  } else {
    await clockInWithSchedule(null) // No schedule, just clock in
  }
}

async function confirmClockIn() {
  loading = true
  
  try {
    const { data: activeEntry } = await supabase
      .from('time_entries')
      .select('*, profiles!time_entries_nanny_id_fkey(full_name)')
      .is('clock_out', null)
      .limit(1)
      .maybeSingle()
    
    if (activeEntry) {
      alert(`${activeEntry.profiles.full_name} is already clocked in. Only one nanny can be on the clock at a time.`)
      loading = false
      showClockInConfirm = false
      return
    }
    
    // Build the clock-in timestamp from today's date + selected time
    const today = new Date().toISOString().split('T')[0]
    const clockInDateTime = new Date(`${today}T${clockInTime}`)
    
    const { data, error } = await supabase
      .from('time_entries')
      .insert({
        nanny_id: selectedNannyId,
        clock_in: clockInDateTime.toISOString()
      })
      .select()
      .single()
    
    if (error) throw error
    
    currentEntry = data
    startTimer()
    await loadWeekData()
    showClockInConfirm = false
  } catch (err) {
    alert('Error clocking in: ' + err.message)
  } finally {
    loading = false
  }
}
  
async function clockOut() {
  loading = true
  
  try {
    const { data: activeEntry, error: fetchError } = await supabase
      .from('time_entries')
      .select('*')
      .eq('nanny_id', selectedNannyId)
      .is('clock_out', null)
      .maybeSingle()
    
    if (fetchError) throw fetchError
    
    if (!activeEntry) {
      alert('No active shift found for this nanny')
      loading = false
      return
    }
    
    const clockOutTime = new Date()
    const clockInTime = new Date(activeEntry.clock_in)
    const hours = (clockOutTime - clockInTime) / (1000 * 60 * 60)
    
    const { error: updateError } = await supabase
      .from('time_entries')
      .update({
        clock_out: clockOutTime.toISOString(),
        hours: hours.toFixed(2)
      })
      .eq('id', activeEntry.id)
    
    if (updateError) throw updateError
    
    // If this was a scheduled shift, update its status
    if (activeEntry.schedule_id) {
      await supabase
        .from('schedules')
        .update({ status: 'completed' })
        .eq('id', activeEntry.schedule_id)
    }
    
    alert(`Clocked out! Worked ${hours.toFixed(2)} hours`)
    
    currentEntry = null
    stopTimer()
    await checkCurrentEntry()
    await loadWeekData()
    await loadTodaySchedule()
  } catch (err) {
    console.error('Clock out error:', err)
    alert('Error clocking out: ' + err.message)
  } finally {
    loading = false
  }
}

  
  async function generateVenmoPayment() {
    if (weekTotal === 0) {
      alert('No completed hours for this week')
      return
    }
    
    const nanny = selectedNanny
    const venmo = nanny?.venmo_username?.replace('@', '') || 'username'
    const rate = nanny?.hourly_rate || 20
    
    const note = `Weekly payment for ${nanny?.full_name}
Week of ${currentWeekStart.toLocaleDateString()}
Hours: ${weekTotal.toFixed(1)}
Rate: $${rate}/hour
Total: $${weekPay.toFixed(2)}`
    
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    
    if (isMobile && venmo !== 'username') {
      const venmoUrl = `venmo://paycharge?txn=pay&recipients=${venmo}&amount=${weekPay.toFixed(2)}&note=${encodeURIComponent(note)}`
      
      if (confirm(`Pay $${weekPay.toFixed(2)} to @${venmo} via Venmo?`)) {
        // Create payment record
        await createPaymentRecord()
        window.location.href = venmoUrl
      }
    } else {
      try {
        await navigator.clipboard.writeText(note)
        await createPaymentRecord()
        alert(`Payment details copied!\n\n${note}\n\nPaste into Venmo when sending to @${venmo}`)
        // Don't auto-create payment record on desktop
      } catch {
        prompt('Copy this payment message:', note)
      }
    }
  }
  
  async function createPaymentRecord() {
    try {
      await supabase
        .from('payments')
        .insert({
          nanny_id: selectedNannyId,
          week_start: currentWeekStart.toISOString().split('T')[0],
          week_end: currentWeekEnd.toISOString().split('T')[0],
          hours: weekTotal,
          amount: weekPay,
          is_paid: false,
          payment_method: 'Venmo'
        })
      
      await loadPayments()
    } catch (err) {
      console.error('Error creating payment record:', err)
    }
  }
  
  async function markPaid(paymentId) {
    try {
      await supabase
        .from('payments')
        .update({
          is_paid: true,
          paid_date: new Date().toISOString()
        })
        .eq('id', paymentId)
      
      await loadPayments()
    } catch (err) {
      alert('Error marking as paid: ' + err.message)
    }
  }
  
  async function markUnpaid(paymentId) {
    try {
      await supabase
        .from('payments')
        .update({
          is_paid: false,
          paid_date: null
        })
        .eq('id', paymentId)
      
      await loadPayments()
    } catch (err) {
      alert('Error marking as unpaid: ' + err.message)
    }
  }
  
  function exportCSV() {
    const headers = ['Date', 'Clock In', 'Clock Out', 'Hours', 'Earnings', 'Notes']
    const rate = selectedNanny?.hourly_rate || 20
    const rows = filteredEntries.map(e => [
      formatDate(e.clock_in),
      formatTime(e.clock_in),
      formatTime(e.clock_out),
      (parseFloat(e.hours) || 0).toFixed(2),
      ((parseFloat(e.hours) || 0) * rate).toFixed(2),
      e.notes || ''
    ])
    
    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')
    
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `timesheet-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }
  
  function getSelectedNannyName() {
    if (profile?.role === 'nanny') return 'You'
    return nannies.find(n => n.id === selectedNannyId)?.full_name || 'Select a nanny'
  }
  async function deletePayment(paymentId) {
  if (!confirm('Delete this payment record? This cannot be undone.')) {
    return
  }
  
  try {
    const { error } = await supabase
      .from('payments')
      .delete()
      .eq('id', paymentId)
    
    if (error) throw error
    
    await loadPayments()
    alert('Payment record deleted')
  } catch (err) {
    alert('Error deleting payment: ' + err.message)
  }
}
async function requestPayment() {
  if (weekTotal === 0) {
    alert('No completed hours for this week')
    return
  }
  
  const nanny = profile
  const venmo = nanny?.venmo_username?.replace('@', '') || null
  const rate = nanny?.hourly_rate || 20
  
  if (!venmo) {
    alert('Please add your Venmo username in Settings first')
    window.location.href = '/settings'
    return
  }
  
  // Get family members who could pay
  const { data: familyMembers } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'family')
  
  const familyVenmo = familyMembers?.[0]?.venmo_username?.replace('@', '') || 'family'
  
  const note = `Payment request from ${nanny?.full_name}
Week of ${currentWeekStart.toLocaleDateString()}
Hours: ${weekTotal.toFixed(1)}
Rate: $${rate}/hour
Total: $${weekPay.toFixed(2)}`
  
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  
  if (isMobile) {
    const venmoUrl = `venmo://paycharge?txn=charge&recipients=${familyVenmo}&amount=${weekPay.toFixed(2)}&note=${encodeURIComponent(note)}`
    
    if (confirm(`Request $${weekPay.toFixed(2)} from @${familyVenmo} via Venmo?`)) {
      window.location.href = venmoUrl
    }
  } else {
    try {
      await navigator.clipboard.writeText(note)
      alert(`Payment request details copied!\n\n${note}\n\nOpen Venmo and request from your employer.`)
    } catch {
      prompt('Copy this payment request:', note)
    }
  }
}
// Add these variables at the top with your other state
let showManualEntry = false
let editingEntry = null
let manualEntryForm = {
  date: new Date().toISOString().split('T')[0],
  clockIn: '09:00',
  clockOut: '17:00',
  notes: ''
}

// Add these functions
function openManualEntry() {
  editingEntry = null
  manualEntryForm = {
    date: new Date().toISOString().split('T')[0],
    clockIn: '09:00',
    clockOut: '17:00',
    notes: ''
  }
  showManualEntry = true
}

function editEntry(entry) {
  editingEntry = entry
  manualEntryForm = {
    date: new Date(entry.clock_in).toISOString().split('T')[0],
    clockIn: new Date(entry.clock_in).toTimeString().slice(0, 5),
    clockOut: entry.clock_out ? new Date(entry.clock_out).toTimeString().slice(0, 5) : '17:00',
    notes: entry.notes || ''
  }
  showManualEntry = true
}

async function saveManualEntry() {
  const clockIn = new Date(`${manualEntryForm.date}T${manualEntryForm.clockIn}`)
  const clockOut = new Date(`${manualEntryForm.date}T${manualEntryForm.clockOut}`)
  const hours = (clockOut - clockIn) / (1000 * 60 * 60)
  
  if (hours <= 0) {
    alert('Clock out must be after clock in')
    return
  }
  
  try {
    if (editingEntry) {
      // Update existing
      const { error } = await supabase
        .from('time_entries')
        .update({
          clock_in: clockIn.toISOString(),
          clock_out: clockOut.toISOString(),
          hours: hours.toFixed(2),
          notes: manualEntryForm.notes
        })
        .eq('id', editingEntry.id)
      
      if (error) throw error
    } else {
      // Create new
      const { error } = await supabase
        .from('time_entries')
        .insert({
          nanny_id: selectedNannyId,
          clock_in: clockIn.toISOString(),
          clock_out: clockOut.toISOString(),
          hours: hours.toFixed(2),
          notes: manualEntryForm.notes
        })
      
      if (error) throw error
    }
    
    showManualEntry = false
    await loadWeekData()
    alert('Entry saved!')
  } catch (err) {
    alert('Error: ' + err.message)
  }
}

async function deleteEntry(entryId) {
  if (!confirm('Delete this entry?')) return
  
  try {
    const { error } = await supabase
      .from('time_entries')
      .delete()
      .eq('id', entryId)
    
    if (error) throw error
    
    await loadWeekData()
    alert('Entry deleted')
  } catch (err) {
    alert('Error deleting: ' + err.message)
  }
}
</script>

<Nav currentPage="tracker" />

<div class="container">
  {#if loading}
    <div class="loading">Loading...</div>
  {:else}
    <!-- Nanny Selector -->
    {#if (profile?.role === 'family' || profile?.role === 'admin') && nannies.length > 0}
      <div class="nanny-selector">
        <label>Tracking for:</label>
        <select bind:value={selectedNannyId} on:change={handleNannyChange}>
          {#each nannies as nanny}
            <option value={nanny.id}>{nanny.full_name}</option>
          {/each}
        </select>
      </div>
    {/if}
    <!-- Today's Schedule Card (only show if there are schedules) -->
{#if todaySchedules.length > 0}
  <div class="card schedule-today-card">
    <h2>📅 Today's Schedule</h2>
    
    <div class="schedule-list">
      {#each todaySchedules as schedule}
        <div class="schedule-item" class:active={schedule.status === 'in_progress'} class:completed={schedule.status === 'completed'}>
          <div class="schedule-info">
            <div class="schedule-time">
              <strong>{schedule.start_time.slice(0,5)} - {schedule.end_time.slice(0,5)}</strong>
              {#if schedule.status === 'completed'}
                <span class="status-badge completed">✅ Completed</span>
              {:else if schedule.status === 'in_progress'}
                <span class="status-badge active">🟢 In Progress</span>
              {:else if schedule.id === currentSchedule?.id}
                <span class="status-badge upcoming">⏰ Up Next</span>
              {:else}
                <span class="status-badge scheduled">📅 Scheduled</span>
              {/if}
            </div>
            
            {#if schedule.notes}
              <div class="schedule-notes">{schedule.notes}</div>
            {/if}
          </div>
          
          {#if schedule.status === 'scheduled' && !currentEntry && schedule.id === currentSchedule?.id}
            <button class="btn btn-schedule-clock" on:click={() => clockInWithSchedule(schedule.id)}>
              Clock In for This Shift
            </button>
          {/if}
        </div>
      {/each}
    </div>
    
    {#if !currentEntry && !currentSchedule}
      <div class="no-current-schedule">
        No upcoming shifts today. You can still clock in for unscheduled work.
      </div>
    {/if}
  </div>
{/if}
    <!-- Timer Card -->
    <div class="card">
      <h2>⏰ Time Tracking</h2>
      
      <div class="timer-card">
        <div class="timer-label">{currentEntry ? 'CURRENT SHIFT' : 'NOT CLOCKED IN'}</div>
        <div class="timer" class:active={currentEntry}>{timerDisplay}</div>
        {#if currentEntry}
          <div class="timer-info">Clocked in at {formatTime(currentEntry.clock_in)}</div>
        {:else}
          <div class="timer-info">Not clocked in</div>
        {/if}
      </div>
      
      <div class="button-container">
        {#if currentEntry}
          <button class="btn btn-clock-out" on:click={clockOut} disabled={loading}>
            Clock Out
          </button>
        {:else}
          <button class="btn btn-clock-in" on:click={clockIn} disabled={loading || !selectedNannyId}>
            Clock In
          </button>
        {/if}
      </div>
      
      <div class="quick-actions">
        <button class="btn btn-secondary" on:click={() => window.location.href = '/dashboard'}>
          ← Back to Dashboard
        </button>
        {#if profile?.role === 'family' || profile?.role === 'admin'}
    <button class="btn btn-secondary" on:click={openManualEntry}>
      ➕ Manual Entry
    </button>
  {/if}
        <button class="btn btn-secondary" on:click={exportCSV}>
          📥 Export CSV
        </button>
      </div>
    </div>
    
    <!-- This Week's Summary -->
    <div class="card">
      <div class="card-header">
        <h2>📊 This Week's Summary</h2>
        <div class="week-nav">
          <button on:click={() => changeWeek(-1)}>←</button>
          <span>{currentWeekStart && currentWeekEnd ? formatWeekDisplay(currentWeekStart, currentWeekEnd) : 'Loading...'}</span>
          <button on:click={() => changeWeek(1)}>→</button>
        </div>
      </div>
      
      {#if filteredEntries.length === 0}
        <div class="empty-state">No entries for this week</div>
      {:else}
        <table>
          <thead>
  <tr>
    <th>Date</th>
    <th>Clock In</th>
    <th>Clock Out</th>
    <th>Hours</th>
    <th>Earnings</th>
    <th>Notes</th>
    {#if profile?.role === 'family' || profile?.role === 'admin'}
      <th>Actions</th>
    {/if}
  </tr>
</thead>
<tbody>
  {#each filteredEntries as entry}
    <tr>
      <td>{formatDate(entry.clock_in)}</td>
      <td>{formatTime(entry.clock_in)}</td>
      <td>{formatTime(entry.clock_out)}</td>
      <td>{(parseFloat(entry.hours) || 0).toFixed(1)}</td>
      <td>${((parseFloat(entry.hours) || 0) * (selectedNanny?.hourly_rate || 20)).toFixed(2)}</td>
      <td>{entry.notes || ''}</td>
      {#if profile?.role === 'family' || profile?.role === 'admin'}
        <td>
          <button class="btn-sm btn-edit" on:click={() => editEntry(entry)}>Edit</button>
          <button class="btn-sm btn-danger" on:click={() => deleteEntry(entry.id)}>Delete</button>
        </td>
      {/if}
    </tr>
  {/each}
</tbody>
        </table>
        <div class="week-total">
            <div class="total-amount">Total: ${weekPay.toFixed(2)} ({weekTotal.toFixed(1)} hours)</div>
            {#if profile?.role === 'family' || profile?.role === 'admin'}
                <button class="btn btn-primary" on:click={generateVenmoPayment}>
                    Generate Venmo Payment
                </button>
            {:else if profile?.role === 'nanny'}
                <button class="btn btn-primary" on:click={requestPayment}>
                Request Payment via Venmo
                </button>
            {/if}
        </div>
      {/if}  <!-- ADD THIS LINE - closes the {#if filteredEntries.length === 0} block -->
    </div>  <!-- This closes the card -->
    
<!-- Payment History -->
<div class="card">
  <h2>💰 Payment History</h2>

  {#if payments.length === 0}
    <div class="empty-state">No payment records yet</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Week</th>
          <th>Status</th>
          <th>Hours</th>
          <th>Amount</th>
          <th>Paid Date</th>
          <th>Method</th>
          {#if profile?.role === 'family' || profile?.role === 'admin'}
            <th>Actions</th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each payments as payment}
          <tr>
            <td>{formatDate(payment.week_start)} – {formatDate(payment.week_end)}</td>
            <td>
              <span class="status-badge" class:paid={payment.is_paid}>
                {payment.is_paid ? 'Paid' : 'Unpaid'}
              </span>
            </td>
            <td>{payment.hours?.toFixed(1) || 0}</td>
            <td>${payment.amount?.toFixed(2) || 0}</td>
            <td>{payment.paid_date ? formatDate(payment.paid_date) : '—'}</td>
            <td>{payment.payment_method || 'Venmo'}</td>
            {#if profile?.role === 'family' || profile?.role === 'admin'}
              <td>
                {#if payment.is_paid}
                  <button class="btn-sm btn-warning" on:click={() => markUnpaid(payment.id)}>
                    Mark Unpaid
                  </button>
                {:else}
                  <button class="btn-sm btn-success" on:click={() => markPaid(payment.id)}>
                    Mark Paid
                  </button>
                {/if}
                <button class="btn-sm btn-danger" on:click={() => deletePayment(payment.id)}>
                  Delete
                </button>
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
{/if} 
{#if showClockInConfirm}
  <div class="modal-overlay" on:click={() => showClockInConfirm = false}>
    <div class="modal-content" on:click|stopPropagation>
      <h3>Confirm Clock In Time</h3>
      
      <div class="clock-in-confirm">
        <p>Clocking in <strong>{getSelectedNannyName()}</strong></p>
        
        <div class="form-group">
          <label>Clock In Time</label>
          <input type="time" bind:value={clockInTime} />
          <small>Adjust if they started earlier/later</small>
        </div>
        
        <div class="button-row">
          <button class="btn btn-primary" on:click={confirmClockIn}>
            Confirm Clock In
          </button>
          <button class="btn btn-secondary" on:click={() => showClockInConfirm = false}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
</div>
{#if showManualEntry}
  <div class="modal-overlay" on:click={() => showManualEntry = false}>
    <div class="modal-content" on:click|stopPropagation>
      <h3>{editingEntry ? 'Edit' : 'Add'} Time Entry</h3>
      
      <form on:submit|preventDefault={saveManualEntry}>
        <div class="form-group">
          <label>Date</label>
          <input type="date" bind:value={manualEntryForm.date} required />
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label>Clock In</label>
            <input type="time" bind:value={manualEntryForm.clockIn} required />
          </div>
          <div class="form-group">
            <label>Clock Out</label>
            <input type="time" bind:value={manualEntryForm.clockOut} required />
          </div>
        </div>
        
        <div class="form-group">
          <label>Notes</label>
          <input type="text" bind:value={manualEntryForm.notes} placeholder="Optional" />
        </div>
        
        <div class="button-row">
          <button type="submit" class="btn btn-primary">Save</button>
          <button type="button" class="btn btn-secondary" on:click={() => showManualEntry = false}>Cancel</button>
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
    max-width: 1200px;
    margin: 0 auto;
  }
  
  .nanny-selector {
    background: white;
    padding: 20px;
    border-radius: 15px;
    margin-bottom: 20px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    display: flex;
    align-items: center;
    gap: 15px;
  }
  
  .nanny-selector label {
    font-weight: 600;
    color: #4a5568;
  }
  
  .nanny-selector select {
    flex: 1;
    padding: 12px;
    border: 2px solid #e2e8f0;
    border-radius: 8px;
    font-size: 1em;
  }
  
  .card {
    background: white;
    border-radius: 15px;
    padding: 30px;
    margin-bottom: 20px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  }
  
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }
  
  h2 {
    margin: 0 0 20px 0;
    color: #2d3748;
    padding-bottom: 10px;
    border-bottom: 2px solid #e2e8f0;
  }
  
  .card-header h2 {
    border: none;
    padding: 0;
    margin: 0;
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
  }
  
  .week-nav button:hover {
    background: #f7fafc;
  }
  
  .timer-card {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 40px;
    border-radius: 15px;
    text-align: center;
    margin-bottom: 30px;
  }
  
  .timer-label {
    font-size: 0.9em;
    opacity: 0.9;
    margin-bottom: 15px;
    letter-spacing: 2px;
  }
  
  .timer {
    font-size: 3.5em;
    font-weight: bold;
    font-family: 'SF Mono', Monaco, monospace;
  }
  
  .timer.active {
    animation: pulse 2s ease-in-out infinite;
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
  }
  
  .timer-info {
    margin-top: 15px;
    opacity: 0.9;
  }
  
  .button-container {
    text-align: center;
    margin-bottom: 20px;
  }
  
  .btn {
    padding: 16px 40px;
    font-size: 1.2em;
    font-weight: bold;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.3s;
  }
  
  .btn-clock-in {
    background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
    color: white;
  }
  
  .btn-clock-out {
    background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
    color: white;
  }
  
  .btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(0,0,0,0.2);
  }
  
  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .quick-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
  }
  
  .btn-secondary {
    padding: 10px 20px;
    font-size: 0.95em;
    background: #718096;
    color: white;
  }
  
  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }
  
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 20px;
  }
  
  th {
    background: #f7fafc;
    padding: 12px;
    text-align: left;
    color: #4a5568;
    font-weight: 600;
    border-bottom: 2px solid #e2e8f0;
  }
  
  td {
    padding: 12px;
    border-bottom: 1px solid #e2e8f0;
  }
  
  tr:hover {
    background: #f7fafc;
  }
  
  .empty-state {
    text-align: center;
    padding: 40px;
    color: #718096;
  }
  
  .week-total {
    margin-top: 20px;
    padding: 20px;
    background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
    color: white;
    border-radius: 10px;
    text-align: center;
  }
  
  .total-amount {
    font-size: 1.8em;
    font-weight: bold;
    margin-bottom: 15px;
  }
  
  .status-badge {
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 0.85em;
    font-weight: 600;
    background: #fed7d7;
    color: #c53030;
  }
  
  .status-badge.paid {
    background: #c6f6d5;
    color: #22543d;
  }
  
  .btn-sm {
    padding: 6px 12px;
    font-size: 0.85em;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
  }
  
  .btn-success {
    background: #48bb78;
    color: white;
  }
  
  .btn-warning {
    background: #ed8936;
    color: white;
  }
  
  .loading {
    text-align: center;
    padding: 60px;
    color: #718096;
  }
  .btn-danger {
  background: #f56565;
  color: white;
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
}

.modal-content {
  background: white;
  padding: 30px;
  border-radius: 15px;
  max-width: 500px;
  width: 90%;
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

.form-group input {
  width: 100%;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
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
  padding: 12px;
  font-size: 1em;
}

.btn-edit {
  background: #4299e1;
  color: white;
}
.clock-in-confirm {
  text-align: center;
}

.clock-in-confirm p {
  margin-bottom: 20px;
  font-size: 1.1em;
}

.clock-in-confirm small {
  display: block;
  margin-top: 5px;
  color: #718096;
  font-size: 0.85em;
}

@media (max-width: 600px) {
  .form-row {
    grid-template-columns: 1fr;
  }
}

/* Today's Schedule Styles */
.schedule-today-card {
  background: linear-gradient(to right, #f7fafc, white);
  border-left: 4px solid #667eea;
}

.schedule-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.schedule-item {
  background: white;
  border: 2px solid #e2e8f0;
  border-radius: 10px;
  padding: 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: all 0.3s;
}

.schedule-item.active {
  border-color: #48bb78;
  background: #f0fff4;
}

.schedule-item.completed {
  border-color: #9f7aea;
  background: #faf5ff;
  opacity: 0.8;
}

.schedule-info {
  flex: 1;
}

.schedule-time {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 5px;
}

.status-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.8em;
  font-weight: 600;
}

.status-badge.completed {
  background: #c6f6d5;
  color: #22543d;
}

.status-badge.active {
  background: #c6f6d5;
  color: #22543d;
}

.status-badge.upcoming {
  background: #fef5e7;
  color: #744210;
}

.status-badge.scheduled {
  background: #e6f7ff;
  color: #0050b3;
}

.schedule-notes {
  color: #718096;
  font-size: 0.9em;
  margin-top: 5px;
}

.btn-schedule-clock {
  padding: 10px 20px;
  background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-schedule-clock:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(72, 187, 120, 0.3);
}

.no-current-schedule {
  text-align: center;
  padding: 20px;
  color: #718096;
  background: #f7fafc;
  border-radius: 8px;
  margin-top: 15px;
}
</style>
