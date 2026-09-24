// The app's map: three sections, each with its own tabs.
//
// Home is the household's page, Care holds everything about the kids and
// the nanny, and Settings holds the people behind the app. Nav.svelte draws
// this tree; the landing redirects read it too.

import { ART } from '$lib/art.js';

/**
 * @typedef {import('$app/types').Pathname} Pathname
 * @typedef {{ href: Pathname, label: string, roles?: string[] }} NavTab
 * @typedef {{ key: string, href: Pathname, label: string, art: string, roles?: string[], tabs?: NavTab[] }} NavSection
 */

/** @type {NavSection[]} */
export const SECTIONS = [
	{ key: 'home', href: '/home', label: 'Home', art: ART.navHome, roles: ['family', 'admin'] },
	{
		key: 'care',
		href: '/care',
		label: 'Care',
		art: ART.navCare,
		tabs: [
			{ href: '/care', label: 'Today' },
			{ href: '/care/journal', label: 'Journal' },
			{ href: '/care/sheet', label: 'Care Sheet' },
			{ href: '/care/hours', label: 'Hours & Pay' }
		]
	},
	{
		key: 'settings',
		href: '/settings',
		label: 'Settings',
		art: ART.iconOrb,
		tabs: [
			{ href: '/settings', label: 'You' },
			{ href: '/settings/household', label: 'Household' },
			{ href: '/settings/accounts', label: 'Accounts', roles: ['family', 'admin'] }
		]
	}
];

/**
 * Where someone lands after signing in: the nanny's day is Care, the
 * parents' is Home.
 * @param {string | null | undefined} role
 * @returns {'/care' | '/home'}
 */
export function landingFor(role) {
	return role === 'nanny' ? '/care' : '/home';
}

/**
 * @param {{ roles?: string[] }} item a section or a tab
 * @param {string | null | undefined} role
 */
export function visibleTo(item, role) {
	return !item.roles || (!!role && item.roles.includes(role));
}

/**
 * The section a path belongs to, if any (the retired calendar grid has none).
 * @param {string} pathname
 * @returns {NavSection | null}
 */
export function sectionFor(pathname) {
	return SECTIONS.find((s) => pathname === s.href || pathname.startsWith(s.href + '/')) || null;
}

/**
 * A section's first tab shares the section's own path, so it only lights up
 * on an exact match; the others also cover anything beneath them.
 * @param {NavSection} section
 * @param {NavTab} tab
 * @param {string} pathname
 */
export function tabIsActive(section, tab, pathname) {
	if (tab.href === section.href) return pathname === tab.href;
	return pathname === tab.href || pathname.startsWith(tab.href + '/');
}
