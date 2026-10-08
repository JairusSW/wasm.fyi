<script lang="ts">
import {apiView,aggregateKey} from '$lib/api/controller.svelte';
import {datasetView} from '$lib/api/view.svelte';
 import { tipCard, tipWho } from '$lib/tip';
import { CALL_PATHS } from '$lib/call-paths';
import { CFG } from '$lib/data/runtimes';
import { ST } from '$lib/data/status';
	import { OV } from '$lib/data/snapshot';
	import type { MetricKey, OvKey } from '$lib/data/types';
	import { fmtUGroup, n0 } from '$lib/format';
	import { heatCount, heatRatio } from '$lib/heat';
	import { totalWorkloads, sharedCount, cov, absOf, disp, isOff, isVisible, ratio } from '$lib/model';
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
		calls: 'Two independently measured call paths; callback averages use a guest loop.',
		lat: 'Shared exact contracts from explicit host-local report membership.',
		mem: 'RSS retains its source pass and observation boundary.',
		code: 'Shared code-size comparisons include engines with available native code; other engines show n/a.',
		cov: `All ${totalWorkloads()} measured contracts.`
	};

	/** Badness of a count within its column across runtimes available on this machine, 0…1. */
	const countBadness = (col: number, v: number) => {
		const vals = CFG.filter((k) => !isOff(ui.scope, k.id)).map((k) => cov(k.id,ui.scope)[col]);
		const lo = Math.min(...vals);
		const hi = Math.max(...vals);
		const t = hi > lo ? (v - lo) / (hi - lo) : 0;
		return col === 0 ? 1 - t : t;
	};

	const callWorkloads = CALL_PATHS.map(p=>p.id);
	function opsRate(milliseconds: number) {
		const rate = 1000 / milliseconds;
		if (rate >= 1e9) return (rate / 1e9).toFixed(1) + 'b';
		if (rate >= 1e6) return (rate / 1e6).toFixed(1) + 'm';
		if (rate >= 1e3) return (rate / 1e3).toFixed(1) + 'k';
		return rate.toFixed(1);
	}
	const peakMemoryPoints = [
		'Arithmetic mean of available workload-phase peaks: compile, instantiate, first call, steady',
		'Kernel-reported process-lifetime peak RSS is collected at process exit',
		'This is an average of measured peaks; time-averaged process RSS is not collected',
		'Equal weight per measurement; shared pages count per process',
		'Transpiler compile peak uses max(transpiler, compiler)'
	];
	const peakMemoryNote = 'Kernel-reported process-lifetime peak RSS, collected at process exit. The average column is the arithmetic mean of available phase peaks; time-averaged RSS is not collected.';
	const callCells = $derived.by(() => {
		const configs = CFG.filter((c) => isVisible(ui.scope, c));
		const raw = callWorkloads.map((workload) => configs.map((config) => viewCell(ui.machine, ui.snap, workload, config.id, 'steady')));
		const baselines = callWorkloads.map(workload => viewCell(ui.machine, ui.snap, workload, ui.baseline, 'steady'));
		const total=(cells:typeof baselines)=>cells.every(c=>c.st==='ok'&&c.v!=null)?{st:'ok' as const,v:cells.reduce((sum,c)=>sum+c.v!,0),report:''}:{st:'nm' as const,report:''};
		raw.push(configs.map((_,index)=>total(raw.slice(0,2).map(cells=>cells[index]))));
		baselines.push(total(baselines.slice(0,2)));
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
                const absolute=absOf(s,grp,c.id,sourceIndex);
				if (!absolute) {
					const codeCells=Object.entries(viewData.hosts[s.machine].snapshots.s1).filter(([key])=>key.endsWith(`|${c.id}|code`));
                    const interpreter=grp==='code'&&(/interpreter/.test(viewData.hosts[s.machine].configurations[c.id]?.backend||'')||(codeCells.length>0&&codeCells.every(([,cell])=>cell.st==='unsupported')));
					const metric=grp==='mem'&&i===3?'rssAverage':g.metrics[i];
					const key=aggregateKey(s,metric);
					const status=apiView.aggregateErrors[key]?'unavailable':!apiView.aggregates[key]&&datasetView.revision?'loading…':'not measured';
					return { text: interpreter?'n/a':disp(s,grp,c.id,sourceIndex)?.t || (off?'unavailable':ui.cohortMode==='shared'&&grp==='lat'?'No shared corpus':status), bg:'transparent',color:'var(--fg3)' };
				}
				return { text: commonTimes?.[i] || disp(s, grp, c.id, sourceIndex)!.t, bg: heatRatio(r?.r ?? null), color: 'var(--fg)' };
			});
			return {
				c,
				cells,
				covShort: off ? '—' : n0(cv[0]) + ' / ' + totalWorkloads(),
				covBg: off ? 'transparent' : heatCount(countBadness(0, cv[0]))
			};
		});
	});

	const comparisonErrors=$derived(Object.entries(apiView.aggregateErrors).filter(([key])=>g.metrics.some(metric=>key===aggregateKey(ui.scope,metric))||ui.group==='mem'&&key===aggregateKey(ui.scope,'rssAverage')).map(([,reason])=>reason));
 const interpretation=$derived(apiView.aggregates[aggregateKey(ui.scope,ui.group==='code'?'code':ui.group==='mem'?'rss':g.metrics[0])]?.interpretation);
	const snapTaken = 'Latest snapshot per engine';
	const snapAgo = $derived(ui.group === 'calls' ? '2 measured call workloads' : ui.group==='code'&&ui.cohortMode==='shared'?`${sharedCount(ui.scope,'code',3)} shared contracts across engines with native code` : ui.cohortMode==='shared'?`${sharedCount(ui.scope)} shared successful contracts in the latency cohort`:'Successful contracts per engine; populations can differ');
</script>

<div class="stack">
	<Tabs options={KEYS.map((k) => [k, OV[k].label])} value={ui.group} onselect={(k) => (ui.group = k)} />
	<Carousel title={g.label} sub="{gi + 1} / {KEYS.length} · {SHARED_NOTE[ui.group]}" onprev={() => step(-1)} onnext={() => step(1)}>
		<div class="snap">
			<span
				class="mono taken"
				data-tip-card={tipCard({ title: snapTaken, points: ['All metrics use the same latest source snapshot for each engine', 'Missing cells are not filled from older versions'], note: 'Older snapshots appear in History.' })}
				>{snapTaken}</span
			>
			<span class="small fg3">{snapAgo}</span>
		</div>
	</Carousel>
 {#if ui.group==='lat'&&ui.cohortMode==='shared'&&g.metrics.some((_,i)=>sharedCount(ui.scope,'lat',i)===0)}<p class="small fg3">Some phases have no corpus that passed on every selected engine. <button class="link-quiet" onclick={()=>ui.cohortMode='per-engine'}>Show averages of workloads passed per engine</button></p>{/if}
	{#if comparisonErrors.length}<p class="small fg3" role="status">Comparison unavailable: {comparisonErrors.join(" · ")}</p>{/if}
 {#if interpretation}<p class="small fg3">{interpretation.population} {interpretation.reports} {interpretation.weighting} Intervals: {interpretation.uncertainty}.</p>{/if}
	<div class="tbl-wrap">
		<table class="mx" style:min-width="720px">
			<thead>
				<tr>
					<th class="stick th-label">Runtime</th>
					{#each g.cols as label, i (label)}
						<th class="colh">
							<button onclick={() => onmetric(g.metrics[i])} data-tip-card={tipCard(ui.group === 'mem' && i === 3 ? { title: label, points: peakMemoryPoints, action: `open the per-benchmark ${label} matrix` } : ui.group === 'calls' ? { title: label, note: (CALL_PATHS[i]?.note || 'Sum of both measured call directions.'), action: `open the per-benchmark ${label} matrix` } : { title: label, action: `open the per-benchmark ${label} matrix` })}>{label}</button>
						</th>
					{/each}
					<th class="colh">Correct</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.c.id)}
					<tr>
						<td class="stick rtcell"><RtLabel c={r.c} profile mono bold ver /></td>
						{#each r.cells as x, i (i)}
							<td class="p0">
								<button
									class="cellbtn mono val"
									style:background={x.bg}
									style:color={x.color}
									onclick={() => onmetric(g.metrics[i])}
									data-tip-card={tipCard({ kicker: `${g.label} · ${g.cols[i]}`, who: tipWho(r.c), value: x.text, valueColor: x.color === 'var(--fg)' ? '' : x.color, heat: x.bg === 'transparent' ? '' : x.bg, stats: 'rate' in x && x.rate ? [['throughput', x.rate.replace(' · reciprocal of latency', '')]] : [], points: ui.group === 'mem' && i === 3 ? peakMemoryPoints : [], note: ui.group === 'calls' ? (CALL_PATHS[i]?.note || 'Sum of both measured call directions.') : '', action: 'see per-workload results' })}>{x.text}</button
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
	@media (max-width: 720px) {
		.snap {
			margin-left: 0;
			padding-left: 0;
			border-left: 0;
			width: 100%;
			justify-content: center;
			gap: 2px 8px;
		}
		.rtcell,
		.val,
		.corr,
		.colh {
			padding: 4px 10px;
		}
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
