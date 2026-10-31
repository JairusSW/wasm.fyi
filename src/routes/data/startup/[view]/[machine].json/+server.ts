import {json,error} from '@sveltejs/kit';
import {building} from '$app/environment';
import {env} from '$env/dynamic/private';
import {bakePageSeed} from '$lib/api/controller.svelte';
import {encodeBakedSeed} from '$lib/api/baked-codec';
import type {MachineId} from '$lib/data/types';
import type {RequestHandler} from './$types';
export const prerender=true;
export const entries=()=>env.WASMFYI_PRERENDER_API_ORIGIN?['features','history'].flatMap(view=>['m1','m2','m3'].map(machine=>({view,machine}))):[];
export const GET:RequestHandler=async({params})=>{
 if(!building||!env.WASMFYI_PRERENDER_API_ORIGIN||!['features','history'].includes(params.view)||!['m1','m2','m3'].includes(params.machine))error(404);
 const seed=await bakePageSeed(env.WASMFYI_PRERENDER_API_ORIGIN,`/${params.view}/`,params.machine as MachineId);
 if(seed.machine!==params.machine)error(404,'Machine has no published results');
 return json(encodeBakedSeed(seed));
};
