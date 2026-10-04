<script lang="ts">
	import { CFG } from '$lib/data/runtimes';
	import { ST } from '$lib/data/status';
	import { fmtUGroup } from '$lib/format';
	import { isVisible } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import { viewCell } from '$lib/view-data';
	import RtLabel from '../RtLabel.svelte';

	const directions = [
		{ id: 'mechanisms/wasm-to-host-call', label: 'Wasm → host', note: 'A Wasm export makes one typed host callback.' },
		{ id: 'mechanisms/host-to-wasm-call', label: 'Host → Wasm', note: 'The embedding calls one typed Wasm export.' }
	] as const;

	const rows = $derived.by(() => {
		const configs = CFG.filter(c => isVisible(ui.scope, c));
		const data = directions.map(direction => configs.map(config => viewCell(ui.machine, ui.snap, direction.id, config.id, 'steady')));
		const formatted = fmtUGroup(data.flatMap(cells => cells.map(cell => cell.st === 'ok' ? cell.v ?? null : null)), 'ns');
		return configs.map((config, index) => ({
			config,
			cells: data.map((cells, directionIndex) => {
				const cell = cells[index];
				return cell.st === 'ok' && cell.v != null
					? { text: formatted[directionIndex * configs.length + index], tip: `${directions[directionIndex].label} call · steady-state, one verified operation`, color: 'var(--fg)' }
					: { text: ST[cell.st][1], tip: cell.reason == null ? `${directions[directionIndex].label} call measurement status` : `${directions[directionIndex].label} call · ${cell.reason}`, color: ST[cell.st][2] };
			})
		}));
	});
</script>

<section class="calls">
	<div class="heading">
		<h2>Host ↔ Wasm call latency</h2>
		<span class="small fg3">Steady-state · same typed identity call · {ui.machine === 'm1' ? 'AMD64' : 'ARM64'}</span>
	</div>
	<div class="tbl-wrap">
		<table>
			<thead>
				<tr><th>Runtime</th>{#each directions as direction}<th class="r" data-tip={direction.note}>{direction.label}</th>{/each}</tr>
			</thead>
			<tbody>
				{#each rows as row (row.config.id)}
					<tr>
						<td><RtLabel c={row.config} profile mono /></td>
						{#each row.cells as cell, index (index)}<td class="mono r" style:color={cell.color} data-tip={cell.tip}>{cell.text}</td>{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

<style>
	.calls { margin: 18px 0; padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
	.heading { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
	h2 { margin: 0; font-size: 14px; font-weight: 600; }
	table { width: 100%; border-collapse: collapse; }
	th, td { padding: 7px 10px; border-bottom: 1px solid var(--line); }
	th { font-size: 12px; color: var(--fg2); font-weight: 500; text-align: left; }
	th.r, td.r { text-align: right; }
	tr:last-child td { border-bottom: 0; }
</style>
