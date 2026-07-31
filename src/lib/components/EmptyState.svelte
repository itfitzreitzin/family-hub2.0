<script>
	import Icon from '$lib/icons/Icon.svelte';

	/** Sprite name to show in the vignette. */
	export let icon = 'cauldron';
	export let title = 'Nothing here yet';
	export let hint = '';
</script>

<div class="empty-vignette">
	<div class="frame">
		<Icon name={icon} size={64} />
		<span class="spark spark-a"><Icon name="star" size={12} /></span>
		<span class="spark spark-b"><Icon name="star" size={9} /></span>
		<span class="spark spark-c"><Icon name="star" size={7} /></span>
	</div>

	<p class="empty-title">{title}</p>
	{#if hint}<p class="empty-hint">{hint}</p>{/if}
	<slot />
</div>

<style>
	.empty-vignette {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		text-align: center;
		padding: clamp(2rem, 6vw, 3rem) 1.25rem;
		color: var(--text-faint);
	}

	.frame {
		position: relative;
		display: grid;
		place-items: center;
		width: 108px;
		height: 108px;
		margin-bottom: 0.5rem;
		border: 1px solid var(--border-soft);
		border-radius: 50%;
		background: radial-gradient(circle at 50% 40%, var(--accent-tint), transparent 70%);
		color: var(--text-faint);
		--icon-accent: var(--accent);
	}

	/* Sparks drift around the vignette at different tempos. */
	.spark {
		position: absolute;
		color: var(--accent);
		--icon-accent: var(--accent-bright);
		animation: drift 4.5s ease-in-out infinite;
	}

	.spark-a {
		top: 6px;
		right: 12px;
	}

	.spark-b {
		bottom: 14px;
		left: 8px;
		animation-delay: 1.1s;
	}

	.spark-c {
		top: 40%;
		left: -4px;
		animation-delay: 2.3s;
	}

	@keyframes drift {
		0%,
		100% {
			opacity: 0.25;
			transform: translateY(0) scale(0.9);
		}
		50% {
			opacity: 1;
			transform: translateY(-5px) scale(1.1);
		}
	}

	.empty-title {
		font-family: var(--font-display);
		font-size: 1.05rem;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}

	.empty-hint {
		font-size: 0.92rem;
		max-width: 36ch;
		line-height: 1.5;
	}
</style>
