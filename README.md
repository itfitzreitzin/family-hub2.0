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
for body, Pixelify Sans for the shift timer. Fonts are self-hosted from
`static/fonts` via `src/fonts.css` — no third-party request at runtime. They're
OFL-licensed; see `static/fonts/OFL.txt`.

> Pixelify Sans is display-only. Its `5` and `8` are hard to tell apart below
> roughly 1.4rem, so numbers in tables and stat tiles use the body face with
> `font-variant-numeric: tabular-nums` instead.

**Icons.** Original 16×16 pixel sprites in `src/lib/icons/sprites.js`, where each
icon *is* its picture — sixteen rows of sixteen characters. Edit the art by
editing the grid. `<Icon name="cottage" size={24} />` renders one; colour comes
from `currentColor` plus `--icon-accent`. No third-party icon set is used.

**Components.** `MoonPhase` draws the real current lunar phase (`src/lib/moon.js`),
`EmptyState` gives empty screens an illustrated vignette, and `Skeleton` provides
content-shaped loading placeholders.
