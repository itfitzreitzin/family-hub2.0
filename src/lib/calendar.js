// Shared calendar data layer.
//
// The month view consumes this module end-to-end; the week view currently
// shares only expandRecurringInstances (full unification is a planned
// follow-up). Everything here is pure over its inputs — Supabase clients are
// passed in, never imported — so the functions stay testable.

import {
	localDateString,
	parseLocalDate,
	combineLocalDateTime,
	normalizeDateValue
} from '$lib/time.js';

/**
 * One unified calendar entry, whatever table it came from.
 *
 * @typedef {Object} CalendarItem
 * @property {string} id            Kind-prefixed stable key, unique per instance
 * @property {'shift'|'family'|'nanny-busy'|'payment'} kind
 * @property {string} title
 * @property {Date} start
 * @property {Date} end
 * @property {boolean} allDay       Payments render as all-day pills
 * @property {string|null} ownerId  nanny_id for shifts/payments, calendar owner for events
 * @property {string|null} calendarName
 * @property {any} raw              Original row — edit flows need it
 */

/**
 * Expand a recurring manual_busy_times row into concrete instances that fall
 * inside [rangeStart, rangeEnd]. Generalizes the week view's old 7-day loop
 * to any range.
 *
 * Patterns: 'weekly' and 'biweekly' ('monthly' is allowed by the DB check
 * constraint but nothing in the app writes it — deliberately unsupported
 * until it can).
 *
 * @param {any} event manual_busy_times row with recurring fields
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @returns {any[]} rows shaped like the input with concrete start/end ISO times
 */
export function expandRecurringInstances(event, rangeStart, rangeEnd) {
	/** @type {any[]} */
	const instances = [];
	const startDate = new Date(event.start_time);
	const endDate = new Date(event.end_time);
	const duration = endDate.getTime() - startDate.getTime();

	if (event.recurring_pattern !== 'weekly' && event.recurring_pattern !== 'biweekly') {
		return instances;
	}

	// recurring_until is a bare DATE; parse local and extend to end of day so
	// the final occurrence isn't dropped (naive new Date() parses UTC midnight).
	let until = null;
	if (event.recurring_until) {
		until = parseLocalDate(event.recurring_until);
		until.setHours(23, 59, 59, 999);
	}

	// A series has no occurrences before the day it starts. (The old week-view
	// expander skipped this check; it only mattered when viewing past ranges.)
	const seriesStartDay = new Date(startDate);
	seriesStartDay.setHours(0, 0, 0, 0);

	const cursor = new Date(rangeStart);
	cursor.setHours(0, 0, 0, 0);

	for (; cursor <= rangeEnd; cursor.setDate(cursor.getDate() + 1)) {
		if (cursor < seriesStartDay) continue;

		const dayName = cursor.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
		if (!event.recurring_days || !event.recurring_days.includes(dayName)) continue;

		// Day-level week difference. The old expander subtracted the series' full
		// timestamp from day midnights, which inverted biweekly alternation for
		// any series not created at exactly midnight. Math.round absorbs the ±1h
		// a DST boundary adds to the day count.
		const daysDiff = Math.round(
			(cursor.getTime() - seriesStartDay.getTime()) / (24 * 60 * 60 * 1000)
		);
		const weeksDiff = Math.floor(daysDiff / 7);
		if (event.recurring_pattern === 'biweekly' && weeksDiff % 2 !== 0) continue;

		if (until && cursor > until) continue;

		const instanceStart = new Date(cursor);
		instanceStart.setHours(startDate.getHours(), startDate.getMinutes(), 0, 0);
		const instanceEnd = new Date(instanceStart.getTime() + duration);

		instances.push({
			...event,
			start_time: instanceStart.toISOString(),
			end_time: instanceEnd.toISOString()
		});
	}

	return instances;
}

/**
 * Scheduled nanny shifts whose date falls in [startStr, endStr].
 * @param {any} supabase
 * @param {string} startStr 'YYYY-MM-DD'
 * @param {string} endStr 'YYYY-MM-DD'
 * @param {string|null} [nannyId] restrict to one nanny (nanny role)
 * @returns {Promise<any[]>}
 */
export async function fetchShiftsInRange(supabase, startStr, endStr, nannyId = null) {
	let query = supabase
		.from('schedules')
		.select('*')
		.gte('date', startStr)
		.lte('date', endStr)
		.order('date', { ascending: true })
		.order('start_time', { ascending: true });

	if (nannyId) query = query.eq('nanny_id', nannyId);

	const { data, error } = await query;
	if (error) throw error;

	return (data || []).map((/** @type {any} */ shift) => ({
		...shift,
		date: normalizeDateValue(shift.date)
	}));
}

/**
 * Synced busy calendar events OVERLAPPING [rangeStart, rangeEnd] — not just
 * starting inside it, so boundary-crossing events appear.
 * @param {any} supabase
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @returns {Promise<any[]>} rows joined with their parent_calendars
 */
export async function fetchBusyEventsInRange(supabase, rangeStart, rangeEnd) {
	const { data, error } = await supabase
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
		.lt('start_time', rangeEnd.toISOString())
		.gt('end_time', rangeStart.toISOString())
		.eq('is_busy', true)
		.eq('parent_calendars.sync_enabled', true)
		.order('start_time');

	if (error) throw error;
	return data || [];
}

/**
 * Manual busy times overlapping the range: one-off rows by overlap, recurring
 * rows expanded into concrete instances.
 * @param {any} supabase
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @returns {Promise<any[]>} concrete rows (recurring already expanded)
 */
export async function fetchManualBusyInRange(supabase, rangeStart, rangeEnd) {
	const { data, error } = await supabase
		.from('manual_busy_times')
		.select('*')
		.or(
			`and(start_time.lt.${rangeEnd.toISOString()},end_time.gt.${rangeStart.toISOString()}),recurring.eq.true`
		);

	if (error) throw error;

	/** @type {any[]} */
	const rows = data || [];
	const oneOffs = rows.filter((r) => !r.recurring);
	const expanded = rows
		.filter((r) => r.recurring)
		.flatMap((r) => expandRecurringInstances(r, rangeStart, rangeEnd));

	return [...oneOffs, ...expanded];
}

/**
 * Unpaid payment rows whose week_end lands in [startStr, endStr] — these show
 * as "payment due" pills.
 * @param {any} supabase
 * @param {string} startStr 'YYYY-MM-DD'
 * @param {string} endStr 'YYYY-MM-DD'
 * @param {string|null} [nannyId]
 * @returns {Promise<any[]>}
 */
export async function fetchPaymentsDueInRange(supabase, startStr, endStr, nannyId = null) {
	let query = supabase
		.from('payments')
		.select('*')
		.gte('week_end', startStr)
		.lte('week_end', endStr)
		.or('is_paid.is.null,is_paid.eq.false');

	if (nannyId) query = query.eq('nanny_id', nannyId);

	const { data, error } = await query;
	if (error) throw error;
	return data || [];
}

/**
 * Merge raw rows from the fetchers into the unified CalendarItem list.
 * @param {Object} input
 * @param {any[]} [input.shifts]
 * @param {any[]} [input.busyEvents]
 * @param {any[]} [input.manualInstances]
 * @param {any[]} [input.payments]
 * @param {Set<string>} input.familyIds
 * @param {Set<string>} input.nannyIds
 * @param {(id: string) => string} input.getNannyName
 * @returns {CalendarItem[]}
 */
export function toCalendarItems({
	shifts = [],
	busyEvents = [],
	manualInstances = [],
	payments = [],
	familyIds,
	nannyIds,
	getNannyName
}) {
	/** @type {CalendarItem[]} */
	const items = [];

	shifts.forEach((shift) => {
		if (!shift.date || !shift.start_time || !shift.end_time) return;
		const start = combineLocalDateTime(shift.date, shift.start_time.slice(0, 5));
		let end = combineLocalDateTime(shift.date, shift.end_time.slice(0, 5));
		// Overnight shift: end wall-clock before start means it crosses midnight
		if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);

		items.push({
			id: `shift-${shift.id}`,
			kind: 'shift',
			title: getNannyName(shift.nanny_id),
			start,
			end,
			allDay: false,
			ownerId: shift.nanny_id,
			calendarName: null,
			raw: shift
		});
	});

	busyEvents.forEach((event) => {
		const ownerId = event.parent_calendars?.user_id ?? event.user_id;
		const kind = familyIds.has(ownerId) ? 'family' : nannyIds.has(ownerId) ? 'nanny-busy' : null;
		if (!kind) return;

		items.push({
			id: `event-${event.id}`,
			kind,
			title: event.title || 'Busy',
			start: new Date(event.start_time),
			end: new Date(event.end_time),
			allDay: false,
			ownerId,
			calendarName: event.parent_calendars?.calendar_name || null,
			raw: event
		});
	});

	manualInstances.forEach((manual) => {
		const kind = familyIds.has(manual.user_id)
			? 'family'
			: nannyIds.has(manual.user_id)
				? 'nanny-busy'
				: null;
		if (!kind) return;

		items.push({
			// Recurring instances share a row id, so key by occurrence date too
			id: `manual-${manual.id}-${localDateString(new Date(manual.start_time))}`,
			kind,
			title: manual.title || 'Busy',
			start: new Date(manual.start_time),
			end: new Date(manual.end_time),
			allDay: false,
			ownerId: manual.user_id,
			calendarName: 'Manual Entry',
			raw: manual
		});
	});

	payments.forEach((payment) => {
		const weekEnd = normalizeDateValue(payment.week_end);
		if (!weekEnd) return;
		const start = parseLocalDate(weekEnd);
		const end = new Date(start);
		end.setHours(23, 59, 59, 999);

		items.push({
			id: `payment-${payment.id}`,
			kind: 'payment',
			title: `Payment due $${Number(payment.amount || 0).toFixed(0)}`,
			start,
			end,
			allDay: true,
			ownerId: payment.nanny_id || null,
			calendarName: null,
			raw: payment
		});
	});

	return items;
}

/**
 * Bucket items by every LOCAL day they overlap inside [gridStart, gridEnd].
 * Multi-day events land on each day they touch. Per day: timed items sorted by
 * start, all-day items pinned last.
 * @param {CalendarItem[]} items
 * @param {Date} gridStart
 * @param {Date} gridEnd
 * @returns {Record<string, CalendarItem[]>}
 */
export function groupItemsByDay(items, gridStart, gridEnd) {
	/** @type {Record<string, CalendarItem[]>} */
	const byDay = {};

	items.forEach((item) => {
		const cursor = new Date(Math.max(item.start.getTime(), gridStart.getTime()));
		cursor.setHours(0, 0, 0, 0);

		for (; cursor <= gridEnd; cursor.setDate(cursor.getDate() + 1)) {
			const dayEnd = new Date(cursor);
			dayEnd.setHours(23, 59, 59, 999);
			// Stop once the day starts at/after the item's end. An item ending at
			// exactly midnight belongs to the previous day only.
			if (item.end <= cursor) break;
			if (item.start > dayEnd) continue;

			const key = localDateString(cursor);
			(byDay[key] ||= []).push(item);
		}
	});

	Object.values(byDay).forEach((dayItems) => {
		dayItems.sort((a, b) => {
			if (a.allDay !== b.allDay) return a.allDay ? 1 : -1;
			return a.start.getTime() - b.start.getTime();
		});
	});

	return byDay;
}

/**
 * The next `count` items that haven't ended yet, soonest first.
 * @param {CalendarItem[]} items
 * @param {Date} [now]
 * @param {number} [count]
 * @returns {CalendarItem[]}
 */
export function upcomingItems(items, now = new Date(), count = 5) {
	return items
		.filter((item) => item.end > now)
		.sort((a, b) => a.start.getTime() - b.start.getTime())
		.slice(0, count);
}
