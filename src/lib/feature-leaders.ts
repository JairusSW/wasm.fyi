/** Cross-feature rankings: support breadth and feature performance. Shared by the Features page and the home page. */
import { COMPAT, FEATURE_ROWS } from './data/features';
import { CB, FEATURE_CFG } from './data/runtimes';
import type { Cfg, CfgId } from './data/types';
import { familyCohort, featureAverage } from './feature-values';
import { featureContracts, type Scope } from './model';
import { engineFeatureVersions, runtimeFeatureTrack } from './support';
import { shortVersion } from './version-identity';

/** Configurations with a collected feature run on the selected machine, as the Features page lists them. */
export const featureColumns = (s: Scope) =>
	FEATURE_CFG.filter((c) => !s.hide[c.id] && (['stable', 'development'] as const).some((channel) => engineFeatureVersions(c.rt, s, channel).length > 0));

/** One entry per configuration (backend): fully passed families and the corpus pass rate. */
export function featureSupport(s: Scope) {
	const fams = FEATURE_ROWS.filter((f) => featureContracts(f.id).length > 0);
	const engines = FEATURE_CFG.filter((c) => !s.hide[c.id] && (['stable', 'development'] as const).some((channel) => engineFeatureVersions(c.rt, s, channel, c.id).length > 0)).map((c) => {
		const channel = engineFeatureVersions(c.rt, s, 'stable', c.id).length ? 'stable' : 'development';
		const tracks = fams.map((f) => ({ f, t: runtimeFeatureTrack(c.rt, f, s, channel, undefined, c.id) }));
		const full = tracks.filter(({ t }) => t.expected > 0 && t.pass === t.expected);
		const passed = tracks.reduce((sum, { t }) => sum + t.pass, 0);
		const total = tracks.reduce((sum, { t }) => sum + t.expected, 0);
		return {
			c,
			release: shortVersion(engineFeatureVersions(c.rt, s, channel, c.id)[0] ?? '').replace(/\/source-.*/, ''),
			full: full.length,
			rate: total ? passed / total : 0,
			passed,
			total
		};
	});
	return { families: fams.length, engines: engines.filter((e) => e.total > 0) };
}

/**
 * Average per-feature time for each ranked configuration. Absolute times only compare over the
 * same features, so runtimes are ranked on the features measured by every ranked runtime.
 */
export function featureSpeed(s: Scope, cols: CfgId[], metric: 'steady' | 'compile') {
	const ids = cols.filter((id) => CB[id]);
	const fams = COMPAT.flatMap((sec) => sec.fams)
		.map((f) => {
			const comparison = familyCohort(s, f.id, cols, metric);
			return { values: ids.map((id) => comparison.values[cols.indexOf(id)]) };
		})
		.filter((x) => x.values.some((v) => v != null));
	const minFamilies = Math.max(3, Math.ceil(fams.length / 2));
	let cand = ids.map((id, k) => ({ id, k, n: fams.filter((x) => x.values[k] != null).length })).filter((x) => x.n >= minFamilies);
	let shared = fams.filter((x) => cand.every((c) => x.values[c.k] != null));
	// Too few features in common: drop the runtime with the narrowest coverage and retry.
	while (shared.length < 3 && cand.length > 2) {
		cand = [...cand].sort((a, b) => b.n - a.n).slice(0, -1);
		shared = fams.filter((x) => cand.every((c) => x.values[c.k] != null));
	}
	const score = (k: number) => featureAverage(shared.map((x) => x.values[k]!), s.average)!;
	const ranked: { c: Cfg; v: number }[] = shared.length ? cand.map((c) => ({ c: CB[c.id], v: score(c.k) })) : [];
	return { ranked, shared: shared.length, families: fams.length, minFamilies };
}
