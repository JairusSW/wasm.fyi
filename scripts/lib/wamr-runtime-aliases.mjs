// Accept the two known registry layouts; never silently skip an unknown seam.
export function withWamrRuntimeAliases(text) {
 const base='"wasmi", "wavm", "wamr", "wasm3"',aliases='"wasmi", "wavm", "wamr", "wamr-fast-jit", "wamr-llvm-jit", "wasm3"';
 const occurrences=text.split(base).length-1,adapted=text.split(aliases).length-1;
 if(occurrences===3)return text.replaceAll(base,aliases).replace('strings.ReplaceAll(id, "-", "_")','func() string { if strings.HasPrefix(id, "wamr-") { return "wamr" }; return strings.ReplaceAll(id, "-", "_") }()');
 if(adapted===3)return text;
 // Newer frozen harnesses register JIT command arguments separately and map
 // native Cargo feature names explicitly. Unrelated runtimes may extend lists.
 const names=list=>['"wamr-fast-jit"','"wamr-llvm-jit"'].every(name=>list?.includes(name));
 const command=text.match(/case "wamr-fast-jit", "wamr-llvm-jit":([\s\S]*?)\n\s*case /)?.[1];
 const admitted=text.match(/slices\.Contains\(\[\]string\{([^}]+)\}, id\)/)?.[1];
 const build=text.match(/case ([^\n]+):\s*\n\s*feature := id\s*\n\s*if strings\.HasPrefix\(id, "wamr-"\) \{\s*\n\s*feature = "wamr"/);
 if(command?.includes('"adapter-"+id')&&command.includes('"--wamr-mode="')&&names(admitted)&&names(build?.[1]))return text;
 throw Error('WAMR runtime alias anchors changed');
}
