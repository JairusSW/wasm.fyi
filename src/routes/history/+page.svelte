<script lang="ts">
	import VersionLink from '$lib/components/VersionLink.svelte';
	import {CALL_PATHS} from '$lib/call-paths';
	import {apiHistory,historyKey} from '$lib/api/history.svelte';
 import {loadHistoryReport} from '$lib/api/controller.svelte';
 import {datasetView} from '$lib/api/view.svelte';
 import {presentResult} from '$lib/api/presentation';
 import HistoryWindow from '$lib/components/HistoryWindow.svelte';
 import Carousel from '$lib/components/Carousel.svelte';
	import Seg from '$lib/components/Seg.svelte';
	import Swatch from '$lib/components/Swatch.svelte';
	import Tabs from '$lib/components/Tabs.svelte';
	import { CB, CFG } from '$lib/data/runtimes';
	import { ALLB, EVENTS, HARNESS_BREAK, MET, OTM, OTM_KEYS, SNAPS, verAt } from '$lib/data/snapshot';
	import type { CfgId, MetricKey } from '$lib/data/types';
	import { fmtU, n0, pc, pct, relative, workloadName } from '$lib/format';
	import { benchVal, otSeries } from '$lib/model';
	import { ui } from '$lib/state.svelte';
import { viewData } from '$lib/view-data';
import { historyCell, historyChange, historySegments, historyCurve, historicalCallWorkloads, historyPointInfo, historyVersionChanges, historyCoverage, historyComparison, historyCohort, historyEndpoints, historyVerdict, type HistoryVerdict } from '$lib/history-values';
import HistoryMarker from '$lib/components/HistoryMarker.svelte';
import { onscreen } from '$lib/onscreen';
import { RangeSelect } from '$lib/range-select.svelte';
import { tipCard, tipWho } from '$lib/tip';
import TipDelta from '$lib/components/TipDelta.svelte';
import TipCoverage from '$lib/components/TipCoverage.svelte';
import TipCalls from '$lib/components/TipCalls.svelte';

	const W = 860;
	const HC = 280;
	const pl = 46;
	const pr = 16;
	const pt = 38;
	const pb = 26;
	const X = (i: number) => pl + (i * (W - pl - pr)) / Math.max(1,SNAPS.length-1);
	const STEP = $derived((W - pl - pr) / Math.max(1,SNAPS.length-1));
	const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const NOTE = {
		callTotal: 'Sum of Wasm → host → Wasm and Host → Wasm → host; both directions must be measured.',
		exec: 'shared non-feature reference cohort · steady execution per invocation',
		hostWasm: CALL_PATHS[1].note,
		wasmHostLoop: CALL_PATHS[0].note,
		compile: 'module compile time',
		inst: 'instantiation time',
		mem: 'process lifetime peak RSS',
		code: 'extracted native image size',
		cov: 'correct contracts in the fixed historical corpus · higher is better'
	};

	let hover = $state<number | null>(null);

	// Touch scrubbing: a horizontal drag across the chart moves the hover point.
	function scrub(e: PointerEvent) {
		if (e.pointerType === 'mouse') return;
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = ((e.clientX - r.left) / r.width) * W;
		hover = Math.max(0, Math.min(SNAPS.length - 1, Math.round((x - pl) / STEP)));
	}
	function endScrub(e: PointerEvent) {
		if (e.pointerType !== 'mouse') hover = null;
	}
	// Drag, or click then shift+click, to select the report range.
	const range = new RangeSelect(
		(fx) => Math.max(0, Math.min(SNAPS.length - 1, Math.round((fx * W - pl) / STEP))),
		(from, to) => {
			ui.histFrom = from;
			ui.histTo = to;
		}
	);
	const oi = $derived(OTM_KEYS.indexOf(ui.otMetric));
	const step = (d: number) => (ui.otMetric = OTM_KEYS[(oi + d + OTM_KEYS.length) % OTM_KEYS.length]);

	const M = $derived(OTM[ui.otMetric]);
	const isCov = $derived(M.g === 'cov');
	const SER = $derived(Object.fromEntries(CFG.map((c) => [c.id, otSeries(ui.scope, c.id, M.key)])) as Record<CfgId, number[] | null>);
	const val = (id: CfgId, i: number) => {
		const s = SER[id]!;
		const first=s.find(Number.isFinite)!;
		return ui.histMode === 'ratio' ? s[i] : isCov ? (s[i] - first) / viewData.history[ui.machine].workloads.length : (historyComparison(ui.scope,id,M.key,s.findIndex(Number.isFinite),i)?.ratio??NaN)-1;
	};
	const plotC = $derived(CFG.filter((c) => !ui.scope.hide[c.id] && SER[c.id]));
	const fmtV = (v: number) => (isCov ? n0(v) : fmtU(v, M.u));

	const scale = $derived.by(() => {
		const allV = plotC.flatMap((c) => SNAPS.map((p) => val(c.id, p.i))).filter(Number.isFinite);
		if (!allV.length) allV.push(1);
		const ticks: { y: string; t: string; label: string }[] = [];
		let Y: (v: number) => number;
		if (ui.histMode === 'ratio') {
			const lo = Math.log(Math.min(...allV) * 0.85);
			const hi = Math.log(Math.max(...allV) * 1.15);
			Y = (v) => pt + (1 - (Math.log(v) - lo) / (hi - lo)) * (HC - pt - pb);
			const cand: number[] = [];
			for (let e = Math.floor(lo / Math.LN10) - 1; e <= Math.ceil(hi / Math.LN10); e++)
				[1, 2, 5].forEach((m) => cand.push(m * Math.pow(10, e)));
			let tk = cand.filter((v) => Math.log(v) > lo && Math.log(v) < hi);
			if (tk.length < 3) {
				const a = Math.exp(lo);
				const b = Math.exp(hi);
				tk = [1, 2, 3, 4].map((k) => a + ((b - a) * k) / 5);
			}
			tk.forEach((v) => ticks.push({ y: Y(v).toFixed(1), t: pc(Y(v), HC), label: fmtV(v) }));
		} else {
			const lo = Math.min(...allV) - 0.01;
			const hi = Math.max(...allV) + 0.01;
			Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (HC - pt - pb);
			for (let v = Math.ceil(lo * 50) / 50; v <= hi; v += 0.02) ticks.push({ y: Y(v).toFixed(1), t: pc(Y(v), HC), label: isCov ? pct(v, 0) : relative(1+v,ui.deltaFormat) });
		}
		return { Y, ticks };
	});

	const lines = $derived(
		plotC.map((c) => {
			const sel = c.id === ui.histCfg;
			const Y = scale.Y;
			const versions=new Set(historyVersionChanges(viewData.history[ui.machine].versions[c.id] || [],SNAPS.map(p=>val(c.id,p.i)),new Set(viewData.history[ui.machine].points.flatMap((p,i)=>p.releases?.[c.id]?[i]:[]))));
			return {
				c,
				sel,
				width: sel ? 2.2 : 1.2,
				op: sel ? 1 : 0.7,
                points: SNAPS.filter(p=>Number.isFinite(val(c.id,p.i))).map(p=>({i:p.i,x:X(p.i),y:Y(val(c.id,p.i)),version:versions.has(p.i)?verAt(c.id,p.i,ui.machine):'',partial:!historyCoverage(ui.scope,c.id,M.key,p.i).complete})),
                segs:historySegments(SNAPS.map(p=>val(c.id,p.i)),X,Y,true),
				bumps: SNAPS.filter((p) => versions.has(p.i)).map((p) => {
					const x = X(p.i);
					const y = Y(val(c.id, p.i));
					return { i: p.i, tf: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(45)`, bl: pc(x, W), bt: (((y - 8) / HC) * 100).toFixed(2) + '%', ver: verAt(c.id, p.i,ui.machine) };
				})
			};
		})
	);

	const events = $derived(EVENTS.map((e) => ({
		x: X(e.i).toFixed(1),
		dash: e.kind === 'harness' ? 'none' : e.kind === 'corpus' ? '1 3' : '3 3',
		stroke: e.kind === 'harness' ? 'var(--fg2)' : 'var(--fg3)'
	})));
	const hits = $derived(SNAPS.map((p) => ({
		i: p.i,
		x: (X(p.i) - STEP / 2).toFixed(1),
		label: MON[+p.date.slice(5, 7) - 1] + (p.i === 0 ? ' ' + p.date.slice(0, 4) : ''),
		l: pc(X(p.i), W),
		show: p.i === 0 || p.date.slice(5, 7) !== SNAPS[p.i - 1]?.date.slice(5, 7)
	})));

	const tip = $derived.by(() => {
		const hi = hover;
		if (hi == null || !plotC.length) return null;
		const fmtH = (id: CfgId, i: number) => (ui.histMode === 'ratio' ? fmtV(val(id, i)) : isCov ? pct(val(id, i)) : relative(1+val(id,i),ui.deltaFormat));
		const rows = plotC.filter(c=>Number.isFinite(SER[c.id]![hi]) && Number.isFinite(val(c.id,hi)))
			.map((c) => {
				const s = SER[c.id]!;
				const v = s[hi];
				const previous=s.findLastIndex((v,i)=>i<hi&&Number.isFinite(v));
				const comparison=historyComparison(ui.scope,c.id,M.key,previous,hi);
				const d = !comparison ? null : isCov ? comparison.after-comparison.before : comparison.ratio-1;
				const good = d == null ? null : isCov ? d > 0 : d < 0;
				const flat = d == null || (isCov ? d === 0 : Math.abs(d) < 0.02);
				return {
					c,
					raw: ui.histMode === 'ratio' ? (isCov ? -v : v) : val(c.id, hi),
					mag: val(c.id, hi),
					value: fmtH(c.id, hi),
					info: historyPointInfo(ui.scope,c.id,M.key,hi),
					ver: verAt(c.id, hi,ui.machine),
					release: historyVersionChanges(viewData.history[ui.machine].versions[c.id]||[],s).includes(hi),
					d: flat ? 0 : d,
					delta: d == null ? '—' : isCov ? (d >= 0 ? '+' : '−') + Math.abs(d) : relative(1+d,ui.deltaFormat),
					dColor: flat ? 'var(--fg3)' : good ? 'var(--good)' : 'var(--bad)',
					sel: c.id === ui.histCfg,
					y: scale.Y(val(c.id, hi)).toFixed(1),
					r: c.id === ui.histCfg ? 4.5 : 3.5
				};
			})
			.sort((a, b) => a.raw - b.raw);
		// Magnitude bars: proportional in value mode, diverging around zero in change mode.
		const diverging = ui.histMode !== 'ratio';
		const top = Math.max(...rows.map((r) => Math.abs(r.mag)), 1e-12);
		const bars = rows.map((r) => {
			const w = (Math.abs(r.mag) / top) * (diverging ? 50 : 100);
			return { left: (diverging ? (r.mag < 0 ? 50 - w : 50) : 0) + '%', width: Math.max(w, 2) + '%' };
		});
		const archived = rows.filter((r) => r.info.archived).length;
		const notes = [
			historicalCallWorkloads(M.key).length ? M.key==='callTotal'?'sum of both recorded call directions':'recorded median per call path' : isCov ? '' : `geomean · ${ui.scope.weighting} weighting`,
			'Δ vs previous matched point',
			archived ? (archived === rows.length ? 'archived capture' : `${archived}/${rows.length} archived`) : ''
		].filter(Boolean);
		return {
			diverging,
			bars,
			notes,
			x: X(hi).toFixed(1),
			l: pc(X(hi), W),
			tf: hi > 8 ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)',
			date: 'snap-' + SNAPS[hi]?.date,
			ev: EVENTS.filter((e) => e.i === hi).map((e) => e.label),
			rows
		};
	});


	// Change report for the selected runtime over [from, to]. Endpoints snap
	// inward to the nearest measured points so sparse weekly series still report.
	const rep = $derived.by(() => {
		const s = ui.scope;
		const cid = ui.histCfg;
		const c = CB[cid];
		const RM = ({ exec: 'steady', callTotal: 'steady', hostWasm: 'steady', wasmHostLoop: 'steady', compile: 'compile', inst: 'inst', mem: 'rss', code: 'code', cov: 'steady' } as const)[M.key] as MetricKey;
		const key = isCov ? 'exec' : M.key;
		const EX = SER[cid] && !isCov ? SER[cid] : otSeries(s, cid, 'exec');
		const ends = historyEndpoints(EX, ui.histFrom, ui.histTo);
		const [f, t] = ends ?? [ui.histFrom, ui.histTo];
		const snapped = !!ends && (f !== ui.histFrom || t !== ui.histTo);
		const matched = ends ? historyComparison(s, cid, key, f, t) : null;
		const dt = matched?.ratio ?? NaN;
        if(datasetView.revision){
         const beforeDate=SNAPS[f]?.date,afterDate=SNAPS[t]?.date;const ready=apiHistory.reportKey===JSON.stringify([historyKey(s,key),cid,beforeDate,afterDate]);const report=ready?apiHistory.report:null;
         const colors:Record<string,string>={improved:'var(--good)',regressed:'var(--bad)','no practical change':'var(--fg3)','reused evidence':'var(--fg3)'};
         const rows=(report?.workloads||[]).map(row=>{const a=presentResult(row.before),b=presentResult(row.after);const verdict:HistoryVerdict=row.reused?'reused evidence':row.ratio<0.98?'improved':row.ratio>1.02?'regressed':'no practical change';return {name:workloadName(row.workload),group:row.group,tip:'',before:a.v==null?'unavailable':fmtU(a.v,MET[RM].u),after:b.v==null?'unavailable':fmtU(b.v,MET[RM].u),d:row.ratio-1,delta:relative(row.ratio,ui.deltaFormat),ci:row.reused?'not applicable':'unavailable',verdict,estimate:!row.reused,vColor:colors[verdict]}});
         return {c,empty:!ends,title:`${c.rt} ${c.be}: ${verAt(cid,f,ui.machine)} → ${verAt(cid,t,ui.machine)}`,range:`${beforeDate||'unavailable'} → ${afterDate||'unavailable'}`,snapped,estimates:rows.filter(r=>r.estimate).length,spans:false,rows,moreN:report?`${report.total} matched workloads`:'Loading matched workload report',sums:['improved','regressed','no practical change','reused evidence'].map(k=>({k,v:report?.summaryCounts[k]||0,c:colors[k]})),other:[{k:`Matched geomean (${matched?.count||0} workloads)`,v:matched?relative(matched.ratio,ui.deltaFormat):'unavailable'},{k:'Policy',v:'Exact contracts and compatible recorded contexts; reused observations keep their identities.'},{k:'Uncertainty',v:'Comparison interval unavailable.'}]};
        }
		const callIds = historicalCallWorkloads(M.key);
		// Rows use the same matched cohort as the headline geomean.
		const cohort = callIds.length ? new Set(callIds) : (() => { const after = new Set(historyCohort(s, cid, key, t)); return new Set(historyCohort(s, cid, key, f).filter((w) => after.has(w))); })();
		const colors: Record<HistoryVerdict, string> = { regressed: 'var(--bad)', improved: 'var(--good)', inconclusive: 'var(--fg2)', 'no practical change': 'var(--fg3)', 'reused evidence': 'var(--fg3)' };
		const directionRows = !ends ? [] : ALLB.filter((b) => cohort.has(b.id)).map((b) => {
			const before = historyCell(s.machine, b.id, cid, RM, f), after = historyCell(s.machine, b.id, cid, RM, t);
			const change = historyChange(before, after);
			if (!change) return null;
			const { verdict, estimate } = historyVerdict(change);
			const interval = change.interval;
			return { name: workloadName(b.id), group: b.group, tip: '', before: fmtU(before.v!, MET[RM].u), after: fmtU(after.v!, MET[RM].u), d: change.delta, delta: relative(1 + change.delta, ui.deltaFormat), ci: change.fixed ? 'not applicable' : interval ? `${relative(1 + interval[0], ui.deltaFormat)} – ${relative(1 + interval[1], ui.deltaFormat)}` : 'single launch', verdict, estimate, vColor: colors[verdict] };
		}).filter((x) => x != null).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
		const rows = directionRows;
		const cnt = (v: HistoryVerdict) => rows.filter((r) => r.verdict === v).length;
		const estimates = rows.filter((r) => r.estimate).length;
		const cv = otSeries(s, cid, 'cov');
		const covText = (() => {
			if (!cv || !Number.isFinite(cv[f]) || !Number.isFinite(cv[t])) return 'not collected';
			const dd = cv[t] - cv[f];
			return dd ? (dd > 0 ? '+' : '−') + Math.abs(dd) + ' correct workloads (' + n0(cv[t]) + ' / '+viewData.history[s.machine].workloads.length+')' : 'unchanged (' + n0(cv[t]) + ' / '+viewData.history[s.machine].workloads.length+')';
		})();
		return {
			c,
			empty: !ends,
			title: `${c.rt} ${c.be}: ${verAt(cid, f,ui.machine)} → ${verAt(cid, t,ui.machine)}`,
			range: `snap-${SNAPS[f]?.date} → snap-${SNAPS[t]?.date}`,
			snapped,
			estimates,
			spans: f < HARNESS_BREAK && t >= HARNESS_BREAK,
			rows: rows.slice(0, 14),
			moreN: rows.length > 14 ? `${rows.length - 14} more workloads in the full report` : '',
			sums: [
				{ k: 'Improved', v: cnt('improved'), c: 'var(--good)' },
				{ k: 'Regressed', v: cnt('regressed'), c: 'var(--bad)' },
				{ k: 'Inconclusive', v: cnt('inconclusive'), c: 'var(--fg)' },
				{ k: 'No practical change', v: cnt('no practical change'), c: 'var(--fg3)' },
				...(cnt('reused evidence') ? [{ k: 'Reused evidence', v: cnt('reused evidence'), c: 'var(--fg3)' }] : [])
			],
			other: [
				{ k: historicalCallWorkloads(M.key).length?M.l:`Matched geomean (${matched?.count??0} workloads)`, v: Number.isFinite(dt) && (SER[cid] || isCov) ? relative(dt,ui.deltaFormat) : 'not measured' },
				{ k: 'Coverage', v: covText },
				{ k: 'Process lifetime peak RSS', v: 'See recorded memory series; no inferred phase delta' },
				{ k: 'Extracted native image', v: 'See recorded image series; no active-code inference' },
				{ k: 'Revisions', v: `${verAt(cid, f,ui.machine)}  → ${verAt(cid, t,ui.machine)} ` }
			]
		};
	});

 $effect(()=>{
  if(!datasetView.revision)return;
  const series=otSeries(ui.scope,ui.histCfg,ui.otMetric),ends=historyEndpoints(series,ui.histFrom,ui.histTo);if(!ends)return;
  const before=SNAPS[ends[0]]?.date,after=SNAPS[ends[1]]?.date;if(!before||!after)return;
  const scope={...ui.scope,snapshot:ui.snap,metric:ui.metric};const metric=ui.otMetric,cid=ui.histCfg;
  const timer=setTimeout(()=>void loadHistoryReport(scope,metric,cid,before,after),150);return ()=>clearTimeout(timer);
 });

	const f = $derived(ui.histFrom);
	const t = $derived(ui.histTo);
	// Keep the report runtime visible when the scope hides it.
	$effect(() => {
		if (plotC.length && !plotC.some((c) => c.id === ui.histCfg)) ui.histCfg = plotC[0].id;
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && range.clear()} />

<svelte:head>
	<title>History · wasm.fyi</title>
</svelte:head>

<div class="head">
	<h1>History</h1>
	<span class="subtitle fg3">Retrospective engine revisions · frozen workload artifacts · current-chart reference cohort</span>
</div>
<Tabs options={OTM_KEYS.map((k) => [k, OTM[k].l])} value={ui.otMetric} onselect={(k) => (ui.otMetric = k)} />
<Carousel title="{M.l} History" sub="{oi + 1} / {OTM_KEYS.length} · {NOTE[M.key]}" onprev={() => step(-1)} onnext={() => step(1)} noun="metric" />
<div class="row">
	<Seg
		options={[
			['ratio', 'Absolute'],
			['change', 'Change from first measured']
		]}
		value={ui.histMode}
		onselect={(v) => (ui.histMode = v as 'ratio' | 'change')}
	/>
	<span class="small fg3">Drag to select a range · or click, then shift+click</span>
	<label class="sel"
		>From
		<select value={String(f)} onchange={(e) => (ui.histFrom = Math.min(+e.currentTarget.value, ui.histTo - 1))}>
			{#each SNAPS as p (p.i)}<option value={String(p.i)}>snap-{p.date}</option>{/each}
		</select>
	</label>
	<label class="sel"
		>To
		<select value={String(t)} onchange={(e) => (ui.histTo = Math.max(+e.currentTarget.value, ui.histFrom + 1))}>
			{#each SNAPS as p (p.i)}<option value={String(p.i)}>snap-{p.date}</option>{/each}
		</select>
	</label>
</div>

<div class="panel chart-panel">
	<div class="chart" role="presentation" onmouseleave={() => (hover = null)} onpointerdown={scrub} onpointermove={scrub} onpointerup={endScrub} onpointercancel={endScrub}>
		<svg viewBox="0 0 {W} {HC}" role="presentation" class:dragging={range.dragging} onpointerdown={(e) => e.pointerType === 'mouse' && range.down(e)} onpointermove={(e) => e.pointerType === 'mouse' && range.move(e)} onpointerup={(e) => e.pointerType === 'mouse' && range.up(e)} onpointercancel={range.cancel}>
			<rect x={X(f).toFixed(1)} y="38" width={(X(t) - X(f)).toFixed(1)} height="216" style="fill:var(--bg3)" />
			{#if range.anchor != null && !range.dragging}
				<line class="anchor" x1={X(range.anchor).toFixed(1)} x2={X(range.anchor).toFixed(1)} y1="38" y2="254" />
			{/if}
			{#if range.band}
				{@const [lo, hi] = range.band}
				<rect class="drag-band" x={X(lo).toFixed(1)} y="38" width={Math.max(1, X(hi) - X(lo)).toFixed(1)} height="216" />
			{/if}
			{#each scale.ticks as k (k.y)}<line x1="46" x2="844" y1={k.y} y2={k.y} style="stroke:var(--line)" />{/each}
			{#each events as e (e.x)}<line x1={e.x} x2={e.x} y1="30" y2="254" style:stroke={e.stroke} style:stroke-dasharray={e.dash} />{/each}
			{#each lines as l (l.c.id)}
				{#each l.segs as p, k (k)}
					<path
						d={historyCurve(p)}
						style:stroke={l.c.col}
						style:stroke-width={l.width}
						style:opacity={l.op}
						style:stroke-dasharray={l.c.hollow ? '4 3' : 'none'}
						class="line"
					/>
				{/each}
			{/each}
			<line x1={X(f).toFixed(1)} x2={X(f).toFixed(1)} y1="38" y2="254" style="stroke:var(--fg)" />
			<line x1={X(t).toFixed(1)} x2={X(t).toFixed(1)} y1="38" y2="254" style="stroke:var(--fg)" />
            {#if tip}
				<line x1={tip.x} x2={tip.x} y1="30" y2="254" style="stroke:var(--fg3)" />
				{#each tip.rows as d (d.c.id)}<circle cx={tip.x} cy={d.y} r={d.r} style:stroke={d.c.col} style="fill:var(--bg2);stroke-width:2" />{/each}
			{/if}
			{#each hits as h (h.i)}
				<rect
					role="presentation"
					x={h.x}
					y="30"
					width={STEP.toFixed(1)}
					height="232"
					class="hit"
					onpointerenter={(e) => e.pointerType === 'mouse' && (hover = range.dragging ? null : h.i)}
				/>
			{/each}
		</svg>
		{#each lines as l (l.c.id)}
			{#each l.points as p (p.i)}<HistoryMarker x={pc(p.x,W)} y={pc(p.y,HC)} color={l.c.col} version={p.version} selected={l.sel} partial={p.partial} />{/each}
		{/each}
		{#if tip}
			<div class="htip float" role="tooltip" style:left={tip.l} style:transform={tip.tf} use:onscreen={tip}>
				<div class="htip-top">
					<span class="mono">{tip.date}</span>
					{#each tip.ev as e (e)}<span class="htip-chip">{e}</span>{/each}
				</div>
				{#each tip.rows as r, k (r.c.id)}
					<div class="htip-row" class:cur={r.sel}>
						<Swatch color={r.c.col} bg={r.c.hollow ? 'transparent' : r.c.col} />
						<span class="htip-name">{r.c.rt} <span class="fg3">{r.c.be}</span> <span class="mono fg3" class:rel={r.release}>{r.release ? '◆ ' : ''}<VersionLink id={r.c.id} version={viewData.history[ui.machine].versions[r.c.id]?.[hover!]} source={viewData.history[ui.machine].sources?.[r.c.id]?.[hover!]} /></span></span>
						<span class="htip-bar" class:div={tip.diverging}><span style:left={tip.bars[k].left} style:width={tip.bars[k].width} style:background={r.c.col}></span></span>
						<span class="mono r">{r.value}</span>
						<TipDelta text={r.delta} color={r.dColor} dir={r.d} />
					</div>
					{#if !r.info.coverage.complete || r.info.calls}
						<div class="htip-sub">
							{#if !r.info.coverage.complete}<TipCoverage measured={r.info.coverage.measured} reference={r.info.coverage.reference} />{/if}
							{#if r.info.calls}<TipCalls {...r.info.calls} color={r.c.col} />{/if}
						</div>
					{/if}
				{/each}
				<div class="htip-foot">{tip.notes.join(' · ')}</div>
			</div>
		{/if}
		{#if range.anchor != null && !range.dragging}
			{@const an = range.anchor}
			<span class="rtag anchor-tag mono" style:left={pc(X(an), W)} style:transform={an < 1 ? 'translateX(0)' : an >= SNAPS.length - 2 ? 'translateX(-100%)' : 'translateX(-50%)'}>{(SNAPS[an]?.date.slice(5)||'unavailable')} · SHIFT+CLICK</span>
		{/if}
		<span class="rtag mono" style:left={pc(X(f), W)} style:transform={f < 1 ? 'translateX(0)' : 'translateX(-50%)'}>FROM {(SNAPS[f]?.date.slice(5)||'unavailable')}</span>
		<span class="rtag mono" style:left={pc(X(t), W)} style:transform={t >= SNAPS.length - 2 ? 'translateX(-100%)' : 'translateX(-50%)'}
			>TO {(SNAPS[t]?.date.slice(5)||'unavailable')}</span
		>
		{#each lines as l (l.c.id)}
			{#if l.sel}
				{#each l.bumps as b, j (b.i)}
					{#if !/^[a-f0-9]{12}$/.test(b.ver) || j===0 || j===l.bumps.length-1}
						<span class="ver mono" style:left={b.bl} style:top={b.bt} style:color={l.c.col}><VersionLink id={l.c.id} version={viewData.history[ui.machine].versions[l.c.id]?.[b.i]} source={viewData.history[ui.machine].sources?.[l.c.id]?.[b.i]} /></span>
					{/if}
				{/each}
			{/if}
		{/each}
		{#each scale.ticks as k (k.y)}
			<span class="axis-label" style:left="4.7%" style:top={k.t} style:transform="translate(-100%,-50%)">{k.label}</span>
		{/each}
		{#each hits as h (h.i)}
			{#if h.show}<span class="axis-label" style:left={h.l} style:top="94%" style:transform="translateX(-50%)">{h.label}</span>{/if}
		{/each}
	</div>
	<div class="keys">
		<span class="key"><span class="k-range"></span>Change-report range — click chart or use From / To</span>
		<span class="key"><span class="k-diamond"></span>Release version · circle = source snapshot</span>
		<span class="key">○ Partial workload coverage · changes use matched workloads</span>
		<span class="key"><span class="k-event"></span>Retrospective source revision — hover for details</span>
	</div>
	<div class="report-for">
		<span class="small fg3 nowrap">Report for</span>
		{#each plotC as c (c.id)}
			<button class="chip" class:on={c.id === ui.histCfg} onclick={() => (ui.histCfg = c.id)}>
				<Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} />{c.rt} <span class="small fg3">{c.be}</span>
			</button>
		{/each}
	</div>
	<div class="note">Revision markers identify retrospectively measured engine source. The corpus is frozen; current source rebuilds do not change these measurements.</div>
</div>

<HistoryWindow />
<div class="panel report">
	<div class="rep-head">
		<span class="rep-title"><Swatch color={rep.c.col} bg={rep.c.hollow ? 'transparent' : rep.c.col} size={9} />Change report — {rep.title}</span>
		<span class="mono small fg3">{rep.range}</span>
		<span class="small fg3 push">threshold ±2% · the 95% CI must clear it where one exists</span>
	</div>
	{#if isCov}<div class="note">The workload change report shows execution.</div>{/if}
	{#if rep.empty}
		<div class="note">{rep.c.rt} {rep.c.be} has fewer than two measured points in this range. Widen the range or pick another runtime.</div>
	{:else if rep.snapped}
		<div class="note">Endpoints moved to the nearest measured points inside the selected range.</div>
	{/if}
	{#if rep.spans}
		<div class="warn">
			This range crosses a recorded measurement boundary; do not attribute the difference to the runtime alone.
		</div>
	{/if}
	<div class="sums">
		{#each rep.sums as k (k.k)}
			<div class="sum"><div class="small fg3">{k.k}</div><div class="mono s18" style:color={k.c}>{k.v}</div></div>
		{/each}
	</div>
	<div class="other">
		{#each rep.other as k (k.k)}
			<div class="kv"><span class="small fg3">{k.k}</span><span class="mono s12">{k.v}</span></div>
		{/each}
	</div>
	<div class="ox">
		<table class="t" style:min-width="680px">
			<thead>
				<tr>
					<th class="pl14">Workload</th>
					<th class="r">Before</th>
					<th class="r">After</th>
					<th class="r">Δ</th>
					<th class="r">95% CI</th>
					<th class="pl14">Verdict</th>
				</tr>
			</thead>
			<tbody>
				{#each rep.rows as r (r.name)}
					<tr>
						<td class="pl14" data-tip-card={r.tip || undefined}><span class="mono">{r.name}</span> <span class="small fg3">{r.group}</span></td>
						<td class="mono r fg2">{r.before}</td>
						<td class="mono r">{r.after}</td>
						<td class="mono r" style:color={r.vColor}>{r.delta}</td>
						<td class="mono r fg3">{r.ci}</td>
						<td class="pl14" style:color={r.vColor}>{r.verdict}{#if r.estimate}<span class="est" data-tip="Point estimate: single-launch capture, no confidence interval">*</span>{/if}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
 {#if datasetView.revision}
  {#if apiHistory.reportLoading}<p role="status">Loading matched workload page…</p>{/if}
  {#if apiHistory.reportError}<p role="alert">{apiHistory.reportError}</p>{/if}
  {#if apiHistory.report?.nextCursor}<button class="btn-small" disabled={apiHistory.reportLoading} onclick={()=>loadHistoryReport({...ui.scope,snapshot:ui.snap,metric:ui.metric},ui.otMetric,ui.histCfg,SNAPS[ui.histFrom]?.date,SNAPS[ui.histTo]?.date,apiHistory.report!.nextCursor)}>Next workloads</button>{/if}
 {/if}
	<div class="more note">{rep.moreN}{#if rep.estimates}{rep.moreN ? ' · ' : ''}* {rep.estimates} {rep.estimates === 1 ? 'verdict uses' : 'verdicts use'} the point estimate against ±2%: a comparison interval is unavailable.{/if}</div>
</div>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 16px;
	}
	h1 {
		font-size: 16px;
		font-weight: 600;
	}
	.subtitle {
		font-size: 11px;
		line-height: 16px;
	}
	.s12 {
		font-size: 12px;
	}
	.s18 {
		font-size: 18px;
	}
	.sel {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 12px;
		color: var(--fg3);
	}
	.chart-panel {
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
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
	.line {
		fill: none;
		stroke-linejoin: round;
	}
	svg :global(line),
	svg :global(path) {
		vector-effect: non-scaling-stroke;
	}
	.hit {
		fill: transparent;
		cursor: crosshair;
	}
	svg.dragging .hit {
		cursor: ew-resize;
	}
	.anchor {
		stroke: var(--fg);
		stroke-dasharray: 3 3;
		pointer-events: none;
	}
	.anchor-tag {
		top: 4%;
		background: var(--bg3);
		color: var(--fg);
		border: 1px dashed var(--fg3);
	}
	.drag-band {
		fill: color-mix(in srgb, var(--fg) 10%, transparent);
		stroke: var(--fg3);
		stroke-dasharray: 3 3;
		pointer-events: none;
	}
	.htip {
		position: absolute;
		top: 12%;
		padding: 8px 10px;
		min-width: min(320px, calc(100vw - 16px));
		max-width: calc(100vw - 16px);
		pointer-events: auto;
		overflow-wrap: anywhere;
		z-index: 3;
	}
	.htip-top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 6px;
		font-size: 11px;
		color: var(--fg3);
		margin-bottom: 6px;
	}
	.htip-chip {
		padding: 0 5px;
		font-size: 10px;
		line-height: 16px;
		color: var(--fg2);
		background: var(--bg3);
		border: 1px solid var(--line);
		border-radius: 3px;
	}
	.htip-row {
		display: grid;
		grid-template-columns: 10px minmax(0, 1fr) 48px auto 64px;
		gap: 7px;
		align-items: center;
		font-size: 12px;
		padding: 2px 0;
	}
	.htip-row.cur {
		font-weight: 600;
	}
	.htip-row :global(.delta) {
		justify-self: end;
	}
	.htip-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.htip-name .fg3 {
		font-size: 11px;
		font-weight: 400;
	}
	.htip-name .rel {
		color: var(--fg2);
	}
	.htip-bar {
		position: relative;
		height: 6px;
		background: var(--bg3);
	}
	.htip-bar.div {
		background: linear-gradient(var(--fg3), var(--fg3)) 50% / 1px 100% no-repeat, var(--bg3);
	}
	.htip-bar span {
		position: absolute;
		top: 0;
		bottom: 0;
	}
	.htip-sub {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin: 0 0 4px 17px;
	}
	.htip-foot {
		font-size: 10px;
		color: var(--fg3);
		border-top: 1px solid var(--line);
		margin-top: 6px;
		padding-top: 5px;
	}
	.rtag {
		position: absolute;
		top: 11.5%;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		line-height: 1;
		padding: 2px 5px;
		background: var(--fg);
		color: var(--bg);
		white-space: nowrap;
		pointer-events: none;
	}
	.ver {
		position: absolute;
		transform: translate(-50%, -100%);
		font-size: 10px;
		line-height: 1;
		background: var(--bg2);
		padding: 0 2px;
		white-space: nowrap;
		pointer-events: auto;
	}
	.keys {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 16px;
		align-items: center;
		font-size: 11px;
		color: var(--fg3);
	}
	.key {
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}
	.k-range {
		flex-shrink: 0;
		width: 14px;
		height: 10px;
		border-left: 1px solid var(--fg);
		border-right: 1px solid var(--fg);
		background: var(--bg3);
	}
	.k-diamond {
		flex-shrink: 0;
		width: 7px;
		height: 7px;
		background: var(--fg2);
		transform: rotate(45deg);
	}
	.k-event {
		flex-shrink: 0;
		width: 1px;
		height: 10px;
		border-left: 1px dashed var(--fg3);
	}
	.report-for {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--line2);
		padding: 2px 8px;
		font-size: 12px;
	}
	.chip.on {
		border-color: var(--fg2);
	}
	.report {
		display: flex;
		flex-direction: column;
	}
	.rep-head {
		padding: 10px 14px;
		border-bottom: 1px solid var(--line);
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		align-items: baseline;
	}
	.rep-title {
		display: flex;
		align-items: center;
		gap: 7px;
		font-weight: 600;
	}
	.push {
		margin-left: auto;
	}
	.warn {
		padding: 8px 14px;
		border-bottom: 1px solid var(--line);
		color: var(--st-warn);
		font-size: 12px;
	}
	.sums {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		gap: 1px;
		background: var(--line);
	}
	.sum {
		background: var(--bg2);
		padding: 8px 14px;
	}
	.other {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 4px 18px;
		padding: 8px 14px;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
	}
	.kv {
		display: flex;
		flex-direction: column;
	}
	.ox {
		overflow-x: auto;
	}
	.pl14 {
		padding-left: 14px !important;
	}
	.est {
		margin-left: 2px;
		color: var(--fg3);
	}
	.more {
		padding: 8px 14px;
	}
	/* Phones: a taller stretched chart, a pinned readout instead of a floating tip, compact controls. */
	@media (max-width: 720px) {
		.sel {
			flex: 1 1 140px;
			font-size: 13px;
		}
		.sel select {
			flex: 1;
			min-width: 0;
		}
		.chart-panel {
			padding: 10px;
		}
		.chart {
			margin-left: 22px;
			touch-action: pan-y;
		}
		svg {
			height: 240px;
		}
		svg circle {
			display: none;
		}
		.htip {
			top: auto;
			bottom: calc(100% + 6px);
			left: -22px !important;
			right: 0;
			transform: none !important;
			min-width: 0;
		}
		.htip-row {
			grid-template-columns: 12px minmax(0, 1fr) auto 58px;
		}
		.key {
			white-space: normal;
		}
		.chip {
			padding: 6px 10px;
			font-size: 13px;
		}
		.rep-head {
			padding: 10px 12px;
		}
		.push {
			margin-left: 0;
		}
		.sum,
		.other,
		.more {
			padding-left: 12px;
			padding-right: 12px;
		}
		.sums {
			grid-template-columns: 1fr 1fr;
		}
		.other {
			grid-template-columns: 1fr;
		}
	}
</style>
