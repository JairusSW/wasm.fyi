/**
 * Animated favicon. Browsers don't animate SVG favicons (only Firefox runs their CSS), so this
 * draws the dot-matrix mark into a canvas and swaps the icon link's href frame by frame. The bars
 * fill up dot by dot, hold, then drop and refill. Static `/brand/favicon-dots.svg` stays the
 * fallback for no-JS, reduced motion and the first paint.
 *
 * Hidden tabs throttle timers (Chrome: about once a second), so the loop runs coarser there.
 */

/** Lit height (dots from the bottom) of each of the 8 columns, as in favicon-dots.svg. */
const HEIGHTS = [3, 3, 0, 5, 5, 0, 8, 8];
const BARS = [0, 0, -1, 1, 1, -1, 2, 2]; // which bar a column belongs to, for staggering
const PERIOD = 7000;
const STAGGER = 140; // ms between bars starting to grow
const PER_DOT = 85; // ms per dot while growing
const FALL_AT = 6100;
const FALL = 500;

const SIZE = 64; // drawn at 2× the 32px icon so it stays crisp on HiDPI tab strips
const PITCH = 3.2 * 2;
const ORIGIN = 4.8 * 2;
const R = 1.25 * 2;

function lit(col: number, t: number) {
	const h = HEIGHTS[col];
	if (!h) return 0;
	if (t >= FALL_AT) return Math.max(0, Math.ceil(h * (1 - (t - FALL_AT) / FALL)));
	return Math.max(0, Math.min(h, Math.floor((t - BARS[col] * STAGGER) / PER_DOT) + 1));
}

export function animateFavicon(): () => void {
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
	const link = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = SIZE;
	const g = canvas.getContext('2d');
	if (!link || !g) return () => {};
	const original = link.href;
	// Chrome prefers the PNG icon links when several are present; while animating, only ours counts.
	const others = [...document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')].filter((l) => l !== link);
	for (const l of others) l.remove();
	link.type = 'image/png';

	const start = performance.now();
	let last = '';
	const tick = () => {
		const t = (performance.now() - start) % PERIOD;
		const state = HEIGHTS.map((_, c) => lit(c, t));
		const key = state.join();
		if (key === last) return; // only push a new icon when a dot changes
		last = key;
		g.fillStyle = '#0d0e10';
		g.fillRect(0, 0, SIZE, SIZE);
		g.fillStyle = '#e4e6e9';
		for (let c = 0; c < 8; c++)
			for (let r = 0; r < 8; r++) {
				g.globalAlpha = 8 - r <= state[c] ? 1 : 0.16;
				g.beginPath();
				g.arc(ORIGIN + c * PITCH, ORIGIN + r * PITCH, R, 0, Math.PI * 2);
				g.fill();
			}
		g.globalAlpha = 1;
		link.href = canvas.toDataURL('image/png');
	};
	tick();
	const timer = setInterval(tick, 40);
	return () => {
		clearInterval(timer);
		link.type = 'image/svg+xml';
		link.href = original;
		for (const l of others) document.head.append(l);
	};
}
