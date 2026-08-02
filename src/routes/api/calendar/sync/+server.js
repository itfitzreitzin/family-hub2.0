import { json } from '@sveltejs/kit'
import { createServerClient } from '$lib/server/supabase.js'
import { fetchAndParseICal } from '$lib/server/ical-parser.js'

/**
 * POST /api/calendar/sync
 * Syncs a single calendar by fetching its iCal feed and upserting events.
 *
 * Body: { calendarId: number }
 * Requires authenticated user (passed via authorization header).
 */
export async function POST({ request }) {
  // Get auth token from request
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = authHeader.replace('Bearer ', '')
  const supabase = createServerClient(token)

  // Verify the user
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get request body
  let calendarId
  try {
    const body = await request.json()
    calendarId = body.calendarId
  } catch {
    return json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!calendarId) {
    return json({ error: 'calendarId is required' }, { status: 400 })
  }

  // Fetch the calendar record
  const { data: calendar, error: calError } = await supabase
    .from('parent_calendars')
    .select('*')
    .eq('id', calendarId)
    .single()

  if (calError || !calendar) {
    return json({ error: 'Calendar not found' }, { status: 404 })
  }

  // Only sync calendars with a URL (ical type)
  if (!calendar.calendar_url) {
    return json({ error: 'Calendar has no feed URL to sync' }, { status: 400 })
  }

  try {
    // Sync window: far enough back for history, far enough out that browsing
    // future months in the month view finds data. Recurrence expansion in the
    // parser is bounded by the same window.
    const now = new Date()
    const windowStart = new Date(now)
    windowStart.setDate(windowStart.getDate() - 180)
    const windowEnd = new Date(now)
    windowEnd.setDate(windowEnd.getDate() + 365)

    // Fetch and parse the iCal feed (recurrences expanded per-instance)
    const events = await fetchAndParseICal(calendar.calendar_url, {
      rangeStart: windowStart,
      rangeEnd: windowEnd
    })

    const relevantEvents = events.filter(e =>
      e.end > windowStart && e.start < windowEnd
    )

    // Batch upserts — an expanded feed can be 1,000+ rows and one round-trip
    // per row is far too slow. The (calendar_id, event_id) unique index dedups.
    let synced = 0
    let errors = 0
    const CHUNK = 200

    for (let i = 0; i < relevantEvents.length; i += CHUNK) {
      const chunk = relevantEvents.slice(i, i + CHUNK).map(event => ({
        calendar_id: calendar.id,
        user_id: calendar.user_id,
        event_id: event.uid,
        title: event.summary || 'Busy',
        start_time: event.start.toISOString(),
        end_time: event.end.toISOString(),
        is_busy: event.isBusy
      }))

      const { error: upsertError } = await supabase
        .from('calendar_events')
        .upsert(chunk, { onConflict: 'calendar_id,event_id' })

      if (upsertError) {
        errors += chunk.length
      } else {
        synced += chunk.length
      }
    }

    // Remove events the feed no longer contains — but only inside the sync
    // window. Rows outside it (older history, far future) are left alone so
    // browsing distant months doesn't show falsely-empty data purged by an
    // earlier, narrower sync.
    const feedUids = new Set(relevantEvents.map(e => e.uid))
    const { data: existingEvents } = await supabase
      .from('calendar_events')
      .select('id, event_id, start_time, end_time')
      .eq('calendar_id', calendar.id)
      .lt('start_time', windowEnd.toISOString())
      .gt('end_time', windowStart.toISOString())

    if (existingEvents) {
      const toDelete = existingEvents.filter(e => !feedUids.has(e.event_id))
      if (toDelete.length > 0) {
        await supabase
          .from('calendar_events')
          .delete()
          .in('id', toDelete.map(e => e.id))
      }
    }

    // Update last_synced timestamp
    await supabase
      .from('parent_calendars')
      .update({ last_synced: new Date().toISOString() })
      .eq('id', calendar.id)

    return json({
      success: true,
      synced,
      errors,
      total: relevantEvents.length
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return json({ error: 'Failed to sync calendar: ' + message }, { status: 500 })
  }
}
