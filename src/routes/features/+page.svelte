<script lang="ts">
 import { configVersion } from '$lib/data/runtimes';
	import { siteHref } from '$lib/links';
	import RtLabel from '$lib/components/RtLabel.svelte';
	import Seg from '$lib/components/Seg.svelte';
	import Swatch from '$lib/components/Swatch.svelte';
	import { BROWSERS, COMPAT, FEATS, PROPS } from '$lib/data/features';
	import { FEATURE_CFG, FEATURE_ENGINES, RTB } from '$lib/data/runtimes';
	import { viewCell } from '$lib/view-data';
	import type { RatioCi } from '$lib/data/types';
	import { fmtU, relative, n0 } from '$lib/format';
	import { heatRatio } from '$lib/heat';
	import { PROPOSAL_IDS } from '$lib/links';
	import { cellView, compatCell, featureContracts, featureOutcome, isOff, isVisible, kidCells, mf } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import { supportCell, runtimeSupportCell } from '$lib/support';

	const propLinks = PROPOSAL_IDS.map((id) => ({ id, label: PROPS[id].title }));

	// ── Support matrix ─────────────────────────────────────────────────────
	const featCols = [
		...BROWSERS.map((b) => ({ label: b, sub: 'browser', rt: null as string | null })),
		...FEATURE_ENGINES.map((id) => ({ label: RTB[id].name, sub: RTB[id].lang, rt: RTB[id].cfg ? id : null }))
	];
	const groups = $derived([...new Set(FEATS.map(f=>f.g))].map(g=>({g,rows:FEATS.filter(f=>f.g===g).map(f=>{
    return {f,count:`${featureContracts(f.id).length} representative contracts`,cells:[...BROWSERS.map(()=>({...supportCell('?'),detail:''})), ...FEATURE_ENGINES.map(id=>runtimeSupportCell(id,f,ui.scope))]};
  })})));

	// ── Spec tests ─────────────────────────────────────────────────────────
	const cols = $derived(FEATURE_CFG.filter((c) => isVisible(ui.scope, c)));
	const offCell = { glyph: '—', text: 'config unavailable', sub: '', subColor: 'var(--fg3)', segs: [], color: 'var(--fg3)' };

	// ── Proposal performance ───────────────────────────────────────────────
	const PERF_NOTE={exec:'Steady execution · shared successful execution contracts per family; compile-only probes excluded.',compile:'Compilation · shared successful contracts per family.',mem:'Steady process peak RSS · shared successful contracts; includes adapter process.'};
  const perfSecs=$derived.by(()=>{
    const metric=ui.perfMetric==='exec'?'steady':ui.perfMetric==='compile'?'compile':'rss';
    const unit=metric==='rss'?'MiB':'ms';
    return COMPAT.map(sec=>({sec:sec.sec,rows:sec.fams.map(f=>{
      const contracts=featureContracts(f.id).filter(w=>metric==='compile'||!['compile-only','compile-and-instantiate'].includes(w.evidenceScope || ''));
      const participants=cols.filter(c=>contracts.some(w=>{const x=viewCell(ui.scope.machine,ui.scope.snapshot || 's1',w.id,c.id,metric);return x.st==='ok' && x.v!=null && x.v>0;}));
      const cohort=contracts.filter(w=>participants.length && participants.every(c=>{const x=viewCell(ui.scope.machine,ui.scope.snapshot || 's1',w.id,c.id,metric);return x.st==='ok' && x.v!=null && x.v>0;}));
      const values=cols.map(c=>participants.some(p=>p.id===c.id) && cohort.length?Math.exp(cohort.reduce((sum,w)=>sum+Math.log(viewCell(ui.scope.machine,ui.scope.snapshot || 's1',w.id,c.id,metric).v!),0)/cohort.length):null);
      const min=Math.min(...values.filter((v):v is number=>v!=null));
      return {f,corpus:`${cohort.length} shared contracts / ${contracts.length} eligible`,cells:values.map(v=>v==null?{text:'not measured',sub:'no shared successful cohort',bg:'transparent',color:'var(--fg3)',fw:400}:{text:fmtU(v,unit),sub:v===min?'lowest':relative(v/min,ui.deltaFormat)+' vs lowest',bg:heatRatio(v/min),color:'var(--fg)',fw:v===min?600:400})};
    })}));
  });

</script>

<svelte:head>
	<title>Features · wasm.fyi</title>
</svelte:head>

<div class="head">
	<span class="mono small fg3 path">wasm.fyi/features</span>
	<h1>Features</h1>
	<span class="s12 fg3 lim">Feature status across browsers and runtimes, plus verified representative corpus results and per-proposal performance.</span>
</div>
<div class="row">
	<Seg
		options={[
			['support', 'Support'],
			['tests', 'Corpus tests'],
			['perf', 'Performance']
		]}
		value={ui.compatView}
		onselect={(v) => (ui.compatView = v as typeof ui.compatView)}
		size="md"
		label="View"
	/>
	{#if ui.compatView === 'perf'}
		<Seg
			options={[
				['exec', 'Execution'],
				['compile', 'Compilation'],
				['mem', 'Peak memory']
			]}
			value={ui.perfMetric}
			onselect={(v) => (ui.perfMetric = v as typeof ui.perfMetric)}
			size="md"
			label="Metric"
		/>
	{/if}
</div>

{#snippet proposalLinks()}
	{#each propLinks as p (p.id)}
		<a class="plink" href={siteHref(`/${p.id}`)} data-tip="Open the {p.label} page: status, adoption & performance">{p.label}</a>
	{/each}
{/snippet}

{#if ui.compatView === 'support'}
	<div class="legend">
		<span class="lg"><span class="box" style:background="oklch(0.72 0.14 150 / 0.18)"></span>● representative corpus passed</span>
		<span class="lg"><span class="box" style:background="oklch(0.77 0.14 60 / 0.16)"></span>⚑ flag · ◐ partial</span>
		<span>— no · ? unknown · · not applicable</span>
		<span class="fg3">Proposal pages:</span>
		{@render proposalLinks()}
	</div>
	<div class="tbl-wrap tall">
		<table class="mx" style:min-width="1100px">
			<thead>
				<tr>
					<th class="stick th-label" style:min-width="230px">Feature</th>
					{#each featCols as h (h.label)}
						<th class="fh">
							{#if h.rt}
								{@const rt = h.rt}
								<button class="w5" onclick={() => ui.openProfile(rt)} data-tip="Open {h.label} runtime profile">{h.label}</button>
							{:else}
								<span class="w5">{h.label}</span>
							{/if}
							<div class="micro fg3 w4">{h.sub}</div>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each groups as g (g.g)}
					<tr class="sec">
						<td class="stick secname">{g.g}</td>
						{#each featCols as h (h.label)}<td></td>{/each}
					</tr>
					{#each g.rows as r (r.f.id)}
						<tr>
							<td class="stick fname">
								{#if r.f.page}<a class="link w5" href={siteHref(`/${r.f.page}`)}>{r.f.name}</a>{:else}<span class="w5">{r.f.name}</span>{/if}
								<div class="mono micro fg3">{r.f.phase} · {r.count}</div>
							</td>
							{#each r.cells as x, k (k)}
								<td class="fcell" style:background={x.bg} data-tip={`${r.f.name} — ${featCols[k].label}\n${x.glyph} ${x.text}\n${r.f.phase}\n${x.detail}`}>
									<div class="mono small nowrap" style:color={x.color}><span class="micro">{x.glyph}</span> {x.text}</div>
								</td>
							{/each}
						</tr>
					{/each}
				{/each}
			</tbody>
		</table>
	</div>
	<div class="note">
		Results apply to the recorded adapters and host. “Via plugin” indicates documented availability in an optional plugin configuration that has not been benchmarked here: Wago provides WASI through <a href="https://github.com/wago-org/wasi">wago-org/wasi</a> and Component Model execution through <a href="https://github.com/wago-org/component-model">wago-org/component-model</a>. Execution contracts verify exact outputs; structural and interface probes verify compilation only. Browser builds have not been collected. All tested configurations, including async components and the WasmFX flag, appear in Corpus tests and Performance. A passed cell requires one configuration to pass the complete family; diagnostics list each configuration separately. Adapter-unsupported contracts do not establish that an engine lacks a feature. Feature-only engines never enter application averages. These representative cases do not establish full specification conformance. <a href={siteHref('/wasmbench/feature-support.json')}>Full support evidence</a>.

	</div>
{:else if ui.compatView === 'tests'}
	<div class="legend">
		<span class="kicker">Availability</span>
		<span>● recorded configuration</span><span>⚑ requires flag (tested with flag)</span><span>— unavailable</span><span>? unknown</span><span>· not run</span>
		<span class="kicker ml">Results</span>
		<span class="lg"><span class="sbar" style:background="var(--st-pass)"></span>passed</span>
		<span class="lg"><span class="sbar" style:background="var(--st-fail)"></span>failed</span>
		<span class="lg"><span class="sbar" style:background="var(--st-crash)"></span>crashed</span>
		<span class="lg"><span class="sbar" style:background="var(--st-skip)"></span>skipped</span>
	</div>
	<div class="legend">Proposal pages: {@render proposalLinks()}</div>
	<div class="tbl-wrap tall">
		<table class="mx" style:min-width="1080px">
			<thead>
				<tr>
					<th class="stick th-label" style:min-width="240px">Feature family</th>
					{#each cols as c (c.id)}
						<th class="ch">
							<span class="cname"><Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} />{c.rt}</span>
							<span class="mono micro fg3">{configVersion(ui.machine,c.id)} · {c.be}</span>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each COMPAT as sec (sec.sec)}
					<tr class="sec">
						<td class="stick secpad">
							<div class="w6">{sec.sec}</div>
							<div class="mono micro fg3 nowrap">{sec.suite} · counted in {sec.unit}</div>
						</td>
						{#each cols as c (c.id)}<td></td>{/each}
					</tr>
					{#each sec.fams as f (f.id)}
						{@const open = !!ui.compatOpen[f.id]}
						<tr>
							<td class="stick fname">
								<div class="fam-line">
									<button class="fam" aria-expanded={open} onclick={() => (ui.compatOpen = { ...ui.compatOpen, [f.id]: !open })}>
										<span class="mono caret">{open ? '▾' : '▸'}</span><span class="w5">{f.name}</span>
									</button>
									{#if f.page}<a class="link-quiet small" href={siteHref(`/${f.page}`)}>feature page</a>{/if}
								</div>
								<div class="mono micro fg3 indent">{n0(f.total)} {sec.unit}</div>
							</td>
							{#each cols as c (c.id)}
								{@const ci = FEATURE_CFG.indexOf(c)}
								{@const x = isOff(ui.scope, c.id) ? offCell : cellView(compatCell(f.id, c.id, ui.scope))}
								<td class="p0">
									<button
										class="tcell hoverbg"
										style:color={x.color}
										onclick={() => (ui.drawer = { type: 'compat', fam: f.id, cid: c.id })}
										data-tip={`${f.name} — ${c.rt} ${c.be}\n${[x.text, x.sub].filter(Boolean).join(' · ')}\nClick for failing tests & diagnostics`}
									>
										<span class="tl mono"><span class="glyph">{x.glyph}</span>{x.text}</span>
										<span class="sbar-row">{#each x.segs as g, k (k)}<span style:width={g.w} style:background={g.c}></span>{/each}</span>
										<span class="micro nowrap" style:color={x.subColor}>{x.sub}</span>
									</button>
								</td>
							{/each}
						</tr>
						{#if open}
							{@const per = cols.map((c) => kidCells(f, FEATURE_CFG.indexOf(c), ui.scope))}
							{#each f.kids as [name], ki (name)}
								<tr>
									<td class="stick kid">{name}</td>
									{#each cols as c, k (c.id)}
										{@const x = cellView(per[k][ki])}
										<td class="p0">
											<button
												class="kcell hoverbg mono"
												style:color={x.color}
												onclick={() => (ui.drawer = { type: 'compat', fam: f.id, kid: ki, cid: c.id })}
												data-tip={`${name} — ${c.rt} ${c.be}\n${[x.text, x.sub].filter(Boolean).join(' · ')}\nClick for failing tests & diagnostics`}
											>
												<span>{x.text}</span><span class="micro" style:color={x.subColor}>{x.sub}</span>
											</button>
										</td>
									{/each}
								</tr>
							{/each}
						{/if}
					{/each}
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<div class="s12 fg3">{PERF_NOTE[ui.perfMetric]}</div>
	<div class="tbl-wrap tall">
		<table class="mx" style:min-width="1000px">
			<thead>
				<tr>
					<th class="stick th-label" style:min-width="240px">Proposal / extension · corpus</th>
					{#each cols as c (c.id)}
						<th class="ch r">
							<span class="cname jr"><Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} />{c.rt}</span>
							<div class="mono micro fg3">{c.be}</div>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each perfSecs as sec (sec.sec)}
					<tr class="sec">
						<td class="stick secname">{sec.sec}</td>
						{#each cols as c (c.id)}<td></td>{/each}
					</tr>
					{#each sec.rows as r (r.f.id)}
						<tr>
							<td class="stick fname">
								<div class="fam-line">
									<span class="w5">{r.f.name}</span>
									{#if r.f.page}<a class="link-quiet small" href={siteHref(`/${r.f.page}`)}>feature page</a>{/if}
								</div>
								<div class="mono micro fg3">{r.corpus}</div>
							</td>
							{#each r.cells as x, k (k)}
								<td
									class="pcell r"
									style:background={x.bg}
									style:color={x.color}
									data-tip={`${r.f.name} — ${cols[k].rt} ${cols[k].be}\n${[x.text, x.sub].filter(Boolean).join(' · ')}`}
								>
									<div class="mono s12 nowrap" style:font-weight={x.fw}>{x.text}</div>
									<div class="micro fg3 nowrap">{x.sub}</div>
								</td>
							{/each}
						</tr>
					{/each}
				{/each}
			</tbody>
		</table>
	</div>
	<div class="note">
		Bold = lowest in row · heat = distance from row's lowest · ⚑ measured with the feature flag enabled · runtimes failing the corpus correctness
		check get no value.
	</div>
{/if}

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 16px;
	}
	.path {
		width: 100%;
	}
	h1 {
		font-size: 18px;
		font-weight: 600;
	}
	.s12 {
		font-size: 12px;
	}
	.lim {
		max-width: 760px;
	}
	.w4 {
		font-weight: 400;
	}
	.w5 {
		font-weight: 500;
	}
	.w6 {
		font-weight: 600;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 16px;
		font-size: 12px;
		color: var(--fg2);
		align-items: center;
	}
	.lg {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.box {
		width: 12px;
		height: 12px;
	}
	.sbar {
		width: 10px;
		height: 6px;
	}
	.ml {
		margin-left: 8px;
	}
	.plink {
		font-size: 12px;
		text-decoration: underline;
	}
	.tall {
		max-height: 76vh;
	}
	.fh {
		padding: 6px 8px;
		text-align: center;
		font-size: 12px;
	}
	.secname {
		padding: 6px 12px;
		font-weight: 600;
		background: var(--bg3) !important;
	}
	.secpad {
		padding: 8px 12px;
		background: var(--bg3) !important;
	}
	.fname {
		padding: 6px 12px;
	}
	.fcell {
		padding: 6px;
		text-align: center;
	}
	.ch {
		padding: 6px 10px;
		text-align: left;
	}
	.cname {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
	}
	.jr {
		display: inline-flex;
	}
	.fam-line {
		display: flex;
		gap: 8px;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.fam {
		display: flex;
		gap: 8px;
		align-items: baseline;
		text-align: left;
	}
	.caret {
		width: 10px;
	}
	.indent {
		padding-left: 18px;
	}
	.p0 {
		padding: 0;
	}
	.tcell {
		display: flex;
		flex-direction: column;
		gap: 3px;
		width: 100%;
		padding: 6px 10px;
		text-align: left;
	}
	.tl {
		display: flex;
		gap: 6px;
		align-items: baseline;
		font-size: 12px;
		white-space: nowrap;
	}
	.glyph {
		width: 10px;
		color: var(--fg2);
	}
	.sbar-row {
		display: flex;
		height: 4px;
		width: 100%;
		background: var(--bg3);
	}
	.kid {
		padding: 4px 12px 4px 38px;
		font-size: 12px;
		color: var(--fg2);
	}
	.kcell {
		display: flex;
		justify-content: space-between;
		gap: 6px;
		width: 100%;
		padding: 4px 10px;
		text-align: left;
		font-size: 11px;
	}
	.pcell {
		padding: 6px 10px;
	}
</style>
