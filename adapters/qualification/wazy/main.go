// Single-sample qualification against Wazy's own compiler and exact corpus oracles.
package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/samyfodil/wazy"
	"github.com/samyfodil/wazy/api"
	"github.com/samyfodil/wazy/component"
	"github.com/samyfodil/wazy/experimental"
	"github.com/wasmbench/wasmbench/protocol"
	"os"
	"slices"
	"strings"
	"time"
)

const revision = "ed4381b865215e8f5e1575c382b2381422a5a8d6"

var ctx = context.Background()

type adapter struct {
	prep     *protocol.Preparation
	bytes    []byte
	engine   wazy.Runtime
	compiled wazy.CompiledModule
	retained api.Module
}

func newRuntime(w protocol.Workload) (wazy.Runtime, error) {
	r := wazy.NewRuntimeWithConfig(ctx, wazy.NewRuntimeConfigCompiler().WithCoreFeatures(api.CoreFeaturesV3|experimental.CoreFeaturesThreads).WithCloseOnContextDone(true))
	var err error
	switch w.HostProfile {
	case "", "threads-defined-v1", "component-u64-v1":
	case "identity-v1":
		_, err = r.NewHostModuleBuilder("wasmbench").NewFunctionBuilder().WithGoFunction(api.GoFunc(func(_ context.Context, s []uint64) { s[0] = uint64(uint32(s[0])) }), []api.ValueType{api.ValueTypeI32}, []api.ValueType{api.ValueTypeI32}).Export("identity").Instantiate(ctx)
	case "assemblyscript-abort-v1":
		_, err = r.NewHostModuleBuilder("env").NewFunctionBuilder().WithGoFunction(api.GoFunc(func(_ context.Context, s []uint64) { panic(fmt.Sprintf("AssemblyScript abort: %v", s)) }), []api.ValueType{api.ValueTypeI32, api.ValueTypeI32, api.ValueTypeI32, api.ValueTypeI32}, nil).Export("abort").Instantiate(ctx)
	default:
		err = fmt.Errorf("unsupported: host profile %s", w.HostProfile)
	}
	if err != nil {
		r.Close(ctx)
		return nil, err
	}
	return r, nil
}
func call(m api.Module, name string, args []uint64) ([]uint64, error) {
	f := m.ExportedFunction(name)
	if f == nil {
		return nil, fmt.Errorf("missing export %s", name)
	}
	return f.Call(ctx, args...)
}
func pointer(m api.Module, name string) (uint64, error) {
	if name == "" {
		return 0, nil
	}
	v, e := call(m, name, nil)
	if e != nil {
		return 0, e
	}
	if len(v) != 1 {
		return 0, fmt.Errorf("pointer export arity")
	}
	return v[0], nil
}
func initialize(m api.Module, w protocol.Workload) error {
	if w.Initialize != "" {
		v, e := call(m, w.Initialize, nil)
		if e != nil {
			return e
		}
		if len(v) != 0 {
			return fmt.Errorf("initializer must return no results")
		}
	}
	if w.Input != nil {
		p, e := pointer(m, w.Input.PointerExport)
		if e != nil {
			return e
		}
		data, e := hex.DecodeString(w.Input.Hex)
		if e != nil {
			return e
		}
		offset := p + uint64(w.Input.Offset)
		if offset > 1<<32-1 || m.Memory() == nil || !m.Memory().Write(uint32(offset), data) {
			return fmt.Errorf("input memory bounds")
		}
	}
	return nil
}
func verify(m api.Module, w protocol.Workload, result []uint64) error {
	if !slices.Equal(result, []uint64(w.Oracle.Expected)) {
		return fmt.Errorf("scalar oracle mismatch: got %v want %v", result, w.Oracle.Expected)
	}
	p, e := pointer(m, w.Oracle.OutputPointerExport)
	if e != nil {
		return e
	}
	for _, check := range w.Oracle.Memory {
		offset := p + uint64(check.Offset)
		expected, e := hex.DecodeString(check.Hex)
		if e != nil {
			return e
		}
		if offset > 1<<32-1 || m.Memory() == nil {
			return fmt.Errorf("oracle memory bounds")
		}
		actual, ok := m.Memory().Read(uint32(offset), uint32(len(expected)))
		if !ok || !slices.Equal(actual, expected) {
			return fmt.Errorf("memory oracle mismatch at %d", offset)
		}
	}
	return nil
}
func (a *adapter) handle(req protocol.Request) (protocol.Response, error) {
	resp := protocol.Response{Version: 1, ID: req.ID, Status: "ok"}
	switch req.Method {
	case "describe":
		resp.Description = &protocol.Description{Runtime: "wazy", Version: revision, Build: "wasm-fyi Wazy adapter v1; source " + revision, Backend: "native-jit", Embedding: "Wazy Go API; explicit compiler, Wasm 3 core features", ABIs: []string{"core", "component"}, Scenarios: []string{"compile", "instantiate", "first-call", "steady"}, Capabilities: map[string]bool{"can_compile_separately": true, "can_instantiate_separately": true, "can_host_function_calls_v1": true, "can_code_profile": true, "can_measure_native_code_size": true}, Configuration: map[string]string{"compile_policy": "cold compiler runtime per compile sample; shared compiled module for other phases", "steady_policy": "same retained instance across sample groups; no implicit warmup", "native_code_policy": "compiled executable plus module entry stubs; shared runtime code excluded"}}
	case "close":
		a.releaseCore()
		a.prep = nil
		a.bytes = nil
	case "prepare":
		p := req.Prepare
		if p == nil {
			return resp, fmt.Errorf("missing preparation")
		}
		w := p.Workload
		if !slices.Contains([]string{"timing", "memory", "code"}, p.Profile) || (w.ABI != "core" && w.ABI != "component") || !slices.Contains([]string{"exact_u64", "exact_vectors", "component_compile_only"}, w.Oracle.Kind) || w.Oracle.Float != nil || w.Oracle.ExpectedTrap != "" {
			return resp, fmt.Errorf("unsupported: core exact scalar/memory oracle required")
		}
		if w.Reset != "stateless" && w.Reset != "fresh_instance_per_sample" {
			return resp, fmt.Errorf("unsupported: reset policy %s", w.Reset)
		}
		b, e := os.ReadFile(p.Artifact)
		if e != nil {
			return resp, e
		}
		sum := sha256.Sum256(b)
		if hex.EncodeToString(sum[:]) != p.ArtifactSHA256 {
			return resp, fmt.Errorf("artifact hash mismatch")
		}
		a.releaseCore()
		a.prep = p
		a.bytes = b
	case "inspect":
		if a.prep == nil || a.prep.Profile != "code" || a.prep.Workload.ABI != "core" {
			return resp, fmt.Errorf("unsupported: code inspection requires prepared core module")
		}
		result, err := a.runCore(resp, &protocol.RunRequest{Scenario: "compile", Samples: 1, Operations: 1, Warmup: 0})
		if err != nil {
			return result, err
		}
		if len(result.Samples) != 1 || !result.Samples[0].Verified {
			return resp, fmt.Errorf("code inspection oracle was not verified")
		}
		result.Diagnostics = result.Samples[0].Observations
		result.Samples = nil
		return result, nil
	case "run":
		if a.prep == nil || req.Run == nil {
			return resp, fmt.Errorf("prepare and run required")
		}
		w := a.prep.Workload
		r := req.Run
		if w.ABI == "core" {
			return a.runCore(resp, r)
		}
		if r.Samples != 1 || r.Operations != 1 || r.Warmup != 0 {
			return resp, fmt.Errorf("qualification requires one sample, one operation, zero warmups")
		}
		if !slices.Contains([]string{"compile", "instantiate", "first-call", "steady"}, r.Scenario) {
			return resp, fmt.Errorf("unsupported: phase %s", r.Scenario)
		}
		engine, e := newRuntime(w)
		if e != nil {
			return resp, e
		}
		defer engine.Close(ctx)
		if w.ABI == "component" {
			start := time.Now()
			instance, e := component.Instantiate(ctx, engine, a.bytes)
			if e != nil {
				return resp, e
			}
			defer instance.Close(ctx)
			var result []uint64
			if w.Oracle.Kind != "component_compile_only" {
				args := make([]component.Value, len(w.Args))
				for i, v := range w.Args {
					args[i] = uint64(v)
				}
				values, e := instance.Call(ctx, w.Export, args...)
				if e != nil {
					return resp, e
				}
				for _, v := range values {
					switch n := v.(type) {
					case uint64:
						result = append(result, n)
					case uint32:
						result = append(result, uint64(n))
					case int64:
						result = append(result, uint64(n))
					default:
						return resp, fmt.Errorf("component result type %T", v)
					}
				}
				if !slices.Equal(result, []uint64(w.Oracle.Expected)) {
					return resp, fmt.Errorf("component oracle mismatch")
				}
			}
			resp.Samples = []protocol.Sample{{Index: 0, ElapsedNS: time.Since(start).Nanoseconds(), Operations: 1, Verified: true, Result: result, SampleType: "individual_operation"}}
			return resp, nil
		}
		if w.Oracle.Kind == "exact_vectors" {
			compiled, e := engine.CompileModule(ctx, a.bytes)
			if e != nil {
				return resp, e
			}
			instance, e := engine.InstantiateModule(ctx, compiled, wazy.NewModuleConfig().WithStartFunctions())
			if e != nil {
				return resp, e
			}
			if e = initialize(instance, w); e != nil {
				return resp, e
			}
			vectors, e := protocol.PrepareWorkloadVectors(w)
			if e != nil {
				return resp, e
			}
			f := instance.ExportedFunction(w.Export)
			if f == nil || instance.Memory() == nil {
				return resp, fmt.Errorf("missing vector export/memory")
			}
			start := time.Now()
			e = vectors.Run(protocol.VectorInstance{Pointer: func(name string) ([]uint64, error) { return call(instance, name, nil) }, Write: instance.Memory().Write, Read: instance.Memory().Read, Invoke: func(in, n, out uint32) error { _, e := f.Call(ctx, uint64(in), uint64(n), uint64(out)); return e }})
			if e != nil {
				return resp, e
			}
			resp.Samples = []protocol.Sample{{Index: 0, ElapsedNS: time.Since(start).Nanoseconds(), Operations: 1, Verified: true, SampleType: "individual_operation"}}
			return resp, nil
		}
		var compiled wazy.CompiledModule
		var instance api.Module
		var result []uint64
		start := time.Now()
		if r.Scenario == "compile" {
			compiled, e = engine.CompileModule(ctx, a.bytes)
		} else {
			compiled, e = engine.CompileModule(ctx, a.bytes)
			if e == nil && r.Scenario != "instantiate" {
				instance, e = engine.InstantiateModule(ctx, compiled, wazy.NewModuleConfig().WithStartFunctions())
				if e == nil {
					e = initialize(instance, w)
				}
			}
			start = time.Now()
			if e == nil {
				if r.Scenario == "instantiate" {
					instance, e = engine.InstantiateModule(ctx, compiled, wazy.NewModuleConfig().WithStartFunctions())
				} else {
					result, e = call(instance, w.Export, []uint64(w.Args))
				}
			}
		}
		elapsed := time.Since(start).Nanoseconds()
		if e != nil {
			return resp, e
		}
		if r.Scenario == "compile" {
			instance, e = engine.InstantiateModule(ctx, compiled, wazy.NewModuleConfig().WithStartFunctions())
		}
		if e != nil {
			return resp, e
		}
		if r.Scenario == "compile" || r.Scenario == "instantiate" {
			if e = initialize(instance, w); e == nil {
				result, e = call(instance, w.Export, []uint64(w.Args))
			}
		}
		if e != nil {
			return resp, e
		}
		if e = verify(instance, w, result); e != nil {
			return resp, e
		}
		resp.Samples = []protocol.Sample{{Index: 0, ElapsedNS: elapsed, Operations: 1, Verified: true, Result: result, SampleType: "individual_operation"}}
	default:
		return resp, fmt.Errorf("unsupported: method %s", req.Method)
	}
	return resp, nil
}
func main() {
	a := &adapter{}
	input := bufio.NewScanner(os.Stdin)
	input.Buffer(make([]byte, 65536), 32<<20)
	out := json.NewEncoder(os.Stdout)
	for input.Scan() {
		var req protocol.Request
		var resp protocol.Response
		err := json.Unmarshal(input.Bytes(), &req)
		if err == nil {
			resp, err = a.handle(req)
		}
		if err != nil {
			resp = protocol.Response{Version: 1, ID: req.ID, Status: "error", Reason: err.Error()}
			if strings.HasPrefix(err.Error(), "unsupported:") {
				resp.Status = "unsupported"
			}
		}
		if e := out.Encode(resp); e != nil {
			panic(e)
		}
	}
	if e := input.Err(); e != nil {
		panic(e)
	}
}
