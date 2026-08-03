<script>
	import { ART } from '$lib/art.js';

	/**
	 * The wood shelf that grounds a page: three pixel still lifes standing on
	 * it, and an optional balance tile at the right.
	 *
	 * The still lifes are decorative. The balance tile is only rendered when a
	 * figure is actually passed in — an empty shelf is better than a tile
	 * confidently reporting $0.00 because its data never arrived.
	 */
	let {
		/** Outstanding amount owed. Pass null to render the shelf on its own. */
		balanceDue = null,
		/** Caption under the amount. */
		balanceLabel = 'Balance due',
		/** Makes the tile a button when supplied. */
		onBalanceClick = null,
		/** Quiet line of context along the shelf, e.g. what the balance covers. */
		note = ''
	} = $props();

	let hasBalance = $derived(typeof balanceDue === 'number' && Number.isFinite(balanceDue));
	let amount = $derived(hasBalance ? `$${balanceDue.toFixed(2)}` : '');
	let hasPlankContent = $derived(hasBalance || !!note);
</script>

<footer class="shelf">
	<!-- Still lifes stand on the shelf, overlapping its upper edge. -->
	<div class="still-lifes" aria-hidden="true">
		<img src={ART.shelfLeft} alt="" class="still" draggable="false" decoding="async" />
		<img src={ART.shelfCenter} alt="" class="still center" draggable="false" decoding="async" />
		<img src={ART.shelfRight} alt="" class="still" draggable="false" decoding="async" />
	</div>

	<div class="plank" class:bare={!hasPlankContent}>
		<span class="edge-light" aria-hidden="true"></span>

		{#if hasPlankContent}
			<div class="plank-inner">
				{#if note}
					<p class="note">{note}</p>
				{/if}
				{#if hasBalance}
					<svelte:element
						this={onBalanceClick ? 'button' : 'div'}
						role={onBalanceClick ? undefined : 'group'}
						type={onBalanceClick ? 'button' : undefined}
						class="balance"
						class:interactive={onBalanceClick}
						onclick={onBalanceClick}
						aria-label={onBalanceClick ? `${balanceLabel} ${amount}. View breakdown` : undefined}
					>
						<img src={ART.iconPurse} alt="" class="purse" draggable="false" decoding="async" />
						<span class="balance-text">
							<span class="balance-label">{balanceLabel}</span>
							<span class="balance-amount">{amount}</span>
						</span>
					</svelte:element>
				{/if}
			</div>
		{/if}
	</div>
</footer>

<style>
	.shelf {
		margin-top: var(--section-gap, 2rem);
	}

	.still-lifes {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		padding: 0 clamp(0.75rem, 5vw, 3rem);
		/* Overlap the plank's top edge by a pixel so nothing floats. */
		transform: translateY(1px);
	}

	.still {
		height: 68px;
		width: auto;
		user-select: none;
		-webkit-user-drag: none;
	}

	.plank {
		position: relative;
		background: var(--wood);
		border-top: 2px solid var(--wood-dark);
		border-radius: 0 0 var(--radius-md, 8px) var(--radius-md, 8px);
		padding: 0.75rem clamp(0.75rem, 3vw, 1.5rem);
		min-height: 20px;
	}

	/* A hairline of gilt along the shelf's front edge, catching the light. */
	.edge-light {
		position: absolute;
		inset-inline: 0;
		top: 0;
		height: 1px;
		background: var(--border-gilt);
	}

	/* With nothing on it the plank collapses to a slim rail, so an empty shelf
	   reads as trim rather than a broad bare plank waiting to be filled. */
	.plank.bare {
		padding-block: 0.4rem;
	}

	.plank-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.note {
		margin: 0;
		min-width: 0;
		font-size: 0.78rem;
		font-style: italic;
		line-height: 1.4;
		color: var(--wood-ink-muted);
	}

	.balance {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		min-height: 48px;
		padding: 0.4rem 0.9rem;
		border: 1px solid var(--border-gilt);
		border-radius: var(--radius-sm, 6px);
		background: var(--surface);
		text-align: left;
		font: inherit;
		color: inherit;
	}

	.balance.interactive {
		cursor: pointer;
		transition:
			background-color 0.18s ease,
			border-color 0.18s ease;
	}

	.balance.interactive:hover {
		background: var(--surface-hi);
		border-color: var(--accent);
	}

	.purse {
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		user-select: none;
		-webkit-user-drag: none;
	}

	.balance-text {
		display: flex;
		flex-direction: column;
	}

	.balance-label {
		font-family: var(--font-display);
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.balance-amount {
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 700;
		line-height: 1.2;
		font-variant-numeric: tabular-nums;
		color: var(--danger);
	}

	/* The centre still life is the first thing to go when the shelf narrows —
	   three clusters on a phone crowd into each other. */
	@media (max-width: 720px) {
		.still {
			height: 52px;
		}

		.center {
			display: none;
		}
	}

	@media print {
		.shelf {
			display: none;
		}
	}
</style>
