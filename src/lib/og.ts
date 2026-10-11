// Open Graph identity for every page: which share image it uses and the text
// shown in link previews. Shared by the page <head> and the image endpoint.
import { PROPS } from './data/features';
import { ALLB } from './data/snapshot';
import type { Bench, ProposalId } from './data/types';
import { workloadName } from './format';
import { PROPOSAL_IDS } from './links';
import { SITE_DESCRIPTION } from './site';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface OgPage {
	title: string;
	description: string;
}

/** Static pages, keyed by image slug. */
export const OG_PAGES: Record<string, OgPage> = {
	home: { title: 'wasm.fyi — The reference for WebAssembly runtimes', description: SITE_DESCRIPTION },
	benchmarks: {
		title: 'Benchmarks · wasm.fyi',
		description: 'Compilation, instantiation, execution, memory and machine code for WebAssembly runtimes across real programs and microbenchmarks.'
	},
	workloads: { title: 'Prepared workload catalog · wasm.fyi', description: 'Explore prepared WebAssembly application workloads, exact corpus artifacts, source identities and operation contracts. Inventory is separate from measured performance.' },
	docs: { title: 'API and measurement guide · wasm.fyi', description: 'Read WebAssembly benchmark data without JavaScript: API discovery, pagination, units, provenance and fair comparison.' },
	health: { title: 'Service status · wasm.fyi', description: 'Live API availability and measurement freshness for wasm.fyi.' },
	dashboard: { title: 'Dashboard · wasm.fyi', description: 'Authorized administration for wasm.fyi.' },
	history: { title: 'History · wasm.fyi', description: 'Every metric over time, with source revisions, recorded gaps and fixed comparison baselines.' },
	features: { title: 'Features · wasm.fyi', description: 'Released engine compatibility, official suite results and feature performance across WebAssembly runtimes.' },
	compare: { title: 'Startup vs throughput · wasm.fyi', description: 'When does a slow-starting fast runtime win? Estimated total cost as invocations grow.' }
};

/** Feature probes share the Features image; application workloads get their own. */
export const hasOwnImage = (b: Bench) => !b.id.startsWith('features/');

/** File-safe, collision-resistant slug for a workload id (ids contain `/`, spaces and symbols). */
export function workloadSlug(id: string): string {
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	const base = workloadName(id)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 60);
	return `w-${base}-${(h >>> 0).toString(36).slice(0, 5)}`;
}

/** Every image the endpoint renders. */
export function ogSlugs(): string[] {
	return [...Object.keys(OG_PAGES), ...PROPOSAL_IDS, ...ALLB.filter(hasOwnImage).map((b) => workloadSlug(b.id))];
}

/** Image slug and preview text for a route. */
export function ogFor(routeId: string | null, params: Record<string, string>, data: Record<string, unknown>): OgPage & { slug: string } {
	if (routeId === '/[proposal=proposal]' && PROPOSAL_IDS.includes(params.proposal as ProposalId)) {
		const p = PROPS[params.proposal as ProposalId];
		return { slug: params.proposal, title: `${p.title} · wasm.fyi`, description: `${p.long}. ${p.q}` };
	}
	if (routeId === '/bench/[...id]' && data.preparedWorkload) {
		const workload = data.preparedWorkload as { name: string; description: string };
		return { slug: 'benchmarks', title: `${workload.name} · wasm.fyi`, description: `${workload.description}. Prepared corpus contract; live results depend on the selected platform and runtime.` };
	}
	if (routeId === '/bench/[...id]' && data.bench) {
		const b = data.bench as Bench;
		return {
			slug: hasOwnImage(b) ? workloadSlug(b.id) : 'features',
			title: `${workloadName(b.id)} · wasm.fyi`,
			description: b.purpose || `${workloadName(b.id)} — ${b.group} workload measured across WebAssembly runtimes.`
		};
	}
	if (routeId === '/bench/[...id]' && typeof data.workload === 'string') {
		return { slug: 'benchmarks', title: `${workloadName(data.workload)} · wasm.fyi`, description: 'WebAssembly workload measurements by platform, runtime and phase. Read the workload contract and measurement scope before comparing results.' };
	}
	const key = routeId === '/' || !routeId ? 'home' : routeId.slice(1);
	const page = OG_PAGES[key] ?? OG_PAGES.home;
	return { slug: OG_PAGES[key] ? key : 'home', ...page };
}
