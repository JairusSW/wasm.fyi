<script lang="ts">
	import { tick } from 'svelte';
	import { BLOCKS, CATEGORIES, TEMPLATES } from './registry';
	import { PRESETS } from './presets';
	import { studio } from './store.svelte';

	const open = $derived(!!studio.library);
	const page = $derived(studio.current);
	let q = $state('');
	let cat = $state<string>('All');
	let input = $state<HTMLInputElement>();

	$effect(() => {
		if (open) {
			q = '';
			tick().then(() => input?.focus());
		}
	});

	const available = (type: string) => {
		const def = BLOCKS[type];
		if (def.requires && !studio.ctx[def.requires]) return 'Only on its own page';
		if (def.unique && studio.layout(page).blocks.some((b) => b.type === type)) return 'Already on this page';
		return null;
	};
	const match = (...s: string[]) => !q.trim() || s.join(' ').toLowerCase().includes(q.trim().toLowerCase());

	const templates = $derived(cat === 'All' || cat === 'Charts' ? TEMPLATES.filter((t) => match(t.label, t.description, 'chart')) : []);
	const blocks = $derived(Object.values(BLOCKS).filter((d) => (cat === 'All' || d.category === cat) && match(d.label, d.description, d.category)));
	const presets = $derived(cat === 'All' || cat === 'Layouts' ? PRESETS.filter((p) => (!p.pages || p.pages.includes(page)) && match(p.label, p.description, 'layout')) : []);

	async function add(type: string, config?: Record<string, unknown>, span?: number) {
		const id = studio.add(page, type, config, span, studio.library?.after);
		studio.library = null;
		if (!id) return;
		studio.selected = BLOCKS[type].fields?.length ? id : null;
		await tick();
		document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}
	function applyPreset(id: string) {
		const p = PRESETS.find((x) => x.id === id);
		if (!p) return;
		studio.apply(page, p.build(page), `Applied “${p.label}” · ⌘Z to undo`);
		studio.library = null;
	}
	function onkeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') studio.library = null;
	}
</script>

<svelte:window {onkeydown} />

{#if open}
	<div class="scrim" role="presentation" onclick={() => (studio.library = null)}></div>
	<div class="lib float" role="dialog" aria-modal="true" aria-label="Add a block">
		<div class="top">
			<input bind:this={input} type="search" bind:value={q} placeholder="Search blocks, charts and layouts…" aria-label="Search the block library" />
			<button class="x" onclick={() => (studio.library = null)} aria-label="Close">Esc</button>
		</div>
		<div class="cats" role="tablist">
			{#each ['All', ...CATEGORIES, 'Layouts'] as c (c)}
				<button role="tab" aria-selected={cat === c} onclick={() => (cat = c)}>{c}</button>
			{/each}
		</div>
		<div class="scroll">
			{#if presets.length}
				<div class="group-title">Layout presets <span class="fg3">replace the whole page</span></div>
				<div class="cards">
					{#each presets as p (p.id)}
						<button class="item preset" onclick={() => applyPreset(p.id)}>
							<span class="name">{p.label}</span>
							<span class="desc">{p.description}</span>
						</button>
					{/each}
				</div>
			{/if}
			{#if templates.length}
				<div class="group-title">Chart templates</div>
				<div class="cards">
					{#each templates as t (t.id)}
						<button class="item" onclick={() => add(t.type, t.config, t.span)}>
							<span class="tag">chart</span>
							<span class="name">{t.label}</span>
							<span class="desc">{t.description}</span>
						</button>
					{/each}
				</div>
			{/if}
			{#if blocks.length}
				<div class="group-title">Blocks</div>
				<div class="cards">
					{#each blocks as d (d.type)}
						{@const why = available(d.type)}
						<button class="item" disabled={!!why} onclick={() => add(d.type)} data-tip={why ?? undefined}>
							<span class="tag">{d.category.toLowerCase()}</span>
							<span class="name">{d.type === 'chart' ? 'Blank chart' : d.label}</span>
							<span class="desc">{why ?? d.description}</span>
						</button>
					{/each}
				</div>
			{/if}
			{#if !presets.length && !templates.length && !blocks.length}
				<div class="none fg3">Nothing matches “{q}”.</div>
			{/if}
		</div>
		<div class="foot small fg3">Blocks are added {studio.library?.after ? 'after the selected block' : 'at the end of the page'}. Drag them anywhere afterwards.</div>
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
		top: 8vh;
		transform: translateX(-50%);
		width: min(860px, calc(100vw - 32px));
		max-height: 84vh;
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
	.cats {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		padding: 0 12px;
		border-bottom: 1px solid var(--line);
	}
	.cats button {
		padding: 7px 10px 6px;
		font-size: 12px;
		color: var(--fg2);
		border-bottom: 2px solid transparent;
	}
	.cats button[aria-selected='true'] {
		color: var(--fg);
		border-bottom-color: var(--fg);
	}
	.scroll {
		overflow: auto;
		padding: 4px 12px 12px;
	}
	.group-title {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg2);
		padding: 12px 0 8px;
	}
	.group-title .fg3 {
		text-transform: none;
		letter-spacing: 0;
		margin-left: 6px;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: 8px;
	}
	.item {
		border: 1px solid var(--line);
		background: var(--bg);
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		text-align: left;
		position: relative;
	}
	.item:hover:not(:disabled) {
		border-color: var(--fg3);
		background: var(--hover);
	}
	.item:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.preset {
		border-color: var(--line2);
	}
	.tag {
		position: absolute;
		top: 8px;
		right: 10px;
		font-family: var(--mono);
		font-size: 10px;
		color: var(--fg3);
	}
	.name {
		font-weight: 600;
		font-size: 13px;
		padding-right: 60px;
	}
	.desc {
		font-size: 12px;
		color: var(--fg2);
		line-height: 1.4;
	}
	.none {
		padding: 30px;
		text-align: center;
	}
	.foot {
		padding: 8px 12px;
		border-top: 1px solid var(--line);
	}
</style>
