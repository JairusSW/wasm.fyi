use anyhow::{anyhow, ensure, Result};
use libwasm_engine::{
    compile,
    module::ImportDescription,
    runtime::{ExternValue, HostCallback, InstanceAddress, Store, Value},
    types::ValType,
    Module as RuntimeModule,
};
use std::{fs, rc::Rc, sync::Arc};

pub fn version() -> String {
    env!("WASMBENCH_LIBWASM_VERSION").to_owned()
}

pub struct Engine;
pub struct Module(Arc<RuntimeModule>);
pub struct Instance {
    store: Store,
    instance: InstanceAddress,
}

pub fn enable_native_size_capture() {
    let mut options = std::env::var("LIBWASM_JIT").unwrap_or_else(|_| "eager,sync,threads=1".to_owned());
    for required in ["eager", "sync", "perf-map"] {
        if !options.split(',').any(|option| option == required) {
            options.push(',');
            options.push_str(required);
        }
    }
    // Code inspection deliberately compiles every function. The adapter is
    // single-threaded and sets this before LibWasm reads its process-wide JIT
    // options for the first time; timed captures retain their selected mode.
    unsafe { std::env::set_var("LIBWASM_JIT", options) };
}

impl Engine {
    pub fn new() -> Result<Self> {
        Ok(Self)
    }

    pub fn compile(&self, bytes: &[u8]) -> Result<Module> {
        Ok(Module(Arc::new(compile(bytes).map_err(|error| anyhow!("LibWasm compilation failed: {error:?}"))?)))
    }

    pub fn instantiate(&self, module: &Module) -> Result<Instance> {
        let mut store = Store::new();
        let mut imports = Vec::with_capacity(module.0.imports.len());
        for import in &module.0.imports {
            ensure!(
                import.module == "wasmbench" && import.name == "identity",
                "unsupported: LibWasm host import {}.{}",
                import.module,
                import.name
            );
            let ImportDescription::Function(type_index) = import.description else {
                return Err(anyhow!("unsupported: non-function LibWasm host import"));
            };
            let ty = module.0.types[type_index as usize]
                .as_func()
                .ok_or_else(|| anyhow!("invalid LibWasm function import type"))?
                .clone();
            ensure!(ty.params == ty.results, "unsupported: identity import signature");
            let callback: HostCallback = Rc::new(|_: &mut Store, arguments: &[Value]| Ok(arguments.to_vec()));
            imports.push(ExternValue::Function(store.allocate_host_function(ty, callback)));
        }
        let instance = store
            .instantiate(module.0.clone(), &imports)
            .map_err(|error| anyhow!("LibWasm instantiation failed: {error:?}"))?;
        Ok(Instance { store, instance })
    }
}

fn value_kind(ty: ValType) -> Result<u8> {
    Ok(match ty {
        ValType::I32 => 0x7f,
        ValType::I64 => 0x7e,
        ValType::F32 => 0x7d,
        ValType::F64 => 0x7c,
        _ => return Err(anyhow!("unsupported: non-scalar export signature")),
    })
}

fn argument(ty: ValType, bits: u64) -> Result<Value> {
    Ok(match ty {
        ValType::I32 => Value::I32(bits as u32 as i32),
        ValType::I64 => Value::I64(bits as i64),
        ValType::F32 => Value::F32(bits as u32),
        ValType::F64 => Value::F64(bits),
        _ => return Err(anyhow!("unsupported: non-scalar export signature")),
    })
}

fn result_bits(value: Value) -> Result<u64> {
    Ok(match value {
        Value::I32(value) => value as u32 as u64,
        Value::I64(value) => value as u64,
        Value::F32(bits) => bits as u64,
        Value::F64(bits) => bits,
        _ => return Err(anyhow!("unsupported: non-scalar export result")),
    })
}

impl Instance {
    pub fn native_size(&self) -> Result<usize> {
        let map = fs::read_to_string(format!("/tmp/perf-{}.map", std::process::id()))
            .map_err(|error| anyhow!("LibWasm perf map unavailable: {error}"))?;
        let size = map
            .lines()
            .filter_map(|line| {
                let mut fields = line.split_whitespace();
                fields.next()?;
                let size = fields.next()?;
                let name = fields.next()?;
                name.starts_with("wasm-function-")
                    .then(|| usize::from_str_radix(size, 16).ok())
                    .flatten()
            })
            .sum();
        ensure!(size > 0, "LibWasm JIT produced no native functions");
        Ok(size)
    }

    fn function(&self, name: &str) -> Result<libwasm_engine::runtime::FunctionAddress> {
        match self.store.instance(self.instance).export(name) {
            Some(ExternValue::Function(function)) => Ok(function),
            _ => Err(anyhow!("missing function export {name}")),
        }
    }

    pub fn signature(&self, name: &str) -> Result<(Vec<u8>, Vec<u8>)> {
        let function = self.function(name)?;
        let ty = &self.store.function(function).ty;
        Ok((
            ty.params.iter().copied().map(value_kind).collect::<Result<_>>()?,
            ty.results.iter().copied().map(value_kind).collect::<Result<_>>()?,
        ))
    }

    pub fn call(&mut self, name: &str, arguments: &[u64]) -> Result<Vec<u64>> {
        let function = self.function(name)?;
        let params = self.store.function(function).ty.params.clone();
        ensure!(params.len() == arguments.len(), "signature arity mismatch");
        let values = params
            .into_iter()
            .zip(arguments.iter().copied())
            .map(|(ty, bits)| argument(ty, bits))
            .collect::<Result<Vec<_>>>()?;
        self.store
            .invoke(function, &values)
            .map_err(|error| anyhow!("guest trap in LibWasm: {error:?}"))?
            .into_iter()
            .map(result_bits)
            .collect()
    }

    pub fn memory(&mut self) -> Result<&mut [u8]> {
        let memory = match self.store.instance(self.instance).export("memory") {
            Some(ExternValue::Memory(memory)) => memory,
            _ => return Err(anyhow!("missing exported memory")),
        };
        Ok(self.store.memory_mut(memory).bytes_mut())
    }
}
