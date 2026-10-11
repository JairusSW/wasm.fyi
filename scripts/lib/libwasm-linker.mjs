import {isAbsolute} from 'node:path';

// Rust's default system cc must not link objects built against a private C/C++
// sysroot. Use the same configured C driver, which carries that sysroot policy.
export function libwasmLinkerEnvironment(env,platform=process.platform,arch=process.arch){
 if(platform!=='linux'||!env.WASMFYI_LIBWASM_CC)return {...env};
 if(!isAbsolute(env.WASMFYI_LIBWASM_CC))throw Error('Libwasm private C driver must be an absolute path');
 const target={x64:'X86_64_UNKNOWN_LINUX_GNU',arm64:'AARCH64_UNKNOWN_LINUX_GNU'}[arch];
 if(!target)throw Error('Unsupported Libwasm private linker architecture: '+arch);
 return {...env,['CARGO_TARGET_'+target+'_LINKER']:env.WASMFYI_LIBWASM_CC};
}
