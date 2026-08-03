<script>
	import { ART } from '$lib/art.js';

	/**
	 * The gilt rule and four filigree corners that frame the whole screen.
	 *
	 * Purely decorative and never takes a click. Fixed rather than absolute:
	 * the frame belongs to the viewport, not the document, so it stays put on a
	 * long ledger instead of sliding off the top the moment the page scrolls.
	 */

	// One asset, mirrored into all four corners.
	const CORNERS = [
		{ key: 'tl', className: 'tl' },
		{ key: 'tr', className: 'tr' },
		{ key: 'bl', className: 'bl' },
		{ key: 'br', className: 'br' }
	];
</script>

<div class="ornate-frame" aria-hidden="true">
	<span class="frame-rule frame-rule-outer"></span>
	<span class="frame-rule frame-rule-inner"></span>
	{#each CORNERS as corner (corner.key)}
		<img
			src={ART.cornerFiligree}
			alt=""
			class="corner {corner.className}"
			draggable="false"
			decoding="async"
		/>
	{/each}
</div>

<style>
	.ornate-frame {
		position: fixed;
		inset: 0;
		/* Above the nav so the rule reads as framing the whole screen, but under
		   modals (9999) and toasts (10000) so it never sits on top of a dialog. */
		z-index: 9998;
		pointer-events: none;
	}

	/* Namespaced deliberately: app.css already owns a global `.rule` (the tarot
	   section break), and a bare `.rule` here inherits its margin and its
	   ::before/::after gradient lines, which paint a hairline straight across
	   the middle of the screen. */
	.frame-rule {
		position: absolute;
		display: block;
		margin: 0;
		border-style: solid;
	}

	.frame-rule-outer {
		inset: 7px;
		border-width: 2px;
		border-color: var(--border-gilt);
		border-radius: 6px;
	}

	.frame-rule-inner {
		inset: 12px;
		border-width: 1px;
		border-color: var(--border-soft);
		border-radius: 4px;
	}

	.corner {
		position: absolute;
		width: 64px;
		height: 64px;
		opacity: 0.9;
		user-select: none;
		-webkit-user-drag: none;
	}

	.tl {
		top: 0;
		left: 0;
	}
	.tr {
		top: 0;
		right: 0;
		transform: scaleX(-1);
	}
	.bl {
		bottom: 0;
		left: 0;
		transform: scaleY(-1);
	}
	.br {
		bottom: 0;
		right: 0;
		transform: scale(-1, -1);
	}

	/* The gilt reads brighter on parchment than it does on midnight, so pull it
	   back a touch in the light theme rather than letting it shout. */
	:global(:root[data-theme='light']) .corner {
		opacity: 0.75;
	}

	@media (max-width: 720px) {
		.corner {
			width: 40px;
			height: 40px;
		}

		.frame-rule-outer {
			inset: 5px;
		}

		.frame-rule-inner {
			inset: 9px;
		}
	}

	@media print {
		.ornate-frame {
			display: none;
		}
	}
</style>
