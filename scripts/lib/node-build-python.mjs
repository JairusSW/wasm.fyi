export async function nodeBuildPython(env,run,engine='Node') {
 const program=env.WASMFYI_BUILD_PYTHON||env.WASMFYI_NODE_PYTHON||'python3';
 const version=(await run(program,['-c','import sys; print(".".join(map(str,sys.version_info[:3])))'])).output.trim();
 const match=version.match(/^(\d+)\.(\d+)\.(\d+)$/);
 if(!match||Number(match[1])!==3||Number(match[2])<10)throw Error(engine+' source configure requires Python >=3.10; selected '+program+' reported '+version);
 return {program,version};
}

export function nodeBuildEnvironment(env,platform=process.platform) {
 if(platform!=='linux')return {...env};
 const prefix=env.WASMFYI_NODE_CXX_SDK||env.WASMFYI_WAVM_CXX_SDK;
 if(!prefix)return {...env};
 if(!prefix.startsWith('/')||/[\s"'`$]/.test(prefix))throw Error('Unsafe Node compiler SDK prefix');
 const library=prefix+'/lib/x86_64-unknown-linux-gnu';
 return {...env,CC:prefix+'/bin/clang',CXX:prefix+'/bin/clang++',
  CXXFLAGS:[env.CXXFLAGS,'-stdlib=libc++','-nostdinc++','-I'+prefix+'/include/c++/v1'].filter(Boolean).join(' '),
  LDFLAGS:[env.LDFLAGS,'-stdlib=libc++','-L'+library,'-Wl,-rpath,'+library,'-fuse-ld='+prefix+'/bin/ld.lld'].filter(Boolean).join(' ')};
}
