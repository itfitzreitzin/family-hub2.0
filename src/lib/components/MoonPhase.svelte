<script>
	import { moonPhase } from '$lib/moon.js';

	export let size = 22;
	export let date = new Date();
	/** Show the phase name beside the glyph. */
	export let showLabel = false;

	const R = 8;

	$: phase = moonPhase(date);

	/**
	 * The lit region as a single path: one semicircle on the lit side, closed
	 * by the terminator ellipse. rx collapses to 0 at the quarters (straight
	 * terminator) and back out to R at new/full.
	 * @param {{fraction: number, waxing: boolean}} p
	 */
	function litPath(p) {
		const rx = Math.abs(R * Math.cos(2 * Math.PI * p.fraction));
		const signed = R * Math.cos(2 * Math.PI * p.fraction);

		if (p.waxing) {
			const sweep = signed > 0 ? 0 : 1;
			return `M 0 ${-R} A ${R} ${R} 0 0 1 0 ${R} A ${rx} ${R} 0 0 ${sweep} 0 ${-R} Z`;
		}

		const sweep = signed > 0 ? 1 : 0;
		return `M 0 ${-R} A ${R} ${R} 0 0 0 0 ${R} A ${rx} ${R} 0 0 ${sweep} 0 ${-R} Z`;
	}
</script>

<span class="moon-phase" title="{phase.name} — {phase.meaning}">
	<svg
		width={size}
		height={size}
		viewBox="-9 -9 18 18"
		role="img"
		aria-label="{phase.name}, {Math.round(phase.illumination * 100)}% illuminated"
	>
		<circle r={R} class="disc" />
		<path d={litPath(phase)} class="lit" />
		<circle r={R} class="ring" />
	</svg>
	{#if showLabel}
		<span class="phase-name">{phase.name}</span>
	{/if}
</span>

<style>
	.moon-phase {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	svg {
		display: block;
		overflow: visible;
	}

	.disc {
		fill: var(--surface-2);
	}

	.lit {
		fill: var(--accent-bright);
		filter: drop-shadow(0 0 4px var(--accent-dim));
	}

	.ring {
		fill: none;
		stroke: var(--border-gilt);
		stroke-width: 1;
	}

	.phase-name {
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-faint);
		white-space: nowrap;
	}
</style>
