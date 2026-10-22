package api

import (
	"strings"

	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
)

// Ignorable custom sections cannot prove hint consumption by execution alone.
// These exact campaign SDKs were audited at their source/configuration pins.
// Raw observations and their samples remain unchanged in storage and detail.
func featureDeclarationProjection(row sqldb.Cell) sqldb.Cell {
	feature := ""
	for _, name := range []string{"branch-hinting", "compilation-hints"} {
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
		// The pinned adapter enables both experimental metadata flags.
		declared = (row.Backend == "turboshaft" || row.Backend == "optimizing-only") && revision == "f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93"
	case "graalwasm":
		declared = feature == "branch-hinting" && row.Backend == "truffle-graal" && revision == "f1dce3f84de778485d0ba8d6ddfd4d260b230d0a"
	}
	if !declared {
		row.Status, row.MemoryStatus, row.CodeStatus = "unavailable", "unavailable", "unavailable"
		row.Value, row.PeakRSS, row.CodeBytes, row.CodeKind = nil, nil, nil, nil
		row.TimingSamples, row.SampleStats, row.Sampling = 0, nil, nil
	}
	return row
}
