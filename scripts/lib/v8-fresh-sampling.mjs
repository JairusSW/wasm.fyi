export function withV8FreshSampling(source){
 const before="      if(r.scenario!=='compile'){setup();\n      if (!['first-call', 'trajectory', 'teardown'].includes(r.scenario)) verify(invoke());}";
 const after="      // Recorded samples validate their own fresh instance/result; never call a consumed prior instance.\n      if(r.scenario!=='compile')setup();";
 if(source.includes(after))return source;
 if(!source.includes(before))throw Error('V8 retained-instance validation seam changed');
 return source.replace(before,after);
}
