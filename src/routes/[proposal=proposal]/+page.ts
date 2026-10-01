import type { ProposalId } from '$lib/data/types';
import { PROPOSAL_IDS } from '$lib/links';
import type { EntryGenerator, PageLoad } from './$types';

export const entries: EntryGenerator = () => PROPOSAL_IDS.map((proposal) => ({ proposal }));

export const load: PageLoad = ({ params }) => ({ id: params.proposal as ProposalId });
