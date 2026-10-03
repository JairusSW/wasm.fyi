// Studio state: page layouts (stored as overrides on top of defaults), edit
// mode, undo/redo, local persistence, dashboards and share links.
import { browser } from '$app/environment';
import { BLOCKS, defaultLayout, newId, sanitize } from './registry';
import type { BlockConfig, BlockInstance, Layout, StudioCtx } from './types';

const KEY = 'wasmfyi:studio:v1';
const HISTORY_LIMIT = 100;

export interface Dashboard {
	id: string;
	name: string;
}

const clone = <T>(v: T): T => structuredClone($state.snapshot(v) as T);
const json = (l: Layout) => JSON.stringify(l);

class StudioStore {
	editing = $state(false);
	overrides = $state<Record<string, Layout>>({});
	dashboards = $state<Dashboard[]>([{ id: 'main', name: 'My dashboard' }]);
	/** Page key of the mounted Studio, so global controls know what to act on. */
	current = $state<string>('home');
	ctx = $state<StudioCtx>({});
	selected = $state<string | null>(null);
	library = $state<{ after?: string } | null>(null);
	palette = $state(false);
	/** A shared layout being previewed (not yet saved). */
	preview = $state<{ page: string; layout: Layout } | null>(null);
	toast = $state<{ text: string; undo?: string } | null>(null);
	/** A block just placed from the library that the pointer is still holding. */
	pendingDrag = $state<{ page: string; id: string; x: number; y: number } | null>(null);
	/** Shortcut help overlay. */
	help = $state(false);
	/** Timestamp of the last saved change, for the "Saved" indicator. */
	savedAt = $state(0);
	hydrated = $state(false);
	/** Bumped whenever undo/redo stacks change, so derived UI updates. */
	rev = $state(0);

	#past: Record<string, string[]> = {};
	#future: Record<string, string[]> = {};
	#gesture: { page: string; before: string } | null = null;
	#toastTimer: ReturnType<typeof setTimeout> | undefined;

	layout(page: string): Layout {
		if (this.preview?.page === page) return this.preview.layout;
		return this.overrides[page] ?? defaultLayout(page);
	}
	isCustom(page: string) {
		return !!this.overrides[page];
	}
	canUndo(page: string) {
		void this.rev;
		return !!this.#past[page]?.length;
	}
	canRedo(page: string) {
		void this.rev;
		return !!this.#future[page]?.length;
	}

	/** Shows a toast; pass a page to offer an Undo button for its last change. */
	notify(msg: string, undo?: string) {
		this.toast = { text: msg, undo };
		clearTimeout(this.#toastTimer);
		this.#toastTimer = setTimeout(() => (this.toast = null), undo ? 5000 : 2600);
	}

	/** Replace a page layout. `record` adds an undo step. */
	commit(page: string, next: Layout, record = true) {
		if (this.preview?.page === page) {
			this.preview = { page, layout: next };
			return;
		}
		if (record) {
			(this.#past[page] ??= []).push(json(this.layout(page)));
			if (this.#past[page].length > HISTORY_LIMIT) this.#past[page].shift();
			this.#future[page] = [];
			this.rev++;
		}
		this.overrides[page] = next;
		this.persist();
	}

	#edit(page: string, fn: (blocks: BlockInstance[]) => BlockInstance[] | void, record = true) {
		const l = clone(this.layout(page));
		const out = fn(l.blocks);
		this.commit(page, { v: 1, blocks: out ?? l.blocks }, record);
	}

	/** Start a drag/resize gesture: intermediate updates don't record; `endGesture` records one step. */
	beginGesture(page: string) {
		this.#gesture = { page, before: json(this.layout(page)) };
	}
	endGesture(cancel = false) {
		const g = this.#gesture;
		this.#gesture = null;
		if (!g) return;
		if (cancel) {
			this.commit(g.page, JSON.parse(g.before), false);
			return;
		}
		if (json(this.layout(g.page)) === g.before || this.preview?.page === g.page) return;
		(this.#past[g.page] ??= []).push(g.before);
		this.#future[g.page] = [];
		this.rev++;
	}

	move(page: string, from: number, to: number, record = true) {
		if (from === to) return;
		this.#edit(page, (bs) => {
			const [x] = bs.splice(from, 1);
			bs.splice(Math.max(0, Math.min(bs.length, to)), 0, x);
		}, record);
	}

	add(page: string, type: string, config?: BlockConfig, span?: number, after?: string): string | null {
		const def = BLOCKS[type];
		if (!def) return null;
		const blocks = this.layout(page).blocks;
		if (def.unique && blocks.some((b) => b.type === type)) {
			this.notify(`${def.label} is already on this page`);
			return null;
		}
		const id = newId();
		this.#edit(page, (bs) => {
			const at = after ? bs.findIndex((b) => b.id === after) + 1 : bs.length;
			bs.splice(at > 0 ? at : bs.length, 0, { id, type, span: span ?? def.span, config: { ...def.defaults(), ...structuredClone(config ?? {}) } });
		});
		return id;
	}

	remove(page: string, id: string) {
		const b = this.layout(page).blocks.find((x) => x.id === id);
		this.#edit(page, (bs) => bs.filter((x) => x.id !== id));
		if (this.selected === id) this.selected = null;
		if (b) this.notify(`Removed ${BLOCKS[b.type]?.label ?? 'block'}`, page);
	}

	duplicate(page: string, id: string) {
		const src = this.layout(page).blocks.find((x) => x.id === id);
		if (!src) return;
		if (BLOCKS[src.type]?.unique) return this.notify(`${BLOCKS[src.type].label} can only appear once per page`);
		const copy = { ...clone(src), id: newId() };
		this.#edit(page, (bs) => {
			bs.splice(bs.findIndex((x) => x.id === id) + 1, 0, copy);
		});
		return copy.id;
	}

	update(page: string, id: string, patch: BlockConfig, record = true) {
		this.#edit(page, (bs) => {
			const b = bs.find((x) => x.id === id);
			if (b) b.config = { ...b.config, ...structuredClone(patch) };
		}, record);
	}

	setSpan(page: string, id: string, span: number, record = true) {
		this.#edit(page, (bs) => {
			const b = bs.find((x) => x.id === id);
			if (!b) return;
			const def = BLOCKS[b.type];
			b.span = Math.max(def?.minSpan ?? 1, Math.min(12, Math.round(span)));
		}, record);
	}

	/** Max height in px, or null for the natural height. */
	setHeight(page: string, id: string, height: number | null, record = true) {
		this.#edit(page, (bs) => {
			const b = bs.find((x) => x.id === id);
			if (!b) return;
			if (height == null) delete b.height;
			else b.height = Math.max(40, Math.round(height));
		}, record);
	}

	setCollapsed(page: string, id: string, collapsed: boolean, record = true) {
		this.#edit(page, (bs) => {
			const b = bs.find((x) => x.id === id);
			if (b) b.collapsed = collapsed || undefined;
		}, record);
	}

	/** Copy a block onto another page (e.g. a chart into a dashboard). */
	copyTo(page: string, id: string, target: string) {
		const src = this.layout(page).blocks.find((x) => x.id === id);
		if (!src) return;
		const def = BLOCKS[src.type];
		if (def?.requires) return this.notify(`${def.label} only works on its own page`);
		const t = clone(this.layout(target));
		t.blocks.push({ ...clone(src), id: newId() });
		const prev = this.current;
		this.commit(target, t);
		this.current = prev;
		this.notify(`Copied to ${this.pageName(target)}`);
	}

	undo(page: string) {
		const prev = this.#past[page]?.pop();
		if (prev == null) return;
		(this.#future[page] ??= []).push(json(this.layout(page)));
		this.overrides[page] = JSON.parse(prev);
		this.rev++;
		this.persist();
	}
	redo(page: string) {
		const next = this.#future[page]?.pop();
		if (next == null) return;
		(this.#past[page] ??= []).push(json(this.layout(page)));
		this.overrides[page] = JSON.parse(next);
		this.rev++;
		this.persist();
	}

	reset(page: string) {
		if (!this.overrides[page]) return;
		(this.#past[page] ??= []).push(json(this.layout(page)));
		this.rev++;
		delete this.overrides[page];
		this.persist();
		this.notify('Layout reset to default', page);
	}

	/** Apply a whole layout (template, import) as one undo step. */
	apply(page: string, layout: Layout, message?: string) {
		this.commit(page, layout);
		if (message) this.notify(message, page);
	}

	exportJSON(page: string) {
		return JSON.stringify({ format: 'wasm.fyi/layout', version: 1, page, layout: this.layout(page) }, null, 2);
	}
	importJSON(page: string, text: string): string | null {
		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch {
			return 'Not valid JSON';
		}
		const obj = data as { layout?: unknown; type?: string; config?: BlockConfig };
		if (obj && obj.type && BLOCKS[obj.type] && obj.config) {
			this.add(page, obj.type, obj.config);
			return null;
		}
		const l = sanitize(obj?.layout ?? data);
		if (!l) return 'This file is not a wasm.fyi layout or chart';
		this.apply(page, this.#forPage(page, l), 'Layout imported');
		return null;
	}
	/** Remove blocks whose required page context is missing. */
	#forPage(page: string, l: Layout): Layout {
		const ctxKeys = { bench: page === 'bench', proposal: page === 'proposal' };
		return { v: 1, blocks: l.blocks.filter((b) => !BLOCKS[b.type].requires || ctxKeys[BLOCKS[b.type].requires!]) };
	}

	// ── Share links ────────────────────────────────────────────────────────
	async shareUrl(page: string): Promise<string> {
		const payload = JSON.stringify({ p: page, l: this.layout(page) });
		const url = new URL(location.href);
		url.hash = 'layout=' + (await encode(payload));
		return url.toString();
	}
	/** Reads `#layout=…`; returns true when a shared layout is now previewed. */
	async loadShared(hash: string, page: string): Promise<boolean> {
		const m = /^#layout=([A-Za-z0-9_-]+)$/.exec(hash);
		if (!m) return false;
		try {
			const data = JSON.parse(await decode(m[1])) as { p?: string; l?: unknown };
			const l = sanitize(data.l);
			if (!l) throw new Error('invalid');
			this.preview = { page, layout: this.#forPage(page, l) };
			return true;
		} catch {
			this.notify('That shared layout link is damaged or from an incompatible version');
			return false;
		}
	}
	keepPreview() {
		const p = this.preview;
		if (!p) return;
		this.preview = null;
		this.commit(p.page, p.layout);
		this.notify('Shared layout saved to this page');
	}

	// ── Dashboards ─────────────────────────────────────────────────────────
	pageName(page: string) {
		if (page.startsWith('dash:')) return this.dashboards.find((d) => 'dash:' + d.id === page)?.name ?? 'Dashboard';
		return { home: 'Home', benchmarks: 'Benchmarks', history: 'History', features: 'Features', proposal: 'Proposal pages', bench: 'Workload pages', compare: 'Compare' }[page] ?? page;
	}
	createDashboard(name = 'Untitled dashboard', from?: Layout): string {
		const id = newId().slice(1, 9);
		this.dashboards.push({ id, name });
		if (from) this.overrides['dash:' + id] = clone(from);
		else this.overrides['dash:' + id] = { v: 1, blocks: [{ id: newId(), type: 'heading', span: 12, config: { ...BLOCKS.heading.defaults(), eyebrow: 'Dashboard', title: name, rule: false } }] };
		this.persist();
		return id;
	}
	renameDashboard(id: string, name: string) {
		const d = this.dashboards.find((x) => x.id === id);
		if (d) d.name = name.trim().slice(0, 80) || d.name;
		this.persist();
	}
	deleteDashboard(id: string) {
		if (this.dashboards.length <= 1) return this.notify('Keep at least one dashboard');
		this.dashboards = this.dashboards.filter((d) => d.id !== id);
		delete this.overrides['dash:' + id];
		this.persist();
	}

	// ── Persistence ────────────────────────────────────────────────────────
	persist() {
		if (!browser) return;
		try {
			localStorage.setItem(KEY, JSON.stringify({ v: 1, layouts: $state.snapshot(this.overrides), dashboards: $state.snapshot(this.dashboards) }));
			this.savedAt = Date.now();
		} catch {
			this.notify('Could not save layout (storage unavailable)');
		}
	}
	hydrate() {
		if (!browser || this.hydrated) return;
		this.hydrated = true;
		try {
			const raw = localStorage.getItem(KEY);
			if (!raw) return;
			const data = JSON.parse(raw) as { layouts?: Record<string, unknown>; dashboards?: Dashboard[] };
			const layouts: Record<string, Layout> = {};
			for (const [k, v] of Object.entries(data.layouts ?? {})) {
				const l = sanitize(v);
				if (l && /^[\w:-]{1,40}$/.test(k)) layouts[k] = l;
			}
			this.overrides = layouts;
			const dash = (data.dashboards ?? []).filter((d) => d && typeof d.id === 'string' && typeof d.name === 'string');
			if (dash.length) this.dashboards = dash;
		} catch {
			/* corrupt storage: fall back to defaults */
		}
	}
}

// deflate-raw + base64url keeps share links short; plain base64url is the fallback.
async function encode(text: string): Promise<string> {
	const bytes = new TextEncoder().encode(text);
	if (typeof CompressionStream === 'undefined') return 'j' + b64(bytes);
	const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
	return 'd' + b64(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function decode(s: string): Promise<string> {
	const kind = s[0];
	const bytes = unb64(s.slice(1));
	if (kind === 'j') return new TextDecoder().decode(bytes);
	if (kind !== 'd') throw new Error('Unknown encoding');
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	const out = new Uint8Array(await new Response(stream).arrayBuffer());
	if (out.length > 2_000_000) throw new Error('Too large');
	return new TextDecoder().decode(out);
}
const b64 = (bytes: Uint8Array) => {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (s: string) => {
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export const studio = new StudioStore();
