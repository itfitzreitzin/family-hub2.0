<script>
	import { confirm, prompt } from '$lib/stores/toast.js';

	let promptValue = '';

	function handleConfirm() {
		$confirm.resolve(true);
		confirm.close();
	}

	function handleCancel() {
		$confirm.resolve(false);
		confirm.close();
	}

	function handlePromptSubmit() {
		$prompt.resolve(promptValue);
		promptValue = '';
		prompt.close();
	}

	function handlePromptCancel() {
		$prompt.resolve(null);
		promptValue = '';
		prompt.close();
	}

	function handleKeydown(e) {
		if (e.key === 'Escape') {
			if ($confirm) handleCancel();
			if ($prompt) handlePromptCancel();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if $confirm}
	<div class="modal-backdrop" on:click={handleCancel}>
		<div
			class="modal-box"
			on:click|stopPropagation
			role="dialog"
			aria-modal="true"
			aria-labelledby="confirm-title"
		>
			<h3 id="confirm-title">{$confirm.title}</h3>
			<p>{$confirm.message}</p>
			<div class="modal-actions">
				<button class="btn-cancel" on:click={handleCancel}>{$confirm.cancelText}</button>
				<button class="btn-confirm" class:danger={$confirm.danger} on:click={handleConfirm}>
					{$confirm.confirmText}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if $prompt}
	<div class="modal-backdrop" on:click={handlePromptCancel}>
		<div
			class="modal-box"
			on:click|stopPropagation
			role="dialog"
			aria-modal="true"
			aria-labelledby="prompt-title"
		>
			<h3 id="prompt-title">{$prompt.title}</h3>
			{#if $prompt.message}
				<p>{$prompt.message}</p>
			{/if}
			<form on:submit|preventDefault={handlePromptSubmit}>
				<input
					type={$prompt.inputType}
					bind:value={promptValue}
					placeholder={$prompt.placeholder}
					autofocus
					minlength={$prompt.inputType === 'password' ? 6 : undefined}
				/>
				<div class="modal-actions">
					<button type="button" class="btn-cancel" on:click={handlePromptCancel}>Cancel</button>
					<button type="submit" class="btn-confirm">Submit</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background: rgba(8, 5, 15, 0.7);
		backdrop-filter: blur(10px) saturate(120%);
		-webkit-backdrop-filter: blur(10px) saturate(120%);
		animation: veil-in 0.22s ease;
	}

	@keyframes veil-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.modal-box {
		position: relative;
		width: 100%;
		max-width: min(420px, calc(100vw - 2rem));
		padding: clamp(1.35rem, 5vw, 1.85rem);
		background: var(--surface);
		background-image: linear-gradient(155deg, var(--accent-tint), transparent 50%);
		border: 1px solid var(--border-gilt);
		border-radius: var(--card-radius);
		box-shadow: var(--shadow-xl);
		animation: conjure 0.32s var(--ease-out-expo);
	}

	.modal-box::before {
		content: '';
		position: absolute;
		inset: 5px;
		border: 1px solid var(--border-soft);
		border-radius: calc(var(--card-radius) - 4px);
		pointer-events: none;
	}

	@keyframes conjure {
		from {
			opacity: 0;
			transform: translateY(12px) scale(0.97);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.modal-box h3 {
		font-family: var(--font-display);
		font-size: 1.15rem;
		letter-spacing: 0.04em;
		color: var(--accent-bright);
		margin-bottom: 0.55rem;
	}

	.modal-box p {
		color: var(--text-muted);
		font-size: 0.95rem;
		line-height: 1.5;
		margin-bottom: 1.25rem;
	}

	.modal-box input {
		margin-bottom: 1.25rem;
	}

	.modal-actions {
		display: flex;
		gap: 0.6rem;
	}

	.modal-actions button {
		flex: 1;
		min-height: 44px;
		padding: 0.65rem 1.1rem;
		border-radius: var(--radius-sm);
		font-family: var(--font-body);
		font-size: 0.95rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.btn-cancel {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text-muted);
	}

	.btn-cancel:hover {
		border-color: var(--border-gilt);
		color: var(--accent-bright);
		background: var(--accent-tint);
	}

	.btn-confirm {
		background: linear-gradient(160deg, var(--accent-bright), var(--accent));
		border: 1px solid var(--accent);
		color: var(--text-on-accent);
	}

	.btn-confirm:hover {
		box-shadow: var(--glow-gilt);
	}

	/* Destructive confirmations wear ember rather than gilt. */
	.btn-confirm.danger {
		background: linear-gradient(160deg, var(--ember), var(--ember-deep));
		border-color: var(--ember-deep);
		color: #fdf3f0;
	}

	.btn-confirm.danger:hover {
		box-shadow:
			0 0 0 1px var(--danger),
			0 6px 22px var(--danger-dim);
	}

	@media (max-width: 768px) {
		.modal-backdrop {
			padding: 0;
			align-items: flex-end;
		}

		.modal-box {
			max-width: 100%;
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
			border-bottom: none;
			padding-bottom: calc(1.35rem + var(--safe-bottom));
			animation: sheet-up 0.3s var(--ease-out-expo);
		}

		@keyframes sheet-up {
			from {
				transform: translateY(100%);
			}
			to {
				transform: translateY(0);
			}
		}
	}
</style>
