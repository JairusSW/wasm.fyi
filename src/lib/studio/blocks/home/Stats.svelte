<script lang="ts">
	import { FEATS } from '$lib/data/features';
	import { RTS } from '$lib/data/runtimes';
	import { n0, shortCount } from '$lib/format';
	import { TOTAL_WORKLOADS } from '$lib/model';
	import { viewData } from '$lib/view-data';
	import type { BlockProps } from '../../types';

	type C = { show: string[] };
	let { config }: BlockProps<C> = $props();

	const STATS: Record<string, [() => number, string]> = {
		runtimes: [() => RTS.length, 'runtimes & engines tracked'],
		contracts: [() => TOTAL_WORKLOADS, 'measured contracts'],
		samples: [() => viewData.statistics.timingSamples, 'recorded timing samples'],
		features: [() => FEATS.length, 'feature families'],
		machines: [() => Object.keys(viewData.hosts).length, 'machines'],
		reports: [() => Object.keys(viewData.reports).length, 'pinned reports']
	};
	const tiles = $derived((config.show?.length ? config.show : Object.keys(STATS)).filter((k) => STATS[k]).map((k) => [STATS[k][0](), STATS[k][1]] as const));
</script>

<section class="tiles-row">
	{#each tiles as [v, l] (l)}
		<div class="tile"><span class="mono tv" title={shortCount(v) === n0(v) ? undefined : n0(v)}>{shortCount(v)}</span><span class="fg3">{l}</span></div>
	{/each}
</section>

<style>
	.tiles-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
	}
	.tile {
		padding: 22px 4px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.tv {
		font-size: 28px;
		font-weight: 500;
		letter-spacing: -0.02em;
	}
</style>
