// Minimal linear/log scales with readable ticks.

export interface Scale {
	(v: number): number;
	ticks: number[];
	log: boolean;
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
	if (!(hi > lo)) return [lo];
	const step0 = (hi - lo) / count;
	const mag = 10 ** Math.floor(Math.log10(step0));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => (hi - lo) / s <= count) ?? 10 * mag;
	const out: number[] = [];
	for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
	return out;
}

export function logTicks(lo: number, hi: number): number[] {
	const out: number[] = [];
	for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
		for (const m of [1, 2, 5]) {
			const v = m * 10 ** e;
			if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
		}
	if (out.length > 7) return out.filter((v) => Math.abs(Math.log10(v) % 1) < 1e-9);
	return out.length >= 2 ? out : [lo, hi];
}

/** Maps [lo, hi] to [a, b]. Log scales require positive domains. */
export function scale(lo: number, hi: number, a: number, b: number, log = false, pad = 0.06): Scale {
	if (log) {
		const l0 = Math.log(lo) - pad;
		const l1 = Math.log(hi) + pad;
		const f = ((v: number) => a + ((Math.log(v) - l0) / (l1 - l0 || 1)) * (b - a)) as Scale;
		f.ticks = logTicks(Math.exp(l0), Math.exp(l1));
		f.log = true;
		return f;
	}
	const span = hi - lo || Math.abs(hi) || 1;
	const d0 = lo >= 0 && lo - span * pad < 0 ? 0 : lo - span * pad;
	const d1 = hi + span * pad;
	const f = ((v: number) => a + ((v - d0) / (d1 - d0 || 1)) * (b - a)) as Scale;
	f.ticks = niceTicks(d0, d1);
	f.log = false;
	return f;
}

export const extent = (xs: number[]): [number, number] => {
	const v = xs.filter((x) => Number.isFinite(x));
	return v.length ? [Math.min(...v), Math.max(...v)] : [0, 1];
};
