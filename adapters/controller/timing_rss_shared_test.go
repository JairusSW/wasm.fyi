package experiment
import("testing";"github.com/wasmbench/wasmbench/protocol")
func TestSharedTimingRSSRequiresAdaptivePhaseProvenance(t *testing.T){
 peak:=protocol.Observation{Metric:"process.peak_rss",DefinitionVersion:1,Unit:"bytes",Scope:"adapter_process",Phase:"compile/shared_process_phase",Collector:"proc_pid_status",CollectorVersion:"1",Quality:"kernel_accounted_phase_peak",Profile:"timing",Status:"available",Denominator:"process",Value:protocol.Value(123456)}
 b:=Bundle{Manifest:Manifest{Lock:Lock{Options:Options{Profile:"timing",TimingPeakRSS:true,AdaptiveSamples:true}}},Trials:[]Trial{{ID:"one",Scenario:"compile",Profile:"timing",Status:"ok",Block:0,Observations:[]protocol.Observation{peak}}}}
 if err:=ValidateTimingPeakRSS(b);err!=nil{t.Fatal(err)}
 for _,mutate:=range []func(*Bundle){func(b *Bundle){b.Manifest.Lock.Options.AdaptiveSamples=false},func(b *Bundle){b.Trials[0].Observations[0].Phase="steady/shared_process_phase"},func(b *Bundle){b.Trials[0].Observations[0].Collector="wait4_rusage"}}{
  copy:=b;copy.Trials=append([]Trial{},b.Trials...);copy.Trials[0].Observations=append([]protocol.Observation{},b.Trials[0].Observations...);mutate(&copy);if ValidateTimingPeakRSS(copy)==nil{t.Fatal("accepted mismatched shared-phase provenance")}
 }
}
