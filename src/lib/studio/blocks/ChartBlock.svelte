<script lang="ts">
	import { ui } from '$lib/state.svelte';
	import Chart from '../charts/Chart.svelte';
	import { download, slug, standaloneSvg, svgToPng } from '../charts/exporters';
	import { AGG_LABEL, buildDataset, toCsv, type ChartConfig } from '../charts/query';
	import type { BlockProps } from '../types';

	let { config }: BlockProps<ChartConfig> = $props();

	const ds = $derived(buildDataset(ui.scope, config));
	let svgEl = $state<SVGSVGElement | null>(null);
	let menu = $state(false);
	let flash = $state('');

	const subtitle = $derived(
		config.subtitle ||
			(ds.source === 'results'
				? `${ds.kind === 'scatter' ? `${ds.label} vs ${ds.xLabel ?? (config.xMetric === 'expr' ? config.xExpr : config.xMetric)}` : ds.label}${ds.kind === 'bar' || ds.kind === 'stat' || (ds.kind === 'scatter' && config.per === 'config') ? ` · ${AGG_LABEL[config.agg].toLowerCase()}` : ''}${config.log ? ' · log scale' : ''}`
				: ds.label)
	);

	async function act(kind: 'csv' | 'copy' | 'svg' | 'png' | 'json') {
		menu = false;
		const name = slug(config.title);
		try {
			if (kind === 'csv') download(name + '.csv', toCsv(ds), 'text/csv');
			if (kind === 'copy') {
				await navigator.clipboard.writeText(toCsv(ds));
				flash = 'Copied CSV';
			}
			if (kind === 'json') download(name + '.chart.json', JSON.stringify({ type: 'chart', config }, null, 2), 'application/json');
			if (kind === 'svg' && svgEl) download(name + '.svg', standaloneSvg(svgEl), 'image/svg+xml');
			if (kind === 'png' && svgEl) download(name + '.png', await svgToPng(svgEl));
		} catch (e) {
			flash = (e as Error).message;
		}
		if (flash) setTimeout(() => (flash = ''), 1600);
	}
</script>

<div class="card chart-card">
	<div class="head">
		<div class="titles">
			<div class="card-title">{config.title}</div>
			<div class="note">{subtitle}</div>
		</div>
		<div class="menu-wrap">
			{#if flash}<span class="small fg3">{flash}</span>{/if}
			<button class="dots" aria-label="Chart export options" aria-expanded={menu} onclick={() => (menu = !menu)}>⋯</button>
			{#if menu}
				<div class="menu float" role="menu">
					<button role="menuitem" onclick={() => act('copy')}>Copy data as CSV</button>
					<button role="menuitem" onclick={() => act('csv')}>Download CSV</button>
					<button role="menuitem" disabled={!svgEl} onclick={() => act('svg')}>Download SVG</button>
					<button role="menuitem" disabled={!svgEl} onclick={() => act('png')}>Download PNG</button>
					<button role="menuitem" onclick={() => act('json')}>Export chart definition</button>
				</div>
			{/if}
		</div>
	</div>
	<Chart {ds} {config} bind:svgEl />
	{#if ds.notes.length && !ds.error}
		<div class="note">{ds.notes.join(' · ')}</div>
	{/if}
</div>

<svelte:window onclick={(e) => menu && !(e.target as Element).closest('.menu-wrap') && (menu = false)} />

<style>
	.chart-card {
		height: 100%;
		box-sizing: border-box;
		gap: 10px;
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		align-items: flex-start;
	}
	.titles {
		min-width: 0;
	}
	.menu-wrap {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dots {
		border: 1px solid var(--line2);
		width: 26px;
		height: 22px;
		text-align: center;
		color: var(--fg2);
		line-height: 1;
	}
	.menu {
		position: absolute;
		right: 0;
		top: 26px;
		z-index: 20;
		display: flex;
		flex-direction: column;
		min-width: 190px;
		padding: 4px 0;
	}
	.menu button {
		padding: 6px 12px;
		font-size: 12px;
		text-align: left;
	}
	.menu button:hover:not(:disabled) {
		background: var(--hover);
	}
	.menu button:disabled {
		color: var(--fg3);
		cursor: default;
	}
</style>
