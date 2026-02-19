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
  const { calendarId } = await request.json()
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
    // Fetch and parse the iCal feed
    const events = await fetchAndParseICal(calendar.calendar_url)

    // Filter to events within a reasonable window (past 30 days to future 90 days)
    const now = new Date()
    const windowStart = new Date(now)
    windowStart.setDate(windowStart.getDate() - 30)
    const windowEnd = new Date(now)
    windowEnd.setDate(windowEnd.getDate() + 90)

    const relevantEvents = events.filter(e =>
      e.end > windowStart && e.start < windowEnd
    )

    // Upsert events into calendar_events table
    // Using the unique (calendar_id, event_id) constraint for dedup
    let synced = 0
    let errors = 0

    for (const event of relevantEvents) {
      const { error: upsertError } = await supabase
        .from('calendar_events')
        .upsert(
          {
            calendar_id: calendar.id,
            user_id: calendar.user_id,
            event_id: event.uid,
            title: event.summary || 'Busy',
            start_time: event.start.toISOString(),
            end_time: event.end.toISOString(),
            is_busy: event.isBusy
          },
          { onConflict: 'calendar_id,event_id' }
        )

      if (upsertError) {
        errors++
      } else {
        synced++
      }
    }

    // Clean up old events that are no longer in the feed
    const feedUids = new Set(relevantEvents.map(e => e.uid))
    const { data: existingEvents } = await supabase
      .from('calendar_events')
      .select('id, event_id')
      .eq('calendar_id', calendar.id)

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
    return json({ error: 'Failed to sync calendar: ' + err.message }, { status: 500 })
  }
}

/**
 * POST /api/calendar/sync-all
 * Convenience: sync all calendars for a user.
 */
