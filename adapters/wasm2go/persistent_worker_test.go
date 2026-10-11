package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"github.com/wasmbench/wasmbench/protocol"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	mode := os.Getenv("WASMFYI_WASM2GO_FAKE_CHILD")
	if mode == "" {
		os.Exit(m.Run())
	}
	trace, err := os.OpenFile(os.Getenv("WASMFYI_WASM2GO_TRACE"), os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		os.Exit(2)
	}
	defer trace.Close()
	events := json.NewEncoder(trace)
	encoder := json.NewEncoder(os.Stdout)
	scanner := bufio.NewScanner(os.Stdin)
	prepared := 0
	for scanner.Scan() {
		var request protocol.Request
		if json.Unmarshal(scanner.Bytes(), &request) != nil {
			os.Exit(3)
		}
		response := protocol.Response{Version: 1, ID: request.ID, Status: "ok"}
		event := map[string]any{"pid": os.Getpid(), "method": request.Method, "prepares": prepared}
		switch request.Method {
		case "prepare":
			prepared++
			event["prepares"] = prepared
		case "run":
			event["phase"] = request.Run.Scenario
			if prepared != 1 {
				response.Status = "error"
				response.Reason = "compiled worker prepared more than once"
			}
			events.Encode(event)
			if mode == "hang" {
				time.Sleep(time.Hour)
			}
			if mode == "error" {
				response.Status = "error"
				response.Reason = "guest oracle rejected"
			} else {
				for i := 0; i < request.Run.Samples; i++ {
					response.Samples = append(response.Samples, protocol.Sample{Index: i, ElapsedNS: 100, Operations: request.Run.Operations, Verified: true, Result: protocol.Values{1}})
				}
			}
			encoder.Encode(response)
			continue
		}
		events.Encode(event)
		encoder.Encode(response)
	}
	os.Exit(0)
}
func nativeFixture(t *testing.T, mode string) (string, string) {
	t.Helper()
	dir := t.TempDir()
	binary := filepath.Join(dir, "native")
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(self, binary); err != nil {
		t.Fatal(err)
	}
	trace := filepath.Join(dir, "events.jsonl")
	if err = os.WriteFile(trace, nil, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("WASMFYI_WASM2GO_FAKE_CHILD", mode)
	t.Setenv("WASMFYI_WASM2GO_TRACE", trace)
	return binary, trace
}
func TestNativeWorkerRetainsOnePIDAndPreparationAcrossPhasesAndGroups(t *testing.T) {
	binary, trace := nativeFixture(t, "ok")
	a := &adapter{prep: &protocol.Preparation{Profile: "timing"}, worker: binary}
	defer a.closeNativeWorker()
	var pid int
	for _, phase := range []string{"first-call", "instantiate", "steady", "steady", "steady"} {
		samples, err := a.run(&protocol.RunRequest{Scenario: phase, Samples: 5, Operations: 1})
		if err != nil || len(samples) != 5 {
			t.Fatalf("%s: %+v %v", phase, samples, err)
		}
		if pid == 0 {
			pid = a.nativeWorker.client.PID()
		} else if pid != a.nativeWorker.client.PID() {
			t.Fatal("native worker relaunched")
		}
	}
	a.closeNativeWorker()
	if syscall.Kill(pid, 0) == nil {
		t.Fatal("native process survived close")
	}
	data, err := os.ReadFile(trace)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 6 {
		t.Fatalf("unexpected protocol count: %s", data)
	}
	for _, line := range lines {
		var event map[string]any
		json.Unmarshal([]byte(line), &event)
		if event["pid"] != float64(pid) || event["prepares"] != float64(1) {
			t.Fatalf("lost prepared artifact: %s", line)
		}
	}
}
func TestNativeWorkerErrorAndTimeoutReapWithoutImplicitRelaunch(t *testing.T) {
	for _, mode := range []string{"error", "hang"} {
		t.Run(mode, func(t *testing.T) {
			binary, trace := nativeFixture(t, mode)
			saved := nativeWorkerTimeout
			nativeWorkerTimeout = 100 * time.Millisecond
			defer func() { nativeWorkerTimeout = saved }()
			a := &adapter{prep: &protocol.Preparation{Profile: "timing"}}
			defer a.closeNativeWorker()
			_, err := a.execute(binary, &protocol.RunRequest{Scenario: "steady", Samples: 1, Operations: 1})
			if err == nil {
				t.Fatal("accepted failed child")
			}
			before, _ := os.ReadFile(trace)
			if a.nativeWorker.client != nil {
				t.Fatal("failed child not reaped")
			}
			if _, err = a.execute(binary, &protocol.RunRequest{Scenario: "steady", Samples: 1, Operations: 1}); err == nil {
				t.Fatal("implicitly relaunched failed artifact")
			}
			after, _ := os.ReadFile(trace)
			if fmt.Sprint(before) != fmt.Sprint(after) {
				t.Fatal("failure spawned another native worker")
			}
		})
	}
}

func TestNativeMemoryOnlyPassUsesReapedActualChildPeak(t *testing.T) {
	binary, _ := nativeFixture(t, "ok")
	a := &adapter{prep: &protocol.Preparation{Profile: "memory"}}
	defer a.closeNativeWorker()
	response, err := a.execute(binary, &protocol.RunRequest{Scenario: "instantiate", Samples: 1, Operations: 1})
	if err != nil {
		t.Fatal(err)
	}
	if a.nativeWorker != nil {
		t.Fatal("RSS-only child remained live")
	}
	observations := response.Samples[0].Observations
	if len(observations) != 1 {
		t.Fatalf("missing native RSS: %+v", observations)
	}
	o := observations[0]
	if o.Metric != "aot.native_worker.peak_rss" || o.Scope != "native_worker_process" || o.Collector != "wait4_rusage" || o.Phase != "instantiate/process_lifetime" || o.Status != "available" || o.Value == nil || *o.Value <= 0 {
		t.Fatalf("incorrect child kernel RSS: %+v", o)
	}
}

func TestColdGuestBuildsChangeOnlyGuestIdentityAndKeepDependencyCache(t *testing.T) {
	dir := t.TempDir()
	trace := filepath.Join(dir, "compiler.jsonl")
	tool := filepath.Join(dir, "tool.py")
	script := `#!/usr/bin/env python3
import os,sys,json,pathlib
if sys.argv[1]=='-pkg':
 pathlib.Path(sys.argv[sys.argv.index('-o')+1]).write_text('package main\ntype Module struct{}\nfunc New()*Module{return &Module{}}\nfunc(m *Module)Xadd(a,b int32)int32{return a+b}\n')
else:
 with open(os.environ['WASMFYI_WASM2GO_COMPILER_TRACE'],'a') as out:out.write(json.dumps({'module':pathlib.Path('go.mod').read_text(),'cache':os.environ.get('GOCACHE'),'args':sys.argv[1:]})+'\n')
 pathlib.Path(sys.argv[sys.argv.index('-o')+1]).write_text('generated-native-artifact')
`
	if err := os.WriteFile(tool, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	previousTranslator, previousGo, previousRoot := translator, goTool, root
	translator, goTool, root = tool, tool, dir
	defer func() { translator, goTool, root = previousTranslator, previousGo, previousRoot }()
	cache := filepath.Join(dir, "shared-dependency-cache")
	t.Setenv("GOCACHE", cache)
	t.Setenv("WASMFYI_WASM2GO_COMPILER_TRACE", trace)
	a := &adapter{prep: &protocol.Preparation{Artifact: filepath.Join(dir, "module.wasm"), Workload: protocol.Workload{Export: "add"}}}
	defer a.close()
	for i := 0; i < 2; i++ {
		if _, _, err := a.build(); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(trace)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Fatalf("compiler launches: %s", data)
	}
	var modules []string
	for _, line := range lines {
		var event struct {
			Module, Cache string
			Args          []string
		}
		if err = json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatal(err)
		}
		if event.Cache != cache {
			t.Fatalf("discarded dependency cache: %s", line)
		}
		module := strings.Split(event.Module, "\n")[0]
		modules = append(modules, module)
		if !strings.Contains(event.Module, "replace github.com/wasmbench/wasmbench => "+dir) {
			t.Fatal("changed harness dependency binding")
		}
		for _, arg := range event.Args {
			if arg == "-a" {
				t.Fatal("forced dependency recompilation")
			}
		}
	}
	if modules[0] == modules[1] {
		t.Fatalf("cold guest builds reused package identity: %v", modules)
	}
}
