package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/wago-org/wago"
	"os"
	"sort"
	"time"
)

func median(v []int64) int64 {
	sort.Slice(v, func(i, j int) bool { return v[i] < v[j] })
	return v[len(v)/2]
}
func main() {
	ctx := context.Background()
	for _, path := range os.Args[1:] {
		data, e := os.ReadFile(path)
		if e != nil {
			panic(e)
		}
		results := map[string]any{"artifact": path, "bytes": len(data)}
		cfg := wazero.NewRuntimeConfigCompiler().WithCoreFeatures(api.CoreFeaturesV2).WithCloseOnContextDone(true)
		r := wazero.NewRuntimeWithConfig(ctx, cfg)
		retained, e := r.CompileModule(ctx, data)
		if e != nil {
			panic(e)
		}
		cached, fresh, closed, wagoTimes := []int64{}, []int64{}, []int64{}, []int64{}
		for i := 0; i < 15; i++ {
			start := time.Now()
			m, e := r.CompileModule(ctx, data)
			dt := time.Since(start).Nanoseconds()
			if e != nil {
				panic(e)
			}
			cached = append(cached, dt)
			m.Close(ctx)
			cold := wazero.NewRuntimeWithConfig(ctx, cfg)
			start = time.Now()
			m, e = cold.CompileModule(ctx, data)
			dt = time.Since(start).Nanoseconds()
			if e != nil {
				panic(e)
			}
			fresh = append(fresh, dt)
			m.Close(ctx)
			cold.Close(ctx)
			start = time.Now()
			c, e := wago.Compile(nil, data)
			dt = time.Since(start).Nanoseconds()
			if e != nil {
				panic(e)
			}
			wagoTimes = append(wagoTimes, dt)
			c.Close()
		}
		retained.Close(ctx)
		r.Close(ctx)
		r = wazero.NewRuntimeWithConfig(ctx, cfg)
		for i := 0; i < 15; i++ {
			start := time.Now()
			m, e := r.CompileModule(ctx, data)
			dt := time.Since(start).Nanoseconds()
			if e != nil {
				panic(e)
			}
			closed = append(closed, dt)
			m.Close(ctx)
		}
		r.Close(ctx)
		results["wazero_retained_ns"] = median(cached)
		results["wazero_fresh_runtime_ns"] = median(fresh)
		results["wazero_closed_module_ns"] = median(closed)
		results["wago_fresh_compile_ns"] = median(wagoTimes)
		results["wazero_retained_samples_ns"] = cached
		results["wazero_fresh_samples_ns"] = fresh
		results["wazero_closed_samples_ns"] = closed
		results["wago_samples_ns"] = wagoTimes
		results["fresh_to_retained_ratio"] = float64(median(fresh)) / float64(median(cached))
		b, _ := json.Marshal(results)
		fmt.Println(string(b))
	}
}
