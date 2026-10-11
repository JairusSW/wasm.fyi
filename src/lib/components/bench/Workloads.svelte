<script lang="ts">
	import {leastCoveredReference} from '$lib/comparison-policy';
	import {viewData} from '$lib/view-data';
	import {TableWindow} from '$lib/table-window.svelte';
	import {apiView,loadPage,trackId} from '$lib/api/controller.svelte';
 import {datasetView} from '$lib/api/view.svelte';
 import {metricSelectors} from '$lib/api/presentation';
 import {workloadBench} from '$lib/api/catalog';
 import { rankStats, tipCard, tipWho } from '$lib/tip';
	import { siteHref } from '$lib/links';
	import { goto } from '$lib/navigation';
	import { CFG } from '$lib/data/runtimes';
	import { BENCH, MET, PHASE_NOTE } from '$lib/data/snapshot';
	import { ST } from '$lib/data/status';
	import type { Bench, Cfg, MetricKey } from '$lib/data/types';
	import { fmtU, fmtUGroup, n0, workloadName } from '$lib/format';
	import { heatField } from '$lib/heat';
	import { benchHref } from '$lib/links';
	import { benchVal, compileExcluded, isVisible } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import Seg from '../Seg.svelte';
	import Swatch from '../Swatch.svelte';

	const cols = $derived(CFG.filter((c) => isVisible(ui.scope, c) && !compileExcluded(ui.scope, c, ui.metric)));
	function more(){
		if(apiView.pageLoading||!apiView.page?.nextCursor)return;
		void loadPage({machine:ui.machine,snapshot:ui.snap,metric:ui.metric,hide:{...ui.scope.hide},baseline:ui.baseline,weighting:ui.weighting,search:ui.q,tag:ui.tag,sortBy:ui.sortBy},apiView.pageIndex+1,true);
	}
	function watchMore(node:HTMLElement,_cursor:string|undefined){
		const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!apiView.pageError)more()},{rootMargin:'300px'});
		observer.observe(node);
		return {update(){observer.unobserve(node);observer.observe(node)},destroy(){observer.disconnect()}};
	}

	const cellFor = (b: Bench, c: Cfg, cf: number, caseLabel?: string, formatted?:string, bg='transparent', stats: [string, string][] = []) => {
		const s = ui.scope;
		const m = ui.metric;
		const u = MET[m].u;
		const r = benchVal(s, b, c.id, m, cf);
		const open = () => {ui.drawer = { type: 'cell', b: b.id, c: c.id, m, cf, caseLabel };};
		if (r.st !== 'ok') {
			const t = ST[r.st];
			// Cells show just the status symbol; the tooltip spells it out.
			return { text: m==='code'&&r.st==='unsupported'?'n/a':t[0], label: m==='code'&&r.st==='unsupported'?'':t[1], sub: '', bg: 'transparent', color: t[2], open, stats };
		}
		return {
			text: formatted || fmtU(r.v, u),
			sub: '',
			bg,
			color: 'var(--fg)',
			open,
			stats
		};
	};
	const cellsFor = (b:Bench,cf=1,caseLabel?:string) => {
		const s=ui.scope,m=ui.metric,u=MET[m].u;
		const values=cols.map(c=>{
			const r=benchVal(s,b,c.id,m,cf);return r.st==='ok'?r.v:null;
		});
		const formatted=fmtUGroup(values,u);
		// Place within the row and the row's best, for the tooltip.
		const names=cols.map(c=>`${c.rt} ${c.be}`);
		const best=['rss','rssCompile','rssInst','code'].includes(m)?'smallest':'fastest';
		return cols.map((c,i)=>cellFor(b,c,cf,caseLabel,formatted[i],heatField(values,i),rankStats(values,i,names,v=>fmtU(v,u),best)));
	};

	type Row =
		| { kind: 'group'; name: string; count: string; open: boolean; cells: () => {text:string;count:number}[] }
		| {
				kind: 'item';
				b: Bench;
				name: string;
				indent: string;
				cases: number;
				expanded: boolean;
				tags: string[];
				cells: () => ReturnType<typeof cellFor>[];
		  };

	const view = $derived.by(() => {
		const s = ui.scope;
		const m = ui.metric;
        if(datasetView.revision){
            const rows:Row[]=[];let previousGroup='';
            for(const row of apiView.page?.items||[]){
                const b=workloadBench(row.workload);b.group=row.group;
                if(row.group!==previousGroup){
                    previousGroup=row.group;const summary=apiView.page?.groups?.find(g=>g.name===row.group);
                    const values=cols.map(c=>summary?.cells.find(x=>x.track===trackId(c.id)));
                    const formatted=fmtUGroup(values.map(x=>x?.value==null?null:x.value/metricSelectors[m].factor),MET[m].u);
                    rows.push({kind:'group',name:row.group,count:`${summary?.total||0} matching workloads`,open:!ui.collapsed[row.group],cells:()=>values.map((x,i)=>({text:formatted[i]||'—',count:x?.count||0}))});
                }
                if(ui.collapsed[row.group])continue;
                rows.push({kind:'item',b,name:workloadName(b.id),indent:'12px',cases:0,expanded:false,tags:b.tags,cells:()=>cellsFor(b)});
            }
            return {rows,shown:apiView.page?.total||0};
        }
		const reference=ui.cohortMode==='shared'?new Set(leastCoveredReference(BENCH.flatMap(g=>g.items.map(b=>({...b,group:g.g}))),viewData.applicationConfigurations.filter(id=>cols.some(c=>c.id===id)).sort((a,b)=>(viewData.configurations[a]||a).localeCompare(viewData.configurations[b]||b)),(b,id)=>benchVal(s,b,id,'steady').st==='ok',id=>viewData.configurations[id]||id).map(b=>b.id)):null;
  const q = ui.q.trim().toLowerCase();
		const match = (b: Bench) =>
			(!q || b.id.toLowerCase().includes(q) || b.tags.some((t) => t.includes(q))) && (!ui.tag || b.tags.includes(ui.tag));
		const rows: Row[] = [];
		let shown = 0;
		for (const g of BENCH) {
			const items: Bench[] = g.items.filter((b) => match({ ...b, group: g.g })).map((b) => ({ ...b, group: g.g }));
			if (!items.length) continue;
			shown += items.length;
			const collapsed = !!ui.collapsed[g.g];
   const groupCells=()=>{
    const eligible=ui.cohortMode==='shared'?items.filter(b=>reference?.has(b.id)):items;
    const averages=cols.map(c=>{
     const values=eligible.map(b=>benchVal(s,b,c.id,m)).flatMap(r=>r.st==='ok'?[r.v]:[]);
     return {value:values.length&&(ui.cohortMode!=='shared'||values.length===eligible.length)?values.reduce((a,b)=>a+b,0)/values.length:null,count:values.length};
    });
    const formatted=fmtUGroup(averages.map(a=>a.value),MET[m].u);
    return averages.map((a,i)=>({text:formatted[i]||'—',count:a.count}));
   };
   rows.push({kind:'group',name:g.g,count:`${items.length} shown · ${n0(g.total)} in corpus`,open:!collapsed,cells:groupCells});
			if (collapsed) continue;
			let list = items;
			if (ui.sortBy) {
				const { id, dir } = ui.sortBy;
				const sv = (b: Bench) => {
					const r = benchVal(s, b, id, m);
					return r.st === 'ok' ? r.v : Infinity;
				};
				list = [...items].sort((x, y) => (sv(x) - sv(y)) * dir || 0);
			}
			for (const b of list) {
				const expanded = !!ui.expanded[b.id];
				rows.push({
					kind: 'item',
					b,
					name: workloadName(b.id),
					indent: '12px',
					cases: b.cases?.length ?? 0,
					expanded,
					tags: b.tags,
					cells: () => cellsFor(b,1)
				});
				if (expanded && b.cases)
					for (const [lab, f] of b.cases)
						rows.push({
							kind: 'item',
							b,
							name: '↳ ' + lab,
							indent: '32px',
							cases: 0,
							expanded: false,
							tags: [],
							cells: () => cellsFor(b,f,lab)
						});
			}
		}
		return { rows, shown };
	});

	const sortClick = (c: Cfg) => {
		const sb = ui.sortBy;
		ui.sortBy = sb && sb.id === c.id ? (sb.dir > 0 ? { id: c.id, dir: -1 } : null) : { id: c.id, dir: 1 };
	};
	const tagClick = (t: string) => {
		if (t === 'simd') goto('/simd');
		else ui.tag = ui.tag === t ? null : t;
	};
	const legend = Object.values(ST);
 const windowed=new TableWindow();
 const rowKey=(row:Row)=>row.kind==='group'?`group:${row.name}`:`item:${row.b.id}:${row.name}`;
 $effect(()=>windowed.setRows(view.rows.map(rowKey)));
 const visibleRows=$derived(view.rows.slice(windowed.range.start,windowed.range.end));
	// Before the dataset (or the first workload page) arrives, show placeholder rows.
	const skeleton = $derived(!apiView.ready || (!view.rows.length && apiView.pageLoading));
</script>

<div class="head" id="workloads">
	<h2>All workloads</h2>
	<span class="s12 fg3">{MET[ui.metric].l} · {#if skeleton}<span class="skel" style:width="2em"></span>{:else}{view.shown}{/if} workloads · group averages · click a cell for details</span>
</div>
<div class="row">
	<Seg
		options={Object.entries(MET).map(([k, v]) => [k as MetricKey, v.short])}
		value={ui.metric}
		onselect={(m) => (ui.metric = m)}
		size="md"
		label="Metric"
	/>
	{#if ui.tag}
		<button class="chip" onclick={() => (ui.tag = null)} data-tip="Clear tag filter">#{ui.tag} ✕</button>
	{/if}
	{#if ui.q}
		<button class="chip" onclick={() => (ui.q = '')} data-tip="Clear search">“{ui.q}” ✕</button>
	{/if}
</div>
<div class="phase-note">{PHASE_NOTE[ui.metric]}</div>
<div class="tbl-wrap scroll" use:windowed.observe>
	<table class="mx wl-table" aria-rowcount={view.rows.length+1}>
		<thead>
			<tr>
				<th class="stick th-label wl">Workload</th>
				{#each cols as c (c.id)}
					{@const mark = ui.sortBy?.id === c.id ? (ui.sortBy.dir > 0 ? '↑' : '↓') : ''}
					<th class="colh">
						<button class="sort" onclick={() => sortClick(c)} aria-label="Sort by {c.rt} {c.be}">
							<span class="rtn"><Swatch color={c.col} bg={c.hollow ? 'transparent' : c.col} />{c.rt}<span class="small fg3">{mark}</span></span>
							<span class="mono micro fg3">{c.be}</span>
						</button>
					</th>
				{/each}
				{#if !cols.length && skeleton}
					{#each { length: 8 } as _, k (k)}<th class="colh" aria-hidden="true"><span class="skel" style:width="{48 + ((k * 13) % 24)}px"></span></th>{/each}
				{/if}
			</tr>
		</thead>
		<tbody aria-busy={skeleton}>
			{#if skeleton}
				{#each { length: 12 } as _, ri (ri)}
					<tr aria-hidden="true">
						<td class="stick wl"><span class="skel" style:width="{110 + ((ri * 37) % 90)}px"></span></td>
						{#each { length: cols.length || 8 } as _, k (k)}<td class="r skel-cell"><span class="skel" style:width="{34 + ((ri * 7 + k * 11) % 26)}px"></span></td>{/each}
					</tr>
				{/each}
			{/if}
			{#if windowed.range.top>0}<tr class="spacer" aria-hidden="true"><td colspan={cols.length+1} style:height="{windowed.range.top}px"></td></tr>{/if}
   {#each visibleRows as r, ri (rowKey(r))}
				{#if r.kind === 'group'}
     {@const cells=r.cells()}
					<tr class="sec" use:windowed.measure={rowKey(r)} aria-rowindex={windowed.range.start+ri+2}>
						<td class="stick grp">
							<button
								class="grp-btn"
								aria-expanded={r.open}
								onclick={() => (ui.collapsed = { ...ui.collapsed, [r.name]: r.open })}
							>
								<span class="mono caret">{r.open ? '▾' : '▸'}</span><span class="w6">{r.name}</span><span class="small fg3">{r.count}</span>
							</button>
						</td>
						{#each cells as cell, k (k)}
							<td class="mono small fg2 r gcell" data-tip-card={tipCard({ kicker: `${MET[ui.metric].l} · group mean`, title: r.name, who: tipWho(cols[k]), value: cell.text, stats: [['workloads', String(cell.count)], ['weighting', 'equal']], note: 'Arithmetic mean of successful measurements.' })}>{cell.text}</td>
						{/each}
					</tr>
				{:else}
     {@const cells=r.cells()}
					<tr use:windowed.measure={rowKey(r)} aria-rowindex={windowed.range.start+ri+2}>
						<td class="stick item" style:padding-left={r.indent}>
							<div class="item-line">
								{#if r.cases}
									<button
										class="cases mono"
										aria-label="Show parameterized cases"
										onclick={() => (ui.expanded = { ...ui.expanded, [r.b.id]: !r.expanded })}>{r.expanded ? '− ' : '+ '}{r.cases}</button
									>
								{/if}
								<a class="mono name" href={siteHref(benchHref(r.b.id))}>{#each r.name.split('/') as part, pi (pi)}{#if pi}/<wbr />{/if}{part}{/each}</a>
								{#each r.tags as t (t)}
									<button class="tag" onclick={() => tagClick(t)} data-tip={t === 'simd' ? 'Open the SIMD page' : `Filter benchmarks to #${t}`}>#{t}</button>
								{/each}
							</div>
						</td>
						{#each cells as x, k (k)}
							<td class="p0" style:background={x.bg}>
								<button
									class="cellbtn wcell"
									style:color={x.color}
									onclick={x.open}
									data-tip-card={tipCard({ kicker: MET[ui.metric].l, title: r.name, who: tipWho(cols[k]), value: 'label' in x && x.label ? `${x.text} ${x.label}` : x.text, valueColor: x.color === 'var(--fg)' ? '' : x.color, sub: x.sub, heat: x.bg === 'transparent' ? '' : x.bg, stats: x.stats, action: 'distribution & run record' })}
								>
									<span class="mono s12 nowrap">{x.text}</span>
									<span class="mono micro fg3 nowrap">{x.sub}</span>
								</button>
							</td>
						{/each}
					</tr>
				{/if}
			{/each}
   {#if windowed.range.bottom>0}<tr class="spacer" aria-hidden="true"><td colspan={cols.length+1} style:height="{windowed.range.bottom}px"></td></tr>{/if}
		</tbody>
	</table>
</div>
{#if datasetView.revision}
 <div class="row" aria-label="Workload loading" use:watchMore={apiView.page?.nextCursor}>
  <span class="small fg3">{apiView.page?.items.length||0} / {apiView.page?.total||0} workloads loaded</span>
  {#if apiView.page?.nextCursor}<button class="btn-small" disabled={apiView.pageLoading} onclick={more}>{apiView.pageLoading?'Loading…':'Load more workloads'}</button>{/if}
 </div>
{/if}
<div class="legend small">
	{#each legend as [g, l, c] (l)}<span style:color={c}>{g} {l}</span>{/each}
</div>

<style>
 .spacer td{padding:0;border:0;}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 16px;
		scroll-margin-top: 12px;
	}
	h2 {
		font-size: 14px;
		font-weight: 600;
		border-top: 1px solid var(--line);
		padding-top: 16px;
	}
	.s12 {
		font-size: 12px;
	}
	.w6 {
		font-weight: 600;
	}
	.chip {
		border: 1px solid var(--line2);
		background: var(--bg3);
		padding: 2px 8px;
		font-size: 12px;
	}
	.phase-note {
		font-size: 12px;
		color: var(--fg2);
		border-left: 2px solid var(--line2);
		padding-left: 10px;
	}
	.scroll {
		max-height: 68vh;
	}
	.wl-table {
		min-width: 980px;
	}
	.wl {
		min-width: 250px;
	}
	@media (max-width: 720px) {
		.wl-table {
			min-width: 760px;
		}
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
	td.stick.grp {
		background: var(--bg3);
		padding: 4px 12px;
	}
	.grp-btn {
		display: flex;
		gap: 8px;
		align-items: baseline;
	}
	.caret {
		width: 10px;
	}
	.gcell {
		padding: 4px 10px;
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
	.cases {
		border: 1px solid var(--line2);
		padding: 0 4px;
		font-size: 10px;
		color: var(--fg2);
	}
	.name {
		font-size: 12px;
		text-decoration: none;
	}
	.name:hover {
		text-decoration: underline;
	}
	.tag {
		font-size: 10px;
		color: var(--fg3);
	}
	.tag:hover {
		color: var(--fg);
	}
	.p0 {
		padding: 0;
	}
	.wcell {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		justify-content: center;
		padding: 3px 10px;
		min-height: 28px;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
	}
	@media (max-width: 720px) {
		/* Phones: no box-within-the-page vertical scroll; the table scrolls sideways only. */
		.scroll {
			max-height: none;
		}
		.colh {
			padding: 6px 8px;
		}
		.wcell {
			padding: 3px 8px;
			min-height: 30px;
		}
		.gcell {
			padding: 4px 8px;
		}
		td.stick.grp {
			padding: 5px 10px;
		}
		.grp-btn {
			display: grid;
			grid-template-columns: 10px minmax(0, 1fr);
			column-gap: 6px;
			text-align: left;
		}
		.grp-btn > :last-child {
			display: none;
		}
		.item {
			padding-top: 3px;
			padding-bottom: 3px;
			line-height: 1.3;
		}
		.item-line {
			gap: 2px 6px;
		}
		.tag {
			display: none;
		}
		.name {
			overflow-wrap: break-word;
			word-break: normal;
			min-width: 0;
		}
		.cases {
			padding: 2px 6px;
		}
	}
	.skel-cell {
		padding: 6px 10px;
	}
</style>
