package api

import (
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
)

func TestHintDeclarationProjection(t *testing.T) {
	n := 12.0
	base := sqldb.Cell{Result: benchdb.Result{Row: benchdb.Row{Workload: "features/branch-hinting/mostly-taken/64", Engine: "graalwasm", Backend: "truffle-graal", Version: "f1dce3f84de778485d0ba8d6ddfd4d260b230d0a", Status: "ok", Value: &n, TimingSamples: 1, SamplesNs: []float64{n}}}}
	if got := featureDeclarationProjection(base); got.Status != "ok" || got.Value == nil {
		t.Fatal("audited pinned SDK lost declared hint support")
	}
	unknown := base
	unknown.Version = "unknown"
	got := featureDeclarationProjection(unknown)
	if got.Status != "unavailable" || got.Value != nil || got.TimingSamples != 0 {
		t.Fatal("ignorable metadata execution claimed unverified hint support")
	}
	if unknown.Status != "ok" || unknown.Value == nil || len(unknown.SamplesNs) != 1 {
		t.Fatal("projection mutated the stored observation")
	}
	unknown.Status = "failed"
	if featureDeclarationProjection(unknown).Status != "failed" {
		t.Fatal("declaration projection concealed a failed workload")
	}
	base.Workload = "features/compilation-hints/optimization/64"
	if featureDeclarationProjection(base).Status != "unavailable" {
		t.Fatal("branch hint support leaked into compilation hints")
	}
	base.Workload = "applications/test"
	if featureDeclarationProjection(base).Status != "ok" {
		t.Fatal("declaration policy affected ordinary execution")
	}
}

func TestHintDeclarationUsedByBothCompactFormats(t *testing.T) {
	n := 12.0
	row := sqldb.Cell{Result: benchdb.Result{Row: benchdb.Row{Workload: "features/branch-hinting/mostly-taken/64", Engine: "unknown", Status: "ok", Value: &n}}}
	m := sqldb.Matrix{Items: []sqldb.Cell{row}}
	if got := packMatrix(m).Rows[0]; got[8] != "unavailable" || got[5] != (*float64)(nil) {
		t.Fatal("matrix did not enforce the declaration policy")
	}
	if got := packTable(m).Rows[0]; got[9].(int)&7 != tableStatus("unavailable") || got[6] != (*float64)(nil) {
		t.Fatal("table did not enforce the declaration policy")
	}
}

func TestHintDeclarationPinsAndBackends(t *testing.T) {
	for _, tc := range []struct {
		engine, backend, revision, feature string
		declared                           bool
	}{
		{"wasmtime", "cranelift", "f96eabaa11a06086e4fb779ed1c1688481067ab9", "branch-hinting", true},
		{"wasmtime-winch", "winch", "f96eabaa11a06086e4fb779ed1c1688481067ab9", "branch-hinting", false},
		{"wasmtime", "cranelift", "f96eabaa11a06086e4fb779ed1c1688481067ab9", "compilation-hints", false},
		{"v8", "turboshaft", "f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93", "branch-hinting", true},
		{"v8", "optimizing-only", "f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93", "compilation-hints", true},
		{"v8", "liftoff", "f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93", "compilation-hints", false},
	} {
		row := sqldb.Cell{Result: benchdb.Result{Row: benchdb.Row{Engine: tc.engine, Backend: tc.backend, Version: "release label", Source: &benchdb.Source{Revision: tc.revision}, Workload: "features/" + tc.feature + "/case/1", Status: "ok"}}}
		if got := featureDeclarationProjection(row); (got.Status == "ok") != tc.declared {
			t.Fatalf("unexpected declaration for %s %s %s", tc.engine, tc.backend, tc.feature)
		}
		row.Source.Revision = "unverified"
		row.Version = tc.revision
		if featureDeclarationProjection(row).Status != "unavailable" {
			t.Fatal("version label overrode actual source revision")
		}
	}
}

func TestInstructionTraceDeclarationProjection(t *testing.T) {
	for _, tc := range []struct {
		engine, backend, revision string
		declared                  bool
	}{
		{"v8", "turboshaft", "f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93", true},
		{"v8", "optimizing-only", "f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93", true},
		{"v8", "turboshaft", "unknown", false},
		{"wasmtime", "cranelift", "f96eabaa11a06086e4fb779ed1c1688481067ab9", false},
		{"graalwasm", "truffle-graal", "f1dce3f84de778485d0ba8d6ddfd4d260b230d0a", false},
	} {
		row := sqldb.Cell{Result: benchdb.Result{Row: benchdb.Row{Engine: tc.engine, Backend: tc.backend, Version: tc.revision, Workload: "features/instrument-and-tracing-technology/affine-region/64", Status: "ok"}}}
		if got := featureDeclarationProjection(row); (got.Status == "ok") != tc.declared {
			t.Fatalf("unexpected tracing declaration for %s %s %s", tc.engine, tc.backend, tc.revision)
		}
		row.Status = "failed"
		if featureDeclarationProjection(row).Status != "failed" {
			t.Fatal("tracing projection concealed runtime failure")
		}
	}
}
