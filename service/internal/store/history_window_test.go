package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestHistoryWindowBoundariesFrozenAndPortable(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	jan := time.Date(2026, 1, 31, 23, 59, 59, 0, time.UTC)
	feb := jan.Add(time.Second)
	march := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	publishTest(t, s, "january", jan)
	publishTest(t, s, "february", feb)
	rev := publishTest(t, s, "march", march)
	q := Query{Revision: rev, From: feb.Format(time.RFC3339Nano), Until: march.Format(time.RFC3339Nano)}
	check := func(s *Store) {
		t.Helper()
		rows, e := s.Results(q, true)
		if e != nil || len(rows) != 3 {
			t.Fatal("history window changed population", len(rows), e)
		}
		all, e := s.Results(Query{Revision: rev}, true)
		if e != nil || len(all) != 9 {
			t.Fatal("full history lost", len(all), e)
		}
	}
	check(s)
	publishTest(t, s, "later", march.Add(time.Hour))
	check(s)
	q.From = "2026-02-01T01:00:00+01:00"
	normalized, e := NormalizeHistoryQuery(q)
	if e != nil || normalized.From != feb.Format(time.RFC3339Nano) {
		t.Fatal("timezone normalization differs", e)
	}
	check(s)
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e = s.Backup(context.Background(), backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if e = Rebuild(backup, rebuilt, "test"); e != nil {
		t.Fatal(e)
	}
	r := openTest(t, rebuilt)
	defer r.Close()
	check(r)
	for _, bad := range []Query{{From: q.From}, {Until: q.Until}, {From: q.Until, Until: q.From}, {From: "2026-01-01", Until: q.Until}, {From: "2000-01-01T00:00:00Z", Until: "2026-01-01T00:00:00Z"}} {
		if _, e := s.Results(bad, true); e == nil {
			t.Fatal("invalid history window accepted")
		}
	}
	if _, e = s.Results(q, false); e == nil {
		t.Fatal("window silently ignored on current results")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = s.ResultsContext(ctx, q, true); e != context.Canceled {
		t.Fatal("history window ignores cancellation", e)
	}
}

func TestHistoryMonthIndexAvoidsOlderChainObjects(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	jan := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	feb := jan.AddDate(0, 1, 0)
	publishTest(t, s, "old", jan)
	revID := publishTest(t, s, "new", feb)
	rev, e := s.Revision(revID)
	if e != nil {
		t.Fatal(e)
	}
	// Poison only the history-chain link in a private test revision. The month
	// query must use its immutable postings, rather than reading that old chain.
	root := rev.Selection
	budget := ScanLimit
	updates := map[string]string{}
	if e = s.walk(root, &budget, func(key, id string) error {
		var c cell
		if e := s.load(id, &c); e != nil {
			return e
		}
		c.History = "not-a-content-hash"
		digest, e := s.put(c)
		if e != nil {
			return e
		}
		updates[key] = digest
		return nil
	}); e != nil {
		t.Fatal(e)
	}
	rev.Selection, e = s.mapSetMany(context.Background(), root, updates, 0)
	if e != nil {
		t.Fatal(e)
	}
	s.mu.Lock()
	s.published[revID] = rev
	s.mu.Unlock()
	rows, e := s.Results(Query{Revision: revID, From: feb.Format(time.RFC3339Nano), Until: feb.AddDate(0, 1, 0).Format(time.RFC3339Nano)}, true)
	if e != nil || len(rows) != 3 {
		t.Fatal("window decoded old chain", e)
	}
}
