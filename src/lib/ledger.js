// The tracker's weekly ledger: one row per week that has logged hours or a
// payment record, whether or not anyone has pressed the pay button yet.

import { localDateString, parseLocalDate } from './time.js';

/** How many weeks the Purse reads from live entries (older weeks fall back to their payment rows). */
export const LEDGER_WEEKS = 26;

/**
 * 'YYYY-MM-DD' of the Sunday that starts the local week containing `value`.
 * @param {string | Date} value
 * @returns {string}
 */
export function weekStartKey(value) {
	const d = new Date(parseLocalDate(value));
	d.setDate(d.getDate() - d.getDay());
	return localDateString(d);
}

/**
 * @param {string} weekStart 'YYYY-MM-DD'
 * @returns {string} the Saturday that ends that week, 'YYYY-MM-DD'
 */
export function weekEndKey(weekStart) {
	const d = parseLocalDate(weekStart);
	d.setDate(d.getDate() + 6);
	return localDateString(d);
}

/**
 * Merge completed time entries and payment rows into per-week totals.
 *
 * Weeks on or after `since` take their hours from the entries (the live
 * truth, so edits after a payment was recorded still show). Older weeks,
 * whose entries weren't loaded, fall back to the payment row's figures.
 *
 * @param {{ clock_in: string, hours: string | number | null }[]} entries completed entries on or after `since`
 * @param {any[]} payments payment rows for the same nanny
 * @param {number} rate hourly rate
 * @param {string} since 'YYYY-MM-DD' week start of the oldest loaded entries
 * @returns {{ weekStart: string, weekEnd: string, hours: number, amount: number, payment: any }[]} newest first
 */
export function buildWeekLedger(entries, payments, rate, since) {
	/** @type {Map<string, number>} */
	const hoursByWeek = new Map();
	for (const entry of entries) {
		const key = weekStartKey(entry.clock_in);
		hoursByWeek.set(key, (hoursByWeek.get(key) || 0) + (parseFloat(String(entry.hours)) || 0));
	}

	/** @type {Map<string, any>} */
	const paymentByWeek = new Map();
	for (const payment of payments) {
		if (payment?.week_start) paymentByWeek.set(String(payment.week_start).slice(0, 10), payment);
	}

	const weeks = new Set([...hoursByWeek.keys(), ...paymentByWeek.keys()]);

	return [...weeks]
		.map((weekStart) => {
			const payment = paymentByWeek.get(weekStart) || null;
			const live = weekStart >= since;
			const hours = live ? hoursByWeek.get(weekStart) || 0 : parseFloat(payment?.hours) || 0;
			const amount = live ? hours * rate : parseFloat(payment?.amount) || 0;
			return { weekStart, weekEnd: weekEndKey(weekStart), hours, amount, payment };
		})
		.filter((row) => row.hours > 0 || row.payment)
		.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

/**
 * Where a ledger week stands. 'short' is a week recorded as paid for less
 * than its hours now come to — hours logged after the payment, or a week
 * paid while a shift was still running — so it can't hide behind "Paid".
 *
 * @param {{ amount: number, payment: any }} week a buildWeekLedger row
 * @returns {{ status: 'paid' | 'short' | 'unpaid', owed: number }}
 */
export function weekPayStatus(week) {
	const payment = week.payment;
	if (!payment?.is_paid) return { status: 'unpaid', owed: week.amount };
	const owed = Math.round((week.amount - (parseFloat(payment.amount) || 0)) * 100) / 100;
	return owed >= 0.01 ? { status: 'short', owed } : { status: 'paid', owed: 0 };
}

/**
 * Everything the Purse shows as owed, summed across nannies: unpaid weeks at
 * their total, short-paid weeks by the difference. Same rules as the
 * Purse on Hours & Pay, so Home and the Purse never disagree about money.
 *
 * @param {{ nanny_id: string, clock_in: string, hours: string | number | null }[]} entries completed entries on or after `since`, any nanny
 * @param {any[]} payments payment rows, any nanny
 * @param {(nannyId: string) => number} rateFor hourly rate for a nanny
 * @param {string} since 'YYYY-MM-DD' week start of the oldest loaded entries
 * @param {string} [before] 'YYYY-MM-DD' — count only weeks starting earlier (finished weeks)
 * @returns {{ amount: number, hours: number, weeks: number }}
 */
export function outstandingBalance(entries, payments, rateFor, since, before) {
	const nannyIds = new Set([...entries.map((e) => e.nanny_id), ...payments.map((p) => p.nanny_id)]);
	let amount = 0;
	let hours = 0;
	let weeks = 0;
	for (const nannyId of nannyIds) {
		const ledger = buildWeekLedger(
			entries.filter((e) => e.nanny_id === nannyId),
			payments.filter((p) => p.nanny_id === nannyId),
			rateFor(nannyId),
			since
		);
		for (const week of ledger) {
			if (before && week.weekStart >= before) continue;
			const { status, owed } = weekPayStatus(week);
			if (status === 'paid' || owed < 0.01) continue;
			amount += owed;
			hours +=
				status === 'short' ? week.hours - (parseFloat(week.payment?.hours) || 0) : week.hours;
			weeks++;
		}
	}
	return { amount: Math.round(amount * 100) / 100, hours, weeks };
}
