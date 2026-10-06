package store

import (
	"context"
	"fmt"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func (s *Store) validateConformance(ctx context.Context, job wire.Job, records map[string]wire.Record, binaries map[string]wire.Object) error {
	sources := map[string]wire.ConformanceSource{}
	reports := map[string]bool{}
	for _, record := range records {
		if record.Kind != "conformance-source" {
			continue
		}
		source, err := wire.ConformanceSourceData(record.Data)
		if err != nil {
			return err
		}
		matched := false
		for _, export := range job.Exports {
			m := export.Manifest
			if m.Format == "conformance-v1" && source.ReportID == m.ReportID && source.SHA256 == m.SourceReportSHA256 && source.Receipt.SHA256 == m.SourceSealSHA256 {
				matched = true
			}
		}
		if !matched || reports[source.ReportID] {
			return wire.Invalid("conformance source differs from manifest")
		}
		reports[source.ReportID] = true
		sources[record.ID] = source
		if err = source.Verify(func(chunk wire.FileChunk) ([]byte, error) {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			object, ok := binaries[chunk.SHA256]
			if !ok || object.Bytes != chunk.Bytes {
				return nil, wire.Invalid("unresolved conformance source chunk")
			}
			return s.objectRepresentationContext(ctx, object)
		}); err != nil {
			return err
		}
	}
	if job.Kind == "conformance" {
		for _, export := range job.Exports {
			if !reports[export.Manifest.ReportID] {
				return wire.Invalid("missing conformance source")
			}
		}
	}
	contexts := map[string]wire.ConformanceContext{}
	coverage := map[string]int{}
	coverageKeys := map[string]bool{}
	for _, record := range records {
		if record.Kind != "conformance-context" {
			continue
		}
		value, err := wire.ConformanceContextData(record.Data)
		if err != nil {
			return err
		}
		if _, ok := sources[value.SourceID]; !ok {
			return wire.Invalid("unresolved conformance context source")
		}
		if _, ok := contexts[value.SourceID]; ok {
			return wire.Invalid("duplicate conformance source context")
		}
		contexts[value.SourceID] = value
	}
	for _, record := range records {
		if record.Kind != "conformance-coverage" {
			continue
		}
		value, err := wire.ConformanceCoverageData(record.Data)
		if err != nil {
			return err
		}
		context, ok := contexts[value.SourceID]
		if !ok || context.CoverageCount == nil || !context.Created.Equal(value.Created) {
			return wire.Invalid("unresolved conformance coverage context")
		}
		key := value.SourceID + ":" + value.Engine
		if coverageKeys[key] {
			return wire.Invalid("duplicate conformance coverage engine")
		}
		coverageKeys[key] = true
		coverage[value.SourceID]++
	}
	for source, context := range contexts {
		if context.CoverageCount != nil && coverage[source] != *context.CoverageCount {
			return wire.Invalid("conformance coverage population differs")
		}
	}
	seen := map[string]bool{}
	populations := map[string]int{}
	for _, record := range records {
		if record.Kind != "conformance" {
			continue
		}
		lane, err := wire.ConformanceLaneData(record.Data)
		if err != nil {
			return err
		}
		if _, ok := sources[lane.SourceID]; !ok {
			return wire.Invalid("unresolved conformance lane source")
		}
		if context, ok := contexts[lane.SourceID]; ok && !context.Created.Equal(lane.Created) {
			return wire.Invalid("conformance collection time differs")
		}
		key := lane.SourceID + ":" + lane.Lane
		if seen[key] {
			return wire.Invalid("duplicate conformance lane")
		}
		seen[key] = true
		populations[lane.SourceID]++
		if populations[lane.SourceID] > 128 {
			return wire.Invalid("conformance lane population exceeds ceiling")
		}
	}
	for id := range sources {
		if populations[id] == 0 {
			return wire.Invalid("conformance source has no recorded lanes")
		}
	}
	return nil
}

func (s *Store) ConformanceSourceChunk(ctx context.Context, revision, sourceID, digest string) ([]byte, error) {
	if !wire.IsHash(digest) {
		return nil, wire.Invalid("invalid conformance chunk identity")
	}
	record, err := s.Record(revision, "conformance-source", sourceID)
	if err != nil {
		return nil, err
	}
	source, err := wire.ConformanceSourceData(record.Data)
	if err != nil {
		return nil, err
	}
	for _, chunk := range append(source.Chunks, source.Receipt) {
		if chunk.SHA256 == digest {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			return s.objectRepresentationContext(ctx, wire.Object{SHA256: chunk.SHA256, Bytes: chunk.Bytes, Kind: "binary"})
		}
	}
	return nil, ErrNotFound
}

// Empty selections are valid before any benchmark publication. A suite-only
// revision must preserve every selection inherited from its parent.
func (s *Store) validateSelectionRoot(r Revision) error {
	if r.Selection != "" {
		return nil
	}
	var job wire.Job
	if err := s.load(r.Job, &job); err != nil {
		return err
	}
	if err := job.Validate(); err != nil || job.Kind != "conformance" {
		return fmt.Errorf("invalid empty revision selection")
	}
	if r.Parent != "" {
		var parent Revision
		if err := s.load(r.Parent, &parent); err != nil {
			return err
		}
		if parent.Selection != "" {
			return fmt.Errorf("revision erased benchmark selection")
		}
	}
	return nil
}
