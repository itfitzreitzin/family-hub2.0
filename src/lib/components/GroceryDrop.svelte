<script>
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabase';
	import { toast } from '$lib/stores/toast.js';
	import { errorMessage } from '$lib/errors.js';
	import GroceryAdd from './GroceryAdd.svelte';
	import Icon from '$lib/icons/Icon.svelte';

	/*
	 * The nanny's side of the grocery list, on Care → Today: "out of wipes"
	 * goes straight onto the parents' list. The database only shows the nanny
	 * what they added, so this card lists those — still waiting, or bought —
	 * and lets them take back a mistake before anyone shops for it.
	 */

	/** @type {any} */
	export let user = null;

	/** How long a bought item keeps its "got it" tick here. */
	const RECENT_MS = 3 * 24 * 60 * 60 * 1000;

	/** @type {any[]} */
	let mine = [];
	/** @type {ReturnType<typeof supabase.channel> | null} */
	let channel = null;

	onMount(() => {
		load().catch((err) => console.warn('Grocery card failed to load:', errorMessage(err)));
		channel = supabase
			.channel('grocery-drop')
			.on('postgres_changes', { event: '*', schema: 'public', table: 'grocery_items' }, () =>
				load().catch(() => {})
			)
			.subscribe();
	});

	onDestroy(() => {
		if (channel) supabase.removeChannel(channel);
	});

	async function load() {
		const { data, error } = await supabase
			.from('grocery_items')
			.select('*')
			.eq('added_by', user.id)
			.order('added_at', { ascending: false })
			.limit(100);
		if (error) throw error;
		mine = data || [];
	}

	$: waiting = mine.filter((i) => !i.checked_at);
	$: bought = mine.filter(
		(i) => i.checked_at && Date.now() - new Date(i.checked_at).getTime() < RECENT_MS
	);

	/** @param {any} row */
	function added(row) {
		mine = [row, ...mine.filter((i) => i.id !== row.id)];
	}

	/** @param {any} item */
	async function takeBack(item) {
		const previous = mine;
		mine = mine.filter((i) => i.id !== item.id);
		try {
			const { error } = await supabase.from('grocery_items').delete().eq('id', item.id);
			if (error) throw error;
		} catch (err) {
			mine = previous;
			toast.error('Error taking it back: ' + errorMessage(err));
		}
	}
</script>

<section class="card arcana grocery-drop">
	<div class="card-header">
		<h2>Running Low?</h2>
		<span class="rune-label">onto the grocery list</span>
	</div>

	<GroceryAdd {user} items={mine} onadded={added} />

	{#if waiting.length > 0 || bought.length > 0}
		<ul class="mine">
			{#each waiting as item (item.id)}
				<li>
					<span class="mine-name">{item.name}</span>
					<span class="mine-state">on the list</span>
					<button
						class="icon-btn mine-undo"
						on:click={() => takeBack(item)}
						aria-label="Take {item.name} off the list"
					>
						<Icon name="close" size={13} />
					</button>
				</li>
			{/each}
			{#each bought as item (item.id)}
				<li class="got">
					<span class="mine-name">{item.name}</span>
					<span class="mine-state"><Icon name="check" size={12} /> got it</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.mine {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 1rem 0 0;
		padding: 0.85rem 0 0;
		list-style: none;
		border-top: 1px solid var(--border-soft);
	}

	.mine li {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.3rem 0.2rem 0.75rem;
		background: var(--accent-tint);
		border: 1px solid var(--border-gilt);
		border-radius: 999px;
		font-size: 0.86rem;
	}

	.mine li.got {
		padding-right: 0.75rem;
		background: var(--growing-dim);
		border-color: rgba(111, 191, 115, 0.4);
	}

	.mine-name {
		font-weight: 600;
		color: var(--text);
	}

	.mine-state {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.74rem;
		color: var(--text-faint);
	}

	.got .mine-state {
		color: var(--growing);
		--icon-accent: var(--growing);
	}

	.mine-undo {
		width: 26px;
		height: 26px;
		min-height: 26px;
	}
</style>
