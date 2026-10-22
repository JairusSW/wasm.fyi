package api

import (
	"strings"

	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
)

// Feature declarations include metadata consumption, source syntax, and the host API boundary.
// Successful binary execution alone cannot prove either capability.
// These exact campaign SDKs were audited at their source/configuration pins.
// Raw observations and their samples remain unchanged in storage and detail.
func featureDeclarationProjection(row sqldb.Cell) sqldb.Cell {
	feature := ""
	for _, name := range []string{"branch-hinting", "compilation-hints", "instrument-and-tracing-technology", "big-int", "extended-name-section", "custom-annotation-syntax-in-the-text-format", "numeric-values-in-wat"} {
		if strings.HasPrefix(row.Workload, "features/"+name+"/") {
			feature = name
			break
		}
	}
	if feature == "" || row.Status != "ok" {
		return row
	}
	revision := row.Version
	if row.Source != nil {
		revision = row.Source.Revision
	}
	declared := false
	switch row.Engine {
	case "wasmtime":
		declared = feature == "branch-hinting" && row.Backend == "cranelift" && revision == "f96eabaa11a06086e4fb779ed1c1688481067ab9"
	case "v8":
		// The pinned adapter enables the branch, compilation, and instruction-tracing flags.
		// module-decoder-impl.h consumes metadata.code.trace_inst only with tracing enabled.
		// NamesProvider decodes and uses all extended-name subsection maps.
		// WAT annotations/numeric literals are parsed by the corpus compiler,
		// not this binary-input runtime adapter.
		applicable := feature == "branch-hinting" || feature == "compilation-hints" || feature == "instrument-and-tracing-technology" || feature == "big-int" || feature == "extended-name-section"
		declared = applicable && (row.Backend == "turboshaft" || row.Backend == "optimizing-only") && revision == "f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93"
	case "spidermonkey":
		declared = feature == "big-int" && row.Backend == "ion-only" && revision == "dff12f8eda3dd87cda2a19a6d096a51334a2afe1"
	case "jsc":
		// WasmSectionParser reads metadata.code.branch_hint unconditionally;
		// WasmOMGIRGenerator uses it for taken/continuation block frequency.
		declared = (feature == "big-int" || feature == "branch-hinting") && row.Backend == "OMG (forced tier-up)" && revision == "f3e56c5b480ab4dc6bb6412abdfc35c2536467ec"
	case "graalwasm":
		declared = feature == "branch-hinting" && row.Backend == "truffle-graal" && revision == "f1dce3f84de778485d0ba8d6ddfd4d260b230d0a"
	case "chasm":
		// Old captures used ModuleConfig's decodeNameSection=false default.
		// Only the repaired profile explicitly enables the extended decoder.
		declared = feature == "extended-name-section" && row.FeatureProfile == "extended-names" && row.Backend == "jvm-interpreter" && revision == "02033f247459790dd46da3d5b104c0c11bc36bd7"
	}
	if !declared {
		row.Status, row.MemoryStatus, row.CodeStatus = "unavailable", "unavailable", "unavailable"
		row.Value, row.PeakRSS, row.CodeBytes, row.CodeKind = nil, nil, nil, nil
		row.TimingSamples, row.SampleStats, row.Sampling = 0, nil, nil
	}
	return row
}
