<script lang="ts">
	import { CFG, MACH } from '$lib/data/runtimes';
	import type { MachineId } from '$lib/data/types';
	import { ui } from '$lib/state.svelte';
	import Swatch from './Swatch.svelte';
	import { viewData } from '$lib/view-data';

	const SNAP_OPTS = [
		['s1', 'Latest measured cells'],
		['s2', 'Previous measured cells']
	] as const;

	const someHidden = $derived(Object.values(ui.hide).some(Boolean));

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
		{ k: 'Runtimes', v: [...new Set(CFG.map((c) => c.rt + ' ' + c.ver))].join(' · ') },
		{ k: 'Aggregation', v: 'geomean · corpus-balanced · shared workloads only' },
		{ k: 'Cache state', v: 'cold — no on-disk artifact cache' },
		{ k: 'Compilation workers', v: 'Per-runtime configuration; CPU affinity uncontrolled' },
		{ k: 'Warmup & sampling', v: 'Per-cell sealed report records launches, samples and warmups' },
		{ k: 'Feature flags', v: 'runtime defaults (flagged runs separate)' },
		{ k: 'Instrumentation', v: 'none in timing runs · memory from linked runs' },
		{ k: 'Isolation', v: 'Scheduling, frequency and filesystem caches uncontrolled' }
	]);
</script>

<section aria-label="Comparison scope">
	<div class="line">
		<select bind:value={ui.machine} aria-label="Machine" class="machine">
			{#each Object.entries(MACH) as [v, m] (v)}
				<option value={v as MachineId}>{m.l}</option>
			{/each}
		</select>
		<select bind:value={ui.snap} aria-label="Snapshot">
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
			{#if someHidden}<button class="all" onclick={() => (ui.hide = {})}>all</button>{/if}
		</div>
		<button class="btn-small adv" aria-expanded={ui.adv} onclick={() => (ui.adv = !ui.adv)}>
			{ui.adv ? 'Hide run settings' : 'Run settings'}
		</button>
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
		padding: 8px 20px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 14px;
		align-items: center;
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
		padding: 2px 7px;
		font-size: 12px;
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
		margin-left: auto;
		padding: 3px 9px;
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
	}
</style>
