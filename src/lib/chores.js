// The chores' shared bits: when each one is due, whether it's done, the
// streaks, and the words for all of it.
//
// Rows come from public.chores and public.chore_completions (see
// supabase/chores.sql). A chore is one of three cadences:
//   once   a one-off, due by due_on or whenever;
//   weeks  on a schedule — due_on's weekday, every `every` weeks, whether or
//          not the last one was done (trash day);
//   days   every so often — due `every` days after it was last done.
// Each completion says which day it counts for (counts_for): the scheduled
// day it met for a schedule chore, otherwise the day it was done.
//
// Whatever the cadence, a chore is on the board once, never stacked: a
// missed trash day doesn't pile up behind next week's. A scheduled chore
// waits one grace day after its day — "done, forgot to tap" still counts —
// then moves on to the next one. A chore that comes round every so often
// just waits until it's done.
//
// Like the other helpers, everything here is pure over its inputs and works
// in device-local days ('YYYY-MM-DD'), the way the rest of the app does.

import { localDateString, parseLocalDate } from '$lib/time.js';

/** How long a scheduled chore waits, past its day, to be ticked off. */
export const GRACE_DAYS = 1;

/** The schedule's every-N-weeks choices. */
export const WEEK_CHOICES = [1, 2, 3, 4];

export const WEEKDAYS = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday'
];

/**
 * Chores to start from, while the board is still bare. Trash goes out on
 * Fridays here, and recycling every other one.
 * @type {{ title: string, cadence: 'weeks' | 'days', every: number, weekday?: number }[]}
 */
export const STARTERS = [
	{ title: 'Trash out', cadence: 'weeks', every: 1, weekday: 5 },
	{ title: 'Recycling out', cadence: 'weeks', every: 2, weekday: 5 },
	{ title: 'Water the plants', cadence: 'days', every: 3 },
	{ title: 'Change the sheets', cadence: 'days', every: 14 },
	{ title: 'Clean the bathroom', cadence: 'days', every: 7 },
	{ title: 'Vacuum', cadence: 'days', every: 7 }
];

/** Each person's color on the board, in roster order: parents, then the nanny. */
export const PERSON_COLORS = ['#a877e8', '#4fb8a8', '#e88ba7', '#8b9ef5', '#e0664e'];

/**
 * @typedef {{ id: number, title: string, note?: string | null, assigned_to: string | null,
 *   cadence: 'once' | 'weeks' | 'days', every: number | null, due_on: string | null,
 *   closed_at?: string | null, created_at: string }} Chore
 * @typedef {{ id: number, chore_id: number, counts_for: string, done_by: string | null,
 *   done_at: string }} Completion
 * @typedef {'late' | 'today' | 'upcoming' | 'anytime' | 'done'} ChoreState
 * @typedef {{
 *   chore: Chore,
 *   state: ChoreState,
 *   due: string | null,
 *   countsFor: string,
 *   done: Completion | null,
 *   streak: number
 * }} ChoreNow
 *   due: the day this turn of the chore is (or was) due — null for whenever;
 *   countsFor: what a tick now records as counts_for;
 *   done: the completion, while it's showing as done.
 */

/**
 * Whole days from a to b — positive when b is later. Midnight-anchored, with
 * Math.round absorbing the hour a clock change adds or takes away.
 * @param {string} a 'YYYY-MM-DD'
 * @param {string} b 'YYYY-MM-DD'
 */
export function daysBetween(a, b) {
	return Math.round((parseLocalDate(b).getTime() - parseLocalDate(a).getTime()) / 86400000);
}

/**
 * @param {string} day 'YYYY-MM-DD'
 * @param {number} n
 * @returns {string}
 */
export function addDays(day, n) {
	const d = new Date(parseLocalDate(day));
	d.setDate(d.getDate() + n);
	return localDateString(d);
}

/** The local day a timestamp fell on. @param {string} iso */
export function dayOf(iso) {
	return localDateString(new Date(iso));
}

/** @param {string} day 'YYYY-MM-DD' */
export function weekdayOf(day) {
	return parseLocalDate(day).getDay();
}

/**
 * The first date on or after `from` that falls on a weekday.
 * @param {string} from 'YYYY-MM-DD'
 * @param {number} weekday 0 = Sunday
 */
export function nextWeekday(from, weekday) {
	return addDays(from, (weekday - weekdayOf(from) + 7) % 7);
}

/**
 * A schedule chore's days either side of `today`: the last one before it,
 * and the first on or after it.
 * @param {Chore} chore a 'weeks' chore
 * @param {string} today
 * @returns {{ prev: string | null, next: string }}
 */
export function scheduleAround(chore, today) {
	const period = 7 * (chore.every || 1);
	const start = /** @type {string} */ (chore.due_on);
	const diff = daysBetween(start, today);
	if (diff <= 0) return { prev: null, next: start };
	const next = addDays(start, Math.ceil(diff / period) * period);
	return { prev: addDays(next, -period), next };
}

/** @param {string} iso */
function ms(iso) {
	return new Date(iso).getTime();
}

/** @param {Completion[]} list */
function latest(list) {
	let best = null;
	for (const c of list) if (!best || ms(c.done_at) > ms(best.done_at)) best = c;
	return best;
}

/**
 * @param {string | null} due
 * @param {string} today
 * @returns {ChoreState}
 */
function stateFor(due, today) {
	if (!due) return 'anytime';
	const d = daysBetween(due, today);
	if (d > 0) return 'late';
	return d === 0 ? 'today' : 'upcoming';
}

/**
 * Where a chore stands today: the one turn of it on the board. Null when
 * there's nothing to show — a one-off done before today.
 * @param {Chore} chore
 * @param {Completion[]} completions this chore's, any order
 * @param {string} today 'YYYY-MM-DD'
 * @returns {ChoreNow | null}
 */
export function choreNow(chore, completions, today) {
	if (chore.cadence === 'weeks') return scheduleNow(chore, completions, today);
	if (chore.cadence === 'days') return everySoOftenNow(chore, completions, today);

	const done = latest(completions);
	const countsFor = chore.due_on || dayOf(chore.created_at);
	if (done) {
		if (dayOf(done.done_at) !== today) return null;
		return { chore, state: 'done', due: chore.due_on, countsFor, done, streak: 0 };
	}
	return {
		chore,
		state: stateFor(chore.due_on, today),
		due: chore.due_on,
		countsFor,
		done: null,
		streak: 0
	};
}

/**
 * @param {Chore} chore
 * @param {Completion[]} completions
 * @param {string} today
 * @returns {ChoreNow}
 */
function scheduleNow(chore, completions, today) {
	const byDay = new Map(completions.map((c) => [c.counts_for, c]));
	const { prev, next } = scheduleAround(chore, today);
	const streak = scheduleStreak(chore, byDay, today);

	// Yesterday's still open: done and not tapped counts, for a day.
	if (prev && daysBetween(prev, today) <= GRACE_DAYS) {
		const c = byDay.get(prev);
		if (!c) return { chore, state: 'late', due: prev, countsFor: prev, done: null, streak };
		if (dayOf(c.done_at) === today)
			return { chore, state: 'done', due: prev, countsFor: prev, done: c, streak };
	}

	const c = byDay.get(next) || null;
	return {
		chore,
		state: c ? 'done' : stateFor(next, today),
		due: next,
		countsFor: next,
		done: c,
		streak
	};
}

/**
 * Scheduled days met in a row, back from the latest. The day coming up, and
 * yesterday's while it's in its grace day, don't break it — only a day gone
 * by undone does.
 * @param {Chore} chore
 * @param {Map<string, Completion>} byDay
 * @param {string} today
 */
function scheduleStreak(chore, byDay, today) {
	const period = 7 * (chore.every || 1);
	const start = /** @type {string} */ (chore.due_on);
	const { prev, next } = scheduleAround(chore, today);

	let streak = byDay.has(next) ? 1 : 0;
	let day = prev;
	if (day && !byDay.has(day) && daysBetween(day, today) <= GRACE_DAYS) day = addDays(day, -period);
	while (day && day >= start && byDay.has(day)) {
		streak += 1;
		day = addDays(day, -period);
	}
	return streak;
}

/**
 * @param {Chore} chore
 * @param {Completion[]} completions
 * @param {string} today
 * @returns {ChoreNow}
 */
function everySoOftenNow(chore, completions, today) {
	const every = chore.every || 1;
	const sorted = [...completions].sort((a, b) => a.counts_for.localeCompare(b.counts_for));
	const last = sorted[sorted.length - 1] || null;
	const streak = everySoOftenStreak(chore, sorted, today);

	if (last && last.counts_for === today) {
		// Done today: shown done where it stood, due when it was due.
		const before = sorted[sorted.length - 2];
		const due = before ? addDays(before.counts_for, every) : chore.due_on;
		return { chore, state: 'done', due, countsFor: today, done: last, streak };
	}

	const due = last ? addDays(last.counts_for, every) : /** @type {string} */ (chore.due_on);
	return { chore, state: stateFor(due, today), due, countsFor: today, done: null, streak };
}

/**
 * Times in a row it was done by when it was due (with the grace day), back
 * from the latest — broken once it's gone past due and its grace day.
 * @param {Chore} chore
 * @param {Completion[]} sorted oldest first
 * @param {string} today
 */
function everySoOftenStreak(chore, sorted, today) {
	const every = chore.every || 1;
	const last = sorted[sorted.length - 1];
	if (!last) return 0;
	if (last.counts_for !== today && daysBetween(addDays(last.counts_for, every), today) > GRACE_DAYS)
		return 0;

	let streak = 0;
	for (let i = sorted.length - 1; i >= 0; i--) {
		const due = i > 0 ? addDays(sorted[i - 1].counts_for, every) : chore.due_on;
		if (due && daysBetween(due, sorted[i].counts_for) > GRACE_DAYS) break;
		streak += 1;
	}
	return streak;
}

/**
 * Every live chore's turn today, soonest first: late ones, then today's and
 * the whenever ones, then what's coming. A chore keeps its place when it's
 * ticked off, so nothing moves under a thumb.
 * @param {Chore[]} chores
 * @param {Completion[]} completions
 * @param {string} today
 * @returns {ChoreNow[]}
 */
export function boardFor(chores, completions, today) {
	/** @type {Map<number, Completion[]>} */
	const byChore = new Map();
	for (const c of completions) {
		const list = byChore.get(c.chore_id);
		if (list) list.push(c);
		else byChore.set(c.chore_id, [c]);
	}
	/** @type {ChoreNow[]} */
	const board = [];
	for (const chore of chores) {
		const now = choreNow(chore, byChore.get(chore.id) || [], today);
		if (now) board.push(now);
	}
	return board.sort(
		(a, b) =>
			(a.due || today).localeCompare(b.due || today) ||
			String(a.chore.title).localeCompare(String(b.chore.title))
	);
}

/**
 * Which part of the board a turn belongs in: now (late, today, whenever),
 * the coming week, or later.
 * @param {ChoreNow} item
 * @param {string} today
 * @returns {'now' | 'week' | 'later'}
 */
export function whenGroup(item, today) {
	if (!item.due) return 'now';
	const ahead = daysBetween(today, item.due);
	if (ahead <= 0) return 'now';
	return ahead <= 6 ? 'week' : 'later';
}

/**
 * "every Friday", "every other Friday", "every 3 days" — empty for a one-off.
 * @param {Chore} chore
 */
export function cadenceLabel(chore) {
	const every = chore.every || 1;
	if (chore.cadence === 'weeks' && chore.due_on) {
		const day = WEEKDAYS[weekdayOf(chore.due_on)];
		if (every === 1) return `every ${day}`;
		if (every === 2) return `every other ${day}`;
		return `every ${every} weeks, ${day}`;
	}
	if (chore.cadence === 'days') {
		if (every === 1) return 'every day';
		if (every === 7) return 'every week';
		if (every === 14) return 'every two weeks';
		return `every ${every} days`;
	}
	return '';
}

/** @param {string} day */
function shortDate(day) {
	return parseLocalDate(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * When it's due, in words: "today", "tomorrow", "Friday", "Oct 16"; and once
 * it's past, gently — "due yesterday", "due Tuesday". Empty for whenever, and
 * for done (the row says who instead).
 * @param {ChoreNow} item
 * @param {string} today
 */
export function dueLabel(item, today) {
	if (!item.due || item.state === 'done') return '';
	const ahead = daysBetween(today, item.due);
	if (ahead === 0) return 'today';
	if (ahead === 1) return 'tomorrow';
	if (ahead === -1) return 'due yesterday';
	const day = ahead > 0 && ahead <= 6 ? WEEKDAYS[weekdayOf(item.due)] : null;
	if (ahead > 0) return day || shortDate(item.due);
	return `due ${ahead >= -6 ? WEEKDAYS[weekdayOf(item.due)] : shortDate(item.due)}`;
}

/**
 * When it was done: the time today, the weekday this week, the date before.
 * @param {string} iso
 * @param {string} today
 */
export function doneWhen(iso, today) {
	const day = dayOf(iso);
	if (day === today)
		return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
	if (daysBetween(day, today) === 1) return 'yesterday';
	if (daysBetween(day, today) <= 6) return WEEKDAYS[weekdayOf(day)];
	return shortDate(day);
}

/**
 * The people a chore can be for, with their colors: the parents (by name),
 * then the nanny.
 * @param {{ id: string, full_name?: string | null, role?: string | null }[]} profiles
 * @returns {{ id: string, name: string, role: string, color: string }[]}
 */
export function chorePeople(profiles) {
	const rank = (/** @type {string | null | undefined} */ role) => (role === 'nanny' ? 1 : 0);
	return profiles
		.filter((p) => p.role === 'family' || p.role === 'admin' || p.role === 'nanny')
		.sort(
			(a, b) =>
				rank(a.role) - rank(b.role) ||
				String(a.full_name || '').localeCompare(String(b.full_name || ''))
		)
		.map((p, i) => ({
			id: p.id,
			name: String(p.full_name || '').split(' ')[0] || 'Someone',
			role: /** @type {string} */ (p.role),
			color: PERSON_COLORS[i % PERSON_COLORS.length]
		}));
}

/**
 * Who did how many this week (Sunday on), most first.
 * @param {Completion[]} completions
 * @param {Date} weekStart
 * @returns {{ id: string, count: number }[]}
 */
export function weekTally(completions, weekStart) {
	const since = weekStart.getTime();
	/** @type {Record<string, number>} */
	const counts = {};
	for (const c of completions) {
		if (!c.done_by || ms(c.done_at) < since) continue;
		counts[c.done_by] = (counts[c.done_by] || 0) + 1;
	}
	return Object.entries(counts)
		.map(([id, count]) => ({ id, count }))
		.sort((a, b) => b.count - a.count);
}

/**
 * Tidy a typed chore for storage: trimmed, single-spaced, first letter up.
 * @param {string} title
 */
export function cleanChoreTitle(title) {
	const t = String(title || '')
		.trim()
		.replace(/\s+/g, ' ');
	return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}
