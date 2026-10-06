package store

import (
	"context"
	"fmt"
	"reflect"
	"sort"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// Build final changed branches once. Intermediate roots were never published
// and do not need their own durable files. Unchanged branches remain shared.
func (s *Store) mapSetMany(ctx context.Context, root string, updates map[string]string, depth int) (string, error) {
	if e := ctx.Err(); e != nil {
		return "", e
	}
	if len(updates) == 0 {
		return root, nil
	}
	n := node{Entries: map[string]string{}}
	if root != "" {
		if e := s.load(root, &n); e != nil {
			return "", e
		}
	}
	if n.Children == nil {
		changed := false
		for key, value := range updates {
			if n.Entries[key] != value {
				n.Entries[key] = value
				changed = true
			}
		}
		if !changed {
			return root, nil
		}
		if len(n.Entries) <= 32 {
			return s.put(n)
		}
		updates = n.Entries
		n = node{Children: map[string]string{}}
	}
	if depth >= 64 {
		return "", fmt.Errorf("map collision")
	}
	groups := map[string]map[string]string{}
	for key, value := range updates {
		path := wire.Hash([]byte(key))
		prefix := path[depth : depth+1]
		if groups[prefix] == nil {
			groups[prefix] = map[string]string{}
		}
		groups[prefix][key] = value
	}
	before := map[string]string{}
	for key, value := range n.Children {
		before[key] = value
	}
	prefixes := []string{}
	for prefix := range groups {
		prefixes = append(prefixes, prefix)
	}
	sort.Strings(prefixes)
	for _, prefix := range prefixes {
		child, e := s.mapSetMany(ctx, n.Children[prefix], groups[prefix], depth+1)
		if e != nil {
			return "", e
		}
		n.Children[prefix] = child
	}
	if root != "" && reflect.DeepEqual(before, n.Children) {
		return root, nil
	}
	return s.put(n)
}

func (s *Store) addRecordIndexBatch(ctx context.Context, rev *Revision, records map[string]wire.Record, digests map[string]string) error {
	updates := map[string]map[string]string{}
	add := func(key, entry, value string) {
		if updates[key] == nil {
			updates[key] = map[string]string{}
		}
		updates[key][entry] = value
	}
	for key, r := range records {
		if e := ctx.Err(); e != nil {
			return e
		}
		digest := digests[key]
		add(indexKey("catalog", r.Kind, ""), r.ID, digest)
		if r.Kind == "conformance" {
			lane, e := wire.ConformanceLaneData(r.Data)
			if e != nil {
				return e
			}
			add(indexKey("source-conformance", lane.SourceID, ""), r.ID, digest)
		}
		if r.Kind == "feature-probe" {
			probe, e := wire.FeatureProbeData(r.Data)
			if e != nil {
				return e
			}
			add(indexKey("report-features", probe.ReportID, ""), r.ID, digest)
		}
		if r.Kind == "report-file" {
			file, e := wire.ReportFileData(r.Data)
			if e != nil {
				return e
			}
			set, e := s.indexGet(rev.Indexes, indexKey("report-files", file.ReportID, ""))
			if e != nil {
				return e
			}
			prior, e := s.mapGet(set.Root, file.Name)
			if e != nil {
				return e
			}
			if prior != "" && prior != digest {
				return wire.Invalid("immutable report file collision")
			}
			fileKey := indexKey("report-files", file.ReportID, "")
			if other := updates[fileKey][file.Name]; other != "" && other != digest {
				return wire.Invalid("duplicate report file name")
			}
			add(fileKey, file.Name, digest)
		}
		if r.Kind != "result" {
			continue
		}
		var v wire.Result
		if e := wire.Decode(r.Data, &v); e != nil {
			return e
		}
		if v.MeasurementMethod != nil {
			add(indexKey("methods", v.MeasurementMethodID, v.MetricDefinitionID), r.ID, digest)
		}
		for dimension, value := range dimensions(v) {
			if dimension == "method" && value == "" {
				continue
			}
			add(indexKey("cells", dimension, value), v.Cell(), v.Cell())
		}
	}
	directory := map[string]string{}
	keys := []string{}
	for key := range updates {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if e := ctx.Err(); e != nil {
			return e
		}
		set, e := s.indexGet(rev.Indexes, key)
		if e != nil {
			return e
		}
		for entry := range updates[key] {
			old, e := s.mapGet(set.Root, entry)
			if e != nil {
				return e
			}
			if old == "" {
				set.Count++
			}
		}
		set.Root, e = s.mapSetMany(ctx, set.Root, updates[key], 0)
		if e != nil {
			return e
		}
		id, e := s.put(set)
		if e != nil {
			return e
		}
		directory[key] = id
	}
	root, e := s.mapSetMany(ctx, rev.Indexes, directory, 0)
	if e == nil {
		rev.Indexes = root
	}
	return e
}
