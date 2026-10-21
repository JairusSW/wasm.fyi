export function applyJavaScriptSampling(source) {
 let js=source;
 js=js.replace("Math.max(r.warmup, runtime==='jsc'&&tierMode==='omg-eager'?2:0)",'r.warmup');
 js=js.replace('      if (shared) verify(invoke(shared,args),shared);\n','');
 js=js.replace("warmup_minimum:'2'","warmup_minimum:'0'");
 js=js.replace('IPInt → BBQ → OMG tier-up forced after warmup; synchronous OMG compilation','IPInt → BBQ → OMG synchronous tier-up during recorded samples');
 js=js.replace(/        \/\/ Internal JSC tier-up calls[\s\S]*?        if\(i<r\.warmup\)/,'        // Retain every requested sample, including any tier-up cost.\n        if(i<r.warmup)');
 if(js.includes('let cachedModule, cachedSteady, cachedVectors;'))return js;

 const patch=(old,next)=>{
  if(!js.includes(old))throw Error('JavaScript adapter cache seam changed: '+old);
  js=js.replace(old,next);
 };
 patch('  let prep, bytes, signature;','  let prep, bytes, signature;\n  let cachedModule, cachedSteady, cachedVectors;');
 js=js.replaceAll('prep = bytes = signature = undefined;', 'prep = bytes = signature = cachedModule = cachedSteady = cachedVectors = undefined;');

 // Feature-complete adapters precompute vector cases. Scalar-only historical
 // adapters have no vector setup, so there is deliberately nothing to cache.
 const vectors='const w=prep.workload,v=w.vectors,cases=vectorCases(w),samples=[];';
 if(js.includes(vectors))js=js.replace(vectors,'const w=prep.workload,v=w.vectors,cases=cachedVectors ||= vectorCases(w),samples=[];');

 const directModule="const shared=r.scenario==='compile'?undefined:new WebAssembly.Module(bytes);";
 if(js.includes(directModule))js=js.replace(directModule,"const shared=r.scenario==='compile'?undefined:(cachedModule ||= new WebAssembly.Module(bytes));");
 const directInstance='const start=now(),target=new WebAssembly.Instance(module);';
 if(js.includes(directInstance))js=js.replace(directInstance,"const start=now(),target=r.scenario==='steady' && w.reset==='stateless' ? (cachedSteady ||= new WebAssembly.Instance(module)) : new WebAssembly.Instance(module);");

 patch("let compiled = r.scenario === 'compile' ? undefined : new WebAssembly.Module(bytes);", "let compiled = r.scenario === 'compile' ? undefined : (cachedModule ||= new WebAssembly.Module(bytes));");
 const fresh="let shared = r.scenario === 'steady' && !freshSteady ? initialize(new WebAssembly.Instance(compiled, imports)) : undefined;";
 const scalar="let shared = r.scenario === 'steady' ? initialize(new WebAssembly.Instance(compiled, imports)) : undefined;";
 if(js.includes(fresh))js=js.replace(fresh,"let shared = r.scenario === 'steady' && !freshSteady ? (cachedSteady ||= initialize(new WebAssembly.Instance(compiled, imports))) : undefined;");
 else if(js.includes(scalar))js=js.replace(scalar,"let shared = r.scenario === 'steady' ? (cachedSteady ||= initialize(new WebAssembly.Instance(compiled, imports))) : undefined;");
 else throw Error('JavaScript adapter cache seam changed: steady instance');
 return js;
}
