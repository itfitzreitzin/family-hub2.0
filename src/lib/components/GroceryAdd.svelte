<script>
	import { supabase } from '$lib/supabase';
	import { toast } from '$lib/stores/toast.js';
	import { errorMessage, isMissingSchema } from '$lib/errors.js';
	import { cleanGroceryName, grocerySuggestions, foldQuantity } from '$lib/groceries.js';
	import { splitAmount, ingredientKey } from '$lib/ingredients.js';
	import Icon from '$lib/icons/Icon.svelte';

	/*
	 * Putting something on the grocery list: type it, or tap a quick-add chip
	 * (what the house buys most, then the staples). Shared by the list itself
	 * and the nanny's "Running low?" card on Care → Today.
	 *
	 * An amount comes out of what's typed — "2 milk", "ground beef 2 lb",
	 * "milk x2" — so there's no second field to fill in.
	 */

	/** @type {any} */
	export let user = null;
	/** Rows this person can see — open ones hide their chips, all of them
	 * teach the suggestions. */
	/** @type {any[]} */
	export let items = [];
	/** The list new items go on, and its name for the confirmations. */
	/** @type {number | null} */
	export let listId = null;
	export let listName = 'Groceries';
	/** Called with the inserted (or re-counted) row. */
	/** @type {(row: any) => void} */
	export let onadded = () => {};
	/** Typing "3 milk" when Milk is already on the list changes how many —
	 * for parents; the database only lets them change a row. */
	export let canUpdate = false;
	/** Tuck the quick-add chips behind a toggle — on the list page, so the
	 * list itself stays on a phone's first screen at the store. */
	export let collapsible = false;

	let showChips = !collapsible;

	let name = '';
	let note = '';
	let showNote = false;
	let saving = false;

	$: open = items.filter((i) => !i.checked_at && i.list_id === listId);
	$: chips = grocerySuggestions(items, open);

	/** @param {string} raw @param {string} [rawNote] */
	async function add(raw, rawNote = '') {
		if (saving || listId === null) return;
		const { name: typed, quantity } = splitAmount(raw);
		const clean = cleanGroceryName(typed);
		if (!clean) return;
		const label = quantity ? `${clean} (${quantity})` : clean;

		// "onion" finds Onions: one thing, however it's typed
		const already = open.find((i) => ingredientKey(i.name) === ingredientKey(clean));
		if (already) {
			if (canUpdate && quantity && quantity !== already.quantity) {
				await recount(already, quantity);
			} else {
				toast.info(`${already.name} is already on the ${listName} list`);
			}
			return;
		}

		saving = true;
		try {
			const row = {
				list_id: listId,
				name: clean,
				note: rawNote.trim() || null,
				added_by: user.id,
				// Left out when there's no amount, so plain adds work on a
				// database that hasn't run grocery_recipes.sql yet.
				...(quantity ? { quantity } : {})
			};
			let { data, error } = await supabase.from('grocery_items').insert(row).select().single();
			if (error && quantity && isMissingSchema(error)) {
				({ data, error } = await supabase
					.from('grocery_items')
					.insert(foldQuantity(row))
					.select()
					.single());
			}

			if (error) throw error;
			name = '';
			note = '';
			showNote = false;
			onadded(data);
			toast.success(`${label} is on the ${listName} list`);
		} catch (err) {
			if (/** @type {any} */ (err).code === '23505') {
				// one_open_grocery_per_name: someone else already put it down
				toast.info(`${clean} is already on the ${listName} list`);
			} else {
				toast.error('Error adding: ' + errorMessage(err));
			}
		} finally {
			saving = false;
		}
	}

	/**
	 * A new amount for something already on the list.
	 * @param {any} item
	 * @param {string} quantity
	 */
	async function recount(item, quantity) {
		saving = true;
		try {
			const { data, error } = await supabase
				.from('grocery_items')
				.update({ quantity })
				.eq('id', item.id)
				.select()
				.single();
			if (error) throw error;
			name = '';
			onadded(data);
			toast.success(`${item.name}: now ${quantity}`);
		} catch (err) {
			toast.error(
				isMissingSchema(err)
					? 'Amounts need supabase/grocery_recipes.sql run in Supabase first'
					: 'Error changing the amount: ' + errorMessage(err)
			);
		} finally {
			saving = false;
		}
	}
</script>

<form class="g-add" on:submit|preventDefault={() => add(name, note)}>
	<div class="g-add-row">
		<label class="visually-hidden" for="g-name">Add to the grocery list</label>
		<input
			id="g-name"
			type="text"
			bind:value={name}
			placeholder="Add something — 2 milk, wipes…"
			autocomplete="off"
			maxlength="80"
		/>
		<button type="submit" class="btn btn-primary" disabled={saving || !name.trim()}>
			<Icon name="plus" size={16} /> Add
		</button>
	</div>

	{#if showNote}
		<label class="visually-hidden" for="g-note">A note for the shopper</label>
		<input
			id="g-note"
			class="g-note"
			type="text"
			bind:value={note}
			placeholder="A note for the shopper — brand, size"
			maxlength="200"
		/>
	{/if}
	<div class="g-toggles">
		{#if !showNote}
			<button type="button" class="g-note-toggle" on:click={() => (showNote = true)}>
				+ add a note
			</button>
		{/if}
		{#if collapsible && chips.length > 0}
			<button
				type="button"
				class="g-note-toggle"
				aria-expanded={showChips}
				on:click={() => (showChips = !showChips)}
			>
				{showChips ? '− hide quick add' : '+ quick add'}
			</button>
		{/if}
	</div>
</form>

{#if showChips && chips.length > 0}
	<div class="g-chips" aria-label="Quick add">
		{#each chips as chip (chip)}
			<button type="button" class="g-chip" on:click={() => add(chip)} disabled={saving}>
				<Icon name="plus" size={11} />
				{chip}
			</button>
		{/each}
	</div>
{/if}

<style>
	.g-add {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.g-add-row {
		display: flex;
		gap: 0.5rem;
	}

	.g-add-row input {
		flex: 1;
		min-width: 0;
	}

	.g-note {
		font-size: 0.9rem;
	}

	.g-toggles {
		display: flex;
		gap: 1rem;
	}

	.g-note-toggle {
		padding: 0.15rem 0;
		background: none;
		border: none;
		color: var(--text-faint);
		font-family: var(--font-body);
		font-size: 0.8rem;
		cursor: pointer;
	}

	.g-note-toggle:hover {
		color: var(--accent-bright);
	}

	.g-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.75rem;
	}

	.g-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 36px;
		padding: 0.3rem 0.8rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--text-muted);
		font-family: var(--font-body);
		font-size: 0.86rem;
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-fast);
		--icon-accent: var(--accent);
	}

	.g-chip:hover:not(:disabled) {
		color: var(--accent-bright);
		border-color: var(--border-gilt);
		background: var(--accent-tint);
	}

	.g-chip:active:not(:disabled) {
		transform: scale(0.96);
	}
</style>
