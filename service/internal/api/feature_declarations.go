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
		declared = feature == "branch-hinting" && row.Backend == "cranelift" && (revision == "f96eabaa11a06086e4fb779ed1c1688481067ab9" || revision == "ebe5e8df1f4e12c5fc2f5954926881d8d61367d8" && row.FeatureProfile == "core-proposals")
	case "v8":
		// The pinned adapter enables the branch, compilation, and instruction-tracing flags.
		// module-decoder-impl.h consumes metadata.code.trace_inst only with tracing enabled.
		// NamesProvider decodes and uses all extended-name subsection maps.
		// WAT annotations/numeric literals are parsed by the corpus compiler,
		// not this binary-input runtime adapter.
		applicable := feature == "branch-hinting" || feature == "compilation-hints" || feature == "instrument-and-tracing-technology" || feature == "big-int" || feature == "extended-name-section"
		declared = applicable && (row.Backend == "turboshaft" || row.Backend == "optimizing-only") && (revision == "f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93" || revision == "bc2e01dcf6acd5cf7d169b5f26cf89abaaeb41f1")
	case "spidermonkey":
		declared = feature == "big-int" && row.Backend == "ion-only" && (revision == "dff12f8eda3dd87cda2a19a6d096a51334a2afe1" || revision == "9378fbc58660847fbc02c3486a0ecd6049978e25")
	case "jsc":
		// WasmSectionParser reads metadata.code.branch_hint unconditionally;
		// WasmOMGIRGenerator uses it for taken/continuation block frequency.
		declared = (feature == "big-int" || feature == "branch-hinting") && row.Backend == "OMG (forced tier-up)" && (revision == "f3e56c5b480ab4dc6bb6412abdfc35c2536467ec" || revision == "b95c91b1c0ee43cc86d25ff7af73038f67a88e04")
	case "graalwasm":
		declared = feature == "branch-hinting" && row.Backend == "truffle-graal" && (revision == "f1dce3f84de778485d0ba8d6ddfd4d260b230d0a" || revision == "092eca6772a74d4ce501d5656f61cfb26745ce73")
	case "chasm":
		// Old captures used ModuleConfig's decodeNameSection=false default.
		// The repaired old profile and the current pinned adapter explicitly
		// enable the extended decoder. The current adapter does so by default.
		decoderEnabled := revision == "02033f247459790dd46da3d5b104c0c11bc36bd7" && row.FeatureProfile == "extended-names" || revision == "79e96f65101c256d96a8eb82ccdc8a53e79c8b32" && (row.FeatureProfile == "" || row.FeatureProfile == "extended-names")
		if feature == "extended-name-section" && decoderEnabled && row.Backend == "jvm-interpreter" {
			// NameDataDecoder has no element/data subsection representation.
			for _, subsection := range []string{"label", "type", "table", "memory", "global", "field", "tag"} {
				declared = declared || strings.HasPrefix(row.Workload, "features/extended-name-section/"+subsection+"-name/")
			}
		}
	}
	if !declared {
		row.Status, row.MemoryStatus, row.CodeStatus = "unavailable", "unavailable", "unavailable"
		row.Value, row.PeakRSS, row.CodeBytes, row.CodeKind = nil, nil, nil, nil
		row.TimingSamples, row.SampleStats, row.Sampling = 0, nil, nil
	}
	return row
}
