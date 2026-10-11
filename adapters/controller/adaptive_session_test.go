package experiment

import (
 "bufio"
 "context"
 "encoding/json"
 "fmt"
 "os"
 "path/filepath"
 goruntime "runtime"
 "strings"
 "syscall"
 "testing"
 "time"
 "github.com/wasmbench/wasmbench/protocol"
)

// A real JSON-lines child lets the test observe process identity, preparation
// count and retained compiler state rather than merely mocking method calls.
func TestAdaptiveSessionProcess(t *testing.T){
 mode:=os.Getenv("WASMFYI_ADAPTIVE_FAKE_MODE")
 if mode==""{t.Skip("adapter child only")}
 trace,err:=os.OpenFile(os.Getenv("WASMFYI_ADAPTIVE_FAKE_TRACE"),os.O_CREATE|os.O_APPEND|os.O_WRONLY,0600)
 if err!=nil{os.Exit(2)}
 defer trace.Close()
 encoder:=json.NewEncoder(os.Stdout);events:=json.NewEncoder(trace)
 scanner:=bufio.NewScanner(os.Stdin)
 prepared:=0;compiled:=false;groups:=map[string]int{}
 for scanner.Scan(){
  var request protocol.Request
  if json.Unmarshal(scanner.Bytes(),&request)!=nil{os.Exit(3)}
  response:=protocol.Response{Version:protocol.Version,ID:request.ID,Status:"ok"}
  scenario:=""
  if request.Run!=nil{scenario=request.Run.Scenario}
  events.Encode(map[string]any{"pid":os.Getpid(),"method":request.Method,"scenario":scenario,"prepared":prepared,"compiled":compiled})
  switch request.Method{
  case "prepare":prepared++;compiled=false
  case "run":
   if mode=="hang"{time.Sleep(30*time.Second)}
   if mode=="error"{response.Status="error";response.Reason="fixture phase failure";break}
   if scenario!="compile"&&!compiled{response.Status="error";response.Reason="compiled module cache was discarded";break}
   if scenario=="compile"{compiled=true}
   groups[scenario]++
   for index:=0;index<request.Run.Samples;index++{
    elapsed:=int64(100)
    if groups[scenario]==1{elapsed+=int64(index*40)}
    kind:="individual_operation";if request.Run.Operations>1{kind="batch_average"}
    response.Samples=append(response.Samples,protocol.Sample{Index:index,ElapsedNS:elapsed*int64(request.Run.Operations),Operations:request.Run.Operations,SampleType:kind,Verified:true,Result:protocol.Values{1}})
   }
  }
  if encoder.Encode(response)!=nil{os.Exit(4)}
 }
 os.Exit(0)
}

func adaptiveSessionFixture(t *testing.T,mode string,timeout time.Duration)(string,Options,Runtime,protocol.Workload,string){
 t.Helper();root:=t.TempDir();os.Mkdir(filepath.Join(root,"logs"),0700)
 trace:=filepath.Join(root,"trace.jsonl")
 phases:=[]string{"compile","instantiate","first-call","steady"}
 options:=Options{AdaptiveSamples:true,Profile:"timing",Samples:5,Operations:1,SteadyOperations:1000000,Scenarios:phases,Timeout:timeout,adaptiveSessions:newAdaptiveSessionPool(context.Background())}
 t.Cleanup(options.adaptiveSessions.closeAll)
 runtime:=Runtime{ID:"fixture",Command:[]string{"env","WASMFYI_ADAPTIVE_FAKE_MODE="+mode,"WASMFYI_ADAPTIVE_FAKE_TRACE="+trace,os.Args[0],"-test.run=^TestAdaptiveSessionProcess$"},Description:&protocol.Description{Runtime:"fixture",Version:"1",Backend:"fixture",Scenarios:phases,ABIs:[]string{"core"},Features:[]string{"mvp"},Capabilities:map[string]bool{}}}
 workload:=protocol.Workload{ID:"fixture/workload",Artifact:"module.wasm",ABI:"core",Reset:"stateless",Oracle:protocol.Oracle{Kind:"exact_u64",Expected:protocol.Values{1}}}
 return root,options,runtime,workload,trace
}

func TestAdaptiveSessionReusesProcessPreparationAndCompiledModule(t *testing.T){
 root,options,runtime,workload,trace:=adaptiveSessionFixture(t,"ok",2*time.Second)
 for index,phase:=range options.Scenarios{
  result:=runTrial(context.Background(),root,options,runtime,workload,phase,0,fmt.Sprintf("phase-%d",index))
  if result.Status!="ok"{t.Fatalf("%s: %s %s",phase,result.Status,result.Reason)}
  want:=15;if phase=="compile"||phase=="instantiate"{want=10}
  if len(result.Samples)!=want{t.Fatalf("%s: samples=%d, want %d ordered observations",phase,len(result.Samples),want)}
  for sampleIndex,sample:=range result.Samples{if sample.Index!=sampleIndex||sample.Warmup{t.Fatalf("invalid ordered/no-warmup sample: %+v",sample)}}
 }
 data,err:=os.ReadFile(trace);if err!=nil{t.Fatal(err)}
 pids:=map[float64]bool{};preparations:=0;runs:=0
 for _,line:=range strings.Split(strings.TrimSpace(string(data)),"\n"){
  var event map[string]any;if json.Unmarshal([]byte(line),&event)!=nil{t.Fatal("invalid trace")}
  pids[event["pid"].(float64)]=true
  if event["method"]=="prepare"{preparations++}
  if event["method"]=="run"{runs++}
 }
 if len(pids)!=1||preparations!=1||runs!=10{t.Fatalf("pids=%v preparations=%d run-groups=%d",pids,preparations,runs)}
 for pid:=range pids{if err:=syscall.Kill(int(pid),0);err==nil{t.Fatalf("adapter process %d survived final phase",int(pid))}}
}

func TestAdaptiveSessionFailureClosesProcessWithoutLaunchingAgain(t *testing.T){
 for _,mode:=range []string{"error","hang"}{
  t.Run(mode,func(t *testing.T){
   root,options,runtime,workload,trace:=adaptiveSessionFixture(t,mode,100*time.Millisecond)
   first:=runTrial(context.Background(),root,options,runtime,workload,"compile",0,"first")
   if first.Status=="ok"{t.Fatal("failed phase was successful")}
   second:=runTrial(context.Background(),root,options,runtime,workload,"instantiate",0,"second")
   if second.Status=="ok"{t.Fatal("failed session was reused as a successful phase")}
   data,err:=os.ReadFile(trace);if err!=nil{t.Fatal(err)}
   preparations:=strings.Count(string(data),`"method":"prepare"`)
   runs:=strings.Count(string(data),`"method":"run"`)
   if preparations!=1||runs!=1{t.Fatalf("relaunched after failure: preparations=%d runs=%d",preparations,runs)}
   for _,session:=range options.adaptiveSessions.sessions{if !session.closed||syscall.Kill(session.client.PID(),0)==nil{t.Fatal("failed adapter process survived")}}
  })
 }
}

func TestAdaptiveSessionKernelRSSIsResetAndReadForEachLivePhase(t *testing.T){
 if goruntime.GOOS!="linux"{t.Skip("Linux resettable RSS high-water mark")}
 root,options,runtime,workload,_:=adaptiveSessionFixture(t,"ok",2*time.Second)
 options.TimingPeakRSS=true
 for index,phase:=range options.Scenarios{
  result:=runTrial(context.Background(),root,options,runtime,workload,phase,0,fmt.Sprintf("rss-%d",index))
  if result.Status!="ok"{t.Fatalf("%s: %s",phase,result.Reason)}
  found:=false
  for _,observation:=range result.Observations{
   if observation.Metric=="process.peak_rss"{
    found=true
    if observation.Status!="available"||observation.Value==nil||*observation.Value<=0||observation.Phase!=phase+"/shared_process_phase"{t.Fatalf("%s RSS: %+v",phase,observation)}
   }
  }
  if !found{t.Fatalf("missing %s phase RSS",phase)}
 }
}

func TestAdaptivePhaseOrderKeepsFirstInvocationBeforeInstantiationValidation(t *testing.T){
 for _,test:=range []struct{in,want []string}{
  {[]string{"compile","instantiate","first-call","steady"},[]string{"compile","first-call","instantiate","steady"}},
  {[]string{"first-call","instantiate"},[]string{"first-call","instantiate"}},
  {[]string{"steady"},[]string{"steady"}},
 }{got:=adaptivePhaseOrder(test.in);if fmt.Sprint(got)!=fmt.Sprint(test.want){t.Fatalf("%v => %v, want %v",test.in,got,test.want)}}
}
