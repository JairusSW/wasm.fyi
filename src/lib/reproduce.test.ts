import {describe,it,expect} from 'vitest';
import {reproductionCommand,shellToken} from './reproduce';
const source={repository:'wago-org/wago',revision:'a'.repeat(40),ref:'main',kind:'snapshot' as const,asOf:'2026-11-03'};
describe('local reproduction commands',()=>{
 it('pins runtime, artifact and contract instead of silently running latest',()=>{
  const {command}=reproductionCommand({engines:[{engine:'wago',source}],workloads:['applications/image-blur'],artifact:'b'.repeat(64),contract:'c'.repeat(64),pinned:true});
  expect(command).toContain('wago-railshot@'+source.revision);expect(command).toContain('--artifact applications/image-blur='+'b'.repeat(64));expect(command).toContain('--contract');expect(command).toContain('--rerun');
 });
 it('quotes imported strings and refuses unrecorded source identities',()=>{
  expect(shellToken("a'; touch /tmp/pwn")).toBe("'a'\\''; touch /tmp/pwn'");
  expect(()=>reproductionCommand({engines:[{engine:'wago'}],workloads:['applications/a'],pinned:true})).toThrow(/not recorded/);
 });
 it('requires the same dirty source snapshot for local reproductions',()=>{
  const {command}=reproductionCommand({engines:[{engine:'wago',source:{...source,ref:'local:'+source.revision+':'+'d'.repeat(64)}}],workloads:['applications/a'],pinned:true});expect(command).toContain('--source wago-railshot=/path/to/wago');expect(command).toContain('--source-digest '+'d'.repeat(64));
 });
});
