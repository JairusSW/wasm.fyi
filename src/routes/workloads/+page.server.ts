import { listPreparedWorkloads, PREPARED_CATALOG_SOURCE, PREPARED_CATALOG_POLICY } from '$lib/server/prepared-workloads';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const workloads = listPreparedWorkloads();
	const categories = [...new Set(workloads.map(workload => workload.category))].sort();
	return {
		count: workloads.length,
		policy: PREPARED_CATALOG_POLICY,
		source: PREPARED_CATALOG_SOURCE,
		// Only the visible listing is serialized. Full artifact/source records stay
		// server-only and each detail route receives just its own contract.
		categories: categories.map((name, index) => ({
			name,
			anchor: `category-${index + 1}`,
			workloads: workloads.filter(workload => workload.category === name).map(({ id, name, path, description }) => ({ id, name, path, description }))
		}))
	};
};
