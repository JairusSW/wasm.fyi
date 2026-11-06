import { bakePageSeed } from './api/controller.svelte';
import type { Cfg, MachineId } from './data/types';
import { featureColumns, featureSpeed, featureSupport } from './feature-leaders';
import type { Scope } from './model';
import { ui } from './state.svelte';

/** Display identity of a ranked configuration; engines outside the static list only exist once their data loads. */
export type FeatureEntrant = Pick<Cfg, 'id' | 'rt' | 'be' | 'col' | 'hollow'>;
/** Home-page preview of the Features leaders: support breadth and feature execution speed. */
export interface FeatureSummary {
	/** Feature families with corpus tests, and each leader's fully passed count. */
	support: { families: number; top: { who: FeatureEntrant; full: number }[] };
	/** Average per-feature execution time over contracts that pass on every listed runtime. */
	speed: { shared: number; top: { who: FeatureEntrant; ms: number }[] };
}
export type FeatureSummaries = Partial<Record<MachineId, FeatureSummary>>;

const TOP = 5;

const entrant = ({ id, rt, be, col, hollow }: Cfg): FeatureEntrant => ({ id, rt, be, col, hollow });

export function summarizeFeatures(scope: Scope): FeatureSummary {
	const { families, engines } = featureSupport(scope);
	// Few contracts pass on every engine, so pick the leaders on their own passed contracts,
	// then compare just those leaders over the contracts all of them pass.
	const perEngine: Scope = { ...scope, cohortMode: 'per-engine' };
	const leaders = [...featureSpeed(perEngine, featureColumns(perEngine).map((c) => c.id), 'steady').ranked].sort((a, b) => a.v - b.v).slice(0, TOP);
	const { ranked, shared } = featureSpeed({ ...scope, cohortMode: 'shared' }, leaders.map((r) => r.c.id), 'steady');
	return {
		support: {
			families,
			top: [...engines].sort((a, b) => b.full - a.full || b.rate - a.rate).slice(0, TOP).map((e) => ({ who: entrant(e.c), full: e.full }))
		},
		speed: { shared, top: [...ranked].sort((a, b) => a.v - b.v).slice(0, TOP).map((r) => ({ who: entrant(r.c), ms: r.v })) }
	};
}

/**
 * Load the features corpus for each machine and summarize it. Shares the controller's global
 * state with page baking, so callers must run it alone and re-apply their own seed afterwards.
 */
export async function bakeFeatureSummaries(origin: string): Promise<FeatureSummaries> {
	const out: FeatureSummaries = {};
	for (const machine of ['m1', 'm2', 'm3'] as const) {
		try {
			const seed = await bakePageSeed(origin, '/features/', machine);
			if (seed.machine === machine) out[machine] = summarizeFeatures(ui.scope);
		} catch (error) {
			// A machine without published feature results has no preview.
			console.warn(`Feature summary for ${machine} unavailable:`, error);
		}
	}
	return out;
}
