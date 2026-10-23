// Source-built performance contracts are separate from small correctness probes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fixtures,featureIds} from '../corpora/features/generator.mjs';
import {FEATURE_PERFORMANCE_REPEATS,FEATURE_PERFORMANCE_BATCH_NS,performanceSource,repeatedFeatureSource,repeatedFeatureExpected} from './lib/feature-performance.mjs';
import {featureCompiler} from './lib/feature-toolchain.mjs';
import {validateProposalArtifact} from './lib/proposal-validation.mjs';
import {proposalBinaryBytes} from '../corpora/features/proposal-binary.mjs';
import {site,digest,command} from './lib/wasmbench.mjs';
const root=resolve(process.argv.find(a=>a.startsWith('--input='))?.slice(8)||join(site,'corpora/features')),output=resolve(process.argv[2]||join(site,'.wasmbench/feature-performance'));
const families=process.argv.find(a=>a.startsWith('--family='))?.slice(9).split(',').filter(Boolean);
if(families?.some(f=>!featureIds.includes(f)))throw Error('Unknown feature family: '+families.filter(f=>!featureIds.includes(f)).join(', '));
const manifest=JSON.parse(await readFile(join(root,'manifest.json'))),compiler=await featureCompiler();
const version=command(compiler,['--version']).toString().trim();if(!version.startsWith('wasm-tools 1.260.0'))throw Error('Pinned feature compiler required');
await mkdir(join(output,'sources'),{recursive:true});await mkdir(join(output,'artifacts'),{recursive:true});
const workloads=[],recipes=[],lifecycle=[],probes=[],lifecycleWorkloads=[],probeWorkloads=[];
for(const f of fixtures().filter(f=>!families||families.includes(f.feature))){
 const size=Math.max(...f.sizes),original=manifest.find(w=>w.id===`features/${f.feature}/${f.name}/${size}`);
 if(!original)throw Error('Missing feature '+f.name);
 if(digest(await readFile(join(root,original.artifact)))!==original.sha256||await readFile(join(root,original.source),'utf8')!==f.wat.trim()+'\n')throw Error('Stale source-built feature '+f.name);
 if(['compile-only','compile-and-instantiate'].includes(f.scope)){probes.push(original.id);probeWorkloads.push({...original,artifact:join(root,original.artifact)});continue;}
 if(f.reset!=='stateless'&&f.abi!=='component'){lifecycle.push(original.id);lifecycleWorkloads.push({...original,artifact:join(root,original.artifact)});continue;}
 const component=f.abi==='component',n=component?size*16:size,repeats=(component||f.hostBoundary)?1:(f.performanceRepeats??FEATURE_PERFORMANCE_REPEATS);
 const sourceInfo=performanceSource(f),wat=(component||f.hostBoundary)?sourceInfo.wat:f.performanceWat?f.performanceWat():repeatedFeatureSource(sourceInfo.wat,repeats,f.export??'benchmark'),stem=f.feature+'-'+f.name;
 const source=join(output,'sources',stem+'.wat'),artifact=join(output,'artifacts',stem+'.wasm');
 await writeFile(source,wat.trim()+'\n');
 if(f.nativeValidation)await writeFile(artifact,proposalBinaryBytes(wat));
 else command(compiler,['parse',source,'-o',artifact]);
 await validateProposalArtifact(compiler,artifact,f);
 const sha256=digest(await readFile(artifact));
 const expected=(component||f.hostBoundary)?String(f.expected(n)):repeatedFeatureExpected(f.expected(n));
 const recipe={source,sourceSha256:digest(await readFile(source)),artifact,sha256,compiler:f.nativeValidation?original.provenance.recipe.compiler:version,
  ...(f.nativeValidation?{validator:original.provenance.recipe.validator}:{}),originalArtifactSha256:original.sha256,repeats,retainedGcRoots:sourceInfo.retained};recipes.push(recipe);
 workloads.push({...original,id:`features/${f.feature}/${f.name}/performance-${n}x${repeats}`,artifact,sha256,source,export:(component||f.hostBoundary)?'benchmark':'performance',args:f.args?f.args(n):[component?String(n):n],oracle:{kind:'exact_u64',expected:[expected]},size:n,units_per_invocation:(f.units||n)*repeats,
  provenance:{...original.provenance,performance:true,recipe,performancePolicy:{repeats,minimumBatchNs:FEATURE_PERFORMANCE_BATCH_NS,independentLaunches:1,warmupBatches:0,retainedGcRoots:sourceInfo.retained,originalSize:size,scope:f.scope}}});
}
await writeFile(join(output,'manifest.json'),JSON.stringify(workloads,null,2)+'\n');
await writeFile(join(output,'compile-probes.json'),JSON.stringify(probeWorkloads,null,2)+'\n');
await writeFile(join(output,'lifecycle-probes.json'),JSON.stringify(lifecycleWorkloads,null,2)+'\n');
await writeFile(join(output,'build.json'),JSON.stringify({compiler:version,performanceContracts:workloads.length,repeats:FEATURE_PERFORMANCE_REPEATS,minimumBatchNs:FEATURE_PERFORMANCE_BATCH_NS,recipes,lifecycleOnly:lifecycle,compileProbes:probes},null,2)+'\n');
console.log(`Built ${workloads.length} feature performance contracts; ${lifecycle.length} one-shot lifecycle probes and ${probes.length} compilation probes remain separate.`);
