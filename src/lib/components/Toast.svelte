<script>
  import { toast } from '$lib/stores/toast.js'

  const icons = {
    success: '\u2713',
    error: '\u2717',
    warning: '!',
    info: 'i'
  }
</script>

<div class="toast-container" aria-live="polite">
  {#each $toast as t (t.id)}
    <div class="toast toast-{t.type}" role="alert">
      <span class="toast-icon">{icons[t.type] || icons.info}</span>
      <span class="toast-message">{t.message}</span>
      <button class="toast-close" on:click={() => toast.dismiss(t.id)} aria-label="Dismiss notification">&times;</button>
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: min(400px, calc(100vw - 40px));
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    border-radius: 10px;
    background: white;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    animation: slideIn 0.3s ease;
    pointer-events: auto;
    font-size: 0.95em;
    line-height: 1.4;
  }

  .toast-success {
    border-left: 4px solid #48bb78;
  }

  .toast-error {
    border-left: 4px solid #f56565;
  }

  .toast-warning {
    border-left: 4px solid #ed8936;
  }

  .toast-info {
    border-left: 4px solid #667eea;
  }

  .toast-icon {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 0.85em;
    flex-shrink: 0;
  }

  .toast-success .toast-icon {
    background: #c6f6d5;
    color: #22543d;
  }

  .toast-error .toast-icon {
    background: #fed7d7;
    color: #c53030;
  }

  .toast-warning .toast-icon {
    background: #feebc8;
    color: #c05621;
  }

  .toast-info .toast-icon {
    background: #e8eeff;
    color: #4c51bf;
  }

  .toast-message {
    flex: 1;
    color: #2d3748;
    word-break: break-word;
  }

  .toast-close {
    background: none;
    border: none;
    color: #a0aec0;
    font-size: 1.3em;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    flex-shrink: 0;
    min-height: auto;
    min-width: auto;
  }

  .toast-close:hover {
    color: #4a5568;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(100%);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  @media (max-width: 768px) {
    .toast-container {
      top: calc(60px + env(safe-area-inset-top, 0px));
      right: 10px;
      left: 10px;
      max-width: none;
    }
  }
</style>
