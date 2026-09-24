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
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

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
 * @param {string} [options.timeZone] IANA zone for all-day dates and floating times
 *   (the household's). Without it they fall back to the server's zone.
 * @returns {Array<{uid: string, summary: string, start: Date, end: Date, isBusy: boolean}>}
 */
export function parseICal(icalText, options = {}) {
	const now = new Date();
	const rangeStart = options.rangeStart || new Date(now.getFullYear() - 1, now.getMonth(), 1);
	const rangeEnd = options.rangeEnd || new Date(now.getFullYear() + 2, now.getMonth(), 1);
	const maxInstances = options.maxInstancesPerEvent || 1000;
	const zone = validZone(options.timeZone);

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
			const start = toJSDate(event.startDate, zone);
			const end = event.endDate ? toJSDate(event.endDate, zone) : start;
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

			const start = toJSDate(details.startDate, zone);
			const end = toJSDate(details.endDate, zone);

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
 * ICAL.Time → JS Date. UTC times and TZIDs the feed defined are instants
 * already. All-day dates and floating times are wall-clock: read them in the
 * TZID they name when that's a real zone (a feed that omits its VTIMEZONE),
 * else in the household's zone — not the server's, which is UTC on hosted
 * platforms and put all-day events on the previous evening.
 * @param {any} icalTime
 * @param {string | null} householdZone
 * @returns {Date}
 */
function toJSDate(icalTime, householdZone) {
	const floating = icalTime.isDate || !icalTime.zone || icalTime.zone.tzid === 'floating';
	if (!floating) return icalTime.toJSDate();

	const zone = validZone(icalTime.timezone) || householdZone;
	const { year, month, day } = icalTime;
	const [hour, minute, second] = icalTime.isDate
		? [0, 0, 0]
		: [icalTime.hour, icalTime.minute, icalTime.second];
	if (!zone) return new Date(year, month - 1, day, hour, minute, second);
	return zonedWallClock(year, month, day, hour, minute, second, zone);
}

/** @param {unknown} tz @returns {string | null} the zone when Intl knows it */
function validZone(tz) {
	if (typeof tz !== 'string' || !tz) return null;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return tz;
	} catch {
		return null;
	}
}

/** How far `timeZone` is ahead of UTC at instant `ms`, in ms (CDT: -5h). */
function zoneOffsetMs(/** @type {number} */ ms, /** @type {string} */ timeZone) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric'
		})
			.formatToParts(new Date(ms))
			.map((p) => [p.type, p.value])
	);
	const asUTC = Date.UTC(
		+parts.year,
		+parts.month - 1,
		+parts.day,
		+parts.hour,
		+parts.minute,
		+parts.second
	);
	return asUTC - ms;
}

/**
 * The instant a wall-clock time in `timeZone` names. Two passes, so a DST
 * change between the first guess and the answer still lands right.
 * @param {number} y @param {number} mo @param {number} d
 * @param {number} h @param {number} mi @param {number} s
 * @param {string} timeZone
 * @returns {Date}
 */
function zonedWallClock(y, mo, d, h, mi, s, timeZone) {
	const guess = Date.UTC(y, mo - 1, d, h, mi, s);
	let t = guess - zoneOffsetMs(guess, timeZone);
	t = guess - zoneOffsetMs(t, timeZone);
	return new Date(t);
}

// A hung feed host must not hang the sync endpoint, and a runaway response
// must not exhaust server memory. Real household feeds are well under 5 MB.
const FETCH_TIMEOUT_MS = 20_000;
const MAX_FEED_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/**
 * Loopback, private, link-local (cloud metadata lives at 169.254.169.254),
 * carrier-grade NAT, multicast and reserved ranges, v4 and v6.
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateAddress(ip) {
	if (isIP(ip) === 4) {
		const [a, b] = ip.split('.').map(Number);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a >= 224
		);
	}
	const v6 = ip.toLowerCase();
	if (v6 === '::' || v6 === '::1') return true;
	const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return isPrivateAddress(mapped[1]);
	return /^(f[cd]|fe[89ab]|ff)/.test(v6);
}

/**
 * The server fetches whatever feed URL a household member saved, so it must
 * only reach the public internet — not itself, the cloud metadata service or
 * anything else on a private network. webcal:// (iCloud's public links) is
 * https under another name.
 * @param {string} raw
 * @returns {Promise<URL>}
 */
export async function publicFeedUrl(raw) {
	let url;
	try {
		url = new URL(
			String(raw)
				.trim()
				.replace(/^webcals?:\/\//i, 'https://')
		);
	} catch {
		throw new Error("That calendar link isn't a valid web address");
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error('Calendar links must start with https://');
	}
	const host = url.hostname.replace(/^\[|\]$/g, '');
	let addresses;
	try {
		addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
	} catch {
		throw new Error(`Couldn't find the calendar host ${host}`);
	}
	if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
		throw new Error('Calendar links must point to a public internet address');
	}
	return url;
}

/**
 * Fetch and parse an iCal feed from a URL.
 * @param {string} url The iCal feed URL
 * @param {Object} [options] Passed through to parseICal
 * @returns {Promise<Array<{uid: string, summary: string, start: Date, end: Date, isBusy: boolean}>>}
 */
export async function fetchAndParseICal(url, options = {}) {
	const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	let target = await publicFeedUrl(url);
	let response;
	try {
		// Follow redirects by hand so every hop gets the same public-address
		// check as the first.
		for (let hop = 0; ; hop++) {
			response = await fetch(target, {
				headers: {
					Accept: 'text/calendar, application/calendar+json, text/plain',
					'User-Agent': 'FamilyHub/2.0 Calendar Sync'
				},
				redirect: 'manual',
				signal
			});
			const location = response.headers.get('location');
			if (response.status < 300 || response.status >= 400 || !location) break;
			if (hop >= MAX_REDIRECTS) throw new Error('Calendar feed redirected too many times');
			target = await publicFeedUrl(new URL(location, target).href);
		}
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

	// Count bytes as they arrive rather than buffering first and checking after.
	/** @type {Uint8Array[]} */
	const chunks = [];
	let received = 0;
	const reader = response.body?.getReader();
	while (reader) {
		const { done, value } = await reader.read();
		if (done) break;
		received += value.byteLength;
		if (received > MAX_FEED_BYTES) {
			await reader.cancel();
			throw new Error('Calendar feed is too large to sync');
		}
		chunks.push(value);
	}
	const text = Buffer.concat(chunks).toString('utf8');

	try {
		return parseICal(text, options);
	} catch {
		// Never echo the body back: whatever the link returned, it wasn't a feed.
		throw new Error("That link didn't return a calendar feed");
	}
}
