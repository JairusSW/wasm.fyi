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
	// Provenance enrichment has less evidence than the selected representation.
	// Its proof must survive independently without replacing the native record.
	proofJob, proofObjects, err := testutil.Fixture("capture", date)
	if err != nil {
		t.Fatal(err)
	}
	proofJob.Attempt = "source-proof-only"
	proofManifest := &proofJob.Exports[0].Manifest
	for i, object := range proofManifest.Objects {
		if object.Kind != "record" {
			continue
		}
		var record wire.Record
		_ = wire.Decode(proofObjects[object.SHA256], &record)
		if record.Kind != "result" {
			continue
		}
		var value wire.Result
		_ = wire.Decode(record.Data, &value)
		if value.Metric != "native.code_size" {
			continue
		}
		group := wire.SamplingGroup{Schema: 1, PassID: "same-code-source", CapturedAt: date, Runtime: value.Runtime, Workload: value.Workload, Scenario: value.Scenario, Profile: value.Profile, ManifestSHA256: wire.Hash([]byte("source-manifest")), TrialsSHA256: wire.Hash([]byte("source-trials")), TrialCount: 1}
		group.ID = group.Digest()
		value.SamplingGroup = &group
		value.Evidence = nil
		record.Data, _ = wire.Encode(value)
		record.ID = wire.Hash(record.Data)
		b, _ := wire.Encode(record)
		delete(proofObjects, object.SHA256)
		object.SHA256, object.Bytes = wire.Hash(b), len(b)
		proofObjects[object.SHA256] = b
		proofManifest.Objects[i] = object
	}
	b, _ = wire.Encode(proofManifest)
	proofJob.Exports[0].SHA256 = wire.Hash(b)
	for hash, b := range proofObjects {
		if err = s.Install(hash, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	proofID, err := s.Submit(proofJob)
	if err != nil {
		t.Fatal(err)
	}
	revision, err = s.Commit(proofID)
	if err != nil {
		t.Fatal(err)
	}
	rows, err = s.Results(Query{Revision: revision}, true)
	if err != nil || len(rows) != 6 {
		t.Fatal("proof split full history", len(rows), err)
	}
	window, err := s.Results(Query{Revision: revision, From: date.Format(time.RFC3339), Until: date.Add(2 * time.Hour).Format(time.RFC3339)}, true)
	if err != nil || len(window) != 6 {
		t.Fatal("proof split window history", len(window), err)
	}
	found = false
	for _, row := range rows {
		if row.ID == newCode {
			var value wire.Result
			_ = wire.Decode(row.Data, &value)
			if value.SamplingGroup == nil {
				t.Fatal("selected evidence lost source proof")
			}
			found = true
		}
	}
	if !found {
		t.Fatal("source proof downgraded selected evidence")
	}
	rev, err := s.Revision(revision)
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := s.record(rev.Catalog, "result", newCode)
	if err != nil {
		t.Fatal(err)
	}
	var unchanged wire.Result
	_ = wire.Decode(canonical.Data, &unchanged)
	if unchanged.SamplingGroup != nil || len(unchanged.Evidence) != 1 || wire.Hash(canonical.Data) != canonical.ID {
		t.Fatal("enrichment rewrote canonical bytes")
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
	// A conflicting producer attestation must leave the published revision intact.
	jobBytes, _ := wire.Encode(proofJob)
	var conflicting wire.Job
	_ = wire.Decode(jobBytes, &conflicting)
	conflicting.Attempt = "conflicting-source-proof"
	conflictObjects := map[string][]byte{}
	for hash, b := range proofObjects {
		conflictObjects[hash] = b
	}
	for i, object := range conflicting.Exports[0].Manifest.Objects {
		if object.Kind != "record" {
			continue
		}
		var record wire.Record
		_ = wire.Decode(conflictObjects[object.SHA256], &record)
		if record.Kind != "result" {
			continue
		}
		var value wire.Result
		_ = wire.Decode(record.Data, &value)
		if value.SamplingGroup == nil {
			continue
		}
		value.SamplingGroup.PassID = "conflicting-source"
		value.SamplingGroup.ID = value.SamplingGroup.Digest()
		record.Data, _ = wire.Encode(value)
		record.ID = wire.Hash(record.Data)
		b, _ := wire.Encode(record)
		delete(conflictObjects, object.SHA256)
		object.SHA256, object.Bytes = wire.Hash(b), len(b)
		conflictObjects[object.SHA256] = b
		conflicting.Exports[0].Manifest.Objects[i] = object
	}
	jobBytes, _ = wire.Encode(conflicting.Exports[0].Manifest)
	conflicting.Exports[0].SHA256 = wire.Hash(jobBytes)
	for hash, b := range conflictObjects {
		if err = s.Install(hash, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	conflictID, err := s.Submit(conflicting)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Commit(conflictID); err == nil {
		t.Fatal("conflicting source proof published")
	}
	if s.Current() != revision {
		t.Fatal("conflicting proof changed current revision")
	}
	if err = s.Abort(conflictID); err != nil {
		t.Fatal(err)
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
	found = false
	for _, row := range rows {
		if row.ID == newCode {
			var value wire.Result
			if err := wire.Decode(row.Data, &value); err != nil {
				t.Fatal(err)
			}
			if value.SamplingGroup == nil || value.SamplingGroup.PassID != "same-code-source" {
				t.Fatal("rebuild lost independent source proof")
			}
			found = true
		}
	}
	if !found {
		t.Fatal("rebuild downgraded native evidence")
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
	t.Run("unindexed", func(t *testing.T) { testLegacyObservationMigration(t, "") })
	t.Run("v1-indexed", func(t *testing.T) { testLegacyObservationMigration(t, "source-summary-v1") })
	t.Run("v2-indexed", func(t *testing.T) { testLegacyObservationMigration(t, previousObservationPolicy) })
}

func testLegacyObservationMigration(t *testing.T, policy string) {
	root := t.TempDir()
	s := openTest(t, root)
	date := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	current := publishTest(t, s, "legacy-capture", date)
	revision, err := s.Revision(current)
	if err != nil {
		t.Fatal(err)
	}
	revision.ObservationPolicy = policy
	if policy == "" {
		revision.Observations = ""
		revision.ObservationPolicy = ""
	}
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
	if result.Observations == "" || result.ObservationPolicy != ObservationPolicy {
		t.Fatal("did not index legacy observations")
	}
	rows, err := s.Results(Query{Revision: upgraded}, true)
	if err != nil || len(rows) != 6 {
		t.Fatal("migration lost legacy history", len(rows), err)
	}
	old, err := s.Revision(legacy)
	if err != nil || old.Observations != revision.Observations || old.ObservationPolicy != revision.ObservationPolicy {
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

// Independent source populations are distinct even when their summaries and
// block numbers coincide. Rebuilding the exact same capture in another report
// must not advance the previous-measurement selection.
func TestCrossReportSamplingPreservesHistoryAndPrevious(t *testing.T) {
	dir := t.TempDir()
	s := openTest(t, filepath.Join(dir, "live"))
	date := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	publish := func(report, pass string, captured time.Time) string {
		t.Helper()
		job, objects, err := testutil.Fixture(report, captured)
		if err != nil {
			t.Fatal(err)
		}
		manifest := &job.Exports[0].Manifest
		for i, object := range manifest.Objects {
			if object.Kind != "record" {
				continue
			}
			var record wire.Record
			if err := wire.Decode(objects[object.SHA256], &record); err != nil {
				t.Fatal(err)
			}
			if record.Kind != "result" {
				continue
			}
			var result wire.Result
			if err := wire.Decode(record.Data, &result); err != nil {
				t.Fatal(err)
			}
			group := wire.SamplingGroup{Schema: 1, PassID: pass, CapturedAt: captured, Runtime: result.Runtime, Workload: result.Workload, Scenario: result.Scenario, Profile: result.Profile, ManifestSHA256: wire.Hash([]byte(pass)), TrialsSHA256: wire.Hash([]byte(pass + result.Metric)), TrialCount: 1}
			group.ID = group.Digest()
			result.SamplingGroup = &group
			record.Data, _ = wire.Encode(result)
			record.ID = wire.Hash(record.Data)
			b, _ := wire.Encode(record)
			delete(objects, object.SHA256)
			object.SHA256, object.Bytes = wire.Hash(b), len(b)
			objects[object.SHA256] = b
			manifest.Objects[i] = object
		}
		b, _ := wire.Encode(manifest)
		job.Exports[0].SHA256 = wire.Hash(b)
		for hash, b := range objects {
			if err := s.Install(hash, bytes.NewReader(b)); err != nil {
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
		return revision
	}
	first := publish("first-report", "source-one", date)
	second := publish("second-report", "source-two", date.Add(time.Hour))
	rebuilt := publish("rebuilt-report", "source-one", date)
	check := func(s *Store, revision string, count int) {
		t.Helper()
		rows, err := s.Results(Query{Revision: revision}, true)
		if err != nil || len(rows) != count {
			t.Fatalf("history: %d want %d: %v", len(rows), count, err)
		}
		window, err := s.Results(Query{Revision: revision, From: date.Format(time.RFC3339), Until: date.Add(2 * time.Hour).Format(time.RFC3339)}, true)
		if err != nil || len(window) != count {
			t.Fatalf("window: %d want %d: %v", len(window), count, err)
		}
	}
	check(s, first, 3)
	check(s, second, 6)
	check(s, rebuilt, 6)
	previous, err := s.Results(Query{Revision: rebuilt, Selection: "previous"}, false)
	if err != nil || len(previous) != 3 {
		t.Fatal("previous population", len(previous), err)
	}
	for _, r := range previous {
		var value wire.Result
		_ = wire.Decode(r.Data, &value)
		if value.SamplingGroup.PassID != "source-one" {
			t.Fatal("previous became repeated publication")
		}
	}
	// Exercise an old report-scoped map with a duplicated current/previous pair.
	legacy, err := s.Revision(rebuilt)
	if err != nil {
		t.Fatal(err)
	}
	legacy.Observations = ""
	legacy.ObservationPolicy = "source-summary-v1"
	budget := ScanLimit
	if err = s.walk(legacy.Catalog, &budget, func(_, digest string) error {
		var record wire.Record
		if err := s.load(digest, &record); err != nil {
			return err
		}
		if record.Kind != "result" {
			return nil
		}
		_, err := s.registerObservation(&legacy, record)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	rows, err := s.Results(Query{Revision: rebuilt}, true)
	if err != nil {
		t.Fatal(err)
	}
	var duplicate wire.Result
	var duplicateID string
	for _, row := range rows {
		var v wire.Result
		_ = wire.Decode(row.Data, &v)
		if v.SamplingGroup.PassID == "source-one" {
			duplicate, duplicateID = v, row.ID
			break
		}
	}
	cellDigest, err := s.mapGet(legacy.Selection, duplicate.Cell())
	if err != nil {
		t.Fatal(err)
	}
	var oldCell cell
	if err = s.load(cellDigest, &oldCell); err != nil {
		t.Fatal(err)
	}
	oldCell.Current, oldCell.Previous = duplicateID, duplicateID
	cellDigest, err = s.put(oldCell)
	if err != nil {
		t.Fatal(err)
	}
	legacy.Selection, err = s.mapSet(legacy.Selection, duplicate.Cell(), cellDigest, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.upgradeObservations(context.Background(), &legacy); err != nil {
		t.Fatal(err)
	}
	cellDigest, err = s.mapGet(legacy.Selection, duplicate.Cell())
	if err != nil {
		t.Fatal(err)
	}
	if err = s.load(cellDigest, &oldCell); err != nil {
		t.Fatal(err)
	}
	if oldCell.Current == oldCell.Previous || oldCell.Previous == "" {
		t.Fatal("migration lost earlier distinct capture")
	}
	for _, choice := range []struct{ id, pass string }{{oldCell.Current, "source-two"}, {oldCell.Previous, "source-one"}} {
		record, err := s.record(legacy.Catalog, "result", choice.id)
		if err != nil {
			t.Fatal(err)
		}
		var value wire.Result
		_ = wire.Decode(record.Data, &value)
		if value.SamplingGroup.PassID != choice.pass {
			t.Fatal("migration did not recover newest distinct captures")
		}
	}
	// Frozen revisions and portable reconstruction retain the policy and aliases.
	backup := filepath.Join(dir, "backup")
	if _, err = s.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s = openTest(t, filepath.Join(dir, "live"))
	check(s, rebuilt, 6)
	s.Close()
	restored := filepath.Join(dir, "rebuilt")
	if err = Rebuild(backup, restored, "fixture"); err != nil {
		t.Fatal(err)
	}
	s = openTest(t, restored)
	defer s.Close()
	check(s, first, 3)
	check(s, rebuilt, 6)
}

func TestSourceSamplingIdentityRequiresExactScience(t *testing.T) {
	date := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	value := wire.Result{ReportID: wire.Hash([]byte("report")), Runtime: "engine", Workload: "fixture/a", Scenario: "steady", Profile: "timing", Created: date, Summary: json.RawMessage(`{"median_ns_per_operation":4}`)}
	group := wire.SamplingGroup{Schema: 1, PassID: "pass", CapturedAt: date, Runtime: value.Runtime, Workload: value.Workload, Scenario: value.Scenario, Profile: value.Profile, ManifestSHA256: wire.Hash([]byte("manifest")), TrialsSHA256: wire.Hash([]byte("trials")), TrialCount: 1}
	group.ID = group.Digest()
	value.SamplingGroup = &group
	record := func(v wire.Result) wire.Record {
		b, _ := wire.Encode(v)
		return wire.Record{Kind: "result", ID: wire.Hash(b), Data: b}
	}
	original, err := observationIdentity(record(value), ObservationPolicy)
	if err != nil {
		t.Fatal(err)
	}
	rebuilt := value
	rebuilt.ReportID = wire.Hash([]byte("other report"))
	shared, err := observationIdentity(record(rebuilt), ObservationPolicy)
	if err != nil || shared != original {
		t.Fatal("report rebuild became capture", err)
	}
	changes := []func(*wire.Result){
		func(v *wire.Result) { v.ConfigurationID = "other" },
		func(v *wire.Result) { v.ContractID = "other" },
		func(v *wire.Result) { v.MetricDefinitionID = "other" },
		func(v *wire.Result) { v.AnalysisVersion = "other" },
		func(v *wire.Result) { v.MeasurementMethodID = "other" },
		func(v *wire.Result) { v.Created = v.Created.Add(time.Hour) },
		func(v *wire.Result) { v.Summary = json.RawMessage(`{"median_ns_per_operation":5}`) },
		func(v *wire.Result) {
			g := *v.SamplingGroup
			g.PassID = "other"
			g.ID = g.Digest()
			v.SamplingGroup = &g
		},
	}
	for i, change := range changes {
		v := value
		change(&v)
		id, err := observationIdentity(record(v), ObservationPolicy)
		if err != nil || id == original {
			t.Fatal("distinct scientific identity collapsed", i, err)
		}
	}
	if _, err := observationIdentity(record(value), "unknown"); err == nil {
		t.Fatal("unknown observation policy accepted")
	}
}

func TestSourceProofRejectsScientificMismatch(t *testing.T) {
	date := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	value := wire.Result{ReportID: wire.Hash([]byte("report")), Runtime: "engine", Workload: "fixture/a", Scenario: "steady", Profile: "timing", Created: date, Summary: json.RawMessage(`{"median_ns_per_operation":4}`)}
	group := wire.SamplingGroup{Schema: 1, PassID: "pass", CapturedAt: date, Runtime: value.Runtime, Workload: value.Workload, Scenario: value.Scenario, Profile: value.Profile, ManifestSHA256: wire.Hash([]byte("manifest")), TrialsSHA256: wire.Hash([]byte("trials")), TrialCount: 1}
	group.ID = group.Digest()
	source := value
	source.SamplingGroup = &group
	record := func(v wire.Result) wire.Record {
		b, _ := wire.Encode(v)
		return wire.Record{Kind: "result", ID: wire.Hash(b), Data: b}
	}
	if err := compatibleSourceProof(record(value), record(source)); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*wire.Result){
		"report":     func(v *wire.Result) { v.ReportID = wire.Hash([]byte("other")) },
		"summary":    func(v *wire.Result) { v.Summary = json.RawMessage(`{"median_ns_per_operation":5}`) },
		"method":     func(v *wire.Result) { v.MeasurementMethodID = wire.Hash([]byte("other-method")) },
		"population": func(v *wire.Result) { g := group; g.PassID = "other-pass"; g.ID = g.Digest(); v.SamplingGroup = &g },
	} {
		t.Run(name, func(t *testing.T) {
			v := value
			change(&v)
			if err := compatibleSourceProof(record(v), record(source)); err == nil {
				t.Fatal("mismatched source proof accepted")
			}
		})
	}
	if err := compatibleSourceProof(record(value), record(value)); err == nil {
		t.Fatal("missing provenance accepted as proof")
	}
}
