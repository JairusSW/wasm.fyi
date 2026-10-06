package store

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func historyJobFixture(t *testing.T) (wire.Job, map[string][]byte) {
	t.Helper()
	job, objects, e := testutil.Fixture("history-context", time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC))
	if e != nil {
		t.Fatal(e)
	}
	configs := map[string]bool{}
	for _, body := range objects {
		var r wire.Record
		_ = json.Unmarshal(body, &r)
		if r.Kind == "result" {
			var v wire.Result
			_ = json.Unmarshal(r.Data, &v)
			configs[v.ConfigurationID] = true
		}
	}
	for id := range configs {
		job.History = append(job.History, wire.HistoryBinding{ReportID: job.Exports[0].Manifest.ReportID, ConfigurationID: id, Policy: wire.HistoryBindingPolicy, TargetDate: "2026-01-01", SourceRevision: strings.Repeat("a", 40), BuildRole: "source"})
	}
	return job, objects
}
func TestHistoryContextPublicationFrozenRebuildAndNoObservation(t *testing.T) {
	ctx := context.Background()
	s := openTest(t, t.TempDir())
	defer s.Close()
	j, objects := historyJobFixture(t)
	for id, body := range objects {
		if e := s.Install(id, bytes.NewReader(body)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(j)
	if e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.HistoryContexts(ctx, s.Current(), id, 0, 1); e == nil {
		t.Fatal("staged history exposed")
	}
	rev, e := s.Commit(id)
	if e != nil {
		t.Fatal(e)
	}
	before, total, e := s.HistoryContexts(ctx, rev, id, 0, 100)
	if e != nil || total != len(j.History) || len(before) != total {
		t.Fatal(e, total, before)
	}
	for _, item := range before {
		if item.Binding.BuildRole != "source" || item.Binding.Release != nil || item.InterpretationSource != "trusted-publisher-assertion" || item.PublishedAt.IsZero() {
			t.Fatal("history roles changed", item)
		}
	}
	rows, e := s.Results(Query{Revision: rev}, true)
	if e != nil || len(rows) != 3 {
		t.Fatal("history annotations created observations", e, len(rows))
	}
	publishTest(t, s, "history-context-later", time.Now().UTC())
	frozen, _, e := s.HistoryContexts(ctx, rev, id, 0, 100)
	if e != nil {
		t.Fatal(e)
	}
	a, _ := wire.Encode(before)
	b, _ := wire.Encode(frozen)
	if !bytes.Equal(a, b) {
		t.Fatal("publication changed frozen roles")
	}
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e = s.Backup(ctx, backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if e = Rebuild(backup, rebuilt, "fixture-publisher"); e != nil {
		t.Fatal(e)
	}
	r := openTest(t, rebuilt)
	defer r.Close()
	restored, _, e := r.HistoryContexts(ctx, rev, id, 0, 100)
	if e != nil {
		t.Fatal(e)
	}
	b, _ = wire.Encode(restored)
	if !bytes.Equal(a, b) {
		t.Fatal("portable rebuild changed history interpretation")
	}
	if _, _, e = s.HistoryContexts(ctx, rev, id, total+1, 1); e == nil {
		t.Fatal("invalid offset accepted")
	}
}
func TestHistoryContextRejectsForeignConfigurationBeforePublication(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	j, objects := historyJobFixture(t)
	j.History[0].ConfigurationID = strings.Repeat("b", 64)
	for id, body := range objects {
		if e := s.Install(id, bytes.NewReader(body)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(j)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Commit(id); e == nil || s.Current() != "" {
		t.Fatal("foreign history configuration published", e)
	}
}

func TestHistoryContextWithoutBindingsIsEmpty(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	revID := publishTest(t, s, "without-history-binding", time.Now().UTC())
	rev, e := s.Revision(revID)
	if e != nil {
		t.Fatal(e)
	}
	rows, total, e := s.HistoryContexts(context.Background(), revID, rev.Job, 0, 100)
	if e != nil || rows == nil || len(rows) != 0 || total != 0 {
		t.Fatal("absent metadata fabricated history", e, total, rows)
	}
}

func TestHistoryContextReleaseDatesRemainIndependent(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	j, objects := historyJobFixture(t)
	sourceDate := time.Date(2025, 12, 31, 12, 0, 0, 0, time.UTC)
	releaseDate := time.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC)
	j.History[0].SourceDate = &sourceDate
	j.History[0].BuildRole = "release"
	j.History[0].Release = &wire.HistoryRelease{Version: "v1.2.3", PublishedAt: releaseDate, URL: "https://example.test/releases/v1.2.3"}
	for id, body := range objects {
		if e := s.Install(id, bytes.NewReader(body)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(j)
	if e != nil {
		t.Fatal(e)
	}
	rev, e := s.Commit(id)
	if e != nil {
		t.Fatal(e)
	}
	rows, _, e := s.HistoryContexts(context.Background(), rev, id, 0, 1)
	if e != nil || len(rows) != 1 {
		t.Fatal(e, rows)
	}
	out := rows[0]
	report, e := s.Record(rev, "report", out.Binding.ReportID)
	if e != nil {
		t.Fatal(e)
	}
	var declared struct {
		Created *time.Time `json:"created"`
	}
	if e = json.Unmarshal(report.Data, &declared); e != nil {
		t.Fatal(e)
	}
	if out.Binding.TargetDate != "2026-01-01" || out.Binding.SourceDate == nil || !out.Binding.SourceDate.Equal(sourceDate) || out.Binding.Release == nil || !out.Binding.Release.PublishedAt.Equal(releaseDate) || out.InterpretationSource != "trusted-publisher-assertion" {
		t.Fatal("history dates or trust conflated", out)
	}
	if declared.Created == nil {
		if out.CollectedAt != nil {
			t.Fatal("collection time fabricated")
		}
	} else if out.CollectedAt == nil || !out.CollectedAt.Equal(*declared.Created) {
		t.Fatal("collection time substituted", out)
	}
	if out.PublishedAt.Equal(releaseDate) || out.PublishedAt.Equal(sourceDate) {
		t.Fatal("publication backdated", out)
	}
	// A changed interpretation cannot rewrite the same immutable collection attempt.
	changed := j
	changed.History = append([]wire.HistoryBinding{}, j.History...)
	changed.History[0].TargetDate = "2026-01-03"
	if _, e = s.Submit(changed); e == nil {
		t.Fatal("existing attempt interpretation overwritten")
	}
}

func TestHistoryContextRejectsInvalidCollectionTimeBeforePublication(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	job, objects := historyJobFixture(t)
	for i, object := range job.Exports[0].Manifest.Objects {
		if object.Kind != "record" {
			continue
		}
		var record wire.Record
		_ = wire.Decode(objects[object.SHA256], &record)
		if record.Kind != "report" {
			continue
		}
		var data map[string]json.RawMessage
		_ = json.Unmarshal(record.Data, &data)
		data["created"] = json.RawMessage(`"invalid-date"`)
		record.Data, _ = wire.Encode(data)
		body, _ := wire.Encode(record)
		digest := wire.Hash(body)
		delete(objects, object.SHA256)
		objects[digest] = body
		job.Exports[0].Manifest.Objects[i] = wire.Object{SHA256: digest, Bytes: len(body), Kind: "record"}
	}
	manifest, _ := wire.Encode(job.Exports[0].Manifest)
	job.Exports[0].SHA256 = wire.Hash(manifest)
	for id, body := range objects {
		if e := s.Install(id, bytes.NewReader(body)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(job)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Commit(id); e == nil || !strings.Contains(e.Error(), "history report collection time") || s.Current() != "" {
		t.Fatal("unreadable history context became public", e)
	}
}
