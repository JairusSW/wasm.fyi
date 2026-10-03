<script lang="ts">
	import { columns as colOrder } from '$lib/order.svelte';
	import { reorder } from '$lib/reorder';
	import Swatch from '$lib/components/Swatch.svelte';
	import type { Cfg } from '$lib/data/types';
	import { heatRatio } from '$lib/heat';
	import { ui } from '$lib/state.svelte';
	import { fmtValue, isPerfMetric, type ChartConfig, type Dataset } from './query';
	import { extent, scale } from './scale';

	/** `height` is the drawing height in px; the chart fills its width. */
	let { ds, config, height = 260, svgEl = $bindable() }: { ds: Dataset; config: ChartConfig; height?: number; svgEl?: SVGSVGElement | null } = $props();

	let width = $state(640);
	const H = $derived(Math.max(110, height));
	const name = (c: Cfg) => `${c.rt} ${c.be}`;
	const bg = (c: Cfg) => (c.hollow ? 'transparent' : c.col);
	const fmt = (v: number | null | undefined, unit = ds.unit) => (v == null ? '—' : fmtValue(v, unit));
	const openCell = (w: string, c: Cfg) => {
		if (isPerfMetric(config.metric)) ui.drawer = { type: 'cell', b: w, c: c.id, m: config.metric, cf: 1 };
	};
	/** Runtime name, plus the backend when that runtime appears more than once. */
	const label = (c: Cfg, all: Cfg[]) => (all.filter((x) => x.rt === c.rt).length > 1 ? name(c) : c.rt);
	const ratioTick = (v: number) => (v >= 1000 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k' : v >= 10 ? Math.round(v).toString() : String(+v.toPrecision(2)));
	const tick = (v: number, unit: string) => (unit === 'x' ? ratioTick(v) + '×' : unit === '%' ? Math.round(v * 100) + '%' : unit ? fmtValue(v, unit) : String(+v.toPrecision(3)));

	// ── Ranking ────────────────────────────────────────────────────────────
	const bars = $derived.by(() => {
		const vals = ds.rows.map((r) => r.value).filter((v): v is number => v != null && v > 0);
		const [lo, hi] = vals.length ? extent(vals) : [1, 1];
		const len = (v: number) => (config.log && hi > lo ? 6 + (94 * Math.log(v / lo)) / Math.log(hi / lo) : Math.max(1, (v / hi) * 100));
		return ds.rows.map((r) => ({ ...r, w: r.value != null ? len(r.value).toFixed(1) + '%' : '0%' }));
	});

	// ── Trade-off ──────────────────────────────────────────────────────────
	const scatter = $derived.by(() => {
		if (ds.kind !== 'scatter' || !ds.points?.length) return null;
		const pl = 64;
		const pb = 34;
		const pt = 22;
		const [x0, x1] = extent(ds.points.map((p) => p.x));
		const [y0, y1] = extent(ds.points.map((p) => p.y));
		const x = scale(x0, x1, pl, width - 16, config.log);
		const y = scale(y0, y1, H - pb, pt, config.log);
		return { x, y, pl, pb, pt, all: ds.points.map((p) => p.cfg) };
	});

	// ── History ────────────────────────────────────────────────────────────
	const line = $derived.by(() => {
		if (ds.kind !== 'line' || !ds.lines || !ds.dates) return null;
		const pl = 64;
		const pb = 24;
		const pt = 10;
		const vals = ds.lines.flatMap((l) => l.values).filter((v): v is number => v != null);
		const [lo, hi] = extent(vals);
		const n = ds.dates.length;
		const x = (i: number) => pl + (i * (width - pl - 16)) / Math.max(1, n - 1);
		const y = scale(lo, hi, H - pb, pt, config.log && lo > 0);
		const paths = ds.lines.map((l) => {
			const segs: string[] = [];
			let cur: string[] = [];
			l.values.forEach((v, i) => {
				if (v == null) {
					if (cur.length) segs.push(cur.join(' '));
					cur = [];
				} else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
			});
			if (cur.length) segs.push(cur.join(' '));
			return { cfg: l.cfg, segs, dots: l.values.flatMap((v, i) => (v == null ? [] : [{ cx: x(i), cy: y(v), v, d: ds.dates![i] }])) };
		});
		const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - pl) / 70))));
		return { x, y, pl, paths, xt: ds.dates.map((d, i) => ({ i, d })).filter(({ i }) => i % every === 0) };
	});
</script>

<div class="chart" bind:clientWidth={width}>
	{#if ds.error}
		<div class="empty" style:min-height="{Math.min(H, 160)}px">{ds.error}</div>
	{:else if ds.kind === 'bar'}
		<div class="bars">
			{#each bars as r (r.cfg.id)}
				<div class="bar-row" style:grid-template-columns="minmax(110px, 190px) 1fr 86px" data-tip={`${name(r.cfg)}\n${fmt(r.value)}\n${r.n ? r.n + ' measured' : 'not measured'}`}>
					<button class="lab" onclick={() => ui.openProfile(r.cfg.rt)}>
						<Swatch color={r.cfg.col} bg={bg(r.cfg)} /><span class="nm">{r.cfg.rt}</span><span class="be">{r.cfg.be}</span>
					</button>
					{#if r.value != null}
						<span class="bar" style:width={r.w} style:background={r.cfg.col}></span>
					{:else}
						<span class="small fg3">not measured</span>
					{/if}
					<span class="mono r small" class:fg3={r.value == null}>{fmt(r.value)}</span>
				</div>
			{/each}
		</div>
	{:else if scatter && ds.points}
		<svg bind:this={svgEl} {width} height={H} role="img" aria-label={config.title}>
			{#each scatter.x.ticks as t (t)}
				<line x1={scatter.x(t)} x2={scatter.x(t)} y1={scatter.pt} y2={H - scatter.pb} class="grid" />
				<text x={scatter.x(t)} y={H - scatter.pb + 14} class="tick" text-anchor="middle">{tick(t, ds.xUnit ?? '')}</text>
			{/each}
			{#each scatter.y.ticks as t (t)}
				<line x1={scatter.pl} x2={width - 16} y1={scatter.y(t)} y2={scatter.y(t)} class="grid" />
				<text x={scatter.pl - 6} y={scatter.y(t) + 3} class="tick" text-anchor="end">{tick(t, ds.unit)}</text>
			{/each}
			<text x={width - 16} y={H - 3} class="axis" text-anchor="end">{ds.xLabel} →</text>
			<text x={scatter.pl} y="10" class="axis">↑ {ds.label}</text>
			{#each ds.points as p (p.cfg.id)}
				{@const px = scatter.x(p.x)}
				{@const flipL = px > width - 130}
				<circle cx={px} cy={scatter.y(p.y)} r="6" style:fill={p.cfg.hollow ? 'var(--bg2)' : p.cfg.col} style:stroke={p.cfg.col} stroke-width="1.5" role="presentation" data-tip={`${name(p.cfg)}\n${ds.xLabel}: ${fmtValue(p.x, ds.xUnit ?? '')}\n${ds.label}: ${fmtValue(p.y, ds.unit)}`} />
				<text x={px + (flipL ? -10 : 10)} y={scatter.y(p.y) + 4} text-anchor={flipL ? 'end' : 'start'} class="plab" style:fill={p.cfg.col}>{label(p.cfg, scatter.all)}</text>
			{/each}
		</svg>
	{:else if line}
		<svg bind:this={svgEl} {width} height={H} role="img" aria-label={config.title}>
			{#each line.y.ticks as t (t)}
				<line x1={line.pl} x2={width - 16} y1={line.y(t)} y2={line.y(t)} class="grid" />
				<text x={line.pl - 6} y={line.y(t) + 3} class="tick" text-anchor="end">{tick(t, ds.unit)}</text>
			{/each}
			{#each line.xt as t (t.i)}
				<text x={line.x(t.i)} y={H - 6} class="tick" text-anchor="middle">{t.d.slice(5)}</text>
			{/each}
			{#each line.paths as p (p.cfg.id)}
				{#each p.segs as s, k (k)}
					<polyline points={s} class="ln" style:stroke={p.cfg.col} style:stroke-dasharray={p.cfg.hollow ? '4 3' : 'none'} />
				{/each}
				{#each p.dots as d, k (k)}
					<circle cx={d.cx} cy={d.cy} r="6" class="hit" role="presentation" data-tip={`${d.d}\n${name(p.cfg)} · ${tick(d.v, ds.unit)}`} />
				{/each}
			{/each}
		</svg>
		<div class="legend">
			{#each line.paths as p (p.cfg.id)}<span class="lg"><Swatch color={p.cfg.col} bg={bg(p.cfg)} />{name(p.cfg)}</span>{/each}
		</div>
	{:else if ds.kind === 'heatmap' && ds.matrix}
		{@const m = ds.matrix}
		<div class="tbl-wrap" style:max-height="{H}px">
			<table class="mx hm">
				<thead>
					<tr use:reorder={{ onmove: (id, t, after) => colOrder.moveCfg(id, t, after), onstep: (id, d) => colOrder.stepCfg(id, m.cfgs.map((c) => c.id), d) }}>
						<th class="stick th-label">{m.workloads ? 'Workload' : 'Feature family'}</th>
						{#each m.cfgs as c (c.id)}<th class="ch" data-col={c.id} data-col-label={name(c)} tabindex="0"><Swatch color={c.col} bg={bg(c)} /> {c.rt}<div class="micro fg3">{c.be}</div></th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each m.rows as row, ri (row.id)}
						{@const vals = m.values[ri]}
						{@const best = ds.unit === '%' ? Math.max(...(vals.filter((v) => v != null) as number[])) : Math.min(...(vals.filter((v) => v != null) as number[]))}
						<tr>
							<td class="stick wl mono" title={row.id}>{row.label}</td>
							{#each m.cfgs as c, ci (c.id)}
								{@const v = vals[ci]}
								<td
									class="mono r cell"
									class:fg3={v == null}
									class:click={m.workloads}
									style:background={v == null ? 'transparent' : ds.unit === '%' ? heatRatio(1 / Math.max(v, 0.25)) : heatRatio(v / best)}
									data-tip={`${row.id}\n${name(c)} · ${v == null ? (m.status[ri][ci] === 'nm' ? 'not measured' : m.status[ri][ci]) : fmt(v)}`}
									onclick={() => m.workloads && openCell(row.id, c)}
								>
									{v == null ? '–' : fmt(v)}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<div class="empty">Nothing to draw with these settings.</div>
	{/if}
</div>

<style>
	.chart {
		width: 100%;
		min-width: 0;
	}
	svg {
		display: block;
		overflow: visible;
	}
	.empty {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px 12px;
		text-align: center;
		color: var(--fg3);
		font-size: 12px;
	}
	.bars {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.lab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}
	.nm {
		font-weight: 500;
	}
	.be {
		color: var(--fg3);
		font-size: 11px;
	}
	.bar {
		display: block;
	}
	.grid {
		stroke: var(--line);
	}
	.tick,
	.axis {
		font-family: var(--mono);
		font-size: 10px;
		fill: var(--fg3);
	}
	.axis {
		fill: var(--fg2);
	}
	.plab {
		font-family: var(--sans);
		font-size: 11px;
	}
	.ln {
		fill: none;
		stroke-width: 1.8;
		stroke-linejoin: round;
	}
	.hit {
		fill: transparent;
		cursor: crosshair;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 11px;
		color: var(--fg2);
		margin-top: 4px;
	}
	.lg {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.hm .ch {
		padding: 6px 10px;
		font-size: 12px;
		text-align: right;
	}
	.wl {
		padding: 4px 12px;
		font-size: 11px;
		white-space: nowrap;
		max-width: 260px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cell {
		padding: 4px 10px;
		font-size: 11px;
		white-space: nowrap;
	}
	.click {
		cursor: pointer;
	}
</style>
