# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Design system — "The Hearth & Hollow"

The look is cozy-arcana: tarot gilt over a pixel-farm warmth. Everything lives in
`src/app.css`.

**Themes.** Two, driven off `data-theme` on `<html>`: `dark` (Midnight Arcana,
the default) and `light` (Candlelit Almanac). `src/lib/theme.js` owns the store;
an inline script in `src/app.html` resolves the theme before first paint so the
page never flashes the wrong one. `ThemeToggle.svelte` flips it.

**Tokens.** Style against the semantic names — `--surface`, `--text`,
`--accent`, `--growing`, `--danger`, `--border-gilt` — never the raw hex. Both
themes define the same set, so anything built on them themes for free. Gilt is
the primary accent; moss green (`--growing`) means "on the clock"; ember
(`--danger`) is destructive.

**Type.** Cinzel for headings, Cinzel Decorative for the wordmark, Alegreya Sans
for body — and for every number, timers and money included. Fonts are
self-hosted from `static/fonts` via `src/fonts.css` — no third-party request at
runtime. They're OFL-licensed; see `static/fonts/OFL.txt`.

> Alegreya Sans defaults to old-style figures (3 4 5 7 9 hang below the line).
> The body sets `lining-nums`; columns and ticking timers add `tabular-nums`
> (`.num` does both). `tabular-nums` on its own gives the tabular *old-style*
> set, so always pair them. Cinzel has no lowercase — keep sentences out of it.
> Money on screen goes through `formatMoney` (`src/lib/money.js`): `$1,006.50`.

**Icons.** Line glyphs on a 24-unit grid in `src/lib/icons/glyphs.js`, drawn for
this app. `<Icon name="cottage" size={24} />` renders one; lines take
`currentColor`, and the few solid accents (heart, star, moon, candle flame) take
`--icon-accent`. They replaced 16×16 pixel sprites, which smeared at the 11–16px
the UI actually uses. Pixel art belongs in the paintings (`static/art`,
`src/lib/art.js`), shown at their drawn size. No third-party icon set is used.

**Components.** `MoonPhase` draws the real current lunar phase (`src/lib/moon.js`),
`EmptyState` gives empty screens an illustrated vignette, and `Skeleton` provides
content-shaped loading placeholders.
