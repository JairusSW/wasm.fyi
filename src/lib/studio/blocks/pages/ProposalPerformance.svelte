<script lang="ts">
	import Gc from '$lib/components/proposal/Gc.svelte';
	import Memory64 from '$lib/components/proposal/Memory64.svelte';
	import Simd from '$lib/components/proposal/Simd.svelte';
	import Threads from '$lib/components/proposal/Threads.svelte';
	import { PROPS } from '$lib/data/features';
	import type { BlockProps } from '../../types';

	let { ctx }: BlockProps = $props();
	const id = $derived(ctx.proposal ?? 'simd');
</script>

<div class="perf-head">
	<span class="kicker">Performance</span>
	<h2>{PROPS[id].q}</h2>
</div>

{#if id === 'simd'}
	<Simd />
{:else if id === 'gc'}
	<Gc />
{:else if id === 'memory64'}
	<Memory64 />
{:else}
	<Threads />
{/if}

<style>
	.perf-head {
		display: flex;
		flex-direction: column;
		gap: 2px;
		border-top: 1px solid var(--line);
		padding-top: 14px;
	}
	h2 {
		font-size: 16px;
		font-weight: 600;
	}
</style>
