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
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
    padding: 20px;
    animation: fadeIn 0.2s ease;
  }

  .modal-box {
    background: white;
    border-radius: 15px;
    padding: 30px;
    max-width: 420px;
    width: 100%;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    animation: scaleIn 0.2s ease;
  }

  .modal-box h3 {
    margin: 0 0 12px;
    color: #2d3748;
    font-size: 1.2em;
  }

  .modal-box p {
    margin: 0 0 24px;
    color: #4a5568;
    line-height: 1.5;
    white-space: pre-line;
  }

  .modal-box input {
    width: 100%;
    padding: 12px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-size: 16px;
    margin-bottom: 20px;
  }

  .modal-box input:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
  }

  .modal-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .btn-cancel,
  .btn-confirm {
    padding: 10px 20px;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.95em;
    transition: all 0.2s;
    min-height: auto;
  }

  .btn-cancel {
    background: white;
    color: #4a5568;
    border: 2px solid #e2e8f0;
  }

  .btn-cancel:hover {
    background: #f7fafc;
  }

  .btn-confirm {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
  }

  .btn-confirm:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
  }

  .btn-confirm.danger {
    background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
  }

  .btn-confirm.danger:hover {
    box-shadow: 0 4px 12px rgba(245, 101, 101, 0.3);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes scaleIn {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
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
