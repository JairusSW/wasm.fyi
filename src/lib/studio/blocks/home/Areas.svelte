<script lang="ts">
	import { href, siteHref } from '$lib/links';
	import type { BlockProps } from '../../types';
	import { studio } from '../../store.svelte';
	import Heading from './Heading.svelte';

	type C = { eyebrow: string; title: string };
	let { config }: BlockProps<C> = $props();

	const areas = [
		{
			t: 'Benchmarks',
			d: 'Compilation, instantiation, execution, memory and machine code across real programs and microbenchmarks.',
			href: '/benchmarks',
			links: [
				['Fastest execution', href('/benchmarks', { metric: 'steady' }) + '#workloads'],
				['Startup cost', href('/benchmarks', { metric: 'compile' }) + '#workloads'],
				['Memory', href('/benchmarks', { metric: 'rss' }) + '#workloads']
			]
		},
		{
			t: 'History',
			d: 'Every metric over time, with source revisions, recorded gaps and a fixed comparison-engine baseline.',
			href: '/history',
			links: [
				['Execution trend', '/history'],
				['Machine code size', href('/history', { ot: 'code' })],
				['Correctness', href('/history', { ot: 'cov' })]
			]
		},
		{
			t: 'Features',
			d: 'Released engine compatibility, official suite results and feature performance.',
			href: '/features',
			links: [
				['SIMD', '/simd'],
				['WasmGC', '/gc'],
				['Threads', '/threads']
			]
		},
		{
			t: 'Studio',
			d: 'Build your own dashboards: drag blocks, write derived metrics and chart any measured result.',
			href: '/studio',
			links: [
				['Open studio', '/studio'],
				['Customize this page', '#customize']
			]
		}
	];
</script>

<section class="block">
	<Heading eyebrow={config.eyebrow} title={config.title} />
	<div class="areas">
		{#each areas as a (a.t)}
			<div class="area">
				<a class="area-title" href={siteHref(a.href)}>{a.t} →</a>
				<p class="fg2">{a.d}</p>
				<div class="area-links">
					{#each a.links as [label, to] (label)}
						{#if to === '#customize'}
							<button class="link" onclick={() => (studio.editing = true)}>{label}</button>
						{:else}
							<a class="link" href={siteHref(to)}>{label}</a>
						{/if}
					{/each}
				</div>
			</div>
		{/each}
	</div>
</section>

<style>
	.block {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 40px 0 12px;
	}
	.areas {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
		gap: 1px;
		background: var(--line);
		border: 1px solid var(--line);
	}
	.area {
		background: var(--bg2);
		padding: 20px 22px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.area-title {
		font-size: 18px;
		font-weight: 600;
		text-decoration: none;
	}
	.area p {
		line-height: 1.5;
		text-wrap: pretty;
	}
	.area-links {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		margin-top: auto;
	}
</style>
