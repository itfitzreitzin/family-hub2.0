<script>
	import { GLYPHS } from './glyphs.js';

	/** Name of a glyph in glyphs.js. */
	export let name = 'star';
	/** Rendered edge length in px. */
	export let size = 20;
	/** Accessible label. Omit for purely decorative icons. */
	export let label = '';

	$: glyph = GLYPHS[name] || GLYPHS.star;
	// Heavier lines when small, lighter when large, so a 12px chevron and a
	// 48px empty-state glyph look like the same hand drew them.
	$: stroke = size <= 14 ? 2.25 : size <= 20 ? 2 : size <= 32 ? 1.75 : 1.4;
</script>

<svg
	class="icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	role={label ? 'img' : 'presentation'}
	aria-label={label || undefined}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	{#if label}<title>{label}</title>{/if}
	{#each glyph.line || [] as d (d)}
		<path
			{d}
			fill="none"
			stroke="currentColor"
			stroke-width={stroke}
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	{/each}
	{#each glyph.solid || [] as d (d)}
		<path {d} fill="var(--icon-accent, currentColor)" />
	{/each}
</svg>

<style>
	.icon {
		display: block;
		flex-shrink: 0;
	}
</style>
