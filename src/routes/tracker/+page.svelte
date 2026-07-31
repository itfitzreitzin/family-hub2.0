<script>
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { goto } from '$app/navigation';
	import { toast } from '$lib/stores/toast.js';
	import { confirm as confirmModal } from '$lib/stores/toast.js';
	import Nav from '$lib/Nav.svelte';
	import {
		localDateString,
		localTimeString,
		combineLocalDateTime,
		getWeekBounds,
		weekOffsetFor,
		formatDuration,
		hoursBetween,
		formatTime,
		formatDate,
		formatDateShort,
		formatWeekDisplay
	} from '$lib/time.js';
	import { errorMessage } from '$lib/errors.js';
	import {
		normalizeVenmoHandle,
		isMobileDevice,
		buildVenmoNote,
		buildVenmoLink
	} from '$lib/venmo.js';
	import { buildTimesheetCsv, timesheetFilename, downloadCsv } from '$lib/csv.js';
	import Icon from '$lib/icons/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	/** @type {any} */
	let user = null;
	/** @type {any} */
	let profile = null;
	/** @type {any[]} */
	let nannies = [];
	/** @type {string | null} */
	let selectedNannyId = null;
	/** @type {any} */
	let currentEntry = null;
	let timerDisplay = '00:00:00';
	/** @type {ReturnType<typeof setInterval> | null} */
	let timerInterval = null;
	let initializing = true;
	/** @type {string | null} */
	let initError = null;
	let clockingIn = false;
	let clockingOut = false;
	let weekLoading = false;
	let generatingPayment = false;
	/** @type {string | number | null} */
	let paymentBusyId = null;
	let entryLoadToken = 0;
	let weekLoadToken = 0;
	let paymentsLoadToken = 0;
	/** @type {ReturnType<typeof supabase.channel> | null} */
	let realtimeChannel = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let resyncTimer = null;
	/** @type {any[]} */
	let entries = [];
	/** @type {any[]} */
	let payments = [];
	let showClockInConfirm = false;
	let clockInTime = '09:00';
	let showClockOutConfirm = false;
	let clockOutTime = '17:00';
	let showManualEntry = false;
	/** @type {any} */
	let editingEntry = null;
	let saving = false;
	let manualEntryForm = {
		date: localDateString(),
		clockIn: '09:00',
		clockOut: '17:00',
		notes: ''
	};

	// Week filter
	let currentWeekOffset = 0;
	let currentWeekStart = null;
	let currentWeekEnd = null;

	// Mobile table view toggle
	let mobileView = 'summary'; // 'summary' or 'details'

	onMount(() => {
		initTracker();
	});

	onDestroy(() => {
		if (timerInterval) clearInterval(timerInterval);
		if (resyncTimer) clearTimeout(resyncTimer);
		if (realtimeChannel) supabase.removeChannel(realtimeChannel);
	});

	async function initTracker() {
		initializing = true;
		initError = null;

		try {
			const {
				data: { user: currentUser }
			} = await supabase.auth.getUser();

			if (!currentUser) {
				goto('/');
				return;
			}

			user = currentUser;

			const { data: profileData, error: profileError } = await supabase
				.from('profiles')
				.select('*')
				.eq('id', user.id)
				.maybeSingle();

			if (profileError) throw profileError;
			profile = profileData;

			// Load nannies for family/admin
			if (profile?.role === 'family' || profile?.role === 'admin') {
				const { data: nanniesData, error: nanniesError } = await supabase
					.from('profiles')
					.select('*')
					.eq('role', 'nanny')
					.order('full_name');

				if (nanniesError) throw nanniesError;
				nannies = nanniesData || [];

				if (nannies.length > 0) {
					selectedNannyId = nannies[0].id;
				}
			} else if (profile?.role === 'nanny') {
				selectedNannyId = user.id;
			}

			await Promise.all([checkCurrentEntry(), loadWeekData(), loadPayments()]);

			if (!realtimeChannel) {
				subscribeRealtime();
			}

			initializing = false;
		} catch (err) {
			initError = errorMessage(err);
			initializing = false;
		}
	}

	function subscribeRealtime() {
		// Unfiltered on purpose: a clock-out UPDATE leaves the clock_out=is.null
		// set (filtered subscriptions never see it), and DELETE events can't be
		// filtered by non-key columns at all. Relevance is checked client-side.
		realtimeChannel = supabase
			.channel('tracker-live')
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'time_entries' },
				handleTimeEntryEvent
			)
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'payments' },
				handlePaymentEvent
			)
			.subscribe();
	}

	/** @param {any} payload */
	function handleTimeEntryEvent(payload) {
		const row = payload.new || {};

		// Fast paths keep the timer honest before the refetch lands
		if (
			payload.eventType === 'UPDATE' &&
			currentEntry &&
			row.id === currentEntry.id &&
			row.clock_out
		) {
			currentEntry = null;
			stopTimer();
			toast.info('Shift was clocked out on another device');
		} else if (
			payload.eventType === 'INSERT' &&
			row.nanny_id === selectedNannyId &&
			!row.clock_out
		) {
			currentEntry = row;
			startTimer();
		}

		// DELETE payloads only carry the primary key, so treat them as relevant
		if (payload.eventType === 'DELETE' || row.nanny_id === selectedNannyId) {
			scheduleResync();
		}
	}

	/** @param {any} payload */
	function handlePaymentEvent(payload) {
		const row = payload.new || {};
		if (payload.eventType === 'DELETE' || row.nanny_id === selectedNannyId) {
			loadPayments().catch(() => {});
		}
	}

	// Collapse event bursts (e.g. a clock-out closing stray duplicates) into
	// one refetch.
	function scheduleResync() {
		if (resyncTimer) clearTimeout(resyncTimer);
		resyncTimer = setTimeout(() => {
			resyncTimer = null;
			resyncAll();
		}, 250);
	}

	async function resyncAll() {
		try {
			await Promise.all([checkCurrentEntry(), loadWeekData(true), loadPayments()]);
		} catch (err) {
			// Background sync: keep showing the last good data
			console.warn('Tracker resync failed:', errorMessage(err));
		}
	}

	function handleVisibility() {
		if (document.visibilityState !== 'visible' || initializing) return;
		updateTimerDisplay();
		scheduleResync();
	}

	async function handleNannyChange() {
		try {
			await Promise.all([checkCurrentEntry(), loadWeekData(), loadPayments()]);
		} catch (err) {
			toast.error('Error loading data: ' + errorMessage(err));
		}
	}

	$: filteredEntries = entries.filter((e) => e.clock_out);
	$: weekTotal = filteredEntries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);
	$: selectedNanny = nannies.find((n) => n.id === selectedNannyId) || profile;
	$: weekPay = weekTotal * (selectedNanny?.hourly_rate || 20);
	// The payment record for the week being viewed, if one exists
	$: currentWeekPayment = currentWeekStart
		? payments.find((p) => p.week_start === localDateString(currentWeekStart)) || null
		: null;

	async function checkCurrentEntry() {
		if (!selectedNannyId) return;

		// Tokens drop responses that arrive after a newer request or a nanny
		// switch, so rapid interactions can't apply stale data.
		const token = ++entryLoadToken;
		const nannyId = selectedNannyId;

		const { data, error } = await supabase
			.from('time_entries')
			.select('*')
			.eq('nanny_id', nannyId)
			.is('clock_out', null)
			.order('clock_in', { ascending: false })
			.limit(1)
			.maybeSingle();

		if (error) throw error;
		if (token !== entryLoadToken || nannyId !== selectedNannyId) return;

		if (data) {
			currentEntry = data;
			startTimer();
		} else {
			currentEntry = null;
			stopTimer();
		}
	}

	async function loadWeekData(quiet = false) {
		if (!selectedNannyId) return;

		const token = ++weekLoadToken;
		const nannyId = selectedNannyId;
		if (!quiet) weekLoading = true;

		try {
			const bounds = getWeekBounds(currentWeekOffset);
			currentWeekStart = bounds.start;
			currentWeekEnd = bounds.end;

			const { data, error } = await supabase
				.from('time_entries')
				.select('*')
				.eq('nanny_id', nannyId)
				.gte('clock_in', bounds.start.toISOString())
				.lte('clock_in', bounds.end.toISOString())
				.order('clock_in', { ascending: false });

			if (error) throw error;
			if (token !== weekLoadToken || nannyId !== selectedNannyId) return;

			entries = data || [];
		} finally {
			if (token === weekLoadToken) weekLoading = false;
		}
	}

	async function loadPayments() {
		if (!selectedNannyId) return;

		const token = ++paymentsLoadToken;
		const nannyId = selectedNannyId;

		const { data, error } = await supabase
			.from('payments')
			.select('*')
			.eq('nanny_id', nannyId)
			.order('week_start', { ascending: false })
			.limit(20);

		if (error) throw error;
		if (token !== paymentsLoadToken || nannyId !== selectedNannyId) return;

		payments = data || [];
	}

	function changeWeek(direction) {
		currentWeekOffset += direction;
		loadWeekData().catch((err) => {
			toast.error('Error loading week: ' + errorMessage(err));
		});
	}

	function updateTimerDisplay() {
		if (!currentEntry) return;
		timerDisplay = formatDuration(Date.now() - new Date(currentEntry.clock_in).getTime());
	}

	function startTimer() {
		if (timerInterval) clearInterval(timerInterval);
		updateTimerDisplay();
		timerInterval = setInterval(updateTimerDisplay, 1000);
	}

	function stopTimer() {
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = null;
		}
		timerDisplay = '00:00:00';
	}

	async function clockIn() {
		if (!selectedNannyId) {
			toast.error('Please select a nanny');
			return;
		}

		if (profile?.role !== 'nanny' && selectedNannyId === user.id) {
			toast.error('You cannot clock yourself in. Please select a nanny.');
			return;
		}

		showClockInConfirm = true;
		clockInTime = localTimeString();
	}

	async function confirmClockIn() {
		if (clockingIn) return;
		clockingIn = true;

		try {
			const { data: activeEntry } = await supabase
				.from('time_entries')
				.select('*, profiles!time_entries_nanny_id_fkey(full_name)')
				.is('clock_out', null)
				.limit(1)
				.maybeSingle();

			if (activeEntry) {
				toast.error(
					`${activeEntry.profiles?.full_name || 'Another nanny'} is already clocked in. Only one nanny can be on the clock at a time.`
				);
				showClockInConfirm = false;
				return;
			}

			const clockInDateTime = combineLocalDateTime(localDateString(), clockInTime);

			if (clockInDateTime.getTime() > Date.now() + 60 * 1000) {
				toast.error("Clock-in time can't be in the future");
				return;
			}

			const { data, error } = await supabase
				.from('time_entries')
				.insert({
					nanny_id: selectedNannyId,
					clock_in: clockInDateTime.toISOString()
				})
				.select()
				.single();

			if (error) throw error;

			currentEntry = data;
			startTimer();
			showClockInConfirm = false;
		} catch (err) {
			if (/** @type {any} */ (err).code === '23505') {
				// Unique index one_open_shift_per_nanny: an open shift already exists
				toast.error('This nanny is already clocked in.');
				showClockInConfirm = false;
				await checkCurrentEntry().catch(() => {});
			} else {
				toast.error('Error clocking in: ' + errorMessage(err));
			}
		} finally {
			clockingIn = false;
		}
	}

	// Replace an entry in the week table (or remove it) without a refetch.
	/** @param {any} row */
	function mergeEntry(row) {
		if (!row) return;

		const rest = entries.filter((e) => e.id !== row.id);
		const inViewedWeek =
			row.nanny_id === selectedNannyId &&
			currentWeekStart &&
			currentWeekEnd &&
			new Date(row.clock_in) >= currentWeekStart &&
			new Date(row.clock_in) <= currentWeekEnd;

		if (!inViewedWeek) {
			entries = rest;
			return;
		}

		entries = [...rest, row].sort(
			(a, b) => new Date(b.clock_in).getTime() - new Date(a.clock_in).getTime()
		);
	}

	/** @param {Date} endTime */
	async function performClockOut(endTime) {
		if (clockingOut) return false;
		clockingOut = true;

		try {
			// Fetch ALL open shifts for this nanny. Duplicates can exist (e.g. from
			// a double-tapped clock-in), and a single-row query errors on them.
			const { data: openEntries, error: fetchError } = await supabase
				.from('time_entries')
				.select('*')
				.eq('nanny_id', selectedNannyId)
				.is('clock_out', null)
				.order('clock_in', { ascending: false });

			if (fetchError) throw fetchError;

			if (!openEntries || openEntries.length === 0) {
				toast.error('No active shift found for this nanny');
				return false;
			}

			// The newest open entry is the shift the timer displays; any older open
			// entries are stray duplicates. Close the strays first with 0 hours so
			// they can't inflate the week total or block future clock-ins — if that
			// fails, the real shift is still open and clock-out can be retried.
			const [activeEntry, ...staleEntries] = openEntries;

			for (const stale of staleEntries) {
				const { error: staleError } = await supabase
					.from('time_entries')
					.update({
						clock_out: stale.clock_in,
						hours: '0.00'
					})
					.eq('id', stale.id);

				if (staleError) throw staleError;
			}

			const hours = hoursBetween(new Date(activeEntry.clock_in), endTime);

			const { data: closedRow, error: updateError } = await supabase
				.from('time_entries')
				.update({
					clock_out: endTime.toISOString(),
					hours: hours.toFixed(2)
				})
				.eq('id', activeEntry.id)
				.select()
				.single();

			if (updateError) throw updateError;

			toast.success(`Clocked out! Worked ${hours.toFixed(2)} hours`);

			currentEntry = null;
			stopTimer();
			mergeEntry(closedRow);
			return true;
		} catch (err) {
			toast.error('Error clocking out: ' + errorMessage(err));
			return false;
		} finally {
			clockingOut = false;
		}
	}

	function clockOut() {
		if (!currentEntry) return;
		clockOutTime = localTimeString();
		showClockOutConfirm = true;
	}

	async function confirmClockOut() {
		if (!currentEntry) return;

		const end = combineLocalDateTime(localDateString(), clockOutTime);
		const start = new Date(currentEntry.clock_in);

		if (end.getTime() <= start.getTime()) {
			toast.error(`End time must be after clock-in (${formatTime(currentEntry.clock_in)})`);
			return;
		}

		if (end.getTime() > Date.now() + 60 * 1000) {
			toast.error("Clock-out time can't be in the future");
			return;
		}

		const ok = await performClockOut(end);
		if (ok) showClockOutConfirm = false;
	}

	/** @param {KeyboardEvent} event */
	function handleModalKeydown(event) {
		if (event.key !== 'Escape') return;
		if (showClockOutConfirm) showClockOutConfirm = false;
		else if (showClockInConfirm) showClockInConfirm = false;
		else if (showManualEntry) showManualEntry = false;
	}

	async function generateVenmoPayment() {
		if (generatingPayment) return;

		if (weekTotal === 0) {
			toast.error('No completed hours for this week');
			return;
		}

		const nanny = selectedNanny;
		const recipient = normalizeVenmoHandle(nanny?.venmo_username);

		if (!recipient) {
			toast.error(
				`${nanny?.full_name || 'This nanny'} has no Venmo username set. Add it in Settings.`
			);
			return;
		}

		generatingPayment = true;

		try {
			// Record (or refresh) the payment row BEFORE any Venmo handoff, so the
			// bookkeeping never depends on what happens inside Venmo and behaves
			// identically on mobile and desktop.
			const { row, status } = await ensureWeekPaymentRecord();

			if (status === 'already-paid') {
				const proceed = await confirmModal.show({
					title: 'Already Paid',
					message: `This week is already marked paid${row.paid_date ? ' on ' + formatDate(row.paid_date) : ''}. Open Venmo again anyway?`,
					confirmText: 'Open Venmo'
				});
				if (!proceed) return;
			} else if (status === 'created') {
				toast.success('Payment recorded for this week — mark it paid once sent');
			} else {
				toast.success('Payment record updated with the latest hours');
			}

			const rate = nanny?.hourly_rate || 20;
			const note = buildVenmoNote({
				direction: 'pay',
				name: nanny?.full_name || 'nanny',
				weekStart: currentWeekStart,
				hours: weekTotal,
				rate,
				total: weekPay
			});

			if (isMobileDevice()) {
				const confirmed = await confirmModal.show({
					title: 'Venmo Payment',
					message: `Pay $${weekPay.toFixed(2)} to @${recipient} via Venmo?`,
					confirmText: 'Pay'
				});
				if (confirmed) {
					window.location.href = buildVenmoLink({ txn: 'pay', recipient, amount: weekPay, note });
				}
			} else {
				try {
					await navigator.clipboard.writeText(note);
					toast.success('Payment details copied to clipboard!');
				} catch {
					toast.info('Payment details: ' + note, 10000);
				}
			}
		} catch (err) {
			toast.error('Error preparing payment: ' + errorMessage(err));
		} finally {
			generatingPayment = false;
		}
	}

	/** @param {any} row */
	function mergePayment(row) {
		if (!row) return;
		const rest = payments.filter((p) => p.id !== row.id);
		payments = [...rest, row].sort((a, b) =>
			String(b.week_start).localeCompare(String(a.week_start))
		);
	}

	// One payment row per nanny per week: update the existing row when there is
	// one, insert otherwise. Never silently touches a row that is already paid.
	async function ensureWeekPaymentRecord() {
		const weekStartStr = localDateString(currentWeekStart);
		const weekEndStr = localDateString(currentWeekEnd);
		const roundedHours = Math.round(weekTotal * 100) / 100;
		const roundedAmount = Math.round(weekPay * 100) / 100;

		// Fresh fetch (not the cached list) so a row created on another device
		// moments ago is still found.
		const { data: existing, error: fetchError } = await supabase
			.from('payments')
			.select('*')
			.eq('nanny_id', selectedNannyId)
			.eq('week_start', weekStartStr)
			.maybeSingle();

		if (fetchError) throw fetchError;

		if (existing && existing.is_paid) {
			mergePayment(existing);
			return { row: existing, status: 'already-paid' };
		}

		if (existing) {
			const { data, error } = await supabase
				.from('payments')
				.update({
					hours: roundedHours,
					amount: roundedAmount,
					week_end: weekEndStr
				})
				.eq('id', existing.id)
				.select()
				.single();

			if (error) throw error;
			mergePayment(data);
			return { row: data, status: 'updated' };
		}

		const { data, error } = await supabase
			.from('payments')
			.insert({
				nanny_id: selectedNannyId,
				week_start: weekStartStr,
				week_end: weekEndStr,
				hours: roundedHours,
				amount: roundedAmount,
				is_paid: false,
				payment_method: 'Venmo'
			})
			.select()
			.single();

		if (error) {
			if (/** @type {any} */ (error).code === '23505') {
				// Unique index one_payment_per_nanny_week: lost a race with another
				// device — use the row that won.
				const { data: raced, error: racedError } = await supabase
					.from('payments')
					.select('*')
					.eq('nanny_id', selectedNannyId)
					.eq('week_start', weekStartStr)
					.maybeSingle();

				if (racedError) throw racedError;
				if (raced) {
					mergePayment(raced);
					return { row: raced, status: 'updated' };
				}
			}
			throw error;
		}

		mergePayment(data);
		return { row: data, status: 'created' };
	}

	// Flip paid state optimistically, then confirm with the returned row —
	// reverting (with a toast) if the update fails.
	/**
	 * @param {string | number} paymentId
	 * @param {{ is_paid: boolean, paid_date: string | null }} patch
	 */
	async function setPaidState(paymentId, patch) {
		if (paymentBusyId) return;
		paymentBusyId = paymentId;

		const previous = payments;
		payments = payments.map((p) => (p.id === paymentId ? { ...p, ...patch } : p));

		try {
			const { data, error } = await supabase
				.from('payments')
				.update(patch)
				.eq('id', paymentId)
				.select()
				.single();

			if (error) throw error;

			payments = payments.map((p) => (p.id === paymentId ? data : p));
		} catch (err) {
			payments = previous;
			toast.error('Error updating payment: ' + errorMessage(err));
		} finally {
			paymentBusyId = null;
		}
	}

	/** @param {string | number} paymentId */
	function markPaid(paymentId) {
		setPaidState(paymentId, { is_paid: true, paid_date: new Date().toISOString() });
	}

	/** @param {string | number} paymentId */
	function markUnpaid(paymentId) {
		setPaidState(paymentId, { is_paid: false, paid_date: null });
	}

	function exportCSV() {
		const rate = selectedNanny?.hourly_rate || 20;

		downloadCsv(
			timesheetFilename({
				nannyName: selectedNanny?.full_name,
				weekStart: currentWeekStart,
				weekEnd: currentWeekEnd
			}),
			buildTimesheetCsv(filteredEntries, () => rate)
		);
	}

	function getSelectedNannyName() {
		if (profile?.role === 'nanny') return 'You';
		return nannies.find((n) => n.id === selectedNannyId)?.full_name || 'Select a nanny';
	}

	/** @param {string | number} paymentId */
	async function deletePayment(paymentId) {
		const confirmed = await confirmModal.show({
			title: 'Delete Payment',
			message: 'Delete this payment record? This cannot be undone.',
			confirmText: 'Delete',
			danger: true
		});
		if (!confirmed) {
			return;
		}

		if (paymentBusyId) return;
		paymentBusyId = paymentId;

		try {
			const { error } = await supabase.from('payments').delete().eq('id', paymentId);

			if (error) throw error;

			payments = payments.filter((p) => p.id !== paymentId);
			toast.success('Payment record deleted');
		} catch (err) {
			toast.error('Error deleting payment: ' + errorMessage(err));
		} finally {
			paymentBusyId = null;
		}
	}

	async function requestPayment() {
		if (generatingPayment) return;

		if (weekTotal === 0) {
			toast.error('No completed hours for this week');
			return;
		}

		const requester = normalizeVenmoHandle(profile?.venmo_username);

		if (!requester) {
			toast.error('Please add your Venmo username in Settings first');
			goto('/settings');
			return;
		}

		generatingPayment = true;

		try {
			const { data: familyMembers, error } = await supabase
				.from('profiles')
				.select('*')
				.eq('role', 'family')
				.not('venmo_username', 'is', null)
				.order('full_name');

			if (error) throw error;

			const target = (familyMembers || [])
				.map((m) => normalizeVenmoHandle(m.venmo_username))
				.find((h) => h);

			if (!target) {
				toast.error('No family member has a Venmo username set. Ask them to add it in Settings.');
				return;
			}

			const rate = profile?.hourly_rate || 20;
			const note = buildVenmoNote({
				direction: 'request',
				name: profile?.full_name || 'nanny',
				weekStart: currentWeekStart,
				hours: weekTotal,
				rate,
				total: weekPay
			});

			if (isMobileDevice()) {
				const confirmed = await confirmModal.show({
					title: 'Request Payment',
					message: `Request $${weekPay.toFixed(2)} from @${target} via Venmo?`,
					confirmText: 'Request'
				});
				if (confirmed) {
					window.location.href = buildVenmoLink({
						txn: 'charge',
						recipient: target,
						amount: weekPay,
						note
					});
				}
			} else {
				try {
					await navigator.clipboard.writeText(note);
					toast.success('Payment request details copied to clipboard!');
				} catch {
					toast.info('Payment request: ' + note, 10000);
				}
			}
		} catch (err) {
			toast.error('Error preparing request: ' + errorMessage(err));
		} finally {
			generatingPayment = false;
		}
	}

	function openManualEntry() {
		editingEntry = null;
		manualEntryForm = {
			date: localDateString(),
			clockIn: '09:00',
			clockOut: '17:00',
			notes: ''
		};
		showManualEntry = true;
	}

	function editEntry(entry) {
		editingEntry = entry;
		manualEntryForm = {
			date: localDateString(new Date(entry.clock_in)),
			clockIn: localTimeString(new Date(entry.clock_in)),
			clockOut: entry.clock_out ? localTimeString(new Date(entry.clock_out)) : '17:00',
			notes: entry.notes || ''
		};
		showManualEntry = true;
	}

	async function saveManualEntry() {
		if (saving) return;

		const clockIn = combineLocalDateTime(manualEntryForm.date, manualEntryForm.clockIn);
		let clockOut = combineLocalDateTime(manualEntryForm.date, manualEntryForm.clockOut);
		let overnight = false;

		if (clockOut.getTime() === clockIn.getTime()) {
			toast.error('Clock out must be after clock in');
			return;
		}

		// An end time before the start means the shift crossed midnight
		if (clockOut.getTime() < clockIn.getTime()) {
			clockOut = new Date(clockOut.getTime() + 24 * 60 * 60 * 1000);
			overnight = true;
		}

		const hours = hoursBetween(clockIn, clockOut);

		saving = true;

		try {
			let savedRow;
			if (editingEntry) {
				const { data, error } = await supabase
					.from('time_entries')
					.update({
						clock_in: clockIn.toISOString(),
						clock_out: clockOut.toISOString(),
						hours: hours.toFixed(2),
						notes: manualEntryForm.notes
					})
					.eq('id', editingEntry.id)
					.select()
					.single();

				if (error) throw error;
				savedRow = data;
			} else {
				const { data, error } = await supabase
					.from('time_entries')
					.insert({
						nanny_id: selectedNannyId,
						clock_in: clockIn.toISOString(),
						clock_out: clockOut.toISOString(),
						hours: hours.toFixed(2),
						notes: manualEntryForm.notes
					})
					.select()
					.single();

				if (error) throw error;
				savedRow = data;
			}

			showManualEntry = false;
			mergeEntry(savedRow);

			// Jump to the saved entry's week so it never silently disappears
			const targetOffset = weekOffsetFor(new Date(savedRow.clock_in));
			if (targetOffset !== currentWeekOffset) {
				currentWeekOffset = targetOffset;
				loadWeekData().catch(() => {});
				toast.success(`Entry saved — showing week of ${formatDateShort(savedRow.clock_in)}`);
			} else {
				toast.success(overnight ? 'Saved overnight entry ending the next day' : 'Entry saved!');
			}
		} catch (err) {
			toast.error('Error: ' + errorMessage(err));
		} finally {
			saving = false;
		}
	}

	/** @param {string | number} entryId */
	async function deleteEntry(entryId) {
		const confirmed = await confirmModal.show({
			title: 'Delete Entry',
			message: 'Delete this entry?',
			confirmText: 'Delete',
			danger: true
		});
		if (!confirmed) return;

		try {
			const { error } = await supabase.from('time_entries').delete().eq('id', entryId);

			if (error) throw error;

			entries = entries.filter((e) => e.id !== entryId);
			toast.success('Entry deleted');
		} catch (err) {
			toast.error('Error deleting: ' + errorMessage(err));
		}
	}
</script>

<svelte:document on:visibilitychange={handleVisibility} />
<svelte:window on:focus={handleVisibility} on:keydown={handleModalKeydown} />

<Nav currentPage="tracker" />

<div class="container">
	{#if initializing}
		<Skeleton variant="card" count={2} />
	{:else if initError}
		<div class="card arcana">
			<EmptyState icon="warning" title="The hourglass is stuck" hint={initError}>
				<button class="btn btn-primary" on:click={initTracker}>
					<Icon name="star" size={16} /> Try again
				</button>
			</EmptyState>
		</div>
	{:else}
		<!-- ── Who are we counting for? ─────────────────────── -->
		{#if (profile?.role === 'family' || profile?.role === 'admin') && nannies.length > 0}
			<div class="nanny-selector">
				<label for="who">Counting hours for</label>
				<select id="who" bind:value={selectedNannyId} on:change={handleNannyChange}>
					{#each nannies as nanny (nanny.id)}
						<option value={nanny.id}>{nanny.full_name}</option>
					{/each}
				</select>
			</div>
		{/if}

		<!-- ── The hourglass ────────────────────────────────── -->
		<div class="card arcana">
			<div class="timer-card" class:running={currentEntry}>
				<div class="timer-glyph" aria-hidden="true">
					<Icon name={currentEntry ? 'hourglass' : 'candle'} size={48} />
				</div>

				<span class="badge" class:badge-live={currentEntry}>
					{#if currentEntry}<span class="live-dot"></span>{/if}
					{currentEntry ? 'Current shift' : 'Not clocked in'}
				</span>

				<p class="timer" class:active={currentEntry}>{timerDisplay}</p>

				<p class="timer-info">
					{currentEntry
						? `Clocked in at ${formatTime(currentEntry.clock_in)}`
						: 'The hours are yours to begin'}
				</p>

				<div class="button-container">
					{#if currentEntry}
						<button class="btn btn-danger btn-large" on:click={clockOut} disabled={clockingOut}>
							<Icon name="close" size={16} />
							{clockingOut ? 'Clocking out…' : 'Clock out'}
						</button>
					{:else}
						<button
							class="btn btn-success btn-large"
							on:click={clockIn}
							disabled={clockingIn || !selectedNannyId}
						>
							<Icon name="sprout" size={16} />
							{clockingIn ? 'Clocking in…' : 'Clock in'}
						</button>
					{/if}
				</div>
			</div>

			<div class="quick-actions">
				<button class="btn btn-secondary btn-small" on:click={() => goto('/dashboard')}>
					<Icon name="cottage" size={16} /> Hearth
				</button>
				{#if profile?.role === 'family' || profile?.role === 'admin'}
					<button class="btn btn-secondary btn-small" on:click={openManualEntry}>
						<Icon name="quill" size={16} /> Manual entry
					</button>
				{/if}
				<button class="btn btn-secondary btn-small" on:click={exportCSV}>
					<Icon name="download" size={16} /> Export
				</button>
			</div>
		</div>

		<!-- ── The week ─────────────────────────────────────── -->
		<div class="card arcana">
			<div class="card-header">
				<h2>The Week</h2>
				<div class="week-nav">
					<button class="icon-btn" on:click={() => changeWeek(-1)} aria-label="Previous week">
						<Icon name="chevron-left" size={16} />
					</button>
					<span class="week-label">
						{currentWeekStart && currentWeekEnd
							? formatWeekDisplay(currentWeekStart, currentWeekEnd)
							: 'Loading…'}
						{#if weekLoading}<span class="week-updating">updating…</span>{/if}
					</span>
					<button class="icon-btn" on:click={() => changeWeek(1)} aria-label="Next week">
						<Icon name="chevron-right" size={16} />
					</button>
				</div>
			</div>

			<div class="mobile-view-toggle mobile-only">
				<button class:active={mobileView === 'summary'} on:click={() => (mobileView = 'summary')}>
					Summary
				</button>
				<button class:active={mobileView === 'details'} on:click={() => (mobileView = 'details')}>
					Details
				</button>
			</div>

			{#if filteredEntries.length === 0}
				<EmptyState
					icon="moon"
					title="A quiet week"
					hint="No hours recorded between these two moons."
				/>
			{:else}
				<!-- Desktop ledger -->
				<div class="desktop-table desktop-only" class:refreshing={weekLoading}>
					<table>
						<thead>
							<tr>
								<th>Date</th>
								<th>In</th>
								<th>Out</th>
								<th>Hours</th>
								<th>Earnings</th>
								<th>Notes</th>
								{#if profile?.role === 'family' || profile?.role === 'admin'}<th></th>{/if}
							</tr>
						</thead>
						<tbody>
							{#each filteredEntries as entry (entry.id)}
								<tr>
									<td>{formatDate(entry.clock_in)}</td>
									<td>{formatTime(entry.clock_in)}</td>
									<td>{formatTime(entry.clock_out)}</td>
									<td class="num">{(parseFloat(entry.hours) || 0).toFixed(1)}</td>
									<td class="num gilt-text">
										${((parseFloat(entry.hours) || 0) * (selectedNanny?.hourly_rate || 20)).toFixed(
											2
										)}
									</td>
									<td class="notes">{entry.notes || '—'}</td>
									{#if profile?.role === 'family' || profile?.role === 'admin'}
										<td class="row-actions">
											<button
												class="icon-btn"
												on:click={() => editEntry(entry)}
												aria-label="Edit entry"
											>
												<Icon name="quill" size={16} />
											</button>
											<button
												class="icon-btn danger"
												on:click={() => deleteEntry(entry.id)}
												aria-label="Delete entry"
											>
												<Icon name="urn" size={16} />
											</button>
										</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- Mobile ledger -->
				<div class="mobile-only" class:refreshing={weekLoading}>
					{#if mobileView === 'summary'}
						<div class="entry-list">
							{#each filteredEntries as entry (entry.id)}
								<div class="entry-card">
									<div class="entry-top">
										<span class="entry-date">{formatDateShort(entry.clock_in)}</span>
										<span class="entry-hours">{(parseFloat(entry.hours) || 0).toFixed(1)}h</span>
									</div>
									<div class="entry-time">
										{formatTime(entry.clock_in)} – {formatTime(entry.clock_out)}
									</div>
									<div class="entry-bottom">
										<span class="entry-earnings">
											${(
												(parseFloat(entry.hours) || 0) * (selectedNanny?.hourly_rate || 20)
											).toFixed(2)}
										</span>
										{#if profile?.role === 'family' || profile?.role === 'admin'}
											<span class="entry-actions">
												<button
													class="icon-btn"
													on:click={() => editEntry(entry)}
													aria-label="Edit"
												>
													<Icon name="quill" size={16} />
												</button>
												<button
													class="icon-btn danger"
													on:click={() => deleteEntry(entry.id)}
													aria-label="Delete"
												>
													<Icon name="urn" size={16} />
												</button>
											</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div class="entry-list">
							{#each filteredEntries as entry (entry.id)}
								<div class="entry-card">
									<div class="detail-row">
										<span>Date</span><span>{formatDate(entry.clock_in)}</span>
									</div>
									<div class="detail-row">
										<span>In / out</span>
										<span>{formatTime(entry.clock_in)} – {formatTime(entry.clock_out)}</span>
									</div>
									<div class="detail-row">
										<span>Hours</span><span>{(parseFloat(entry.hours) || 0).toFixed(1)}</span>
									</div>
									<div class="detail-row">
										<span>Earnings</span>
										<span class="gilt-text">
											${(
												(parseFloat(entry.hours) || 0) * (selectedNanny?.hourly_rate || 20)
											).toFixed(2)}
										</span>
									</div>
									{#if entry.notes}
										<div class="detail-row"><span>Notes</span><span>{entry.notes}</span></div>
									{/if}
									{#if profile?.role === 'family' || profile?.role === 'admin'}
										<div class="entry-actions">
											<button class="btn-small" on:click={() => editEntry(entry)}>
												<Icon name="quill" size={16} /> Edit
											</button>
											<button class="btn-small danger" on:click={() => deleteEntry(entry.id)}>
												<Icon name="urn" size={16} /> Delete
											</button>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Week total -->
				<div class="week-total">
					<div class="total-figures">
						<span class="total-label">Owed this week</span>
						<span class="total-value">${weekPay.toFixed(2)}</span>
						<span class="total-hours">{weekTotal.toFixed(1)} hours</span>
					</div>

					<div class="total-tail">
						{#if currentWeekPayment}
							<span
								class="badge"
								class:badge-live={currentWeekPayment.is_paid}
								class:badge-danger={!currentWeekPayment.is_paid}
							>
								{currentWeekPayment.is_paid
									? 'Paid' +
										(currentWeekPayment.paid_date
											? ' ' + formatDateShort(currentWeekPayment.paid_date)
											: '')
									: 'Recorded — unpaid'}
							</span>
						{:else}
							<span class="badge">Not recorded</span>
						{/if}

						{#if profile?.role === 'family' || profile?.role === 'admin'}
							<button
								class="btn btn-primary"
								on:click={generateVenmoPayment}
								disabled={generatingPayment}
							>
								<Icon name="coin" size={16} />
								{generatingPayment
									? 'Preparing…'
									: !currentWeekPayment
										? 'Send via Venmo'
										: currentWeekPayment.is_paid
											? 'Regenerate'
											: 'Update & pay'}
							</button>
						{:else if profile?.role === 'nanny'}
							<button
								class="btn btn-primary"
								on:click={requestPayment}
								disabled={generatingPayment}
							>
								<Icon name="coin" size={16} />
								{generatingPayment ? 'Preparing…' : 'Request payment'}
							</button>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- ── Payments ─────────────────────────────────────── -->
		<div class="card arcana">
			<h2>The Purse</h2>

			{#if payments.length === 0}
				<EmptyState
					icon="coin"
					title="The purse is empty"
					hint="Payments appear here once a week has been settled."
				/>
			{:else}
				<div class="desktop-table desktop-only">
					<table>
						<thead>
							<tr>
								<th>Week</th>
								<th>Status</th>
								<th>Hours</th>
								<th>Amount</th>
								<th>Paid</th>
								<th>Method</th>
								{#if profile?.role === 'family' || profile?.role === 'admin'}<th></th>{/if}
							</tr>
						</thead>
						<tbody>
							{#each payments as payment (payment.id)}
								<tr>
									<td>{formatDate(payment.week_start)} – {formatDate(payment.week_end)}</td>
									<td>
										<span
											class="badge"
											class:badge-live={payment.is_paid}
											class:badge-danger={!payment.is_paid}
										>
											{payment.is_paid ? 'Paid' : 'Unpaid'}
										</span>
									</td>
									<td class="num">{payment.hours?.toFixed(1) || 0}</td>
									<td class="num gilt-text">${payment.amount?.toFixed(2) || 0}</td>
									<td>{payment.paid_date ? formatDate(payment.paid_date) : '—'}</td>
									<td>{payment.payment_method || 'Venmo'}</td>
									{#if profile?.role === 'family' || profile?.role === 'admin'}
										<td class="row-actions">
											{#if payment.is_paid}
												<button
													class="btn-small"
													on:click={() => markUnpaid(payment.id)}
													disabled={paymentBusyId === payment.id}
												>
													Mark unpaid
												</button>
											{:else}
												<button
													class="btn-small growing"
													on:click={() => markPaid(payment.id)}
													disabled={paymentBusyId === payment.id}
												>
													<Icon name="check" size={16} /> Paid
												</button>
											{/if}
											<button
												class="icon-btn danger"
												on:click={() => deletePayment(payment.id)}
												disabled={paymentBusyId === payment.id}
												aria-label="Delete payment"
											>
												<Icon name="urn" size={16} />
											</button>
										</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<div class="mobile-only entry-list">
					{#each payments as payment (payment.id)}
						<div class="entry-card" class:settled={payment.is_paid}>
							<div class="entry-top">
								<span class="entry-date">
									{formatDateShort(payment.week_start)} – {formatDateShort(payment.week_end)}
								</span>
								<span
									class="badge"
									class:badge-live={payment.is_paid}
									class:badge-danger={!payment.is_paid}
								>
									{payment.is_paid ? 'Paid' : 'Unpaid'}
								</span>
							</div>
							<div class="entry-bottom">
								<span class="entry-earnings">${payment.amount?.toFixed(2) || 0}</span>
								<span class="entry-time">{payment.hours?.toFixed(1) || 0}h</span>
							</div>
							{#if profile?.role === 'family' || profile?.role === 'admin'}
								<div class="entry-actions">
									{#if payment.is_paid}
										<button
											class="btn-small"
											on:click={() => markUnpaid(payment.id)}
											disabled={paymentBusyId === payment.id}
										>
											Mark unpaid
										</button>
									{:else}
										<button
											class="btn-small growing"
											on:click={() => markPaid(payment.id)}
											disabled={paymentBusyId === payment.id}
										>
											<Icon name="check" size={16} /> Mark paid
										</button>
									{/if}
									<button
										class="icon-btn danger"
										on:click={() => deletePayment(payment.id)}
										disabled={paymentBusyId === payment.id}
										aria-label="Delete payment"
									>
										<Icon name="urn" size={16} />
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

<!-- ── Clock in ───────────────────────────────────────── -->
{#if showClockInConfirm}
	<div class="modal-overlay" on:click={() => (showClockInConfirm = false)} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>Begin the shift</h2>
			<p class="modal-lede">Clocking in <strong>{getSelectedNannyName()}</strong></p>

			<div class="form-group">
				<label for="cit">Clock in time</label>
				<input id="cit" type="time" bind:value={clockInTime} />
				<small>Adjust if they started earlier or later.</small>
			</div>

			<div class="button-row">
				<button class="btn btn-success" on:click={confirmClockIn} disabled={clockingIn}>
					<Icon name="sprout" size={16} />
					{clockingIn ? 'Clocking in…' : 'Confirm'}
				</button>
				<button
					class="btn btn-secondary"
					on:click={() => (showClockInConfirm = false)}
					disabled={clockingIn}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ── Clock out ──────────────────────────────────────── -->
{#if showClockOutConfirm && currentEntry}
	<div class="modal-overlay" on:click={() => (showClockOutConfirm = false)} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>End the shift</h2>
			<p class="modal-lede">Clocking out <strong>{getSelectedNannyName()}</strong></p>
			<p class="modal-note">
				Started at {formatTime(currentEntry.clock_in)} · {timerDisplay} elapsed
			</p>

			<div class="form-group">
				<label for="cot">Clock out time</label>
				<input id="cot" type="time" bind:value={clockOutTime} />
				<small>Adjust if they actually finished earlier.</small>
			</div>

			<div class="button-row">
				<button class="btn btn-primary" on:click={confirmClockOut} disabled={clockingOut}>
					<Icon name="check" size={16} />
					{clockingOut ? 'Clocking out…' : 'Confirm'}
				</button>
				<button
					class="btn btn-secondary"
					on:click={() => (showClockOutConfirm = false)}
					disabled={clockingOut}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ── Manual entry ───────────────────────────────────── -->
{#if showManualEntry}
	<div class="modal-overlay" on:click={() => (showManualEntry = false)} role="presentation">
		<div class="modal-content" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>{editingEntry ? 'Amend an entry' : 'Write an entry'}</h2>

			<form on:submit|preventDefault={saveManualEntry}>
				<div class="form-group">
					<label for="med">Date</label>
					<input id="med" type="date" bind:value={manualEntryForm.date} required />
				</div>

				<div class="form-row">
					<div class="form-group">
						<label for="mei">Clock in</label>
						<input id="mei" type="time" bind:value={manualEntryForm.clockIn} required />
					</div>
					<div class="form-group">
						<label for="meo">Clock out</label>
						<input id="meo" type="time" bind:value={manualEntryForm.clockOut} required />
					</div>
				</div>

				<div class="form-group">
					<label for="men">Notes</label>
					<input id="men" type="text" bind:value={manualEntryForm.notes} placeholder="Optional" />
				</div>

				<div class="button-row">
					<button type="submit" class="btn btn-primary" disabled={saving}>
						<Icon name="quill" size={16} /> Save
					</button>
					<button
						type="button"
						class="btn btn-secondary"
						on:click={() => (showManualEntry = false)}
					>
						Cancel
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	/* ── Who ──────────────────────────────────────────────── */
	.nanny-selector {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		flex-wrap: wrap;
		margin-bottom: var(--section-gap);
		padding: 0.85rem 1.1rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--card-radius);
	}

	.nanny-selector label {
		margin: 0;
		white-space: nowrap;
	}

	.nanny-selector select {
		flex: 1;
		min-width: 180px;
	}

	/* ── The hourglass ────────────────────────────────────── */
	.timer-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: clamp(1.5rem, 6vw, 2.5rem) 1.25rem;
		text-align: center;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--card-radius);
		transition: all var(--transition-slow);
	}

	.timer-card.running {
		border-color: rgba(111, 191, 115, 0.4);
		background-image: radial-gradient(70% 90% at 50% 0%, var(--growing-dim), transparent 72%);
	}

	.timer-glyph {
		color: var(--text-faint);
		--icon-accent: var(--accent);
	}

	.timer-card.running .timer-glyph {
		color: var(--growing);
		--icon-accent: var(--growing);
		animation: flicker 4s ease-in-out infinite;
	}

	.timer {
		font-family: var(--font-pixel);
		font-size: clamp(2.4rem, 12vw, 4.2rem);
		font-weight: 600;
		line-height: 1;
		letter-spacing: 0.03em;
		color: var(--text-faint);
		margin: 0.35rem 0 0.15rem;
	}

	.timer.active {
		color: var(--growing);
		text-shadow: 0 0 30px var(--growing-dim);
	}

	.timer-info {
		font-size: 0.92rem;
		color: var(--text-muted);
		margin-bottom: 0.9rem;
	}

	.quick-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1.15rem;
	}

	/* ── Week nav ─────────────────────────────────────────── */
	.week-nav {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.week-label {
		font-family: var(--font-body);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.week-updating {
		margin-left: 0.4rem;
		color: var(--accent);
		text-transform: none;
		letter-spacing: normal;
		font-weight: 400;
		font-style: italic;
	}

	.mobile-view-toggle {
		display: flex;
		gap: 0.3rem;
		padding: 0.25rem;
		margin-bottom: 1rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
	}

	.mobile-view-toggle button {
		flex: 1;
		min-height: 38px;
		background: none;
		border: none;
		border-radius: 6px;
		color: var(--text-faint);
		font-family: var(--font-body);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.mobile-view-toggle button.active {
		background: var(--accent-dim);
		color: var(--accent-bright);
	}

	/* ── Table extras ─────────────────────────────────────── */
	.num {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: var(--text);
	}

	.notes {
		color: var(--text-faint);
		font-style: italic;
	}

	.row-actions {
		display: flex;
		gap: 0.35rem;
		align-items: center;
	}

	.icon-btn.danger:hover:not(:disabled),
	.btn-small.danger:hover:not(:disabled) {
		color: var(--danger);
		border-color: var(--danger);
		background: var(--danger-dim);
	}

	.btn-small.growing {
		color: var(--growing);
		border-color: rgba(111, 191, 115, 0.4);
		--icon-accent: var(--growing);
	}

	.btn-small.growing:hover:not(:disabled) {
		background: var(--growing-dim);
		border-color: var(--growing);
		color: var(--growing);
	}

	/* ── Mobile entry cards ───────────────────────────────── */
	.entry-list {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}

	.entry-card {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.9rem 1rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
	}

	.entry-card.settled {
		border-left: 2px solid var(--growing);
	}

	.entry-top,
	.entry-bottom {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.entry-date {
		font-family: var(--font-display);
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text);
	}

	.entry-hours,
	.entry-earnings {
		font-size: 1.05rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--accent-bright);
	}

	.entry-time {
		font-size: 0.88rem;
		color: var(--text-faint);
	}

	.detail-row {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-size: 0.9rem;
		color: var(--text-muted);
	}

	.detail-row span:first-child {
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.11em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.entry-actions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.3rem;
	}

	/* ── Week total ───────────────────────────────────────── */
	.week-total {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 1rem;
		margin-top: 1.25rem;
		padding-top: 1.15rem;
		border-top: 1px solid var(--border-gilt);
	}

	.total-figures {
		display: flex;
		flex-direction: column;
	}

	.total-label {
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.total-value {
		font-family: var(--font-pixel);
		font-size: clamp(1.6rem, 5vw, 2.1rem);
		font-weight: 600;
		line-height: 1.1;
		color: var(--accent-bright);
		text-shadow: 0 0 24px var(--accent-dim);
	}

	.total-hours {
		font-size: 0.85rem;
		color: var(--text-faint);
	}

	.total-tail {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		flex-wrap: wrap;
	}

	/* ── Modal extras ─────────────────────────────────────── */
	.modal-lede {
		color: var(--text-muted);
		margin-bottom: 0.4rem;
	}

	.modal-note {
		font-size: 0.88rem;
		color: var(--text-faint);
		margin-bottom: 1.15rem;
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	@media (max-width: 768px) {
		.quick-actions {
			flex-direction: row;
		}

		.quick-actions .btn {
			flex: 1;
			width: auto;
		}

		.week-total {
			flex-direction: column;
			align-items: stretch;
		}

		.total-tail {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
