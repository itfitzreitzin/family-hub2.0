// The chore board, live: the chores, their record and the household, shared
// by Home → Chores, Home's chores card and the nanny's card on Care →
// Today. It loads, keeps in step with the other phones over realtime, and
// ticks chores off at once on screen, the write following behind.
//
// The rules for what's due and what's done live in $lib/chores.js; this
// only fetches and writes.

import { writable, get } from 'svelte/store';
import { supabase } from '$lib/supabase';
import { toast } from '$lib/stores/toast.js';
import { errorMessage, isMissingSchema } from '$lib/errors.js';
import { chorePeople } from '$lib/chores.js';

/** How far back the record is read — enough for a year of streaks. */
const HISTORY_DAYS = 400;
/** How long a done one-off is read back, to show it ticked off today. */
const CLOSED_DAYS = 2;

/**
 * @typedef {import('$lib/chores.js').Chore} Chore
 * @typedef {import('$lib/chores.js').Completion} Completion
 * @typedef {import('$lib/chores.js').ChoreNow} ChoreNow
 * @typedef {{
 *   ready: boolean,
 *   missing: boolean,
 *   error: string | null,
 *   userId: string | null,
 *   role: string | null,
 *   chores: Chore[],
 *   completions: (Completion & { chore?: { title: string } | null })[],
 *   people: ReturnType<typeof chorePeople>
 * }} BoardState
 */

/**
 * @param {string} channelName a realtime channel name unique to the page
 */
export function choreBoard(channelName) {
	/** @type {import('svelte/store').Writable<BoardState>} */
	const state = writable({
		ready: false,
		missing: false,
		error: null,
		userId: null,
		role: null,
		chores: [],
		completions: [],
		people: []
	});

	/** @type {ReturnType<typeof supabase.channel> | null} */
	let channel = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let resyncTimer = null;
	/** Chores with a write on the way, so a second tap waits its turn. */
	const busy = new Set();
	let tempId = -1;

	async function load() {
		const s = get(state);
		let { userId, role } = s;
		if (!userId) {
			const {
				data: { user }
			} = await supabase.auth.getUser();
			if (!user) return;
			userId = user.id;
		}

		const since = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString();
		const closedSince = new Date(Date.now() - CLOSED_DAYS * 86400000).toISOString();
		const [peopleRes, choresRes, doneRes] = await Promise.all([
			supabase.from('profiles').select('id, full_name, role'),
			supabase
				.from('chores')
				.select('*')
				.is('archived_at', null)
				.or(`closed_at.is.null,closed_at.gte."${closedSince}"`)
				.order('created_at', { ascending: true }),
			supabase
				.from('chore_completions')
				.select('*, chore:chores(title)')
				.gte('done_at', since)
				.order('done_at', { ascending: false })
				.limit(3000)
		]);

		if (choresRes.error && isMissingSchema(choresRes.error)) {
			state.set({ ...get(state), ready: true, missing: true, userId, error: null });
			return;
		}
		if (peopleRes.error) throw peopleRes.error;
		if (choresRes.error) throw choresRes.error;
		if (doneRes.error) throw doneRes.error;

		const profiles = peopleRes.data || [];
		role = profiles.find((p) => p.id === userId)?.role || role;

		// A tick still on its way keeps its place until the write lands
		// (unless this read already has it).
		const loaded = doneRes.data || [];
		const pending = get(state).completions.filter(
			(c) =>
				c.id < 0 && !loaded.some((d) => d.chore_id === c.chore_id && d.counts_for === c.counts_for)
		);
		state.set({
			ready: true,
			missing: false,
			error: null,
			userId,
			role,
			chores: choresRes.data || [],
			completions: [...pending, ...loaded],
			people: chorePeople(profiles)
		});
	}

	async function refresh() {
		try {
			await load();
		} catch (err) {
			const s = get(state);
			// A failed refresh keeps what's on screen; only a first load shows it.
			if (!s.ready) state.set({ ...s, ready: true, error: errorMessage(err) });
			else console.warn('Chore board refresh failed:', errorMessage(err));
		}
	}

	function scheduleResync() {
		if (resyncTimer) clearTimeout(resyncTimer);
		resyncTimer = setTimeout(() => {
			resyncTimer = null;
			refresh();
		}, 300);
	}

	async function start() {
		await refresh();
		if (channel || get(state).missing) return;
		channel = supabase
			.channel(channelName)
			.on('postgres_changes', { event: '*', schema: 'public', table: 'chores' }, scheduleResync)
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'chore_completions' },
				scheduleResync
			)
			.subscribe();
	}

	function stop() {
		if (resyncTimer) clearTimeout(resyncTimer);
		resyncTimer = null;
		if (channel) supabase.removeChannel(channel);
		channel = null;
	}

	/** @param {(list: BoardState['completions']) => BoardState['completions']} change */
	function editCompletions(change) {
		state.update((s) => ({ ...s, completions: change(s.completions) }));
	}

	/**
	 * Tick a chore off, or take the tick back when it's showing done.
	 * @param {ChoreNow} item
	 */
	async function toggle(item) {
		const { userId } = get(state);
		const choreId = item.chore.id;
		if (!userId || busy.has(choreId)) return;
		busy.add(choreId);
		try {
			if (item.done) await untick(item.done);
			else await tick(item, userId);
		} finally {
			busy.delete(choreId);
		}
	}

	/** @param {ChoreNow} item @param {string} userId */
	async function tick(item, userId) {
		const row = { chore_id: item.chore.id, counts_for: item.countsFor, done_by: userId };
		const temp = { ...row, id: tempId--, done_at: new Date().toISOString(), chore: null };
		editCompletions((list) => [temp, ...list]);
		try {
			const { data, error } = await supabase
				.from('chore_completions')
				.insert(row)
				.select('*, chore:chores(title)')
				.single();
			if (error) throw error;
			editCompletions((list) => [
				data,
				...list.filter((c) => c.id !== temp.id && c.id !== data.id)
			]);
		} catch (err) {
			editCompletions((list) => list.filter((c) => c.id !== temp.id));
			if (/** @type {any} */ (err)?.code === '23505') {
				// The other phone got there first.
				toast.info(`${item.chore.title} is already done`);
				scheduleResync();
			} else {
				toast.error('Error ticking it off: ' + errorMessage(err));
			}
		}
	}

	/** @param {Completion} done */
	async function untick(done) {
		editCompletions((list) => list.filter((c) => c.id !== done.id));
		if (done.id < 0) return;
		try {
			const { error } = await supabase.from('chore_completions').delete().eq('id', done.id);
			if (error) throw error;
		} catch (err) {
			editCompletions((list) => [done, ...list]);
			toast.error('Error taking it back: ' + errorMessage(err));
		}
	}

	/** A chore the sheet just saved. @param {Chore} chore */
	function putChore(chore) {
		state.update((s) => ({
			...s,
			chores: s.chores.some((c) => c.id === chore.id)
				? s.chores.map((c) => (c.id === chore.id ? chore : c))
				: [...s.chores, chore]
		}));
	}

	/** A chore the sheet just removed. @param {number} id */
	function dropChore(id) {
		state.update((s) => ({ ...s, chores: s.chores.filter((c) => c.id !== id) }));
	}

	return {
		subscribe: state.subscribe,
		start,
		stop,
		refresh: scheduleResync,
		toggle,
		putChore,
		dropChore
	};
}
