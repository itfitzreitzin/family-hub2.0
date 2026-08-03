/**
 * Pixel-art assets, served from static/art.
 *
 * These are illustrations — the hearth scene, the gilt corner filigree, the
 * shelf still lifes and the family portraits. Functional UI icons stay on the
 * hand-authored 16px sprites in $lib/icons: those stay crisp at any size and
 * take their colour from the theme, which a raster can't do.
 *
 * Everything here was downscaled from 1024px masters to roughly twice its
 * display size, so a retina panel gets one image pixel per device pixel and no
 * more. Don't reach past these sizes without re-exporting.
 */
export const ART = {
	heroFamily: '/art/hero-family.webp',
	cornerFiligree: '/art/corner-filigree.png',

	navToday: '/art/nav-today.png',
	navCalendar: '/art/nav-calendar.png',
	navCare: '/art/nav-care.png',
	navHome: '/art/nav-home.png',
	navPayments: '/art/nav-payments.png',

	iconShift: '/art/icon-shift.png',
	iconClock: '/art/icon-clock.png',
	iconOrb: '/art/icon-orb.png',
	iconRituals: '/art/icon-rituals.png',
	iconThermometer: '/art/icon-thermometer.png',
	iconDroplet: '/art/icon-droplet.png',
	iconLock: '/art/icon-lock.png',
	iconCauldron: '/art/icon-cauldron.png',
	iconClipboard: '/art/icon-clipboard.png',
	iconCoins: '/art/icon-coins.png',
	iconPurse: '/art/icon-purse.png',

	shelfLeft: '/art/shelf-left.png',
	shelfCenter: '/art/shelf-center.png',
	shelfRight: '/art/shelf-right.png',
	stillBooksCat: '/art/still-books-cat.png',
	stillClipboard: '/art/still-clipboard.png',

	avatarNick: '/art/avatar-nick.png',
	avatarSarah: '/art/avatar-sarah.png',
	avatarNanny: '/art/avatar-nanny.png',
	avatarJack: '/art/avatar-jack.png',
	avatarEmma: '/art/avatar-emma.png'
};

/** Portraits that can stand in for a person who has no uploaded photo. */
const AVATARS = [ART.avatarNick, ART.avatarSarah, ART.avatarNanny, ART.avatarJack, ART.avatarEmma];

/**
 * Pick a stable stand-in portrait for someone without an avatar. Keyed off the
 * id (or name) so the same person always gets the same face rather than
 * shuffling on every render.
 */
/**
 * @param {string | null | undefined} key
 * @param {string} [fallback]
 * @returns {string}
 */
export function avatarFor(key, fallback = ART.avatarNanny) {
	if (!key) return fallback;
	let hash = 0;
	for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
	return AVATARS[hash % AVATARS.length];
}
