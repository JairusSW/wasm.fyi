<script lang="ts">
	import { base } from '$app/paths';
	import { siteHref } from '$lib/links';
	import RtLabel from '$lib/components/RtLabel.svelte';
	import Seg from '$lib/components/Seg.svelte';
	import { CB, CFG, MACH } from '$lib/data/runtimes';
	import { MET, PHASE_NOTE, PH_NAMES, SNAPS } from '$lib/data/snapshot';
	import { ST } from '$lib/data/status';
	import type { CfgId, MetricKey } from '$lib/data/types';
	import { fmtU, n0, pc, relative, workloadName } from '$lib/format';
	import { benchVal, isVisible, otSeries } from '$lib/model';
	import { ui } from '$lib/state.svelte';
import { viewCell, viewData } from '$lib/view-data';
import { historySegments } from '$lib/history-values';

	let { data } = $props();
	const b = $derived(data.bench);
	const vis = $derived(CFG.filter((c) => isVisible(ui.scope, c)));
	const okC = $derived(vis.filter((c) => benchVal(ui.scope, b, c.id, 'steady').st === 'ok'));

	// ── Latency ────────────────────────────────────────────────────────────
	const PHASE_TIP: Partial<Record<MetricKey, Partial<Record<CfgId, string>>>> = {};
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
  const sel=$derived(ui.memSel.filter(id=>vis.some(c=>c.id===id)));
  // Independent process high-water records do not supply an elapsed lifecycle
  // curve or phase endpoints. Preserve the plot's empty state instead of joining
  // unrelated process snapshots into a fabricated trace.
  const mem=$derived({yTicks:[] as {y:string;t:string;label:string}[],series:[] as {c:typeof CFG[number];points:string;pkX:string;pkY:string;pkL:string;pkLl:string;pkLt:string;ticks:string[]}[],bands:[] as {x:string;w:string;fill:string;label:string;ll:string}[],xTicks:[] as {l:string;tf:string;label:string}[],
    table:([['Compile process lifetime','rssCompile'],['Instantiate process lifetime','rssInst'],['First-call process lifetime','rssFirst'],['Steady process lifetime','rss']] as const).map(([name,metric])=>({name,cells:sel.map(id=>{
      if(ui.memMetric!=='rss')return 'not collected';
      const cell=viewCell(ui.machine,ui.snap,b.id,id,metric);
      return cell.st==='ok' && cell.v!=null?fmtU(cell.v,'MiB'):'not measured';
    })}))});
	const toggleMem = (id: CfgId) => {
		const on = sel.includes(id);
		ui.memSel = on ? ui.memSel.filter((x) => x !== id) : [...ui.memSel.filter((x) => okC.some((o) => o.id === x)), id].slice(-3);
	};
	const memLabel = $derived(
		{ rss: 'Process RSS (VmRSS)', pss: 'Proportional set size (PSS)', linear: 'Guest linear memory size (memory.size × 64 KiB)' }[ui.memMetric]
	);

	// ── Code ───────────────────────────────────────────────────────────────
  const codeRows=$derived(vis.map(c=>{
    const cell=viewCell(ui.machine,ui.snap,b.id,c.id,'code');
    const report=viewData.reports[cell.report];
    const native=report?.codeRecords.find(record=>record.runtime===viewData.configurations[c.id]&&record.workload===b.id&&record.status==='available'&&record.inspectable);
    const inspect=report?.codeSource?.id&&native
      ? `${base}/wasmbench/code-inspection/${encodeURIComponent(report.codeSource.id)}/view.html?trial=${encodeURIComponent(native.trial)}`
      : null;
    const image=cell.st==='ok'&&cell.v!=null?fmtU(cell.v,'KiB'):cell.st==='na'?'n/a':cell.st==='unsupported'?'unsupported':cell.st==='failed'?'failed':'not measured';
    return {c,inspect,cells:['not collected','not collected','not collected',image,'not collected','not collected','not collected']};
  }));

	// ── History ────────────────────────────────────────────────────────────
	const spark = $derived(
		vis.map((c) => {
			const vals = otSeries(ui.scope, c.id, 'exec', b.id);
			if (!vals) return { c, segments: [], now: 'not collected', delta: '', dColor: 'var(--fg3)' };
			const lo = Math.min(...vals.filter(Number.isFinite));
			const hi = Math.max(...vals.filter(Number.isFinite));
			const X = (i: number) => 2 + i * (156 / Math.max(1,SNAPS.length-1));
			const Y = (v: number) => 21 - ((v - lo) / (hi - lo || 1)) * 18;
			const d = vals[SNAPS.length-1] / vals[0] - 1;
			return {
				c,
				segments: historySegments(vals,X,Y),
				now: Number.isFinite(vals[SNAPS.length-1])?fmtU(vals[SNAPS.length-1], 'ms'):'not measured',
				delta: Number.isFinite(d)?relative(1+d,ui.deltaFormat):'not measured',
				dColor: Math.abs(d) < 0.02 ? 'var(--fg3)' : d < 0 ? 'var(--good)' : 'var(--bad)'
			};
		})
	);

  const references=$derived([...new Set(vis.flatMap(c=>['compile','inst','first','steady','rss','code'].map(metric=>viewCell(ui.machine,ui.snap,b.id,c.id,metric).report)).filter(Boolean))].map(id=>({id,...viewData.reports[id]})));
  const meta=$derived([
    {k:'Purpose',v:b.purpose || b.group},{k:'Input',v:b.input || 'not recorded'},
    {k:'Wasm artifact',v:fmtU(b.kb,'KiB')+' · sha256 '+b.artifactSha256},
    {k:'Declared features',v:b.tags.join(' · ') || 'none recorded'},
    {k:'Imports',v:b.imports==null?'not collected':String(b.imports)+' declared imports · '+b.abi},
    {k:'Source / toolchain',v:b.src || 'not recorded'},
    {k:'Coverage',v:`${okC.length} / ${vis.length} selected configurations verified for steady execution`}
  ]);
  const record=$derived([
    {k:'Reports',v:references.map(r=>r.runId+' · '+r.created).join(' · ') || 'not collected'},
    {k:'Memory passes',v:references.map(r=>r.memorySource?.id).filter(Boolean).join(' · ') || 'not collected'},
    {k:'Code passes',v:references.map(r=>r.codeSource?.id).filter(Boolean).join(' · ') || 'not collected'},
    {k:'Machine',v:MACH[ui.machine].l},{k:'OS',v:MACH[ui.machine].os},
    {k:'Sampling / warmup',v:references.map(r=>r.runId+': '+JSON.stringify(r.options)).join(' · ')},
    {k:'Reset policy',v:b.reset || 'not recorded'},
    {k:'Correctness oracle',v:JSON.stringify(b.oracle) || 'not recorded'},
    {k:'Raw evidence',v:references.map(r=>r.evidence+' · sha256 '+r.sha256).join(' · ')},
    {k:'Provenance',v:'Collected on both named hosts; exact artifacts and adapter identities sealed per report.'}
  ]);
	const tagHref = (t: string) => (t === 'simd' ? '/simd' : '/benchmarks?tag=' + encodeURIComponent(t) + '#workloads');
</script>

<svelte:head>
	<title>{workloadName(b.id)} · wasm.fyi</title>
	<meta name="description" content={b.purpose || `${workloadName(b.id)} — ${b.group} workload on wasm.fyi`} />
</svelte:head>

<div class="stack6">
	<div class="crumbs s12 fg3"><a class="link-quiet" href={siteHref(`/benchmarks`)}>Benchmarks</a> / {b.group}</div>
	<div class="title-line">
		<h1 class="mono">{workloadName(b.id)}</h1>
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
			<span class="note">up to 3 selected configurations · independent scenario processes</span>
		</div>
		{#if ui.memAligned}<div class="small warn">Phase-aligned view: each phase is stretched to a fixed width. Horizontal distance is not time.</div>{/if}
		{#if !mem.series.length}
			<div class="empty fg3">Elapsed memory timelines with phase anchors are not collected. The table reports independent process lifetime high-water values.</div>
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
		<div class="note">Process peak RSS is a lifetime high-water reading from each separate scenario process. PSS and guest-memory phase endpoints are unavailable.</div>
	</div>
	{#if sel.length}
		<div class="tbl-wrap">
			<table class="t" style:min-width="520px">
				<thead>
					<tr>
						<th>Scenario · process peak RSS (MiB)</th>
						{#each sel as id (id)}<th class="r"><RtLabel c={CB[id]} /></th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each mem.table as r (r.name)}
						<tr>
							<td class="fg2">{r.name}</td>
							{#each r.cells as text, k (k)}
								<td class="mono r" data-tip={`${r.name} — ${CB[sel[k]].rt} ${CB[sel[k]].be}\n${text}\nlifetime high-water record`}>{text}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	<div class="note">Memory values come from matched memory-profile runs. Timing and memory are separate measurements; phase end values and physical reclamation are not inferred.</div>
{:else if ui.bdTab === 'code'}
	<div class="lede">
		Extracted native image bytes from a separate code-profile pass. Images can include wrappers and data. Function, stub, metadata, active-tier and cumulative breakdowns are not collected.
	</div>
	<div class="tbl-wrap">
		<table class="t" style:min-width="900px">
			<thead>
				<tr>
					<th>Configuration</th>
					<th class="r">Function code</th>
					<th class="r">Stubs &amp; trampolines</th>
					<th class="r">Metadata &amp; pools</th>
					<th class="r">Extracted image</th>
					<th class="r">Cumulative emitted</th>
					<th>Compiled functions</th>
					<th>Tier</th>
				</tr>
			</thead>
			<tbody>
				{#each codeRows as r (r.c.id)}
					<tr>
						<td class="nowrap"><RtLabel c={r.c} /></td>
					{#each r.cells as c, i (i)}<td class="mono fg2" class:r={i < 5}>{c}{#if i===3&&r.inspect}<br /><a href={r.inspect} target="_blank" rel="noreferrer">Inspect image</a>{/if}</td>{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<div class="note">“Inspect image” opens the exact extracted bytes and engine-reported function ranges. These bytes include any wrappers and embedded data; ranges are not instruction-only sizes.</div>
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
		<pre class="mono">just refresh</pre>
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
