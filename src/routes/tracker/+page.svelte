<script>
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import { goto } from '$app/navigation'
  import { toast } from '$lib/stores/toast.js'
  import { confirm as confirmModal, prompt as promptModal } from '$lib/stores/toast.js'
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
  let showManualEntry = false
  let editingEntry = null
  let manualEntryForm = {
    date: new Date().toISOString().split('T')[0],
    clockIn: '09:00',
    clockOut: '17:00',
    notes: ''
  }
  
  // Week filter
  let currentWeekOffset = 0
  let currentWeekStart = null
  let currentWeekEnd = null
  
  // Mobile table view toggle
  let mobileView = 'summary' // 'summary' or 'details'
  
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
  })
  
  async function handleNannyChange() {
    await checkCurrentEntry()
    await loadWeekData()
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
  
  function formatDateShort(dateString) {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
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
      toast.error('Please select a nanny')
      return
    }
    
    if (profile?.role !== 'nanny' && selectedNannyId === user.id) {
      toast.error('You cannot clock yourself in. Please select a nanny.')
      return
    }
    
    showClockInConfirm = true
    clockInTime = new Date().toTimeString().slice(0, 5)
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
        toast.error(`${activeEntry.profiles.full_name} is already clocked in. Only one nanny can be on the clock at a time.`)
        loading = false
        showClockInConfirm = false
        return
      }
      
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
      toast.error('Error clocking in: ' + err.message)
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
        toast.error('No active shift found for this nanny')
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
      
      toast.success(`Clocked out! Worked ${hours.toFixed(2)} hours`)
      
      currentEntry = null
      stopTimer()
      await checkCurrentEntry()
      await loadWeekData()
    } catch (err) {
      toast.error('Error clocking out: ' + err.message)
    } finally {
      loading = false
    }
  }
  
  async function generateVenmoPayment() {
    if (weekTotal === 0) {
      toast.error('No completed hours for this week')
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
      
      const confirmed = await confirmModal.show({ title: 'Venmo Payment', message: `Pay $${weekPay.toFixed(2)} to @${venmo} via Venmo?`, confirmText: 'Pay' })
      if (confirmed) {
        await createPaymentRecord()
        window.location.href = venmoUrl
      }
    } else {
      try {
        await navigator.clipboard.writeText(note)
        await createPaymentRecord()
        toast.success('Payment details copied to clipboard!')
      } catch {
        toast.info('Payment details: ' + note, 10000)
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
      toast.error('Error marking as paid: ' + err.message)
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
      toast.error('Error marking as unpaid: ' + err.message)
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
    const confirmed = await confirmModal.show({ title: 'Delete Payment', message: 'Delete this payment record? This cannot be undone.', confirmText: 'Delete', danger: true })
    if (!confirmed) {
      return
    }
    
    try {
      const { error } = await supabase
        .from('payments')
        .delete()
        .eq('id', paymentId)
      
      if (error) throw error
      
      await loadPayments()
      toast.success('Payment record deleted')
    } catch (err) {
      toast.error('Error deleting payment: ' + err.message)
    }
  }
  
  async function requestPayment() {
    if (weekTotal === 0) {
      toast.error('No completed hours for this week')
      return
    }

    const nanny = profile
    const venmo = nanny?.venmo_username?.replace('@', '') || null
    const rate = nanny?.hourly_rate || 20
    
    if (!venmo) {
      toast.error('Please add your Venmo username in Settings first')
      goto('/settings')
      return
    }
    
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
      
      const confirmed = await confirmModal.show({ title: 'Request Payment', message: `Request $${weekPay.toFixed(2)} from @${familyVenmo} via Venmo?`, confirmText: 'Request' })
      if (confirmed) {
        window.location.href = venmoUrl
      }
    } else {
      try {
        await navigator.clipboard.writeText(note)
        toast.success('Payment request details copied to clipboard!')
      } catch {
        toast.info('Payment request: ' + note, 10000)
      }
    }
  }
  
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
      toast.error('Clock out must be after clock in')
      return
    }
    
    try {
      if (editingEntry) {
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
      toast.success('Entry saved!')
    } catch (err) {
      toast.error('Error: ' + err.message)
    }
  }

  async function deleteEntry(entryId) {
    const confirmed = await confirmModal.show({ title: 'Delete Entry', message: 'Delete this entry?', confirmText: 'Delete', danger: true })
    if (!confirmed) return
    
    try {
      const { error } = await supabase
        .from('time_entries')
        .delete()
        .eq('id', entryId)
      
      if (error) throw error
      
      await loadWeekData()
      toast.success('Entry deleted')
    } catch (err) {
      toast.error('Error deleting: ' + err.message)
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
    
    <!-- Timer Card -->
    <div class="card">
      <h2>⏰ Time Tracking</h2>
      
      <div class="timer-card">
        <div class="timer-label">{currentEntry ? 'CURRENT SHIFT' : 'NOT CLOCKED IN'}</div>
        <div class="timer" class:active={currentEntry}>{timerDisplay}</div>
        {#if currentEntry}
          <div class="timer-info">Clocked in at {formatTime(currentEntry.clock_in)}</div>
        {:else}
          <div class="timer-info">Ready to start</div>
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
        <button class="btn btn-secondary" on:click={() => goto('/dashboard')}>
          ← Dashboard
        </button>
        {#if profile?.role === 'family' || profile?.role === 'admin'}
          <button class="btn btn-secondary" on:click={openManualEntry}>
            + Manual Entry
          </button>
        {/if}
        <button class="btn btn-secondary" on:click={exportCSV}>
          📥 Export
        </button>
      </div>
    </div>
    
    <!-- This Week's Summary -->
    <div class="card">
      <div class="card-header">
        <h2>📊 Week Summary</h2>
        <div class="week-nav">
          <button on:click={() => changeWeek(-1)}>←</button>
          <span>{currentWeekStart && currentWeekEnd ? formatWeekDisplay(currentWeekStart, currentWeekEnd) : 'Loading...'}</span>
          <button on:click={() => changeWeek(1)}>→</button>
        </div>
      </div>
      
      <!-- Mobile view toggle -->
      <div class="mobile-view-toggle">
        <button class:active={mobileView === 'summary'} on:click={() => mobileView = 'summary'}>
          Summary
        </button>
        <button class:active={mobileView === 'details'} on:click={() => mobileView = 'details'}>
          Details
        </button>
      </div>
      
      {#if filteredEntries.length === 0}
        <div class="empty-state">No entries for this week</div>
      {:else}
        <!-- Desktop table view -->
        <div class="desktop-table">
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
        </div>
        
        <!-- Mobile card view -->
        <div class="mobile-cards">
          {#if mobileView === 'summary'}
            <!-- Summary View -->
            <div class="summary-grid">
              {#each filteredEntries as entry}
                <div class="entry-card">
                  <div class="entry-header">
                    <span class="entry-date">{formatDateShort(entry.clock_in)}</span>
                    <span class="entry-hours">{(parseFloat(entry.hours) || 0).toFixed(1)}h</span>
                  </div>
                  <div class="entry-time">
                    {formatTime(entry.clock_in)} - {formatTime(entry.clock_out)}
                  </div>
                  <div class="entry-earnings">
                    ${((parseFloat(entry.hours) || 0) * (selectedNanny?.hourly_rate || 20)).toFixed(2)}
                  </div>
                  {#if profile?.role === 'family' || profile?.role === 'admin'}
                    <div class="entry-actions">
                      <button class="btn-sm btn-edit" on:click={() => editEntry(entry)}>Edit</button>
                      <button class="btn-sm btn-danger" on:click={() => deleteEntry(entry.id)}>Delete</button>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <!-- Details View -->
            <div class="details-list">
              {#each filteredEntries as entry}
                <div class="detail-card">
                  <div class="detail-row">
                    <span class="detail-label">Date:</span>
                    <span class="detail-value">{formatDate(entry.clock_in)}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">In/Out:</span>
                    <span class="detail-value">{formatTime(entry.clock_in)} - {formatTime(entry.clock_out)}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Hours:</span>
                    <span class="detail-value">{(parseFloat(entry.hours) || 0).toFixed(1)}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Earnings:</span>
                    <span class="detail-value">${((parseFloat(entry.hours) || 0) * (selectedNanny?.hourly_rate || 20)).toFixed(2)}</span>
                  </div>
                  {#if entry.notes}
                    <div class="detail-row">
                      <span class="detail-label">Notes:</span>
                      <span class="detail-value">{entry.notes}</span>
                    </div>
                  {/if}
                  {#if profile?.role === 'family' || profile?.role === 'admin'}
                    <div class="detail-actions">
                      <button class="btn-sm btn-edit" on:click={() => editEntry(entry)}>Edit</button>
                      <button class="btn-sm btn-danger" on:click={() => deleteEntry(entry.id)}>Delete</button>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
        
        <div class="week-total">
          <div class="total-amount">
            <span class="total-label">Total:</span>
            <span class="total-value">${weekPay.toFixed(2)}</span>
            <span class="total-hours">({weekTotal.toFixed(1)} hours)</span>
          </div>
          {#if profile?.role === 'family' || profile?.role === 'admin'}
            <button class="btn btn-primary" on:click={generateVenmoPayment}>
              Generate Venmo Payment
            </button>
          {:else if profile?.role === 'nanny'}
            <button class="btn btn-primary" on:click={requestPayment}>
              Request Payment
            </button>
          {/if}
        </div>
      {/if}
    </div>
    
    <!-- Payment History -->
    <div class="card">
      <h2>💰 Payment History</h2>

      {#if payments.length === 0}
        <div class="empty-state">No payment records yet</div>
      {:else}
        <!-- Desktop table -->
        <div class="desktop-table">
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
                          Unpaid
                        </button>
                      {:else}
                        <button class="btn-sm btn-success" on:click={() => markPaid(payment.id)}>
                          Paid
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
        </div>
        
        <!-- Mobile payment cards -->
        <div class="mobile-cards">
          {#each payments as payment}
            <div class="payment-card" class:paid={payment.is_paid}>
              <div class="payment-header">
                <span class="payment-week">{formatDateShort(payment.week_start)} - {formatDateShort(payment.week_end)}</span>
                <span class="status-badge" class:paid={payment.is_paid}>
                  {payment.is_paid ? 'Paid' : 'Unpaid'}
                </span>
              </div>
              <div class="payment-details">
                <div class="payment-row">
                  <span>{payment.hours?.toFixed(1) || 0} hours</span>
                  <span class="payment-amount">${payment.amount?.toFixed(2) || 0}</span>
                </div>
                {#if payment.paid_date}
                  <div class="payment-date">Paid: {formatDateShort(payment.paid_date)}</div>
                {/if}
              </div>
              {#if profile?.role === 'family' || profile?.role === 'admin'}
                <div class="payment-actions">
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
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- Clock In Confirmation Modal -->
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

<!-- Manual Entry Modal -->
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
    flex-wrap: wrap;
    gap: 15px;
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
    gap: 10px;
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
  
  .week-nav span {
    font-size: 0.95em;
    font-weight: 600;
    color: #4a5568;
    min-width: 200px;
    text-align: center;
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
    flex-wrap: wrap;
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
  
  /* Mobile view toggle */
  .mobile-view-toggle {
    display: none;
    gap: 10px;
    margin-bottom: 20px;
  }
  
  .mobile-view-toggle button {
    flex: 1;
    padding: 10px;
    background: white;
    border: 2px solid #e2e8f0;
    border-radius: 6px;
    font-weight: 600;
    color: #4a5568;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .mobile-view-toggle button.active {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-color: #667eea;
  }
  
  /* Desktop table */
  .desktop-table {
    display: block;
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
  
  /* Mobile cards - hidden by default */
  .mobile-cards {
    display: none;
  }
  
  .summary-grid {
    display: grid;
    gap: 15px;
  }
  
  .entry-card {
    background: #f7fafc;
    padding: 15px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
  }
  
  .entry-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  
  .entry-date {
    font-weight: 600;
    color: #2d3748;
  }
  
  .entry-hours {
    background: #667eea;
    color: white;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.9em;
    font-weight: 600;
  }
  
  .entry-time {
    color: #4a5568;
    font-size: 0.9em;
    margin-bottom: 8px;
  }
  
  .entry-earnings {
    font-size: 1.2em;
    font-weight: bold;
    color: #48bb78;
    margin-bottom: 10px;
  }
  
  .entry-actions {
    display: flex;
    gap: 8px;
  }
  
  .detail-card {
    background: white;
    border: 1px solid #e2e8f0;
    padding: 15px;
    border-radius: 8px;
    margin-bottom: 10px;
  }
  
  .detail-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid #f7fafc;
  }
  
  .detail-row:last-child {
    border-bottom: none;
  }
  
  .detail-label {
    font-weight: 600;
    color: #4a5568;
  }
  
  .detail-value {
    color: #2d3748;
  }
  
  .detail-actions {
    margin-top: 15px;
    padding-top: 15px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    gap: 8px;
  }
  
  /* Payment cards */
  .payment-card {
    background: white;
    border: 2px solid #e2e8f0;
    padding: 15px;
    border-radius: 8px;
    margin-bottom: 10px;
  }
  
  .payment-card.paid {
    border-color: #48bb78;
    background: #f0fff4;
  }
  
  .payment-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  
  .payment-week {
    font-weight: 600;
    color: #2d3748;
  }
  
  .payment-details {
    margin-bottom: 10px;
  }
  
  .payment-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 5px;
  }
  
  .payment-amount {
    font-weight: bold;
    color: #2d3748;
  }
  
  .payment-date {
    font-size: 0.9em;
    color: #4a5568;
  }
  
  .payment-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid #e2e8f0;
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
  
  .total-label {
    opacity: 0.9;
    margin-right: 10px;
  }
  
  .total-hours {
    font-size: 0.7em;
    opacity: 0.9;
    margin-left: 10px;
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
    transition: all 0.2s;
  }
  
  .btn-success {
    background: #48bb78;
    color: white;
  }
  
  .btn-warning {
    background: #ed8936;
    color: white;
  }
  
  .btn-danger {
    background: #f56565;
    color: white;
  }
  
  .btn-edit {
    background: #4299e1;
    color: white;
  }
  
  .loading {
    text-align: center;
    padding: 60px;
    color: #718096;
  }
  
  /* Modals */
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
    padding: 20px;
  }
  
  .modal-content {
    background: white;
    padding: 30px;
    border-radius: 15px;
    max-width: 500px;
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
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
  
  .form-group input {
    width: 100%;
    padding: 10px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 16px; /* Prevent iOS zoom */
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
  
  .clock-in-confirm {
    text-align: center;
  }
  
  .clock-in-confirm p {
    margin-bottom: 20px;
    font-size: 1.1em;
  }
  
  /* Mobile responsive styles */
  @media (max-width: 768px) {
    .container {
      padding: 20px 12px;
    }
    
    .card {
      padding: 20px;
    }
    
    .timer-card {
      padding: 30px 20px;
    }
    
    .timer {
      font-size: 2.5em;
    }
    
    .btn {
      padding: 14px 28px;
      font-size: 1.1em;
    }
    
    .week-nav span {
      min-width: auto;
      font-size: 0.85em;
    }
    
    .week-nav button {
      padding: 8px 12px;
    }
    
    /* Hide desktop table, show mobile cards */
    .desktop-table {
      display: none;
    }
    
    .mobile-cards {
      display: block;
    }
    
    .mobile-view-toggle {
      display: flex;
    }
    
    .quick-actions {
      gap: 8px;
    }
    
    .btn-secondary {
      padding: 10px 16px;
      font-size: 0.9em;
    }
    
    .modal-content {
      padding: 20px;
    }
    
    .form-row {
      grid-template-columns: 1fr;
    }
    
    .week-total {
      padding: 15px;
    }
    
    .total-amount {
      font-size: 1.5em;
    }
  }
  
  @media (max-width: 480px) {
    .nanny-selector {
      flex-direction: column;
      align-items: stretch;
    }
    
    .card-header {
      flex-direction: column;
      align-items: stretch;
      text-align: center;
    }
    
    .week-nav {
      width: 100%;
      justify-content: space-between;
    }
    
    .btn-sm {
      font-size: 0.8em;
      padding: 5px 10px;
    }
    
    .entry-actions,
    .detail-actions,
    .payment-actions {
      flex-wrap: wrap;
    }
  }
</style>