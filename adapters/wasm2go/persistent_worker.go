package main

import (
	"fmt"
	"github.com/wasmbench/wasmbench/agent"
	"github.com/wasmbench/wasmbench/protocol"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

var nativeWorkerTimeout = 5 * time.Minute
var nativeWorkerSequence uint64

type persistentNativeWorker struct {
	binary  string
	client  *agent.Client
	failure error
}

func (a *adapter) closeNativeWorker() {
	if a.nativeWorker != nil && a.nativeWorker.client != nil {
		a.nativeWorker.client.Close()
	}
	a.nativeWorker = nil
}

// A cold compile changes the native artifact, so its verification worker replaces
// the previous artifact's worker. The final compiled artifact stays prepared and
// serves every subsequent phase and adaptive sample group in one native process.
func (a *adapter) execute(binary string, r *protocol.RunRequest) (protocol.Response, error) {
	if a.nativeWorker != nil && a.nativeWorker.binary != binary {
		a.closeNativeWorker()
	}
	if a.nativeWorker == nil {
		session := &persistentNativeWorker{binary: binary}
		a.nativeWorker = session
		client, err := agent.Start(ctx, []string{binary, strconv.Itoa(os.Getpid())}, fmt.Sprintf("%s.session-%d.log", binary, atomic.AddUint64(&nativeWorkerSequence, 1)), nativeWorkerTimeout)
		if err != nil {
			session.failure = err
			return protocol.Response{}, err
		}
		session.client = client
		response, err := client.Call(protocol.Request{Method: "prepare", Prepare: a.prep})
		if err == nil && response.Status != "ok" {
			err = fmt.Errorf("native preparation: %s", response.Reason)
		}
		if err != nil {
			session.failure = err
			client.Close()
			session.client = nil
			return response, err
		}
	}
	session := a.nativeWorker
	if session.failure != nil {
		return protocol.Response{}, session.failure
	}
	rssReset := runtime.GOOS == "linux" && os.WriteFile(fmt.Sprintf("/proc/%d/clear_refs", session.client.PID()), []byte("5"), 0) == nil
	response, err := session.client.Call(protocol.Request{Method: "run", Run: r})
	if err == nil && response.Status != "ok" {
		err = fmt.Errorf("native worker: %s", response.Reason)
	}
	if err != nil {
		session.failure = err
		session.client.Close()
		session.client = nil
		return response, err
	}
	if len(response.Samples) > 0 {
		observation := nativeWorkerPhaseRSS(session.client.PID(), r.Scenario, a.prep.Profile, rssReset)
		if a.prep.Profile == "memory" {
			// A deterministic RSS-only pass can reap this child and obtain its kernel
			// lifetime peak without mixing any of these samples into latency results.
			session.client.Close()
			observation = session.client.PeakRSSObservation(r.Scenario)
			observation.Metric = "aot.native_worker.peak_rss"
			observation.Scope = "native_worker_process"
			observation.Profile = "memory"
			session.client = nil
			a.nativeWorker = nil
		}
		response.Samples[0].Observations = append(response.Samples[0].Observations, observation)
	}
	return response, err
}

func nativeWorkerPhaseRSS(pid int, phase, profile string, reset bool) protocol.Observation {
	o := protocol.Observation{Metric: "aot.native_worker.peak_rss", DefinitionVersion: 1, Unit: "bytes", Scope: "native_worker_process", Phase: phase + "/shared_process_phase", Collector: "proc_pid_status", CollectorVersion: "1", Quality: "kernel_accounted_phase_peak", Profile: profile, Status: "unavailable", Denominator: "process"}
	if !reset {
		o.Reason = "live native worker RSS high-water reset unavailable; deterministic child wait4 pass required"
		return o
	}
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		o.Reason = err.Error()
		return o
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 3 && fields[0] == "VmHWM:" && fields[2] == "kB" {
			value, err := strconv.ParseUint(fields[1], 10, 64)
			if err == nil {
				o.Status = "available"
				o.Value = protocol.Value(float64(value) * 1024)
				return o
			}
		}
	}
	o.Reason = "native worker RSS high-water mark unavailable"
	return o
}

// Give each cold guest compilation its own import identity. Standard-library
// and harness dependency cache keys remain unchanged.
func nativeGuestModulePath(directory string) string {
	return "wasmbench.native.worker." + filepath.Base(directory)
}
