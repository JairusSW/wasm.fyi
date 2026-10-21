import {applyV8Turboshaft} from './lib/v8-turboshaft.mjs';
import {applyControllerPreflightPolicy} from './lib/controller-preflight-policy.mjs';
// Install the site's hardcoded same-process collector in an isolated harness.
import {readFile,writeFile,copyFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyWasm2GoSession} from './lib/wasm2go-session.mjs';
import {applyWazeroSampling} from './lib/wazero-sampling.mjs';
import {applyWasm2cExceptions} from './lib/wasm2c-exceptions.mjs';
import {applyWavmLoadDiagnostic} from './lib/wavm-load-diagnostic.mjs';
import {applyV8CacheFlag} from './lib/v8-cache-flag.mjs';
import {applyV8NativeSizePolicy} from './lib/v8-native-size-policy.mjs';
import {applyV8SingleCoreMode} from './lib/v8-single-core-mode.mjs';
import {applyPrivateELFInterpreter} from './lib/private-elf-interpreter.mjs';
import {applyJavaScriptSampling} from './lib/js-shell-sampling.mjs';
const root=resolve(process.argv[2]||'');
if(!process.argv[2])throw Error('Harness source directory required');
// A historical wazero rebuild only changes that adapter. Avoid migrating
// unrelated JS/V8 seams in a harness that may come from a newer recipe.
if(process.env.WASMFYI_PATCH_ONLY==='wazero'){
 await applyWazeroSampling(root);
 console.log('Installed wazero-only sampling and interruption policy in '+root);
 process.exit(0);
}
await applyV8SingleCoreMode(root);
await applyV8CacheFlag(root);
await applyV8NativeSizePolicy(root);
await applyV8Turboshaft(root);
await applyControllerPreflightPolicy(root);
await applyPrivateELFInterpreter(root);
const files=new Map();
for(const relative of ['experiment/types.go','experiment/runner.go','cmd/wasmbench/main.go'])files.set(relative,await readFile(join(root,relative),'utf8'));
if(!files.get('experiment/runner.go').includes('case "wasmer-cranelift":')){
 const current=files.get('experiment/runner.go');
 if(!current.includes('\t\tswitch id {'))throw Error('Wasmer Cranelift runtime registration seam changed');
 files.set('experiment/runner.go',current.replace('\t\tswitch id {',`\t\tswitch id {
        case "wasmer-cranelift":
            path := filepath.Join(root,"bin","adapter-wasmer-cranelift")
            r.Command=[]string{path}
            hash,err:=DigestFile(path)
            if err!=nil{return nil,err}
            r.Files[path]=hash`));
}
if(!files.get('experiment/runner.go').includes('case "wizard-v3-int", "wizard-fast-int", "wizard-spc":')){
 const current=files.get('experiment/runner.go');
 if(!current.includes('\t\tswitch id {'))throw Error('Wizard runtime registration seam changed');
 files.set('experiment/runner.go',current.replace('\t\tswitch id {',`\t\tswitch id {
        case "wizard-v3-int", "wizard-fast-int", "wizard-spc":
            commandFile := filepath.Join(root,"bin",id+"-command.json")
            data, err := os.ReadFile(commandFile)
            if err != nil { return nil, fmt.Errorf("Wizard SDK command: %w",err) }
            var manifest struct { Configuration string \`json:"configuration"\`; Revision string \`json:"revision"\`; Command []string \`json:"command"\`; Files map[string]string \`json:"files"\` }
            if err := json.Unmarshal(data,&manifest); err != nil { return nil, fmt.Errorf("Wizard SDK command JSON: %w",err) }
            if manifest.Configuration!=id || len(manifest.Revision)!=40 || len(manifest.Command)==0 || strings.TrimSpace(manifest.Command[0])=="" || len(manifest.Files)==0 { return nil, fmt.Errorf("Wizard SDK manifest identity or artifacts missing") }
            r.Command=manifest.Command
            hash, err := DigestFile(commandFile)
            if err != nil { return nil, err }
            r.Files[commandFile]=hash
            for path,want:=range manifest.Files { got,err:=DigestFile(path);if err!=nil{return nil,err};if got!=want{return nil,fmt.Errorf("Wizard SDK artifact digest differs: %s",path)};r.Files[path]=got }`));
}
if(!files.get('experiment/runner.go').includes('case "wazy":')){
 const current=files.get('experiment/runner.go');
 if(!current.includes('\t\tswitch id {'))throw Error('Runtime registration seam changed');
 files.set('experiment/runner.go',current.replace('\t\tswitch id {','\t\tswitch id {\n\t\tcase "wazy":\n\t\t\tr.Command = []string{filepath.Join(root, "bin", "adapter-wazy")}'));
 await writeFile(join(root,'experiment/runner.go'),files.get('experiment/runner.go'));
}
if(!files.get('experiment/runner.go').includes('case "endive-interpreter", "endive-jit", "endive-redline":')){
 const current=files.get('experiment/runner.go');
 files.set('experiment/runner.go',current.replace('\t\tswitch id {',`\t\tswitch id {
        case "endive-interpreter", "endive-jit", "endive-redline":
            java := os.Getenv("WASMBENCH_JAVA")
            if java == "" { java = "java" }
            r.Command = []string{java, "-XX:ActiveProcessorCount=1", "-XX:+UseSerialGC", "-Xbatch", "-cp", filepath.Join(root,"endive-classes")+string(os.PathListSeparator)+filepath.Join(root,"endive-sdk","*"), "EndiveAdapter"}
            if id == "endive-interpreter" { r.Command = append(r.Command,"--interpreter") }
            if id == "endive-redline" { r.Command = append(r.Command,"--redline") }`));
 await writeFile(join(root,'experiment/runner.go'),files.get('experiment/runner.go'));
}
if(!files.get('experiment/runner.go').includes('case "zwasm-interpreter", "zwasm-jit":')){
 const current=files.get('experiment/runner.go');
 if(!current.includes('\t\tswitch id {'))throw Error('Zwasm runtime registration seam changed');
 files.set('experiment/runner.go',current.replace('\t\tswitch id {',`\t\tswitch id {
        case "zwasm-interpreter", "zwasm-jit":
            library := filepath.Join(root,"bin","libzwasm-adapter.so")
            if runtime.GOOS=="darwin" { library=filepath.Join(root,"bin","libzwasm-adapter.dylib") }
            script := filepath.Join(root,"adapters","zwasm","adapter.py")
            mode := "--interpreter"
            if id=="zwasm-jit" { mode="--jit" }
            python, err := exec.LookPath("python3")
            if err != nil { return nil, fmt.Errorf("Zwasm Python interpreter: %w",err) }
            python, err = filepath.EvalSymlinks(python)
            if err != nil { return nil, fmt.Errorf("Zwasm canonical Python interpreter: %w",err) }
            python, err = filepath.Abs(python)
            if err != nil { return nil, err }
            r.Command=[]string{python,script,library,mode}
            for _,path:=range []string{script,library} { hash,err:=DigestFile(path);if err!=nil{return nil,err};r.Files[path]=hash }`));
}
// Upgrade already registered source-bound controllers as well as fresh ones.
if(files.get('experiment/runner.go').includes('r.Command=[]string{"python3",script,library,mode}')){
 files.set('experiment/runner.go',files.get('experiment/runner.go').replace('r.Command=[]string{"python3",script,library,mode}',`python, err := exec.LookPath("python3")
            if err != nil { return nil, fmt.Errorf("Zwasm Python interpreter: %w",err) }
            python, err = filepath.EvalSymlinks(python)
            if err != nil { return nil, fmt.Errorf("Zwasm canonical Python interpreter: %w",err) }
            python, err = filepath.Abs(python)
            if err != nil { return nil, err }
            r.Command=[]string{python,script,library,mode}`));
}
if(!files.get('experiment/runner.go').includes('case "graalwasm":')){
 const current=files.get('experiment/runner.go');
 if(!current.includes('\t\tswitch id {'))throw Error('GraalWasm runtime registration seam changed');
 files.set('experiment/runner.go',current.replace('\t\tswitch id {',`\t\tswitch id {
        case "graalwasm":
            commandFile := filepath.Join(root,"bin","graalwasm-command.json")
            data, err := os.ReadFile(commandFile)
            if err != nil { return nil, fmt.Errorf("GraalWasm SDK command: %w",err) }
            if err := json.Unmarshal(data,&r.Command); err != nil { return nil, fmt.Errorf("GraalWasm SDK command JSON: %w",err) }
            if len(r.Command)==0 || strings.TrimSpace(r.Command[0])=="" { return nil, fmt.Errorf("GraalWasm SDK command is empty") }
            hash, err := DigestFile(commandFile)
            if err != nil { return nil, err }
            r.Files[commandFile]=hash`));
}
if(!files.get('experiment/runner.go').includes('trackSDKJVMInputs(&r)')){
 const current=files.get('experiment/runner.go');
 const anchor='\t\tfor _, path := range r.Command {';
 if(!current.includes(anchor))throw Error('SDK command file resolver seam changed');
 files.set('experiment/runner.go',current.replace(anchor,`
        managedJVM := id=="chasm" || id=="chicory-jit" || strings.HasPrefix(id,"endive-") || id=="graalwasm" || id=="wizard-v3-int"
        if managedJVM { if err:=trackSDKJVMInputs(&r);err!=nil{return nil,fmt.Errorf("SDK JVM artifacts: %w",err)} }
`+anchor+`
            if (managedJVM || strings.HasPrefix(id,"wizard-")) && path!=r.Command[0] { continue } // SDK inputs above/manifest; flags and entrypoint are policy.
`));
}
function replace(file,old,next){const text=files.get(file);if(!text.includes(old))throw Error(`Collector source changed: ${file}`);files.set(file,text.replace(old,next));}
if(!files.get('experiment/types.go').includes('SteadyOperations'))replace('experiment/types.go','type Options struct {','type Options struct {\n SteadyOperations int `json:"steady_operations,omitempty"`');
if(!files.get('experiment/runner.go').includes('validateSteadyOperations(o.SteadyOperations)')){
 replace('experiment/runner.go','\to := l.Options','\to := l.Options\n if err := validateSteadyOperations(o.SteadyOperations); err != nil { return err }');
}
if(!files.get('experiment/runner.go').includes('r.Operations = o.SteadyOperations')){
 replace('experiment/runner.go','\tr := protocol.RunRequest{Scenario: scenario, Samples: o.Samples, Operations: o.Operations, Warmup: warmup, PhaseBarriers: o.PhaseBarriers && block >= 0}', '\tr := protocol.RunRequest{Scenario: scenario, Samples: o.Samples, Operations: o.Operations, Warmup: warmup, PhaseBarriers: o.PhaseBarriers && block >= 0}\n if scenario == "steady" && o.SteadyOperations > 0 { r.Operations = o.SteadyOperations }');
}
if(!files.get('cmd/wasmbench/main.go').includes('steadyOperations := f.Int(')){
 replace('cmd/wasmbench/main.go','\t\toperations :=','\t\tsteadyOperations := f.Int("steady-operations",0,"operations per steady batch only; 0 uses --operations, maximum 1000000")\n\t\toperations :=');
}
if(!files.get('cmd/wasmbench/main.go').includes('if *steadyOperations != 0')){
 replace('cmd/wasmbench/main.go','\t\tif *lockPath != "" {','\t\tif *lockPath != "" {\n   if *steadyOperations != 0 { return fmt.Errorf("--steady-operations cannot override an existing lock") }');
}
if(!files.get('cmd/wasmbench/main.go').includes('SteadyOperations:*steadyOperations,')){
 replace('cmd/wasmbench/main.go','experiment.Options{','experiment.Options{SteadyOperations:*steadyOperations,');
}
if(!files.get('experiment/runner.go').includes('case "chasm":')){
 const current=files.get('experiment/runner.go');
 files.set('experiment/runner.go',current.replace('\t\tswitch id {','\t\tswitch id {\n\t\tcase "chasm":\n\t\t\tr.Command = []string{filepath.Join(root, "bin", "adapter-chasm")}'));
 await writeFile(join(root,'experiment/runner.go'),files.get('experiment/runner.go'));
}
if(!files.get('experiment/runner.go').includes('chasm-command.json')){
 const current=files.get('experiment/runner.go');
 const legacy='r.Command = []string{filepath.Join(root, "bin", "adapter-chasm")}';
 if(!current.includes(legacy))throw Error('Chasm SDK command registration seam changed');
 files.set('experiment/runner.go',current.replace(legacy,`commandFile := filepath.Join(root,"bin","chasm-command.json")
            data, err := os.ReadFile(commandFile)
            if err != nil { return nil, fmt.Errorf("Chasm SDK command: %w",err) }
            if err := json.Unmarshal(data,&r.Command); err != nil { return nil, fmt.Errorf("Chasm SDK command JSON: %w",err) }
            if len(r.Command)==0 || strings.TrimSpace(r.Command[0])=="" { return nil, fmt.Errorf("Chasm SDK command is empty") }
            hash, err := DigestFile(commandFile)
            if err != nil { return nil, err }
            r.Files[commandFile]=hash`));
}
// Upgrade previously installed controllers as well as fresh harnesses.
{
 const current=files.get('experiment/runner.go');
 files.set('experiment/runner.go',current.replace('managedJVM := id=="chicory-jit"','managedJVM := id=="chasm" || id=="chicory-jit"'));
}
if(!files.get('experiment/runner.go').includes('case "chicory-jit":')){
 const current=files.get('experiment/runner.go');
 files.set('experiment/runner.go',current.replace('\t\tswitch id {',`\t\tswitch id {
        case "chicory-jit":
            java := os.Getenv("WASMBENCH_JAVA")
            if java == "" { java = "java" }
            r.Command = []string{java,"-XX:ActiveProcessorCount=1","-XX:+UseSerialGC","-Xbatch","-jar",filepath.Join(root,"bin","adapter-chicory-jit.jar")}`));
 await writeFile(join(root,'experiment/runner.go'),files.get('experiment/runner.go'));
}
if(!files.get('experiment/types.go').includes('AdaptiveSamples'))replace('experiment/types.go','type Options struct {','type Options struct {\n AdaptiveSamples bool `json:"adaptive_samples,omitempty"`');
if(!files.get('experiment/runner.go').includes('adaptive sampling requires timing')){
 replace('experiment/runner.go','\tif o.Launches < 1',` if o.AdaptiveSamples {
  if o.Profile!="timing"||o.Launches!=1||o.Samples!=5||o.Warmup!=0||o.PhaseBarriers{return fmt.Errorf("adaptive sampling requires timing, one process, groups of five, zero warmup, no phase barriers")}
  for _,n:=range o.ScenarioSamples{if n!=5{return fmt.Errorf("adaptive sample overrides must equal five")}}
  for _,scenario:=range o.Scenarios{if !slices.Contains([]string{"compile","instantiate","first-call","steady"},scenario){return fmt.Errorf("adaptive sampling requires latency scenarios")}}
 }
\tif o.Launches < 1`);
}
if(!files.get('experiment/runner.go').includes('collectAdaptiveSamples(func(group protocol.RunRequest)')){
 replace('experiment/runner.go','\t\tresp, e = c.CallPhased(protocol.Request{Method: "run", Run: &request}, handler)',`  if o.AdaptiveSamples && block>=0 && o.Profile=="timing" {
   resp,e=collectAdaptiveSamples(func(group protocol.RunRequest)(protocol.Response,error){return c.CallPhased(protocol.Request{Method:"run",Run:&group},nil)},request)
   request.Samples=len(resp.Samples)
  } else {
   resp, e = c.CallPhased(protocol.Request{Method: "run", Run: &request}, handler)
  }`);
}
if(!files.get('cmd/wasmbench/main.go').includes('adaptiveSamples := f.Bool(')){
 replace('cmd/wasmbench/main.go','\t\ttimingPeakRSS :=', '\t\tadaptiveSamples := f.Bool("adaptive-samples",false,"same-process groups of five until stable; compile/instantiate maximum 10; execution maximum 25; zero warmup")\n\t\ttimingPeakRSS :=');
}
if(!files.get('cmd/wasmbench/main.go').includes('if *adaptiveSamples{return')){
 replace('cmd/wasmbench/main.go','\t\tif *lockPath != "" {','\t\tif *lockPath != "" {\n   if *adaptiveSamples{return fmt.Errorf("--adaptive-samples cannot override an existing lock")}');
}
if(!files.get('cmd/wasmbench/main.go').includes('AdaptiveSamples:*adaptiveSamples,')){
 replace('cmd/wasmbench/main.go','experiment.Options{', 'experiment.Options{AdaptiveSamples:*adaptiveSamples,');
}
if(!files.get('experiment/types.go').includes('adaptiveSessions'))replace('experiment/types.go','type Options struct {','type Options struct {\n adaptiveSessions *adaptiveSessionPool');
if(!files.get('experiment/runner.go').includes('lock.Options.adaptiveSessions = newAdaptiveSessionPool(ctx)')){
 replace('experiment/runner.go','\texecutable, runnerErr := os.Executable()', '\tif lock.Options.AdaptiveSamples {\n  lock.Options.adaptiveSessions = newAdaptiveSessionPool(ctx)\n  defer lock.Options.adaptiveSessions.closeAll()\n }\n\texecutable, runnerErr := os.Executable()');
}
if(!files.get('experiment/runner.go').includes('groups := make(map[[3]int][]measurement)')){
 replace('experiment/runner.go','\t\tmeasurementOutcomes := make(map[string]int)',`  if lock.Options.AdaptiveSamples {
   // Finish one runtime/workload/launch before opening the next SDK session.
   groups := make(map[[3]int][]measurement)
   var order [][3]int
   for phaseIndex, scenario := range lock.Options.Scenarios {
    for _, job := range measurementsByScenario[scenario] {
     key := [3]int{job.block,job.workload,job.runtime}
     if phaseIndex==0 { order=append(order,key) }
     groups[key]=append(groups[key],job)
    }
   }
   phases=nil;manifest.Order=nil
   for _,key:=range order { for _,job:=range groups[key] { phases=append(phases,[]measurement{job});manifest.Order=append(manifest.Order,job.id) } }
  }
\t\tmeasurementOutcomes := make(map[string]int)`);
}
if(!files.get('experiment/runner.go').includes('adaptiveSessions.complete(')){
 replace('experiment/runner.go','\tstart := time.Now()\n\tdefer func() { t.DurationNS = time.Since(start).Nanoseconds() }()', '\tif o.adaptiveSessions != nil && block >= 0 { defer func(){ o.adaptiveSessions.complete(r,w,block,scenario,o,&t) }() }\n\tstart := time.Now()\n\tdefer func() { t.DurationNS = time.Since(start).Nanoseconds() }()');
}
if(!files.get('experiment/runner.go').includes('var sharedSession *adaptiveSession')){
 replace('experiment/runner.go','\tc, e := agent.StartIsolated(trialCtx, r.Command, filepath.Join(root, t.Log), o.Timeout, o.Resources)',` var sharedSession *adaptiveSession
 var c *agent.Client
 var e error
 if o.adaptiveSessions != nil && block >= 0 {
  sharedSession,e=o.adaptiveSessions.acquire(root,o,r,w,block,t.Log)
  if sharedSession!=nil { t.Log=sharedSession.log }
  if e==nil { c=sharedSession.client; if o.TimingPeakRSS { beginAdaptiveRSSPhase(sharedSession) } }
 } else { c,e=agent.StartIsolated(trialCtx,r.Command,filepath.Join(root,t.Log),o.Timeout,o.Resources) }`);
}
if(!files.get('experiment/runner.go').includes('sharedSession.failureStatus')){
 replace('experiment/runner.go','\t\tt.Reason = e.Error()\n\t\treturn\n\t}\n\tt.Isolation = c.Isolation()', '\t\tt.Reason = e.Error()\n  if sharedSession!=nil && sharedSession.failureStatus!="" { t.Status=sharedSession.failureStatus }\n\t\treturn\n\t}\n\tt.Isolation = c.Isolation()');
}
if(!files.get('experiment/runner.go').includes('adaptivePhaseRSS(')){
 replace('experiment/runner.go','\t\tif err := c.Close(); err != nil {',`  if sharedSession!=nil {
   if block>=0 && o.TimingPeakRSS { t.Observations=append(t.Observations,adaptivePhaseRSS(sharedSession,scenario)) }
   return
  }
\t\tif err := c.Close(); err != nil {`);
}
if(!files.get('experiment/runner.go').includes('context.AfterFunc(trialCtx')){
 replace('experiment/runner.go','\tprepareProfile := o.Profile',` if sharedSession!=nil {
  stop:=context.AfterFunc(trialCtx,func(){ sharedSession.cancel() })
  defer stop()
 }
\tprepareProfile := o.Profile`);
}
if(!files.get('experiment/runner.go').includes('sharedSession.prepared')){
 replace('experiment/runner.go','\tresp, e := c.Call(protocol.Request{Method: "prepare", Prepare: &protocol.Preparation{Artifact: filepath.Join(root, w.Artifact), ArtifactSHA256: w.SHA256, Workload: resolveCommandFiles(w, root), Profile: prepareProfile}})',` var resp protocol.Response
 if sharedSession==nil || !sharedSession.prepared {
  resp,e=c.Call(protocol.Request{Method:"prepare",Prepare:&protocol.Preparation{Artifact:filepath.Join(root,w.Artifact),ArtifactSHA256:w.SHA256,Workload:resolveCommandFiles(w,root),Profile:prepareProfile}})
  if e==nil && sharedSession!=nil { sharedSession.prepared=true }
 }`);
}
if(!files.get('experiment/runner.go').includes('for phaseIndex, scenario := range adaptivePhaseOrder(lock.Options.Scenarios) {'))files.set('experiment/runner.go',files.get('experiment/runner.go').replace('for phaseIndex, scenario := range lock.Options.Scenarios {','for phaseIndex, scenario := range adaptivePhaseOrder(lock.Options.Scenarios) {'));
for(const [file,text]of files)await writeFile(join(root,file),text);
for(const name of ['adaptive.go','adaptive_test.go','steady_operations_test.go','adaptive_session.go','adaptive_session_test.go','timing_rss.go','timing_rss_shared_test.go','runtime_inputs.go','runtime_inputs_test.go'])await copyFile(fileURLToPath(new URL('../adapters/controller/'+name,import.meta.url)),join(root,'experiment',name));
const jsPath=join(root,'adapters/js-shell/adapter.js');
let js=await readFile(jsPath,'utf8');
js=applyJavaScriptSampling(js);
await writeFile(jsPath,js);
console.log('Installed same-process sampling collector in '+root);

if(await stat(join(root,'adapters/wasm2go/main.go')).catch(()=>null))await applyWasm2GoSession(root);
if(await stat(join(root,'adapters/wazero/main.go')).catch(()=>null))await applyWazeroSampling(root);
await applyWasm2cExceptions(root);
if(await stat(join(root,'adapters/native/src/wavm.cpp')).catch(()=>null))await applyWavmLoadDiagnostic(root);
