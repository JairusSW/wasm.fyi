package main

import (
	"strings"
	"testing"

	"github.com/wasmbench/wasmbench/corpus"
	"github.com/wasmbench/wasmbench/protocol"
)

func coldCompileAdapter(expected uint64) *adapter {
	// A unique test module exports cold_compile_test() -> i32.const 17.
	wasm := []byte{0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 21, 1, 17}
	wasm = append(wasm, []byte("cold_compile_test")...)
	wasm = append(wasm, 0, 0, 10, 6, 1, 4, 0, 65, 17, 11)
	return &adapter{wasm: wasm, prep: &protocol.Preparation{Profile: "timing", ArtifactSHA256: corpus.Hash(wasm), Workload: protocol.Workload{ID: "test/cold-compile", ABI: "core", Export: "cold_compile_test", Reset: "stateless", Oracle: protocol.Oracle{Kind: "exact_u64", Expected: protocol.Values{expected}}}}}
}

func TestCompileDoesNotPrepareUnmeasuredModule(t *testing.T) {
	a := coldCompileAdapter(17)
	defer a.closeAll()
	samples, err := a.run(&protocol.RunRequest{Scenario: "compile", Samples: 1, Operations: 1, Warmup: 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(samples) != 1 || !samples[0].Verified || samples[0].Warmup || samples[0].Operations != 1 {
		t.Fatal("missing verified cold compile sample")
	}
	if a.compiled != nil || a.instance != nil || a.fn != nil {
		t.Fatal("compile prepared an extra unmeasured module/instance")
	}
}

func TestColdCompileStillRejectsWrongGuestResult(t *testing.T) {
	a := coldCompileAdapter(18)
	defer a.closeAll()
	_, err := a.run(&protocol.RunRequest{Scenario: "compile", Samples: 1, Operations: 1, Warmup: 0})
	if err == nil || !strings.Contains(err.Error(), "incorrect result") {
		t.Fatalf("compile did not verify its fresh module: %v", err)
	}
}
