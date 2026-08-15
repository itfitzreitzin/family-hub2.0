# Family Hub — Visual Direction

This file is the durable visual brief for Family Hub. It exists because an AI agent's default idea of a polished web app is not the product's target.

## North star

**A cozy household operating system that feels like a lived-in illustrated almanac or magical home console, not a SaaS dashboard wearing pixel-art stickers.**

The interface should feel personal, warm, tactile, calm, and useful enough to live in the kitchen. The visual identity is **Hearth & Hollow**: cozy arcana, storybook warmth, 16-bit/SNES-GBA character, domestic rather than epic fantasy.

The application can be playful, but it is still operational software. Important information must be easier to understand because of the design, not harder.

## What Nick consistently likes

- Cozy witchy / tarot / celestial atmosphere without horror.
- Crisp 16-bit / SNES / GBA pixel-art character.
- Parchment cream, deep plum, midnight charcoal, moss green, muted gold, dusty rose, potion purple, warm brown.
- Dark plum-charcoal outlines and a small number of deliberate shades per object.
- Warm upper-left lighting in pixel art.
- Illustrated household scenes, portraits, still lifes, shelf/wood details, books, candles, plants, stars, moons, and domestic magical objects.
- The interface feeling authored for this specific family rather than purchased from a component library.
- Practical labels inside a whimsical world.
- Strong composition with visual hierarchy rather than a wall of widgets.
- Art used as part of the scene or information architecture.
- Interfaces that can be glanced at, especially on a home display.

## What Nick has rejected or disliked

- Generic Claude/AI dashboard composition: hero card + several equal cards + quick-actions card + stat tiles.
- Every feature being promoted to its own card or top-level page.
- Decorative art simply inserted where an icon used to be without changing the composition.
- Overly polished corporate SaaS minimalism.
- Glassmorphism and translucent floating panels as a default visual language.
- Large gradient backgrounds or gradient-filled CTA buttons.
- Excessive rounded pills, chips, and badges.
- A different icon beside every line of copy.
- Anime-looking character art when the target is 16-bit storybook pixel art.
- Asset drift away from the approved pixel-art style.
- Excessive arcane terminology in practical or safety-critical flows.
- Designs that are beautiful in a mockup but require the user to hunt, scroll, or remember where a feature lives.
- Desktop layouts that become mobile by stacking every card vertically.

## Composition rules

### One surface, not a card collection

A screen should normally read as one composed environment with regions separated by whitespace, typography, rules, background treatment, or structural illustration.

Cards are appropriate when the object itself benefits from containment: a note, a person, an appointment detail, a payment record, a modal, or a discrete interactive object. They are not the default answer to page layout.

### Prioritize the first five seconds

Before decorating a page, answer:

1. What should the user understand first?
2. What should they do next?
3. What may wait behind one tap?

The visual hierarchy must make those answers obvious without explanation.

### Art is structural

Use art to:

- establish place and mood
- mark a meaningful region
- distinguish people or family members
- frame an empty state
- provide a persistent landmark
- support time-of-day or household-state changes
- make a tablet feel like a household appliance

Do not use art merely to make a generic card more decorative.

### Operational clarity wins

Medication, emergency contacts, money, time tracking, permissions, destructive actions, stale/offline warnings, and error messages should use straightforward language and restrained visual treatment.

Whimsy belongs around them, not inside the critical instruction.

## Color semantics

Use semantic tokens from the existing design system rather than new raw color values.

- **Gilt / accent:** importance, selection, focused navigation, decorative rules.
- **Moss / growing:** active, currently running, healthy/available state.
- **Ember / danger:** true warning, destructive action, safety concern. Never use it decoratively.
- **Plum / parchment / charcoal / wood:** the environmental base.

If everything is accented, nothing is important.

## Typography

- Display type establishes the storybook/almanac voice.
- Body type must remain effortless to scan.
- Pixel type is reserved for sufficiently large timer/display moments where its character helps; never use it for dense numerical tables.
- Avoid excessive all-caps labels and letter spacing. Use them only for small structural labels where they add hierarchy.
- Large tablet content must remain readable from several feet away.

## Controls

- Primary actions should be large, stable, and clearly labeled.
- A button's visual weight should reflect frequency and consequence.
- Do not make every secondary option look like a CTA.
- Prefer a few stable actions to rotating sets of contextual buttons when muscle memory matters.
- Avoid pill shapes as a default container. Use them for genuinely compact selectors, filters, or statuses.
- Touch targets should be forgiving enough to use while holding a child or carrying something.

## Device personalities

### Phone — action first

The phone is for quick capture, immediate action, and checking what changed. Remove secondary context rather than stacking the entire desktop view.

### Tablet / home display — glance first

The tablet is a household appliance. The default view should:

- have no core-content scrolling
- communicate current household state from several feet away
- keep important actions in stable positions
- minimize navigation and administration
- return to its default ambient state after secondary interactions
- use art to establish a composed home-console environment

### Desktop — planning first

Desktop may show denser calendar, time/pay, configuration, and longer-range planning tools. It still follows the same visual language, but it may expose more controls and context.

## Hearth & Hollow vocabulary

Good uses of flavor:

- The Hearth as a home/ambient concept
- Almanac or Chronicle for a memory/archive surface
- moon phases and celestial marks as secondary atmosphere
- illustrated empty-state copy
- seasonal/time-of-day details

Keep labels practical for frequent actions:

- Add note
- Calendar
- Care Sheet
- Start shift
- End shift
- Mark done
- Medication
- Call
- Pay

Do not rename ordinary actions into riddles.

## Review questions for every visible change

Before approval, ask:

1. Does this still look like a generic dashboard if the pixel-art images are removed? If yes, composition needs more work.
2. Is the hierarchy derived from the user's actual moment, or from the database/features available?
3. Could one large region replace several equal cards?
4. Is every visible element earning its space?
5. Are art and ornament helping navigation or comprehension?
6. Is the mobile/tablet composition genuinely recomposed for that device?
7. Can the primary action be found without reading the entire screen?
8. Are safety and money flows visually quieter and clearer?
9. Does this resemble an approved Family Hub reference more than the model's default UI taste?
10. What would Nick likely call "too Claude" about this screen?

## Reference library workflow

Store approved visual references under `docs/design/references/` when practical, with a small Markdown note explaining what is approved about each image.

A reference does **not** mean “copy the entire screenshot.” Record the transferable qualities, for example:

- composition and density
- border treatment
- navigation model
- pixel-art rendering
- lighting
- parchment texture
- typography hierarchy
- use of whitespace

Also record rejected iterations when they expose a recurring failure mode. A short note like “too card-grid / too anime / too decorative for the care flow” is valuable training data for future agents.

## Current tablet direction

The home display should feel like an ambient family status board rather than the current Today dashboard enlarged.

The strongest current direction is:

- a restrained household header
- a dominant Now / Next responsibility or handoff region
- a readable Today timeline
- a small active-note area
- a concise Care-at-a-glance region
- a stable bottom action dock
- time-of-day atmosphere and eventual meaningful home status

The exact composition remains subject to household validation and Nick's visual approval. This section is direction, not an implementation spec.
