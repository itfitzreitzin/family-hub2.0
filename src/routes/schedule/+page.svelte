<script>
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabase';
	import Nav from '$lib/Nav.svelte';
	import CalendarManager from '$lib/components/CalendarManager.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { goto } from '$app/navigation';
	import { toast, confirm as confirmModal } from '$lib/stores/toast.js';

	let user = null;
	let profile = null;
	let currentWeekStart = null;
	let weekOffset = 0;
	let shifts = [];
	let loading = true;
	let showAddShift = false;
	let showCalendarManager = false;
	let nannies = [];
	let editingShiftId = null;
	let isMobile = false;

	let shiftForm = {
		nannyId: null,
		date: '',
		startTime: '09:00',
		endTime: '17:00',
		notes: ''
	};
	let weekSummary = null;

	// Calendar data
	let parentCalendarEvents = {
		you: [],
		partner: []
	};
	let nannyCalendarEvents = {}; // keyed by nanny_id -> array of events
	let familyMembers = [];

	// Time grid config
	const DAY_START_HOUR = 0;
	const DAY_END_HOUR = 24;
	const TOTAL_HOURS = DAY_END_HOUR - DAY_START_HOUR;
	const HOUR_HEIGHT = 60; // px per hour
	const SLOT_MINUTES = 15;
	const SLOT_HEIGHT = HOUR_HEIGHT / (60 / SLOT_MINUTES); // 15px

	let hoveredSlot = null;

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

		await setCurrentWeek(0);
		loading = false;

		// Prevent body from scrolling — only the grid body should scroll
		document.body.classList.add('schedule-active');

		// Mobile detection
		const mql = window.matchMedia('(max-width: 768px)');
		isMobile = mql.matches;
		const handleResize = (e) => {
			isMobile = e.matches;
		};
		mql.addEventListener('change', handleResize);
		mqlCleanup = () => mql.removeEventListener('change', handleResize);

		// Auto-scroll grid to current hour
		setTimeout(() => {
			const gridBody = document.querySelector('.grid-body');
			if (gridBody) {
				const scrollToHour = Math.max(new Date().getHours() - 1, 0);
				gridBody.scrollTop = scrollToHour * HOUR_HEIGHT;
			}
		}, 50);
	});

	let mqlCleanup = null;
	onDestroy(() => {
		if (typeof document !== 'undefined') {
			document.body.classList.remove('schedule-active');
		}
		if (mqlCleanup) mqlCleanup();
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

	async function loadParentCalendarEvents() {
		if (!currentWeekStart || familyMembers.length === 0) {
			console.log(
				'[schedule] loadParentCalendarEvents SKIPPED — currentWeekStart:',
				!!currentWeekStart,
				'familyMembers:',
				familyMembers.length
			);
			return;
		}

		const weekEnd = new Date(currentWeekStart);
		weekEnd.setDate(weekEnd.getDate() + 6);
		weekEnd.setHours(23, 59, 59, 999);

		try {
			const { data: events, error } = await supabase
				.from('calendar_events')
				.select(
					`
          *,
          parent_calendars!inner (
            calendar_name,
            color,
            sync_enabled,
            user_id
          )
        `
				)
				.gte('start_time', currentWeekStart.toISOString())
				.lte('start_time', weekEnd.toISOString())
				.eq('is_busy', true)
				.eq('parent_calendars.sync_enabled', true)
				.order('start_time');

			if (error) throw error;

			// Fetch non-recurring manual busy times within this week,
			// plus all recurring events (their start_time is the first occurrence,
			// which may be in the past, so we can't filter by date range).
			const { data: manualTimes, error: manualError } = await supabase
				.from('manual_busy_times')
				.select('*')
				.or(
					`and(start_time.gte.${currentWeekStart.toISOString()},start_time.lte.${weekEnd.toISOString()}),recurring.eq.true`
				);

			if (manualError) throw manualError;

			const recurringEvents = await processRecurringEvents(
				manualTimes || [],
				currentWeekStart,
				weekEnd
			);

			const newParentEvents = { you: [], partner: [] };

			const youId = user.id;
			const partnerId = familyMembers.find((m) => m.id !== youId)?.id;

			(events || []).forEach((event) => {
				const eventData = {
					title: event.title,
					startTime: new Date(event.start_time),
					endTime: new Date(event.end_time),
					color: event.parent_calendars.color,
					calendarName: event.parent_calendars.calendar_name
				};

				if (event.parent_calendars.user_id === youId) {
					newParentEvents.you.push(eventData);
				} else if (event.parent_calendars.user_id === partnerId) {
					newParentEvents.partner.push(eventData);
				}
			});

			recurringEvents.forEach((event) => {
				const eventData = {
					title: event.title,
					startTime: new Date(event.start_time),
					endTime: new Date(event.end_time),
					color: '#718096',
					calendarName: 'Manual Entry'
				};

				if (event.user_id === youId) {
					newParentEvents.you.push(eventData);
				} else if (event.user_id === partnerId) {
					newParentEvents.partner.push(eventData);
				}
			});

			console.log(
				'[schedule] loadParentCalendarEvents: DB events=',
				(events || []).length,
				'recurring=',
				recurringEvents.length,
				'you=',
				newParentEvents.you.length,
				'partner=',
				newParentEvents.partner.length,
				'range=',
				currentWeekStart.toISOString(),
				'to',
				weekEnd.toISOString()
			);
			parentCalendarEvents = newParentEvents;
		} catch (err) {
			console.error('[schedule] loadParentCalendarEvents ERROR:', err);
			parentCalendarEvents = { you: [], partner: [] };
		}
	}

	async function loadCalendarEvents() {
		if (profile?.role === 'family' || profile?.role === 'admin') {
			await loadParentCalendarEvents();
			await loadNannyCalendarEvents();
		} else if (profile?.role === 'nanny') {
			await loadNannyCalendarEvents();
		}
	}

	async function loadNannyCalendarEvents() {
		if (!currentWeekStart) return;

		const weekEnd = new Date(currentWeekStart);
		weekEnd.setDate(weekEnd.getDate() + 6);
		weekEnd.setHours(23, 59, 59, 999);

		try {
			// Build the query — family sees all nanny events, nannies see only their own
			let query = supabase
				.from('calendar_events')
				.select(
					`
          *,
          parent_calendars!inner (
            calendar_name,
            color,
            sync_enabled,
            user_id
          )
        `
				)
				.gte('start_time', currentWeekStart.toISOString())
				.lte('start_time', weekEnd.toISOString())
				.eq('is_busy', true)
				.eq('parent_calendars.sync_enabled', true)
				.order('start_time');

			const { data: events, error } = await query;
			if (error) throw error;

			// Get the set of nanny IDs
			const nannyIds = new Set(nannies.map((n) => n.id));

			// Reset and populate nanny events
			const newNannyEvents = {};
			(events || []).forEach((event) => {
				const ownerId = event.parent_calendars.user_id;
				if (!nannyIds.has(ownerId)) return;

				if (!newNannyEvents[ownerId]) {
					newNannyEvents[ownerId] = [];
				}

				newNannyEvents[ownerId].push({
					title: event.title,
					startTime: new Date(event.start_time),
					endTime: new Date(event.end_time),
					color: event.parent_calendars.color,
					calendarName: event.parent_calendars.calendar_name,
					nannyId: ownerId
				});
			});

			console.log(
				'[schedule] loadNannyCalendarEvents:',
				(events || []).length,
				'DB events, matched',
				Object.values(newNannyEvents).flat().length,
				'nanny events'
			);
			nannyCalendarEvents = newNannyEvents;
		} catch (err) {
			console.error('[schedule] loadNannyCalendarEvents ERROR:', err);
			nannyCalendarEvents = {};
		}
	}

	async function processRecurringEvents(manualTimes, weekStart, weekEnd) {
		const recurringEvents = [];
		for (const manual of manualTimes.filter((m) => m.recurring)) {
			const instances = generateRecurringInstances(manual, weekStart, weekEnd);
			recurringEvents.push(...instances);
		}
		return recurringEvents;
	}

	function generateRecurringInstances(event, weekStart, weekEnd) {
		const instances = [];
		const startDate = new Date(event.start_time);
		const endDate = new Date(event.end_time);
		const duration = endDate - startDate;

		if (event.recurring_pattern === 'weekly' || event.recurring_pattern === 'biweekly') {
			for (let i = 0; i < 7; i++) {
				const d = new Date(weekStart);
				d.setDate(d.getDate() + i);
				const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

				if (event.recurring_days && event.recurring_days.includes(dayName)) {
					const weeksDiff = Math.floor((d - startDate) / (7 * 24 * 60 * 60 * 1000));

					if (event.recurring_pattern === 'weekly' || weeksDiff % 2 === 0) {
						if (!event.recurring_until || d <= new Date(event.recurring_until)) {
							const instanceStart = new Date(d);
							instanceStart.setHours(startDate.getHours(), startDate.getMinutes(), 0);
							const instanceEnd = new Date(instanceStart.getTime() + duration);

							instances.push({
								...event,
								start_time: instanceStart.toISOString(),
								end_time: instanceEnd.toISOString()
							});
						}
					}
				}
			}
		}

		return instances;
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

	function normalizeDateValue(value) {
		if (!value) return '';
		if (value instanceof Date) return ymd(value);
		if (typeof value === 'string') return value.length > 10 ? value.slice(0, 10) : value;
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? '' : ymd(parsed);
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

			if (profile?.role === 'family' || profile?.role === 'admin') {
				await loadWeekSummary();
			} else {
				weekSummary = null;
			}
		} catch (err) {
			console.error('[schedule] loadShifts ERROR:', err);
			shifts = [];
		}
	}

	async function loadWeekSummary() {
		if (!currentWeekStart) return;

		const weekStartDate = new Date(currentWeekStart);
		weekStartDate.setHours(0, 0, 0, 0);

		const { data, error } = await supabase
			.from('weekly_coverage_summary')
			.select('*')
			.gte('week_start', weekStartDate.toISOString())
			.lt('week_start', new Date(weekStartDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString())
			.maybeSingle();

		if (!error) weekSummary = data;
	}

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

			// Navigate to the week containing the saved shift so it's visible
			const shiftDate = new Date(savedDate + 'T00:00:00');
			const weekEnd = new Date(currentWeekStart);
			weekEnd.setDate(weekEnd.getDate() + 6);

			if (shiftDate < currentWeekStart || shiftDate > weekEnd) {
				// Calculate the week offset for the shift's week
				const now = new Date();
				const currentSunday = new Date(now);
				currentSunday.setDate(now.getDate() - now.getDay());
				currentSunday.setHours(0, 0, 0, 0);

				const shiftSunday = new Date(shiftDate);
				shiftSunday.setDate(shiftDate.getDate() - shiftDate.getDay());
				shiftSunday.setHours(0, 0, 0, 0);

				const newOffset = Math.round((shiftSunday - currentSunday) / (7 * 24 * 60 * 60 * 1000));
				await setCurrentWeek(newOffset);
			} else {
				// Same week — just reload data via setCurrentWeek
				await setCurrentWeek(weekOffset);
			}

			toast.success(isEditing ? 'Shift updated!' : 'Shift saved!');
		} catch (err) {
			toast.error('Error: ' + err.message);
		}
	}

	function getWeekDays() {
		if (!currentWeekStart) return [];
		const days = [];
		if (isMobile) {
			// 3-day view centered on today (or week start if today is outside this week)
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const weekEnd = new Date(currentWeekStart);
			weekEnd.setDate(weekEnd.getDate() + 6);

			let center;
			if (today >= currentWeekStart && today <= weekEnd) {
				center = new Date(today);
			} else {
				center = new Date(currentWeekStart);
				center.setDate(center.getDate() + 1);
			}

			for (let i = -1; i <= 1; i++) {
				const day = new Date(center);
				day.setDate(day.getDate() + i);
				days.push(day);
			}
		} else {
			for (let i = 0; i < 7; i++) {
				const day = new Date(currentWeekStart);
				day.setDate(day.getDate() + i);
				days.push(day);
			}
		}
		return days;
	}

	function getShiftsForDay(date) {
		const dateStr = ymd(date);
		return shifts.filter((s) => normalizeDateValue(s.date) === dateStr);
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

	function handleDayClick(e, day) {
		if (profile?.role !== 'family' && profile?.role !== 'admin') return;
		const rect = e.currentTarget.getBoundingClientRect();
		const y = e.clientY - rect.top + e.currentTarget.scrollTop;
		const totalMinutes = (y / HOUR_HEIGHT) * 60;
		const snapped = Math.floor(totalMinutes / SLOT_MINUTES) * SLOT_MINUTES;
		const hour = Math.min(Math.floor(snapped / 60), 23);
		const minute = snapped % 60;
		openAddShift(day, hour, minute);
	}

	function handleDayMouseMove(e, dayIdx) {
		if (profile?.role !== 'family' && profile?.role !== 'admin') return;
		const rect = e.currentTarget.getBoundingClientRect();
		const y = e.clientY - rect.top + e.currentTarget.scrollTop;
		const totalMinutes = (y / HOUR_HEIGHT) * 60;
		const snapped = Math.floor(totalMinutes / SLOT_MINUTES) * SLOT_MINUTES;
		const hour = Math.min(Math.floor(snapped / 60), 23);
		const minute = snapped % 60;
		if (hour >= 0 && hour < 24) {
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
			await loadShifts();
		} catch (err) {
			toast.error('Error deleting shift');
		}
	}

	// --- Time grid positioning helpers ---

	function timeToMinutes(timeStr) {
		const [h, m] = timeStr.split(':').map(Number);
		return h * 60 + m;
	}

	function eventTop(startTime) {
		const minutes =
			startTime instanceof Date
				? startTime.getHours() * 60 + startTime.getMinutes()
				: timeToMinutes(startTime);
		return ((minutes - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT;
	}

	function eventHeight(startTime, endTime) {
		let startMin, endMin;
		if (startTime instanceof Date) {
			startMin = startTime.getHours() * 60 + startTime.getMinutes();
			endMin = endTime.getHours() * 60 + endTime.getMinutes();
		} else {
			startMin = timeToMinutes(startTime);
			endMin = timeToMinutes(endTime);
		}
		return Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 20);
	}

	function getEventsForDay(day) {
		const youEvents = parentCalendarEvents.you
			.filter((e) => e.startTime.toDateString() === day.toDateString())
			.map((e) => ({ ...e, owner: 'you' }));

		const partnerEvents = parentCalendarEvents.partner
			.filter((e) => e.startTime.toDateString() === day.toDateString())
			.map((e) => ({ ...e, owner: 'partner' }));

		return [...youEvents, ...partnerEvents];
	}

	function getNannyEventsForDay(day) {
		const events = [];
		for (const [nannyId, nannyEvents] of Object.entries(nannyCalendarEvents)) {
			for (const event of nannyEvents) {
				if (event.startTime.toDateString() === day.toDateString()) {
					events.push({ ...event, nannyName: getNannyName(nannyId) });
				}
			}
		}
		return events;
	}

	function getPartnerName() {
		return familyMembers.find((m) => m.id !== user?.id)?.full_name || 'Partner';
	}

	function isToday(date) {
		const today = new Date();
		return date.toDateString() === today.toDateString();
	}

	function getCurrentTimePosition() {
		const now = new Date();
		const minutes = now.getHours() * 60 + now.getMinutes();
		return ((minutes - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT;
	}

	function getCoverageGaps() {
		const gaps = [];
		const days = getWeekDays();

		days.forEach((day) => {
			if (day.getDay() === 0 || day.getDay() === 6) return;
			const dayShifts = getShiftsForDay(day);
			const dayEvents = getEventsForDay(day);

			for (let hour = 8; hour < 18; hour++) {
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

				const youBusy = parentCalendarEvents.you.some(
					(e) => checkTime < e.endTime && checkEnd > e.startTime
				);
				const partnerBusy = parentCalendarEvents.partner.some(
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

	function getShiftConflicts() {
		if (!shiftForm.nannyId || !shiftForm.date || !shiftForm.startTime || !shiftForm.endTime)
			return [];

		const nannyEvents = nannyCalendarEvents[shiftForm.nannyId] || [];
		if (nannyEvents.length === 0) return [];

		const shiftStart = new Date(`${shiftForm.date}T${shiftForm.startTime}:00`);
		const shiftEnd = new Date(`${shiftForm.date}T${shiftForm.endTime}:00`);

		return nannyEvents.filter((event) => event.startTime < shiftEnd && event.endTime > shiftStart);
	}

	function getWeekSummary() {
		if (shifts.length === 0) return null;

		const byNanny = {};
		let totalHours = 0;

		shifts.forEach((shift) => {
			const startMin = timeToMinutes(shift.start_time);
			const endMin = timeToMinutes(shift.end_time);
			const hours = Math.max((endMin - startMin) / 60, 0);

			const id = shift.nanny_id;
			if (!byNanny[id]) {
				const nanny = nannies.find((n) => n.id === id);
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

	function handleCalendarUpdate() {
		loadCalendarEvents();
	}

	function goToToday() {
		setCurrentWeek(0);
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
				<button class="top-btn" on:click={() => (showCalendarManager = true)}>
					<Icon name="grimoire" size={16} />
					{profile?.role === 'nanny' ? 'My Availability' : 'Calendars'}
				</button>
				<div class="week-nav">
					<button class="nav-btn" on:click={() => changeWeek('prev')}>
						<Icon name="chevron-left" size={16} />
					</button>
					<button class="today-btn" on:click={goToToday}>Today</button>
					<button class="nav-btn" on:click={() => changeWeek('next')}>
						<Icon name="chevron-right" size={16} />
					</button>
				</div>
			</div>
		</div>

		<!-- Coverage Gap Alert -->
		{#if (profile?.role === 'family' || profile?.role === 'admin') && getCoverageGaps().length > 0}
			<div class="gap-banner">
				<Icon name="warning" size={16} />
				<span
					><strong
						>{getCoverageGaps().length} coverage gap{getCoverageGaps().length > 1
							? 's'
							: ''}</strong
					> this week &mdash; both parents busy with no nanny scheduled</span
				>
			</div>
		{/if}

		<!-- Week Summary -->
		{#if getWeekSummary()}
			{@const summary = getWeekSummary()}
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
							<span class="summary-detail">{nanny.hours.toFixed(1)}h &times; ${nanny.rate}/hr</span>
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
							on:click={(e) => handleDayClick(e, day)}
							on:mousemove={(e) => handleDayMouseMove(e, dayIdx)}
							on:mouseleave={() => (hoveredSlot = null)}
						>
							<!-- Zebra hour backgrounds -->
							{#each Array(TOTAL_HOURS) as _, i}
								<div
									class="hour-bg"
									class:hour-even={i % 2 === 0}
									style="top: {i * HOUR_HEIGHT}px; height: {HOUR_HEIGHT}px"
								></div>
							{/each}

							<!-- Grid lines: hour (solid), half-hour (dashed), quarter-hour (dotted) -->
							{#each Array(TOTAL_HOURS) as _, i}
								<div class="hour-line" style="top: {i * HOUR_HEIGHT}px"></div>
								<div class="quarter-line" style="top: {i * HOUR_HEIGHT + SLOT_HEIGHT}px"></div>
								<div class="half-line" style="top: {i * HOUR_HEIGHT + SLOT_HEIGHT * 2}px"></div>
								<div class="quarter-line" style="top: {i * HOUR_HEIGHT + SLOT_HEIGHT * 3}px"></div>
							{/each}

							<!-- Hover indicator for clickable slot -->
							{#if hoveredSlot && hoveredSlot.dayIdx === dayIdx}
								<div
									class="slot-hover"
									style="top: {((hoveredSlot.hour * 60 + hoveredSlot.minute) / 60) *
										HOUR_HEIGHT}px; height: {SLOT_HEIGHT}px"
								>
									<span class="slot-hover-label">
										<Icon name="plus" size={16} />
										{formatTime15(hoveredSlot.hour, hoveredSlot.minute)}
									</span>
								</div>
							{/if}

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
									on:click|stopPropagation
								>
									<span class="cal-event-owner"
										>{event.owner === 'you' ? 'You' : getPartnerName()}</span
									>
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
									on:click|stopPropagation
								>
									<span class="cal-event-owner">{nEvent.nannyName}</span>
									<span class="cal-event-title">{nEvent.title}</span>
								</div>
							{/each}

							<!-- Nanny shifts (solid green blocks) -->
							{#each getShiftsForDay(day) as shift}
								<div
									class="shift-block"
									class:shift-editable={profile?.role === 'family' || profile?.role === 'admin'}
									style="
                    top: {eventTop(shift.start_time)}px;
                    height: {eventHeight(shift.start_time, shift.end_time)}px;
                  "
									on:click|stopPropagation={() => {
										if (profile?.role === 'family' || profile?.role === 'admin') editShift(shift);
									}}
									title={profile?.role === 'family' || profile?.role === 'admin'
										? 'Click to edit'
										: ''}
								>
									<div class="shift-content">
										<span class="shift-name">{getNannyName(shift.nanny_id)}</span>
										<span class="shift-time"
											>{formatTime(shift.start_time)} - {formatTime(shift.end_time)}</span
										>
										{#if shift.notes}
											<span class="shift-note">{shift.notes}</span>
										{/if}
									</div>
									{#if profile?.role === 'family' || profile?.role === 'admin'}
										<button
											class="shift-delete"
											on:click|stopPropagation={() => deleteShift(shift.id)}
											title="Remove shift"
										>
											<Icon name="close" size={16} />
										</button>
									{/if}
								</div>
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

				{#if getShiftConflicts().length > 0}
					<div class="conflict-warning">
						<Icon name="warning" size={16} />
						<div class="conflict-text">
							<strong>Heads up</strong> &mdash; {getNannyName(shiftForm.nannyId)} has {getShiftConflicts()
								.length === 1
								? 'something'
								: `${getShiftConflicts().length} things`} on their calendar during this time:
							<ul class="conflict-list">
								{#each getShiftConflicts() as conflict}
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
		min-width: 720px;
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
	.cal-event {
		position: absolute;
		left: 2px;
		right: 2px;
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
	.shift-block {
		position: absolute;
		left: 3px;
		right: 3px;
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
