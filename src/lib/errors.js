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

/**
 * True when a query failed because the database doesn't have a column or
 * table yet — a supabase/*.sql migration that hasn't been run. PostgREST
 * says PGRST204/PGRST205 from its schema cache; Postgres itself says
 * 42703/42P01.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isMissingSchema(err) {
  const code = /** @type {{ code?: unknown } | null | undefined} */ (err)?.code
  return code === 'PGRST204' || code === 'PGRST205' || code === '42703' || code === '42P01'
}
