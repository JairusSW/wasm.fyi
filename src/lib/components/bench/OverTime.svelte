<script lang="ts">
	import VersionLink from '../VersionLink.svelte';
	import {CALL_PATHS} from '$lib/call-paths';
	import HistoryWindow from '../HistoryWindow.svelte';
 import {apiHistory} from '$lib/api/history.svelte';
 import {apiView,historyPending,loadHistory,loadHistoryComparison} from '$lib/api/controller.svelte';
 import { tipCard, tipWho } from '$lib/tip';
	import { siteHref } from '$lib/links';
	import { goto } from '$lib/navigation';
	import { CFG } from '$lib/data/runtimes';
	import { OTM, OTM_KEYS, SNAPS, verAt } from '$lib/data/snapshot';
	import type { CfgId } from '$lib/data/types';
	import { pc } from '$lib/format';
	import { href } from '$lib/links';
	import { compileExcluded, isOff, isVisible, otSeries, seriesFmt } from '$lib/model';
	import { ui } from '$lib/state.svelte';
import { historySegments, historyCurve, commitPinned, historyReusesEvidence, historyPointInfo, historyEndpoints, historyVersionChanges, historyCoverage, historyComparison } from '$lib/history-values';
import { viewData } from '$lib/view-data';
import { onscreen } from '$lib/onscreen';
import { RangeSelect } from '$lib/range-select.svelte';
import TipDelta from '../TipDelta.svelte';
import TipCoverage from '../TipCoverage.svelte';
import TipCalls from '../TipCalls.svelte';
import HistoryMarker from '../HistoryMarker.svelte';
import MarkerKey from '../MarkerKey.svelte';
	import Carousel from '../Carousel.svelte';
	import RtLabel from '../RtLabel.svelte';
	import Tabs from '../Tabs.svelte';

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

	let hover = $state<{ i: number; row: CfgId } | null>(null);
 $effect(()=>{apiHistory.from;apiHistory.until;hover=null});
 let visible=$state(false);
 function observeHistory(node:HTMLElement){const observer=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting)});observer.observe(node);return {destroy(){observer.disconnect()}}}
 $effect(()=>{
  if(!visible||!apiView.ready)return;
  apiView.historyRevision;
  const scope={...ui.scope,machine:ui.machine,snapshot:ui.snap,metric:ui.metric,hide:{...ui.scope.hide}};
  void loadHistory(scope,ui.otMetric).then(()=>{const max=Math.max(0,SNAPS.length-1);ui.histFrom=Math.min(ui.histFrom,max);ui.histTo=Math.min(ui.histTo,max)});
 });
 $effect(()=>{
  if(!visible||!apiView.ready||!apiHistory.compact)return;
  const scope={...ui.scope,snapshot:ui.snap,metric:ui.metric},metric=ui.otMetric;
  const from=SNAPS[ui.histFrom]?.date,to=SNAPS[ui.histTo]?.date;
  if(!from||!to)return;
  const timer=setTimeout(()=>void loadHistoryComparison(scope,metric,from,to),100);return ()=>clearTimeout(timer);
 });
	const oi = $derived(OTM_KEYS.indexOf(ui.otMetric));
	const step = (d: number) => {
		ui.otMetric = OTM_KEYS[(oi + d + OTM_KEYS.length) % OTM_KEYS.length];
		hover = null;
	};

	// Sparkline geometry in a 600×34 viewBox stretched to the cell width.
	const WX = (i: number) => 6 + i * (588 / Math.max(1,SNAPS.length-1));
	const STEP = $derived(588 / Math.max(1,SNAPS.length-1));

	// Drag, or click then shift+click, on any sparkline to pick the Δ range.
	const range = new RangeSelect(
		(fx) => Math.max(0, Math.min(SNAPS.length - 1, Math.round((fx * 600 - 6) / STEP))),
		(from, to) => {
			ui.histFrom = from;
			ui.histTo = to;
		}
	);
	const full = $derived(ui.histFrom === 0 && ui.histTo === SNAPS.length - 1);

	const rows = $derived.by(() => {
		const s = ui.scope;
		const { fv, chg, col } = seriesFmt(ui.otMetric,ui.deltaFormat);
		return CFG.filter((c) => !s.hide[c.id] && !compileExcluded(s, c, ui.otMetric) && (isVisible(s, c) || otSeries(s,c.id,ui.otMetric))).map((c) => {
			const vals = otSeries(s, c.id, ui.otMetric);
			if (!vals) return { c, na: true as const, now: isOff(s, c.id) ? 'unavailable' : '—' };
			const finite=vals.filter(Number.isFinite);
			const lo = Math.min(...finite);
			const hi = Math.max(...finite);
			const WY = (v: number) => 30 - ((v - lo) / (hi - lo || 1)) * 26;
			const coverage=vals.map((_,i)=>historyCoverage(s,c.id,ui.otMetric,i));
			const segments=historySegments(vals,WX,WY,true);
			const versions=new Set(historyVersionChanges(viewData.history[s.machine].versions[c.id] || [],vals,new Set(viewData.history[s.machine].points.flatMap((p,i)=>p.releases?.[c.id]?[i]:[]))));
			const hi_ = hover?.i;
			const hv = hi_ != null && Number.isFinite(vals[hi_]);
			const previousIndex=hv?vals.findLastIndex((v,i)=>i<hi_!&&Number.isFinite(v)):-1;
			const previous=hv?historyComparison(s,c.id,ui.otMetric,previousIndex,hi_):null;
			const hd = previous ? chg(previous.after,previous.before) : null;
			// Δ spans the selected range, snapped inward to measured points.
			const ends=historyEndpoints(vals,ui.histFrom,ui.histTo);
			const lastInRange=vals.findLastIndex((v,i)=>i<=ui.histTo&&i>=ui.histFrom&&Number.isFinite(v));
			const last=vals[lastInRange];
            const reused=historyReusesEvidence(ui.machine,c.id,ui.otMetric,hv?previousIndex:ends?.[0]??-1,hv?hi_:ends?.[1]??-1);
            const comparison=ends?historyComparison(s,c.id,ui.otMetric,ends[0],ends[1]):null;
            const d8 = comparison?chg(comparison.after,comparison.before):null;
			const tipOn = hv && hover!.row === c.id;
			return {
				c,
				na: false as const,
				segments,
				points: vals.flatMap((v,i)=>Number.isFinite(v)?[{i,x:WX(i),y:WY(v),version:versions.has(i)?verAt(c.id,i,s.machine):'',commit:commitPinned(viewData.history[s.machine].versions[c.id]?.[i]),partial:!coverage[i].complete}]:[]),
				hv,
				hx: hv ? WX(hi_).toFixed(1) : '0',
				dl: hv ? pc(WX(hi_), 600) : '0%',
				dt: hv ? pc(WY(vals[hi_]), 34) : '0%',
				tipOn,
				tip: tipOn
					? {
							index:hi_ ?? 0,
							date: SNAPS[hi_]?.date,
							info: historyPointInfo(ui.scope,c.id,ui.otMetric,hi_),
							ver: `${c.rt} ${verAt(c.id, hi_,ui.machine)}`,
							release: versions.has(hi_),
							val: fv(vals[hi_]),
							delta: reused ? '~' : hd ? hd.t : 'no prior',
							dDir: reused || !hd || !previous ? null : Math.sign(previous.after - previous.before),
							matched: !reused && hd && previous?.count ? previous.count : 0,
							dColor: reused ? 'var(--fg3)' : hd ? col(hd) : 'var(--fg3)',
							tf: hi_ > 9 ? 'translate(calc(-100% - 10px), -50%)' : 'translate(10px, -50%)'
						}
					: null,
				now: hv ? fv(vals[hi_]) : Number.isFinite(last)?fv(last):'—',
				reused,
				delta: reused ? '~' : hv ? (hd ? hd.t : '—') : d8?.t || '—',
				dColor: reused ? 'var(--fg3)' : hv ? (hd ? col(hd) : 'var(--fg3)') : d8?col(d8):'var(--fg3)'
			};
		});
	});

	const sh = $derived(hover?.i ?? null);
	// Links carry the selected range so the history report opens on it.
	const histHref = (id: CfgId) =>
		href('/history', {
			cfg: id === 'A' ? null : id,
			ot: ui.otMetric === 'exec' ? null : ui.otMetric,
			from: full ? null : ui.histFrom,
			to: full ? null : ui.histTo
		});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && range.clear()} />

<div id="history" class="stack" use:observeHistory>
 <HistoryWindow />
	<Tabs options={OTM_KEYS.map((k) => [k, OTM[k].l])} value={ui.otMetric} onselect={(k) => (ui.otMetric = k)} />
	<div class="toolbar">
		<Carousel
			title="{OTM[ui.otMetric].l} History"
			sub="{oi + 1} / {OTM_KEYS.length} · {NOTE[ui.otMetric]}"
			onprev={() => step(-1)}
			onnext={() => step(1)}
			noun="metric"
		/>
		<MarkerKey note="changes use matched workloads" />
		{#if !full}<button class="link-quiet s12" onclick={() => { ui.histFrom = 0; ui.histTo = SNAPS.length - 1; }}>reset range</button>{/if}
		<a class="link-quiet push" href={siteHref(histHref(ui.histCfg))}>History</a>
	</div>
 {#if apiHistory.loading&&SNAPS.length&&!historyPending(ui.machine)}<p class="small fg3" role="status">Loading selected history…</p>{/if}
 {#if apiHistory.error}<p role="alert">{apiHistory.error}</p>{/if}
 {#if historyPending(ui.machine)}
	<div class="tbl-wrap" aria-busy="true">
		<table class="t sp">
			<!-- Fixed column widths: hovering swaps header and value text, which must not resize columns. -->
			<colgroup><col class="c-rt" /><col /><col class="c-now" /><col class="c-delta" /></colgroup>
			<thead><tr><th>Runtime</th><th></th><th class="r">Now</th><th class="r">Δ</th></tr></thead>
			<tbody>
				{#each [70, 56, 82, 64, 50, 76] as w, k (w)}
					<tr aria-hidden="true">
						<td class="nowrap w1"><span class="skel" style:width="{w * 1.5}px"></span></td>
						<td class="spark-td"><div class="spark"><svg viewBox="0 0 600 34" preserveAspectRatio="none" class="skel-spark"><path d={`M6 ${17 + (k % 3) * 3} C 150 ${8 + k * 2}, 300 ${26 - k}, 450 ${14 + k} S 560 ${20 - k} 594 ${16 + (k % 2) * 5}`} /></svg></div></td>
						<td class="r v"><span class="skel" style:width="3.5em"></span></td>
						<td class="r v"><span class="skel" style:width="3em"></span></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
 {:else if !SNAPS.length}<p class="small fg3">No historical target-date bindings are published for this scope and window.</p>{:else}
	<div class="tbl-wrap" role="presentation" onmouseleave={() => (hover = null)}>
		<table class="t sp">
			<!-- Fixed column widths: hovering swaps header and value text, which must not resize columns. -->
			<colgroup><col class="c-rt" /><col /><col class="c-now" /><col class="c-delta" /></colgroup>
			<thead>
				<tr>
					<th>Runtime</th>
					<th class="mono">{sh == null ? (SNAPS[0]?.short||'—')+' → '+(SNAPS[SNAPS.length-1]?.short||'—') : 'snap-' + SNAPS[sh]?.date}</th>
					<th class="r">{sh != null ? 'At snapshot' : full ? 'Now' : `At ${(SNAPS[ui.histTo]?.date.slice(5)||'unavailable')}`}</th>
					<th class="r">{sh != null ? 'Δ prev week' : full ? 'Δ first → last recorded' : `Δ ${(SNAPS[ui.histFrom]?.date.slice(5)||'unavailable')} → ${(SNAPS[ui.histTo]?.date.slice(5)||'unavailable')}`}</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as h (h.c.id)}
					<tr class="hoverbg" onclick={() => goto(histHref(h.c.id))}>
						<td class="nowrap w1">
							<a class="rt" href={siteHref(histHref(h.c.id))} data-tip-card={tipCard({ who: tipWho(h.c, verAt(h.c.id,SNAPS.length-1,ui.machine)), note: h.c.kind, action: 'open full history' })}>
								<RtLabel c={h.c} mono />
							</a>
						</td>
						<td class="spark-td">
							<div class="spark">
								{#if !h.na}
									<svg viewBox="0 0 600 34" preserveAspectRatio="none" role="presentation" class:dragging={range.dragging} onpointerdown={range.down} onpointermove={range.move} onpointerup={range.up} onpointercancel={range.cancel} onclick={(e) => e.stopPropagation()}>
										{#if !full}<rect class="sel-range" x={WX(ui.histFrom).toFixed(1)} y="0" width={(WX(ui.histTo) - WX(ui.histFrom)).toFixed(1)} height="34" />{/if}
										{#if range.band}<rect class="drag-band" x={WX(range.band[0]).toFixed(1)} y="0" width={Math.max(1, WX(range.band[1]) - WX(range.band[0])).toFixed(1)} height="34" />{/if}
										{#if range.anchor != null && !range.dragging}<line class="anchor" x1={WX(range.anchor).toFixed(1)} x2={WX(range.anchor).toFixed(1)} y1="0" y2="34" />{/if}
										{#if h.hv}<line x1={h.hx} x2={h.hx} y1="0" y2="34" class="cross" />{/if}
										{#each h.segments as points}<path d={historyCurve(points)} style:stroke={h.c.col} style:stroke-dasharray={h.c.hollow ? '4 3' : 'none'} />{/each}
										{#each SNAPS as p (p.i)}
											<rect
												role="presentation"
												x={(WX(p.i) - STEP / 2).toFixed(1)}
												y="0"
												width={STEP.toFixed(1)}
												height="34"
												onmouseenter={() => (hover = range.dragging ? null : { i: p.i, row: h.c.id })}
												ontouchstart={() => (hover = { i: p.i, row: h.c.id })}
											/>
										{/each}
									</svg>
									{#each h.points as p (p.i)}<HistoryMarker x={pc(p.x,600)} y={pc(p.y,34)} color={h.c.col} version={p.version} commit={p.commit} partial={p.partial} hot={h.hv && p.i === hover?.i} />{/each}
									{#if h.tip}
										<div class="tip float" role="tooltip" style:left={h.dl} style:transform={h.tip.tf} use:onscreen={h.tip}>
											<span class="tip-top"><span class="mono">{h.tip.date}</span><span class:rel={h.tip.release}>{h.tip.release ? '◆ ' : ''}{h.c.rt} <VersionLink id={h.c.id} version={viewData.history[ui.machine].versions[h.c.id]?.[h.tip.index]} source={viewData.history[ui.machine].sources?.[h.c.id]?.[h.tip.index]} /></span></span>
											<span class="tip-main">
												<span class="mono tip-val">{h.tip.val}</span>
												<TipDelta text={h.tip.delta} color={h.tip.dColor} dir={h.tip.dDir} />
											</span>
											{#if h.tip.matched}<span class="tip-note">vs previous · {h.tip.matched} matched workloads</span>{/if}
											{#if !h.tip.info.coverage.complete}<TipCoverage measured={h.tip.info.coverage.measured} reference={h.tip.info.coverage.reference} />{/if}
											{#if h.tip.info.calls}<TipCalls {...h.tip.info.calls} color={h.c.col} />{/if}
											{#if h.tip.info.archived}
												<span class="tip-chips">
													{#if h.tip.info.archived}<span class="chip fg3">archived</span>{/if}
												</span>
											{/if}
										</div>
									{/if}
								{/if}
							</div>
						</td>
						<td class="mono r nowrap w1 v">{h.now}</td>
						<td class="mono r nowrap w1 v" style:color={h.na ? 'var(--fg3)' : h.dColor} data-tip={!h.na && h.reused ? 'No change: both ends reuse the same measurement' : undefined}>{h.na ? '' : h.delta}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
 {/if}
</div>

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		align-items: center;
	}
	.s12 {
		font-size: 12px;
	}
	.push {
		margin-left: auto;
	}
	.sp {
		table-layout: fixed;
		min-width: 640px;
		font-size: 13px;
		/* Presses between sparklines (row borders, cell padding) must not start a text selection. */
		user-select: none;
		-webkit-user-select: none;
	}
	tr {
		cursor: pointer;
	}
	.w1 {
		width: 1%;
	}
	.c-rt {
		width: 240px;
	}
	.c-now {
		width: 110px;
	}
	.c-delta {
		width: 170px;
	}
	/* Clip long labels to their column; the sparkline cell keeps its overflowing tooltip. */
	.sp td:not(.spark-td),
	.sp th {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rt {
		text-decoration: none;
		display: inline-flex;
	}
	.spark-td {
		padding: 2px 12px;
	}
	.v {
		padding: 3px 12px;
	}
	.spark {
		position: relative;
		user-select: none;
		-webkit-user-select: none;
		height: 30px;
		min-width: 300px;
	}
	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	path {
		fill: none;
		stroke-width: 1.6;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}
	.skel-spark path {
		stroke: var(--bg3);
		stroke-width: 3;
		animation: skel-pulse 1.6s ease-in-out infinite;
	}
	@keyframes skel-pulse {
		50% { stroke: color-mix(in srgb, var(--fg) 12%, var(--bg3)); }
	}
	.cross {
		stroke: var(--fg3);
		vector-effect: non-scaling-stroke;
	}
	rect {
		fill: transparent;
		cursor: crosshair;
	}
	.sel-range {
		fill: var(--bg3);
	}
	.drag-band {
		fill: color-mix(in srgb, var(--fg) 10%, transparent);
		stroke: var(--fg3);
		stroke-dasharray: 3 3;
		vector-effect: non-scaling-stroke;
		pointer-events: none;
	}
	.anchor {
		stroke: var(--fg);
		stroke-dasharray: 3 3;
		vector-effect: non-scaling-stroke;
		pointer-events: none;
	}
	svg.dragging {
		cursor: ew-resize;
	}
	.tip {
		position: absolute;
		top: 50%;
		z-index: 5;
		/* Click-through, so hovering and range selection keep tracking the sparklines underneath. */
		pointer-events: none;
		padding: 6px 9px;
		display: flex;
		flex-direction: column;
		gap: 3px;
		width: max-content;
		min-width: min(150px, calc(100vw - 16px));
		max-width: calc(100vw - 16px);
		overflow-wrap: anywhere;
	}
	.tip-top {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 11px;
		color: var(--fg3);
	}
	.tip-top .rel {
		color: var(--fg2);
	}
	.tip-main {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.tip-val {
		font-size: 15px;
	}
	.tip-note {
		font-size: 10px;
		color: var(--fg3);
	}
	.tip-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 3px;
	}
	.chip {
		padding: 0 5px;
		font-size: 10px;
		line-height: 16px;
		color: var(--fg2);
		background: var(--bg3);
		border: 1px solid var(--line);
		border-radius: 3px;
	}
	/* Phones: one card per runtime — label, now and delta on top, a full-width sparkline below. */
	@media (max-width: 720px) {
		.push {
			margin-left: 0;
		}
		.sp {
			min-width: 0;
			display: block;
		}
		.sp thead {
			display: none;
		}
		.sp tbody {
			display: block;
		}
		.sp tr {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto auto;
			grid-template-areas:
				'rt now delta'
				'spark spark spark';
			align-items: center;
			gap: 0 12px;
			padding: 5px 12px 2px;
			border-bottom: 1px solid var(--line);
		}
		.sp tr:last-child {
			border-bottom: 0;
		}
		.sp td {
			border: 0;
			padding: 0;
			width: auto;
		}
		.sp td:nth-child(1) {
			grid-area: rt;
			min-width: 0;
			overflow: hidden;
		}
		.sp td:nth-child(2) {
			grid-area: spark;
			padding: 2px 0;
		}
		.sp td:nth-child(3) {
			grid-area: now;
		}
		.sp td:nth-child(4) {
			grid-area: delta;
			font-size: 12px;
		}
		.spark {
			min-width: 0;
			height: 30px;
			margin: 0 6px;
		}
		.tip {
			display: none;
		}
	}
</style>
