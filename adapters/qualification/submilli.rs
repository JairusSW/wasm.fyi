use anyhow::{Result, ensure};
use submilli_wasm::{Config, Linker, Store, Val, ValType};
pub fn version() -> String {
    env!("SUBMILLI_REVISION").into()
}
pub struct Engine(submilli_wasm::Engine);
pub struct Module(submilli_wasm::Module);
pub struct Instance {
    store: Store<()>,
    instance: submilli_wasm::Instance,
}
impl Engine {
    pub fn new() -> Result<Self> {
        let mut config = Config::default();
        config.consume_fuel(false).epoch_interruption(false);
        Ok(Self(submilli_wasm::Engine::new(&config)?))
    }
    pub fn compile(&self, bytes: &[u8]) -> Result<Module> {
        let module = submilli_wasm::Module::new(&self.0, bytes)?;
        Ok(Module(module))
    }
    pub fn instantiate(&self, module: &Module) -> Result<Instance> {
        let mut store = Store::new(&self.0, ());
        let mut linker = Linker::new(&self.0);
        linker.func_wrap("wasmbench", "identity", |value: i32| value)?;
        linker.func_new("env", "abort", submilli_wasm::FuncType::new(&self.0, [ValType::I32, ValType::I32, ValType::I32, ValType::I32], []), |_, _, _| { return Err(submilli_wasm::Error::msg("guest abort")) })?;
        let instance = linker.instantiate(&mut store, &module.0)?;
        Ok(Instance { store, instance })
    }
}
impl Instance {
    pub fn signature(&mut self, name: &str) -> Result<(Vec<u8>, Vec<u8>)> {
        let func = self.instance.get_func(&mut self.store, name).ok_or_else(|| anyhow::anyhow!("missing export {name}"))?;
        let ty = func.ty(&self.store);
        let code = |t| match t { ValType::I32 => Ok(0x7f), ValType::I64 => Ok(0x7e), _ => anyhow::bail!("unsupported: integer signature required") };
        Ok((ty.params().map(code).collect::<Result<_>>()?, ty.results().map(code).collect::<Result<_>>()?))
    }
    pub fn call(&mut self, name: &str, args: &[u64]) -> Result<Vec<u64>> {
        let f = self
            .instance
            .get_func(&mut self.store, name)
            .ok_or_else(|| anyhow::anyhow!("missing export {name}"))?;
        let ty = f.ty(&self.store);
        ensure!(args.len() == ty.params().len(), "argument count mismatch");
        let params: Result<Vec<_>> = args
            .iter()
            .zip(ty.params())
            .map(|(v, t)| match t {
                ValType::I32 => Ok(Val::I32(*v as i32)),
                ValType::I64 => Ok(Val::I64(*v as i64)),
                _ => anyhow::bail!("unsupported: integer signature required"),
            })
            .collect();
        let mut results: Vec<_> = ty
            .results()
            .map(|t| match t { ValType::I32 => Val::I32(0), _ => Val::I64(0) })
            .collect();
        ensure!(
            ty.results()
                .all(|t| matches!(t, ValType::I32 | ValType::I64)),
            "unsupported: integer results required"
        );
        f.call(&mut self.store, &params?, &mut results)?;
        Ok(results
            .iter()
            .map(|v| match v {
                Val::I32(x) => *x as u32 as u64,
                Val::I64(x) => *x as u64,
                _ => unreachable!(),
            })
            .collect())
    }
    pub fn memory(&mut self) -> Result<&mut [u8]> {
        let memory = self
            .instance
            .get_memory(&mut self.store, "memory")
            .ok_or_else(|| anyhow::anyhow!("missing exported memory"))?;
        Ok(memory.data_mut(&mut self.store))
    }
}
