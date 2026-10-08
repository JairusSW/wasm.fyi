import {expect,it} from 'vitest';
import {shortVersion,versionIdentity} from './version-identity';
const source={repository:'wago-org/wago',revision:'a'.repeat(40)+'/source-'+ 'b'.repeat(64),ref:'main',asOf:'2026-10-08T00:00:00Z',kind:'current' as const};
it('shortens commit and artifact hashes without losing full commit targets',()=>{
 expect(versionIdentity(source.revision,source)).toEqual({label:'aaaaaaaa',url:'https://github.com/wago-org/wago/commit/'+ 'a'.repeat(40)});
 expect(shortVersion('binary-sha256:'+ 'c'.repeat(64))).toBe('sha256:cccccccc');
 expect(versionIdentity('binary-sha256:'+ 'c'.repeat(64),{...source,revision:'binary-sha256:'+ 'c'.repeat(64)}).url).toBeNull();
});
it('links exact released tags and Go pseudo-version commits',()=>{
 expect(versionIdentity('1.2.3',{...source,kind:'release',ref:'v1.2.3'})).toEqual({label:'v1.2.3',url:'https://github.com/wago-org/wago/releases/tag/v1.2.3'});
 expect(versionIdentity('wasm2go v0.4.17-0.20261007174606-87c392b92214 / go1.27',{...source,repository:'ncruces/wasm2go',revision:'unknown'})).toEqual({label:'87c392b9',url:'https://github.com/ncruces/wasm2go/commit/87c392b92214'});
});
it('links module-only tagged versions to their exact commits',()=>{
 expect(versionIdentity('wasm2go v0.4.9',{...source,repository:'ncruces/wasm2go',revision:'a'.repeat(40),kind:'release',ref:'v0.4.9',dateBasis:'go-module-commit'})).toEqual({label:'v0.4.9',url:'https://github.com/ncruces/wasm2go/commit/'+'a'.repeat(40)});
});
it('links versions without release entries to their exact tagged source',()=>{
 expect(versionIdentity('a'.repeat(40),{...source,repository:'dylibso/chicory',revision:'a'.repeat(40),kind:'release',ref:'1.7.4',dateBasis:'git-tag-commit'})).toEqual({label:'1.7.4',url:'https://github.com/dylibso/chicory/commit/'+'a'.repeat(40)});
});
