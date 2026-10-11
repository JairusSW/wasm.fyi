package main

import (
	"fmt"
	"github.com/samyfodil/wazy"
	"github.com/samyfodil/wazy/api"
	"github.com/wasmbench/wasmbench/protocol"
	"slices"
	"time"
)

func (a *adapter) releaseCore() {
	if a.retained != nil {
		a.retained.Close(ctx)
	}
	if a.compiled != nil {
		a.compiled.Close(ctx)
	}
	if a.engine != nil {
		a.engine.Close(ctx)
	}
	a.engine = nil
	a.compiled = nil
	a.retained = nil
}

func (a *adapter) ensureCompiled() error {
	if a.compiled != nil {
		return nil
	}
	var err error
	a.engine, err = newRuntime(a.prep.Workload)
	if err != nil {
		return err
	}
	a.compiled, err = a.engine.CompileModule(ctx, a.bytes)
	return err
}

func instantiate(engine wazy.Runtime, module wazy.CompiledModule) (api.Module, error) {
	return engine.InstantiateModule(ctx, module, wazy.NewModuleConfig().WithName("").WithStartFunctions())
}

// Verify each vector immediately. Only guest invocations contribute latency;
// input setup, memory reads, pointer resolution and the oracle remain outside.
func executeCore(instance api.Module, w protocol.Workload, operations int) ([]uint64, int64, error) {
	var elapsed int64
	var result []uint64
	if w.Oracle.Kind == "exact_vectors" {
		vectors, err := protocol.PrepareWorkloadVectors(w)
		if err != nil {
			return nil, 0, err
		}
		function := instance.ExportedFunction(w.Export)
		if function == nil || instance.Memory() == nil {
			return nil, 0, fmt.Errorf("missing vector function or memory")
		}
		for operation := 0; operation < operations; operation++ {
			err = vectors.Run(protocol.VectorInstance{Pointer: func(name string) ([]uint64, error) { return call(instance, name, nil) }, Write: instance.Memory().Write, Read: instance.Memory().Read, Invoke: func(input, length, output uint32) error {
				start := time.Now()
				_, err := function.Call(ctx, uint64(input), uint64(length), uint64(output))
				elapsed += time.Since(start).Nanoseconds()
				return err
			}})
			if err != nil {
				return nil, 0, err
			}
		}
		return nil, elapsed, nil
	}
	function := instance.ExportedFunction(w.Export)
	if function == nil {
		return nil, 0, fmt.Errorf("missing export")
	}
	args := []uint64(w.Args)
	// Scalar verification is constant-size and follows the timed batch. Memory
	// oracles must be checked before a later invocation can overwrite the bytes.
	if len(w.Oracle.Memory) == 0 {
		start := time.Now()
		for operation := 0; operation < operations; operation++ {
			var err error
			result, err = function.Call(ctx, args...)
			if err != nil {
				return nil, 0, err
			}
		}
		elapsed = time.Since(start).Nanoseconds()
		return result, elapsed, verify(instance, w, result)
	}
	for operation := 0; operation < operations; operation++ {
		start := time.Now()
		var err error
		result, err = function.Call(ctx, args...)
		elapsed += time.Since(start).Nanoseconds()
		if err != nil {
			return nil, 0, err
		}
		if err = verify(instance, w, result); err != nil {
			return nil, 0, err
		}
	}
	return result, elapsed, nil
}

func (a *adapter) runCore(response protocol.Response, r *protocol.RunRequest) (protocol.Response, error) {
	if r.Samples < 1 || r.Samples > 35 || r.Warmup != 0 || r.Operations < 1 {
		return response, fmt.Errorf("unsupported: 1..35 samples, positive operations, zero warmup required")
	}
	if !slices.Contains([]string{"compile", "instantiate", "first-call", "steady"}, r.Scenario) {
		return response, fmt.Errorf("unsupported: phase")
	}
	if r.Scenario != "steady" && r.Operations != 1 {
		return response, fmt.Errorf("unsupported: lifecycle requires one operation")
	}
	w := a.prep.Workload
	if w.Reset != "stateless" && r.Operations != 1 {
		return response, fmt.Errorf("unsupported: fresh-instance batches")
	}
	codeProfile := a.prep.Profile == "code"
	if codeProfile && (r.Scenario != "compile" || r.Samples != 1) {
		return response, fmt.Errorf("unsupported: code size needs one compile pass")
	}
	if r.Scenario != "compile" {
		if err := a.ensureCompiled(); err != nil {
			return response, err
		}
	}
	for index := 0; index < r.Samples; index++ {
		var engine wazy.Runtime
		var module wazy.CompiledModule
		var instance api.Module
		var elapsed int64
		var result []uint64
		var observations []protocol.Observation
		err := func() error {
			if r.Scenario == "compile" {
				var err error
				engine, err = newRuntime(w)
				if err != nil {
					return err
				}
				defer engine.Close(ctx)
				start := time.Now()
				module, err = engine.CompileModule(ctx, a.bytes)
				elapsed = time.Since(start).Nanoseconds()
				if err != nil {
					return err
				}
				defer module.Close(ctx)
			} else {
				engine = a.engine
				module = a.compiled
			}
			if r.Scenario == "steady" && w.Reset == "stateless" {
				if a.retained == nil {
					var err error
					a.retained, err = instantiate(engine, module)
					if err != nil {
						return err
					}
					if err = initialize(a.retained, w); err != nil {
						return err
					}
				}
				instance = a.retained
			} else {
				var err error
				start := time.Now()
				instance, err = instantiate(engine, module)
				if r.Scenario == "instantiate" {
					elapsed = time.Since(start).Nanoseconds()
				}
				if err != nil {
					return err
				}
				defer instance.Close(ctx)
				if err = initialize(instance, w); err != nil {
					return err
				}
			}
			executionResult, executionTime, err := executeCore(instance, w, r.Operations)
			if err != nil {
				return err
			}
			result = executionResult
			if r.Scenario == "steady" || r.Scenario == "first-call" {
				elapsed = executionTime
			}
			if codeProfile {
				metric := protocol.Observation{Metric: "native.code_size", DefinitionVersion: 1, Unit: "bytes", Scope: "compiled_module", Collector: "Wazy compiled executable and module entry stubs", CollectorVersion: revision, Profile: "code", Quality: "engine_reported", Phase: "compile", Denominator: "module", Status: "unavailable", Reason: "Pinned SDK has no native-size getter"}
				if getter, ok := module.(interface{ WasmFyiNativeCodeSize() (uint64, bool) }); ok {
					if size, available := getter.WasmFyiNativeCodeSize(); available {
						metric.Status = "available"
						metric.Reason = ""
						metric.Value = protocol.Value(float64(size))
					}
				}
				observations = []protocol.Observation{metric}
			}
			return nil
		}()
		if err != nil {
			return response, err
		}
		sampleType := "individual_operation"
		if r.Operations > 1 {
			sampleType = "batch_average"
		}
		response.Samples = append(response.Samples, protocol.Sample{Index: index, ElapsedNS: elapsed, Operations: r.Operations, Verified: true, Result: result, SampleType: sampleType, Observations: observations})
	}
	return response, nil
}
