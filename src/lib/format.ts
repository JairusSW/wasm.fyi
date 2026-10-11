/** Integer with thousands separators. */
export const n0 = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Repository provenance stays in the evidence key, outside the workload name. */
export const workloadName = (id: string): string => id==='mechanisms/wasm-host-wasm-loop'?'Wasm → host → Wasm':id==='mechanisms/host-to-wasm-call'?'Host → Wasm → host':id.replace(/^(wago|applications)\//, '').replace(/\/polybench_run$/, '');

/** Compact count for headline figures: `9,412`, `48.2K`, `1.38M`. Below 10,000 keeps commas. */
export const shortCount = (n: number): string => {
	const a = Math.abs(n);
	if (a < 10_000) return n0(n);
	const [d, suffix] = a < 1e6 ? [1e3, 'K'] : a < 1e9 ? [1e6, 'M'] : [1e9, 'B'];
	const v = n / d;
	return (Math.abs(v) < 10 ? v.toFixed(2) : Math.abs(v) < 100 ? v.toFixed(1) : v.toFixed(0)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + suffix;
};

/** Ratio as a multiplier, e.g. `1.42×`. */
export const fx = (r: number): string =>
	(r >= 100 ? r.toFixed(0) : r >= 10 ? r.toFixed(1) : r.toFixed(2)) + '×';

/** Signed percentage using a true minus sign, e.g. `−3.1%`. */
export const pct = (d: number, p = 1): string =>
	(d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d * 100).toFixed(p) + '%';

export type DeltaFormat = 'factor' | 'percent';
/** The same relative quantity: 1.3× = +30%, and 0.7× = −30%. */
export const relative = (ratio: number, format: DeltaFormat = 'percent'): string =>
	format === 'percent' ? pct(ratio - 1) : fx(ratio);

const compact = (value:number, digits:number) => {
	const rounded=Number(value.toFixed(digits));
	if(value!==0 && rounded===0)return '<'+(1/10**digits).toString();
	return rounded.toString();
};
const timeUnits=['ns','µs','ms','s'] as const;
type TimeUnit=typeof timeUnits[number];
const timeValue=(v:number,u:string)=>u==='µs'?v/1000:v;
const timeIndex=(ms:number)=>ms<0.001?0:ms<1?1:ms<1000?2:3;
const scaledTime=(ms:number,index:number)=>ms*[1e6,1e3,1,1/1000][index];
/** At most three significant figures (trailing zeros dropped). */
const sig3=(value:number)=>{const a=Math.abs(value);return compact(value,a<10?2:a<100?1:0);};
const timeText=(value:number,unit:TimeUnit)=>sig3(value)+' '+unit;

/** Value in its natural unit, rescaled to stay readable (ns ↔ µs ↔ ms ↔ s). */
export const fmtU = (v: number, u: string): string => {
	// Every unit: the largest one that keeps the value under 1000, at most three significant figures.
	if (u === 'ms' || u === 'µs' || u === 'ns') {
		const ms=u==='ns'?v/1e6:timeValue(v,u);
		let index=timeIndex(Math.abs(ms));
		// 999.7 µs rounds to "1000 µs"; step up so it reads "1 ms".
		if(index<timeUnits.length-1&&Math.abs(Number(sig3(scaledTime(ms,index))))>=1000)index++;
		return timeText(scaledTime(ms,index),timeUnits[index]);
	}
	const scale=(value:number,units:string[])=>{let i=0;while(i<units.length-1&&Math.abs(Number(sig3(value)))>=1000){value/=1024;i++;}return sig3(value)+' '+units[i];};
	if (u === 'MB' || u === 'KB') return scale(u === 'MB' ? v : v / 1024, ['MB', 'GB']).replace(/^(\S+) MB$/, (m, n) => (u === 'KB' && Number(n) < 1 ? sig3(v) + ' KB' : m));
	if (u === 'MiB') return scale(v, ['MiB', 'GiB']);
	if (u === 'KiB') return v * 1024 < 1000 ? n0(Math.round(v * 1024)) + ' B' : scale(v, ['KiB', 'MiB', 'GiB']);
	return String(v);
};

/** Mark a displayed aggregate mean without changing its units or precision. */
export const fmtAverage = (v: number, u: string): string => '~' + fmtU(v, u);

/** Format a row of values, each in its own best unit at three significant figures. */
export const fmtUGroup = (values:(number|null)[],u:string):string[] => values.map(v=>v==null||!Number.isFinite(v)?'':fmtU(v,u));

/** `v` as a percentage of `tot`, for positioning overlays on scaled SVGs. */
export const pc = (v: number, tot: number): string => ((v / tot) * 100).toFixed(2) + '%';

export const geomean = (xs: number[]): number => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length);
