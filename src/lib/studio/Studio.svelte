<script lang="ts">
	import { flip } from 'svelte/animate';
	import { onMount, tick } from 'svelte';
	import { BLOCKS } from './registry';
	import { studio } from './store.svelte';
	import type { BlockInstance, StudioCtx } from './types';

	/**
	 * Renders a page as an ordered list of blocks on a 12-column grid. Outside
	 * edit mode it is visually identical to a plain stacked page.
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
	const blocks = $derived(layout.blocks.filter((b) => (editing || !b.hidden) && (!BLOCKS[b.type].requires || ctx[BLOCKS[b.type].requires!])));

	let gridEl = $state<HTMLDivElement>();
	let live = $state('');

	// ── Drag to reorder ────────────────────────────────────────────────────
	// The dragged block stays in flow as a placeholder; the list reorders live
	// as the pointer crosses other blocks and `animate:flip` slides the rest.
	let drag = $state<{ id: string; label: string; x: number; y: number } | null>(null);
	let lastSwap = 0;
	let scrollRaf = 0;

	function indexOf(id: string) {
		return layout.blocks.findIndex((b) => b.id === id);
	}

	function startDrag(e: PointerEvent, b: BlockInstance) {
		if (e.button !== 0) return;
		e.preventDefault();
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		studio.beginGesture(page);
		drag = { id: b.id, label: blockTitle(b), x: e.clientX, y: e.clientY };
		autoScroll();
	}

	function onDragMove(e: PointerEvent) {
		if (!drag || !gridEl) return;
		drag.x = e.clientX;
		drag.y = e.clientY;
		if (performance.now() - lastSwap < 140) return;
		const g = gridEl.getBoundingClientRect();
		// Layout boxes (offset*) ignore the transforms applied during flip animations.
		for (const el of gridEl.querySelectorAll<HTMLElement>(':scope > .blk')) {
			const id = el.dataset.id!;
			if (id === drag.id) continue;
			const left = g.left + el.offsetLeft;
			const top = g.top + el.offsetTop;
			if (e.clientX < left || e.clientX > left + el.offsetWidth || e.clientY < top || e.clientY > top + el.offsetHeight) continue;
			const from = indexOf(drag.id);
			let to = indexOf(id);
			const sharesRow = el.offsetWidth < gridEl.clientWidth * 0.9;
			const after = sharesRow ? e.clientX > left + el.offsetWidth / 2 : e.clientY > top + el.offsetHeight / 2;
			if (from < to && !after) to -= 1;
			if (from > to && after) to += 1;
			if (to !== from) {
				studio.move(page, from, to, false);
				lastSwap = performance.now();
			}
			break;
		}
	}

	function endDrag(cancel = false) {
		if (!drag) return;
		const label = drag.label;
		drag = null;
		cancelAnimationFrame(scrollRaf);
		studio.endGesture(cancel);
		live = cancel ? `Move of ${label} cancelled` : `${label} moved`;
	}

	function autoScroll() {
		cancelAnimationFrame(scrollRaf);
		const step = () => {
			if (!drag) return;
			const edge = 70;
			const dy = drag.y < edge ? -(edge - drag.y) / 3 : drag.y > innerHeight - edge ? (drag.y - (innerHeight - edge)) / 3 : 0;
			if (dy) scrollBy(0, dy);
			scrollRaf = requestAnimationFrame(step);
		};
		scrollRaf = requestAnimationFrame(step);
	}

	// ── Resize from the right edge, snapping to grid columns ───────────────
	let resizing = $state<{ id: string; left: number; span: number } | null>(null);
	function startResize(e: PointerEvent, b: BlockInstance) {
		if (e.button !== 0 || !gridEl) return;
		e.preventDefault();
		e.stopPropagation();
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		const el = (e.currentTarget as HTMLElement).closest('.blk') as HTMLElement;
		studio.beginGesture(page);
		resizing = { id: b.id, left: el.getBoundingClientRect().left, span: b.span };
	}
	function onResizeMove(e: PointerEvent) {
		if (!resizing || !gridEl) return;
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

	// ── Keyboard: move with arrows, resize with [ ], delete, settings ─────
	async function onHandleKey(e: KeyboardEvent, b: BlockInstance) {
		const i = indexOf(b.id);
		const keys: Record<string, () => void> = {
			ArrowUp: () => studio.move(page, i, i - 1),
			ArrowLeft: () => studio.move(page, i, i - 1),
			ArrowDown: () => studio.move(page, i, i + 1),
			ArrowRight: () => studio.move(page, i, i + 1),
			'[': () => studio.setSpan(page, b.id, b.span - 1),
			']': () => studio.setSpan(page, b.id, b.span + 1),
			Delete: () => studio.remove(page, b.id),
			Backspace: () => studio.remove(page, b.id),
			Enter: () => (studio.selected = b.id),
			d: () => studio.duplicate(page, b.id),
			h: () => studio.toggleHidden(page, b.id)
		};
		const fn = keys[e.key];
		if (!fn) return;
		e.preventDefault();
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
</script>

<svelte:window {onkeydown} onpointermove={(e) => (drag ? onDragMove(e) : resizing ? onResizeMove(e) : null)} onpointerup={() => (drag ? endDrag() : endResize())} onpointercancel={() => (drag ? endDrag(true) : endResize())} />

{#if studio.preview?.page === page}
	<div class="shared" role="status">
		<span><b>Viewing a shared layout.</b> It isn’t saved until you keep it.</span>
		<button class="btn-small primary" onclick={() => studio.keepPreview()}>Keep on this page</button>
		<button class="btn-small" onclick={() => (studio.preview = null)}>Discard</button>
	</div>
{/if}

<div class="grid" class:editing class:dragging={!!drag} class:resizing={!!resizing} bind:this={gridEl}>
	{#each blocks as b (b.id)}
		{@const def = BLOCKS[b.type]}
		{@const Comp = def.component}
		<section
			class="blk"
			class:hidden-blk={b.hidden}
			class:selected={editing && studio.selected === b.id}
			class:ghost={drag?.id === b.id}
			data-id={b.id}
			data-type={b.type}
			style:--span={b.span}
			animate:flip={{ duration: 180 }}
		>
			{#if editing}
				<div class="chrome">
					<button
						class="handle"
						aria-label="Move {blockTitle(b)}. Arrow keys move, [ and ] resize, Enter opens settings."
						aria-roledescription="draggable block"
						onpointerdown={(e) => startDrag(e, b)}
						onkeydown={(e) => onHandleKey(e, b)}
						data-tip="Drag to move · arrows move · [ ] resize · Enter settings · D duplicate · H hide · Del remove"
					>
						<svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true"><g fill="currentColor">{#each [0, 1, 2] as r (r)}<circle cx="2.5" cy={2.5 + r * 4.5} r="1.3" /><circle cx="7.5" cy={2.5 + r * 4.5} r="1.3" />{/each}</g></svg>
					</button>
					<span class="ttl" title={blockTitle(b)}>{blockTitle(b)}</span>
					<span class="span mono">{b.span}/12</span>
					<div class="acts">
						{#if def.fields?.length}
							<button onclick={() => (studio.selected = studio.selected === b.id ? null : b.id)} aria-pressed={studio.selected === b.id} data-tip="Settings">⚙</button>
						{/if}
						<button onclick={() => (studio.library = { after: b.id })} data-tip="Insert a block after this one">＋</button>
						<button onclick={() => studio.duplicate(page, b.id)} disabled={def.unique} data-tip="Duplicate">⧉</button>
						<button onclick={() => studio.toggleHidden(page, b.id)} aria-pressed={b.hidden} data-tip={b.hidden ? 'Show on the page' : 'Hide without deleting'}>{b.hidden ? '◌' : '◉'}</button>
						<button class="danger" onclick={() => studio.remove(page, b.id)} data-tip="Remove (undo with ⌘Z)">✕</button>
					</div>
				</div>
			{/if}
			<div class="body" inert={editing && !!drag}>
				<Comp config={b.config} {ctx} {editing} update={(patch) => studio.update(page, b.id, patch)} />
			</div>
			{#if editing}
				<div class="resize" role="separator" aria-orientation="vertical" aria-label="Resize {blockTitle(b)}" onpointerdown={(e) => startResize(e, b)} data-tip="Drag to resize"></div>
			{/if}
		</section>
	{/each}
	{#if editing}
		<button class="add-tile" onclick={() => (studio.library = {})}>
			<span class="plus">＋</span> Add a block
			<span class="small fg3">charts, notes, sections from any page</span>
		</button>
	{/if}
</div>

{#if drag}
	<div class="drag-pill" style:left="{drag.x + 14}px" style:top="{drag.y + 10}px" aria-hidden="true">↕ {drag.label}</div>
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
	.blk {
		grid-column: span var(--span, 12);
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 18px;
		position: relative;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 18px;
		min-width: 0;
	}
	@media (max-width: 760px) {
		.blk {
			grid-column: span 12;
		}
	}

	/* Edit mode */
	.editing .blk {
		outline: 1px dashed var(--line2);
		outline-offset: 6px;
		gap: 10px;
	}
	.editing .blk:hover,
	.editing .blk.selected {
		outline: 1px solid var(--fg3);
	}
	.editing .blk.selected {
		outline-color: var(--focus);
	}
	.hidden-blk .body {
		opacity: 0.35;
	}
	.ghost {
		opacity: 0.45;
	}
	.ghost::after {
		content: '';
		position: absolute;
		inset: -6px;
		border: 2px dashed var(--focus);
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
	}
	.handle {
		cursor: grab;
		touch-action: none;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: 1px solid var(--line2);
		color: var(--fg2);
		flex: none;
	}
	.handle:hover {
		color: var(--fg);
		border-color: var(--fg3);
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
	}
	.resize:hover::after {
		background: var(--focus);
	}
	.add-tile {
		grid-column: span 12;
		border: 1px dashed var(--line2);
		padding: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
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
