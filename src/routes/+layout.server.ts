import type {LayoutServerLoad} from './$types';
import {building} from '$app/environment';
import {env} from '$env/dynamic/private';
import {encodeBakedSeed} from '$lib/api/baked-codec';
import {bakePageSeed} from '$lib/api/controller.svelte';

export const load:LayoutServerLoad=async({url,route})=>{
 const origin=env.WASMFYI_PRERENDER_API_ORIGIN;
 // The publication baker re-renders pages outside the build with WASMFYI_STATIC_BAKER.
 if(!(building||env.WASMFYI_STATIC_BAKER==='1')||!origin||route.id==='/'||route.id==='/dashboard'||route.id==='/bench/[...id]')return {pageSeed:null};
 // The baker also renders each page for every machine (`?m=`); prerendering
 // cannot read the query, so build output is always the default machine.
 const machine=building?'m1':(['m1','m2','m3'] as const).find(m=>m===url.searchParams.get('m'))??'m1';
 return {pageSeed:encodeBakedSeed(await bakePageSeed(origin,url.pathname,machine))};
};
