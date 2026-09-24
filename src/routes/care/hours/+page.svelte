<script>
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from '$lib/stores/toast.js';
	import { confirm as confirmModal } from '$lib/stores/toast.js';
	import {
		localDateString,
		localTimeString,
		combineLocalDateTime,
		getWeekBounds,
		weekOffsetFor,
		hoursBetween,
		formatTime,
		formatDate,
		formatDateShort,
		formatWeekDisplay,
		parseLocalDate,
		nextDay
	} from '$lib/time.js';
	import { buildWeekLedger, weekPayStatus, LEDGER_WEEKS } from '$lib/ledger.js';
	import { formatMoney } from '$lib/money.js';
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

	/*
	 * Care → Hours & Pay: the week's hours, the Purse, and the long ledger
	 * the old History page kept. Clocking in and out lives on Care → Today.
	 */

	/** @type {any} */
	let user = null;
	/** @type {any} */
	let profile = null;
	/** @type {any[]} */
	let nannies = [];
	/** @type {string | null} */
	let selectedNannyId = null;
	let initializing = true;
	/** @type {string | null} */
	let initError = null;
	let weekLoading = false;
	let generatingPayment = false;
	/** @type {string | number | null} */
	let paymentBusyId = null;
	let weekLoadToken = 0;
	let paymentsLoadToken = 0;
	let ledgerLoadToken = 0;
	let allTimeLoadToken = 0;
	/** @type {ReturnType<typeof supabase.channel> | null} */
	let realtimeChannel = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let resyncTimer = null;
	/** @type {any[]} */
	let entries = [];
	/** @type {any[]} */
	let payments = [];
	// Completed entries for the last LEDGER_WEEKS weeks, summed per week in
	// the ledger so totals show whether or not a payment was recorded.
	/** @type {any[]} */
	let ledgerEntries = [];
	let ledgerSince = localDateString(getWeekBounds(-(LEDGER_WEEKS - 1)).start);
	// Every completed entry, for the all-time totals and export.
	/** @type {any[]} */
	let allEntries = [];
	/** @type {HTMLElement | null} */
	let weekCard = null;
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
	/** @type {string | null} 'YYYY-MM-DD' start of the week shown in The Week */
	let viewedWeekKey = null;

	// Mobile table view toggle
	let mobileView = 'summary'; // 'summary' or 'details'

	onMount(() => {
		initHours();
	});

	onDestroy(() => {
		if (resyncTimer) clearTimeout(resyncTimer);
		if (realtimeChannel) supabase.removeChannel(realtimeChannel);
	});

	async function initHours() {
		initializing = true;
		initError = null;

		try {
			const {
				data: { user: currentUser }
			} = await supabase.auth.getUser();

			if (!currentUser) {
				goto(resolve('/'));
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
					// A link from Accounts names the nanny (?nanny=<id>). Otherwise
					// open on whoever is on the clock, then the first by name.
					const asked = new URLSearchParams(window.location.search).get('nanny');
					const { data: openShift } = await supabase
						.from('time_entries')
						.select('nanny_id')
						.is('clock_out', null)
						.order('clock_in', { ascending: false })
						.limit(1)
						.maybeSingle();
					const onClock = openShift?.nanny_id;
					selectedNannyId =
						[asked, onClock].find((id) => id && nannies.some((n) => n.id === id)) || nannies[0].id;
				}
			} else if (profile?.role === 'nanny') {
				selectedNannyId = user.id;
			}

			await Promise.all([loadWeekData(), loadPayments(), loadLedger(), loadAllTime()]);

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
		// Unfiltered on purpose: DELETE events can't be filtered by non-key
		// columns at all. Relevance is checked client-side.
		realtimeChannel = supabase
			.channel('hours-live')
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
			await Promise.all([loadWeekData(true), loadPayments(), loadLedger(), loadAllTime()]);
		} catch (err) {
			// Background sync: keep showing the last good data
			console.warn('Hours resync failed:', errorMessage(err));
		}
	}

	function handleVisibility() {
		if (document.visibilityState !== 'visible' || initializing) return;
		scheduleResync();
	}

	async function handleNannyChange() {
		// Drop the previous nanny's rows first. Until the new loads land, the
		// pay buttons would otherwise record nanny A's hours under nanny B.
		entries = [];
		payments = [];
		ledgerEntries = [];
		allEntries = [];
		try {
			await Promise.all([loadWeekData(), loadPayments(), loadLedger(), loadAllTime()]);
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
	$: ledger = buildWeekLedger(
		ledgerEntries,
		payments,
		selectedNanny?.hourly_rate || 20,
		ledgerSince
	);
	// The long view the History page used to hold: every completed shift,
	// priced at the nanny's rate.
	$: allTimeHours = allEntries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);
	$: allTimePay = allTimeHours * (selectedNanny?.hourly_rate || 20);
	$: firstShift = allEntries.length > 0 ? allEntries[allEntries.length - 1].clock_in : null;

	async function loadWeekData(quiet = false) {
		if (!selectedNannyId) return;

		const token = ++weekLoadToken;
		const nannyId = selectedNannyId;
		if (!quiet) weekLoading = true;

		try {
			const bounds = getWeekBounds(currentWeekOffset);
			currentWeekStart = bounds.start;
			currentWeekEnd = bounds.end;
			viewedWeekKey = localDateString(bounds.start);

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
		} catch (err) {
			// Never leave last week's rows under this week's dates — the pay
			// buttons would bill them against the wrong week.
			if (token === weekLoadToken) entries = [];
			throw err;
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
			.limit(LEDGER_WEEKS + 14);

		if (error) throw error;
		if (token !== paymentsLoadToken || nannyId !== selectedNannyId) return;

		payments = data || [];
	}

	async function loadLedger() {
		if (!selectedNannyId) return;

		const token = ++ledgerLoadToken;
		const nannyId = selectedNannyId;
		const since = getWeekBounds(-(LEDGER_WEEKS - 1)).start;

		const { data, error } = await supabase
			.from('time_entries')
			.select('id, clock_in, hours')
			.eq('nanny_id', nannyId)
			.not('clock_out', 'is', null)
			.gte('clock_in', since.toISOString())
			.order('clock_in', { ascending: false });

		if (error) throw error;
		if (token !== ledgerLoadToken || nannyId !== selectedNannyId) return;

		ledgerSince = localDateString(since);
		ledgerEntries = data || [];
	}

	async function loadAllTime() {
		if (!selectedNannyId) return;

		const token = ++allTimeLoadToken;
		const nannyId = selectedNannyId;

		const { data, error } = await supabase
			.from('time_entries')
			.select('*')
			.eq('nanny_id', nannyId)
			.not('clock_out', 'is', null)
			.order('clock_in', { ascending: false });

		if (error) throw error;
		if (token !== allTimeLoadToken || nannyId !== selectedNannyId) return;

		allEntries = data || [];
	}

	// Entry edits change a week's total: refresh the ledger in the background.
	function refreshLedger() {
		Promise.all([loadLedger(), loadAllTime()]).catch((err) =>
			console.warn('Ledger refresh failed:', errorMessage(err))
		);
	}

	// Clicking a week in the ledger opens it in The Week card above.
	/** @param {string} weekStart 'YYYY-MM-DD' */
	function openWeek(weekStart) {
		const offset = weekOffsetFor(parseLocalDate(weekStart));
		if (offset !== currentWeekOffset) {
			currentWeekOffset = offset;
			loadWeekData().catch((err) => {
				toast.error('Error loading week: ' + errorMessage(err));
			});
		}
		weekCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	/** @param {number} direction */
	function changeWeek(direction) {
		currentWeekOffset += direction;
		loadWeekData().catch((err) => {
			toast.error('Error loading week: ' + errorMessage(err));
		});
	}

	// Replace an entry in the week table (or remove it) without a refetch.
	/** @param {any} row */
	function mergeEntry(row) {
		if (!row) return;
		refreshLedger();

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

	/** @param {KeyboardEvent} event */
	function handleModalKeydown(event) {
		if (event.key === 'Escape' && showManualEntry) showManualEntry = false;
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
				`${nanny?.full_name || 'This nanny'} has no Venmo username set. Add it in Settings → Accounts.`
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
					message: `Pay ${formatMoney(weekPay)} to @${recipient} via Venmo?`,
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
	 * @param {{ is_paid: boolean, paid_date: string | null, hours?: number, amount?: number }} patch
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

	/**
	 * Ask before a one-tap payment, naming the money — and warn when the week
	 * isn't over, since later hours will show as still owed.
	 * @param {{ weekStart: string, weekEnd: string, hours: number, amount: number }} week
	 * @param {number} [amount] what this tap records, when not the week's total
	 */
	function confirmWeekPaid(week, amount = week.amount) {
		const open = week.weekEnd >= localDateString();
		return confirmModal.show({
			title: 'Mark week paid',
			message:
				`Record ${formatMoney(amount)} paid for ${formatDateShort(week.weekStart)} – ` +
				`${formatDateShort(week.weekEnd)} (${week.hours.toFixed(2)} hours)?` +
				(open ? ' This week isn’t over — hours logged later will show as still owed.' : ''),
			confirmText: 'Mark paid'
		});
	}

	/**
	 * Mark a recorded week paid — or settle a short one. Writes the week's
	 * figures as they stand now, so the record matches the total shown beside
	 * the button rather than whatever was recorded before hours changed.
	 * @param {{ weekStart: string, weekEnd: string, hours: number, amount: number, payment: any }} week
	 */
	async function markPaid(week) {
		const { status, owed } = weekPayStatus(week);
		if (!(await confirmWeekPaid(week, status === 'short' ? owed : week.amount))) return;
		setPaidState(week.payment.id, {
			is_paid: true,
			paid_date: new Date().toISOString(),
			hours: Math.round(week.hours * 100) / 100,
			amount: Math.round(week.amount * 100) / 100
		});
	}

	/** @param {string | number} paymentId */
	function markUnpaid(paymentId) {
		setPaidState(paymentId, { is_paid: false, paid_date: null });
	}

	// A ledger week with hours but no payment record yet (paid outside the
	// app, or before anyone pressed pay): record it as paid in one step.
	/** @param {{ weekStart: string, weekEnd: string, hours: number, amount: number }} week */
	async function recordWeekAsPaid(week) {
		if (paymentBusyId) return;
		if (!(await confirmWeekPaid(week))) return;
		paymentBusyId = week.weekStart;

		const paid = {
			is_paid: true,
			paid_date: new Date().toISOString(),
			hours: Math.round(week.hours * 100) / 100,
			amount: Math.round(week.amount * 100) / 100
		};

		try {
			let { data, error } = await supabase
				.from('payments')
				.insert({
					nanny_id: selectedNannyId,
					week_start: week.weekStart,
					week_end: week.weekEnd,
					payment_method: 'Venmo',
					...paid
				})
				.select()
				.single();

			if (error && /** @type {any} */ (error).code === '23505') {
				// Unique index one_payment_per_nanny_week: another device recorded
				// this week first — mark that row paid instead.
				({ data, error } = await supabase
					.from('payments')
					.update(paid)
					.eq('nanny_id', selectedNannyId)
					.eq('week_start', week.weekStart)
					.select()
					.single());
			}

			if (error) throw error;
			mergePayment(data);
			toast.success('Week marked paid');
		} catch (err) {
			toast.error('Error recording payment: ' + errorMessage(err));
		} finally {
			paymentBusyId = null;
		}
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

	// Every completed shift, the export the History page used to offer.
	function exportAllCSV() {
		const rate = selectedNanny?.hourly_rate || 20;

		downloadCsv(
			timesheetFilename({ nannyName: selectedNanny?.full_name }),
			buildTimesheetCsv(allEntries, () => rate)
		);
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
			goto(resolve('/settings'));
			return;
		}

		generatingPayment = true;

		try {
			const { data: familyMembers, error } = await supabase
				.from('profiles')
				.select('*')
				.in('role', ['family', 'admin'])
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
					message: `Request ${formatMoney(weekPay)} from @${target} via Venmo?`,
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
			clockOut = nextDay(clockOut);
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
			refreshLedger();
			toast.success('Entry deleted');
		} catch (err) {
			toast.error('Error deleting: ' + errorMessage(err));
		}
	}
</script>

<svelte:document on:visibilitychange={handleVisibility} />
<svelte:window on:focus={handleVisibility} on:keydown={handleModalKeydown} />

<div class="container">
	{#if initializing}
		<Skeleton variant="card" count={2} />
	{:else if initError}
		<div class="card arcana">
			<EmptyState icon="warning" title="The hourglass is stuck" hint={initError}>
				<button class="btn btn-primary" on:click={initHours}>
					<Icon name="star" size={16} /> Try again
				</button>
			</EmptyState>
		</div>
	{:else}
		<div class="page-head">
			<div>
				<h1>Hours &amp; Pay</h1>
				<p class="lede">Every hour kept, every week settled.</p>
			</div>
			<div class="head-actions">
				{#if profile?.role === 'family' || profile?.role === 'admin'}
					<button class="btn btn-secondary btn-small" on:click={openManualEntry}>
						<Icon name="quill" size={16} /> Manual entry
					</button>
				{/if}
				<button class="btn btn-secondary btn-small" on:click={exportCSV}>
					<Icon name="download" size={16} /> Export week
				</button>
			</div>
		</div>

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

		<!-- ── The week ─────────────────────────────────────── -->
		<div class="card arcana week-card" bind:this={weekCard}>
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
										{formatMoney(
											(parseFloat(entry.hours) || 0) * (selectedNanny?.hourly_rate || 20)
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
											{formatMoney(
												(parseFloat(entry.hours) || 0) * (selectedNanny?.hourly_rate || 20)
											)}
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
											{formatMoney(
												(parseFloat(entry.hours) || 0) * (selectedNanny?.hourly_rate || 20)
											)}
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
						<span class="total-value">{formatMoney(weekPay)}</span>
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
								disabled={generatingPayment || weekLoading}
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
								disabled={generatingPayment || weekLoading}
							>
								<Icon name="coin" size={16} />
								{generatingPayment ? 'Preparing…' : 'Request payment'}
							</button>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- ── The ledger: every week's total, paid or not ──── -->
		<div class="card arcana">
			<h2>The Purse</h2>

			{#if ledger.length === 0}
				<EmptyState
					icon="coin"
					title="The purse is empty"
					hint="Each week's total appears here as soon as hours are logged."
				/>
			{:else}
				<p class="ledger-hint">Tap a week to open its hours.</p>

				<div class="desktop-table desktop-only">
					<table>
						<thead>
							<tr>
								<th>Week</th>
								<th>Hours</th>
								<th>Total</th>
								<th>Status</th>
								<th>Paid</th>
								{#if profile?.role === 'family' || profile?.role === 'admin'}<th></th>{/if}
							</tr>
						</thead>
						<tbody>
							{#each ledger as week (week.weekStart)}
								{@const payment = week.payment}
								{@const pay = weekPayStatus(week)}
								<tr
									class="ledger-row"
									class:viewing={week.weekStart === viewedWeekKey}
									on:click={() => openWeek(week.weekStart)}
								>
									<td>
										<button
											class="week-link"
											on:click|stopPropagation={() => openWeek(week.weekStart)}
										>
											{formatDateShort(week.weekStart)} – {formatDateShort(week.weekEnd)}
										</button>
									</td>
									<td class="num">{week.hours.toFixed(1)}</td>
									<td class="num gilt-text">
										{formatMoney(week.amount)}
										{#if payment?.is_paid && Math.abs((parseFloat(payment.amount) || 0) - week.amount) >= 0.01}
											<span class="paid-diff">paid {formatMoney(payment.amount)}</span>
										{/if}
									</td>
									<td>
										<span
											class="badge"
											class:badge-live={pay.status === 'paid'}
											class:badge-danger={pay.status !== 'paid'}
										>
											{pay.status === 'paid'
												? 'Paid'
												: pay.status === 'short'
													? `Short ${formatMoney(pay.owed)}`
													: 'Unpaid'}
										</span>
									</td>
									<td>{payment?.paid_date ? formatDate(payment.paid_date) : '—'}</td>
									{#if profile?.role === 'family' || profile?.role === 'admin'}
										<td class="row-actions" on:click|stopPropagation>
											{#if pay.status === 'short'}
												<button
													class="btn-small growing"
													on:click={() => markPaid(week)}
													disabled={paymentBusyId === payment.id}
												>
													<Icon name="check" size={16} /> Settle
												</button>
											{:else if payment?.is_paid}
												<button
													class="btn-small"
													on:click={() => markUnpaid(payment.id)}
													disabled={paymentBusyId === payment.id}
												>
													Mark unpaid
												</button>
											{:else if payment}
												<button
													class="btn-small growing"
													on:click={() => markPaid(week)}
													disabled={paymentBusyId === payment.id}
												>
													<Icon name="check" size={16} /> Paid
												</button>
											{:else}
												<button
													class="btn-small growing"
													on:click={() => recordWeekAsPaid(week)}
													disabled={paymentBusyId === week.weekStart}
												>
													<Icon name="check" size={16} /> Paid
												</button>
											{/if}
											{#if payment}
												<button
													class="icon-btn danger"
													on:click={() => deletePayment(payment.id)}
													disabled={paymentBusyId === payment.id}
													aria-label="Delete payment record"
												>
													<Icon name="urn" size={16} />
												</button>
											{/if}
										</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<div class="mobile-only entry-list">
					{#each ledger as week (week.weekStart)}
						{@const payment = week.payment}
						{@const pay = weekPayStatus(week)}
						<div
							class="entry-card"
							class:settled={pay.status === 'paid'}
							class:viewing={week.weekStart === viewedWeekKey}
						>
							<button class="entry-top week-link" on:click={() => openWeek(week.weekStart)}>
								<span class="entry-date">
									{formatDateShort(week.weekStart)} – {formatDateShort(week.weekEnd)}
								</span>
								<span
									class="badge"
									class:badge-live={pay.status === 'paid'}
									class:badge-danger={pay.status !== 'paid'}
								>
									{pay.status === 'paid'
										? 'Paid'
										: pay.status === 'short'
											? `Short ${formatMoney(pay.owed)}`
											: 'Unpaid'}
								</span>
							</button>
							<div class="entry-bottom">
								<span class="entry-earnings">{formatMoney(week.amount)}</span>
								<span class="entry-time">{week.hours.toFixed(1)}h</span>
							</div>
							{#if payment?.is_paid && Math.abs((parseFloat(payment.amount) || 0) - week.amount) >= 0.01}
								<span class="paid-diff">paid {formatMoney(payment.amount)}</span>
							{/if}
							{#if profile?.role === 'family' || profile?.role === 'admin'}
								<div class="entry-actions">
									{#if pay.status === 'short'}
										<button
											class="btn-small growing"
											on:click={() => markPaid(week)}
											disabled={paymentBusyId === payment.id}
										>
											<Icon name="check" size={16} /> Settle
										</button>
									{:else if payment?.is_paid}
										<button
											class="btn-small"
											on:click={() => markUnpaid(payment.id)}
											disabled={paymentBusyId === payment.id}
										>
											Mark unpaid
										</button>
									{:else if payment}
										<button
											class="btn-small growing"
											on:click={() => markPaid(week)}
											disabled={paymentBusyId === payment.id}
										>
											<Icon name="check" size={16} /> Mark paid
										</button>
									{:else}
										<button
											class="btn-small growing"
											on:click={() => recordWeekAsPaid(week)}
											disabled={paymentBusyId === week.weekStart}
										>
											<Icon name="check" size={16} /> Mark paid
										</button>
									{/if}
									{#if payment}
										<button
											class="icon-btn danger"
											on:click={() => deletePayment(payment.id)}
											disabled={paymentBusyId === payment.id}
											aria-label="Delete payment record"
										>
											<Icon name="urn" size={16} />
										</button>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- ── The long ledger: every hour kept ─────────────── -->
		{#if allEntries.length > 0}
			<div class="all-time">
				<div class="all-time-figures">
					<span class="total-label">All time</span>
					<span class="all-time-value">
						{allTimeHours.toFixed(1)} hours · {formatMoney(allTimePay)}
					</span>
					<span class="total-hours">
						{allEntries.length}
						{allEntries.length === 1 ? 'shift' : 'shifts'}
						{#if firstShift}since {formatDate(firstShift)}{/if}
					</span>
				</div>
				<button class="btn btn-secondary btn-small" on:click={exportAllCSV}>
					<Icon name="download" size={16} /> Export all
				</button>
			</div>
		{/if}
	{/if}
</div>

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
	/* ── Head ─────────────────────────────────────────────── */
	.page-head h1 {
		color: var(--accent-bright);
	}

	.lede {
		color: var(--text-faint);
		font-size: 0.95rem;
		margin-top: 0.2rem;
	}

	.head-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

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

	/* ── Ledger ───────────────────────────────────────────── */
	.week-card {
		scroll-margin-top: 1rem;
	}

	.ledger-hint {
		margin: -0.35rem 0 0.9rem;
		font-size: 0.85rem;
		color: var(--text-faint);
	}

	.ledger-row {
		cursor: pointer;
		transition: background var(--transition-fast);
	}

	.ledger-row:hover {
		background: var(--accent-tint);
	}

	.ledger-row.viewing,
	.entry-card.viewing {
		background: var(--accent-dim);
	}

	.week-link {
		padding: 0;
		background: none;
		border: none;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.week-link:hover,
	.week-link:focus-visible {
		color: var(--accent-bright);
	}

	button.entry-top {
		width: 100%;
	}

	.paid-diff {
		display: block;
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--text-faint);
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
		font-family: var(--font-body);
		font-variant-numeric: lining-nums tabular-nums;
		font-size: clamp(1.7rem, 5vw, 2.2rem);
		font-weight: 700;
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

	/* ── All time ─────────────────────────────────────────── */
	.all-time {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: var(--section-gap);
		padding: 1rem 1.2rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--card-radius);
	}

	.all-time-figures {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.all-time-value {
		font-family: var(--font-body);
		font-variant-numeric: lining-nums tabular-nums;
		font-size: 1.2rem;
		font-weight: 700;
		color: var(--text);
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	@media (max-width: 768px) {
		.head-actions {
			width: 100%;
		}

		.head-actions .btn {
			flex: 1;
		}

		.all-time {
			flex-direction: column;
			align-items: stretch;
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
