<script lang="ts">
	/**
	 * Black-and-white dot-matrix world map. Every land cell is a dot; activity lights dots up.
	 *   heat: compact spots centered on nearby groups of locations.
	 *   dots: each place lights a round cluster of grid dots (sea included) sized by its count.
	 * Live pings ripple out from a place as requests arrive. Drawn on a canvas: the dots are
	 * rendered once into an offscreen layer, and only the pings animate on top.
	 */
	import { onMount } from 'svelte';
	import { WORLD, landCells, toGrid } from '$lib/admin/world';
	import { clusterLocations } from '$lib/admin/clusters';

	type Spot = { label: string; sub: string; lat: number; lon: number; value: number };
	let {
		spots,
		mode = 'heat',
		unit = 'visitors',
		pings = []
	}: {
		spots: Spot[];
		mode?: 'heat' | 'dots';
		unit?: string;
		/** Recent arrivals to ripple, with the time they arrived (ms). */
		pings?: { lat: number; lon: number; at: number }[];
	} = $props();

	let wrap = $state<HTMLDivElement>();
	let canvas = $state<HTMLCanvasElement>();
	let width = $state(0);
	let theme = $state(0); // bumps when the site theme flips, to re-read colours
	let hover = $state<{ x: number; y: number; spot: Spot } | null>(null);

	// Very small screens merge 2×2 cells so the dots stay legible.
	const stride = $derived(width && width / WORLD.cols < 3 ? 2 : 1);
	const cols = $derived(Math.ceil(WORLD.cols / stride));
	const rows = $derived(Math.ceil(WORLD.rows / stride));
	const cell = $derived(width / cols);
	const height = $derived(Math.round(cell * rows));

	const land = $derived.by(() => {
		const src = landCells();
		const out = new Uint8Array(cols * rows);
		for (let r = 0; r < WORLD.rows; r++) for (let c = 0; c < WORLD.cols; c++) if (src[r * WORLD.cols + c]) out[Math.floor(r / stride) * cols + Math.floor(c / stride)] = 1;
		return out;
	});
	const grid = (lat: number, lon: number) => {
		const g = toGrid(lat, lon);
		return { col: (g.col + 0.5) / stride - 0.5, row: (g.row + 0.5) / stride - 0.5 };
	};

	// Only input location changes recompute the proximity groups, never animation frames.
	const centers = $derived(clusterLocations(spots));

	/** Per-cell intensity in 0..1. */
	const level = $derived.by(() => {
		const out = new Float32Array(cols * rows);
		const max = Math.max(1, ...spots.map((s) => s.value));
		if (mode === 'heat') {
			const sigma = 0.45 / stride;
			// Include the nearest dot even at a cell corner on a small screen.
			const radius = Math.max(0.75, sigma * 3);
			const reach = Math.ceil(radius);
			for (const s of centers) {
				const { col, row } = grid(s.lat, s.lon);
				for (let r = Math.max(0, Math.floor(row - reach)); r <= Math.min(rows - 1, row + reach); r++)
					for (let c = Math.max(0, Math.floor(col - reach)); c <= Math.min(cols - 1, col + reach); c++) {
						const d2 = (c - col) ** 2 + (r - row) ** 2;
						if (d2 <= radius ** 2) out[r * cols + c] += s.value * Math.exp(-d2 / (2 * sigma * sigma));
					}
			}
			let peak = 0;
			for (let i = 0; i < out.length; i++) peak = Math.max(peak, out[i]);
			// Keep the halo compact rather than boosting its faint tail.
			for (let i = 0; i < out.length; i++) out[i] = peak ? (out[i] / peak) ** 0.8 : 0;
		} else {
			for (const s of spots) {
				const { col, row } = grid(s.lat, s.lon);
				const rad = (0.6 + 3.2 * Math.sqrt(s.value / max)) / stride;
				for (let r = Math.max(0, Math.floor(row - rad)); r <= Math.min(rows - 1, row + rad); r++)
					for (let c = Math.max(0, Math.floor(col - rad)); c <= Math.min(cols - 1, col + rad); c++) {
						const d = Math.hypot(c - col, r - row);
						if (d <= rad) out[r * cols + c] = Math.max(out[r * cols + c], 0.55 + 0.45 * (1 - d / (rad + 0.5)));
					}
			}
		}
		return out;
	});

	let layer: HTMLCanvasElement | null = null;
	let ink = { fg: '#fff', faint: '#333', bg: '#000' };
	function readColors() {
		if (!wrap) return;
		const cs = getComputedStyle(wrap);
		ink = { fg: cs.getPropertyValue('--fg').trim(), faint: cs.getPropertyValue('--line2').trim(), bg: cs.getPropertyValue('--bg2').trim() };
	}

	/** Blend two #rrggbb colours. */
	function mix(a: string, b: string, t: number) {
		const pa = parseInt(a.slice(1), 16);
		const pb = parseInt(b.slice(1), 16);
		const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
		return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
	}

	function paintLayer() {
		if (!width || !height) return;
		theme;
		readColors();
		const dpr = window.devicePixelRatio || 1;
		layer ??= document.createElement('canvas');
		layer.width = Math.round(width * dpr);
		layer.height = Math.round(height * dpr);
		const g = layer.getContext('2d')!;
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, width, height);
		const steps = 12;
		const shades = Array.from({ length: steps + 1 }, (_, k) => mix(ink.faint, ink.fg, k / steps));
		for (let r = 0; r < rows; r++)
			for (let c = 0; c < cols; c++) {
				const i = r * cols + c;
				const v = level[i];
				if (!land[i] && v === 0) continue;
				g.fillStyle = shades[Math.round(v * steps)];
				g.beginPath();
				g.arc((c + 0.5) * cell, (r + 0.5) * cell, cell * (0.26 + 0.18 * v), 0, Math.PI * 2);
				g.fill();
			}
	}

	let raf = 0;
	function frame() {
		raf = 0;
		if (!canvas || !layer) return;
		const dpr = window.devicePixelRatio || 1;
		if (canvas.width !== layer.width || canvas.height !== layer.height) {
			canvas.width = layer.width;
			canvas.height = layer.height;
		}
		const g = canvas.getContext('2d')!;
		g.setTransform(1, 0, 0, 1, 0, 0);
		g.clearRect(0, 0, canvas.width, canvas.height);
		g.drawImage(layer, 0, 0);
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		const now = Date.now();
		let alive = false;
		for (const p of pings) {
			const t = (now - p.at) / 1800;
			if (t < 0 || t > 1) continue;
			alive = true;
			const { col, row } = grid(p.lat, p.lon);
			const x = (col + 0.5) * cell;
			const y = (row + 0.5) * cell;
			g.strokeStyle = ink.fg;
			g.globalAlpha = (1 - t) * 0.9;
			g.lineWidth = 1.2;
			g.beginPath();
			g.arc(x, y, 2 + t * cell * 6, 0, Math.PI * 2);
			g.stroke();
			g.globalAlpha = 1 - t;
			g.fillStyle = ink.fg;
			g.beginPath();
			g.arc(x, y, Math.max(1.5, cell * 0.42), 0, Math.PI * 2);
			g.fill();
			g.globalAlpha = 1;
		}
		if (alive) raf = requestAnimationFrame(frame);
	}
	const kick = () => {
		if (!raf) raf = requestAnimationFrame(frame);
	};

	$effect(() => {
		paintLayer();
		kick();
	});
	$effect(() => {
		pings;
		kick();
	});

	onMount(() => {
		const mo = new MutationObserver(() => theme++);
		mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		const mq = matchMedia('(prefers-color-scheme: dark)');
		const bump = () => theme++;
		mq.addEventListener('change', bump);
		return () => {
			mo.disconnect();
			mq.removeEventListener('change', bump);
			cancelAnimationFrame(raf);
		};
	});

	function move(e: PointerEvent) {
		const rect = canvas!.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		let best: Spot | null = null;
		let bestD = (cell * 3.5) ** 2;
		for (const s of spots) {
			const { col, row } = grid(s.lat, s.lon);
			const d = ((col + 0.5) * cell - x) ** 2 + ((row + 0.5) * cell - y) ** 2;
			if (d < bestD) {
				bestD = d;
				best = s;
			}
		}
		hover = best ? { x, y, spot: best } : null;
	}
</script>

<div class="map" bind:this={wrap} bind:clientWidth={width} style:height="{height}px" role="img" aria-label="World map of {unit} by location">
	<canvas bind:this={canvas} style:width="{width}px" style:height="{height}px" aria-hidden="true" onpointermove={move} onpointerdown={move} onpointerleave={() => (hover = null)}></canvas>
	{#if hover}
		<div class="tip" style:left="{hover.x}px" style:top="{hover.y}px" class:flip={hover.x > width - 160}>
			<b>{hover.spot.label}</b><span class="fg3">{hover.spot.sub}</span>
			<span class="mono">{hover.spot.value.toLocaleString()} <span class="fg3">{unit}</span></span>
		</div>
	{/if}
</div>

<style>
	.map {
		position: relative;
		width: 100%;
		min-width: 0;
	}
	canvas {
		display: block;
		touch-action: pan-y;
	}
	.tip {
		position: absolute;
		transform: translate(12px, -50%);
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 6px 9px;
		font-size: 12px;
		white-space: nowrap;
		pointer-events: none;
		background: var(--bg2);
		border: 1px solid var(--line2);
		box-shadow: var(--shadow-float);
	}
	.tip.flip {
		transform: translate(calc(-100% - 12px), -50%);
	}
	.tip span {
		font-size: 11px;
	}
</style>
