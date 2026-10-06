<script lang="ts">
	import { CFG, MACH } from '$lib/data/runtimes';
	import type { MachineId } from '$lib/data/types';
	import { ui } from '$lib/state.svelte';
	import Swatch from './Swatch.svelte';
	import Seg from './Seg.svelte';
	import { viewData } from '$lib/view-data';

	const SNAP_OPTS = [
		['s1', 'Latest measured cells'],
		['s2', 'Previous measured cells']
	] as const;

	const someHidden = $derived(Object.values(ui.hide).some(Boolean));
	const shown = $derived(CFG.filter((c) => !ui.hide[c.id]));
	// Phones collapse the scope controls behind a one-line summary.
	let open = $state(false);

	function toggle(id: (typeof CFG)[number]['id']) {
		const next = { ...ui.hide, [id]: !ui.hide[id] };
		if (CFG.every((x) => next[x.id])) return; // keep at least one runtime visible
		ui.hide = next;
	}
	function solo(e: MouseEvent, id: string) {
		e.preventDefault();
		ui.hide = Object.fromEntries(CFG.map((x) => [x.id, x.id !== id]));
	}

	const advItems = $derived([
		{ k: 'OS', v: MACH[ui.machine].os },
		{ k: 'Runtimes', v: Object.values(viewData.hosts[ui.machine].configurations).map(c=>c!.runtime+' '+c!.version).join(' · ') },
		{ k: 'Aggregation', v: 'geomean · '+ui.weighting+' weighting · shared successful cohort' },
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
			<span class="sum-meta fg3">{ui.snap === 's1' ? 'Latest' : 'Previous'} cells · {shown.length}/{CFG.length} runtimes · Δ {ui.deltaFormat === 'factor' ? '×' : '%'}</span>
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
			<select bind:value={ui.snap} aria-label="Snapshot" class="snap">
				{#each SNAP_OPTS as [v, l] (v)}
					<option value={v}>{l}</option>
				{/each}
			</select>
			<div class="chips" role="group" aria-label="Runtimes shown">
				{#each CFG as c (c.id)}
					{@const on = !ui.hide[c.id]}
					<button
						class="chip"
						class:off={!on}
						aria-pressed={on}
						onclick={() => toggle(c.id)}
						ondblclick={(e) => solo(e, c.id)}
						data-tip={`${c.rt} ${viewData.hosts[ui.machine].configurations[c.id]?.version || 'not collected'} · ${c.be}\n${c.kind}\n${on ? 'Click to hide · double-click to show only this' : 'Hidden · click to show, double-click to solo'}`}
					>
						<Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} />{c.rt}
						<span class="be">{c.be}</span>
					</button>
				{/each}
				{#if someHidden}<button class="all" onclick={() => (ui.hide = {})}>Show all</button>{/if}
			</div>
		</div>
		<div class="side">
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
