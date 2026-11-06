import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { bakeFeatureSummaries, type FeatureSummaries } from '$lib/feature-summary';
import { activatePageSeed } from '$lib/api/controller.svelte';
import { decodeBakedSeed } from '$lib/api/baked-codec';

// Outside a build the summaries are only computed when an API origin is configured; cache them per process.
let cached: Promise<FeatureSummaries> | undefined;

export const load: PageServerLoad = async ({ parent }) => {
	const origin = env.WASMFYI_PRERENDER_API_ORIGIN;
	if (!origin) return { features: null };
	// The layout bakes this page's own seed through the same controller state; let it finish first.
	const { pageSeed } = await parent();
	try {
		cached ??= bakeFeatureSummaries(origin);
		return { features: await cached };
	} finally {
		// Feature baking uses the shared controller; SSR must render the home seed again.
		if (pageSeed) activatePageSeed(decodeBakedSeed(pageSeed));
	}
};
