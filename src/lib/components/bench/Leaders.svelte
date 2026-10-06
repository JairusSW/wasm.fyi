<script lang="ts">
	import type { MetricKey, OvKey } from '$lib/data/types';
	import { leader } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import Swatch from '../Swatch.svelte';

	let { onmetric, onoverview }: { onmetric: (m: MetricKey) => void; onoverview: (group: OvKey) => void } = $props();
	let expanded = $state(false);

	const rankingNote = 'Places rank measured means; overlapping uncertainty does not establish a clear lead.';
	const leaders = $derived([
		{ ...leader(ui.scope, 'Fastest compilation', 'lat', 0, 'compile'), overview: null, note: rankingNote },
		{ ...leader(ui.scope, 'Fastest instantiation', 'lat', 1, 'inst'), overview: null, note: rankingNote },
		{ ...leader(ui.scope, 'Lowest average RSS', 'mem', 3, 'rss'), overview: 'mem' as OvKey,
			note: 'Arithmetic mean of recorded whole-process RSS snapshots after benchmark batches across compilation, instantiation, first-call and steady workloads. Each available workload-phase measurement has equal weight. Lower is better. Boundary samples, not a continuous time average; missing observations remain unmeasured.' },
		{ ...leader(ui.scope, 'Fastest execution', 'lat', 3, 'steady'), overview: null, note: rankingNote }
	]);
</script>

<div class="leader-panel">
<div class="tiles leaders" id="benchmark-leader-results">
	{#each leaders as l (l.label)}
		<button
			class="leader hoverbg"
			onclick={() => l.overview ? onoverview(l.overview) : onmetric(l.metric)}
			data-tip={[l.label, l.note, 'Click to see the underlying results'].join('\n')}
		>
			<span class="kicker">{l.label}</span>
			{#if l.places.length}
				{@const first = l.places[0]}
				<span class="results">
					<span class="first" title={`${first.cfg.rt} ${first.cfg.be} · ${first.value}`}>
						<span class="mono value">{first.value}</span>
						<span class="who">
							<Swatch color={first.cfg.col} bg={first.cfg.hollow ? 'transparent' : first.cfg.col} size={9} />
							<span class="w5">{first.cfg.rt}</span>
							<span class="mono small fg3 backend">{first.cfg.be}</span>
						</span>
					</span>
					<span class="places" aria-label="Next places by measured mean">
						{#each l.places.slice(1, expanded ? undefined : 3) as p (p.cfg.id)}
							<span class="place" title={`${p.cfg.rt} ${p.cfg.be} · ${p.value}`}>
								<span class="mono small fg3">{p.place === 2 ? '2nd' : p.place === 3 ? '3rd' : `${p.place}th`}</span>
								<span class="entrant"><span class="who small"><Swatch color={p.cfg.col} bg={p.cfg.hollow ? 'transparent' : p.cfg.col} size={6} /><span>{p.cfg.rt}</span></span><span class="mono micro fg3 backend">{p.cfg.be}</span></span>
								<span class="mono small result-value">{p.value}</span>
							</span>
						{/each}
					</span>
				</span>
			{:else}
				<span class="unclear">No clear leader</span>
				<span class="small fg3">{l.versus}</span>
			{/if}
		</button>
	{/each}
</div>
<button class="expand-bar hoverbg small" aria-expanded={expanded} aria-controls="benchmark-leader-results" onclick={() => expanded = !expanded}>
	{expanded ? 'Show top three' : 'Show all results'} <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
</button>
</div>

<style>
	.leader-panel {
		min-width: 0;
	}
	.expand-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		width: 100%;
		padding: 5px 14px;
		border: 1px solid var(--line);
		border-top: 0;
		border-radius: 0 0 4px 4px;
		background: var(--bg2);
		color: var(--fg3);
	}
	.leaders {
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
	}
	.leader {
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		text-align: left;
	}
	.value {
		font-size: 22px;
		font-weight: 500;
		letter-spacing: -0.02em;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.results {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
		gap: 16px;
		align-items: start;
	}
	.first .who {
		min-width: 0;
		gap: 5px;
	}
	.first .w5 {
		flex: none;
	}
	.first .backend {
		min-width: 0;
		flex: 1;
	}
	.first,
	.places {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.place {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr) auto;
		gap: 5px;
		align-items: start;
	}
	.entrant {
		min-width: 0;
	}
	.entrant .who {
		gap: 4px;
	}
	.entrant .who > span:last-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.backend {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.result-value {
		white-space: nowrap;
	}
	.w5 {
		font-weight: 500;
	}
	.unclear {
		font-size: 18px;
		font-weight: 500;
	}
	/* Phones: a zoomed-out 2×2 grid — winner on top, runners-up as compact lines beneath. */
	@media (max-width: 720px) {
		.leaders {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.leader {
			padding: 10px;
			gap: 6px;
		}
		.leader .kicker {
			font-size: 10px;
			letter-spacing: 0.04em;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.results {
			grid-template-columns: minmax(0, 1fr);
			gap: 8px;
		}
		.value {
			font-size: 18px;
		}
		.first {
			gap: 3px;
		}
		.first .backend {
			font-size: 10px;
		}
		.places {
			gap: 3px;
			padding-top: 6px;
			border-top: 1px solid var(--line);
		}
		.place {
			grid-template-columns: 22px minmax(0, 1fr) auto;
			gap: 4px;
			align-items: center;
		}
		.place > :global(*) {
			font-size: 11px;
		}
		.entrant .backend {
			display: none;
		}
		.expand-bar {
			padding: 9px 14px;
		}
	}
</style>
