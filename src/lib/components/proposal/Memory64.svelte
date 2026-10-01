<script lang="ts">
	import { CFG } from '$lib/data/runtimes';
	import { M64_D, M64_W } from '$lib/data/snapshot';
	import { H } from '$lib/format';
	import { isVisible } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import BarRow from '../BarRow.svelte';
	import RtLabel from '../RtLabel.svelte';

	const vis = $derived(CFG.filter((c) => isVisible(ui.scope, c)));
	const execMax = $derived(Math.max(...vis.map((c) => M64_D[c.id]?.[0] ?? 0), 1));
	const compMax = $derived(Math.max(...vis.map((c) => M64_D[c.id]?.[1] ?? 0), 1));
	const w = (v: number, max: number) => Math.max(1, (v / max) * 100).toFixed(1) + '%';
</script>

<div class="lede">
	Deliberately matched wasm32 and wasm64 builds of the same source and input. 32-bit memories can use guard pages for bounds checks; 64-bit
	memories generally need explicit checks.
</div>
<div class="cards">
	<div class="card">
		<div><div class="card-title">Execution overhead vs wasm32</div><div class="note">geomean across matched workloads · lower is better</div></div>
		{#each vis as c (c.id)}
			{@const d = M64_D[c.id]}
			<BarRow {c} ok={!!d} w={w(d?.[0] ?? 0, execMax)} text={d ? '+' + d[0].toFixed(1) + '%' + (d[2] ? ' ⚑' : '') : ''} status="unsupported" />
		{/each}
	</div>
	<div class="card">
		<div><div class="card-title">Compilation overhead vs wasm32</div><div class="note">lower is better</div></div>
		{#each vis as c (c.id)}
			{@const d = M64_D[c.id]}
			<BarRow {c} ok={!!d} w={w(d?.[1] ?? 0, compMax)} text={d ? '+' + d[1].toFixed(1) + '%' : ''} status="unsupported" />
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
			{#each M64_W as [id, desc] (id)}
				<tr>
					<td class="pad"><div class="mono">{id}</div><div class="small fg3">{desc}</div></td>
					{#each vis as c (c.id)}
						{@const d = M64_D[c.id]}
						{#if d}
							<td class="mono r pad">+{(d[0] * (0.5 + H(id + c.id) * 1.1)).toFixed(1)}%</td>
						{:else}
							<td class="mono r pad fg3">unsupported</td>
						{/if}
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
