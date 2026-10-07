// Admission for the application corpus only. WASI proposal/conformance fixtures
// deliberately live outside this boundary and retain their own host contracts.
export function assertMainCorpusContract(workload, bytes) {
  if (workload.abi !== 'core') throw new Error(`Main corpus requires core ABI: ${workload.id}`);
  if (workload.command || workload.abi === 'emscripten') throw new Error(`Main corpus cannot require command/host glue: ${workload.id}`);
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module);
  for (const item of imports) {
    // The existing AssemblyScript kernels use a fail-closed fatal assertion
    // callback. It is not a filesystem, environment, clock, or syscall adapter.
    const fatalAssertion = workload.host_profile === 'assemblyscript-abort-v1'
      && item.module === 'env' && item.name === 'abort' && item.kind === 'function';
    if (!fatalAssertion) throw new Error(`Main corpus host import forbidden: ${workload.id}: ${item.module}.${item.name}`);
  }
  return imports;
}
