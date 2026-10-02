import { json } from '@sveltejs/kit';
import { createServerClient } from '$lib/server/supabase.js';
import { fetchPublicText } from '$lib/server/publicFetch.js';
import { readRecipePage } from '$lib/server/recipePage.js';

// Recipe pages run a few MB with their ads and scripts; the recipe itself is
// a sliver of that.
const FETCH_TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
// Some recipe sites turn away anything that doesn't look like a browser.
const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15 FamilyHub/2.0';

/** Statuses that mean the site turned us away, not that the link is wrong. */
const TURNED_AWAY = new Set([401, 402, 403, 406, 429, 451, 503]);

const PASTE_INSTEAD = 'copy its ingredients and paste them instead.';

/**
 * POST /api/recipe/read
 * Reads a recipe page's ingredients from the schema.org Recipe data it
 * publishes for search engines (see recipePage.js), for the Recipes sheet on
 * the grocery list. Nothing is stored here; the sheet keeps what it's given.
 *
 * Body: { url: string }
 * Requires a signed-in parent (the grocery list is theirs).
 */
export async function POST({ request }) {
	const authHeader = request.headers.get('authorization');
	if (!authHeader) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const token = authHeader.replace('Bearer ', '');
	const supabase = createServerClient(token);

	const {
		data: { user },
		error: authError
	} = await supabase.auth.getUser(token);
	if (authError || !user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// The server fetches pages on the caller's say-so, so only the household's
	// parents may ask it to.
	const { data: profile } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.maybeSingle();
	if (profile?.role !== 'family' && profile?.role !== 'admin') {
		return json({ error: 'Not allowed' }, { status: 403 });
	}

	let link;
	try {
		const body = await request.json();
		link = typeof body.url === 'string' ? body.url.trim() : '';
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}
	if (!link || link.length > 2048) {
		return json({ error: 'A recipe link is required' }, { status: 400 });
	}

	let html;
	try {
		({ text: html } = await fetchPublicText(link, {
			noun: 'recipe',
			thing: 'The recipe page',
			accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
			userAgent: USER_AGENT,
			timeoutMs: FETCH_TIMEOUT_MS,
			maxBytes: MAX_PAGE_BYTES
		}));
	} catch (err) {
		const status = /** @type {any} */ (err)?.status;
		const message = err instanceof Error ? err.message : String(err);
		if (TURNED_AWAY.has(status)) {
			return json(
				{ error: `That site wouldn't let us read the recipe — ${PASTE_INSTEAD}` },
				{ status: 502 }
			);
		}
		if (status === 404 || status === 410) {
			return json(
				{ error: `That page isn't there any more — check the link, or ${PASTE_INSTEAD}` },
				{ status: 502 }
			);
		}
		return json({ error: message }, { status: 502 });
	}

	const found = readRecipePage(html);
	if (!found) {
		// Cloudflare and friends answer 200 with a "just a moment" page.
		const challenged = /just a moment|attention required|enable javascript and cookies/i.test(
			html.slice(0, 5000)
		);
		return json(
			{
				error: challenged
					? `That site wouldn't let us read the recipe — ${PASTE_INSTEAD}`
					: `Couldn't find a recipe on that page — ${PASTE_INSTEAD}`
			},
			{ status: 422 }
		);
	}

	return json({ ...found, source: new URL(link).href });
}
