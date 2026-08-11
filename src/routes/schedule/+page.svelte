<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { supabase } from '$lib/supabase';
	import Nav from '$lib/Nav.svelte';
	import CalendarManager from '$lib/components/CalendarManager.svelte';
	import MonthGrid from '$lib/components/MonthGrid.svelte';
	import MonthSidePanel from '$lib/components/MonthSidePanel.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { goto } from '$app/navigation';
	import { toast, confirm as confirmModal } from '$lib/stores/toast.js';
	import {
		normalizeDateValue,
		localDateString,
		parseLocalDate,
		combineLocalDateTime,
		buildMonthGrid,
		getMonthGridRange,
		addMonths
	} from '$lib/time.js';
	import {
		fetchShiftsInRange,
		fetchBusyEventsInRange,
		fetchManualBusyInRange,
		fetchPaymentsDueInRange,
		toCalendarItems,
		groupItemsByDay,
		upcomingItems
	} from '$lib/calendar.js';

	/** @type {any} */
	let user = null;
	/** @type {any} */
	let profile = null;
	/** @type {Date | null} */
	let currentWeekStart = null;
	let weekOffset = 0;
	/** @type {any[]} */
	let shifts = [];
	let loading = true;
	let showAddShift = false;
	let showCalendarManager = false;
	/** @type {any[]} */
	let nannies = [];
	/** @type {number | null} */
	let editingShiftId = null;
	let isMobile = false;

	// View state. Month is the desktop default; phones land on Day (set at
	// mount) — the single-column grid is the one that fits a thumb.
	/** @type {'month' | 'week' | 'day'} */
	let view = 'month';
	const _initialNow = new Date();
	let monthYear = _initialNow.getFullYear();
	let monthMonth = _initialNow.getMonth();

	// Day view state. The day borrows the week's loaded data (it always sits
	// inside currentWeekStart's week) and renders one column of the same grid.
	const _todayStart = new Date(_initialNow);
	_todayStart.setHours(0, 0, 0, 0);
	/** @type {Date} */
	let currentDay = _todayStart;
	// Compressed by default: the small hours are dead canvas. Expanding shows
	// the full 24 and remembers nothing — mornings deserve the fresh default.
	let showFullDay = false;
	const DAY_WINDOW_START = 6;
	const DAY_WINDOW_END = 22;
	/** @type {import('$lib/calendar.js').CalendarItem[]} */
	let monthItems = [];
	/** @type {Record<string, import('$lib/calendar.js').CalendarItem[]>} */
	let monthItemsByDay = {};
	let monthLoading = false;
	let monthError = null;
	let monthInitialized = false;
	let monthLoadToken = 0;
	let selectedDateStr = localDateString();

	const MONTH_NAMES = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];

	/** @type {{ nannyId: string | null, date: string, startTime: string, endTime: string, notes: string }} */
	let shiftForm = {
		nannyId: null,
		date: '',
		startTime: '09:00',
		endTime: '17:00',
		notes: ''
	};

	// Calendar data
	/** @type {{ you: any[], partner: any[] }} */
	let parentCalendarEvents = {
		you: [],
		partner: []
	};
	/** @type {Record<string, any[]>} */
	let nannyCalendarEvents = {}; // keyed by nanny_id -> array of events
	/** @type {any[]} */
	let familyMembers = [];

	// Sync status: every syncable calendar the viewer can see, surfaced on the
	// page itself so a stale or broken feed can't masquerade as fresh truth.
	/** @type {any[]} */
	let calendarMeta = [];
	/** @type {number | null} */
	let syncingCalId = null;
	let autoSyncRan = false;

	const AUTO_SYNC_AFTER_MS = 6 * 60 * 60 * 1000; // quietly re-sync when older
	const SYNC_WARN_AFTER_MS = 24 * 60 * 60 * 1000; // chip turns warning when older

	// Time grid config
	const DAY_START_HOUR = 0;
	const DAY_END_HOUR = 24;
	const TOTAL_HOURS = DAY_END_HOUR - DAY_START_HOUR;
	const HOUR_HEIGHT = 60; // px per hour
	const SLOT_MINUTES = 15;
	const SLOT_HEIGHT = HOUR_HEIGHT / (60 / SLOT_MINUTES); // 15px

	// The window the coverage-gap detector scans (weekday working hours).
	// A household setting eventually; a named constant until then.
	const COVERAGE_START_HOUR = 8;
	const COVERAGE_END_HOUR = 18;

	let hoveredSlot = null;

	// The hour window the grid renders. Week always shows the full 24; Day
	// compresses to the waking hours unless expanded.
	$: windowStartHour = view === 'day' && !showFullDay ? DAY_WINDOW_START : 0;
	$: windowEndHour = view === 'day' && !showFullDay ? DAY_WINDOW_END : 24;
	$: windowHours = windowEndHour - windowStartHour;

	// The columns the grid draws: one day, or the week (3-day slice on mobile).
	/** @type {Date[]} */
	$: gridDays = view === 'day' ? [currentDay] : weekDays;

	onMount(async () => {
		const {
			data: { user: currentUser }
		} = await supabase.auth.getUser();
		if (!currentUser) {
			goto('/');
			return;
		}

		user = currentUser;

		const { data: profileData } = await supabase
			.from('profiles')
			.select('*')
			.eq('id', user.id)
			.maybeSingle();

		profile = profileData;

		if (profile?.role === 'family' || profile?.role === 'admin') {
			await loadFamilyMembers();

			const { data: nanniesData } = await supabase
				.from('profiles')
				.select('*')
				.eq('role', 'nanny')
				.order('full_name');

			nannies = nanniesData || [];
			if (nannies.length > 0) {
				shiftForm.nannyId = nannies[0].id;
			}
		} else if (profile?.role === 'nanny') {
			nannies = profile ? [profile] : [];
			shiftForm.nannyId = profile?.id || null;
		}

		// Mobile detection — before the initial load, because phones default to
		// the Day view instead of Month.
		const mql = window.matchMedia('(max-width: 768px)');
		isMobile = mql.matches;
		/** @param {MediaQueryListEvent} e */
		const handleResize = (e) => {
			isMobile = e.matches;
		};
		mql.addEventListener('change', handleResize);
		mqlCleanup = () => mql.removeEventListener('change', handleResize);

		if (isMobile) view = 'day';

		if (view === 'month') {
			await loadMonthData();
		} else if (view === 'day') {
			await setCurrentDay(currentDay);
		} else {
			await setCurrentWeek(0);
		}
		loading = false;

		// After first paint: show sync freshness, then quietly refresh stale
		// feeds in the background (not awaited — the page stays interactive).
		loadCalendarMeta().then(() => maybeAutoSync());

		// Prevent body from scrolling — only the grid body should scroll
		document.body.classList.add('schedule-active');

		nowInterval = setInterval(() => (nowTick = new Date()), 60_000);

		if (view === 'week' || view === 'day') scrollGridToNow();
	});

	// Auto-scroll the time grid to the current hour, relative to the rendered
	// window. The .grid-body node only exists while the grid is mounted.
	function scrollGridToNow() {
		setTimeout(() => {
			const gridBody = document.querySelector('.grid-body');
			if (gridBody) {
				const scrollToHour = Math.max(new Date().getHours() - 1 - windowStartHour, 0);
				gridBody.scrollTop = scrollToHour * HOUR_HEIGHT;
			}
		}, 50);
	}

	// ── Day navigation ────────────────────────────────────────────────
	// The day always lives inside the loaded week; crossing a Sunday/Saturday
	// boundary loads the containing week through the same setCurrentWeek path
	// the week view uses (reactive safety net included).

	/** @param {Date} date */
	async function setCurrentDay(date) {
		const day = new Date(date);
		day.setHours(0, 0, 0, 0);
		currentDay = day;

		const sunday = new Date(day);
		sunday.setDate(day.getDate() - day.getDay());
		sunday.setHours(0, 0, 0, 0);

		if (!currentWeekStart || sunday.getTime() !== currentWeekStart.getTime()) {
			const now = new Date();
			const currentSunday = new Date(now);
			currentSunday.setDate(now.getDate() - now.getDay());
			currentSunday.setHours(0, 0, 0, 0);
			const offset = Math.round(
				(sunday.getTime() - currentSunday.getTime()) / (7 * 24 * 60 * 60 * 1000)
			);
			await setCurrentWeek(offset);
		}
	}

	/** @param {'prev' | 'next'} direction */
	function changeDay(direction) {
		const day = new Date(currentDay);
		day.setDate(day.getDate() + (direction === 'prev' ? -1 : 1));
		setCurrentDay(day);
	}

	function dayGoToToday() {
		setCurrentDay(new Date());
	}

	// Swipe between days on touch — the day grid is the phone's home.
	let touchStartX = 0;
	let touchStartY = 0;

	/** @param {TouchEvent} e */
	function handleTouchStart(e) {
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
	}

	/** @param {TouchEvent} e */
	function handleTouchEnd(e) {
		if (view !== 'day') return;
		const dx = e.changedTouches[0].clientX - touchStartX;
		const dy = e.changedTouches[0].clientY - touchStartY;
		if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
			changeDay(dx < 0 ? 'next' : 'prev');
		}
	}

	/** @type {(() => void) | null} */
	let mqlCleanup = null;
	onDestroy(() => {
		if (typeof document !== 'undefined') {
			document.body.classList.remove('schedule-active');
		}
		if (mqlCleanup) mqlCleanup();
		if (nowInterval) clearInterval(nowInterval);
	});

	// Reactive data reload — whenever the displayed week changes, reload everything.
	// This is a safety net: setCurrentWeek already calls the loaders, but Svelte's
	// async reactivity can miss updates in some edge cases.
	let _prevWeekKey = null;
	$: {
		const weekKey = currentWeekStart ? currentWeekStart.getTime() : null;
		if (weekKey && weekKey !== _prevWeekKey && !loading && user && profile) {
			_prevWeekKey = weekKey;
			console.log('[schedule] reactive reload triggered for week', ymd(currentWeekStart));
			Promise.all([loadShifts(), loadCalendarEvents()]);
		}
	}

	async function loadFamilyMembers() {
		const { data, error } = await supabase
			.from('profiles')
			.select('*')
			.eq('role', 'family')
			.order('created_at');

		if (error) return;
		familyMembers = data || [];
	}

	async function loadCalendarMeta() {
		try {
			// select('*') rather than naming columns: sync_error only exists after
			// the calendar_sync_state.sql migration, and the chips should work
			// (minus failure badges) before it runs.
			let query = supabase.from('parent_calendars').select('*').order('created_at');
			if (profile?.role === 'nanny') query = query.eq('user_id', user.id);

			const { data, error } = await query;
			if (error) throw error;
			calendarMeta = (data || []).filter((c) => c.calendar_url && c.sync_enabled);
		} catch (err) {
			console.warn('[schedule] loadCalendarMeta failed:', err);
		}
	}

	/** @param {any} cal */
	function calAge(cal) {
		return cal.last_synced ? Date.now() - new Date(cal.last_synced).getTime() : Infinity;
	}

	/** @param {any} cal */
	function calOwnerLabel(cal) {
		if (cal.user_id === user?.id) return cal.calendar_name;
		const owner =
			familyMembers.find((m) => m.id === cal.user_id) || nannies.find((n) => n.id === cal.user_id);
		const first = owner?.full_name?.split(' ')[0];
		return first ? `${first} · ${cal.calendar_name}` : cal.calendar_name;
	}

	/** @param {any} cal */
	function syncAgeLabel(cal) {
		if (cal.sync_error) return 'sync failed';
		if (!cal.last_synced) return 'never synced';
		const mins = Math.floor((Date.now() - new Date(cal.last_synced).getTime()) / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		return `${Math.floor(hrs / 24)}d ago`;
	}

	/**
	 * @param {number} calendarId
	 * @param {{ quiet?: boolean }} [opts] quiet = background auto-sync, no toasts
	 * @returns {Promise<boolean>} whether the sync succeeded
	 */
	async function syncCalendarById(calendarId, { quiet = false } = {}) {
		syncingCalId = calendarId;
		try {
			const {
				data: { session }
			} = await supabase.auth.getSession();
			if (!session) return false;

			const response = await fetch('/api/calendar/sync', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session.access_token}`
				},
				body: JSON.stringify({ calendarId })
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error || 'Sync failed');

			if (!quiet) toast.success(`Synced ${result.synced} events`);
			return true;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (!quiet) toast.error('Sync failed: ' + message);
			else console.warn('[schedule] auto-sync failed for calendar', calendarId, message);
			return false;
		} finally {
			syncingCalId = null;
		}
	}

	/** @param {any} cal */
	async function manualChipSync(cal) {
		const ok = await syncCalendarById(cal.id);
		await loadCalendarMeta();
		if (ok) handleCalendarUpdate();
	}

	// On arrival, quietly refresh any feed that hasn't synced in a while —
	// sync used to be button-only, so overlays silently went stale.
	async function maybeAutoSync() {
		if (autoSyncRan) return;
		autoSyncRan = true;

		const stale = calendarMeta.filter((c) => calAge(c) > AUTO_SYNC_AFTER_MS);
		if (stale.length === 0) return;

		let anySucceeded = false;
		for (const cal of stale) {
			anySucceeded = (await syncCalendarById(cal.id, { quiet: true })) || anySucceeded;
		}
		await loadCalendarMeta();
		if (anySucceeded) handleCalendarUpdate();
	}

	// One loader for every busy-time overlay, built on the shared calendar.js
	// fetchers. Those query by true OVERLAP with the week — the old per-role
	// loaders filtered on start_time containment, so an event that began before
	// Sunday (or crossed midnight) silently vanished from the grid.
	async function loadCalendarEvents() {
		if (!currentWeekStart) return;

		const weekEnd = new Date(currentWeekStart);
		weekEnd.setDate(weekEnd.getDate() + 6);
		weekEnd.setHours(23, 59, 59, 999);

		const isFamilyViewer = profile?.role === 'family' || profile?.role === 'admin';

		try {
			const [busyRows, manualRows] = await Promise.all([
				fetchBusyEventsInRange(supabase, currentWeekStart, weekEnd),
				// Parity with the month view: manual busy times are a family-member
				// feature; the nanny view never shows them.
				isFamilyViewer
					? fetchManualBusyInRange(supabase, currentWeekStart, weekEnd)
					: Promise.resolve([])
			]);

			const youId = user.id;
			const partnerId = familyMembers.find((m) => m.id !== youId)?.id;
			const familyIds = new Set(familyMembers.map((m) => m.id));
			const nannyIds = new Set(nannies.map((n) => n.id));

			/** @type {{ you: any[], partner: any[] }} */
			const newParentEvents = { you: [], partner: [] };
			/** @type {Record<string, any[]>} */
			const newNannyEvents = {};

			for (const event of busyRows) {
				const ownerId = event.parent_calendars?.user_id ?? event.user_id;
				const eventData = {
					title: event.title,
					startTime: new Date(event.start_time),
					endTime: new Date(event.end_time),
					color: event.parent_calendars?.color,
					calendarName: event.parent_calendars?.calendar_name
				};

				if (nannyIds.has(ownerId)) {
					// For a nanny viewer, nannyIds is just themselves — scoping for free.
					(newNannyEvents[ownerId] ||= []).push({ ...eventData, nannyId: ownerId });
				} else if (isFamilyViewer) {
					if (ownerId === youId) newParentEvents.you.push(eventData);
					else if (ownerId === partnerId) newParentEvents.partner.push(eventData);
				}
			}

			for (const manual of manualRows) {
				if (!familyIds.has(manual.user_id)) continue;
				const eventData = {
					title: manual.title,
					startTime: new Date(manual.start_time),
					endTime: new Date(manual.end_time),
					color: '#718096',
					calendarName: 'Manual Entry'
				};
				if (manual.user_id === youId) newParentEvents.you.push(eventData);
				else if (manual.user_id === partnerId) newParentEvents.partner.push(eventData);
			}

			parentCalendarEvents = newParentEvents;
			nannyCalendarEvents = newNannyEvents;
		} catch (err) {
			console.error('[schedule] loadCalendarEvents ERROR:', err);
			parentCalendarEvents = { you: [], partner: [] };
			nannyCalendarEvents = {};
		}
	}

	async function setCurrentWeek(offset) {
		weekOffset = offset;
		const now = new Date();
		const weekStart = new Date(now);
		weekStart.setDate(now.getDate() - now.getDay() + offset * 7);
		weekStart.setHours(0, 0, 0, 0);
		currentWeekStart = weekStart;
		console.log(
			'[schedule] setCurrentWeek offset=',
			offset,
			'range=',
			ymd(currentWeekStart),
			'to',
			ymd(new Date(currentWeekStart.getTime() + 6 * 86400000))
		);
		await Promise.all([loadShifts(), loadCalendarEvents()]);
	}

	function ymd(date) {
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}

	function getNannyName(id) {
		const nanny = nannies.find((x) => x.id === id);
		if (nanny) {
			if (profile?.role === 'nanny' && nanny.id === profile?.id) return nanny.full_name || 'You';
			return nanny.full_name;
		}
		if (profile?.role === 'nanny' && id === profile?.id) return profile.full_name || 'You';
		return 'Nanny';
	}

	async function loadShifts() {
		if (!currentWeekStart) return;

		const weekEnd = new Date(currentWeekStart);
		weekEnd.setDate(weekEnd.getDate() + 6);

		try {
			let query = supabase
				.from('schedules')
				.select('*')
				.gte('date', ymd(currentWeekStart))
				.lte('date', ymd(weekEnd))
				.order('date', { ascending: true })
				.order('start_time', { ascending: true });

			if (profile?.role === 'nanny') {
				query = query.eq('nanny_id', user.id);
			}

			const { data, error } = await query;
			if (error) throw error;

			shifts = (data || []).map((shift) => ({
				...shift,
				date: normalizeDateValue(shift.date)
			}));
			console.log(
				'[schedule] loadShifts:',
				shifts.length,
				'shifts for',
				ymd(currentWeekStart),
				'-',
				ymd(weekEnd)
			);
		} catch (err) {
			console.error('[schedule] loadShifts ERROR:', err);
			shifts = [];
		}
	}

	/** @param {any} shift */
	function editShift(shift) {
		editingShiftId = shift.id;
		shiftForm = {
			nannyId: shift.nanny_id,
			date: normalizeDateValue(shift.date),
			startTime: shift.start_time.slice(0, 5),
			endTime: shift.end_time.slice(0, 5),
			notes: shift.notes || ''
		};
		showAddShift = true;
	}

	function resetShiftForm() {
		editingShiftId = null;
		shiftForm = {
			nannyId: nannies.length > 0 ? nannies[0].id : null,
			date: '',
			startTime: '09:00',
			endTime: '17:00',
			notes: ''
		};
		showAddShift = false;
	}

	async function saveShift() {
		if (!shiftForm.nannyId) {
			toast.error('Please select a nanny');
			return;
		}

		if (shiftForm.startTime >= shiftForm.endTime) {
			toast.error('End time must be after start time');
			return;
		}

		const isEditing = !!editingShiftId;
		const savedDate = shiftForm.date;

		try {
			if (editingShiftId) {
				const { error } = await supabase
					.from('schedules')
					.update({
						nanny_id: shiftForm.nannyId,
						date: shiftForm.date,
						start_time: shiftForm.startTime,
						end_time: shiftForm.endTime,
						notes: shiftForm.notes || ''
					})
					.eq('id', editingShiftId);

				if (error) throw error;
			} else {
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
					.single();

				if (error) throw error;
			}

			resetShiftForm();

			if (view === 'month') {
				// Jump the viewed month to the saved shift so it's visible
				const shiftDate = parseLocalDate(savedDate);
				if (shiftDate.getFullYear() !== monthYear || shiftDate.getMonth() !== monthMonth) {
					monthYear = shiftDate.getFullYear();
					monthMonth = shiftDate.getMonth();
				}
				selectedDateStr = normalizeDateValue(savedDate);
				await loadMonthData();
			} else {
				// Navigate to the week containing the saved shift so it's visible
				const shiftDate = new Date(savedDate + 'T00:00:00');
				const weekStart = currentWeekStart || new Date();
				const weekEnd = new Date(weekStart);
				weekEnd.setDate(weekEnd.getDate() + 6);

				if (shiftDate < weekStart || shiftDate > weekEnd) {
					// Calculate the week offset for the shift's week
					const now = new Date();
					const currentSunday = new Date(now);
					currentSunday.setDate(now.getDate() - now.getDay());
					currentSunday.setHours(0, 0, 0, 0);

					const shiftSunday = new Date(shiftDate);
					shiftSunday.setDate(shiftDate.getDate() - shiftDate.getDay());
					shiftSunday.setHours(0, 0, 0, 0);

					const newOffset = Math.round(
						(shiftSunday.getTime() - currentSunday.getTime()) / (7 * 24 * 60 * 60 * 1000)
					);
					await setCurrentWeek(newOffset);
				} else {
					// Same week — just reload data via setCurrentWeek
					await setCurrentWeek(weekOffset);
				}
			}

			toast.success(isEditing ? 'Shift updated!' : 'Shift saved!');
		} catch (err) {
			toast.error('Error: ' + err.message);
		}
	}

	/**
	 * The days the grid shows: the full week, or a 3-day slice centered on
	 * today on mobile. Pure — the reactive `weekDays` below is the one source
	 * the template and layout read.
	 * @param {Date} weekStart
	 * @param {boolean} mobile
	 * @returns {Date[]}
	 */
	function computeWeekDays(weekStart, mobile) {
		const days = [];
		if (mobile) {
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const weekEnd = new Date(weekStart);
			weekEnd.setDate(weekEnd.getDate() + 6);

			let center;
			if (today >= weekStart && today <= weekEnd) {
				center = new Date(today);
			} else {
				center = new Date(weekStart);
				center.setDate(center.getDate() + 1);
			}

			for (let i = -1; i <= 1; i++) {
				const day = new Date(center);
				day.setDate(day.getDate() + i);
				days.push(day);
			}
		} else {
			for (let i = 0; i < 7; i++) {
				const day = new Date(weekStart);
				day.setDate(day.getDate() + i);
				days.push(day);
			}
		}
		return days;
	}

	/** @type {Date[]} */
	$: weekDays = currentWeekStart ? computeWeekDays(currentWeekStart, isMobile) : [];

	/**
	 * @param {any[]} allShifts
	 * @param {Date} date
	 */
	function shiftsOnDate(allShifts, date) {
		const dateStr = ymd(date);
		return allShifts.filter((s) => normalizeDateValue(s.date) === dateStr);
	}

	function formatTime(timeStr) {
		if (!timeStr) return '';
		const [h, m] = timeStr.slice(0, 5).split(':');
		const hour = parseInt(h);
		const ampm = hour >= 12 ? 'pm' : 'am';
		const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
		return `${display}:${m}${ampm}`;
	}

	function formatHour(hour) {
		const ampm = hour >= 12 ? 'PM' : 'AM';
		const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
		return `${display} ${ampm}`;
	}

	function openAddShift(date, hour, minute = 0) {
		if (
			(profile?.role === 'family' || profile?.role === 'admin') &&
			(!nannies || nannies.length === 0)
		) {
			toast.error('No nannies found. Please create a nanny profile first.');
			return;
		}
		editingShiftId = null;
		shiftForm.date = ymd(date);
		if (hour !== undefined) {
			shiftForm.startTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
			const endTotalMin = Math.min(hour * 60 + minute + 60, 23 * 60 + 59);
			shiftForm.endTime = `${String(Math.floor(endTotalMin / 60)).padStart(2, '0')}:${String(endTotalMin % 60).padStart(2, '0')}`;
		}
		if (!shiftForm.nannyId && nannies && nannies.length === 1) {
			shiftForm.nannyId = nannies[0].id;
		}
		showAddShift = true;
	}

	/**
	 * Pointer y in the grid → snapped clock time, honoring the rendered
	 * window's offset (the Day view's grid may start at 6am, not midnight).
	 * @param {MouseEvent} e
	 */
	function pointerToTime(e) {
		const target = /** @type {HTMLElement} */ (e.currentTarget);
		const rect = target.getBoundingClientRect();
		const y = e.clientY - rect.top + target.scrollTop;
		const totalMinutes = (y / HOUR_HEIGHT) * 60 + windowStartHour * 60;
		const snapped = Math.floor(totalMinutes / SLOT_MINUTES) * SLOT_MINUTES;
		return { hour: Math.min(Math.floor(snapped / 60), 23), minute: snapped % 60 };
	}

	/**
	 * @param {MouseEvent} e
	 * @param {Date} day
	 */
	function handleDayClick(e, day) {
		if (profile?.role !== 'family' && profile?.role !== 'admin') return;
		const { hour, minute } = pointerToTime(e);
		openAddShift(day, hour, minute);
	}

	/**
	 * @param {MouseEvent} e
	 * @param {number} dayIdx
	 */
	function handleDayMouseMove(e, dayIdx) {
		if (profile?.role !== 'family' && profile?.role !== 'admin') return;
		const { hour, minute } = pointerToTime(e);
		if (hour >= windowStartHour && hour < windowEndHour) {
			hoveredSlot = { dayIdx, hour, minute };
		}
	}

	function formatTime15(hour, minute) {
		const ampm = hour >= 12 ? 'pm' : 'am';
		const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
		return `${display}:${String(minute).padStart(2, '0')}${ampm}`;
	}

	function changeWeek(direction) {
		const newOffset = weekOffset + (direction === 'prev' ? -1 : 1);
		console.log('[schedule] changeWeek', direction, '→ offset', newOffset);
		setCurrentWeek(newOffset);
	}

	async function deleteShift(shiftId) {
		const confirmed = await confirmModal.show({
			title: 'Delete Shift',
			message: 'Delete this shift?',
			confirmText: 'Delete',
			danger: true
		});
		if (!confirmed) return;

		try {
			const { error } = await supabase.from('schedules').delete().eq('id', shiftId);
			if (error) throw error;
			if (view === 'month') {
				await loadMonthData();
			} else {
				await loadShifts();
			}
		} catch (err) {
			toast.error('Error deleting shift');
		}
	}

	// --- Time grid positioning helpers ---

	/** @param {string} timeStr 'HH:MM' */
	function timeToMinutes(timeStr) {
		const [h, m] = timeStr.split(':').map(Number);
		return h * 60 + m;
	}

	// ── Day layout engine ─────────────────────────────────────────────
	// Every block a day column draws — shifts and busy overlays — is computed
	// once per data change here, not per render. Events are clipped to each
	// LOCAL day they overlap (the old code matched on start day, so anything
	// crossing midnight or spanning days vanished after its first day), and
	// concurrent blocks are packed into side-by-side lanes instead of
	// stacking full-width and hiding each other.

	/**
	 * Minutes into `day` for a timestamp, clamped to [0, 1440].
	 * @param {Date} time
	 * @param {Date} dayStart local midnight of the day
	 */
	function minutesIntoDay(time, dayStart) {
		return Math.max(0, Math.min(1440, (time.getTime() - dayStart.getTime()) / 60000));
	}

	/**
	 * Assign side-by-side lanes to overlapping blocks. Blocks are grouped into
	 * collision clusters; within a cluster each block gets a lane and the
	 * cluster's lane count, so width = 100% / laneCount.
	 * @param {any[]} blocks with startMin/endMin
	 */
	function packLanes(blocks) {
		const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

		/** @type {any[][]} */
		const clusters = [];
		/** @type {any[]} */
		let cluster = [];
		let clusterEnd = -1;

		for (const block of sorted) {
			if (cluster.length > 0 && block.startMin >= clusterEnd) {
				clusters.push(cluster);
				cluster = [];
				clusterEnd = -1;
			}
			cluster.push(block);
			clusterEnd = Math.max(clusterEnd, block.endMin);
		}
		if (cluster.length > 0) clusters.push(cluster);

		for (const group of clusters) {
			/** @type {number[]} lane -> occupied-until minute */
			const lanes = [];
			for (const block of group) {
				let lane = lanes.findIndex((occupiedUntil) => occupiedUntil <= block.startMin);
				if (lane === -1) {
					lane = lanes.length;
					lanes.push(0);
				}
				lanes[lane] = block.endMin;
				block.lane = lane;
			}
			for (const block of group) block.laneCount = lanes.length;
		}
		return sorted;
	}

	/**
	 * @param {Date[]} days
	 * @param {any[]} allShifts
	 * @param {{ you: any[], partner: any[] }} parentEvents
	 * @param {Record<string, any[]>} nannyEvents
	 * @returns {Record<string, any[]>} ymd -> positioned blocks
	 */
	function computeDayLayouts(days, allShifts, parentEvents, nannyEvents) {
		/** @type {Record<string, any[]>} */
		const layouts = {};

		for (const day of days) {
			const dayStart = new Date(day);
			dayStart.setHours(0, 0, 0, 0);
			const dayEnd = new Date(dayStart);
			dayEnd.setDate(dayEnd.getDate() + 1);
			const dayKey = ymd(day);

			/** @type {any[]} */
			const blocks = [];

			// Shifts on this date; an overnight shift (end <= start) is clamped to
			// midnight here and its spill segment lands on the next day below.
			for (const shift of shiftsOnDate(allShifts, day)) {
				const startMin = timeToMinutes(shift.start_time);
				let endMin = timeToMinutes(shift.end_time);
				if (endMin <= startMin) endMin = 1440;
				blocks.push({
					key: `shift-${shift.id}-${dayKey}`,
					type: 'shift',
					shift,
					startMin,
					endMin
				});
			}

			// Spill segments from yesterday's overnight shifts.
			const prevDay = new Date(day);
			prevDay.setDate(prevDay.getDate() - 1);
			for (const shift of shiftsOnDate(allShifts, prevDay)) {
				const startMin = timeToMinutes(shift.start_time);
				const endMin = timeToMinutes(shift.end_time);
				if (endMin <= startMin && endMin > 0) {
					blocks.push({
						key: `shift-${shift.id}-${dayKey}-spill`,
						type: 'shift',
						shift,
						startMin: 0,
						endMin
					});
				}
			}

			/**
			 * @param {any} event
			 * @param {'you' | 'partner' | 'nanny'} type
			 * @param {string} keyPrefix
			 * @param {number} index
			 * @param {string | null} nannyId
			 */
			const pushClipped = (event, type, keyPrefix, index, nannyId = null) => {
				if (event.endTime <= dayStart || event.startTime >= dayEnd) return;
				blocks.push({
					key: `${keyPrefix}-${index}-${dayKey}`,
					type,
					event,
					nannyId,
					startMin: minutesIntoDay(event.startTime, dayStart),
					endMin: minutesIntoDay(event.endTime, dayStart)
				});
			};

			parentEvents.you.forEach((e, i) => pushClipped(e, 'you', 'you', i));
			parentEvents.partner.forEach((e, i) => pushClipped(e, 'partner', 'partner', i));
			for (const [nannyId, events] of Object.entries(nannyEvents)) {
				events.forEach((e, i) => pushClipped(e, 'nanny', `nanny-${nannyId}`, i, nannyId));
			}

			layouts[dayKey] = packLanes(blocks.filter((b) => b.endMin > b.startMin));
		}

		return layouts;
	}

	/** @type {Record<string, any[]>} */
	$: dayLayouts =
		(view === 'week' || view === 'day') && gridDays.length > 0
			? computeDayLayouts(gridDays, shifts, parentCalendarEvents, nannyCalendarEvents)
			: {};

	/** @param {any} block */
	/**
	 * @param {any} block
	 * @param {number} winStartHour rendered window start (0 for the full day)
	 * @param {number} winEndHour rendered window end
	 */
	function blockStyle(block, winStartHour = 0, winEndHour = 24) {
		const winStart = winStartHour * 60;
		const winEnd = winEndHour * 60;
		const start = Math.max(block.startMin, winStart);
		const end = Math.min(block.endMin, winEnd);
		if (end <= start) return 'display: none;';
		const top = ((start - winStart) / 60) * HOUR_HEIGHT;
		const height = Math.max(((end - start) / 60) * HOUR_HEIGHT, 20);
		const width = 100 / (block.laneCount || 1);
		const left = (block.lane || 0) * width;
		return `top: ${top}px; height: ${height}px; left: calc(${left}% + 2px); width: calc(${width}% - 4px);`;
	}

	/**
	 * Blocks the compressed Day window hides entirely — surfaced on the
	 * expander so nothing can be silently out of sight.
	 * @param {any[]} blocks
	 */
	function countHiddenBlocks(blocks) {
		const winStart = DAY_WINDOW_START * 60;
		const winEnd = DAY_WINDOW_END * 60;
		return blocks.filter((b) => b.endMin <= winStart || b.startMin >= winEnd).length;
	}

	$: dayHiddenCount =
		view === 'day' && !showFullDay ? countHiddenBlocks(dayLayouts[ymd(currentDay)] || []) : 0;

	function getPartnerName() {
		return familyMembers.find((m) => m.id !== user?.id)?.full_name || 'Partner';
	}

	function isToday(date) {
		const today = new Date();
		return date.toDateString() === today.toDateString();
	}

	// The now-line follows a real clock instead of waiting for unrelated
	// re-renders. One tick a minute matches its visual resolution.
	let nowTick = new Date();
	/** @type {ReturnType<typeof setInterval> | null} */
	let nowInterval = null;

	$: nowMinutes = nowTick.getHours() * 60 + nowTick.getMinutes();
	$: nowLinePosition = ((nowMinutes - windowStartHour * 60) / 60) * HOUR_HEIGHT;
	$: nowLineVisible = nowMinutes >= windowStartHour * 60 && nowMinutes <= windowEndHour * 60;

	/**
	 * Weekday working hours where BOTH parents are busy and no nanny covers
	 * the hour. Pure; memoized by the reactive statement below rather than
	 * recomputed on every template read.
	 * @param {Date[]} days
	 * @param {any[]} allShifts
	 * @param {{ you: any[], partner: any[] }} parentEvents
	 */
	function computeCoverageGaps(days, allShifts, parentEvents) {
		/** @type {{ day: Date, startHour: number, endHour: number }[]} */
		const gaps = [];

		days.forEach((day) => {
			if (day.getDay() === 0 || day.getDay() === 6) return;
			const dayShifts = shiftsOnDate(allShifts, day);

			for (let hour = COVERAGE_START_HOUR; hour < COVERAGE_END_HOUR; hour++) {
				const hasNanny = dayShifts.some((s) => {
					const start = parseInt(s.start_time.split(':')[0]);
					const end = parseInt(s.end_time.split(':')[0]);
					return hour >= start && hour < end;
				});

				if (hasNanny) continue;

				const checkTime = new Date(day);
				checkTime.setHours(hour, 0, 0, 0);
				const checkEnd = new Date(day);
				checkEnd.setHours(hour + 1, 0, 0, 0);

				const youBusy = parentEvents.you.some(
					(e) => checkTime < e.endTime && checkEnd > e.startTime
				);
				const partnerBusy = parentEvents.partner.some(
					(e) => checkTime < e.endTime && checkEnd > e.startTime
				);

				if (youBusy && partnerBusy) {
					const last = gaps[gaps.length - 1];
					if (last && last.day.toDateString() === day.toDateString() && last.endHour === hour) {
						last.endHour = hour + 1;
					} else {
						gaps.push({ day, startHour: hour, endHour: hour + 1 });
					}
				}
			}
		});

		return gaps;
	}

	$: coverageGaps =
		view === 'week' && (profile?.role === 'family' || profile?.role === 'admin')
			? computeCoverageGaps(weekDays, shifts, parentCalendarEvents)
			: [];

	/**
	 * Everything standing in the way of the proposed shift: the nanny's own
	 * busy calendar, and — new — any shift they're already booked for. Both
	 * are advisory; saving is never blocked.
	 * @returns {{ title: string, startTime: Date, endTime: Date }[]}
	 */
	function computeShiftConflicts() {
		if (!shiftForm.nannyId || !shiftForm.date || !shiftForm.startTime || !shiftForm.endTime)
			return [];

		const shiftStart = new Date(`${shiftForm.date}T${shiftForm.startTime}:00`);
		const shiftEnd = new Date(`${shiftForm.date}T${shiftForm.endTime}:00`);
		/** @type {{ title: string, startTime: Date, endTime: Date }[]} */
		const conflicts = [];

		/** @param {any} s a schedules row */
		const existingShiftOverlap = (s) => {
			if (s.nanny_id !== shiftForm.nannyId || s.id === editingShiftId) return false;
			const start = combineLocalDateTime(normalizeDateValue(s.date), s.start_time.slice(0, 5));
			let end = combineLocalDateTime(normalizeDateValue(s.date), s.end_time.slice(0, 5));
			if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
			if (start < shiftEnd && end > shiftStart) {
				conflicts.push({ title: 'Already scheduled to work', startTime: start, endTime: end });
			}
		};

		if (view === 'month') {
			monthItems.forEach((item) => {
				if (item.kind === 'shift') existingShiftOverlap(item.raw);
				else if (
					item.kind === 'nanny-busy' &&
					item.ownerId === shiftForm.nannyId &&
					item.start < shiftEnd &&
					item.end > shiftStart
				) {
					conflicts.push({ title: item.title, startTime: item.start, endTime: item.end });
				}
			});
			return conflicts;
		}

		shifts.forEach(existingShiftOverlap);
		for (const event of nannyCalendarEvents[shiftForm.nannyId] || []) {
			if (event.startTime < shiftEnd && event.endTime > shiftStart) {
				conflicts.push({ title: event.title, startTime: event.startTime, endTime: event.endTime });
			}
		}
		return conflicts;
	}

	$: shiftConflicts =
		showAddShift && shiftForm && shifts && monthItems && nannyCalendarEvents
			? computeShiftConflicts()
			: [];

	/**
	 * @param {any[]} allShifts
	 * @param {any[]} allNannies
	 */
	function computeWeekSummary(allShifts, allNannies) {
		if (allShifts.length === 0) return null;

		/** @type {Record<string, { name: string, hours: number, rate: number }>} */
		const byNanny = {};
		let totalHours = 0;

		allShifts.forEach((shift) => {
			const startMin = timeToMinutes(shift.start_time);
			const endMin = timeToMinutes(shift.end_time);
			const hours = Math.max((endMin - startMin) / 60, 0);

			const id = shift.nanny_id;
			if (!byNanny[id]) {
				const nanny = allNannies.find((n) => n.id === id);
				byNanny[id] = {
					name: getNannyName(id),
					hours: 0,
					rate: nanny?.hourly_rate || 20
				};
			}
			byNanny[id].hours += hours;
			totalHours += hours;
		});

		const nannyBreakdown = Object.values(byNanny).map((n) => ({
			...n,
			cost: n.hours * n.rate
		}));

		const totalCost = nannyBreakdown.reduce((sum, n) => sum + n.cost, 0);

		return { totalHours, totalCost, nannyBreakdown };
	}

	$: weekSummaryView = view === 'week' ? computeWeekSummary(shifts, nannies) : null;

	function handleCalendarUpdate() {
		loadCalendarMeta();
		if (view === 'month') {
			loadMonthData();
		} else {
			loadCalendarEvents();
		}
	}

	function goToToday() {
		setCurrentWeek(0);
	}

	// --- Month view ---

	async function loadMonthData() {
		const token = ++monthLoadToken;
		monthLoading = true;
		monthError = null;

		try {
			const { gridStart, gridEnd, startStr, endStr } = getMonthGridRange(monthYear, monthMonth);
			const isNanny = profile?.role === 'nanny';
			const nannyScope = isNanny ? user.id : null;

			const [shiftRows, busyRows, manualRows, paymentRows] = await Promise.all([
				fetchShiftsInRange(supabase, startStr, endStr, nannyScope),
				fetchBusyEventsInRange(supabase, gridStart, gridEnd),
				isNanny ? Promise.resolve([]) : fetchManualBusyInRange(supabase, gridStart, gridEnd),
				fetchPaymentsDueInRange(supabase, startStr, endStr, nannyScope)
			]);

			if (token !== monthLoadToken) return;

			const familyIds = new Set(familyMembers.map((m) => m.id));
			const nannyIds = new Set(nannies.map((n) => n.id));

			// Nannies see their own shifts and their own busy events only.
			const scopedBusy = isNanny
				? busyRows.filter((e) => (e.parent_calendars?.user_id ?? e.user_id) === user.id)
				: busyRows;
			// Family view keeps week-view parity: manual rows from family members only.
			const scopedManual = isNanny ? [] : manualRows.filter((m) => familyIds.has(m.user_id));

			monthItems = toCalendarItems({
				shifts: shiftRows,
				busyEvents: scopedBusy,
				manualInstances: scopedManual,
				payments: paymentRows,
				familyIds: isNanny ? new Set() : familyIds,
				nannyIds: isNanny ? new Set([user.id]) : nannyIds,
				getNannyName
			});
			monthItemsByDay = groupItemsByDay(monthItems, gridStart, gridEnd);
			monthInitialized = true;
		} catch (err) {
			if (token !== monthLoadToken) return;
			console.error('[schedule] loadMonthData ERROR:', err);
			monthError = err?.message || 'Could not load the month.';
		} finally {
			if (token === monthLoadToken) monthLoading = false;
		}
	}

	/** @param {'prev'|'next'} direction */
	function changeMonth(direction) {
		const next = addMonths(monthYear, monthMonth, direction === 'prev' ? -1 : 1);
		monthYear = next.year;
		monthMonth = next.month;
		loadMonthData();
	}

	function monthGoToToday() {
		const now = new Date();
		selectedDateStr = localDateString(now);
		const changed = monthYear !== now.getFullYear() || monthMonth !== now.getMonth();
		monthYear = now.getFullYear();
		monthMonth = now.getMonth();
		if (changed) loadMonthData();
	}

	/** @param {'month'|'week'} next */
	async function setView(next) {
		if (next === view) return;
		view = next;
		if (next === 'week') {
			if (!currentWeekStart) await setCurrentWeek(0);
			await tick();
			scrollGridToNow();
		} else if (next === 'day') {
			await setCurrentDay(currentDay);
			await tick();
			scrollGridToNow();
		} else if (!monthInitialized) {
			await loadMonthData();
		}
	}

	/** @param {CustomEvent<{ dateStr: string }>} event */
	function handleSelectDay(event) {
		selectedDateStr = event.detail.dateStr;
	}

	/** @param {CustomEvent<{ dateStr: string }>} event */
	function handleAddShiftFromMonth(event) {
		openAddShift(parseLocalDate(event.detail.dateStr));
	}

	/** @param {CustomEvent<{ item: import('$lib/calendar.js').CalendarItem }>} event */
	function handleEditItemFromMonth(event) {
		const item = event.detail.item;
		if (item.kind === 'shift') editShift(item.raw);
	}
</script>

<Nav currentPage="schedule" />

<div class="schedule-page">
	{#if loading}
		<div class="loading">
			<div class="loading-spinner"></div>
			<span>Loading calendar...</span>
		</div>
	{:else}
		<!-- Top Bar -->
		<div class="top-bar">
			<div class="top-left">
				<h1>Calendar</h1>
				<span class="week-label">
					{#if view === 'month'}
						{MONTH_NAMES[monthMonth]} {monthYear}
					{:else if view === 'day'}
						{currentDay.toLocaleDateString('en-US', {
							weekday: 'long',
							month: 'long',
							day: 'numeric'
						})}
					{:else}
						{currentWeekStart?.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
					{/if}
				</span>
			</div>
			<div class="top-right">
				<div class="view-toggle" role="group" aria-label="Calendar view">
					<button
						type="button"
						class="toggle-btn"
						class:active={view === 'month'}
						aria-pressed={view === 'month'}
						on:click={() => setView('month')}
					>
						Month
					</button>
					<button
						type="button"
						class="toggle-btn"
						class:active={view === 'week'}
						aria-pressed={view === 'week'}
						on:click={() => setView('week')}
					>
						Week
					</button>
					<button
						type="button"
						class="toggle-btn"
						class:active={view === 'day'}
						aria-pressed={view === 'day'}
						on:click={() => setView('day')}
					>
						Day
					</button>
				</div>
				<button type="button" class="top-btn" on:click={() => (showCalendarManager = true)}>
					<Icon name="grimoire" size={16} />
					{profile?.role === 'nanny' ? 'My Availability' : 'Calendars'}
				</button>
				<div class="week-nav">
					<button
						type="button"
						class="nav-btn"
						aria-label="Previous {view}"
						on:click={() =>
							view === 'month'
								? changeMonth('prev')
								: view === 'day'
									? changeDay('prev')
									: changeWeek('prev')}
					>
						<Icon name="chevron-left" size={16} />
					</button>
					<button
						type="button"
						class="today-btn"
						on:click={() =>
							view === 'month' ? monthGoToToday() : view === 'day' ? dayGoToToday() : goToToday()}
					>
						Today
					</button>
					<button
						type="button"
						class="nav-btn"
						aria-label="Next {view}"
						on:click={() =>
							view === 'month'
								? changeMonth('next')
								: view === 'day'
									? changeDay('next')
									: changeWeek('next')}
					>
						<Icon name="chevron-right" size={16} />
					</button>
				</div>
			</div>
		</div>

		{#if calendarMeta.length > 0}
			<div class="sync-status" aria-label="Calendar sync status">
				<span class="sync-status-label">Feeds</span>
				{#each calendarMeta as cal (cal.id)}
					<button
						type="button"
						class="sync-chip"
						class:warn={!cal.sync_error && calAge(cal) > SYNC_WARN_AFTER_MS}
						class:failed={!!cal.sync_error}
						disabled={syncingCalId === cal.id}
						title={cal.sync_error ? `${cal.sync_error} — click to retry` : 'Click to sync now'}
						on:click={() => manualChipSync(cal)}
					>
						<span class="sync-chip-name">{calOwnerLabel(cal)}</span>
						<span class="sync-chip-age">
							{syncingCalId === cal.id ? 'syncing…' : syncAgeLabel(cal)}
						</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if view === 'month'}
			<!-- ── Month view ─────────────────────────────────── -->
			{#if monthError}
				<div class="month-error">
					<Icon name="warning" size={20} />
					<span>{monthError}</span>
					<button type="button" class="top-btn" on:click={loadMonthData}>Try again</button>
				</div>
			{:else if monthLoading && !monthInitialized}
				<div class="loading">
					<div class="loading-spinner"></div>
					<span>Reading the month...</span>
				</div>
			{:else}
				<div class="month-layout" class:refreshing={monthLoading}>
					<MonthGrid
						weeks={buildMonthGrid(monthYear, monthMonth, localDateString())}
						itemsByDay={monthItemsByDay}
						{selectedDateStr}
						on:selectday={handleSelectDay}
					/>
					<MonthSidePanel
						{selectedDateStr}
						selectedItems={monthItemsByDay[selectedDateStr] || []}
						upcoming={upcomingItems(monthItems)}
						todayStr={localDateString()}
						canEdit={profile?.role === 'family' || profile?.role === 'admin'}
						on:addshift={handleAddShiftFromMonth}
						on:edititem={handleEditItemFromMonth}
					/>
				</div>
			{/if}
		{/if}

		{#if view === 'week' || view === 'day'}
			<!-- Coverage Gap Alert -->
			{#if coverageGaps.length > 0}
				<div class="gap-banner">
					<Icon name="warning" size={16} />
					<span
						><strong>{coverageGaps.length} coverage gap{coverageGaps.length > 1 ? 's' : ''}</strong>
						this week &mdash; both parents busy with no nanny scheduled</span
					>
				</div>
			{/if}

			<!-- Week Summary -->
			{#if weekSummaryView}
				{@const summary = weekSummaryView}
				<div class="week-summary">
					{#if profile?.role === 'nanny'}
						<div class="summary-stat">
							<span class="summary-label">This week</span>
							<span class="summary-value">{summary.totalHours.toFixed(1)}h</span>
						</div>
						<div class="summary-divider"></div>
						<div class="summary-stat">
							<span class="summary-label">Est. income</span>
							<span class="summary-value summary-income">${summary.totalCost.toFixed(2)}</span>
						</div>
					{:else}
						<div class="summary-stat">
							<span class="summary-label">Scheduled</span>
							<span class="summary-value">{summary.totalHours.toFixed(1)}h</span>
						</div>
						<div class="summary-divider"></div>
						{#each summary.nannyBreakdown as nanny}
							<div class="summary-stat">
								<span class="summary-label">{nanny.name}</span>
								<span class="summary-detail"
									>{nanny.hours.toFixed(1)}h &times; ${nanny.rate}/hr</span
								>
							</div>
						{/each}
						<div class="summary-divider"></div>
						<div class="summary-stat">
							<span class="summary-label">Est. cost</span>
							<span class="summary-value summary-cost">${summary.totalCost.toFixed(2)}</span>
						</div>
					{/if}
				</div>
			{/if}

			{#if view === 'day'}
				<div class="day-window-bar">
					<button type="button" class="window-toggle" on:click={() => (showFullDay = !showFullDay)}>
						{#if showFullDay}
							Hide night hours
						{:else}
							Show full day{dayHiddenCount > 0
								? ` · ${dayHiddenCount} hidden item${dayHiddenCount > 1 ? 's' : ''}`
								: ''}
						{/if}
					</button>
				</div>
			{/if}

			<!-- Time Grid Calendar -->
			<div class="calendar-wrapper">
				<div class="time-grid" class:single-day={view === 'day'}>
					<!-- Day Headers — column count follows gridDays (7, 3 on mobile, 1 in Day view) -->
					<div
						class="grid-header"
						style="grid-template-columns: 62px repeat({gridDays.length}, 1fr)"
					>
						<div class="time-gutter-header"></div>
						{#each gridDays as day (ymd(day))}
							<div class="day-col-header" class:today={isToday(day)}>
								<span class="day-label"
									>{day.toLocaleDateString('en-US', { weekday: 'short' })}</span
								>
								<span class="day-num" class:today-num={isToday(day)}>{day.getDate()}</span>
							</div>
						{/each}
					</div>

					<!-- Scrollable Grid Body -->
					<div
						class="grid-body"
						style="grid-template-columns: 62px repeat({gridDays.length}, 1fr)"
						on:touchstart={handleTouchStart}
						on:touchend={handleTouchEnd}
					>
						<!-- Time Gutter -->
						<div class="time-gutter">
							{#each Array(windowHours) as _, i (i)}
								<div class="time-slot" style="height: {HOUR_HEIGHT}px">
									<span class="time-text">{formatHour(windowStartHour + i)}</span>
								</div>
							{/each}
						</div>

						<!-- Day Columns -->
						{#each gridDays as day, dayIdx (ymd(day))}
							<div
								class="day-col"
								class:today-col={isToday(day)}
								on:click={(e) => handleDayClick(e, day)}
								on:mousemove={(e) => handleDayMouseMove(e, dayIdx)}
								on:mouseleave={() => (hoveredSlot = null)}
							>
								<!-- Zebra hour backgrounds -->
								{#each Array(windowHours) as _, i}
									<div
										class="hour-bg"
										class:hour-even={i % 2 === 0}
										style="top: {i * HOUR_HEIGHT}px; height: {HOUR_HEIGHT}px"
									></div>
								{/each}

								<!-- Grid lines: hour (solid), half-hour (dashed), quarter-hour (dotted) -->
								{#each Array(windowHours) as _, i}
									<div class="hour-line" style="top: {i * HOUR_HEIGHT}px"></div>
									<div class="quarter-line" style="top: {i * HOUR_HEIGHT + SLOT_HEIGHT}px"></div>
									<div class="half-line" style="top: {i * HOUR_HEIGHT + SLOT_HEIGHT * 2}px"></div>
									<div
										class="quarter-line"
										style="top: {i * HOUR_HEIGHT + SLOT_HEIGHT * 3}px"
									></div>
								{/each}

								<!-- Hover indicator for clickable slot -->
								{#if hoveredSlot && hoveredSlot.dayIdx === dayIdx}
									<div
										class="slot-hover"
										style="top: {((hoveredSlot.hour * 60 +
											hoveredSlot.minute -
											windowStartHour * 60) /
											60) *
											HOUR_HEIGHT}px; height: {SLOT_HEIGHT}px"
									>
										<span class="slot-hover-label">
											<Icon name="plus" size={16} />
											{formatTime15(hoveredSlot.hour, hoveredSlot.minute)}
										</span>
									</div>
								{/if}

								<!-- Current time indicator -->
								{#if isToday(day) && nowLineVisible}
									<div class="now-line" style="top: {nowLinePosition}px">
										<div class="now-dot"></div>
									</div>
								{/if}

								<!-- All blocks for the day: shifts and busy overlays, clipped to
								     this day and lane-packed so concurrent things sit side by
								     side instead of hiding each other. -->
								{#each dayLayouts[ymd(day)] || [] as block (block.key)}
									{#if block.type === 'shift'}
										<div
											class="shift-block"
											class:shift-editable={profile?.role === 'family' || profile?.role === 'admin'}
											style={blockStyle(block, windowStartHour, windowEndHour)}
											on:click|stopPropagation={() => {
												if (profile?.role === 'family' || profile?.role === 'admin')
													editShift(block.shift);
											}}
											title={profile?.role === 'family' || profile?.role === 'admin'
												? 'Click to edit'
												: ''}
										>
											<div class="shift-content">
												<span class="shift-name">{getNannyName(block.shift.nanny_id)}</span>
												<span class="shift-time"
													>{formatTime(block.shift.start_time)} - {formatTime(
														block.shift.end_time
													)}</span
												>
												{#if block.shift.notes}
													<span class="shift-note">{block.shift.notes}</span>
												{/if}
											</div>
											{#if profile?.role === 'family' || profile?.role === 'admin'}
												<button
													class="shift-delete"
													on:click|stopPropagation={() => deleteShift(block.shift.id)}
													title="Remove shift"
												>
													<Icon name="close" size={16} />
												</button>
											{/if}
										</div>
									{:else if block.type === 'nanny'}
										<div
											class="cal-event cal-event-nanny"
											style="{blockStyle(
												block,
												windowStartHour,
												windowEndHour
											)} border-left-color: {block.event.color || '#e0664e'};"
											title="{getNannyName(block.nannyId)}: {block.event.title} (unavailable)"
											on:click|stopPropagation
										>
											<span class="cal-event-owner">{getNannyName(block.nannyId)}</span>
											<span class="cal-event-title">{block.event.title}</span>
										</div>
									{:else}
										<div
											class="cal-event"
											class:cal-event-you={block.type === 'you'}
											class:cal-event-partner={block.type === 'partner'}
											style="{blockStyle(
												block,
												windowStartHour,
												windowEndHour
											)} border-left-color: {block.event.color};"
											title="{block.type === 'you' ? 'You' : getPartnerName()}: {block.event.title}"
											on:click|stopPropagation
										>
											<span class="cal-event-owner"
												>{block.type === 'you' ? 'You' : getPartnerName()}</span
											>
											<span class="cal-event-title">{block.event.title}</span>
										</div>
									{/if}
								{/each}
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
					<span class="legend-hint">Click a time slot to add a shift</span>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<!-- Calendar Manager Modal -->
{#if showCalendarManager}
	<div class="modal-overlay" on:click={() => (showCalendarManager = false)}>
		<div class="modal-panel" on:click|stopPropagation>
			<div class="modal-top">
				<h2>{profile?.role === 'nanny' ? 'My Availability' : 'Manage Calendars'}</h2>
				<button class="modal-close" on:click={() => (showCalendarManager = false)}>
					<Icon name="close" size={16} />
				</button>
			</div>

			{#if profile?.role === 'nanny'}
				<p class="modal-desc">
					Connect your personal calendar so your family can see when you're unavailable. Only
					busy/free status is shared — event details stay private.
				</p>
			{/if}

			<CalendarManager userId={user.id} onUpdate={handleCalendarUpdate} />

			{#if profile?.role === 'family' || profile?.role === 'admin'}
				{#if familyMembers.length > 1}
					{@const partner = familyMembers.find((m) => m.id !== user.id)}
					{#if partner}
						<div class="partner-section">
							<h3>{partner.full_name}'s Calendars</h3>
							<CalendarManager userId={partner.id} onUpdate={handleCalendarUpdate} />
						</div>
					{/if}
				{/if}

				{#if nannies.length > 0}
					<div class="partner-section">
						<h3>Nanny Calendars</h3>
						<p class="section-desc">
							These calendars are managed by your nannies. Their busy times appear on the schedule
							grid so you can avoid conflicts.
						</p>
						{#each nannies as nanny}
							<div class="nanny-cal-section">
								<h4>{nanny.full_name}</h4>
								<CalendarManager userId={nanny.id} onUpdate={handleCalendarUpdate} />
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}

<!-- Add/Edit Shift Modal -->
{#if showAddShift}
	<div class="modal-overlay" on:click={resetShiftForm}>
		<div class="modal-panel compact" on:click|stopPropagation>
			<div class="modal-top">
				<h2>{editingShiftId ? 'Edit Shift' : 'Add Nanny Shift'}</h2>
				<button class="modal-close" on:click={resetShiftForm}>
					<Icon name="close" size={16} />
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

				{#if shiftConflicts.length > 0}
					<div class="conflict-warning">
						<Icon name="warning" size={16} />
						<div class="conflict-text">
							<strong>Heads up</strong> &mdash; {getNannyName(shiftForm.nannyId)} has {shiftConflicts.length ===
							1
								? 'something'
								: `${shiftConflicts.length} things`} in the way of this time:
							<ul class="conflict-list">
								{#each shiftConflicts as conflict, i (i)}
									<li>
										"{conflict.title}" ({conflict.startTime.toLocaleTimeString('en-US', {
											hour: 'numeric',
											minute: '2-digit'
										})} - {conflict.endTime.toLocaleTimeString('en-US', {
											hour: 'numeric',
											minute: '2-digit'
										})})
									</li>
								{/each}
							</ul>
							<span class="conflict-hint"
								>You may want to check with them before booking this time.</span
							>
						</div>
					</div>
				{/if}

				<div class="form-field">
					<label>Notes <span class="optional">(optional)</span></label>
					<input
						type="text"
						bind:value={shiftForm.notes}
						placeholder="e.g., Park day, early pickup"
					/>
				</div>

				<div class="form-actions">
					<button type="submit" class="btn-save"
						>{editingShiftId ? 'Update Shift' : 'Save Shift'}</button
					>
					<button type="button" class="btn-cancel" on:click={resetShiftForm}>Cancel</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	.schedule-page {
		width: min(100%, 1400px);
		margin: 0 auto;
		padding: clamp(1rem, 3vw, 2rem);
		padding-bottom: calc(84px + var(--safe-bottom));
		position: relative;
		z-index: 1;
	}

	.loading {
		min-height: 60vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		color: var(--text-muted);
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.loading-spinner {
		width: 44px;
		height: 44px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-right-color: var(--accent-dim);
		border-radius: 50%;
		animation: spin 1.1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── Top bar ──────────────────────────────────────────── */
	.top-bar {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1.15rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border-soft);
	}

	.top-left h1 {
		font-family: var(--font-display);
		color: var(--accent-bright);
	}

	.week-label {
		display: block;
		margin-top: 0.15rem;
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.top-right {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.top-btn,
	.today-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 38px;
		padding: 0.4rem 0.9rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		font-family: var(--font-body);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		cursor: pointer;
		transition: all var(--transition-fast);
		--icon-accent: var(--accent);
	}

	.top-btn:hover,
	.today-btn:hover {
		color: var(--accent-bright);
		border-color: var(--border-gilt);
		background: var(--accent-tint);
	}

	.week-nav {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
	}

	.nav-btn {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		min-height: 34px;
		padding: 0;
		background: none;
		border: none;
		border-radius: 6px;
		color: var(--text-muted);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.nav-btn:hover {
		color: var(--accent-bright);
		background: var(--accent-tint);
	}

	/* ── Sync freshness chips ─────────────────────────────── */
	.sync-status {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		margin: -0.35rem 0 0.9rem;
	}

	.sync-status-label {
		font-family: var(--font-body);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.sync-chip {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4rem;
		min-height: 28px;
		padding: 0.2rem 0.65rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: 999px;
		color: var(--text-muted);
		font-family: var(--font-body);
		font-size: 0.72rem;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.sync-chip:hover {
		border-color: var(--border-gilt);
		color: var(--text);
	}

	.sync-chip:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.sync-chip-name {
		font-weight: 700;
	}

	.sync-chip-age {
		color: var(--growing);
	}

	.sync-chip.warn .sync-chip-age {
		color: var(--accent-bright);
		font-weight: 700;
	}

	.sync-chip.failed {
		border-color: var(--danger);
		background: var(--danger-dim);
	}

	.sync-chip.failed .sync-chip-age {
		color: var(--danger);
		font-weight: 700;
	}

	/* ── View toggle ──────────────────────────────────────── */
	.view-toggle {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.2rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
	}

	.toggle-btn {
		min-height: 34px;
		padding: 0.3rem 0.85rem;
		background: none;
		border: none;
		border-radius: 6px;
		color: var(--text-muted);
		font-family: var(--font-body);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.toggle-btn:hover {
		color: var(--accent-bright);
	}

	.toggle-btn.active {
		background: var(--accent-dim);
		color: var(--accent-bright);
	}

	/* ── Month layout ─────────────────────────────────────── */
	.month-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: var(--grid-gap);
		align-items: start;
		transition: opacity var(--transition-fast);
	}

	.month-layout.refreshing {
		opacity: 0.75;
	}

	@media (max-width: 1024px) {
		.month-layout {
			grid-template-columns: 1fr;
		}
	}

	.month-error {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		flex-wrap: wrap;
		padding: 1rem 1.2rem;
		background: var(--danger-dim);
		border: 1px solid var(--danger);
		border-radius: var(--card-radius);
		color: var(--danger);
		--icon-accent: var(--danger);
	}

	/* ── Banners ──────────────────────────────────────────── */
	.gap-banner {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.8rem 1rem;
		margin-bottom: 1rem;
		background: var(--danger-dim);
		border: 1px solid var(--danger);
		border-radius: var(--radius-sm);
		color: var(--danger);
		font-size: 0.92rem;
		--icon-accent: var(--danger);
	}

	.week-summary {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		flex-wrap: wrap;
		padding: 0.9rem 1.15rem;
		margin-bottom: 1rem;
		background: var(--surface);
		background-image: linear-gradient(150deg, var(--accent-tint), transparent 50%);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
	}

	.summary-stat {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.summary-label {
		font-family: var(--font-body);
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.summary-value {
		font-size: 1.15rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.summary-income,
	.summary-cost {
		color: var(--accent-bright);
	}

	.summary-detail {
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}

	.summary-divider {
		width: 1px;
		align-self: stretch;
		background: var(--border-soft);
	}

	/* ── Time grid ────────────────────────────────────────── */
	.calendar-wrapper {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--card-radius);
		overflow: hidden;
		box-shadow: var(--shadow-md);
	}

	.time-grid {
		display: flex;
		flex-direction: column;
	}

	/* Desktop keeps a floor so seven columns stay readable; mobile's 3-day
	   grid fits the viewport instead of forcing a sideways scroll. */
	@media (min-width: 769px) {
		.time-grid {
			min-width: 720px;
		}
	}

	/* One day doesn't need fourteen hundred pixels — cap and center it. */
	.time-grid.single-day {
		min-width: 0;
		width: 100%;
		max-width: 760px;
		margin: 0 auto;
	}

	/* ── Day view window toggle ───────────────────────────── */
	.day-window-bar {
		display: flex;
		justify-content: center;
		margin-bottom: 0.75rem;
	}

	.window-toggle {
		min-height: 32px;
		padding: 0.3rem 0.9rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: 999px;
		color: var(--text-muted);
		font-family: var(--font-body);
		font-size: 0.76rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.window-toggle:hover {
		color: var(--accent-bright);
		border-color: var(--border-gilt);
		background: var(--accent-tint);
	}

	.grid-header {
		display: grid;
		grid-template-columns: 62px repeat(7, 1fr);
		background: var(--surface-2);
		border-bottom: 1px solid var(--border-gilt);
		position: sticky;
		top: 0;
		z-index: 20;
	}

	.time-gutter-header {
		border-right: 1px solid var(--border-soft);
	}

	.day-col-header {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
		padding: 0.6rem 0.25rem;
		border-right: 1px solid var(--border-soft);
	}

	.day-col-header:last-child {
		border-right: none;
	}

	.day-label {
		font-family: var(--font-body);
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.day-num {
		font-size: 1.05rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}

	/* Today gets a gilt coin behind its date. */
	.day-col-header.today .day-label {
		color: var(--accent);
	}

	.day-num.today-num {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: var(--accent);
		color: var(--text-on-accent);
		box-shadow: 0 0 14px var(--accent-dim);
	}

	.grid-body {
		display: grid;
		grid-template-columns: 62px repeat(7, 1fr);
		max-height: 68vh;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}

	.time-gutter {
		border-right: 1px solid var(--border-soft);
		background: var(--surface-2);
	}

	.time-slot {
		position: relative;
		border-bottom: 1px solid var(--border-soft);
	}

	.time-text {
		position: absolute;
		top: -0.55rem;
		right: 0.4rem;
		font-family: var(--font-body);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--text-faint);
		background: var(--surface-2);
		padding: 0 0.2rem;
	}

	.day-col {
		position: relative;
		border-right: 1px solid var(--border-soft);
		cursor: pointer;
	}

	.day-col:last-child {
		border-right: none;
	}

	.day-col.today-col {
		background: var(--accent-tint);
	}

	.hour-bg {
		position: absolute;
		left: 0;
		right: 0;
		pointer-events: none;
	}

	.hour-bg.hour-even {
		background: rgba(255, 255, 255, 0.012);
	}

	.hour-line,
	.half-line,
	.quarter-line {
		position: absolute;
		left: 0;
		right: 0;
		pointer-events: none;
	}

	.hour-line {
		border-top: 1px solid var(--border-soft);
	}

	.half-line {
		border-top: 1px dashed var(--border-soft);
		opacity: 0.5;
	}

	.quarter-line {
		border-top: 1px dotted var(--border-soft);
		opacity: 0.28;
	}

	.slot-hover {
		position: absolute;
		left: 2px;
		right: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent-dim);
		border: 1px dashed var(--accent);
		border-radius: 4px;
		pointer-events: none;
		z-index: 5;
	}

	.slot-hover-label {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.68rem;
		font-weight: 700;
		color: var(--accent-bright);
		--icon-accent: var(--accent-bright);
	}

	/* The current moment, drawn as a glowing thread across today. */
	.now-line {
		position: absolute;
		left: 0;
		right: 0;
		height: 0;
		border-top: 2px solid var(--danger);
		z-index: 15;
		pointer-events: none;
		box-shadow: 0 0 10px var(--danger);
	}

	.now-dot {
		position: absolute;
		top: -4px;
		left: -3px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--danger);
		box-shadow: 0 0 8px var(--danger);
	}

	/* ── Events ───────────────────────────────────────────── */
	/* left/width come from the lane-packing inline style. */
	.cal-event {
		position: absolute;
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		padding: 0.2rem 0.35rem;
		overflow: hidden;
		border-left: 3px solid var(--arcane);
		border-radius: 3px;
		background: var(--arcane-dim);
		font-size: 0.68rem;
		line-height: 1.25;
		z-index: 6;
	}

	.cal-event-you {
		background: var(--arcane-dim);
	}

	.cal-event-partner {
		background: rgba(168, 119, 232, 0.09);
	}

	.cal-event-nanny {
		background: var(--danger-dim);
	}

	.cal-event-owner {
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		font-size: 0.6rem;
		color: var(--text-faint);
	}

	.cal-event-title {
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Nanny shifts are the things that grow — moss green, solid. */
	/* left/width come from the lane-packing inline style. */
	.shift-block {
		position: absolute;
		display: flex;
		justify-content: space-between;
		gap: 0.25rem;
		padding: 0.3rem 0.4rem;
		overflow: hidden;
		background: linear-gradient(150deg, rgba(111, 191, 115, 0.28), rgba(62, 122, 70, 0.22));
		border: 1px solid rgba(111, 191, 115, 0.55);
		border-radius: 5px;
		z-index: 10;
		transition: all var(--transition-fast);
	}

	.shift-editable {
		cursor: pointer;
	}

	.shift-editable:hover {
		border-color: var(--growing);
		box-shadow: var(--glow-moss);
	}

	.shift-content {
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		min-width: 0;
	}

	.shift-name {
		font-family: var(--font-display);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--growing);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.shift-time {
		font-size: 0.65rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}

	.shift-note {
		font-size: 0.62rem;
		font-style: italic;
		color: var(--text-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.shift-delete {
		flex-shrink: 0;
		align-self: flex-start;
		width: 20px;
		height: 20px;
		min-height: 20px;
		display: grid;
		place-items: center;
		padding: 0;
		background: none;
		border: none;
		border-radius: 4px;
		color: var(--text-faint);
		cursor: pointer;
		opacity: 0;
		transition: all var(--transition-fast);
	}

	.shift-block:hover .shift-delete {
		opacity: 1;
	}

	.shift-delete:hover {
		color: var(--danger);
		background: var(--danger-dim);
	}

	/* ── Legend ───────────────────────────────────────────── */
	.legend {
		display: flex;
		align-items: center;
		gap: 1.15rem;
		flex-wrap: wrap;
		margin-top: 1rem;
		padding: 0.75rem 1rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.legend-swatch {
		width: 14px;
		height: 14px;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.shift-swatch {
		background: rgba(111, 191, 115, 0.4);
		border: 1px solid var(--growing);
	}

	.you-swatch {
		background: var(--arcane-dim);
		border-left: 3px solid var(--arcane);
	}

	.partner-swatch {
		background: rgba(168, 119, 232, 0.09);
		border-left: 3px solid var(--arcane);
	}

	.nanny-busy-swatch {
		background: var(--danger-dim);
		border-left: 3px solid var(--danger);
	}

	.legend-hint {
		margin-left: auto;
		font-style: italic;
		color: var(--text-faint);
	}

	/* ── Modals ───────────────────────────────────────────── */
	.modal-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.15rem;
		padding-bottom: 0.85rem;
		border-bottom: 1px solid var(--border-soft);
	}

	.modal-top h2 {
		margin: 0;
		padding: 0;
		border: none;
		font-family: var(--font-display);
		font-size: 1.2rem;
		letter-spacing: 0.04em;
		color: var(--accent-bright);
	}

	.modal-close {
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		min-height: 38px;
		padding: 0;
		background: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.modal-close:hover {
		color: var(--danger);
		border-color: var(--danger);
	}

	.modal-panel {
		max-width: min(720px, calc(100vw - 2rem));
	}

	.modal-panel.compact {
		max-width: min(460px, calc(100vw - 2rem));
	}

	.modal-desc,
	.section-desc {
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--text-faint);
		margin-bottom: 1.15rem;
	}

	.partner-section {
		margin-top: 1.5rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--border-soft);
	}

	.partner-section h3,
	.nanny-cal-section h4 {
		font-family: var(--font-display);
		letter-spacing: 0.04em;
		color: var(--accent-bright);
		margin-bottom: 0.6rem;
	}

	.nanny-cal-section {
		margin-top: 1.15rem;
	}

	.form-row-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.optional {
		text-transform: none;
		letter-spacing: normal;
		font-weight: 400;
		opacity: 0.7;
	}

	.conflict-warning {
		display: flex;
		gap: 0.7rem;
		padding: 0.85rem 1rem;
		margin-bottom: 1.15rem;
		background: var(--danger-dim);
		border: 1px solid var(--danger);
		border-radius: var(--radius-sm);
		color: var(--danger);
		font-size: 0.88rem;
		line-height: 1.5;
		--icon-accent: var(--danger);
	}

	.conflict-list {
		margin: 0.4rem 0 0.4rem 1.1rem;
		color: var(--text-muted);
	}

	.conflict-hint {
		display: block;
		font-style: italic;
		color: var(--text-faint);
	}

	.form-actions {
		display: flex;
		gap: 0.6rem;
		margin-top: 1.25rem;
	}

	.btn-save,
	.btn-cancel {
		flex: 1;
		min-height: 44px;
		padding: 0.65rem 1.1rem;
		border-radius: var(--radius-sm);
		font-family: var(--font-body);
		font-size: 0.95rem;
		font-weight: 700;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-save {
		background: linear-gradient(160deg, var(--accent-bright), var(--accent));
		border: 1px solid var(--accent);
		color: var(--text-on-accent);
	}

	.btn-save:hover {
		box-shadow: var(--glow-gilt);
	}

	.btn-cancel {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text-muted);
	}

	.btn-cancel:hover {
		border-color: var(--border-gilt);
		color: var(--accent-bright);
		background: var(--accent-tint);
	}

	/* ── Mobile ───────────────────────────────────────────── */
	@media (max-width: 768px) {
		.calendar-wrapper {
			overflow-x: auto;
			-webkit-overflow-scrolling: touch;
		}

		.top-bar {
			align-items: flex-start;
		}

		.top-right {
			width: 100%;
			justify-content: space-between;
		}

		.legend {
			font-size: 0.75rem;
			gap: 0.75rem;
		}

		.legend-hint {
			margin-left: 0;
			width: 100%;
		}

		.form-row-2 {
			grid-template-columns: 1fr;
		}
	}
</style>
