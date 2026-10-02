// Reading a recipe page for its ingredients.
//
// Most recipe sites publish the recipe for search engines as schema.org
// Recipe data — JSON-LD in a <script> tag, sometimes microdata on the page
// itself — with the ingredients as a plain list. That's what's read here:
// no AI and nothing guessed from the page's prose. A page without it says
// so, and its ingredients can still be copied and pasted.
//
// Pure over the HTML it's handed; the fetching is publicFetch.js's.

/** @typedef {{ name: string | null, servings: number | null, ingredients: string[] }} FoundRecipe */

/** The named entities recipe pages actually use; numeric ones are decoded generally. */
/** @type {Record<string, string>} */
const ENTITIES = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	frac12: '½',
	frac14: '¼',
	frac34: '¾',
	frac13: '⅓',
	frac23: '⅔',
	frac18: '⅛',
	deg: '°',
	ndash: '–',
	mdash: '—',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
	hellip: '…',
	times: '×',
	eacute: 'é',
	egrave: 'è',
	aacute: 'á',
	iacute: 'í',
	oacute: 'ó',
	uacute: 'ú',
	ntilde: 'ñ',
	ccedil: 'ç',
	auml: 'ä',
	ouml: 'ö',
	uuml: 'ü',
	reg: '',
	trade: '',
	copy: ''
};

/** @param {string} text */
function decodeOnce(text) {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, code) => {
		if (code[0] === '#') {
			const n =
				code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
			return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
		}
		return ENTITIES[code.toLowerCase()] ?? whole;
	});
}

/**
 * Text from a bit of HTML: tags out, entities decoded (twice — plenty of
 * sites encode "&amp;#39;"), spaces single.
 * @param {unknown} html
 * @returns {string}
 */
export function plainText(html) {
	const stripped = String(html ?? '')
		.replace(/<br\s*\/?>/gi, ' ')
		.replace(/<[^>]*>/g, ' ');
	return decodeOnce(decodeOnce(stripped))
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** @param {any} node */
function isRecipe(node) {
	const type = node?.['@type'];
	const types = Array.isArray(type) ? type : [type];
	return types.some((t) => typeof t === 'string' && /(?:^|[:/])Recipe$/i.test(t));
}

/**
 * The first Recipe anywhere in a JSON-LD block: on its own, in a list, in
 * an @graph, or tucked under mainEntity.
 * @param {any} node
 * @param {number} [depth]
 * @returns {any}
 */
function findRecipe(node, depth = 0) {
	if (!node || typeof node !== 'object' || depth > 8) return null;
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = findRecipe(child, depth + 1);
			if (found) return found;
		}
		return null;
	}
	if (isRecipe(node)) return node;
	for (const value of Object.values(node)) {
		const found = findRecipe(value, depth + 1);
		if (found) return found;
	}
	return null;
}

/**
 * A JSON-LD block, forgiving the usual mess: HTML comments or CDATA around
 * it, raw newlines inside its strings.
 * @param {string} raw
 * @returns {any}
 */
function parseJsonLd(raw) {
	const text = raw
		.trim()
		.replace(/^(?:<!--|\/\/\s*<!\[CDATA\[|<!\[CDATA\[)\s*/, '')
		.replace(/\s*(?:-->|\/\/\s*\]\]>|\]\]>)$/, '');
	try {
		return JSON.parse(text);
	} catch {
		try {
			// eslint-disable-next-line no-control-regex
			return JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' '));
		} catch {
			return null;
		}
	}
}

/**
 * How many it serves, from recipeYield: 4, "4", "4 servings", "Serves 4-6",
 * ["4", "4 servings"]. Null when there's no number in a sensible range.
 * @param {unknown} recipeYield
 * @returns {number | null}
 */
export function servingsFrom(recipeYield) {
	const values = Array.isArray(recipeYield) ? recipeYield : [recipeYield];
	for (const value of values) {
		const match = /(\d{1,3})/.exec(plainText(value));
		const n = match ? Number(match[1]) : NaN;
		if (n >= 1 && n <= 99) return n;
	}
	return null;
}

/**
 * One ingredient line, tidied of what recipe plugins leave behind: brackets
 * inside brackets ("((stock cubes), crumbled (Note 1))"), empty ones, a
 * stray comma first ("(, minced)"), and pointers to the page's notes.
 * @param {string} line
 * @returns {string}
 */
export function tidyIngredientLine(line) {
	let flat = '';
	let depth = 0;
	for (const ch of line) {
		if (ch === '(') {
			depth += 1;
			flat += depth === 1 ? '(' : ', ';
		} else if (ch === ')') {
			if (depth === 1) flat += ')';
			if (depth > 0) depth -= 1;
		} else {
			flat += ch;
		}
	}
	return flat
		.replace(/(?:,\s*)?\bnotes?\s+\d+(?:\s+for\s+more)?\b/gi, '')
		.replace(/\(\s*[,;]\s*/g, '(')
		.replace(/\s*[,;]\s*\)/g, ')')
		.replace(/\(\s*\)/g, '')
		.replace(/\s+,/g, ',')
		.replace(/,(?:\s*,)+/g, ',')
		.replace(/\s+/g, ' ')
		.replace(/\(\s+/g, '(')
		.replace(/\s+\)/g, ')')
		.trim();
}

/** @param {unknown} list */
function ingredientLines(list) {
	const values = Array.isArray(list) ? list : typeof list === 'string' ? [list] : [];
	return values
		.flatMap((v) =>
			typeof v === 'string' ? [v] : v && typeof v === 'object' ? [v.text ?? v.name] : []
		)
		.map((v) => tidyIngredientLine(plainText(v)).slice(0, 300))
		.filter((v) => /[a-z]/i.test(v))
		.slice(0, 200);
}

/** @param {string} html */
function fromJsonLd(html) {
	const blocks = html.matchAll(
		/<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi
	);
	for (const [, raw] of blocks) {
		const recipe = findRecipe(parseJsonLd(raw));
		if (!recipe) continue;
		const ingredients = ingredientLines(recipe.recipeIngredient ?? recipe.ingredients);
		if (ingredients.length === 0) continue;
		const name = plainText(Array.isArray(recipe.name) ? recipe.name[0] : recipe.name);
		return {
			name: name ? name.slice(0, 80) : null,
			servings: servingsFrom(recipe.recipeYield ?? recipe.yield),
			ingredients
		};
	}
	return null;
}

/** @param {string} html */
function pageTitle(html) {
	const og =
		/<meta\b[^>]*\bproperty\s*=\s*["']og:title["'][^>]*\bcontent\s*=\s*["']([^"']*)["']/i.exec(
			html
		) ||
		/<meta\b[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*\bproperty\s*=\s*["']og:title["']/i.exec(
			html
		);
	const title = og ? og[1] : /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
	const text = plainText(title || '')
		.replace(/\s+[|–—-]\s+[^|–—-]+$/, '')
		.trim();
	return text ? text.slice(0, 80) : null;
}

/** @param {string} html */
function fromMicrodata(html) {
	/** @type {string[]} */
	const found = [];
	const elements = html.matchAll(
		/<([a-z][a-z0-9]*)\b[^>]*\bitemprop\s*=\s*["'](?:recipeIngredient|ingredients)["'][^>]*>([\s\S]*?)<\/\1>/gi
	);
	for (const [, , inner] of elements) found.push(inner);
	const metas = html.matchAll(
		/<meta\b[^>]*\bitemprop\s*=\s*["'](?:recipeIngredient|ingredients)["'][^>]*\bcontent\s*=\s*["']([^"']*)["']/gi
	);
	for (const [, content] of metas) found.push(content);
	const ingredients = ingredientLines(found);
	if (ingredients.length === 0) return null;
	const yieldTag =
		/\bitemprop\s*=\s*["']recipeYield["'][^>]*?(?:\bcontent\s*=\s*["']([^"']*)["'][^>]*)?>([^<]*)/i.exec(
			html
		);
	return {
		name: pageTitle(html),
		servings: yieldTag ? servingsFrom(yieldTag[1] || yieldTag[2]) : null,
		ingredients
	};
}

/**
 * The recipe on a page, or null when it doesn't publish one.
 * @param {string} html
 * @returns {FoundRecipe | null}
 */
export function readRecipePage(html) {
	const page = String(html || '');
	return fromJsonLd(page) || fromMicrodata(page);
}
