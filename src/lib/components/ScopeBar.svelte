<script lang="ts">
 import {page} from '$app/state';
	import {shortVersion} from '$lib/version-identity';
	import { tipCard, tipWho } from '$lib/tip';
	import { CFG, MACH, execOf, langOf, type Exec } from '$lib/data/runtimes';
	import type { MachineId } from '$lib/data/types';
	import {untrack} from 'svelte';
	import {datasetView} from '$lib/api/view.svelte';
	import { ui } from '$lib/state.svelte';
	import Swatch from './Swatch.svelte';
	import Seg from './Seg.svelte';
	import Select from './Select.svelte';
	import { viewData } from '$lib/view-data';

	const SNAP_OPTS = [
		['s1', 'Latest snapshot'],
	] as const;

	$effect(() => {datasetView.machine=ui.machine;untrack(()=>{const count=viewData.history[ui.machine].points.length;ui.histTo=Math.max(0,count-1);ui.histFrom=Math.min(ui.histFrom,Math.max(0,count-1));});});
	$effect(() => { if (ui.snap !== 's1') ui.snap = 's1'; });
	const shown = $derived(CFG.filter((c) => !ui.scope.hide[c.id]));
 const featureComparison=$derived(page.route.id==='/features');
	// Phones collapse the scope controls behind a one-line summary.
	let open = $state(false);

	// Desktop: the bar sticks to the top. Once scrolled past, the runtime chips fold into a
	// swatch summary; hovering or focusing the bar, or scrolling back up, unfolds them.
	let sentinel = $state<HTMLElement>();
	let chipsEl = $state<HTMLElement>();
	let stuck = $state(false);
	let hovering = $state(false);
	let focused = $state(false);
	let chipsH = $state(0);
	// Once the bar reaches the top it is pinned (position: fixed) and a placeholder keeps its full
	// unfolded height in the page, so folding and unfolding never move the content below.
	let sectionEl = $state<HTMLElement>();
	let fullH = $state(0);
	$effect(() => {
		if (!sentinel) return;
		const wide = matchMedia('(min-width: 721px)');
		const check = () => {
			const next = wide.matches && sentinel!.getBoundingClientRect().top < 0;
			if (next && !stuck && sectionEl) fullH = sectionEl.getBoundingClientRect().height;
			stuck = next;
		};
		check();
		addEventListener('scroll', check, { passive: true });
		addEventListener('resize', check);
		wide.addEventListener('change', check);
		return () => {
			removeEventListener('scroll', check);
			removeEventListener('resize', check);
			wide.removeEventListener('change', check);
		};
	});
	const compact = $derived(stuck && !hovering && !focused && !ui.adv);
	// Hover intent: unfold after a short rest, fold a moment after leaving, so brushing past
	// the bar on the way to the page doesn't make it flicker.
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;
	function enter() {
		clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => (hovering = true), 90);
	}
	function leave() {
		clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => (hovering = false), 320);
	}
	// Folding never changes layout: the bar keeps its height and only transforms and opacity
	// animate (GPU-composited). The chips' height says how far the backdrop slides up.
	$effect(() => {
		if (!chipsEl || !sectionEl) return;
		const ro = new ResizeObserver(() => {
			chipsH = chipsEl!.offsetHeight;
			if (stuck) fullH = sectionEl!.offsetHeight;
		});
		ro.observe(chipsEl);
		ro.observe(sectionEl);
		return () => ro.disconnect();
	});

	// Filtered out by the execution-model or language switch rather than by its own chip.
	const filteredOut = (c: (typeof CFG)[number]) => (ui.exec !== 'all' && execOf(c) !== ui.exec) || (ui.lang !== 'all' && langOf(c) !== ui.lang);
	function toggle(id: (typeof CFG)[number]['id']) {
		const c = CFG.find((x) => x.id === id)!;
		// A chip outside the filters widens them to All and adds just that runtime.
		if (filteredOut(c)) {
			ui.hide = { ...ui.scope.hide, [id]: false };
			ui.exec = 'all';
			ui.lang = 'all';
			return;
		}
		ui.hide = { ...ui.hide, [id]: !ui.hide[id] };
	}
	function solo(e: MouseEvent, id: string) {
		e.preventDefault();
		const c = CFG.find((x) => x.id === id)!;
		if (filteredOut(c)) {
			ui.exec = 'all';
			ui.lang = 'all';
		}
		ui.hide = Object.fromEntries(CFG.map((x) => [x.id, x.id !== id]));
	}

	// Execution filter: hides the other execution model on top of the per-runtime chips.
	const onMachine = $derived(CFG.filter((c) => viewData.hosts[ui.machine].configurations[c.id]));
	const execMissing = $derived((['compiler', 'interpreter'] as const).filter((k) => !onMachine.some((c) => execOf(c) === k)));
	// Every chip counts, including runtimes with no results on this machine.
	const someHidden = $derived(CFG.some((c) => ui.scope.hide[c.id]));
	const someShown = $derived(CFG.some((c) => !ui.scope.hide[c.id]));
	// A machine without the selected execution model would show an empty table.
	$effect(() => {
		// Wait for the machine's configurations to load; an empty list is not "missing".
		if (onMachine.length && ui.exec !== 'all' && execMissing.includes(ui.exec)) untrack(() => (ui.exec = 'all'));
	});
	function setExec(kind: Exec) {
		ui.exec = kind;
		ui.hide = {};
	}
	// Language filter: every implementation language among the runtimes, most runtimes first;
	// languages with no results on this machine stay listed but disabled.
	const langs = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const c of CFG) counts.set(langOf(c), (counts.get(langOf(c)) ?? 0) + 1);
		return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
	});
	const langMissing = $derived(langs.filter((l) => !onMachine.some((c) => langOf(c) === l)));
	$effect(() => {
		if (onMachine.length && ui.lang !== 'all' && langMissing.includes(ui.lang)) untrack(() => (ui.lang = 'all'));
	});
	function setLang(lang: string) {
		ui.lang = lang;
		ui.hide = {};
	}
	// Hides every runtime so you can build a selection up chip by chip.
	function hideAll() {
		ui.hide = Object.fromEntries(CFG.map((x) => [x.id, true]));
	}
	function showAll() {
		ui.exec = 'all';
		ui.lang = 'all';
		ui.hide = {};
	}

	const advItems = $derived([
		{ k: 'OS', v: MACH[ui.machine].os },
		{ k: 'Runtimes', v: Object.values(viewData.hosts[ui.machine].configurations).map(c=>c!.runtime+' '+shortVersion(c!.version)).join(' · ') },
		{ k: 'Aggregation', v: (ui.average==='mean'?'mean':'geomean')+', every workload weighted equally · '+(ui.cohortMode==='shared'?(featureComparison?'passed by every selected engine':'least-covered engine reference'):'passed per engine') },
		{ k: 'Cache state', v: 'cold — no on-disk artifact cache' },
		{ k: 'Compilation workers', v: 'Per-runtime configuration; CPU affinity uncontrolled' },
		{ k: 'Warmup & sampling', v: 'Per-cell sealed report records launches, samples and warmups' },
		{ k: 'Feature flags', v: 'Pinned adapter configuration in each sealed report; optional configurations separate' },
		{ k: 'Instrumentation', v: 'none in timing runs · memory from linked runs' },
		{ k: 'Isolation', v: 'Scheduling, frequency and filesystem caches uncontrolled' }
	]);
</script>

<div class="sentinel" bind:this={sentinel} aria-hidden="true"></div>
<div class="slot" style:height={stuck ? `${fullH}px` : undefined}>
<section
	aria-label="Comparison scope"
	class:open
	class:compact
	style:--chips-h="{chipsH}px"
	bind:this={sectionEl}
	class:stuck
	onmouseenter={enter}
	onmouseleave={leave}
	onfocusin={() => (focused = true)}
	onfocusout={(e) => (focused = e.currentTarget.contains(e.relatedTarget as Node))}
>
	<div class="backdrop" aria-hidden="true"></div>
	<button class="summary" aria-expanded={open} aria-controls="scope-controls" onclick={() => (open = !open)}>
		<span class="swatches" aria-hidden="true">
			{#each shown as c (c.id)}<Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} size={7} />{/each}
		</span>
		<span class="sum-text">
			<span class="sum-machine">{MACH[ui.machine].l}</span>
			<span class="sum-meta fg3">Latest snapshot · {shown.length}/{CFG.length} runtimes · Δ {ui.deltaFormat === 'factor' ? '×' : '%'}</span>
		</span>
		<span class="sum-action">{open ? 'Done' : 'Scope'}<span class="caret" aria-hidden="true">▾</span></span>
	</button>
	<div class="line" id="scope-controls">
		<div class="main">
			<Select class="machine" label="Machine" options={Object.entries(MACH).map(([v, m]): [MachineId, string] => [v as MachineId, m.l])} value={ui.machine} onselect={(v) => (ui.machine = v)} />
			<div class="exec" data-tip="Compilers: JIT, baseline & AOT">
				<Seg options={[['all', 'All'], ['compiler', 'Compilers'], ['interpreter', 'Interpreters']]} value={ui.exec} onselect={setExec} disabled={execMissing} label="Execution model" />
			</div>
			{#if langs.length > 1}
				<div class="exec" data-tip="Language each runtime is implemented in">
					<Seg options={[['all', 'All'], ...langs.map((l): [string, string] => [l, l])]} value={ui.lang} onselect={setLang} disabled={langMissing} label="Implementation language" />
				</div>
			{/if}
			<Select class="snap" label="Snapshot" options={SNAP_OPTS.map(([v, l]) => [v, l] as [typeof ui.snap, string])} value={ui.snap} onselect={(v) => (ui.snap = v)} />
			<span class="mini" class:show={compact} aria-hidden={!compact} aria-label="{shown.length} of {CFG.length} runtimes shown">
				<span class="swatches">{#each shown as c (c.id)}<Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} size={7} />{/each}</span>
				<span class="small fg3">{shown.length}/{CFG.length}</span>
			</span>
		</div>
		<div class="side">
            <div class="delta-format">
                <Seg options={[['per-engine', 'Passed per engine'], ['shared', 'Passed on all engines']]} value={ui.cohortMode} onselect={v=>ui.cohortMode=v as 'shared' | 'per-engine'} label="Average corpus selection" tips={[tipCard({ title: 'Each engine’s own passes', vis: 'cohort-each', note: 'green = averaged' }), tipCard({ title: featureComparison?'Passed by every selected engine':'Least-covered engine’s passing workloads', note: featureComparison?'Only contracts passed and measured by every selected engine enter feature comparisons. Dimmed, crossed-out cells are excluded.':'Use the smallest passing corpus set among shown engines. An average requires every workload in that reference set.' })]} />
            </div>
			<div class="delta-format">
				<Seg options={[['geo', 'Geomean'], ['mean', 'Mean']]} value={ui.average} onselect={(v) => (ui.average = v as 'geo' | 'mean')} label="Average" tips={[tipCard({ title: 'Geometric mean', vis: 'avg-geo' }), tipCard({ title: 'Plain mean', vis: 'avg-mean' })]} />
			</div>
			<div class="delta-format">
				<span class="small fg3">Deltas</span>
				<Seg options={['factor', 'percent'].map(v=>[v as 'factor' | 'percent',v==='factor'?'×':'%'])} value={ui.deltaFormat} onselect={v=>ui.deltaFormat=v} label="Delta format" mono tips={[tipCard({ title: 'Deltas as factors', value: '1.30×' }), tipCard({ title: 'Deltas as percent', value: '+30%' })]} />
			</div>
			<button class="btn-small adv" aria-expanded={ui.adv} onclick={() => (ui.adv = !ui.adv)}>
				{ui.adv ? 'Hide run settings' : 'Run settings'}
			</button>
		</div>
	</div>
		<div class="chips-fold" aria-hidden={compact}>
		<div class="chips" id="scope-chips" role="group" aria-label="Runtimes shown" bind:this={chipsEl} inert={compact}>
			{#each CFG as c (c.id)}
				{@const on = !ui.scope.hide[c.id]}
				<button
					class="chip"
					class:off={!on}
					aria-pressed={on}
					onclick={() => toggle(c.id)}
					ondblclick={(e) => solo(e, c.id)}
					data-tip-card={tipCard({ who: tipWho(c, viewData.hosts[ui.machine].configurations[c.id]?.version || 'not collected'), note: c.kind, chips: on ? [] : ['hidden'], action: on ? 'hide · double-click to show only this' : 'show · double-click to solo' })}
				>
					<Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} />{c.rt}
					<span class="be">{c.label ?? c.be}</span>
				</button>
			{/each}
			<button class="all" onclick={showAll} disabled={!someHidden}>Show all</button>
			<button class="all" onclick={hideAll} disabled={!someShown}>Hide all</button>
		</div>
		</div>
	{#if ui.adv}
		<div class="adv-grid">
			{#each advItems as a (a.k)}
				<div class="kv"><span class="small fg3">{a.k}</span><span class="mono">{a.v}</span></div>
			{/each}
		</div>
	{/if}
</section>
</div>

<style>
	section {
		background: var(--bg2);
		border-bottom: 1px solid var(--line);
		padding: 8px max(var(--gutter), env(safe-area-inset-right)) 8px max(var(--gutter), env(safe-area-inset-left));
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.summary {
		display: none;
	}
	.backdrop {
		display: none;
	}
	@media (min-width: 721px) {
		/* The backdrop (background, edge, shadow) is its own layer so it can slide; the section
		   itself stays transparent and the same height whether folded or not. */
		section {
			position: relative;
			z-index: 20;
			background: transparent;
			border-bottom: 0;
			--ease: cubic-bezier(0.22, 1, 0.36, 1);
			--fold: calc(var(--chips-h) + 8px);
		}
		section.stuck {
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
		}
		.backdrop {
			display: block;
			position: absolute;
			inset: 0;
			z-index: -1;
			background: var(--bg2);
			border-bottom: 1px solid var(--line);
			transition: transform 0.42s var(--ease), box-shadow 0.3s ease;
			will-change: transform;
		}
		section.stuck .backdrop {
			box-shadow: 0 6px 18px -10px rgb(0 0 0 / 0.55);
		}
		.chips-fold {
			transition: opacity 0.28s var(--ease), transform 0.42s var(--ease);
			will-change: transform, opacity;
		}
		/* Folded: the backdrop slides up to the controls line, the chips lift and fade, and the
		   empty area lets the pointer through to the page. */
		section.compact {
			pointer-events: none;
		}
		section.compact .line {
			pointer-events: auto;
		}
		section.compact .backdrop {
			transform: translateY(calc(-1 * var(--fold)));
		}
		section.compact .chips-fold {
			opacity: 0;
			transform: translateY(-14px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.backdrop,
		.chips-fold,
		.mini,
		.chip {
			transition: none !important;
		}
	}
	.mini {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: default;
		opacity: 0;
		visibility: hidden;
		transform: translateX(-8px);
		transition: opacity 0.2s ease, transform 0.36s cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 0.2s;
	}
	.mini.show {
		opacity: 1;
		visibility: visible;
		transform: none;
		transition: opacity 0.26s ease 0.08s, transform 0.36s cubic-bezier(0.22, 1, 0.36, 1) 0.08s, visibility 0s;
	}
	@media (max-width: 720px) {
		.mini {
			display: none;
		}
	}
	.mini .swatches {
		display: inline-flex;
		gap: 2px;
	}
	.line {
		display: flex;
		gap: 8px 12px;
		align-items: flex-start;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 8px 10px;
		align-items: center;
	}
	.side {
		flex: none;
		display: flex;
		gap: 10px;
		align-items: center;
		min-height: 26px;
	}
	.main :global(.machine) {
		max-width: 100%;
	}
	/* Runtime chips span the full bar width; each row stretches its chips to fill it. */
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		width: 100%;
	}
	/* Takes the spare space in the last row only, so a short last row keeps natural widths. */
	.chips::after {
		content: '';
		flex: 1000 1 0;
	}
	.chip {
		flex: 1 1 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		border: 1px solid var(--line2);
		padding: 2px 6px;
		font-size: 12px;
		transition: opacity 0.22s ease, border-color 0.22s ease, background-color 0.22s ease, transform 0.12s ease;
	}
	.chip:hover {
		border-color: var(--fg3);
	}
	.chip:active {
		transform: scale(0.97);
	}
	.chip.off {
		border-color: var(--line);
		opacity: 0.4;
	}
	.be {
		color: var(--fg3);
		font-size: 11px;
	}
	.all {
		padding: 2px 4px;
		font-size: 12px;
		color: var(--fg2);
		text-decoration: underline;
	}
	.all:disabled {
		color: var(--fg3);
		opacity: 0.5;
		text-decoration: none;
		cursor: default;
	}
	.adv {
		padding: 3px 9px;
		white-space: nowrap;
	}
	.delta-format {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.adv-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
		gap: 6px 18px;
		font-size: 12px;
		border-top: 1px solid var(--line);
		padding-top: 8px;
	}
	.kv {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.kv .mono {
		overflow-wrap: anywhere;
	}

	@media (max-width: 720px) {
		section {
			padding: 0 max(16px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left));
			gap: 0;
		}
		.summary {
			display: flex;
			align-items: center;
			gap: 10px;
			width: 100%;
			min-height: 48px;
			padding: 6px 0;
			text-align: left;
		}
		/* a compact two-row strip of the shown runtimes */
		.swatches {
			display: grid;
			grid-auto-flow: column;
			grid-template-rows: repeat(2, 7px);
			gap: 3px;
			flex: none;
			max-width: 34vw;
			overflow: hidden;
		}
		.sum-text {
			display: flex;
			flex-direction: column;
			min-width: 0;
			flex: 1;
		}
		.sum-machine,
		.sum-meta {
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.sum-machine {
			font-size: 13px;
		}
		.sum-meta {
			font-size: 11px;
		}
		.sum-action {
			flex: none;
			display: inline-flex;
			align-items: center;
			gap: 6px;
			border: 1px solid var(--line2);
			padding: 6px 10px;
			font-size: 13px;
			color: var(--fg2);
		}
		.caret {
			font-size: 10px;
			transition: transform 0.15s;
		}
		.open .caret {
			transform: rotate(180deg);
		}
		.line {
			display: none;
			flex-direction: column;
			align-items: stretch;
			gap: 12px;
			padding: 4px 0 14px;
		}
		.open .line {
			display: flex;
		}
		.main {
			flex-direction: column;
			align-items: stretch;
			gap: 10px;
		}
		.main :global(.machine),
		.main :global(.snap) {
			width: 100%;
		}
		.chips {
			gap: 6px;
		}
		.chip {
			padding: 7px 10px;
			font-size: 13px;
		}
		.all {
			padding: 7px 6px;
			font-size: 13px;
		}
		/* the average-corpora toggle gets its own full-width row; the rest share the next one */
		.side {
			justify-content: space-between;
			flex-wrap: wrap;
			gap: 10px;
		}
		.side > .delta-format:first-child {
			flex: 1 1 100%;
		}
		.side > .delta-format:first-child :global(.seg) {
			display: flex;
			flex-wrap: nowrap;
			width: 100%;
		}
		.side > .delta-format:first-child :global(.seg button) {
			flex: 1;
		}
		.adv {
			padding: 7px 12px;
		}
		.adv-grid {
			grid-template-columns: 1fr;
			padding-bottom: 14px;
			margin-top: -4px;
		}
		section:not(.open) .adv-grid,
		section:not(.open) .chips {
			display: none;
		}
		.chips {
			padding-bottom: 14px;
		}
	}
</style>
