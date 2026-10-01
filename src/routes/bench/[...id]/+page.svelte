<script lang="ts">
	import { siteHref } from '$lib/links';
	import RtLabel from '$lib/components/RtLabel.svelte';
	import Seg from '$lib/components/Seg.svelte';
	import { CB, CFG, MACH } from '$lib/data/runtimes';
	import { CODE, MEMPH, MET, PHASE_NOTE, PH_NAMES, SNAPS } from '$lib/data/snapshot';
	import { ST } from '$lib/data/status';
	import type { CfgId, MetricKey } from '$lib/data/types';
	import { H, fmtU, hex, n0, pc, pct } from '$lib/format';
	import { benchVal, isVisible, otSeries } from '$lib/model';
	import { ui } from '$lib/state.svelte';
import { historySegments } from '$lib/history-values';

	let { data } = $props();
	const b = $derived(data.bench);
	const sC = $derived(b.kb / 1240);
	const sS = $derived((b.ms ?? 0) / 412);
	const vis = $derived(CFG.filter((c) => isVisible(ui.scope, c)));
	const okC = $derived(vis.filter((c) => benchVal(ui.scope, b, c.id, 'steady').st === 'ok'));

	// ── Latency ────────────────────────────────────────────────────────────
	const PHASE_TIP: Partial<Record<MetricKey, Partial<Record<CfgId, string>>>> = {
		compile: { E: 'translation only', G: 'translation only', F: 'baseline tier only (lazy)', C: 'full AOT' },
		first: { F: 'incl. lazy compile of called funcs', B: 'incl. stub generation' },
		steady: { F: 'opt tier-up observed at iter 4–9', E: 'no JIT' }
	};
	const phases = $derived(
		(['compile', 'inst', 'first', 'steady'] as MetricKey[]).map((m) => {
			const vals = vis.map((c) => ({ c, r: benchVal(ui.scope, b, c.id, m) }));
			const max = Math.max(...vals.map((x) => (x.r.st === 'ok' ? x.r.v : 0)), 1e-9);
			return {
				m,
				title: MET[m].l,
				def: PHASE_NOTE[m],
				bars: vals.map(({ c, r }) =>
					r.st === 'ok'
						? { c, ok: true, w: Math.max(0.6, (r.v / max) * 100).toFixed(1) + '%', text: fmtU(r.v, 'ms'), note: PHASE_TIP[m]?.[c.id] ?? '', stColor: '' }
						: { c, ok: false, w: '0%', text: ST[r.st][0] + ' ' + ST[r.st][1], note: '', stColor: ST[r.st][2] }
				)
			};
		})
	);

	// ── Memory timeline ────────────────────────────────────────────────────
	const W = 820;
	const HC = 250;
	const pl = 50;
	const pr = 14;
	const pt = 26;
	const pb = 28;
	const FR = [0, 0.05, 0.25, 0.33, 0.47, 0.92, 1];
	const sel = $derived(ui.memSel.filter((id) => okC.some((c) => c.id === id)));
	const ph = (id: CfgId) => {
		const { d, m } = MEMPH[id];
		const dd = [d[0], d[1] * sC, d[2], d[3] * sS, d[4] * sS, d[5]];
		const bnd = [0];
		dd.forEach((x) => bnd.push(bnd[bnd.length - 1] + x));
		return { dd, bnd, m };
	};
	const tf = (v: number) => (ui.memMetric === 'pss' ? Math.max(0.5, v * 0.9 - 1.2) : v);
	const pts = (id: CfgId): [number, number][] => {
		const { dd, bnd, m } = ph(id);
		if (ui.memMetric === 'linear')
			return [
				[0, 0],
				[bnd[2], 0],
				[bnd[3], 16],
				[bnd[4], 40],
				[bnd[4] + dd[4] * 0.3, 64],
				[bnd[5], 64],
				[bnd[5] + dd[5] * 0.5, 0],
				[bnd[6], 0]
			];
		const P: [number, number][] = [
			[0, m[0]],
			[bnd[1], m[0] + 0.4],
			[bnd[1] + dd[1] * 0.7, m[1]],
			[bnd[2], m[2]],
			[bnd[3], m[3]],
			[bnd[3] + dd[3] * 0.5, m[4] + 2],
			[bnd[4], m[4]]
		];
		for (let k = 1; k <= 20; k++) {
			const t = bnd[4] + (dd[4] * k) / 20;
			let v = id === 'F' ? (k < 8 ? m[4] + (m[5] - 28 - m[4]) * Math.min(1, k / 5) : m[5]) : m[4] + (m[5] - m[4]) * Math.min(1, k / 6);
			if (k === 20) v = m[6];
			P.push([t, v + (k < 20 ? (H(id + k) - 0.5) * 1.6 : 0)]);
		}
		P.push([bnd[5] + dd[5] * 0.3, m[6] * 0.6], [bnd[6], m[7]]);
		return P.map(([t, v]) => [t, tf(v)]);
	};

	const mem = $derived.by(() => {
		const Tmax = Math.max(...sel.map((id) => ph(id).bnd[6]), 1);
		const xf = (id: CfgId, t: number) => {
			if (!ui.memAligned) return t / Tmax;
			const { dd, bnd } = ph(id);
			let k = 0;
			while (k < 5 && t > bnd[k + 1]) k++;
			return FR[k] + (dd[k] ? (t - bnd[k]) / dd[k] : 0) * (FR[k + 1] - FR[k]);
		};
		const px = (f: number) => pl + f * (W - pl - pr);
		const all = sel.map((id) => ({ id, P: pts(id) }));
		const ymax = Math.max(...all.flatMap((x) => x.P.map((p) => p[1])), 10) * 1.12;
		const py = (v: number) => pt + (1 - v / ymax) * (HC - pt - pb);
		const stp = [10, 20, 25, 50, 100, 200].find((x) => ymax / x <= 5) || 200;
		const yTicks = [];
		for (let v = 0; v <= ymax; v += stp) yTicks.push({ y: py(v).toFixed(1), t: pc(py(v), HC), label: v + ' MB' });
		const series = all.map(({ id, P }) => {
			const c = CB[id];
			const pk = P.reduce((a, p) => (p[1] > a[1] ? p : a), P[0]);
			return {
				c,
				points: P.map(([t, v]) => px(xf(id, t)).toFixed(1) + ',' + py(v).toFixed(1)).join(' '),
				pkX: px(xf(id, pk[0])).toFixed(1),
				pkY: py(pk[1]).toFixed(1),
				pkL: `peak* ${pk[1].toFixed(0)} MB`,
				pkLl: pc(px(xf(id, pk[0])), W),
				pkLt: pc(py(pk[1]) - 18, HC),
				ticks: ph(id)
					.bnd.slice(1, 6)
					.map((t) => px(xf(id, t)).toFixed(1))
			};
		});
		const prim = sel[0];
		const bands = prim
			? PH_NAMES.map((name, k) => {
					const { bnd } = ph(prim);
					const x0 = px(xf(prim, bnd[k]));
					const x1 = px(xf(prim, bnd[k + 1]));
					return { x: x0.toFixed(1), w: Math.max(0, x1 - x0).toFixed(1), fill: k % 2 ? 'var(--bg3)' : 'transparent', label: x1 - x0 > 46 ? name : '', ll: pc(x0 + 4, W) };
				})
			: [];
		const xTicks = ui.memAligned
			? []
			: [0, 0.25, 0.5, 0.75, 1].map((f) => ({
					l: pc(px(f), W),
					tf: f === 1 ? 'translateX(-100%)' : f === 0 ? 'none' : 'translateX(-50%)',
					label: fmtU(Tmax * f, 'ms')
				}));
		const rowsSrc = (id: CfgId): [number | null, number][] => {
			const m = MEMPH[id].m;
			if (ui.memMetric === 'linear')
				return [
					[0, 0],
					[0, 0],
					[16, 16],
					[40, 40],
					[64, 64],
					[64, 0],
					[null, 0]
				];
			return (
				[
					[m[0] + 0.4, m[0] + 0.4],
					[m[1], m[2]],
					[m[3] + 1, m[3]],
					[m[4] + 2, m[4]],
					[m[5], m[6]],
					[m[6], m[7]],
					[null, m[7]]
				] as [number | null, number][]
			).map(([a, e]) => [a == null ? null : tf(a), tf(e)]);
		};
		const table = [...PH_NAMES, 'retained @ +1 s'].map((name, k) => ({
			name,
			cells: sel.map((id) => {
				const [pk, e] = rowsSrc(id)[k];
				return pk == null ? `— / ${e.toFixed(1)}` : `${pk.toFixed(1)} / ${e.toFixed(1)}`;
			})
		}));
		return { yTicks, series, bands, xTicks, table };
	});
	const toggleMem = (id: CfgId) => {
		const on = sel.includes(id);
		ui.memSel = on ? ui.memSel.filter((x) => x !== id) : [...ui.memSel.filter((x) => okC.some((o) => o.id === x)), id].slice(-3);
	};
	const memLabel = $derived(
		{ rss: 'Process RSS (VmRSS)', pss: 'Proportional set size (PSS)', linear: 'Guest linear memory size (memory.size × 64 KiB)' }[ui.memMetric]
	);

	// ── Code ───────────────────────────────────────────────────────────────
	const codeRows = $derived(
		vis.map((c) => {
			const k = CODE[c.id];
			if (!k) return { c, cells: ['n/a — interpreter', '', '', '', '', '', ''] };
			const f = (v: number | string | null | undefined) => (v == null ? 'not measured' : fmtU((v as number) * sC, 'KB'));
			const tot = k[2] == null ? null : (k[0] as number) + (k[1] as number) + (k[2] as number);
			return { c, cells: [f(k[0]), f(k[1]), f(k[2]), tot == null ? 'partial' : f(tot), k[5] ? f(k[5]) : f(tot), String(k[3]), String(k[4])] };
		})
	);

	// ── History ────────────────────────────────────────────────────────────
	const spark = $derived(
		vis.map((c) => {
			const vals = otSeries(ui.scope, c.id, 'exec', b.id);
			if (!vals) return { c, segments: [], now: 'not collected', delta: '', dColor: 'var(--fg3)' };
			const lo = Math.min(...vals.filter(Number.isFinite));
			const hi = Math.max(...vals.filter(Number.isFinite));
			const X = (i: number) => 2 + i * (156 / (SNAPS.length-1));
			const Y = (v: number) => 21 - ((v - lo) / (hi - lo || 1)) * 18;
			const d = vals[SNAPS.length-1] / vals[0] - 1;
			return {
				c,
				segments: historySegments(vals,X,Y),
				now: Number.isFinite(vals[SNAPS.length-1])?fmtU(vals[SNAPS.length-1], 'ms'):'not measured',
				delta: Number.isFinite(d)?pct(d):'not measured',
				dColor: Math.abs(d) < 0.02 ? 'var(--fg3)' : d < 0 ? 'var(--good)' : 'var(--bad)'
			};
		})
	);

	const feat = $derived(
		b.tags.includes('simd')
			? 'simd128 · bulk-memory'
			: b.tags.includes('gc')
				? 'gc · reference-types · tail-call'
				: b.tags.includes('threads')
					? 'threads · shared memory'
					: b.tags.includes('exceptions')
						? 'exceptions (exnref)'
						: 'bulk-memory · mutable-globals · sign-ext'
	);
	const meta = $derived([
		{ k: 'Purpose', v: b.purpose || 'Kernel from the ' + b.group.toLowerCase() + ' corpus' },
		{ k: 'Input', v: b.input || 'fixed seed 42' },
		{ k: 'Wasm artifact', v: `${n0(b.kb)} KB · sha256 ${hex(b.id)}…` },
		{ k: 'Required features', v: feat },
		{ k: 'Imports', v: 'wasi_snapshot_preview1: fd_write, clock_time_get, random_get' },
		{ k: 'Source / toolchain', v: b.src || 'C · wasi-sdk 24 (clang 19.1.5) -O2' },
		{ k: 'Coverage', v: `${okC.length} / 7 configurations correct` }
	]);
	const record = $derived([
		{ k: 'Timing run', v: 'r-' + hex(b.id) + ' · clean, no instrumentation' },
		{ k: 'Memory run', v: 'm-' + hex(b.id + 'm') + ' · instrumented, linked to timing run' },
		{ k: 'Machine', v: MACH[ui.machine].l },
		{ k: 'OS', v: MACH[ui.machine].os },
		{ k: 'Harness', v: 'v3.2.0 (commit 8c41e0a)' },
		{ k: 'Cache / warmup', v: 'cold · 5 warmup iterations discarded' },
		{ k: 'Samples', v: '10 independent processes × 30 iterations' },
		{ k: 'Correctness', v: 'stdout sha256 compared to reference per process' },
		{ k: 'Raw results', v: 'results/snap-2026-09-28.1/' + b.id + '.jsonl' },
		{ k: 'Provenance', v: 'project-maintained · not independently reproduced' }
	]);
	const tagHref = (t: string) => (t === 'simd' ? '/simd' : '/benchmarks?tag=' + encodeURIComponent(t) + '#workloads');
</script>

<svelte:head>
	<title>{b.id} · wasm.fyi</title>
	<meta name="description" content={b.purpose || `${b.id} — ${b.group} workload on wasm.fyi`} />
</svelte:head>

<div class="stack6">
	<div class="crumbs s12 fg3"><a class="link-quiet" href={siteHref(`/benchmarks`)}>Benchmarks</a> / {b.group}</div>
	<div class="title-line">
		<h1 class="mono">{b.id}</h1>
		{#each b.tags as t (t)}
			<a class="tag" href={siteHref(tagHref(t))} data-tip={t === 'simd' ? 'Open the SIMD page' : `Filter benchmarks to #${t}`}>#{t}</a>
		{/each}
	</div>
</div>
<div class="tiles meta">
	{#each meta as m (m.k)}
		<div class="mcell"><div class="small fg3">{m.k}</div><div class="mono s12 brk">{m.v}</div></div>
	{/each}
</div>
<Seg
	options={[
		['latency', 'Latency'],
		['memory', 'Memory'],
		['code', 'Code'],
		['history', 'History'],
		['run', 'Run details']
	]}
	value={ui.bdTab}
	onselect={(v) => (ui.bdTab = v as typeof ui.bdTab)}
	size="lg"
	label="Section"
/>

{#if ui.bdTab === 'latency'}
	<div class="cards">
		{#each phases as p (p.m)}
			<div class="card g8">
				<div class="card-title">{p.title}</div>
				<div class="note">{p.def}</div>
				{#each p.bars as x (x.c.id)}
					<div class="lat-row">
						<span class="lab"><RtLabel c={x.c} /></span>
						<span class="mid">
							{#if x.ok}<span class="bar" style:width={x.w} style:background={x.c.col}></span>{:else}<span class="small" style:color={x.stColor}>{x.text}</span>{/if}
							<span class="micro fg3">{x.note}</span>
						</span>
						{#if x.ok}<span class="mono r">{x.text}</span>{/if}
					</div>
				{/each}
			</div>
		{/each}
	</div>
{:else if ui.bdTab === 'memory'}
	<div class="row">
		<div class="chips">
			{#each okC as c (c.id)}
				{@const on = sel.includes(c.id)}
				<button class="chip" style:border-color={on ? c.col : 'var(--line2)'} style:opacity={on ? 1 : 0.6} aria-pressed={on} onclick={() => toggleMem(c.id)}>
					<RtLabel {c} />
				</button>
			{/each}
		</div>
		<Seg
			options={[
				['rss', 'RSS'],
				['pss', 'PSS'],
				['linear', 'Guest linear memory']
			]}
			value={ui.memMetric}
			onselect={(v) => (ui.memMetric = v as typeof ui.memMetric)}
		/>
		<Seg
			options={[
				[false, 'Real elapsed time'],
				[true, 'Phase-aligned (not to scale)']
			]}
			value={ui.memAligned}
			onselect={(v) => (ui.memAligned = v)}
		/>
	</div>
	<div class="panel mem">
		<div class="mem-head">
			<span class="w6">{memLabel} — lifecycle timeline</span>
			<span class="note">up to 3 overlays · phase bands from first selected · ticks mark each series' phase boundaries</span>
		</div>
		{#if ui.memAligned}<div class="small warn">Phase-aligned view: each phase is stretched to a fixed width. Horizontal distance is not time.</div>{/if}
		{#if !sel.length}
			<div class="empty fg3">Select a configuration to plot. Configurations without a correct run of this workload are not offered.</div>
		{:else}
			<div class="chart">
				<svg viewBox="0 0 {W} {HC}">
					{#each mem.bands as bd (bd.x)}<rect x={bd.x} y="26" width={bd.w} height="196" style:fill={bd.fill} />{/each}
					{#each mem.yTicks as t (t.y)}<line x1="50" x2="806" y1={t.y} y2={t.y} style="stroke:var(--line)" />{/each}
					{#each mem.series as s (s.c.id)}
						<polyline points={s.points} style:stroke={s.c.col} style:stroke-dasharray={s.c.hollow ? '4 3' : 'none'} class="ln" />
						{#each s.ticks as x (x)}<line x1={x} x2={x} y1="222" y2="228" style:stroke={s.c.col} style="stroke-width:1.5" />{/each}
						<circle cx={s.pkX} cy={s.pkY} r="3" style:stroke={s.c.col} style="fill:var(--bg2);stroke-width:1.5" />
					{/each}
				</svg>
				{#each mem.bands as bd (bd.x)}<span class="axis-label band" style:left={bd.ll} style:top="3%">{bd.label}</span>{/each}
				{#each mem.yTicks as t (t.y)}<span class="axis-label" style:left="5.4%" style:top={t.t} style:transform="translate(-100%,-50%)">{t.label}</span>{/each}
				{#each mem.xTicks as t (t.l)}<span class="axis-label" style:left={t.l} style:top="93%" style:transform={t.tf}>{t.label}</span>{/each}
				{#each mem.series as s (s.c.id)}
					<span class="axis-label" style:left={s.pkLl} style:top={s.pkLt} style:transform="translateX(-50%)" style:color={s.c.col}>{s.pkL}</span>
				{/each}
			</div>
		{/if}
		<div class="note">* Sampled peak: maximum of 1 ms samples; true peak may be higher. Lifetime high-water mark (VmHWM) is reported once, in Run details — not repeated per phase.</div>
	</div>
	{#if sel.length}
		<div class="tbl-wrap">
			<table class="t" style:min-width="520px">
				<thead>
					<tr>
						<th>Phase · MB (peak* / end)</th>
						{#each sel as id (id)}<th class="r"><RtLabel c={CB[id]} /></th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each mem.table as r (r.name)}
						<tr>
							<td class="fg2">{r.name}</td>
							{#each r.cells as text, k (k)}
								<td class="mono r" data-tip={`${r.name} — ${CB[sel[k]].rt} ${CB[sel[k]].be}\n${text}\n* sampled peak (1 ms interval)`}>{text}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	<div class="note">RSS via smaps_rollup every 1 ms, single process, from an instrumented run linked to the timing run.</div>
{:else if ui.bdTab === 'code'}
	<div class="lede">
		Module-level generated code at end of run. Overview score uses “Active total” (function code + stubs + metadata). Static size is not a speed or
		quality score.
	</div>
	<div class="tbl-wrap">
		<table class="t" style:min-width="900px">
			<thead>
				<tr>
					<th>Configuration</th>
					<th class="r">Function code</th>
					<th class="r">Stubs &amp; trampolines</th>
					<th class="r">Metadata &amp; pools</th>
					<th class="r">Active total</th>
					<th class="r">Cumulative emitted</th>
					<th>Compiled functions</th>
					<th>Tier</th>
				</tr>
			</thead>
			<tbody>
				{#each codeRows as r (r.c.id)}
					<tr>
						<td class="nowrap"><RtLabel c={r.c} /></td>
						{#each r.cells as c, i (i)}<td class="mono fg2" class:r={i < 5}>{c}</td>{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<div class="note">Function-level side-by-side explorer (WAT ↔ native, normalized addresses) ships with the code-explorer release.</div>
{:else if ui.bdTab === 'history'}
	<div class="tbl-wrap">
		<table class="t" style:min-width="600px">
			<thead>
				<tr><th>Configuration</th><th>Steady exec · {SNAPS.length} retrospective points</th><th class="r">Now</th><th class="r">Δ first → last point</th></tr>
			</thead>
			<tbody>
				{#each spark as h (h.c.id)}
					<tr>
						<td class="nowrap"><RtLabel c={h.c} /></td>
						<td class="sp">
							{#if h.segments.length}
								<svg viewBox="0 0 160 24" class="mini">{#each h.segments as points}<polyline {points} style:stroke={h.c.col} style:stroke-dasharray={h.c.hollow ? '4 3' : 'none'} class="ln" />{/each}</svg>
							{/if}
						</td>
						<td class="mono r">{h.now}</td>
						<td class="mono r" style:color={h.dColor}>{h.delta}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<div class="panel run">
		{#each record as k (k.k)}
			<div class="rec"><span class="fg3">{k.k}</span><span class="mono brk">{k.v}</span></div>
		{/each}
		<pre class="mono">wbench run --snapshot snap-2026-09-28.1 --workload "{b.id}" --all-configs --phases all --memory-run</pre>
	</div>
{/if}

<style>
	.stack6 {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.s12 {
		font-size: 12px;
	}
	.w6 {
		font-weight: 600;
	}
	.title-line {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 12px;
		align-items: baseline;
	}
	h1 {
		font-size: 18px;
		font-weight: 500;
		word-break: break-word;
	}
	.tag {
		border: 1px solid var(--line2);
		padding: 0 6px;
		font-size: 11px;
		color: var(--fg2);
		text-decoration: none;
	}
	.meta {
		grid-template-columns: repeat(auto-fit, minmax(min(250px, 100%), 1fr));
	}
	.mcell {
		padding: 7px 12px;
	}
	.brk {
		word-break: break-word;
	}
	.g8 {
		gap: 8px;
	}
	.lat-row {
		display: grid;
		grid-template-columns: 130px 1fr 78px;
		gap: 8px;
		align-items: center;
		font-size: 12px;
	}
	.lab {
		overflow: hidden;
		display: flex;
	}
	.mid {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.bar {
		display: block;
		height: 8px;
		opacity: 0.85;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip {
		border: 1px solid;
		padding: 2px 8px;
		font-size: 12px;
	}
	.mem {
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.mem-head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 6px;
	}
	.warn {
		color: var(--st-warn);
	}
	.empty {
		padding: 40px;
		text-align: center;
	}
	.chart {
		position: relative;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
	.ln {
		fill: none;
		stroke-width: 1.6;
		stroke-linejoin: round;
	}
	.band {
		font-family: var(--sans);
	}
	.sp {
		padding: 3px 12px;
	}
	.mini {
		width: 160px;
		height: 24px;
	}
	.mini .ln {
		stroke-width: 1.5;
	}
	.run {
		padding: 10px 14px;
		display: flex;
		flex-direction: column;
	}
	.rec {
		display: grid;
		grid-template-columns: 160px 1fr;
		gap: 10px;
		font-size: 12px;
		border-bottom: 1px solid var(--line);
		padding: 4px 0;
	}
	pre {
		margin: 10px 0 0;
		background: var(--bg3);
		padding: 10px;
		font-size: 11px;
		white-space: pre-wrap;
	}
</style>
