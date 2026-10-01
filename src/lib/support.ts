import { FEATURE_CFG, configVersion } from './data/runtimes';
import { compatCell, type Scope } from './model';
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
  const code=supportOf(rid,f,scope);
  const plugin=rid==='wago'?WAGO_PLUGIN_SUPPORT[f.id]:undefined;
  if(plugin && code==='?')return {...supportCell('p'),text:'via plugin',detail:`Available through ${plugin.plugin}. Plugin configuration has not been benchmarked here. ${plugin.source}`};
  const configurations=FEATURE_CFG.filter(c=>c.rt===rid).map(c=>({c,result:compatCell(f.id,c.id,scope)})).filter(x=>x.result.run);
  const best=[...configurations].sort((a,b)=>b.result.pass-a.result.pass || a.result.fail-b.result.fail)[0];
  const detail=configurations.map(({c,result:r})=>`${c.be} · ${configVersion(scope.machine,c.id)}: ${r.pass}/${r.total} passed, ${r.fail+r.crash} failed, ${r.skip} skipped`).join('\n');
  if(!best)return {...supportCell('?'),text:'not collected',detail:'No sealed feature experiment for this engine on the selected host.'};
  if(code==='?' && best.result.fail+best.result.crash)return {...supportCell('?'),glyph:'✕',text:'rejected / failed',color:'var(--st-fail)',detail};
  return {...supportCell(code),text:code==='y'?'corpus passed':code==='f'?'corpus passed · flag':code==='p'?'partial corpus':'adapter unsupported',detail};
}
