package sqldb

import (
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"testing"
)

func TestRevisionRemovalRestoresAndBlocksOnlyEngine(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	c := fixture()
	c.Results[0].Engine = "wago"
	if _, err = s.Put(ctx, c); err != nil {
		t.Fatal(err)
	}
	newer := c
	source := *c.Source
	source.Revision = "209e448c392510a0325d5b282a0d86a776fb379c"
	source.AsOf = "2026-10-09T00:00:00Z"
	newer.Source = &source
	newer.CapturedAt = "2026-10-09T00:00:00Z"
	newer.Results = append([]benchdb.Row(nil), c.Results...)
	newer.Results[0].SamplesNs = []float64{10, 11, 12, 13, 14}
	if _, err = s.Put(ctx, newer); err != nil {
		t.Fatal(err)
	}
	other := newer
	other.Results = append([]benchdb.Row(nil), newer.Results...)
	other.Results[0].Engine = "wazero"
	if _, err = s.Put(ctx, other); err != nil {
		t.Fatal(err)
	}
	result, err := s.RemoveRevision(ctx, "wago", "209e448c")
	if err != nil {
		t.Fatal(err)
	}
	if result.LatestRemoved != 1 || result.HistoryRemoved != 1 || result.LatestRestored != 1 || result.ObservationsRemoved != 1 {
		t.Fatalf("wrong removal: %+v", result)
	}
	var rev string
	if err = s.reader.QueryRow(`SELECT src.revision FROM latest l JOIN observations o ON o.id=l.observation_id JOIN sources src ON src.id=o.source_id JOIN engines e ON e.id=l.engine_id WHERE e.name='wago'`).Scan(&rev); err != nil || rev != c.Source.Revision {
		t.Fatal("latest not restored", rev, err)
	}
	var vectors int
	s.reader.QueryRow("SELECT count(*) FROM sample_vectors").Scan(&vectors)
	if vectors != 2 {
		t.Fatal("shared samples deleted", vectors)
	}
	again, err := s.RemoveRevision(ctx, "wago", "209e448c")
	if err != nil || again.LatestRemoved != 0 {
		t.Fatal("not idempotent", again, err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	mixed := newer
	mixed.Results = append(append([]benchdb.Row(nil), newer.Results...), other.Results...)
	if _, err = s.Put(ctx, mixed); err != nil {
		t.Fatal(err)
	}
	var blocked int
	s.reader.QueryRow(`SELECT count(*) FROM observations o JOIN configurations c ON c.id=o.configuration_id JOIN engines e ON e.id=c.engine_id JOIN sources src ON src.id=o.source_id WHERE e.name='wago' AND src.revision=?`, source.Revision).Scan(&blocked)
	if blocked != 0 {
		t.Fatal("blocked revision reimported")
	}
	if err = s.Integrity(ctx); err != nil {
		t.Fatal(err)
	}
	var latest, history, latestSamples, allSamples int
	s.reader.QueryRow(`SELECT latest_rows,history_rows,latest_samples,all_samples FROM platform_totals`).Scan(&latest, &history, &latestSamples, &allSamples)
	if latest != 2 || history != 2 || latestSamples != 10 || allSamples != 10 {
		t.Fatal("totals stale", latest, history, latestSamples, allSamples)
	}
}

func TestRevisionRemovalRejectsAmbiguityAndDeletesOnlyOrphans(t *testing.T) {
	ctx := context.Background()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	c := fixture()
	c.Results[0].Engine = "wago"
	source := *c.Source
	source.Revision = "209e448c00000000000000000000000000000000"
	c.Source = &source
	if _, err = s.Put(ctx, c); err != nil {
		t.Fatal(err)
	}
	next := c
	otherSource := source
	otherSource.Revision = "209e448c11111111111111111111111111111111"
	otherSource.AsOf = "2026-10-09T00:00:00Z"
	next.Source = &otherSource
	next.CapturedAt = "2026-10-09T00:00:00Z"
	next.Results = append([]benchdb.Row(nil), c.Results...)
	next.Results[0].SamplesNs = []float64{20, 21, 22, 23, 24}
	if _, err = s.Put(ctx, next); err != nil {
		t.Fatal(err)
	}
	if _, err = s.RemoveRevision(ctx, "wago", "209e448c"); err == nil {
		t.Fatal("ambiguous removal allowed")
	}
	var blocks int
	s.reader.QueryRow("SELECT count(*) FROM blocked_revisions").Scan(&blocks)
	if blocks != 0 {
		t.Fatal("failed removal wrote tombstone")
	}
	result, err := s.RemoveRevision(ctx, "wago", otherSource.Revision)
	if err != nil || result.ObservationsRemoved != 1 {
		t.Fatal(result, err)
	}
	var vectors, observations int
	s.reader.QueryRow("SELECT count(*) FROM sample_vectors").Scan(&vectors)
	s.reader.QueryRow("SELECT count(*) FROM observations").Scan(&observations)
	if vectors != 1 || observations != 1 {
		t.Fatal("orphan records retained", vectors, observations)
	}
	blockedRow := next.Results[0]
	blockedRow.Source = next.Source
	if err = s.ImportBinding(ctx, "history", next.Platform, benchdb.Result{Row: blockedRow, CapturedAt: next.CapturedAt}); err != nil {
		t.Fatal("blocked migration should be no-op", err)
	}
	s.reader.QueryRow("SELECT count(*) FROM observations").Scan(&observations)
	if observations != 1 {
		t.Fatal("migration reimported blocked rows")
	}
	if err = s.Integrity(ctx); err != nil {
		t.Fatal(err)
	}
}
