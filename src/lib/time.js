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
 * @param {number} year
 * @param {number} month 0-based
 * @returns {{ start: Date, end: Date }} first day 00:00:00 → last day 23:59:59.999, local
 */
export function getMonthBounds(year, month) {
  const start = new Date(year, month, 1)
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999)
  return { start, end }
}

/**
 * @param {number} year
 * @param {number} month 0-based
 * @param {number} delta months to add (may be negative)
 * @returns {{ year: number, month: number }}
 */
export function addMonths(year, month, delta) {
  const d = new Date(year, month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

/**
 * Sunday-start bounds of the month GRID — including the leading and trailing
 * spill days shown around the month itself.
 * @param {number} year
 * @param {number} month 0-based
 * @returns {{ gridStart: Date, gridEnd: Date, startStr: string, endStr: string }}
 */
export function getMonthGridRange(year, month) {
  const { start, end } = getMonthBounds(year, month)

  const gridStart = new Date(start)
  gridStart.setDate(gridStart.getDate() - gridStart.getDay())

  const gridEnd = new Date(end)
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()))
  gridEnd.setHours(23, 59, 59, 999)

  return {
    gridStart,
    gridEnd,
    startStr: localDateString(gridStart),
    endStr: localDateString(gridEnd)
  }
}

/**
 * Month-grid cells in rows of 7, Sunday-first, padded with the neighbouring
 * months' spill days to complete weeks.
 * @param {number} year
 * @param {number} month 0-based
 * @param {string} todayStr 'YYYY-MM-DD' — passed in so callers stay reactive
 * @returns {{ day: number, current: boolean, dateStr: string, isToday: boolean }[][]}
 */
export function buildMonthGrid(year, month, todayStr) {
  const { gridStart, gridEnd } = getMonthGridRange(year, month)
  const cells = []

  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
    const dateStr = localDateString(d)
    cells.push({
      day: d.getDate(),
      current: d.getMonth() === month,
      dateStr,
      isToday: dateStr === todayStr
    })
  }

  const rows = []
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7))
  }
  return rows
}

/**
 * @param {Date} a
 * @param {Date} b
 * @returns {boolean} same local calendar day
 */
export function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Human length of a shift from its wall-clock times. Overnight shifts
 * (end before start) wrap across midnight.
 * @param {string} startTime 'HH:MM' or 'HH:MM:SS'
 * @param {string} endTime 'HH:MM' or 'HH:MM:SS'
 * @returns {string} e.g. '8 hours', '7.5 hours', '1 hour', '45 min'
 */
export function formatShiftLength(startTime, endTime) {
  if (!startTime || !endTime) return ''
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  let minutes = eh * 60 + em - (sh * 60 + sm)
  if (minutes <= 0) minutes += 24 * 60
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  const rounded = Math.round(hours * 10) / 10
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return rounded === 1 ? '1 hour' : `${label} hours`
}

/**
 * Normalize a schedules.date value to 'YYYY-MM-DD'. The column is a DATE but
 * rows have been observed coming back timestamp-shaped.
 * @param {string | Date} value
 * @returns {string}
 */
export function normalizeDateValue(value) {
  if (!value) return ''
  if (value instanceof Date) return localDateString(value)
  if (typeof value === 'string') return value.length > 10 ? value.slice(0, 10) : value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : localDateString(parsed)
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
