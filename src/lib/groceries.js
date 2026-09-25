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
