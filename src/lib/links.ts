import { base } from '$app/paths';
import { hostedPath } from './path';
import type { ProposalId } from './data/types';

export const siteHref = (path: string) => hostedPath(path, base);

export const PROPOSAL_IDS: ProposalId[] = ['simd', 'gc', 'memory64', 'threads'];

/** Path for a benchmark detail page. Workload ids may contain `/`, spaces and symbols. */
export const benchHref = (id: string, tab?: string) =>
	siteHref('/bench/' + encodeURI(id).replace(/[?#]/g, encodeURIComponent) + (tab && tab !== 'latency' ? '?tab=' + tab : ''));

/** Path with query params, skipping empty values. */
export const href = (path: string, params: Record<string, string | number | null | undefined> = {}) => {
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v != null && v !== '') sp.set(k, String(v));
	const q = sp.toString();
	return siteHref(path) + (q ? '?' + q : '');
};
