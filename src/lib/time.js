// Shared date/time helpers for the time-tracking pages.
//
// Everything here deliberately works in DEVICE-LOCAL time: shifts are entered
// and read by one household in one timezone. Building date strings from
// toISOString() (UTC) shifted evening entries onto the next day.

/**
 * @param {Date} [date]
 * @returns {string} 'YYYY-MM-DD' in local time
 */
export function localDateString(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * @param {Date} [date]
 * @returns {string} 'HH:MM' in local time
 */
export function localTimeString(date = new Date()) {
  return (
    String(date.getHours()).padStart(2, '0') +
    ':' +
    String(date.getMinutes()).padStart(2, '0')
  )
}

/**
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {string} timeStr 'HH:MM'
 * @returns {Date} that wall-clock moment in local time
 */
export function combineLocalDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}`)
}

/**
 * Parse a timestamp or date-only string in LOCAL time. Bare 'YYYY-MM-DD'
 * strings otherwise parse as UTC midnight and display a day early.
 * @param {string | Date} value
 * @returns {Date}
 */
export function parseLocalDate(value) {
  if (value instanceof Date) return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00`)
  return new Date(value)
}

/**
 * Sunday-to-Saturday bounds of the week `offset` weeks from the current one.
 * @param {number} [offset]
 * @param {Date} [now]
 * @returns {{ start: Date, end: Date }}
 */
export function getWeekBounds(offset = 0, now = new Date()) {
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay())
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(weekStart.getDate() + offset * 7)

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  weekEnd.setHours(23, 59, 59, 999)

  return { start: weekStart, end: weekEnd }
}

/**
 * Week offset (relative to the current week) of the week containing `date`.
 * @param {Date} date
 * @param {Date} [now]
 * @returns {number}
 */
export function weekOffsetFor(date, now = new Date()) {
  /** @param {Date} d */
  const startOfWeek = (d) => {
    const s = new Date(d)
    s.setDate(d.getDate() - d.getDay())
    s.setHours(0, 0, 0, 0)
    return s
  }
  const ms = startOfWeek(date).getTime() - startOfWeek(now).getTime()
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000))
}

/**
 * @param {number} ms
 * @returns {string} 'HH:MM:SS', clamped at 00:00:00 for negative input
 */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return (
    String(hours).padStart(2, '0') +
    ':' +
    String(minutes).padStart(2, '0') +
    ':' +
    String(seconds).padStart(2, '0')
  )
}

/**
 * @param {Date} start
 * @param {Date} end
 * @returns {number} fractional hours between the two moments
 */
export function hoursBetween(start, end) {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60)
}

/**
 * @param {string | Date} value
 * @returns {string} e.g. '09:02 AM'
 */
export function formatTime(value) {
  return parseLocalDate(value).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * @param {string | Date} value
 * @returns {string} e.g. '7/28/2026'
 */
export function formatDate(value) {
  return parseLocalDate(value).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric'
  })
}

/**
 * @param {string | Date} value
 * @returns {string} e.g. 'Jul 28'
 */
export function formatDateShort(value) {
  return parseLocalDate(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  })
}

/**
 * @param {string | Date} value
 * @returns {string} e.g. 'Tue, Jul 28'
 */
export function formatDateWeekday(value) {
  return parseLocalDate(value).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })
}

/**
 * @param {Date} start
 * @param {Date} end
 * @returns {string} e.g. 'Jul 26 - Aug 1, 2026'
 */
export function formatWeekDisplay(start, end) {
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${start.getFullYear()}`
}
