<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { supabase } from '$lib/supabase';
	import { errorMessage } from '$lib/errors.js';
	import Icon from '$lib/icons/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import ShiftClock from '$lib/components/ShiftClock.svelte';
	import MorningNote from '$lib/components/MorningNote.svelte';
	import WrapUpCard from '$lib/components/WrapUpCard.svelte';
	import CareCockpit from '$lib/components/CareCockpit.svelte';
	import GroceryDrop from '$lib/components/GroceryDrop.svelte';
	import ParentsDay from '$lib/components/ParentsDay.svelte';

	/*
	 * Care → Today: the nanny's landing page, and the parents' when the kids
	 * are the business at hand. The clock up top, the morning note under it
	 * (and, for the nanny, when the parents are busy), then the Care Day —
	 * open whether or not anyone is on the clock.
	 */

	/** @type {any} */
	let user = null;
	/** @type {any} */
	let profile = null;
	let initializing = true;
	/** @type {string | null} */
	let initError = null;
	/** The running shift, as the clock sees it. */
	/** @type {any} */
	let shift = null;

	const dateLabel = new Date().toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric'
	});

	onMount(() => {
		init();
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

			const { data, error } = await supabase
				.from('profiles')
				.select('*')
				.eq('id', user.id)
				.maybeSingle();

			if (error) throw error;
			profile = data;
			initializing = false;
		} catch (err) {
			initError = errorMessage(err);
			initializing = false;
		}
	}
</script>

<div class="container">
	{#if initializing}
		<Skeleton variant="card" count={2} />
	{:else if initError}
		<div class="card arcana">
			<EmptyState icon="warning" title="The day won't open" hint={initError}>
				<button class="btn btn-primary" on:click={init}>
					<Icon name="star" size={16} /> Try again
				</button>
			</EmptyState>
		</div>
	{:else}
		<div class="page-head">
			<div>
				<h1>Today</h1>
				<p class="lede">{dateLabel} — the day's care, as it happens.</p>
			</div>
		</div>

		<ShiftClock {user} {profile} bind:shift />
		<MorningNote {user} {profile} />
		<!-- The parents' busy times, as they chose to share them; they have Home. -->
		{#if profile?.role === 'nanny'}
			<ParentsDay />
		{/if}
		<WrapUpCard {user} {profile} activeShift={shift} />
		<CareCockpit {shift} {user} {profile} />
		<!-- Parents keep the list on Home; the nanny adds to it from here. -->
		{#if profile?.role === 'nanny'}
			<GroceryDrop {user} />
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
</style>
