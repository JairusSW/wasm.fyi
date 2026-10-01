/** Integer with thousands separators. */
export const n0 = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Repository provenance stays in the evidence key, outside the workload name. */
export const workloadName = (id: string): string => id.replace(/^wago\//, '');

/** Ratio as a multiplier, e.g. `1.42×`. */
export const fx = (r: number): string =>
	(r >= 100 ? r.toFixed(0) : r >= 10 ? r.toFixed(1) : r.toFixed(2)) + '×';

/** Signed percentage using a true minus sign, e.g. `−3.1%`. */
export const pct = (d: number, p = 1): string =>
	(d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d * 100).toFixed(p) + '%';

export type DeltaFormat = 'factor' | 'percent';
/** The same relative quantity: 1.3× = +30%, and 0.7× = −30%. */
export const relative = (ratio: number, format: DeltaFormat = 'factor'): string =>
	format === 'percent' ? pct(ratio - 1) : fx(ratio);

/** Value in its natural unit, rescaled to stay readable (µs ↔ ms ↔ s, KB ↔ MB). */
export const fmtU = (v: number, u: string): string => {
	if (u === 'ms')
		return v < 1
			? (v * 1000).toFixed(v < 0.1 ? 1 : 0) + ' µs'
			: v < 10
				? v.toFixed(2) + ' ms'
				: v < 1000
					? v.toFixed(1) + ' ms'
					: (v / 1000).toFixed(2) + ' s';
	if (u === 'µs') return v < 1000 ? v.toFixed(v < 10 ? 2 : 1) + ' µs' : (v / 1000).toFixed(2) + ' ms';
	if (u === 'MB') return v.toFixed(1) + ' MB';
	if (u === 'KB') return v >= 1024 ? (v / 1024).toFixed(2) + ' MB' : v.toFixed(0) + ' KB';
	if (u === 'MiB') return v.toFixed(1) + ' MiB';
	if (u === 'KiB') return v >= 1024 ? (v / 1024).toFixed(2) + ' MiB' : v.toFixed(0) + ' KiB';
	return String(v);
};

/** `v` as a percentage of `tot`, for positioning overlays on scaled SVGs. */
export const pc = (v: number, tot: number): string => ((v / tot) * 100).toFixed(2) + '%';

export const geomean = (xs: number[]): number => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length);
