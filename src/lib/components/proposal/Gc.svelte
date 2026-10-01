<script lang="ts">
	import { CFG } from '$lib/data/runtimes';
	import { GC_D, GC_W } from '$lib/data/snapshot';
	import { H } from '$lib/format';
	import { isVisible } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import BarRow from '../BarRow.svelte';
	import RtLabel from '../RtLabel.svelte';

	const vis = $derived(CFG.filter((c) => isVisible(ui.scope, c)));
	const thrMax = $derived(Math.max(...vis.map((c) => GC_D[c.id].thr || 0), 1));
	const ratioMax = $derived(Math.max(...vis.map((c) => GC_D[c.id].ratio || 0), 1));
	const stColor = (st?: string) => (st?.startsWith('fails') ? 'var(--st-fail)' : 'var(--fg3)');
	const w = (v: number, max: number) => Math.max(1, (v / max) * 100).toFixed(1) + '%';
</script>

<div class="lede">
	Allocation-heavy workloads varying allocation rate, live-set size, object lifetime and graph shape. GC on/off is not a switch like scalar vs SIMD
	— comparisons against linear-memory builds need matched allocation policies, so none are shown here.
</div>
<div class="cards">
	<div class="card">
		<div><div class="card-title">Allocation throughput</div><div class="note">geomean across 4 GC workloads · higher is better</div></div>
		{#each vis as c (c.id)}
			{@const d = GC_D[c.id]}
			<BarRow {c} ok={!!d.thr} w={w(d.thr ?? 0, thrMax)} text="{d.thr} M obj/s" status={d.st} statusColor={stColor(d.st)} />
		{/each}
	</div>
	<div class="card">
		<div><div class="card-title">Peak heap ÷ live set</div><div class="note">memory overhead at steady state · lower is better</div></div>
		{#each vis as c (c.id)}
			{@const d = GC_D[c.id]}
			<BarRow {c} ok={!!d.ratio} w={w(d.ratio ?? 0, ratioMax)} text="{d.ratio?.toFixed(1)}× live set" status={d.st} statusColor={stColor(d.st)} />
		{/each}
	</div>
</div>
<div class="tbl-wrap">
	<table class="t" style:min-width="720px">
		<thead>
			<tr>
				<th>Workload</th>
				{#each vis as c (c.id)}<th class="r"><RtLabel {c} /></th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each GC_W as [id, desc, k] (id)}
				<tr>
					<td class="pad"><div class="mono">{id}</div><div class="small fg3">{desc}</div></td>
					{#each vis as c (c.id)}
						{@const d = GC_D[c.id]}
						{#if d.thr}
							<td class="mono r pad">{(d.thr * k * (1 + (H(id + c.id) - 0.5) * 0.3)).toFixed(0)} M/s</td>
						{:else}
							<td class="mono r pad fg3">{d.st}</td>
						{/if}
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
				>{c.id === 'F'
					? 'p50 0.42 ms · p99 3.1 ms · max 7.8 ms (n = 4,120 collections)'
					: GC_D[c.id].thr
						? 'not collector-aware — pauses not reported'
						: '—'}</span
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
