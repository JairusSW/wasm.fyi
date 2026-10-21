import test from 'node:test';
import assert from 'node:assert/strict';
import {wasm2goFeaturePolicySource} from './lib/wasm2go-feature-policy.mjs';

const source=`import (
\t"go/token"
\t"runtime"
\t"strings"
\t"time"
)
func method(file *ast.File, name string) (*ast.FuncDecl, error) { return nil, nil }
func callBody(file *ast.File, name string) { fn, _ := method(file, "X"+name); invoke := "m.X" + name + "(" + strings.Join(args, ",") + ")"; _, _ = fn, invoke }
func pointers(file *ast.File, name string) { method(file, "X"+name) }
func vectors(file *ast.File, name string) { method(file, "X"+name) }
func wrapper(name string, in input) { initialize = "m.X" + name + "()"; input = "offset+=uint64(uint32(m.X" + in.PointerExport + "()))"; output = "offset=uint64(uint32(m.X" + name + "()))"; pointerCases += fmt.Sprintf("case %q:return []uint64{uint64(uint32(m.X%s()))},nil;", name, name) }
func build() { command := exec.CommandContext(ctx, translator, "-pkg", "main", "-o", source, a.prep.Artifact); _ = command }
var description = protocol.Description{Capabilities: map[string]bool{"can_compile_separately": true}, Features: []string{"mvp", "bulk-memory"}}`;

test('advertises wasm2go documented features and supported thread host profiles',()=>{
 const result=wasm2goFeaturePolicySource(source);
 for(const profile of ['threads-defined-v1','threads-identity-v1','threads-opaque-identity-v1'])assert.match(result,new RegExp(`can_host_profile_${profile}`));
 for(const feature of ['memory64','extended-const','tail-call','threads','wide-arithmetic'])assert.match(result,new RegExp(`"${feature}"`));
 assert.match(result,/func wasm2goExportName/);
 assert.equal(result.match(/method\(file, wasm2goExportName\(name\)\)/g)?.length,3);
 assert.match(result,/invoke := "m\." \+ fn\.Name\.Name/);
 assert.doesNotMatch(result,/m\.X%s/);
 assert.match(result,/"hash\/crc32"/);
 assert.match(result,/slices\.Contains\(a\.prep\.Workload\.Features, "threads"\)/);
 assert.match(result,/append\(translateArgs, "-unsafe"\)/);
 assert.equal(wasm2goFeaturePolicySource(result),result);
});
