package store

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestEvidenceRepresentationPreservesCapturesAndSelections(t *testing.T) {
	dir := t.TempDir()
	s := openTest(t, filepath.Join(dir, "live"))
	defer s.Close()
	date := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	old := publishTest(t, s, "capture", date)
	latest := publishTest(t, s, "later-capture", date.Add(time.Hour))
	job, objects, err := testutil.Fixture("capture", date)
	if err != nil {
		t.Fatal(err)
	}
	job.Attempt = "richer-evidence"
	evidence, _ := wire.Encode(map[string]any{"reportId": job.Exports[0].Manifest.ReportID, "passId": "code-pass", "trialId": "code-0", "profile": "code", "scenario": "compile"})
	digest := wire.Hash(evidence)
	objects[digest] = evidence
	manifest := &job.Exports[0].Manifest
	manifest.Objects = append(manifest.Objects, wire.Object{SHA256: digest, Bytes: len(evidence), Kind: "evidence"})
	oldCode, newCode := "", ""
	for i, object := range manifest.Objects {
		if object.Kind != "record" {
			continue
		}
		var record wire.Record
		_ = json.Unmarshal(objects[object.SHA256], &record)
		if record.Kind != "result" {
			continue
		}
		var result wire.Result
		_ = json.Unmarshal(record.Data, &result)
		if result.Metric != "native.code_size" {
			continue
		}
		oldCode = record.ID
		var raw map[string]json.RawMessage
		_ = json.Unmarshal(record.Data, &raw)
		raw["evidence"], _ = wire.Encode([]string{digest})
		record.Data, _ = wire.Encode(raw)
		record.ID = wire.Hash(record.Data)
		newCode = record.ID
		b, _ := wire.Encode(record)
		delete(objects, object.SHA256)
		object.SHA256, object.Bytes = wire.Hash(b), len(b)
		objects[object.SHA256] = b
		manifest.Objects[i] = object
	}
	if oldCode == "" || oldCode == newCode {
		t.Fatal("fixture did not change representation")
	}
	b, _ := wire.Encode(manifest)
	job.Exports[0].SHA256 = wire.Hash(b)
	for hash, b := range objects {
		if err = s.Install(hash, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	revision, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := s.Results(Query{Revision: revision}, true)
	if err != nil || len(rows) != 6 {
		t.Fatal("representation added an observation", len(rows), err)
	}
	found := false
	for _, row := range rows {
		if row.ID == newCode {
			found = true
		}
		if row.ID == oldCode {
			t.Fatal("history did not resolve richer evidence")
		}
	}
	if !found {
		t.Fatal("richer representation disappeared")
	}
	previous, err := s.Results(Query{Revision: revision, Selection: "previous"}, false)
	if err != nil || len(previous) != 3 {
		t.Fatal("previous selection changed population", err)
	}
	found = false
	for _, row := range previous {
		if row.ID == newCode {
			found = true
		}
	}
	if !found {
		t.Fatal("previous capture lost upgraded evidence")
	}
	for _, revision := range []string{old, latest} {
		rows, err = s.Results(Query{Revision: revision}, true)
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range rows {
			if row.ID == newCode {
				t.Fatal("modified an older immutable revision")
			}
		}
	}
	// Redelivering the poorer representation does not downgrade available evidence.
	plain, _, err := testutil.Fixture("capture", date)
	if err != nil {
		t.Fatal(err)
	}
	plain.Attempt = "old-representation-redelivery"
	plainID, err := s.Submit(plain)
	if err != nil {
		t.Fatal(err)
	}
	current, err := s.Commit(plainID)
	if err != nil {
		t.Fatal(err)
	}
	rows, err = s.Results(Query{Revision: current}, true)
	if err != nil || len(rows) != 6 {
		t.Fatal("redelivery duplicated history", err)
	}
	found = false
	for _, row := range rows {
		if row.ID == newCode {
			found = true
		}
	}
	if !found {
		t.Fatal("redelivery downgraded evidence")
	}
	backup := filepath.Join(dir, "backup")
	if _, err = s.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	rebuilt := filepath.Join(dir, "rebuilt")
	if err = Rebuild(backup, rebuilt, "fixture"); err != nil {
		t.Fatal(err)
	}
	r := openTest(t, rebuilt)
	defer r.Close()
	rows, err = r.Results(Query{Revision: current}, true)
	if err != nil || len(rows) != 6 {
		t.Fatal("rebuild lost observation identities", err)
	}
}

func TestScientificIdentityDoesNotCollapseDifferentResults(t *testing.T) {
	job, objects, err := testutil.Fixture("identity", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	_ = job
	var record wire.Record
	for _, b := range objects {
		var r wire.Record
		if json.Unmarshal(b, &r) == nil && r.Kind == "result" {
			record = r
			break
		}
	}
	original, err := observationID(record)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"configurationId", "contractId", "metricDefinitionId", "analysisVersion", "reportId", "summary"} {
		var raw map[string]json.RawMessage
		_ = json.Unmarshal(record.Data, &raw)
		if field == "summary" {
			raw[field] = json.RawMessage(`{"status":"different"}`)
		} else {
			raw[field], _ = wire.Encode("different")
		}
		changed := record
		changed.Data, _ = wire.Encode(raw)
		identity, err := observationID(changed)
		if err != nil || identity == original {
			t.Fatal("collapsed a distinct scientific identity", field, err)
		}
	}
}

func TestLegacyRevisionObservationIndexMigration(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	date := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	current := publishTest(t, s, "legacy-capture", date)
	revision, err := s.Revision(current)
	if err != nil {
		t.Fatal(err)
	}
	revision.Observations = ""
	revision.ObservationPolicy = ""
	legacy, err := s.put(revision)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := wire.Encode(revision)
	batch := s.db.NewBatch()
	if err = batch.Delete(key("revision", current), nil); err != nil {
		t.Fatal(err)
	}
	if err = batch.Set(key("revision", legacy), b, nil); err != nil {
		t.Fatal(err)
	}
	if err = batch.Set(key("current"), []byte(legacy), nil); err != nil {
		t.Fatal(err)
	}
	if err = batch.Set(key("accepted", revision.Job), []byte(legacy), nil); err != nil {
		t.Fatal(err)
	}
	if err = batch.Commit(nil); err != nil {
		t.Fatal(err)
	}
	batch.Close()
	if err = s.portable(legacy); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s = openTest(t, root)
	defer s.Close()
	upgraded := publishTest(t, s, "new-capture", date.Add(time.Hour))
	result, err := s.Revision(upgraded)
	if err != nil {
		t.Fatal(err)
	}
	if result.Observations == "" || result.ObservationPolicy != "source-summary-v1" {
		t.Fatal("did not index legacy observations")
	}
	rows, err := s.Results(Query{Revision: upgraded}, true)
	if err != nil || len(rows) != 6 {
		t.Fatal("migration lost legacy history", len(rows), err)
	}
	old, err := s.Revision(legacy)
	if err != nil || old.Observations != "" {
		t.Fatal("migration changed an immutable legacy revision", err)
	}
}

func TestSamplingProvenanceEnrichmentKeepsSameReportObservation(t *testing.T) {
	date := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	value := wire.Result{ReportID: wire.Hash([]byte("report")), Runtime: "engine", Workload: "fixture/a", Scenario: "steady", Profile: "timing", Created: date, Summary: json.RawMessage(`{"median_ns_per_operation":4}`)}
	raw, _ := wire.Encode(value)
	record := wire.Record{Kind: "result", ID: wire.Hash(raw), Data: raw}
	before, err := observationID(record)
	if err != nil {
		t.Fatal(err)
	}
	group := wire.SamplingGroup{Schema: 1, PassID: "pass", CapturedAt: date, Runtime: value.Runtime, Workload: value.Workload, Scenario: value.Scenario, Profile: value.Profile, ManifestSHA256: wire.Hash([]byte("manifest")), TrialsSHA256: wire.Hash([]byte("trials")), TrialCount: 1}
	group.ID = group.Digest()
	value.SamplingGroup = &group
	raw, _ = wire.Encode(value)
	record.ID = wire.Hash(raw)
	record.Data = raw
	after, err := observationID(record)
	if err != nil || before != after {
		t.Fatal("sampling provenance became a new measurement", err)
	}
}
