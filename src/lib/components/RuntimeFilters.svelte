<script lang="ts">
	/**
	 * Filter panel body. Top to bottom: find by name, coarse cuts (execution model, language,
	 * pass rate), ranking rules, then every runtime with the reason it is in or out.
	 */
	import { onDestroy } from 'svelte';
	import { ui } from '$lib/state.svelte';
	import { CFG, execOf, langOf, type Exec } from '$lib/data/runtimes';
	import type { CfgId } from '$lib/data/types';
	import { viewData } from '$lib/view-data';
	import { type FilterMetric, type RuntimeFilterRule } from '$lib/runtime-filters';
	import { exclusions, passOf, resetScope, soloRuntime, toggleRuntime } from '$lib/runtime-scope';
	import Seg from './Seg.svelte';
	import { engineDrag } from '$lib/engine-drag';
	import { flip } from 'svelte/animate';
	import Swatch from './Swatch.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const METRICS: [FilterMetric, string, string][] = [
		['steady', 'Steady execution', 'ms'],
		['compile', 'Compilation', 'ms'],
		['inst', 'Instantiation', 'ms'],
		['first', 'First call', 'ms'],
		['rss', 'Peak RSS', 'MiB'],
		['code', 'Native code', 'KiB'],
		['pass', 'Pass rate', '%']
	];
	const unitOf = (m: FilterMetric) => METRICS.find((x) => x[0] === m)![2];
	const TOPS = [5, 10, 20, 25, 50, 75, 100];

	// Name search: instant locally, committed to the URL-backed state after a short pause.
	let search = $state(ui.runtimeFilters.name);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => { search = ui.runtimeFilters.name; clearTimeout(searchTimer); });
	onDestroy(() => { if (searchTimer) ui.runtimeFilters = { ...ui.runtimeFilters, name: search }; clearTimeout(searchTimer); });
	function searchChanged(value: string) {
		search = value;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => { searchTimer = undefined; ui.runtimeFilters = { ...ui.runtimeFilters, name: value }; }, 200);
	}

	const host = $derived(viewData.hosts[ui.machine].configurations);
	const onMachine = $derived(CFG.filter((c) => host[c.id]));
	const offMachine = $derived(CFG.filter((c) => !host[c.id]));
	const shownCount = $derived(onMachine.filter((c) => !ui.scope.hide[c.id]).length);

	const execCount = (k: 'compiler' | 'interpreter') => onMachine.filter((c) => execOf(c) === k).length;
	const langs = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const c of onMachine) counts.set(langOf(c), (counts.get(langOf(c)) ?? 0) + 1);
		return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	});

	const why = $derived(exclusions(onMachine.map((c) => c.id)));
	const toggle = toggleRuntime;
	const solo = soloRuntime;
	const showAll = () => (ui.hide = {});
	const hideAll = () => (ui.hide = Object.fromEntries(CFG.map((x) => [x.id, true])));
	const invert = () => (ui.hide = Object.fromEntries(CFG.map((x) => [x.id, !ui.hide[x.id]])));
	const reset = resetScope;

	// Pass-rate dial: every runtime sits on the track at its own pass rate.
	const ticks = $derived(onMachine.map((c) => ({ c, p: passOf(c.id) })).filter((t): t is { c: (typeof CFG)[number]; p: number } => t.p != null));
	const passStops: [number, string][] = [[0, 'Any'], [90, '90%'], [95, '95%'], [100, '100%']];
	const setPass = (v: number) => (ui.passRate = Math.max(0, Math.min(100, Math.round(v))));
	// The dial is square-root scaled so the crowded 90–100% end gets most of the track.
	const toX = (p: number) => 1 - Math.sqrt(Math.max(0, 100 - p) / 100);
	const fromX = (x: number) => 100 - 100 * (1 - x) ** 2;

	function updateRule(i: number, patch: Partial<RuntimeFilterRule>) {
		ui.runtimeFilters = { ...ui.runtimeFilters, rules: ui.runtimeFilters.rules.map((r, k) => (k === i ? { ...r, ...patch } : r)) };
	}
	const addRule = () => (ui.runtimeFilters = { ...ui.runtimeFilters, rules: [...ui.runtimeFilters.rules, { metric: 'steady', top: 25, limit: null }] });
	const removeRule = (i: number) => (ui.runtimeFilters = { ...ui.runtimeFilters, rules: ui.runtimeFilters.rules.filter((_, k) => k !== i) });

	let copied = $state(false);
	async function copyLink() {
		try {
			await navigator.clipboard.writeText(location.href);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {}
	}
</script>

<div class="wrap">
	<header>
		<div>
			<h2 id="scope-filter-title">Runtimes</h2>
			<p class="meter" role="status"><span class="mono"><b>{shownCount}</b> of {onMachine.length}</span> shown on this host</p>
		</div>
		<div class="head-actions">
			<button class="link" onclick={reset}>Reset</button>
			<button class="close" aria-label="Close filters" onclick={onclose}>
				<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
			</button>
		</div>
	</header>
	<div class="bar-meter" aria-hidden="true"><span style:width="{onMachine.length ? (100 * shownCount) / onMachine.length : 0}%"></span></div>

	<div class="body">
		<label class="search">
			<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
			<input data-autofocus type="search" placeholder="Name, backend or version — commas for “or”" aria-label="Filter by runtime name, backend or version" value={search} oninput={(e) => searchChanged(e.currentTarget.value.slice(0, 200))} maxlength="200" />
			<kbd>F</kbd>
		</label>

		<section>
			<h3>Execution model</h3>
			<Seg
				options={[['all', `All ${onMachine.length}`], ['compiler', `Compilers ${execCount('compiler')}`], ['interpreter', `Interpreters ${execCount('interpreter')}`]] as [Exec, string][]}
				value={ui.exec}
				onselect={(v) => (ui.exec = v)}
				disabled={(['compiler', 'interpreter'] as const).filter((k) => !execCount(k))}
				label="Execution model"
			/>
			<p class="hint">Compilers include JIT, baseline and AOT tiers.</p>
		</section>

		{#if langs.length > 1}
			<section>
				<h3>Written in</h3>
				<div class="chips" role="group" aria-label="Implementation language">
					<button class="chip" aria-pressed={ui.lang === 'all'} onclick={() => (ui.lang = 'all')}>Any</button>
					{#each langs as [l, n] (l)}
						<button class="chip" aria-pressed={ui.lang === l} onclick={() => (ui.lang = ui.lang === l ? 'all' : l)}>{l}<span class="n">{n}</span></button>
					{/each}
				</div>
			</section>
		{/if}

		<section>
			<h3>
				Minimum pass rate
				<span class="val mono">{ui.passRate === 0 ? 'any' : `≥ ${ui.passRate}%`}</span>
			</h3>
			<div class="dial">
				<div class="ticks" aria-hidden="true">
					{#each ticks as t (t.c.id)}
						<i class:out={t.p < ui.passRate} style:left="{100 * toX(t.p)}%" style:--c={t.c.col}></i>
					{/each}
				</div>
				<input type="range" min="0" max="1000" step="1" value={Math.round(1000 * toX(ui.passRate))} oninput={(e) => setPass(fromX(e.currentTarget.valueAsNumber / 1000))} aria-label="Minimum pass rate" aria-valuetext="{ui.passRate}%" style:--v="{100 * toX(ui.passRate)}%" />
				<div class="scale" aria-hidden="true">{#each [0, 50, 90, 99] as v (v)}<span style:left="{100 * toX(v)}%">{v}</span>{/each}<span style:left="100%">100</span></div>
			</div>
			<div class="stops">
				{#each passStops as [v, l] (v)}
					<button class="chip sm" aria-pressed={ui.passRate === v} onclick={() => setPass(v)}>{l}</button>
				{/each}
			</div>
			<p class="hint">Share of {ui.filterFeatures ? 'feature tests' : 'workloads'} each runtime runs correctly. Each mark above is one runtime.</p>
		</section>

		<section>
			<h3>Ranking rules</h3>
			{#each ui.runtimeFilters.rules as rule, i (i)}
				<div class="rule">
					<span class="w">Keep</span>
					<select aria-label="Rule {i + 1} ranking" value={rule.top} onchange={(e) => updateRule(i, { top: Number(e.currentTarget.value) })}>
						{#each TOPS as p (p)}<option value={p}>{p === 100 ? 'any' : `top ${p}%`}</option>{/each}
					</select>
					<span class="w">by</span>
					<select aria-label="Rule {i + 1} metric" value={rule.metric} onchange={(e) => updateRule(i, { metric: e.currentTarget.value as FilterMetric, limit: null })}>
						{#each METRICS as [id, label] (id)}<option value={id}>{label}</option>{/each}
					</select>
					<button class="rm" aria-label="Remove rule {i + 1}" onclick={() => removeRule(i)}>
						<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
					</button>
					<span class="w">{rule.metric === 'pass' ? 'at least' : 'at most'}</span>
					<span class="lim">
						<input
							type="number"
							min="0"
							max={rule.metric === 'pass' ? 100 : undefined}
							step="any"
							placeholder="no limit"
							aria-label="Rule {i + 1} {rule.metric === 'pass' ? 'minimum' : 'maximum'}"
							value={rule.limit ?? ''}
							oninput={(e) => {
								const v = e.currentTarget.valueAsNumber;
								updateRule(i, { limit: Number.isFinite(v) ? Math.max(0, rule.metric === 'pass' ? Math.min(100, v) : v) : null });
							}}
						/>
						<span class="unit">{unitOf(rule.metric)}</span>
					</span>
				</div>
			{/each}
			<button class="add" onclick={addRule} disabled={ui.runtimeFilters.rules.length >= 8}>
				<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v8M2 6h8" /></svg>
				Add rule
			</button>
			<p class="hint">Ranks use the latest {ui.filterFeatures ? 'feature' : 'main-corpus'} per-engine {ui.average === 'mean' ? 'means' : 'geomeans'} among runtimes passing the cuts above. Every rule must hold; ties are kept.</p>
		</section>

		<section class="list">
			<h3>
				On this host
				<span class="acts">
					<button class="link" onclick={showAll}>All</button>
					<button class="link" onclick={hideAll}>None</button>
					<button class="link" onclick={invert}>Invert</button>
					{#if ui.order.length}<button class="link" onclick={() => (ui.order = [])}>Reset order</button>{/if}
				</span>
			</h3>
			<ul>
				{#each onMachine as c (c.id)}
					{@const w = why.get(c.id)}
					{@const on = w?.kind === 'shown'}
					{@const pass = passOf(c.id)}
					<li class:on animate:flip={{ duration: 200 }} use:engineDrag={{ id: c.id, group: 'panel', axis: 'y' }}>
						<button class="rt" aria-pressed={on} onclick={() => toggle(c.id)} ondblclick={() => solo(c.id)}>
							<span class="check" aria-hidden="true">
								{#if on}<svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3 4.7-4.9" /></svg>{/if}
							</span>
							<Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} size={9} />
							<span class="name">{c.rt}<span class="be">{c.label ?? c.be}</span></span>
							{#if !on && w}<span class="why {w.kind}">{w.text}</span>{/if}
							<span class="pct mono" class:low={pass != null && pass < 100}>{pass == null ? '—' : `${pass >= 99.95 || pass === 0 ? pass.toFixed(0) : pass.toFixed(1)}%`}</span>
						</button>
						<button class="only" onclick={() => solo(c.id)} aria-label="Show only {c.rt} {c.label ?? c.be}">only</button>
					</li>
				{/each}
			</ul>
			{#if offMachine.length}
				<details>
					<summary>{offMachine.length} not measured on this host</summary>
					<p class="off">{offMachine.map((c) => `${c.rt} ${c.label ?? c.be}`).join(' · ')}</p>
				</details>
			{/if}
		</section>
	</div>

	<footer>
		<button class="link" onclick={copyLink}>{copied ? 'Link copied' : 'Copy link to this view'}</button>
		<button class="done" onclick={onclose}>Show {shownCount} runtime{shownCount === 1 ? '' : 's'}</button>
	</footer>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding: 16px 18px 12px;
	}
	h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 600;
	}
	.meter {
		margin: 2px 0 0;
		font-size: 12px;
		color: var(--fg3);
	}
	.meter b {
		color: var(--fg);
		font-weight: 600;
	}
	.bar-meter {
		height: 2px;
		background: var(--line);
	}
	.bar-meter span {
		display: block;
		height: 100%;
		background: var(--fg2);
		transition: width 0.3s cubic-bezier(0.22, 1, 0.36, 1);
	}
	.head-actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.close {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border: 1px solid var(--line2);
		color: var(--fg2);
	}
	.close:hover {
		color: var(--fg);
		border-color: var(--fg3);
	}
	svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.close svg {
		width: 12px;
		height: 12px;
	}
	.link {
		font-size: 12px;
		color: var(--fg2);
		text-decoration: underline;
		text-decoration-color: var(--line2);
		text-underline-offset: 3px;
	}
	.link:hover {
		color: var(--fg);
		text-decoration-color: var(--fg3);
	}

	.body {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 14px 18px 20px;
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	section {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}
	h3 {
		margin: 0;
		width: 100%;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		font-size: 10.5px;
		font-weight: 500;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--fg3);
	}
	.val {
		font-size: 12px;
		letter-spacing: 0;
		text-transform: none;
		color: var(--fg);
	}
	.hint {
		margin: 0;
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--fg3);
	}

	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		box-sizing: border-box;
		height: 36px;
		padding: 0 10px;
		background: var(--bg);
		border: 1px solid var(--line2);
	}
	.search:focus-within {
		border-color: var(--fg3);
	}
	.search svg {
		width: 14px;
		height: 14px;
		color: var(--fg3);
		flex: none;
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 13px;
		color: var(--fg);
		outline: none;
	}
	kbd {
		font-family: var(--mono);
		font-size: 10px;
		color: var(--fg3);
		border: 1px solid var(--line2);
		padding: 0 4px;
	}

	.chips,
	.stops {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 9px;
		font-size: 12px;
		border: 1px solid var(--line2);
		color: var(--fg2);
		transition: background-color 0.15s, color 0.15s, border-color 0.15s;
	}
	.chip.sm {
		padding: 2px 8px;
		font-size: 11.5px;
	}
	.chip:hover {
		color: var(--fg);
		border-color: var(--fg3);
	}
	.chip[aria-pressed='true'] {
		background: var(--fg);
		border-color: var(--fg);
		color: var(--bg);
	}
	.n {
		font-family: var(--mono);
		font-size: 10.5px;
		opacity: 0.6;
	}

	/* Pass-rate dial. */
	.dial {
		position: relative;
		width: 100%;
		padding-top: 14px;
	}
	.ticks {
		position: absolute;
		left: 7px;
		right: 7px;
		top: 0;
		height: 12px;
	}
	.ticks i {
		position: absolute;
		bottom: 0;
		width: 3px;
		height: 10px;
		margin-left: -1.5px;
		background: var(--c);
		transition: opacity 0.2s, height 0.2s;
	}
	.ticks i.out {
		opacity: 0.25;
		height: 5px;
	}
	.scale {
		position: relative;
		height: 14px;
		margin: 2px 7px 0;
		font-family: var(--mono);
		font-size: 9.5px;
		color: var(--fg3);
	}
	.scale span {
		position: absolute;
		transform: translateX(-50%);
	}
	input[type='range'] {
		width: 100%;
		margin: 0;
		height: 16px;
		appearance: none;
		-webkit-appearance: none;
		background: none;
		cursor: pointer;
	}
	input[type='range']::-webkit-slider-runnable-track {
		height: 3px;
		background: linear-gradient(to right, var(--line2) var(--v), var(--fg2) var(--v));
	}
	input[type='range']::-moz-range-track {
		height: 3px;
		background: linear-gradient(to right, var(--line2) var(--v), var(--fg2) var(--v));
	}
	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		margin-top: -5.5px;
		background: var(--bg2);
		border: 2px solid var(--fg);
		border-radius: 50%;
	}
	input[type='range']::-moz-range-thumb {
		width: 10px;
		height: 10px;
		background: var(--bg2);
		border: 2px solid var(--fg);
		border-radius: 50%;
	}
	input[type='range']:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	/* Ranking rules read as a sentence. */
	.rule {
		width: 100%;
		box-sizing: border-box;
		display: grid;
		grid-template-columns: auto 1fr auto 1.6fr auto;
		align-items: center;
		gap: 6px;
		padding: 8px;
		background: var(--bg3);
		border: 1px solid var(--line);
		font-size: 12px;
	}
	.rule .w {
		color: var(--fg3);
	}
	.rule select,
	.rule input {
		font: inherit;
		font-size: 12px;
		color: var(--fg);
		background: var(--bg);
		border: 1px solid var(--line2);
		padding: 4px 6px;
		min-width: 0;
	}
	.lim {
		grid-column: 2 / span 3;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.lim input {
		width: 110px;
	}
	.unit {
		color: var(--fg3);
		font-family: var(--mono);
		font-size: 11px;
	}
	.rm {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		color: var(--fg3);
		grid-row: 1;
		grid-column: 5;
	}
	.rm svg {
		width: 10px;
		height: 10px;
	}
	.rm:hover {
		color: var(--fg);
	}
	.add {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		border: 1px dashed var(--line2);
		font-size: 12px;
		color: var(--fg2);
	}
	.add:hover:not(:disabled) {
		border-color: var(--fg3);
		color: var(--fg);
	}
	.add:disabled {
		opacity: 0.4;
	}
	.add svg {
		width: 10px;
		height: 10px;
	}

	/* Runtime list. */
	.list {
		align-items: stretch;
	}
	.acts {
		display: flex;
		gap: 10px;
		text-transform: none;
		letter-spacing: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--line);
	}
	li {
		position: relative;
		display: flex;
		align-items: stretch;
	}
	li + li {
		border-top: 1px solid var(--line);
	}
	.rt {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		font-size: 12.5px;
		text-align: left;
		color: var(--fg3);
		transition: background-color 0.12s;
	}
	.rt:hover {
		background: var(--hover);
	}
	li.on .rt {
		color: var(--fg);
	}
	.check {
		display: grid;
		place-items: center;
		width: 14px;
		height: 14px;
		flex: none;
		border: 1px solid var(--line2);
	}
	li.on .check {
		background: var(--fg);
		border-color: var(--fg);
		color: var(--bg);
	}
	.check svg {
		width: 10px;
		height: 10px;
		stroke-width: 2;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.be {
		margin-left: 6px;
		font-size: 11px;
		color: var(--fg3);
	}
	.why {
		flex: none;
		font-size: 10.5px;
		padding: 1px 5px;
		border: 1px solid var(--line2);
		color: var(--fg3);
		white-space: nowrap;
	}
	.why.pass {
		color: var(--st-warn);
		border-color: color-mix(in srgb, var(--st-warn) 45%, transparent);
	}
	.pct {
		flex: none;
		width: 46px;
		text-align: right;
		font-size: 11px;
		color: var(--fg3);
	}
	.pct.low {
		color: var(--st-warn);
	}
	.only {
		position: absolute;
		right: 62px;
		top: 50%;
		transform: translateY(-50%);
		padding: 1px 6px;
		font-size: 11px;
		background: var(--bg2);
		border: 1px solid var(--line2);
		color: var(--fg2);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.12s;
	}
	li:hover .only,
	.only:focus-visible {
		opacity: 1;
		pointer-events: auto;
	}
	/* "only" takes the reason badge's place on hover rather than sitting on top of it. */
	li:hover .why,
	li:has(.only:focus-visible) .why {
		visibility: hidden;
	}
	.only:hover {
		color: var(--fg);
		border-color: var(--fg3);
	}
	details {
		font-size: 12px;
		color: var(--fg3);
	}
	summary {
		cursor: pointer;
		padding: 4px 0;
	}
	.off {
		margin: 4px 0 0;
		line-height: 1.6;
	}

	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 18px max(12px, env(safe-area-inset-bottom));
		border-top: 1px solid var(--line);
		background: var(--bg2);
	}
	.done {
		padding: 8px 14px;
		font-size: 13px;
		font-weight: 500;
		background: var(--fg);
		color: var(--bg);
	}
	.done:hover {
		opacity: 0.9;
	}
	button:focus-visible,
	select:focus-visible,
	.rule input:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 1px;
	}
	@media (max-width: 720px) {
		header {
			padding: 14px 16px 10px;
		}
		.body {
			padding: 14px 16px 20px;
		}
		.search {
			height: 44px;
		}
		.search input,
		.rule select,
		.rule input {
			font-size: 16px;
		}
		.chip {
			padding: 8px 12px;
			font-size: 13px;
		}
		.chip.sm {
			padding: 6px 12px;
			font-size: 12.5px;
		}
		.rt {
			padding: 11px 12px;
			font-size: 14px;
		}
		.rule {
			grid-template-columns: 56px minmax(0, 1fr) 36px;
			row-gap: 8px;
		}
		.rule select:nth-of-type(2) {
			grid-column: span 2;
		}
		.rm {
			grid-column: 3;
			width: 36px;
			height: 36px;
		}
		.lim {
			grid-column: 2 / span 2;
		}
		.lim input {
			flex: 1;
			width: auto;
		}
		input[type='range'] {
			height: 28px;
		}
		input[type='range']::-webkit-slider-thumb {
			width: 22px;
			height: 22px;
			margin-top: -9.5px;
		}
		footer {
			padding: 10px 16px max(10px, env(safe-area-inset-bottom));
		}
		.done {
			padding: 12px 18px;
			font-size: 14px;
		}
		.link {
			padding: 6px 0;
			font-size: 13px;
		}
	}
	@media (hover: none) {
		kbd {
			display: none;
		}
		.only {
			opacity: 1;
			pointer-events: auto;
			position: static;
			transform: none;
			margin: auto 8px auto 0;
		}
	}
</style>
