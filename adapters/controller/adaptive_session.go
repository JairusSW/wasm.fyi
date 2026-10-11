package experiment

import (
 "context"
 "fmt"
 "os"
 "path/filepath"
 "runtime"
 "strconv"
 "strings"
 "sync"
 "github.com/wasmbench/wasmbench/agent"
 "github.com/wasmbench/wasmbench/protocol"
)

type adaptiveSessionKey struct { runtime, workload string; launch int }
type adaptiveSession struct {
 client *agent.Client
 context context.Context
 cancel context.CancelFunc
 log string
 prepared bool
 failure, failureStatus string
 closed bool
 phaseRSSReset bool
}
type adaptiveSessionPool struct {
 context context.Context
 mutex sync.Mutex
 sessions map[adaptiveSessionKey]*adaptiveSession
}
func newAdaptiveSessionPool(ctx context.Context)*adaptiveSessionPool{
 return &adaptiveSessionPool{context:ctx,sessions:map[adaptiveSessionKey]*adaptiveSession{}}
}
func (p *adaptiveSessionPool) acquire(root string,o Options,r Runtime,w protocol.Workload,block int,log string)(*adaptiveSession,error){
 key:=adaptiveSessionKey{r.ID,w.ID,block}
 p.mutex.Lock();defer p.mutex.Unlock()
 if session:=p.sessions[key];session!=nil{
  if session.failure!=""{return session,fmt.Errorf("%s",session.failure)}
  if session.closed{return session,fmt.Errorf("adaptive phase session already closed")}
  return session,nil
 }
 ctx,cancel:=context.WithTimeout(p.context,o.Timeout)
 session:=&adaptiveSession{context:ctx,cancel:cancel,log:log}
 p.sessions[key]=session
 client,err:=agent.StartIsolated(ctx,r.Command,filepath.Join(root,log),o.Timeout,o.Resources)
 if err!=nil{cancel();session.closed=true;session.failure=err.Error();session.failureStatus="error";return session,err}
 session.client=client
 return session,nil
}
func (p *adaptiveSessionPool) complete(r Runtime,w protocol.Workload,block int,scenario string,o Options,t *Trial){
 key:=adaptiveSessionKey{r.ID,w.ID,block}
 p.mutex.Lock();defer p.mutex.Unlock()
 session:=p.sessions[key]
 if session==nil||session.closed{return}
 if session.context.Err()==context.DeadlineExceeded{
  t.Status="timeout";t.Reason="adapter exceeded the complete workload phase-group deadline"
 }
 phases:=adaptivePhaseOrder(o.Scenarios)
 last:=len(phases)>0&&scenario==phases[len(phases)-1]
 if t.Status=="ok"&&!last{return}
 if t.Status!="ok"{session.failureStatus=t.Status;session.failure=fmt.Sprintf("adaptive phase %s: %s",scenario,t.Reason)}
 session.closed=true;session.cancel()
 if err:=session.client.Close();err!=nil{
  t.Status="error";t.Reason+="; shared phase-session cleanup: "+err.Error()
 }
 if o.TimingPeakRSS{
  observation:=session.client.PeakRSSObservation("phase-group")
  // This is a whole-session peak, not an individual phase peak.
  observation.Metric="process.session_peak_rss";observation.Profile=o.Profile
  t.Observations=append(t.Observations,observation)
 }
}
func (p *adaptiveSessionPool) closeAll(){
 p.mutex.Lock();defer p.mutex.Unlock()
 for _,session:=range p.sessions{
  if !session.closed&&session.client!=nil{session.closed=true;session.cancel();session.client.Close()}
 }
}
func beginAdaptiveRSSPhase(session *adaptiveSession){
 session.phaseRSSReset=false
 if runtime.GOOS=="linux"{
  session.phaseRSSReset=os.WriteFile(fmt.Sprintf("/proc/%d/clear_refs",session.client.PID()),[]byte("5"),0)==nil
 }
}
func adaptivePhaseRSS(session *adaptiveSession,scenario string)protocol.Observation{
 observation:=protocol.Observation{Metric:"process.peak_rss",DefinitionVersion:1,Unit:"bytes",Scope:"adapter_process",Phase:scenario+"/shared_process_phase",Collector:"proc_pid_status",CollectorVersion:"1",Quality:"kernel_accounted_phase_peak",Profile:"timing",Status:"unavailable",Denominator:"process"}
 if runtime.GOOS!="linux"{observation.Reason="platform does not expose resettable per-phase RSS high-water marks for a live shared process";return observation}
 if !session.phaseRSSReset{observation.Reason="kernel RSS high-water reset was unavailable; whole-session peak remains separate";return observation}
 data,err:=os.ReadFile(fmt.Sprintf("/proc/%d/status",session.client.PID()))
 if err!=nil{observation.Reason=err.Error();return observation}
 for _,line:=range strings.Split(string(data),"\n"){
  fields:=strings.Fields(line)
  if len(fields)==3&&fields[0]=="VmHWM:"&&fields[2]=="kB"{
   value,err:=strconv.ParseUint(fields[1],10,64)
   if err==nil{observation.Status="available";observation.Value=protocol.Value(float64(value)*1024);return observation}
  }
 }
 observation.Reason="live process RSS high-water mark is unavailable"
 return observation
}

// First-call observes a fresh instance before instantiation validation calls can
// tier the shared compiled module. This is not globally cold compiled code.
func adaptivePhaseOrder(requested []string)[]string{
 ordered:=make([]string,0,len(requested))
 for _,phase:=range []string{"compile","first-call","instantiate","steady"}{
  for _,candidate:=range requested{if candidate==phase{ordered=append(ordered,phase);break}}
 }
 return ordered
}
