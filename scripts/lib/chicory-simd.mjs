export function withChicorySimd(source){
 if(source.includes('builder.withMachineFactory(com.dylibso.chicory.simd.SimdInterpreterMachine::new);'))return source;
 const seam='var builder=Instance.builder(module);';if(!source.includes(seam))throw Error('Unknown Chicory instance builder seam');
 return source.replace(seam,seam+'\n    builder.withMachineFactory(com.dylibso.chicory.simd.SimdInterpreterMachine::new);').replace('"effective_configuration":{','"effective_configuration":{"interpreter_machine":"SimdInterpreterMachine; JDK incubator vector enabled",');
}

export function chicoryVectorOptions(current='',{revision,receipt,repair}={}){
 const pinned=!!revision&&receipt?.pin?.revision===revision&&receipt?.provenance?.sdk?.simdMachine===true;
 const repaired=!!revision&&repair?.status==='adapter-rebuilt'&&repair?.sourceRevision===revision;
 const option='--add-modules=jdk.incubator.vector';
 return (pinned||repaired)&&!current.includes(option)?[current,option].filter(Boolean).join(' '):current;
}
