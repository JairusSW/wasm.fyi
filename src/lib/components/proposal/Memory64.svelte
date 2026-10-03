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

	const M64_W=featureContracts('memory64').map(w=>[w.id,w.purpose || ''] as [string,string]);
 const M64_D=$derived(Object.fromEntries(CFG.map(c=>[c.id,[familyValue(ui.scope,'memory64',c.id),familyValue(ui.scope,'memory64',c.id,'compile')]])));
 const vis = $derived(ordered(CFG.filter((c) => isVisible(ui.scope, c))));
	const execMax = $derived(Math.max(...vis.map((c) => M64_D[c.id]?.[0] ?? 0), 1));
	const compMax = $derived(Math.max(...vis.map((c) => M64_D[c.id]?.[1] ?? 0), 1));
	const w = (v: number, max: number) => Math.max(1, (v / max) * 100).toFixed(1) + '%';
</script>

<div class="lede">
	Memory64 load/store, fill/copy and growth contracts at multiple input sizes. The scalar baseline has different memory work and cannot establish wasm32 overhead.
</div>
<div class="cards">
	<div class="card">
		<div><div class="card-title">Memory64 execution</div><div class="note">geomean across complete Memory64 corpus · lower is better</div></div>
		{#each vis as c (c.id)}
			{@const d = M64_D[c.id]}
			<BarRow {c} ok={d?.[0]!=null} w={w(d?.[0] ?? 0, execMax)} text={d?.[0]==null?'':fmtU(d[0],'ms')} status="not measured" />
		{/each}
	</div>
	<div class="card">
		<div><div class="card-title">Memory64 compilation</div><div class="note">lower is better</div></div>
		{#each vis as c (c.id)}
			{@const d = M64_D[c.id]}
			<BarRow {c} ok={d?.[1]!=null} w={w(d?.[1] ?? 0, compMax)} text={d?.[1]==null?'':fmtU(d[1],'ms')} status="not measured" />
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
			{#each M64_W as [id, desc] (id)}
				<tr>
					<td class="pad"><div class="mono">{id}</div><div class="small fg3">{desc}</div></td>
					{#each vis as c (c.id)}
						{@const d = M64_D[c.id]}
            {@const value=featureValue(ui.scope,id,c.id)}
            <td class="mono r pad">{value==null?'not measured':fmtU(value,'ms')}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.pad {
		padding: 6px 12px;
	}
</style>
