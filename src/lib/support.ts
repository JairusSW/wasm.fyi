import { viewData } from './view-data';
import { FEATURE_CFG, configVersion } from './data/runtimes';
import { compatCell, featureContracts, type Scope } from './model';
// Feature-support cell helpers shared by the Features matrix and proposal pages.
import { SUPC } from './data/features';
import type { FeatureRow, SupportCode } from './data/types';

export const supportCell = (code: SupportCode) => ({
	glyph: SUPC[code][0],
	text: SUPC[code][1],
	color: code === 'y' || code === 'f' || code === 'p' ? 'var(--fg)' : 'var(--fg3)',
	bg:
		code === 'y'
			? 'oklch(0.72 0.14 150 / 0.18)'
			: code === 'f' || code === 'p'
				? 'oklch(0.77 0.14 60 / 0.16)'
				: 'transparent'
});

/** Browser cells hold the first version enabled by default, or a support code. */
export const browserCell = (v: string) =>
	/^\d/.test(v) ? { ...supportCell('y'), text: v } : supportCell(v as SupportCode);

/** Support follows recorded configurations, with explicit experimental flags. */
export const supportOf = (rid:string,f:FeatureRow,scope:Scope):SupportCode => {
  if(rid==='wago' && pluginSupportEvidence(f.id,scope.machine))return 'y';
  const counts=FEATURE_CFG.filter(c=>c.rt===rid).map(c=>({config:c,result:compatCell(f.id,c.id,scope)})).filter(x=>x.result.run);
  if(!counts.length)return '?';
  const complete=counts.filter(({result:c})=>c.total>0 && c.pass===c.total);
  if(complete.some(x=>x.config.id!=='S'))return 'y';
  if(complete.length)return 'f';
  return counts.some(x=>x.result.pass>0)?'p':'?';
};

/** Documented plugin availability is distinct from a sealed adapter test result. */
export const WAGO_PLUGIN_SUPPORT:Record<string,{plugin:string;source:string}> = {
  'wasi-p1':{plugin:'wago-org/wasi',source:'https://github.com/wago-org/wasi'},
  'wasi-p2':{plugin:'wago-org/wasi',source:'https://github.com/wago-org/wasi'},
  'component-model':{plugin:'wago-org/component-model',source:'https://github.com/wago-org/component-model'},
  'cm-abi':{plugin:'wago-org/component-model',source:'https://github.com/wago-org/component-model'},
  'cm-res':{plugin:'wago-org/component-model',source:'https://github.com/wago-org/component-model'},
  'cm-async':{plugin:'wago-org/component-model',source:'https://github.com/wago-org/component-model'}
};
export function runtimeSupportCell(rid:string,f:FeatureRow,scope:Scope) {
  // WASI is an embedding API, not a proposal implemented by V8 itself.
  // The Node-backed adapter can run Preview 1, but no sealed corpus run for
  // that adapter identity exists yet, so show availability without implying a pass.
  if(rid==='v8' && f.id==='wasi-p1')return {...supportCell('?'),text:'Node host API · unmeasured',detail:'Node.js provides a WASI Preview 1 host for V8 modules, and the benchmark adapter now exposes wasi-command. A sealed V8/Node WASI corpus run has not been collected yet.'};
  const code=supportOf(rid,f,scope);
  const plugin=rid==='wago'?WAGO_PLUGIN_SUPPORT[f.id]:undefined;
  const configurations=FEATURE_CFG.filter(c=>c.rt===rid).map(c=>({c,result:compatCell(f.id,c.id,scope)})).filter(x=>x.result.run);
  const best=[...configurations].sort((a,b)=>b.result.pass-a.result.pass || a.result.fail-b.result.fail)[0];
  const suite=plugin?pluginSupportEvidence(f.id,scope.machine):undefined;
  const detail=[
    ...(suite?[`${suite.label}: ${suite.passed}/${suite.total} passed, ${suite.failed} failed, ${suite.skipped} skipped (${suite.version}). ${plugin!.source}`]:[]),
    ...configurations.map(({c,result:r})=>`${c.be} · ${configVersion(scope.machine,c.id)}: ${r.pass}/${r.total} passed, ${r.fail+r.crash} failed, ${r.skip} skipped`)
  ].join('\n');
  if(plugin && !best && suite)return {...supportCell('y'),text:'supported via plugin',detail:`Published correctness suite supports this plugin. No benchmark contracts were collected for this feature. ${detail}`};
  if(plugin && !best && code==='?')return {...supportCell('p'),text:'via plugin',detail:`Available through ${plugin.plugin}; no benchmark contracts collected. ${plugin.source}`};
  if(!best)return {...supportCell('?'),text:'not collected',detail:'No sealed feature experiment for this engine on the selected host.'};
  if(plugin){
    const measuredCode:SupportCode=best.result.total>0&&best.result.pass===best.result.total?'y':best.result.pass>0?'p':'?';
    const failed=best.result.fail+best.result.crash>0;
    return {...supportCell(measuredCode),glyph:measuredCode==='?'&&failed?'✕':supportCell(measuredCode).glyph,
      color:measuredCode==='?'&&failed?'var(--st-fail)':supportCell(measuredCode).color,
      text:best.result.pass===best.result.total?'corpus passed':best.result.pass?'partial corpus':failed?'rejected / failed':'adapter unsupported',detail};
  }
  if(code==='?' && best.result.fail+best.result.crash)return {...supportCell('?'),glyph:'✕',text:'rejected / failed',color:'var(--st-fail)',detail};
  return {...supportCell(code),text:code==='y'?'corpus passed':code==='f'?'corpus passed · flag':code==='p'?'partial corpus':'adapter unsupported',detail};
}

export function engineFeatureVersions(rid:string,scope:Scope,channel:'stable'|'development') {
  const ids=FEATURE_CFG.filter(c=>c.rt===rid && viewData.configurations[c.id]!=='v8-wasmfx').map(c=>c.id);
  return [...new Set(viewData.featureVersions[scope.machine].filter(v=>ids.some(id=>viewData.configurations[id]===v.id) && v.channel===channel).map(v=>v.version))];
}
export function runtimeFeatureTrack(rid:string,f:FeatureRow,scope:Scope,channel:'stable'|'development',version?:string) {
  if(rid==='v8' && f.id==='wasi-p1')return {...supportCell('?'),text:'Node host API · unmeasured',detail:'Node.js provides a WASI Preview 1 host for V8 modules, and the benchmark adapter now exposes wasi-command. A sealed V8/Node WASI corpus run has not been collected yet.',version:'',channel,expected:featureContracts(f.id).length,pass:0,configurations:[]};
  const selected=version || engineFeatureVersions(rid,scope,channel)[0];
  const ids=FEATURE_CFG.filter(c=>c.rt===rid).map(c=>viewData.configurations[c.id]);
  // One pinned identity supplies a complete family; older identities and other
  // compiler modes cannot fill its missing contracts.
  const candidates=viewData.featureVersions[scope.machine].filter(v=>ids.includes(v.id) && v.channel===channel && v.version===selected);
  const latest=new Map<string,(typeof candidates)[number]>();
  for(const v of candidates)if(!latest.has(v.id))latest.set(v.id,v);
  const counts=[...latest.values()].flatMap(v=>{const x=v.features.find(x=>x.id===f.id);return x && x.total>0?[{v,f:x}]:[];});
  const expected=featureContracts(f.id).length;
  const complete=counts.filter(x=>x.f.total===expected && x.f.pass===expected);
  const code:SupportCode=complete.length?'y':counts.some(x=>x.f.pass>0)?'p':'?';
  const failed=counts.some(x=>x.f.failed>0);
  const detail=counts.map(({v,f})=>`${v.description.backend} · ${v.version}: ${f.pass}/${expected} passed, ${f.failed} failed, ${f.unsupported} unsupported\n${f.reasons.join('\n')}`).join('\n');
  const best=complete[0] || [...counts].sort((a,b)=>b.f.pass-a.f.pass || a.f.failed-b.f.failed)[0];
  return {...supportCell(code),glyph:code==='?'&&failed?'✕':supportCell(code).glyph,
    color:code==='?'&&failed?'var(--st-fail)':supportCell(code).color,
    text:!counts.length?'not collected':code==='y'?'corpus passed':code==='p'?'partial corpus':failed?'rejected / failed':'adapter unsupported',detail,
    version:selected || '',channel,expected,pass:best?.f.pass || 0,
    configurations:counts.map(({v,f})=>({id:v.id,backend:v.description.backend,version:v.version,collectedAt:v.collectedAt,source:v.source,pass:f.pass,total:expected,failed:f.failed,skipped:f.total-f.pass-f.failed,missing:expected-f.total,contracts:f.contracts}))};
}

export type FeatureTrack = ReturnType<typeof runtimeFeatureTrack>;

/** Official/plugin suite evidence remains separate from performance contracts. */
import pluginInput from './data/plugin-tests.json';
export interface PluginTestEvidence {scope?:string;label:string;official:boolean;passed:number;failed:number;skipped:number;total:number;created:string;version:string;engine:string;evidence:string}
export const pluginTests=pluginInput as Record<'m1'|'m2',Partial<Record<string,PluginTestEvidence>>>;

export function pluginSupportEvidence(feature:string,machine:'m1'|'m2') {
  if(!WAGO_PLUGIN_SUPPORT[feature])return undefined;
  return pluginTests[machine][feature];
}
