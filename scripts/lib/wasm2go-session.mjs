import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function applyWasm2GoSession(root){
 const directory=join(root,'adapters/wasm2go'),path=join(directory,'main.go');
 let source=await readFile(path,'utf8');
 if(!/nativeWorker\s+\*persistentNativeWorker/.test(source)){
  const begin=source.indexOf('func (a *adapter) execute('),end=source.indexOf('func (a *adapter) run(',begin);
  if(begin<0||end<0||!source.includes('type adapter struct {')||!source.includes('func (a *adapter) close() {'))throw Error('Wasm2Go native session integration seam changed');
  source=source.slice(0,begin)+source.slice(end);
  source=source.replace('type adapter struct {','type adapter struct {\n nativeWorker *persistentNativeWorker');
  source=source.replace('func (a *adapter) close() {','func (a *adapter) close() {\n a.closeNativeWorker()');
  for(const unused of ['bytes','io'])source=source.replace(new RegExp('^\\t"'+unused+'"\\n','m'),'');
  const verification='\t\t\t\treturn nil, fmt.Errorf("compiled worker verification: %v", err)\n\t\t\t}';
  if(!source.includes(verification))throw Error('Wasm2Go final compiled-artifact cache seam changed');
  source=source.replace(verification,verification+'\n            a.worker=binary');
  await writeFile(path,source);
 }
 if(!source.includes('nativeGuestModulePath(dir)')){
  const module=/mod := fmt.Sprintf\("module wasmbench\.native\.worker\\n([^"]*)", root\)/;
  if(!module.test(source))throw Error('Wasm2Go cold guest-module compilation seam changed');
  source=source.replace(module,(_,tail)=>'mod := fmt.Sprintf("module %s\\n'+tail+'", nativeGuestModulePath(dir), root)');
  await writeFile(path,source);
 }
 for(const name of ['persistent_worker.go','persistent_worker_test.go'])await copyFile(fileURLToPath(new URL('../../adapters/wasm2go/'+name,import.meta.url)),join(directory,name));
 let worker=await readFile(join(directory,'worker.go.txt'),'utf8');
 const priming='if r.Scenario=="steady"{if !verifyModule(m,benchmarkCall(m,prep.Workload.Args)){return nil,fmt.Errorf("incorrect initial result")}};';
 worker=worker.replace(priming,'');
 if(!worker.includes('func watchNativeWorkerParent(){')){
  if(!worker.includes('func main(){'))throw Error('Wasm2Go native worker deadline seam changed');
  worker=worker.replace('import("bufio";','import("strconv";"bufio";');
  worker=worker.replace('func main(){','func main(){watchNativeWorkerParent();');
  worker+='\nfunc watchNativeWorkerParent(){parent:=os.Getppid();if len(os.Args)>1 {if value,err:=strconv.Atoi(os.Args[1]);err==nil{parent=value}};deadline:=time.Now().Add(5*time.Minute);go func(){ticker:=time.NewTicker(time.Second);defer ticker.Stop();for now:=range ticker.C{if os.Getppid()!=parent||now.After(deadline){os.Exit(124)}}}()}\n';
 }
 await writeFile(join(directory,'worker.go.txt'),worker);
 // Execute the real generated runBatch implementation against an instrumented
 // typed module; this catches hidden guest invocations without duplicating it.
 let test=worker.replace('import("strconv";','import("testing";"strconv";').replace('func main(){','func generatedWorkerMain(){');
 test=test.replaceAll('__INITIALIZE__','').replaceAll('__INPUT_POINTER__','').replaceAll('__OUTPUT_POINTER__','').replaceAll('__POINTER_CASES__','');
 test+='\ntype Module struct{}\nvar guestCalls int\nfunc newModule()*Module{return &Module{}}\nfunc moduleMemory(*Module)[]byte{return make([]byte,8)}\nfunc benchmarkCall(*Module,protocol.Values)protocol.Values{guestCalls++;return protocol.Values{1}}\nfunc TestGeneratedSteadyHasNoHiddenGuestInvocation(t *testing.T){prep=&protocol.Preparation{Workload:protocol.Workload{Oracle:protocol.Oracle{Kind:"exact_u64",Expected:protocol.Values{1}},Reset:"stateless"}};guestCalls=0;for i:=0;i<2;i++{samples,err:=runBatch(&protocol.RunRequest{Scenario:"steady",Samples:5,Operations:3,Warmup:0});if err!=nil||len(samples)!=5{t.Fatalf("batch: %v, %v",samples,err)};for _,sample:=range samples{if !sample.Verified{t.Fatal("missing independent oracle check")}}};if guestCalls!=30{t.Fatalf("executed %d guest calls; expected exactly 2*5*3",guestCalls)}}\n';
 await writeFile(join(directory,'generated_worker_call_count_test.go'),test);
}
