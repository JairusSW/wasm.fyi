// Native C bridge generation shared with historical AOT qualification.
fn ctype(t: ValType, wasm2c: bool) -> &'static str {
    match (t, wasm2c) {
        (ValType::I32, true) => "u32",
        (ValType::I64, true) => "u64",
        (ValType::I32, false) => "U32",
        _ => "U64",
    }
}
fn bridge(
    wasm2c: bool,
    exports: &[Export],
    memory: &Option<String>,
    identity: bool,
    abort: bool,
) -> String {
    let instance = if wasm2c { "w2c_wb" } else { "m2_wbInstance" };
    let mut c = format!(
        "#include \"wb.h\"\n#include <stdlib.h>\n#include <stdint.h>\n#include <setjmp.h>\n#include <stdio.h>\nstatic jmp_buf boundary;\nstatic char error[256];\nconst char* wb_error(void){{return error;}}\n"
    );
    if wasm2c {
        c.push_str("void wb_trap(wasm_rt_trap_t code){snprintf(error,sizeof(error),\"guest trap %d\",(int)code);longjmp(boundary,1);}\nvoid wb_init(void){wasm_rt_init();}\nvoid wb_fini(void){wasm_rt_free();}\n");
    } else {
        c.push_str("void trap(Trap code){snprintf(error,sizeof(error),\"guest trap: %s\",trapDescription(code));longjmp(boundary,1);}\nvoid wb_init(void){}\nvoid wb_fini(void){}\n");
    }
    if identity {
        // The callback is an opaque host boundary, including under GCC LTO.
        // Keep the call and its side effect; otherwise an identity loop vanishes.
        c.push_str("#if defined(__clang__)\n#define WB_CALLBACK __attribute__((noinline))\n#else\n#define WB_CALLBACK __attribute__((noinline,noipa))\n#endif\n");
        c.push_str(if wasm2c {
            "WB_CALLBACK u32 w2c_wasmbench_identity(struct w2c_wasmbench*p,u32 x){(void)p;__asm__ __volatile__(\"\" ::: \"memory\");return x;}\n"
        } else {
            "WB_CALLBACK U32 i9_wasmbench8_identity(wasmModuleInstance*p,U32 x){(void)p;__asm__ __volatile__(\"\" ::: \"memory\");return x;}\n"
        });
    }
    if abort {
        c.push_str(if wasm2c {"void w2c_env_abort(struct w2c_env*p,u32 a,u32 b,u32 c,u32 d){(void)p;snprintf(error,sizeof(error),\"AssemblyScript abort message_ptr=%u file_ptr=%u line=%u column=%u\",a,b,c,d);longjmp(boundary,1);}\n"} else {"void i3_env5_abort(wasmModuleInstance*p,U32 a,U32 b,U32 c,U32 d){(void)p;snprintf(error,sizeof(error),\"AssemblyScript abort message_ptr=%u file_ptr=%u line=%u column=%u\",a,b,c,d);longjmp(boundary,1);}\n"});
    }
    c.push_str(&format!("void* wb_new(void){{{instance}*i=calloc(1,sizeof(*i));if(!i)return NULL;if(setjmp(boundary)){{free(i);return NULL;}}"));
    if wasm2c {
        c.push_str(&format!(
            "wasm2c_wb_instantiate(i{}{});return i;}}\n",
            if identity { ",NULL" } else { "" },
            if abort { ",NULL" } else { "" }
        ));
    } else {
        c.push_str("m2_wbInstantiate(i,NULL);return i;}\n");
    }
    c.push_str(&format!("void wb_free(void*p){{{instance}*i=p;"));
    c.push_str(if wasm2c {
        "wasm2c_wb_free(i);free(i);}\n"
    } else {
        "m2_wbFreeInstance(i);free(i);}\n"
    });
    c.push_str(&format!("int wb_call(void*p,unsigned id,const uint64_t*a,uint64_t*r){{{instance}*i=p;if(setjmp(boundary))return -1;switch(id){{\n"));
    for (id, e) in exports.iter().enumerate() {
        let args = e
            .params
            .iter()
            .enumerate()
            .map(|(n, t)| format!(",({})a[{n}]", ctype(*t, wasm2c)))
            .collect::<String>();
        let prefix = if e.results.is_empty() {
            ""
        } else {
            "r[0]=(uint64_t)"
        };
        c.push_str(&format!(
            "case {id}: {prefix}{}(i{args});return 0;\n",
            e.symbol
        ));
    }
    c.push_str("default:return -2;}}\n");
    c.push_str(&format!(
        "unsigned char* wb_memory(void*p,size_t*n){{{instance}*i=p;"
    ));
    if let Some(symbol) = memory {
        c.push_str(&format!(
            "{}*m={symbol}(i);*n={};return m->data;}}\n",
            if wasm2c {
                "wasm_rt_memory_t"
            } else {
                "wasmMemory"
            },
            if wasm2c {
                "m->size"
            } else {
                "(size_t)m->pages*65536"
            }
        ));
    } else {
        c.push_str("*n=0;return NULL;}\n");
    }
    c
}
