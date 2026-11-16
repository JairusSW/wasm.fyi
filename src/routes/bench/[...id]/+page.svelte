<script lang="ts">
	import { apiView, loadHistory, loadHistoryComparison } from '$lib/api/controller.svelte';
	import { apiHistory } from '$lib/api/history.svelte';
	import RunLocally from '$lib/components/RunLocally.svelte';
	import ArtifactInspection from '$lib/components/ArtifactInspection.svelte';
	import RtLabel from '$lib/components/RtLabel.svelte';
	import Seg from '$lib/components/Seg.svelte';
	import StatusLegend from '$lib/components/StatusLegend.svelte';
	import { base } from '$app/paths';
	import { siteHref } from '$lib/links';
	import { CFG, MACH } from '$lib/data/runtimes';
	import { MET, PHASE_NOTE, SNAPS } from '$lib/data/snapshot';
	import { ST } from '$lib/data/status';
	import type { CfgId } from '$lib/data/types';
	import { fmtU, fx, relative, workloadName } from '$lib/format';
	import { benchVal, isVisible, otSeries, type BenchResult } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import { lazyTipCard, tipWho } from '$lib/tip';
	import { viewCell, viewData } from '$lib/view-data';
	import { historySegments, historyEndpoints } from '$lib/history-values';
	import { RangeSelect } from '$lib/range-select.svelte';

	let { data } = $props();
	// The catalogue arrives with the dataset; until then (or for an unknown id) a stub keeps every
	// derived value safe and the page shows a placeholder instead of crashing.
	const found = $derived(viewData.catalogue.find((w) => w.id === data.workload));
	const b = $derived(found ?? ({ id: data.workload, group: '', tags: [], purpose: '' } as unknown as (typeof viewData.catalogue)[number]));
	const vis = $derived(CFG.filter((c) => isVisible(ui.scope, c)));

	// ── Results: every visible runtime × the six per-workload measurements ──
	type M = 'steady' | 'compile' | 'inst' | 'first' | 'rss' | 'code';
	const METRICS: { m: M; label: string; short: string }[] = [
		{ m: 'steady', label: 'Steady execution', short: 'Steady' },
		{ m: 'compile', label: 'Compilation', short: 'Compile' },
		{ m: 'inst', label: 'Instantiation', short: 'Instantiate' },
		{ m: 'first', label: 'First call', short: 'First call' },
		{ m: 'rss', label: 'Peak memory', short: 'Peak RSS' },
		{ m: 'code', label: 'Native code size', short: 'Code' }
	];
	const LABEL = Object.fromEntries(METRICS.map((x) => [x.m, x])) as Record<M, (typeof METRICS)[number]>;
	const NOTE: Record<M, string> = { ...PHASE_NOTE, rss: PHASE_NOTE.rss, code: PHASE_NOTE.code } as Record<M, string>;
	const results = $derived(vis.map((c) => ({ c, r: Object.fromEntries(METRICS.map(({ m }) => [m, benchVal(ui.scope, b, c.id, m)])) as Record<M, BenchResult> })));
	const val = (r: BenchResult) => (r.st === 'ok' ? r.v : null);
	const range = $derived(
		Object.fromEntries(
			METRICS.map(({ m }) => {
				const ok = results.flatMap((x) => (x.r[m].st === 'ok' ? [{ c: x.c, v: x.r[m].v }] : [])).sort((a, b) => a.v - b.v);
				return [m, ok.length ? { best: ok[0], worst: ok.at(-1)!, n: ok.length } : null];
			})
		) as Record<M, { best: { c: (typeof CFG)[number]; v: number }; worst: { c: (typeof CFG)[number]; v: number }; n: number } | null>
	);
	const fmt = (m: M, v: number) => fmtU(v, MET[m].u);
	const statusText = (r: BenchResult) => (r.st === 'ok' ? '' : `${ST[r.st][0]} ${ST[r.st][1]}`);
	const open = (c: CfgId, m: M) => (ui.drawer = { type: 'cell', b: b.id, c, m, cf: 1 });
	const passing = $derived(results.filter((x) => x.r.steady.st === 'ok').length);
	const failures = $derived(results.filter((x) => !['ok', 'nm', 'na', 'unavail'].includes(x.r.steady.st)));

	// ── Ranked chart for one measurement ──
	let focus = $state<M>('steady');
	const ranked = $derived.by(() => {
		const span = range[focus];
		const ok = results.filter((x) => x.r[focus].st === 'ok').sort((a, b) => val(a.r[focus])! - val(b.r[focus])!);
		const rest = results.filter((x) => x.r[focus].st !== 'ok');
		// Startup phases span orders of magnitude, so wide ranges plot on a log scale.
		const log = !!span && span.worst.v / span.best.v > 20;
		const width = (v: number) => {
			if (!span) return 0;
			if (log) return 4 + (96 * Math.log(v / span.best.v)) / Math.log(span.worst.v / span.best.v || 2);
			return Math.max(2, (v / span.worst.v) * 100);
		};
		return { log, rows: [...ok.map((x, i) => ({ ...x, rank: i + 1, v: val(x.r[focus])!, w: width(val(x.r[focus])!) })), ...rest.map((x) => ({ ...x, rank: 0, v: null, w: 0 }))] };
	});

	// ── All-results table ──
	let sort = $state<{ m: M | 'name'; dir: 1 | -1 }>({ m: 'steady', dir: 1 });
	const sorted = $derived(
		[...results].sort((a, z) => {
			if (sort.m === 'name') return sort.dir * `${a.c.rt} ${a.c.be}`.localeCompare(`${z.c.rt} ${z.c.be}`);
			const x = val(a.r[sort.m]), y = val(z.r[sort.m]);
			if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
			return sort.dir * (x - y);
		})
	);
	const sortBy = (m: M | 'name') => (sort = { m, dir: sort.m === m ? (-sort.dir as 1 | -1) : 1 });
	const inspectLink = (cid: CfgId) => {
		const cell = viewCell(ui.machine, ui.snap, b.id, cid, 'code');
		const report = viewData.reports[cell.report];
		const native = report?.codeRecords.find((r) => r.runtime === viewData.configurations[cid] && r.workload === b.id && r.status === 'available' && r.inspectable);
		return { artifact: cell.artifact, image: report?.codeSource?.id && native ? `${base}/wasmbench/code-inspection/${encodeURIComponent(report.codeSource.id)}/view.html?trial=${encodeURIComponent(native.trial)}` : null };
	};
	let inspected = $state<string | null>(null);

	// ── Neighbours within the same corpus group ──
	const siblings = $derived(viewData.catalogue.filter((w) => w.group === b.group && w.id.startsWith('features/') === b.id.startsWith('features/')).sort((x, y) => x.id.localeCompare(y.id)));
	const at = $derived(siblings.findIndex((w) => w.id === b.id));
	const prev = $derived(at > 0 ? siblings[at - 1] : null);
	const next = $derived(at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : null);
	const benchHref = (id: string) => siteHref('/bench/' + encodeURI(id).replace(/[?#]/g, encodeURIComponent) + '/');
	const tagHref = (t: string) => (t === 'simd' ? '/simd' : '/benchmarks?tag=' + encodeURIComponent(t) + '#workloads');

	// ── History: fetched only once the section is on screen ──
	let historyShown = $state(false);
	const onScreen = (node: HTMLElement) => {
		const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && ((historyShown = true), observer.disconnect()), { rootMargin: '200px' });
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	};
	$effect(() => {
		if (!historyShown || !apiView.ready) return;
		apiView.historyRevision;
		void loadHistory({ ...ui.scope, snapshot: ui.snap, metric: ui.metric }, 'exec', b.id);
	});
	$effect(() => {
		if (!historyShown || !apiView.ready) return;
		const from = SNAPS[ui.histFrom]?.date, to = SNAPS[ui.histTo]?.date;
		if (!from || !to) return;
		const scope = { ...ui.scope, snapshot: ui.snap, metric: ui.metric }, workload = b.id;
		const timer = setTimeout(() => void loadHistoryComparison(scope, 'exec', from, to, workload), 100);
		return () => clearTimeout(timer);
	});
	const SX = (i: number) => 2 + i * (156 / Math.max(1, SNAPS.length - 1));
	const SSTEP = 156 / Math.max(1, SNAPS.length - 1);
	const histRange = new RangeSelect(
		(fx) => Math.max(0, Math.min(SNAPS.length - 1, Math.round((fx * 160 - 2) / SSTEP))),
		(from, to) => {
			ui.histFrom = from;
			ui.histTo = to;
		}
	);
	const full = $derived(ui.histFrom === 0 && ui.histTo === SNAPS.length - 1);
	const spark = $derived(
		vis.map((c) => {
			const vals = otSeries(ui.scope, c.id, 'exec', b.id);
			if (!vals) return { c, segments: [] as string[], now: 'not collected', delta: '', dColor: 'var(--fg3)' };
			const finite = vals.filter(Number.isFinite);
			const lo = Math.min(...finite), hi = Math.max(...finite);
			const Y = (v: number) => 21 - ((v - lo) / (hi - lo || 1)) * 18;
			const ends = historyEndpoints(vals, ui.histFrom, ui.histTo);
			const d = ends ? vals[ends[1]] / vals[ends[0]] - 1 : NaN;
			const last = vals.findLastIndex((v, i) => i >= ui.histFrom && i <= ui.histTo && Number.isFinite(v));
			return {
				c,
				segments: historySegments(vals, SX, Y),
				now: last >= 0 ? fmtU(vals[last], 'ms') : ST.unavail[0],
				delta: Number.isFinite(d) ? relative(1 + d, ui.deltaFormat) : ST.unavail[0],
				dColor: Math.abs(d) < 0.02 ? 'var(--fg3)' : d < 0 ? 'var(--good)' : 'var(--bad)'
			};
		})
	);

	// ── Details ──
	const references = $derived(
		[...new Set(vis.flatMap((c) => ['compile', 'inst', 'first', 'steady', 'rss', 'code'].map((m) => viewCell(ui.machine, ui.snap, b.id, c.id, m).report)).filter(Boolean))].map((id) => ({ id, ...viewData.reports[id] }))
	);
	const collectionBundles = $derived([...new Map(references.flatMap((r) => (r.collectionBundle ? [[r.collectionBundle.url, r.collectionBundle] as const] : []))).values()]);
	const facts = $derived(
		[
			{ k: 'Wasm', v: b.kb == null ? null : fmtU(b.kb, 'KiB') },
			{ k: 'Imports', v: b.imports == null ? null : `${b.imports} · ${b.abi}` },
			{ k: 'Source', v: b.src || null },
			{ k: 'Input', v: b.input || null }
		].filter((f) => f.v)
	);
	const details = $derived([
		{ k: 'Wasm artifact', v: (b.kb == null ? 'size not recorded' : fmtU(b.kb, 'KiB')) + ' · sha256 ' + b.artifactSha256 },
		{ k: 'Declared features', v: b.tags.join(' · ') || 'none recorded' },
		{ k: 'Machine', v: `${MACH[ui.machine].l} · ${MACH[ui.machine].os}` },
		{ k: 'Reset policy', v: b.reset || 'not recorded' },
		{ k: 'Correctness oracle', v: JSON.stringify(b.oracle) || 'not recorded' },
		{ k: 'Reports', v: references.map((r) => r.runId + ' · ' + r.created).join('\n') || 'not collected' },
		{ k: 'Memory passes', v: references.map((r) => r.memorySource?.id).filter(Boolean).join(' · ') || 'not collected' },
		{ k: 'Code passes', v: references.map((r) => r.codeSource?.id).filter(Boolean).join(' · ') || 'not collected' }
	]);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && histRange.clear()} />

<svelte:head>
	<title>{workloadName(b.id)} · wasm.fyi</title>
</svelte:head>

<header class="head">
	<nav class="crumbs" aria-label="Breadcrumb">
		<a href={siteHref('/benchmarks')}>Benchmarks</a>
		{#if b.group}<span aria-hidden="true">/</span><a href={siteHref('/benchmarks?search=' + encodeURIComponent(b.group) + '#workloads')}>{b.group}</a>{/if}
		{#if siblings.length > 1 && at >= 0}<span class="pos mono">{at + 1} of {siblings.length}</span>{/if}
	</nav>
	<div class="title">
		<h1 class="mono">{workloadName(b.id)}</h1>
		<div class="step">
			{#if prev}<a class="nav-btn" href={benchHref(prev.id)} data-tip={`Previous: ${workloadName(prev.id)}`} aria-label="Previous workload">←</a>{/if}
			{#if next}<a class="nav-btn" href={benchHref(next.id)} data-tip={`Next: ${workloadName(next.id)}`} aria-label="Next workload">→</a>{/if}
		</div>
	</div>
	{#if found}
		{#if b.purpose}<p class="purpose">{b.purpose}</p>{/if}
		<div class="facts">
			{#each b.tags as t (t)}<a class="tag" href={siteHref(tagHref(t))} data-tip={t === 'simd' ? 'Open the SIMD page' : `Filter benchmarks to #${t}`}>#{t}</a>{/each}
			{#each facts as f (f.k)}<span class="fact"><span class="k">{f.k}</span><span class="mono">{f.v}</span></span>{/each}
			<span class="fact" class:bad={failures.length > 0}>
				<span class="k">Correct</span><span class="mono">{passing}/{vis.length}</span>
			</span>
		</div>
	{/if}
	<RunLocally workloads={[b.id]} engines={vis.map((c) => ({ engine: viewData.configurations[c.id] || c.rt, version: viewData.hosts[ui.machine].configurations[c.id]?.version, source: viewData.hosts[ui.machine].configurations[c.id]?.source }))} artifact={b.artifactSha256 || undefined} />
</header>

{#if !found}
	<div class="placeholder" aria-busy={!apiView.ready}>
		{#if apiView.ready}
			<p class="fg3">This workload isn’t in the current dataset. <a class="link-quiet" href={siteHref('/benchmarks')}>Browse all workloads</a>.</p>
		{:else}
			<span class="skel" style:width="60%"></span>
			<span class="skel" style:width="40%"></span>
		{/if}
	</div>
{:else}
	<section class="summary" aria-label="Leaders">
		{#each METRICS.slice(0, 4).concat(METRICS.slice(4)) as { m, label } (m)}
			{@const span = range[m]}
			<button class="lead" class:on={focus === m} aria-pressed={focus === m} onclick={() => (focus = m)} use:lazyTipCard={() => ({ kicker: label, points: [NOTE[m]], action: 'rank every runtime below' })}>
				<span class="lk">{label}</span>
				{#if span}
					<span class="lv mono">{fmt(m, span.best.v)}</span>
					<span class="lw"><RtLabel c={span.best.c} /></span>
					<span class="ls mono" data-tip={span.n > 1 ? `Slowest of ${span.n} runtimes is ${fx(span.worst.v / span.best.v)} the best` : undefined}>{span.n > 1 ? `${fx(span.worst.v / span.best.v)} spread` : 'only runtime'}</span>
				{:else}
					<span class="lv fg3">—</span>
					<span class="ls">not measured</span>
				{/if}
			</button>
		{/each}
	</section>

	{#if failures.length}
		<div class="fails" role="note">
			<span class="k">Not correct</span>
			{#each failures as x (x.c.id)}
				<button class="fail" onclick={() => open(x.c.id, 'steady')} style:color={ST[x.r.steady.st][2]}><RtLabel c={x.c} /> <span>{statusText(x.r.steady)}</span></button>
			{/each}
		</div>
	{/if}

	<section class="block" aria-labelledby="rank-title">
		<div class="block-head">
			<h2 id="rank-title">{LABEL[focus].label}</h2>
			<div class="seg-wrap">
				<Seg options={METRICS.map(({ m, short }) => [m, short] as [M, string])} value={focus} onselect={(v) => (focus = v)} label="Measurement" />
			</div>
		</div>
		<p class="note">{NOTE[focus]} Lower is better{ranked.log ? '; bars use a log scale' : ''}.</p>
		<ol class="rank">
			{#each ranked.rows as x (x.c.id)}
				<li>
					<button class="rrow" onclick={() => open(x.c.id, focus)} use:lazyTipCard={() => ({ kicker: LABEL[focus].label, title: workloadName(b.id), who: tipWho(x.c), value: x.v == null ? statusText(x.r[focus]) : fmt(focus, x.v), sub: x.v != null && range[focus] && x.rank > 1 ? `${fx(x.v / range[focus]!.best.v)} the best` : x.rank === 1 ? 'fastest' : '', action: 'distribution & run record' })}>
						<span class="rk mono">{x.rank || ''}</span>
						<span class="rn"><RtLabel c={x.c} /></span>
						<span class="rt">
							{#if x.v != null}<span class="rb" style:width="{x.w}%" style:background={x.c.col} class:hollow={x.c.hollow}></span>{:else}<span class="st" style:color={ST[x.r[focus].st][2]}>{statusText(x.r[focus])}</span>{/if}
						</span>
						<span class="rv mono">{x.v != null ? fmt(focus, x.v) : ''}</span>
						<span class="rx mono">{x.v != null && x.rank > 1 && range[focus] ? fx(x.v / range[focus]!.best.v) : ''}</span>
					</button>
				</li>
			{/each}
		</ol>
	</section>

	<section class="block" aria-labelledby="all-title">
		<div class="block-head"><h2 id="all-title">All results</h2><span class="note">Best per column highlighted · select a value for its distribution</span></div>
		<div class="tbl-wrap ox">
			<table class="t results">
				<thead>
					<tr>
						<th aria-sort={sort.m === 'name' ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => sortBy('name')}>Runtime{sort.m === 'name' ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button></th>
						{#each METRICS as { m, short } (m)}
							<th class="r" aria-sort={sort.m === m ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}><button class="sort" onclick={() => sortBy(m)}>{short}{sort.m === m ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button></th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each sorted as x (x.c.id)}
						<tr>
							<td class="nowrap"><RtLabel c={x.c} /></td>
							{#each METRICS as { m } (m)}
								{@const r = x.r[m]}
								{@const best = range[m] && r.st === 'ok' && r.v === range[m]!.best.v && range[m]!.n > 1}
								<td class="r mono" class:best>
									{#if r.st === 'ok'}
										<button class="cell" onclick={() => open(x.c.id, m)}>{fmt(m, r.v)}</button>
										{#if m === 'code'}
											{@const link = inspectLink(x.c.id)}
											{#if link.artifact}<button class="mini-link" onclick={() => (inspected = link.artifact!)} data-tip="Inspect code record">⌕</button>{/if}
											{#if link.image}<a class="mini-link" href={link.image} target="_blank" rel="noreferrer" data-tip="Inspect native image">↗</a>{/if}
										{/if}
									{:else}
										<span style:color={ST[r.st][2]} data-tip={ST[r.st][1]}>{ST[r.st][0]}</span>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if inspected}<ArtifactInspection artifact={inspected} />{/if}
	</section>

	<section class="block" aria-labelledby="hist-title" use:onScreen>
		<div class="block-head">
			<h2 id="hist-title">Over time</h2>
			<span class="note">{#if SNAPS.length}Steady execution · {SNAPS.length} points · drag a sparkline to compare a range{#if !full} · <button class="link-quiet" onclick={() => { ui.histFrom = 0; ui.histTo = SNAPS.length - 1; }}>reset range</button>{/if}{:else}Steady execution across past releases and source snapshots{/if}</span>
		</div>
		{#if !SNAPS.length}
			<div class="hist-empty fg3">{apiHistory.error ? 'History is unavailable right now.' : apiHistory.loading || !historyShown ? 'Loading history…' : 'No recorded history for this workload yet.'}</div>
		{:else}
		<div class="tbl-wrap ox">
			<table class="t hist">
				<thead>
					<tr><th>Runtime</th><th>Trend</th><th class="r">{full ? 'Now' : `At ${SNAPS[ui.histTo]?.date.slice(5) || '—'}`}</th><th class="r">{full ? 'Δ first → last' : `Δ ${SNAPS[ui.histFrom]?.date.slice(5) || '—'} → ${SNAPS[ui.histTo]?.date.slice(5) || '—'}`}</th></tr>
				</thead>
				<tbody>
					{#each spark as h (h.c.id)}
						<tr>
							<td class="nowrap"><RtLabel c={h.c} /></td>
							<td class="sp">
								{#if h.segments.length}
									<svg viewBox="0 0 160 24" preserveAspectRatio="none" class="mini" role="presentation" class:dragging={histRange.dragging} onpointerdown={histRange.down} onpointermove={histRange.move} onpointerup={histRange.up} onpointercancel={histRange.cancel}>
										{#if !full}<rect class="sel-range" x={SX(ui.histFrom).toFixed(1)} y="0" width={(SX(ui.histTo) - SX(ui.histFrom)).toFixed(1)} height="24" />{/if}
										{#if histRange.band}<rect class="drag-band" x={SX(histRange.band[0]).toFixed(1)} y="0" width={Math.max(0.5, SX(histRange.band[1]) - SX(histRange.band[0])).toFixed(1)} height="24" />{/if}
										{#if histRange.anchor != null && !histRange.dragging}<line class="anchor" x1={SX(histRange.anchor).toFixed(1)} x2={SX(histRange.anchor).toFixed(1)} y1="0" y2="24" />{/if}
										{#each h.segments as points}<polyline {points} style:stroke={h.c.col} style:stroke-dasharray={h.c.hollow ? '4 3' : 'none'} class="ln" />{/each}
									</svg>
								{:else}<span class="fg3 small">not collected</span>{/if}
							</td>
							<td class="mono r">{h.now}</td>
							<td class="mono r" style:color={h.dColor}>{h.delta}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{/if}
	</section>

	<details class="block details">
		<summary><h2>Workload & run details</h2></summary>
		<dl>
			{#each details as d (d.k)}<div><dt>{d.k}</dt><dd class="mono">{d.v}</dd></div>{/each}
		</dl>
		{#each collectionBundles as bundle (bundle.url)}
			<p class="note"><a href={siteHref(bundle.url)}>Collection bundle {bundle.id} ({bundle.machine}) ↗</a> · exact adapters and run metadata</p>
		{/each}
	</details>
{/if}

<StatusLegend />

<style>
	.head {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.crumbs {
		display: flex;
		gap: 6px;
		align-items: baseline;
		font-size: 12px;
		color: var(--fg3);
	}
	.crumbs a {
		color: var(--fg2);
		text-decoration: none;
	}
	.crumbs a:hover {
		color: var(--fg);
	}
	.pos {
		margin-left: auto;
		font-size: 11px;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 12px;
		justify-content: space-between;
	}
	h1 {
		font-size: clamp(22px, 3vw, 30px);
		font-weight: 500;
		letter-spacing: -0.01em;
		word-break: break-word;
		margin: 0;
	}
	.step {
		display: flex;
		gap: 6px;
		flex: none;
	}
	.nav-btn {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: 1px solid var(--line2);
		color: var(--fg2);
		text-decoration: none;
	}
	.nav-btn:hover {
		color: var(--fg);
		border-color: var(--fg3);
	}
	.purpose {
		margin: 0;
		color: var(--fg2);
		font-size: 14px;
		max-width: 70ch;
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.tag,
	.fact {
		display: inline-flex;
		gap: 6px;
		align-items: baseline;
		border: 1px solid var(--line2);
		padding: 2px 8px;
		font-size: 12px;
		color: var(--fg2);
		text-decoration: none;
		max-width: 100%;
		min-width: 0;
	}
	.fact .mono {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fact.bad {
		border-color: color-mix(in srgb, var(--bad) 50%, var(--line2));
	}
	.k {
		color: var(--fg3);
		font-size: 11px;
	}
	.placeholder {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	/* Leaders */
	.summary {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 1px;
		background: var(--line);
		border: 1px solid var(--line);
	}
	.lead {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		padding: 12px 14px;
		background: var(--bg2);
		text-align: left;
		min-width: 0;
		position: relative;
	}
	.lead:hover {
		background: var(--bg3);
	}
	.lead.on {
		box-shadow: inset 0 2px 0 var(--fg);
	}
	.lk {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg3);
	}
	.lv {
		font-size: 22px;
		line-height: 1.1;
	}
	.lw {
		font-size: 12px;
		max-width: 100%;
		overflow: hidden;
		display: flex;
	}
	.ls {
		font-size: 11px;
		color: var(--fg3);
	}
	.fails {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 12px;
		align-items: center;
		font-size: 12px;
	}
	.fail {
		display: inline-flex;
		gap: 6px;
		align-items: center;
	}

	/* Sections */
	.block {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.block-head {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		font-size: 16px;
		font-weight: 600;
		margin: 0;
	}
	.seg-wrap {
		max-width: 100%;
		overflow-x: auto;
	}

	/* Ranked chart */
	.rank {
		list-style: none;
		margin: 0;
		padding: 6px 0;
		border: 1px solid var(--line);
		background: var(--bg2);
	}
	.rrow {
		display: grid;
		grid-template-columns: 28px minmax(140px, 220px) 1fr 76px 56px;
		gap: 10px;
		align-items: center;
		width: 100%;
		padding: 4px 14px;
		font-size: 12px;
		text-align: left;
	}
	.rrow:hover {
		background: var(--bg3);
	}
	.rk {
		color: var(--fg3);
		text-align: right;
	}
	.rn {
		overflow: hidden;
		display: flex;
		min-width: 0;
	}
	.rt {
		height: 10px;
		display: flex;
		align-items: center;
	}
	.rb {
		display: block;
		height: 8px;
		opacity: 0.9;
	}
	.rb.hollow {
		opacity: 0.45;
	}
	.st {
		font-size: 11px;
	}
	.rv {
		text-align: right;
	}
	.rx {
		text-align: right;
		color: var(--fg3);
		font-size: 11px;
	}

	/* Results table */
	.results {
		min-width: 720px;
	}
	.sort {
		font: inherit;
		color: inherit;
		white-space: nowrap;
	}
	.cell {
		font: inherit;
		color: inherit;
	}
	.cell:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	td.best {
		background: color-mix(in srgb, var(--good) 14%, transparent);
		color: var(--fg);
	}
	.mini-link {
		margin-left: 4px;
		color: var(--fg3);
		text-decoration: none;
		font-size: 11px;
	}
	.mini-link:hover {
		color: var(--fg);
	}

	/* History */
	.hist {
		min-width: 560px;
	}
	.hist-empty {
		border: 1px solid var(--line);
		background: var(--bg2);
		padding: 28px 14px;
		text-align: center;
		font-size: 12px;
	}
	.sp {
		padding: 3px 12px;
		user-select: none;
		-webkit-user-select: none;
		width: 50%;
	}
	.mini {
		display: block;
		width: 100%;
		min-width: 200px;
		height: 28px;
		cursor: crosshair;
		touch-action: pan-y;
	}
	.mini.dragging {
		cursor: ew-resize;
	}
	.ln {
		fill: none;
		stroke-width: 1.5;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}
	.sel-range {
		fill: var(--bg3);
	}
	.drag-band {
		fill: color-mix(in srgb, var(--fg) 10%, transparent);
		stroke: var(--fg3);
		stroke-dasharray: 3 3;
		vector-effect: non-scaling-stroke;
	}
	.anchor {
		stroke: var(--fg);
		stroke-dasharray: 3 3;
		vector-effect: non-scaling-stroke;
	}

	/* Details */
	.details summary {
		cursor: pointer;
		list-style: none;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.details summary::before {
		content: '▸';
		color: var(--fg3);
		transition: transform 0.15s;
	}
	.details[open] summary::before {
		transform: rotate(90deg);
	}
	dl {
		margin: 0;
		border: 1px solid var(--line);
		background: var(--bg2);
		padding: 4px 14px;
	}
	dl > div {
		display: grid;
		grid-template-columns: 170px 1fr;
		gap: 12px;
		padding: 6px 0;
		border-bottom: 1px solid var(--line);
		font-size: 12px;
	}
	dl > div:last-child {
		border-bottom: none;
	}
	dt {
		color: var(--fg3);
	}
	dd {
		margin: 0;
		word-break: break-word;
		white-space: pre-line;
	}

	@media (max-width: 1100px) {
		.summary {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (max-width: 720px) {
		.summary {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.lead {
			padding: 10px 12px;
		}
		.lv {
			font-size: 18px;
		}
		.rrow {
			grid-template-columns: 20px minmax(0, 1.1fr) minmax(0, 1fr) 62px;
			gap: 8px;
			padding: 5px 10px;
		}
		.rx {
			display: none;
		}
		/* The summary cards above select the measurement on phones. */
		.seg-wrap {
			display: none;
		}
		dl > div {
			grid-template-columns: 1fr;
			gap: 2px;
		}
	}
</style>
