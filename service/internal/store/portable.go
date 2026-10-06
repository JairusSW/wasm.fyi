package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"github.com/cockroachdb/pebble/v2"
)

// The durable filesystem pointer is written after the synchronous DB commit
// and before acknowledgement. It makes a content-only rebuild unambiguous:
// unpublished CAS roots cannot become public by being found in a directory.
type portablePointer struct {
	Schema        int    `json:"schema"`
	Current       string `json:"current"`
	Registrations string `json:"registrationRoot,omitempty"`
	Overviews     string `json:"overviewRoot,omitempty"`
}

func atomicFile(path string, b []byte, mode os.FileMode) error {
	f, e := os.CreateTemp(filepath.Dir(path), ".atomic-")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if e = f.Chmod(mode); e != nil {
		f.Close()
		return e
	}
	if _, e = f.Write(b); e != nil {
		f.Close()
		return e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = os.Rename(f.Name(), path); e != nil {
		return e
	}
	return syncDir(filepath.Dir(path))
}
func (s *Store) portable(current string) error {
	return s.portableWithRegistrations(current, s.registrationRoot())
}
func (s *Store) portableWithRegistrations(current, registrations string) error {
	return s.portableRoots(current, registrations, s.overviewRoot())
}
func (s *Store) portableRoots(current, registrations, overviews string) error {
	b, e := wire.Encode(portablePointer{Schema: 1, Current: current, Registrations: registrations, Overviews: overviews})
	if e != nil {
		return e
	}
	return atomicFile(filepath.Join(s.root, "published.json"), b, 0600)
}

// Reachability is typed: posting-set cell IDs are logical keys, not blob hashes.
// Visit each shared object only once, irrespective of the number of revisions.
func (s *Store) reachable(includeStaging bool) (map[string]bool, error) {
	return s.reachableContext(context.Background(), includeStaging)
}
func (s *Store) reachableContext(ctx context.Context, includeStaging bool) (map[string]bool, error) {
	return s.reachableScopes(ctx, includeStaging, nil)
}

// Backup holds publication ownership while snapshotting both sets. Capture the
// required published/registered closure before adding optional staged objects.
func (s *Store) backupReachability(ctx context.Context) (map[string]bool, map[string]bool, error) {
	required := map[string]bool{}
	marked, err := s.reachableScopes(ctx, true, required)
	return marked, required, err
}

func (s *Store) reachableScopes(ctx context.Context, includeStaging bool, required map[string]bool) (map[string]bool, error) {
	var nativeProofs nativeValidationPass
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	marked := map[string]bool{}
	visited := map[string]bool{}
	read := func(id string, v any) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		b, e := s.typedContent(id, v)
		if e != nil {
			return e
		}
		marked[id] = true
		return wire.Decode(b, v)
	}
	fetchProofObject := func(o wire.Object) ([]byte, error) {
		if e := ctx.Err(); e != nil {
			return nil, e
		}
		b, e := s.objectRepresentation(o)
		if e == nil {
			marked[o.SHA256] = true
		}
		return b, e
	}
	plans := planVerifier{fetch: fetchProofObject}
	archives := archiveVerifier{fetch: fetchProofObject}
	origins, revisionRanks, e := s.publicationOrigins(read)
	if e != nil {
		return nil, e
	}
	postingOrigins := publicationPostingVerifier{read: read, origins: origins}
	revisionRank := 0
	var markMap func(string, string, func(string, string) error) error
	markMap = func(id, kind string, entry func(string, string) error) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		if id == "" {
			return nil
		}
		tag := kind + ":" + id
		if visited[tag] {
			return nil
		}
		visited[tag] = true
		var n node
		if e := read(id, &n); e != nil {
			return e
		}
		if e := validateNode(n); e != nil {
			return e
		}
		if n.Children != nil {
			for _, child := range n.Children {
				if e := markMap(child, kind, entry); e != nil {
					return e
				}
			}
		} else {
			for k, v := range n.Entries {
				if e := entry(k, v); e != nil {
					return e
				}
			}
		}
		return nil
	}
	var markEvidence func(string) error
	markEvidence = func(id string) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		if marked[id] {
			return nil
		}
		b, e := s.content(id)
		if e != nil {
			return e
		}
		marked[id] = true
		refs, e := wire.EvidenceReferences(b)
		if e != nil {
			return e
		}
		resource, e := wire.Resource(b)
		if e != nil {
			return e
		}
		if resource != nil {
			if e = wire.VerifyResource(*resource, func(id string) ([]byte, error) {
				if e := ctx.Err(); e != nil {
					return nil, e
				}
				return s.content(id)
			}); e != nil {
				return e
			}
		}
		for _, ref := range refs {
			if e = markEvidence(ref); e != nil {
				return e
			}
		}
		return nil
	}
	markRecord := func(_ string, id string) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		if visited["record:"+id] {
			return nil
		}
		visited["record:"+id] = true
		var r wire.Record
		if e := read(id, &r); e != nil {
			return e
		}
		if r.Kind == "report-file" {
			if wire.Hash(r.Data) != r.ID {
				return wire.Invalid("report file identity differs")
			}
			file, e := wire.ReportFileData(r.Data)
			if e != nil {
				return e
			}
			if file.Name == "report.tar.gz" {
				source, e := s.Record(s.Current(), "report", file.ReportID)
				if e != nil {
					return e
				}
				if e = file.ValidateSource(source.Data); e != nil {
					return e
				}
			}
			if e = wire.VerifyReportFile(file, func(chunk wire.FileChunk) ([]byte, error) {
				b, e := fetchProofObject(wire.Object{SHA256: chunk.SHA256, Bytes: chunk.Bytes, Kind: "binary"})
				if e == nil {
					marked[chunk.SHA256] = true
				}
				return b, e
			}); e != nil {
				return e
			}
		}
		if r.Kind == "conformance-source" {
			if wire.Hash(r.Data) != r.ID {
				return wire.Invalid("conformance source record identity differs")
			}
			source, err := wire.ConformanceSourceData(r.Data)
			if err != nil {
				return err
			}
			if err = source.Verify(func(chunk wire.FileChunk) ([]byte, error) {
				return fetchProofObject(wire.Object{SHA256: chunk.SHA256, Bytes: chunk.Bytes, Kind: "binary"})
			}); err != nil {
				return err
			}
		}
		if wire.IsConformanceKind(r.Kind) && r.Kind != "conformance-source" {
			if wire.Hash(r.Data) != r.ID {
				return wire.Invalid("conformance lane identity differs")
			}
			if _, err := wire.ConformanceMetadataSource(r.Kind, r.Data); err != nil {
				return err
			}
		}
		if r.Kind == "artifact" {
			artifact, e := wire.ArtifactData(r.Data)
			if e != nil {
				return e
			}
			if e = nativeProofs.validate(ctx, s, artifact, "", func(id string) ([]byte, error) {
				if e := ctx.Err(); e != nil {
					return nil, e
				}
				return s.content(id)
			}); e != nil {
				return e
			}
			if artifact.Content.Status == "available" {
				object := wire.Object{SHA256: artifact.Content.SHA256, Bytes: artifact.Content.Bytes, Kind: "binary"}
				if _, e = fetchProofObject(object); e != nil {
					return e
				}
				marked[object.SHA256] = true
			}
			if artifact.Inspection.Metadata != "" {
				if e := markEvidence(artifact.Inspection.Metadata); e != nil {
					return e
				}
			}
		}
		if r.Kind == "feature-probe" {
			if wire.Hash(r.Data) != r.ID {
				return wire.Invalid("feature probe identity differs")
			}
			probe, err := wire.FeatureProbeData(r.Data)
			if err != nil {
				return err
			}
			for _, ref := range probe.Evidence {
				if err = markEvidence(ref); err != nil {
					return err
				}
			}
		}
		if r.Kind == "report" {
			report, err := wire.ReportEvidenceData(r.Data)
			if err != nil {
				return err
			}
			if err = validateReportSections(r.ID, report, s.content); err != nil {
				return err
			}
			for _, ref := range report.Roots() {
				if e := markEvidence(ref); e != nil {
					return e
				}
			}
		}
		if r.Kind == "result" {
			var v wire.Result
			if e := wire.Decode(r.Data, &v); e != nil {
				return e
			}
			if e := v.ValidateMethod(); e != nil {
				return e
			}
			for _, ref := range v.Evidence {
				if e := markEvidence(ref); e != nil {
					return e
				}
			}
		}
		return nil
	}
	var markHistory func(string) error
	markHistory = func(id string) error {
		for id != "" {
			if visited["history:"+id] {
				return nil
			}
			visited["history:"+id] = true
			var h history
			if e := read(id, &h); e != nil {
				return e
			}
			id = h.Previous
		}
		return nil
	}
	markSelection := func(_ string, id string) error {
		var c cell
		if e := read(id, &c); e != nil {
			return e
		}
		return markHistory(c.History)
	}
	featureIndexProofs := map[string]int{}
	markIndexes := func(k, id string) error {
		var tuple []string
		if e := json.Unmarshal([]byte(k), &tuple); e != nil || len(tuple) != 3 {
			return fmt.Errorf("invalid index directory key")
		}
		var set indexSet
		if e := read(id, &set); e != nil {
			return e
		}
		switch tuple[0] {
		case "report-features", "source-conformance", "source-conformance-context", "source-conformance-coverage":
			if !wire.IsHash(tuple[1]) || tuple[2] != "" || set.Count < 0 || set.Count > ScanLimit {
				return wire.Invalid("invalid report feature index")
			}
			proof := tuple[0] + ":" + tuple[1] + ":" + set.Root
			if count, ok := featureIndexProofs[proof]; ok {
				if count != set.Count {
					return wire.Invalid("report feature index count differs")
				}
				return nil
			}
			if err := markMap(set.Root, "feature-index-nodes", func(string, string) error { return nil }); err != nil {
				return err
			}
			count, budget := 0, ScanLimit
			err := s.walk(set.Root, &budget, func(key, id string) error {
				var record wire.Record
				if err := read(id, &record); err != nil {
					return err
				}
				kind, source := "feature-probe", ""
				if tuple[0] == "report-features" {
					probe, err := wire.FeatureProbeData(record.Data)
					if err != nil {
						return err
					}
					source = probe.ReportID
				} else {
					kind = strings.TrimPrefix(tuple[0], "source-")
					value, err := wire.ConformanceMetadataSource(kind, record.Data)
					if err != nil {
						return err
					}
					source = value
				}
				if record.Kind != kind || record.ID != key || source != tuple[1] {
					return wire.Invalid("source-scoped posting differs")
				}
				count++
				return markRecord(key, id)
			})
			if err != nil {
				return err
			}
			if count != set.Count {
				return wire.Invalid("report feature index count differs")
			}
			featureIndexProofs[proof] = count
			return nil
		case "report-files":
			if set.Count > 9 {
				return ErrLimit
			}
			return markMap(set.Root, "posting-report-file", func(name, id string) error {
				var record wire.Record
				if e := read(id, &record); e != nil {
					return e
				}
				file, e := wire.ReportFileData(record.Data)
				if e != nil {
					return e
				}
				if record.Kind != "report-file" || file.Name != name || file.ReportID != tuple[1] {
					return wire.Invalid("report file posting differs")
				}
				return markRecord("", id)
			})
		case "catalog", "methods":
			return markMap(set.Root, "posting-record", markRecord)
		case "history-month":
			return markMap(set.Root, "posting-history", func(k, id string) error {
				var record wire.Record
				if e := read(id, &record); e != nil {
					return e
				}
				var result wire.Result
				if e := wire.Decode(record.Data, &result); e != nil {
					return e
				}
				observation, e := observationID(record)
				if e != nil {
					return e
				}
				entry, _ := wire.Encode([]string{result.Created.UTC().Format(time.RFC3339Nano), observation})
				if string(entry) != k || result.Cell() != tuple[1] || result.Created.UTC().Format("2006-01") != tuple[2] {
					return wire.Invalid("history posting binding differs")
				}
				return markRecord("", id)
			})
		case "session-plan-scope":
			return markMap(set.Root, "posting-session-plan-scope", func(session, id string) error {
				var projection indexedPlanScope
				if e := read(id, &projection); e != nil {
					return e
				}
				var job wire.Job
				if e := read(projection.SourceJob, &job); e != nil {
					return e
				}
				if projection.Schema != 1 || projection.Session != session || job.Session != session || job.SessionPlan == nil || projection.Plan != job.Plan || projection.ConfiguredHarnessPin != job.ConfiguredHarnessPin || tuple[1] != "" || tuple[2] != "" {
					return wire.Invalid("invalid indexed session plan binding")
				}
				scope, e := plans.verify(job)
				if e != nil {
					return e
				}
				checkSet := func(set indexSet, expected []string, kind string) error {
					if set.Count != len(expected) || !wire.IsHash(set.Root) {
						return wire.Invalid("session plan membership count differs")
					}
					binding := "plan-membership:" + kind + ":" + projection.Plan + ":" + set.Root
					if !visited[binding] {
						remaining := map[string]bool{}
						for _, v := range expected {
							remaining[v] = true
						}
						budget := ScanLimit
						e := s.walk(set.Root, &budget, func(k, v string) error {
							if e := ctx.Err(); e != nil {
								return e
							}
							if v != "1" || !remaining[k] {
								return wire.Invalid("session plan membership differs")
							}
							delete(remaining, k)
							return nil
						})
						if e != nil {
							return e
						}
						if len(remaining) != 0 {
							return wire.Invalid("session plan membership missing")
						}
						visited[binding] = true
					}
					return markMap(set.Root, "plan-membership-pages", func(_, _ string) error { return nil })
				}
				if e := checkSet(projection.Members, scope.Members, "members"); e != nil {
					return e
				}
				return checkSet(projection.Corpora, scope.Corpora, "corpora")
			})
		case "session-plan":
			return markMap(set.Root, "posting-session-plan", func(k, id string) error {
				var job wire.Job
				if e := read(id, &job); e != nil {
					return e
				}
				if job.Session != k || job.SessionPlan == nil || tuple[1] != "" || tuple[2] != "" {
					return wire.Invalid("invalid session plan reference")
				}
				_, e := plans.verify(job)
				return e
			})
		case "session-jobs", "published-job":
			newest, e := postingOrigins.newest(set.Root)
			if e != nil {
				return e
			}
			if newest < revisionRank {
				return wire.Invalid("job posting is newer than frozen revision")
			}
			return markMap(set.Root, "posting-"+tuple[0], func(k, id string) error {
				var summary PublishedJob
				if e := read(id, &summary); e != nil {
					return e
				}
				var job wire.Job
				if e := read(summary.ID, &job); e != nil {
					return e
				}
				if e := job.Validate(); e != nil {
					return e
				}
				actual := jobSummary(job, summary.ID, summary.PublishedAt)
				a, _ := wire.Encode(actual)
				b, _ := wire.Encode(summary)
				if string(a) != string(b) || tuple[0] == "session-jobs" && (summary.Session != tuple[1] || publishedJobKey(summary) != k) || tuple[0] == "published-job" && (summary.ID != k || tuple[1] != "" || tuple[2] != "") {
					return wire.Invalid("session job summary differs from source")
				}
				return nil
			})
		case "cells":
			return markMap(set.Root, "posting-cell", func(_, _ string) error { return nil })
		default:
			return fmt.Errorf("unsupported index type")
		}
	}
	jobs := map[string]bool{}
	for _, id := range s.Revisions() {
		if e := ctx.Err(); e != nil {
			return nil, e
		}
		revisionRank = revisionRanks[id]
		var r Revision
		if e := read(id, &r); e != nil {
			return nil, e
		}
		if r.HistoryIndexVersion != "" && r.HistoryIndexVersion != HistoryIndexVersion {
			return nil, wire.Invalid("unsupported history index")
		}
		if r.SessionIndexVersion != "" && r.SessionIndexVersion != SessionIndexVersion {
			return nil, wire.Invalid("unsupported session index")
		}
		newest, e := postingOrigins.newestDirectory(r.Indexes)
		if e != nil {
			return nil, e
		}
		if newest < revisionRank {
			return nil, wire.Invalid("job posting is newer than frozen revision")
		}
		if e := markMap(r.Catalog, "catalog", markRecord); e != nil {
			return nil, e
		}
		if e := markMap(r.Selection, "selection", markSelection); e != nil {
			return nil, e
		}
		for _, planKind := range []string{"session-plan", "session-plan-scope"} {
			planSet, e := s.indexGet(r.Indexes, indexKey(planKind, "", ""))
			if e != nil {
				return nil, e
			}
			if planSet.Count > 0 {
				published, e := s.indexGet(r.Indexes, indexKey("published-job", "", ""))
				if e != nil {
					return nil, e
				}
				referenceKey := "session-plan-publications:" + planKind + ":" + planSet.Root + ":" + published.Root
				if !visited[referenceKey] {
					budget := ScanLimit
					e := s.walk(planSet.Root, &budget, func(session, jobID string) error {
						if e := ctx.Err(); e != nil {
							return e
						}
						if planKind == "session-plan-scope" {
							var projection indexedPlanScope
							if e := read(jobID, &projection); e != nil {
								return e
							}
							jobID = projection.SourceJob
						}
						summaryID, e := s.mapGet(published.Root, jobID)
						if e != nil {
							return e
						}
						if summaryID == "" {
							return wire.Invalid("session plan source is unpublished")
						}
						var summary PublishedJob
						if e := read(summaryID, &summary); e != nil {
							return e
						}
						if summary.ID != jobID || summary.Session != session {
							return wire.Invalid("session plan publication binding differs")
						}
						return nil
					})
					if e != nil {
						return nil, e
					}
					visited[referenceKey] = true
				}
			}
		}
		if e := markMap(r.Indexes, "indexes", markIndexes); e != nil {
			return nil, e
		}
		if r.Observations != "" {
			if r.ObservationPolicy != "source-summary-v1" && r.ObservationPolicy != previousObservationPolicy && r.ObservationPolicy != ObservationPolicy {
				return nil, fmt.Errorf("unsupported observation policy")
			}
			if e := markMap(r.Observations, "observations", func(id, result string) error {
				record, e := s.record(r.Catalog, "result", result)
				if e != nil {
					return e
				}
				actual, e := observationIdentity(record, r.ObservationPolicy)
				if e != nil {
					return e
				}
				if actual != id {
					legacy, e := observationID(record)
					if e != nil {
						return e
					}
					if legacy != id {
						if r.ObservationPolicy != ObservationPolicy {
							return fmt.Errorf("observation identity differs")
						}
						proofID, e := s.mapGet(r.SourceBindings, legacy)
						if e != nil {
							return e
						}
						if proofID == "" {
							return fmt.Errorf("missing source binding proof")
						}
						proof, e := s.record(r.Catalog, "result", proofID)
						if e != nil {
							return e
						}
						if e := compatibleSourceProof(record, proof); e != nil {
							return e
						}
						bound, e := observationIdentity(proof, ObservationPolicy)
						if e != nil || bound != id {
							return fmt.Errorf("observation source binding differs")
						}
					} else if r.ObservationPolicy != ObservationPolicy && r.ObservationPolicy != previousObservationPolicy {
						return fmt.Errorf("observation identity differs")
					}
				}
				return nil
			}); e != nil {
				return nil, e
			}
		}
		if r.SourceBindings != "" {
			if r.ObservationPolicy != ObservationPolicy {
				return nil, wire.Invalid("unexpected source bindings")
			}
			if e := markMap(r.SourceBindings, "source-bindings", func(legacy, result string) error {
				record, e := s.record(r.Catalog, "result", result)
				if e != nil {
					return e
				}
				actual, e := observationID(record)
				if e != nil || actual != legacy {
					return fmt.Errorf("source proof report binding differs")
				}
				var value wire.Result
				if e = wire.Decode(record.Data, &value); e != nil {
					return e
				}
				if value.SamplingGroup == nil {
					return fmt.Errorf("source proof lacks sampling provenance")
				}
				if e = value.ValidateMethod(); e != nil {
					return e
				}
				shared, e := observationIdentity(record, ObservationPolicy)
				if e != nil {
					return e
				}
				preferred, e := s.mapGet(r.Observations, shared)
				if e != nil {
					return e
				}
				if preferred == "" {
					return fmt.Errorf("source proof lacks preferred representation")
				}
				return nil
			}); e != nil {
				return nil, e
			}
		}
		var job wire.Job
		if e := read(r.Job, &job); e != nil {
			return nil, e
		}
		if e := job.Validate(); e != nil {
			return nil, e
		}
		if e := s.checkRegisteredJob(job); e != nil {
			return nil, e
		}
		scope, e := s.sessionPlanScopeWithVerifier(ctx, r, job.Session, &plans)
		if e != nil {
			return nil, e
		}
		if scope != nil {
			contains, e := scope.Contains(job.Machine, job.Corpus)
			if e != nil {
				return nil, e
			}
			if scope.Plan != job.Plan || scope.ConfiguredHarnessPin != job.ConfiguredHarnessPin || !contains {
				return nil, wire.Invalid("recovered job outside published session plan")
			}
		}
		if job.SessionPlan != nil {
			if _, e := plans.verify(job); e != nil {
				return nil, e
			}
		}
		if job.ParentArchive != nil {
			if e := archives.verify(job); e != nil {
				return nil, e
			}
		}
		jobs[r.Job] = true
		conformanceRecords := map[string]wire.Record{}
		conformanceBinaries := map[string]wire.Object{}
		historyRecords := map[string]wire.Record{}
		wantedHistory := map[string]bool{}
		wantedHistoryReports := map[string]bool{}
		for _, h := range job.History {
			wantedHistory[h.ReportID+":"+h.ConfigurationID] = true
			wantedHistoryReports[h.ReportID] = true
		}
		for _, export := range job.Exports {
			payload, e := s.manifestObjectsContext(ctx, export.Manifest, false)
			if e != nil {
				return nil, e
			}
			for _, page := range export.Manifest.InventoryPages {
				payload = append(payload, page.Object())
			}
			for _, object := range payload {
				if e := ctx.Err(); e != nil {
					return nil, e
				}
				b, e := fetchProofObject(object)
				if e != nil {
					return nil, e
				}
				if len(b) != object.Bytes {
					return nil, fmt.Errorf("content size differs")
				}
				marked[object.SHA256] = true
				if job.Kind == "conformance" {
					if object.Kind == "binary" {
						conformanceBinaries[object.SHA256] = object
					}
					if object.Kind == "record" {
						var record wire.Record
						if e := wire.Decode(b, &record); e != nil {
							return nil, e
						}
						if !wire.IsConformanceKind(record.Kind) || wire.Hash(record.Data) != record.ID {
							return nil, wire.Invalid("invalid portable conformance record")
						}
						conformanceRecords[record.Kind+":"+record.ID] = record
					}
				}
				if len(wantedHistory) > 0 && object.Kind == "record" {
					var record wire.Record
					if e := wire.Decode(b, &record); e != nil {
						return nil, e
					}
					if record.Kind == "report" && wantedHistoryReports[record.ID] {
						historyRecords["report:"+record.ID] = record
					}
					if record.Kind == "result" {
						var result wire.Result
						if e := wire.Decode(record.Data, &result); e != nil {
							return nil, e
						}
						k := result.ReportID + ":" + result.ConfigurationID
						if wantedHistory[k] {
							historyRecords[k] = record
						}
					}
				}
			}
		}
		if e := s.validateConformance(ctx, job, conformanceRecords, conformanceBinaries); e != nil {
			return nil, e
		}
		if e := s.validateHistoryBindings(ctx, job, historyRecords); e != nil {
			return nil, e
		}
	}
	if e := s.markOverviews(ctx, marked); e != nil {
		return nil, e
	}
	if required == nil {
		if e := s.markRegistrations(ctx, marked, includeStaging); e != nil {
			return nil, e
		}
	} else {
		if e := s.markRegistrations(ctx, marked, false); e != nil {
			return nil, e
		}
		for id, value := range marked {
			if e := ctx.Err(); e != nil {
				return nil, e
			}
			required[id] = value
		}
		if includeStaging {
			if e := s.markRegistrations(ctx, marked, true); e != nil {
				return nil, e
			}
		}
	}
	if includeStaging {
		prefix := key("import")
		it, e := s.db.NewIter(nil)
		if e != nil {
			return nil, e
		}
		defer it.Close()
		for it.SeekGE(prefix); it.Valid() && bytes.HasPrefix(it.Key(), prefix); it.Next() {
			if e := ctx.Err(); e != nil {
				return nil, e
			}
			var job wire.Job
			if e = wire.Decode(it.Value(), &job); e != nil {
				return nil, e
			}
			id := wire.Hash(it.Value())
			if jobs[id] {
				continue
			}
			if _, e = s.get(key("aborted", id)); e == nil {
				continue
			} else if !errors.Is(e, pebble.ErrNotFound) {
				return nil, e
			}
			if job.SessionPlan != nil {
				for _, o := range job.SessionPlan.Chunks {
					marked[o.SHA256] = true
					if _, e := fetchProofObject(o); e != nil && !os.IsNotExist(e) {
						return nil, e
					}
				}
			}
			if job.ParentArchive != nil {
				for _, o := range job.ParentArchive.Objects() {
					marked[o.SHA256] = true
					_, e := fetchProofObject(o)
					if e != nil && !os.IsNotExist(e) {
						return nil, e
					}
				}
			}
			for _, export := range job.Exports {
				payload, e := s.manifestObjectsContext(ctx, export.Manifest, true)
				if e != nil {
					return nil, e
				}
				for _, page := range export.Manifest.InventoryPages {
					payload = append(payload, page.Object())
				}
				for _, object := range payload {
					if e := ctx.Err(); e != nil {
						return nil, e
					}
					marked[object.SHA256] = true
					b, e := fetchProofObject(object)
					if os.IsNotExist(e) {
						continue
					}
					if e != nil {
						return nil, e
					}
					if len(b) != object.Bytes {
						return nil, fmt.Errorf("staged content size differs")
					}
					marked[object.SHA256] = true
				}
			}
		}
		if e = it.Error(); e != nil {
			return nil, e
		}
	}
	return marked, nil
}
func validateNode(n node) error {
	if (n.Children != nil) == (n.Entries != nil) {
		return fmt.Errorf("invalid radix node shape")
	}
	if len(n.Entries) > 32 || len(n.Children) > 16 {
		return fmt.Errorf("radix node exceeds fanout")
	}
	if len(n.Entries) == 0 && len(n.Children) == 0 {
		return fmt.Errorf("empty radix node")
	}
	for prefix, id := range n.Children {
		if len(prefix) != 1 || !bytes.ContainsRune([]byte("0123456789abcdef"), rune(prefix[0])) || !wire.IsHash(id) {
			return fmt.Errorf("invalid radix branch")
		}
	}
	return nil
}

// Rebuild a brand-new database using only the acknowledged portable pointer and
// immutable content. Source directories are never modified or silently reused.
func Rebuild(source, destination, publisher string) error {
	return RebuildWithLimits(source, destination, publisher, DefaultLimits())
}

// Recovery preserves already published jobs without re-admitting them as staged
// uploads. Content storage remains bounded by the operator's recovery limits.
func RebuildWithLimits(source, destination, publisher string, limits Limits) error {
	if err := validateLimits(limits); err != nil {
		return err
	}
	if _, e := os.Lstat(destination); e == nil {
		return fmt.Errorf("destination already exists")
	} else if !os.IsNotExist(e) {
		return e
	}
	fs, e := os.OpenRoot(source)
	if e != nil {
		return e
	}
	defer fs.Close()
	b, e := readRegular(fs, "published.json", 4096)
	if e != nil {
		return e
	}
	var pointer portablePointer
	if e = wire.Decode(b, &pointer); e != nil {
		return e
	}
	if pointer.Schema != 1 || pointer.Current != "" && !wire.IsHash(pointer.Current) || pointer.Registrations != "" && !wire.IsHash(pointer.Registrations) || pointer.Overviews != "" && !wire.IsHash(pointer.Overviews) {
		return fmt.Errorf("invalid publication pointer")
	}
	objects, e := os.OpenRoot(filepath.Join(source, "objects"))
	if e != nil {
		return e
	}
	defer objects.Close()
	reader := &Store{root: source, objects: objects, published: map[string]Revision{}, registrations: pointer.Registrations, overviews: pointer.Overviews}
	chain := []string{}
	for id := pointer.Current; id != ""; {
		if len(chain) >= 1000000 {
			return ErrLimit
		}
		var r Revision
		if e = reader.load(id, &r); e != nil {
			return e
		}
		if r.Parent != "" && !wire.IsHash(r.Parent) {
			return fmt.Errorf("invalid parent revision")
		}
		reader.published[id] = r
		chain = append(chain, id)
		id = r.Parent
	}
	reader.current = pointer.Current
	marked, e := reader.reachable(false)
	if e != nil {
		return e
	}
	parent := filepath.Dir(destination)
	temp, e := os.MkdirTemp(parent, ".rebuild-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(temp)
	target, e := OpenWithLimits(temp, publisher, limits)
	if e != nil {
		return e
	}
	closed := false
	defer func() {
		if !closed {
			target.Close()
		}
	}()
	ids := make([]string, 0, len(marked))
	for id := range marked {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		b, e := reader.representation(id, wire.BlobBytes)
		if e != nil {
			return e
		}
		if e = target.installRepresentation(id, b, wire.BlobBytes); e != nil {
			return e
		}
	}
	// Reconstruct bindings and receipts from immutable canonical job records.
	for i := len(chain) - 1; i >= 0; i-- {
		id := chain[i]
		rev := reader.published[id]
		var job wire.Job
		if e = reader.load(rev.Job, &job); e != nil {
			return e
		}
		jobID := rev.Job
		rb, e := wire.Encode(rev)
		if e != nil {
			return e
		}
		batch := target.db.NewBatch()
		if e = target.restorePublishedJob(batch, jobID, job); e != nil {
			batch.Close()
			return e
		}
		for _, entry := range []struct{ k, v []byte }{{key("revision", id), rb}, {key("accepted", rev.Job), []byte(id)}, {key("current"), []byte(id)}} {
			if e = batch.Set(entry.k, entry.v, nil); e != nil {
				batch.Close()
				return e
			}
		}
		e = batch.Commit(pebble.Sync)
		batch.Close()
		if e != nil {
			return e
		}
	}
	if pointer.Registrations != "" {
		if e = target.restoreRegistrations(reader, pointer.Registrations); e != nil {
			return e
		}
	}
	if pointer.Overviews != "" {
		if e = target.db.Set(key("overviews"), []byte(pointer.Overviews), pebble.Sync); e != nil {
			return e
		}
		target.overviews = pointer.Overviews
	}
	if e = target.portable(pointer.Current); e != nil {
		return e
	}
	if e = target.Close(); e != nil {
		return e
	}
	closed = true
	// Preserve the cursor key only when it is a regular private file.
	if info, e := fs.Lstat("cursor.key"); e == nil {
		if !info.Mode().IsRegular() || info.Size() != 32 {
			return fmt.Errorf("invalid cursor key")
		}
		b, e := readRegular(fs, "cursor.key", 32)
		if e != nil {
			return e
		}
		if e = atomicFile(filepath.Join(temp, "cursor.key"), b, 0600); e != nil {
			return e
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	if e = installDirectory(temp, destination); e != nil {
		return e
	}
	return syncDir(parent)
}

func verifyPortable(source string) error {
	fs, e := os.OpenRoot(source)
	if e != nil {
		return e
	}
	defer fs.Close()
	b, e := readRegular(fs, "published.json", 4096)
	if e != nil {
		return e
	}
	var pointer portablePointer
	if e = wire.Decode(b, &pointer); e != nil {
		return e
	}
	if pointer.Schema != 1 || pointer.Current != "" && !wire.IsHash(pointer.Current) || pointer.Registrations != "" && !wire.IsHash(pointer.Registrations) || pointer.Overviews != "" && !wire.IsHash(pointer.Overviews) {
		return fmt.Errorf("invalid portable pointer")
	}
	objects, e := os.OpenRoot(filepath.Join(source, "objects"))
	if e != nil {
		return e
	}
	defer objects.Close()
	reader := &Store{root: source, objects: objects, published: map[string]Revision{}, current: pointer.Current, registrations: pointer.Registrations, overviews: pointer.Overviews}
	for id := pointer.Current; id != ""; {
		if _, seen := reader.published[id]; seen {
			return fmt.Errorf("portable revision cycle")
		}
		if len(reader.published) >= 1000000 {
			return ErrLimit
		}
		var r Revision
		if e = reader.load(id, &r); e != nil {
			return e
		}
		if !wire.IsHash(r.Job) || !wire.IsHash(r.Catalog) || r.Selection != "" && !wire.IsHash(r.Selection) || r.Parent != "" && !wire.IsHash(r.Parent) || r.Observations != "" && !wire.IsHash(r.Observations) || r.SourceBindings != "" && !wire.IsHash(r.SourceBindings) {
			return fmt.Errorf("invalid portable revision")
		}
		if e = reader.validateSelectionRoot(r); e != nil {
			return e
		}
		reader.published[id] = r
		id = r.Parent
	}
	_, e = reader.reachable(false)
	return e
}
