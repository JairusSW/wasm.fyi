// Drag-to-reorder for any row of items marked with `data-col` (table header
// cells, chips). Works with mouse, pen and touch; a short press still clicks,
// so sortable headers keep working. Alt+←/→ moves the focused item.
import type { Action } from 'svelte/action';

export interface ReorderOptions {
	/** Called with the dragged id, the target id, and whether to drop after it. */
	onmove: (id: string, target: string, after: boolean) => void;
	/** Keyboard move by one step. */
	onstep?: (id: string, dir: -1 | 1) => void;
	disabled?: boolean;
	label?: string;
}

const THRESHOLD = 6;

export const reorder: Action<HTMLElement, ReorderOptions> = (node, initial) => {
	let opts = initial;
	let start: { x: number; y: number; id: string; el: HTMLElement; pointer: number } | null = null;
	let dragging = false;
	let marker: HTMLDivElement | null = null;
	let pill: HTMLDivElement | null = null;
	let drop: { id: string; after: boolean } | null = null;

	const items = () => [...node.querySelectorAll<HTMLElement>('[data-col]')];
	const itemAt = (x: number, y: number) => {
		for (const el of items()) {
			const r = el.getBoundingClientRect();
			if (x >= r.left && x <= r.right && y >= r.top - 4 && y <= r.bottom + 4) return el;
		}
		// Past either end of the row: snap to the nearest item horizontally.
		const all = items();
		let best: HTMLElement | null = null;
		let dist = Infinity;
		for (const el of all) {
			const r = el.getBoundingClientRect();
			if (y < r.top - 40 || y > r.bottom + 40) continue;
			const d = Math.min(Math.abs(x - r.left), Math.abs(x - r.right));
			if (d < dist) (dist = d), (best = el);
		}
		return best;
	};

	function down(e: PointerEvent) {
		if (opts.disabled || e.button !== 0) return;
		const el = (e.target as Element).closest<HTMLElement>('[data-col]');
		if (!el || !node.contains(el) || (e.target as Element).closest('input,select,textarea,[data-noreorder]')) return;
		start = { x: e.clientX, y: e.clientY, id: el.dataset.col!, el, pointer: e.pointerId };
	}
	function move(e: PointerEvent) {
		if (!start || e.pointerId !== start.pointer) return;
		if (!dragging) {
			if (Math.abs(e.clientX - start.x) < THRESHOLD && Math.abs(e.clientY - start.y) < THRESHOLD) return;
			dragging = true;
			start.el.classList.add('col-dragging');
			document.documentElement.classList.add('col-drag-active');
			marker = Object.assign(document.createElement('div'), { className: 'col-drop-marker' });
			pill = Object.assign(document.createElement('div'), { className: 'col-drag-pill', textContent: '✥ ' + (start.el.dataset.colLabel || start.el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 40)) });
			document.body.append(marker, pill);
		}
		e.preventDefault();
		pill!.style.left = e.clientX + 14 + 'px';
		pill!.style.top = e.clientY + 12 + 'px';
		const t = itemAt(e.clientX, e.clientY);
		if (!t || t.dataset.col === start.id) {
			drop = null;
			marker!.style.display = 'none';
			return;
		}
		const r = t.getBoundingClientRect();
		const after = e.clientX > r.left + r.width / 2;
		drop = { id: t.dataset.col!, after };
		// Span the marker over the whole table when reordering header cells.
		const table = t.closest('table');
		const tr = table?.getBoundingClientRect();
		const scroller = t.closest<HTMLElement>('.tbl-wrap');
		const sr = scroller?.getBoundingClientRect();
		const top = tr ? Math.max(tr.top, sr?.top ?? -Infinity) : r.top;
		const bottom = tr ? Math.min(tr.bottom, sr?.bottom ?? Infinity, innerHeight) : r.bottom;
		Object.assign(marker!.style, { display: 'block', left: (after ? r.right : r.left) - 1 + 'px', top: top + 'px', height: Math.max(r.height, bottom - top) + 'px' });
	}
	function up(e: PointerEvent) {
		if (!start || e.pointerId !== start.pointer) return;
		const was = dragging;
		const id = start.id;
		const target = drop;
		cleanup();
		if (!was) return;
		// Swallow the click that follows a drag so headers don't also sort.
		const stop = (ev: Event) => {
			ev.stopPropagation();
			ev.preventDefault();
		};
		window.addEventListener('click', stop, { capture: true, once: true });
		setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
		if (target) opts.onmove(id, target.id, target.after);
	}
	function cleanup() {
		start?.el.classList.remove('col-dragging');
		document.documentElement.classList.remove('col-drag-active');
		marker?.remove();
		pill?.remove();
		marker = pill = null;
		start = null;
		dragging = false;
		drop = null;
	}
	function key(e: KeyboardEvent) {
		if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !opts.onstep) return;
		const el = (e.target as Element).closest<HTMLElement>('[data-col]');
		if (!el || !node.contains(el)) return;
		e.preventDefault();
		const id = el.dataset.col!;
		opts.onstep(id, e.key === 'ArrowLeft' ? -1 : 1);
		// Keep focus on the moved item after re-render.
		requestAnimationFrame(() => node.querySelector<HTMLElement>(`[data-col="${CSS.escape(id)}"] button, [data-col="${CSS.escape(id)}"][tabindex]`)?.focus());
	}
	const cancel = (e: KeyboardEvent) => e.key === 'Escape' && dragging && cleanup();

	node.addEventListener('pointerdown', down);
	window.addEventListener('pointermove', move, { passive: false });
	window.addEventListener('pointerup', up);
	window.addEventListener('pointercancel', cleanup);
	window.addEventListener('keydown', cancel);
	node.addEventListener('keydown', key);
	node.classList.add('reorderable');
	return {
		update(o) {
			opts = o;
		},
		destroy() {
			cleanup();
			node.removeEventListener('pointerdown', down);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', cleanup);
			window.removeEventListener('keydown', cancel);
			node.removeEventListener('keydown', key);
		}
	};
};
