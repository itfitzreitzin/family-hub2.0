<script>
  import { confirm, prompt } from '$lib/stores/toast.js'

  let promptValue = ''

  function handleConfirm() {
    $confirm.resolve(true)
    confirm.close()
  }

  function handleCancel() {
    $confirm.resolve(false)
    confirm.close()
  }

  function handlePromptSubmit() {
    $prompt.resolve(promptValue)
    promptValue = ''
    prompt.close()
  }

  function handlePromptCancel() {
    $prompt.resolve(null)
    promptValue = ''
    prompt.close()
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      if ($confirm) handleCancel()
      if ($prompt) handlePromptCancel()
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if $confirm}
  <div class="modal-backdrop" on:click={handleCancel}>
    <div class="modal-box" on:click|stopPropagation role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <h3 id="confirm-title">{$confirm.title}</h3>
      <p>{$confirm.message}</p>
      <div class="modal-actions">
        <button class="btn-cancel" on:click={handleCancel}>{$confirm.cancelText}</button>
        <button
          class="btn-confirm"
          class:danger={$confirm.danger}
          on:click={handleConfirm}
        >
          {$confirm.confirmText}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if $prompt}
  <div class="modal-backdrop" on:click={handlePromptCancel}>
    <div class="modal-box" on:click|stopPropagation role="dialog" aria-modal="true" aria-labelledby="prompt-title">
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
    background: rgba(15, 23, 42, 0.45);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
    padding: 20px;
    animation: fadeIn 0.2s ease;
  }

  .modal-box {
    background: white;
    border-radius: 1.125rem;
    padding: 28px;
    max-width: 420px;
    width: 100%;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0,0,0,0.04);
    animation: modalSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .modal-box h3 {
    margin: 0 0 10px;
    color: var(--color-gray-900, #1a202c);
    font-size: 1.15em;
    letter-spacing: -0.015em;
  }

  .modal-box p {
    margin: 0 0 24px;
    color: var(--color-gray-600, #4a5568);
    line-height: 1.6;
    white-space: pre-line;
    font-size: 0.95em;
  }

  .modal-box input {
    width: 100%;
    padding: 11px 14px;
    border: 1.5px solid var(--color-gray-200, #e2e8f0);
    border-radius: 10px;
    font-size: 16px;
    margin-bottom: 20px;
    background: var(--color-gray-50, #f7fafc);
    transition: all 0.2s;
  }

  .modal-box input:focus {
    outline: none;
    border-color: var(--color-primary, #667eea);
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
    background: white;
  }

  .modal-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .btn-cancel,
  .btn-confirm {
    padding: 10px 20px;
    border-radius: 10px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.9em;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    min-height: auto;
  }

  .btn-cancel {
    background: white;
    color: var(--color-gray-600, #4a5568);
    border: 1.5px solid var(--color-gray-200, #e2e8f0);
  }

  .btn-cancel:hover {
    background: var(--color-gray-50, #f7fafc);
    border-color: var(--color-gray-300, #cbd5e0);
  }

  .btn-confirm {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.25);
  }

  .btn-confirm:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(102, 126, 234, 0.35);
  }

  .btn-confirm.danger {
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25);
  }

  .btn-confirm.danger:hover {
    box-shadow: 0 4px 14px rgba(239, 68, 68, 0.35);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes modalSlideIn {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (max-width: 768px) {
    .modal-box {
      padding: 24px;
    }

    .modal-actions {
      flex-direction: column-reverse;
    }

    .btn-cancel,
    .btn-confirm {
      width: 100%;
      text-align: center;
    }
  }
</style>
