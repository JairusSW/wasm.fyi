<script lang="ts">
	import { siteHref } from '$lib/links';
	import { tick } from 'svelte';
	import Leaders from '$lib/components/bench/Leaders.svelte';
	import Matrix from '$lib/components/bench/Matrix.svelte';
	import OverTime from '$lib/components/bench/OverTime.svelte';
	import Workloads from '$lib/components/bench/Workloads.svelte';
	import type { MetricKey, OvKey } from '$lib/data/types';
	import { sharedCount, totalWorkloads } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import { apiView } from '$lib/api/controller.svelte';

	// Passed per engine: every engine averages its own passed workloads out of the whole corpus.
	// Passed on all engines: use the least-covered measured engine’s passing workloads.
	const nShared = $derived(ui.cohortMode === 'shared' ? `${sharedCount(ui.scope)} reference workloads from the least-covered shown engine` : `${totalWorkloads()} application workloads, each engine's passed ones`);

	async function showOverview(group: OvKey) {
		ui.group = group;
		await tick();
		document.getElementById('overview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	/** Switch the per-workload matrix to a metric and bring it into view. */
	async function showMetric(m: MetricKey) {
		ui.metric = m;
		await tick();
		document.getElementById('workloads')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<svelte:head>
	<title>Benchmarks · wasm.fyi</title>
</svelte:head>

<div class="head">
	<h1>Benchmarks</h1>
	<span class="s12 fg3">{ui.average === 'mean' ? 'Mean' : 'Geometric mean'} over {#if apiView.ready}{nShared}{:else}<span class="skel" style:width="3em"></span> application workloads{/if} · lower is better</span>
	<a class="link-quiet push" href={siteHref(`/compare`)}>Startup vs throughput model →</a>
</div>

<Leaders onmetric={showMetric} onoverview={showOverview} />
<div id="overview"><Matrix onmetric={showMetric} /></div>
<OverTime />
<Workloads />

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 14px;
	}
	h1 {
		font-size: 18px;
		font-weight: 600;
	}
	.s12 {
		font-size: 12px;
	}
	.push {
		margin-left: auto;
	}
</style>
