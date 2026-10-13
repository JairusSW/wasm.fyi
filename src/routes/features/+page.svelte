<script lang="ts">
 import CohortStrike from '$lib/components/CohortStrike.svelte';
 import StatusLegend from '$lib/components/StatusLegend.svelte';
	import {apiView} from '$lib/api/controller.svelte';
 import { rankStats, tipCard, tipWho } from '$lib/tip';
 import PlugIcon from '$lib/components/PlugIcon.svelte';
 import FeatureLeaders from '$lib/components/FeatureLeaders.svelte';
 import FeatureCorpora from '$lib/components/FeatureCorpora.svelte';
 const corpusCount=(family:string)=>new Set(featureContracts(family).map(w=>w.id.split('/')[2])).size;
 let expandedCorpora=$state<Record<string,boolean>>({});
	import { siteHref } from '$lib/links';
	import Seg from '$lib/components/Seg.svelte';
	import Swatch from '$lib/components/Swatch.svelte';
	import { COMPAT, FEATURE_ROWS, PROPS } from '$lib/data/features';
	import { FEATURE_CFG } from '$lib/data/runtimes';
		import { fmtU, fmtAverage } from '$lib/format';
	import { heatCount, heatField, heatCorrectness } from '$lib/heat';
	import { PROPOSAL_IDS } from '$lib/links';
	import {ST} from '$lib/data/status';
 import { featureContracts } from '$lib/model';
	import { familyCohort } from '$lib/feature-values';
	import { ui } from '$lib/state.svelte';
	import { engineFeatureVersions, runtimeFeatureTrack, pluginSupportEvidence } from '$lib/support';


  const channels=['stable','development'] as const;
	const propLinks = PROPOSAL_IDS.map((id) => ({ id, label: PROPS[id].title }));

	// ── Support matrix ─────────────────────────────────────────────────────
	// Same shape as the Benchmarks workload table: one column per engine in its standard colour,
	// phase groups as collapsible sections, and passed/total cells heat-mapped by pass rate.
	const shortVer = (v?: string) => v?.replace(/\/source-.*/, '').replace(/^([a-f0-9]{12})[a-f0-9]{28}$/, '$1').replace(/^Node (.*?) \/ V8 .*/, 'Node $1') || '';
	const engines = $derived(
		// One column per configuration, so each backend (e.g. wazero compiler vs interpreter) stands alone.
		FEATURE_CFG.filter((c) => {
			if (ui.scope.hide[c.id]) return false;
			const plugin = c.rt === 'wago' && FEATURE_CFG.find((x) => x.rt === 'wago')?.id === c.id && FEATURE_ROWS.some((f) => pluginSupportEvidence(f.id, ui.scope.machine));
			return plugin || channels.some((ch) => engineFeatureVersions(c.rt, ui.scope, ch, c.id).length > 0);
		}).map((c) => ({
			id: c.id,
			rt: c.rt,
			be: c.be,
			col: c.col,
			hollow: c.hollow,
			plugin: c.rt === 'wago' && FEATURE_CFG.find((x) => x.rt === 'wago')?.id === c.id,
			release: shortVer(engineFeatureVersions(c.rt, ui.scope, 'stable', c.id)[0]),
			main: shortVer(engineFeatureVersions(c.rt, ui.scope, 'development', c.id)[0])
		}))
	);
	type Engine = (typeof engines)[number];
	type CompatView = { text: string; sub: string; bg: string; color: string; full: boolean; tip: string; href?: string; open?: () => void };
	type Perf = ReturnType<typeof familyCohort> | null;
	/** Execution performance for the compatibility tooltip: this configuration's time and place, and the fastest. */
	function perfStats(perf: Perf, k: number): [string, string][] {
		if (!perf || !perf.contracts.length) return [];
		const n = perf.contracts.length;
		const v = perf.values[k];
		const rs = rankStats(perf.values, k, engines.map((e) => `${e.rt} ${e.be}`), (x) => fmtU(x, 'ms'));
		const head: [string, string] = v != null ? ['execution', `${fmtAverage(v, 'ms')} · ${rs[0][1]}`] : ['execution', perf.passed[k] > 0 ? `unavailable · ${perf.passed[k]}/${n} passed` : '—'];
		return [head, ...rs.filter(([key]) => key === 'fastest')];
	}
	function compatView(f: (typeof FEATURE_ROWS)[number], e: Engine, contracts: number, perf: Perf, k: number): CompatView {
		const plugin = e.plugin ? pluginSupportEvidence(f.id, ui.scope.machine) : undefined;
		if (plugin) {
			const frac = plugin.total ? plugin.passed / plugin.total : 0;
			return {
				text: plugin.official ? `${plugin.passed}/${plugin.total}` : ST.nm[0],
				sub: 'plugin',
				bg: plugin.official && plugin.total ? heatCorrectness(plugin.passed,plugin.total) : 'transparent',
				color: plugin.official ? 'var(--fg)' : 'var(--fg3)',
				full: plugin.official && plugin.total > 0 && plugin.passed === plugin.total,
				href: plugin.official ? plugin.evidence : '/api/v1/conformance',
				tip: tipCard({ kicker: 'Feature compatibility · plugin', title: f.name, who: { rt: e.rt, be: 'plugin', col: e.col, hollow: e.hollow, ver: plugin.version }, value: plugin.official ? `${plugin.passed}/${plugin.total}` : 'unmeasured', sub: plugin.official ? `${plugin.failed} failed · ${plugin.skipped} skipped` : '', note: plugin.official ? `${plugin.scope || 'Official upstream suite'}; skips count toward the total. Performance remains unmeasured.` : 'Official suite not collected for this feature on this host.', action: 'open the suite evidence' })
			};
		}
		const none = (why: string): CompatView => ({ text: ST.nm[0], sub: '', bg: 'transparent', color: 'var(--fg3)', full: false, tip: tipCard({ kicker: 'Feature compatibility', title: f.name, who: { rt: e.rt, be: e.be, col: e.col, hollow: e.hollow }, value: 'not measured', note: why }) });
		if (!contracts) return none('No corpus contracts for this feature yet.');
		const rel = runtimeFeatureTrack(e.rt, f, ui.scope, 'stable', undefined, e.id);
		const main = runtimeFeatureTrack(e.rt, f, ui.scope, 'development', undefined, e.id);
		if (rel.text === 'Node host API · unmeasured') return none(rel.detail);
		const track = rel.configurations.length ? rel : main.configurations.length ? main : null;
		if (!track) return none(rel.text === 'not collected' ? 'No release or main-branch results collected.' : `Release: ${rel.text}.`);
		const best = track.configurations.filter((c) => c.pass === track.pass).sort((a, b) => a.failed - b.failed)[0];
		const frac = track.expected ? track.pass / track.expected : 0;
		const text = `${track.pass}/${track.expected}`;
		const mainDiffers = track === rel && main.configurations.length > 0 && main.pass !== rel.pass;
		const flagged = track.text === 'corpus passed · flag';
		// Nothing passed: show a plain dash rather than a red 0/n; details stay in the tooltip.
		const nonePassed = track.pass === 0;
		// Failed means the engine accepted the module but got it wrong: it claims the feature without
		// passing. Rejected or adapter-unsupported tests are not failures and stay a plain dash.
		const claimed = nonePassed && (best?.failed ?? 0) > 0;
		const bg = nonePassed ? 'transparent' : heatCorrectness(track.pass,track.expected);
		const reasons = track.detail.split('\n').filter((l) => l && !/ passed, /.test(l)).slice(0, 3);
		return {
			text: claimed ? ST.failed[0] : nonePassed ? ((best?.skipped||0)===track.expected?ST.unsupported[0]:ST.nm[0]) : text,
			// Columns with no release are labelled main in the header; flag main-only cells only where a release exists.
			sub: track === main ? (e.release ? 'main only' : '') : mainDiffers ? `main ${main.pass}/${main.expected}` : flagged ? '⚑ flag' : '',
			bg,
			color: claimed ? ST.failed[2] : nonePassed ? 'var(--fg3)' : 'var(--fg)',
			full: frac === 1,
			open: () => (ui.drawer = { type: 'support', fam: f.id, c: e.id, channel: track === rel ? 'stable' : 'development', peers: engines.map((x) => x.id) }),
			tip: tipCard({
				kicker: `Feature compatibility · ${track === rel ? 'release' : 'main branch'}`,
				title: f.name,
				who: { rt: e.rt, be: e.be, col: e.col, hollow: e.hollow, ver: shortVer(track.version) },
				value: text,
				heat: bg,
				sub: best ? `${best.failed} failed · ${best.skipped} skipped${best.missing ? ` · ${best.missing} not run` : ''}` : '',
				stats: [
					...track.configurations.map((c): [string, string] => [c.backend, `${c.pass}/${c.total}`]),
					...(track === rel && main.configurations.length ? [[`main ${shortVer(main.version)}`, `${main.pass}/${main.expected}`] as [string, string]] : []),
					...perfStats(perf, k)
				],
				points: reasons,
				note: flagged ? 'Passes only with an experimental flag enabled.' : '',
				action: 'tests, backends & run record'
			})
		};
	}
	const compatGroups = $derived(
		[...new Set(FEATURE_ROWS.map((f) => f.g))].map((g) => {
			const rows = FEATURE_ROWS.filter((f) => f.g === g).map((f) => {
				const contracts = featureContracts(f.id).length;
				const perf = contracts ? familyCohort(ui.scope, f.id, engines.map((e) => e.id), 'steady') : null;
				return { f, contracts, count: contracts ? `${contracts} corpus tests` : f.phase, cells: engines.map((e, k) => compatView(f, e, contracts, perf, k)) };
			});
			const measuredRows = rows.filter((r) => r.contracts);
			return {
				g,
				rows,
				open: !ui.collapsed['feat:' + g],
				count: `${rows.length} features · ${measuredRows.length} with corpus tests`,
				cells: engines.map((e, k) => {
					const full = measuredRows.filter((r) => r.cells[k].full).length;
					return { text: measuredRows.length ? `${full}/${measuredRows.length}` : '—', tip: tipCard({ kicker: 'Fully passed features', title: g, who: { rt: e.rt, be: e.be, col: e.col, hollow: e.hollow, ver: e.release }, value: `${full} of ${measuredRows.length}`, note: 'Features in this group where every corpus test passed.' }) };
				})
			};
		})
	);

	// ── Spec tests ─────────────────────────────────────────────────────────
	const cols = $derived(FEATURE_CFG.filter((c) => !ui.scope.hide[c.id] && channels.some(channel=>engineFeatureVersions(c.rt,ui.scope,channel).length>0)));

 // ── Proposal performance ───────────────────────────────────────────────
	const perfMetricKey = $derived(ui.perfMetric === 'exec' ? 'steady' : ui.perfMetric === 'compile' ? 'compile' : 'rss');
	const PERF_NOTE=$derived({exec:`Steady execution · ${ui.average==='mean'?'arithmetic mean':'geometric mean'} over selected execution contract per feature; compile-only probes excluded. ${ui.cohortMode==='per-engine'?'Passed contracts per engine':'Contracts passed on all shown engines'}.`,compile:`Compilation · ${ui.average==='mean'?'arithmetic mean':'geometric mean'} over selected contract per feature. ${ui.cohortMode==='per-engine'?'Passed contracts per engine':'Contracts passed on all shown engines'}.`,mem:`Steady process peak RSS · ${ui.average==='mean'?'arithmetic mean':'geometric mean'} over selected contract; includes adapter process. ${ui.cohortMode==='per-engine'?'Passed contracts per engine':'Contracts passed on all shown engines'}.`});
  const perfSecs=$derived.by(()=>{
    const metric=ui.perfMetric==='exec'?'steady':ui.perfMetric==='compile'?'compile':'rss';
    const unit=metric==='rss'?'MiB':'ms';
    // Same sections as Compatibility: MVP first, then proposals by phase; families outside
    // those rows (WASI, component interfaces) close the table as System interfaces.
    const fams=COMPAT.flatMap(sec=>sec.fams);
    const named=FEATURE_ROWS.flatMap(row=>{const fam=fams.find(x=>x.id===row.id);return fam?[{g:row.g,fam:{...fam,name:row.name,page:row.page}}]:[];});
    const rest=fams.filter(fam=>!named.some(x=>x.fam.id===fam.id)).map(fam=>({g:'System interfaces',fam}));
    const all=[...named,...rest];
    return [...new Set(all.map(x=>x.g))].map(g=>({sec:g,rows:all.filter(x=>x.g===g).map(({fam:f})=>{
      // Select passed contracts using the same cohort control as Benchmarks.
      const {contracts,values,passed,statuses,cohort}=familyCohort(ui.scope,f.id,cols.map(c=>c.id),metric);
      const excluded=ui.scope.cohortMode==='shared'&&contracts.length>0&&!cohort.length;
      const display=excluded?familyCohort({...ui.scope,cohortMode:'per-engine'},f.id,cols.map(c=>c.id),metric).values:values;
      const min=Math.min(...values.filter((v):v is number=>v!=null));
      const n=contracts.length;
      const names=cols.map(c=>`${c.rt} ${c.be}`);
      const stats=(k:number)=>rankStats(values,k,names,v=>fmtU(v,unit),metric==='rss'?'smallest':'fastest');
      return {f,excluded,corpus:n?`${ui.cohortMode==='shared'?cohort.length:n} contracts · ${ui.cohortMode==='shared'?'shared passes':'passed per engine'}`:'no eligible contracts',cells:display.map((v,k)=>v!=null
        ?{text:fmtAverage(v,unit),sub:excluded?'excluded':v===min?'lowest':'',note:excluded?'Excluded from comparison: no contracts passed and measured by every selected engine.':'',bg:excluded?'transparent':heatField(values,k),color:'var(--fg)',fw:!excluded&&v===min?600:400,stats:excluded?[]:stats(k)}
        :{text:ST[statuses[k]][0],sub:passed[k]>0?`${passed[k]}/${n} passed`:'',note:excluded?'Excluded from comparison: no contracts passed and measured by every selected engine.':ST[statuses[k]][1],bg:'transparent',color:ST[statuses[k]][2],fw:400,stats:excluded?[]:stats(k)})};
    })}));
  });

</script>

<svelte:head>
	<title>Features · wasm.fyi</title>
</svelte:head>

<div class="head">
	<h1>Features</h1>
	<span class="s12 fg3 lim">Latest pinned engine compatibility and measured feature performance.</span>
</div>
<FeatureLeaders cols={cols.map((c) => c.id)} />
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
	<div class="phase-note">Released engines · passed / total corpus tests per feature · heat runs green (all passed) to red (few passed) · click a cell for individual test results</div>
	<div class="tbl-wrap scroll">
		<table class="mx wl-table compat">
			<thead>
				<tr>
					<th class="stick th-label feat-h">Feature</th>
					{#each engines as e (e.id)}
						<th class="colh">
							<button class="sort" onclick={() => ui.openProfile(e.rt, e.id)} data-tip={`Open the ${e.rt} profile\nrelease ${e.release || '—'}${e.main ? ` · main ${e.main}` : ''}`}>
								<span class="rtn"><Swatch color={e.col} bg={e.hollow ? 'transparent' : e.col} />{e.rt}</span>
								<span class="mono micro fg3 ver">{e.be || '—'}{e.release ? '' : e.main ? ' · main' : ''}</span>
							</button>
						</th>
					{/each}
					{#if !apiView.ready}{#each { length: 8 } as _, k (k)}<th class="colh" aria-hidden="true"><span class="skel" style:width="{46 + ((k * 13) % 22)}px"></span></th>{/each}{/if}
				</tr>
			</thead>
			<tbody>
				{#each compatGroups as g (g.g)}
					<tr class="sec">
						<td class="stick grp">
							<button class="grp-btn" aria-expanded={g.open} onclick={() => (ui.collapsed = { ...ui.collapsed, ['feat:' + g.g]: g.open })}>
								<span class="mono caret">{g.open ? '▾' : '▸'}</span><span class="w6">{g.g}</span><span class="small fg3">{#if apiView.ready}{g.count}{:else}<span class="skel" style:width="9em"></span>{/if}</span>
							</button>
						</td>
						{#each g.cells as cell, k (k)}
							<td class="mono small fg2 r gcell" data-tip-card={cell.tip}>{cell.text}</td>
						{/each}
						{#if !apiView.ready}{#each { length: 8 } as _, k (k)}<td class="gcell"></td>{/each}{/if}
					</tr>
					{#if g.open}
						{#each g.rows as r (r.f.id)}
							<tr>
								<td class="stick item">
									<div class="item-line">
          {#if corpusCount(r.f.id)>1}<button class="corpus-toggle mono" aria-label={`${expandedCorpora[r.f.id]?'Hide':'Show'} corpora for ${r.f.name}`} aria-expanded={!!expandedCorpora[r.f.id]} onclick={()=>expandedCorpora[r.f.id]=!expandedCorpora[r.f.id]}>{expandedCorpora[r.f.id]?'▾':'▸'}</button>{/if}
										{#if r.f.page}<a class="name" href={siteHref(`/${r.f.page}`)} data-tip="Open the {r.f.name} page: status, adoption and performance">{r.f.name}</a>{:else if r.f.url}<a class="name" href={r.f.url} target="_blank" rel="noopener" data-tip="Open the official {r.f.name} {r.f.url.includes('/proposals') || r.f.url.includes('github.com/WebAssembly/') ? 'proposal' : 'specification'}">{r.f.name}<span class="ext-mark" aria-label="(opens in a new tab)">↗</span></a>{:else}<span class="name">{r.f.name}</span>{/if}
										<span class="mono micro fg3">{corpusCount(r.f.id)>1?`${corpusCount(r.f.id)} corpora · `:''}{r.count}</span>
									</div>
								</td>
								{#each r.cells as x, k (k)}
									<td class="p0" style:background={x.bg}>
										{#if x.href}
											<a class="cellbtn wcell" href={x.href} style:color={x.color} data-tip-card={x.tip}>
												<span class="mono s12 nowrap"><PlugIcon /> {x.text}</span>
											</a>
										{:else if x.open}
											<button class="cellbtn wcell" style:color={x.color} onclick={x.open} data-tip-card={x.tip}>
												<span class="mono s12 nowrap">{x.text}</span>
												{#if x.sub}<span class="mono micro fg3 nowrap">{x.sub}</span>{/if}
											</button>
										{:else}
											<div class="wcell" style:color={x.color} data-tip-card={x.tip}><span class="mono s12 nowrap">{x.text}</span></div>
										{/if}
									</td>
								{/each}
								{#if !apiView.ready}{#each { length: 8 } as _, k (k)}<td class="skel-cell" aria-hidden="true"><span class="skel" style:width="{26 + ((k * 7) % 16)}px"></span></td>{/each}{/if}
							</tr>
       {#if expandedCorpora[r.f.id]}<FeatureCorpora family={r.f.id} ids={engines.map(e=>e.id)} mode="support" />{/if}
						{/each}
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
 <StatusLegend note="n/n = passed / total contracts" />
	<div class="note">
		Representative corpus tests with independent oracles, not full specification conformance. Adapter-unsupported results do not establish that an engine lacks a feature. Browser builds and plugin performance are unmeasured. <a href={'/api/v1/features'}>Full evidence</a>.
		<details><summary>Measurement scope</summary><p>The latest measured release is shown for each engine, with the pinned main commit in the tooltip and beneath the count when it differs. Compilation and execution contracts use their declared oracles. Wago provides optional WASI and Component Model plugins; their cells show official suite cases passed / total, including failed and skipped cases. Feature workloads never enter application averages.</p></details>
	</div>
{:else}
	<div class="s12 fg3">{PERF_NOTE[ui.perfMetric]}</div>
	<div class="tbl-wrap scroll">
		<table class="mx wl-table perf">
			<thead>
				<tr>
					<th class="stick th-label perf-h">Proposal / extension · corpus</th>
					{#each cols as c (c.id)}
						<th class="colh">
							<button class="sort" onclick={() => ui.openProfile(c.rt, c.id)} data-tip={`Open the ${c.rt} profile`}>
								<span class="rtn"><Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} />{c.rt}</span>
								<span class="mono micro fg3 ver">{c.be}</span>
							</button>
						</th>
					{/each}
					{#if !apiView.ready}{#each { length: 8 } as _, k (k)}<th class="colh" aria-hidden="true"><span class="skel" style:width="{46 + ((k * 13) % 22)}px"></span></th>{/each}{/if}
				</tr>
			</thead>
			<tbody>
				{#each perfSecs as sec (sec.sec)}
					{@const open = !ui.collapsed['perf:' + sec.sec]}
					<tr class="sec">
						<td class="stick grp">
							<button class="grp-btn" aria-expanded={open} onclick={() => (ui.collapsed = { ...ui.collapsed, ['perf:' + sec.sec]: open })}>
								<span class="mono caret">{open ? '▾' : '▸'}</span><span class="w6">{sec.sec}</span><span class="small fg3">{sec.rows.length} features</span>
							</button>
						</td>
						{#each cols as c (c.id)}<td class="gcell"></td>{/each}
						{#if !apiView.ready}{#each { length: 8 } as _, k (k)}<td class="gcell"></td>{/each}{/if}
					</tr>
					{#each open ? sec.rows : [] as r (r.f.id)}
						<tr>
							<td class="stick item">
								<div class="item-line">
          {#if corpusCount(r.f.id)>1}<button class="corpus-toggle mono" aria-label={`${expandedCorpora[r.f.id]?'Hide':'Show'} corpora for ${r.f.name}`} aria-expanded={!!expandedCorpora[r.f.id]} onclick={()=>expandedCorpora[r.f.id]=!expandedCorpora[r.f.id]}>{expandedCorpora[r.f.id]?'▾':'▸'}</button>{/if}
									{#if r.f.page}<a class="name" href={siteHref(`/${r.f.page}`)}>{r.f.name}</a>{:else}<span class="name">{r.f.name}</span>{/if}
									<span class="mono micro fg3">{corpusCount(r.f.id)>1?`${corpusCount(r.f.id)} corpora · `:''}{r.corpus}</span>
								</div>
							</td>
							{#each r.cells as x, k (k)}
								<td class="p0" class:cohort-excluded={r.excluded} style:background={x.bg}>
         {#if r.excluded}<CohortStrike />{/if}
									<button
										class="cellbtn wcell"
										style:color={x.color}
										onclick={() => (ui.drawer = { type: 'feature', fam: r.f.id, c: cols[k].id, m: perfMetricKey, peers: cols.map((c) => c.id) })}
										data-tip-card={tipCard({ kicker: 'Feature performance', title: r.f.name, who: tipWho(cols[k]), value: x.text, valueColor: x.color === 'var(--fg)' ? '' : x.color, sub: x.sub, heat: x.bg === 'transparent' ? '' : x.bg, note: 'note' in x && x.note ? `${x.note} ${r.corpus}.` : r.corpus, stats: x.stats, action: 'contracts, spread & run record' })}
									>
										<span class="mono s12 nowrap" style:font-weight={x.fw}>{x.text}</span>
										<span class="micro fg3 nowrap">{x.sub}</span>
									</button>
								</td>
							{/each}
							{#if !apiView.ready}{#each { length: 8 } as _, k (k)}<td class="skel-cell" aria-hidden="true"><span class="skel" style:width="{34 + ((k * 7) % 16)}px"></span></td>{/each}{/if}
						</tr>
      {#if expandedCorpora[r.f.id]}<FeatureCorpora family={r.f.id} ids={cols.map(c=>c.id)} mode="perf" metric={perfMetricKey} />{/if}
					{/each}
				{/each}
			</tbody>
		</table>
	</div>
 <StatusLegend note="~ = average · bold = lowest in row" />
	<div class="note">
		Bold = lowest in row · heat = distance from the row's lowest measured value. Averages use {ui.average==='mean'?'arithmetic mean':'geometric mean'} over {ui.cohortMode==='shared'?'contracts passed on all shown engines':'contracts passed per engine'}. {#if ui.cohortMode==='shared'}Dimmed, crossed-out cells are excluded from comparison.{/if}
	</div>
{/if}


<style>
 .cohort-excluded .cellbtn{opacity:.4;}
 .cohort-excluded{position:relative;}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 16px;
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
	.plink {
		font-size: 12px;
		text-decoration: underline;
	}
	/* Table styles mirror the Benchmarks workload table. */
	.phase-note {
		font-size: 12px;
		color: var(--fg2);
		border-left: 2px solid var(--line2);
		padding-left: 10px;
	}
	.w6 {
		font-weight: 600;
	}
	.colh {
		padding: 4px 10px;
		text-align: right;
	}
	.sort {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 1px;
		margin-left: auto;
	}
	.rtn {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
	}
	.ver {
		max-width: 110px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	td.stick.grp {
		background: var(--bg3);
		padding: 4px 12px;
	}
	.grp-btn {
		display: flex;
		gap: 8px;
		align-items: baseline;
		text-align: left;
	}
 .corpus-toggle {font-size:12px;width:14px;flex-shrink:0;color:var(--fg2);}
	.caret {
		width: 10px;
	}
	.gcell {
		padding: 4px 10px;
		background: var(--bg3);
	}
	.item {
		padding: 3px 12px;
	}
	.item-line {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.name {
		font-size: 12px;
		color: var(--fg);
		text-decoration: none;
	}
	a.name:hover {
		text-decoration: underline;
	}
	.wcell {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		justify-content: center;
		padding: 3px 10px;
		min-height: 28px;
		box-sizing: border-box;
		text-decoration: none;
	}
	.ext-mark {
		margin-left: 3px;
		font-size: 10px;
		color: var(--fg3);
		text-decoration: none;
		display: inline-block;
	}
	.scroll {
		max-height: 68vh;
	}
	.wl-table {
		min-width: 980px;
	}
	.feat-h {
		min-width: 250px;
	}
	.perf-h {
		min-width: 250px;
	}
	@media (max-width: 720px) {
		.wl-table {
			min-width: 760px;
		}
		/* Phones: no box-within-the-page vertical scroll; the table scrolls sideways only. */
		.item,
		td.stick.grp {
			padding: 5px 10px;
		}
		.colh {
			padding: 6px 8px;
		}
		.wcell {
			padding: 3px 8px;
			min-height: 30px;
		}
		.grp-btn {display:grid;grid-template-columns:10px minmax(0,1fr);column-gap:6px;text-align:left;}
		.gcell {padding:4px 8px;}
		.item {padding-top:3px;padding-bottom:3px;line-height:1.3;}
		.grp-btn > :last-child {
			display: none;
		}
	}

	.skel-cell {
		padding: 5px 10px;
		text-align: center;
	}
</style>
