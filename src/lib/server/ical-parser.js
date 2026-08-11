/**
 * iCal (.ics) feed parser built on ical.js.
 *
 * Compared to the old hand-rolled parser this expands RRULE recurrences
 * (honoring EXDATE and RECURRENCE-ID overrides) and resolves TZID datetimes
 * through each feed's embedded VTIMEZONE definitions — a Google or Outlook
 * feed publishes a weekly meeting as ONE VEVENT plus a rule, which previously
 * synced as a single occurrence.
 */

import ICAL from 'ical.js';

/**
 * Parse an iCal string into flat event instances.
 *
 * Recurring events are expanded per-instance inside [rangeStart, rangeEnd];
 * instance uids are `<uid>_<recurrenceId>` so they stay stable across syncs
 * and upsert cleanly on the (calendar_id, event_id) unique index.
 *
 * @param {string} icalText Raw .ics file content
 * @param {Object} [options]
 * @param {Date} [options.rangeStart] Skip instances ending before this (default: 1 year back)
 * @param {Date} [options.rangeEnd] Stop expanding at this bound (default: 2 years out)
 * @param {number} [options.maxInstancesPerEvent] Runaway-RRULE guard (default 1000)
 * @returns {Array<{uid: string, summary: string, start: Date, end: Date, isBusy: boolean}>}
 */
export function parseICal(icalText, options = {}) {
	const now = new Date();
	const rangeStart = options.rangeStart || new Date(now.getFullYear() - 1, now.getMonth(), 1);
	const rangeEnd = options.rangeEnd || new Date(now.getFullYear() + 2, now.getMonth(), 1);
	const maxInstances = options.maxInstancesPerEvent || 1000;

	/** @type {Array<{uid: string, summary: string, start: Date, end: Date, isBusy: boolean}>} */
	const events = [];

	const jcal = ICAL.parse(icalText);
	const comp = new ICAL.Component(jcal);

	// TimezoneService is global — reset so one feed's zones never leak into
	// the next parse, then register this feed's VTIMEZONEs so TZID datetimes
	// resolve to correct instants.
	ICAL.TimezoneService.reset();
	for (const vtz of comp.getAllSubcomponents('vtimezone')) {
		ICAL.TimezoneService.register(new ICAL.Timezone(vtz));
	}

	// Group VEVENTs: primaries by uid, RECURRENCE-ID overrides related after.
	/** @type {Map<string, any>} */
	const primaries = new Map();
	/** @type {any[]} */
	const exceptions = [];

	for (const vevent of comp.getAllSubcomponents('vevent')) {
		let event;
		try {
			event = new ICAL.Event(vevent);
		} catch {
			continue;
		}
		if (!event.startDate) continue;

		if (event.isRecurrenceException()) {
			exceptions.push(event);
		} else {
			primaries.set(event.uid, event);
		}
	}

	for (const ex of exceptions) {
		const primary = primaries.get(ex.uid);
		if (primary) {
			primary.relateException(ex);
		} else {
			// Orphan override (its series is outside the feed) — keep it as a
			// standalone event rather than dropping it.
			primaries.set(`${ex.uid}_${ex.recurrenceId?.toICALString() || 'orphan'}`, ex);
		}
	}

	for (const [key, event] of primaries) {
		const transp = event.component.getFirstPropertyValue('transp');
		const isBusy = transp !== 'TRANSPARENT';

		if (!event.isRecurring()) {
			const start = toJSDate(event.startDate);
			const end = event.endDate ? toJSDate(event.endDate) : start;
			events.push({
				uid: key,
				summary: event.summary || 'Busy',
				start,
				end,
				isBusy
			});
			continue;
		}

		let iterator;
		try {
			iterator = event.iterator();
		} catch {
			continue;
		}

		let next;
		let produced = 0;
		while ((next = iterator.next()) && produced < maxInstances) {
			let details;
			try {
				details = event.getOccurrenceDetails(next);
			} catch {
				continue;
			}

			const start = toJSDate(details.startDate);
			const end = toJSDate(details.endDate);

			if (end <= rangeStart) continue;
			if (start >= rangeEnd) break;

			events.push({
				uid: `${event.uid}_${details.recurrenceId.toICALString()}`,
				// details.item carries the override's summary when an exception
				// replaced this occurrence
				summary: details.item?.summary || event.summary || 'Busy',
				start,
				end,
				isBusy
			});
			produced++;
		}
	}

	return events;
}

/**
 * ICAL.Time → JS Date. Date-only values (all-day events) become local
 * midnight, matching how the old parser treated them.
 * @param {any} icalTime
 * @returns {Date}
 */
function toJSDate(icalTime) {
	if (icalTime.isDate) {
		return new Date(icalTime.year, icalTime.month - 1, icalTime.day);
	}
	return icalTime.toJSDate();
}

// A hung feed host must not hang the sync endpoint, and a runaway response
// must not exhaust server memory. Real household feeds are well under 5 MB.
const FETCH_TIMEOUT_MS = 20_000;
const MAX_FEED_BYTES = 10 * 1024 * 1024;

/**
 * Fetch and parse an iCal feed from a URL.
 * @param {string} url The iCal feed URL
 * @param {Object} [options] Passed through to parseICal
 * @returns {Promise<Array<{uid: string, summary: string, start: Date, end: Date, isBusy: boolean}>>}
 */
export async function fetchAndParseICal(url, options = {}) {
	let response;
	try {
		response = await fetch(url, {
			headers: {
				Accept: 'text/calendar, application/calendar+json, text/plain',
				'User-Agent': 'FamilyHub/2.0 Calendar Sync'
			},
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
	} catch (err) {
		if (err instanceof Error && err.name === 'TimeoutError') {
			throw new Error(`Calendar feed timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
		}
		throw err;
	}

	if (!response.ok) {
		throw new Error(`Failed to fetch calendar: ${response.status} ${response.statusText}`);
	}

	const declaredLength = Number(response.headers.get('content-length'));
	if (declaredLength > MAX_FEED_BYTES) {
		throw new Error('Calendar feed is too large to sync');
	}

	const text = await response.text();
	if (text.length > MAX_FEED_BYTES) {
		throw new Error('Calendar feed is too large to sync');
	}
	return parseICal(text, options);
}
