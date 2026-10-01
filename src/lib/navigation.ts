import { goto as kitGoto, replaceState as kitReplaceState } from '$app/navigation';
import { siteHref } from './links';

export const goto: typeof kitGoto = (url, options) => kitGoto(url instanceof URL ? url : siteHref(url), options);
export const replaceState: typeof kitReplaceState = (url, state) => kitReplaceState(url instanceof URL ? url : siteHref(url), state);
