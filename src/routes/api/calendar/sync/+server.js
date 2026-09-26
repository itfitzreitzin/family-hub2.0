import { json } from '@sveltejs/kit';
import { createServerClient } from '$lib/server/supabase.js';
import { fetchAndParseICal } from '$lib/server/ical-parser.js';

/**
 * Update a parent_calendars row, tolerating a database that hasn't run the
 * calendar_sync_state.sql migration yet: if the update fails and included
 * sync_error, retry without that column so last_synced still lands.
 * @param {any} supabase
 * @param {number} calendarId
 * @param {Record<string, any>} fields
 */
async function updateCalendarSyncState(supabase, calendarId, fields) {
	const { error } = await supabase.from('parent_calendars').update(fields).eq('id', calendarId);
	if (error && 'sync_error' in fields) {
		const { sync_error: _dropped, ...rest } = fields;
		if (Object.keys(rest).length > 0) {
			await supabase.from('parent_calendars').update(rest).eq('id', calendarId);
		}
	}
}

/**
 * @param {any} supabase
 * @param {Record<string, any>[]} rows
 * @param {boolean} withAllDay
 */
function upsertEvents(supabase, rows, withAllDay) {
	const payload = withAllDay
		? rows
		: rows.map((row) => {
				const copy = { ...row };
				delete copy.all_day;
				return copy;
			});
	return supabase.from('calendar_events').upsert(payload, { onConflict: 'calendar_id,event_id' });
}

/**
 * Whether a database error is about a missing column (a migration not yet run).
 * @param {any} error
 * @param {string} column
 */
function mentionsColumn(error, column) {
	const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
	return error?.code === '42703' || error?.code === 'PGRST204' || text.includes(column);
}

/**
 * POST /api/calendar/sync
 * Syncs a single calendar by fetching its iCal feed and upserting events.
 *
 * Body: { calendarId: number }
 * Requires authenticated user (passed via authorization header).
 */
export async function POST({ request }) {
	// Get auth token from request
	const authHeader = request.headers.get('authorization');
	if (!authHeader) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const token = authHeader.replace('Bearer ', '');
	const supabase = createServerClient(token);

	// Verify the user
	const {
		data: { user },
		error: authError
	} = await supabase.auth.getUser(token);
	if (authError || !user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// Get request body. timeZone is the household's (the browser's) IANA zone:
	// all-day events and floating times are read in it, not the server's.
	let calendarId;
	let timeZone;
	try {
		const body = await request.json();
		calendarId = body.calendarId;
		timeZone = typeof body.timeZone === 'string' ? body.timeZone : undefined;
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}
	if (!calendarId) {
		return json({ error: 'calendarId is required' }, { status: 400 });
	}

	// Fetch the calendar record
	const { data: calendar, error: calError } = await supabase
		.from('parent_calendars')
		.select('*')
		.eq('id', calendarId)
		.single();

	if (calError || !calendar) {
		return json({ error: 'Calendar not found' }, { status: 404 });
	}

	// Household model: you can sync your own calendars; family/admin can sync
	// anyone's (they manage partner and nanny calendars from the schedule page).
	// Mirrors the RLS modify policy — needed here because the service role key
	// bypasses RLS. The nanny may also refresh a parent's calendar that's
	// shared with them (nanny_sees), so their busy/free view isn't stale:
	// a refresh reads nothing back, it only brings the feed up to date.
	if (calendar.user_id !== user.id) {
		const { data: requesterProfile } = await supabase
			.from('profiles')
			.select('role')
			.eq('id', user.id)
			.maybeSingle();

		const role = requesterProfile?.role;
		const isParent = role === 'family' || role === 'admin';
		const sharedWithNanny =
			role === 'nanny' && (calendar.nanny_sees === 'busy' || calendar.nanny_sees === 'details');
		if (!isParent && !sharedWithNanny) {
			return json({ error: 'Not allowed to sync this calendar' }, { status: 403 });
		}
	}

	// Only sync calendars with a URL (ical type)
	if (!calendar.calendar_url) {
		return json({ error: 'Calendar has no feed URL to sync' }, { status: 400 });
	}

	try {
		// Sync window: far enough back for history, far enough out that browsing
		// future months in the month view finds data. Recurrence expansion in the
		// parser is bounded by the same window.
		const now = new Date();
		const windowStart = new Date(now);
		windowStart.setDate(windowStart.getDate() - 180);
		const windowEnd = new Date(now);
		windowEnd.setDate(windowEnd.getDate() + 365);

		// Fetch and parse the iCal feed (recurrences expanded per-instance)
		const events = await fetchAndParseICal(calendar.calendar_url, {
			rangeStart: windowStart,
			rangeEnd: windowEnd,
			timeZone
		});

		const relevantEvents = events.filter((e) => e.end > windowStart && e.start < windowEnd);

		// Batch upserts — an expanded feed can be 1,000+ rows and one round-trip
		// per row is far too slow. The (calendar_id, event_id) unique index dedups.
		let synced = 0;
		let errors = 0;
		const CHUNK = 200;
		// all_day arrives with family_calendar.sql; until that has run, save
		// without it rather than failing the whole sync.
		let withAllDay = true;

		for (let i = 0; i < relevantEvents.length; i += CHUNK) {
			const chunk = relevantEvents.slice(i, i + CHUNK).map((event) => ({
				calendar_id: calendar.id,
				user_id: calendar.user_id,
				event_id: event.uid,
				title: event.summary || 'Busy',
				start_time: event.start.toISOString(),
				end_time: event.end.toISOString(),
				is_busy: event.isBusy,
				all_day: event.allDay
			}));

			let { error: upsertError } = await upsertEvents(supabase, chunk, withAllDay);
			if (upsertError && withAllDay && mentionsColumn(upsertError, 'all_day')) {
				withAllDay = false;
				({ error: upsertError } = await upsertEvents(supabase, chunk, false));
			}

			if (upsertError) {
				errors += chunk.length;
			} else {
				synced += chunk.length;
			}
		}

		// Remove events the feed no longer contains — but only inside the sync
		// window. Rows outside it (older history, far future) are left alone so
		// browsing distant months doesn't show falsely-empty data purged by an
		// earlier, narrower sync.
		const feedUids = new Set(relevantEvents.map((e) => e.uid));
		const { data: existingEvents } = await supabase
			.from('calendar_events')
			.select('id, event_id, start_time, end_time')
			.eq('calendar_id', calendar.id)
			.lt('start_time', windowEnd.toISOString())
			.gt('end_time', windowStart.toISOString());

		if (existingEvents) {
			const toDelete = existingEvents.filter((e) => !feedUids.has(e.event_id));
			if (toDelete.length > 0) {
				await supabase
					.from('calendar_events')
					.delete()
					.in(
						'id',
						toDelete.map((e) => e.id)
					);
			}
		}

		// Record the outcome: fresh last_synced, and clear (or set) the stored
		// failure so the schedule page can surface broken feeds instead of
		// silently showing stale overlays.
		await updateCalendarSyncState(supabase, calendar.id, {
			last_synced: new Date().toISOString(),
			sync_error: errors > 0 ? `${errors} of ${relevantEvents.length} events failed to save` : null
		});

		return json({
			success: true,
			synced,
			errors,
			total: relevantEvents.length
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await updateCalendarSyncState(supabase, calendar.id, { sync_error: message });
		return json({ error: 'Failed to sync calendar: ' + message }, { status: 500 });
	}
}
