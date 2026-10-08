<script lang="ts">
 import { configVersion } from '$lib/data/runtimes';
	import { siteHref } from '$lib/links';
	import Swatch from '$lib/components/Swatch.svelte';
	import { FEATS, PROPS } from '$lib/data/features';
	import { CFG, RTS } from '$lib/data/runtimes';
	import { viewData } from '$lib/view-data';
	import { EVENTS, SNAPS } from '$lib/data/snapshot';
	import { PROPOSAL_IDS, href } from '$lib/links';
	import { totalWorkloads, disp, isOff, isVisible, ratio } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import { shortCount, n0 } from '$lib/format';

	const board = $derived.by(() => {
		const s = ui.scope;
		const lb = CFG.filter((c) => isVisible(s, c))
			.map((c) => ({ c, r: ratio(s, 'lat', c.id, 3) }))
			.filter((x) => x.r)
			.sort((a, b) => a.r!.r - b.r!.r)
			.slice(0, 5);
		const r0 = lb[0]?.r!.r ?? 1;
		const rMax = lb.length ? lb[lb.length - 1].r!.r : 1;
		return lb.map((x, i) => ({
			c: x.c,
			rank: i + 1,
            report:x.r!.report,
			w: Math.max(4, (Math.log(x.r!.r / r0 + 1) / Math.log(rMax / r0 + 1)) * 100).toFixed(1) + '%',
			val: disp(s, 'lat', x.c.id, 3)!.t
		}));
	});

	const tiles: [number|null, string][] = $derived([
		[RTS.length, 'runtimes & engines tracked'],
		[totalWorkloads(), 'measured contracts'],
		[viewData.statistics.timingSamples, 'recorded timing samples'],
		[FEATS.length, 'features tracked'],
		[viewData.statistics.machines??0, 'machines']
	]);

	const areas = [
		{
			t: 'Benchmarks',
			d: 'Compilation, instantiation, execution, memory and machine code across real programs and microbenchmarks.',
			href: '/benchmarks',
			links: [
				['Fastest execution', href('/benchmarks', { metric: 'steady' }) + '#workloads'],
				['Startup cost', href('/benchmarks', { metric: 'compile' }) + '#workloads'],
				['Memory', href('/benchmarks', { metric: 'rss' }) + '#workloads']
			]
		},
		{
			t: 'History',
			d: 'Every metric over time, with source revisions, recorded gaps and a fixed comparison-engine baseline.',
			href: '/history',
			links: [
				['Execution trend', '/history'],
				['Machine code size', href('/history', { ot: 'code' })],
				['Correctness', href('/history', { ot: 'cov' })]
			]
		},
		{
			t: 'Features',
			d: 'Released engine compatibility, official suite results and feature performance.',
			href: '/features',
			links: [
				['SIMD', '/simd'],
				['WasmGC', '/gc'],
				['Threads', '/threads']
			]
		}
	];

	const props = PROPOSAL_IDS.map((id) => ({
		id,
		title: PROPS[id].title,
		q: PROPS[id].q,
		phase: FEATS.find((f) => f.id === id)!.phase
	}));
	const events = [...EVENTS].reverse().map((e) => ({ date: SNAPS[e.i].date, label: e.label }));
</script>

<svelte:head>
	<title>wasm.fyi — The reference for WebAssembly runtimes</title>
</svelte:head>

<section class="hero">
	<div class="intro">
		<span class="mono fg3 s12">wasm.fyi</span>
		<h1>The reference for WebAssembly runtimes.</h1>
		<p class="lead">
			Independent benchmarks, feature support and proposal performance. Every number links to the run that produced it.
		</p>
		<div class="ctas">
			<a class="btn-primary" href={siteHref(`/benchmarks`)}>Explore benchmarks</a>
			<a class="btn-outline" href={siteHref(`/features`)}>Feature status</a>
		</div>
	</div>
	<div class="panel board">
		<div class="board-head">
			<span class="w6">Fastest execution</span>
			<span class="mono small fg3">{board[0]?viewData.reports[board[0].report].created.slice(0,10):'not measured'} · per invocation</span>
		</div>
		<div class="board-rows">
			{#each board as b (b.c.id)}
				<button
					class="board-row"
					onclick={() => ui.openProfile(b.c.rt)}
					data-tip={`${b.c.rt} ${configVersion(ui.machine,b.c.id)} · ${b.c.be}\n${b.c.kind}\nClick to open runtime profile`}
				>
					<span class="mono small fg3">{b.rank}</span>
					<span class="rtname">
						<Swatch color={b.c.col} bg={b.c.hollow ? 'transparent' : b.c.col} />{b.c.rt}
						<span class="small fg3">{b.c.be}</span>
					</span>
					<span class="bar" style:width={b.w} style:background={b.c.col}></span>
					<span class="mono r s12">{b.val}</span>
				</button>
			{/each}
		</div>
	<div class="board-foot small fg3">Geometric mean over measured application workloads · merged host-local reports</div>
	</div>
</section>

<section class="tiles-row">
	{#each tiles as [v, l] (l)}
		<div class="tile"><span class="mono tv" title={v==null?undefined:shortCount(v) === n0(v) ? undefined : n0(v)}>{v==null?'not collected':shortCount(v)}</span> <span class="fg3">{l}</span></div>
	{/each}
</section>

<section class="block">
	<div class="heading">
		<span class="eyebrow">What's inside</span>
		<h2>One place to answer “which runtime, and why?”</h2>
	</div>
	<div class="areas">
		{#each areas as a (a.t)}
			<div class="area">
				<a class="area-title" href={siteHref(a.href)}>{a.t} →</a>
				<p class="fg2">{a.d}</p>
				<div class="area-links">
					{#each a.links as [label, to] (label)}<a class="link" href={siteHref(to)}>{label}</a>{/each}
				</div>
			</div>
		{/each}
	</div>
</section>

<section class="block">
	<div class="heading">
		<span class="eyebrow">Proposals</span>
		<h2>Beyond the checkbox.</h2>
		<p class="fg2 s14">Each major proposal has a permanent page combining status, adoption and measured performance.</p>
	</div>
	<div class="props">
		{#each props as p (p.id)}
			<a class="prop panel" href={siteHref(`/${p.id}`)} data-tip="Open the {p.title} page: status, adoption & performance">
				<span class="prop-head"><span class="s18 w6">{p.title}</span><span class="mono micro fg3">{p.phase}</span></span>
				<span class="fg2">{p.q}</span>
			</a>
		{/each}
	</div>
</section>

<section class="block split">
	<div class="col">
		<div class="heading">
			<span class="eyebrow">Methodology</span>
			<h2>Built to be checked.</h2>
		</div>
		<div class="points">
			<div>
				<div class="w6 s14">Every number is reproducible</div>
				<div class="fg2">Each result resolves to a run record with versions, flags, machine, harness revision and the exact command.</div>
			</div>
			<div>
				<div class="w6 s14">Scope is always visible</div>
				<div class="fg2">Hardware, snapshot and workload set travel with every comparison, chart and export.</div>
			</div>
			<div>
				<div class="w6 s14">Missing is never zero</div>
				<div class="fg2">Unsupported, failed, crashed and not-measured stay distinct. Incorrect results get no performance credit.</div>
			</div>
		</div>
	</div>
	<div class="col">
		<div class="heading">
			<span class="eyebrow">Recent changes</span>
			<h2>What moved this quarter.</h2>
		</div>
		<div>
			{#each events as e (e.label)}
				<div class="event"><span class="mono s12 fg3">{e.date}</span><span>{e.label}</span></div>
			{/each}
		</div>
		<a class="link" href={siteHref(`/history`)}>All history and change reports</a>
	</div>
</section>

<section class="panel cta">
	<div class="cta-text">
		<h2 class="s22">Missing a runtime or a program?</h2>
		<p class="fg2 s14">wasm.fyi is open. Submit a runtime adapter, add a workload, or reproduce a result on your own hardware.</p>
	</div>
	<a class="btn-primary" href="https://github.com/JairusSW/wasm.fyi">Contribute on GitHub</a>
</section>

<style>
	.s12 {
		font-size: 12px;
	}
	.s14 {
		font-size: 14px;
	}
	.s18 {
		font-size: 18px;
	}
	.s22 {
		font-size: 22px;
		font-weight: 600;
	}
	.w6 {
		font-weight: 600;
	}
	.hero {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
		gap: 40px;
		align-items: center;
		padding: 48px 0 40px;
	}
	.intro {
		display: flex;
		flex-direction: column;
		gap: 18px;
		max-width: 600px;
	}
	h1 {
		font-size: 46px;
		line-height: 1.05;
		font-weight: 600;
		letter-spacing: -0.025em;
		text-wrap: balance;
	}
	.lead {
		font-size: 16px;
		line-height: 1.55;
		color: var(--fg2);
		text-wrap: pretty;
	}
	.ctas {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.board {
		display: flex;
		flex-direction: column;
	}
	.board-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--line);
	}
	.board-rows {
		padding: 10px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.board-row {
		display: grid;
		grid-template-columns: 16px 150px 1fr 70px;
		gap: 10px;
		align-items: center;
		font-size: 13px;
	}
	.rtname {
		display: flex;
		align-items: center;
		gap: 7px;
		white-space: nowrap;
	}
	.bar {
		height: 8px;
		opacity: 0.85;
	}
	.board-foot {
		padding: 10px 16px;
		border-top: 1px solid var(--line);
	}
	@media (max-width: 600px) {
		.board-head { align-items: flex-start; flex-direction: column; }
	}
	.tiles-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
	}
	.tile {
		padding: 22px 4px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.tv {
		font-size: 28px;
		font-weight: 500;
		letter-spacing: -0.02em;
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 40px 0 12px;
	}
	.heading {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.heading p {
		max-width: 640px;
	}
	.eyebrow {
		font-size: 11px;
		color: var(--fg3);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	h2 {
		font-size: 26px;
		font-weight: 600;
		letter-spacing: -0.015em;
	}
	.areas {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
		gap: 1px;
		background: var(--line);
		border: 1px solid var(--line);
	}
	.area {
		background: var(--bg2);
		padding: 20px 22px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.area-title {
		font-size: 18px;
		font-weight: 600;
		text-decoration: none;
	}
	.area p {
		line-height: 1.5;
		text-wrap: pretty;
	}
	.area-links {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		margin-top: auto;
	}
	.props {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 14px;
	}
	.prop {
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		text-decoration: none;
		line-height: 1.45;
	}
	.prop:hover {
		border-color: var(--fg3);
	}
	.prop-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
	}
	.split {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
		gap: 40px;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.col > .link {
		align-self: flex-start;
	}
	.points {
		display: flex;
		flex-direction: column;
		gap: 14px;
		line-height: 1.5;
	}
	.event {
		display: grid;
		grid-template-columns: 100px 1fr;
		gap: 10px;
		border-bottom: 1px solid var(--line);
		padding: 8px 0;
	}
	.cta {
		margin: 40px 0 8px;
		padding: 28px;
		display: flex;
		flex-wrap: wrap;
		gap: 16px 32px;
		align-items: center;
		justify-content: space-between;
	}
	.cta-text {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-width: 620px;
	}
	@media (max-width: 720px) {
		.hero {
			padding: 20px 0 8px;
			gap: 28px;
		}
		h1 {
			font-size: clamp(32px, 9.5vw, 40px);
		}
		.lead {
			font-size: 15px;
		}
		.ctas > :global(a) {
			flex: 1 1 auto;
		}
		.board-head,
		.board-rows,
		.board-foot {
			padding-left: 14px;
			padding-right: 14px;
		}
		.tiles-row {
			grid-template-columns: 1fr 1fr;
		}
		.tile {
			padding: 16px 4px;
		}
		.tile:last-child:nth-child(odd) {
			grid-column: 1 / -1;
		}
		.tv {
			font-size: 24px;
		}
		.block {
			padding: 28px 0 4px;
			gap: 16px;
		}
		h2 {
			font-size: 22px;
		}
		.area {
			padding: 16px;
		}
		.prop {
			padding: 16px;
		}
		.split {
			gap: 28px;
		}
		.event {
			grid-template-columns: 88px 1fr;
		}
		.cta {
			margin-top: 28px;
			padding: 20px 16px;
		}
		.cta > :global(.btn-primary) {
			flex: 1 1 100%;
		}
	}
</style>
