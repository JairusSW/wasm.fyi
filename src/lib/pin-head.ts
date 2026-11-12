// Keeps a scroll-box table's sticky header visible while the *page* scrolls past the table.
// The header is sticky inside its own scroll container, so on its own it only sticks while that
// box scrolls. This offsets it (via --head-top) by however far the box's top has gone under the
// site's sticky bar (or the viewport top when nothing is stuck), clamped to the box.
export function pinHead(node: HTMLElement) {
	let frame = 0;
	function update() {
		frame = 0;
		const bar = document.querySelector<HTMLElement>('.scope');
		const barBottom = bar && getComputedStyle(bar).position === 'sticky' ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
		const head = node.querySelector('thead')?.getBoundingClientRect().height ?? 0;
		const top = node.getBoundingClientRect().top;
		const offset = Math.max(0, Math.min(barBottom - top, node.clientHeight - head));
		node.style.setProperty('--head-top', `${Math.round(offset)}px`);
	}
	const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
	window.addEventListener('scroll', schedule, { passive: true });
	window.addEventListener('resize', schedule);
	const ro = new ResizeObserver(schedule);
	ro.observe(node);
	schedule();
	return {
		destroy() {
			cancelAnimationFrame(frame);
			window.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
			ro.disconnect();
		}
	};
}
