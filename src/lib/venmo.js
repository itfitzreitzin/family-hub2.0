// Shared Venmo helpers: handle normalization, payment notes, and deep links.

/**
 * Normalize a Venmo handle for use in links. Returns null when missing so
 * callers must handle the no-handle case instead of paying a bogus default.
 * @param {string | null | undefined} handle
 * @returns {string | null}
 */
export function normalizeVenmoHandle(handle) {
  const cleaned = (handle || '').replace('@', '').trim()
  return cleaned || null
}

/**
 * @returns {boolean}
 */
export function isMobileDevice() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

/**
 * @param {{ direction: 'pay' | 'request', name: string, weekStart: Date, hours: number, rate: number, total: number }} params
 * @returns {string}
 */
export function buildVenmoNote({ direction, name, weekStart, hours, rate, total }) {
  const heading =
    direction === 'request'
      ? `Payment request from ${name}`
      : `Weekly payment for ${name}`
  return `${heading}
Week of ${weekStart.toLocaleDateString()}
Hours: ${hours.toFixed(1)}
Rate: $${rate}/hour
Total: $${total.toFixed(2)}`
}

/**
 * @param {{ txn: 'pay' | 'charge', recipient: string, amount: number, note: string }} params
 * @returns {string}
 */
export function buildVenmoLink({ txn, recipient, amount, note }) {
  return (
    'venmo://paycharge' +
    `?txn=${encodeURIComponent(txn)}` +
    `&recipients=${encodeURIComponent(recipient)}` +
    `&amount=${encodeURIComponent(amount.toFixed(2))}` +
    `&note=${encodeURIComponent(note)}`
  )
}
