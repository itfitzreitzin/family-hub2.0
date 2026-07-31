<script>
	import { theme } from '$lib/theme.js';
	import Icon from '$lib/icons/Icon.svelte';
	import { browser } from '$app/environment';

	export let compact = false;

	function flip() {
		theme.toggle();
		if (browser && window.navigator?.vibrate) window.navigator.vibrate(8);
	}
</script>

<button
	class="theme-toggle"
	class:compact
	on:click={flip}
	aria-label={$theme === 'dark' ? 'Switch to candlelight' : 'Switch to midnight'}
	title={$theme === 'dark' ? 'Light the candles' : 'Draw the curtains'}
>
	<span class="glyph" class:flipped={$theme === 'light'}>
		<span class="face front"><Icon name="moon" size={16} /></span>
		<span class="face back"><Icon name="sun" size={16} /></span>
	</span>
	{#if !compact}
		<span class="label">{$theme === 'dark' ? 'Midnight' : 'Candlelight'}</span>
	{/if}
</button>

<style>
	.theme-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		min-height: 38px;
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-muted);
		cursor: pointer;
		transition: all var(--transition-fast);
		--icon-accent: var(--accent-bright);
	}

	.theme-toggle.compact {
		padding: 0.35rem;
		width: 38px;
		justify-content: center;
	}

	.theme-toggle:hover {
		border-color: var(--border-gilt);
		background: var(--accent-tint);
		color: var(--accent-bright);
	}

	/* The glyph flips like a coin between the two themes. */
	.glyph {
		position: relative;
		width: 16px;
		height: 16px;
		transform-style: preserve-3d;
		transition: transform 0.5s var(--ease-spring);
	}

	.glyph.flipped {
		transform: rotateY(180deg);
	}

	.face {
		position: absolute;
		inset: 0;
		backface-visibility: hidden;
		display: block;
	}

	.back {
		transform: rotateY(180deg);
	}

	.label {
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
</style>
