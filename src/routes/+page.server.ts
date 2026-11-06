import type {PageServerLoad} from './$types';
import {env} from '$env/dynamic/private';
import {bakeHomepage} from '$lib/server/homepage';
import type {Homepage} from '$lib/homepage';
// One frozen payload per build/baker process, shared by HTML and route data.
let baked:Promise<Homepage>|undefined;
export const load:PageServerLoad=async()=>{
 const origin=env.WASMFYI_PRERENDER_API_ORIGIN;
 if(!origin)return {home:null};
 baked??=bakeHomepage(origin);
 return {home:await baked};
};
