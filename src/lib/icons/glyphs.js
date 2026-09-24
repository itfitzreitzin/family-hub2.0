/**
 * The UI glyphs: simple line drawings on a 24-unit grid.
 *
 * These replaced hand-coded 16x16 pixel sprites. A pixel grid only renders
 * cleanly at whole multiples of itself, and most icons here sit at 11-16px
 * beside a label, where the sprites smeared into blobs. Lines stay sharp at
 * any size. The pixel-art character lives in the paintings in static/art.
 *
 * Each glyph is a set of path `d` strings:
 *   line  stroked in currentColor (round caps, width set by Icon.svelte);
 *         a zero-length segment ('M12 17h.01') draws a dot
 *   solid filled with --icon-accent, falling back to currentColor — kept for
 *         the few warm accents: heart, star, moon, candle flame
 */

/** @typedef {{ line?: string[], solid?: string[] }} Glyph */

/** A circle as a path, so every glyph is just `d` strings. */
function circle(/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ r) {
	return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
}

/** @type {Record<string, Glyph>} */
export const GLYPHS = {
	/* ── Controls ─────────────────────────────── */

	'chevron-left': { line: ['M15 5l-7 7 7 7'] },
	'chevron-right': { line: ['M9 5l7 7-7 7'] },
	plus: { line: ['M12 5v14', 'M5 12h14'] },
	close: { line: ['M6 6l12 12', 'M18 6L6 18'] },
	check: { line: ['M4.5 12.5l5 5L19.5 7'] },
	menu: { line: ['M4 7h16', 'M4 12h16', 'M4 17h16'] },
	download: { line: ['M12 4v11', 'M7 10.5l5 5 5-5', 'M5 20h14'] },
	warning: {
		line: [
			'M10.3 4.3L2.9 17.6A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-2.9L13.7 4.3a2 2 0 0 0-3.4 0z',
			'M12 9.5v4.5',
			'M12 17.25h.01'
		]
	},
	/** Edit. Kept its old name; drawn as a pencil, which reads as "edit" even
	 * on an icon-only button. */
	quill: {
		line: [
			'M4.5 19.5l1-4.2L15.8 5a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.7 18.5z',
			'M13.8 7l3.2 3.2'
		]
	},
	/** Delete. */
	urn: {
		line: ['M4 7h16', 'M9.5 7V4.5h5V7', 'M6.5 7l1 13h9l1-13', 'M10.25 11v5.5', 'M13.75 11v5.5']
	},
	eye: {
		line: [
			'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z',
			circle(12, 12, 2.75)
		]
	},
	key: { line: [circle(8, 15.5, 3.75), 'M10.7 12.8L19.5 4', 'M16.5 7l2.5 2.5', 'M14 9.5l2 2'] },
	/** Arrive / leave. */
	door: { line: ['M6 21V9.5a6 6 0 0 1 12 0V21', 'M3.5 21h17', 'M14.5 14.5h.01'] },

	/* ── Things ──────────────────────────────── */

	heart: {
		solid: [
			'M12 20.5S3 15.3 3 9.1C3 6.4 5.1 4.5 7.6 4.5c1.8 0 3.3 1 4.4 2.6 1.1-1.6 2.6-2.6 4.4-2.6 2.5 0 4.6 1.9 4.6 4.6 0 6.2-9 11.4-9 11.4z'
		]
	},
	star: {
		solid: [
			'M12 2.5c.9 5.5 4 8.6 9.5 9.5-5.5.9-8.6 4-9.5 9.5-.9-5.5-4-8.6-9.5-9.5 5.5-.9 8.6-4 9.5-9.5z'
		]
	},
	moon: { solid: ['M19.5 15A8 8 0 1 1 9 4.5a6.5 6.5 0 0 0 10.5 10.5z'] },
	sun: {
		line: [
			circle(12, 12, 4),
			'M12 2.5v2',
			'M12 19.5v2',
			'M2.5 12h2',
			'M19.5 12h2',
			'M5.3 5.3l1.4 1.4',
			'M17.3 17.3l1.4 1.4',
			'M5.3 18.7l1.4-1.4',
			'M17.3 6.7l1.4-1.4'
		]
	},
	sprout: {
		line: [
			'M12 21v-8.5',
			'M12 12.5C12 8.5 9.5 6 5 6c0 4 2.5 6.5 7 6.5z',
			'M12 10.5c0-3.5 2.3-6 6.5-6 0 3.5-2.3 6-6.5 6z'
		]
	},
	hourglass: {
		line: [
			'M6 3h12',
			'M6 21h12',
			'M7.5 3c0 5.5 4.5 6.5 4.5 9s-4.5 3.5-4.5 9',
			'M16.5 3c0 5.5-4.5 6.5-4.5 9s4.5 3.5 4.5 9'
		]
	},
	clock: { line: [circle(12, 12, 8.5), 'M12 7.5V12l3 2'] },
	calendar: {
		line: [
			'M6 5.5h12a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2z',
			'M4 10h16',
			'M8.5 3.5v4',
			'M15.5 3.5v4'
		]
	},
	person: { line: [circle(12, 8, 3.5), 'M5 20c.8-3.8 3.5-6 7-6s6.2 2.2 7 6'] },
	coin: {
		line: [
			circle(12, 12, 8.5),
			'M12 6.5v11',
			'M14.7 9.3c-.4-.9-1.4-1.4-2.7-1.4-1.5 0-2.7.8-2.7 1.9 0 2.8 5.5 1.5 5.5 4.3 0 1.2-1.2 2-2.8 2-1.3 0-2.4-.6-2.8-1.5'
		]
	},
	/** Ledgers, notes, print. */
	scroll: {
		line: [
			'M5.75 3.5h12.5a1.75 1.75 0 0 1 0 3.5H5.75a1.75 1.75 0 0 1 0-3.5z',
			'M5.75 17h12.5a1.75 1.75 0 0 1 0 3.5H5.75a1.75 1.75 0 0 1 0-3.5z',
			'M6 7v10',
			'M18 7v10',
			'M9.5 10.5h5',
			'M9.5 13.5h3.5'
		]
	},
	/** A book, open. */
	grimoire: {
		line: [
			'M12 6.5C10.2 5.2 7.7 4.5 4 4.5V18c3.7 0 6.2.7 8 2 1.8-1.3 4.3-2 8-2V4.5c-3.7 0-6.2.7-8 2z',
			'M12 6.5V20'
		]
	},
	candle: {
		line: ['M9 10.5h6V20H9z', 'M12 8.5v2', 'M6.5 20h11'],
		solid: ['M12 2.5c1.6 1.9 2.2 3.1 2.2 4.2a2.2 2.2 0 0 1-4.4 0c0-1.1.6-2.3 2.2-4.2z']
	},
	cottage: { line: ['M3.5 11.5L12 4.5l8.5 7', 'M6 9.5V20h12V9.5', 'M10.25 20v-5h3.5v5'] },
	/** A crystal ball on its stand. */
	crystal: {
		line: [circle(12, 10.5, 6.5), 'M8 20.5h8l-1.3-3.3H9.3z', 'M9.2 8.6a3.3 3.3 0 0 1 2.3-2']
	},
	cat: {
		line: [
			'M5 10.5V4l4 3.5h6L19 4v6.5',
			'M5 10.5c0 5 3 8.5 7 8.5s7-3.5 7-8.5',
			'M9.25 12.25h.01',
			'M14.75 12.25h.01',
			'M11 15h2l-1 1z'
		]
	},
	/** A meal. */
	bowl: {
		line: [
			'M3.5 11h17c0 4.7-3.8 8.5-8.5 8.5S3.5 15.7 3.5 11z',
			'M9.5 21h5',
			'M9.5 8c0-1.3 1-1.7 1-3',
			'M13.5 8c0-1.3 1-1.7 1-3'
		]
	},
	/** A snack. */
	apple: {
		line: [
			'M12 7.8C10.3 6.5 7.6 6.6 6 8.3 4.3 10.1 4.6 14 6.4 16.8c1.3 2 3 3.4 4.5 2.8.4-.2.7-.3 1.1-.3s.7.1 1.1.3c1.5.6 3.2-.8 4.5-2.8 1.8-2.8 2.1-6.7.4-8.5-1.6-1.7-4.3-1.8-6-.5z',
			'M12 7.8c.1-1.9.8-3.3 2.3-4.3'
		]
	},
	/** Potty. */
	droplet: { line: ['M12 3.5c3.2 4 5.5 7.2 5.5 10.2a5.5 5.5 0 0 1-11 0c0-3 2.3-6.2 5.5-10.2z'] },
	/** Medicine. */
	potion: {
		line: [
			'M9.5 3.5h5',
			'M10.5 3.5v5.3L5.6 17.2A2.2 2.2 0 0 0 7.5 20.5h9a2.2 2.2 0 0 0 1.9-3.3L13.5 8.8V3.5',
			'M7.3 14.5h9.4'
		]
	},
	/** Meals and snacks. */
	cauldron: {
		line: [
			'M3.5 10h17',
			'M5 10l1.1 7a3 3 0 0 0 3 2.5h5.8a3 3 0 0 0 3-2.5L19 10',
			'M8 19.5l-1.3 1.5',
			'M16 19.5l1.3 1.5',
			circle(10, 6, 1.1),
			circle(14.25, 4.5, 1.4)
		]
	}
};
