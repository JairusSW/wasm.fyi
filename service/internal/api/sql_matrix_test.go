package api

import (
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
	"strings"
	"testing"
)

func TestCompactMatrixDeduplicatesMetadata(t *testing.T) {
	source := &benchdb.Source{Repository: "https://example.com/runtime", Revision: strings.Repeat("a", 40), Ref: "main", AsOf: "2026-10-04T00:00:00Z", Kind: "snapshot"}
	value := 1.25
	rows := []sqldb.Cell{}
	for i := 0; i < 100; i++ {
		rows = append(rows, sqldb.Cell{ObservationID: int64(i + 1), Result: benchdb.Result{Row: benchdb.Row{Engine: "runtime", Version: "version", Backend: "jit", Workload: "corpus", Wasm: "corpus.wasm", Artifact: strings.Repeat("b", 64), Contract: strings.Repeat("c", 64), Source: source, Value: &value, SamplesNs: []float64{1, 2, 3, 4, 5}}, CapturedAt: "2026-10-10T00:00:00Z"}})
	}
	packed := packMatrix(sqldb.Matrix{Revision: "revision", Platform: "platform", Phase: "steady", Total: 100, Items: rows})
	if len(packed.Contracts) != 1 || len(packed.Configurations) != 1 || len(packed.Sources) != 1 || len(packed.CapturedAt) != 1 || len(packed.Rows) != 100 {
		t.Fatal("metadata was not deduplicated")
	}
	data, err := json.Marshal(packed)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "samplesNs") {
		t.Fatal("table contains raw samples")
	}
	original, _ := json.Marshal(rows)
	if len(data)*3 >= len(original) {
		t.Fatalf("packed response too large: %d vs %d", len(data), len(original))
	}
	for i, row := range packed.Rows {
		if row[0] != int64(i+1) || row[5] != rows[i].Value {
			t.Fatal("scalar or observation order changed")
		}
	}
}

func TestCompactTablePreservesPhasesAndLazyDetail(t *testing.T) {
	zero, positive := 0.0, 12.0
	rows := []sqldb.Cell{}
	for i, phase := range []string{"compile", "instantiate", "first-call", "steady"} {
		value := &positive
		if i == 3 {
			value = &zero
		}
		rows = append(rows, sqldb.Cell{ObservationID: int64(i + 1), SampleStats: &sqldb.SampleStats{Count: 5, Mean: 0.25}, Result: benchdb.Result{Row: benchdb.Row{Phase: phase, Status: "ok", Value: value, Sampling: &benchdb.Sampling{}}, CapturedAt: "date"}})
	}
	result := packTable(sqldb.Matrix{Items: rows, Total: 4})
	if result.Schema != 4 || len(result.Sampling) != 1 || result.Sampling[0] != nil {
		t.Fatal("sampling included")
	}
	for i, row := range result.Rows {
		if row[5] != i || row[0] != int64(i+1) {
			t.Fatal("phase/detail key lost")
		}
		if i < 3 && row[12] != nil {
			t.Fatal("eager sample stats")
		}
	}
	if result.Rows[3][12] == nil {
		t.Fatal("sub-resolution recovery lost")
	}
}
