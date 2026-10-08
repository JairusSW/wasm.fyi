import type {Source} from './api/benchmark-types';
export function shortVersion(value:string):string {
 const commit=value.match(/^(?:main@)?([a-f0-9]{40})(?:\/|$)/i);if(commit)return commit[1].slice(0,8);
 const pseudo=value.match(/v\d+\.\d+\.\d+-\d+\.\d{14}-([a-f0-9]{12,40})/i);if(pseudo)return pseudo[1].slice(0,8);
 return value.replace(/\b[a-f0-9]{12,64}\b/gi,hash=>hash.slice(0,8)).replace(/^binary-sha256:/,'sha256:');
}
export function versionIdentity(version:string,source?:Source):{label:string;url:string|null} {
 const label=shortVersion(source?.kind==='release'?source.ref:version);
 if(!source||!/^[-\w.]+\/[-\w.]+$/.test(source.repository))return {label,url:null};
 const base='https://github.com/'+source.repository;
 const commit=source.revision.match(/^([a-f0-9]{40})(?:\/|$)/i)?.[1] || version.match(/v\d+\.\d+\.\d+-\d+\.\d{14}-([a-f0-9]{12,40})/i)?.[1];
 if(source.kind==='release'&&source.dateBasis)return {label,url:commit?base+'/commit/'+commit:null};
 if(source.kind==='release')return {label,url:base+'/releases/tag/'+encodeURIComponent(source.ref)};
 if(commit)return {label,url:base+'/commit/'+commit};
 const v8=version.match(/^(\d+\.\d+\.\d+\.\d+)(?:-node\.\d+)?$/);
 if(source.repository==='nodejs/node'&&v8)return {label,url:'https://chromium.googlesource.com/v8/v8/+/refs/tags/'+v8[1]};
 if(/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))return {label,url:base+'/releases/tag/'+encodeURIComponent(version.startsWith('v')?version:source.repository==='bytecodealliance/wasm-micro-runtime'||source.repository==='wasm-micro-runtime/wasm-micro-runtime'?'WAMR-'+version:'v'+version)};
 if(/^nightly-[\w.-]+$/.test(version))return {label,url:base+'/releases/tag/'+encodeURIComponent(version)};
 return {label,url:null};
}
