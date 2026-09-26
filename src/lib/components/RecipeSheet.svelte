<script>
	import { onMount, tick } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { toast, confirm as confirmModal } from '$lib/stores/toast.js';
	import { errorMessage, isMissingSchema } from '$lib/errors.js';
	import { cleanGroceryName, groceryKey, groupBySection, foldQuantity } from '$lib/groceries.js';
	import {
		parseIngredients,
		ingredientKey,
		alwaysHave,
		scaleQuantity,
		NOTE_MAX
	} from '$lib/ingredients.js';
	import Icon from '$lib/icons/Icon.svelte';

	/*
	 * Groceries from a recipe. Paste one — a recipe's ingredients, a recipe
	 * site, a list ChatGPT made — or pick one from the recipe book; tap off
	 * what's already in the house (the Worcestershire), and the rest goes on
	 * the list, each thing saying which recipe wants it. A kept recipe is one
	 * tap next time.
	 *
	 * One sheet, three steps: the book, the recipe (paste or edit), and
	 * picking what's needed. The recipe is kept as written; the reading
	 * happens here (src/lib/ingredients.js), every time it's picked.
	 */

	/** @type {any} */
	export let user = null;
	/** The grocery page's rows, to know what's already on the list. */
	/** @type {any[]} */
	export let items = [];
	/** @type {number | null} */
	export let listId = null;
	export let listName = 'Groceries';
	/** Called with the rows put on the list. */
	/** @type {(rows: any[]) => void} */
	export let onadded = () => {};
	export let onclose = () => {};

	/** @type {'loading' | 'book' | 'write' | 'pick'} */
	let view = 'loading';
	/** @type {any[]} */
	let recipes = [];
	/** No recipes table yet (grocery_recipes.sql not run): pasting works, keeping doesn't. */
	let noBook = false;
	/** The book's row for what's open, when it came from the book. */
	/** @type {any | null} */
	let recipe = null;
	let name = '';
	/** @type {number | null | undefined} */
	let servings = null;
	let body = '';
	/** How many to shop for, when the recipe says how many it serves. */
	let makeFor = 0;
	/** @type {import('$lib/ingredients.js').Ingredient[]} */
	let lines = [];
	/** Taps in the pick step — in the house or not — by ingredient key. They
	 * outlive a trip back to edit the recipe. */
	/** @type {Record<string, boolean>} */
	let choices = {};
	let keep = true;
	let busy = false;
	/** @type {HTMLTextAreaElement | null} */
	let bodyEl = null;

	onMount(loadBook);

	async function loadBook() {
		const { data, error } = await supabase
			.from('recipes')
			.select('*')
			.order('last_used_at', { ascending: false, nullsFirst: false })
			.order('name', { ascending: true });
		if (error) {
			noBook = isMissingSchema(error);
			if (!noBook) toast.error('Error opening the recipe book: ' + errorMessage(error));
		}
		recipes = data || [];
		if (recipes.length) {
			view = 'book';
		} else {
			view = 'write';
			await tick();
			bodyEl?.focus();
		}
	}

	$: title = cleanGroceryName(name);
	$: serves = Number(servings) >= 1 && Number(servings) <= 99 ? Math.round(Number(servings)) : null;
	$: factor = serves && makeFor ? makeFor / serves : 1;
	$: counts = Object.fromEntries(recipes.map((r) => [r.id, parseIngredients(r.body).items.length]));
	// Keeping a new recipe under a name the book already has replaces that one,
	// so that starts unticked.
	$: clash =
		(!recipe && title && recipes.find((r) => groceryKey(r.name) === groceryKey(title))) || null;
	$: keep = !clash;
	$: onList = new Set(
		items.filter((i) => !i.checked_at && i.list_id === listId).map((i) => ingredientKey(i.name))
	);
	// In the house: what was tapped, or else water, salt and pepper.
	$: inHouse = new Set(
		lines.filter((l) => choices[l.key] ?? alwaysHave(l.name, l.quantity)).map((l) => l.key)
	);
	$: toAdd = lines.filter((l) => !inHouse.has(l.key) && !onList.has(l.key));
	$: groups = groupBySection(lines);

	/** @param {any} r */
	function meta(r) {
		const count = counts[r.id] || 0;
		return [
			r.servings ? `serves ${r.servings}` : '',
			`${count} ${count === 1 ? 'thing' : 'things'}`
		]
			.filter(Boolean)
			.join(' · ');
	}

	/** @param {any | null} from */
	function open(from) {
		recipe = from;
		name = from?.name || '';
		servings = from?.servings ?? null;
		body = from?.body || '';
		choices = {};
	}

	async function startPaste() {
		open(null);
		view = 'write';
		await tick();
		bodyEl?.focus();
	}

	/** @param {any} r */
	function edit(r) {
		open(r);
		view = 'write';
	}

	/** @param {any} r */
	function cook(r) {
		open(r);
		pick();
	}

	function pick() {
		const parsed = parseIngredients(body);
		// Read name and servings fresh: cook() sets them in the same tick, before
		// the reactive title and serves have caught up.
		if (!cleanGroceryName(name) && parsed.title) name = parsed.title;
		if (!(Number(servings) >= 1) && parsed.servings) servings = parsed.servings;
		makeFor = Number(servings) || 0;
		lines = parsed.items;
		view = 'pick';
	}

	/** @param {import('$lib/ingredients.js').Ingredient} line */
	function toggle(line) {
		choices = { ...choices, [line.key]: !inHouse.has(line.key) };
	}

	/** @param {number} by */
	function scale(by) {
		makeFor = Math.min(99, Math.max(1, makeFor + by));
	}

	/**
	 * Put rows on the list: all at once, or — when one of them got there
	 * first (someone added it meanwhile) — one at a time, skipping those.
	 * Before grocery_recipes.sql has run, amounts ride in the note.
	 * @param {any[]} rows
	 * @returns {Promise<{ added: any[], skipped: number }>}
	 */
	async function insertRows(rows) {
		let fold = false;
		let res = await supabase.from('grocery_items').insert(rows).select();
		if (res.error && isMissingSchema(res.error)) {
			fold = true;
			res = await supabase
				.from('grocery_items')
				.insert(rows.map((r) => foldQuantity(r)))
				.select();
		}
		if (!res.error) return { added: res.data || [], skipped: 0 };
		if (res.error.code !== '23505') throw res.error;

		/** @type {any[]} */
		const added = [];
		let skipped = 0;
		for (const row of rows) {
			const one = await supabase
				.from('grocery_items')
				.insert(fold ? foldQuantity(row) : row)
				.select()
				.single();
			if (one.error?.code === '23505') skipped += 1;
			else if (one.error) throw one.error;
			else added.push(one.data);
		}
		return { added, skipped };
	}

	async function addToList() {
		if (busy || toAdd.length === 0 || listId === null) return;
		busy = true;
		// At the store, "for Chili" says why there's cumin on the list.
		const tag = title ? `for ${title}` : '';
		const rows = toAdd.map((l) => {
			const quantity = scaleQuantity(l.quantity, factor);
			const note = [l.note, tag].filter(Boolean).join(' · ').slice(0, NOTE_MAX);
			return {
				list_id: listId,
				name: l.name,
				note: note || null,
				added_by: user.id,
				...(quantity ? { quantity } : {})
			};
		});
		try {
			const { added, skipped } = await insertRows(rows);
			onadded(added);
			await remember();
			toast.success(
				`Added ${added.length} to ${listName}` +
					(skipped ? ` — ${skipped} ${skipped === 1 ? 'was' : 'were'} already on it` : '')
			);
			onclose();
		} catch (err) {
			toast.error('Error adding to the list: ' + errorMessage(err));
		} finally {
			busy = false;
		}
	}

	// Keep a new recipe (if asked), or note that a kept one was cooked again —
	// saving any edits made on the way.
	async function remember() {
		if (noBook) return;
		const stamp = new Date().toISOString();
		const fields = { name: title, servings: serves, body, updated_at: stamp };
		try {
			let error = null;
			if (recipe) {
				const edited =
					recipe.body !== body ||
					(title && recipe.name !== title) ||
					(recipe.servings ?? null) !== serves;
				({ error } = await supabase
					.from('recipes')
					.update(
						edited
							? { ...fields, name: title || recipe.name, last_used_at: stamp }
							: { last_used_at: stamp }
					)
					.eq('id', recipe.id));
			} else if (keep && title) {
				({ error } = clash
					? await supabase
							.from('recipes')
							.update({ ...fields, last_used_at: stamp })
							.eq('id', clash.id)
					: await supabase
							.from('recipes')
							.insert({ ...fields, last_used_at: stamp, created_by: user.id }));
			}
			if (error) throw error;
		} catch (err) {
			toast.error("It's on the list, but keeping the recipe failed: " + errorMessage(err));
		}
	}

	async function saveOnly() {
		if (busy || !title || noBook) return;
		busy = true;
		const target = recipe || clash;
		const fields = { name: title, servings: serves, body, updated_at: new Date().toISOString() };
		try {
			const { error } = target
				? await supabase.from('recipes').update(fields).eq('id', target.id)
				: await supabase.from('recipes').insert({ ...fields, created_by: user.id });
			if (error) throw error;
			toast.success(`${title} is in the recipe book`);
			open(null);
			await loadBook();
		} catch (err) {
			toast.error(
				/** @type {any} */ (err).code === '23505'
					? `The book already has a recipe called ${title}`
					: 'Error keeping the recipe: ' + errorMessage(err)
			);
		} finally {
			busy = false;
		}
	}

	async function deleteRecipe() {
		if (!recipe || busy) return;
		const gone = recipe;
		const ok = await confirmModal.show({
			title: 'Delete this recipe',
			message: `Take ${gone.name} out of the recipe book? Anything already on the grocery list stays there.`,
			confirmText: 'Delete',
			danger: true
		});
		if (!ok) return;
		busy = true;
		try {
			const { error } = await supabase.from('recipes').delete().eq('id', gone.id);
			if (error) throw error;
			toast.success(`${gone.name} is out of the recipe book`);
			open(null);
			await loadBook();
		} catch (err) {
			toast.error('Error deleting the recipe: ' + errorMessage(err));
		} finally {
			busy = false;
		}
	}

	// Tapping outside closes the sheet only when there's nothing to lose.
	function veil() {
		if (view === 'book' || view === 'loading' || !body.trim()) onclose();
	}

	/** @param {KeyboardEvent} e */
	function onKeydown(e) {
		// Escape on a confirmation closes the confirmation, not the sheet.
		if (e.key === 'Escape' && !$confirmModal) onclose();
	}
</script>

<svelte:window on:keydown={onKeydown} />

<div class="modal-overlay">
	<button class="rs-veil" tabindex="-1" aria-label="Close" on:click={veil}></button>
	<div class="modal-content rs" role="dialog" aria-modal="true" aria-labelledby="rs-title">
		<div class="rs-head">
			<h2 id="rs-title">
				{#if view === 'write'}
					{recipe ? recipe.name : 'A recipe or a list'}
				{:else if view === 'pick'}
					{title || 'What do we need?'}
				{:else}
					Recipes
				{/if}
			</h2>
			<button class="icon-btn" on:click={onclose} aria-label="Close">
				<Icon name="close" size={16} />
			</button>
		</div>

		<div class="rs-body">
			{#if view === 'loading'}
				<p class="rs-lede">Opening the recipe book…</p>
			{:else if view === 'book'}
				<!-- ── The book ───────────────────────────────── -->
				<button class="rs-new" on:click={startPaste}>
					<Icon name="plus" size={16} /> Paste a recipe or a list
				</button>
				<ul class="rs-book">
					{#each recipes as r (r.id)}
						<li>
							<button class="rs-recipe" on:click={() => cook(r)}>
								<span class="rs-recipe-name">{r.name}</span>
								<span class="rs-recipe-meta">{meta(r)}</span>
							</button>
							<button class="btn-small" on:click={() => edit(r)} aria-label="Edit {r.name}">
								Edit
							</button>
						</li>
					{/each}
				</ul>
			{:else if view === 'write'}
				<!-- ── The recipe, pasted or kept ─────────────── -->
				<div class="rs-fields">
					<div class="form-group rs-name">
						<label for="rs-name">Name</label>
						<input
							id="rs-name"
							type="text"
							bind:value={name}
							maxlength="80"
							placeholder="Chili, taco night… (optional)"
							autocomplete="off"
						/>
					</div>
					<div class="form-group rs-serves">
						<label for="rs-serves">Serves</label>
						<input
							id="rs-serves"
							type="number"
							inputmode="numeric"
							min="1"
							max="99"
							bind:value={servings}
							placeholder="–"
						/>
					</div>
				</div>
				<div class="form-group">
					<label for="rs-body">Ingredients</label>
					<textarea
						id="rs-body"
						bind:this={bodyEl}
						bind:value={body}
						rows="10"
						maxlength="20000"
						placeholder="Paste a recipe, a recipe site, or a list from ChatGPT.&#10;One thing per line — “2 lb ground beef”, “Worcestershire”.&#10;Headings and cooking steps are skipped."
					></textarea>
				</div>
				<button class="btn btn-primary rs-go" on:click={pick} disabled={!body.trim()}>
					Pick what we need <Icon name="chevron-right" size={16} />
				</button>
				<div class="rs-more">
					{#if recipes.length}
						<button class="btn-small" on:click={() => (view = 'book')}>
							<Icon name="chevron-left" size={13} /> The book
						</button>
					{/if}
					{#if !noBook && title && body.trim()}
						<button class="btn-small" on:click={saveOnly} disabled={busy}>
							<Icon name="grimoire" size={13} />
							{recipe ? 'Save changes' : 'Keep without adding'}
						</button>
					{/if}
					{#if recipe}
						<button class="btn-small rs-delete" on:click={deleteRecipe} disabled={busy}>
							<Icon name="urn" size={13} /> Delete
						</button>
					{/if}
				</div>
				{#if noBook}
					<p class="rs-hint">
						To keep recipes for next time, run supabase/grocery_recipes.sql in Supabase.
					</p>
				{/if}
			{:else}
				<!-- ── Picking what's needed ──────────────────── -->
				<p class="rs-lede">Tap what's already in the house. The rest goes on {listName}.</p>
				{#if serves}
					<div class="rs-scale">
						<span>Serves {serves} · shopping for</span>
						<button
							class="icon-btn"
							on:click={() => scale(-1)}
							disabled={makeFor <= 1}
							aria-label="Fewer people"
						>
							<Icon name="minus" size={14} />
						</button>
						<span class="rs-count" aria-live="polite">{makeFor}</span>
						<button
							class="icon-btn"
							on:click={() => scale(1)}
							disabled={makeFor >= 99}
							aria-label="More people"
						>
							<Icon name="plus" size={14} />
						</button>
					</div>
				{/if}

				{#if lines.length === 0}
					<p class="rs-empty">
						Couldn't find anything to buy in that — one thing per line works best.
					</p>
				{:else}
					{#each groups as group (group.section)}
						<h3 class="rs-section">{group.section}</h3>
						<ul class="rs-lines">
							{#each group.items as line (line.key)}
								{@const listed = onList.has(line.key)}
								{@const got = !listed && inHouse.has(line.key)}
								{@const qty = scaleQuantity(line.quantity, factor)}
								<li>
									<button
										class="rs-line"
										class:got
										class:listed
										disabled={listed}
										aria-pressed={got}
										on:click={() => toggle(line)}
									>
										<span class="rs-box" aria-hidden="true"><Icon name="check" size={13} /></span>
										<span class="rs-text">
											<span class="rs-item">
												{#if qty}<span class="rs-qty">{qty}&nbsp;</span>{/if}{line.name}
											</span>
											{#if line.note}<span class="rs-note">{line.note}</span>{/if}
										</span>
										{#if listed}
											<span class="rs-tag">on the list</span>
										{:else if got}
											<span class="rs-tag">have it</span>
										{/if}
									</button>
								</li>
							{/each}
						</ul>
					{/each}
				{/if}
			{/if}
		</div>

		{#if view === 'pick'}
			<div class="rs-foot">
				{#if !recipe && !noBook && title}
					<label class="rs-keep">
						<input type="checkbox" bind:checked={keep} />
						{clash
							? `Keep it in the recipe book (replaces ${clash.name})`
							: `Keep ${title} in the recipe book`}
					</label>
				{/if}
				<button
					class="btn btn-primary rs-add"
					on:click={addToList}
					disabled={busy || toAdd.length === 0}
				>
					<Icon name="plus" size={16} />
					{busy
						? 'Adding…'
						: toAdd.length
							? `Add ${toAdd.length} to ${listName}`
							: 'Nothing to add'}
				</button>
				<button class="btn-small rs-back" on:click={() => (view = 'write')}>
					<Icon name="chevron-left" size={13} />
					{recipe ? 'Edit the recipe' : 'Back to the paste'}
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	/* Tapping the veil around the sheet. */
	.rs-veil {
		position: absolute;
		inset: 0;
		min-height: 0;
		padding: 0;
		background: none;
		border: none;
		cursor: default;
	}

	/* The head and the foot stay put; the middle scrolls. */
	.rs {
		z-index: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.rs-body {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
		/* Room for focus rings at the edges */
		margin: 0 -6px;
		padding: 0 6px 2px;
	}

	.rs-head {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border-soft);
	}

	.rs-head h2 {
		margin: 0;
		padding: 0;
		border: none;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.rs-lede,
	.rs-hint,
	.rs-empty {
		margin: 0 0 0.85rem;
		color: var(--text-muted);
		font-size: 0.92rem;
	}

	.rs-hint {
		margin: 0.85rem 0 0;
		color: var(--text-faint);
		font-size: 0.82rem;
	}

	/* ── The book ─────────────────────────────────────────── */
	.rs-new {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		min-height: 52px;
		margin-bottom: 1rem;
		background: var(--accent-tint);
		border: 1px dashed var(--border-gilt);
		border-radius: var(--radius-sm);
		color: var(--accent-bright);
		font-family: var(--font-body);
		font-size: 1rem;
		font-weight: 700;
		cursor: pointer;
		--icon-accent: currentColor;
	}

	.rs-new:hover {
		background: var(--accent-dim);
	}

	.rs-book {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.rs-book li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border-bottom: 1px solid var(--border-soft);
	}

	.rs-book li:last-child {
		border-bottom: none;
	}

	.rs-recipe {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		min-height: 56px;
		padding: 0.5rem 0.25rem;
		background: none;
		border: none;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.rs-recipe-name {
		font-size: 1.08rem;
		font-weight: 700;
		color: var(--text);
	}

	.rs-recipe:hover .rs-recipe-name {
		color: var(--accent-bright);
	}

	.rs-recipe-meta {
		font-size: 0.8rem;
		color: var(--text-faint);
	}

	/* ── The recipe ───────────────────────────────────────── */
	.rs-fields {
		display: flex;
		gap: 0.75rem;
	}

	.rs-name {
		flex: 1;
		min-width: 0;
	}

	.rs-serves {
		width: 5.5rem;
		flex-shrink: 0;
	}

	.rs-serves input {
		font-variant-numeric: lining-nums tabular-nums;
	}

	textarea {
		width: 100%;
		min-height: 12rem;
		resize: vertical;
		line-height: 1.5;
	}

	.rs-go {
		width: 100%;
	}

	.rs-more {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.rs-delete:hover:not(:disabled) {
		color: var(--danger);
		border-color: var(--danger);
	}

	/* ── Picking ──────────────────────────────────────────── */
	.rs-scale {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		color: var(--text-muted);
		font-size: 0.92rem;
	}

	.rs-count {
		min-width: 1.6rem;
		text-align: center;
		font-weight: 700;
		color: var(--text);
		font-variant-numeric: lining-nums tabular-nums;
	}

	.rs-section {
		margin: 0.9rem 0 0.1rem;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.rs-lines {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.rs-lines li {
		border-bottom: 1px solid var(--border-soft);
	}

	.rs-lines li:last-child {
		border-bottom: none;
	}

	.rs-line {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		min-height: 52px;
		padding: 0.45rem 0.2rem;
		background: none;
		border: none;
		color: inherit;
		text-align: left;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	.rs-line:disabled {
		opacity: 1;
		cursor: default;
	}

	.rs-box {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 26px;
		height: 26px;
		border: 1.5px solid var(--border-gilt);
		border-radius: 7px;
		color: transparent;
		--icon-accent: transparent;
		transition: all var(--transition-fast);
	}

	.rs-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.rs-item {
		font-size: 1.02rem;
		font-weight: 600;
		color: var(--text);
		overflow-wrap: anywhere;
	}

	.rs-qty {
		color: var(--accent-bright);
		font-weight: 700;
		font-variant-numeric: lining-nums tabular-nums;
	}

	.rs-note {
		font-size: 0.82rem;
		color: var(--text-faint);
	}

	.rs-tag {
		flex-shrink: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	/* In the house: crossed off, like the list. */
	.rs-line.got .rs-box {
		background: var(--growing-dim);
		border-color: var(--growing);
		color: var(--growing);
		--icon-accent: var(--growing);
	}

	.rs-line.got .rs-item,
	.rs-line.listed .rs-item {
		color: var(--text-faint);
		text-decoration: line-through;
		text-decoration-thickness: 2px;
	}

	.rs-line.got .rs-item {
		text-decoration-color: var(--growing);
	}

	.rs-line.got .rs-qty,
	.rs-line.listed .rs-qty {
		color: inherit;
	}

	.rs-line.got .rs-tag {
		color: var(--growing);
	}

	.rs-line.listed .rs-box {
		border-style: dashed;
		border-color: var(--border);
	}

	.rs-line.listed .rs-item {
		text-decoration-color: var(--border);
	}

	/* Always in reach at the foot of the sheet, however long the recipe. */
	.rs-foot {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 0.75rem;
		padding-top: 0.85rem;
		border-top: 1px solid var(--border-soft);
	}

	.rs-keep {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin: 0;
		color: var(--text-muted);
		font-family: var(--font-body);
		font-size: 0.9rem;
		font-weight: 600;
		letter-spacing: normal;
		text-transform: none;
		cursor: pointer;
	}

	.rs-keep input {
		width: 18px;
		height: 18px;
		accent-color: var(--accent);
	}

	.rs-add {
		width: 100%;
	}

	.rs-back {
		align-self: flex-start;
	}

	@media (max-width: 480px) {
		.rs-fields {
			gap: 0.5rem;
		}
	}
</style>
