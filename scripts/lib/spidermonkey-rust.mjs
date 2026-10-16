// Mozilla target detection can lag Rust's expanded target list. Select only
// explicitly provisioned compatible compilers; keep ESR build tools isolated.
export function spiderMonkeyRustEnvironment(env,minimumRust) {
 if(!env.WASMFYI_SPIDERMONKEY_LEGACY_RUST&&!env.WASMFYI_SPIDERMONKEY_RUST)return {...env};
 const parse=v=>{if(typeof v!=='string'||!/^\d+\.\d+(?:\.\d+)?$/.test(v)||v.trim()!==v)throw Error('Invalid SpiderMonkey Rust version '+v);const parts=v.split('.').map(Number);while(parts.length<3)parts.push(0);return parts;};
 const min=parse(minimumRust),compare=(a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2];
 const legacy=env.WASMFYI_SPIDERMONKEY_LEGACY_RUST&&compare(min,[1,70,0])<=0;
 const selected=legacy?env.WASMFYI_SPIDERMONKEY_LEGACY_RUST:env.WASMFYI_SPIDERMONKEY_RUST;
 if(!selected)return {...env};
 if(compare(parse(selected),min)<0)throw Error('Selected SpiderMonkey Rust is below pinned source minimum');
 if(!legacy)return {...env,RUSTUP_TOOLCHAIN:selected};
 const python=env.WASMFYI_SPIDERMONKEY_LEGACY_PYTHON;
 if(python&&(!python.startsWith('/')||/[\s\0\"'$`]/.test(python)))throw Error('Unsafe SpiderMonkey legacy Python path');
 const tools=env.WASMFYI_SPIDERMONKEY_LEGACY_BUILD;
 if(tools&&(!tools.startsWith('/')||/[\s\n\r"'$`]/.test(tools)))throw Error('Unsafe SpiderMonkey legacy tools path');
 return {...env,RUSTUP_TOOLCHAIN:selected,...(python?{WASMFYI_BUILD_PYTHON:python}:{}),...(tools?{PATH:tools+'/usr/bin:'+env.PATH,M4:tools+'/usr/bin/m4',AC_MACRODIR:tools+'/usr/share/autoconf2.13'}:{})};
}
