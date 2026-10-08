import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';
export async function instrumentWasmEdgeJIT(source) {
 const files={};
 const replace=(text,anchor,value,path)=>{if(!text.includes(anchor))throw Error('Pinned WasmEdge JIT seam changed: '+path);return text.replace(anchor,value);};
 async function edit(path,transform) {const full=join(source,path);let text=await readFile(full,'utf8');if(!text.includes('wasmfyi_native_size')){text=transform(text);await writeFile(full,text);}else if(path==='lib/api/wasmedge.cpp'&&text.includes('WasmEdge::Loader::Loader Loader(ConfCxt->Conf);')){text=text.replace('WasmEdge::Loader::Loader Loader(ConfCxt->Conf);','WasmEdge::Loader::Loader Loader(ConfCxt->Conf, &WasmEdge::Executor::Executor::Intrinsics);');await writeFile(full,text);}files[path]=digest(Buffer.from(text));}
 const module='include/ast/module.h';
 await edit(module,t=>replace(t,'private:',`  // wasmfyi_native_size: inspection-only measured native text bytes.
  void wasmfyiSetNativeSize(uint64_t Size) noexcept { WasmfyiNativeBytes=Size; WasmfyiNativeMeasured=true; }
  bool wasmfyiGetNativeSize(uint64_t &Size) const noexcept { if(!WasmfyiNativeMeasured)return false; Size=WasmfyiNativeBytes; return true; }
private:
  uint64_t WasmfyiNativeBytes=0;
  bool WasmfyiNativeMeasured=false;`,module));
 const header='include/llvm/jit.h';
 await edit(header,t=>{
  t=t.replace('#include <memory>','#include <memory>\n#include <atomic>');
  t=replace(t,'class OrcLLJIT;',`class OrcLLJIT;
// wasmfyi_native_size: retained by the JIT library for callback lifetime.
struct WasmfyiNativeText { std::atomic<uint64_t> Bytes{0}; std::atomic<bool> Invalid{false}; };`,header);
  t=t.replace('  friend class JIT;','');
  const owner=t.match(/  (?:std::shared_ptr<(?:LLVM::)?OrcLLJIT> J|OrcLLJIT \*J);/)?.[0];if(!owner)throw Error('Pinned WasmEdge JIT owner seam changed');
  t=replace(t,owner,owner+'\n  std::shared_ptr<WasmfyiNativeText> WasmfyiSize;\n  friend class JIT;',header);
  t=replace(t,'JIT(const Configure &Conf) noexcept : Conf(Conf) {}','JIT(const Configure &Conf, std::shared_ptr<WasmfyiNativeText> Size = {}) noexcept : Conf(Conf), WasmfyiSize(std::move(Size)) {}',header);
  return replace(t,'  const Configure Conf;','  const Configure Conf;\n  std::shared_ptr<WasmfyiNativeText> WasmfyiSize;',header);
 });
 const jit='lib/llvm/jit.cpp';
 await edit(jit,t=>{
  t=replace(t,'#include "llvm/jit.h"','#include "llvm/jit.h"\n#include <llvm-c/Object.h>',jit);
  const anchor='  auto &LLModule = D.extract().LLModule;';
  t=replace(t,anchor,`  // wasmfyi_native_size: no object inspection in ordinary timed compilation.
  if (WasmfyiSize) LLVMOrcObjectTransformLayerSetTransform(
      LLVMOrcLLJITGetObjTransformLayer(${t.includes('OrcLLJIT J;')?'J':'LLJITInstance'}.unwrap()),
      [](void *Context, LLVMMemoryBufferRef *Buffer) -> LLVMErrorRef {
        auto &Size=*static_cast<WasmfyiNativeText *>(Context);
        char *Error=nullptr; auto Binary=LLVMCreateBinary(*Buffer,nullptr,&Error);
        if (!Binary) {Size.Invalid.store(true);LLVMDisposeMessage(Error);return LLVMErrorSuccess;}
        auto Section=LLVMObjectFileCopySectionIterator(Binary);
        while(!LLVMObjectFileIsSectionIteratorAtEnd(Binary,Section)) {
          const char *Name=LLVMGetSectionName(Section);
          if(Name && (strcmp(Name,"__text")==0 || strncmp(Name,".text",5)==0)) Size.Bytes.fetch_add(LLVMGetSectionSize(Section));
          LLVMMoveToNextSection(Section);
        }
        LLVMDisposeSectionIterator(Section);LLVMDisposeBinary(Binary);
        return LLVMErrorSuccess;
      },WasmfyiSize.get());
`+anchor,jit);
  // Main has lazy-JIT support; 0.17.x has a single eager load implementation.
  const marker=t.includes('IsLazy);')?'IsLazy);':'std::move(LLJITInstance)));';
  if(marker==='IsLazy);')return replace(t,'  return std::make_shared<JITLibrary>(\n      std::make_shared<OrcLLJIT>(std::move(LLJITInstance)), IsLazy);',`  auto Result=std::make_shared<JITLibrary>(std::make_shared<OrcLLJIT>(std::move(LLJITInstance)), IsLazy);
  Result->WasmfyiSize=WasmfyiSize; return Result;`,jit);
  if(t.includes('  return std::make_shared<JITLibrary>(std::move(J));'))return replace(t,'  return std::make_shared<JITLibrary>(std::move(J));','  auto Result=std::make_shared<JITLibrary>(std::move(J));\n  Result->WasmfyiSize=WasmfyiSize; return Result;',jit);
  return replace(t,'  return std::make_shared<JITLibrary>(\n      std::make_shared<OrcLLJIT>(std::move(LLJITInstance)));',`  auto Result=std::make_shared<JITLibrary>(std::make_shared<OrcLLJIT>(std::move(LLJITInstance)));
  Result->WasmfyiSize=WasmfyiSize; return Result;`,jit);
 });
 const api='lib/api/wasmedge.cpp';
 await edit(api,t=>t+`
// wasmfyi_native_size: explicit eager JIT compilation; no interpreter fallback.
#ifdef WASMEDGE_USE_LLVM
#include "llvm/jit.h"
#endif
extern "C" WASMEDGE_CAPI_EXPORT WasmEdge_Result wasmfyi_ast_compile_jit_measured(const WasmEdge_ConfigureContext *ConfCxt,WasmEdge_ASTModuleContext *ModuleCxt,bool Measure) noexcept {
  if(!ConfCxt||!ModuleCxt)return genWasmEdge_Result(ErrCode::Value::WrongVMWorkflow);
#ifdef WASMEDGE_USE_LLVM
  try {
    auto &Mod=*fromASTModCxt(ModuleCxt);
    if(!Mod.getIsValidated())return genWasmEdge_Result(ErrCode::Value::WrongVMWorkflow);
    WasmEdge::LLVM::Compiler Compiler(ConfCxt->Conf);
    if(auto Check=Compiler.checkConfigure();!Check)return genWasmEdge_Result(Check.error());
    auto Data=Compiler.compile(Mod);if(!Data)return genWasmEdge_Result(Data.error());
    auto Size=Measure?std::make_shared<WasmEdge::LLVM::WasmfyiNativeText>():nullptr;
    WasmEdge::LLVM::JIT JIT(ConfCxt->Conf,Size);
    auto Executable=JIT.load(std::move(*Data));if(!Executable)return genWasmEdge_Result(Executable.error());
    WasmEdge::Loader::Loader Loader(ConfCxt->Conf, &WasmEdge::Executor::Executor::Intrinsics);
    if(auto Loaded=Loader.loadExecutable(Mod,std::move(*Executable));!Loaded)return genWasmEdge_Result(Loaded.error());
    if(!Mod.getSymbol())return genWasmEdge_Result(ErrCode::Value::RuntimeError);
    for(const auto &Code:Mod.getCodeSection().getContent())if(!Code.getSymbol())return genWasmEdge_Result(ErrCode::Value::RuntimeError);
    if(Size){if(Size->Invalid.load()||(!Mod.getCodeSection().getContent().empty()&&!Size->Bytes.load()))return genWasmEdge_Result(ErrCode::Value::RuntimeError);Mod.wasmfyiSetNativeSize(Size->Bytes.load());}
    return genWasmEdge_Result(ErrCode::Value::Success);
  }catch(...){return handleCAPIError();}
#else
  return genWasmEdge_Result(ErrCode::Value::RuntimeError);
#endif
}
extern "C" WASMEDGE_CAPI_EXPORT WasmEdge_Result wasmfyi_ast_compile_jit(const WasmEdge_ConfigureContext *ConfCxt,WasmEdge_ASTModuleContext *ModuleCxt) noexcept {
  return wasmfyi_ast_compile_jit_measured(ConfCxt,ModuleCxt,false);
}
extern "C" WASMEDGE_CAPI_EXPORT bool wasmfyi_ast_native_size(const WasmEdge_ASTModuleContext *Cxt,uint64_t *Size) noexcept {
  return Cxt&&Size&&fromASTModCxt(Cxt)->getSymbol()&&fromASTModCxt(Cxt)->wasmfyiGetNativeSize(*Size);
}
`);
 const exports='lib/api/libwasmedge.lds';
 await edit(exports,t=>replace(t,'global:', 'global:\n    wasmfyi_*; /* wasmfyi_native_size */',exports));
 return {policy:'Explicit Compiler + JIT + Loader native-symbol attachment; fail closed. Native text sizes measured only on inspect passes.',files,patchSha256:digest(Buffer.from(JSON.stringify(files)))};
}
