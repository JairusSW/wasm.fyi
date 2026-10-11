// Build-time corpus metadata only. Keeping this module under $lib/server prevents
// the full committed inventory from becoming a browser JavaScript dependency.
import inventory from '../../../corpora/catalog.json' with { type: 'json' };

export interface PreparedWorkload {
	id: string;
	name: string;
	path: string;
	description: string;
	category: string;
	algorithm: string;
	abi: string;
	workUnit: string;
	unitsPerInvocation: number;
	reset: string;
	artifactSha256: string;
	artifactBytes: number;
	license: string;
	status: 'prepared';
	source: {
		name: string | null;
		repository: string | null;
		revision: string | null;
		buildRecipe: string | null;
		path: string | null;
		sha256: string | null;
	};
}

export const PREPARED_CATALOG_SOURCE = 'https://github.com/JairusSW/wasm.fyi/blob/main/corpora/catalog.json';
export const PREPARED_CATALOG_POLICY = 'Committed prepared corpus inventory. These contracts describe inputs and artifacts, not measured results or current runtime support.';

const seen = new Set<string>();
const prepared: PreparedWorkload[] = inventory.workloads.filter(workload => workload.status === 'prepared').map<PreparedWorkload>(workload => {
	const id = workload.contractId;
	if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(id) || id.split('/').some(part => part === '.' || part === '..') || seen.has(id)) {
		throw new Error(`Invalid or duplicate prepared workload contract ID: ${id}`);
	}
	seen.add(id);
	const source: Record<string, unknown> = workload.source;
	const sourceText = (key: string) => typeof source[key] === 'string' ? source[key] as string : null;
	const repository = sourceText('repository') ?? sourceText('url');
	if (repository && !/^https:\/\//.test(repository)) throw new Error(`Invalid prepared workload source URL: ${id}`);
	return {
		id,
		name: id.replace(/^(wago|applications)\//, '').replace(/\/polybench_run$/, ''),
		path: `/bench/${id}/`,
		description: workload.description,
		category: workload.category,
		algorithm: workload.algorithm,
		abi: workload.abi,
		workUnit: workload.workUnit,
		unitsPerInvocation: workload.unitsPerInvocation,
		reset: workload.reset,
		artifactSha256: workload.sha256,
		artifactBytes: workload.artifactBytes,
		license: workload.license,
		status: 'prepared',
		source: {
			name: sourceText('name'), repository,
			revision: sourceText('revision'),
			buildRecipe: sourceText('buildRecipe') ?? sourceText('recipe'),
			path: sourceText('source'),
			sha256: sourceText('sourceSha256') ?? sourceText('sha256')
		}
	};
}).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const byId = new Map(prepared.map(workload => [workload.id, workload]));

/** Stable contract IDs and metadata, with no API fetches or measurement data. */
export function listPreparedWorkloads(): PreparedWorkload[] {
	return prepared.slice();
}

/** Exact ID lookup; live imports outside the committed inventory return null. */
export function getPreparedWorkload(id: string): PreparedWorkload | null {
	return byId.get(id) ?? null;
}
