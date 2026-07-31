<script>
	import { toast } from '$lib/stores/toast.js';

	const icons = {
		success: '\u2713',
		error: '\u2717',
		warning: '!',
		info: 'i'
	};
</script>

<div class="toast-container" aria-live="polite">
	{#each $toast as t (t.id)}
		<div class="toast toast-{t.type}" role="alert">
			<span class="toast-icon">{icons[t.type] || icons.info}</span>
			<span class="toast-message">{t.message}</span>
			<button
				class="toast-close"
				on:click={() => toast.dismiss(t.id)}
				aria-label="Dismiss notification">&times;</button
			>
		</div>
	{/each}
</div>

<style>
	.toast-container {
		position: fixed;
		top: calc(1rem + var(--safe-top));
		right: 1rem;
		z-index: 10000;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-width: min(400px, calc(100vw - 2rem));
		pointer-events: none;
	}

	/* Each toast is a small scroll pinned to the corner of the screen. */
	.toast {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.8rem 1rem;
		background: var(--surface);
		background-image: linear-gradient(150deg, var(--accent-tint), transparent 55%);
		border: 1px solid var(--border);
		border-left-width: 3px;
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-lg);
		color: var(--text-muted);
		font-size: 0.92rem;
		line-height: 1.45;
		pointer-events: auto;
		animation: toast-in 0.4s var(--ease-out-expo);
	}

	.toast-success {
		border-left-color: var(--growing);
	}

	.toast-error {
		border-left-color: var(--danger);
	}

	.toast-warning {
		border-left-color: var(--accent);
	}

	.toast-info {
		border-left-color: var(--arcane);
	}

	.toast-icon {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		flex-shrink: 0;
		border-radius: 50%;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.toast-success .toast-icon {
		background: var(--growing-dim);
		color: var(--growing);
	}

	.toast-error .toast-icon {
		background: var(--danger-dim);
		color: var(--danger);
	}

	.toast-warning .toast-icon {
		background: var(--accent-dim);
		color: var(--accent-bright);
	}

	.toast-info .toast-icon {
		background: var(--arcane-dim);
		color: var(--arcane);
	}

	.toast-message {
		flex: 1;
		word-break: break-word;
	}

	.toast-close {
		flex-shrink: 0;
		min-height: auto;
		min-width: auto;
		padding: 0;
		background: none;
		border: none;
		color: var(--text-faint);
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
		transition: color var(--transition-fast);
	}

	.toast-close:hover {
		color: var(--danger);
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateX(36px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateX(0) scale(1);
		}
	}

	@media (max-width: 768px) {
		.toast-container {
			top: calc(64px + var(--safe-top));
			right: 0.75rem;
			left: 0.75rem;
			max-width: none;
		}
	}
</style>
