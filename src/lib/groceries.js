// The grocery list's shared bits: the staples, name matching, and the
// quick-add suggestions.
//
// Rows come from public.grocery_items (see supabase/grocery_items.sql). An
// item is on the list while checked_at is null; checked items stay behind as
// history, which is what the suggestions learn from.

/** The things this house always buys — the quick-add chips before there's
 * any history to learn from, and alongside it after. */
export const STAPLES = [
	'Milk',
	'Eggs',
	'Bread',
	'Ground beef',
	'Chicken',
	'Greens',
	'Kale',
	'Onions',
	'Bananas',
	'Diapers',
	'Wipes',
	'Paper towels',
	'Toilet paper'
];

/**
 * The key two names match on: case and stray spaces don't make a new item.
 * Mirrors the database's one_open_grocery_per_name index.
 * @param {string | null | undefined} name
 * @returns {string}
 */
export function groceryKey(name) {
	return String(name || '')
		.trim()
		.replace(/\s+/g, ' ')
		.toLowerCase();
}

/**
 * Tidy a typed name for storage: trimmed, single-spaced, first letter up.
 * @param {string} name
 * @returns {string}
 */
export function cleanGroceryName(name) {
	const t = String(name || '')
		.trim()
		.replace(/\s+/g, ' ');
	return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/**
 * Quick-add chips: what the house buys most often, then the staples, minus
 * anything already on the list.
 * @param {{ name: string }[]} history past items (checked or not), any order
 * @param {{ name: string }[]} open items on the list now
 * @param {number} [limit]
 * @returns {string[]}
 */
export function grocerySuggestions(history, open, limit = 12) {
	const onList = new Set(open.map((i) => groceryKey(i.name)));

	/** @type {Map<string, { name: string, count: number }>} */
	const tally = new Map();
	for (const item of history) {
		const key = groceryKey(item.name);
		if (!key) continue;
		const seen = tally.get(key);
		if (seen) seen.count += 1;
		else tally.set(key, { name: cleanGroceryName(item.name), count: 1 });
	}

	const frequent = [...tally.values()]
		.filter((t) => t.count >= 2)
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
		.map((t) => t.name);

	const out = [];
	const used = new Set();
	for (const name of [...frequent, ...STAPLES]) {
		const key = groceryKey(name);
		if (onList.has(key) || used.has(key)) continue;
		used.add(key);
		out.push(name);
		if (out.length >= limit) break;
	}
	return out;
}

/**
 * "just now", "12m ago", "3h ago", "yesterday", "Tue" — how long an item has
 * been waiting on the list.
 * @param {string} iso
 * @param {number} nowMs
 * @returns {string}
 */
export function sinceLabel(iso, nowMs) {
	const then = new Date(iso);
	const minutes = Math.max(0, Math.round((nowMs - then.getTime()) / 60000));
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	if (hours < 48) return 'yesterday';
	return then.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Store sections, in the order a walk through the store meets them. The
 * list groups by these so it follows the aisles.
 */
export const GROCERY_SECTIONS = [
	'Produce',
	'Meat & Fish',
	'Dairy & Eggs',
	'Bakery',
	'Pantry',
	'Frozen',
	'Drinks',
	'Baby',
	'Household',
	'Other'
];

// Checked in this order, first match wins: the specific before the general
// ("ice cream" is frozen, not dairy; "peanut butter" is pantry; "orange
// juice" is a drink, not produce).
/** @type {[string, string[]][]} */
const SECTION_WORDS = [
	['Frozen', ['frozen', 'ice cream', 'popsicle', 'ice pop']],
	['Baby', ['diaper', 'wipes', 'formula', 'baby', 'pouches', 'teether']],
	[
		'Household',
		[
			'paper towel',
			'toilet paper',
			'tissue',
			'napkin',
			'soap',
			'detergent',
			'dishwasher',
			'trash bag',
			'garbage bag',
			'sponge',
			'foil',
			'plastic wrap',
			'ziploc',
			'cleaner',
			'bleach',
			'shampoo',
			'conditioner',
			'toothpaste',
			'toothbrush',
			'deodorant',
			'batteries',
			'light bulb'
		]
	],
	['Drinks', ['juice', 'water', 'soda', 'seltzer', 'sparkling', 'beer', 'wine', 'kombucha']],
	[
		'Pantry',
		['peanut butter', 'almond butter', 'olive oil', 'tomato sauce', 'canned', 'broth', 'stock']
	],
	[
		'Meat & Fish',
		[
			'beef',
			'chicken',
			'pork',
			'turkey',
			'bacon',
			'sausage',
			'salmon',
			'fish',
			'shrimp',
			'steak',
			'ham',
			'lamb',
			'meat',
			'hot dog'
		]
	],
	[
		'Produce',
		[
			'eggplant',
			'kale',
			'greens',
			'lettuce',
			'spinach',
			'arugula',
			'onion',
			'garlic',
			'banana',
			'apple',
			'berries',
			'berry',
			'avocado',
			'tomato',
			'potato',
			'carrot',
			'pepper',
			'lemon',
			'lime',
			'orange',
			'grape',
			'cucumber',
			'broccoli',
			'cauliflower',
			'celery',
			'cilantro',
			'basil',
			'parsley',
			'mushroom',
			'zucchini',
			'squash',
			'pear',
			'peach',
			'plum',
			'melon',
			'ginger',
			'fruit',
			'veggie',
			'vegetable'
		]
	],
	[
		'Dairy & Eggs',
		['milk', 'egg', 'cheese', 'yogurt', 'yoghurt', 'butter', 'cream', 'kefir', 'cottage']
	],
	['Bakery', ['bread', 'bagel', 'tortilla', 'bun', 'roll', 'muffin', 'croissant', 'pita']],
	[
		'Pantry',
		[
			'rice',
			'pasta',
			'noodle',
			'cereal',
			'oat',
			'flour',
			'sugar',
			'oil',
			'sauce',
			'beans',
			'soup',
			'coffee',
			'tea',
			'jam',
			'honey',
			'syrup',
			'snack',
			'cracker',
			'chips',
			'nuts',
			'spice',
			'salt',
			'vinegar',
			'granola',
			'bar'
		]
	]
];

/**
 * Which store section a thing belongs in, guessed from its name.
 * @param {string} name
 * @returns {string} one of GROCERY_SECTIONS
 */
export function sectionFor(name) {
	// Words match at the start of a word, so "graham" isn't ham and "steak"
	// isn't tea — but "eggs" is egg and "oats" is oat.
	const words = groceryKey(name)
		.split(/[^a-z]+/)
		.filter(Boolean);
	const text = ' ' + words.join(' ');
	for (const [section, cues] of SECTION_WORDS) {
		if (cues.some((cue) => text.includes(' ' + cue))) return section;
	}
	return 'Other';
}

/**
 * Items grouped by store section, sections in walking order, empty ones
 * left out.
 * @template {{ name: string }} T
 * @param {T[]} items
 * @returns {{ section: string, items: T[] }[]}
 */
export function groupBySection(items) {
	/** @type {Map<string, T[]>} */
	const bySection = new Map();
	for (const item of items) {
		const section = sectionFor(item.name);
		const list = bySection.get(section);
		if (list) list.push(item);
		else bySection.set(section, [item]);
	}
	return GROCERY_SECTIONS.filter((s) => bySection.has(s)).map((section) => ({
		section,
		items: /** @type {T[]} */ (bySection.get(section))
	}));
}
