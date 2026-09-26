<script>
	import { onMount, onDestroy } from 'svelte';
	import { slide } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { supabase } from '$lib/supabase';
	import { toast, confirm as confirmModal, prompt as promptModal } from '$lib/stores/toast.js';
	import { errorMessage } from '$lib/errors.js';
	import { sinceLabel, groupBySection, cleanGroceryName, groceryKey } from '$lib/groceries.js';
	import Icon from '$lib/icons/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import GroceryAdd from '$lib/components/GroceryAdd.svelte';
	import RecipeSheet from '$lib/components/RecipeSheet.svelte';

	/*
	 * Home → Groceries: the lists you carry into the store — Groceries, and
	 * whatever else the house adds (Costco, Target). Items group by store
	 * section so the list follows the aisles. Tap a thing to cross it off — a
	 * quill inks a line through it, and it waits there with an Undo until
	 * you've stopped tapping for a few seconds, then drops into the basket.
	 * Removing a thing and clearing the basket wait the same way. Anyone can
	 * add (the nanny from Care → Today); each item says who asked for it. A
	 * recipe, or a list pasted from anywhere, comes in through Recipes.
	 */

	/** Remembers which list was open, per device. */
	const LIST_KEY = 'familyhub-grocery-list';

	/** How far back the suggestions look. */
	const HISTORY_ROWS = 400;
	/** How long a change waits in place, Undo showing, after the last tap. */
	const SETTLE_MS = 5000;

	/** @type {any} */
	let user = null;
	/** @type {any} */
	let profile = null;
	let initializing = true;
	/** @type {string | null} */
	let initError = null;
	/** Open items plus recent history, by id. */
	/** @type {Record<number, any>} */
	let rows = {};
	/** @type {Record<string, string>} */
	let namesById = {};
	/** @type {any[]} */
	let lists = [];
	/** @type {number | null} */
	let listId = null;
	/** Changes waiting in place with their Undo: item id → what happened. */
	/** @type {Record<number, 'check' | 'remove'>} */
	let pending = {};
	/** The basket just emptied, while its Undo lasts. */
	/** @type {{ ids: number[], stamp: string } | null} */
	let cleared = null;
	/** Bumped whenever the wait starts over, so every fuse starts over too. */
	let round = 0;
	let clearing = false;
	let showRecipes = false;
	/** What the last tap did, for screen readers. */
	let announcement = '';
	/** Rows slide in and out; not with reduced motion. */
	let slideMs = 220;
	let now = Date.now();

	/** Each item's writes go out one after another, so an Undo never
	 * overtakes the tap it undoes. */
	/** @type {Record<number, Promise<void>>} */
	const writes = {};

	/** @type {ReturnType<typeof supabase.channel> | null} */
	let channel = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let resyncTimer = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let settleTimer = null;
	/** @type {ReturnType<typeof setInterval> | null} */
	let nowInterval = null;

	onMount(() => {
		if (reducedMotion()) slideMs = 0;
		init();
	});

	onDestroy(() => {
		// Leaving settles what's still waiting: removed things get removed.
		settle();
		if (channel) supabase.removeChannel(channel);
		if (resyncTimer) clearTimeout(resyncTimer);
		if (nowInterval) clearInterval(nowInterval);
	});

	async function init() {
		initializing = true;
		initError = null;

		try {
			const {
				data: { user: currentUser }
			} = await supabase.auth.getUser();
			if (!currentUser) {
				goto(resolve('/'));
				return;
			}
			user = currentUser;

			const { data: profileData, error: profileError } = await supabase
				.from('profiles')
				.select('*')
				.eq('id', user.id)
				.maybeSingle();
			if (profileError) throw profileError;
			profile = profileData;

			// The nanny adds from Care → Today; the list itself is the parents'.
			if (profile?.role === 'nanny') {
				goto(resolve('/care'), { replaceState: true });
				return;
			}

			const { data: people } = await supabase.from('profiles').select('id, full_name');
			namesById = Object.fromEntries((people || []).map((p) => [p.id, p.full_name || '']));

			await load();

			if (!channel) {
				channel = supabase
					.channel('grocery-list')
					.on('postgres_changes', { event: '*', schema: 'public', table: 'grocery_items' }, () =>
						scheduleResync()
					)
					.on('postgres_changes', { event: '*', schema: 'public', table: 'grocery_lists' }, () =>
						scheduleResync()
					)
					.subscribe();
			}
			nowInterval = setInterval(() => (now = Date.now()), 60000);
			initializing = false;
		} catch (err) {
			initError = errorMessage(err);
			initializing = false;
		}
	}

	async function load() {
		const [listsRes, openRes, recentRes] = await Promise.all([
			supabase
				.from('grocery_lists')
				.select('*')
				.order('position', { ascending: true })
				.order('created_at', { ascending: true }),
			supabase.from('grocery_items').select('*').is('checked_at', null),
			supabase
				.from('grocery_items')
				.select('*')
				.order('added_at', { ascending: false })
				.limit(HISTORY_ROWS)
		]);
		if (listsRes.error) throw listsRes.error;
		if (openRes.error) throw openRes.error;
		if (recentRes.error) throw recentRes.error;

		lists = listsRes.data || [];
		if (!lists.some((l) => l.id === listId)) {
			let saved = null;
			try {
				saved = Number(localStorage.getItem(LIST_KEY));
			} catch {
				// Private browsing: start on the first list
			}
			listId = (lists.find((l) => l.id === saved) || lists[0])?.id ?? null;
		}

		/** @type {Record<number, any>} */
		const next = {};
		for (const r of [...(recentRes.data || []), ...(openRes.data || [])]) next[r.id] = r;
		// Something still waiting keeps its local state until it settles.
		for (const key of Object.keys(pending)) {
			const id = Number(key);
			if (rows[id]) next[id] = rows[id];
		}
		rows = next;
	}

	function scheduleResync() {
		if (resyncTimer) clearTimeout(resyncTimer);
		resyncTimer = setTimeout(() => {
			resyncTimer = null;
			load().catch((err) => console.warn('Grocery resync failed:', errorMessage(err)));
		}, 300);
	}

	/** @param {any} row */
	function put(row) {
		rows = { ...rows, [row.id]: row };
	}

	/** Rows the recipe sheet put on the list. @param {any[]} added */
	function putAll(added) {
		const next = { ...rows };
		for (const row of added) next[row.id] = row;
		rows = next;
	}

	$: all = Object.values(rows);
	$: currentList = lists.find((l) => l.id === listId) || null;
	$: openCounts = all.reduce((acc, i) => {
		if (!i.checked_at && !pending[i.id]) acc[i.list_id] = (acc[i.list_id] || 0) + 1;
		return acc;
	}, /** @type {Record<number, number>} */ ({}));
	$: here = all.filter((i) => i.list_id === listId);
	$: openItems = here
		.filter((i) => !i.checked_at || pending[i.id])
		.sort((a, b) => String(a.added_at).localeCompare(String(b.added_at)));
	$: toBuy = openItems.filter((i) => !pending[i.id]).length;
	$: sections = groupBySection(openItems);
	$: basket = here
		.filter((i) => i.checked_at && !i.cleared_at && !pending[i.id])
		.sort((a, b) => String(b.checked_at).localeCompare(String(a.checked_at)));

	/** @param {number} id */
	function openList(id) {
		settle();
		listId = id;
		try {
			localStorage.setItem(LIST_KEY, String(id));
		} catch {
			// Not remembered; harmless
		}
	}

	async function newList() {
		const raw = await promptModal.show({
			title: 'A new list',
			message: 'What is it for? A store, or a kind of trip — Costco, Target, the pharmacy.',
			placeholder: 'Costco'
		});
		const name = cleanGroceryName(raw || '');
		if (!name) return;
		const clash = lists.find((l) => groceryKey(l.name) === groceryKey(name));
		if (clash) {
			openList(clash.id);
			return;
		}
		try {
			const { data, error } = await supabase
				.from('grocery_lists')
				.insert({
					name,
					position: Math.max(0, ...lists.map((l) => l.position || 0)) + 1,
					created_by: user.id
				})
				.select()
				.single();
			if (error) throw error;
			lists = [...lists, data];
			openList(data.id);
		} catch (err) {
			toast.error('Error making the list: ' + errorMessage(err));
		}
	}

	async function deleteList() {
		if (!currentList || lists.length < 2) return;
		const ok = await confirmModal.show({
			title: 'Delete this list',
			message: `Delete the ${currentList.name} list, and everything on it and its history?`,
			confirmText: 'Delete',
			danger: true
		});
		if (!ok) return;
		const gone = currentList;
		try {
			const { error } = await supabase.from('grocery_lists').delete().eq('id', gone.id);
			if (error) throw error;
			lists = lists.filter((l) => l.id !== gone.id);
			const rest = { ...rows };
			for (const i of all) if (i.list_id === gone.id) delete rest[i.id];
			rows = rest;
			openList(lists[0].id);
		} catch (err) {
			toast.error('Error deleting the list: ' + errorMessage(err));
		}
	}

	/** @param {string | null | undefined} id */
	function firstName(id) {
		return (id && namesById[id]?.split(' ')[0]) || 'someone';
	}

	function reducedMotion() {
		return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	}

	/** @param {any} item */
	function label(item) {
		return item.quantity ? `${item.quantity} ${item.name}` : item.name;
	}

	/**
	 * Send a write for one item once any earlier write for it has landed.
	 * @param {number} id
	 * @param {() => Promise<void>} run handles its own errors
	 */
	function write(id, run) {
		const next = (writes[id] || Promise.resolve())
			.then(run)
			.catch((err) => console.warn('Grocery write failed:', errorMessage(err)));
		writes[id] = next;
		next.then(() => {
			if (writes[id] === next) delete writes[id];
		});
	}

	// Every tap starts the wait over, so nothing moves while you're still
	// tapping — the list never shifts under a thumb mid-aisle.
	function restartSettle() {
		if (settleTimer) clearTimeout(settleTimer);
		round += 1;
		settleTimer = setTimeout(settle, SETTLE_MS);
	}

	// The wait is over: crossed-off things drop into the basket (their write
	// went out with the tap), removed things are deleted now, and the cleared
	// basket's Undo goes.
	function settle() {
		if (settleTimer) clearTimeout(settleTimer);
		settleTimer = null;
		const removed = Object.keys(pending)
			.map(Number)
			.filter((id) => pending[id] === 'remove');
		pending = {};
		cleared = null;
		for (const id of removed) deleteNow(id);
	}

	/** @param {number} id */
	function unpend(id) {
		const rest = { ...pending };
		delete rest[id];
		pending = rest;
	}

	// Cross it off: the quill inks through the name, and it waits there with
	// an Undo. The write goes out at once, so the other phone knows.
	/** @param {any} item */
	function checkOff(item) {
		const stamp = { checked_at: new Date().toISOString(), checked_by: user.id };
		put({ ...item, ...stamp });
		pending = { ...pending, [item.id]: 'check' };
		announcement = `Crossed off ${label(item)}`;
		restartSettle();
		write(item.id, async () => {
			try {
				const { data, error } = await supabase
					.from('grocery_items')
					.update(stamp)
					.eq('id', item.id)
					.select()
					.single();
				if (error) throw error;
				// An Undo that landed meanwhile wins.
				if (rows[item.id]?.checked_at === stamp.checked_at) put(data);
			} catch (err) {
				if (rows[item.id]?.checked_at === stamp.checked_at) {
					unpend(item.id);
					put(item);
				}
				toast.error('Error crossing it off: ' + errorMessage(err));
			}
		});
	}

	/** Back on the list: an Undo, or a tap in the basket. @param {any} item */
	function uncheck(item) {
		unpend(item.id);
		put({ ...item, checked_at: null, checked_by: null });
		announcement = `${label(item)} is back on the list`;
		write(item.id, async () => {
			try {
				const { data, error } = await supabase
					.from('grocery_items')
					.update({ checked_at: null, checked_by: null })
					.eq('id', item.id)
					.select()
					.single();
				if (error) throw error;
				if (!rows[item.id]?.checked_at) put(data);
			} catch (err) {
				if (!rows[item.id]?.checked_at) put(item);
				if (/** @type {any} */ (err).code === '23505') {
					toast.info(`${item.name} is already back on the list`);
				} else {
					toast.error('Error putting it back: ' + errorMessage(err));
				}
			}
		});
	}

	/** @param {any} item */
	function undoCheck(item) {
		uncheck(item);
		restartSettle();
	}

	// A mistake comes off the same way: it waits, removed, with an Undo, and is
	// only deleted once the wait is over.
	/** @param {any} item */
	function removeItem(item) {
		pending = { ...pending, [item.id]: 'remove' };
		announcement = `Removed ${label(item)}`;
		restartSettle();
	}

	/** @param {any} item */
	function undoRemove(item) {
		unpend(item.id);
		announcement = `${label(item)} is back on the list`;
		restartSettle();
	}

	/** @param {number} id */
	function deleteNow(id) {
		const item = rows[id];
		if (!item) return;
		const rest = { ...rows };
		delete rest[id];
		rows = rest;
		write(id, async () => {
			try {
				const { error } = await supabase.from('grocery_items').delete().eq('id', id);
				if (error) throw error;
			} catch (err) {
				put(item);
				toast.error('Error removing: ' + errorMessage(err));
			}
		});
	}

	/** @param {number[]} ids @param {string | null} stamp */
	function markCleared(ids, stamp) {
		const next = { ...rows };
		for (const id of ids) if (next[id]) next[id] = { ...next[id], cleared_at: stamp };
		rows = next;
	}

	// Empty the basket. The rows stay as history for the suggestions, and an
	// Undo stands in for the basket until the wait is over.
	async function clearBasket() {
		if (clearing || basket.length === 0) return;
		clearing = true;
		const ids = basket.map((i) => i.id);
		const stamp = new Date().toISOString();
		try {
			const { error } = await supabase
				.from('grocery_items')
				.update({ cleared_at: stamp })
				.in('id', ids);
			if (error) throw error;
			markCleared(ids, stamp);
			cleared = { ids, stamp };
			announcement = `Cleared ${ids.length} from the basket`;
			restartSettle();
		} catch (err) {
			toast.error('Error clearing the basket: ' + errorMessage(err));
		} finally {
			clearing = false;
		}
	}

	async function undoClear() {
		if (!cleared) return;
		const { ids, stamp } = cleared;
		cleared = null;
		markCleared(ids, null);
		announcement = 'The basket is back';
		try {
			const { error } = await supabase
				.from('grocery_items')
				.update({ cleared_at: null })
				.in('id', ids);
			if (error) throw error;
		} catch (err) {
			markCleared(ids, stamp);
			toast.error('Error bringing the basket back: ' + errorMessage(err));
		}
	}
</script>

<svelte:window on:focus={() => !initializing && scheduleResync()} on:pagehide={settle} />

<div class="container">
	{#if initializing}
		<Skeleton variant="card" count={2} />
	{:else if initError}
		<div class="card arcana">
			<EmptyState icon="warning" title="The list won't unroll" hint={initError}>
				<button class="btn btn-primary" on:click={init}>
					<Icon name="star" size={16} /> Try again
				</button>
			</EmptyState>
		</div>
	{:else}
		<div class="page-head grocery-head">
			<div>
				<h1>Groceries</h1>
				<p class="lede">What the house needs — tap it off at the store.</p>
			</div>
			{#if currentList}
				<button class="btn btn-secondary recipes-open" on:click={() => (showRecipes = true)}>
					<Icon name="grimoire" size={16} /> Recipes
				</button>
			{/if}
		</div>

		<!-- ── Which list ─────────────────────────────────── -->
		<div class="list-tabs" role="tablist" aria-label="Lists">
			{#each lists as list (list.id)}
				<button
					role="tab"
					class="list-tab"
					class:active={list.id === listId}
					aria-selected={list.id === listId}
					on:click={() => openList(list.id)}
				>
					{list.name}
					{#if openCounts[list.id]}<span class="list-count">{openCounts[list.id]}</span>{/if}
				</button>
			{/each}
			<button class="list-tab new" on:click={newList} aria-label="New list">
				<Icon name="plus" size={13} /> List
			</button>
		</div>

		{#if !currentList}
			<div class="card arcana">
				<EmptyState
					icon="cauldron"
					title="No lists yet"
					hint="Run supabase/grocery_items.sql in Supabase — it makes the first one."
				/>
			</div>
		{:else}
			<section class="card arcana">
				<GroceryAdd
					{user}
					items={all}
					{listId}
					listName={currentList.name}
					onadded={put}
					canUpdate
					collapsible
				/>
			</section>

			<section class="card arcana">
				<div class="card-header">
					<h2>{currentList.name}</h2>
					<span class="rune-label">
						{toBuy || (openItems.length ? 'all crossed off' : 'nothing yet')}
					</span>
				</div>

				{#if openItems.length === 0}
					<EmptyState
						icon="cauldron"
						title="The larder is full"
						hint="Nothing on the list. Add something above, or the nanny can from Care."
					/>
				{:else}
					<!-- Keyed on the list, so switching lists swaps them without sliding. -->
					{#key listId}
						{#each sections as group (group.section)}
							<div class="g-group" transition:slide={{ duration: slideMs }}>
								<h3 class="g-section">{group.section}</h3>
								<ul class="g-list">
									{#each group.items as item (item.id)}
										{@const what = pending[item.id]}
										<li
											class="g-item"
											class:inking={what === 'check'}
											class:removed={what === 'remove'}
											transition:slide={{ duration: slideMs }}
										>
											{#if what === 'remove'}
												<span class="g-tap">
													<span class="g-box" aria-hidden="true"
														><Icon name="close" size={14} /></span
													>
													<span class="g-text">
														<span class="g-name">
															{#if item.quantity}<span class="g-qty">{item.quantity}&nbsp;</span
																>{/if}{item.name}
														</span>
														<span class="g-by">removed</span>
													</span>
												</span>
											{:else}
												<button
													class="g-tap"
													on:click={() => (what ? undoCheck(item) : checkOff(item))}
													aria-label={what
														? `Undo crossing off ${label(item)}`
														: `Cross off ${label(item)}`}
												>
													<span class="g-box" aria-hidden="true"
														><Icon name="check" size={14} /></span
													>
													<span class="g-text">
														<span class="g-name">
															{#if item.quantity}<span class="g-qty">{item.quantity}&nbsp;</span
																>{/if}{item.name}
															<!-- The quill: a stand-in for a sprite sheet later. -->
															<span class="g-ink" aria-hidden="true">
																<span class="g-quill"><Icon name="quill" size={18} /></span>
															</span>
														</span>
														{#if item.note}<span class="g-note">{item.note}</span>{/if}
														<span class="g-by">
															{#if what}
																crossed off
															{:else}
																{firstName(item.added_by)} · {sinceLabel(item.added_at, now)}
															{/if}
														</span>
													</span>
												</button>
											{/if}
											{#if what}
												<button
													class="g-undo"
													on:click={() => (what === 'remove' ? undoRemove(item) : undoCheck(item))}
													aria-label="Undo — {label(item)} back on the list"
												>
													<Icon name="undo" size={14} /> Undo
												</button>
												<!-- Burns down to when it moves; any tap relights it. -->
												{#key round}
													<span
														class="g-fuse"
														aria-hidden="true"
														style="animation-duration: {SETTLE_MS}ms"
													></span>
												{/key}
											{:else}
												<button
													class="icon-btn g-remove"
													on:click={() => removeItem(item)}
													aria-label="Remove {label(item)} from the list"
												>
													<Icon name="close" size={14} />
												</button>
											{/if}
										</li>
									{/each}
								</ul>
							</div>
						{/each}
					{/key}
				{/if}
			</section>

			{#if basket.length > 0 || cleared}
				<section class="card arcana basket">
					<div class="card-header">
						<h2>In the Basket</h2>
						{#if basket.length > 0}
							<button
								class="btn btn-secondary btn-small"
								on:click={clearBasket}
								disabled={clearing}
							>
								<Icon name="sprout" size={14} />
								{clearing ? 'Clearing…' : 'Clear the basket'}
							</button>
						{/if}
					</div>
					{#if cleared}
						<div class="g-cleared">
							<span>
								Cleared {cleared.ids.length}
								{cleared.ids.length === 1 ? 'thing' : 'things'} from the basket.
							</span>
							<button class="g-undo" on:click={undoClear}>
								<Icon name="undo" size={14} /> Undo
							</button>
							{#key round}
								<span class="g-fuse" aria-hidden="true" style="animation-duration: {SETTLE_MS}ms"
								></span>
							{/key}
						</div>
					{/if}
					{#if basket.length > 0}
						<p class="basket-hint">Tap one to put it back on the list.</p>
						<ul class="g-list">
							{#each basket as item (item.id)}
								<li class="g-item done" transition:slide={{ duration: slideMs }}>
									<button
										class="g-tap"
										on:click={() => uncheck(item)}
										aria-label="Put {label(item)} back"
									>
										<span class="g-box" aria-hidden="true"><Icon name="check" size={14} /></span>
										<span class="g-text">
											<span class="g-name">
												{#if item.quantity}<span class="g-qty">{item.quantity}&nbsp;</span
													>{/if}{item.name}
											</span>
											<span class="g-by">
												got by {firstName(item.checked_by)} · {sinceLabel(item.checked_at, now)}
											</span>
										</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}

			{#if lists.length > 1}
				<div class="list-foot">
					<button class="btn-small list-delete" on:click={deleteList}>
						<Icon name="urn" size={13} /> Delete the {currentList.name} list
					</button>
				</div>
			{/if}

			{#if showRecipes}
				<RecipeSheet
					{user}
					items={all}
					{listId}
					listName={currentList.name}
					onadded={putAll}
					onclose={() => (showRecipes = false)}
				/>
			{/if}
		{/if}
	{/if}

	<p class="visually-hidden" aria-live="polite">{announcement}</p>
</div>

<style>
	.page-head h1 {
		color: var(--accent-bright);
	}

	.lede {
		color: var(--text-faint);
		font-size: 0.95rem;
		margin-top: 0.2rem;
	}

	/* Recipes sits beside the title, so the list keeps a phone's first screen. */
	.grocery-head {
		flex-wrap: nowrap;
		align-items: flex-start;
	}

	.recipes-open {
		flex-shrink: 0;
		padding: 0.55rem 1rem;
	}

	/* ── Lists ────────────────────────────────────────────── */
	.list-tabs {
		display: flex;
		gap: 0.4rem;
		margin-bottom: var(--section-gap);
		overflow-x: auto;
		scrollbar-width: none;
	}

	.list-tab {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
		min-height: 40px;
		padding: 0.35rem 0.95rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--text-muted);
		font-family: var(--font-display);
		font-size: 0.88rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition: all var(--transition-fast);
		--icon-accent: var(--accent);
	}

	.list-tab.active {
		color: var(--accent-bright);
		border-color: var(--border-gilt);
		background: var(--accent-dim);
	}

	.list-tab.new {
		border-style: dashed;
		color: var(--text-faint);
	}

	.list-count {
		min-width: 1.3rem;
		padding: 0 0.35rem;
		border-radius: 999px;
		background: var(--accent);
		color: var(--text-on-accent);
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 700;
		text-align: center;
	}

	.list-foot {
		display: flex;
		justify-content: center;
	}

	.list-delete {
		color: var(--text-faint);
	}

	.list-delete:hover {
		color: var(--danger);
		border-color: var(--danger);
	}

	/* ── Store sections ───────────────────────────────────── */
	.g-section {
		margin: 1rem 0 0.1rem;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.card-header + .g-group .g-section {
		margin-top: 0;
	}

	.g-list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.g-item {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		border-bottom: 1px solid var(--border-soft);
	}

	.g-item:last-child {
		border-bottom: none;
	}

	/* The whole row is the tap target — thumbs in a grocery aisle. */
	.g-tap {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.85rem;
		min-height: 60px;
		padding: 0.55rem 0.25rem;
		background: none;
		border: none;
		color: inherit;
		text-align: left;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.g-box {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		border: 1.5px solid var(--border-gilt);
		border-radius: 8px;
		color: transparent;
		--icon-accent: transparent;
		transition: all var(--transition-fast);
	}

	.g-tap:hover .g-box {
		background: var(--accent-tint);
	}

	.g-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.g-name {
		position: relative;
		align-self: flex-start;
		font-family: var(--font-body);
		font-size: 1.12rem;
		font-weight: 600;
		color: var(--text);
		overflow-wrap: anywhere;
		transition: color var(--transition-normal);
	}

	/* How many, ahead of the name: "2 lb Ground beef". */
	.g-qty {
		color: var(--accent-bright);
		font-weight: 700;
		font-variant-numeric: lining-nums tabular-nums;
	}

	.g-note {
		font-size: 0.88rem;
		color: var(--text-muted);
	}

	.g-by {
		font-size: 0.76rem;
		color: var(--text-faint);
	}

	.g-remove {
		flex-shrink: 0;
		opacity: 0.6;
	}

	.g-remove:hover {
		opacity: 1;
		color: var(--danger);
		border-color: var(--danger);
	}

	/* ── Waiting, with an Undo ─────────────────────────────── */
	.g-undo {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
		min-height: 40px;
		padding: 0.3rem 0.85rem;
		background: var(--accent-dim);
		border: 1px solid var(--border-gilt);
		border-radius: 999px;
		color: var(--accent-bright);
		font-family: var(--font-body);
		font-size: 0.88rem;
		font-weight: 700;
		cursor: pointer;
		--icon-accent: currentColor;
		animation: undo-in 0.25s var(--ease-out-expo);
	}

	.g-undo:hover {
		background: var(--accent-tint);
		border-color: var(--accent);
	}

	@keyframes undo-in {
		from {
			opacity: 0;
			transform: scale(0.9);
		}
	}

	/* The fuse along the row's foot: burns down to when it moves. */
	.g-fuse {
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 2px;
		border-radius: 2px;
		background: linear-gradient(90deg, var(--accent), var(--accent-bright));
		transform-origin: left center;
		animation-name: fuse;
		animation-timing-function: linear;
		animation-fill-mode: forwards;
		pointer-events: none;
	}

	@keyframes fuse {
		from {
			transform: scaleX(1);
		}
		to {
			transform: scaleX(0);
		}
	}

	.g-item.inking .g-name {
		color: var(--text-muted);
	}

	.g-item.removed .g-tap {
		cursor: default;
	}

	.g-item.removed .g-box {
		border-color: var(--danger);
		color: var(--danger);
		--icon-accent: var(--danger);
	}

	.g-item.removed .g-name {
		color: var(--text-faint);
		text-decoration: line-through;
		text-decoration-color: var(--danger);
		text-decoration-thickness: 2px;
	}

	.g-item.removed .g-qty {
		color: inherit;
	}

	.g-item.removed .g-by {
		color: var(--danger);
	}

	/* ── The quill's cross-out ─────────────────────────────── */
	.g-ink {
		position: absolute;
		left: -4px;
		right: -4px;
		top: 52%;
		height: 0;
		pointer-events: none;
	}

	/* The inked line: gilt, glowing, drawn left to right. */
	.g-ink::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: -1.5px;
		height: 3px;
		border-radius: 3px;
		background: linear-gradient(90deg, var(--accent), var(--accent-bright), var(--arcane));
		box-shadow:
			0 0 10px var(--accent),
			0 0 18px var(--accent-dim);
		transform: scaleX(0);
		transform-origin: left center;
	}

	.g-quill {
		position: absolute;
		left: 0;
		top: -22px;
		opacity: 0;
		color: var(--accent-bright);
		--icon-accent: var(--accent-bright);
		filter: drop-shadow(0 0 6px var(--accent));
	}

	.g-item.inking .g-ink::before {
		animation: ink-line 0.6s var(--ease-out-expo) forwards;
	}

	.g-item.inking .g-quill {
		animation: quill-run 0.6s var(--ease-out-expo) forwards;
	}

	.g-item.inking .g-box {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent);
		--icon-accent: var(--text-on-accent);
		transform: scale(1.12);
	}

	@keyframes ink-line {
		to {
			transform: scaleX(1);
		}
	}

	@keyframes quill-run {
		0% {
			left: 0;
			opacity: 1;
			transform: rotate(-12deg);
		}
		85% {
			opacity: 1;
		}
		100% {
			left: 100%;
			opacity: 0;
			transform: rotate(8deg);
		}
	}

	/* ── The basket ────────────────────────────────────────── */
	.basket-hint {
		margin: -0.35rem 0 0.4rem;
		font-size: 0.85rem;
		color: var(--text-faint);
	}

	.g-cleared {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
		padding: 0.35rem 0 0.6rem;
		color: var(--text-muted);
		font-size: 0.92rem;
	}

	.g-item.done .g-tap {
		min-height: 50px;
	}

	.g-item.done .g-box {
		background: var(--growing-dim);
		border-color: var(--growing);
		color: var(--growing);
		--icon-accent: var(--growing);
	}

	.g-item.done .g-name {
		color: var(--text-faint);
		text-decoration: line-through;
		text-decoration-color: var(--accent);
		text-decoration-thickness: 2px;
	}

	.g-item.done .g-qty {
		color: inherit;
	}

	@media (prefers-reduced-motion: reduce) {
		.g-item.inking .g-quill,
		.g-undo {
			animation: none;
		}

		/* The line is there at once, not drawn. */
		.g-item.inking .g-ink::before {
			animation: none;
			transform: scaleX(1);
		}

		/* Still waits; just doesn't burn down on screen. */
		.g-fuse {
			display: none;
		}
	}
</style>
