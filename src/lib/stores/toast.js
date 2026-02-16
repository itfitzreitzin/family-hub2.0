import { writable } from 'svelte/store'

function createToastStore() {
  const { subscribe, update } = writable([])
  let id = 0

  function add(message, type = 'info', duration = 4000) {
    const toast = { id: ++id, message, type, duration }
    update(toasts => [...toasts, toast])

    if (duration > 0) {
      setTimeout(() => remove(toast.id), duration)
    }

    return toast.id
  }

  function remove(toastId) {
    update(toasts => toasts.filter(t => t.id !== toastId))
  }

  return {
    subscribe,
    success: (msg, duration) => add(msg, 'success', duration),
    error: (msg, duration) => add(msg, 'error', duration ?? 6000),
    info: (msg, duration) => add(msg, 'info', duration),
    warning: (msg, duration) => add(msg, 'warning', duration),
    remove
  }
}

export const toast = createToastStore()
