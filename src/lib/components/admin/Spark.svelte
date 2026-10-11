<script lang="ts">
	/** Tiny trend line with a soft fill, scaled to its own min/max. Colour comes from `color`. */
	let { values, width = 96, height = 24, color = 'var(--fg2)' }: { values: number[]; width?: number; height?: number; color?: string } = $props();

	const path = $derived.by(() => {
		if (values.length < 2) return { line: '', area: '' };
		const lo = Math.min(...values);
		const hi = Math.max(...values);
		const span = hi - lo || 1;
		const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 2 - ((v - lo) / span) * (height - 4)] as const);
		const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
		return { line, area: `${line}L${width} ${height}L0 ${height}Z` };
	});
</script>

<svg class="spark" viewBox="0 0 {width} {height}" {width} {height} aria-hidden="true" style:--c={color}>
	<path class="area" d={path.area} />
	<path class="line" d={path.line} />
</svg>

<style>
	.spark {
		display: block;
		overflow: visible;
	}
	.area {
		fill: color-mix(in srgb, var(--c) 14%, transparent);
	}
	.line {
		fill: none;
		stroke: var(--c);
		stroke-width: 1.3;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}
</style>
