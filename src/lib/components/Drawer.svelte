<script lang="ts">
 import ReportFiles from './ReportFiles.svelte';
 import {sourceNumber} from '$lib/api/presentation';
 import {currentClient,loadCellSamples} from '$lib/api/controller.svelte';
 import type {WireRecord,ResultData} from '$lib/api/types';
 import {sampleDistribution} from '$lib/sample-distribution';
 import {shortVersion} from '$lib/version-identity';
 import VersionLink from './VersionLink.svelte';
 import { configVersion } from '$lib/data/runtimes';
	import { siteHref } from '$lib/links';
	import { COMPAT, CORPUS_FEATS, FEATURE_ROWS, FLAGS, FT } from '$lib/data/features';
	import { runtimeFeatureTrack } from '$lib/support';
	import { CB, CFG, MACH, runtimeRegistry, langOf } from '$lib/data/runtimes';
	import { heatCount } from '$lib/heat';
	import { familyCohort } from '$lib/feature-values';
	import {featureAverage} from '$lib/feature-values';
	import { aggregateCohort } from '$lib/aggregates';
	import { ALLB, MET, OV, PHASE_NOTE } from '$lib/data/snapshot';
	import type { Cfg, CfgId, MetricKey } from '$lib/data/types';
	import { ST, ST_DESC } from '$lib/data/status';
	import { fmtU, relative, n0, workloadName } from '$lib/format';
	import { benchHref, href } from '$lib/links';
	import { configIdentity } from '$lib/data/runtimes';
	import { totalWorkloads, benchVal, isVisible, compileExcluded, absOf, cfgIndex, compatCell, cov, featureContracts, featureOutcome, kidCells, ratio, type PerfGroup } from '$lib/model';
	import { ui } from '$lib/state.svelte';
	import Swatch from './Swatch.svelte';
	import { viewCell, viewData, viewReason } from '$lib/view-data';
	import { fade, fly } from 'svelte/transition';
	import { cubicIn, quintOut } from 'svelte/easing';

	// Slide the whole panel in from the right edge; leave a little faster than it arrives.
	// Content swaps inside an open panel only crossfade. Reduced-motion users get no animation.
	const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const panelIn = { x: '100%', opacity: 0.6, duration: still ? 0 : 320, easing: quintOut };
	const panelOut = { x: '100%', opacity: 0.6, duration: still ? 0 : 220, easing: cubicIn };
	const scrimIn = { duration: still ? 0 : 240 };
	const scrimOut = { duration: still ? 0 : 200 };
	const swapIn = { duration: still ? 0 : 160 };

	const d = $derived(ui.drawer);
 $effect(()=>{
  const selected=ui.drawer;if(selected?.type!=='cell')return;
  const abort=new AbortController();
  void loadCellSamples(ui.machine,ui.snap,selected.b,selected.c,selected.m,abort.signal).catch(error=>{if(!abort.signal.aborted)detailError=String(error)});
  return ()=>abort.abort();
 });
	let copied = $state(false);
	const close = () => {
		ui.drawer = null;
		copied = false;
	};


 let detail=$state<{result:WireRecord;report:WireRecord;configuration:WireRecord;environment:WireRecord;workload:WireRecord}|null>(null);
 let detailError=$state('');let detailLoading=$state(false);let evidence=$state('');let chunk=$state('');let evidenceLoading=$state(false);
 $effect(()=>{
  const selected=ui.drawer;if(selected?.type!=='cell'){detail=null;return}
  const source=viewCell(ui.machine,ui.snap,selected.b,selected.c,selected.m);const client=currentClient();
  detail=null;detailError='';evidence='';chunk='';if(!client||!source.result)return;
  const abort=new AbortController();detailLoading=true;
  void (async()=>{
   const result=(await client.descriptor('results',source.result!,abort.signal)).record;
   const data=result.data as ResultData;
   const report=(await client.descriptor('reports',data.reportId,abort.signal)).record;
   const configuration=(await client.descriptor('configurations',data.configurationId,abort.signal)).record;
   const environment=(await client.descriptor('environments',data.environmentId,abort.signal)).record;
   const workload=(await client.descriptor('workloads',data.contractId,abort.signal)).record;
   abort.signal.throwIfAborted();detail={result,report,configuration,environment,workload};
  })().catch(error=>{if(!abort.signal.aborted)detailError=String(error)}).finally(()=>{if(!abort.signal.aborted)detailLoading=false});
  return ()=>abort.abort();
 });
 async function loadEvidence(){
  const client=currentClient();if(!client||!detail||!chunk)return;evidenceLoading=true;detailError='';
  try{const data=await client.evidence('results',detail.result.id,chunk);evidence=JSON.stringify(data,null,2);
   const diagnostic=data as {kind?:string;data?:{launch_medians?:Record<string,unknown>}};
   if(diagnostic.kind==='summary-diagnostics'&&diagnostic.data?.launch_medians){const values=Object.entries(diagnostic.data.launch_medians).sort(([a],[b])=>Number(a)-Number(b)).map(([,v])=>sourceNumber(v)!.value/1e6);const selected=ui.drawer;if(selected?.type==='cell')viewCell(ui.machine,ui.snap,selected.b,selected.c,selected.m).launchMedians=values}}catch(error){detailError=String(error)}finally{evidenceLoading=false}
 }

	type RecordRow = { k: string; v: string; tip?: string; fine?: boolean; href?: string | null; ext?: boolean; action?: () => void; copy?: string };
	type RecordGroup = { title: string; rows: RecordRow[] };
	const REPO = 'https://github.com/JairusSW/wasm.fyi';
	// Corpus workloads live in the repository as corpora/<corpus>/{artifacts,sources}/….
	function corpusHref(id: string, file: string) {
		const corpus = id.split('/')[0];
		return ['applications', 'features'].includes(corpus) && id.includes('/') ? `${REPO}/blob/main/corpora/${corpus}/${file}` : null;
	}
	function fmtSpread(cv: number) {
		const pct = cv * 100;
		return pct < 0.1 ? '<0.1%' : `±${pct.toFixed(pct < 10 ? 1 : 0)}%`;
	}
	let copiedKey = $state('');
	async function copyValue(key: string, value: string) {
		try {
			await navigator.clipboard.writeText(value);
			copiedKey = key;
			setTimeout(() => copiedKey === key && (copiedKey = ''), 1400);
		} catch {}
	}
	// Human-readable run timestamp; the raw ISO value stays available as a tooltip.
	function fmtDate(iso: string) {
		const t = new Date(iso);
		if (Number.isNaN(t.getTime())) return iso;
		return t.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC';
	}
	// Resource policy as "8 cores · 30.5 GiB" instead of raw JSON.
	function fmtPolicy(policy: unknown) {
		if (!policy || typeof policy !== 'object') return 'not recorded';
		const parts = Object.entries(policy as Record<string, unknown>).map(([k, v]) => k === 'cores' ? `${v} cores` : k === 'memory' ? `${v} memory` : `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`);
		return parts.join(' · ') || 'not recorded';
	}

	// Two-sided 95% Student-t critical values by degrees of freedom (1–30); normal beyond.
	const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
	function meanInterval(values: number[]): [number, number] | null {
		const dist = sampleDistribution(values);
		if (!dist || dist.stdDev == null) return null;
		const half = (T95[dist.count - 2] ?? 1.96) * (dist.stdDev / Math.sqrt(dist.count));
		return [dist.mean - half, dist.mean + half];
	}
	const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
	type Confidence = { level: 'High' | 'Medium' | 'Low'; color: string; why: string };
	// Confidence from the relative width of the 95% interval, demoted for few samples or repeated outliers.
	function confidence(interval: [number, number] | null, center: number, count: number, outliers: number): Confidence {
		if (!interval || count < 3) return { level: 'Low', color: 'var(--st-warn)', why: `Only ${count} sample${count === 1 ? '' : 's'}; no reliable interval.` };
		const rel = (interval[1] - interval[0]) / 2 / center;
		let rank = rel < 0.01 ? 2 : rel < 0.05 ? 1 : 0;
		const reasons = [`95% interval ±${fmtSpread(rel).replace('±', '')}`, `n = ${count}`];
		if (count < 5) { rank = Math.min(rank, 1); reasons.push('few samples'); }
		if (outliers >= 2) { rank = Math.max(0, rank - 1); reasons.push(`${outliers} outliers`); }
		else if (outliers) reasons.push('1 outlier');
		const level = (['Low', 'Medium', 'High'] as const)[rank];
		return { level, color: ['var(--st-warn)', 'var(--fg2)', 'var(--st-pass)'][rank], why: reasons.join(' · ') };
	}

	type StripPoint = { c: Pick<Cfg, 'rt' | 'be' | 'col' | 'hollow'>; score: number; label: string; self: boolean; tie: boolean };
	type StripSpec = ReturnType<typeof rankSpec>;
	/** Rank strip: every compared configuration on one line (lower score = better, left), this one ringed, ties banded. */
	function rankSpec(points: StripPoint[], log: boolean, lead: string) {
		const sorted = [...points].sort((a, b) => a.score - b.score);
		const self = points.find((p) => p.self);
		if (!self || points.length < 2) return null;
		const lo = sorted[0].score;
		const hi = sorted[sorted.length - 1].score;
		const useLog = log && lo > 0;
		const f = (x: number) => (useLog ? Math.log(x) : x);
		const X = (x: number) => (hi === lo ? 210 : 16 + ((f(x) - f(lo)) / (f(hi) - f(lo))) * 388);
		const name = (p: StripPoint) => `${p.c.rt} ${p.c.be}`;
		const tied = points.filter((p) => p.tie);
		const tieXs = [self, ...tied].map((p) => X(p.score));
		return {
			place: ordinal(1 + points.filter((p) => p.score < self.score).length),
			n: points.length,
			lead,
			best: { c: sorted[0].c, label: sorted[0].label, self: sorted[0].self || sorted[0].score === self.score },
			ties: tied.map(name),
			band: tied.length ? { x: Math.min(...tieXs) - 7, w: Math.max(...tieXs) - Math.min(...tieXs) + 14 } : null,
			// This configuration is drawn last so it sits on top.
			// Configurations at the same position stack vertically so none hides another.
			dots: (() => {
				const seen = new Map<string, number>();
				const lane = [0, -7, 7, -14, 14, -21, 21];
				return [...sorted.filter((p) => !p.self), self].map((p) => {
					const x = X(p.score).toFixed(0);
					const n = p.self ? 0 : (seen.get(x) ?? (self && X(self.score).toFixed(0) === x ? 1 : 0));
					if (!p.self) seen.set(x, n + 1);
					return { x: X(p.score).toFixed(1), y: 24 + (lane[n] ?? 0), col: p.c.col, hollow: p.c.hollow, self: p.self, name: name(p), label: p.label };
				});
			})(),
			loL: sorted[0].label,
			hiL: sorted[sorted.length - 1].label
		};
	}

	type DistSpec = ReturnType<typeof distSpec>;
	/** Box-plot geometry for the panel chart: scale symmetric around `center`, tails to the extreme values. */
	function distSpec(values: number[], center: number, fmt: (x: number) => string, fmtOffset: (x: number) => string, opts: { signs?: [string, string]; log?: boolean } = {}) {
		const [below, above] = opts.signs ?? ['−', '+'];
		// sampleDistribution ignores negatives, so log-scale values are shifted into range and back.
		const shift = opts.log ? Math.max(0, -Math.min(...values)) : 0;
		const shifted = sampleDistribution(values.map((x) => x + shift));
		const dist = shifted && { ...shifted, mean: shifted.mean - shift, min: shifted.min - shift, max: shifted.max - shift, q1: shifted.q1 - shift, q3: shifted.q3 - shift };
		if (!dist) return null;
		const sd = dist.stdDev || 0;
		const extent = Math.max(center - Math.min(dist.min, dist.mean - sd), Math.max(dist.max, dist.mean + sd) - center);
		const lo = center - extent;
		const X = (x: number) => 16 + ((x - lo) / (2 * extent || 1)) * 388;
		const boxW = Math.max(2, X(dist.q3) - X(dist.q1));
		const sdLo = X(opts.log ? dist.mean - sd : Math.max(0, dist.mean - sd));
		return {
			dots: values.map((x, i) => ({ x: X(x).toFixed(1), y: (24 + (((i * 3) % 5) - 2) * 3.5).toFixed(1), value: fmt(x) })),
			medX: X(center).toFixed(1),
			boxX: X(dist.q1).toFixed(1),
			boxW: boxW.toFixed(1),
			// A short stub keeps both tails visible when a quartile equals min or max.
			whiskerLo: Math.min(X(dist.min), X(dist.q1) - 6).toFixed(1),
			whiskerHi: Math.max(X(dist.max), X(dist.q1) + boxW + 6).toFixed(1),
			sdX: sdLo.toFixed(1),
			sdW: Math.max(1, X(dist.mean + sd) - sdLo).toFixed(1),
			// Edges are equidistant from the median, so they are labelled as offsets.
			minL: extent ? below + fmtOffset(extent) : '',
			medL: fmt(center),
			maxL: extent ? above + fmtOffset(extent) : ''
		};
	}

	// ── Result cell ────────────────────────────────────────────────────────
	const cell = $derived.by(() => {
		if (d?.type !== 'cell') return null;
		const s = ui.scope;
		// Feature contracts are opened from the feature panel and may not be in the workload groups.
		const b = ALLB.find((x) => x.id === d.b) ?? viewData.catalogue.find((x) => x.id === d.b);
		const c = CB[d.c];
		if (!b || !c) return null;
		const u = MET[d.m].u;
		const r = benchVal(s, b, c.id, d.m, d.cf);
		const t = ST[r.st];
		const measured = viewCell(s.machine,ui.snap,b.id,c.id,d.m);
		const reference=viewData.reports[measured.report];const rawReport=detail?.report.data;
  const report=reference?{...reference,runId:String(rawReport?.runId||reference.runId),created:String(rawReport?.created||reference.created),sha256:String(rawReport?.sourceReportSha256||reference.sha256)}:undefined;
  const method=(detail?.result.data as ResultData|undefined)?.measurementMethod;
		const options = (method?.recipe?.options||report?.options) as {launches?:number;samples?:number;scenario_samples?:Record<string,number>;warmup?:number} | undefined;
		const scenario = ({compile:'compile',rssCompile:'compile',inst:'instantiate',rssInst:'instantiate',first:'first-call',steady:'steady',rss:'steady',code:'compile'} satisfies Partial<Record<MetricKey,string>>)[d.m];
		const singleSamplePass = ['rss','rssCompile','rssInst','code'].includes(d.m);
		const phaseSamples = scenario ? options?.scenario_samples?.[scenario] : undefined;
		const sampleCount = singleSamplePass ? 1 : phaseSamples ?? options?.scenario_samples?.['*'] ?? options?.samples ?? 'unavailable';
		const rawConfig=detail?.configuration.data;const description=rawConfig?.description as Record<string,unknown>|undefined;
  const config = rawConfig?{runtime:String(rawConfig.id),version:String(rawConfig.version||description?.runtime_version||'not recorded'),backend:String(rawConfig.backend||description?.backend||'not recorded')}:viewData.hosts[s.machine].configurations[c.id];
		const ok = r.st === 'ok';
		const v = ok ? r.v : 0;
		const allDots = ok && !['rss','rssCompile','rssInst','code'].includes(d.m) ? measured.samples || measured.launchMedians || [] : [];
		const dots=allDots.slice(measured.sampling?.retainedStart||0);
		const distribution=sampleDistribution(dots);
		const fence = distribution ? 1.5 * (distribution.q3 - distribution.q1) : 0;
		const outliers = distribution ? dots.filter((x) => x < distribution.q1 - fence || x > distribution.q3 + fence).length : 0;
		const interval: [number, number] | null = ok && !measured.sampling && measured.interval ? [measured.interval[0], measured.interval[1]] : measured.sampling ? null : meanInterval(dots);
		const conf = ok && distribution && !measured.sampling ? confidence(interval, distribution.mean, distribution.count, outliers) : null;
		// Rank among the configurations visible in the table; overlapping 95% intervals count as a tie.
		const peers = CFG.filter((x) => isVisible(s, x) && !compileExcluded(s, x, d.m)).flatMap((x) => {
			const res = benchVal(s, b, x.id, d.m, d.cf);
			if (res.st !== 'ok') return [];
			const pc = viewCell(s.machine, ui.snap, b.id, x.id, d.m);
			return [{ c: x, v: res.v, ci: x.id === c.id ? interval : pc.sampling ? null : meanInterval(pc.samples || pc.launchMedians || []) }];
		}).sort((p, q) => p.v - q.v);
		const at = peers.findIndex((p) => p.c.id === c.id);
		const self = peers[at];
		const ties = self?.ci ? peers.filter((p) => p !== self && p.ci && p.ci[0] <= self.ci![1] && self.ci![0] <= p.ci[1]) : [];
		const best = ['rss', 'rssCompile', 'rssInst', 'code'].includes(d.m) ? 'smallest' : 'fastest';
		const artifactSha = String(detail?.workload.data.sha256 || b.artifactSha256);
		// Builder-absolute paths (…/sources/x.wat) map onto the corpus's own sources/ directory.
		const sourcePath = b.src?.includes('/sources/') ? 'sources/' + b.src.split('/sources/').pop() : b.src;
        const cmd = report ? `just gather --rebuild /path/to/sealed/${report.runId}/report` : 'No sealed measurement for this cell';
		return {
			kicker: `${b.group} · ${MET[d.m].l}`,
			title: workloadName(b.id) + (d.caseLabel ? ' · ' + d.caseLabel : ''),
			b,
			c,
			ok,
			metric: MET[d.m].short,isLatency:!['rss','rssCompile','rssInst','rssFirst','code'].includes(d.m),
			st: t,
			stDesc: viewReason(measured) || ST_DESC[r.st] || '',
			abs: ok ? fmtU(v, u) : '',
			absCi: ok && interval ? `95% CI ${fmtU(interval[0], u)} – ${fmtU(interval[1], u)}` : '',
			conf,
			outliers,
			strip: ok ? rankSpec(peers.map((p) => ({ c: p.c, score: p.v, label: fmtU(p.v, u), self: p.c.id === c.id, tie: ties.includes(p) })), true, best) : null,
			chart: ok && dots.length ? distSpec(dots, v, (x) => fmtU(x, u), (x) => fmtU(x, u)) : null,
			heroLabel: d.m === 'code' ? 'Measured size' : measured.latencySummary==='retained-mean'?'Retained sample mean (zero-resolution median)':'Median',
			count: distribution?.count ?? null,
			spread: distribution?.stdDev != null && distribution.mean > 0 ? fmtSpread(distribution.stdDev / distribution.mean) : '',
			stats: ok && distribution ? [
				{ k: 'Min', v: fmtU(distribution.min, u) },
				{ k: 'Mean', v: '~' + fmtU(distribution.mean, u) },
				{ k: 'Max', v: fmtU(distribution.max, u) },
				{ k: 'Std dev', v: distribution.stdDev !== null ? fmtU(distribution.stdDev, u) : ST.na[0], tip: 'Sample standard deviation' }
			] : [],
			phaseNote: PHASE_NOTE[d.m],
			record: [
				{ title: 'Configuration', rows: [
					{ k: 'Runtime', v: config ? `${config.runtime} ${shortVersion(config.version)}` : 'not collected', href: configIdentity(s.machine, c.id).url, ext: true, tip: 'Open this runtime version’s source' },
					{ k: 'Backend', v: config?.backend || 'not collected', action: () => ui.openProfile(c.rt, c.id), tip: `Open the ${c.rt} profile` }
				] },
				{ title: 'Environment', rows: [
					{ k: 'Machine', v: detail ? [detail.environment.data.cpu_description, detail.environment.data.hostname].filter(Boolean).join(' · ') : MACH[s.machine].l, href: href('/benchmarks', { m: s.machine, metric: d.m }), tip: 'All benchmarks on this machine' },
					{ k: 'Resources', v: fmtPolicy(detail?.environment.data.policy || viewData.hosts[s.machine].policy) }
				] },
				{ title: 'Provenance', rows: [
					{ k: 'Recorded', v: report ? fmtDate(report.created) : 'not collected', tip: report?.created },
					{ k: 'Run ID', v: report ? report.runId : 'not collected', fine: true, copy: report?.runId },
					// Feature performance variants are generated at build time, so only application artifacts are committed as measured.
					{ k: 'Artifact', v: `${workloadName(b.id)}.wasm · sha256 ${shortVersion(artifactSha)}`, href: b.id.startsWith('applications/') ? corpusHref(b.id, `artifacts/${b.id.split('/').slice(1).join('/')}.wasm`) : null, ext: true, copy: artifactSha, tip: `sha256 ${artifactSha}` },
					{ k: 'Source', v: sourcePath || 'unavailable', href: sourcePath ? corpusHref(b.id, sourcePath) : null, ext: true }
				] }
			] as RecordGroup[],
			cmd
		};
	});

	async function copyCmd() {
		if (!cell) return;
		try {
			await navigator.clipboard.writeText(cell.cmd.replace(/\\\n\s*/g, ''));
		} catch {}
		copied = true;
	}

	// ── Feature performance ────────────────────────────────────────────────
	const FEATURE_NOTE = $derived({
		steady: `Steady execution · ${ui.average==='mean'?'arithmetic mean':'geometric mean'} over selected execution contracts; compile-only probes excluded. ${ui.cohortMode==='shared'?'Contracts passed on all shown engines':'Passed contracts per engine'}.`,
		compile: `Compilation · ${ui.average==='mean'?'arithmetic mean':'geometric mean'} over selected contracts. ${ui.cohortMode==='shared'?'Contracts passed on all shown engines':'Passed contracts per engine'}.`,
		rss: `Steady process peak RSS · ${ui.average==='mean'?'arithmetic mean':'geometric mean'} over selected contracts; includes the adapter process. ${ui.cohortMode==='shared'?'Contracts passed on all shown engines':'Passed contracts per engine'}.`
	});
	/** Paired comparison over the same contracts: geometric-mean ratio a/b with a 95% interval. */
	function pairedRatio(a: number[], b: number[]) {
		const logs = a.map((x, i) => Math.log(x / b[i]));
		const n = logs.length;
		if (!n) return null;
		const mean = logs.reduce((sum, x) => sum + x, 0) / n;
		if (n < 2) return { ratio: Math.exp(mean), ci: null };
		const sd = Math.sqrt(logs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1));
		const half = (T95[n - 2] ?? 1.96) * (sd / Math.sqrt(n));
		return { ratio: Math.exp(mean), ci: [Math.exp(mean - half), Math.exp(mean + half)] as [number, number] };
	}
	let showAllContracts = $state(false);
	const feature = $derived.by(() => {
		if (d?.type !== 'feature') return null;
		const s = ui.scope;
		const sec = COMPAT.find((x) => x.fams.some((f) => f.id === d.fam));
		const f = sec?.fams.find((x) => x.id === d.fam);
		const c = CB[d.c];
		if (!sec || !f || !c) return null;
		const metric = d.m;
		const unit = metric === 'rss' ? 'MiB' : 'ms';
		const contracts = featureContracts(f.id).filter((w) => metric === 'compile' || !['compile-only', 'compile-and-instantiate'].includes(w.evidenceScope || ''));
		const val = (id: string, cid: CfgId) => {
			const x = viewCell(s.machine, s.snapshot || 's1', id, cid, metric);
			return x.st === 'ok' && x.v != null && x.v > 0 ? x.v : null;
		};
		const peers = d.peers.map((id) => CB[id]).filter(Boolean);
  const comparison=familyCohort(s,f.id,peers.map(p=>p.id),metric);
  const selected=(cid:CfgId)=>comparison.cohorts[peers.findIndex(p=>p.id===cid)]||[];
  const cohort=selected(c.id);
  const participants=peers.filter((p,k)=>comparison.values[k]!=null);
  const ranked=peers.flatMap((p,k)=>comparison.values[k]!=null?[{c:p,v:comparison.values[k]!}]:[]).sort((a,b)=>a.v-b.v);
		const at = ranked.findIndex((p) => p.c.id === c.id);
		const ok = at >= 0 && cohort.length > 0;
		const config = viewData.hosts[s.machine].configurations[c.id];
		const name = (p: { c: Cfg }) => `${p.c.rt} ${p.c.be}`;
		const series = (cid: CfgId) => selected(cid).map((w) => val(w.id, cid)!);
		const failures = contracts.filter((w) => val(w.id, c.id) == null).map((w) => ({ w, st: viewCell(s.machine, s.snapshot || 's1', w.id, c.id, metric).st }));
		const base = {
			kicker: `${sec.sec} · ${MET[metric].l}`,
			title: f.name,
			f,
			c,
			note: FEATURE_NOTE[metric],
			eligible: contracts.length,
			failures: failures.length,
			record: [
				{ title: 'Configuration', rows: [
					{ k: 'Runtime', v: config ? `${config.runtime} ${shortVersion(config.version)}` : 'not collected', href: configIdentity(s.machine, c.id).url, ext: true },
					{ k: 'Backend', v: config?.backend || c.be || 'not collected', action: () => ui.openProfile(c.rt, c.id), tip: `Open the ${c.rt} profile` }
				] },
				{ title: 'Environment', rows: [
					{ k: 'Machine', v: MACH[s.machine].l, href: href('/features', { m: s.machine }), tip: 'Feature results on this machine' },
					{ k: 'Resources', v: fmtPolicy(viewData.hosts[s.machine].policy) }
				] },
				{ title: 'Corpus', rows: [
					{ k: 'Suite', v: sec.suite },
					{ k: 'Eligible', v: `${contracts.length} contracts` },
					{ k: 'Comparable', v: `${participants.length} of ${peers.length} runtimes measured · ${s.cohortMode==='shared'?'shared passes':'passed per engine'}` },
					{ k: 'Source', v: `corpora/features/…/${f.id}`, href: `${REPO}/tree/main/corpora/features`, ext: true }
				] }
			] as RecordGroup[]
		};
		if (!ok) {
   const status=ST[comparison.statuses[peers.findIndex(p=>p.id===c.id)]||'nm'];
   return {...base,ok:false as const,invalid:false,value:'',statusLabel:status[0]+' '+status[1],reason:`No successful measurements in the selected ${s.cohortMode==='shared'?'shared-pass':'per-engine'} cohort.`,failureList:failures.slice(0,12).map(x=>({name:x.w.id.split('/').slice(2).join('/'),st:ST[x.st]}))};
		}
		const self = ranked[at];
		const ref = at === 0 ? ranked[1] : ranked[0];
		const paired = s.cohortMode!=='per-engine' && s.average !== 'mean' && ref ? pairedRatio(series(c.id), series(ref.c.id)) : null;
		// A paired interval over one or two contracts says nothing, so ties and the CI need three.
		const ties = s.cohortMode==='per-engine' || s.average === 'mean' || cohort.length < 3 ? [] : ranked.filter((p) => p !== self && (() => { const pr = pairedRatio(series(c.id), series(p.c.id)); return !!pr?.ci && pr.ci[0] <= 1 && pr.ci[1] >= 1; })());
		// This runtime's own measurements: one value per contract, each with its sample spread.
		const rows = cohort.map((w) => {
			const v = val(w.id, c.id)!;
			const cellv = viewCell(s.machine, s.snapshot || 's1', w.id, c.id, metric);
			const samples = cellv.samples || cellv.launchMedians || [];
			const sd = cellv.sampleStats||sampleDistribution(samples);
			return { w, name: w.id.split('/').slice(2).join('/') || w.id, v, samples, spread: sd?.stdDev != null && sd.mean > 0 ? fmtSpread(sd.stdDev / sd.mean) : '—' };
		}).sort((a, b) => b.v - a.v);
		// Three or more contracts: one dot per contract. Fewer: every raw sample of those contracts,
		// falling back to the contract values when samples were not retained (e.g. peak memory).
		const pooled = rows.flatMap((r) => r.samples);
		const perSample = rows.length < 3 && pooled.length > 0;
		const plotted = perSample ? pooled : rows.map((r) => r.v);
		const pdist = sampleDistribution(plotted);
		const fence = pdist ? 1.5 * (pdist.q3 - pdist.q1) : 0;
		const outliers = pdist ? plotted.filter((x) => x < pdist.q1 - fence || x > pdist.q3 + fence).length : 0;
		const best = metric === 'rss' ? 'smallest' : 'fastest';
		const conf = paired ? confidence(paired.ci, paired.ratio, cohort.length, outliers) : null;
		return {
			...base,
			ok: true as const,
			value: '~' + fmtU(self.v, unit),
			strip: rankSpec(ranked.map((p) => ({ c: p.c, score: p.v, label: fmtU(p.v, unit), self: p === self, tie: ties.includes(p) })), true, best),
			conf,
			outliers,
			shared: cohort.length,
			ci: paired?.ci && cohort.length >= 3 ? `95% CI vs ${name(ref!)} ${relative(paired.ci[0], ui.deltaFormat)} – ${relative(paired.ci[1], ui.deltaFormat)}` : '',
			chartUnit: perSample ? 'sample' : 'contract',
			chart: pdist ? distSpec(plotted, pdist.median, (x) => fmtU(x, unit), (x) => fmtU(x, unit)) : null,
			stats: pdist ? [
				{ k: 'Min', v: fmtU(pdist.min, unit) },
				{ k: 'Mean', v: '~' + fmtU(pdist.mean, unit) },
				{ k: 'Max', v: fmtU(pdist.max, unit) },
				{ k: 'Std dev', v: pdist.stdDev != null ? fmtU(pdist.stdDev, unit) : ST.na[0], tip: perSample ? 'Sample standard deviation' : 'Standard deviation across contracts' }
			] : [],
			rows: rows.map((r) => ({ ...r, value: fmtU(r.v, unit), rel: r.spread, open: () => (ui.drawer = { type: 'cell', b: r.w.id, c: c.id, m: metric, cf: 1, back: { drawer: d, label: f.name } }) }))
		};
	});

	// ── Feature support (compatibility cell) ───────────────────────────────
	// The chosen backend belongs to the open panel, so another cell starts from its first backend.
	let supportPick = $state<{ for: unknown; id: string } | null>(null);
	const support = $derived.by(() => {
		if (d?.type !== 'support') return null;
		const s = ui.scope;
		const f = FEATURE_ROWS.find((x) => x.id === d.fam) ?? CORPUS_FEATS.find((x) => x.id === d.fam);
		if (!f) return null;
		const cfg = CB[d.c];
		if (!cfg) return null;
		const rt = cfg.rt;
		const track = runtimeFeatureTrack(rt, f, s, d.channel, undefined, d.c);
		const other = runtimeFeatureTrack(rt, f, s, d.channel === 'stable' ? 'development' : 'stable', undefined, d.c);
		const name = rt;
		const col = cfg.col;
		const configs = track.configurations;
		const active = configs.find((c) => supportPick?.for === d && c.id === supportPick.id) ?? configs[0];
		const expected = track.expected;
		const frac = expected ? track.pass / expected : 0;
		const status= !configs.length?ST.nm:frac===1?ST.ok:active?.failed?ST.failed:active?.skipped?ST.unsupported:ST.nm;
		// Rank against the other configurations in the table on the same channel.
		const peers = d.peers.filter((id) => CB[id]).map((id) => ({ id, pass: runtimeFeatureTrack(CB[id].rt, f, s, d.channel, undefined, id) })).filter((p) => p.pass.configurations.length);
		const contracts = active
			? (viewData.featureVersions[s.machine].find((v) => v.id === active.id && v.version === active.version)?.features.find((x) => x.id === f.id)?.contracts ?? active.contracts ?? [])
			: [];
		// Tests open the per-workload panel for the configuration that ran them.
		const cid = active ? CFG.find((c) => viewData.configurations[c.id] === active.id)?.id : undefined;
		const order = { failed: 0, unsupported: 1, passed: 2 } as Record<string, number>;
		const tests = [...contracts]
			.sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1) || a.workload.localeCompare(b.workload))
			.map((t) => {
				const m: MetricKey = t.scope === 'compile-only' ? 'compile' : t.scope === 'compile-and-instantiate' ? 'inst' : 'steady';
				return {
					...t,
					name: t.workload.split('/').slice(2).join(' / ') || t.workload,
					glyph: t.status === 'passed' ? '●' : t.status === 'failed' ? '✕' : '—',
					color: t.status === 'passed' ? 'var(--st-pass)' : t.status === 'failed' ? 'var(--st-fail)' : 'var(--fg3)',
					open: cid ? () => (ui.drawer = { type: 'cell', b: t.workload, c: cid, m, cf: 1, back: { drawer: d, label: f.name } }) : null
				};
			});
		const channelLabel = d.channel === 'stable' ? 'Release' : 'Main branch';
		// Execution performance for this feature, with the same validity rule as the Performance view.
		const perf = featureContracts(f.id).length ? familyCohort(s, f.id, d.peers, 'steady') : null;
		const pk = d.peers.indexOf(d.c);
		const perfRows: RecordRow[] = [];
		if (perf && pk >= 0) {
			const n = perf.contracts.length;
			const ok = perf.values.flatMap((x, k) => (x == null ? [] : [{ x, k }])).sort((a, b) => a.x - b.x);
			const v = perf.values[pk];
			const openPerf = () => (ui.drawer = { type: 'feature', fam: f.id, c: d.c, m: 'steady', peers: d.peers });
			perfRows.push({
				k: 'Execution',
				v: v != null ? `${fmtU(v, 'ms')} · ${ordinal(1 + ok.filter((e) => e.x < v).length)} of ${ok.length}` : perf.passed[pk] > 0 ? `unavailable · ${perf.passed[pk]}/${n} passed` : ST.unavail[0],
				action: openPerf,
				tip: `Steady execution, ${s.average==='mean'?'arithmetic mean':'geometric mean'} over the selected contracts. Open the performance panel.`
			});
			if (ok.length) perfRows.push({ k: 'Fastest', v: `${CB[d.peers[ok[0].k]].rt} ${CB[d.peers[ok[0].k]].be} · ${fmtU(ok[0].x, 'ms')}` });
		}
		return {
			kicker: `${f.phase} · feature support`,
			title: f.name,
			f,
			rt,
			cid: cfg.id,
			be: cfg.be,
			hollow: cfg.hollow,
			name,
			col,
			version: shortVersion(track.version || '') || 'not collected',
			channelLabel,
			status,
			measured: configs.length > 0,
			value: configs.length ? `${track.pass} / ${expected}` : '—',
			heat: configs.length ? heatCount(1 - frac) : 'transparent',
			sub: active ? [`${active.failed} failed`, `${active.skipped} unsupported`, ...(active.missing ? [`${active.missing} uncollected`] : [])] : [],
			flagged: track.text === 'corpus passed · flag',
			strip: configs.length ? rankSpec(peers.map((p) => ({ c: CB[p.id], score: p.pass.expected - p.pass.pass, label: `${p.pass.pass}/${p.pass.expected}`, self: p.id === d.c, tie: p.id !== d.c && p.pass.pass === track.pass })), false, 'most passed') : null,
			backends: configs.map((c) => ({ id: c.id, label: c.backend, v: `${c.pass}/${c.total}`, on: c.id === active?.id })),
			activeBackend: active?.backend ?? '',
			stats: active ? [
				{ k: 'Passed', v: String(active.pass), c: 'var(--st-pass)' },
				{ k: 'Failed', v: String(active.failed), c: active.failed ? 'var(--st-fail)' : '' },
				{ k: 'Unsupported', v: String(active.skipped), c: '' },
				{ k: 'Uncollected', v: String(active.missing), c: '' }
			] : [],
			tests,
			record: [
				{ title: 'Configuration', rows: [
					{ k: 'Runtime', v: `${rt} ${shortVersion(track.version || '') || 'not collected'}`, tip: track.version },
					{ k: 'Backend', v: active?.backend || cfg.be || 'not collected', action: () => ui.openProfile(rt, cfg.id), tip: `Open the ${name} profile` },
					{ k: 'Channel', v: channelLabel },
					...(other.configurations.length ? [{ k: d.channel === 'stable' ? 'Main branch' : 'Release', v: `${other.pass}/${other.expected} · ${shortVersion(other.version || '')}`, action: () => (ui.drawer = { ...d, channel: d.channel === 'stable' ? 'development' : 'stable' }), tip: 'Open that build' }] : [])
				] },
				...(perfRows.length ? [{ title: 'Performance', rows: perfRows }] : []),
				{ title: 'Environment', rows: [
					{ k: 'Machine', v: MACH[s.machine].l, href: href('/features', { m: s.machine }), tip: 'Feature results on this machine' },
					{ k: 'Resources', v: fmtPolicy(viewData.hosts[s.machine].policy) }
				] },
				{ title: 'Provenance', rows: [
					{ k: 'Collected', v: active ? fmtDate(active.collectedAt) : 'not collected', tip: active?.collectedAt },
					...(active?.source ? [{ k: 'Build', v: 'build source', href: active.source, ext: true }] : []),
					{ k: 'Corpus', v: `${expected} tests · corpora/features`, href: `${REPO}/tree/main/corpora/features`, ext: true },
					...(f.url ? [{ k: 'Spec', v: f.url.replace(/^https?:\/\//, ''), href: f.url, ext: true }] : [])
				] }
			] as RecordGroup[]
		};
	});

	// ── Aggregate (overview table cell) ────────────────────────────────────
	// One runtime × one overview column: the geometric mean the table shows, its rank, the
	// spread of the runtime's per-workload results and the workloads that drive it.
	const AGG_METRICS: Record<'lat' | 'mem' | 'code', (MetricKey | 'rssAverage' | null)[]> = { lat: ['compile', 'inst', 'first', 'steady'], mem: ['rssCompile', 'rssInst', 'rss', 'rssAverage'], code: [null, null, null, 'code', null] };
	const AGG_UNIT = { lat: 'ms', mem: 'MiB', code: 'KiB' } as const;
	let showAllWorkloads = $state(false);
	const aggregatePanel = $derived.by(() => {
		if (d?.type !== 'aggregate') return null;
		const s = ui.scope;
		const c = CB[d.c];
		if (!c) return null;
		const { group, col } = d;
		const e2e = group === 'lat' && col === -1;
		const unit = AGG_UNIT[group];
		const label = e2e ? 'End-to-end' : OV[group].cols[group === 'code' ? col - 3 : col] ?? '';
		const metric = e2e ? null : AGG_METRICS[group][col];
		const phase = (cid: CfgId, i: number) => (compileExcluded(s, CB[cid], AGG_METRICS.lat[i]!) ? null : (absOf(s, 'lat', cid, i) ?? null));
		const summary = (cid: CfgId) => {
			if (!e2e) { const a = metric && compileExcluded(s, CB[cid], metric) ? null : absOf(s, group, cid, col); return a ? { v: a.v, interval: a.interval, count: a.count } : null; }
			const parts = [0, 1, 2, 3].map((i) => phase(cid, i));
			return parts.every(Boolean) ? { v: parts.reduce((a, p) => a + p!.v, 0), interval: undefined, count: Math.min(...parts.map((p) => p!.count)) } : null;
		};
		const self = summary(c.id);
		const best = group === 'lat' ? 'fastest' : 'smallest';
		const visible = CFG.filter((x) => isVisible(s, x));
		const peers = visible.map((x) => ({ c: x, a: summary(x.id) })).filter((p) => p.a);
		const overlap = (a?: [number, number], b?: [number, number]) => !!a && !!b && a[0] <= b[1] && b[0] <= a[1];
		const strip = self ? rankSpec(peers.map((p) => ({ c: p.c, score: p.a!.v, label: fmtU(p.a!.v, unit), self: p.c.id === c.id, tie: p.c.id !== c.id && overlap(p.a!.interval, self.interval) })), true, best) : null;
		// Per-workload values over the same cohort the aggregate uses.
		const cellOf = (w: string, cid: CfgId, m: string) => viewCell(s.machine, s.snapshot || 's1', w, cid, m);
		const perWorkload = (w: string, cid: CfgId): number | null => {
			const ok = (m: string) => { const x = cellOf(w, cid, m); return x.st === 'ok' && x.v != null && x.v > 0 ? x.v : null; };
			if (e2e) { const v = ['compile', 'inst', 'first', 'steady'].map(ok); return v.every((x) => x != null) ? (v as number[]).reduce((a, b) => a + b, 0) : null; }
			if (metric === 'rssAverage') { const v = ['rssCompile', 'rssInst', 'rss'].map(ok).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
			return metric ? ok(metric) : null;
		};
		const cohort = e2e ? aggregateCohort(s, 'lat', c.id, 3).cohort : aggregateCohort(s, group, c.id, col).cohort;
		const rows = cohort
			.map((w) => {
				const v = perWorkload(w.id, c.id);
				if (v == null) return null;
				const others = visible.map((x) => perWorkload(w.id, x.id)).filter((x): x is number => x != null);
				return { w, name: workloadName(w.id), v, place: 1 + others.filter((x) => x < v).length, of: others.length };
			})
			.filter((r): r is NonNullable<typeof r> => !!r)
			.sort((a, b) => b.v - a.v);
		const values = rows.map((r) => r.v);
		const dist = sampleDistribution(values);
		const cellMetric: MetricKey = e2e ? 'steady' : metric === 'rssAverage' ? 'rss' : (metric ?? 'steady');
		const config = viewData.hosts[s.machine].configurations[c.id];
		return {
			kicker: `${OV[group].label} · ${label}`,
			title: `${c.rt} ${c.be}`,
			c,
			label,
			value: self ? fmtU(self.v, unit) : '—',
			ci: self?.interval ? `95% CI ${fmtU(self.interval[0], unit)} – ${fmtU(self.interval[1], unit)}` : '',
			count: rows.length,
			strip,
			note: e2e ? 'Sum of the compile, instantiate, first-call and steady averages.' : `${s.average === 'mean' ? 'Mean' : 'Geometric mean'} over the workloads in the cohort, each weighted equally; ${s.cohortMode === 'shared' ? 'only workloads every shown runtime passed' : 'workloads this runtime passed'}.`,
			chart: values.length >= 3 && dist ? distSpec(values.map(Math.log), Math.log(dist.median), (x) => fmtU(Math.exp(x), unit), (x) => `${Math.exp(x) < 10 ? Math.exp(x).toFixed(1) : Math.round(Math.exp(x))}×`, { signs: ['÷', '×'], log: true }) : null,
			stats: dist ? [
				{ k: 'Min', v: fmtU(dist.min, unit) },
				{ k: 'Median', v: fmtU(dist.median, unit) },
				{ k: 'Max', v: fmtU(dist.max, unit) },
				{ k: 'Spread', v: `${(dist.max / dist.min).toFixed(dist.max / dist.min < 10 ? 1 : 0)}×`, tip: 'Slowest workload ÷ fastest workload' }
			] : [],
			rows: rows.map((r) => ({ ...r, value: fmtU(r.v, unit), rank: `${ordinal(r.place)}/${r.of}`, open: () => (ui.drawer = { type: 'cell', b: r.w.id, c: c.id, m: cellMetric, cf: 1, back: { drawer: d, label: `${c.rt} ${c.be} · ${label}` } }) })),
			cellMetric,
			breakdown: e2e ? [0, 1, 2, 3].map((i) => ({ k: OV.lat.cols[i], v: phase(c.id, i) ? fmtU(phase(c.id, i)!.v, 'ms') : '—' })) : [],
			record: [
				{ title: 'Configuration', rows: [
					{ k: 'Runtime', v: config ? `${config.runtime} ${shortVersion(config.version)}` : c.rt, href: configIdentity(s.machine, c.id).url, ext: true },
					{ k: 'Backend', v: c.be, action: () => ui.openProfile(c.rt, c.id), tip: `Open the ${c.rt} profile` }
				] },
				{ title: 'Aggregation', rows: [
					{ k: 'Workloads', v: `${rows.length} in cohort` },
					{ k: 'Cohort', v: s.cohortMode === 'shared' ? 'passed on every shown runtime' : 'passed by this runtime' },
					{ k: 'Machine', v: MACH[s.machine].l }
				] }
			] as RecordGroup[]
		};
	});

	// ── Spec test failures ─────────────────────────────────────────────────
	const compat = $derived.by(() => {
		if (d?.type !== 'compat') return null;
		const sec = COMPAT.find((x) => x.fams.some((f) => f.id === d.fam))!;
		const f = sec.fams.find((x) => x.id === d.fam)!;
		const ci = cfgIndex(d.cid);
		const c = CB[d.cid];
		const k = d.kid != null ? kidCells(f, ci, ui.scope)[d.kid] : compatCell(f.id, d.cid, ui.scope);
		const avail = k.run?'Recorded adapter configuration · representative contracts':'No recorded result';
    const contracts=featureContracts(f.id).filter(w=>d.kid==null || w.id===f.kids[d.kid][0]);
    const fails=contracts.map(w=>({w,cell:featureOutcome(ui.scope,w,d.cid)})).filter(x=>x.cell.st!=='ok').map(({w,cell})=>({
      st:cell.st,stColor:cell.st==='failed'?'var(--st-fail)':'var(--fg3)',file:w.src || w.id,
      kind:w.evidenceScope || 'unrecorded scope',expr:w.id,exp:'independent corpus oracle',act:cell.st,
      diag:viewReason(cell) || 'No recorded diagnostic',issue:cell.report?`Evidence: ${cell.report}`:'No report collected'
    }));
		const run = (v: number) => (k.run ? n0(v) : '—');
		return {
			kicker: `${sec.sec} · representative contracts`,
			title: f.name + (d.kid != null ? ' / ' + f.kids[d.kid][0] : ''),
			c,
			avail,
			fails,
			more: k.fail > 4 ? `+ ${k.fail - 4} more failing ${sec.unit}` : '',
			counts: [
				{ k: 'Passed', v: run(k.pass), c: 'var(--st-pass)' },
				{ k: 'Failed', v: run(k.fail), c: 'var(--st-fail)' },
				{ k: 'Crashed', v: run(k.crash), c: 'var(--st-crash)' },
				{ k: 'Skipped', v: run(k.skip), c: 'var(--fg2)' },
				{ k: 'Timed out', v: 'see raw outcomes', c: 'var(--fg2)' },
				{ k: 'Not run', v: n0(contracts.filter(w=>!featureOutcome(ui.scope,w,d.cid).report).length), c: 'var(--fg2)' }
			],
			meta: [
				{ k: 'Counting unit', v: `${sec.unit} (${n0(k.total)} total)` },
				{ k: 'Suite', v: sec.suite },
				{ k: 'Configuration', v: `${c.rt} ${configVersion(ui.machine,c.id)} · ${c.be}` },
				{ k: 'Tested', v: [...new Set(contracts.map(w=>featureOutcome(ui.scope,w,d.cid).report).filter(Boolean))].map(id=>viewData.reports[id].created).join(' · ') || 'not collected' },
				{ k: 'Scope', v: 'Execution verifies outputs; compile-only probes verify structural acceptance. Skipped includes unsupported or uncollected contracts.' }
			]
		};
	});

	// ── Runtime profile ────────────────────────────────────────────────────
	// Official project sites, only where known; GitHub and releases come from the registry repo.
	const SITES: Record<string, string> = {
		wasmtime: 'https://wasmtime.dev', wasmer: 'https://wasmer.io', wazero: 'https://wazero.io', v8: 'https://v8.dev', wago: 'https://wago.sh',
		wasmedge: 'https://wasmedge.org', spidermonkey: 'https://spidermonkey.dev', chicory: 'https://chicory.dev', graalwasm: 'https://www.graalvm.org/webassembly/', jsc: 'https://webkit.org'
	};
	const SUPPORT_TEXT: Record<string, string> = { y: 'yes', f: 'behind a flag', p: 'partial', n: 'no', '?': 'unknown', '-': ST.na[0] };
	const profile = $derived.by(() => {
		if (d?.type !== 'profile') return null;
		const s = ui.scope;
		const info = runtimeRegistry.find((r) => r.id === d.rt);
		const host = viewData.hosts[s.machine];
		// One backend per profile: the requested configuration, or the runtime's first on this machine.
		const backends = CFG.filter((c) => c.rt === d.rt && host.configurations[c.id]);
		const chosen = (d.c && backends.find((c) => c.id === d.c)) || backends[0];
		const cfgs = chosen ? [chosen] : [];
		const visible = CFG.filter((c) => isVisible(s, c));
		// Each tile: this configuration's aggregate and its place among the visible configurations.
		const metrics: { label: string; group: PerfGroup; col: number; metric: string; best: string }[] = [
			{ label: 'Compile', group: 'lat', col: 0, metric: 'compile', best: 'fastest' },
			{ label: 'Instantiate', group: 'lat', col: 1, metric: 'inst', best: 'fastest' },
			{ label: 'Steady', group: 'lat', col: 3, metric: 'steady', best: 'fastest' },
			{ label: 'Peak RSS', group: 'mem', col: 3, metric: 'rss', best: 'smallest' },
			{ label: 'Code size', group: 'code', col: 3, metric: 'code', best: 'smallest' }
		];
		const value = (c: Cfg, m: (typeof metrics)[number]) => (compileExcluded(s, c, m.metric) ? null : (absOf(s, m.group, c.id, m.col)?.v ?? null));
		const unit = { lat: 'ms', mem: 'MiB', code: 'KiB' } as const;
		const e2e = (c: Cfg) => { const parts = [0, 1, 2, 3].map((i) => (compileExcluded(s, c, ['compile', 'inst', 'first', 'steady'][i]) ? null : (absOf(s, 'lat', c.id, i)?.v ?? null))); return parts.every((v) => v != null) ? (parts as number[]).reduce((a, b) => a + b, 0) : null; };
		const place = (mine: number | null, all: (number | null)[]) => {
			const ok = all.filter((v): v is number => v != null);
			return mine == null || !ok.length ? null : { n: 1 + ok.filter((v) => v < mine).length, of: ok.length };
		};
		const highlights: { lead: boolean; text: string; place: string }[] = [];
		const configs = cfgs.map((c) => {
			const tiles = metrics.map((m) => {
				const v = value(c, m), p = place(v, visible.map((x) => value(x, m)));
				if (p && p.of > 1 && p.n === 1) highlights.push({ lead: true, text: `${m.best[0].toUpperCase() + m.best.slice(1)} ${m.label.toLowerCase()}`, place: `${c.be} · 1st of ${p.of}` });
				if (p && p.of > 2 && p.n === p.of) highlights.push({ lead: false, text: `${m.best === 'fastest' ? 'Slowest' : 'Largest'} ${m.label.toLowerCase()}`, place: `${c.be} · ${ordinal(p.n)} of ${p.of}` });
				return { label: m.label, v: v == null ? '—' : fmtU(v, unit[m.group]), place: p ? `${ordinal(p.n)}/${p.of}` : '', top: p?.n === 1 && p.of > 1 };
			});
			const total = e2e(c), tp = place(total, visible.map(e2e));
			tiles.splice(3, 0, { label: 'End-to-end', v: total == null ? '—' : fmtU(total, 'ms'), place: tp ? `${ordinal(tp.n)}/${tp.of}` : '', top: tp?.n === 1 && tp.of > 1 });
			const correct = cov(c.id, s)[0], total2 = totalWorkloads();
			return { c, kind: c.kind, correct: `${n0(correct)}/${total2}`, full: total2 > 0 && correct === total2, tiles };
		});
		// One log-scale box plot per metric: every shown runtime, this runtime's configurations ringed.
		const compare = [...metrics.slice(0, 3), { label: 'End-to-end', group: 'lat' as PerfGroup, col: -1, metric: 'e2e', best: 'fastest' }, ...metrics.slice(3)].flatMap((m) => {
			const val = (c: Cfg) => (m.metric === 'e2e' ? e2e(c) : value(c, m));
			const pts = visible.map((c) => ({ c, v: val(c) })).filter((p): p is { c: Cfg; v: number } => p.v != null && p.v > 0);
			const mine = (c: Cfg) => c.id === chosen?.id;
			if (pts.length < 2 || !pts.some((p) => mine(p.c))) return [];
			const logs = pts.map((p) => Math.log(p.v)).sort((a, b) => a - b);
			const q = (f: number) => { const i = (logs.length - 1) * f, a = Math.floor(i); return logs[a] + (logs[Math.ceil(i)] - logs[a]) * (i - a); };
			const lo = logs[0], hi = logs[logs.length - 1];
			const X = (l: number) => (hi === lo ? 210 : 16 + ((l - lo) / (hi - lo)) * 388);
			const u = unit[m.group];
			// Rating from this backend's position on the row's log scale: 0 = best shown, 1 = worst.
			const me = pts.find((p) => mine(p.c))!;
			const f = hi === lo ? 0.5 : (Math.log(me.v) - lo) / (hi - lo);
			const level = f <= 0.1 ? 3 : f <= 0.25 ? 2 : f <= 0.4 ? 1 : f < 0.6 ? 0 : f < 0.75 ? -1 : f < 0.9 ? -2 : -3;
			return [{
				label: m.label,
				level,
				box: { x: X(q(0.25)), w: Math.max(2, X(q(0.75)) - X(q(0.25))), med: X(q(0.5)) },
				whisker: [X(lo), X(hi)],
				dots: [...pts.filter((p) => !mine(p.c)), ...pts.filter((p) => mine(p.c))].map((p, k) => ({
					x: X(Math.log(p.v)), y: 14 + (mine(p.c) ? 0 : ((k % 3) - 1) * 4), self: mine(p.c), col: p.c.col, hollow: p.c.hollow, tip: `${p.c.rt} ${p.c.be}: ${fmtU(p.v, u)}`
				})),
				loL: fmtU(Math.exp(lo), u),
				hiL: fmtU(Math.exp(hi), u)
			}];
		});
		const fams = COMPAT[1]?.fams ?? [];
		const repo = info?.repo ? 'https://' + info.repo.replace(/^https?:\/\//, '') : '';
		return {
			title: `${info?.name ?? d.rt}${chosen ? ' · ' + chosen.be : ''}`,
			rt: d.rt,
			be: chosen?.be ?? '',
			siblings: backends.filter((c) => c.id !== chosen?.id).map((c) => ({ id: c.id, be: c.be, col: c.col, hollow: c.hollow })),
			lang: info ? langOf({ rt: d.rt }) : '',
			license: info?.lic && info.lic !== 'not reviewed' ? info.lic : '',
			links: [
				...(repo ? [{ label: 'GitHub', href: repo }, ...(repo.includes('github.com') ? [{ label: 'Releases', href: repo + '/releases' }] : [])] : []),
				...(SITES[d.rt] ? [{ label: 'Website', href: SITES[d.rt] }] : [])
			],
			repo,
			site: SITES[d.rt] ?? '',
			configs,
			compare,
			highlights,
			features: fams.length ? cfgs.map((c) => ({ be: c.be, v: `${fams.filter((f) => { const x = compatCell(f.id, c.id, s); return x.run && x.total > 0 && x.pass === x.total; }).length}/${fams.length}` })) : [],
			about: info ? [
				{ k: 'Language', v: info.lang },
				{ k: 'Execution', v: info.exec.join(' · ') },
				{ k: 'Tiers', v: info.tiers },
				{ k: 'Architectures', v: info.arch.join(' · ') },
				{ k: 'WASI', v: info.wasi },
				{ k: 'Component Model', v: SUPPORT_TEXT[info.cm] ?? info.cm },
				{ k: 'Embeds in', v: info.embed.join(' · ') },
				...(info.lic && info.lic !== 'not reviewed' ? [{ k: 'License', v: info.lic }] : [])
			].filter((r) => r.v && r.v !== ST.na[0]) : [],
			notes: info?.notes ?? [],
			machine: MACH[s.machine].l
		};
	});

	// Compatibility ⇄ performance for the same feature and configuration.
	const PERF_METRIC = { exec: 'steady', compile: 'compile', mem: 'rss' } as const;
	const swap = $derived.by(() => {
		if (d?.type === 'support') {
			const hasPerf = COMPAT.some((sec) => sec.fams.some((x) => x.id === d.fam));
			const to = { type: 'feature' as const, fam: d.fam, c: d.c, m: PERF_METRIC[ui.perfMetric], peers: d.peers };
			return { on: 'support', toSupport: null, toPerf: hasPerf ? () => (ui.drawer = to) : null };
		}
		if (d?.type === 'feature') {
			const to = { type: 'support' as const, fam: d.fam, c: d.c, channel: 'stable' as const, peers: d.peers };
			return { on: 'perf', toSupport: () => (ui.drawer = to), toPerf: null };
		}
		return null;
	});

	const kicker = $derived(cell?.kicker ?? feature?.kicker ?? support?.kicker ?? aggregatePanel?.kicker ?? compat?.kicker ?? 'Runtime profile');
	const title = $derived(cell?.title ?? feature?.title ?? support?.title ?? aggregatePanel?.title ?? compat?.title ?? profile?.title ?? '');

	// Close on a click outside the panel, unless that click opened something else in it
	// (e.g. another result cell), which replaces the panel's contents instead.
	let drawerAtPress: typeof ui.drawer = null;
	function onpointerdown() {
		drawerAtPress = ui.drawer;
	}
	function onclick(e: MouseEvent) {
		if (!ui.drawer || ui.drawer !== drawerAtPress) return;
		if (e.target instanceof Node && (panel?.contains(e.target) || !e.target.isConnected)) return;
		close();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && ui.drawer) close();
		// ← / → switch between the compatibility and performance views of the same cell.
		const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
		if (swap && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
			if (e.key === 'ArrowLeft' && swap.toSupport) swap.toSupport();
			if (e.key === 'ArrowRight' && swap.toPerf) swap.toPerf();
		}
	}

	// Move focus into the panel when it opens, return it to the opener when it closes,
	// and keep the page underneath from scrolling while the panel covers it.
	let panel = $state<HTMLDivElement>();
	let opener: HTMLElement | null = null;
	const isOpen = $derived(!!d);
	$effect(() => {
		if (!isOpen) return;
		opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		panel?.focus({ preventScroll: true });
		const root = document.documentElement;
		const prev = root.style.overflow;
		if (matchMedia('(max-width: 720px)').matches) root.style.overflow = 'hidden';
		return () => {
			root.style.overflow = prev;
			if (opener?.isConnected) opener.focus({ preventScroll: true });
		};
	});
</script>

<svelte:window {onkeydown} {onpointerdown} {onclick} />

<!-- Consumer-Reports-style rating: stacked chevrons, up = better, ~ = middle of the field. -->
{#snippet rating(level: number)}
	{@const RATING = { 3: ['oklch(0.58 0.15 150)', 'Much better than most shown runtimes'], 2: ['oklch(0.68 0.16 148)', 'Better than most shown runtimes'], 1: ['oklch(0.8 0.14 135)', 'Somewhat better than most'], 0: ['oklch(0.84 0.15 95)', 'Middle of the field'], '-1': ['oklch(0.76 0.16 65)', 'Somewhat worse than most'], '-2': ['oklch(0.66 0.18 42)', 'Worse than most shown runtimes'], '-3': ['oklch(0.6 0.21 27)', 'Much worse than most shown runtimes'] } as Record<string, [string, string]>}
	{@const [col, text] = RATING[String(level)]}
	{@const n = Math.abs(level)}
	<!-- Drawn inside the plot's svg at its right edge, centred on the plot's line (y = 14). -->
	<svg class="rating" x="424" y="0" width="16" height="28" viewBox="0 0 16 28" role="img" aria-label={text}>
		<title>{text}</title>
		{#if level === 0}
			<path d="M4 14 q2 -2.6 4 0 t4 0" style:stroke={col} />
		{:else}
			{#each Array(n) as _, k (k)}
				{@const y = 14 + (k - (n - 1) / 2) * 4}
				<polyline points={level > 0 ? `4.5,${y + 1.6} 8,${y - 1.6} 11.5,${y + 1.6}` : `4.5,${y - 1.6} 8,${y + 1.6} 11.5,${y - 1.6}`} style:stroke={col} />
			{/each}
		{/if}
	</svg>
{/snippet}

{#snippet rankStrip(st: StripSpec)}
	{#if st}
		<div class="strip">
			<div class="strip-head">
				<span class="mono rank-place">{st.place}</span><span class="fg3 small">of {st.n}</span>
				{#if st.ties.length}<span class="tie-chip small" data-tip={`Statistically tied (paired 95% interval includes no difference):\n${st.ties.join('\n')}`}>≈ {st.ties.length} tied</span>{/if}
				<span class="lead small">
					{#if st.best.self}<span class="fg3">{st.lead}</span>
					{:else}<span class="fg3">{st.lead}</span><Swatch color={st.best.c.col} bg={st.best.c.hollow ? 'transparent' : st.best.c.col} size={7} /><span>{st.best.c.rt}</span><span class="mono">{st.best.label}</span>{/if}
				</span>
			</div>
			<svg viewBox="0 0 420 48" class="dist" role="img" aria-label="{st.place} of {st.n}; each dot is one configuration, best on the left">
				<line x1="16" x2="404" y1="24" y2="24" style="stroke:var(--line2)" />
				{#if st.band}<rect x={st.band.x} width={st.band.w} y="3" height="42" rx="10" style="fill:var(--fg3)" opacity="0.14" />{/if}
				{#each st.dots as p, i (i)}
					{#if p.self}<circle cx={p.x} cy={p.y} r="9" style="fill:none;stroke:var(--fg);stroke-width:1.5" />{/if}
					<circle cx={p.x} cy={p.y} r={p.self ? 5.5 : 3.5} style:fill={p.hollow ? 'var(--bg2)' : p.col} style:stroke={p.col} style="stroke-width:1.5" opacity={p.self ? 1 : 0.7}><title>{p.name}: {p.label}</title></circle>
				{/each}
			</svg>
			<div class="minmax mono"><span>{st.loL}</span><span></span><span>{st.hiL}</span></div>
		</div>
	{/if}
{/snippet}

{#snippet distChart(spec: DistSpec, col: string, unit: string, label: string)}
	{#if spec}
		<svg viewBox="0 0 420 48" class="dist" role="img" aria-label="Box plot with min–max tails, one dot per {unit} and a band showing mean plus or minus one standard deviation">
			<rect x={spec.sdX} width={spec.sdW} y="2" height="44" style:fill={col} opacity="0.12" />
			<line x1={spec.whiskerLo} x2={spec.whiskerHi} y1="24" y2="24" style="stroke:var(--fg3)" />
			<line x1={spec.whiskerLo} x2={spec.whiskerLo} y1="17" y2="31" style="stroke:var(--fg3)" />
			<line x1={spec.whiskerHi} x2={spec.whiskerHi} y1="17" y2="31" style="stroke:var(--fg3)" />
			<rect x={spec.boxX} width={spec.boxW} y="12" height="24" style="fill:var(--bg3);stroke:var(--fg3)" />
			<line x1={spec.medX} x2={spec.medX} y1="8" y2="40" style="stroke:var(--fg);stroke-width:2" />
			{#each spec.dots as dot, i (i)}
				<circle cx={dot.x} cy={dot.y} r="3.5" style:fill={col} style="stroke:var(--bg2);stroke-width:1"><title>{label} {i + 1}: {dot.value}</title></circle>
			{/each}
		</svg>
		<div class="minmax mono"><span>{spec.minL}</span><span class="axis-med">{spec.medL}</span><span>{spec.maxL}</span></div>
		<ul class="legend small fg3">
			<li><i class="lg-dot" style:background={col}></i>{unit}</li>
			<li><i class="lg-box"></i>middle 50%</li>
			<li><i class="lg-tail"></i>min – max</li>
			<li><i class="lg-med"></i>median</li>
			<li><i class="lg-band" style:background={col}></i>mean ± 1 SD</li>
		</ul>
	{/if}
{/snippet}

{#if d}
	<div class="scrim" role="presentation" onclick={close} in:fade={scrimIn} out:fade={scrimOut}></div>
	<div class="drawer" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" bind:this={panel} in:fly={panelIn} out:fly={panelOut}>
		<div class="top">
			<div class="titles">
				{#if d.type === 'cell' && d.back}
					{@const back = d.back}
					<button class="back small" onclick={() => (ui.drawer = back.drawer)}>← {back.label}</button>
				{/if}
				<div class="kicker">{kicker}</div>
				<div class="mono title">{title}</div>
				{#if swap}
					<div class="swap" role="group" aria-label="View">
						<button class:on={swap.on === 'support'} disabled={!swap.toSupport} onclick={() => swap.toSupport?.()} aria-label="Compatibility">‹ Compatibility</button>
						<button class:on={swap.on === 'perf'} disabled={!swap.toPerf} onclick={() => swap.toPerf?.()} aria-label="Performance" data-tip={swap.on === 'support' && !swap.toPerf ? 'No performance contracts for this feature' : undefined}>Performance ›</button>
					</div>
				{/if}
			</div>
			<button class="esc" onclick={close} aria-label="Close" data-tip="Close · Esc">
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
					><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg
				>
			</button>
		</div>
		{#key d}<div class="body" in:fade={swapIn}>
			{#if cell}
				<div class="ident">
					<Swatch color={cell.c.col} bg={cell.c.hollow ? 'transparent' : cell.c.col} size={9} />
					<span class="w5">{cell.c.rt}</span>
					<VersionLink id={cell.c.id} />
					<span class="chip mono">{cell.c.be}</span>
					<span class="pill" style:color={cell.st[2]} data-tip={cell.ok ? 'Output matched the independent oracle' : cell.stDesc}>
						<span aria-hidden="true">{cell.st[0]}</span>{cell.st[1]}
					</span>
				</div>
				{#if cell.ok}
					<div class="hero">
						<div class="small fg3 hero-label" data-tip={cell.phaseNote}>{cell.heroLabel} <span class="info" aria-hidden="true">ⓘ</span></div>
						<div class="hero-main">
							<div class="mono big">{cell.abs}</div>
							{#if cell.conf}<span class="conf" style:color={cell.conf.color} data-tip={cell.conf.why}><i></i>{cell.conf.level} confidence</span>{/if}
						</div>
						<div class="hero-sub mono small">
							{#if cell.absCi}<span data-tip="95% confidence interval of the mean (Student t)">{cell.absCi}</span>{/if}
							{#if cell.count != null}<span>n = {cell.count}</span>{/if}
							{#if cell.spread}<span data-tip="Coefficient of variation (std dev ÷ mean)">{cell.spread} spread</span>{/if}
							{#if cell.outliers}<span data-tip="Samples beyond 1.5× the interquartile range">{cell.outliers} outlier{cell.outliers === 1 ? '' : 's'}</span>{/if}
						</div>
						{@render rankStrip(cell.strip)}
					</div>
					{#if cell.isLatency}<section class="sect">
						<h3 class="kicker">Sample distribution</h3>
						{#if cell.chart}
							{@render distChart(cell.chart, cell.c.col, 'sample', 'Sample')}
						{:else}<p class="small fg3">Samples were not retained for this older measurement.</p>{/if}
						{#if cell.stats.length}
							<dl class="tiles stats">
								{#each cell.stats as s (s.k)}
									<div data-tip={s.tip}><dt class="small fg3">{s.k}</dt><dd class="mono">{s.v}</dd></div>
								{/each}
							</dl>
						{/if}
					</section>{/if}
				{:else}
					<div class="desc mono">{cell.stDesc}</div>
					<p class="lede">{cell.phaseNote}</p>
				{/if}
				<section class="sect record">
					<h3 class="kicker">Run record</h3>
					{#each cell.record as g (g.title)}
						<div class="group">
							<div class="group-title small fg3">{g.title}</div>
							<dl>
								{#each g.rows as r (r.k)}
									<div class="kv">
										<dt class="fg3">{r.k}</dt>
										<dd class="mono" class:fine={r.fine}>
											{#if r.href}<a class="rlink" href={r.href} target={r.ext ? '_blank' : undefined} rel={r.ext ? 'noopener noreferrer' : undefined} data-tip={r.tip}>{r.v}{#if r.ext}<span class="ext" aria-hidden="true">↗</span>{/if}</a>
											{:else if r.action}<button class="rlink" onclick={r.action} data-tip={r.tip}>{r.v}<span class="ext" aria-hidden="true">→</span></button>
											{:else}<span data-tip={r.tip}>{r.v}</span>{/if}
											{#if r.copy}<button class="copy" onclick={() => copyValue(r.k, r.copy!)} aria-label={`Copy ${r.k}`} data-tip={copiedKey === r.k ? 'Copied' : `Copy full ${r.k.toLowerCase()}`}>{copiedKey === r.k ? '✓' : '⧉'}</button>{/if}
										</dd>
									</div>
								{/each}
							</dl>
						</div>
					{/each}
				</section>
			{:else if feature}
				<div class="ident">
					<Swatch color={feature.c.col} bg={feature.c.hollow ? 'transparent' : feature.c.col} size={9} />
					<span class="w5">{feature.c.rt}</span>
					<VersionLink id={feature.c.id} />
					<span class="chip mono">{feature.c.be}</span>
					{#if feature.ok}
						<span class="pill" style:color="var(--st-pass)" data-tip="Passed every contract's oracle"><span aria-hidden="true">✓</span>{feature.shared}/{feature.eligible} passed</span>
					{:else}
						<span class="pill" style:color={'var(--fg3)'}>{feature.statusLabel}</span>
					{/if}
				</div>
				{#if feature.ok}
					<div class="hero">
						<div class="small fg3 hero-label" data-tip={feature.note}>{ui.average==='mean'?'Arithmetic mean':'Geometric mean'} <span class="info" aria-hidden="true">ⓘ</span></div>
						<div class="hero-main">
							<div class="mono big">{feature.value}</div>
							{#if feature.conf}<span class="conf" style:color={feature.conf.color} data-tip={feature.conf.why}><i></i>{feature.conf.level} confidence</span>{/if}
						</div>
						<div class="hero-sub mono small">
							{#if feature.ci}<span data-tip="Paired over the same contracts (Student t on log ratios)">{feature.ci}</span>{/if}
							<span>{feature.shared} of {feature.eligible} contracts</span>
							{#if feature.outliers}<span data-tip="Contracts beyond 1.5× the interquartile range of ratios">{feature.outliers} outlier{feature.outliers === 1 ? '' : 's'}</span>{/if}
						</div>
						{@render rankStrip(feature.strip)}
					</div>
					{#if feature.chart}<section class="sect">
						<h3 class="kicker">Sample spread{feature.chartUnit === 'contract' ? ' · one dot per contract' : ''}</h3>
						{@render distChart(feature.chart, feature.c.col, feature.chartUnit, feature.chartUnit === 'contract' ? 'Contract' : 'Sample')}
						<dl class="tiles stats">
							{#each feature.stats as st (st.k)}
								<div data-tip={st.tip}><dt class="small fg3">{st.k}</dt><dd class="mono">{st.v}</dd></div>
							{/each}
						</dl>
					</section>{/if}
					<section class="sect">
						<h3 class="kicker">Contracts <span class="fg3">· slowest first · ± sample spread · open for samples</span></h3>
						<ul class="contracts">
							{#each showAllContracts ? feature.rows : feature.rows.slice(0, 8) as r (r.w.id)}
								<li>
									<button class="contract" onclick={r.open} data-tip={`${r.samples.length} samples · coefficient of variation ${r.rel}`}>
										<span class="mono cname">{r.name}</span>
										<span class="mono">{r.value}</span>
										<span class="mono rel">{r.rel}</span>
									</button>
								</li>
							{/each}
						</ul>
						{#if feature.rows.length > 8}
							<button class="more small" onclick={() => (showAllContracts = !showAllContracts)}>{showAllContracts ? 'Show fewer' : `Show all ${feature.rows.length} contracts`}</button>
						{/if}
						{#if feature.failures}<p class="small fg3">{feature.failures} eligible contract{feature.failures === 1 ? '' : 's'} not passed by {feature.c.rt}; excluded from the cohort.</p>{/if}
					</section>
				{:else}
					<div class="desc mono">{feature.reason}</div>
					{#if feature.failureList?.length}
						<ul class="contracts">
							{#each feature.failureList as x (x.name)}
								<li class="contract static"><span class="mono cname">{x.name}</span><span class="mono" style:color={x.st[2]}>{x.st[0]} {x.st[1]}</span></li>
							{/each}
						</ul>
					{/if}
					<p class="lede">{feature.note}</p>
				{/if}
				<section class="sect record">
					<h3 class="kicker">Run record</h3>
					{#each feature.record as g (g.title)}
						<div class="group">
							<div class="group-title small fg3">{g.title}</div>
							<dl>
								{#each g.rows as r (r.k)}
									<div class="kv">
										<dt class="fg3">{r.k}</dt>
										<dd class="mono">
											{#if r.href}<a class="rlink" href={r.href} target={r.ext ? '_blank' : undefined} rel={r.ext ? 'noopener noreferrer' : undefined} data-tip={r.tip}>{r.v}{#if r.ext}<span class="ext" aria-hidden="true">↗</span>{/if}</a>
											{:else if r.action}<button class="rlink" onclick={r.action} data-tip={r.tip}>{r.v}<span class="ext" aria-hidden="true">→</span></button>
											{:else}<span>{r.v}</span>{/if}
										</dd>
									</div>
								{/each}
							</dl>
						</div>
					{/each}
				</section>
			{:else if support}
				<div class="ident">
					<Swatch color={support.col} bg={support.hollow ? 'transparent' : support.col} size={9} />
					<span class="w5">{support.rt}</span>
					<span class="version-tag mono">{support.version}</span>
					<span class="chip mono">{support.activeBackend || support.be}</span>
					<span class="pill" style:color={support.status[2]}><span aria-hidden="true">{support.status[0]}</span>{support.status[1]}</span>
				</div>
				<div class="hero">
					<div class="small fg3 hero-label" data-tip="Representative corpus tests with independent oracles, not full specification conformance. Unsupported means the adapter could not run the test; it does not establish that the engine lacks the feature.">Corpus tests passed · {support.channelLabel.toLowerCase()} <span class="info" aria-hidden="true">ⓘ</span></div>
					<div class="hero-main">
						<div class="mono big">{support.value}</div>
						{#if support.measured}<span class="heat-chip" style:background={support.heat} aria-hidden="true"></span>{/if}
					</div>
					{#if support.sub.length}
						<div class="hero-sub mono small">
							{#each support.sub as x (x)}<span>{x}</span>{/each}
							{#if support.flagged}<span>⚑ experimental flag</span>{/if}
						</div>
					{/if}
					{@render rankStrip(support.strip)}
				</div>
				{#if support.measured}
					<section class="sect">
						<h3 class="kicker">Results</h3>
						{#if support.backends.length > 1}
							<div class="backends" role="group" aria-label="Backend">
								{#each support.backends as b (b.id)}
									<button aria-pressed={b.on} onclick={() => (supportPick = { for: d, id: b.id })}>{b.label} <span class="mono">{b.v}</span></button>
								{/each}
							</div>
						{/if}
						<dl class="tiles stats">
							{#each support.stats as st (st.k)}
								<div><dt class="small fg3">{st.k}</dt><dd class="mono" style:color={st.c || null}>{st.v}</dd></div>
							{/each}
						</dl>
					</section>
					<section class="sect">
						<h3 class="kicker">Tests <span class="fg3">· failures first · open for samples</span></h3>
						<ul class="contracts">
							{#each support.tests as t (t.workload)}
								<li>
									{#if t.open}
										<button class="contract test" onclick={t.open} data-tip={t.scope}>
											<span class="mono" style:color={t.color}>{t.glyph}</span>
											<span class="mono cname">{t.name}</span>
											<span class="mono rel" style:color={t.color}>{t.status}</span>
										</button>
									{:else}
										<div class="contract test static"><span class="mono" style:color={t.color}>{t.glyph}</span><span class="mono cname">{t.name}</span><span class="mono rel" style:color={t.color}>{t.status}</span></div>
									{/if}
									{#if t.reasons.length}
										<details class="diag"><summary class="small fg3">Diagnostic</summary><pre class="mono">{t.reasons.join('\n\n')}</pre></details>
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				{:else}
					<div class="desc mono">No measured corpus results for this build on the selected machine.</div>
				{/if}
				<section class="sect record">
					<h3 class="kicker">Run record</h3>
					{#each support.record as g (g.title)}
						<div class="group">
							<div class="group-title small fg3">{g.title}</div>
							<dl>
								{#each g.rows as r (r.k)}
									<div class="kv">
										<dt class="fg3">{r.k}</dt>
										<dd class="mono">
											{#if r.href}<a class="rlink" href={r.href} target={r.ext ? '_blank' : undefined} rel={r.ext ? 'noopener noreferrer' : undefined} data-tip={r.tip}>{r.v}{#if r.ext}<span class="ext" aria-hidden="true">↗</span>{/if}</a>
											{:else if r.action}<button class="rlink" onclick={r.action} data-tip={r.tip}>{r.v}<span class="ext" aria-hidden="true">→</span></button>
											{:else}<span data-tip={r.tip}>{r.v}</span>{/if}
										</dd>
									</div>
								{/each}
							</dl>
						</div>
					{/each}
				</section>
			{:else if aggregatePanel}
				{@const a = aggregatePanel}
				<div class="ident">
					<Swatch color={a.c.col} bg={a.c.hollow ? 'transparent' : a.c.col} size={9} />
					<span class="w5">{a.c.rt}</span>
					<VersionLink id={a.c.id} />
					<span class="chip mono">{a.c.be}</span>
				</div>
				<div class="hero">
					<div class="small fg3 hero-label" data-tip={a.note}>{a.label} <span class="info" aria-hidden="true">ⓘ</span></div>
					<div class="hero-main"><div class="mono big">{a.value}</div></div>
					<div class="hero-sub mono small">
						{#if a.ci}<span>{a.ci}</span>{/if}
						<span>{a.count} workloads</span>
					</div>
					{@render rankStrip(a.strip)}
				</div>
				{#if a.breakdown.length}
					<dl class="tiles stats">
						{#each a.breakdown as b (b.k)}<div><dt class="small fg3">{b.k}</dt><dd class="mono">{b.v}</dd></div>{/each}
					</dl>
				{/if}
				{#if a.chart}
					<section class="sect">
						<h3 class="kicker">Spread across workloads <span class="fg3">· one dot per workload · log scale</span></h3>
						{@render distChart(a.chart, a.c.col, 'workload', 'Workload')}
						<dl class="tiles stats">
							{#each a.stats as st (st.k)}<div data-tip={st.tip}><dt class="small fg3">{st.k}</dt><dd class="mono">{st.v}</dd></div>{/each}
						</dl>
					</section>
				{/if}
				{#if a.rows.length}
					<section class="sect">
						<h3 class="kicker">Workloads <span class="fg3">· slowest first · place among shown runtimes · open for samples</span></h3>
						<ul class="contracts">
							{#each showAllWorkloads ? a.rows : a.rows.slice(0, 10) as r (r.w.id)}
								<li>
									<button class="contract" onclick={r.open}>
										<span class="mono cname">{r.name}</span>
										<span class="mono">{r.value}</span>
										<span class="mono rel">{r.rank}</span>
									</button>
								</li>
							{/each}
						</ul>
						{#if a.rows.length > 10}
							<button class="more small" onclick={() => (showAllWorkloads = !showAllWorkloads)}>{showAllWorkloads ? 'Show fewer' : `Show all ${a.rows.length} workloads`}</button>
						{/if}
					</section>
				{/if}
				<section class="sect record">
					<h3 class="kicker">Run record</h3>
					{#each a.record as g (g.title)}
						<div class="group">
							<div class="group-title small fg3">{g.title}</div>
							<dl>
								{#each g.rows as r (r.k)}
									<div class="kv">
										<dt class="fg3">{r.k}</dt>
										<dd class="mono">
											{#if r.href}<a class="rlink" href={r.href} target={r.ext ? '_blank' : undefined} rel={r.ext ? 'noopener noreferrer' : undefined}>{r.v}{#if r.ext}<span class="ext" aria-hidden="true">↗</span>{/if}</a>
											{:else if r.action}<button class="rlink" onclick={r.action} data-tip={r.tip}>{r.v}<span class="ext" aria-hidden="true">→</span></button>
											{:else}<span>{r.v}</span>{/if}
										</dd>
									</div>
								{/each}
							</dl>
						</div>
					{/each}
				</section>
			{:else if compat}
				<div class="ident">
					<Swatch color={compat.c.col} bg={compat.c.hollow ? 'transparent' : compat.c.col} size={9} />
					<span class="w5">{compat.c.rt} <VersionLink id={compat.c.id} /></span>
					<span class="mono small fg3">{compat.c.be}</span>
				</div>
				<div class="s12"><span class="fg3">Availability: </span>{compat.avail}</div>
				<div class="tiles three">
					{#each compat.counts as k (k.k)}
						<div class="pad8">
							<div class="small fg3">{k.k}</div>
							<div class="mono s16" style:color={k.c}>{k.v}</div>
						</div>
					{/each}
				</div>
				<div class="sect0">
					{#each compat.meta as k (k.k)}
						<div class="kv" style:grid-template-columns="110px 1fr"><span class="fg3">{k.k}</span><span class="mono">{k.v}</span></div>
					{/each}
				</div>
				<div class="sect">
					<div class="kicker">Failing tests</div>
					{#if !compat.fails.length}<div class="lede">No failing or crashed tests in this cell.</div>{/if}
					{#each compat.fails as f, i (i)}
						<div class="fail">
							<div class="between"><span class="mono">{f.file}</span><span class="small" style:color={f.stColor}>{f.st}</span></div>
							<div class="mono small fg2 brk">{f.kind} {f.expr}</div>
							<div class="expact mono small">
								<span class="fg3">expected</span><span>{f.exp}</span>
								<span class="fg3">actual</span><span style:color={f.stColor}>{f.act}</span>
							</div>
							<div class="small fg2">{f.diag} · <span class="fg3">{f.issue}</span></div>
						</div>
					{/each}
					<div class="note">{compat.more}</div>
				</div>
				<div class="note">Observed results for one configuration on one suite revision. Not a compliance certification.</div>
			{:else if profile}
				<div class="ident">
					{#each profile.configs.slice(0, 1) as x (x.c.id)}<Swatch color={x.c.col} bg={x.c.col} size={9} />{/each}
					<span class="w5">{profile.rt}</span>
					{#if profile.lang}<span class="chip mono">{profile.lang}</span>{/if}
					{#if profile.license}<span class="chip mono" title="License">{profile.license}</span>{/if}
				</div>
				{#if profile.links.length}
					<div class="links">
						{#each profile.links as l (l.label)}<a class="link-btn" href={l.href} target="_blank" rel="noopener noreferrer">{l.label}<span aria-hidden="true">↗</span></a>{/each}
					</div>
				{/if}
				{#if profile.siblings.length}
					<div class="siblings small">
						<span class="fg3">Other backends</span>
						{#each profile.siblings as sb (sb.id)}
							<button class="sib" onclick={() => ui.openProfile(profile.rt, sb.id)}><Swatch color={sb.col} bg={sb.hollow ? 'transparent' : sb.col} size={7} />{sb.be}<span class="ext" aria-hidden="true">→</span></button>
						{/each}
					</div>
				{/if}
				<section class="sect">
					<h3 class="kicker">This backend <span class="fg3">· {profile.machine} · place among shown runtimes</span></h3>
					{#if !profile.configs.length}<p class="small fg3">No measured configuration on this machine.</p>{/if}
					{#each profile.configs as x (x.c.id)}
						<div class="pcfg">
							<div class="pcfg-head">
								<Swatch color={x.c.col} bg={x.c.hollow ? 'transparent' : x.c.col} />
								<span class="w5">{x.c.be}</span>
								<VersionLink id={x.c.id} />
								<span class="small fg3">{x.kind}</span>
								<span class="pill" style:color={x.full ? 'var(--st-pass)' : 'var(--fg2)'} data-tip="Workloads verified correct">{x.correct}</span>
							</div>
							<dl class="tiles ptiles">
								{#each x.tiles as t (t.label)}
									<div class:lead-tile={t.top}><dt class="small fg3">{t.label}</dt><dd class="mono">{t.v}</dd><dd class="mono micro fg3">{t.place}</dd></div>
								{/each}
							</dl>
						</div>
					{/each}
				</section>
				{#if profile.compare.length}
					<section class="sect">
						<h3 class="kicker">How it compares <span class="fg3">· all shown runtimes · log scale, best on the left</span></h3>
						{#each profile.compare as m (m.label)}
							<div class="cmp">
								<span class="small fg3 cmp-label">{m.label}</span>
								<div>
									<svg viewBox="0 0 440 28" class="dist" role="img" aria-label="{m.label} across shown runtimes">
										<line x1={m.whisker[0]} x2={m.whisker[1]} y1="14" y2="14" style="stroke:var(--fg3)" />
										<line x1={m.whisker[0]} x2={m.whisker[0]} y1="9" y2="19" style="stroke:var(--fg3)" />
										<line x1={m.whisker[1]} x2={m.whisker[1]} y1="9" y2="19" style="stroke:var(--fg3)" />
										<rect x={m.box.x} width={m.box.w} y="6" height="16" style="fill:var(--bg3);stroke:var(--fg3)" />
										<line x1={m.box.med} x2={m.box.med} y1="4" y2="24" style="stroke:var(--fg);stroke-width:1.5" />
										{#each m.dots as p, i (i)}
											{#if p.self}<circle cx={p.x} cy={p.y} r="7.5" style="fill:none;stroke:var(--fg);stroke-width:1.25" />{/if}
											<circle cx={p.x} cy={p.y} r={p.self ? 4.5 : 3} style:fill={p.hollow ? 'var(--bg2)' : p.col} style:stroke={p.col} style="stroke-width:1.5" opacity={p.self ? 1 : 0.85}><title>{p.tip}</title></circle>
										{/each}
										{@render rating(m.level)}
									</svg>
									<div class="minmax mono cmp-axis"><span>{m.loL}</span><span></span><span>{m.hiL}</span></div>
								</div>
							</div>
						{/each}
						<ul class="legend small fg3">
							<li><i class="lg-box"></i>middle 50%</li>
							<li><i class="lg-med"></i>median</li>
							<li><i class="lg-tail"></i>fastest – slowest</li>
							<li><i class="lg-dot lg-ring" style:background={profile.configs[0]?.c.col ?? 'var(--fg)'}></i>{profile.rt} {profile.be} · other dots are other runtimes and backends</li>
						</ul>
					</section>
				{/if}
				{#if profile.highlights.length}
					<section class="sect">
						<h3 class="kicker">Highlights</h3>
						<ul class="hl">
							{#each profile.highlights as h (h.text + h.place)}
								<li><span class="hl-mark mono">{h.lead ? '▲' : '▼'}</span><span>{h.text}</span><span class="mono small fg3">{h.place}</span></li>
							{/each}
						</ul>
					</section>
				{/if}
				{#if profile.features.length}
					<section class="sect">
						<h3 class="kicker">Feature corpus <span class="fg3">· families fully passed</span></h3>
						<dl>{#each profile.features as f (f.be)}<div class="kv"><dt class="fg3">{f.be}</dt><dd class="mono">{f.v}</dd></div>{/each}</dl>
					</section>
				{/if}
				{#if profile.about.length}
					<section class="sect record">
						<h3 class="kicker">About</h3>
						<dl>{#each profile.about as r (r.k)}<div class="kv"><dt class="fg3">{r.k}</dt><dd>{r.v}</dd></div>{/each}</dl>
						{#if profile.notes.length}<ul class="notes small fg2">{#each profile.notes as n (n)}<li>{n}</li>{/each}</ul>{/if}
					</section>
				{/if}
			{/if}
		</div>{/key}
		{#if aggregatePanel}
			{@const ax = aggregatePanel}
			<div class="foot">
				<button class="primary" onclick={() => { ui.metric = ax.cellMetric; ui.drawer = null; document.getElementById('workloads')?.scrollIntoView({ behavior: 'smooth' }); }}>Per-workload table</button>
				<button class="outline" onclick={() => ui.openProfile(ax.c.rt, ax.c.id)}>{ax.c.rt} profile</button>
			</div>
		{/if}
		{#if profile && (profile.repo || profile.site)}
			{@const px = profile}
			<div class="foot">
				{#if px.repo}<a class="primary" href={px.repo} target="_blank" rel="noopener noreferrer">GitHub ↗</a>{:else}<span></span>{/if}
				{#if px.site}<a class="outline" href={px.site} target="_blank" rel="noopener noreferrer">Website ↗</a>{:else if px.repo.includes('github.com')}<a class="outline" href={px.repo + '/releases'} target="_blank" rel="noopener noreferrer">Releases ↗</a>{/if}
			</div>
		{/if}
		{#if support}
			{@const sx = support}
			<div class="foot">
				{#if sx.f.page}<a class="primary" href={siteHref(`/${sx.f.page}`)}>Open feature page</a>{:else if sx.f.url}<a class="primary" href={sx.f.url} target="_blank" rel="noopener noreferrer">Specification ↗</a>{:else}<span></span>{/if}
				<button class="outline" onclick={() => ui.openProfile(sx.rt, sx.cid)}>{sx.rt} profile</button>
			</div>
		{/if}
		{#if feature}
			{@const fx = feature}
			<div class="foot">
				<button class="primary" onclick={() => d?.type === 'feature' && (ui.drawer = { type: 'support', fam: fx.f.id, c: fx.c.id, channel: 'stable', peers: d.peers })}>Test results</button>
				<button class="outline" onclick={() => ui.openProfile(fx.c.rt, fx.c.id)}>{fx.c.rt} profile</button>
			</div>
		{/if}
		{#if cell}
			<div class="foot">
				<a class="primary" href={siteHref(benchHref(cell.b.id))}>Open benchmark page</a>
				<button class="outline" onclick={() => ui.openProfile(cell.c.rt, cell.c.id)}>{cell.c.rt} profile</button>
			</div>
		{/if}
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 49;
		background: rgba(0, 0, 0, 0.32);
	}
	.drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 460px;
		max-width: 100vw;
		box-sizing: border-box;
		background: var(--bg2);
		border-left: 1px solid var(--line2);
		box-shadow: -12px 0 32px rgba(0, 0, 0, 0.28);
		overflow: auto;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
		z-index: 50;
		display: flex;
		flex-direction: column;
		padding-bottom: env(safe-area-inset-bottom);
		padding-right: env(safe-area-inset-right);
	}
	.drawer {
		will-change: transform;
	}
	.drawer:focus {
		outline: none;
	}
	@media (max-width: 720px) {
		.drawer {
			width: 100vw;
			border-left: 0;
		}
		.top {
			padding-top: max(12px, env(safe-area-inset-top));
		}
		.body {
			padding-bottom: 32px;
		}
	}
	/* Desktop keeps the page usable beside the panel, so other cells can be opened directly. */
	@media (min-width: 721px) {
		.scrim {
			display: none;
		}
	}
	.top {
		position: sticky;
		top: 0;
		background: var(--bg2);
		border-bottom: 1px solid var(--line);
		padding: 12px 16px;
		display: flex;
		gap: 10px;
		align-items: flex-start;
		z-index: 1;
	}
	.titles {
		flex: 1;
		min-width: 0;
	}
	.title {
		font-size: 14px;
		font-weight: 500;
		word-break: break-word;
	}
	.esc {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		margin: -4px -6px 0 0;
		border: 1px solid var(--line2);
		color: var(--fg2);
	}
	.esc:hover {
		color: var(--fg);
		border-color: var(--fg3);
	}
	@media (max-width: 720px) {
		.esc {
			width: 40px;
			height: 40px;
		}
	}
	.body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.ident {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.w5 {
		font-weight: 500;
	}
	.three {
		grid-template-columns: repeat(3, 1fr);
	}
	.pad8 {
		padding: 8px;
	}
	.big {
		font-size: 20px;
	}
	.s16 {
		font-size: 16px;
	}
	.s12 {
		font-size: 12px;
	}
	.sect {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.sect0 {
		display: flex;
		flex-direction: column;
	}
	.dist {
		width: 100%;
		height: auto;
		display: block;
	}
	.minmax {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		font-size: 10px;
		color: var(--fg3);
	}
	.chip {
		font-size: 11px;
		color: var(--fg2);
		border: 1px solid var(--line2);
		padding: 0 5px;
		line-height: 16px;
	}
	.pill {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		font-weight: 500;
		padding: 1px 8px;
		border: 1px solid color-mix(in oklab, currentColor 40%, transparent);
		background: color-mix(in oklab, currentColor 10%, transparent);
		white-space: nowrap;
	}
	.hero {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-bottom: 14px;
		border-bottom: 1px solid var(--line);
	}
	.hero .big {
		font-size: 28px;
		line-height: 1.15;
	}
	.hero-main {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.conf {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		white-space: nowrap;
	}
	.conf i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: currentColor;
	}
	.strip {
		margin-top: 10px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.strip-head {
		display: flex;
		align-items: baseline;
		gap: 6px;
		font-size: 12px;
	}
	.strip-head .rank-place {
		font-size: 14px;
	}
	.tie-chip {
		padding: 0 6px;
		border: 1px solid var(--line2);
		color: var(--fg2);
	}
	.lead {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		white-space: nowrap;
	}
	.hero-label {
		cursor: help;
	}
	.info {
		font-size: 10px;
		opacity: 0.7;
	}
	.rank-place {
		font-weight: 500;
	}
	.hero-sub {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		color: var(--fg2);
	}
	h3.kicker {
		margin: 0 0 4px;
		font-weight: 400;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin: 2px 0 0;
		padding: 0;
		list-style: none;
		font-size: 11px;
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.legend i {
		display: inline-block;
		flex: none;
	}
	.lg-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
	.lg-box {
		width: 12px;
		height: 8px;
		background: var(--bg3);
		border: 1px solid var(--fg3);
	}
	.axis-med {
		color: var(--fg);
	}
	.minmax > :last-child {
		text-align: right;
	}
	.lg-tail {
		width: 14px;
		height: 8px;
		background: linear-gradient(var(--fg3), var(--fg3)) center / 100% 1px no-repeat;
		border-left: 1px solid var(--fg3);
		border-right: 1px solid var(--fg3);
	}
	.lg-med {
		width: 2px;
		height: 11px;
		background: var(--fg);
	}
	.lg-band {
		width: 12px;
		height: 10px;
		opacity: 0.25;
	}
	.stats {
		grid-template-columns: repeat(4, 1fr);
		margin: 8px 0 0;
	}
	.stats > div {
		padding: 6px 8px;
	}
	.stats dd {
		margin: 0;
		font-size: 13px;
	}
	.record {
		gap: 10px;
	}
	.group dl {
		margin: 2px 0 0;
	}
	.group-title {
		font-weight: 500;
	}
	.kv {
		grid-template-columns: 96px 1fr;
	}
	.kv dd {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}
	.rlink {
		color: inherit;
		text-align: left;
		text-decoration: underline;
		text-decoration-color: var(--line2);
		text-underline-offset: 3px;
		word-break: break-word;
	}
	.rlink:hover {
		text-decoration-color: currentColor;
	}
	.ext {
		margin-left: 4px;
		color: var(--fg3);
		font-size: 11px;
	}
	.copy {
		flex: none;
		margin-left: auto;
		color: var(--fg3);
		font-size: 12px;
		line-height: 1;
		padding: 2px 4px;
	}
	.copy:hover {
		color: var(--fg);
	}
	.fine {
		font-size: 11px;
		color: var(--fg2);
	}
	.swap {
		display: inline-flex;
		margin-top: 8px;
		border: 1px solid var(--line2);
	}
	.swap button {
		padding: 3px 10px;
		font-size: 12px;
		color: var(--fg2);
	}
	.swap button.on {
		background: var(--line2);
		color: var(--fg);
	}
	.swap button:disabled:not(.on) {
		opacity: 0.4;
	}
	.swap button:not(:disabled):hover {
		color: var(--fg);
	}
	.lg-ring {
		box-shadow: 0 0 0 1.5px var(--bg2), 0 0 0 2.5px var(--fg);
	}
	.siblings {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.sib {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 8px;
		border: 1px solid var(--line2);
		font-size: 12px;
	}
	.sib:hover {
		border-color: var(--fg3);
	}
	.rating polyline,
	.rating path {
		fill: none;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.cmp {
		display: grid;
		grid-template-columns: 78px 1fr;
		gap: 8px;
		align-items: start;
	}
	/* The plot is 440 units wide with the rating in the last 20; keep the max label under the whisker. */
	.cmp-axis {
		padding-right: calc(100% * 20 / 440);
	}
	.cmp-label {
		padding-top: 6px;
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.link-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 9px;
		font-size: 12px;
		border: 1px solid var(--line2);
		color: var(--fg);
		text-decoration: none;
	}
	.link-btn:hover {
		border-color: var(--fg3);
	}
	.pcfg {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 0 10px;
		border-bottom: 1px solid var(--line);
	}
	.pcfg-head {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
	}
	.ptiles {
		grid-template-columns: repeat(3, 1fr);
		margin: 0;
	}
	.ptiles > div {
		padding: 5px 8px;
	}
	.ptiles dd {
		margin: 0;
	}
	.ptiles .lead-tile dd:first-of-type {
		font-weight: 600;
	}
	.hl {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.hl li {
		display: grid;
		grid-template-columns: 14px 1fr auto;
		gap: 8px;
		align-items: baseline;
		padding: 4px 0;
		font-size: 12px;
		border-bottom: 1px solid var(--line);
	}
	.hl-mark {
		font-size: 10px;
		color: var(--fg3);
	}
	.notes {
		margin: 6px 0 0;
		padding-left: 16px;
	}
	.notes li {
		padding: 1px 0;
	}
	.back {
		display: block;
		margin-bottom: 4px;
		color: var(--fg2);
		text-align: left;
	}
	.back:hover {
		color: var(--fg);
	}
	.contracts {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--line);
	}
	.contract {
		display: grid;
		grid-template-columns: 1fr auto 72px;
		gap: 10px;
		align-items: baseline;
		width: 100%;
		padding: 5px 2px;
		font-size: 12px;
		text-align: left;
		border-bottom: 1px solid var(--line);
	}
	.contract.test {
		grid-template-columns: 14px 1fr auto;
	}
	.diag {
		padding: 2px 2px 6px 26px;
		border-bottom: 1px solid var(--line);
	}
	.diag pre {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 160px;
		overflow: auto;
		font-size: 10px;
		margin: 4px 0 0;
	}
	.backends {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
		margin-bottom: 4px;
	}
	.backends button {
		font-size: 11px;
		border: 1px solid var(--line2);
		padding: 3px 7px;
		color: var(--fg2);
	}
	.backends button[aria-pressed='true'] {
		background: var(--line2);
		color: var(--fg);
	}
	.version-tag {
		font-size: 11px;
		color: var(--fg3);
	}
	.heat-chip {
		width: 22px;
		height: 22px;
		border: 1px solid var(--line2);
	}
	.contract.static {
		grid-template-columns: 1fr auto;
	}
	button.contract:hover {
		background: var(--hover);
	}
	.cname {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rel {
		text-align: right;
		color: var(--fg2);
	}
	.more {
		align-self: flex-start;
		margin-top: 4px;
		color: var(--fg2);
		text-decoration: underline;
		text-decoration-color: var(--line2);
		text-underline-offset: 3px;
	}
	.foot {
		position: sticky;
		bottom: 0;
		margin-top: auto;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		padding: 12px 16px;
		background: var(--bg2);
		border-top: 1px solid var(--line);
	}
	.foot > * {
		text-align: center;
		padding: 8px 10px;
	}
	.desc {
		font-size: 12px;
		color: var(--fg2);
		background: var(--bg3);
		padding: 10px;
		white-space: pre-wrap;
	}
	.kv {
		display: grid;
		gap: 8px;
		font-size: 12px;
		border-bottom: 1px solid var(--line);
		padding: 3px 0;
	}
	.kv .mono,
	.brk {
		word-break: break-word;
	}
	.between {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.primary {
		background: var(--fg);
		color: var(--bg);
		padding: 5px 10px;
		font-size: 12px;
		text-decoration: none;
	}
	.outline {
		border: 1px solid var(--line2);
		padding: 5px 10px;
		font-size: 12px;
	}
	.fail {
		border: 1px solid var(--line);
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
	}
	.expact {
		display: grid;
		grid-template-columns: 70px 1fr;
		gap: 2px 8px;
	}
	@media (max-width: 420px) {
		.stats {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
