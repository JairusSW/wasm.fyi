
/// Measurement-only getter; returns bytes, never process addresses.
#[cfg(feature = "sys")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wasmbench_module_native_function_size(module: Option<&wasm_module_t>, bytes_out: *mut usize) -> bool {
    if bytes_out.is_null() { return false; }
    let Some(module) = module else { return false; };
    let measured = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        use wasmer_compiler::ArtifactCreate;
        let artifact = module.inner.sys_artifact()?;
        let extents = artifact.finished_function_extents()?;
        let info = artifact.module_info();
        let expected = info.functions.len().checked_sub(info.num_imported_functions)?;
        if extents.len() != expected { return None; }
        extents.iter().try_fold(0usize, |size, (_, extent)| size.checked_add(extent.length))
    }));
    if let Ok(Some(size)) = measured { unsafe { *bytes_out = size; } true } else { false }
}
