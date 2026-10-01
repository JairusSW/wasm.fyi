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
