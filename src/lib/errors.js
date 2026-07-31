// Small error helpers shared by the pages.

/**
 * Human-readable message from any thrown value (supabase-js rejects with
 * plain objects, not Error instances).
 * @param {unknown} err
 * @returns {string}
 */
export function errorMessage(err) {
  const message = /** @type {{ message?: unknown } | null | undefined} */ (err)?.message
  return typeof message === 'string' ? message : String(err)
}
