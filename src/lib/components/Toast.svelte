<script>
  import { toast } from '$lib/stores/toast.js'
  import { fly, fade } from 'svelte/transition'
</script>

<div class="toast-container" aria-live="polite" aria-atomic="true">
  {#each $toast as t (t.id)}
    <div
      class="toast toast-{t.type}"
      role="alert"
      in:fly={{ y: -30, duration: 250 }}
      out:fade={{ duration: 200 }}
    >
      <span class="toast-icon">
        {#if t.type === 'success'}✓
        {:else if t.type === 'error'}✕
        {:else if t.type === 'warning'}⚠
        {:else}ℹ
        {/if}
      </span>
      <span class="toast-message">{t.message}</span>
      <button class="toast-close" on:click={() => toast.remove(t.id)} aria-label="Dismiss">×</button>
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(420px, calc(100vw - 32px));
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    font-weight: 500;
    font-size: 0.95em;
    pointer-events: auto;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .toast-success {
    background: #f0fff4;
    border: 1px solid #48bb78;
    color: #22543d;
  }

  .toast-error {
    background: #fff5f5;
    border: 1px solid #f56565;
    color: #c53030;
  }

  .toast-warning {
    background: #fffbeb;
    border: 1px solid #ed8936;
    color: #9c4221;
  }

  .toast-info {
    background: #ebf8ff;
    border: 1px solid #4299e1;
    color: #2b6cb0;
  }

  .toast-icon {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-size: 0.8em;
    font-weight: bold;
  }

  .toast-success .toast-icon {
    background: #48bb78;
    color: white;
  }

  .toast-error .toast-icon {
    background: #f56565;
    color: white;
  }

  .toast-warning .toast-icon {
    background: #ed8936;
    color: white;
  }

  .toast-info .toast-icon {
    background: #4299e1;
    color: white;
  }

  .toast-message {
    flex: 1;
    line-height: 1.4;
  }

  .toast-close {
    flex-shrink: 0;
    background: none;
    border: none;
    font-size: 1.3em;
    cursor: pointer;
    opacity: 0.5;
    padding: 0 4px;
    line-height: 1;
    color: inherit;
    min-height: auto;
    min-width: auto;
  }

  .toast-close:hover {
    opacity: 1;
  }

  @media (max-width: 768px) {
    .toast-container {
      top: calc(60px + env(safe-area-inset-top, 0px));
    }
  }
</style>
