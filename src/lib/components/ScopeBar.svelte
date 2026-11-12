<script lang="ts">
	/**
	 * Comparison scope: one slim sticky bar. The host, a runtimes button that opens the filter
	 * panel, the active constraints as removable pills, and the averaging choices. Everything that
	 * narrows the runtime set lives in the panel; the bar only summarises it.
	 */
	import RuntimeFilters from './RuntimeFilters.svelte';
	import { emptyRuntimeFilters, type FilterMetric } from '$lib/runtime-filters';
	import { page } from '$app/state';
	import { tipCard } from '$lib/tip';
	import { CFG, MACH, execOf, langOf, type Exec } from '$lib/data/runtimes';
	import type { MachineId } from '$lib/data/types';
	import { untrack } from 'svelte';
	import { datasetView } from '$lib/api/view.svelte';
	import { ui } from '$lib/state.svelte';
	import Swatch from './Swatch.svelte';
	import Seg from './Seg.svelte';
	import { exclusions, resetScope, soloRuntime, toggleRuntime } from '$lib/runtime-scope';
	import { engineDrag } from '$lib/engine-drag';
	import { engineOrder } from '$lib/engine-order.svelte';
	import { flip } from 'svelte/animate';
	import { onMount } from 'svelte';
	import Select from './Select.svelte';
	import { viewData } from '$lib/view-data';

	$effect(() => {datasetView.machine=ui.machine;untrack(()=>{const count=viewData.history[ui.machine].points.length;ui.histTo=Math.max(0,count-1);ui.histFrom=Math.min(ui.histFrom,Math.max(0,count-1));});});
	$effect(() => { if (ui.snap !== 's1') ui.snap = 's1'; });
	const featureComparison = $derived(page.route.id === '/features');
	$effect(() => { ui.filterFeatures = featureComparison; });

	const onMachine = $derived(CFG.filter((c) => viewData.hosts[ui.machine].configurations[c.id]));
	const shown = $derived(onMachine.filter((c) => !ui.scope.hide[c.id]));
	const why = $derived(exclusions(onMachine.map((c) => c.id)));
	const execCount = (k: 'compiler' | 'interpreter') => onMachine.filter((c) => execOf(c) === k).length;
	const langs = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const c of onMachine) counts.set(langOf(c), (counts.get(langOf(c)) ?? 0) + 1);
		return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
	});

	// A machine without the selected execution model or language would show an empty table.
	$effect(() => {
		if (!onMachine.length) return;
		untrack(() => {
			if (ui.exec !== 'all' && !onMachine.some((c) => execOf(c) === ui.exec)) ui.exec = 'all';
			if (ui.lang !== 'all' && !onMachine.some((c) => langOf(c) === ui.lang)) ui.lang = 'all';
		});
	});

	const METRIC_SHORT: Record<FilterMetric, string> = { steady: 'execution', compile: 'compile', inst: 'instantiate', first: 'first call', rss: 'peak RSS', code: 'code size', pass: 'pass rate' };
	const UNIT: Record<FilterMetric, string> = { steady: 'ms', compile: 'ms', inst: 'ms', first: 'ms', rss: 'MiB', code: 'KiB', pass: '%' };
	const manualHidden = $derived(onMachine.filter((c) => ui.hide[c.id]).length);

	/** Every constraint narrowing the comparison, each with its own undo. */
	const pills = $derived.by(() => {
		const out: { key: string; label: string; tip: string; clear: () => void }[] = [];
		if (ui.exec !== 'all') out.push({ key: 'exec', label: ui.exec === 'compiler' ? 'Compilers' : 'Interpreters', tip: 'Execution model', clear: () => (ui.exec = 'all') });
		if (ui.lang !== 'all') out.push({ key: 'lang', label: `Written in ${ui.lang}`, tip: 'Implementation language', clear: () => (ui.lang = 'all') });
		if (ui.passRate > 0) out.push({ key: 'pass', label: ui.passRate === 100 ? 'Passes every workload' : `Passes ≥ ${ui.passRate}%`, tip: 'Minimum workload pass rate', clear: () => (ui.passRate = 0) });
		const name = ui.runtimeFilters.name.trim();
		if (name) out.push({ key: 'name', label: `“${name}”`, tip: 'Name, backend or version', clear: () => (ui.runtimeFilters = { ...ui.runtimeFilters, name: '' }) });
		ui.runtimeFilters.rules.forEach((r, i) => {
			const cap = r.limit == null ? '' : ` · ${r.metric === 'pass' ? '≥' : '≤'} ${r.limit} ${UNIT[r.metric]}`;
			out.push({ key: `rule${i}`, label: `${r.top === 100 ? 'Any' : `Top ${r.top}%`} ${METRIC_SHORT[r.metric]}${cap}`, tip: 'Ranking rule', clear: () => (ui.runtimeFilters = { ...ui.runtimeFilters, rules: ui.runtimeFilters.rules.filter((_, k) => k !== i) }) });
		});
		if (manualHidden) out.push({ key: 'hidden', label: `${manualHidden} hidden by hand`, tip: 'Runtimes you switched off', clear: () => (ui.hide = {}) });
		return out;
	});
	const resetAll = resetScope;

	// The engine order is a reading preference: remembered on this device unless a link sets one.
	const ORDER_KEY = 'wasmfyi.engine-order';
	let orderLoaded = $state(false);
	onMount(() => {
		try {
			const saved = localStorage.getItem(ORDER_KEY);
			if (saved && !new URL(location.href).searchParams.has('order') && !engineOrder.ids.length) ui.order = saved.split(',').filter(Boolean);
		} catch {}
		orderLoaded = true;
	});
	$effect(() => {
		const ids = engineOrder.ids;
		if (!orderLoaded) return;
		try {
			if (ids.length) localStorage.setItem(ORDER_KEY, ids.join(','));
			else localStorage.removeItem(ORDER_KEY);
		} catch {}
	});

	// Filter panel: focus moves in on open and back to the trigger on close.
	let trigger = $state<HTMLButtonElement>();
	let panel = $state<HTMLElement>();
	let wasOpen = false;
	$effect(() => {
		if (ui.filterOpen) queueMicrotask(() => panel?.querySelector<HTMLElement>('[data-autofocus]')?.focus());
		if (!ui.filterOpen && wasOpen) trigger?.focus();
		wasOpen = ui.filterOpen;
	});
	function panelKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') { e.stopPropagation(); ui.filterOpen = false; return; }
		if (e.key !== 'Tab' || !panel) return;
		const focusable = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')];
		if (!focusable.length) return;
		const first = focusable[0], last = focusable[focusable.length - 1];
		if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
		else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
	}
	// "f" toggles the panel from anywhere outside a text field.
	function globalKey(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement | null)?.tagName;
		if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === 'f' || e.key === 'F') { e.preventDefault(); ui.filterOpen = !ui.filterOpen; }
		if (e.key === 'Escape' && displayOpen) displayOpen = false;
	}

	// Display menu: averaging, delta notation and the run settings behind every number.
	let displayOpen = $state(false);
	let displayEl = $state<HTMLElement>();
	function outside(e: PointerEvent) {
		if (displayOpen && displayEl && !displayEl.contains(e.target as Node)) displayOpen = false;
	}
	const runSettings = $derived([
		{ k: 'OS', v: MACH[ui.machine]?.os ?? '—' },
		{ k: 'Cache state', v: 'cold — no on-disk artifact cache' },
		{ k: 'Compilation workers', v: 'per-runtime configuration; CPU affinity uncontrolled' },
		{ k: 'Warmup & sampling', v: 'per-cell sealed report records launches, samples and warmups' },
		{ k: 'Feature flags', v: 'pinned adapter configuration in each sealed report' },
		{ k: 'Instrumentation', v: 'none in timing runs · memory from linked runs' },
		{ k: 'Isolation', v: 'scheduling, frequency and filesystem caches uncontrolled' }
	]);
	let showRun = $state(false);
</script>

<svelte:window onkeydown={globalKey} onpointerdown={outside} />

<section class="scope" aria-label="Comparison scope">
	<div class="scope-row">
		<div class="lead">
			<Select class="machine" label="Machine" options={Object.entries(MACH).map(([v, m]): [MachineId, string] => [v as MachineId, m.l])} value={ui.machine} onselect={(v) => (ui.machine = v)} />
			<button
				class="runtimes"
				class:none={onMachine.length > 0 && !shown.length}
				bind:this={trigger}
				aria-expanded={ui.filterOpen}
				aria-controls="scope-filter-panel"
				aria-keyshortcuts="f"
				onclick={() => (ui.filterOpen = !ui.filterOpen)}
				data-tip="Choose and filter runtimes · F"
			>
				<span class="strip" aria-hidden="true">
					{#each onMachine as c (c.id)}
						{@const on = !ui.scope.hide[c.id]}
						<i class:off={!on} style:--c={c.col} class:hollow={c.hollow}></i>
					{/each}
				</span>
				<span class="count"><b>{shown.length}</b><span class="fg3">/{onMachine.length}</span></span>
				<span class="lbl">runtimes</span>
				<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M4.5 8h7M7 12h2" /></svg>
			</button>
		</div>

		<ul class="pills" aria-label="Active filters">
			{#each pills as p (p.key)}
				<li class="pill">
					<button class="pill-body" onclick={() => (ui.filterOpen = true)} data-tip={p.tip}>{p.label}</button>
					<button class="pill-x" aria-label="Remove filter: {p.label}" onclick={p.clear}>
						<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" /></svg>
					</button>
				</li>
			{:else}
				<li class="pill-none fg3">All runtimes on this host</li>
			{/each}
			{#if pills.length > 1}<li><button class="reset" onclick={resetAll}>Clear all</button></li>{/if}
			{#if onMachine.length && !shown.length}<li class="empty" role="status">No runtime matches every filter</li>{/if}
		</ul>

		<div class="tail">
			<div class="cohort">
				<span class="cap fg3">Workloads</span>
				<Seg
					options={[['shared', 'Passed by all'], ['per-engine', 'Per engine']]}
					value={ui.cohortMode}
					onselect={(v) => (ui.cohortMode = v as 'shared' | 'per-engine')}
					label="Workloads averaged"
					tips={[
						tipCard({ title: featureComparison ? 'Passed by every selected engine' : 'Workloads every shown engine passed', note: featureComparison ? 'Only contracts passed and measured by every selected engine enter feature comparisons. Dimmed, crossed-out cells are excluded.' : 'Every average covers the same workload set, so engines compare like for like.' }),
						tipCard({ title: 'Each engine’s own passes', vis: 'cohort-each', note: 'green = averaged' })
					]}
				/>
			</div>
			<div class="display" bind:this={displayEl}>
				<button class="disp-btn" aria-expanded={displayOpen} aria-haspopup="dialog" onclick={() => (displayOpen = !displayOpen)}>
					<span>{ui.average === 'geo' ? 'Geomean' : 'Mean'}</span><span class="fg3 sep">·</span><span class="mono">{ui.deltaFormat === 'factor' ? '×' : '%'}</span>
					<svg class="chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" /></svg>
				</button>
				{#if displayOpen}
					<button class="sheet-scrim" tabindex="-1" aria-label="Close display settings" onclick={() => (displayOpen = false)}></button>
					<div class="menu" role="dialog" aria-label="Display settings">
						<div class="field phone-only">
							<span class="cap">Workloads averaged</span>
							<Seg options={[['shared', 'Passed by all'], ['per-engine', 'Per engine']]} value={ui.cohortMode} onselect={(v) => (ui.cohortMode = v as 'shared' | 'per-engine')} label="Workloads averaged" />
							<p class="hint">{ui.cohortMode === 'shared' ? 'Every average covers the workloads all shown engines pass.' : 'Each engine averages its own passing workloads.'}</p>
						</div>
						<div class="field">
							<span class="cap">Average</span>
							<Seg options={[['geo', 'Geometric'], ['mean', 'Arithmetic']]} value={ui.average} onselect={(v) => (ui.average = v as 'geo' | 'mean')} label="Average" tips={[tipCard({ title: 'Geometric mean', vis: 'avg-geo' }), tipCard({ title: 'Plain mean', vis: 'avg-mean' })]} />
							<p class="hint">Every workload weighted equally.</p>
						</div>
						<div class="field">
							<span class="cap">Differences</span>
							<Seg options={[['percent', '+30%'], ['factor', '1.30×']]} value={ui.deltaFormat} onselect={(v) => (ui.deltaFormat = v as 'factor' | 'percent')} label="Delta format" mono />
						</div>
						<div class="field">
							<button class="run-toggle" aria-expanded={showRun} onclick={() => (showRun = !showRun)}>
								<svg class="chev" class:rot={showRun} viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" /></svg>
								Run settings
							</button>
							{#if showRun}
								<dl class="run">
									{#each runSettings as a (a.k)}<dt>{a.k}</dt><dd>{a.v}</dd>{/each}
								</dl>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</section>

<!-- In page flow below the sticky row: at the top of the page it shows every engine, and on
     scroll it slides up under the row, leaving the slim bar. -->
<div class="tray" aria-label="Engines">
	<div class="tray-head">
		<Seg options={[['all', 'All'], ['compiler', `Compilers ${execCount('compiler')}`], ['interpreter', `Interpreters ${execCount('interpreter')}`]] as [Exec, string][]} value={ui.exec} onselect={(v) => (ui.exec = v)} disabled={(['compiler', 'interpreter'] as const).filter((k) => !execCount(k))} label="Execution model" />
		{#if langs.length > 1}
			<Seg options={[['all', 'Any language'], ...langs.map((l): [string, string] => [l, l])]} value={ui.lang} onselect={(v) => (ui.lang = v)} label="Implementation language" />
		{/if}
		<span class="tray-acts">
			{#if ui.order.length}<button class="reset" onclick={() => (ui.order = [])}>Reset order</button>{/if}
			<button class="reset" onclick={() => (ui.hide = {})}>Show all</button>
			<button class="reset" onclick={() => (ui.hide = Object.fromEntries(CFG.map((x) => [x.id, true])))}>Hide all</button>
		</span>
	</div>
	<div class="engines" role="group" aria-label="Engines shown">
		{#each onMachine as c (c.id)}
			{@const w = why.get(c.id)}
			{@const on = w?.kind === 'shown'}
			<button
				class="engine"
				animate:flip={{ duration: 220 }}
				use:engineDrag={{ id: c.id, group: 'tray' }}
				class:off={!on}
				aria-pressed={on}
				onclick={() => toggleRuntime(c.id)}
				ondblclick={(e) => { e.preventDefault(); soloRuntime(c.id); }}
				data-tip={on ? `${c.rt} ${c.label ?? c.be} · click to hide · double-click for only this · drag to reorder` : `${c.rt} ${c.label ?? c.be} · excluded: ${w?.text} · click to show · drag to reorder`}
			>
				<Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} />{c.rt}<span class="ebe">{c.label ?? c.be}</span>
			</button>
		{/each}
	</div>
</div>

{#if ui.filterOpen}
	<button class="scrim" tabindex="-1" aria-label="Close filters" onclick={() => (ui.filterOpen = false)}></button>
	<div id="scope-filter-panel" class="fpanel" bind:this={panel} role="dialog" aria-modal="true" aria-labelledby="scope-filter-title" tabindex="-1" onkeydown={panelKeydown}>
		<RuntimeFilters onclose={() => (ui.filterOpen = false)} />
	</div>
{/if}

<style>
	/* Engine tray: scrolls away beneath the sticky row. */
	.tray {
		position: relative;
		z-index: 19;
		background: var(--bg2);
		border-bottom: 1px solid var(--line);
		padding: 8px max(var(--gutter), env(safe-area-inset-right)) 10px max(var(--gutter), env(safe-area-inset-left));
		margin-top: -1px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.tray-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 10px;
	}
	.tray-acts {
		margin-left: auto;
		display: flex;
		gap: 8px;
	}
	.engines {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	/* Spare space goes to the last row only, so a short last row keeps natural widths. */
	.engines::after {
		content: '';
		flex: 1000 1 0;
	}
	.engine {
		flex: 1 1 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		padding: 2px 7px;
		border: 1px solid var(--line2);
		font-size: 12px;
		color: var(--fg);
		transition: opacity 0.18s ease, border-color 0.18s ease, transform 0.12s ease;
	}
	.engine:hover {
		border-color: var(--fg3);
	}
	.engine:active {
		transform: scale(0.97);
	}
	.engine.off {
		opacity: 0.38;
		border-color: var(--line);
	}
	.engine.off:hover {
		opacity: 0.75;
	}
	.ebe {
		font-size: 11px;
		color: var(--fg3);
	}
	@media (max-width: 720px) {
		.tray {
			display: none;
		}
	}
	.scope {
		position: sticky;
		top: 0;
		z-index: 20;
		background: color-mix(in srgb, var(--bg2) 88%, transparent);
		backdrop-filter: blur(10px) saturate(1.2);
		-webkit-backdrop-filter: blur(10px) saturate(1.2);
		border-bottom: 1px solid var(--line);
		padding: 0 max(var(--gutter), env(safe-area-inset-right)) 0 max(var(--gutter), env(safe-area-inset-left));
	}
	.scope-row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 48px;
	}
	.lead,
	.tail {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
	}
	.tail {
		margin-left: auto;
		gap: 12px;
	}
	.cap {
		font-size: 11px;
		letter-spacing: 0.02em;
	}

	/* Runtimes trigger: a strip of every runtime's colour, lit when shown. */
	.runtimes {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 30px;
		padding: 0 10px;
		border: 1px solid var(--line2);
		background: var(--bg);
		font-size: 12px;
		color: var(--fg);
		transition: border-color 0.15s;
	}
	.runtimes:hover,
	.runtimes[aria-expanded='true'] {
		border-color: var(--fg3);
	}
	.strip {
		display: inline-flex;
		align-items: center;
		gap: 1.5px;
		max-width: 150px;
		overflow: hidden;
	}
	.strip i {
		width: 4px;
		height: 14px;
		flex: none;
		background: var(--c);
		transition: height 0.2s ease, opacity 0.2s ease;
	}
	.strip i.hollow {
		background: transparent;
		box-shadow: inset 0 0 0 1px var(--c);
	}
	.strip i.off {
		height: 4px;
		opacity: 0.35;
	}
	.count {
		font-family: var(--mono);
		font-variant-numeric: tabular-nums;
	}
	.count b {
		font-weight: 600;
	}
	.ico,
	.chev {
		width: 12px;
		height: 12px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		color: var(--fg3);
	}
	.chev {
		width: 10px;
		height: 10px;
		transition: transform 0.15s;
	}
	.chev.rot {
		transform: rotate(90deg);
	}

	/* Active constraints. */
	.pills {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex: 1;
		overflow-x: auto;
		scrollbar-width: none;
		mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
		padding-right: 24px;
	}
	.pills::-webkit-scrollbar {
		display: none;
	}
	.pill {
		display: inline-flex;
		flex: none;
		align-items: stretch;
		height: 24px;
		border: 1px solid var(--line2);
		background: var(--bg3);
		font-size: 12px;
		animation: pop 0.18s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	.pill-body {
		padding: 0 4px 0 8px;
		color: var(--fg);
		white-space: nowrap;
	}
	.pill-x {
		display: grid;
		place-items: center;
		width: 22px;
		color: var(--fg3);
	}
	.pill-x svg {
		width: 9px;
		height: 9px;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
	}
	.pill-x:hover {
		color: var(--fg);
		background: var(--hover);
	}
	.pill-none {
		font-size: 12px;
		white-space: nowrap;
	}
	.reset {
		font-size: 12px;
		color: var(--fg2);
		white-space: nowrap;
		padding: 0 4px;
		text-decoration: underline;
		text-decoration-color: var(--line2);
		text-underline-offset: 3px;
	}
	.empty {
		flex: none;
		font-size: 12px;
		color: var(--st-warn);
		white-space: nowrap;
	}
	.runtimes.none .count b {
		color: var(--st-warn);
	}
	.reset:hover {
		color: var(--fg);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.94);
		}
	}

	.cohort {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* Display menu. */
	.display {
		position: relative;
	}
	.disp-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 26px;
		padding: 0 9px;
		border: 1px solid var(--line2);
		font-size: 12px;
		color: var(--fg);
	}
	.disp-btn:hover,
	.disp-btn[aria-expanded='true'] {
		border-color: var(--fg3);
	}
	.sep {
		margin: 0 -2px;
	}
	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		z-index: 30;
		width: 300px;
		max-height: 70vh;
		overflow: auto;
		background: var(--bg2);
		border: 1px solid var(--line2);
		box-shadow: var(--shadow-float);
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		animation: drop 0.16s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
	.field {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}
	.field .cap {
		color: var(--fg3);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: 10.5px;
	}
	.hint {
		margin: 0;
		font-size: 11px;
		color: var(--fg3);
	}
	.run-toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--fg2);
	}
	.run-toggle:hover {
		color: var(--fg);
	}
	.run {
		margin: 0;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 10px;
		font-size: 11px;
		border-top: 1px solid var(--line);
		padding-top: 8px;
		width: 100%;
	}
	.run dt {
		color: var(--fg3);
		white-space: nowrap;
	}
	.run dd {
		margin: 0;
		font-family: var(--mono);
		overflow-wrap: anywhere;
	}

	/* Filter panel. */
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 39;
		border: 0;
		background: rgb(0 0 0 / 0.38);
		animation: fade 0.16s ease-out both;
	}
	.fpanel {
		position: fixed;
		z-index: 40;
		inset: 0 0 0 auto;
		width: min(440px, 100vw);
		height: 100dvh;
		background: var(--bg2);
		border-left: 1px solid var(--line);
		box-shadow: -16px 0 40px rgb(0 0 0 / 0.3);
		animation: slide 0.22s cubic-bezier(0.22, 1, 0.36, 1) both;
		outline: none;
	}
	@keyframes slide {
		from {
			transform: translateX(32px);
			opacity: 0.6;
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	button:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 1px;
	}
	@media (prefers-reduced-motion: reduce) {
		.pill,
		.menu,
		.fpanel,
		.scrim,
		.strip i {
			animation: none !important;
			transition: none !important;
		}
	}

	@media (max-width: 1100px) {
		.cohort .cap {
			display: none;
		}
	}
	.phone-only {
		display: none;
	}
	.sheet-scrim {
		display: none;
	}
	/* Phones: two rows. Host, runtimes and the averaging menu on top; active filters beneath.
	   The workload cohort moves into the averaging menu, which opens as a bottom sheet. */
	@media (max-width: 720px) {
		/* No backdrop-filter here: it would make the bar the containing block for the fixed
		   bottom sheet and its scrim. */
		.scope {
			position: static;
			background: var(--bg2);
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
			padding: 8px max(16px, env(safe-area-inset-right)) 8px max(16px, env(safe-area-inset-left));
		}
		.scope-row {
			flex-wrap: wrap;
			gap: 8px;
			min-height: 0;
		}
		.lead {
			flex: 1 1 0;
			min-width: 0;
		}
		.lead :global(.machine) {
			flex: 1;
			min-width: 0;
		}
		.lead :global(.machine .trigger) {
			min-height: 40px;
		}
		.runtimes {
			height: 40px;
			padding: 0 10px;
		}
		.strip {
			max-width: 44px;
		}
		.lbl,
		.ico {
			display: none;
		}
		.tail {
			order: 2;
			margin-left: 0;
		}
		.cohort {
			display: none;
		}
		.disp-btn {
			height: 40px;
		}
		.pills {
			order: 3;
			flex: 1 1 100%;
		}
		.pills:empty {
			display: none;
		}
		.pill {
			height: 32px;
		}
		.pill-x {
			width: 32px;
		}
		.phone-only {
			display: flex;
		}
		.sheet-scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 29;
			background: rgb(0 0 0 / 0.38);
			border: 0;
		}
		.menu {
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			top: auto;
			width: auto;
			max-height: 80dvh;
			padding: 18px max(16px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
			border-width: 1px 0 0;
			animation: sheet 0.22s cubic-bezier(0.22, 1, 0.36, 1) both;
		}
		.menu :global(.seg) {
			display: flex;
			width: 100%;
		}
		.menu :global(.seg button) {
			flex: 1;
		}
	}
	@keyframes sheet {
		from {
			transform: translateY(24px);
			opacity: 0.6;
		}
	}
</style>
