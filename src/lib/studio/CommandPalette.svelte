<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$lib/navigation';
	import { benchHref, href, PROPOSAL_IDS, siteHref } from '$lib/links';
	import { PROPS } from '$lib/data/features';
	import { ALLB } from '$lib/data/snapshot';
	import { MACH } from '$lib/data/runtimes';
	import type { MachineId } from '$lib/data/types';
	import { workloadName } from '$lib/format';
	import { ui } from '$lib/state.svelte';
	import { BLOCKS, TEMPLATES } from './registry';
	import { PRESETS } from './presets';
	import { studio } from './store.svelte';

	interface Cmd {
		id: string;
		group: string;
		label: string;
		hint?: string;
		run: () => void;
	}

	let q = $state('');
	let active = $state(0);
	let input = $state<HTMLInputElement>();
	let list = $state<HTMLDivElement>();

	$effect(() => {
		if (studio.palette) {
			q = '';
			active = 0;
			tick().then(() => input?.focus());
		}
	});

	const go = (path: string) => () => goto(siteHref(path));
	const page = $derived(studio.current);
	const theme = () => {
		ui.theme = ui.theme === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = ui.theme;
		try {
			localStorage.setItem('theme', ui.theme);
		} catch {}
	};
	const addBlock = (type: string, config?: Record<string, unknown>, span?: number) => () => {
		studio.editing = true;
		const id = studio.add(page, type, config, span);
		if (id && BLOCKS[type].fields?.length) studio.selected = id;
		tick().then(() => document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
	};

	const commands = $derived.by((): Cmd[] => [
		{ id: 'edit', group: 'Layout', label: studio.editing ? 'Finish editing layout' : 'Customize this page', hint: 'E', run: () => (studio.editing = !studio.editing) },
		{ id: 'add', group: 'Layout', label: 'Add a block…', run: () => ((studio.editing = true), (studio.library = {})) },
		{ id: 'undo', group: 'Layout', label: 'Undo layout change', hint: '⌘Z', run: () => studio.undo(page) },
		{ id: 'redo', group: 'Layout', label: 'Redo layout change', hint: '⇧⌘Z', run: () => studio.redo(page) },
		{ id: 'share', group: 'Layout', label: 'Copy share link for this layout', run: async () => { await navigator.clipboard.writeText(await studio.shareUrl(page)); studio.notify('Share link copied'); } },
		...(studio.isCustom(page) ? [{ id: 'reset', group: 'Layout', label: 'Reset this page to its default layout', run: () => studio.reset(page) }] : []),
		...PRESETS.filter((p) => !p.pages || p.pages.includes(page)).map((p) => ({ id: 'preset-' + p.id, group: 'Presets', label: 'Apply preset: ' + p.label, hint: p.description, run: () => studio.apply(page, p.build(page), `Applied “${p.label}” · ⌘Z to undo`) })),
		...TEMPLATES.map((t) => ({ id: t.id, group: 'Add chart', label: 'Add chart: ' + t.label, hint: t.description, run: addBlock(t.type, t.config, t.span) })),
		...Object.values(BLOCKS)
			.filter((d) => !d.requires || studio.ctx[d.requires])
			.map((d) => ({ id: 'block-' + d.type, group: 'Add block', label: 'Add block: ' + d.label, hint: d.description, run: addBlock(d.type) })),
		{ id: 'nav-home', group: 'Go to', label: 'Home', run: go('/') },
		{ id: 'nav-bench', group: 'Go to', label: 'Benchmarks', run: go('/benchmarks') },
		{ id: 'nav-history', group: 'Go to', label: 'History', run: go('/history') },
		{ id: 'nav-features', group: 'Go to', label: 'Features', run: go('/features') },
		{ id: 'nav-compare', group: 'Go to', label: 'Startup vs throughput model', run: go('/compare') },
		...studio.dashboards.map((d) => ({ id: 'dash-' + d.id, group: 'Go to', label: 'Dashboard: ' + d.name, run: () => goto(siteHref(href('/studio', { d: d.id === 'main' ? null : d.id }))) })),
		{ id: 'new-dash', group: 'Go to', label: 'New dashboard', run: () => { const id = studio.createDashboard(); goto(siteHref(href('/studio', { d: id }))); studio.editing = true; } },
		...PROPOSAL_IDS.map((id) => ({ id: 'prop-' + id, group: 'Go to', label: 'Proposal: ' + PROPS[id].title, run: go('/' + id) })),
		...ALLB.filter((b) => !b.id.startsWith('features/')).map((b) => ({ id: 'w-' + b.id, group: 'Workloads', label: workloadName(b.id), hint: b.group, run: () => goto(siteHref(benchHref(b.id))) })),
		{ id: 'theme', group: 'View', label: ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', run: theme },
		...(Object.keys(MACH) as MachineId[]).filter((m) => m !== ui.machine).map((m) => ({ id: 'm-' + m, group: 'View', label: 'Switch machine: ' + MACH[m].l.split('—')[0].trim(), run: () => (ui.machine = m) })),
		{ id: 'snap', group: 'View', label: ui.snap === 's1' ? 'Show previous snapshot' : 'Show latest snapshot', run: () => (ui.snap = ui.snap === 's1' ? 's2' : 's1') },
		{ id: 'all-rt', group: 'View', label: 'Show all runtimes', run: () => (ui.hide = {}) }
	]);

	/** Subsequence match with a bonus for word starts and contiguous runs. */
	function score(text: string, query: string): number {
		if (!query) return 1;
		const t = text.toLowerCase();
		const qq = query.toLowerCase();
		if (t.includes(qq)) return 100 - t.indexOf(qq) + (t.startsWith(qq) ? 50 : 0);
		let i = 0;
		let s = 0;
		let run = 0;
		for (const ch of qq) {
			const j = t.indexOf(ch, i);
			if (j < 0) return 0;
			run = j === i ? run + 1 : 0;
			s += 1 + run + (j === 0 || /[\s:/-]/.test(t[j - 1]) ? 3 : 0);
			i = j + 1;
		}
		return s;
	}

	const results = $derived.by(() => {
		const query = q.trim();
		const scored = commands.map((c) => ({ c, s: score(c.label + ' ' + c.group, query) })).filter((x) => x.s > 0);
		if (query) scored.sort((a, b) => b.s - a.s);
		// Without a query, hide the long workload list.
		return scored.filter((x) => query || x.c.group !== 'Workloads' && x.c.group !== 'Add block').slice(0, 60).map((x) => x.c);
	});

	$effect(() => {
		void q;
		active = 0;
	});

	function run(c: Cmd) {
		studio.palette = false;
		c.run();
	}
	function onkeydown(e: KeyboardEvent) {
		if (!studio.palette) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			studio.palette = false;
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = Math.min(results.length - 1, active + 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = Math.max(0, active - 1);
		} else if (e.key === 'Enter' && results[active]) {
			e.preventDefault();
			run(results[active]);
		} else return;
		tick().then(() => list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
	}
</script>

<svelte:window {onkeydown} />

{#if studio.palette}
	<div class="scrim" role="presentation" onclick={() => (studio.palette = false)}></div>
	<div class="pal float" role="dialog" aria-modal="true" aria-label="Command palette">
		<input
			bind:this={input}
			bind:value={q}
			placeholder="Type a command, page, chart or workload…"
			aria-label="Command"
			role="combobox"
			aria-expanded="true"
			aria-controls="cmd-list"
			aria-activedescendant={results[active] ? 'cmd-' + active : undefined}
		/>
		<div class="list" id="cmd-list" role="listbox" bind:this={list}>
			{#each results as c, i (c.id)}
				{#if i === 0 || results[i - 1].group !== c.group}<div class="grp">{c.group}</div>{/if}
				<button id="cmd-{i}" role="option" aria-selected={i === active} onmouseenter={() => (active = i)} onclick={() => run(c)}>
					<span class="lbl">{c.label}</span>
					{#if c.hint}<span class="hint">{c.hint}</span>{/if}
				</button>
			{:else}
				<div class="none">No matching commands.</div>
			{/each}
		</div>
		<div class="foot"><span>↑↓ navigate</span><span>↵ run</span><span>esc close</span></div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.35);
		z-index: 80;
	}
	.pal {
		position: fixed;
		z-index: 81;
		left: 50%;
		top: 12vh;
		transform: translateX(-50%);
		width: min(620px, calc(100vw - 32px));
		background: var(--bg2);
		display: flex;
		flex-direction: column;
		max-height: 70vh;
	}
	input {
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--line);
		padding: 14px 16px;
		font-size: 15px;
		outline: none;
	}
	.list {
		overflow: auto;
		padding: 4px 0;
	}
	.grp {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--fg3);
		padding: 8px 16px 4px;
	}
	button {
		display: flex;
		width: 100%;
		gap: 12px;
		justify-content: space-between;
		align-items: baseline;
		padding: 7px 16px;
		text-align: left;
		font-size: 13px;
	}
	button[aria-selected='true'] {
		background: var(--hover);
		box-shadow: inset 2px 0 var(--focus);
	}
	.lbl {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hint {
		font-size: 11px;
		color: var(--fg3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 45%;
	}
	.none {
		padding: 20px 16px;
		color: var(--fg3);
		font-size: 12px;
	}
	.foot {
		display: flex;
		gap: 16px;
		padding: 7px 16px;
		border-top: 1px solid var(--line);
		font-size: 11px;
		color: var(--fg3);
	}
</style>
