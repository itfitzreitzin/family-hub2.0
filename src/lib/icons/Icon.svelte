<script>
	import { SPRITES, spriteRects } from './sprites.js';

	/** Name of a sprite in sprites.js. */
	export let name = 'star';
	/** Rendered edge length in px. Multiples of 16 stay perfectly crisp. */
	export let size = 20;
	/** Accessible label. Omit for purely decorative icons. */
	export let label = '';

	$: grid = SPRITES[name] || SPRITES.star;
	$: rects = spriteRects(grid);
</script>

<svg
	class="pixel-icon"
	width={size}
	height={size}
	viewBox="0 0 16 16"
	shape-rendering="crispEdges"
	role={label ? 'img' : 'presentation'}
	aria-label={label || undefined}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	{#if label}<title>{label}</title>{/if}
	{#each rects as r, i (i)}
		<rect x={r.x} y={r.y} width={r.w} height="1" fill={r.fill} />
	{/each}
</svg>

<style>
	.pixel-icon {
		display: block;
		flex-shrink: 0;
	}
</style>
