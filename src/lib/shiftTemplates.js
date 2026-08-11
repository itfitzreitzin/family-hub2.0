// Repeating shift templates: the pure math and the generator.
//
// A template ("Mon/Wed/Fri 9:00-16:30, weekly") materializes into ordinary
// schedules rows a horizon ahead, so everything that already reads schedules
// — dashboard, tracker, coverage gaps — works untouched. generated_until on
// the template marks how far rows exist; generation only ever moves forward,
// which is what lets a deleted single occurrence STAY deleted (its span is
// never revisited).
//
// Like calendar.js, everything here is pure over its inputs; the Supabase
// client is passed in, never imported.

import { localDateString, parseLocalDate } from '$lib/time.js';

/** How far ahead rows are kept materialized. */
export const GENERATION_HORIZON_DAYS = 56;

/**
 * The dates a template occurs on inside [from, to], inclusive, as
 * 'YYYY-MM-DD' strings. Biweekly parity is anchored to the Sunday of the
 * week containing starts_on — the same day-level math as calendar.js's
 * expander (midnight-anchored day diffs, Math.round absorbing DST).
 *
 * @param {any} template shift_templates row
 * @param {Date} from
 * @param {Date} to
 * @returns {string[]}
 */
export function occurrencesBetween(template, from, to) {
	/** @type {string[]} */
	const dates = [];
	if (!template.days || template.days.length === 0) return dates;

	const startsOn = parseLocalDate(template.starts_on);
	startsOn.setHours(0, 0, 0, 0);

	const anchorSunday = new Date(startsOn);
	anchorSunday.setDate(startsOn.getDate() - startsOn.getDay());

	let untilEnd = null;
	if (template.until) {
		untilEnd = parseLocalDate(template.until);
		untilEnd.setHours(23, 59, 59, 999);
	}

	const cursor = new Date(from);
	cursor.setHours(0, 0, 0, 0);

	for (; cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
		if (cursor < startsOn) continue;
		if (untilEnd && cursor > untilEnd) break;

		const dayName = cursor.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
		if (!template.days.includes(dayName)) continue;

		if (template.pattern === 'biweekly') {
			const daysDiff = Math.round(
				(cursor.getTime() - anchorSunday.getTime()) / (24 * 60 * 60 * 1000)
			);
			if (Math.floor(daysDiff / 7) % 2 !== 0) continue;
		}

		dates.push(localDateString(cursor));
	}

	return dates;
}

/**
 * Materialize a template's rows from just past generated_until through
 * `through` (capped by the template's until), then advance generated_until.
 * Safe to call repeatedly — an already-covered span generates nothing.
 *
 * @param {any} supabase
 * @param {any} template shift_templates row
 * @param {Date} through
 * @param {string} createdBy user id stamped on generated rows
 * @returns {Promise<number>} how many rows were inserted
 */
export async function generateThrough(supabase, template, through, createdBy) {
	const from = parseLocalDate(template.generated_until);
	from.setHours(0, 0, 0, 0);
	from.setDate(from.getDate() + 1);

	let to = new Date(through);
	to.setHours(0, 0, 0, 0);
	if (template.until) {
		const untilDate = parseLocalDate(template.until);
		untilDate.setHours(0, 0, 0, 0);
		if (untilDate < to) to = untilDate;
	}

	if (from > to) return 0;

	const dates = occurrencesBetween(template, from, to);

	if (dates.length > 0) {
		const rows = dates.map((date) => ({
			nanny_id: template.nanny_id,
			date,
			start_time: template.start_time,
			end_time: template.end_time,
			notes: template.notes || '',
			created_by: createdBy,
			template_id: template.id
		}));
		const { error } = await supabase.from('schedules').insert(rows);
		if (error) throw error;
	}

	// Mark the span covered even when it held no occurrences, so top-ups
	// never re-walk it.
	const { error: updateError } = await supabase
		.from('shift_templates')
		.update({ generated_until: localDateString(to) })
		.eq('id', template.id);
	if (updateError) throw updateError;

	return dates.length;
}

/**
 * Keep every active template materialized through the horizon. Returns how
 * many rows were created (0 = nothing needed).
 *
 * @param {any} supabase
 * @param {string} userId stamped as created_by on generated rows
 * @returns {Promise<number>}
 */
export async function topUpTemplates(supabase, userId) {
	const { data, error } = await supabase.from('shift_templates').select('*');
	if (error) throw error;

	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const horizon = new Date(today);
	horizon.setDate(horizon.getDate() + GENERATION_HORIZON_DAYS);

	let created = 0;
	for (const template of data || []) {
		const generatedUntil = parseLocalDate(template.generated_until);
		generatedUntil.setHours(0, 0, 0, 0);
		if (generatedUntil >= horizon) continue;
		if (template.until) {
			const untilDate = parseLocalDate(template.until);
			untilDate.setHours(0, 0, 0, 0);
			if (generatedUntil >= untilDate) continue; // series fully generated
		}
		created += await generateThrough(supabase, template, horizon, userId);
	}
	return created;
}

/**
 * End a series: remove its still-future occurrences and delete the template.
 * Past (and today's) rows survive as plain shifts — schedules.template_id is
 * ON DELETE SET NULL, so history keeps its hours.
 *
 * @param {any} supabase
 * @param {number} templateId
 * @returns {Promise<void>}
 */
export async function endSeries(supabase, templateId) {
	const tomorrow = new Date();
	tomorrow.setHours(0, 0, 0, 0);
	tomorrow.setDate(tomorrow.getDate() + 1);

	const { error: deleteRowsError } = await supabase
		.from('schedules')
		.delete()
		.eq('template_id', templateId)
		.gte('date', localDateString(tomorrow));
	if (deleteRowsError) throw deleteRowsError;

	const { error: deleteTemplateError } = await supabase
		.from('shift_templates')
		.delete()
		.eq('id', templateId);
	if (deleteTemplateError) throw deleteTemplateError;
}

/**
 * Human summary for the manager list: "Weekly · Mon, Wed, Fri · 9:00am–4:30pm".
 * @param {any} template
 * @param {(t: string) => string} formatTime 'HH:MM[:SS]' -> display time
 */
export function describeTemplate(template, formatTime) {
	const cadence = template.pattern === 'biweekly' ? 'Every 2 weeks' : 'Weekly';
	const days = (template.days || []).map((/** @type {string} */ d) => {
		return d.slice(0, 1).toUpperCase() + d.slice(1, 3);
	});
	const span = `${formatTime(template.start_time)} – ${formatTime(template.end_time)}`;
	const until = template.until ? ` · until ${template.until}` : '';
	return `${cadence} · ${days.join(', ')} · ${span}${until}`;
}
