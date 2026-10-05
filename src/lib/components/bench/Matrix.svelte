<script lang="ts">
import { CFG } from '$lib/data/runtimes';
import { ST } from '$lib/data/status';
	import { OV } from '$lib/data/snapshot';
	import type { MetricKey, OvKey } from '$lib/data/types';
	import { fmtUGroup, n0 } from '$lib/format';
	import { heatCount, heatRatio } from '$lib/heat';
	import { TOTAL_WORKLOADS, sharedCount, cov, absOf, disp, isOff, isVisible, ratio } from '$lib/model';
import { ui } from '$lib/state.svelte';
import { viewCell, viewData } from '$lib/view-data';
	import Carousel from '../Carousel.svelte';
	import RtLabel from '../RtLabel.svelte';
	import Tabs from '../Tabs.svelte';

	let { onmetric }: { onmetric: (m: MetricKey) => void } = $props();

	const KEYS = Object.keys(OV) as OvKey[];
	const gi = $derived(KEYS.indexOf(ui.group));
	const step = (d: number) => (ui.group = KEYS[(gi + d + KEYS.length) % KEYS.length]);
	const g = $derived(OV[ui.group]);

	const SHARED_NOTE: Record<OvKey, string> = {
		calls: 'Two measured directions; round trip estimates their sum.',
		lat: 'Successful shared contracts from one locked report.',
		mem: 'Process lifetime peak RSS in each separate memory scenario.',
		code: 'Extracted image bytes; unavailable collectors remain unmeasured.',
		cov: `All ${TOTAL_WORKLOADS} measured contracts.`
	};

	/** Badness of a count within its column across runtimes available on this machine, 0…1. */
	const countBadness = (col: number, v: number) => {
		const vals = CFG.filter((k) => !isOff(ui.scope, k.id)).map((k) => cov(k.id,ui.scope)[col]);
		const lo = Math.min(...vals);
		const hi = Math.max(...vals);
		const t = hi > lo ? (v - lo) / (hi - lo) : 0;
		return col === 0 ? 1 - t : t;
	};

	const callWorkloads = ['mechanisms/wasm-to-host-call', 'mechanisms/host-to-wasm-call'];
	function opsRate(milliseconds: number) {
		const rate = 1000 / milliseconds;
		if (rate >= 1e9) return (rate / 1e9).toFixed(1) + 'b';
		if (rate >= 1e6) return (rate / 1e6).toFixed(1) + 'm';
		if (rate >= 1e3) return (rate / 1e3).toFixed(1) + 'k';
		return rate.toFixed(1);
	}
	const peakMemoryNote = 'Arithmetic mean of recorded whole-process RSS snapshots taken after each benchmark batch, across compilation, instantiation, first-call and steady workloads on this host and snapshot. Each available workload-phase measurement has equal weight. These are boundary samples, not a continuous time average. Missing current RSS observations remain not measured.';
	const roundTripNote = 'Estimated sum of Wasm → host and Host → Wasm steady-state latencies; not an independently measured nested round trip.';
	function roundTrip(a: ReturnType<typeof viewCell>, b: ReturnType<typeof viewCell>): ReturnType<typeof viewCell> {
		if (a.st !== 'ok') return a;
		if (b.st !== 'ok') return b;
		if (a.v == null || b.v == null) return { ...a, st: 'nm', v: undefined };
		return { ...a, v: a.v + b.v };
	}
	const callCells = $derived.by(() => {
		const configs = CFG.filter((c) => isVisible(ui.scope, c));
		const raw = callWorkloads.map((workload) => configs.map((config) => viewCell(ui.machine, ui.snap, workload, config.id, 'steady')));
		raw.push(raw[0].map((cell, i) => roundTrip(cell, raw[1][i])));
		const baselines = callWorkloads.map(workload => viewCell(ui.machine, ui.snap, workload, ui.baseline, 'steady'));
		baselines.push(roundTrip(baselines[0], baselines[1]));
		const values = raw.flatMap(cells => cells.map(cell => cell.st === 'ok' ? cell.v ?? null : null));
		const formatted = fmtUGroup(values, 'ms');
		return new Map(configs.map((config, configIndex) => [config.id, raw.map((cells, directionIndex) => {
			const cell = cells[configIndex];
			const baseline = baselines[directionIndex];
			if (cell.st !== 'ok' || cell.v == null) return {text: ST[cell.st][1], bg: 'transparent', color: ST[cell.st][2]};
			const baselineValue = baseline.st === 'ok' ? baseline.v : null;
			const rel = baselineValue && baselineValue > 0 ? cell.v / baselineValue : null;
			return {text: formatted[directionIndex * configs.length + configIndex] || '—', rate: cell.v > 0 ? `${opsRate(cell.v)} ops/s · reciprocal of latency` : '', bg: heatRatio(rel), color: 'var(--fg)'};
		})]));
	});

	const rows = $derived.by(() => {
		const s = ui.scope;
		return CFG.filter((c) => isVisible(s, c)).map((c) => {
			const off = isOff(s, c.id);
			const cv = cov(c.id,ui.scope);
			const commonTimes=ui.group==='lat'?fmtUGroup(g.metrics.map((_,i)=>absOf(s,'lat',c.id,i)?.v ?? null),'ms'):null;
			const cells = g.cols.map((_, i) => {
				if (ui.group === 'calls') return callCells.get(c.id)?.[i] || {text:'—',bg:'transparent',color:'var(--fg3)'};
				if (ui.group === 'cov') {
					const v = cv[i];
					if (off) return { text: '—', bg: 'transparent', color: 'var(--fg3)' };
					return {
						text: n0(v),
						bg: i !== 0 && v === 0 ? 'transparent' : heatCount(countBadness(i, v)),
						color: v || i === 0 ? 'var(--fg)' : 'var(--fg3)'
					};
				}
				const grp = ui.group as 'lat' | 'mem' | 'code';
				const sourceIndex = grp === 'code' ? i + 3 : i;
				const r = ratio(s, grp, c.id, sourceIndex);
				if (!r) {
					const interpreter=grp==='code'&&viewData.hosts[s.machine].configurations[c.id]?.backend==='interpreter';
					return { text: interpreter?'n/a':disp(s,grp,c.id,sourceIndex)?.t || (off?'unavailable':'not measured'), bg:'transparent',color:'var(--fg3)' };
				}
				return { text: commonTimes?.[i] || disp(s, grp, c.id, sourceIndex)!.t, bg: heatRatio(r.r), color: 'var(--fg)' };
			});
			return {
				c,
				cells,
				covShort: off ? '—' : n0(cv[0]) + ' / ' + TOTAL_WORKLOADS,
				covBg: off ? 'transparent' : heatCount(countBadness(0, cv[0]))
			};
		});
	});

	const snapTaken = $derived(ui.snap === 's1' ? 'Latest measured cells' : 'Previous measured cells');
	const snapAgo = $derived(ui.group === 'calls' ? '2 measured call workloads' : `${sharedCount(ui.scope)} shared successful contracts in the latency cohort`);
</script>

<div class="stack">
	<Tabs options={KEYS.map((k) => [k, OV[k].label])} value={ui.group} onselect={(k) => (ui.group = k)} />
	<Carousel title={g.label} sub="{gi + 1} / {KEYS.length} · {SHARED_NOTE[ui.group]}" onprev={() => step(-1)} onnext={() => step(1)}>
		<div class="snap">
			<span
				class="mono taken"
				data-tip={'Aggregates use a shared successful cohort in one sealed report. Individual workload cells retain their own report references.\nPick another snapshot in the scope bar.'}
				>{snapTaken}</span
			>
			<span class="small fg3">{snapAgo}</span>
		</div>
	</Carousel>
	<div class="tbl-wrap">
		<table class="mx" style:min-width="720px">
			<thead>
				<tr>
					<th class="stick th-label">Runtime</th>
					{#each g.cols as label, i (label)}
						<th class="colh">
							<button onclick={() => onmetric(g.metrics[i])} data-tip={ui.group === 'mem' && i === 3 ? peakMemoryNote : ui.group === 'calls' && i === 2 ? roundTripNote : `Open the per-benchmark ${label} matrix`}>{label}</button>
						</th>
					{/each}
					<th class="colh">Correct</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.c.id)}
					<tr>
						<td class="stick rtcell"><RtLabel c={r.c} profile mono bold /></td>
						{#each r.cells as x, i (i)}
							<td class="p0">
								<button
									class="cellbtn mono val"
									style:background={x.bg}
									style:color={x.color}
									onclick={() => onmetric(g.metrics[i])}
									data-tip={`${r.c.rt} ${r.c.be} — ${g.cols[i]}\n${x.text}\n${'rate' in x && x.rate ? x.rate + '\n' : ''}${ui.group === 'mem' && i === 3 ? peakMemoryNote + '\n' : ui.group === 'calls' && i === 2 ? roundTripNote + '\n' : ''}Click to see per-workload results`}>{x.text}</button
								>
							</td>
						{/each}
						<td class="mono r corr" style:background={r.covBg}>{r.covShort}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.snap {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin-left: 6px;
		padding-left: 14px;
		border-left: 1px solid var(--line);
	}
	.taken {
		font-size: 12px;
		cursor: help;
	}
	.colh {
		text-align: right;
		padding: 8px 12px;
		font-size: 12px;
	}
	.colh button {
		font-weight: 500;
	}
	.rtcell {
		padding: 7px 12px;
		white-space: nowrap;
	}
	.p0 {
		padding: 0;
	}
	.val {
		padding: 7px 12px;
	}
	.corr {
		padding: 7px 12px;
		font-size: 12px;
	}
</style>
