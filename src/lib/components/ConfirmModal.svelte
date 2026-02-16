<script>
  export let show = false
  export let title = 'Are you sure?'
  export let message = ''
  export let confirmText = 'Confirm'
  export let cancelText = 'Cancel'
  export let danger = false
  export let loading = false
  export let onConfirm = () => {}
  export let onCancel = () => {}

  function handleConfirm() {
    onConfirm()
  }

  function handleCancel() {
    show = false
    onCancel()
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') handleCancel()
  }
</script>

{#if show}
  <div class="confirm-overlay" on:click={handleCancel} on:keydown={handleKeydown} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
    <div class="confirm-box" on:click|stopPropagation>
      <h3 id="confirm-title">{title}</h3>
      {#if message}
        <p class="confirm-message">{message}</p>
      {/if}
      <div class="confirm-actions">
        <button
          class="confirm-btn"
          class:danger
          disabled={loading}
          on:click={handleConfirm}
        >
          {loading ? 'Please wait...' : confirmText}
        </button>
        <button class="cancel-btn" on:click={handleCancel} disabled={loading}>
          {cancelText}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .confirm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: fadeIn 0.15s ease;
    padding: 1rem;
  }

  .confirm-box {
    background: white;
    border-radius: 16px;
    padding: 28px;
    max-width: 420px;
    width: 100%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    animation: scaleIn 0.2s ease;
  }

  h3 {
    margin: 0 0 12px 0;
    color: #2d3748;
    font-size: 1.2rem;
  }

  .confirm-message {
    color: #4a5568;
    margin: 0 0 24px 0;
    line-height: 1.5;
  }

  .confirm-actions {
    display: flex;
    gap: 10px;
  }

  .confirm-btn, .cancel-btn {
    flex: 1;
    padding: 12px 20px;
    border: none;
    border-radius: 10px;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.2s;
    min-height: 44px;
  }

  .confirm-btn {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .confirm-btn.danger {
    background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
  }

  .confirm-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
  }

  .confirm-btn.danger:hover:not(:disabled) {
    box-shadow: 0 4px 12px rgba(245, 101, 101, 0.3);
  }

  .confirm-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .cancel-btn {
    background: white;
    color: #4a5568;
    border: 2px solid #e2e8f0;
  }

  .cancel-btn:hover:not(:disabled) {
    background: #f7fafc;
    border-color: #cbd5e0;
  }

  .cancel-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
</style>
