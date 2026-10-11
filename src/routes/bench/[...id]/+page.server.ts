import { getPreparedWorkload, listPreparedWorkloads, PREPARED_CATALOG_SOURCE, PREPARED_CATALOG_POLICY } from '$lib/server/prepared-workloads';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = () => listPreparedWorkloads().map(workload => ({ id: workload.id }));

export const load: PageServerLoad = ({ params }) => {
	const workload = params.id.replace(/\/$/, '');
	return {
		workload,
		preparedWorkload: getPreparedWorkload(workload),
		preparedCatalogSource: PREPARED_CATALOG_SOURCE,
		preparedCatalogPolicy: PREPARED_CATALOG_POLICY
	};
};
