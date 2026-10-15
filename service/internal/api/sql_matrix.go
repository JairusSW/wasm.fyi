package api

import (
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/sqldb"
)

type matrixContract struct {
	Workload string           `json:"workload"`
	Wasm     string           `json:"wasm"`
	Artifact string           `json:"artifactSha256"`
	Contract string           `json:"contractSha256"`
	Display  *benchdb.Display `json:"display,omitempty"`
}
type matrixConfiguration struct {
	Engine  string `json:"engine"`
	Version string `json:"version"`
	Backend string `json:"backend"`
}
type compactMatrix struct {
	DataRevision   string                `json:"dataRevision,omitempty"`
	Schema         int                   `json:"schema"`
	Revision       string                `json:"revision"`
	Platform       string                `json:"platform"`
	Phase          string                `json:"phase"`
	Total          int                   `json:"total"`
	NextOffset     *int                  `json:"nextOffset"`
	Contracts      []matrixContract      `json:"contracts"`
	Configurations []matrixConfiguration `json:"configurations"`
	Sources        []*benchdb.Source     `json:"sources"`
	Sampling       []*benchdb.Sampling   `json:"sampling"`
	CapturedAt     []string              `json:"capturedAt"`
	Rows           [][]any               `json:"rows"`
}

func dictionaryIndex[T any](values *[]T, index map[string]int, value T) int {
	data, _ := json.Marshal(value)
	key := string(data)
	if id, ok := index[key]; ok {
		return id
	}
	id := len(*values)
	index[key] = id
	*values = append(*values, value)
	return id
}

// Repeated source/configuration/artifact metadata is transmitted once per page.
// Row order: observation,contract,configuration,source,captured,latency,rss,code,
// latency status,memory status,code status,code kind,timing count,sampling.
func packMatrix(v sqldb.Matrix) compactMatrix {
	out := compactMatrix{DataRevision: v.DataRevision, Schema: 2, Revision: v.Revision, Platform: v.Platform, Phase: v.Phase, Total: v.Total, NextOffset: v.NextOffset, Contracts: []matrixContract{}, Configurations: []matrixConfiguration{}, Sources: []*benchdb.Source{}, Sampling: []*benchdb.Sampling{}, CapturedAt: []string{}, Rows: [][]any{}}
	contracts, configs, sources, sampling, captured := map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}
	for _, r := range v.Items {
		c := dictionaryIndex(&out.Contracts, contracts, matrixContract{r.Workload, r.Wasm, r.Artifact, r.Contract, r.Display})
		cfg := dictionaryIndex(&out.Configurations, configs, matrixConfiguration{r.Engine, r.Version, r.Backend})
		src := dictionaryIndex(&out.Sources, sources, r.Source)
		policy := dictionaryIndex(&out.Sampling, sampling, r.Sampling)
		time := dictionaryIndex(&out.CapturedAt, captured, r.CapturedAt)
		out.Rows = append(out.Rows, []any{r.ObservationID, c, cfg, src, time, r.Value, r.PeakRSS, r.CodeBytes, r.Status, r.MemoryStatus, r.CodeStatus, r.CodeKind, r.TimingSamples, policy, compactStats(r.SampleStats)})
	}
	return out
}

func compactStats(stats *sqldb.SampleStats) any {
	if stats == nil {
		return nil
	}
	return []any{stats.Count, stats.Mean, stats.StdDev, stats.Min, stats.Max}
}

// Table omits sampling policies and uses compact metric/phase codes. Original
// observations and complete sample statistics remain on the detail endpoint.
type compactTable struct {
	compactMatrix
	CodeKinds []*string `json:"codeKinds"`
}

var tableStatuses = []string{"not-measured", "ok", "failed", "unsupported", "disabled", "unavailable"}

func tableStatus(v string) int {
	for i, name := range tableStatuses {
		if v == name {
			return i
		}
	}
	return 0
}
func packTable(v sqldb.Matrix) compactTable {
	out := compactTable{compactMatrix: compactMatrix{DataRevision: v.DataRevision, Schema: 4, Revision: v.Revision, Platform: v.Platform, Phase: v.Phase, Total: v.Total, NextOffset: v.NextOffset, Contracts: []matrixContract{}, Configurations: []matrixConfiguration{}, Sources: []*benchdb.Source{}, Sampling: []*benchdb.Sampling{nil}, CapturedAt: []string{}, Rows: make([][]any, 0, len(v.Items))}, CodeKinds: []*string{}}
	contracts, configs, sources, captured, kinds := map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}
	for _, r := range v.Items {
		contract := dictionaryIndex(&out.Contracts, contracts, matrixContract{r.Workload, r.Wasm, r.Artifact, r.Contract, r.Display})
		config := dictionaryIndex(&out.Configurations, configs, matrixConfiguration{r.Engine, r.Version, r.Backend})
		source := dictionaryIndex(&out.Sources, sources, r.Source)
		at := dictionaryIndex(&out.CapturedAt, captured, r.CapturedAt)
		kind := dictionaryIndex(&out.CodeKinds, kinds, r.CodeKind)
		phase := 0
		for i, name := range []string{"compile", "instantiate", "first-call", "steady"} {
			if r.Phase == name {
				phase = i
				break
			}
		}
		flags := tableStatus(r.Status) | tableStatus(r.MemoryStatus)<<3 | tableStatus(r.CodeStatus)<<6
		var recovered any
		if r.Status == "ok" && (r.Value == nil || *r.Value == 0) && r.SampleStats != nil && r.SampleStats.Mean > 0 {
			recovered = r.SampleStats.Mean
		}
		out.Rows = append(out.Rows, []any{r.ObservationID, contract, config, source, at, phase, r.Value, r.PeakRSS, r.CodeBytes, flags, kind, r.TimingSamples, recovered})
	}
	return out
}
