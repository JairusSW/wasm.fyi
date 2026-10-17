import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ensureEndiveJFFI} from './lib/endive-sdk.mjs';
test('Redline packages only the source-resolved provided JFFI dependency and matching native classifier',async()=>{
 const root=await mkdtemp(join(tmpdir(),'endive-provided-')),sdk=join(root,'sdk'),calls=[];
 try{await mkdir(sdk);await writeFile(join(sdk,'unrelated-runtime.jar'),'retained');
 const result=await ensureEndiveJFFI({source:root,sdk,run:async(binary,args,options)=>{
  calls.push({binary,args,options});
  if(binary==='bash')await writeFile(join(sdk,'jffi-1.3.14.jar'),'source-selected binding');
  else await writeFile(args.at(-1),'native classifier');
 }});
 assert.equal(result.version,'1.3.14');assert.match(result.bindingSha256,/^[a-f0-9]{64}$/);
 assert(calls[0].args.includes('-DincludeScope=compile'));assert(calls[0].args.includes('-DincludeArtifactIds=jffi'));
 assert(calls[0].args.includes('-Predline'),'provided dependencies must use the same activated Redline reactor');
 assert.equal(calls[0].options.cwd,root);assert(calls[1].args.includes('https://repo.maven.apache.org/maven2/com/github/jnr/jffi/1.3.14/jffi-1.3.14-native.jar'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('missing provided JFFI fails closed without inventing a dependency version',async()=>{
 const root=await mkdtemp(join(tmpdir(),'endive-missing-'));let calls=0;
 try{await assert.rejects(()=>ensureEndiveJFFI({source:root,sdk:root,run:async()=>{calls++;}}),/source-resolved JFFI dependency is missing/);assert.equal(calls,1);}
 finally{await rm(root,{recursive:true,force:true});}
});

 test('plain SDK adapter compilation disables unrelated upstream annotation processors',async()=>{
 const {compileEndiveAdapter}=await import('./lib/endive-sdk.mjs');const calls=[];
 await compileEndiveAdapter({java:'/qualified/jdk/bin/java',sdk:'/sdk',classes:'/classes',path:'/adapter/EndiveAdapter.java',run:async(binary,args)=>calls.push({binary,args})});
 assert.deepEqual(calls,[{binary:'/qualified/jdk/bin/javac',args:['-proc:none','-cp','/sdk/*','-d','/classes','/adapter/EndiveAdapter.java']}]);
 });
