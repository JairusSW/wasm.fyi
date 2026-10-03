<script lang="ts">
	import { ui } from '$lib/state.svelte';
	import Chart from '../charts/Chart.svelte';
	import { download, slug, standaloneSvg, svgToPng } from '../charts/exporters';
	import { KINDS, buildDataset, toCsv, type ChartConfig, type ChartKind } from '../charts/query';
	import { studio } from '../store.svelte';
	import type { BlockProps } from '../types';

	let { config, update, editing, height }: BlockProps<ChartConfig> = $props();

	const ds = $derived(buildDataset(ui.scope, config));
	let svgEl = $state<SVGSVGElement | null>(null);
	let menu = $state(false);
	let flash = $state('');

	/** Space left for the drawing once the card's header and note are placed. */
	const drawH = $derived(height ? Math.max(110, height - 96) : config.kind === 'heatmap' ? 340 : 240);
	const subtitle = $derived(ds.error ? '' : ds.kind === 'scatter' ? `${ds.label} vs ${ds.xLabel}` : ds.label);

	async function act(kind: 'csv' | 'copy' | 'svg' | 'png') {
		menu = false;
		const name = slug(config.title);
		try {
			if (kind === 'csv') download(name + '.csv', toCsv(ds), 'text/csv');
			if (kind === 'copy') {
				await navigator.clipboard.writeText(toCsv(ds));
				flash = 'Copied';
			}
			if (kind === 'svg' && svgEl) download(name + '.svg', standaloneSvg(svgEl), 'image/svg+xml');
			if (kind === 'png' && svgEl) download(name + '.png', await svgToPng(svgEl));
		} catch (e) {
			flash = (e as Error).message;
		}
		if (flash) setTimeout(() => (flash = ''), 1600);
	}
	const KIND_ICON: Record<ChartKind, string> = { bar: '▤', scatter: '⁘', heatmap: '▦', line: '⟋' };
</script>

<div class="card chart-card">
	<div class="head">
		<div class="titles">
			{#if editing}
				<input
					class="title-input card-title"
					value={config.title}
					aria-label="Chart title"
					onfocus={() => studio.beginGesture(studio.current)}
					onblur={() => studio.endGesture()}
					oninput={(e) => update({ title: e.currentTarget.value }, false)}
					onpointerdown={(e) => e.stopPropagation()}
				/>
			{:else}
				<div class="card-title">{config.title}</div>
			{/if}
			{#if subtitle}<div class="note">{subtitle}</div>{/if}
		</div>
		{#if editing}
			<div class="kinds" role="group" aria-label="Chart type">
				{#each KINDS as [k, label, q] (k)}
					<button aria-pressed={config.kind === k} onclick={() => update({ kind: k })} data-tip="{label}: {q}">{KIND_ICON[k]}</button>
				{/each}
			</div>
		{/if}
		<div class="menu-wrap">
			{#if flash}<span class="small fg3">{flash}</span>{/if}
			<button class="dots" aria-label="Export" aria-expanded={menu} onclick={() => (menu = !menu)} data-tip="Export">⋯</button>
			{#if menu}
				<div class="menu float" role="menu">
					<button role="menuitem" onclick={() => act('copy')}>Copy data</button>
					<button role="menuitem" onclick={() => act('csv')}>Download CSV</button>
					{#if svgEl}
						<button role="menuitem" onclick={() => act('svg')}>Download SVG</button>
						<button role="menuitem" onclick={() => act('png')}>Download PNG</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
	<Chart {ds} {config} height={drawH} bind:svgEl />
	{#if ds.note && !ds.error}<div class="note">{ds.note}</div>{/if}
</div>

<svelte:window onclick={(e) => menu && !(e.target as Element).closest('.menu-wrap') && (menu = false)} />

<style>
	.chart-card {
		gap: 10px;
		min-width: 0;
	}
	.head {
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}
	.titles {
		min-width: 0;
		flex: 1;
	}
	.title-input {
		width: 100%;
		background: transparent;
		border: 0;
		border-bottom: 1px dashed var(--line2);
		padding: 0 0 1px;
		font: inherit;
		font-weight: 600;
		outline: none;
	}
	.title-input:focus {
		border-bottom-color: var(--focus);
	}
	.kinds {
		display: inline-flex;
		border: 1px solid var(--line2);
		flex: none;
	}
	.kinds button {
		width: 26px;
		height: 22px;
		color: var(--fg3);
		text-align: center;
		font-size: 13px;
	}
	.kinds button[aria-pressed='true'] {
		background: var(--line2);
		color: var(--fg);
	}
	.menu-wrap {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
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
		min-width: 160px;
		padding: 4px 0;
	}
	.menu button {
		padding: 6px 12px;
		font-size: 12px;
		text-align: left;
	}
	.menu button:hover {
		background: var(--hover);
	}
</style>
