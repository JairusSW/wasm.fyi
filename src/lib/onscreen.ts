// Keeps an absolutely positioned floating element (chart tooltips) inside the
// viewport and any clipping ancestor (e.g. an `overflow:auto` table wrapper).
// The correction is applied through the CSS `translate` property, so it
// composes with whatever `left`/`transform` the component sets. Pass a value
// that changes whenever the tooltip moves or its content changes.
const MARGIN = 8;

function bounds(node: HTMLElement) {
	let l = MARGIN, t = MARGIN, r = innerWidth - MARGIN, b = innerHeight - MARGIN;
	for (let p = node.parentElement; p && p !== document.body; p = p.parentElement) {
		const cs = getComputedStyle(p);
		if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
		const pr = p.getBoundingClientRect();
		// clientWidth/Height exclude scrollbars, which would hide the tooltip too.
		l = Math.max(l, pr.left + p.clientLeft);
		t = Math.max(t, pr.top + p.clientTop);
		r = Math.min(r, pr.left + p.clientLeft + p.clientWidth);
		b = Math.min(b, pr.top + p.clientTop + p.clientHeight);
	}
	return { l, t, r, b };
}

/** Shift needed to move [lo, hi] inside [min, max]; aligns to `min` when it cannot fit. */
const shift = (lo: number, hi: number, min: number, max: number) => (hi - lo > max - min || lo < min ? min - lo : hi > max ? max - hi : 0);

function fit(node: HTMLElement) {
	node.style.translate = '';
	const rect = node.getBoundingClientRect();
	if (!rect.width && !rect.height) return;
	const { l, t, r, b } = bounds(node);
	const dx = shift(rect.left, rect.right, l, r);
	const dy = shift(rect.top, rect.bottom, t, b);
	if (dx || dy) node.style.translate = `${dx}px ${dy}px`;
}

export function onscreen(node: HTMLElement, _key?: unknown) {
	// Run after Svelte has flushed the new position/content, before paint.
	const run = () => queueMicrotask(() => node.isConnected && fit(node));
	const ro = new ResizeObserver(run);
	ro.observe(node);
	addEventListener('resize', run);
	run();
	return {
		update: run,
		destroy() {
			ro.disconnect();
			removeEventListener('resize', run);
		}
	};
}
