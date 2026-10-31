import type {LayoutServerLoad} from './$types';
import {building} from '$app/environment';
import {env} from '$env/dynamic/private';
import {encodeBakedSeed} from '$lib/api/baked-codec';
import {bakePageSeed} from '$lib/api/controller.svelte';

export const load:LayoutServerLoad=async({url,route})=>{
 const origin=env.WASMFYI_PRERENDER_API_ORIGIN;
 if(!building||!origin||route.id==='/dashboard'||route.id==='/bench/[...id]')return {pageSeed:null};
 return {pageSeed:encodeBakedSeed(await bakePageSeed(origin,url.pathname))};
};
