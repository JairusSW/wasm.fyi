<script lang="ts">
	import { CFG } from '$lib/data/runtimes';
	import { THR_D } from '$lib/data/snapshot';
	import { pc } from '$lib/format';
	import { isVisible } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import BarRow from '../BarRow.svelte';
	import RtLabel from '../RtLabel.svelte';

	const TW = 600;
	const TH = 260;
	const tpl = 44;
	const tpr = 12;
	const tpt = 12;
	const tpb = 28;
	const TX = (k: number) => tpl + (k * (TW - tpl - tpr)) / 4;
	const TY = (v: number) => tpt + (1 - v / 16) * (TH - tpt - tpb);

	const vis = $derived(CFG.filter((c) => isVisible(ui.scope, c)));
	const withData = $derived(vis.filter((c) => THR_D[c.id]));
	const lines = $derived(
		withData.map((c) => ({
			c,
			p: THR_D[c.id]!.slice(0, 5)
				.map((v, k) => TX(k).toFixed(1) + ',' + TY(v).toFixed(1))
				.join(' ')
		}))
	);
	const ideal = [0, 1, 2, 3, 4].map((k) => TX(k).toFixed(1) + ',' + TY(Math.pow(2, k)).toFixed(1)).join(' ');
	const yTicks = [1, 4, 8, 12, 16].map((v) => ({ y: TY(v).toFixed(1), t: pc(TY(v), TH), label: v + '×' }));
	const xTicks = [1, 2, 4, 8, 16].map((w, k) => ({ l: pc(TX(k), TW), label: w + (k === 4 ? ' workers' : '') }));
	const stOf = (id: string) => (id === 'G' ? 'crashed' : 'unsupported');
	const stColor = (id: string) => (id === 'G' ? 'var(--st-crash)' : 'var(--fg3)');
</script>

<div class="cards wide">
	<div class="card g6">
		<div><div class="card-title">Throughput scaling</div><div class="note">parallel workload, speedup vs 1 worker · dashed = ideal</div></div>
		<div class="chart">
			<svg viewBox="0 0 {TW} {TH}">
				{#each yTicks as t (t.y)}<line x1="44" x2="588" y1={t.y} y2={t.y} style="stroke:var(--line)" />{/each}
				<polyline points={ideal} style="fill:none;stroke:var(--fg3);stroke-dasharray:4 4" />
				{#each lines as l (l.c.id)}
					<polyline points={l.p} style:stroke={l.c.col} style:stroke-dasharray={l.c.hollow ? '4 3' : 'none'} class="ln" />
				{/each}
			</svg>
			{#each yTicks as t (t.y)}<span class="axis-label" style:left="6.5%" style:top={t.t} style:transform="translate(-100%,-50%)">{t.label}</span>{/each}
			{#each xTicks as t (t.label)}<span class="axis-label" style:left={t.l} style:top="94%" style:transform="translateX(-50%)">{t.label}</span>{/each}
		</div>
		<div class="at16">
			{#each withData as c (c.id)}
				<span class="item"><RtLabel {c} /><span class="mono">{THR_D[c.id]![4].toFixed(1)}×</span></span>
			{/each}
			<span class="fg3">at 16 workers</span>
		</div>
	</div>
	<div class="col">
		<div class="card">
			<div><div class="card-title">Memory per worker</div><div class="note">RSS increase per additional worker · lower is better</div></div>
			{#each vis as c (c.id)}
				{@const d = THR_D[c.id]}
				<BarRow {c} ok={!!d} w={d ? Math.max(1, (d[5] / 3.6) * 100).toFixed(1) + '%' : '0%'} text={d ? d[5].toFixed(1) + ' MB / worker' : ''} status={stOf(c.id)} statusColor={stColor(c.id)} />
			{/each}
		</div>
		<div class="card">
			<div><div class="card-title">Under contention</div><div class="note">atomic-counter, 8 workers on one cache line · higher is better</div></div>
			{#each vis as c (c.id)}
				{@const d = THR_D[c.id]}
				<BarRow {c} ok={!!d} w={d ? Math.max(1, (d[6] / 8) * 100).toFixed(1) + '%' : '0%'} text={d ? d[6].toFixed(1) + '× at 8 workers' : ''} status={stOf(c.id)} statusColor={stColor(c.id)} />
			{/each}
		</div>
	</div>
</div>

<style>
	.wide {
		grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr));
	}
	.g6 {
		gap: 6px;
	}
	.chart {
		position: relative;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
	.ln {
		fill: none;
		stroke-width: 1.8;
		stroke-linejoin: round;
	}
	.at16 {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 12px;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
</style>
