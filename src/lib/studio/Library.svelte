<script lang="ts">
	import { tick } from 'svelte';
	import { BLOCKS, TEMPLATES } from './registry';
	import { studio } from './store.svelte';
	import type { BlockConfig } from './types';

	interface Item {
		key: string;
		type: string;
		label: string;
		description: string;
		group: 'Charts' | 'Text' | 'Sections';
		config?: BlockConfig;
		span?: number;
	}

	const open = $derived(!!studio.library);
	const page = $derived(studio.current);
	let q = $state('');
	let input = $state<HTMLInputElement>();
	let focused = $state<string>('');

	const SECTION_ORDER = ['Overview', 'Benchmarks', 'History', 'Features', 'Page'];
	const items: Item[] = [
		...TEMPLATES.map((t) => ({ key: t.id, type: t.type, label: t.label, description: t.description, group: 'Charts' as const, config: t.config, span: t.span })),
		{ key: 'chart', type: 'chart', label: 'Blank chart', description: 'Start from scratch: pick a chart type and a measure, or write a formula.', group: 'Charts' },
		...['note', 'heading'].map((t) => ({ key: t, type: t, label: BLOCKS[t].label, description: BLOCKS[t].description, group: 'Text' as const })),
		...Object.values(BLOCKS)
			.filter((d) => !['chart', 'note', 'heading'].includes(d.type))
			.sort((a, b) => SECTION_ORDER.indexOf(a.category) - SECTION_ORDER.indexOf(b.category))
			.map((d) => ({ key: d.type, type: d.type, label: d.label, description: d.description, group: 'Sections' as const }))
	];

	const unavailable = (it: Item) => {
		const def = BLOCKS[it.type];
		if (def.requires && !studio.ctx[def.requires]) return 'Only on its own page';
		if (def.unique && studio.layout(page).blocks.some((b) => b.type === it.type)) return 'Already on this page';
		return null;
	};
	const shown = $derived(items.filter((it) => !q.trim() || (it.label + ' ' + it.description + ' ' + it.group).toLowerCase().includes(q.trim().toLowerCase())));
	const groups = $derived((['Charts', 'Text', 'Sections'] as const).map((g) => ({ g, items: shown.filter((i) => i.group === g) })).filter((g) => g.items.length));
	const current = $derived(shown.find((i) => i.key === focused) ?? shown.find((i) => !unavailable(i)) ?? shown[0]);

	$effect(() => {
		if (open) {
			q = '';
			focused = '';
			tick().then(() => input?.focus());
		}
	});

	async function add(it: Item) {
		if (unavailable(it)) return;
		const id = studio.add(page, it.type, it.config, it.span, studio.library?.after);
		studio.library = null;
		if (!id) return;
		studio.editing = true;
		await tick();
		document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	// Drag an item out of the library to place it exactly where you drop it.
	let press: { it: Item; x: number; y: number } | null = null;
	function down(e: PointerEvent, it: Item) {
		if (e.button !== 0 || unavailable(it)) return;
		press = { it, x: e.clientX, y: e.clientY };
	}
	function move(e: PointerEvent) {
		if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) < 8) return;
		const it = press.it;
		press = null;
		const id = studio.add(page, it.type, it.config, it.span);
		studio.library = null;
		if (!id) return;
		studio.editing = true;
		studio.pendingDrag = { page, id, x: e.clientX, y: e.clientY };
	}

	function onkeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') studio.library = null;
		else if (e.key === 'Enter' && current && document.activeElement === input) add(current);
		else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && shown.length) {
			e.preventDefault();
			const i = Math.max(0, shown.indexOf(current!));
			focused = shown[(i + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length].key;
			tick().then(() => document.querySelector('.lib .item.on')?.scrollIntoView({ block: 'nearest' }));
		}
	}

	const PreviewComp = $derived(current ? BLOCKS[current.type].component : null);
	const previewConfig = $derived(current ? { ...BLOCKS[current.type].defaults(), ...(current.config ?? {}) } : {});
</script>

<svelte:window {onkeydown} onpointermove={move} onpointerup={() => (press = null)} />

{#if open}
	<div class="scrim" role="presentation" onclick={() => (studio.library = null)}></div>
	<div class="lib float" role="dialog" aria-modal="true" aria-label="Add a block">
		<div class="top">
			<input bind:this={input} type="search" bind:value={q} placeholder="Find a chart or section…" aria-label="Search blocks" />
			<button class="x" onclick={() => (studio.library = null)} aria-label="Close">Esc</button>
		</div>
		<div class="panes">
			<div class="list" role="listbox" aria-label="Blocks">
				{#each groups as g (g.g)}
					<div class="group-title">{g.g}</div>
					{#each g.items as it (it.key)}
						{@const why = unavailable(it)}
						<button
							class="item"
							class:on={current?.key === it.key}
							role="option"
							aria-selected={current?.key === it.key}
							aria-disabled={!!why}
							onmouseenter={() => (focused = it.key)}
							onfocus={() => (focused = it.key)}
							onpointerdown={(e) => down(e, it)}
							onclick={() => add(it)}
						>
							<span class="name">{it.label}</span>
							<span class="desc">{why ?? it.description}</span>
						</button>
					{/each}
				{:else}
					<div class="none fg3">Nothing matches “{q}”.</div>
				{/each}
			</div>
			<div class="preview">
				{#if current && PreviewComp}
					{@const why = unavailable(current)}
					<div class="pv-head">
						<div>
							<div class="pv-name">{current.label}</div>
							<div class="small fg3">{current.description}</div>
						</div>
						<button class="add" disabled={!!why} onclick={() => add(current)}>{why ?? 'Add to page'}</button>
					</div>
					<div class="stage" aria-hidden="true" inert>
						{#key current.key}
							<div class="scaled">
								<PreviewComp config={previewConfig} ctx={studio.ctx} editing={false} update={() => {}} />
							</div>
						{/key}
					</div>
					<div class="small fg3 hint">Live preview with current data · click to add, or drag it onto the page</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.35);
		z-index: 70;
	}
	.lib {
		position: fixed;
		z-index: 71;
		left: 50%;
		top: 6vh;
		transform: translateX(-50%);
		width: min(1080px, calc(100vw - 32px));
		height: min(720px, 86vh);
		display: flex;
		flex-direction: column;
		background: var(--bg2);
	}
	.top {
		display: flex;
		gap: 8px;
		padding: 12px;
		border-bottom: 1px solid var(--line);
	}
	.top input {
		flex: 1;
		background: var(--bg);
		border: 1px solid var(--line2);
		border-radius: 0;
		padding: 7px 10px;
		font-size: 13px;
	}
	.x {
		border: 1px solid var(--line2);
		padding: 2px 10px;
		color: var(--fg2);
	}
	.panes {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 300px 1fr;
	}
	.list {
		overflow: auto;
		border-right: 1px solid var(--line);
		padding: 4px 0 12px;
	}
	.group-title {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--fg3);
		padding: 12px 14px 4px;
	}
	.item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		padding: 7px 14px;
		text-align: left;
		cursor: grab;
		touch-action: none;
	}
	.item.on {
		background: var(--hover);
		box-shadow: inset 2px 0 var(--focus);
	}
	.item[aria-disabled='true'] {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.name {
		font-weight: 600;
		font-size: 13px;
	}
	.desc {
		font-size: 11px;
		color: var(--fg3);
		line-height: 1.35;
	}
	.preview {
		min-width: 0;
		display: flex;
		flex-direction: column;
		padding: 14px;
		gap: 10px;
		background: var(--bg);
	}
	.pv-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}
	.pv-name {
		font-size: 15px;
		font-weight: 600;
	}
	.add {
		background: var(--fg);
		color: var(--bg);
		padding: 6px 14px;
		font-size: 13px;
		flex: none;
	}
	.add:disabled {
		background: var(--line2);
		color: var(--fg3);
		cursor: not-allowed;
	}
	.stage {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		border: 1px solid var(--line);
		position: relative;
		background: var(--bg);
		-webkit-mask-image: linear-gradient(to bottom, #000 85%, transparent);
		mask-image: linear-gradient(to bottom, #000 85%, transparent);
	}
	/* Real component, rendered at full width and scaled to fit the stage. */
	.scaled {
		width: 154%;
		transform: scale(0.65);
		transform-origin: top left;
		padding: 14px;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 18px;
		pointer-events: none;
	}
	.hint {
		text-align: center;
	}
	.none {
		padding: 30px 14px;
	}
	@media (max-width: 760px) {
		.panes {
			grid-template-columns: 1fr;
		}
		.preview {
			display: none;
		}
	}
</style>
