import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from './wasmbench.mjs';

const threadProfiles=[
 'threads-defined-v1',
 'threads-identity-v1',
 'threads-opaque-identity-v1',
];

const documentedFeatures=[
 'mvp',
 'bulk-memory',
 'reference-types',
 'multi-value',
 'sign-extension',
 'nontrapping-fptoint',
 'memory64',
 'extended-const',
 'tail-call',
 'threads',
 'wide-arithmetic',
];

export function wasm2goFeaturePolicySource(source) {
 let result=source;
 for(const profile of threadProfiles){
  const capability=`"can_host_profile_${profile}": true`;
  if(!result.includes(capability))result=result.replace('Capabilities: map[string]bool{',`Capabilities: map[string]bool{${capability}, `);
 }
 result=result.replace(/Features: \[\]string\{[^}]*\}/,`Features: []string{${documentedFeatures.map(feature=>JSON.stringify(feature)).join(', ')}}`);
 if(!result.includes('func wasm2goExportName(')){
  result=result
   .replace('\t"go/token"','\t"go/token"\n\t"hash/crc32"')
   .replace('\t"runtime"','\t"runtime"\n\t"strconv"')
   .replace('\t"strings"','\t"strings"\n\t"slices"')
   .replace('\t"time"','\t"time"\n\t"unicode"')
   .replace('func method(file *ast.File, name string) (*ast.FuncDecl, error) {',`func wasm2goExportName(name string) string {
\tvar identifier strings.Builder
\tidentifier.WriteByte('X')
\tsuffix := false
\tfor _, r := range name {
\t\tif !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' {
\t\t\tsuffix = true
\t\t\tr = '_'
\t\t}
\t\tidentifier.WriteRune(r)
\t}
\tif suffix {
\t\tidentifier.WriteByte('_')
\t\tconst mod = 36 * 36 * 36 * 36 * 36 * 36
\t\tchecksum := crc32.Checksum([]byte(name), crc32.MakeTable(crc32.Castagnoli)) % mod
\t\tidentifier.WriteString(strconv.FormatUint(uint64(checksum), 36))
\t}
\treturn identifier.String()
}

func method(file *ast.File, name string) (*ast.FuncDecl, error) {`)
   .replaceAll('method(file, "X"+name)','method(file, wasm2goExportName(name))');
 }
 result=result
  .replaceAll('method(file, "X"+name)','method(file, wasm2goExportName(name))')
  .replace('invoke := "m.X" + name + "(" + strings.Join(args, ",") + ")"','invoke := "m." + fn.Name.Name + "(" + strings.Join(args, ",") + ")"')
  .replace('initialize = "m.X" + name + "()"','initialize = "m." + wasm2goExportName(name) + "()"')
  .replace('input = "offset+=uint64(uint32(m.X" + in.PointerExport + "()))"','input = "offset+=uint64(uint32(m." + wasm2goExportName(in.PointerExport) + "()))"')
  .replace('output = "offset=uint64(uint32(m.X" + name + "()))"','output = "offset=uint64(uint32(m." + wasm2goExportName(name) + "()))"')
  .replace('pointerCases += fmt.Sprintf("case %q:return []uint64{uint64(uint32(m.X%s()))},nil;", name, name)','pointerCases += fmt.Sprintf("case %q:return []uint64{uint64(uint32(m.%s()))},nil;", name, wasm2goExportName(name))');
 if(!result.includes('slices.Contains(a.prep.Workload.Features, "threads")')){
  if(!result.includes('"slices"'))result=result.replace('\t"strings"','\t"strings"\n\t"slices"');
  result=result.replace(
   'command := exec.CommandContext(ctx, translator, "-pkg", "main", "-o", source, a.prep.Artifact)',
   'translateArgs := []string{"-pkg", "main", "-o", source}\n\tif slices.Contains(a.prep.Workload.Features, "threads") {\n\t\ttranslateArgs = append(translateArgs, "-unsafe")\n\t}\n\ttranslateArgs = append(translateArgs, a.prep.Artifact)\n\tcommand := exec.CommandContext(ctx, translator, translateArgs...)');
 }
 for(const profile of threadProfiles)if(!result.includes(`"can_host_profile_${profile}": true`))throw Error('Incomplete wasm2go host-profile policy: '+profile);
 for(const feature of documentedFeatures)if(!result.includes(JSON.stringify(feature)))throw Error('Incomplete wasm2go feature declaration: '+feature);
 if(!result.includes('func wasm2goExportName(')||result.includes('method(file, "X"+name)')||result.includes('"m.X" + name'))throw Error('Incomplete wasm2go export-name policy');
 if(!result.includes('slices.Contains(a.prep.Workload.Features, "threads")'))throw Error('Incomplete wasm2go thread translator policy');
 return result;
}

export async function applyWasm2GoFeaturePolicy(root) {
 const path=join(root,'adapters/wasm2go/main.go');
 const before=await readFile(path,'utf8');
 const after=wasm2goFeaturePolicySource(before);
 if(after!==before)await writeFile(path,after);
 return {policy:'documented-features-export-names-and-thread-flags-v1',mainSha256:digest(Buffer.from(after))};
}
