<script lang="ts">
	import { tick } from 'svelte';
	import Leaders from '$lib/components/bench/Leaders.svelte';
	import Matrix from '$lib/components/bench/Matrix.svelte';
	import OverTime from '$lib/components/bench/OverTime.svelte';
	import Workloads from '$lib/components/bench/Workloads.svelte';
	import type { MetricKey } from '$lib/data/types';
	import { isOff } from '$lib/model';
	import { ui } from '$lib/state.svelte';

	const nShared = $derived(isOff(ui.scope, 'D') ? '1,108 shared workloads' : '1,112 shared workloads');

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
	<span class="mono small fg3 path">wasm.fyi/benchmarks</span>
	<h1>Benchmarks</h1>
	<span class="s12 fg3">Geometric mean over {nShared} · lower is better</span>
	<a class="link-quiet push" href="/compare">Startup vs throughput model →</a>
</div>

<Leaders onmetric={showMetric} />
<Matrix onmetric={showMetric} />
<OverTime />
<Workloads />

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 14px;
	}
	.path {
		width: 100%;
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
