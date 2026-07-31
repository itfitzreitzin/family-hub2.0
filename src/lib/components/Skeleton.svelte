<script>
	/** 'card' | 'stats' | 'rows' | 'text' */
	export let variant = 'card';
	/** How many repeats to draw. */
	export let count = 3;

	// A plain index list keeps every {#each} keyed without a throwaway binding.
	$: slots = Array.from({ length: count }, (_, i) => i);
</script>

<div class="skeleton-wrap" aria-busy="true" aria-live="polite">
	<span class="visually-hidden">Consulting the almanac…</span>

	{#if variant === 'stats'}
		<div class="sk-stats">
			{#each slots as i (i)}
				<div class="sk-stat">
					<div class="skeleton sk-icon"></div>
					<div class="skeleton skeleton-line" style="width: 55%; height: 1.5rem"></div>
					<div class="skeleton skeleton-line short"></div>
				</div>
			{/each}
		</div>
	{:else if variant === 'rows'}
		<div class="sk-rows">
			{#each slots as i (i)}
				<div class="sk-row">
					<div class="skeleton skeleton-line" style="width: 22%"></div>
					<div class="skeleton skeleton-line" style="width: 16%"></div>
					<div class="skeleton skeleton-line" style="width: 16%"></div>
					<div class="skeleton skeleton-line" style="width: 30%"></div>
				</div>
			{/each}
		</div>
	{:else if variant === 'text'}
		{#each slots as i (i)}
			<div class="skeleton skeleton-line" style="width: {i % 3 === 2 ? '55%' : '92%'}"></div>
		{/each}
	{:else}
		<div class="sk-cards">
			{#each slots as i (i)}
				<div class="sk-card">
					<div class="skeleton skeleton-line medium" style="height: 1.1rem"></div>
					<div class="skeleton skeleton-line"></div>
					<div class="skeleton skeleton-line short"></div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.skeleton-wrap {
		width: 100%;
	}

	.sk-stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: var(--grid-gap);
	}

	.sk-stat,
	.sk-card {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 1.15rem;
		border: 1px solid var(--border-soft);
		border-radius: var(--card-radius);
		background: var(--surface-2);
	}

	.sk-icon {
		width: 26px;
		height: 26px;
		border-radius: 4px;
	}

	.sk-cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
		gap: var(--grid-gap);
	}

	.sk-rows {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.sk-row {
		display: flex;
		gap: 1rem;
		align-items: center;
	}

	.sk-row .skeleton-line {
		margin-bottom: 0;
	}
</style>
