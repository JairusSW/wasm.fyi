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
		{"v8", "optimizing-only", "bc2e01dcf6acd5cf7d169b5f26cf89abaaeb41f1", "branch-hinting", true},
		{"v8", "optimizing-only", "bc2e01dcf6acd5cf7d169b5f26cf89abaaeb41f1", "compilation-hints", true},
		{"v8", "optimizing-only", "bc2e01dcf6acd5cf7d169b5f26cf89abaaeb41f1", "instrument-and-tracing-technology", true},
		{"v8", "liftoff", "bc2e01dcf6acd5cf7d169b5f26cf89abaaeb41f1", "branch-hinting", false},
		{"spidermonkey", "ion-only", "9378fbc58660847fbc02c3486a0ecd6049978e25", "big-int", true},
		{"spidermonkey", "baseline", "9378fbc58660847fbc02c3486a0ecd6049978e25", "big-int", false},
		{"graalwasm", "truffle-graal", "092eca6772a74d4ce501d5656f61cfb26745ce73", "branch-hinting", true},
		{"graalwasm", "other", "092eca6772a74d4ce501d5656f61cfb26745ce73", "branch-hinting", false},
		{"v8", "liftoff", "f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93", "compilation-hints", false},
		{"jsc", "OMG (forced tier-up)", "f3e56c5b480ab4dc6bb6412abdfc35c2536467ec", "branch-hinting", true},
		{"jsc", "OMG (forced tier-up)", "b95c91b1c0ee43cc86d25ff7af73038f67a88e04", "branch-hinting", true},
		{"jsc", "OMG (forced tier-up)", "b95c91b1c0ee43cc86d25ff7af73038f67a88e04", "big-int", true},
		{"jsc", "BBQ", "b95c91b1c0ee43cc86d25ff7af73038f67a88e04", "branch-hinting", false},
		{"jsc", "BBQ", "f3e56c5b480ab4dc6bb6412abdfc35c2536467ec", "branch-hinting", false},
		{"jsc", "OMG (forced tier-up)", "f3e56c5b480ab4dc6bb6412abdfc35c2536467ec", "compilation-hints", false},
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

func TestBigIntRequiresJavaScriptBoundary(t *testing.T) {
	for _, tc := range []struct {
		engine, backend, revision string
		declared                  bool
	}{
		{"v8", "turboshaft", "f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93", true},
		{"spidermonkey", "ion-only", "dff12f8eda3dd87cda2a19a6d096a51334a2afe1", true},
		{"jsc", "OMG (forced tier-up)", "f3e56c5b480ab4dc6bb6412abdfc35c2536467ec", true},
		{"wasmtime", "cranelift", "f96eabaa11a06086e4fb779ed1c1688481067ab9", false},
		{"wazero", "compiler", "e234f6fe6ecd4589dd0c643b641bd38f6d826ee5", false},
		{"spidermonkey", "native", "dff12f8eda3dd87cda2a19a6d096a51334a2afe1", false},
		{"jsc", "OMG (forced tier-up)", "unknown", false},
	} {
		row := sqldb.Cell{Result: benchdb.Result{Row: benchdb.Row{Engine: tc.engine, Backend: tc.backend, Version: tc.revision, Workload: "features/big-int/high-bit-identity/64", Status: "ok"}}}
		if got := featureDeclarationProjection(row); (got.Status == "ok") != tc.declared {
			t.Fatalf("unexpected JS BigInt claim for %s %s", tc.engine, tc.backend)
		}
		row.Status = "failed"
		if featureDeclarationProjection(row).Status != "failed" {
			t.Fatal("projection hid a failed boundary probe")
		}
	}
}

func TestSourceFormatAndExtendedNameDeclarations(t *testing.T) {
	for _, tc := range []struct {
		feature, engine, backend, revision string
		declared                           bool
	}{
		{"extended-name-section", "v8", "turboshaft", "f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93", true},
		{"extended-name-section", "v8", "turboshaft", "unknown", false},
		{"extended-name-section", "wasmtime", "cranelift", "f96eabaa11a06086e4fb779ed1c1688481067ab9", false},
		{"custom-annotation-syntax-in-the-text-format", "v8", "turboshaft", "f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93", false},
		{"numeric-values-in-wat", "v8", "turboshaft", "f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93", false},
		{"numeric-values-in-wat", "wasmtime", "cranelift", "f96eabaa11a06086e4fb779ed1c1688481067ab9", false},
	} {
		row := sqldb.Cell{Result: benchdb.Result{Row: benchdb.Row{Engine: tc.engine, Backend: tc.backend, Version: tc.revision, Workload: "features/" + tc.feature + "/case/64", Status: "ok"}}}
		if got := featureDeclarationProjection(row); (got.Status == "ok") != tc.declared {
			t.Fatalf("unexpected %s claim for %s %s", tc.feature, tc.engine, tc.revision)
		}
		row.Status = "failed"
		if featureDeclarationProjection(row).Status != "failed" {
			t.Fatal("projection hid a failed semantic control")
		}
	}
}

func TestChasmExtendedNamesDeclarationRequiresRepairedProfile(t *testing.T) {
	for _, revision := range []string{"02033f247459790dd46da3d5b104c0c11bc36bd7", "79e96f65101c256d96a8eb82ccdc8a53e79c8b32"} {
		row := sqldb.Cell{Result: benchdb.Result{Row: benchdb.Row{Engine: "chasm", Backend: "jvm-interpreter", Version: revision, Workload: "features/extended-name-section/type-name/4096", Status: "ok"}}}
		if got := featureDeclarationProjection(row); (got.Status == "ok") != (revision == "79e96f65101c256d96a8eb82ccdc8a53e79c8b32") {
			t.Fatal("default-decoder declaration did not match the pinned adapter")
		}
		row.FeatureProfile = "extended-names"
		if featureDeclarationProjection(row).Status != "ok" {
			t.Fatal("repaired decoder profile was not admitted")
		}
		for _, name := range []string{"element", "data"} {
			row.Workload = "features/extended-name-section/" + name + "-name/4096"
			if featureDeclarationProjection(row).Status != "unavailable" {
				t.Fatal("ignored subsection inherited decoder support")
			}
		}
		row.Workload = "features/extended-name-section/type-name/4096"
		row.Source = &benchdb.Source{Revision: "unverified"}
		if featureDeclarationProjection(row).Status != "unavailable" {
			t.Fatal("unverified source inherited support")
		}
		row.Status = "failed"
		if featureDeclarationProjection(row).Status != "failed" {
			t.Fatal("projection hid decoder failure")
		}
	}
}

func TestWasmtimeCoreProposalDeclarationRequiresQualifiedProfile(t *testing.T) {
	row := sqldb.Cell{Result: benchdb.Result{Row: benchdb.Row{Engine: "wasmtime", Backend: "cranelift", Version: "ebe5e8df1f4e12c5fc2f5954926881d8d61367d8", FeatureProfile: "core-proposals", Workload: "features/branch-hinting/mostly-taken/64", Status: "ok"}}}
	if featureDeclarationProjection(row).Status != "ok" {
		t.Fatal("qualified feature profile lost branch hint consumption")
	}
	row.FeatureProfile = ""
	if featureDeclarationProjection(row).Status != "unavailable" {
		t.Fatal("old disabled configuration claimed branch metadata consumption")
	}
	row.FeatureProfile = "core-proposals"
	row.Backend = "winch"
	if featureDeclarationProjection(row).Status != "unavailable" {
		t.Fatal("Winch parsing was counted as hint consumption")
	}
}
