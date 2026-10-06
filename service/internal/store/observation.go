package store

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

const ObservationPolicy = "source-sampling-summary-v3"
const previousObservationPolicy = "source-sampling-summary-v2"

func observationIdentity(record wire.Record, policy string) (string, error) {
	if policy == "" || policy == "source-summary-v1" {
		return observationID(record)
	}
	if policy != ObservationPolicy && policy != previousObservationPolicy {
		return "", wire.Invalid("unsupported observation policy")
	}
	var value wire.Result
	if err := wire.Decode(record.Data, &value); err != nil {
		return "", err
	}
	if value.SamplingGroup == nil {
		return observationID(record)
	}
	if err := value.SamplingGroup.Validate(value); err != nil {
		return "", err
	}
	var summary map[string]json.RawMessage
	if err := json.Unmarshal(value.Summary, &summary); err != nil {
		return "", err
	}
	delete(summary, "artifactId")
	value.Summary, _ = wire.Encode(summary)
	value.ReportID = ""
	value.Evidence = nil
	value.MeasurementMethod = nil // Its digest remains part of scientific identity.
	b, err := wire.Encode(value)
	if err != nil {
		return "", err
	}
	return wire.Hash(b), nil
}

// Upgrade only the new revision. Older maps and their cursor scopes stay intact.
func (s *Store) upgradeObservations(ctx context.Context, rev *Revision) error {
	if rev.ObservationPolicy == ObservationPolicy && rev.Observations != "" {
		return nil
	}
	rev.Observations = ""
	rev.SourceBindings = ""
	rev.ObservationPolicy = ObservationPolicy
	budget := ScanLimit
	if err := s.walk(rev.Catalog, &budget, func(_, digest string) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		var record wire.Record
		if err := s.load(digest, &record); err != nil {
			return err
		}
		if record.Kind != "result" {
			return nil
		}
		_, err := s.registerObservation(rev, record)
		return err
	}); err != nil {
		return err
	}
	// A v1 current/previous pair may represent two publications of one source.
	// Recover the newest two distinct captures from the retained history chain.
	budget = ScanLimit
	updates := map[string]string{}
	err := s.walk(rev.Selection, &budget, func(key, digest string) error {
		var c cell
		if err := s.load(digest, &c); err != nil {
			return err
		}
		dates := map[string]time.Time{}
		for h := c.History; h != ""; {
			if err := ctx.Err(); err != nil {
				return err
			}
			budget--
			if budget < 0 {
				return ErrLimit
			}
			var entry history
			if err := s.load(h, &entry); err != nil {
				return err
			}
			id, err := s.resolveObservation(*rev, entry.Result)
			if err != nil {
				return err
			}
			if _, ok := dates[id]; !ok {
				record, err := s.record(rev.Catalog, "result", id)
				if err != nil {
					return err
				}
				var result wire.Result
				if err := wire.Decode(record.Data, &result); err != nil {
					return err
				}
				dates[id] = result.Created
			}
			h = entry.Previous
		}
		ids := make([]string, 0, len(dates))
		for id := range dates {
			ids = append(ids, id)
		}
		sort.Slice(ids, func(i, j int) bool {
			if dates[ids[i]].Equal(dates[ids[j]]) {
				return ids[i] > ids[j]
			}
			return dates[ids[i]].After(dates[ids[j]])
		})
		c.Current, c.Previous = "", ""
		if len(ids) > 0 {
			c.Current = ids[0]
		}
		if len(ids) > 1 {
			c.Previous = ids[1]
		}
		id, err := s.put(c)
		if err == nil {
			updates[key] = id
		}
		return err
	})
	if err != nil {
		return err
	}
	rev.Selection, err = s.mapSetMany(ctx, rev.Selection, updates, 0)
	return err
}

// Legacy report-scoped identity. Exact configuration, contract,
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
	// Keep the v1 hash stable for immutable revisions and same-report aliases.
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
	id, err := observationIdentity(record, revision.ObservationPolicy)
	if err != nil {
		return false, err
	}
	legacy, err := observationID(record)
	if err != nil {
		return false, err
	}
	if revision.ObservationPolicy != ObservationPolicy {
		return s.registerObservationIdentity(revision, record, id)
	}
	// Source binding and evidence ranking are separate: a descriptor need not
	// replace a richer same-report representation to prove its source identity.
	if id != legacy {
		priorProof, err := s.mapGet(revision.SourceBindings, legacy)
		if err != nil {
			return false, err
		}
		if priorProof != "" {
			proof, err := s.record(revision.Catalog, "result", priorProof)
			if err != nil {
				return false, err
			}
			bound, err := observationIdentity(proof, ObservationPolicy)
			if err != nil {
				return false, err
			}
			if bound != id {
				return false, wire.Invalid("conflicting same-report source binding")
			}
		} else {
			revision.SourceBindings, err = s.mapSet(revision.SourceBindings, legacy, record.ID, 0)
			if err != nil {
				return false, err
			}
		}
	}
	existed, err := s.registerObservationIdentity(revision, record, legacy)
	if err != nil {
		return false, err
	}
	proofID, err := s.mapGet(revision.SourceBindings, legacy)
	if err != nil || proofID == "" {
		return existed, err
	}
	proof, err := s.record(revision.Catalog, "result", proofID)
	if err != nil {
		return false, err
	}
	sharedID, err := observationIdentity(proof, ObservationPolicy)
	if err != nil {
		return false, err
	}
	preferred, err := s.mapGet(revision.Observations, legacy)
	if err != nil {
		return false, err
	}
	rich, err := s.record(revision.Catalog, "result", preferred)
	if err != nil {
		return false, err
	}
	if err := compatibleSourceProof(rich, proof); err != nil {
		return false, err
	}
	shared, err := s.registerObservationIdentity(revision, rich, sharedID)
	return existed || shared, err
}

func compatibleSourceProof(record, proof wire.Record) error {
	legacy, err := observationID(record)
	if err != nil {
		return err
	}
	bound, err := observationID(proof)
	if err != nil {
		return err
	}
	if legacy != bound {
		return wire.Invalid("source proof scientific binding differs")
	}
	var value, source wire.Result
	if err := wire.Decode(record.Data, &value); err != nil {
		return err
	}
	if err := wire.Decode(proof.Data, &source); err != nil {
		return err
	}
	if source.SamplingGroup == nil {
		return wire.Invalid("source proof lacks sampling provenance")
	}
	if value.MeasurementMethodID != "" && value.MeasurementMethodID != source.MeasurementMethodID {
		return wire.Invalid("source proof method differs")
	}
	if value.SamplingGroup != nil && value.SamplingGroup.ID != source.SamplingGroup.ID {
		return wire.Invalid("source proof population differs")
	}
	return source.ValidateMethod()
}

func (s *Store) registerObservationIdentity(revision *Revision, record wire.Record, id string) (bool, error) {
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
	if revision.ObservationPolicy == ObservationPolicy {
		legacy, err := observationID(record)
		if err != nil {
			return "", err
		}
		proofID, err := s.mapGet(revision.SourceBindings, legacy)
		if err != nil {
			return "", err
		}
		id := legacy
		if proofID != "" {
			proof, err := s.record(revision.Catalog, "result", proofID)
			if err != nil {
				return "", err
			}
			id, err = observationIdentity(proof, ObservationPolicy)
			if err != nil {
				return "", err
			}
		}
		preferred, err := s.mapGet(revision.Observations, id)
		if err != nil {
			return "", err
		}
		if preferred == "" {
			return "", fmt.Errorf("missing observation representation")
		}
		return preferred, nil
	}
	id, err := observationIdentity(record, revision.ObservationPolicy)
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
	// A legacy record can resolve to same-report provenance enrichment, then
	// to the preferred representation of that source population across reports.
	if revision.ObservationPolicy == previousObservationPolicy && resolved != result {
		record, err := s.record(revision.Catalog, "result", resolved)
		if err != nil {
			return "", err
		}
		shared, err := observationIdentity(record, revision.ObservationPolicy)
		if err != nil {
			return "", err
		}
		preferred, err := s.mapGet(revision.Observations, shared)
		if err != nil {
			return "", err
		}
		if preferred == "" {
			return "", fmt.Errorf("missing source observation representation")
		}
		resolved = preferred
	}
	return resolved, nil
}

// API summaries can expose verified same-report provenance alongside the richer
// canonical record. Persisted record bytes and evidence links remain untouched.
func (s *Store) enrichObservation(rev Revision, record wire.Record, value *wire.Result) error {
	if rev.ObservationPolicy != ObservationPolicy || value.SamplingGroup != nil {
		return nil
	}
	legacy, err := observationID(record)
	if err != nil {
		return err
	}
	proofID, err := s.mapGet(rev.SourceBindings, legacy)
	if err != nil || proofID == "" {
		return err
	}
	proof, err := s.record(rev.Catalog, "result", proofID)
	if err != nil {
		return err
	}
	if err := compatibleSourceProof(record, proof); err != nil {
		return err
	}
	var source wire.Result
	if err = wire.Decode(proof.Data, &source); err != nil {
		return err
	}
	value.SamplingGroup = source.SamplingGroup
	if value.MeasurementMethodID == "" {
		value.MeasurementMethodID = source.MeasurementMethodID
		value.MeasurementMethod = source.MeasurementMethod
	}
	return value.ValidateMethod()
}
