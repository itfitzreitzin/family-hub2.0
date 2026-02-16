import { writable } from 'svelte/store'

function createToastStore() {
  const { subscribe, update } = writable([])
  let id = 0

  function add(message, type = 'info', duration = 4000) {
    const toastId = ++id
    update(toasts => [...toasts, { id: toastId, message, type }])
    if (duration > 0) {
      setTimeout(() => dismiss(toastId), duration)
    }
    return toastId
  }

  function dismiss(toastId) {
    update(toasts => toasts.filter(t => t.id !== toastId))
  }

  return {
    subscribe,
    success: (msg, duration) => add(msg, 'success', duration),
    error: (msg, duration) => add(msg, 'error', duration ?? 6000),
    info: (msg, duration) => add(msg, 'info', duration),
    warning: (msg, duration) => add(msg, 'warning', duration),
    dismiss
  }
}

export const toast = createToastStore()

// Confirmation modal store
function createConfirmStore() {
  const { subscribe, set } = writable(null)

  function show({ title = 'Confirm', message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
    return new Promise((resolve) => {
      set({
        title,
        message,
        confirmText,
        cancelText,
        danger,
        resolve
      })
    })
  }

  function close(result) {
    set(null)
    return result
  }

  return { subscribe, show, close }
}

export const confirm = createConfirmStore()

// Prompt modal store
function createPromptStore() {
  const { subscribe, set } = writable(null)

  function show({ title = 'Input', message, placeholder = '', inputType = 'text' }) {
    return new Promise((resolve) => {
      set({
        title,
        message,
        placeholder,
        inputType,
        resolve
      })
    })
  }

  function close(result) {
    set(null)
    return result
  }

  return { subscribe, show, close }
}

export const prompt = createPromptStore()
