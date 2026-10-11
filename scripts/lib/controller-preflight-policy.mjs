import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
// Future controller builds can omit sacrificial runs for ordinary core workloads.
export async function applyControllerPreflightPolicy(root){
 const path=join(root,'experiment/runner.go');let source=await readFile(path,'utf8');
 if(source.includes('skipOrdinaryPreflight := false'))return;
 const declaration='\tpreflight := make([]Trial, len(lock.Workloads)*len(lock.Runtimes))';
 const start='\tpreflightErr := parallel(ctx, lock.Options.Workers, len(preflight), func(index int) error {';
 const gate='\t\t\tif check.Status != "ok" {';
 for(const seam of [declaration,start,gate])if(!source.includes(seam))throw Error('Controller preflight seam changed');
 source=source.replace(declaration,`\tskipOrdinaryPreflight := false
\tif os.Getenv("WASMFYI_HISTORY_FAST") == "1" && !lock.Options.Check {
\t\tskipOrdinaryPreflight = true
\t\tfor _, w := range lock.Workloads {
\t\t\tif w.ABI != "core" || w.SnapshotDensity != nil || w.ProcessSnapshot != nil || w.Continuation != nil || w.Checkpoint != nil || w.GuestDensity != nil || w.Density != nil {
\t\t\t\tskipOrdinaryPreflight = false
\t\t\t\tbreak
\t\t\t}
\t\t}
\t}
\tif skipOrdinaryPreflight {
\t\tif err := WriteJSON(filepath.Join(out, "preflight-policy.json"), map[string]string{"mode":"omitted", "scope":"ordinary-core", "reason":"requested-performance-only", "measured_checksums":"unchanged"}); err != nil { return out, err }
\t}
`+declaration);
 source=source.replace(start,start+'\n\t\tif skipOrdinaryPreflight { return nil }');
 source=source.replace(gate,'\t\t\tif !skipOrdinaryPreflight && check.Status != "ok" {');
 await writeFile(path,source);
}
