<script lang="ts">
	import { flip } from 'svelte/animate';
	import { onMount, tick } from 'svelte';
	import { BLOCKS, TEMPLATES } from './registry';
	import { studio } from './store.svelte';
	import MoveIcon from './MoveIcon.svelte';
	import type { BlockInstance, StudioCtx } from './types';

	/**
	 * Renders a page as an ordered list of blocks on a 12-column grid. Outside
	 * edit mode it looks like a plain stacked page; hovering a block reveals a
	 * ✥ grip that moves it directly.
	 */
	let { page, ctx = {} }: { page: string; ctx?: StudioCtx } = $props();

	$effect(() => {
		studio.current = page;
		studio.ctx = ctx;
	});
	onMount(() => {
		studio.hydrate();
		studio.loadShared(location.hash, page).then((ok) => {
			if (ok) history.replaceState(history.state, '', location.pathname + location.search);
		});
	});

	const layout = $derived(studio.layout(page));
	const editing = $derived(studio.editing);
	const blocks = $derived(layout.blocks.filter((b) => (!BLOCKS[b.type].requires || ctx[BLOCKS[b.type].requires!])));

	let gridEl = $state<HTMLDivElement>();
	let live = $state('');

	// ── Drag to reorder ────────────────────────────────────────────────────
	// The dragged block stays in flow as a placeholder; the list reorders live
	// as the pointer crosses other blocks and `animate:flip` slides the rest.
	let drag = $state<{ id: string; label: string; x: number; y: number; moved: boolean; sx: number; sy: number } | null>(null);
	let lastSwap = 0;
	let scrollRaf = 0;
	const DRAG_THRESHOLD = 4;

	function indexOf(id: string) {
		return layout.blocks.findIndex((b) => b.id === id);
	}

	function startDrag(e: PointerEvent, b: BlockInstance) {
		if (e.button !== 0) return;
		if ((e.target as Element).closest('.acts button, input, textarea, select')) return;
		e.preventDefault();
		studio.beginGesture(page);
		drag = { id: b.id, label: blockTitle(b), x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
		autoScroll();
	}

	// A block placed from the library arrives already "held" by the pointer.
	$effect(() => {
		const p = studio.pendingDrag;
		if (!p || p.page !== page) return;
		studio.pendingDrag = null;
		const b = layout.blocks.find((x) => x.id === p.id);
		if (!b) return;
		studio.beginGesture(page);
		drag = { id: b.id, label: blockTitle(b), x: p.x, y: p.y, sx: p.x, sy: p.y, moved: true };
		autoScroll();
		tick().then(() => onDragMove({ clientX: p.x, clientY: p.y } as PointerEvent));
	});

	function onDragMove(e: PointerEvent) {
		if (!drag || !gridEl) return;
		drag.x = e.clientX;
		drag.y = e.clientY;
		if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < DRAG_THRESHOLD) return;
		drag.moved = true;
		if (performance.now() - lastSwap < 140) return;
		const g = gridEl.getBoundingClientRect();
		// Layout boxes (offset*) ignore the transforms applied during flip animations.
		const els = [...gridEl.querySelectorAll<HTMLElement>(':scope > .blk')];
		const from = indexOf(drag.id);
		for (const el of els) {
			const id = el.dataset.id!;
			if (id === drag.id) continue;
			const left = g.left + el.offsetLeft;
			const top = g.top + el.offsetTop;
			if (e.clientX < left || e.clientX > left + el.offsetWidth || e.clientY < top || e.clientY > top + el.offsetHeight) continue;
			let to = indexOf(id);
			const sharesRow = el.offsetWidth < gridEl.clientWidth * 0.9;
			const after = sharesRow ? e.clientX > left + el.offsetWidth / 2 : e.clientY > top + el.offsetHeight / 2;
			if (from < to && !after) to -= 1;
			if (from > to && after) to += 1;
			if (to !== from) {
				studio.move(page, from, to, false);
				lastSwap = performance.now();
			}
			return;
		}
		// Below every block: move to the end.
		const last = els.at(-1);
		if (last && e.clientY > g.top + last.offsetTop + last.offsetHeight && from !== layout.blocks.length - 1) {
			studio.move(page, from, layout.blocks.length - 1, false);
			lastSwap = performance.now();
		}
	}

	function endDrag(cancel = false) {
		if (!drag) return;
		const { label, moved, id } = drag;
		drag = null;
		cancelAnimationFrame(scrollRaf);
		studio.endGesture(cancel);
		if (!moved && !cancel) {
			// A click on the hover grip (no movement) opens the block in the editor.
			if (!editing) {
				studio.editing = true;
				if (BLOCKS[layout.blocks.find((b) => b.id === id)?.type ?? '']?.fields?.length) studio.selected = id;
			}
			return;
		}
		live = cancel ? `Move of ${label} cancelled` : `${label} moved`;
		if (!cancel && !editing) studio.notify(`Moved ${label}`, page);
	}

	function autoScroll() {
		cancelAnimationFrame(scrollRaf);
		const step = () => {
			if (!drag) return;
			const edge = 80;
			const dy = drag.y < edge ? -(edge - drag.y) / 3 : drag.y > innerHeight - edge ? (drag.y - (innerHeight - edge)) / 3 : 0;
			if (dy && drag.moved) scrollBy(0, dy);
			scrollRaf = requestAnimationFrame(step);
		};
		scrollRaf = requestAnimationFrame(step);
	}

	// ── Resize from the right edge, snapping to grid columns ───────────────
	let resizing = $state<{ id: string; left: number; span: number; x: number; y: number } | null>(null);
	function startResize(e: PointerEvent, b: BlockInstance) {
		if (e.button !== 0 || !gridEl) return;
		e.preventDefault();
		e.stopPropagation();
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		const el = (e.currentTarget as HTMLElement).closest('.blk') as HTMLElement;
		studio.beginGesture(page);
		resizing = { id: b.id, left: el.getBoundingClientRect().left, span: b.span, x: e.clientX, y: e.clientY };
	}
	function onResizeMove(e: PointerEvent) {
		if (!resizing || !gridEl) return;
		resizing.x = e.clientX;
		resizing.y = e.clientY;
		const gap = parseFloat(getComputedStyle(gridEl).columnGap) || 0;
		const col = (gridEl.clientWidth + gap) / 12;
		const span = Math.max(1, Math.min(12, Math.round((e.clientX - resizing.left + gap) / col)));
		if (span !== resizing.span) {
			resizing.span = span;
			studio.setSpan(page, resizing.id, span, false);
		}
	}
	function endResize() {
		if (!resizing) return;
		resizing = null;
		studio.endGesture();
	}
	function toggleFull(b: BlockInstance) {
		studio.setSpan(page, b.id, b.span < 12 ? 12 : BLOCKS[b.type].span < 12 ? BLOCKS[b.type].span : 6);
	}
	const FRACTION: Record<number, string> = { 3: '¼', 4: '⅓', 6: '½', 8: '⅔', 9: '¾', 12: 'full' };
	const resizeSpan = $derived(resizing ? (layout.blocks.find((b) => b.id === resizing!.id)?.span ?? resizing.span) : 0);

	// ── Height: drag the bottom edge; very short collapses to the title ───
	const COLLAPSE_AT = 64;
	const SNAP = 20;
	let sizing = $state<{ id: string; top: number; natural: number; collapse: boolean; x: number; y: number; h: number } | null>(null);
	function startHeight(e: PointerEvent, b: BlockInstance) {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		const el = (e.currentTarget as HTMLElement).closest('.blk') as HTMLElement;
		const body = el.querySelector<HTMLElement>(':scope > .body');
		const content = body?.querySelector<HTMLElement>(':scope > .content');
		const top = (body ?? el).getBoundingClientRect().top;
		studio.beginGesture(page);
		if (b.collapsed) studio.setCollapsed(page, b.id, false, false);
		sizing = { id: b.id, top, natural: content?.scrollHeight ?? 400, collapse: false, x: e.clientX, y: e.clientY, h: b.height ?? content?.scrollHeight ?? 400 };
	}
	function onHeightMove(e: PointerEvent) {
		if (!sizing) return;
		sizing.x = e.clientX;
		sizing.y = e.clientY;
		const raw = e.clientY - sizing.top;
		sizing.collapse = raw < COLLAPSE_AT;
		const h = Math.max(COLLAPSE_AT, Math.round(raw / SNAP) * SNAP);
		sizing.h = h;
		// Past the content's natural height means "no limit".
		studio.setHeight(page, sizing.id, h >= sizing.natural - SNAP / 2 ? null : h, false);
	}
	function endHeight() {
		if (!sizing) return;
		if (sizing.collapse) studio.setCollapsed(page, sizing.id, true, false);
		sizing = null;
		studio.endGesture();
	}

	// Per-view state (not saved): temporarily expanded blocks and overflow flags.
	let expanded = $state<Record<string, boolean>>({});
	let overflows = $state<Record<string, boolean>>({});
	/** Reports whether the content is taller than the block's height limit. */
	function watchOverflow(node: HTMLElement, id: string) {
		const check = () => {
			const body = node.parentElement!;
			const over = node.scrollHeight > body.clientHeight + 2;
			if (overflows[id] !== over) overflows[id] = over;
		};
		const ro = new ResizeObserver(check);
		ro.observe(node);
		ro.observe(node.parentElement!);
		return { destroy: () => ro.disconnect() };
	}

	// ── Keyboard: move with arrows, resize with [ ], delete, settings ─────
	async function onHandleKey(e: KeyboardEvent, b: BlockInstance) {
		const i = indexOf(b.id);
		const keys: Record<string, () => void> = {
			ArrowUp: () => studio.move(page, i, i - 1),
			ArrowLeft: () => studio.move(page, i, i - 1),
			ArrowDown: () => studio.move(page, i, i + 1),
			ArrowRight: () => studio.move(page, i, i + 1),
			'[': () => studio.setSpan(page, b.id, b.span - 1),
			c: () => studio.setCollapsed(page, b.id, !b.collapsed),
			']': () => studio.setSpan(page, b.id, b.span + 1),
			f: () => toggleFull(b),
			Delete: () => studio.remove(page, b.id),
			Backspace: () => studio.remove(page, b.id),
			Enter: () => (studio.selected = b.id),
			d: () => studio.duplicate(page, b.id)
		};
		const fn = keys[e.key];
		if (!fn) return;
		e.preventDefault();
		e.stopPropagation();
		fn();
		live = `${blockTitle(b)}: position ${indexOf(b.id) + 1} of ${layout.blocks.length}, width ${layout.blocks.find((x) => x.id === b.id)?.span ?? 0} of 12`;
		await tick();
		gridEl?.querySelector<HTMLElement>(`[data-id="${b.id}"] .handle`)?.focus();
	}

	function blockTitle(b: BlockInstance) {
		const def = BLOCKS[b.type];
		return def?.title?.(b.config) || def?.label || b.type;
	}

	function onkeydown(e: KeyboardEvent) {
		if (drag && e.key === 'Escape') endDrag(true);
	}

	const quick = TEMPLATES.slice(0, 4);
</script>

<svelte:window
	{onkeydown}
	onpointermove={(e) => (drag ? onDragMove(e) : resizing ? onResizeMove(e) : sizing ? onHeightMove(e) : null)}
	onpointerup={() => (drag ? endDrag() : resizing ? endResize() : endHeight())}
	onpointercancel={() => (drag ? endDrag(true) : resizing ? endResize() : endHeight())}
/>

{#if studio.preview?.page === page}
	<div class="shared" role="status">
		<span><b>Viewing a shared layout.</b> It isn’t saved until you keep it.</span>
		<button class="btn-small primary" onclick={() => studio.keepPreview()}>Keep on this page</button>
		<button class="btn-small" onclick={() => (studio.preview = null)}>Discard</button>
	</div>
{/if}

<div class="grid" class:editing class:dragging={!!drag?.moved} class:resizing={!!resizing} class:sizing={!!sizing} bind:this={gridEl}>
	{#if drag?.moved || resizing}
		<div class="guides" aria-hidden="true">{#each Array(12) as _, i (i)}<span></span>{/each}</div>
	{/if}
	{#each blocks as b (b.id)}
		{@const def = BLOCKS[b.type]}
		{@const Comp = def.component}
		<section
			class="blk"
			class:selected={editing && studio.selected === b.id}
			class:ghost={drag?.moved && drag.id === b.id}
			data-id={b.id}
			data-type={b.type}
			style:--span={b.span}
			animate:flip={{ duration: 180 }}
		>
			{#if editing}
				<!-- The whole bar is a drag zone; buttons inside keep working. -->
				<div class="chrome" role="presentation" onpointerdown={(e) => startDrag(e, b)}>
					<button
						class="handle"
						aria-label="Move {blockTitle(b)}. Arrow keys move, [ and ] resize, F toggles full width, Enter opens settings."
						aria-roledescription="draggable block"
						onkeydown={(e) => onHandleKey(e, b)}
						data-tip="Drag to move · arrows move · [ ] resize · F full width · C collapse · Enter settings · D duplicate · Del remove"
					>
						<MoveIcon />
					</button>
					<span class="ttl" title={blockTitle(b)}>{blockTitle(b)}</span>
					<span class="span mono">{FRACTION[b.span] ?? b.span + '/12'}</span>
					<div class="acts">
						{#if def.fields?.length}
							<button onclick={() => (studio.selected = studio.selected === b.id ? null : b.id)} aria-pressed={studio.selected === b.id} data-tip="Settings (Enter)">⚙</button>
						{/if}
						<button onclick={() => studio.setCollapsed(page, b.id, !b.collapsed)} aria-pressed={!!b.collapsed} data-tip={b.collapsed ? 'Expand (C)' : 'Collapse to its title (C)'}>{b.collapsed ? '▸' : '▾'}</button>
						<button onclick={() => toggleFull(b)} data-tip={b.span < 12 ? 'Full width (F)' : 'Narrower (F)'}>{b.span < 12 ? '⇔' : '⇥'}</button>
						<button onclick={() => studio.duplicate(page, b.id)} disabled={def.unique} data-tip="Duplicate (D)">⧉</button>
						<button class="danger" onclick={() => studio.remove(page, b.id)} data-tip="Remove (Del) — undo with ⌘Z">✕</button>
					</div>
				</div>
			{:else}
				<button class="hover-grip" aria-label="Move {blockTitle(b)}, or click to customize" onpointerdown={(e) => startDrag(e, b)} data-tip="Drag to move · click to customize">
					<MoveIcon size={13} />
				</button>
			{/if}
			{#if b.collapsed && !expanded[b.id]}
				{#if !editing}
					<button class="collapsed-bar" onclick={() => (expanded[b.id] = true)} aria-expanded="false">
						<span class="chev">▸</span><span class="cb-title">{blockTitle(b)}</span><span class="small fg3">show</span>
					</button>
				{:else}
					<div class="collapsed-note small fg3">Collapsed — visitors see just its title. Drag the bottom edge down or press ▸ to expand.</div>
				{/if}
			{:else}
				{@const limited = !!b.height && !expanded[b.id]}
				<div class="body" class:limited inert={!!drag?.moved} style:max-height={limited ? b.height + 'px' : null}>
					<div class="content" use:watchOverflow={b.id}>
						<Comp config={b.config} {ctx} {editing} height={b.height} update={(patch, record = true) => studio.update(page, b.id, patch, record)} />
					</div>
					{#if limited && overflows[b.id]}
						<div class="fade" aria-hidden="true"></div>
						<button class="show-all" onclick={() => (expanded[b.id] = true)}>Show all ▾</button>
					{/if}
				</div>
				{#if expanded[b.id] && (b.height || b.collapsed)}
					<button class="show-less small" onclick={() => (expanded[b.id] = false)}>{b.collapsed ? 'Collapse ▴' : 'Show less ▴'}</button>
				{/if}
			{/if}
			{#if editing}
				<div
					class="resize"
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize {blockTitle(b)}"
					onpointerdown={(e) => startResize(e, b)}
					ondblclick={() => toggleFull(b)}
					data-tip="Drag to resize · double-click toggles full width"
				></div>
				<div
					class="vresize"
					role="separator"
					aria-orientation="horizontal"
					aria-label="Change the height of {blockTitle(b)}"
					onpointerdown={(e) => startHeight(e, b)}
					ondblclick={() => (studio.setHeight(page, b.id, null), studio.setCollapsed(page, b.id, false))}
					data-tip="Drag to make shorter · drag to the top to collapse · double-click for full height"
				></div>
			{/if}
		</section>
	{/each}
	{#if !blocks.length}
		<div class="empty">
			<div class="empty-title">This page is empty</div>
			<div class="fg3 small">Add a block, start from a template, or bring back the default layout.</div>
			<div class="empty-acts">
				<button class="btn-small primary" onclick={() => ((studio.editing = true), (studio.library = {}))}>＋ Add a block</button>
				{#each quick as t (t.id)}
					<button class="btn-small" onclick={() => ((studio.editing = true), studio.add(page, t.type, t.config, t.span))}>{t.label}</button>
				{/each}
				{#if studio.isCustom(page)}<button class="btn-small" onclick={() => studio.reset(page)}>Restore default</button>{/if}
			</div>
		</div>
	{:else if editing}
		<button class="add-tile" onclick={() => (studio.library = {})}>
			<span class="plus">＋</span> Add a block
			<span class="small fg3">charts, notes, sections from any page · or drag one in from the library</span>
		</button>
	{/if}
</div>

{#if drag?.moved}
	<div class="drag-pill" style:left="{drag.x + 14}px" style:top="{drag.y + 10}px" aria-hidden="true"><MoveIcon size={11} /> {drag.label}</div>
{/if}
{#if sizing}
	<div class="drag-pill" class:warn={sizing.collapse} style:left="{sizing.x + 14}px" style:top="{sizing.y + 10}px" aria-hidden="true">
		{sizing.collapse ? '▸ Release to collapse' : sizing.h >= sizing.natural - SNAP / 2 ? '⇕ Full height' : `⇕ ${sizing.h}px`}
	</div>
{/if}
{#if resizing}
	<div class="drag-pill" style:left="{resizing.x + 14}px" style:top="{resizing.y + 10}px" aria-hidden="true">⇔ {resizeSpan}/12 {FRACTION[resizeSpan] ? '· ' + FRACTION[resizeSpan] : ''}</div>
{/if}
<div class="sr" aria-live="polite">{live}</div>

<style>
	.grid {
		/* Offset parent for the blocks: drag hit-testing uses offsetLeft/Top. */
		position: relative;
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		gap: 18px 24px;
		align-items: start;
	}
	.guides {
		position: absolute;
		inset: -8px 0;
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		gap: 0 24px;
		pointer-events: none;
		z-index: 0;
	}
	.guides span {
		background: color-mix(in oklch, var(--focus) 7%, transparent);
		border-left: 1px dashed color-mix(in oklch, var(--focus) 30%, transparent);
		border-right: 1px dashed color-mix(in oklch, var(--focus) 30%, transparent);
	}
	.blk {
		grid-column: span var(--span, 12);
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 18px;
		position: relative;
	}
	.body {
		position: relative;
		min-width: 0;
	}
	.body.limited {
		overflow: hidden;
	}
	.content {
		display: flex;
		flex-direction: column;
		gap: 18px;
		min-width: 0;
	}
	.fade {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 64px;
		background: linear-gradient(to bottom, transparent, var(--bg) 85%);
		pointer-events: none;
	}
	.show-all {
		position: absolute;
		left: 50%;
		bottom: 8px;
		transform: translateX(-50%);
		border: 1px solid var(--line2);
		background: var(--bg2);
		padding: 3px 12px;
		font-size: 12px;
		color: var(--fg2);
		box-shadow: var(--shadow-float);
	}
	.show-all:hover,
	.show-less:hover {
		color: var(--fg);
		border-color: var(--fg3);
	}
	.show-less {
		align-self: center;
		border: 1px solid var(--line2);
		padding: 2px 10px;
		color: var(--fg2);
		margin-top: -8px;
	}
	.collapsed-bar {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		border: 1px solid var(--line);
		background: var(--bg2);
		padding: 9px 14px;
		text-align: left;
	}
	.collapsed-bar:hover {
		border-color: var(--fg3);
	}
	.chev {
		color: var(--fg3);
		width: 10px;
	}
	.cb-title {
		font-weight: 600;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.collapsed-note {
		border: 1px dashed var(--line2);
		padding: 8px 12px;
	}
	.vresize {
		position: absolute;
		left: 0;
		right: 0;
		bottom: -13px;
		height: 12px;
		cursor: ns-resize;
		touch-action: none;
		z-index: 2;
	}
	.vresize::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 4px;
		width: 32px;
		height: 3px;
		transform: translateX(-50%);
		background: var(--line2);
		transition: width 0.12s, background 0.12s;
	}
	.vresize:hover::after {
		background: var(--focus);
		width: 56px;
	}
	.sizing,
	.sizing * {
		cursor: ns-resize !important;
		user-select: none;
	}
	.drag-pill.warn {
		background: var(--st-warn);
		color: #000;
	}
	@media (max-width: 760px) {
		.blk {
			grid-column: span 12;
		}
	}

	/* Hover grip outside edit mode */
	.hover-grip {
		position: absolute;
		top: 2px;
		right: -21px;
		width: 18px;
		height: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--fg3);
		background: var(--bg);
		border: 1px solid var(--line2);
		opacity: 0;
		transition: opacity 0.15s;
		cursor: grab;
		touch-action: none;
		z-index: 3;
	}
	.blk:hover > .hover-grip,
	.hover-grip:focus-visible {
		opacity: 1;
	}
	.hover-grip:hover {
		color: var(--fg);
		border-color: var(--fg3);
	}
	@media (hover: none) {
		.hover-grip {
			display: none;
		}
	}

	/* Edit mode */
	.editing .blk {
		outline: 1px dashed var(--line2);
		outline-offset: 6px;
		gap: 10px;
		margin-bottom: 6px;
	}
	.editing .blk:hover,
	.editing .blk.selected {
		outline: 1px solid var(--fg3);
	}
	.editing .blk.selected {
		outline-color: var(--focus);
	}
	.ghost {
		opacity: 0.5;
	}
	.ghost::after {
		content: '';
		position: absolute;
		inset: -6px;
		border: 2px dashed var(--focus);
		background: color-mix(in oklch, var(--focus) 6%, transparent);
		pointer-events: none;
	}
	.dragging,
	.dragging * {
		cursor: grabbing !important;
		user-select: none;
	}
	.resizing,
	.resizing * {
		cursor: ew-resize !important;
		user-select: none;
	}
	.chrome {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		color: var(--fg3);
		min-width: 0;
		margin: -2px 0 0;
		cursor: grab;
		touch-action: none;
		padding: 2px 0;
	}
	.chrome:hover .handle {
		color: var(--fg);
		border-color: var(--fg3);
	}
	.handle {
		cursor: grab;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: 1px solid var(--line2);
		color: var(--fg2);
		flex: none;
		background: var(--bg2);
	}
	.ttl {
		font-weight: 500;
		color: var(--fg2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.span {
		font-size: 10px;
		color: var(--fg3);
		flex: none;
	}
	.acts {
		margin-left: auto;
		display: flex;
		gap: 2px;
		flex: none;
		cursor: default;
	}
	.acts button {
		width: 24px;
		height: 22px;
		color: var(--fg2);
		text-align: center;
		font-size: 12px;
	}
	.acts button:hover:not(:disabled) {
		background: var(--hover);
		color: var(--fg);
	}
	.acts button[aria-pressed='true'] {
		color: var(--focus);
	}
	.acts button:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.acts .danger:hover {
		color: var(--st-fail) !important;
	}
	.resize {
		position: absolute;
		top: 0;
		bottom: 0;
		right: -12px;
		width: 12px;
		cursor: ew-resize;
		touch-action: none;
		z-index: 2;
	}
	.resize::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 4px;
		width: 3px;
		height: 32px;
		transform: translateY(-50%);
		background: var(--line2);
		transition: height 0.12s, background 0.12s;
	}
	.resize:hover::after {
		background: var(--focus);
		height: 56px;
	}
	.add-tile {
		grid-column: span 12;
		border: 1px dashed var(--line2);
		padding: 18px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 6px 10px;
		color: var(--fg2);
		font-size: 13px;
	}
	.add-tile:hover {
		border-color: var(--fg3);
		color: var(--fg);
		background: var(--hover);
	}
	.plus {
		font-size: 16px;
	}
	.empty {
		grid-column: span 12;
		border: 1px dashed var(--line2);
		padding: 40px 20px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		text-align: center;
	}
	.empty-title {
		font-size: 16px;
		font-weight: 600;
	}
	.empty-acts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		justify-content: center;
		margin-top: 8px;
	}
	.drag-pill {
		position: fixed;
		z-index: 9000;
		pointer-events: none;
		background: var(--fg);
		color: var(--bg);
		font-size: 12px;
		padding: 4px 10px;
		box-shadow: var(--shadow-float);
		white-space: nowrap;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.shared {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		border: 1px solid var(--focus);
		background: var(--bg2);
		padding: 8px 12px;
		font-size: 12px;
	}
	.primary {
		background: var(--fg);
		color: var(--bg);
		border-color: var(--fg);
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
