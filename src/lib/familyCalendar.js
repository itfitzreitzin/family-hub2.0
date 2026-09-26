// The family calendar: the household's own Google calendars on Home, the
// roster's birthdays, and the busy/free picture the nanny gets of the
// parents' day.
//
// Parents read their calendars directly (supabase/family_calendar.sql). The
// nanny never reads a parent's calendar: household_busy() hands them only
// what each calendar's nanny_sees setting allows. Everything here is pure
// over its inputs except the fetchers and syncCalendar, which take the
// Supabase client as an argument, like calendar.js.

import { formatTime, parseLocalDate } from '$lib/time.js';

/** Calendars older than this re-sync quietly when Home, Calendar or Care opens. */
export const FRESH_FOR_MS = 30 * 60 * 1000;

/** Colors a calendar can take, in the order new calendars are offered them. */
export const CALENDAR_COLORS = [
	'#a877e8',
	'#e0664e',
	'#6fbf73',
	'#d9a441',
	'#8b9ef5',
	'#4fb8a8',
	'#e88ba7',
	'#5a7bd6'
];

/**
 * One thing on the family calendar.
 *
 * @typedef {Object} FamilyItem
 * @property {string} id           unique per item and occurrence
 * @property {'event' | 'birthday'} kind
 * @property {string} title
 * @property {Date} start
 * @property {Date} end            exclusive; an all-day event ends at the next midnight
 * @property {boolean} allDay
 * @property {string | null} color  its calendar's color; null for birthdays
 * @property {string} who          "Nick", "Rhea", "Family" — '' for birthdays
 * @property {number | null} calendarId
 */

/**
 * A row of household_busy(): what the nanny may see of one parent event.
 *
 * @typedef {Object} BusyRow
 * @property {number} event_id
 * @property {number} calendar_id
 * @property {string} owner_id
 * @property {boolean} is_family
 * @property {string | null} title   only for calendars shared in full
 * @property {string} starts_at
 * @property {string} ends_at
 * @property {boolean} all_day
 * @property {boolean} [is_busy] false for an event Google shows as "free"
 */

/**
 * A stretch of busy time, merged from overlapping events.
 *
 * @typedef {Object} BusyBlock
 * @property {Date} start
 * @property {Date} end
 * @property {boolean} allDay  covers the whole day
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Days ────────────────────────────────────────────────────────

/**
 * Local midnight to the next local midnight (a DST day is 23 or 25 hours).
 * @param {Date} date
 * @returns {{ start: Date, end: Date }}
 */
export function dayBounds(date) {
	const start = new Date(date);
	start.setHours(0, 0, 0, 0);
	return { start, end: addDays(start, 1) };
}

/**
 * @param {Date} date
 * @param {number} days
 * @returns {Date} the same wall-clock time `days` calendar days later
 */
export function addDays(date, days) {
	const d = new Date(date);
	d.setDate(d.getDate() + days);
	return d;
}

/** @param {Date} d */
function isLocalMidnight(d) {
	return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

/**
 * Whether a stored span is an all-day event. The sync flags them
 * (calendar_events.all_day); rows saved before it did are recognized by
 * running from one local midnight to another.
 * @param {{ all_day?: boolean | null }} row
 * @param {Date} start
 * @param {Date} end
 */
export function isAllDay(row, start, end) {
	if (row.all_day) return true;
	return end > start && isLocalMidnight(start) && isLocalMidnight(end);
}

/**
 * @param {string | null | undefined} fullName
 * @returns {string}
 */
export function firstName(fullName) {
	return (fullName || '').trim().split(/\s+/)[0] || '';
}

// ── The family's events ─────────────────────────────────────────

/**
 * Whose a calendar is, as the calendar says it: "Family" for the shared one,
 * otherwise its owner's first name.
 * @param {{ is_family?: boolean, user_id: string }} calendar
 * @param {Record<string, string>} namesById full names by profile id
 */
export function calendarWho(calendar, namesById) {
	if (calendar.is_family) return 'Family';
	return firstName(namesById[calendar.user_id]) || 'Someone';
}

/**
 * calendar_events rows → FamilyItems, dropping any whose calendar isn't given.
 * @param {any[]} events calendar_events rows
 * @param {Map<number, any>} calendarsById parent_calendars rows
 * @param {Record<string, string>} namesById
 * @returns {FamilyItem[]}
 */
export function eventItems(events, calendarsById, namesById) {
	/** @type {FamilyItem[]} */
	const items = [];
	for (const event of events) {
		const calendar = calendarsById.get(event.calendar_id);
		if (!calendar) continue;
		const start = new Date(event.start_time);
		const end = new Date(event.end_time);
		items.push({
			id: `event-${event.id}`,
			kind: 'event',
			title: event.title || 'Busy',
			start,
			end,
			allDay: isAllDay(event, start, end),
			color: calendar.color || null,
			who: calendarWho(calendar, namesById),
			calendarId: calendar.id
		});
	}
	return items;
}

/** @param {number} year */
function isLeapYear(year) {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Birthdays from the household roster falling in [rangeStart, rangeEnd).
 * Kids and pets "turn" an age; grown-ups just have a birthday. A Feb 29
 * birthday lands on the 28th in other years.
 * @param {any[]} members family_members rows (name, kind, birthdate)
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @returns {FamilyItem[]}
 */
export function birthdayItems(members, rangeStart, rangeEnd) {
	/** @type {FamilyItem[]} */
	const items = [];
	for (const member of members) {
		if (!member?.birthdate) continue;
		const born = parseLocalDate(member.birthdate);
		if (Number.isNaN(born.getTime())) continue;
		const name = firstName(member.name) || 'Someone';

		for (let year = rangeStart.getFullYear(); year <= rangeEnd.getFullYear(); year++) {
			const age = year - born.getFullYear();
			if (age < 1) continue;
			let day = born.getDate();
			if (born.getMonth() === 1 && day === 29 && !isLeapYear(year)) day = 28;
			const start = new Date(year, born.getMonth(), day);
			const end = new Date(year, born.getMonth(), day + 1);
			if (end <= rangeStart || start >= rangeEnd) continue;

			items.push({
				id: `birthday-${member.id}-${year}`,
				kind: 'birthday',
				title: member.kind === 'parent' ? `${name}'s birthday` : `${name} turns ${age}`,
				start,
				end,
				allDay: true,
				color: null,
				who: '',
				calendarId: null
			});
		}
	}
	return items;
}

/**
 * One day's running order: all-day things first (birthdays leading), then
 * by start time.
 * @param {FamilyItem[]} items
 * @returns {FamilyItem[]}
 */
export function sortDay(items) {
	return [...items].sort((a, b) => {
		if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
		if (a.allDay && a.kind !== b.kind) return a.kind === 'birthday' ? -1 : 1;
		return a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title);
	});
}

/**
 * @param {FamilyItem} item
 * @param {Date} from
 * @param {Date} to
 */
function overlaps(item, from, to) {
	// A zero-length event (a reminder at 9:00) still belongs to its moment.
	if (item.end.getTime() === item.start.getTime()) return item.start >= from && item.start < to;
	return item.start < to && item.end > from;
}

/**
 * Bucket items by every local day they touch in [gridStart, gridEnd], each
 * day in running order — the month grid's input.
 * @param {FamilyItem[]} items
 * @param {Date} gridStart
 * @param {Date} gridEnd
 * @returns {Record<string, FamilyItem[]>} keyed 'YYYY-MM-DD'
 */
export function groupByDay(items, gridStart, gridEnd) {
	/** @type {Record<string, FamilyItem[]>} */
	const byDay = {};
	for (let day = dayBounds(gridStart).start; day <= gridEnd; day = addDays(day, 1)) {
		const next = addDays(day, 1);
		const onDay = items.filter((item) => overlaps(item, day, next));
		if (onDay.length > 0) byDay[dayKey(day)] = sortDay(onDay);
	}
	return byDay;
}

/** @param {Date} d @returns {string} 'YYYY-MM-DD', local */
function dayKey(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * What Home shows: today in full, tomorrow, and the next few things after.
 * Something running across days (a trip, a school break) shows on each day
 * it covers but only starts "later" once.
 * @param {FamilyItem[]} items
 * @param {Date} now
 * @param {{ laterDays?: number, laterCount?: number }} [opts]
 * @returns {{ today: FamilyItem[], tomorrow: FamilyItem[], later: FamilyItem[] }}
 */
export function agenda(items, now, { laterDays = 14, laterCount = 6 } = {}) {
	const { start: todayStart, end: tomorrowStart } = dayBounds(now);
	const dayAfter = addDays(todayStart, 2);
	const horizon = addDays(todayStart, laterDays + 1);

	return {
		today: sortDay(items.filter((i) => overlaps(i, todayStart, tomorrowStart))),
		tomorrow: sortDay(items.filter((i) => overlaps(i, tomorrowStart, dayAfter))),
		later: items
			.filter((i) => i.start >= dayAfter && i.start < horizon)
			.sort((a, b) => a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title))
			.slice(0, laterCount)
	};
}

/**
 * Where an item stands at `now`.
 * @param {FamilyItem} item
 * @param {number} nowMs
 * @returns {'past' | 'now' | 'upcoming'}
 */
export function itemState(item, nowMs) {
	if (item.end.getTime() <= nowMs && item.end.getTime() > item.start.getTime()) return 'past';
	if (item.start.getTime() <= nowMs && nowMs < item.end.getTime()) return 'now';
	if (item.start.getTime() < nowMs) return 'past';
	return 'upcoming';
}

/** @param {Date} d @returns {[string, string]} ['9:05', 'AM'] */
function clockParts(d) {
	const [time, meridiem = ''] = formatTime(d).split(' ');
	return [time, meridiem];
}

/**
 * @param {Date} d
 * @param {Date} [relativeTo] within a week of this, the weekday alone
 * @returns {string} 'Fri' or 'Oct 3'
 */
function shortDay(d, relativeTo = new Date()) {
	const days =
		Math.abs(dayBounds(d).start.getTime() - dayBounds(relativeTo).start.getTime()) / DAY_MS;
	return days < 6.5
		? d.toLocaleDateString('en-US', { weekday: 'short' })
		: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * The time an item takes, the way a person would write it:
 * "9:00 – 10:30 AM", "11:00 AM – 1:00 PM", "All day", "All day · until Fri".
 * @param {FamilyItem} item
 * @param {Date} [now]
 * @returns {string}
 */
export function timeLabel(item, now = new Date()) {
	if (item.allDay) {
		const lastDay = addDays(item.end, -1);
		if (dayBounds(lastDay).start > dayBounds(item.start).start) {
			return `All day · until ${shortDay(lastDay, now)}`;
		}
		return 'All day';
	}
	if (item.end.getTime() - item.start.getTime() >= DAY_MS) {
		return `${shortDay(item.start, now)} ${formatTime(item.start)} – ${shortDay(item.end, now)} ${formatTime(item.end)}`;
	}
	return clockRange(item.start, item.end);
}

/**
 * Two clock times as a range, sharing AM/PM when they can:
 * "9:00 – 10:30 AM", "11:00 AM – 1:00 PM"; one time when they're equal.
 * @param {Date} start
 * @param {Date} end
 * @returns {string}
 */
export function clockRange(start, end) {
	const [startTime, startMer] = clockParts(start);
	if (end.getTime() <= start.getTime()) return `${startTime} ${startMer}`;
	const [endTime, endMer] = clockParts(end);
	if (startMer === endMer) return `${startTime} – ${endTime} ${endMer}`;
	return `${startTime} ${startMer} – ${endTime} ${endMer}`;
}

/**
 * A month-grid pill's time: "9am", "2:30pm".
 * @param {Date} d
 */
export function pillTime(d) {
	const [time, meridiem] = clockParts(d);
	return `${time.replace(/:00$/, '')}${meridiem.toLowerCase()}`;
}

// ── The nanny's view of the parents' day ────────────────────────

/**
 * Busy spans → merged blocks clipped to [dayStart, dayEnd), soonest first.
 * Touching or overlapping spans become one block.
 * @param {{ start: Date, end: Date }[]} spans
 * @param {Date} dayStart
 * @param {Date} dayEnd
 * @returns {BusyBlock[]}
 */
export function mergeBlocks(spans, dayStart, dayEnd) {
	const clipped = spans
		.map((s) => ({
			start: new Date(Math.max(s.start.getTime(), dayStart.getTime())),
			end: new Date(Math.min(s.end.getTime(), dayEnd.getTime()))
		}))
		.filter((s) => s.end > s.start)
		.sort((a, b) => a.start.getTime() - b.start.getTime());

	/** @type {BusyBlock[]} */
	const blocks = [];
	for (const s of clipped) {
		const last = blocks[blocks.length - 1];
		if (last && s.start <= last.end) {
			if (s.end > last.end) last.end = s.end;
		} else {
			blocks.push({ start: s.start, end: s.end, allDay: false });
		}
	}
	for (const b of blocks) {
		b.allDay = b.start.getTime() <= dayStart.getTime() && b.end.getTime() >= dayEnd.getTime();
	}
	return blocks;
}

/**
 * One line of a parent's day as the nanny sees it: an event shared in full
 * (with its title), or a stretch of busy time (without).
 * @typedef {Object} DayEntry
 * @property {string | null} title
 * @property {Date} start
 * @property {Date} end
 * @property {boolean} allDay
 */

/** @param {DayEntry[]} entries */
function sortEntries(entries) {
	return entries.sort(
		(a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime()
	);
}

/**
 * The shared rows for one day, split by whose they are. For each parent:
 * `byOwner` holds their busy time merged into blocks — what decides "busy
 * until…" and fills the strip, so an event Google marks free never counts —
 * and `entriesByOwner` the lines to list: events shared in full by name,
 * plus stretches of busy time from calendars shared as busy times only.
 * The family calendar (only ever shared in full) stays a list of events.
 * @param {BusyRow[]} rows
 * @param {Date} dayStart
 * @param {Date} dayEnd
 * @returns {{ byOwner: Map<string, BusyBlock[]>, entriesByOwner: Map<string, DayEntry[]>, family: DayEntry[] }}
 */
export function splitBusy(rows, dayStart, dayEnd) {
	/** @type {Map<string, { busy: { start: Date, end: Date }[], plain: { start: Date, end: Date }[], named: DayEntry[] }>} */
	const owners = new Map();
	/** @type {DayEntry[]} */
	const family = [];

	for (const row of rows) {
		const start = new Date(row.starts_at);
		const end = new Date(row.ends_at);
		if (!(end > dayStart && start < dayEnd)) continue;
		const allDay = isAllDay(row, start, end);
		if (row.is_family) {
			if (row.title) family.push({ title: row.title, start, end, allDay });
			continue;
		}
		const mine = owners.get(row.owner_id) || { busy: [], plain: [], named: [] };
		owners.set(row.owner_id, mine);
		const busy = row.is_busy !== false;
		if (busy) mine.busy.push({ start, end });
		if (row.title) mine.named.push({ title: row.title, start, end, allDay });
		else if (busy) mine.plain.push({ start, end });
	}

	/** @type {Map<string, BusyBlock[]>} */
	const byOwner = new Map();
	/** @type {Map<string, DayEntry[]>} */
	const entriesByOwner = new Map();
	for (const [owner, mine] of owners) {
		byOwner.set(owner, mergeBlocks(mine.busy, dayStart, dayEnd));
		const plain = mergeBlocks(mine.plain, dayStart, dayEnd).map((b) => ({
			title: null,
			start: b.start,
			end: b.end,
			allDay: b.allDay
		}));
		entriesByOwner.set(owner, sortEntries([...mine.named, ...plain]));
	}
	return { byOwner, entriesByOwner, family: sortEntries(family) };
}

/**
 * One parent's status at `now`, from that day's blocks.
 * @param {BusyBlock[]} blocks
 * @param {Date} now
 * @returns {{ busy: boolean, current: BusyBlock | null, next: BusyBlock | null }}
 */
export function busyStatus(blocks, now) {
	const t = now.getTime();
	const current = blocks.find((b) => b.start.getTime() <= t && t < b.end.getTime()) || null;
	const next = blocks.find((b) => b.start.getTime() > t) || null;
	return { busy: !!current, current, next };
}

/**
 * The status as a sentence: "Busy until 11:30 AM", "Free until 2:00 PM",
 * "Free the rest of the day".
 * @param {BusyBlock[]} blocks
 * @param {Date} now
 * @param {Date} dayEnd
 * @returns {string}
 */
export function statusLabel(blocks, now, dayEnd) {
	const { busy, current, next } = busyStatus(blocks, now);
	if (busy && current) {
		if (current.allDay) return 'Busy all day';
		if (current.end.getTime() >= dayEnd.getTime()) return 'Busy the rest of the day';
		return `Busy until ${formatTime(current.end)}`;
	}
	if (next) return `Free until ${formatTime(next.start)}`;
	return blocks.length === 0 ? 'Free all day' : 'Free the rest of the day';
}

// ── Keeping the calendars fresh ─────────────────────────────────

/**
 * @param {{ last_synced?: string | null }} calendar
 * @param {number} nowMs
 * @param {number} [maxAgeMs]
 */
export function isStale(calendar, nowMs, maxAgeMs = FRESH_FOR_MS) {
	if (!calendar.last_synced) return true;
	return nowMs - new Date(calendar.last_synced).getTime() > maxAgeMs;
}

/**
 * "just now", "12 min ago", "3 hr ago", "2 days ago", "never".
 * @param {string | null | undefined} iso
 * @param {number} nowMs
 */
export function agoLabel(iso, nowMs) {
	if (!iso) return 'never';
	const mins = Math.floor((nowMs - new Date(iso).getTime()) / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours} hr ago`;
	const days = Math.floor(hours / 24);
	return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** @typedef {{ ok: boolean, synced?: number, error?: string }} SyncResult */

/** Syncs underway, so two cards asking for the same calendar share one. */
/** @type {Map<number, Promise<SyncResult>>} */
const inFlight = new Map();
/** When each calendar was last tried this session — a broken feed isn't retried on every visit. */
/** @type {Map<number, number>} */
const lastTried = new Map();

/**
 * Fetch one calendar's feed now (POST /api/calendar/sync).
 * @param {any} supabase
 * @param {number} calendarId
 * @returns {Promise<SyncResult>}
 */
export function syncCalendar(supabase, calendarId) {
	const running = inFlight.get(calendarId);
	if (running) return running;

	lastTried.set(calendarId, Date.now());
	const task = (async () => {
		try {
			const {
				data: { session }
			} = await supabase.auth.getSession();
			if (!session) return { ok: false, error: 'Not signed in' };

			const response = await fetch('/api/calendar/sync', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session.access_token}`
				},
				body: JSON.stringify({
					calendarId,
					// All-day events are read in the household's zone, not the server's
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
				})
			});
			const result = await response.json().catch(() => ({}));
			if (!response.ok)
				return { ok: false, error: result.error || `Sync failed (${response.status})` };
			return { ok: true, synced: result.synced ?? 0 };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		} finally {
			inFlight.delete(calendarId);
		}
	})();
	inFlight.set(calendarId, task);
	return task;
}

/**
 * Quietly re-sync every calendar older than `maxAgeMs`, one at a time,
 * skipping any already tried within that window this session.
 * @param {any} supabase
 * @param {{ id: number, last_synced?: string | null }[]} calendars
 * @param {number} [maxAgeMs]
 * @returns {Promise<boolean>} whether anything came back fresh
 */
export async function syncStale(supabase, calendars, maxAgeMs = FRESH_FOR_MS) {
	const now = Date.now();
	const due = calendars.filter(
		(c) => isStale(c, now, maxAgeMs) && now - (lastTried.get(c.id) ?? 0) > maxAgeMs
	);
	let refreshed = false;
	for (const calendar of due) {
		const result = await syncCalendar(supabase, calendar.id);
		if (result.ok) refreshed = true;
		else console.warn('[calendar] quiet sync failed for', calendar.id, result.error);
	}
	return refreshed;
}

// ── Reading ─────────────────────────────────────────────────────

/**
 * Whether an error means supabase/family_calendar.sql hasn't run yet: a
 * column or function it adds is missing.
 * @param {any} error
 */
export function needsMigration(error) {
	return ['42703', '42883', 'PGRST202', 'PGRST204'].includes(error?.code);
}

/**
 * The calendars shown on Home, events from them in [rangeStart, rangeEnd),
 * and the roster's birthdays in the same range.
 * @param {any} supabase
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @returns {Promise<{ calendars: any[], items: FamilyItem[] }>}
 */
export async function loadHomeCalendar(supabase, rangeStart, rangeEnd) {
	const [calendarsRes, peopleRes, membersRes] = await Promise.all([
		supabase.from('parent_calendars').select('*').eq('show_on_home', true).order('created_at'),
		supabase.from('profiles').select('id, full_name'),
		supabase.from('family_members').select('id, name, kind, birthdate').not('birthdate', 'is', null)
	]);
	if (calendarsRes.error) throw calendarsRes.error;
	if (peopleRes.error) throw peopleRes.error;

	const calendars = calendarsRes.data || [];
	/** @type {Record<string, string>} */
	const namesById = Object.fromEntries(
		(peopleRes.data || []).map((/** @type {any} */ p) => [p.id, p.full_name || ''])
	);

	/** @type {any[]} */
	let events = [];
	if (calendars.length > 0) {
		const { data, error } = await supabase
			.from('calendar_events')
			.select('id, calendar_id, title, start_time, end_time, all_day')
			.in(
				'calendar_id',
				calendars.map((/** @type {any} */ c) => c.id)
			)
			.lt('start_time', rangeEnd.toISOString())
			.gt('end_time', rangeStart.toISOString())
			.order('start_time');
		if (error) throw error;
		events = data || [];
	}

	const calendarsById = new Map(calendars.map((/** @type {any} */ c) => [c.id, c]));
	// The roster is optional here: a birthday is a bonus, not a reason to fail.
	const members = membersRes.error ? [] : membersRes.data || [];

	return {
		calendars,
		items: [
			...eventItems(events, calendarsById, namesById),
			...birthdayItems(members, rangeStart, rangeEnd)
		]
	};
}

/**
 * A calendar link as typed, tidied for comparing: webcal:// is https://
 * under another name, and hosts ignore case.
 * @param {string} url
 */
export function normalizeFeedUrl(url) {
	const trimmed = String(url || '')
		.trim()
		.replace(/^webcals?:\/\//i, 'https://');
	try {
		const parsed = new URL(trimmed);
		return parsed.href;
	} catch {
		return trimmed;
	}
}

/**
 * Where a feed points, shortened to its host ("calendar.google.com").
 * @param {string | null | undefined} url
 */
export function feedHost(url) {
	if (!url) return '';
	try {
		return new URL(normalizeFeedUrl(url)).host;
	} catch {
		return '';
	}
}
