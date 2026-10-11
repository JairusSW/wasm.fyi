import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]||'');
if(!process.argv[2])throw Error('Pinned Wizard source directory required');
for(const [relative,native] of [['src/engine/x86-64/X86_64Target.v3',true],['src/engine/v3/V3Target.v3',false]]){
 const path=join(root,relative);
 const source=await readFile(path,'utf8');
 if(source.includes('def wasmfyiNativeCodeSize('))continue;
 if(!source.includes('component Target {'))throw Error('Pinned Wizard target API changed');
 if(native){
  const compiler=await readFile(join(root,'src/engine/x86-64/X86_64SinglePassCompiler.v3'),'utf8');
  if(!source.includes('type TargetModule(spc_code: X86_64SpcModuleCode)')||!compiler.includes('class X86_64SpcModuleCode')||!compiler.includes('var codeEnd: int;')||!compiler.includes('codeEnd = Target.copyInto(range, startOffset, masm.w);'))throw Error('Pinned Wizard emitted native-image API changed');
 }
 const getter=native?`
    // Emitted module-owned native image, including in-image alignment/data.
    // Unused mapping ballast, shared interpreter code and runtime stubs excluded.
    def wasmfyiNativeCodeSize(module: Module) -> u64 {
        var code = module.target_module.spc_code;
        if (code == null) return 0uL;
        return u64.view(code.codeEnd);
    }
 `:`
    // No artifact-native code exists for the portable interpreter.
    // The adapter translates this absence to n/a, never a measured zero.
    def wasmfyiNativeCodeSize(module: Module) -> u64 { return 0uL; }
 `;
 await writeFile(path,source.replace('component Target {','component Target {'+getter));
}
