// User-chosen column order. Runtime columns share one global order so every
// table, chart and chip row agrees; other tables keep their own order by key.
// Stored in this browser only.
import { browser } from '$app/environment';
import { CFG } from './data/runtimes';
import type { Cfg } from './data/types';

const KEY = 'wasmfyi:order:v1';

class ColumnOrder {
	/** Runtime config ids, in display order. Empty = default order. */
	cfg = $state<string[]>([]);
	/** Other tables' column orders, keyed by table. */
	cols = $state<Record<string, string[]>>({});

	constructor() {
		if (!browser) return;
		try {
			const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
			if (Array.isArray(raw.cfg)) this.cfg = raw.cfg.filter((x: unknown) => typeof x === 'string');
			if (raw.cols && typeof raw.cols === 'object') this.cols = raw.cols;
		} catch {
			/* ignore corrupt storage */
		}
	}

	#save() {
		if (!browser) return;
		try {
			localStorage.setItem(KEY, JSON.stringify({ cfg: $state.snapshot(this.cfg), cols: $state.snapshot(this.cols) }));
		} catch {}
	}

	/** Moves `id` before or after `target` within `all` (the full default order). */
	#moved(current: string[], all: string[], id: string, target: string, after: boolean): string[] {
		const base = arrange(all, (x) => x, current);
		const list = base.filter((x) => x !== id);
		const at = list.indexOf(target);
		if (at < 0 || id === target) return base;
		list.splice(after ? at + 1 : at, 0, id);
		return list;
	}

	moveCfg(id: string, target: string, after: boolean) {
		this.cfg = this.#moved(this.cfg, CFG.map((c) => c.id), id, target, after);
		this.#save();
	}
	moveCol(table: string, all: string[], id: string, target: string, after: boolean) {
		this.cols = { ...this.cols, [table]: this.#moved(this.cols[table] ?? [], all, id, target, after) };
		this.#save();
	}
	/** Keyboard: shift a column one place left (-1) or right (+1) among `visible`. */
	stepCfg(id: string, visible: string[], dir: -1 | 1) {
		const i = visible.indexOf(id);
		const t = visible[i + dir];
		if (t) this.moveCfg(id, t, dir > 0);
	}
	stepCol(table: string, all: string[], id: string, visible: string[], dir: -1 | 1) {
		const i = visible.indexOf(id);
		const t = visible[i + dir];
		if (t) this.moveCol(table, all, id, t, dir > 0);
	}
	get customized() {
		return this.cfg.length > 0 || Object.keys(this.cols).length > 0;
	}
	reset() {
		this.cfg = [];
		this.cols = {};
		this.#save();
	}
}

/** Stable sort of `list` by position in `order`; unknown items keep their place after known ones. */
export function arrange<T>(list: readonly T[], key: (t: T) => string, order: readonly string[]): T[] {
	if (!order.length) return [...list];
	const pos = new Map(order.map((k, i) => [k, i]));
	return list
		.map((t, i) => ({ t, i, p: pos.get(key(t)) ?? order.length + i }))
		.sort((a, b) => a.p - b.p || a.i - b.i)
		.map((x) => x.t);
}

export const columns = new ColumnOrder();

/** Runtime configs in the user's column order. */
export const ordered = (list: readonly Cfg[]): Cfg[] => arrange(list, (c) => c.id, columns.cfg);
