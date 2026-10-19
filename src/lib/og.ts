// Open Graph identity for every page: which share image it uses and the text
// shown in link previews. Shared by the page <head>, the image endpoint and the
// head manifest the production host injects into the application shell.
import { PROPS } from './data/features';
import type { ProposalId } from './data/types';
import { workloadName } from './format';
import { PROPOSAL_IDS } from './links';
import { SITE_DESCRIPTION, SITE_ORIGIN } from './site';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface OgPage {
	title: string;
	description: string;
}

/** Share-card text: a small kicker, a headline (`\n` marks line breaks) and a subtitle. */
export interface OgCard {
	kicker: string;
	headline: string;
	subtitle: string;
	/** Path shown in the card footer. */
	path: string;
}

export type OgSlug = 'home' | 'benchmarks' | 'history' | 'features' | 'compare' | 'health' | 'workload' | ProposalId;

/** Static pages, keyed by image slug. */
export const OG_PAGES: Record<Exclude<OgSlug, ProposalId | 'workload'>, OgPage & { card: OgCard }> = {
	home: {
		title: 'wasm.fyi — The reference for WebAssembly runtimes',
		description: SITE_DESCRIPTION,
		card: { kicker: 'WebAssembly runtimes', headline: 'The reference for\nWebAssembly runtimes.', subtitle: 'Independent benchmarks, feature support and proposal performance.', path: '' }
	},
	benchmarks: {
		title: 'Benchmarks · wasm.fyi',
		description: 'Compilation, instantiation, execution, memory and machine code for WebAssembly runtimes across real programs and microbenchmarks.',
		card: { kicker: 'Benchmarks', headline: 'Benchmarks', subtitle: 'Compilation, instantiation, execution, memory and machine code across real programs.', path: '/benchmarks' }
	},
	history: {
		title: 'History · wasm.fyi',
		description: 'Every metric over time, with source revisions, recorded gaps and fixed comparison baselines.',
		card: { kicker: 'History', headline: 'Every metric,\nover time.', subtitle: 'Source revisions, recorded gaps and fixed comparison baselines.', path: '/history' }
	},
	features: {
		title: 'Features · wasm.fyi',
		description: 'Released engine compatibility, official suite results and feature performance across WebAssembly runtimes.',
		card: { kicker: 'Features', headline: 'Feature support', subtitle: 'Released engine compatibility, official suite results and feature performance.', path: '/features' }
	},
	compare: {
		title: 'Startup vs throughput · wasm.fyi',
		description: 'When does a slow-starting fast runtime win? Estimated total cost as invocations grow.',
		card: { kicker: 'Compare', headline: 'Startup vs\nthroughput', subtitle: 'When does a fast runtime that starts slowly win?', path: '/compare' }
	},
	health: {
		title: 'Health · wasm.fyi',
		description: 'Collection status for every machine, runtime and workload behind wasm.fyi.',
		card: { kicker: 'Health', headline: 'Collection health', subtitle: 'Status for every machine, runtime and workload behind the numbers.', path: '/health' }
	}
};

/** Workload detail pages share one card; `{name}` is the workload's display name. */
export const OG_WORKLOAD = {
	title: '{name} · wasm.fyi',
	description: '{name}: compilation, instantiation, execution, memory and machine code measured across WebAssembly runtimes.',
	card: { kicker: 'Workload', headline: 'Workload\nbenchmarks', subtitle: 'One program, every runtime: startup, execution, memory and machine code.', path: '/bench' } satisfies OgCard
};

const fill = (template: string, name: string) => template.replaceAll('{name}', name);

function proposalPage(id: ProposalId): OgPage & { card: OgCard } {
	const p = PROPS[id];
	return {
		title: `${p.title} · wasm.fyi`,
		description: `${p.long}. ${p.q}`,
		card: { kicker: `Proposal · ${p.ver.replace(/\s*\(.*\)/, '')}`, headline: p.title, subtitle: p.q, path: '/' + id }
	};
}

/** Every image the endpoint renders. */
export function ogSlugs(): OgSlug[] {
	return [...(Object.keys(OG_PAGES) as OgSlug[]), 'workload', ...PROPOSAL_IDS];
}

/** Card text for an image slug. */
export function ogCard(slug: OgSlug): OgCard {
	if (PROPOSAL_IDS.includes(slug as ProposalId)) return proposalPage(slug as ProposalId).card;
	if (slug === 'workload') return OG_WORKLOAD.card;
	return OG_PAGES[slug as keyof typeof OG_PAGES].card;
}

/** Image slug and preview text for a route. */
export function ogFor(routeId: string | null, params: Record<string, string>): OgPage & { slug: OgSlug } {
	if (routeId === '/[proposal=proposal]' && PROPOSAL_IDS.includes(params.proposal as ProposalId)) {
		const { title, description } = proposalPage(params.proposal as ProposalId);
		return { slug: params.proposal as ProposalId, title, description };
	}
	if (routeId === '/bench/[...id]' && params.id) {
		const name = workloadName(params.id.replace(/\/$/, ''));
		return { slug: 'workload', title: fill(OG_WORKLOAD.title, name), description: fill(OG_WORKLOAD.description, name) };
	}
	const key = (routeId === '/' || !routeId ? 'home' : routeId.slice(1)) as keyof typeof OG_PAGES;
	const page = OG_PAGES[key] ?? OG_PAGES.home;
	return { slug: OG_PAGES[key] ? key : 'home', title: page.title, description: page.description };
}

/**
 * Head metadata the production host injects into the application shell, which
 * otherwise reaches crawlers without any page-specific tags. Paths have no
 * trailing slash; workload pages use the `{name}` templates.
 */
export function ogManifest() {
	const pages: Record<string, OgPage & { image: string }> = {};
	for (const slug of Object.keys(OG_PAGES) as (keyof typeof OG_PAGES)[]) {
		const route = slug === 'home' ? '/' : '/' + slug;
		const { title, description } = ogFor(route, {});
		pages[slug === 'home' ? '' : route] = { title, description, image: `/og/${slug}.png` };
	}
	for (const id of PROPOSAL_IDS) {
		const { title, description } = ogFor('/[proposal=proposal]', { proposal: id });
		pages['/' + id] = { title, description, image: `/og/${id}.png` };
	}
	return { origin: SITE_ORIGIN, width: OG_WIDTH, height: OG_HEIGHT, siteName: 'wasm.fyi', pages, workload: { title: OG_WORKLOAD.title, description: OG_WORKLOAD.description, image: '/og/workload.png' } };
}
