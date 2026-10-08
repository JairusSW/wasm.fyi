package store

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"strings"
	"testing"
	"time"
)

func publishHostFixture(t *testing.T, s *Store, seed, hostname, contextName string, date time.Time, failed bool) (string, string) {
	return publishHostSizedFixture(t, s, seed, hostname, contextName, date, failed, 1, 0)
}

func publishHostSizedFixture(t *testing.T, s *Store, seed, hostname, contextName string, date time.Time, failed bool, count, padding int) (string, string) {
	t.Helper()
	cells := []testutil.CohortCell{}
	for i := 0; i < count; i++ {
		workload := "fixture/one"
		if count != 1 {
			workload = fmt.Sprintf("fixture/%03d", i)
		}
		cells = append(cells, testutil.CohortCell{Runtime: "a", Workload: workload, Group: "x", Value: float64(date.Hour() + 1), Failed: failed})
	}
	job, objects, err := testutil.CohortFixture(seed, date, cells)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := wire.Encode(map[string]any{"os": "linux", "arch": "amd64", "hostname": hostname, "cpu_description": "fixture cpu", "environment": map[string]string{"collection_context": contextName}})
	environment := wire.Hash(data)
	manifest := &job.Exports[0].Manifest
	descriptors := manifest.Objects
	manifest.Objects = nil
	for _, object := range descriptors {
		body := objects[object.SHA256]
		if object.Kind == "record" {
			var record wire.Record
			if err = wire.Decode(body, &record); err != nil {
				t.Fatal(err)
			}
			if record.Kind == "environment" {
				record.ID = environment
				record.Data = data
			}
			if record.Kind == "result" {
				var value wire.Result
				_ = wire.Decode(record.Data, &value)
				value.EnvironmentID = environment
				if padding != 0 {
					var summary map[string]any
					if err = json.Unmarshal(value.Summary, &summary); err != nil {
						t.Fatal(err)
					}
					summary["fixture_padding"] = strings.Repeat("p", padding)
					value.Summary, _ = wire.Encode(summary)
				}
				record.Data, _ = wire.Encode(value)
				record.ID = wire.Hash(record.Data)
			}
			body, _ = wire.Encode(record)
		}
		object.SHA256 = wire.Hash(body)
		object.Bytes = len(body)
		objects[object.SHA256] = body
		manifest.Objects = append(manifest.Objects, object)
	}
	body, _ := wire.Encode(*manifest)
	job.Exports[0].SHA256 = wire.Hash(body)
	for _, object := range manifest.Objects {
		if err = s.Install(object.SHA256, bytes.NewReader(objects[object.SHA256])); err != nil {
			t.Fatal(err)
		}
	}
	if job.ParentArchive != nil {
		for _, object := range job.ParentArchive.Chunks {
			if err = s.Install(object.SHA256, bytes.NewReader(objects[object.SHA256])); err != nil {
				t.Fatal(err)
			}
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
	return revision, environment
}

func TestHostSelectionBoundsRetainedPopulationRatherThanDuplicateCandidates(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	s.EnableOfflineImport()
	date := time.Date(2026, 10, 5, 1, 0, 0, 0, time.UTC)
	_, first := publishHostSizedFixture(t, s, "large-one", "fixture-host", "one", date, false, 80, 220000)
	_, second := publishHostSizedFixture(t, s, "large-two", "fixture-host", "two", date.Add(time.Hour), false, 80, 220000)
	_, _ = publishHostSizedFixture(t, s, "large-three", "fixture-host", "one", date.Add(2*time.Hour), false, 80, 220000)
	revision, _ := publishHostSizedFixture(t, s, "large-four", "fixture-host", "two", date.Add(3*time.Hour), false, 80, 220000)
	for selection, created := range map[string]time.Time{"current": date.Add(3 * time.Hour), "previous": date.Add(2 * time.Hour)} {
		rows, err := s.ResultsContext(context.Background(), Query{Revision: revision, Environment: first, Environments: []string{first, second}, Selection: selection}, false)
		if err != nil || len(rows) != 80 {
			t.Fatalf("%s: rows=%d err=%v", selection, len(rows), err)
		}
		for _, record := range rows {
			var value wire.Result
			if err = wire.Decode(record.Data, &value); err != nil || !value.Created.Equal(created) {
				t.Fatalf("%s selected wrong observation: %v", selection, err)
			}
		}
	}
}

func TestExplicitHostSelectionPreservesPreviousAndFailedCurrent(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	date := time.Date(2026, 10, 5, 1, 0, 0, 0, time.UTC)
	_, first := publishHostFixture(t, s, "old", "fixture-host", "one", date, false)
	frozen, second := publishHostFixture(t, s, "mid", "fixture-host", "two", date.Add(time.Hour), false)
	current, _ := publishHostFixture(t, s, "failed-current", "fixture-host", "one", date.Add(2*time.Hour), true)
	q := Query{Revision: current, Environment: first, Environments: []string{second, first}, Selection: "current", Metric: "time.wall", Sort: "catalog"}
	rows, err := s.ResultsContext(context.Background(), q, false)
	if err != nil || len(rows) != 1 {
		t.Fatalf("current: %d %v", len(rows), err)
	}
	var value wire.Result
	_ = wire.Decode(rows[0].Data, &value)
	if value.EnvironmentID != first || !value.Created.Equal(date.Add(2*time.Hour)) {
		t.Fatal("new failure did not advance selection")
	}
	q.Selection = "previous"
	rows, err = s.ResultsContext(context.Background(), q, false)
	if err != nil || len(rows) != 1 {
		t.Fatalf("previous: %d %v", len(rows), err)
	}
	_ = wire.Decode(rows[0].Data, &value)
	if value.EnvironmentID != second || !value.Created.Equal(date.Add(time.Hour)) {
		t.Fatal("previous is not the preceding host-local observation")
	}
	q.Revision = frozen
	q.Selection = "current"
	rows, err = s.ResultsContext(context.Background(), q, false)
	if err != nil {
		t.Fatal(err)
	}
	_ = wire.Decode(rows[0].Data, &value)
	if value.EnvironmentID != second {
		t.Fatal("frozen selection changed")
	}
	rows, err = s.ResultsContext(context.Background(), q, true)
	if err != nil || len(rows) != 2 {
		t.Fatalf("history: %d %v", len(rows), err)
	}
}

func TestExplicitHostMembershipRejectsDifferentMachinesAndDuplicates(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	date := time.Date(2026, 10, 5, 1, 0, 0, 0, time.UTC)
	_, first := publishHostFixture(t, s, "one-host", "one", "one", date, false)
	revision, second := publishHostFixture(t, s, "other-host", "two", "two", date, false)
	for _, ids := range [][]string{{first, second}, {first, first}, {second}} {
		if _, err := s.NormalizeHostEnvironments(revision, first, ids); err == nil {
			t.Fatal("invalid membership accepted", ids)
		}
	}
}
