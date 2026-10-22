// SDK receipts retain the exact LLVM configuration even when build-only env
// variables were intentionally excluded from their runtime environment.
export function wamrRebuildEnvironment(receipt,environment) {
 const env={...environment},sdk=receipt.provenance?.sdk;
 env.LLVM_DIR ||=sdk?.flags?.find(flag=>flag.startsWith('-DLLVM_DIR='))?.slice('-DLLVM_DIR='.length);
 env.WASMFYI_WAMR_CXX_SDK ||=sdk?.compilerPrefix;
 const links=sdk?.flags?.find(flag=>flag.startsWith('-DCMAKE_EXE_LINKER_FLAGS='));
 env.WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR ||=links?.match(/(?:^|\s)(\/[^\s'"`$]+)\/libc\.so\.6(?:\s|$)/)?.[1];
 return env;
}
