import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'familyhub-theme';

/** Background colours the browser chrome should match, per theme. */
const CHROME = {
	dark: '#150e1e',
	light: '#f2e8d2'
};

/**
 * The theme the inline bootstrap in app.html already resolved. Reading it back
 * (rather than recomputing) keeps the store in lockstep with what's painted.
 * @returns {'dark' | 'light'}
 */
function initial() {
	if (!browser) return 'dark';
	const attr = document.documentElement.getAttribute('data-theme');
	return attr === 'light' ? 'light' : 'dark';
}

/** @param {'dark' | 'light'} value */
function apply(value) {
	if (!browser) return;
	document.documentElement.setAttribute('data-theme', value);
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) meta.setAttribute('content', CHROME[value]);
	try {
		localStorage.setItem(STORAGE_KEY, value);
	} catch {
		// Private browsing — the choice just won't survive a reload.
	}
}

function createTheme() {
	const { subscribe, set, update } = writable(/** @type {'dark' | 'light'} */ (initial()));

	return {
		subscribe,
		/** @param {'dark' | 'light'} value */
		set(value) {
			apply(value);
			set(value);
		},
		toggle() {
			update((current) => {
				const next = current === 'dark' ? 'light' : 'dark';
				apply(next);
				return next;
			});
		}
	};
}

export const theme = createTheme();
