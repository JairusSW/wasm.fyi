// The one heatmap scale used everywhere: oklch(0.74 0.12 H / α), α ≤ 0.34.

const HUE = { good: 165, mid: 90, bad: 30 } as const;
type Tone = keyof typeof HUE;

export const heatColor = (tone: Tone, a: number): string =>
	`oklch(0.74 0.12 ${HUE[tone]} / ${Math.min(0.34, a).toFixed(3)})`;

/**
 * Ratio cells (latency / memory / code vs baseline). Within ±0.04 log2 units the
 * cell stays transparent; faster is green, slower is yellow then red past 0.6.
 */
export const heatRatio = (r: number | null | undefined): string => {
	if (r == null || !Number.isFinite(r)) return 'transparent';
	const l = Math.abs(Math.log2(r));
	if (l < 0.04) return 'transparent';
	const a = l * 0.085 + 0.04;
	return r < 1 ? heatColor('good', a) : heatColor(l < 0.6 ? 'mid' : 'bad', a);
};

/** Count cells: `b` is badness normalized within the column across visible runtimes, 0…1. */
export const heatCount = (b: number): string =>
	b < 0.2
		? heatColor('good', 0.2 - b * 0.5)
		: b < 0.6
			? heatColor('mid', 0.1 + b * 0.25)
			: heatColor('bad', 0.1 + b * 0.25);

/**
 * Diverging scale for field cells, `t` in -1 (best) … 1 (worst). Near 0 stays transparent;
 * further from the middle the green or red gets stronger and lighter.
 */
export const heatDiverge = (t: number): string => {
	const m = Math.min(1, Math.abs(t));
	if (m < 0.06) return 'transparent';
	// A little past the shared cap at the far ends, for more variation across the field.
	return `oklch(0.76 0.13 ${t < 0 ? 160 : 28} / ${(0.06 + 0.38 * m).toFixed(3)})`;
};

/**
 * Field cells (lower is better): the mean of the shown runtimes is the neutral middle. Values
 * are compared on a log scale when all are positive, so the mean is the geometric mean and one
 * outlier doesn't wash out the rest. The best value is the darkest green, the worst the darkest red.
 */
export function heatFields(values: readonly (number|null|undefined)[]):string[] {
 const measured=values.filter((x):x is number=>x!=null&&Number.isFinite(x));
 if(measured.length<2)return values.map(()=>'transparent');
 const f=measured.every(x=>x>0)?Math.log:(x:number)=>x;
 const xs=measured.map(f),mid=xs.reduce((a,b)=>a+b,0)/xs.length;
 const lo=Math.min(...xs),hi=Math.max(...xs);
 return values.map(v=>{
  if(v==null||!Number.isFinite(v))return 'transparent';
  const d=f(v)-mid;
  return heatDiverge(d<0?(mid>lo?d/(mid-lo):0):hi>mid?d/(hi-mid):0);
 });
}
export const heatField=(values:readonly (number|null|undefined)[],i:number):string=>heatFields(values)[i];

/** Correctness has an absolute scale: only a complete pass is green. */
export function heatCorrectness(passed:number,total:number):string {
 if(total<=0||!Number.isFinite(passed)||!Number.isFinite(total))return 'transparent';
 const missing=Math.max(0,Math.min(total,total-passed));
 if(!missing)return heatColor('good',0.30);
 const severity=Math.min(1,Math.sqrt((missing/total)/0.10));
 return `oklch(0.74 0.14 ${(120-90*severity).toFixed(1)} / 0.300)`;
}
