/** Integer with thousands separators. */
export const n0 = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Repository provenance stays in the evidence key, outside the workload name. */
export const workloadName = (id: string): string => id==='mechanisms/wasm-host-wasm-loop'?'Wasm → host → Wasm':id==='mechanisms/host-to-wasm-call'?'Host → Wasm → host':id.replace(/^(wago|applications)\//, '');

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
const timeText=(value:number,unit:TimeUnit)=>{
	const a=Math.abs(value),digits=a<10?2:a<100?1:0;
	return compact(value,digits)+' '+unit;
};

/** Value in its natural unit, rescaled to stay readable (ns ↔ µs ↔ ms ↔ s). */
export const fmtU = (v: number, u: string): string => {
	if (u === 'ms' || u === 'µs') {
		const ms=timeValue(v,u),index=timeIndex(Math.abs(ms));
		return timeText(scaledTime(ms,index),timeUnits[index]);
	}
	if (u === 'ns') return timeText(v,'ns');
	if (u === 'MB') return v.toFixed(1) + ' MB';
	if (u === 'KB') return v >= 1024 ? (v / 1024).toFixed(2) + ' MB' : v.toFixed(0) + ' KB';
	if (u === 'MiB') return v.toFixed(1) + ' MiB';
	if (u === 'KiB') return v >= 1024 ? (v / 1024).toFixed(2) + ' MiB' : v < 1.5 ? n0(v * 1024) + ' B' : compact(v, 1) + ' KiB';
	return String(v);
};

/** Keep a row of comparable latencies in one unit when their range allows it. */
export const fmtUGroup = (values:(number|null)[],u:string):string[] => {
	if(u!=='ms'&&u!=='µs')return values.map(v=>v==null?'':fmtU(v,u));
	const valid=values.filter((v):v is number=>v!=null&&Number.isFinite(v));
	if(!valid.length)return values.map(()=>'');
	const ms=valid.map(v=>timeValue(v,u));
	const sorted=[...ms].sort((a,b)=>Math.abs(a)-Math.abs(b));
	const median=Math.abs(sorted[sorted.length>>1]);
	const preferred=timeIndex(median);
	const min=Math.min(...ms.map(Math.abs)),max=Math.max(...ms.map(Math.abs));
	const candidates=[preferred,preferred-1,preferred+1].filter(i=>i>=0&&i<timeUnits.length);
	const shared=candidates.find(i=>scaledTime(min,i)>=1&&scaledTime(max,i)<10_000);
	if(shared==null)return values.map(v=>v==null?'':fmtU(v,u));
	return values.map(v=>v==null?'':timeText(scaledTime(timeValue(v,u),shared),timeUnits[shared]));
};

/** `v` as a percentage of `tot`, for positioning overlays on scaled SVGs. */
export const pc = (v: number, tot: number): string => ((v / tot) * 100).toFixed(2) + '%';

export const geomean = (xs: number[]): number => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length);
