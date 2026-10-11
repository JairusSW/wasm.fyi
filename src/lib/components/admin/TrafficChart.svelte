<script lang="ts">
	/**
	 * Traffic over the selected range. Visitors and pageviews draw as a line over a soft area;
	 * API requests draw as bars stacked by origin. Hovering (or dragging a finger) picks a
	 * bucket and the readout above the chart shows its numbers.
	 */
	import type { Origin, Point } from '$lib/admin/data';
	import { ORIGINS } from '$lib/admin/data';
	import { shortCount } from '$lib/format';

	let {
		series,
		mode,
		step,
		colors,
		labels
	}: {
		series: Point[];
		mode: 'visitors' | 'pageviews' | 'api';
		/** Bucket length in ms; decides how the x axis is labelled. */
		step: number;
		colors: Record<Origin, string>;
		labels: Record<Origin, string>;
	} = $props();

	let width = $state(800);
	const H = 240;
	const pad = { l: 44, r: 8, t: 10, b: 24 };
	let hover = $state<number | null>(null);

	const total = (p: Point) => (mode === 'api' ? p.api.website + p.api.programmatic + p.api.bots : p[mode]);
	const max = $derived.by(() => {
		const m = Math.max(1, ...series.map(total));
		const mag = 10 ** Math.floor(Math.log10(m));
		return Math.ceil(m / mag / 2) * 2 * mag; // round up to an even step
	});
	const iw = $derived(Math.max(1, width - pad.l - pad.r));
	const ih = H - pad.t - pad.b;
	const bw = $derived(iw / series.length);
	const x = (i: number) => pad.l + (i + 0.5) * bw;
	const y = (v: number) => pad.t + ih - (v / max) * ih;

	const line = $derived(series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(total(p)).toFixed(1)}`).join(''));
	const area = $derived(series.length ? `${line}L${x(series.length - 1)} ${pad.t + ih}L${x(0)} ${pad.t + ih}Z` : '');
	const grid = $derived([0, 0.25, 0.5, 0.75, 1].map((f) => f * max));

	const daily = $derived(step >= 86_400_000);
	const fmtTick = (at: number) => {
		const d = new Date(at);
		return daily || step > 3_600_000
			? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
			: d.toLocaleTimeString(undefined, { hour: 'numeric' });
	};
	const ticks = $derived.by(() => {
		const all = series.map((p, i) => ({ i, at: p.at }));
		// Sub-day buckets spanning several days: one tick per day, at midnight.
		const pool = step > 3_600_000 && !daily ? all.filter(({ at }) => new Date(at).getHours() < step / 3_600_000) : all;
		const every = Math.max(1, Math.ceil(pool.length / Math.max(2, Math.floor(iw / 90))));
		return pool.filter((_, k) => (pool.length - 1 - k) % every === 0);
	});
	const fmtWhen = (at: number) => {
		const d = new Date(at);
		const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
		return daily ? date : `${date}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
	};

	function pick(e: PointerEvent) {
		const r = (e.currentTarget as SVGElement).getBoundingClientRect();
		const i = Math.floor((e.clientX - r.left - pad.l) / bw);
		hover = i >= 0 && i < series.length ? i : null;
	}
	const shown = $derived(hover ?? series.length - 1);
	const cur = $derived(series[shown]);
</script>

<div class="chart" bind:clientWidth={width}>
	<div class="readout" aria-live="polite">
		{#if cur}
			<span class="when fg3">{hover === null ? 'Latest' : fmtWhen(cur.at)}</span>
			<span class="big mono">{total(cur).toLocaleString()}</span>
			{#if mode === 'api'}
				{#each ORIGINS as o (o)}
					<span class="part"><i style:background={colors[o]}></i>{labels[o]} <span class="mono fg2">{cur.api[o].toLocaleString()}</span></span>
				{/each}
			{/if}
		{/if}
	</div>
	<svg
		viewBox="0 0 {width} {H}"
		height={H}
		role="img"
		aria-label="{mode === 'api' ? 'API requests by origin' : mode} over time"
		onpointermove={pick}
		onpointerdown={pick}
		onpointerleave={() => (hover = null)}
	>
		{#each grid as g (g)}
			<line class="grid" x1={pad.l} x2={width - pad.r} y1={y(g)} y2={y(g)} />
			<text class="ytick" x={pad.l - 6} y={y(g)} dy="0.32em">{shortCount(g)}</text>
		{/each}
		{#each ticks as t (t.i)}
			<text class="xtick" x={x(t.i)} y={H - 6}>{fmtTick(t.at)}</text>
		{/each}

		{#if mode === 'api'}
			{#each series as p, i (p.at)}
				{@const gap = Math.min(3, bw * 0.25)}
				{@const w = Math.max(1, bw - gap)}
				{@const web = p.api.website}
				{@const prog = p.api.programmatic}
				<g class="bar" class:dim={hover !== null && hover !== i}>
					<rect x={x(i) - w / 2} y={y(web)} width={w} height={pad.t + ih - y(web)} fill={colors.website} />
					<rect x={x(i) - w / 2} y={y(web + prog)} width={w} height={y(web) - y(web + prog)} fill={colors.programmatic} />
					<rect x={x(i) - w / 2} y={y(total(p))} width={w} height={y(web + prog) - y(total(p))} fill={colors.bots} />
				</g>
			{/each}
		{:else}
			<path class="area" d={area} />
			<path class="line" d={line} />
			{#if hover !== null && cur}
				<line class="cross" x1={x(shown)} x2={x(shown)} y1={pad.t} y2={pad.t + ih} />
				<circle class="pt" cx={x(shown)} cy={y(total(cur))} r="3.5" />
			{/if}
		{/if}
	</svg>
</div>

<style>
	.chart {
		width: 100%;
		min-width: 0;
		user-select: none;
	}
	.readout {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 14px;
		min-height: 24px;
		margin-bottom: 6px;
		font-size: 12px;
	}
	.when {
		min-width: 15ch;
	}
	.big {
		font-size: 16px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.part {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--fg3);
	}
	.part i {
		width: 8px;
		height: 8px;
	}
	svg {
		display: block;
		width: 100%;
		touch-action: pan-y;
	}
	.grid {
		stroke: var(--line);
		stroke-width: 1;
	}
	.ytick,
	.xtick {
		font-family: var(--mono);
		font-size: 10px;
		fill: var(--fg3);
	}
	.ytick {
		text-anchor: end;
	}
	.xtick {
		text-anchor: middle;
	}
	.bar {
		transition: opacity 0.15s ease;
	}
	.bar.dim {
		opacity: 0.45;
	}
	.area {
		fill: color-mix(in srgb, var(--fg) 7%, transparent);
	}
	.line {
		fill: none;
		stroke: var(--fg);
		stroke-width: 1.5;
		stroke-linejoin: round;
	}
	.cross {
		stroke: var(--fg3);
		stroke-dasharray: 2 3;
	}
	.pt {
		fill: var(--bg2);
		stroke: var(--fg);
		stroke-width: 1.5;
	}
</style>
