import { CFG } from './data/runtimes';
import type { Cfg, OvKey } from './data/types';
import { fmtUGroup } from './format';
import { absOf, isVisible, type Scope } from './model';
import { viewCell } from './view-data';

const positive = (value: number | null | undefined): value is number => value != null && Number.isFinite(value) && value > 0;

/** Equal-weight geometric mean of slowdowns; units and category scales cancel. */
export function overallScores<T>(rows: {item:T; values:(number | null | undefined)[]}[]) {
	const complete = rows.filter(row => row.values.length === 5 && row.values.every(positive));
	if (!complete.length) return [];
	const fastest = Array.from({length:5}, (_, i) => Math.min(...complete.map(row => row.values[i]!)));
	return complete.map(row => ({item:row.item, score:Math.exp(row.values.reduce<number>((sum, value, i) => sum + Math.log(value! / fastest[i]), 0) / 5)}))
		.sort((a,b) => a.score - b.score);
}

export function callRoundTrip(scope: Scope, config: Cfg) {
	const cells = ['mechanisms/wasm-to-host-call', 'mechanisms/host-to-wasm-call'].map(workload => viewCell(scope.machine, scope.snapshot || 's1', workload, config.id, 'steady'));
	return cells.every(cell => cell.st === 'ok' && positive(cell.v)) ? cells[0].v! + cells[1].v! : null;
}

export function extraLeaders(scope: Scope) {
	const configs = CFG.filter(config => isVisible(scope, config));
	const calls = configs.map(cfg => ({cfg, value:callRoundTrip(scope, cfg)}))
		.filter((row):row is {cfg:Cfg; value:number} => positive(row.value)).sort((a,b) => a.value - b.value);
	const times = fmtUGroup(calls.map(row => row.value), 'ms');
	const overall = overallScores(configs.map(cfg => ({item:cfg, values:[
		absOf(scope, 'lat', cfg.id, 0)?.v,
		absOf(scope, 'lat', cfg.id, 1)?.v,
		absOf(scope, 'lat', cfg.id, 3)?.v,
		callRoundTrip(scope, cfg),
		absOf(scope, 'code', cfg.id, 3)?.v
	]})));
	return [
		{label:'Best overall', metric:'steady' as const, overview:'lat' as OvKey,
			note:'Equal-weight geometric mean of slowdowns versus the fastest complete entrant in compilation, instantiation, steady execution, estimated call round trip and extracted native image size. Lower is better; 1× leads every category. Requires all five measurements. Rankings describe measured values, not statistical significance.',
			places:overall.map((row,i) => ({place:i+1, cfg:row.item, value:row.score.toFixed(2)+'×', ratio:row.score})),
			versus:'No selected runtime has all five measurements.'},
		{label:'Fastest host ↔ Wasm call', metric:'steady' as const, overview:'calls' as OvKey,
			note:'Estimated round trip: sum of the measured Host → Wasm and Wasm → host steady-call medians. This is not an independently measured nested round trip. Ranks measured values; uncertainty is not combined.',
			places:calls.map((row,i) => ({place:i+1, cfg:row.cfg, value:times[i], ratio:row.value/calls[0].value})),
			versus:'No selected runtime has both call directions.'}
	];
}
