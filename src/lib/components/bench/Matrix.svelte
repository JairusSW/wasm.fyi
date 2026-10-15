<script lang="ts">
import {apiView,aggregateKey,trackId} from '$lib/api/controller.svelte';
import StatusLegend from '../StatusLegend.svelte';
import {ST,ST_DESC} from '$lib/data/status';
import {datasetView} from '$lib/api/view.svelte';
 import { rankRows, tipCard, tipWho } from '$lib/tip';
import { CALL_PATHS } from '$lib/call-paths';
import { CFG } from '$lib/data/runtimes';
	import { OV, UNIT } from '$lib/data/snapshot';
	import type { MetricKey, OvKey } from '$lib/data/types';
	import { fmtU, fmtUGroup, n0 } from '$lib/format';
	import { heatCount, heatField, heatFields, heatCorrectness } from '$lib/heat';
	import { totalWorkloads, correctnessWorkloads, sharedCount, cov, absOf, disp, isOff, isVisible, compileExcluded } from '$lib/model';
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
		code: 'Shared code-size comparisons include engines with available native code; other engines show · (not applicable).',
		cov: `All ${totalWorkloads()} measured contracts.`
	};

	const correctnessTotal=$derived(correctnessWorkloads(ui.scope).length);
	const coverageCounts=$derived(new Map(CFG.filter(c=>isVisible(ui.scope,c)).map(c=>[c.id,cov(c.id,ui.scope)])));
	/** Badness of a count within its column across runtimes available on this machine, 0…1. */
	const countBadness = (col: number, v: number) => {
		const vals = [...coverageCounts.values()].map(counts=>counts[col]);
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
		const total=(cells:(typeof raw)[number])=>cells.every(c=>c.st==='ok'&&c.v!=null)?{st:'ok' as const,v:cells.reduce((sum,c)=>sum+c.v!,0),report:''}:{st:'nm' as const,report:''};
		raw.push(configs.map((_,index)=>total(raw.slice(0,2).map(cells=>cells[index]))));
		const values = raw.flatMap(cells => cells.map(cell => cell.st === 'ok' ? cell.v ?? null : null));
		const formatted = fmtUGroup(values, 'ms');
		return new Map(configs.map((config, configIndex) => [config.id, raw.map((cells, directionIndex) => {
			const cell = cells[configIndex];
			if (cell.st !== 'ok' || cell.v == null) return {text: ST[cell.st][1], bg: 'transparent', color: ST[cell.st][2]};
			return {text: formatted[directionIndex * configs.length + configIndex] || '—', rate: cell.v > 0 ? `${opsRate(cell.v)} ops/s · reciprocal of latency` : '', bg: heatField(values.slice(directionIndex * configs.length, (directionIndex + 1) * configs.length), configIndex), color: 'var(--fg)'};
		})]));
	});

	// Each aggregate column's values across the shown runtimes, for heat, place and column leader.
	const columns = $derived.by(() => {
		if (ui.group !== 'lat' && ui.group !== 'mem' && ui.group !== 'code') return null;
		const s = ui.scope;
		const grp = ui.group;
		const cfgs = CFG.filter((c) => isVisible(s, c));
		return g.cols.map((_, i) => ({ cfgs, vals: cfgs.map((c) => (compileExcluded(s, c, g.metrics[i]) ? null : (absOf(s, grp, c.id, grp === 'code' ? i + 3 : i)?.v ?? null))) }));
	});
	// Tooltip place and column leader for each aggregate cell, keyed by column then config id.
	const ranks = $derived.by(() => {
		if (!columns) return null;
		const grp = ui.group as 'lat' | 'mem' | 'code';
		return columns.map(({ cfgs, vals }) => {
			const names = cfgs.map((c) => `${c.rt} ${c.be}`);
			const ranks=rankRows(vals,names,v=>fmtU(v,UNIT[grp]),grp==='lat'?'fastest':'smallest');
 return new Map(cfgs.map((c,k)=>[c.id,ranks[k]]));
		});
	});
	const heatColumns=$derived(columns?.map(col=>{const colors=heatFields(col.vals);return new Map(col.cfgs.map((c,k)=>[c.id,colors[k]]))}));
 const heatOf=(i:number,cid:(typeof CFG)[number]['id'])=>heatColumns?.[i]?.get(cid)||'transparent';

	// End-to-end on the Latency tab: compile + instantiate + first call + one steady call,
	// the sum of the four phase aggregates shown in the row. Missing or excluded phases give no total.
	const phaseSum = (s: typeof ui.scope, c: (typeof CFG)[number], indices:number[]) => {
		const parts = indices.map(i => (compileExcluded(s, c, g.metrics[i]) ? null : (absOf(s, 'lat', c.id, i)?.v ?? null)));
		return parts.every((v) => v != null) ? { total: (parts as number[]).reduce((a, b) => a + b, 0), parts: parts as number[] } : null;
	};
	const combinedColumn = (indices:number[]) => {
		if (ui.group !== 'lat') return null;
		const s = ui.scope;
		const cfgs = CFG.filter((c) => isVisible(s, c));
		const totals = cfgs.map((c) => phaseSum(s, c, indices));
		const names = cfgs.map((c) => `${c.rt} ${c.be}`);
		const values = totals.map((t) => t?.total ?? null);
		const formatted = fmtUGroup(values, 'ms');
 const colors=heatFields(values),ranks=rankRows(values,names,v=>fmtU(v,'ms'));
		return new Map(cfgs.map((c, k) => {
			const t = totals[k];
			return [c.id, t
				? { text: '~' + formatted[k], bg: colors[k], color: 'var(--fg)', stats: [...ranks[k], ...indices.map((phase,i): [string, string] => [g.cols[phase].toLowerCase(), fmtU(t.parts[i], 'ms')])] }
				: { text: '—', bg: 'transparent', color: 'var(--fg3)', stats: [] as [string, string][] }];
		}));
	};
 const startup=$derived(combinedColumn([0,1]));
 const e2e=$derived(combinedColumn([0,1,2,3]));
	// Latency, memory and code cells open the aggregate side panel; others keep switching the table.
	const openCell = (cid: (typeof CFG)[number]['id'], i: number) => {
		if (ui.group === 'lat' || ui.group === 'mem' || ui.group === 'code') ui.drawer = { type: 'aggregate', c: cid, group: ui.group, col: ui.group === 'code' ? i + 3 : i };
		else onmetric(g.metrics[i]);
	};

	const rows = $derived.by(() => {
		const s = ui.scope;
		return CFG.filter((c) => isVisible(s, c)).map((c) => {
			const off = isOff(s, c.id);
			const cv = coverageCounts.get(c.id)||[0,0,0,0,0];
			const commonTimes=ui.group==='lat'?fmtUGroup(g.metrics.map((_,i)=>absOf(s,'lat',c.id,i)?.v ?? null),'ms'):null;
			const cells = g.cols.map((_, i) => {
				if (ui.group === 'calls') return callCells.get(c.id)?.[i] || {text:'—',bg:'transparent',color:'var(--fg3)'};
				if (ui.group === 'cov') {
					const v = cv[i];
					if (off) return { text: '—', bg: 'transparent', color: 'var(--fg3)' };
					return {
						text: n0(v),
						bg: i===0?heatCorrectness(v,correctnessTotal):v===0?'transparent':heatCount(countBadness(i,v)),
						color: v || i === 0 ? 'var(--fg)' : 'var(--fg3)'
					};
				}
				const grp = ui.group as 'lat' | 'mem' | 'code';
				const sourceIndex = grp === 'code' ? i + 3 : i;
				if ((grp === 'lat' || grp === 'mem') && compileExcluded(s, c, g.metrics[i])) return { text: ST.na[0], note:ST_DESC.na, bg: 'transparent', color: 'var(--fg3)' };
                const absolute=absOf(s,grp,c.id,sourceIndex);
				if (!absolute) {
					const interpreter=grp==='code'&&/interpreter/.test(viewData.hosts[s.machine].configurations[c.id]?.backend||'');
					const metric=grp==='mem'&&i===3?'rssAverage':g.metrics[i];
					const key=aggregateKey(s,metric);
					const timingReason=apiView.precomputed[key]?.cards.find(card=>card.engine===trackId(c.id))?.unavailableReason;
					const loading=!apiView.aggregateErrors[key]&&(apiView.serverAggregates?!apiView.precomputed[key]:!apiView.aggregates[key]&&!!datasetView.revision);
     const note=interpreter?ST_DESC.na:timingReason==='timer-resolution'?'Unavailable: retained samples are all zero at the recorded timer resolution; a positive geometric mean cannot be calculated.':timingReason==='incomplete-reference'?'Unavailable: this configuration has no usable measurement for every workload in the selected reference set.':apiView.aggregateErrors[key]||ST_DESC.unavail;
     return {text:interpreter?ST.na[0]:loading?'loading…':ST.unavail[0],note,bg:'transparent',color:'var(--fg3)'};
				}
				return { text: commonTimes?.[i] ? '~'+commonTimes[i] : disp(s, grp, c.id, sourceIndex)!.t, bg: heatOf(i, c.id), color: 'var(--fg)' };
			});
			return {
				c,
				cells,
				covShort: off ? '—' : n0(cv[0]) + ' / ' + correctnessTotal,
				covBg: off ? 'transparent' : heatCorrectness(cv[0],correctnessTotal)
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
      {#if startup && i===1}<th class="colh"><span data-tip-card={tipCard({title:'Startup latency',note:'Compilation + instantiation: the sum of this row’s two phase averages. Shown only when both phases are measured.'})}>Startup latency</span></th>{/if}
					{/each}
					{#if e2e}
						<th class="colh"><span data-tip-card={tipCard({ title: 'End-to-end', note: 'Compilation + instantiation + first call + one steady call: the sum of this row’s phase averages. Shown only when every phase is measured.' })}>End-to-end</span></th>
					{/if}
					<th class="colh">Correct</th>
				</tr>
			</thead>
			<tbody aria-busy={!apiView.ready}>
				{#if !apiView.ready}
					{#each [62, 48, 70, 55, 66, 44, 58, 50] as w (w)}
						<tr aria-hidden="true">
							<td class="stick rtcell"><span class="skel" style:width="0.6em"></span> <span class="skel" style:width="{w * 1.6}px"></span></td>
							{#each { length: g.cols.length + (e2e ? 2 : 1) + (startup ? 1 : 0) } as _, i (i)}
								<td class="r val-skel"><span class="skel" style:width="{36 + ((w + i * 17) % 30)}px"></span></td>
							{/each}
						</tr>
					{/each}
				{/if}
				{#each rows as r (r.c.id)}
					<tr>
						<td class="stick rtcell"><RtLabel c={r.c} profile mono bold ver /></td>
						{#each r.cells as x, i (i)}
							<td class="p0" style:background={x.bg}>
								<button
									class="cellbtn mono val"
									style:color={x.color}
									onclick={() => openCell(r.c.id, i)}
									data-tip-card={x.text === 'loading…' ? undefined : tipCard({ kicker: `${g.label} · ${g.cols[i]}`, who: tipWho(r.c), value: x.text, valueColor: x.color === 'var(--fg)' ? '' : x.color, heat: x.bg === 'transparent' ? '' : x.bg, stats: [...(ranks?.[i]?.get(r.c.id) ?? []), ...('rate' in x && x.rate ? [['throughput', x.rate.replace(' · reciprocal of latency', '')] as [string, string]] : [])], points: ui.group === 'mem' && i === 3 ? peakMemoryPoints : [], note: 'note' in x ? x.note : ui.group === 'calls' ? (CALL_PATHS[i]?.note || 'Sum of both measured call directions.') : '', action: ui.group === 'calls' || ui.group === 'cov' ? 'see per-workload results' : 'rank, spread & workloads' })}>{#if x.text === 'loading…'}<span class="skel" aria-label="loading"></span>{:else}{x.text}{/if}</button
								>
							</td>
       {#if startup && i===1}
        {@const start=startup.get(r.c.id)??{text:'—',bg:'transparent',color:'var(--fg3)',stats:[]}}
        <td class="p0" style:background={start.bg}>
         <button class="cellbtn mono val" style:color={start.color} aria-label={`Startup latency for ${r.c.rt} ${r.c.be}`} onclick={()=>ui.drawer={type:'aggregate',c:r.c.id,group:'lat',col:-2}} data-tip-card={tipCard({kicker:'Latency · Startup latency',who:tipWho(r.c),value:start.text,heat:start.bg==='transparent'?'':start.bg,stats:start.stats,note:`Sum of the compilation and instantiation phase averages (${ui.average==='mean'?'means':'geometric means'}).`,action:'rank, spread & workloads'})}>{start.text}</button>
        </td>
       {/if}
						{/each}
						{#if e2e}
							{@const x = e2e.get(r.c.id) ?? { text: '—', bg: 'transparent', color: 'var(--fg3)', stats: [] }}
							<td class="p0 e2e" style:background={x.bg}>
								<button class="cellbtn mono val" style:color={x.color} onclick={() => (ui.drawer = { type: 'aggregate', c: r.c.id, group: 'lat', col: -1 })} data-tip-card={tipCard({ kicker: 'Latency · End-to-end', who: tipWho(r.c), value: x.text, heat: x.bg === 'transparent' ? '' : x.bg, stats: x.stats, note: `Sum of the four phase averages (${ui.average === 'mean' ? 'means' : 'geometric means'}), not a per-workload total.`, action: 'rank, spread & workloads' })}>{x.text}</button>
							</td>
						{/if}
						<td class="mono r corr" style:background={r.covBg}>{r.covShort}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
 <StatusLegend />
</div>

<style>
	.e2e {
		border-left: 1px solid var(--line2);
	}
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
		padding: 5px 12px;
		font-size: 12px;
	}
	.colh button {
		font-weight: 500;
	}
	.rtcell {
		padding: 4px 12px;
		white-space: nowrap;
	}
	.p0 {
		padding: 0;
	}
	.val {
		padding: 4px 12px;
	}
	.corr {
		padding: 4px 12px;
		font-size: 12px;
	}
	.val-skel {
		padding: 6px 12px;
	}
</style>
