<script lang="ts">
	import {apiView,loadOverview,aggregateKey,trackId} from '$lib/api/controller.svelte';
 import {datasetView} from '$lib/api/view.svelte';
 import {metricSelectors} from '$lib/api/presentation';
 import { tipCard, tipWho } from '$lib/tip';
 import PlugIcon from '$lib/components/PlugIcon.svelte';
 import FeatureResult from '$lib/components/FeatureResult.svelte';
 import FeatureEvidence from '$lib/components/FeatureEvidence.svelte';
 import type { FeatureTrack } from '$lib/support';
	import { siteHref } from '$lib/links';
	import Seg from '$lib/components/Seg.svelte';
	import Swatch from '$lib/components/Swatch.svelte';
	import { COMPAT, FEATS, PROPS } from '$lib/data/features';
	import { FEATURE_CFG, FEATURE_ENGINES, RTB } from '$lib/data/runtimes';
	import { viewCell } from '$lib/view-data';
		import { fmtU, relative } from '$lib/format';
	import { heatRatio } from '$lib/heat';
	import { PROPOSAL_IDS } from '$lib/links';
	import { featureContracts } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import { supportCell, engineFeatureVersions, runtimeFeatureTrack, pluginSupportEvidence } from '$lib/support';

	// One accent per section so phase boundaries read at a glance.
	const TONES:[string,string][]=[['Phase 5','var(--st-pass)'],['Phase 4','var(--good)'],['Phase 3','var(--rt-wasmtime)'],['Phase 2','var(--st-warn)'],['Phase 1','var(--rt-wazero)'],['Inactive','var(--fg3)']];
	const toneOf=(g:string)=>TONES.find(([p])=>g.startsWith(p))?.[1] ?? 'var(--fg2)';

	let evidence=$state<{feature:string;engine:string;track:FeatureTrack}|null>(null);
  const channels=['stable'] as const;
	const propLinks = PROPOSAL_IDS.map((id) => ({ id, label: PROPS[id].title }));

	// ── Support matrix ─────────────────────────────────────────────────────
	const featCols = [
		...FEATURE_ENGINES.map((id) => ({ label: RTB[id].name, sub: RTB[id].lang, rt: id }))
	];
	const groups = $derived([...new Set(FEATS.map(f=>f.g))].map(g=>({g,rows:FEATS.filter(f=>f.g===g).map(f=>{
    const contracts=featureContracts(f.id).length;
    return {f,contracts,count:contracts?`${contracts} corpus tests`:f.phase,cells:[...FEATURE_ENGINES.map(id=>({...supportCell('?'),detail:'',tracks:channels.map(channel=>runtimeFeatureTrack(id,f,ui.scope,channel,undefined))}))]};
  })})));

	// ── Spec tests ─────────────────────────────────────────────────────────
	const cols = $derived(FEATURE_CFG.filter((c) => !ui.scope.hide[c.id] && engineFeatureVersions(c.rt,ui.scope,'stable').length>0));

	$effect(()=>{
  if(!apiView.ready||ui.compatView!=='perf')return;
  const metric=ui.perfMetric==='exec'?'steady':ui.perfMetric==='compile'?'compile':'rss';
  const scope={machine:ui.machine,snapshot:ui.snap,metric,baseline:ui.baseline,weighting:'workload' as const,hide:{...ui.hide,...Object.fromEntries(FEATURE_CFG.filter(c=>!cols.some(v=>v.id===c.id)).map(c=>[c.id,true]))}};
  const abort=new AbortController();for(const section of COMPAT)for(const family of section.fams)void loadOverview(scope as import('$lib/api/controller.svelte').PageScope,metric,family.id,abort.signal);
  return ()=>abort.abort();
 });
 // ── Proposal performance ───────────────────────────────────────────────
	const PERF_NOTE={exec:'Steady execution · shared successful execution contracts per family; compile-only probes excluded.',compile:'Compilation · shared successful contracts per family.',mem:'Steady process peak RSS · shared successful contracts; includes adapter process.'};
  const perfSecs=$derived.by(()=>{
    const metric=ui.perfMetric==='exec'?'steady':ui.perfMetric==='compile'?'compile':'rss';
    const unit=metric==='rss'?'MiB':'ms';
    return COMPAT.map(sec=>({sec:sec.sec,rows:sec.fams.map(f=>{
      const contracts=featureContracts(f.id).filter(w=>metric==='compile'||!['compile-only','compile-and-instantiate'].includes(w.evidenceScope || ''));
      if(datasetView.revision){const scope={...ui.scope,weighting:'workload' as const,hide:{...ui.hide,...Object.fromEntries(FEATURE_CFG.filter(c=>!cols.some(v=>v.id===c.id)).map(c=>[c.id,true]))}};const overview=apiView.aggregates[aggregateKey(scope,metric)+'|feature:'+f.id];const values=cols.map(c=>{const card=overview?.cards.find(x=>x.lane===trackId(c.id));return card?.status==='available'&&card.value!=null?card.value/metricSelectors[metric].factor:null});const min=Math.min(...values.filter((v):v is number=>v!=null));return {f,corpus:`${overview?.cards.find(c=>c.count)?.count||0} shared contracts / ${contracts.length} eligible`,cells:values.map(v=>v==null?{text:'unavailable',sub:apiView.aggregateErrors[aggregateKey(scope,metric)+'|feature:'+f.id]||'loading comparison',bg:'transparent',color:'var(--fg3)',fw:400}:{text:fmtU(v,unit),sub:v===min?'lowest':relative(v/min,ui.deltaFormat)+' vs lowest',bg:heatRatio(v/min),color:'var(--fg)',fw:v===min?600:400})}}
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
	<span class="s12 fg3 lim">Released engine compatibility and verified corpus results. <a class="link" href={'/api/v1/conformance'}>Official suite evidence</a>.</span>
</div>
<div class="row">
	<Seg
		options={[
			['support', 'Compatibility'],
			['perf', 'Performance']
		]}
		value={ui.compatView==='tests'?'support':ui.compatView}
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

{#if ui.compatView !== 'perf'}
	<div class="legend">
		<span class="lg"><span class="box" style:background="oklch(0.72 0.14 150 / 0.18)"></span>● passed</span>
		<span class="lg"><span class="box" style:background="oklch(0.77 0.14 60 / 0.16)"></span>⚑ flag</span>
		<span>passed / total · bar: pass / fail / skip or unsupported · — unmeasured</span>
    <span class="lg"><PlugIcon /> plugin</span>
		<span class="fg3">Proposal pages:</span>
		{@render proposalLinks()}
	</div>
	<div class="tbl-wrap tall">
		<table class="mx compat">
			<thead>
				<tr>
					<th class="stick th-label feat-h">Feature</th>
					{#each featCols as h (h.label)}
						<th class="fh">
							{#if h.rt}
								{@const rt = h.rt}
								<button class="w5" onclick={() => ui.openProfile(rt)} data-tip="Open {h.label} runtime profile">{h.label}</button>
							{:else}
								<span class="w5">{h.label}</span>
							{/if}
							<div class="micro fg3 w4">{h.sub}</div>
              {#if h.rt}
                {#each channels as channel}
                  {@const versions=engineFeatureVersions(h.rt,ui.scope,channel)}
                  <div class="track-version micro">
                    <span>Release</span>
                    <span data-tip={versions[0] ? `${channel} release\n${versions[0]}` : undefined}>{versions[0]?.replace(/\/source-.*/, '').replace(/^([a-f0-9]{12})[a-f0-9]{28}$/, '$1').replace(/^Node (.*?) \/ V8 .*/, 'Node $1') || '—'}</span>
                  </div>
                {/each}
              {/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each groups as g (g.g)}
					<tr class="sec band" style:--tone={toneOf(g.g)}>
						<td class="stick secname"><span class="sec-title">{g.g}</span><span class="sec-count mono">{g.rows.length}</span></td>
						<td class="sec-fill" colspan={featCols.length}></td>
					</tr>
					{#each g.rows as r (r.f.id)}
						<tr>
							<td class="stick fname">
								{#if r.f.page}<a class="flink w5" href={siteHref(`/${r.f.page}`)} data-tip="Open the {r.f.name} page: status, adoption and performance">{r.f.name}</a>{:else if r.f.url}<a class="flink w5" href={r.f.url} target="_blank" rel="noopener" data-tip="Open the official {r.f.name} {r.f.url.includes('/proposals') || r.f.url.includes('github.com/WebAssembly/') ? 'proposal' : 'specification'}">{r.f.name}<span class="ext-mark" aria-label="(opens in a new tab)">↗</span></a>{:else}<span class="w5">{r.f.name}</span>{/if}
								<div class="mono micro fg3">{r.count}</div>
							</td>
							{#if !r.contracts && !featCols.some((h)=>h.rt==='wago' && pluginSupportEvidence(r.f.id,ui.scope.machine))}
								<td class="nocorpus" colspan={featCols.length}><span class="micro fg3"><span class="long">No corpus contracts yet · </span>not measured</span></td>
							{:else}
							{#each r.cells as x, k (k)}
                  {@const supportedPlugin=featCols[k].rt==='wago'?pluginSupportEvidence(r.f.id,ui.scope.machine):undefined}
								<td class="fcell">
                  {#if supportedPlugin}
                    <FeatureResult plugin passed={supportedPlugin.passed} total={supportedPlugin.total} failed={supportedPlugin.failed} skipped={supportedPlugin.skipped} measured={supportedPlugin.official}
                      href={supportedPlugin.official?supportedPlugin.evidence:'/api/v1/conformance'}
                      label={`${r.f.name}, Wago plugin: ${supportedPlugin.official?`${supportedPlugin.passed} of ${supportedPlugin.total} official cases passed, ${supportedPlugin.failed} failed, ${supportedPlugin.skipped} skipped`:'official suite unmeasured'}. Open suite evidence`}
                      tooltip={JSON.stringify({title:`Wago · ${r.f.name}`,subtitle:`Official suite · released plugin ${supportedPlugin.version}`,rows:supportedPlugin.official?[{label:supportedPlugin.label,pass:supportedPlugin.passed,total:supportedPlugin.total,failed:supportedPlugin.failed,skipped:supportedPlugin.skipped,skippedLabel:'skipped',missing:0}]:[],hint:supportedPlugin.official?`${supportedPlugin.scope || 'Official upstream suite'}; skips count toward the total. Performance remains unmeasured.`:'Official suite not collected for this feature on this host. Performance remains unmeasured.'})} />
                  {:else if x.tracks}
                    {#each x.tracks as track}
                      {@const best=track.configurations.filter(c=>c.pass===track.pass).sort((a,b)=>a.failed-b.failed)[0]}
                      {#if track.text==='Node host API · unmeasured'}
                        <div class="mono micro host-note" data-tip={track.detail}>{track.text}</div>
                      {:else}<FeatureResult passed={track.pass} total={track.expected} failed={best?.failed || 0} skipped={best?.skipped || 0} missing={best?.missing || 0} measured={!!track.configurations.length} flagged={track.text==='corpus passed · flag'}
                        label={`${r.f.name}, ${featCols[k].label}: ${track.pass} of ${track.expected} corpus tests passed. Open corpus results`}
                        tooltip={JSON.stringify({title:`${featCols[k].label} · ${r.f.name}`,subtitle:`Corpus tests · published release ${track.version || 'not collected'}`,rows:track.configurations.map(c=>({label:c.backend,pass:c.pass,total:c.total,failed:c.failed,skipped:c.skipped,missing:c.missing})),hint:track.configurations.length?'Click to inspect individual tests':'No measurements for this track'})}
                        onselect={()=>evidence={feature:r.f.name,engine:featCols[k].label,track}} />
                      {/if}
                    {/each}
                  {:else}<div class="mono small nowrap" style:color={x.color}><span class="micro">{x.glyph}</span> {x.text}</div>{/if}
</td>
							{/each}
							{/if}
						</tr>
					{/each}
				{/each}
			</tbody>
		</table>
	</div>
	<div class="note">
    Released engines only. Counts show passed / total corpus tests for one configuration; click for backend and individual test results. ⚑ requires an experimental flag. Browser builds and plugin performance are unmeasured. Wago plugin cells show official cases passed / total, including failed and skipped cases. Official suite links show separate correctness results. <a href={'/api/v1/features'}>Full evidence</a>.
    <details><summary>Measurement scope</summary><p>Unreleased builds are excluded. The latest measured release is shown for each engine. Compilation and execution contracts use their declared oracles. Adapter-unsupported results do not establish that an engine lacks a feature; these representative tests do not establish complete specification conformance. Wago provides optional WASI and Component Model plugins, listed separately from measured results. Feature workloads never enter application averages.</p></details>
	</div>
{:else}
	<div class="s12 fg3">{PERF_NOTE[ui.perfMetric]}</div>
	<div class="tbl-wrap tall">
		<table class="mx perf">
			<thead>
				<tr>
					<th class="stick th-label perf-h">Proposal / extension · corpus</th>
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
									data-tip-card={tipCard({ kicker: 'Feature performance', title: r.f.name, who: tipWho(cols[k]), value: x.text, valueColor: x.color === 'var(--fg)' ? '' : x.color, sub: x.sub, heat: x.bg === 'transparent' ? '' : x.bg, note: r.corpus })}
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

<FeatureEvidence selection={evidence} onclose={()=>evidence=null} />

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
	.fname {
		padding: 6px 12px;
	}
	.fcell {
		padding: 2px 4px;
		text-align: center;
	}
	/* Section bands: spacing above, a full-width tinted bar, and a coloured edge per phase. */
	.band td {
		border-top: 14px solid var(--bg2);
		border-left: 0 !important;
		background: color-mix(in oklab, var(--tone) 14%, var(--bg3)) !important;
	}
	.band:first-child td {
		border-top-width: 0;
	}
	.band .secname {
		padding: 9px 12px 9px 10px;
		box-shadow: inset 3px 0 0 var(--tone);
		white-space: nowrap;
	}
	.sec-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--fg);
	}
	.sec-count {
		margin-left: 8px;
		padding: 0 6px;
		font-size: 10px;
		line-height: 16px;
		display: inline-block;
		color: var(--fg2);
		border: 1px solid color-mix(in oklab, var(--tone) 45%, var(--line2));
	}
	.nocorpus {
		padding: 6px 12px;
	}
	.flink {
		color: var(--fg);
		text-decoration: underline;
		text-decoration-color: var(--line2);
		text-underline-offset: 3px;
	}
	.flink:hover {
		text-decoration-color: var(--fg);
	}
	.ext-mark {
		margin-left: 3px;
		font-size: 10px;
		color: var(--fg3);
		text-decoration: none;
		display: inline-block;
	}
	.ch {
		padding: 6px 10px;
		text-align: left;
	}
	.pcell {
		padding: 6px 10px;
	}

	.compat {
		min-width: 1400px;
	}
	.host-note {
		max-width: 16ch;
		margin: 0 auto;
		color: var(--fg3);
	}
	.perf {
		min-width: 1000px;
	}
	.feat-h {
		min-width: 185px;
	}
	.perf-h {
		min-width: 240px;
	}
	@media (max-width: 720px) {
		.compat {
			min-width: 980px;
		}
		.perf {
			min-width: 760px;
		}
		.tall {
			max-height: 72svh;
		}
		.fname,
		.secname {
			padding: 6px 10px;
		}
		.legend {
			gap: 6px 12px;
		}
		.nocorpus .long {
			display: none;
		}
	}

  .track-version { display:flex;gap:5px;align-items:center;margin-top:5px;max-width:140px;text-align:left; }
  .track-version > span:last-child { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
</style>
