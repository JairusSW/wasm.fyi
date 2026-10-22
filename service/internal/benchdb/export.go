package benchdb

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/cockroachdb/pebble/v2"
)

// ExportBindings preserves both latest and historical bindings, including aliases.
// It returns stored values exactly, without presentation fallbacks or sample loss.
func (s *Store) ExportBindings(ctx context.Context, emit func(string, Platform, Result) error) error {
	snapshot := s.db.NewSnapshot()
	defer snapshot.Close()
	platforms := map[string]Platform{}
	contracts := map[string]contract{}
	engines := map[string]engine{}
	iter, err := snapshot.NewIter(nil)
	if err != nil {
		return err
	}
	defer iter.Close()
	for iter.First(); iter.Valid(); iter.Next() {
		if err = ctx.Err(); err != nil {
			return err
		}
		key := string(iter.Key())
		scope := ""
		if strings.HasPrefix(key, "rows/") {
			scope = "latest"
		} else if strings.HasPrefix(key, "history/") {
			scope = "history"
		} else {
			continue
		}
		parts := strings.SplitN(key, "/", 4)
		platformID, phase := parts[1], parts[2]
		platform, ok := platforms[platformID]
		if !ok {
			data, err := get(snapshot, "platforms/"+platformID)
			if err != nil {
				return err
			}
			if err = json.Unmarshal(data, &platform); err != nil {
				return err
			}
			platforms[platformID] = platform
		}
		var value measurement
		if err = unmarshalMeasurement(snapshot, iter.Value(), &value); err != nil {
			return err
		}
		c, ok := contracts[value.Contract]
		if !ok {
			data, err := get(snapshot, "contracts/"+value.Contract)
			if err != nil {
				return err
			}
			if err = json.Unmarshal(data, &c); err != nil {
				return err
			}
			contracts[value.Contract] = c
		}
		e, ok := engines[value.Engine]
		if !ok {
			data, err := get(snapshot, "engines/"+value.Engine)
			if err != nil {
				return err
			}
			if err = json.Unmarshal(data, &e); err != nil {
				return err
			}
			engines[value.Engine] = e
		}
		result := Result{Row: Row{FeatureProfile: value.FeatureProfile, Sampling: value.Sampling, Source: value.Source, Display: value.Display, TimingSamples: value.TimingSamples, SamplesNs: value.SamplesNs, Workload: c.Workload, Wasm: c.Wasm, Artifact: c.Artifact, Contract: value.Contract, Engine: e.ID, Version: e.Version, Backend: e.Backend, Phase: phase, Status: value.Status, Value: value.Latency, PeakRSS: value.PeakRSS, CodeBytes: value.Code, CodeKind: value.CodeKind, MemoryStatus: value.MemoryStatus, CodeStatus: value.CodeStatus}, CapturedAt: value.CapturedAt}
		if err = emit(scope, platform, result); err != nil {
			return err
		}
	}
	return iter.Error()
}

// ExportMetadata keeps legacy metadata available for a reversible migration.
// Physical shared objects are reconstructed through ExportBindings instead.
func (s *Store) ExportMetadata(ctx context.Context, emit func(string, []byte) error) error {
	snapshot := s.db.NewSnapshot()
	defer snapshot.Close()
	iter, err := snapshot.NewIter(&pebble.IterOptions{})
	if err != nil {
		return err
	}
	defer iter.Close()
	for iter.First(); iter.Valid(); iter.Next() {
		if err = ctx.Err(); err != nil {
			return err
		}
		key := string(iter.Key())
		if strings.HasPrefix(key, "rows/") || strings.HasPrefix(key, "history/") || strings.HasPrefix(key, "objects/") {
			continue
		}
		if err = emit(key, append([]byte(nil), iter.Value()...)); err != nil {
			return err
		}
	}
	return iter.Error()
}
