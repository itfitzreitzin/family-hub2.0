// The Care Day's domain: moment kinds and the small formatters shared by
// the cockpit (and, later, the parents' live card and the Chronicle).
//
// Rows come from public.care_moments (see supabase/care_moments.sql). Each
// kind has a different shape — naps are durations, everything else is a
// point in time — and carries its detail in `payload`:
//   meal/snack  { detail?, appetite? ('well' | 'picky') }
//   potty       { outcome ('tried' | 'success' | 'accident') }
//   meds        { name, dose? }
//   note        { text }
//   headsup     { text }

import { ART } from '$lib/art.js';

/**
 * The moment buttons, in cockpit order. `art` is a painted icon where one
 * was drawn for the care log; kinds without a painting use a 16px sprite.
 * `tone` colours the button: 'growing' is the nap timer's moss, 'danger'
 * is the heads-up ember (the only tier meant to ping parents).
 *
 * @type {{
 *   kind: string,
 *   label: string,
 *   art?: string,
 *   sprite?: string,
 *   hint: string,
 *   tone?: 'growing' | 'danger'
 * }[]}
 */
export const MOMENT_KINDS = [
	{ kind: 'nap', label: 'Nap', sprite: 'moon', hint: 'Tap to start, tap to end', tone: 'growing' },
	{
		kind: 'meal',
		label: 'Meal',
		art: ART.iconCauldron,
		sprite: 'cauldron',
		hint: 'A proper plate'
	},
	{ kind: 'snack', label: 'Snack', sprite: 'cauldron', hint: 'A little something' },
	{
		kind: 'potty',
		label: 'Potty',
		art: ART.iconDroplet,
		sprite: 'potion',
		hint: 'Tried, star, or accident'
	},
	{ kind: 'meds', label: 'Meds', sprite: 'potion', hint: 'Name, dose, time' },
	{ kind: 'note', label: 'Note', sprite: 'quill', hint: 'Jot anything down' },
	{
		kind: 'headsup',
		label: 'Heads-up',
		sprite: 'warning',
		hint: 'The parents see this one',
		tone: 'danger'
	}
];

/**
 * @param {string} kind
 * @returns {(typeof MOMENT_KINDS)[number]}
 */
export function momentKind(kind) {
	return MOMENT_KINDS.find((k) => k.kind === kind) || MOMENT_KINDS[MOMENT_KINDS.length - 2];
}

/** Potty logs an outcome, not a judgement: successes get the star, accidents
 * read neutrally — it's readiness data, not failure. */
export const POTTY_OUTCOMES = [
	{ value: 'tried', label: 'Tried' },
	{ value: 'success', label: 'Success' },
	{ value: 'accident', label: 'Accident' }
];

export const APPETITES = [
	{ value: 'well', label: 'Ate well' },
	{ value: 'picky', label: 'Picky' }
];

/**
 * Local midnight before the given moment — the "today" window the meds
 * double-dose guard filters against.
 * @param {number} nowMs
 * @returns {number} ms epoch of local midnight
 */
export function dayStartMs(nowMs) {
	const d = new Date(nowMs);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/**
 * Human length of a span — '45m', '1h 20m', '2h'.
 * @param {number} ms
 * @returns {string}
 */
export function spanLabel(ms) {
	const minutes = Math.max(0, Math.round(ms / 60000));
	if (minutes < 60) return `${minutes}m`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * How long a nap has run: closed naps use their end, open naps run to `now`.
 * @param {{ started_at: string, ended_at?: string | null }} moment
 * @param {number} nowMs
 * @returns {number} ms
 */
export function napLengthMs(moment, nowMs) {
	const start = new Date(moment.started_at).getTime();
	const end = moment.ended_at ? new Date(moment.ended_at).getTime() : nowMs;
	return Math.max(0, end - start);
}

/**
 * One-line body for a timeline row. The time column, kid faces and any live
 * nap badge render separately; this is just the "what happened".
 * @param {{ kind: string, payload?: any }} moment
 * @returns {string}
 */
export function momentSummary(moment) {
	const p = moment.payload || {};
	switch (moment.kind) {
		case 'nap':
			return 'Nap';
		case 'meal':
		case 'snack': {
			const label = moment.kind === 'meal' ? 'Meal' : 'Snack';
			const appetite = p.appetite === 'well' ? 'ate well' : p.appetite === 'picky' ? 'picky' : '';
			const bits = [p.detail, appetite].filter(Boolean).join(' · ');
			return bits ? `${label} — ${bits}` : label;
		}
		case 'potty': {
			const outcome = POTTY_OUTCOMES.find((o) => o.value === p.outcome)?.label;
			return outcome ? `Potty — ${outcome.toLowerCase()}` : 'Potty';
		}
		case 'meds': {
			const bits = [p.name, p.dose].filter(Boolean).join(', ');
			return bits ? `Meds — ${bits}` : 'Meds';
		}
		case 'headsup':
			return p.text || 'Heads-up';
		default:
			return p.text || 'Note';
	}
}

/**
 * Who a moment covers, as a short label.
 * @param {{ kid_ids?: string[] | null }} moment
 * @param {Map<string, any> | Record<string, any>} kidsById
 * @param {number} totalKids
 * @returns {string} 'Indigo', 'Indigo & Juniper', 'Both kids', '' for none
 */
export function momentKidsLabel(moment, kidsById, totalKids) {
	const ids = moment.kid_ids || [];
	if (ids.length === 0) return '';
	if (totalKids > 1 && ids.length >= totalKids) return totalKids === 2 ? 'Both kids' : 'All kids';
	/** @param {string} id */
	const get = (id) => (kidsById instanceof Map ? kidsById.get(id) : kidsById[id]);
	const names = ids.map((id) => get(id)?.name).filter(Boolean);
	if (names.length === 0) return '';
	if (names.length === 1) return names[0];
	if (names.length === 2) return `${names[0]} & ${names[1]}`;
	return `${names[0]} +${names.length - 1}`;
}
