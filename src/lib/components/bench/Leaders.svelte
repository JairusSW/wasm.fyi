<script lang="ts">
	import type { MetricKey } from '$lib/data/types';
	import { leader } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import Swatch from '../Swatch.svelte';

	let { onmetric }: { onmetric: (m: MetricKey) => void } = $props();

	const leaders = $derived([
		leader(ui.scope, 'Fastest compilation', 'lat', 0, 'compile'),
		leader(ui.scope, 'Fastest instantiation', 'lat', 1, 'inst'),
		leader(ui.scope, 'Fastest execution', 'lat', 3, 'steady'),
		leader(ui.scope, 'Smallest generated code', 'code', 3, 'code')
	]);
</script>

<div class="tiles leaders">
	{#each leaders as l (l.label)}
		<button
			class="leader hoverbg"
			onclick={() => onmetric(l.metric)}
			data-tip={[l.label, l.clear ? [l.value, l.cfg.rt, l.cfg.be].join(' · ') : 'No clear leader', 'Click to see the underlying results'].join('\n')}
		>
			<span class="kicker">{l.label}</span>
			{#if l.clear}
				<span class="mono value">{l.value}</span>
				<span class="who">
					<Swatch color={l.cfg.col} bg={l.cfg.hollow ? 'transparent' : l.cfg.col} size={9} />
					<span class="w5">{l.cfg.rt}</span><span class="mono small fg3">{l.cfg.be}</span>
				</span>
			{:else}
				<span class="unclear">No clear leader</span>
				<span class="small fg3">{l.versus}</span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.leaders {
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	}
	.leader {
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		text-align: left;
	}
	.value {
		font-size: 22px;
		font-weight: 500;
		letter-spacing: -0.02em;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.w5 {
		font-weight: 500;
	}
	.unclear {
		font-size: 18px;
		font-weight: 500;
	}
</style>
