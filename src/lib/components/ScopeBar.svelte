<script lang="ts">
	import {shortVersion} from '$lib/version-identity';
	import { tipCard, tipWho } from '$lib/tip';
	import { CFG, MACH, execOf, type Exec } from '$lib/data/runtimes';
	import type { MachineId, CfgId } from '$lib/data/types';
	import {untrack} from 'svelte';
	import {datasetView} from '$lib/api/view.svelte';
	import { ui } from '$lib/state.svelte';
	import Swatch from './Swatch.svelte';
	import Seg from './Seg.svelte';
	import { viewData } from '$lib/view-data';

	const SNAP_OPTS = [
		['s1', 'Latest snapshot'],
	] as const;

	$effect(() => {datasetView.machine=ui.machine;untrack(()=>{const count=viewData.history[ui.machine].points.length;ui.histTo=Math.max(0,count-1);ui.histFrom=Math.min(ui.histFrom,Math.max(0,count-1));});});
	$effect(() => { if (ui.snap !== 's1') ui.snap = 's1'; });
	const shown = $derived(CFG.filter((c) => !ui.scope.hide[c.id]));
	// Phones collapse the scope controls behind a one-line summary.
	let open = $state(false);

	function toggle(id: (typeof CFG)[number]['id']) {
		const c = CFG.find((x) => x.id === id)!;
		// A chip outside the execution filter widens the filter to All and adds just that runtime.
		if (ui.exec !== 'all' && execOf(c) !== ui.exec) {
			ui.hide = { ...ui.scope.hide, [id]: false };
			ui.exec = 'all';
			return;
		}
		const next: Partial<Record<CfgId, boolean>> = { ...ui.hide, [id]: !ui.hide[id] };
		if (CFG.every((x) => next[x.id] || (ui.exec !== 'all' && execOf(x) !== ui.exec))) return; // keep at least one runtime visible
		ui.hide = next;
	}
	function solo(e: MouseEvent, id: string) {
		e.preventDefault();
		const c = CFG.find((x) => x.id === id)!;
		if (ui.exec !== 'all' && execOf(c) !== ui.exec) ui.exec = 'all';
		ui.hide = Object.fromEntries(CFG.map((x) => [x.id, x.id !== id]));
	}

	// Execution filter: hides the other execution model on top of the per-runtime chips.
	const onMachine = $derived(CFG.filter((c) => viewData.hosts[ui.machine].configurations[c.id]));
	const execMissing = $derived((['compiler', 'interpreter'] as const).filter((k) => !onMachine.some((c) => execOf(c) === k)));
	const someHidden = $derived(onMachine.some((c) => ui.scope.hide[c.id]));
	// A machine without the selected execution model would show an empty table.
	$effect(() => {
		// Wait for the machine's configurations to load; an empty list is not "missing".
		if (onMachine.length && ui.exec !== 'all' && execMissing.includes(ui.exec)) untrack(() => (ui.exec = 'all'));
	});
	function setExec(kind: Exec) {
		ui.exec = kind;
		ui.hide = {};
	}

	const advItems = $derived([
		{ k: 'OS', v: MACH[ui.machine].os },
		{ k: 'Runtimes', v: Object.values(viewData.hosts[ui.machine].configurations).map(c=>c!.runtime+' '+shortVersion(c!.version)).join(' · ') },
		{ k: 'Aggregation', v: 'geomean · '+ui.weighting+' weighting · '+(ui.cohortMode==='shared'?'passed on all shown engines':'passed per engine') },
		{ k: 'Cache state', v: 'cold — no on-disk artifact cache' },
		{ k: 'Compilation workers', v: 'Per-runtime configuration; CPU affinity uncontrolled' },
		{ k: 'Warmup & sampling', v: 'Per-cell sealed report records launches, samples and warmups' },
		{ k: 'Feature flags', v: 'Pinned adapter configuration in each sealed report; optional configurations separate' },
		{ k: 'Instrumentation', v: 'none in timing runs · memory from linked runs' },
		{ k: 'Isolation', v: 'Scheduling, frequency and filesystem caches uncontrolled' }
	]);
</script>

<section aria-label="Comparison scope" class:open>
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
			<select bind:value={ui.machine} aria-label="Machine" class="machine">
				{#each Object.entries(MACH) as [v, m] (v)}
					<option value={v as MachineId}>{m.l}</option>
				{/each}
			</select>
			<div class="exec" data-tip="Compilers include optimizing and baseline JITs, single-pass and ahead-of-time backends.">
				<Seg options={[['all', 'All'], ['compiler', 'Compilers'], ['interpreter', 'Interpreters']]} value={ui.exec} onselect={setExec} disabled={execMissing} label="Execution model" />
			</div>
			<select bind:value={ui.snap} aria-label="Snapshot" class="snap">
				{#each SNAP_OPTS as [v, l] (v)}
					<option value={v}>{l}</option>
				{/each}
			</select>
			<div class="chips" role="group" aria-label="Runtimes shown">
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
						<span class="be">{c.be}</span>
					</button>
				{/each}
				{#if someHidden}<button class="all" onclick={() => setExec('all')}>Show all</button>{/if}
			</div>
		</div>
		<div class="side">
            <div class="delta-format">
                <span class="small fg3">Average corpora</span>
                <Seg options={[['per-engine', 'Passed per engine'], ['shared', 'Passed on all engines']]} value={ui.cohortMode} onselect={v=>ui.cohortMode=v as 'shared' | 'per-engine'} label="Average corpus selection" />
            </div>
			<div class="delta-format" data-tip="Relative deltas: 1.3× = +30%; 0.7× = −30%. Absolute values and counts stay in their own units.">
				<span class="small fg3">Deltas</span>
				<Seg options={['factor', 'percent'].map(v=>[v as 'factor' | 'percent',v==='factor'?'×':'%'])} value={ui.deltaFormat} onselect={v=>ui.deltaFormat=v} label="Delta format" mono />
			</div>
			<button class="btn-small adv" aria-expanded={ui.adv} onclick={() => (ui.adv = !ui.adv)}>
				{ui.adv ? 'Hide run settings' : 'Run settings'}
			</button>
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
	.machine {
		max-width: 100%;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 5px;
		border: 1px solid var(--line2);
		padding: 2px 6px;
		font-size: 12px;
		transition: opacity 0.12s;
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
		.swatches {
			display: grid;
			grid-template-columns: repeat(3, 7px);
			gap: 3px;
			flex: none;
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
		.machine,
		.snap {
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
		.side {
			justify-content: space-between;
		}
		.adv {
			padding: 7px 12px;
		}
		.adv-grid {
			grid-template-columns: 1fr;
			padding-bottom: 14px;
			margin-top: -4px;
		}
		section:not(.open) .adv-grid {
			display: none;
		}
	}
</style>
