package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// Index directories and posting sets are persistent maps: a new corpus copies
// only changed branches and never a whole catalog or historical dataset.
type indexSet struct {
	Root  string `json:"root"`
	Count int    `json:"count"`
}

func indexKey(kind, dimension, value string) string {
	b, _ := wire.Encode([]string{kind, dimension, value})
	return string(b)
}
func (s *Store) indexGet(directory, k string) (indexSet, error) {
	var set indexSet
	id, e := s.mapGet(directory, k)
	if e != nil || id == "" {
		return set, e
	}
	e = s.load(id, &set)
	return set, e
}
func (s *Store) indexAdd(directory, k, entry, value string) (string, error) {
	set, e := s.indexGet(directory, k)
	if e != nil {
		return "", e
	}
	previous, e := s.mapGet(set.Root, entry)
	if e != nil {
		return "", e
	}
	if previous == value {
		return directory, nil
	}
	if previous == "" {
		set.Count++
	}
	set.Root, e = s.mapSet(set.Root, entry, value, 0)
	if e != nil {
		return "", e
	}
	id, e := s.put(set)
	if e != nil {
		return "", e
	}
	return s.mapSet(directory, k, id, 0)
}
func dimensions(v wire.Result) map[string]string {
	return map[string]string{"environment": v.EnvironmentID, "runtime": v.Runtime, "track": v.TrackID, "configuration": v.ConfigurationID, "contract": v.ContractID, "workload": v.Workload, "metric": v.Metric, "definition": v.MetricDefinitionID, "scenario": v.Scenario, "profile": v.Profile, "statistic": v.Statistic}
}
func filters(q Query) map[string]string {
	return map[string]string{"environment": q.Environment, "runtime": q.Runtime, "track": q.Track, "configuration": q.Configuration, "contract": q.Contract, "workload": q.Workload, "metric": q.Metric, "definition": q.Definition, "scenario": q.Scenario, "profile": q.Profile, "statistic": q.Statistic}
}

// Match against the smallest persisted posting set. Unrelated records do not
// consume the scoped query's budget or require a full-map decode.
func (s *Store) candidates(ctx context.Context, rev Revision, q Query, budget *int, visit func(string) error) error {
	if rev.Indexes == "" {
		return s.walk(rev.Selection, budget, func(cell, _ string) error {
			if e := ctx.Err(); e != nil {
				return e
			}
			return visit(cell)
		})
	}
	selected := indexSet{Root: rev.Selection, Count: int(^uint(0) >> 1)}
	for dimension, value := range filters(q) {
		if value == "" {
			continue
		}
		set, e := s.indexGet(rev.Indexes, indexKey("cells", dimension, value))
		if e != nil {
			return e
		}
		if set.Root == "" {
			return nil
		}
		if set.Count < selected.Count {
			selected = set
		}
	}
	if selected.Count > ScanLimit && selected.Root != rev.Selection {
		return ErrLimit
	}
	return s.walk(selected.Root, budget, func(cell, _ string) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		return visit(cell)
	})
}
func (s *Store) indexedCatalog(ctx context.Context, rev Revision, kind string, budget *int, visit func(wire.Record) error) error {
	if rev.Indexes == "" {
		return s.walk(rev.Catalog, budget, func(k, digest string) error {
			if e := ctx.Err(); e != nil {
				return e
			}
			if len(k) <= len(kind) || k[:len(kind)+1] != kind+":" {
				return nil
			}
			var r wire.Record
			if e := s.load(digest, &r); e != nil {
				return e
			}
			return visit(r)
		})
	}
	set, e := s.indexGet(rev.Indexes, indexKey("catalog", kind, ""))
	if e != nil {
		return e
	}
	return s.walk(set.Root, budget, func(id, digest string) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		var r wire.Record
		if e := s.load(digest, &r); e != nil {
			return e
		}
		if r.ID != id || r.Kind != kind {
			return fmt.Errorf("corrupt catalog index")
		}
		return visit(r)
	})
}
func (s *Store) addRecordIndexes(rev *Revision, r wire.Record, digest string) error {
	var e error
	rev.Indexes, e = s.indexAdd(rev.Indexes, indexKey("catalog", r.Kind, ""), r.ID, digest)
	if e != nil {
		return e
	}
	if r.Kind != "result" {
		return nil
	}
	var v wire.Result
	if e = json.Unmarshal(r.Data, &v); e != nil {
		return e
	}
	for dimension, value := range dimensions(v) {
		rev.Indexes, e = s.indexAdd(rev.Indexes, indexKey("cells", dimension, value), v.Cell(), v.Cell())
		if e != nil {
			return e
		}
	}
	return nil
}
