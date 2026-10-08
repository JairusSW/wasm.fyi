import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';

// A read-only SDK measurement ABI. It runs only for code inspection, never
// on compilation/execution paths, and returns extents rather than code bytes.
export async function prepareJavaScriptCoreNativeSize({source,target,run}) {
 const revision=(await run('git',['-C',source,'rev-parse','HEAD'])).output.trim();
 if((await run('git',['-C',source,'status','--porcelain','--untracked-files=no'])).output.trim())throw Error('Upstream JavaScriptCore source is dirty');
 await mkdir(target,{recursive:true});
 if(!await stat(join(target,'.git')).catch(()=>null))await run('git',['-C',source,'worktree','add','--detach',target,revision]);
 if((await run('git',['-C',target,'rev-parse','HEAD'])).output.trim()!==revision)throw Error('Measurement worktree has a different source revision');
 const files=[];
 async function patch(path,transform){const original=await readFile(join(source,path),'utf8'),text=transform(original);if(await readFile(join(target,path),'utf8')!==text)await writeFile(join(target,path),text);files.push({path,upstreamSha256:digest(Buffer.from(original)),patchedSha256:digest(Buffer.from(text))});}
 function replace(text,anchor,value){if(!text.includes(anchor))throw Error('Unrecognized JSC measurement API: '+anchor);return text.replace(anchor,value);}
 const base='Source/JavaScriptCore/';
 await patch(base+'wasm/WasmCalleeGroup.h',text=>{
  if(!text.includes('m_optimizedCallees')||!text.includes('m_wasmToWasmExitStubs'))throw Error('Unknown JSC callee ownership layout');
  const bbqLock=text.includes('class BBQCalleeReference')?'tuple.m_bbqCallee.lock()':'tuple.m_bbqCalleeLock';
  const pending=text.includes('m_pendingPublishCallees')?'for (auto& callee : m_pendingPublishCallees) appendCallee(RefPtr<Callee> { callee.ptr() });':'';
  const method=`
    void wasmFyiAppendCodeRanges(Vector<std::tuple<void*, void*>>& ranges, Vector<RefPtr<Callee>>& keepAlive)
    {
        Locker locker { m_lock };
        auto appendCallee = [&](RefPtr<Callee> callee) {
            if (!callee) return;
            ranges.append(callee->range());
            keepAlive.append(WTF::move(callee));
        };
        for (auto& tuple : m_optimizedCallees) {
#if ENABLE(WEBASSEMBLY_OMGJIT)
            appendCallee(tuple.m_omgCallee);
#endif
#if ENABLE(WEBASSEMBLY_BBQJIT)
            Locker bbqLocker { ${bbqLock} };
            appendCallee(tuple.m_bbqCallee.get());
#endif
        }
#if ENABLE(WEBASSEMBLY_OMGJIT) || ENABLE(WEBASSEMBLY_BBQJIT)
        ${pending}
        for (auto& entry : m_osrEntryCallees) appendCallee(RefPtr<Callee> { entry.value.get() });
#endif
        for (auto& stub : m_wasmToWasmExitStubs) {
            if (auto* allocation = stub.executableMemory())
                ranges.append({ allocation->start().untaggedPtr(), allocation->end().untaggedPtr() });
        }
    }
`;
  return replace(text,'public:\n    Lock m_lock;','public:\n'+method+'    Lock m_lock;');
 });
 await patch(base+'wasm/WasmModule.h',text=>replace(text,'    JS_EXPORT_PRIVATE ~Module();','    JS_EXPORT_PRIVATE uint64_t wasmFyiNativeCodeSize();\n    JS_EXPORT_PRIVATE ~Module();'));
 await patch(base+'wasm/WasmModule.cpp',text=>{
  text=replace(text,'#include "WasmModule.h"','#include "WasmModule.h"\n#include "WasmCalleeGroup.h"\n#include <algorithm>');
  return replace(text,'} } // namespace JSC::Wasm',`
uint64_t Module::wasmFyiNativeCodeSize()
{
    Vector<std::tuple<void*, void*>> ranges;
    Vector<RefPtr<Callee>> keepAlive;
    for (auto& group : m_calleeGroups) {
        if (group) group->wasmFyiAppendCodeRanges(ranges, keepAlive);
    }
    for (auto& stub : m_wasmToJSExitStubs) {
        if (auto* allocation = stub.executableMemory())
            ranges.append({ allocation->start().untaggedPtr(), allocation->end().untaggedPtr() });
    }
    std::sort(ranges.begin(), ranges.end(), [](auto& a, auto& b) {
        return reinterpret_cast<uintptr_t>(std::get<0>(a)) < reinterpret_cast<uintptr_t>(std::get<0>(b));
    });
    uintptr_t end = 0;
    uint64_t total = 0;
    for (auto& range : ranges) {
        auto start = reinterpret_cast<uintptr_t>(std::get<0>(range));
        auto stop = reinterpret_cast<uintptr_t>(std::get<1>(range));
        if (!start || stop <= start || stop <= end) continue;
        total += stop - std::max(start, end);
        end = stop;
    }
    return total;
}
} } // namespace JSC::Wasm`);
 });
 await patch(base+'jsc.cpp',text=>{
  text=replace(text,'#include "JSWebAssemblyMemory.h"','#include "JSWebAssemblyMemory.h"\n#include "JSWebAssemblyModule.h"\n#include "WasmModule.h"');
  const declaration='static JSC_DECLARE_HOST_FUNCTION(functionWebAssemblyMemoryMode);';
  text=replace(text,declaration,declaration+'\nstatic JSC_DECLARE_HOST_FUNCTION(functionWasmFyiNativeCodeSize);');
  const registration='addFunction(vm, "WebAssemblyMemoryMode"_s, functionWebAssemblyMemoryMode, 1);';
  text=replace(text,registration,registration+'\n        addFunction(vm, "wasmFyiNativeCodeSize"_s, functionWasmFyiNativeCodeSize, 1);');
  const definition='JSC_DEFINE_HOST_FUNCTION(functionWebAssemblyMemoryMode,';
  return replace(text,definition,`JSC_DEFINE_HOST_FUNCTION(functionWasmFyiNativeCodeSize, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (JSObject* object = callFrame->argument(0).getObject()) {
        if (auto* module = dynamicDowncast<JSWebAssemblyModule>(object))
            return JSValue::encode(jsNumber(static_cast<double>(module->module().wasmFyiNativeCodeSize())));
    }
    return throwVMTypeError(globalObject, scope, "wasmFyiNativeCodeSize requires a WebAssembly.Module"_s);
}

`+definition);
 });
 return {source:target,revision,files,policy:'Union of live module-owned BBQ/OMG/OSR JIT allocation extents and module import stubs; includes allocation alignment; deduplicates memory-mode aliases; excludes interpreter bytecode and shared engine code; inspection only'};
}
