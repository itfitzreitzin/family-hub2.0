<script>
	/**
	 * A pixel-art illustration at a fixed size.
	 *
	 * Deliberately NOT `image-rendering: pixelated`. These are 1024px paintings
	 * in a pixel-art style rather than true sprites on a pixel grid, so nearest
	 * -neighbour sampling throws away most of the image on the way down and
	 * leaves the edges crawling. Smooth downscaling from an asset already close
	 * to its display size is both sharper and cheaper.
	 */
	/**
	 * @type {{
	 *   src: string,
	 *   size?: number,
	 *   wide?: boolean,
	 *   label?: string,
	 *   loading?: 'lazy' | 'eager',
	 *   class?: string
	 * }}
	 */
	let {
		src,
		/** Rendered edge length in px. Width when `wide` is set. */
		size = 24,
		/** Let height follow the source aspect ratio instead of squaring it. */
		wide = false,
		/** Accessible label. Leave empty for decorative art. */
		label = '',
		/** `eager` for anything above the fold. */
		loading = 'lazy',
		class: className = ''
	} = $props();
</script>

<img
	{src}
	alt={label}
	width={size}
	height={wide ? undefined : size}
	{loading}
	decoding="async"
	draggable="false"
	aria-hidden={label ? undefined : 'true'}
	class="pixel-art {className}"
	class:wide
	style:--art-size="{size}px"
/>

<style>
	.pixel-art {
		display: block;
		flex-shrink: 0;
		width: var(--art-size);
		height: var(--art-size);
		object-fit: contain;
		user-select: none;
		-webkit-user-drag: none;
	}

	.pixel-art.wide {
		height: auto;
	}
</style>
