// Fetching a link a household member gave us — a calendar feed, a recipe
// page — from the server. The server will fetch whatever it's handed, so it
// must only reach the public internet: not itself, the cloud metadata
// service, or anything else on a private network. Every redirect hop gets
// the same check, a hung host times out, and a runaway response is cut off.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Loopback, private, link-local (cloud metadata lives at 169.254.169.254),
 * carrier-grade NAT, multicast and reserved ranges, v4 and v6.
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateAddress(ip) {
	if (isIP(ip) === 4) {
		const [a, b] = ip.split('.').map(Number);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a >= 224
		);
	}
	const v6 = ip.toLowerCase();
	if (v6 === '::' || v6 === '::1') return true;
	const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return isPrivateAddress(mapped[1]);
	return /^(f[cd]|fe[89ab]|ff)/.test(v6);
}

/** @param {string} word */
function capitalized(word) {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * A link as a URL the server may fetch, or an error that says why not.
 * webcal:// (iCloud's public calendar links) is https under another name.
 * @param {string} raw
 * @param {string} noun what the link is to, for the messages: 'calendar', 'recipe'
 * @returns {Promise<URL>}
 */
export async function publicUrl(raw, noun) {
	let url;
	try {
		url = new URL(
			String(raw)
				.trim()
				.replace(/^webcals?:\/\//i, 'https://')
		);
	} catch {
		throw new Error(`That ${noun} link isn't a valid web address`);
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error(`${capitalized(noun)} links must start with https://`);
	}
	const host = url.hostname.replace(/^\[|\]$/g, '');
	let addresses;
	try {
		addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
	} catch {
		throw new Error(`Couldn't find the ${noun} host ${host}`);
	}
	if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
		throw new Error(`${capitalized(noun)} links must point to a public internet address`);
	}
	return url;
}

/**
 * Fetch a public link's body as text, following redirects by hand so every
 * hop is checked like the first.
 * @param {string} raw
 * @param {{
 *   noun: string,
 *   thing: string,
 *   accept: string,
 *   userAgent: string,
 *   timeoutMs: number,
 *   maxBytes: number
 * }} options noun for the link ('calendar'), thing for what it returns ('Calendar feed')
 * @returns {Promise<{ text: string, url: URL, status: number }>}
 */
export async function fetchPublicText(
	raw,
	{ noun, thing, accept, userAgent, timeoutMs, maxBytes }
) {
	const signal = AbortSignal.timeout(timeoutMs);
	let target = await publicUrl(raw, noun);
	let response;
	try {
		for (let hop = 0; ; hop++) {
			response = await fetch(target, {
				headers: { Accept: accept, 'User-Agent': userAgent },
				redirect: 'manual',
				signal
			});
			const location = response.headers.get('location');
			if (response.status < 300 || response.status >= 400 || !location) break;
			if (hop >= 3) throw new Error(`${thing} redirected too many times`);
			target = await publicUrl(new URL(location, target).href, noun);
		}
	} catch (err) {
		if (err instanceof Error && err.name === 'TimeoutError') {
			throw new Error(`${thing} timed out after ${timeoutMs / 1000}s`);
		}
		throw err;
	}

	if (!response.ok) {
		await response.body?.cancel();
		throw Object.assign(
			new Error(`Failed to fetch ${noun}: ${response.status} ${response.statusText}`),
			{ status: response.status }
		);
	}

	const declaredLength = Number(response.headers.get('content-length'));
	if (declaredLength > maxBytes) {
		await response.body?.cancel();
		throw new Error(`${thing} is too large to read`);
	}

	// Count bytes as they arrive rather than buffering first and checking after.
	/** @type {Uint8Array[]} */
	const chunks = [];
	let received = 0;
	const reader = response.body?.getReader();
	while (reader) {
		const { done, value } = await reader.read();
		if (done) break;
		received += value.byteLength;
		if (received > maxBytes) {
			await reader.cancel();
			throw new Error(`${thing} is too large to read`);
		}
		chunks.push(value);
	}
	return { text: Buffer.concat(chunks).toString('utf8'), url: target, status: response.status };
}
