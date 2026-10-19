import { json } from '@sveltejs/kit';
import { ogManifest } from '$lib/og';
import type { RequestHandler } from './$types';

// Per-route head metadata for the production host, which serves the bare
// application shell and injects these tags so link previews see them.
export const prerender = true;

export const GET: RequestHandler = () => json(ogManifest());
