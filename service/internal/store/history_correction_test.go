package store

import (
	"bytes"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"strings"
	"testing"
	"time"
)

func TestRetainedHistoryCorrectionPreservesScientificRootsAndIsIdempotent(t *testing.T) {
	root := t.TempDir()
	s, err := Open(root, "correction-test")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if s != nil {
			s.Close()
		}
	}()
	job, objects, _ := retainedFixture(t, "history-correction", "retained-history", time.Now().UTC(), 123)
	var source wire.Result
	for id, body := range objects {
		if err = s.Install(id, bytes.NewReader(body)); err != nil {
			t.Fatal(err)
		}
		var record wire.Record
		_ = json.Unmarshal(body, &record)
		if record.Kind == "result" {
			_ = json.Unmarshal(record.Data, &source)
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
	wanted := []RetainedHistoryReport{{ReportID: source.ReportID, Rows: []RetainedHistoryRow{{Runtime: source.Runtime, Date: "2026-01-04", Role: "source", Revision: strings.Repeat("a", 40)}, {Runtime: source.Runtime, Date: "2026-01-11", Role: "source", Revision: strings.Repeat("a", 40)}}}}
	if _, err = s.CorrectRetainedHistory(t.Context(), id, wanted); err == nil {
		t.Fatal("online correction allowed")
	}
	s.EnableOfflineImport()
	old, _ := s.Revision(revision)
	corrected, err := s.CorrectRetainedHistory(t.Context(), id, wanted)
	if err != nil {
		t.Fatal(err)
	}
	next, _ := s.Revision(corrected)
	if next.Catalog != old.Catalog || next.Selection != old.Selection || next.Observations != old.Observations || next.SourceBindings != old.SourceBindings || next.Parent != revision {
		t.Fatal("scientific roots changed")
	}
	correctedJob, err := s.Job(next.Job)
	if err != nil {
		t.Fatal(err)
	}
	if len(correctedJob.History) != 1 || len(correctedJob.History[0].TargetDates) != 2 || correctedJob.History[0].ConfigurationID != source.ConfigurationID {
		t.Fatal("incorrect aliases", correctedJob.History)
	}
	again, err := s.CorrectRetainedHistory(t.Context(), id, wanted)
	if err != nil || again != corrected || s.Current() != corrected {
		t.Fatal("not idempotent", again, err)
	}
	foreign := []RetainedHistoryReport{{ReportID: strings.Repeat("b", 64), Rows: wanted[0].Rows}}
	if _, err = s.CorrectRetainedHistory(t.Context(), id, foreign); err == nil || s.Current() != corrected {
		t.Fatal("foreign correction published")
	}
	original, _ := s.Job(id)
	if len(original.History) != 0 {
		t.Fatal("original job mutated")
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = OpenForReadOnlyServing(root, "correction-test", DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	if s.Current() != corrected {
		t.Fatal("correction lost after restart")
	}
}
