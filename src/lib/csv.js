// Shared CSV export helpers for timesheet data.

import { formatDate, formatTime, localDateString } from './time.js'

/**
 * @param {unknown} value
 * @returns {string} the value quoted for CSV, embedded quotes doubled
 */
export function csvEscape(value) {
  return '"' + String(value ?? '').replace(/"/g, '""') + '"'
}

/**
 * @param {Array<any>} entries completed time entries
 * @param {(entry: any) => number} rateFor hourly rate to price each entry at
 * @returns {string}
 */
export function buildTimesheetCsv(entries, rateFor) {
  const headers = ['Date', 'Clock In', 'Clock Out', 'Hours', 'Earnings', 'Notes']
  const rows = entries.map((e) => {
    const hours = parseFloat(e.hours) || 0
    return [
      formatDate(e.clock_in),
      formatTime(e.clock_in),
      formatTime(e.clock_out),
      hours.toFixed(2),
      (hours * rateFor(e)).toFixed(2),
      e.notes || ''
    ]
  })
  return [headers, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n')
}

/**
 * @param {{ nannyName?: string | null, weekStart?: Date | null, weekEnd?: Date | null }} params
 * @returns {string} e.g. 'timesheet-daniella-2026-07-26_2026-08-01.csv'
 */
export function timesheetFilename({ nannyName, weekStart, weekEnd }) {
  const slug = (nannyName || 'all-nannies')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const range =
    weekStart && weekEnd
      ? `${localDateString(weekStart)}_${localDateString(weekEnd)}`
      : 'all-time'
  return `timesheet-${slug || 'all-nannies'}-${range}.csv`
}

/**
 * @param {string} filename
 * @param {string} csvText
 */
export function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
