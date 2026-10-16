import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';

// Historical Mac ports force browser components on after reading CMake flags.
// Change only their build configuration in the isolated measurement worktree.
export function javaScriptCoreMacComponentPolicy(text) {
 const replacements=[
  ['set(ENABLE_WEBKIT_LEGACY ON)','set(ENABLE_WEBKIT_LEGACY OFF)'],
  ['set(ENABLE_WEBKIT ON)','set(ENABLE_WEBKIT OFF)'],
  ['SET_AND_EXPOSE_TO_BUILD(USE_LIBWEBRTC TRUE)','SET_AND_EXPOSE_TO_BUILD(USE_LIBWEBRTC FALSE)'],
  ['set(USE_ANGLE_EGL ON)','set(USE_ANGLE_EGL OFF)'],
 ];
 const matches=replacements.map(([before])=>text.split(before).length-1);
 if(matches.every(count=>count===0))return null;
 if(matches.some(count=>count!==1))throw Error('Unrecognized historical JSC Mac browser-component settings');
 return replacements.reduce((value,[before,after])=>value.replace(before,after),text);
}
export async function prepareJavaScriptCoreMacComponents({source,target,enabled}) {
 if(!enabled)return null;
 const path='Source/cmake/OptionsMac.cmake',original=await readFile(join(source,path),'utf8');
 const patched=javaScriptCoreMacComponentPolicy(original);if(patched===null)return null;
 const current=await readFile(join(target,path),'utf8');
 if(current!==original&&current!==patched)throw Error('Preserve unrelated JSC Mac build changes');
 if(current!==patched)await writeFile(join(target,path),patched);
 return {path,upstreamSha256:digest(Buffer.from(original)),patchedSha256:digest(Buffer.from(patched)),policy:'Disable forced WebKit, WebKitLegacy, libwebrtc and ANGLE browser build components; preserve the Mac port, compiler flags and framework layout'};
}
