import { error } from '@sveltejs/kit';
import { ALLB } from '$lib/data/snapshot';
import type { EntryGenerator, PageLoad } from './$types';

export const entries: EntryGenerator = () => ALLB.map((b) => ({ id: b.id }));

export const load: PageLoad = ({ params }) => {
	const bench = ALLB.find((b) => b.id === params.id);
	if (!bench) error(404, `No workload named “${params.id}” in this snapshot`);
	return { bench };
};
