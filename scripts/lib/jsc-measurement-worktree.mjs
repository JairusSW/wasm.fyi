import {stat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';

// Keep all engine sources, build tools and bundled libraries. Cone mode also
// retains repository-root build files, while omitting unrelated test websites.
export const javaScriptCoreMeasurementDirectories=['Source','Tools','WebKitLibraries'];

// Opt-in source preparation for future SDKs. Capacity must be checked before
// fetching objects, and existing checked-out source trees are never narrowed.
export async function prepareJavaScriptCoreSourceCheckout({source,revision,run,ensureCapacity}) {
 if(!/^[0-9a-f]{40}$/.test(revision))throw Error('Invalid JavaScriptCore source revision');
 if(typeof ensureCapacity!=='function')throw Error('JavaScriptCore pre-fetch capacity guard required');
 await ensureCapacity();
 const repository=await stat(join(source,'.git')).catch(()=>null);
 if(repository?.isFile())throw Error('JavaScriptCore base source must be a standalone repository');
 const index=await stat(join(source,'.git','index')).catch(()=>null);
 if(index){
  const actual=(await run('git',['-C',source,'rev-parse','HEAD'])).output.trim();
  if(actual!==revision)throw Error('Existing JavaScriptCore source pin differs');
  return {source,revision,checkoutPolicy:'existing-source-preserved'};
 }
 if(!repository){
  await run('git',['init',source]);
  await run('git',['-C',source,'remote','add','origin','https://github.com/WebKit/WebKit.git']);
 }
 const remote=(await run('git',['-C',source,'remote','get-url','origin'])).output.trim();
 if(remote!=='https://github.com/WebKit/WebKit.git')throw Error('JavaScriptCore source remote differs');
 await run('git',['-C',source,'config','remote.origin.promisor','true']);
 await run('git',['-C',source,'config','remote.origin.partialclonefilter','blob:none']);
 await run('git',['-C',source,'fetch','--filter=blob:none','--depth','1','origin',revision]);
 await run('git',['-C',source,'sparse-checkout','set','--cone',...javaScriptCoreMeasurementDirectories]);
 await run('git',['-C',source,'checkout','--detach',revision]);
 const actual=(await run('git',['-C',source,'rev-parse','HEAD'])).output.trim();
 if(actual!==revision)throw Error('Sparse JavaScriptCore source pin differs');
 return {source,revision,checkoutPolicy:'partial-clone-sparse-source-tools-libraries'};
}

export async function prepareJavaScriptCoreMeasurementWorktree({source,target,revision,run,sparse=false}) {
 if(!/^[0-9a-f]{40}$/.test(revision))throw Error('Invalid JavaScriptCore source revision');
 if(resolve(source)===resolve(target))throw Error('Measurement worktree must be separate from upstream source');
 const existing=await stat(join(target,'.git')).catch(()=>null);
 if(existing&&await realpath(source)===await realpath(target))throw Error('Measurement worktree must be separate from upstream source');
 if(!existing) {
  await run('git',['-C',source,'worktree','add','--detach',...(sparse?['--no-checkout']:[]),target,revision]);
  if(sparse){
   await run('git',['-C',target,'sparse-checkout','set','--cone',...javaScriptCoreMeasurementDirectories]);
   // --no-checkout leaves an empty index; populate it only after the sparse
   // policy is set so excluded trees are never written to disk.
   await run('git',['-C',target,'checkout','--detach',revision]);
  }
 }
 const actual=(await run('git',['-C',target,'rev-parse','HEAD'])).output.trim();
 if(actual!==revision)throw Error('Measurement worktree has a different source revision');
 // Existing SDK worktrees may carry qualified measurement patches. Never
 // change their checkout policy or rewrite their source files here.
 return {source:target,revision,created:!existing,checkoutPolicy:existing?'existing-worktree-preserved':sparse?'sparse-source-tools-libraries':'full-checkout'};
}
