<script lang="ts">
	import Swatch from '$lib/components/Swatch.svelte';
	import type { Cfg } from '$lib/data/types';
	import { heatRatio } from '$lib/heat';
	import { isPerfMetric, fmtValue, type ChartConfig, type Dataset } from './query';
	import { extent, scale } from './scale';
	import { ui } from '$lib/state.svelte';

	let { ds, config, svgEl = $bindable() }: { ds: Dataset; config: ChartConfig; svgEl?: SVGSVGElement | null } = $props();

	let width = $state(640);
	const H = $derived(Math.max(120, Math.min(900, config.height || 260)));
	const name = (c: Cfg) => `${c.rt} ${c.be}`;
	/** Runtime name, plus the backend when several configs of that runtime are shown. */
	const shortName = (c: Cfg) => (ds.rows.filter((r) => r.cfg.rt === c.rt).length > 1 || (ds.points ?? []).filter((p) => !p.w && p.cfg.rt === c.rt).length > 1 ? `${c.rt} ${c.be}` : c.rt);
	const bg = (c: Cfg) => (c.hollow ? 'transparent' : c.col);
	const fmt = (v: number | null | undefined, unit = ds.unit) => (v == null ? '—' : fmtValue(v, unit));
	const openCell = (w: string, c: Cfg) => {
		if (config.source === 'results' && isPerfMetric(config.metric)) ui.drawer = { type: 'cell', b: w, c: c.id, m: config.metric, cf: 1 };
	};

	// ── Ranked bars ───────────────────────────────────────────────────────
	const bars = $derived.by(() => {
		const vals = ds.rows.map((r) => r.value).filter((v): v is number => v != null && v > 0);
		const [lo, hi] = vals.length ? extent(vals) : [1, 1];
		const len = (v: number) =>
			config.log && hi > lo ? 6 + (94 * Math.log(v / lo)) / Math.log(hi / lo || 2) : Math.max(1, (v / hi) * 100);
		return ds.rows.map((r) => ({ ...r, w: r.value != null && r.value > 0 ? len(r.value).toFixed(1) + '%' : '0%' }));
	});

	// ── Grouped columns ────────────────────────────────────────────────────
	const columns = $derived.by(() => {
		const m = ds.matrix;
		if (ds.kind !== 'columns' || !m) return null;
		const pl = 52;
		const pb = 64;
		const pt = 10;
		const vals = m.values.flat().filter((v): v is number => v != null && v > 0);
		if (!vals.length) return null;
		const [lo, hi] = extent(vals);
		const y = scale(config.log ? lo : 0, hi, H - pb, pt, config.log);
		const band = (width - pl - 8) / m.workloads.length;
		const bw = Math.max(1, (band * 0.8) / m.cfgs.length);
		return {
			pl,
			pb,
			y,
			band,
			bars: m.workloads.flatMap((w, wi) =>
				m.cfgs.map((c, ci) => {
					const v = m.values[wi][ci];
					const x = pl + wi * band + band * 0.1 + ci * bw;
					return v == null || v <= 0
						? { c, w, x, top: H - pb, h: 0, v, bw, missing: true }
						: { c, w, x, top: y(v), h: Math.max(0.5, H - pb - y(v)), v, bw, missing: false };
				})
			),
			labels: m.workloads.map((w, wi) => ({ x: pl + wi * band + band / 2, text: w.id.replace(/^wago\//, '') }))
		};
	});

	// ── Strip plot: per-workload spread per runtime ────────────────────────
	const strip = $derived.by(() => {
		const m = ds.matrix;
		if (ds.kind !== 'strip' || !m) return null;
		const pl = 150;
		const row = 26;
		// Without explicit normalization, show spread relative to each workload's fastest.
		const rel = m.values.map((r) => {
			if (config.normalize !== 'none') return r;
			const best = Math.min(...(r.filter((v) => v != null && v > 0) as number[]));
			return r.map((v) => (v != null && v > 0 && Number.isFinite(best) ? v / best : null));
		});
		const vals = rel.flat().filter((v): v is number => v != null && v > 0);
		if (!vals.length) return null;
		const [lo, hi] = extent(vals);
		const x = scale(Math.min(lo, 1), Math.max(hi, 1), pl, width - 16, true);
		const rows = m.cfgs.map((c, ci) => {
			const pts = m.workloads.map((w, wi) => ({ w, v: rel[wi][ci] })).filter((p): p is { w: typeof p.w; v: number } => p.v != null && p.v > 0);
			const sorted = pts.map((p) => p.v).sort((a, b) => a - b);
			const med = sorted.length ? sorted[sorted.length >> 1] : null;
			return { c, ci, pts, med };
		});
		return { x, rows, row, h: rows.length * row + 34, pl, unit: config.normalize === 'none' ? 'vs fastest' : 'ratio' };
	});

	// ── Scatter ────────────────────────────────────────────────────────────
	const scatter = $derived.by(() => {
		if (ds.kind !== 'scatter' || !ds.points?.length) return null;
		const pl = 64;
		const pb = 38;
		const pt = 24;
		const [x0, x1] = extent(ds.points.map((p) => p.x));
		const [y0, y1] = extent(ds.points.map((p) => p.y));
		const log = config.log && x0 > 0 && y0 > 0;
		const x = scale(x0, x1, pl, width - 16, log);
		const y = scale(y0, y1, H - pb, pt, log);
		return { x, y, pl, pb, pt, pts: ds.points };
	});

	// ── Line (history) ─────────────────────────────────────────────────────
	const line = $derived.by(() => {
		if (ds.kind !== 'line' || !ds.lines || !ds.dates) return null;
		const pl = 64;
		const pb = 28;
		const pt = 12;
		const vals = ds.lines.flatMap((l) => l.values).filter((v): v is number => v != null);
		const [lo, hi] = extent(vals);
		const log = config.log && lo > 0;
		const n = ds.dates.length;
		const x = (i: number) => pl + (i * (width - pl - 16)) / Math.max(1, n - 1);
		const y = scale(lo, hi, H - pb, pt, log);
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
			return { cfg: l.cfg, segs, dots: l.values.map((v, i) => (v == null ? null : { cx: x(i), cy: y(v), v, d: ds.dates![i] })).filter((d) => d != null) };
		});
		const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - pl) / 70))));
		return { x, y, pl, pb, paths, xt: ds.dates.map((d, i) => ({ i, d })).filter(({ i }) => i % every === 0) };
	});

	// ── Stat ───────────────────────────────────────────────────────────────
	const stat = $derived.by(() => {
		const live = ds.rows.filter((r) => r.value != null);
		if (!live.length) return null;
		const best = live[0];
		const next = live[1];
		return { best, next, ratio: next && best.value ? next.value! / best.value : null };
	});

	const ratioTick = (v: number) => (v >= 1e4 ? (v / 1e3).toFixed(0) + 'k' : v >= 1000 ? (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : v >= 10 ? Math.round(v).toString() : String(+v.toPrecision(2)));
	const tickFmt = (v: number, unit: string) => (unit === 'x' ? ratioTick(v) + '×' : unit === '%' ? Math.round(v * 100) + '%' : fmtValue(v, unit));
</script>

<div class="chart" bind:clientWidth={width}>
	{#if ds.error}
		<div class="empty">{ds.error}</div>
	{:else if ds.kind === 'bar'}
		<div class="bars">
			{#each bars as r (r.cfg.id)}
				<div
					class="bar-row"
					style:grid-template-columns="minmax(120px, 190px) 1fr 96px"
					data-tip={`${name(r.cfg)}\n${fmt(r.value)}${r.raw != null && ds.unit === 'x' ? ' · ' + fmtValue(r.raw, ds.source === 'features' ? '%' : config.unit === 'x' ? '' : config.unit) : ''}\n${r.n} measured · ${r.missing} missing`}
				>
					<button class="lab" onclick={() => ui.openProfile(r.cfg.rt)}>
						<Swatch color={r.cfg.col} bg={bg(r.cfg)} /><span class="nm">{r.cfg.rt}</span><span class="be">{r.cfg.be}</span>
					</button>
					{#if r.value != null}
						<span class="bar" style:width={r.w} style:background={r.cfg.col}></span>
					{:else}
						<span class="small fg3">not measured</span>
					{/if}
					<span class="mono r small" class:fg3={r.value == null}>{config.labels ? fmt(r.value) : ''}</span>
				</div>
			{/each}
		</div>
	{:else if columns}
		<svg bind:this={svgEl} {width} height={H} role="img" aria-label={config.title}>
			{#each columns.y.ticks as t (t)}
				<line x1={columns.pl} x2={width - 8} y1={columns.y(t)} y2={columns.y(t)} class="grid" />
				<text x={columns.pl - 6} y={columns.y(t) + 3} class="tick" text-anchor="end">{tickFmt(t, ds.unit)}</text>
			{/each}
			{#each columns.bars as b, i (i)}
				{#if !b.missing}
					<rect
						x={b.x}
						y={b.top}
						width={b.bw}
						height={b.h}
						style:fill={b.c.col}
						style:opacity={b.c.hollow ? 0.55 : 0.9}
						role="presentation"
						data-tip={`${b.w.id}\n${name(b.c)} · ${fmt(b.v)}`}
						onclick={() => openCell(b.w.id, b.c)}
					/>
				{/if}
			{/each}
			{#each columns.labels as l, i (i)}
				<text x={l.x} y={H - columns.pb + 12} class="tick" text-anchor="end" transform="rotate(-35 {l.x} {H - columns.pb + 12})">{l.text.length > 22 ? l.text.slice(0, 21) + '…' : l.text}</text>
			{/each}
		</svg>
	{:else if strip}
		<svg bind:this={svgEl} {width} height={strip.h} role="img" aria-label={config.title}>
			{#each strip.x.ticks as t (t)}
				<line x1={strip.x(t)} x2={strip.x(t)} y1="4" y2={strip.h - 26} class="grid" />
				<text x={strip.x(t)} y={strip.h - 12} class="tick" text-anchor="middle">{tickFmt(t, 'x')}</text>
			{/each}
			<line x1={strip.x(1)} x2={strip.x(1)} y1="4" y2={strip.h - 26} class="one" />
			{#each strip.rows as r (r.c.id)}
				{@const cy = 10 + r.ci * strip.row + strip.row / 2}
				<text x="0" y={cy + 4} class="rowlab">{name(r.c).length > 22 ? name(r.c).slice(0, 21) + '…' : name(r.c)}</text>
				{#each r.pts as p, k (k)}
					<circle
						cx={strip.x(p.v)}
						cy={cy + (((k * 7919) % 9) - 4)}
						r="3"
						style:fill={r.c.col}
						opacity="0.7"
						role="presentation"
						data-tip={`${p.w.id}\n${name(r.c)} · ${tickFmt(p.v, 'x')} ${strip.unit}`}
						onclick={() => openCell(p.w.id, r.c)}
					/>
				{/each}
				{#if r.med != null}<line x1={strip.x(r.med)} x2={strip.x(r.med)} y1={cy - 9} y2={cy + 9} class="med" />{/if}
			{/each}
		</svg>
	{:else if scatter}
		<svg bind:this={svgEl} {width} height={H} role="img" aria-label={config.title}>
			{#each scatter.x.ticks as t (t)}
				<line x1={scatter.x(t)} x2={scatter.x(t)} y1={scatter.pt} y2={H - scatter.pb} class="grid" />
				<text x={scatter.x(t)} y={H - scatter.pb + 14} class="tick" text-anchor="middle">{tickFmt(t, ds.xUnit ?? '')}</text>
			{/each}
			{#each scatter.y.ticks as t (t)}
				<line x1={scatter.pl} x2={width - 16} y1={scatter.y(t)} y2={scatter.y(t)} class="grid" />
				<text x={scatter.pl - 6} y={scatter.y(t) + 3} class="tick" text-anchor="end">{tickFmt(t, ds.unit)}</text>
			{/each}
			<text x={width - 16} y={H - 4} class="axis" text-anchor="end">{ds.xLabel} →</text>
			<text x={scatter.pl} y="10" class="axis">↑ {ds.label}</text>
			{#each scatter.pts as p, i (i)}
				<circle
					cx={scatter.x(p.x)}
					cy={scatter.y(p.y)}
					r={p.w ? 3.5 : 6}
					style:fill={p.cfg.hollow ? 'var(--bg2)' : p.cfg.col}
					style:stroke={p.cfg.col}
					stroke-width="1.5"
					opacity={p.w ? 0.75 : 1}
					role="presentation"
					data-tip={`${p.w ? p.w.id + '\n' : ''}${name(p.cfg)}\nx ${fmtValue(p.x, ds.xUnit ?? '')} · y ${fmtValue(p.y, ds.unit)}`}
				/>
				{#if !p.w && config.labels}
					{@const flipL = scatter.x(p.x) > width - 130}
					<text x={scatter.x(p.x) + (flipL ? -9 : 9)} y={scatter.y(p.y) + 4} text-anchor={flipL ? 'end' : 'start'} class="plab" style:fill={p.cfg.col}>{shortName(p.cfg)}</text>
				{/if}
			{/each}
		</svg>
	{:else if line}
		<svg bind:this={svgEl} {width} height={H} role="img" aria-label={config.title}>
			{#each line.y.ticks as t (t)}
				<line x1={line.pl} x2={width - 16} y1={line.y(t)} y2={line.y(t)} class="grid" />
				<text x={line.pl - 6} y={line.y(t) + 3} class="tick" text-anchor="end">{ds.unit ? tickFmt(t, ds.unit) : Math.round(t)}</text>
			{/each}
			{#each line.xt as t (t.i)}
				<text x={line.x(t.i)} y={H - 8} class="tick" text-anchor="middle">{t.d.slice(5)}</text>
			{/each}
			{#each line.paths as p (p.cfg.id)}
				{#each p.segs as s, k (k)}
					<polyline points={s} class="ln" style:stroke={p.cfg.col} style:stroke-dasharray={p.cfg.hollow ? '4 3' : 'none'} />
				{/each}
				{#each p.dots as d, k (k)}
					<circle cx={d.cx} cy={d.cy} r="6" class="hit" role="presentation" data-tip={`${d.d}\n${name(p.cfg)} · ${ds.unit ? fmt(d.v) : d.v}`} />
				{/each}
			{/each}
		</svg>
		<div class="legend">
			{#each line.paths as p (p.cfg.id)}<span class="lg"><Swatch color={p.cfg.col} bg={bg(p.cfg)} />{name(p.cfg)}</span>{/each}
		</div>
	{:else if (ds.kind === 'heatmap' || ds.kind === 'table') && ds.matrix && (config.per === 'workload' || ds.source === 'features')}
		{@const m = ds.matrix}
		<div class="tbl-wrap" style:max-height="{H + 140}px">
			<table class="mx hm">
				<thead>
					<tr>
						<th class="stick th-label">{ds.source === 'features' ? 'Feature family' : 'Workload'}</th>
						{#each m.cfgs as c (c.id)}<th class="ch"><Swatch color={c.col} bg={bg(c)} /> {c.rt}<div class="micro fg3">{c.be}</div></th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each m.workloads as w, wi (w.id)}
						{@const best = Math.min(...(m.values[wi].filter((v) => v != null && v > 0) as number[]))}
						<tr>
							<td class="stick wl mono">{ds.source === 'features' ? w.group : w.id.replace(/^wago\//, '')}</td>
							{#each m.cfgs as c, ci (c.id)}
								{@const v = m.values[wi][ci]}
								<td
									class="mono r cell"
									class:fg3={v == null}
									style:background={ds.kind === 'heatmap' && v != null ? (ds.source === 'features' ? heatRatio(v > 0 ? 1 / Math.max(v, 0.25) : 4) : heatRatio(v / best)) : 'transparent'}
									data-tip={`${ds.source === 'features' ? w.group : w.id}\n${name(c)} · ${v == null ? m.status[wi][ci] : fmt(v)}`}
									onclick={() => ds.source === 'results' && openCell(w.id, c)}
								>
									{v == null ? (m.status[wi][ci] === 'ok' ? '—' : m.status[wi][ci] === 'nm' ? '–' : m.status[wi][ci]) : fmt(v)}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if ds.kind === 'table' || ds.kind === 'heatmap'}
		<div class="tbl-wrap">
			<table class="t">
				<thead><tr><th>Runtime</th><th class="r">{ds.label}</th><th class="r">Measured</th><th class="r">Missing</th></tr></thead>
				<tbody>
					{#each ds.rows as r (r.cfg.id)}
						<tr>
							<td><span class="lab"><Swatch color={r.cfg.col} bg={bg(r.cfg)} />{r.cfg.rt} <span class="be">{r.cfg.be}</span></span></td>
							<td class="mono r" style:background={ds.kind === 'heatmap' && r.value != null && ds.rows[0].value ? heatRatio(r.value / ds.rows[0].value) : 'transparent'}>{fmt(r.value)}</td>
							<td class="mono r fg2">{r.n}</td>
							<td class="mono r fg3">{r.missing}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if ds.kind === 'stat' && stat}
		<div class="stat">
			<div class="kicker">{config.sort === 'desc' ? 'Highest' : 'Lowest'} · {ds.label}</div>
			<div class="big mono">{fmt(stat.best.value)}</div>
			<div class="who"><Swatch color={stat.best.cfg.col} bg={bg(stat.best.cfg)} size={9} /> <b>{stat.best.cfg.rt}</b> <span class="be">{stat.best.cfg.be}</span></div>
			{#if stat.next && stat.ratio}
				<div class="small fg3">Next: {name(stat.next.cfg)} · {fmt(stat.next.value)} ({stat.ratio.toFixed(2)}×)</div>
			{/if}
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
		padding: 28px 12px;
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
	.one {
		stroke: var(--fg3);
		stroke-dasharray: 3 3;
	}
	.tick,
	.axis,
	.rowlab,
	.plab {
		font-family: var(--mono);
		font-size: 10px;
		fill: var(--fg3);
	}
	.rowlab {
		font-family: var(--sans);
		font-size: 11px;
		fill: var(--fg2);
	}
	.axis {
		fill: var(--fg2);
	}
	.plab {
		font-family: var(--sans);
		font-size: 11px;
	}
	.med {
		stroke: var(--fg);
		stroke-width: 2;
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
	rect,
	circle {
		cursor: pointer;
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
	}
	.cell {
		padding: 4px 10px;
		font-size: 11px;
		white-space: nowrap;
		cursor: pointer;
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 6px 0;
	}
	.big {
		font-size: 34px;
		font-weight: 500;
		letter-spacing: -0.02em;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 6px;
	}
</style>
