import {isAbsolute} from 'node:path';
import {nodeBuildPython} from './node-build-python.mjs';

export async function javaScriptCoreBuildPython(env,run) {
 const selected=await nodeBuildPython(env,run,'JavaScriptCore');
 // CMake converts an untyped relative Python value to a source-relative
 // FILEPATH. Resolve the selected interpreter before passing any cache flags.
 const program=(await run(selected.program,['-c','import sys; print(sys.executable)'])).output.trim();
 if(!isAbsolute(program)||/[\r\n\0;]/.test(program))throw Error('JavaScriptCore selected Python did not report a usable absolute executable');
 return {...selected,program};
}

export function javaScriptCorePythonFlags(program) {
 if(!isAbsolute(program)||/[\r\n\0;]/.test(program))throw Error('JavaScriptCore Python CMake flags require an absolute executable');
 return ['Python_EXECUTABLE','Python3_EXECUTABLE','PYTHON_EXECUTABLE'].map(key=>'-D'+key+'='+program);
}
