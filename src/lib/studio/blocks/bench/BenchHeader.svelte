<script lang="ts">
	import { siteHref } from '$lib/links';
	import { sharedCount } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import type { BlockProps } from '../../types';

	type C = { title: string };
	let { config }: BlockProps<C> = $props();
	const nShared = $derived(`${sharedCount(ui.scope)} shared application workloads`);
</script>

<div class="head">
	<span class="mono small fg3 path">wasm.fyi/benchmarks</span>
	<h1>{config.title}</h1>
	<span class="s12 fg3">Geometric mean over {nShared} · lower is better</span>
	<a class="link-quiet push" href={siteHref(`/compare`)}>Startup vs throughput model →</a>
</div>

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
