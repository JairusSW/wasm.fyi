import {resolve,join} from 'node:path';
import {linkAliasesWhenIdle} from './lib/idle-history-aliases.mjs';
const root=resolve(process.argv[2]);
try{const result=await linkAliasesWhenIdle(root,{command:[process.execPath,join(root,'site/scripts/link-history-aliases.mjs'),root]});process.exitCode=result.exitCode}catch(error){console.error(String(error));process.exitCode=1}
