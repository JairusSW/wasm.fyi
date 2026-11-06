<script lang="ts">
	import Brand from '$lib/components/Brand.svelte';
	import Swatch from '$lib/components/Swatch.svelte';
	import { CFG } from '$lib/data/runtimes';
	import { UNIT } from '$lib/data/snapshot';
	import type { Cfg } from '$lib/data/types';
	import { fmtU, n0 } from '$lib/format';
	import { href, siteHref } from '$lib/links';
	import { absOf, combinedLatency, compileExcluded, isVisible, totalWorkloads, type PerfGroup } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import { viewData } from '$lib/view-data';

	type MetricId = 'steady' | 'compile' | 'inst' | 'rss' | 'e2e';
	// `col` indexes the aggregate column; end-to-end sums all four latency phases instead.
	const METRICS: Record<MetricId, { label: string; group: PerfGroup; col: number }> = {
		steady: { label: 'Execution', group: 'lat', col: 3 },
		compile: { label: 'Compile', group: 'lat', col: 0 },
		inst: { label: 'Instantiate', group: 'lat', col: 1 },
		rss: { label: 'Memory', group: 'mem', col: 3 },
		e2e: { label: 'End-to-end', group: 'lat', col: -1 }
	};
	const IDS = Object.keys(METRICS) as MetricId[];

	let sortBy = $state<MetricId>('steady');
	const TOP = 10;

	/** One metric's aggregate for a runtime, or null when it was not measured. */
	function value(c: Cfg, id: MetricId): number | null {
		const s = ui.scope;
		if (id === 'e2e') return combinedLatency(s, c, [0, 1, 2, 3])?.total ?? null;
		if (id === 'compile' && compileExcluded(s, c, 'compile')) return null;
		const v = absOf(s, METRICS[id].group, c.id, METRICS[id].col)?.v;
		return v != null && Number.isFinite(v) && v > 0 ? v : null;
	}

	const ranked = $derived.by(() => {
		const list = CFG.filter((c) => viewData.applicationConfigurations.includes(c.id) && isVisible(ui.scope, c))
			.map((c) => ({ c, v: value(c, sortBy) }))
			.filter((r): r is { c: Cfg; v: number } => r.v != null)
			.sort((a, b) => a.v - b.v);
		// Bars show relative speed (or leanness): the leader fills the track.
		return list.map((r) => ({ ...r, bar: (list[0].v / r.v) * 100 }));
	});

	const benchHref = $derived(siteHref(href('/benchmarks', { metric: sortBy === 'e2e' ? 'steady' : sortBy })));
	const fmt = (v: number) => fmtU(v, UNIT[METRICS[sortBy].group]);
	const updated = $derived.by(() => {
		const dates = ranked.map((r) => viewData.reports[absOf(ui.scope, 'lat', r.c.id, 3)?.report ?? '']?.created.slice(0, 10)).filter(Boolean) as string[];
		return dates.sort().at(-1) ?? null;
	});
	const host = $derived(viewData.hosts[ui.machine]?.label ?? '');

	const samples = $derived({ all: viewData.statistics.allTimingSamples ?? 0, latest: viewData.statistics.timingSamples ?? 0 });
	let { data } = $props();
	const feat = $derived(data.features?.[ui.machine]);
</script>

<svelte:head>
	<title>wasm.fyi — The reference for WebAssembly runtimes</title>
</svelte:head>

<div class="home">
	<header class="hero">
		<div class="mark">
			<h1><Brand width={440} /></h1>
		</div>
		{#if samples.all}
			<div class="captures">
				<span class="big mono">{n0(samples.all)}</span>
				<span class="cap">timing samples captured</span>
				{#if samples.latest}<span class="cap sub mono">{n0(samples.latest)} in the current results</span>{/if}
			</div>
		{/if}
	</header>

	<div class="pitch">
		<p>Measuring WebAssembly runtimes on real programs: compile, startup, execution and memory</p>
		<div class="ctas">
			<a class="btn solid" href={siteHref('/benchmarks')}>Explore benchmarks <span aria-hidden="true">→</span></a>
			<a class="btn" href={siteHref('/features')}>Feature support</a>
		</div>
	</div>

	<section aria-labelledby="lb-title">
		<div class="lb-head">
			<h2 id="lb-title">Leaderboard</h2>
			<span class="meta">{[host, `${totalWorkloads()} workloads`, updated && `updated ${updated}`].filter(Boolean).join(' · ')}</span>
		</div>

		<div class="seg" role="tablist" aria-label="Rank by">
			{#each IDS as id (id)}
				<button role="tab" aria-selected={sortBy === id} class:on={sortBy === id} onclick={() => (sortBy = id)}>{METRICS[id].label}</button>
			{/each}
		</div>

		<div class="box">
			<ol class="lb">
				{#each ranked.slice(0, TOP) as r, i (r.c.id)}
					<li>
						<a href={benchHref}>
							<span class="rank mono">{i + 1}</span>
							<span class="name">
								<Swatch color={r.c.col} bg={r.c.hollow ? 'transparent' : r.c.col} size={10} />
								<span class="rt">{r.c.rt}</span>
								<span class="be">{r.c.be}</span>
							</span>
							<span class="track"><span class="bar" style:width="{r.bar}%" style:background={r.c.col}></span></span>
							<span class="val mono">{fmt(r.v)}</span>
						</a>
					</li>
				{:else}
					<li class="empty">Loading…</li>
				{/each}
			</ol>
			<a class="all" href={benchHref}>
				<span>{ranked.length > TOP ? `See all ${ranked.length} runtimes` : 'See every workload'} on Benchmarks</span>
				<span aria-hidden="true">→</span>
			</a>
		</div>
	</section>

	<section aria-labelledby="prop-title">
		<div class="lb-head">
			<h2 id="prop-title">Proposals</h2>
			{#if feat}<span class="meta">{feat.support.families} features · spec corpus tests</span>{/if}
		</div>
		<div class="panels">
			<div class="box panel">
				<div class="panel-head">
					<span class="pt">Support</span>
					<span class="pd">Features where every corpus test passes</span>
				</div>
				<ol class="lb">
					{#each feat?.support.top ?? [] as { who: c, full } (c.id)}
							<li>
								<a href={siteHref('/features')}>
									<span class="rank mono">{feat!.support.top.findIndex((x) => x.full === full) + 1}</span>
									<span class="name"><Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} size={10} /><span class="rt">{c.rt}</span><span class="be">{c.be}</span></span>
									<span class="track"><span class="bar" style:width="{(full / feat!.support.families) * 100}%" style:background={c.col}></span></span>
									<span class="val mono">{full} / {feat!.support.families}</span>
								</a>
							</li>
					{:else}
						<li class="empty">{data.features ? 'Not collected on this machine' : 'Loading…'}</li>
					{/each}
				</ol>
				<a class="all" href={siteHref('/features')}><span>Support matrix</span><span aria-hidden="true">→</span></a>
			</div>
			<div class="box panel">
				<div class="panel-head">
					<span class="pt">Speed</span>
					<span class="pd">{feat?.speed.shared ? `Average execution time per feature, over the contracts all ${feat.speed.top.length} pass · ${feat.speed.shared} features` : 'Average execution time per feature'}</span>
				</div>
				<ol class="lb">
					{#each feat?.speed.top ?? [] as { who: c, ms }, i (c.id)}
							<li>
								<a href={siteHref('/features?view=perf')}>
									<span class="rank mono">{i + 1}</span>
									<span class="name"><Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} size={10} /><span class="rt">{c.rt}</span><span class="be">{c.be}</span></span>
									<span class="track"><span class="bar" style:width="{(ms / feat!.speed.top.at(-1)!.ms) * 100}%" style:background={c.col}></span></span>
									<span class="val mono">{fmtU(ms, 'ms')}</span>
								</a>
							</li>
					{:else}
						<li class="empty">{data.features ? 'Not measured on this machine' : 'Loading…'}</li>
					{/each}
				</ol>
				<a class="all" href={siteHref('/features?view=perf')}><span>Feature performance</span><span aria-hidden="true">→</span></a>
			</div>
		</div>
	</section>
</div>

<style>
	.home {
		width: 100%;
		max-width: 1040px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		padding: 56px 0 24px;
	}

	/* Hero */
	.hero {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 24px 48px;
		flex-wrap: wrap;
		padding-bottom: 40px;
		border-bottom: 1px solid var(--line);
	}
	h1 {
		margin: 0;
		line-height: 0;
	}
	.captures {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		text-align: right;
	}
	.big {
		font-size: 34px;
		font-weight: 500;
		letter-spacing: -0.03em;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
	.cap {
		font-size: 13px;
		color: var(--fg2);
	}
	.cap.sub {
		margin-top: 6px;
		font-size: 11px;
		color: var(--fg3);
	}
	.pitch {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 20px 40px;
		padding: 32px 0 0;
	}
	.pitch p {
		margin: 0;
		max-width: 30ch;
		font-size: 20px;
		line-height: 1.4;
		color: var(--fg2);
		text-wrap: balance;
	}
	.ctas {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 11px 18px;
		border: 1px solid var(--line2);
		font-size: 14px;
		font-weight: 500;
		text-decoration: none;
		transition: background 0.15s;
	}
	.btn:hover {
		background: var(--hover);
	}
	.btn.solid {
		background: var(--fg);
		border-color: var(--fg);
		color: var(--bg);
	}
	.btn.solid:hover {
		opacity: 0.88;
	}

	/* Sections */
	section {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding-top: 88px;
	}
	h2 {
		margin: 0 0 8px;
		font-size: 30px;
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	.lb-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 16px;
	}
	.lb-head h2 {
		margin: 0;
	}
	.seg {
		display: inline-flex;
		align-self: flex-start;
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: none;
		border: 1px solid var(--line2);
	}
	.seg button {
		padding: 6px 12px;
		font-size: 13px;
		color: var(--fg2);
		white-space: nowrap;
	}
	.seg button + button {
		border-left: 1px solid var(--line);
	}
	.seg button:hover {
		color: var(--fg);
	}
	.seg button.on {
		background: var(--fg);
		color: var(--bg);
	}
	.meta {
		font-size: 13px;
		color: var(--fg3);
		text-decoration: none;
	}
	.box {
		border: 1px solid var(--line);
		background: var(--bg2);
	}
	/* Leaderboard */
	.lb {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.lb a {
		display: grid;
		grid-template-columns: 20px minmax(0, 15rem) 1fr 6rem;
		gap: 16px;
		align-items: center;
		padding: 11px 18px;
		border-bottom: 1px solid var(--line);
		font-size: 13px;
		text-decoration: none;
	}
	.lb a:hover {
		background: var(--hover);
	}
	.rank {
		font-size: 11px;
		color: var(--fg3);
	}
	.name {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		white-space: nowrap;
	}
	.rt {
		font-weight: 500;
	}
	.be {
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--fg3);
	}
	.track {
		position: relative;
		display: block;
		height: 10px;
		background: var(--bg3);
	}
	.bar {
		position: absolute;
		inset: 0 auto 0 0;
	}
	.val {
		font-size: 12px;
		font-weight: 600;
		text-align: right;
		white-space: nowrap;
	}
	.empty {
		padding: 40px 18px;
		color: var(--fg3);
		text-align: center;
	}
	.all {
		display: flex;
		justify-content: space-between;
		padding: 14px 18px;
		font-size: 13px;
		font-weight: 500;
		text-decoration: none;
		transition: background 0.15s;
	}
	.all:hover {
		background: var(--hover);
	}

	/* Proposal panels */
	.panels {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	.panel {
		display: flex;
		flex-direction: column;
	}
	.panel .lb {
		flex: 1;
	}
	.panel-head {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 16px 18px 12px;
		border-bottom: 1px solid var(--line);
	}
	.pt {
		font-size: 15px;
		font-weight: 600;
	}
	.pd {
		font-size: 12px;
		color: var(--fg3);
	}
	.panel .lb a {
		grid-template-columns: 14px minmax(0, 10rem) 1fr 4.5rem;
		gap: 12px;
	}

	@media (max-width: 760px) {
		.home {
			padding-top: 32px;
		}
		.hero :global(.logo) {
			width: 100% !important;
		}
		.mark {
			flex: 1 1 100%;
		}
		.captures {
			align-items: flex-start;
			text-align: left;
		}
		.big {
			font-size: 28px;
		}
		.pitch p {
			font-size: 17px;
		}
		section {
			padding-top: 64px;
		}
		h2 {
			font-size: 24px;
		}
		.panels {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 520px) {
		.lb a {
			grid-template-columns: 14px minmax(0, 1fr) auto;
			gap: 10px;
			padding: 11px 14px;
		}
		.lb .track {
			display: none;
		}
		.panel .lb a {
			grid-template-columns: 14px minmax(0, 1fr) auto;
		}
		.all {
			padding: 14px;
		}
	}
</style>
