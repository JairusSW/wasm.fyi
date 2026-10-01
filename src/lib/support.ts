import { CFG } from './data/runtimes';
import { compatCell, type Scope } from './model';
// Feature-support cell helpers shared by the Features matrix and proposal pages.
import { SUPC } from './data/features';
import { RTB, SA } from './data/runtimes';
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

/** Support code for a runtime: engines follow their browser, standalone runtimes use `SA` order. */
export const supportOf = (rid:string,f:FeatureRow,scope:Scope):SupportCode => {
  const counts=CFG.filter(c=>c.rt===rid).map(c=>compatCell(f.id,c.id,scope));
  if(!counts.length || counts.every(c=>!c.run))return '?';
  const total=counts.reduce((n,c)=>n+c.total,0),pass=counts.reduce((n,c)=>n+c.pass,0);
  return total>0 && pass===total?'y':pass>0?'p':'?';
};

/** Documented plugin availability is distinct from a sealed adapter test result. */
export const WAGO_PLUGIN_SUPPORT:Record<string,{plugin:string;source:string}> = {
  'wasi-p1':{plugin:'wago-org/wasi',source:'https://github.com/wago-org/wasi'},
  'wasi-p2':{plugin:'wago-org/wasi',source:'https://github.com/wago-org/wasi'},
  'component-model':{plugin:'wago-org/component-model',source:'https://github.com/wago-org/component-model'}
};
export function runtimeSupportCell(rid:string,f:FeatureRow,scope:Scope) {
  const code=supportOf(rid,f,scope);
  const plugin=rid==='wago'?WAGO_PLUGIN_SUPPORT[f.id]:undefined;
  if(plugin && code==='?')return {...supportCell('p'),text:'via plugin',detail:`Available through ${plugin.plugin}. Plugin configuration has not been benchmarked here. ${plugin.source}`};
  return {...supportCell(code),text:code==='y'?'corpus passed':code==='p'?'partial corpus':'not verified',detail:''};
}
