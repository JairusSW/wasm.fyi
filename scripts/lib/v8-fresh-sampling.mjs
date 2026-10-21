export function withV8FreshSampling(source){
 const before="      if(r.scenario!=='compile'){setup();\n      if (!['first-call', 'trajectory', 'teardown'].includes(r.scenario)) verify(invoke());}";
 const currentBefore="      setup();\n      if (!['first-call', 'trajectory', 'teardown'].includes(r.scenario)) verify(invoke());";
 const after="      // Recorded samples validate their own fresh instance/result; never call a consumed prior instance.\n      if(r.scenario!=='compile')setup();";
 if(source.includes(after))return source;
 const current=[
  "let compiled = r.scenario === 'compile' ? undefined : (cachedModule ||= new WebAssembly.Module(bytes));",
  "let shared = r.scenario === 'steady' ? (cachedSteady ||= initialize(new WebAssembly.Instance(compiled, imports))) : undefined;",
  "if (r.scenario === 'first-call') target = initialize(new WebAssembly.Instance(module, imports));",
  "if (r.scenario === 'compile' || r.scenario === 'instantiate') { target = initialize(target || new WebAssembly.Instance(module, imports)); result = invoke(target,args); verify(result,target); }",
 ];
 // The unified JS-shell adapter has no pre-sample oracle call: first-call and
 // instantiate validate the instance created by that measured sample, while
 // steady is admitted only for stateless workloads and owns cachedSteady.
 if(current.every(part=>source.includes(part)))return source;
 if(source.includes(currentBefore))return source.replace(currentBefore,after);
 if(source.includes(before))return source.replace(before,after);
 throw Error('V8 retained-instance validation seam changed');
}
