package main

import (
	"context"
 "fmt"
	"testing"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/wasmbench/wasmbench/protocol"
)

type samplingEngine struct{ wazero.Runtime }
type samplingCompiled struct{ wazero.CompiledModule }
type samplingInstance struct{ api.Module }
type samplingFunction struct {
	api.Function
	calls, invalidAt int
}

func (f *samplingFunction) Call(context.Context, ...uint64) ([]uint64, error) {
	f.calls++
	if f.calls == f.invalidAt {
		return []uint64{99}, nil
	}
	return []uint64{7}, nil
}

func samplingAdapter(f *samplingFunction) *adapter {
	return &adapter{
		prep: &protocol.Preparation{Profile: "timing", Workload: protocol.Workload{
			Reset: "stateless", Oracle: protocol.Oracle{Kind: "exact_u64", Expected: protocol.Values{7}},
		}},
		engine: &samplingEngine{}, compiled: &samplingCompiled{}, instance: &samplingInstance{}, fn: f,
	}
}

func TestSamplingSteadyHasExactlyRecordedCalls(t *testing.T) {
	f := &samplingFunction{}
	a := samplingAdapter(f)
	engine, compiled, instance := a.engine, a.compiled, a.instance
	for group := 0; group < 2; group++ {
		samples, err := a.run(&protocol.RunRequest{Scenario: "steady", Samples: 5, Operations: 3})
		if err != nil || len(samples) != 5 {
			t.Fatalf("group %d: samples=%v error=%v", group, samples, err)
		}
		for _, sample := range samples {
			if !sample.Verified || sample.Warmup || sample.Operations != 3 {
				t.Fatalf("incorrect sample policy: %+v", sample)
			}
		}
	}
	if f.calls != 30 {
		t.Fatalf("guest calls=%d; want exactly 2 groups * 5 samples * 3 operations", f.calls)
	}
	if a.engine != engine || a.compiled != compiled || a.instance != instance {
		t.Fatal("steady sample groups replaced prepared runtime artifacts")
	}
}

func TestSamplingSteadyValidatesEveryRecordedResult(t *testing.T) {
	f := &samplingFunction{invalidAt: 2}
	_, err := samplingAdapter(f).run(&protocol.RunRequest{Scenario: "steady", Samples: 1, Operations: 3})
	if err == nil {
		t.Fatal("an incorrect middle result was accepted")
	}
	if f.calls != 3 {
		t.Fatalf("guest calls=%d; want only the three recorded operations", f.calls)
	}
}

// A second invocation destroys the fixture, matching data.drop and memory.grow
// lifecycle contracts. Fresh instances must be used for every recorded sample.
type destructiveSamplingFunction struct { api.Function; calls int; bad bool }
func (f *destructiveSamplingFunction) Call(context.Context, ...uint64) ([]uint64,error) {
 f.calls++
 if f.calls>1 { return nil,fmt.Errorf("destructive fixture invoked twice") }
 if f.bad { return []uint64{99},nil }
 return []uint64{7},nil
}
type destructiveSamplingModule struct { api.Module; fn *destructiveSamplingFunction; closed bool }
func (m *destructiveSamplingModule) Close(context.Context) error { m.closed=true; return nil }
func (m *destructiveSamplingModule) ExportedFunction(string) api.Function { return m.fn }
type destructiveSamplingRuntime struct { wazero.Runtime; instances []*destructiveSamplingModule; bad bool }
func (e *destructiveSamplingRuntime) InstantiateModule(context.Context,wazero.CompiledModule,wazero.ModuleConfig) (api.Module,error) {
 m:=&destructiveSamplingModule{fn:&destructiveSamplingFunction{bad:e.bad}}
 e.instances=append(e.instances,m)
 return m,nil
}
func TestSamplingFreshDestructiveFixturesAcrossGroups(t *testing.T) {
 for _,phase:=range []string{"instantiate","first-call","steady"} {
  t.Run(phase,func(t *testing.T){
   e:=&destructiveSamplingRuntime{}
   // The preceding phase has already consumed this retained instance.
   old:=&destructiveSamplingModule{fn:&destructiveSamplingFunction{calls:1}}
   a:=&adapter{prep:&protocol.Preparation{Profile:"timing",Workload:protocol.Workload{Reset:"fresh_instance_per_sample",Export:"run",Oracle:protocol.Oracle{Kind:"exact_u64",Expected:protocol.Values{7}}}},engine:e,compiled:&samplingCompiled{},instance:old,fn:old.fn}
   for group:=0;group<2;group++ {
    samples,err:=a.run(&protocol.RunRequest{Scenario:phase,Samples:5,Operations:3})
    if err!=nil||len(samples)!=5 {t.Fatalf("group %d: %v, %v",group,samples,err)}
    for _,sample:=range samples {if !sample.Verified||sample.Operations!=1||sample.Warmup {t.Fatalf("sample: %+v",sample)}}
   }
   if old.fn.calls!=1 {t.Fatalf("consumed prior instance called %d times",old.fn.calls)}
   if len(e.instances)!=10 {t.Fatalf("instances=%d, want 10",len(e.instances))}
   for i,m:=range e.instances {if m.fn.calls!=1 {t.Fatalf("instance %d calls=%d",i,m.fn.calls)}}
  })
 }
}
func TestSamplingFreshDestructiveOracleFailureIsRejected(t *testing.T) {
 for _,phase:=range []string{"instantiate","first-call","steady"} {
  e:=&destructiveSamplingRuntime{bad:true}
  old:=&destructiveSamplingModule{fn:&destructiveSamplingFunction{calls:1}}
  a:=&adapter{prep:&protocol.Preparation{Profile:"timing",Workload:protocol.Workload{Reset:"fresh_instance_per_sample",Export:"run",Oracle:protocol.Oracle{Kind:"exact_u64",Expected:protocol.Values{7}}}},engine:e,compiled:&samplingCompiled{},instance:old,fn:old.fn}
  if _,err:=a.run(&protocol.RunRequest{Scenario:phase,Samples:1,Operations:1});err==nil {t.Fatalf("%s accepted wrong oracle",phase)}
 }
}
