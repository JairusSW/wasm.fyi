import type { CfgId } from './data/types';

/** Keep a preferred baseline only when it was collected on the selected host. */
export function comparisonBaseline(preferred: CfgId, available: readonly CfgId[]): CfgId {
	return available.includes(preferred) ? preferred : available[0] ?? preferred;
}
