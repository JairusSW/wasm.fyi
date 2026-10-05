<script lang="ts">
	import { siteHref } from '$lib/links';
	import { goto } from '$lib/navigation';
	import { CFG } from '$lib/data/runtimes';
	import { EVENTS, OTM, OTM_KEYS, SNAPS, verAt } from '$lib/data/snapshot';
	import type { CfgId } from '$lib/data/types';
	import { pc } from '$lib/format';
	import { href } from '$lib/links';
	import { isOff, isVisible, otSeries, seriesFmt } from '$lib/model';
	import { ui } from '$lib/state.svelte';
import { historySegments, historyCurve, historyCallDetails, historyReusesEvidence, historyAggregateDetails, historyVersionChanges } from '$lib/history-values';
import { viewData } from '$lib/view-data';
import HistoryMarker from '../HistoryMarker.svelte';
	import Carousel from '../Carousel.svelte';
	import RtLabel from '../RtLabel.svelte';
	import Tabs from '../Tabs.svelte';

	const NOTE = {
		exec: 'all non-feature workloads · steady execution per invocation',
		wasmHost: 'typed callback · steady Wasm → host latency',
		hostWasm: 'steady host → Wasm latency',
		roundTrip: 'estimated sum of directional medians · not a measured nested round trip',
		compile: 'module compile time',
		inst: 'instantiation time',
		mem: 'process lifetime peak RSS',
		code: 'extracted native image size',
		cov: 'correct contracts in the fixed historical corpus · higher is better'
	};

	let hover = $state<{ i: number; row: CfgId } | null>(null);
	const oi = $derived(OTM_KEYS.indexOf(ui.otMetric));
	const step = (d: number) => {
		ui.otMetric = OTM_KEYS[(oi + d + OTM_KEYS.length) % OTM_KEYS.length];
		hover = null;
	};

	// Sparkline geometry in a 600×34 viewBox stretched to the cell width.
	const WX = (i: number) => 6 + i * (588 / Math.max(1,SNAPS.length-1));
	const STEP = 588 / Math.max(1,SNAPS.length-1);

	const rows = $derived.by(() => {
		const s = ui.scope;
		const { fv, chg, col } = seriesFmt(ui.otMetric,ui.deltaFormat);
		return CFG.filter((c) => !s.hide[c.id] && (isVisible(s, c) || otSeries(s,c.id,ui.otMetric))).map((c) => {
			const vals = otSeries(s, c.id, ui.otMetric);
			if (!vals) return { c, na: true as const, now: isOff(s, c.id) ? 'unavailable' : 'n/a' };
			const finite=vals.filter(Number.isFinite);
			const lo = Math.min(...finite);
			const hi = Math.max(...finite);
			const WY = (v: number) => 30 - ((v - lo) / (hi - lo || 1)) * 26;
			const segments=historySegments(vals,WX,WY,true);
			const versions=new Set(historyVersionChanges(viewData.history[s.machine].versions[c.id] || [],vals));
			const hi_ = hover?.i;
			const hv = hi_ != null && Number.isFinite(vals[hi_]);
			const hd = hv && hi_ > 0 && Number.isFinite(vals[hi_-1]) ? chg(vals[hi_], vals[hi_ - 1]) : null;
			const firstIndex=vals.findIndex(Number.isFinite),first=vals[firstIndex],last=vals[SNAPS.length-1];
            const reused=historyReusesEvidence(ui.machine,c.id,ui.otMetric,hv?hi_-1:firstIndex,hv?hi_:SNAPS.length-1);
            const d8 = finite.length>1 && first!=null && Number.isFinite(last)?chg(last,first):null;
			const tipOn = hv && hover!.row === c.id;
			return {
				c,
				na: false as const,
				segments,
				points: vals.flatMap((v,i)=>Number.isFinite(v)?[{i,x:WX(i),y:WY(v),version:versions.has(i)?verAt(c.id,i,s.machine):''}]:[]),
				hv,
				hx: hv ? WX(hi_).toFixed(1) : '0',
				dl: hv ? pc(WX(hi_), 600) : '0%',
				dt: hv ? pc(WY(vals[hi_]), 34) : '0%',
				tipOn,
				tip: tipOn
					? {
							date: SNAPS[hi_].date,
							aggregateDetails: historyAggregateDetails(ui.scope,c.id,ui.otMetric,hi_),
							callDetails: ui.otMetric === 'roundTrip' ? historyCallDetails(ui.scope,c.id,hi_) : '',
							ver: `${c.rt} ${verAt(c.id, hi_,ui.machine)}`,
							val: fv(vals[hi_]),
							delta: reused ? 'reused evidence' : hd ? hd.t + ' vs prev week' : 'first snapshot',
							dColor: hd ? col(hd) : 'var(--fg3)',
							ev: EVENTS.filter((e) => e.i === hi_)
								.map((e) => e.label)
								.join(' · '),
							tf: hi_ > 9 ? 'translate(calc(-100% - 10px), -50%)' : 'translate(10px, -50%)'
						}
					: null,
				now: hv ? fv(vals[hi_]) : Number.isFinite(last)?fv(last):'not measured',
				delta: reused ? 'reused evidence' : hv ? (hd ? hd.t : '—') : d8?.t || 'not measured',
				dColor: hv ? (hd ? col(hd) : 'var(--fg3)') : d8?col(d8):'var(--fg3)'
			};
		});
	});

	const sh = $derived(hover?.i ?? null);
	const spEvent = $derived(
		sh == null
			? ''
			: EVENTS.filter((e) => e.i === sh)
					.map((e) => e.label)
					.join(' · ')
	);
	const histHref = (id: CfgId, i?: number) =>
		i == null
			? href('/history', { cfg: id === 'A' ? null : id, ot: ui.otMetric === 'exec' ? null : ui.otMetric })
			: href('/history', {
					cfg: id === 'A' ? null : id,
					ot: ui.otMetric === 'exec' ? null : ui.otMetric,
					to: Math.max(1, i),
					from: Math.max(0, Math.max(1, i) - 6)
				});
</script>

<div class="stack">
	<Tabs options={OTM_KEYS.map((k) => [k, OTM[k].l])} value={ui.otMetric} onselect={(k) => (ui.otMetric = k)} />
	<div class="toolbar">
		<Carousel
			title="{OTM[ui.otMetric].l} History"
			sub="{oi + 1} / {OTM_KEYS.length} · {NOTE[ui.otMetric]}"
			onprev={() => step(-1)}
			onnext={() => step(1)}
			noun="metric"
		/>
		<span class="s12 fg3">{SNAPS.length} retrospective points · ◆ version · ● snapshot · hover to inspect</span>
		<span class="s12 fg2">{spEvent}</span>
		<a class="link-quiet push" href={siteHref(histHref(ui.histCfg))}>History</a>
	</div>
	<div class="tbl-wrap" role="presentation" onmouseleave={() => (hover = null)}>
		<table class="t sp">
			<thead>
				<tr>
					<th>Runtime</th>
					<th class="mono">{sh == null ? SNAPS[0].short+' → '+SNAPS[SNAPS.length-1].short : 'snap-' + SNAPS[sh].date}</th>
					<th class="r">{sh == null ? 'Now' : 'At snapshot'}</th>
					<th class="r">{sh == null ? 'Δ first → last recorded' : 'Δ prev week'}</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as h (h.c.id)}
					<tr class="hoverbg" onclick={() => goto(histHref(h.c.id))}>
						<td class="nowrap w1">
							<a class="rt" href={siteHref(histHref(h.c.id))} data-tip={`${h.c.rt} ${verAt(h.c.id,SNAPS.length-1,ui.machine)} · ${h.c.be}\n${h.c.kind}\nClick to open history`}>
								<RtLabel c={h.c} mono />
							</a>
						</td>
						<td class="spark-td">
							<div class="spark">
								{#if !h.na}
									<svg viewBox="0 0 600 34" preserveAspectRatio="none">
										{#if h.hv}<line x1={h.hx} x2={h.hx} y1="0" y2="34" class="cross" />{/if}
										{#each h.segments as points}<path d={historyCurve(points)} style:stroke={h.c.col} style:stroke-dasharray={h.c.hollow ? '4 3' : 'none'} />{/each}
										{#each SNAPS as p (p.i)}
											<rect
												role="presentation"
												x={(WX(p.i) - STEP / 2).toFixed(1)}
												y="0"
												width={STEP.toFixed(1)}
												height="34"
												onmouseenter={() => (hover = { i: p.i, row: h.c.id })}
												ontouchstart={() => (hover = { i: p.i, row: h.c.id })}
												onclick={(e) => {
													e.stopPropagation();
													goto(histHref(h.c.id, p.i));
												}}
											/>
										{/each}
									</svg>
									{#each h.points as p (p.i)}<HistoryMarker x={pc(p.x,600)} y={pc(p.y,34)} color={h.c.col} version={p.version} />{/each}
									{#if h.hv}
										<span class="dot" style:left={h.dl} style:top={h.dt} style:border-color={h.c.col}></span>
									{/if}
									{#if h.tip}
										<div class="tip float" role="tooltip" style:left={h.dl} style:transform={h.tip.tf}>
											<span class="tip-top"><span class="mono">{h.tip.date}</span><span>{h.tip.ver}</span></span>
											<span class="mono tip-val">{h.tip.val}</span>
											<span class="mono small" style:color={h.tip.dColor}>{h.tip.delta}</span>
											{#if h.tip.aggregateDetails}<span class="tip-ev">{h.tip.aggregateDetails}</span>{/if}
										{#if h.tip.callDetails}<span class="tip-ev">{h.tip.callDetails}</span>{/if}
											{#if h.tip.ev}<span class="tip-ev">{h.tip.ev}</span>{/if}
										</div>
									{/if}
								{/if}
							</div>
						</td>
						<td class="mono r nowrap w1 v">{h.now}</td>
						<td class="mono r nowrap w1 v" style:color={h.na ? 'var(--fg3)' : h.dColor}>{h.na ? '' : h.delta}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
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
		min-width: 640px;
		font-size: 13px;
	}
	tr {
		cursor: pointer;
	}
	.w1 {
		width: 1%;
	}
	.rt {
		text-decoration: none;
		display: inline-flex;
	}
	.spark-td {
		padding: 4px 12px;
	}
	.v {
		padding: 5px 12px;
	}
	.spark {
		position: relative;
		height: 36px;
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
	.cross {
		stroke: var(--fg3);
		vector-effect: non-scaling-stroke;
	}
	rect {
		fill: transparent;
		cursor: crosshair;
	}
	.dot {
		position: absolute;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--bg2);
		border: 2px solid;
		transform: translate(-50%, -50%);
		pointer-events: none;
	}
	.tip {
		position: absolute;
		top: 50%;
		z-index: 5;
		pointer-events: none;
		padding: 6px 9px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		white-space: nowrap;
		min-width: 150px;
	}
	.tip-top {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 11px;
		color: var(--fg3);
	}
	.tip-val {
		font-size: 15px;
	}
	.tip-ev {
		font-size: 11px;
		color: var(--fg2);
		border-top: 1px solid var(--line);
		padding-top: 3px;
		margin-top: 2px;
	}
</style>
