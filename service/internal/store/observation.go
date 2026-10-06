package store

import (
	"encoding/json"
	"fmt"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// The source report/seal identify this capture. Exact configuration, contract,
// metric and analysis distinguish scientific results. Evidence links and artifact
// representations do not create a second independent capture of the same result.
func observationID(record wire.Record) (string, error) {
	var value wire.Result
	if err := wire.Decode(record.Data, &value); err != nil {
		return "", err
	}
	var summary map[string]json.RawMessage
	if err := json.Unmarshal(value.Summary, &summary); err != nil {
		return "", err
	}
	delete(summary, "artifactId")
	value.Evidence = nil
	// A bounded selector extracted from the same sealed report enriches its
	// representation; it does not create another independent measurement.
	value.MeasurementMethod = nil
	value.MeasurementMethodID = ""
	// Sampling provenance is enrichment until a versioned history policy can
	// connect equivalent captures across reports. Preserve same-report identity.
	value.SamplingGroup = nil
	value.Summary, _ = wire.Encode(summary)
	b, err := wire.Encode(value)
	if err != nil {
		return "", err
	}
	return wire.Hash(b), nil
}

func (s *Store) representationRank(revision Revision, record wire.Record) (int, error) {
	var value wire.Result
	if err := wire.Decode(record.Data, &value); err != nil {
		return 0, err
	}
	rank := 0
	if len(value.Evidence) > 0 {
		rank = 1
	}
	if value.MeasurementMethod != nil && value.MeasurementMethod.Status == "available" {
		rank++
	}
	if value.SamplingGroup != nil {
		rank++
	}
	var summary struct {
		Artifact string `json:"artifactId"`
	}
	if err := json.Unmarshal(value.Summary, &summary); err != nil {
		return 0, err
	}
	if summary.Artifact != "" {
		artifact, err := s.record(revision.Catalog, "artifact", summary.Artifact)
		if err != nil {
			return 0, err
		}
		var availability struct {
			Content    struct{ Status string }
			Inspection struct{ Status string }
		}
		if err = json.Unmarshal(artifact.Data, &availability); err != nil {
			return 0, err
		}
		if availability.Content.Status == "available" {
			rank += 4
		}
		if availability.Inspection.Status == "available" {
			rank += 2
		}
	}
	return rank, nil
}

// Return whether an observation already existed, retaining the richer available
// representation. Stable ID order breaks equal-rank ties without publication time.
func (s *Store) registerObservation(revision *Revision, record wire.Record) (bool, error) {
	id, err := observationID(record)
	if err != nil {
		return false, err
	}
	prior, err := s.mapGet(revision.Observations, id)
	if err != nil {
		return false, err
	}
	if prior == record.ID {
		return true, nil
	}
	if prior != "" {
		old, err := s.record(revision.Catalog, "result", prior)
		if err != nil {
			return false, err
		}
		oldRank, err := s.representationRank(*revision, old)
		if err != nil {
			return false, err
		}
		newRank, err := s.representationRank(*revision, record)
		if err != nil {
			return false, err
		}
		if newRank < oldRank || newRank == oldRank && record.ID < prior {
			return true, nil
		}
	}
	revision.Observations, err = s.mapSet(revision.Observations, id, record.ID, 0)
	return prior != "", err
}
func (s *Store) resolveObservation(revision Revision, result string) (string, error) {
	if revision.Observations == "" {
		return result, nil
	}
	record, err := s.record(revision.Catalog, "result", result)
	if err != nil {
		return "", err
	}
	id, err := observationID(record)
	if err != nil {
		return "", err
	}
	resolved, err := s.mapGet(revision.Observations, id)
	if err != nil {
		return "", err
	}
	if resolved == "" {
		return "", fmt.Errorf("missing observation representation")
	}
	return resolved, nil
}
