// The family roster's shared bits: member kinds, portraits, ages.
//
// Rows come from public.family_members (see supabase/family_members.sql):
// the whole household — parents, kids, pets — where members are people (and
// animals), not accounts. The Care Day cockpit and the Chronicle both anchor
// to these rows, so the helpers live here rather than in the Family page.

import { ART, avatarFor } from '$lib/art.js';
import { parseLocalDate } from '$lib/time.js';

/**
 * Display order and copy for the three member kinds.
 * @type {{ kind: string, label: string, plural: string }[]}
 */
export const MEMBER_KINDS = [
	{ kind: 'parent', label: 'Parent', plural: 'Parents' },
	{ kind: 'child', label: 'Kid', plural: 'Kids' },
	{ kind: 'pet', label: 'Pet', plural: 'Pets' }
];

/** Painted kid portraits, for children without an uploaded picture. The
 * repo's "Jack"/"Emma" paintings are stand-ins until real portraits arrive —
 * keyed off the member id so each kid keeps the same face between renders. */
const KID_PORTRAITS = [ART.avatarJack, ART.avatarEmma];

/**
 * Portrait for a member card: their avatar_url if set, a stable painted
 * stand-in otherwise. Pets have no painted portrait — callers get null and
 * should render the cat sprite in its place.
 * @param {{ kind?: string, avatar_url?: string | null, id?: string, name?: string } | null | undefined} member
 * @returns {string | null}
 */
export function memberPortrait(member) {
	if (!member) return null;
	if (member.avatar_url) return member.avatar_url;
	if (member.kind === 'pet') return null;

	const key = member.id || member.name || '';
	if (member.kind === 'child') {
		let hash = 0;
		for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
		return KID_PORTRAITS[hash % KID_PORTRAITS.length];
	}

	// Parents share the adult stand-ins the rest of the app uses.
	return avatarFor(key);
}

/**
 * Short age from a birthdate: months under two years, years after.
 * @param {string | null | undefined} birthdate 'YYYY-MM-DD'
 * @param {Date} [now]
 * @returns {string} e.g. '18 mo', '5 yrs', '' when unset
 */
export function ageLabel(birthdate, now = new Date()) {
	if (!birthdate) return '';
	const born = parseLocalDate(birthdate);
	if (Number.isNaN(born.getTime()) || born > now) return '';

	let months = (now.getFullYear() - born.getFullYear()) * 12 + (now.getMonth() - born.getMonth());
	if (now.getDate() < born.getDate()) months -= 1;
	months = Math.max(0, months);

	if (months < 24) return `${months} mo`;
	const years = Math.floor(months / 12);
	return years === 1 ? '1 yr' : `${years} yrs`;
}
