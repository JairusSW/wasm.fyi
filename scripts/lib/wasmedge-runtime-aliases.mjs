// Frozen harnesses may already register the JIT transport independently of
// the native-runtime lists; unrelated entries must not invalidate that binding.
export function withWasmEdgeRuntimeAliases(text){
 const base='"wasmi", "wavm", "wamr", "wasm3", "wasmedge", "wasmer-llvm", "wasmer-singlepass"';
 const aliases='"wasmi", "wavm", "wamr", "wasm3", "wasmedge", "wasmedge-jit", "wasmer-llvm", "wasmer-singlepass"';
 if(text.split(base).length-1===3)return text.replaceAll(base,aliases);
 if(text.split(aliases).length-1===3)return text;
 const command=text.match(/case "wasmedge-jit":([\s\S]*?)\n\s*case /)?.[1];
 const admitted=text.match(/slices\.Contains\(\[\]string\{([^}]+)\}, id\)/)?.[1];
 const build=text.match(/case ([^\n]+):\s*\n\s*feature := id/);
 const feature=/if id == "wasmedge-jit" \{\s*feature = "wasmedge"\s*\}/.test(text);
 if(command?.includes('"adapter-"+id')&&command.includes('"--wasmedge-mode=jit"')&&admitted?.includes('"wasmedge-jit"')&&build?.[1].includes('"wasmedge-jit"')&&feature)return text;
 throw Error('WasmEdge runtime alias anchors changed');
}
