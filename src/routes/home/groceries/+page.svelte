<script>
	import { onMount, onDestroy } from 'svelte';
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

	/*
	 * Home → Groceries: the lists you carry into the store — Groceries, and
	 * whatever else the house adds (Costco, Target). Items group by store
	 * section so the list follows the aisles. Tap a thing to cross it off — a
	 * quill inks a line through it and it drops into the basket. Anyone can
	 * add (the nanny from Care → Today); each item says who asked for it.
	 */

	/** Remembers which list was open, per device. */
	const LIST_KEY = 'familyhub-grocery-list';

	/** How far back the suggestions look. */
	const HISTORY_ROWS = 400;
	/** How long the quill takes to cross something out. */
	const INK_MS = 650;

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
	/** Ids mid-cross-out, so the quill can finish before they move. */
	/** @type {number[]} */
	let inking = [];
	let clearing = false;
	let now = Date.now();

	/** @type {ReturnType<typeof supabase.channel> | null} */
	let channel = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let resyncTimer = null;
	/** @type {ReturnType<typeof setInterval> | null} */
	let nowInterval = null;

	onMount(() => {
		init();
	});

	onDestroy(() => {
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
		// A cross-out still inking keeps its local state until the quill lands.
		for (const id of inking) if (rows[id]) next[id] = rows[id];
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

	$: all = Object.values(rows);
	$: currentList = lists.find((l) => l.id === listId) || null;
	$: openCounts = all.reduce((acc, i) => {
		if (!i.checked_at) acc[i.list_id] = (acc[i.list_id] || 0) + 1;
		return acc;
	}, /** @type {Record<number, number>} */ ({}));
	$: here = all.filter((i) => i.list_id === listId);
	$: openItems = here
		.filter((i) => !i.checked_at || inking.includes(i.id))
		.sort((a, b) => String(a.added_at).localeCompare(String(b.added_at)));
	$: sections = groupBySection(openItems);
	$: basket = here
		.filter((i) => i.checked_at && !i.cleared_at && !inking.includes(i.id))
		.sort((a, b) => String(b.checked_at).localeCompare(String(a.checked_at)));

	/** @param {number} id */
	function openList(id) {
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

	// Cross it off: the quill inks through the name, then it drops into the
	// basket. The write goes out at once; the move waits for the ink.
	/** @param {any} item */
	async function checkOff(item) {
		if (inking.includes(item.id)) return;
		inking = [...inking, item.id];
		const stamp = { checked_at: new Date().toISOString(), checked_by: user.id };
		put({ ...item, ...stamp });

		const settle = new Promise((r) => setTimeout(r, reducedMotion() ? 0 : INK_MS));
		try {
			const { data, error } = await supabase
				.from('grocery_items')
				.update(stamp)
				.eq('id', item.id)
				.select()
				.single();
			if (error) throw error;
			await settle;
			put(data);
		} catch (err) {
			await settle;
			put(item);
			toast.error('Error crossing it off: ' + errorMessage(err));
		} finally {
			inking = inking.filter((id) => id !== item.id);
		}
	}

	/** @param {any} item */
	async function putBack(item) {
		const previous = item;
		put({ ...item, checked_at: null, checked_by: null });
		try {
			const { data, error } = await supabase
				.from('grocery_items')
				.update({ checked_at: null, checked_by: null })
				.eq('id', item.id)
				.select()
				.single();
			if (error) throw error;
			put(data);
		} catch (err) {
			put(previous);
			if (/** @type {any} */ (err).code === '23505') {
				toast.info(`${item.name} is already back on the list`);
			} else {
				toast.error('Error putting it back: ' + errorMessage(err));
			}
		}
	}

	/** @param {any} item */
	async function removeItem(item) {
		const previous = rows;
		const rest = { ...rows };
		delete rest[item.id];
		rows = rest;
		try {
			const { error } = await supabase.from('grocery_items').delete().eq('id', item.id);
			if (error) throw error;
		} catch (err) {
			rows = previous;
			toast.error('Error removing: ' + errorMessage(err));
		}
	}

	// Empty the basket. The rows stay as history for the suggestions.
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
			const next = { ...rows };
			for (const id of ids) next[id] = { ...next[id], cleared_at: stamp };
			rows = next;
		} catch (err) {
			toast.error('Error clearing the basket: ' + errorMessage(err));
		} finally {
			clearing = false;
		}
	}
</script>

<svelte:window on:focus={() => !initializing && scheduleResync()} />

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
		<div class="page-head">
			<div>
				<h1>Groceries</h1>
				<p class="lede">What the house needs — tap it off at the store.</p>
			</div>
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
					collapsible
				/>
			</section>

			<section class="card arcana">
				<div class="card-header">
					<h2>{currentList.name}</h2>
					<span class="rune-label">{openItems.length || 'nothing yet'}</span>
				</div>

				{#if openItems.length === 0}
					<EmptyState
						icon="cauldron"
						title="The larder is full"
						hint="Nothing on the list. Add something above, or the nanny can from Care."
					/>
				{:else}
					{#each sections as group (group.section)}
						<h3 class="g-section">{group.section}</h3>
						<ul class="g-list">
							{#each group.items as item (item.id)}
								<li class="g-item" class:inking={inking.includes(item.id)}>
									<button
										class="g-tap"
										on:click={() => checkOff(item)}
										aria-label="Cross off {item.name}"
									>
										<span class="g-box" aria-hidden="true"><Icon name="check" size={14} /></span>
										<span class="g-text">
											<span class="g-name">
												{item.name}
												<!-- The quill: a stand-in for a sprite sheet later. -->
												<span class="g-ink" aria-hidden="true">
													<span class="g-quill"><Icon name="quill" size={18} /></span>
												</span>
											</span>
											{#if item.note}<span class="g-note">{item.note}</span>{/if}
											<span class="g-by">
												{firstName(item.added_by)} · {sinceLabel(item.added_at, now)}
											</span>
										</span>
									</button>
									<button
										class="icon-btn g-remove"
										on:click={() => removeItem(item)}
										aria-label="Remove {item.name} from the list"
									>
										<Icon name="close" size={14} />
									</button>
								</li>
							{/each}
						</ul>
					{/each}
				{/if}
			</section>

			{#if basket.length > 0}
				<section class="card arcana basket">
					<div class="card-header">
						<h2>In the Basket</h2>
						<button class="btn btn-secondary btn-small" on:click={clearBasket} disabled={clearing}>
							<Icon name="sprout" size={14} />
							{clearing ? 'Clearing…' : 'Clear the basket'}
						</button>
					</div>
					<p class="basket-hint">Tap one to put it back on the list.</p>
					<ul class="g-list">
						{#each basket as item (item.id)}
							<li class="g-item done">
								<button
									class="g-tap"
									on:click={() => putBack(item)}
									aria-label="Put {item.name} back"
								>
									<span class="g-box" aria-hidden="true"><Icon name="check" size={14} /></span>
									<span class="g-text">
										<span class="g-name">{item.name}</span>
										<span class="g-by">
											got by {firstName(item.checked_by)} · {sinceLabel(item.checked_at, now)}
										</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if lists.length > 1}
				<div class="list-foot">
					<button class="btn-small list-delete" on:click={deleteList}>
						<Icon name="urn" size={13} /> Delete the {currentList.name} list
					</button>
				</div>
			{/if}
		{/if}
	{/if}
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

	.g-section:first-of-type {
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

	@media (prefers-reduced-motion: reduce) {
		.g-item.inking .g-ink::before,
		.g-item.inking .g-quill {
			animation: none;
		}
	}
</style>
