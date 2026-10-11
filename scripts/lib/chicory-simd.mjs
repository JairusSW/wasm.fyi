export function withChicorySimd(source){
 if(source.includes('builder.withMachineFactory(com.dylibso.chicory.simd.SimdInterpreterMachine::new);'))return source;
 const seam='var builder=Instance.builder(module);';if(!source.includes(seam))throw Error('Unknown Chicory instance builder seam');
 return source.replace(seam,seam+'\n    builder.withMachineFactory(com.dylibso.chicory.simd.SimdInterpreterMachine::new);').replace('"effective_configuration":{','"effective_configuration":{"interpreter_machine":"SimdInterpreterMachine; JDK incubator vector enabled",');
}
