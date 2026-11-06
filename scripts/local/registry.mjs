import {readFile} from 'node:fs/promises';
import {engineSources} from '../lib/engine-sources.mjs';
export const aliases=JSON.parse(await readFile(new URL('../../schemas/engine-cli.json',import.meta.url),'utf8'));
export const engines=Object.entries(aliases).map(([id,engine])=>({id,engine,family:Object.keys(engineSources).find(f=>engineSources[f].configurations.includes(engine)),repository:Object.values(engineSources).find(f=>f.configurations.includes(engine))?.repository}));
export function resolveEngine(text){
 const at=text.lastIndexOf('@'),name=at>0?text.slice(0,at):text,ref=at>0?text.slice(at+1):'latest';
 const value=engines.find(e=>e.id===name||e.engine===name);
 if(!value||!ref||ref.length>128||!/^[-\w./]+$/.test(ref))throw Error(`Unknown engine or version ${JSON.stringify(text)}. See wasmfyi engines.`);
 return {...value,ref};
}
export function selectCorpora(rows,selectors=['main']){
 const matches=(w,s)=>s==='main'?!w.id.startsWith('features/'):s===w.id||w.id.startsWith(s.replace(/\/$/,'')+'/');
 for(const selector of selectors)if(!rows.some(w=>matches(w,selector)))throw Error(`No corpus matches ${JSON.stringify(selector)}. See wasmfyi corpora.`);
 return rows.filter(w=>selectors.some(s=>matches(w,s)));
}
