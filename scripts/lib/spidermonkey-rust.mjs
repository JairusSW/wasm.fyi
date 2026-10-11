// Old Mozilla target detection predates modern Rust's expanded target list.
// Select an explicitly provisioned compatible compiler only for old sources.
export function spiderMonkeyRustEnvironment(env,minimumRust) {
 const selected=env.WASMFYI_SPIDERMONKEY_LEGACY_RUST;
 if(!selected)return {...env};
 const parse=v=>{if(!/^\d+\.\d+\.\d+$/.test(v))throw Error('Invalid SpiderMonkey Rust version '+v);return v.split('.').map(Number);};
 const min=parse(minimumRust),version=parse(selected);
 const compare=(a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2];
 if(compare(min,[1,70,0])>0)return {...env};
 if(compare(version,min)<0)throw Error('Selected SpiderMonkey Rust is below pinned source minimum');
 const python=env.WASMFYI_SPIDERMONKEY_LEGACY_PYTHON;
 if(python&&(!python.startsWith('/')||/[\s\0\"'$`]/.test(python)))throw Error('Unsafe SpiderMonkey legacy Python path');
 const tools=env.WASMFYI_SPIDERMONKEY_LEGACY_BUILD;
 if(tools&&(!tools.startsWith('/')||/[\s\n\r"'$`]/.test(tools)))throw Error('Unsafe SpiderMonkey legacy tools path');
 return {...env,RUSTUP_TOOLCHAIN:selected,...(python?{WASMFYI_BUILD_PYTHON:python}:{}),...(tools?{PATH:tools+'/usr/bin:'+env.PATH,M4:tools+'/usr/bin/m4',AC_MACRODIR:tools+'/usr/share/autoconf2.13'}:{})};
}
