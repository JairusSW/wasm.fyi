package store

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestOfflineMigrationDefersExistingEvidenceVerification(t *testing.T) {
	root := t.TempDir()
	s, err := Open(root, "retained-test")
	if err != nil {
		t.Fatal(err)
	}
	job, objects, _ := retainedFixture(t, "deferred", "retained-measurement", time.Now(), 1)
	var resultObject string
	for id, body := range objects {
		var record wire.Record
		if json.Unmarshal(body, &record) == nil && record.Kind == "result" {
			resultObject = id
		}
		if err := s.Install(id, bytes.NewReader(body)); err != nil {
			t.Fatal(err)
		}
	}
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Commit(id); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if resultObject == "" {
		t.Fatal("missing result fixture")
	}
	if err := os.WriteFile(filepath.Join(root, "objects", resultObject), []byte("corrupt evidence"), 0600); err != nil {
		t.Fatal(err)
	}
	offline, err := OpenForOfflineMigration(root, "retained-test", DefaultLimits())
	if err != nil {
		t.Fatalf("offline reopen scanned old evidence: %v", err)
	}
	if err := offline.Close(); err != nil {
		t.Fatal(err)
	}
	reader, err := OpenForReadOnlyServing(root, "retained-test", DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	if reader.offline {
		t.Fatal("read-only serving enabled offline installation")
	}
	if _, err := reader.content(resultObject); err == nil {
		t.Fatal("read-only serving accepted corrupt content on demand")
	}
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	if reader, err := Open(root, "retained-test"); err == nil {
		reader.Close()
		t.Fatal("ordinary serving reopen accepted corrupt evidence")
	}
}

func TestOfflineMigrationDefersExistingContentInventory(t *testing.T) {
	root := t.TempDir()
	s, err := Open(root, "retained-test")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	// An unexpected directory would be rejected by the full inventory. The
	// migration leaves that existing-content check to its final audit.
	if err := os.Mkdir(filepath.Join(root, "objects", "unexpected-directory"), 0700); err != nil {
		t.Fatal(err)
	}
	offline, err := OpenForOfflineMigration(root, "retained-test", DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	if err := offline.Close(); err != nil {
		t.Fatal(err)
	}
	if reader, err := Open(root, "retained-test"); err == nil {
		reader.Close()
		t.Fatal("ordinary serving reopen skipped the content inventory")
	}
}

func retainedFixture(t *testing.T, seed, kind string, date time.Time, value float64) (wire.Job, map[string][]byte, wire.Result) {
	t.Helper()
	job, objects, err := testutil.CohortFixture(seed, date, []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Group: "x", Value: value}})
	if err != nil {
		t.Fatal(err)
	}
	job.Schema = 3
	job.Kind = kind
	job.ConfiguredHarnessPin = ""
	job.ParentBundleSHA256 = ""
	job.ParentArchive = nil
	job.SessionPlan = nil
	manifest := &job.Exports[0].Manifest
	manifest.Format = "site-v2-retained"
	manifest.Verification = "retained-projection-integrity-checked"
	if manifest.ExporterIdentity != nil {
		manifest.ExporterIdentity.Format = manifest.Format
	}
	body, _ := wire.Encode(*manifest)
	job.Exports[0].SHA256 = wire.Hash(body)
	var result wire.Result
	for _, body := range objects {
		var record wire.Record
		if json.Unmarshal(body, &record) == nil && record.Kind == "result" {
			_ = json.Unmarshal(record.Data, &result)
		}
	}
	return job, objects, result
}
func TestRetainedHistoryDoesNotReplaceCurrentOrPrevious(t *testing.T) {
	s, err := Open(t.TempDir(), "retained-test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	s.EnableOfflineImport()
	var last wire.Result
	revision := ""
	for i, kind := range []string{"retained-measurement", "retained-measurement", "retained-history"} {
		job, objects, result := retainedFixture(t, string(rune('a'+i)), kind, time.Date(2026, 1, 1+i, 0, 0, 0, 0, time.UTC), float64(100+i*100))
		last = result
		for id, body := range objects {
			if err = s.Install(id, bytes.NewReader(body)); err != nil {
				t.Fatal(err)
			}
		}
		id, err := s.Submit(job)
		if err != nil {
			t.Fatal(err)
		}
		revision, err = s.Commit(id)
		if err != nil {
			t.Fatal(err)
		}
		summary := jobSummary(job, id, time.Now())
		if len(summary.Reports) != 1 {
			t.Fatal("retained reports missing from history membership index")
		}
	}
	q := Query{Revision: revision, Environment: last.EnvironmentID, Track: last.TrackID, Workload: last.Workload, Metric: last.Metric}
	for selection, want := range map[string]float64{"current": 200, "previous": 100} {
		q.Selection = selection
		rows, err := s.ResultsContext(context.Background(), q, false)
		if err != nil || len(rows) != 1 {
			t.Fatalf("%s: %v %d", selection, err, len(rows))
		}
		var value wire.Result
		_ = json.Unmarshal(rows[0].Data, &value)
		var summary map[string]float64
		_ = json.Unmarshal(value.Summary, &summary)
		if summary["median_ns_per_operation"] != want {
			t.Fatalf("%s promoted a retrospective capture", selection)
		}
	}
	q.Selection = ""
	history, err := s.ResultsContext(context.Background(), q, true)
	if err != nil || len(history) != 3 {
		t.Fatalf("lost archival observations: %v %d", err, len(history))
	}
}
func TestRetainedImportRejectsRecomputedVerificationClaim(t *testing.T) {
	job, _, _ := retainedFixture(t, "claim", "retained-measurement", time.Now(), 1)
	if err := job.Validate(); err != nil {
		t.Fatal(err)
	}
	job.Exports[0].Manifest.Verification = "source-recomputed"
	body, _ := wire.Encode(job.Exports[0].Manifest)
	job.Exports[0].SHA256 = wire.Hash(body)
	if job.Validate() == nil {
		t.Fatal("retained data promoted to independent recomputation")
	}
}
