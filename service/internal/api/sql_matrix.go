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
	out := compactMatrix{Schema: 2, Revision: v.Revision, Platform: v.Platform, Phase: v.Phase, Total: v.Total, NextOffset: v.NextOffset, Contracts: []matrixContract{}, Configurations: []matrixConfiguration{}, Sources: []*benchdb.Source{}, Sampling: []*benchdb.Sampling{}, CapturedAt: []string{}, Rows: [][]any{}}
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
