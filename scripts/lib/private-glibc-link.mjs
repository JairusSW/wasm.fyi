// Qualified host-private glibc is required by prebuilt LLVM support objects.
// This keeps actual unresolved imports strict; it never supplies symbol stubs.
export function privateGlibcLinkFlags(env,platform=process.platform) {
 if(platform!=='linux'||!env.WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR)return [];
 const prefix=env.WASMFYI_PRIVATE_GLIBC_LIBRARY_DIR;
 if(!prefix.startsWith('/')||/[\s"'`$]/.test(prefix))throw Error('Unsafe private glibc library prefix');
 return ['-Wl,--no-as-needed',prefix+'/libc.so.6','-Wl,--as-needed','-Wl,--disable-new-dtags','-Wl,-rpath,'+prefix,'-Wl,-rpath-link,'+prefix];
}
