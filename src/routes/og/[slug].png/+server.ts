import { error } from '@sveltejs/kit';
import { ogSlugs } from '$lib/og';
import { renderOg } from '$lib/server/og';
import type { EntryGenerator, RequestHandler } from './$types';

// Rendered once at build time into static PNGs; rendered on request in dev.
export const prerender = true;

export const entries: EntryGenerator = () => ogSlugs().map((slug) => ({ slug }));

export const GET: RequestHandler = async ({ params }) => {
	if (!ogSlugs().includes(params.slug)) error(404, 'No share image for this page');
	const png = await renderOg(params.slug);
	return new Response(png as BodyInit, {
		headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' }
	});
};
