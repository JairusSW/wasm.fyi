import type { ParamMatcher } from '@sveltejs/kit';
import { PROPOSAL_IDS } from '$lib/links';

export const match = ((param: string) => (PROPOSAL_IDS as string[]).includes(param)) satisfies ParamMatcher;
