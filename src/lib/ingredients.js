// Reading amounts and ingredients out of typed text: the add box's "2 milk",
// and a whole pasted recipe or grocery list (one from ChatGPT, a recipe
// site's ingredients, a text from the other parent).
//
// Plain rules, no AI and no network. An amount comes off the front of a line
// ("2 lb ground beef", "1 (15 oz) can black beans") or the back ("milk x2",
// "cheddar (8 oz)"); prep comes off the end ("onion, diced"); bullets,
// headings, intros and method steps are skipped. Whatever it can't read stays
// in the name — the recipe sheet shows every line before anything is added.

import { groceryKey, cleanGroceryName } from './groceries.js';

/** Column limits in grocery_items (see supabase/grocery_items.sql). */
export const NAME_MAX = 80;
export const QUANTITY_MAX = 40;
export const NOTE_MAX = 200;

/** @typedef {{ name: string, quantity: string | null }} Amounted */
/** @typedef {{ key: string, name: string, quantity: string | null, note: string | null }} Ingredient */

// ── Numbers ─────────────────────────────────────────────────

/** @type {Record<string, string>} */
const FRACTION_TEXT = {
	'½': '1/2',
	'⅓': '1/3',
	'⅔': '2/3',
	'¼': '1/4',
	'¾': '3/4',
	'⅕': '1/5',
	'⅖': '2/5',
	'⅗': '3/5',
	'⅘': '4/5',
	'⅙': '1/6',
	'⅚': '5/6',
	'⅛': '1/8',
	'⅜': '3/8',
	'⅝': '5/8',
	'⅞': '7/8'
};
const FRACTION_CHARS = Object.keys(FRACTION_TEXT).join('');

// One number: 2, 1.5, .5, 1/2, 1 1/2, 1½, ½. Then optionally a range: 2-3, 2 to 3.
const NUMBER = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\s*[${FRACTION_CHARS}]|\\d+\\/\\d+|\\d*\\.\\d+|\\d+|[${FRACTION_CHARS}])`;
const RANGE = `${NUMBER}(?:\\s*(?:-|–|—|to|or)\\s*${NUMBER})?`;

/** Spelled-out amounts, and what they're written as on the list. */
/** @type {Record<string, string>} */
const WORD_AMOUNTS = {
	a: '1',
	an: '1',
	one: '1',
	two: '2',
	three: '3',
	four: '4',
	five: '5',
	six: '6',
	seven: '7',
	eight: '8',
	nine: '9',
	ten: '10',
	eleven: '11',
	twelve: '12',
	half: '1/2',
	'half a': '1/2',
	'half an': '1/2',
	'a half': '1/2',
	couple: '2',
	'couple of': '2',
	'a couple': '2',
	'a couple of': '2',
	'a few': 'a few',
	several: 'several'
};

// ── Units ───────────────────────────────────────────────────

// What an amount comes in. Each group is one measure, keyed for comparing
// ("lbs" and "pounds" are the same thing); each spelling list is
// [one, many, other spellings…] so a sum can say "2 cans" and "1 can".
/** @type {[string, ...string[][]][]} */
const UNIT_GROUPS = [
	['lb', ['lb', 'lbs'], ['pound', 'pounds']],
	['oz', ['oz', 'oz'], ['ounce', 'ounces']],
	['fl oz', ['fl oz', 'fl oz'], ['fluid ounce', 'fluid ounces']],
	['g', ['g', 'g', 'gr'], ['gram', 'grams']],
	['kg', ['kg', 'kg', 'kgs'], ['kilo', 'kilos'], ['kilogram', 'kilograms']],
	['ml', ['ml', 'ml'], ['milliliter', 'milliliters'], ['millilitre', 'millilitres']],
	['l', ['l', 'l'], ['liter', 'liters'], ['litre', 'litres']],
	['cup', ['cup', 'cups'], ['c', 'c']],
	['tbsp', ['tbsp', 'tbsp', 'tbsps', 'tbs', 'tbl'], ['tablespoon', 'tablespoons']],
	['tsp', ['tsp', 'tsp', 'tsps'], ['teaspoon', 'teaspoons']],
	['pint', ['pint', 'pints'], ['pt', 'pt']],
	['quart', ['quart', 'quarts'], ['qt', 'qt']],
	['gallon', ['gallon', 'gallons'], ['gal', 'gal']],
	['dozen', ['dozen', 'dozen', 'doz']],
	['can', ['can', 'cans'], ['tin', 'tins']],
	['jar', ['jar', 'jars']],
	['bag', ['bag', 'bags']],
	['box', ['box', 'boxes']],
	['bottle', ['bottle', 'bottles']],
	[
		'pack',
		['pack', 'packs', 'pk', 'pks'],
		['package', 'packages'],
		['pkg', 'pkgs'],
		['packet', 'packets']
	],
	['count', ['count', 'count', 'ct']],
	['carton', ['carton', 'cartons']],
	['container', ['container', 'containers'], ['tub', 'tubs']],
	['case', ['case', 'cases']],
	['jug', ['jug', 'jugs']],
	['pouch', ['pouch', 'pouches']],
	['tray', ['tray', 'trays']],
	['bunch', ['bunch', 'bunches']],
	['head', ['head', 'heads']],
	['clove', ['clove', 'cloves']],
	['bulb', ['bulb', 'bulbs']],
	['stalk', ['stalk', 'stalks'], ['rib', 'ribs']],
	['sprig', ['sprig', 'sprigs']],
	['ear', ['ear', 'ears']],
	['knob', ['knob', 'knobs']],
	['stick', ['stick', 'sticks']],
	['slice', ['slice', 'slices']],
	['strip', ['strip', 'strips']],
	['piece', ['piece', 'pieces'], ['pc', 'pcs']],
	['fillet', ['fillet', 'fillets'], ['filet', 'filets']],
	['link', ['link', 'links']],
	['rack', ['rack', 'racks']],
	['loaf', ['loaf', 'loaves']],
	['roll', ['roll', 'rolls']],
	['sheet', ['sheet', 'sheets']],
	['block', ['block', 'blocks']],
	['envelope', ['envelope', 'envelopes']],
	['pinch', ['pinch', 'pinches']],
	['dash', ['dash', 'dashes']],
	['drop', ['drop', 'drops']],
	['handful', ['handful', 'handfuls']],
	['scoop', ['scoop', 'scoops']]
];

/** Containers: "a case of water" is something to buy, "a cup of water" isn't. */
const CONTAINERS = new Set([
	'can',
	'jar',
	'bag',
	'box',
	'bottle',
	'pack',
	'carton',
	'container',
	'case',
	'jug',
	'pouch',
	'tray'
]);

/** Every spelling → its measure and how to say one or many of it. */
/** @type {Map<string, { key: string, one: string, many: string }>} */
const SPELLINGS = new Map();
for (const [key, ...forms] of UNIT_GROUPS) {
	for (const [one, many, ...others] of forms) {
		for (const spelling of [one, many, ...others]) SPELLINGS.set(spelling, { key, one, many });
	}
}

const UNIT = `(?:${[...SPELLINGS.keys()]
	.sort((a, b) => b.length - a.length)
	.map((s) => s.replace(/ /g, '\\s+'))
	.join('|')})`;

/** Size words that belong with the amount: "2 large eggs", "1 medium onion". */
const SIZE =
	'(?:extra[- ]large|large|medium|small|big|jumbo|heaping|heaped|level|rounded|scant|generous)';

// ── Tidying ─────────────────────────────────────────────────

/**
 * Unicode fractions as typed ones: "1½" → "1 1/2".
 * @param {string} text
 * @returns {string}
 */
function asciiFractions(text) {
	return text
		.replace(
			new RegExp(`(\\d?)\\s*([${FRACTION_CHARS}])`, 'g'),
			(_, whole, f) => (whole ? `${whole} ` : ' ') + FRACTION_TEXT[f]
		)
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Lowercased, accents off, single spaces.
 * @param {string} text
 * @returns {string}
 */
function plain(text) {
	return groceryKey(text).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * The last word as its singular, so "onions" and "Onion" are one thing. Only
 * ever compared, never shown, so a rough rule does: "molasses" and "molasse"
 * never have to look right, only match each other.
 * @param {string} word
 * @returns {string}
 */
function singular(word) {
	if (word.length <= 3) return word;
	if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
	if (/(?:ches|shes|sses|xes|zes|oes)$/.test(word)) return word.slice(0, -2);
	if (word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
	return word;
}

/**
 * The key two ingredients match on: "Yellow onions", "yellow onion" and
 * "Yellow  Onion" are the same thing on a list.
 * @param {string | null | undefined} name
 * @returns {string}
 */
export function ingredientKey(name) {
	const words = plain(String(name || ''))
		.replace(/[^a-z0-9&%' ]+/g, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (words.length) words[words.length - 1] = singular(words[words.length - 1]);
	return words.join(' ');
}

// ── Amounts ─────────────────────────────────────────────────

const LEAD_NUMBER = new RegExp(`^(${RANGE})`, 'i');
// "Half and half" is a thing to buy, not half of one.
const LEAD_WORD = new RegExp(
	`^(?!half\\s+(?:and|&|n)\\s+half\\b)(${Object.keys(WORD_AMOUNTS)
		.sort((a, b) => b.length - a.length)
		.map((w) => w.replace(/ /g, '\\s+'))
		.join('|')})\\s+`,
	'i'
);
const UNIT_START = new RegExp(`^(${UNIT})\\.?(?![a-z])`, 'i');
const SIZE_START = new RegExp(`^(${SIZE})(?![a-z])`, 'i');
const AMOUNT_ONLY = new RegExp(
	`^(?:about\\s+|approx\\.?\\s+|approximately\\s+|~\\s*)?${RANGE}(?:\\s*-?\\s*(?:${UNIT})\\.?)?$`,
	'i'
);

/** Amounts at the end: "milk x2", "milk 2x", "cheddar (8 oz)", "ground beef 2 lb", "milk - 2". */
const TRAILING = [
	new RegExp(`^(.+?)\\s+[x×]\\s*(${RANGE})$`, 'i'),
	new RegExp(`^(.+?)\\s+(${RANGE})\\s*[x×]$`, 'i'),
	new RegExp(`^(.+?)\\s*\\(\\s*((?:about\\s+)?${RANGE}(?:\\s*(?:${UNIT})\\.?)?)\\s*\\)$`, 'i'),
	new RegExp(`^(.+?)(?:\\s*[,:–—-]\\s*|\\s+)(${RANGE}\\s*(?:${UNIT})\\.?)$`, 'i'),
	new RegExp(`^(.+?)\\s*[,:–—-]\\s*(${RANGE})$`, 'i')
];

/**
 * An amount from the front: "2 lb ground beef", "1 (15 oz) can beans",
 * "a pinch of salt", "2x milk".
 * @param {string} text tidy, single-spaced
 * @returns {Amounted | null}
 */
function leadingAmount(text) {
	/** @type {string[]} */
	const parts = [];
	let rest = text;

	const num = LEAD_NUMBER.exec(rest);
	if (num) {
		const after = rest.slice(num[0].length);
		// "2% milk" and "7up" are names, not amounts.
		if (after.startsWith('%')) return null;
		if (/^[a-z]/i.test(after) && !UNIT_START.test(after) && !/^[x×](?![a-z])/i.test(after)) {
			return null;
		}
		parts.push(asciiFractions(num[1]));
		rest = after;
	} else {
		const word = LEAD_WORD.exec(rest);
		if (!word) return null;
		parts.push(WORD_AMOUNTS[word[1].toLowerCase().replace(/\s+/g, ' ')]);
		rest = rest.slice(word[0].length);
	}

	// "1-inch piece ginger": the size rides on the number.
	const inch = /^\s?-?\s?inch(?:es)?(?![a-z])/i.exec(rest);
	if (inch) {
		parts[0] += '-inch';
		rest = rest.slice(inch[0].length);
	}
	rest = rest.trimStart();

	// "2 x milk", "2x milk"
	const times = /^[x×]\s*(?=[a-z])/i.exec(rest);
	if (times && !UNIT_START.test(rest)) rest = rest.slice(times[0].length);

	/** @param {RegExpExecArray | null} match */
	const take = (match) => {
		if (!match) return false;
		rest = rest.slice(match[0].length).trimStart();
		return true;
	};

	// "1 (15 oz) can" — a size in brackets straight after the number
	const size1 = /^\(([^()]{1,30})\)/.exec(rest);
	if (size1 && AMOUNT_ONLY.test(size1[1].trim()) && take(size1)) parts.push(`(${size1[1].trim()})`);

	const size = SIZE_START.exec(rest);
	if (take(size)) parts.push(/** @type {RegExpExecArray} */ (size)[1].toLowerCase());

	const unit = UNIT_START.exec(rest);
	const unitWord = unit ? unit[1].toLowerCase().replace(/\s+/g, ' ') : '';
	if (take(unit)) parts.push(unitWord);

	// "2 cans (15 oz)" — or straight after the unit; "2 cups/250g" too
	const size2 = /^\(([^()]{1,30})\)/.exec(rest) || /^\/\s*([^\s,]{1,12})/.exec(rest);
	if (unit && size2 && AMOUNT_ONLY.test(size2[1].trim()) && take(size2)) {
		parts.push(`(${size2[1].trim()})`);
	}

	rest = rest.replace(/^of\s+/i, '').trim();
	if (!rest) {
		// "6 rolls": the unit was the thing itself.
		if (!unit) return null;
		parts.pop();
		rest = unit[1];
	}
	return { name: rest, quantity: parts.join(' ') };
}

/**
 * An amount from the end: "milk x2", "cheddar (8 oz)", "ground beef 2 lb".
 * A bare trailing number isn't one — "diapers size 4" keeps its 4.
 * @param {string} text
 * @returns {Amounted | null}
 */
function trailingAmount(text) {
	for (const pattern of TRAILING) {
		const m = pattern.exec(text);
		if (m && m[1].trim()) {
			return { name: m[1].trim(), quantity: asciiFractions(m[2]).toLowerCase() };
		}
	}
	return null;
}

/**
 * Split an amount off a typed thing: "2 milk" → 2 + Milk, "ground beef 2 lb"
 * → 2 lb + Ground beef, "milk" → Milk with no amount.
 * @param {string} text
 * @returns {Amounted}
 */
export function splitAmount(text) {
	// \s covers no-break spaces from copied web pages
	const tidy = String(text || '')
		.replace(/\s+/g, ' ')
		.trim();
	const found = leadingAmount(tidy) || trailingAmount(tidy);
	if (!found) return { name: tidy, quantity: null };
	return {
		name: found.name,
		quantity: found.quantity ? found.quantity.slice(0, QUANTITY_MAX).trim() : null
	};
}

// ── Adding amounts up ───────────────────────────────────────

const AMOUNT_VALUE = new RegExp(`^(${NUMBER})(?:\\s*(?:-|–|—|to|or)\\s*(${NUMBER}))?`, 'i');

/**
 * "1 1/2" → 1.5
 * @param {string} text
 * @returns {number}
 */
function numberValue(text) {
	let total = 0;
	for (const part of asciiFractions(text).split(' ')) {
		const frac = /^(\d+)\/(\d+)$/.exec(part);
		total += frac ? Number(frac[1]) / Number(frac[2]) : Number(part);
	}
	return total;
}

/**
 * The number an amount starts with, and what follows it.
 * @param {string} quantity
 * @returns {{ value: number, max: number | null, rest: string } | null}
 */
function readAmount(quantity) {
	const m = AMOUNT_VALUE.exec(quantity.trim());
	if (!m) return null;
	const value = numberValue(m[1]);
	const max = m[2] ? numberValue(m[2]) : null;
	if (!Number.isFinite(value) || value <= 0 || (max !== null && !Number.isFinite(max))) return null;
	return { value, max, rest: quantity.trim().slice(m[0].length).trim() };
}

/**
 * A measure for comparing: "(15 oz) cans" and "(15 oz) can" match, "lbs"
 * and "pounds" match.
 * @param {string} rest
 * @returns {string}
 */
function measureKey(rest) {
	return rest
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.map((w) => SPELLINGS.get(w.replace(/\.$/, ''))?.key ?? w)
		.join(' ');
}

/**
 * Say the measure for this many: "can" → "cans" for 2.
 * @param {string} rest
 * @param {number} count
 * @returns {string}
 */
function inflect(rest, count) {
	const words = rest.split(' ');
	const last = words[words.length - 1];
	const spelling = SPELLINGS.get(last.toLowerCase().replace(/\.$/, ''));
	if (spelling) words[words.length - 1] = count > 1 ? spelling.many : spelling.one;
	return words.join(' ');
}

/** Fractions a recipe would write. */
/** @type {[number, string][]} */
const NICE_FRACTIONS = [
	[1 / 8, '1/8'],
	[1 / 4, '1/4'],
	[1 / 3, '1/3'],
	[3 / 8, '3/8'],
	[1 / 2, '1/2'],
	[5 / 8, '5/8'],
	[2 / 3, '2/3'],
	[3 / 4, '3/4'],
	[7 / 8, '7/8']
];

/**
 * 1.5 → "1 1/2", 0.333 → "1/3", 2.2 → "2.2"
 * @param {number} n
 * @returns {string}
 */
export function formatAmount(n) {
	const whole = Math.floor(n);
	const frac = n - whole;
	if (frac < 0.02) return String(whole);
	if (frac > 0.98) return String(whole + 1);
	for (const [value, text] of NICE_FRACTIONS) {
		if (Math.abs(frac - value) < 0.02) return whole ? `${whole} ${text}` : text;
	}
	return String(Math.round(n * 100) / 100);
}

/**
 * Two amounts of the same thing as one: "1" + "2" → "3", "1 can" + "1 can"
 * → "2 cans". Amounts that don't add up ("1 cup" + "2 tbsp") are kept side
 * by side: "1 cup + 2 tbsp".
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {string | null}
 */
export function combineQuantities(a, b) {
	if (!a) return b || null;
	if (!b) return a;
	const x = readAmount(a);
	const y = readAmount(b);
	if (x && y && x.max === null && y.max === null && measureKey(x.rest) === measureKey(y.rest)) {
		const total = x.value + y.value;
		return x.rest ? `${formatAmount(total)} ${inflect(x.rest, total)}` : formatAmount(total);
	}
	const both = `${a} + ${b}`;
	return both.length <= QUANTITY_MAX ? both : a;
}

/**
 * An amount for more or fewer people: "1 lb" × 2 → "2 lb", "1 can" × 2 →
 * "2 cans". Amounts without a number ("a few sprigs") stay as they are.
 * @param {string | null} quantity
 * @param {number} factor
 * @returns {string | null}
 */
export function scaleQuantity(quantity, factor) {
	if (!quantity || factor === 1) return quantity;
	const x = readAmount(quantity);
	// "1-inch piece": the number is a size, not a count
	if (!x || x.rest.startsWith('-')) return quantity;
	const low = x.value * factor;
	const high = x.max === null ? null : x.max * factor;
	const amount = high === null ? formatAmount(low) : `${formatAmount(low)}-${formatAmount(high)}`;
	return x.rest ? `${amount} ${inflect(x.rest, high ?? low)}` : amount;
}

// ── What every kitchen has ──────────────────────────────────

const FREEBIE_WORDS = new Set([
	'kosher',
	'sea',
	'table',
	'fine',
	'flaky',
	'coarse',
	'fresh',
	'freshly',
	'ground',
	'cracked',
	'black',
	'and',
	'&',
	'cold',
	'warm',
	'hot',
	'boiling',
	'ice',
	'iced',
	'lukewarm',
	'tap',
	'filtered'
]);

/**
 * Water, salt and pepper: in a recipe, never something to buy. (A case of
 * water, or two bell peppers, are.)
 * @param {string} name
 * @param {string | null} [quantity]
 * @returns {boolean}
 */
export function alwaysHave(name, quantity = null) {
	const words = plain(name)
		.replace(/[^a-z& ]+/g, ' ')
		.split(/\s+/)
		.filter((w) => w && !FREEBIE_WORDS.has(w))
		.map(singular);
	if (words.length === 0 || !words.every((w) => w === 'salt' || w === 'pepper' || w === 'water')) {
		return false;
	}
	const amount = quantity ? readAmount(quantity) : null;
	const measure = amount ? measureKey(amount.rest).split(' ').pop() || '' : '';
	if (CONTAINERS.has(measure)) return false;
	// "2 peppers" are bell peppers; "1 tsp pepper" is black pepper.
	if (words.join(' ') === 'pepper' && amount && !measure) return false;
	return true;
}

// ── Pasted recipes and lists ────────────────────────────────

// Prep that comes after a comma and doesn't matter at the store: "onion,
// diced", "butter, melted, divided".
const PREP = new RegExp(
	'^(?:(?:very|finely|roughly|coarsely|thinly|thickly|freshly|lightly|well|loosely|firmly|and|or|then)\\s+)*' +
		'(?:diced|chopped|minced|sliced|grated|shredded|crushed|cubed|julienned|peeled|seeded|deseeded|' +
		'cored|pitted|halved|quartered|trimmed|rinsed|drained|patted|dried|softened|melted|beaten|' +
		'whisked|sifted|toasted|cooked|uncooked|thawed|chilled|warmed|ground|cut|torn|crumbled|juiced|' +
		'zested|stemmed|deveined|shelled|smashed|mashed|pressed|cleaned|washed|divided|separated|packed|' +
		'reserved|removed|discarded|room temp|at room temperature|room temperature|to taste|as needed|' +
		'if desired|for [a-z]+|plus more|or more)\\b',
	'i'
);

const LEFTOVERS =
	/\s*,?\s*(?:to taste|as needed|if needed|if desired|for garnish(?:ing)?|for serving|for topping|for frying|for greasing|for dusting|or more to taste|plus more(?: for [a-z ]+)?)\s*$/i;

const INGREDIENTS_HEADING =
	/^(?:the\s+)?ingredients?(?:\s+list)?(?:\s+for\s+(.+?))?(?:\s*\([^)]*\))?\s*:?$/i;
const STOP_HEADING =
	/^(?:instructions?|directions?|method|steps?|preparation|how to make(?: it)?|to make|notes?|recipe notes|tips?|nutrition(?: facts| information)?|equipment|serving suggestions?|storage|video)\s*:?$/i;
const TITLE_HEADING =
	/(?:grocery|shopping)\s+list\s+for\s+(?:making\s+)?(?:the\s+|a\s+|an\s+|your\s+)?(.+?)\s*:?$/i;

/** Aisle and group headings a list might carry — the list sorts by aisle itself. */
const GROUP_WORDS = new Set(
	[
		'produce',
		'fresh produce',
		'fruit',
		'fruits',
		'vegetables',
		'veggies',
		'fruits and vegetables',
		'fruits & vegetables',
		'meat',
		'meats',
		'meat and seafood',
		'meat & seafood',
		'meat & fish',
		'meat and fish',
		'seafood',
		'protein',
		'proteins',
		'dairy',
		'dairy and eggs',
		'dairy & eggs',
		'eggs and dairy',
		'eggs & dairy',
		'bakery',
		'bread and bakery',
		'bread & bakery',
		'pantry',
		'pantry staples',
		'pantry items',
		'staples',
		'dry goods',
		'canned goods',
		'grains',
		'grains and pasta',
		'grains & pasta',
		'spices',
		'spices and seasonings',
		'spices & seasonings',
		'seasonings',
		'herbs and spices',
		'herbs & spices',
		'condiments',
		'sauces',
		'condiments and sauces',
		'condiments & sauces',
		'oils and vinegars',
		'baking',
		'frozen',
		'frozen foods',
		'beverages',
		'drinks',
		'snacks',
		'deli',
		'household',
		'personal care',
		'baby',
		'other',
		'misc',
		'miscellaneous',
		'optional',
		'grocery list',
		'shopping list'
	].map((w) => w.toLowerCase())
);

const SERVES = /^(?:serves|servings?|yields?|makes)\s*:?\s*(?:about\s+)?(\d{1,2})\b/i;
const META =
	/^(?:(?:prep|cook|total|active|inactive|bake|rest|chill|marinate)\s*(?:time)?\s*:|(?:calories|course|cuisine|keyword|author|difficulty|tip|pro tip|note|hint)\s*:|print\b|jump to\b|pin (?:it|recipe)\b|save recipe\b|scale\b|us customary$|metric$|imperial$|\d+\s*(?:min|mins|minutes|hours?|hrs?)$|(?:\d+(?:\.\d+)?\s*[x×]\s*)+$)/i;
const STEP_VERB =
	/^(?:preheat|heat|add|stir|cook|bake|mix|combine|serve|place|pour|whisk|bring|reduce|simmer|remove|transfer|let|season|garnish|sprinkle|spread|fold|beat|cover|drain|rinse|chop|slice|dice|mince|boil|fry|saute|sauté|toss|knead|set|allow|make|prepare|repeat|divide|arrange|refrigerate|meanwhile|in a|in the|once|when|while|using|use|then|next|finally|first|step)\s/i;

/**
 * A line without its list marks: bullets, checkboxes, "1.", emoji, markdown.
 * @param {string} raw
 * @returns {{ text: string, bulleted: boolean, marked: boolean }}
 */
function unmark(raw) {
	let text = String(raw).replace(/\s+/g, ' ').trim();
	let bulleted = false;
	// "## Produce" is a heading
	let marked = /^#{1,6}\s/.test(text);
	text = text.replace(/^#{1,6}\s+/, '');

	for (let i = 0; i < 4; i++) {
		const before = text;
		text = text
			.replace(/^(?:\p{Extended_Pictographic}|️|‍)+\s*/u, '')
			// "* Milk" is a bullet; "**Produce**" is bold
			.replace(/^(?:[*+]\s+|-\s*|[•·▪▫◦‣⁃–—○●◯□■☐☑☒✓✔✗▢]\s*)/, () => {
				bulleted = true;
				return '';
			})
			.replace(/^\[\s?[xX✓]?\s?\]\s*/, () => {
				bulleted = true;
				return '';
			})
			.replace(/^\d{1,2}[.)]\s+/, () => {
				bulleted = true;
				return '';
			});
		if (text === before) break;
	}

	// "**Produce**" is a heading, bulleted or not
	if (/^(\*\*|__)[^*_]+\1:?$/.test(text)) marked = true;
	text = text
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/(\*\*|__|~~|`)/g, '')
		.replace(/(^|\s)[*_](\S)/g, '$1$2')
		.replace(/(\S)[*_](?=\s|$|[,.;:])/g, '$1')
		.trim();
	// Nothing to buy ends in a colon: "Produce:", "Here's your list for the week:"
	if (/:$/.test(text)) marked = true;
	return { text, bulleted, marked };
}

/**
 * What a heading means for the lines under it.
 * @param {string} text
 * @param {{ bulleted: boolean, marked: boolean }} how
 * @returns {{ kind: 'ingredients' | 'stop' | 'group', title: string | null } | null}
 */
function headingOf(text, { bulleted, marked }) {
	const words = text.split(' ').length;
	const bare = text.replace(/:$/, '').trim().toLowerCase();
	const known = INGREDIENTS_HEADING.test(text) || STOP_HEADING.test(text) || GROUP_WORDS.has(bare);
	if (!marked && !(!bulleted && words <= 4 && known)) return null;

	const ingredients = INGREDIENTS_HEADING.exec(text);
	if (ingredients) return { kind: 'ingredients', title: ingredients[1] || null };
	if (STOP_HEADING.test(text)) return { kind: 'stop', title: null };
	const titled = TITLE_HEADING.exec(text);
	return { kind: 'group', title: titled && titled[1].split(' ').length <= 6 ? titled[1] : null };
}

/**
 * Method steps and chatter, not things to buy.
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeProse(text) {
	const words = text.split(' ').length;
	if (text.length > 120 || words > 14) return true;
	if (/[!?]$/.test(text)) return true;
	if (/\.$/.test(text) && words > 8) return true;
	if (STEP_VERB.test(text) && (words >= 3 || /\.$/.test(text))) return true;
	return false;
}

/**
 * "salt, pepper, garlic powder" is three things; "boneless, skinless chicken
 * thighs, trimmed" is one.
 * @param {string} text
 * @param {boolean} onlyLine
 * @returns {string[]}
 */
function splitListLine(text, onlyLine) {
	const parts = text
		.split(/\s*[,;]\s*/)
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length < 2) return [text];
	const short = parts.every((p) => p.split(' ').length <= 4 && !PREP.test(p));
	return short && (onlyLine || parts.length >= 3) ? parts : [text];
}

/**
 * One line of a recipe as a thing to buy.
 * @param {string} line
 * @returns {Ingredient | null}
 */
function readIngredient(line) {
	/** @type {string[]} */
	const notes = [];
	let text = line
		.replace(/^optional\s*[:-]\s*/i, () => {
			notes.push('optional');
			return '';
		})
		.replace(/^(?:about|approximately|approx\.?|roughly|around|~)\s*/i, '')
		// "Juice of 1 lemon" is a lemon
		.replace(/^(?:the\s+)?(?:juice|zest)(?:\s+and\s+(?:juice|zest))?\s+of\s+/i, '');

	const { name, quantity } = splitAmount(text);
	text = name
		.replace(/\s*\(([^()]*)\)/g, (_, inner) => {
			const note = String(inner).trim();
			if (note && !/^see\b/i.test(note)) notes.push(note);
			return ' ';
		})
		.replace(LEFTOVERS, '')
		.replace(/\s*,?\s*optional\s*$/i, () => {
			notes.push('optional');
			return '';
		});

	const segments = text.split(',');
	while (segments.length > 1 && PREP.test(segments[segments.length - 1].trim())) segments.pop();
	text = segments
		.join(',')
		.replace(/^(?:(?:firmly|lightly|loosely)\s+)?(?:packed|heaping|level|scant|generous)\s+/i, '')
		.replace(/^of\s+/i, '')
		.replace(/[\s.,;:*–—-]+$/, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!/[a-z]/i.test(text)) return null;

	const clean = cleanGroceryName(text).slice(0, NAME_MAX).trim();
	const note = [...new Set(notes)].join('; ').slice(0, NOTE_MAX).trim();
	return {
		key: ingredientKey(clean),
		name: clean,
		quantity: quantity || null,
		note: note || null
	};
}

/**
 * A pasted recipe or grocery list, read into the things it needs. The same
 * thing twice becomes one, amounts added up.
 *
 * When there's an "Ingredients" heading, only what's under it counts (a whole
 * recipe page can be pasted), and the first short line before it is taken as
 * the title. Method steps, times and chatter are skipped.
 * @param {string} text
 * @returns {{ items: Ingredient[], title: string | null, servings: number | null }}
 */
export function parseIngredients(text) {
	const lines = String(text || '')
		.split(/\r?\n/)
		.map(unmark)
		.filter((l) => l.text);
	const hasHeading = lines.some((l) => headingOf(l.text, l)?.kind === 'ingredients');

	/** @type {Map<string, Ingredient>} */
	const found = new Map();
	/** @type {string | null} */
	let title = null;
	/** @type {number | null} */
	let servings = null;
	let before = hasHeading;
	let collecting = !hasHeading;
	// Under an "Optional" heading, everything is.
	let optional = false;

	for (const line of lines) {
		const serves = SERVES.exec(line.text);
		if (serves) {
			const n = Number(serves[1]);
			if (servings === null && n >= 1 && n <= 99) servings = n;
			continue;
		}
		if (META.test(line.text)) continue;

		const heading = headingOf(line.text, line);
		if (heading) {
			optional = /^optional\b/i.test(line.text);
			if (heading.kind === 'ingredients') {
				collecting = true;
				before = false;
			} else if (heading.kind === 'stop') {
				collecting = false;
			}
			if (!title && heading.title) title = heading.title;
			continue;
		}

		if (!collecting) {
			if (before && !title && line.text.length <= 60 && !/[.!?:]$/.test(line.text)) {
				title = line.text;
			}
			continue;
		}
		if (looksLikeProse(line.text)) continue;

		for (const piece of splitListLine(line.text, lines.length === 1)) {
			const item = readIngredient(piece);
			if (!item) continue;
			if (optional && !item.note?.includes('optional')) {
				item.note = item.note ? `optional; ${item.note}` : 'optional';
			}
			const seen = found.get(item.key);
			if (!seen) {
				found.set(item.key, item);
				continue;
			}
			seen.quantity = combineQuantities(seen.quantity, item.quantity);
			if (item.note && item.note !== seen.note) {
				seen.note = (seen.note ? `${seen.note}; ${item.note}` : item.note).slice(0, NOTE_MAX);
			}
		}
	}

	// "chicken tikka masala for 4" → the title, and it serves 4
	if (title) {
		const forN = /\s+for\s+(\d{1,2})(?:\s+(?:people|servings|guests))?$/i.exec(title);
		if (forN) {
			if (servings === null) servings = Number(forN[1]);
			title = title.slice(0, forN.index);
		}
		title =
			cleanGroceryName(title.replace(/[:.]+$/, ''))
				.slice(0, 60)
				.trim() || null;
	}

	return { items: [...found.values()], title, servings };
}
