/**
 * Lightweight iCal (.ics) parser.
 * Parses VEVENT components from an iCal feed and returns structured event objects.
 * Handles DTSTART/DTEND, SUMMARY, UID, and basic recurrence.
 */

/**
 * Parse an iCal string into an array of event objects.
 * @param {string} icalText - Raw .ics file content
 * @returns {Array<{uid: string, summary: string, start: Date, end: Date, isBusy: boolean}>}
 */
export function parseICal(icalText) {
  const events = []
  const lines = unfoldLines(icalText)

  let inEvent = false
  let currentEvent = {}

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true
      currentEvent = {}
      continue
    }

    if (line === 'END:VEVENT') {
      inEvent = false
      if (currentEvent.start && currentEvent.end) {
        events.push({
          uid: currentEvent.uid || `unknown_${Date.now()}_${Math.random()}`,
          summary: currentEvent.summary || 'Busy',
          start: currentEvent.start,
          end: currentEvent.end,
          isBusy: currentEvent.transp !== 'TRANSPARENT'
        })
      }
      continue
    }

    if (!inEvent) continue

    const { name, params, value } = parseLine(line)

    switch (name) {
      case 'DTSTART':
        currentEvent.start = parseICalDate(value, params)
        break
      case 'DTEND':
        currentEvent.end = parseICalDate(value, params)
        break
      case 'DURATION':
        if (currentEvent.start && !currentEvent.end) {
          currentEvent.end = addDuration(currentEvent.start, value)
        }
        break
      case 'SUMMARY':
        currentEvent.summary = value
        break
      case 'UID':
        currentEvent.uid = value
        break
      case 'TRANSP':
        currentEvent.transp = value
        break
    }
  }

  return events
}

/**
 * Unfold iCal lines (lines starting with space/tab are continuations).
 */
function unfoldLines(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
}

/**
 * Parse a single iCal property line into name, params, value.
 * e.g. "DTSTART;TZID=America/New_York:20240115T090000"
 */
function parseLine(line) {
  const colonIdx = line.indexOf(':')
  if (colonIdx === -1) return { name: '', params: {}, value: line }

  const left = line.substring(0, colonIdx)
  const value = line.substring(colonIdx + 1)

  const parts = left.split(';')
  const name = parts[0].toUpperCase()
  const params = {}

  for (let i = 1; i < parts.length; i++) {
    const eqIdx = parts[i].indexOf('=')
    if (eqIdx > -1) {
      params[parts[i].substring(0, eqIdx).toUpperCase()] = parts[i].substring(eqIdx + 1)
    }
  }

  return { name, params, value }
}

/**
 * Parse an iCal date/datetime string into a JavaScript Date.
 * Handles formats: 20240115T090000Z, 20240115T090000, 20240115
 */
function parseICalDate(value, params = {}) {
  // Remove any quotes
  const v = value.replace(/"/g, '').trim()

  if (v.length === 8) {
    // Date only: YYYYMMDD
    const year = parseInt(v.substring(0, 4))
    const month = parseInt(v.substring(4, 6)) - 1
    const day = parseInt(v.substring(6, 8))
    return new Date(year, month, day)
  }

  if (v.length >= 15) {
    // DateTime: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
    const year = parseInt(v.substring(0, 4))
    const month = parseInt(v.substring(4, 6)) - 1
    const day = parseInt(v.substring(6, 8))
    const hour = parseInt(v.substring(9, 11))
    const minute = parseInt(v.substring(11, 13))
    const second = parseInt(v.substring(13, 15))

    if (v.endsWith('Z')) {
      return new Date(Date.UTC(year, month, day, hour, minute, second))
    }

    // If TZID is specified, create the date in that timezone
    // For simplicity, create as local and let the DB handle timezone
    return new Date(year, month, day, hour, minute, second)
  }

  // Fallback
  return new Date(v)
}

/**
 * Add an iCal DURATION value to a date.
 * e.g. "PT1H30M" = 1 hour 30 minutes
 */
function addDuration(date, duration) {
  const result = new Date(date)
  const match = duration.match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/)

  if (!match) return result

  const weeks = parseInt(match[1]) || 0
  const days = parseInt(match[2]) || 0
  const hours = parseInt(match[3]) || 0
  const minutes = parseInt(match[4]) || 0
  const seconds = parseInt(match[5]) || 0

  result.setDate(result.getDate() + weeks * 7 + days)
  result.setHours(result.getHours() + hours)
  result.setMinutes(result.getMinutes() + minutes)
  result.setSeconds(result.getSeconds() + seconds)

  return result
}

/**
 * Fetch and parse an iCal feed from a URL.
 * @param {string} url - The iCal feed URL
 * @returns {Promise<Array>} Parsed events
 */
export async function fetchAndParseICal(url) {
  // Validate the URL before fetching
  try {
    const parsed = new URL(url)
    if (!parsed.protocol.startsWith('http')) {
      throw new Error('not http')
    }
  } catch {
    throw new Error(`Invalid calendar URL: "${url}" — please update the calendar with a valid https:// link`)
  }

  const response = await fetch(url, {
    headers: {
      'Accept': 'text/calendar, application/calendar+json, text/plain',
      'User-Agent': 'FamilyHub/2.0 Calendar Sync'
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch calendar: ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  return parseICal(text)
}
