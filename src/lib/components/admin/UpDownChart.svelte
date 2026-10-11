<script lang="ts">
	/**
	 * Mirrored bars: download above the axis, upload below. Each half has its own scale (upload is
	 * usually a small fraction of download, with bursts), labelled on its own side. Hovering picks a
	 * bucket; the readout shows it, or the latest bucket when nothing is hovered.
	 */
	import type { BwPoint } from '$lib/admin/data';

	let {
		series,
		fmt,
		when,
		height = 200,
		downColor = 'var(--rt-v8)',
		upColor = 'var(--rt-wasmer)',
		readout = true,
		latestLabel = 'Latest',
		ticks = []
	}: {
		series: BwPoint[];
		fmt: (v: number) => string;
		when: (at: number) => string;
		height?: number;
		downColor?: string;
		upColor?: string;
		readout?: boolean;
		latestLabel?: string;
		/** Indexes to label on the x axis, with their text. */
		ticks?: { i: number; text: string }[];
	} = $props();

	let width = $state(600);
	let hover = $state<number | null>(null);
	const pad = $derived({ l: 68, r: 6, t: 6, b: ticks.length ? 20 : 4 });
	const ih = $derived(height - pad.t - pad.b);
	const downH = $derived(ih * 0.64);
	const upH = $derived(ih - downH - 1);
	const axis = $derived(pad.t + downH);
	const iw = $derived(Math.max(1, width - pad.l - pad.r));
	const bw = $derived(iw / Math.max(1, series.length));
	const maxDown = $derived(Math.max(1, ...series.map((p) => p.down)));
	const maxUp = $derived(Math.max(1, ...series.map((p) => p.up)));
	const x = (i: number) => pad.l + i * bw;

	function pick(e: PointerEvent) {
		const r = (e.currentTarget as SVGElement).getBoundingClientRect();
		const i = Math.floor((e.clientX - r.left - pad.l) / bw);
		hover = i >= 0 && i < series.length ? i : null;
	}
	const cur = $derived(series[hover ?? series.length - 1]);
</script>

<div class="ud" bind:clientWidth={width}>
	{#if readout && cur}
		<div class="readout">
			<span class="when fg3">{hover === null ? latestLabel : when(cur.at)}</span>
			<span class="v"><i style:background={downColor}></i>↓ <span class="mono">{fmt(cur.down)}</span></span>
			<span class="v"><i style:background={upColor}></i>↑ <span class="mono">{fmt(cur.up)}</span></span>
		</div>
	{/if}
	<svg viewBox="0 0 {width} {height}" {height} role="img" aria-label="Download and upload over time" onpointermove={pick} onpointerdown={pick} onpointerleave={() => (hover = null)}>
		<text class="lab" x={pad.l - 6} y={pad.t} dy="0.8em">{fmt(maxDown)}</text>
		<text class="lab dir" x={pad.l - 6} y={axis - 4}>↓ down</text>
		<text class="lab dir" x={pad.l - 6} y={axis + 4} dy="0.8em">↑ up</text>
		<text class="lab" x={pad.l - 6} y={axis + upH}>{fmt(maxUp)}</text>
		<line class="grid" x1={pad.l} x2={width - pad.r} y1={pad.t} y2={pad.t} />
		<line class="grid" x1={pad.l} x2={width - pad.r} y1={axis + upH} y2={axis + upH} />
		{#each series as p, i (p.at)}
			{@const w = Math.max(1, bw - Math.min(2, bw * 0.2))}
			{@const hd = (p.down / maxDown) * downH}
			{@const hu = Math.max(p.up ? 0.5 : 0, (p.up / maxUp) * upH)}
			<g class:dim={hover !== null && hover !== i}>
				<rect x={x(i)} y={axis - hd} width={w} height={hd} fill={downColor} />
				<rect x={x(i)} y={axis + 1} width={w} height={hu} fill={upColor} />
			</g>
		{/each}
		<line class="axis" x1={pad.l} x2={width - pad.r} y1={axis + 0.5} y2={axis + 0.5} />
		{#each ticks as t (t.i)}
			{@const tx = x(t.i) + bw / 2}
			<!-- labels near the right edge anchor to their end so they don't run off -->
			<text class="xtick" x={tx} y={height - 5} text-anchor={tx > width - pad.r - 24 ? 'end' : 'middle'}>{t.text}</text>
		{/each}
	</svg>
</div>

<style>
	.ud {
		width: 100%;
		min-width: 0;
		user-select: none;
	}
	.readout {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 16px;
		min-height: 22px;
		margin-bottom: 6px;
		font-size: 12px;
	}
	.when {
		min-width: 15ch;
	}
	.v {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--fg3);
	}
	.v .mono {
		color: var(--fg);
		font-variant-numeric: tabular-nums;
	}
	.v i {
		width: 8px;
		height: 8px;
	}
	svg {
		display: block;
		width: 100%;
		touch-action: pan-y;
	}
	g {
		transition: opacity 0.15s ease;
	}
	g.dim {
		opacity: 0.45;
	}
	.grid {
		stroke: var(--line);
	}
	.axis {
		stroke: var(--fg3);
	}
	.lab,
	.xtick {
		font-family: var(--mono);
		font-size: 10px;
		fill: var(--fg3);
	}
	.lab {
		text-anchor: end;
	}
	.dir {
		fill: var(--fg2);
	}
</style>
