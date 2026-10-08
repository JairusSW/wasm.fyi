package api

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type preparedPageResults struct {
	Schema   int                      `json:"schema"`
	Revision string                   `json:"revision"`
	Entries  map[string][]wire.Record `json:"entries"`
}

// Prepared selections stay on the server. Only a requested page is serialized
// to the browser; global filtering, sorting and totals still see every row.
func (b *PageBuilder) PreparedResults(ctx context.Context, seed PageSeed) ([]byte, error) {
	definitions := [][3]string{{"time.wall", "steady", "median_ns_per_operation"}}
	for _, d := range definitions {
		q := store.Query{Revision: b.Revision, Environment: seed.Environment, Environments: seed.Environments, Selection: "current", Metric: d[0], Scenario: d[1], Statistic: d[2], Sort: "catalog"}
		if d[0] == "time.wall" {
			q.Profile = "timing"
		}
		if _, e := b.api.resultRows(ctx, q, false); e != nil {
			return nil, e
		}
	}
	b.api.results.mu.Lock()
	defer b.api.results.mu.Unlock()
	cache := preparedPageResults{Schema: 1, Revision: b.Revision, Entries: map[string][]wire.Record{}}
	for key, entry := range b.api.results.entries {
		cache.Entries[key] = entry.rows
	}
	return json.Marshal(cache)
}

func (a *API) loadPreparedResults(directory string) error {
	if directory == "" {
		return nil
	}
	path := filepath.Join(directory, "prepared-results.json")
	info, e := os.Stat(path)
	if e != nil {
		return e
	}
	if info.Size() > 32<<20 {
		return fmt.Errorf("prepared page selections exceed ceiling")
	}
	raw, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	digest, e := os.ReadFile(path + ".sha256")
	if e != nil {
		return e
	}
	if strings.TrimSpace(string(digest)) != wire.Hash(raw) {
		return fmt.Errorf("prepared page selection checksum differs")
	}
	var cache preparedPageResults
	if e = wire.Decode(raw, &cache); e != nil {
		return e
	}
	if cache.Schema != 1 || !wire.IsHash(cache.Revision) || len(cache.Entries) > resultCacheEntries {
		return fmt.Errorf("invalid prepared page selections")
	}
	if _, e = a.Store.Revision(cache.Revision); e != nil {
		return e
	}
	for key, rows := range cache.Entries {
		if !wire.IsHash(key) {
			return fmt.Errorf("invalid prepared selection key")
		}
		for _, row := range rows {
			if row.Kind != "result" || !wire.IsHash(row.ID) {
				return fmt.Errorf("invalid prepared summary")
			}
		}
		a.results.put(key, rows)
	}
	historyDirectory := filepath.Join(directory, "history-index")
	if _, e = os.Stat(historyDirectory); e == nil {
		a.historyIndex, e = store.OpenHistoryReadIndex(historyDirectory, cache.Revision)
		if e != nil {
			return e
		}
		a.Store.EnablePreparedSelections(a.historyIndex)
	} else if !os.IsNotExist(e) {
		return e
	}
	return nil
}
