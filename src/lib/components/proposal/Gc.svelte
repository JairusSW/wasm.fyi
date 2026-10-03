<script lang="ts">
	import { columns, ordered } from '$lib/order.svelte';
	import { reorder } from '$lib/reorder';
	import { CFG } from '$lib/data/runtimes';
	import { featureValue, familyValue } from '$lib/feature-values';
 import { featureContracts } from '$lib/model';
 import { fmtU } from '$lib/format';
	import { isVisible } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import BarRow from '../BarRow.svelte';
	import RtLabel from '../RtLabel.svelte';

	const GC_W=featureContracts('gc').map(w=>[w.id,w.purpose || '',1] as [string,string,number]);
  const GC_D=$derived(Object.fromEntries(CFG.map(c=>[c.id,{thr:familyValue(ui.scope,'gc',c.id),ratio:familyValue(ui.scope,'gc',c.id,'rss'),st:'not measured',col:'not collected'}])));
  const vis = $derived(ordered(CFG.filter((c) => isVisible(ui.scope, c))));
	const thrMax = $derived(Math.max(...vis.map((c) => GC_D[c.id].thr || 0), 1));
	const ratioMax = $derived(Math.max(...vis.map((c) => GC_D[c.id].ratio || 0), 1));
	const stColor = (st?: string) => (st?.startsWith('fails') ? 'var(--st-fail)' : 'var(--fg3)');
	const w = (v: number, max: number) => Math.max(1, (v / max) * 100).toFixed(1) + '%';
</script>

<div class="lede">
	Exact struct, array, cast and i31 contracts at multiple operation counts. Invocation timing includes the recorded guest work; it does not measure isolated collector pauses.
</div>
<div class="cards">
	<div class="card">
		<div><div class="card-title">GC corpus execution</div><div class="note">geomean across successful complete GC corpus · lower is better</div></div>
		{#each vis as c (c.id)}
			{@const d = GC_D[c.id]}
			<BarRow {c} ok={!!d.thr} w={w(d.thr ?? 0, thrMax)} text={d.thr==null?'':fmtU(d.thr,'ms')} status={d.st} statusColor={stColor(d.st)} />
		{/each}
	</div>
	<div class="card">
		<div><div class="card-title">Steady process peak RSS</div><div class="note">includes adapter process · lower is better</div></div>
		{#each vis as c (c.id)}
			{@const d = GC_D[c.id]}
			<BarRow {c} ok={!!d.ratio} w={w(d.ratio ?? 0, ratioMax)} text={d.ratio==null?'':fmtU(d.ratio,'MiB')} status={d.st} statusColor={stColor(d.st)} />
		{/each}
	</div>
</div>
<div class="tbl-wrap">
	<table class="t" style:min-width="720px">
		<thead>
			<tr use:reorder={{ onmove: (id, t, after) => columns.moveCfg(id, t, after), onstep: (id, d) => columns.stepCfg(id, vis.map((c) => c.id), d) }}>
				<th>Workload</th>
				{#each vis as c (c.id)}<th class="r" data-col={c.id} data-col-label="{c.rt} {c.be}" tabindex="0"><RtLabel {c} /></th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each GC_W as [id, desc, k] (id)}
				<tr>
					<td class="pad"><div class="mono">{id}</div><div class="small fg3">{desc}</div></td>
					{#each vis as c (c.id)}
						{@const d = GC_D[c.id]}
            {@const v=featureValue(ui.scope,id,c.id)}
            <td class="mono r pad">{v==null?'not measured':fmtU(v,'ms')}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
<div class="panel colls">
	<span class="kicker">Collectors and pauses</span>
	{#each vis.filter((c) => GC_D[c.id].col) as c (c.id)}
		<div class="coll">
			<RtLabel {c} />
			<span class="mono small">{GC_D[c.id].col}</span>
			<span class="mono small fg2"
				>{'Collector pause distribution not collected'}</span
			>
		</div>
	{/each}
	<span class="note">Pause distributions appear only where a collector-aware measurement exists. Ordinary invocation latency is never relabeled as GC pause.</span>
</div>

<style>
	.pad {
		padding: 6px 12px;
	}
	.colls {
		padding: 10px 14px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.coll {
		display: grid;
		grid-template-columns: 170px 220px 1fr;
		gap: 8px;
		font-size: 12px;
		border-bottom: 1px solid var(--line);
		padding: 4px 0;
		align-items: center;
	}
	@media (max-width: 640px) {
		.coll {
			grid-template-columns: 1fr;
		}
	}
</style>
