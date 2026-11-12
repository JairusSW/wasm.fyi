// Drag engines (column headers, chips, list rows) to reorder them site-wide. Pointer-based so it
// works on buttons in every browser; a ghost follows the pointer and the drop side is marked on the
// target with data-drop="before|after". Alt+Arrow moves the focused engine one place.
import { CFG } from './data/runtimes';
import { ui } from './state.svelte';
import { moveEngine } from './engine-order.svelte';

export type EngineDragOptions = { id: string; group: string; axis?: 'x' | 'y' };

const THRESHOLD = 6;

function commit(id: string, target: string, after: boolean) {
	const ids = CFG.map((c) => c.id as string);
	const next = moveEngine(ids, id, target, after);
	if (next.join() !== ids.join()) ui.order = next;
}

export function engineDrag(node: HTMLElement, options: EngineDragOptions) {
	let opts = options;
	const tag = () => {
		node.dataset.engine = opts.id;
		node.dataset.engineGroup = opts.group;
	};
	tag();
	node.classList.add('engine-draggable');

	let startX = 0, startY = 0, active = false;
	let target: HTMLElement | null = null, after = false;
	let ghost: HTMLElement | null = null, offX = 0, offY = 0;

	const clearTarget = () => {
		target?.removeAttribute('data-drop');
		target = null;
	};
	function finish() {
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', up);
		window.removeEventListener('pointercancel', finish);
		window.removeEventListener('keydown', escape, true);
		clearTarget();
		ghost?.remove();
		ghost = null;
		node.classList.remove('engine-dragging');
		document.documentElement.classList.remove('engine-drag-active');
		active = false;
	}
	function escape(e: KeyboardEvent) {
		if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
	}
	function down(e: PointerEvent) {
		// Touch keeps native scrolling; mouse and pen drag.
		if (e.button !== 0 || e.pointerType === 'touch') return;
		startX = e.clientX;
		startY = e.clientY;
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', finish);
	}
	function start(e: PointerEvent) {
		active = true;
		const r = node.getBoundingClientRect();
		offX = startX - r.left;
		offY = startY - r.top;
		ghost = node.cloneNode(true) as HTMLElement;
		ghost.removeAttribute('data-engine');
		ghost.removeAttribute('data-engine-group');
		ghost.classList.add('engine-ghost');
		Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px` });
		document.body.appendChild(ghost);
		node.classList.add('engine-dragging');
		document.documentElement.classList.add('engine-drag-active');
		window.addEventListener('keydown', escape, true);
		place(e);
	}
	function place(e: PointerEvent) {
		if (ghost) ghost.style.transform = `translate(${e.clientX - offX}px, ${e.clientY - offY}px) rotate(-1.5deg)`;
	}
	function move(e: PointerEvent) {
		if (!active) {
			if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
			start(e);
		}
		e.preventDefault();
		place(e);
		const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el !== ghost && !ghost?.contains(el));
		const el = hit?.closest<HTMLElement>(`[data-engine-group="${CSS.escape(opts.group)}"]`) ?? null;
		if (el !== target) {
			clearTarget();
			target = el && el !== node ? el : null;
		}
		if (target) {
			const r = target.getBoundingClientRect();
			after = opts.axis === 'y' ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
			target.dataset.drop = after ? 'after' : 'before';
		}
	}
	function up() {
		const wasActive = active, to = target?.dataset.engine, side = after;
		finish();
		if (!wasActive) return;
		// A drag is not a click: swallow the click the browser fires after pointerup.
		const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
		window.addEventListener('click', swallow, { capture: true, once: true });
		setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
		if (to) commit(opts.id, to, side);
	}
	function key(e: KeyboardEvent) {
		if (!e.altKey) return;
		const back = opts.axis === 'y' ? e.key === 'ArrowUp' : e.key === 'ArrowLeft';
		const fwd = opts.axis === 'y' ? e.key === 'ArrowDown' : e.key === 'ArrowRight';
		if (!back && !fwd) return;
		e.preventDefault();
		const peers = [...document.querySelectorAll<HTMLElement>(`[data-engine-group="${CSS.escape(opts.group)}"]`)].map((x) => x.dataset.engine!);
		const i = peers.indexOf(opts.id);
		const neighbour = peers[back ? i - 1 : i + 1];
		if (neighbour) commit(opts.id, neighbour, fwd);
		queueMicrotask(() => (e.target as HTMLElement | null)?.focus());
	}

	node.addEventListener('pointerdown', down);
	node.addEventListener('keydown', key);
	return {
		update(next: EngineDragOptions) {
			opts = next;
			tag();
		},
		destroy() {
			finish();
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('keydown', key);
		}
	};
}
