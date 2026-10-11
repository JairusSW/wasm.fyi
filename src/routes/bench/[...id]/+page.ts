import type { PageLoad } from './$types';

// Build known prepared contracts while retaining the Go host's live-import route.
export const prerender = 'auto';
export const load: PageLoad = ({ params, data }) => ({ ...data, workload: params.id.replace(/\/$/, '') });
