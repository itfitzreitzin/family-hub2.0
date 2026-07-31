/**
 * Moon phase, for flavour. Accurate to within a few hours, which is plenty
 * for drawing the right sliver next to the wordmark.
 */

// A known new moon: 2000-01-06 18:14 UTC.
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const SYNODIC_MONTH_MS = 29.530588853 * 24 * 60 * 60 * 1000;

const PHASES = [
	{ name: 'New Moon', meaning: 'a beginning' },
	{ name: 'Waxing Crescent', meaning: 'intention' },
	{ name: 'First Quarter', meaning: 'decision' },
	{ name: 'Waxing Gibbous', meaning: 'refinement' },
	{ name: 'Full Moon', meaning: 'culmination' },
	{ name: 'Waning Gibbous', meaning: 'gratitude' },
	{ name: 'Last Quarter', meaning: 'release' },
	{ name: 'Waning Crescent', meaning: 'rest' }
];

/**
 * Fraction of the lunar cycle elapsed, 0 (new) → 1 (new again).
 * @param {Date} [date]
 * @returns {number}
 */
export function lunarFraction(date = new Date()) {
	const elapsed = date.getTime() - KNOWN_NEW_MOON;
	const fraction = (elapsed % SYNODIC_MONTH_MS) / SYNODIC_MONTH_MS;
	return fraction < 0 ? fraction + 1 : fraction;
}

/**
 * The current phase as an index (0-7), name, and illuminated fraction.
 * @param {Date} [date]
 */
export function moonPhase(date = new Date()) {
	const fraction = lunarFraction(date);
	const index = Math.floor(fraction * 8 + 0.5) % 8;
	// Illumination follows a cosine over the cycle: 0 at new, 1 at full.
	const illumination = (1 - Math.cos(fraction * 2 * Math.PI)) / 2;

	return {
		index,
		fraction,
		illumination,
		waxing: fraction < 0.5,
		...PHASES[index]
	};
}
