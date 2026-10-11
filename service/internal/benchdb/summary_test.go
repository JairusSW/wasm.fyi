package benchdb

import (
	"context"
	"strings"
	"testing"
)

func TestSummaryIncludesFreshHistoricalCaptureWithoutReplacingLatest(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	current := fixture("2026-10-10T08:00:00Z", 10)
	current.Source = &Source{Repository: "org/repo", Revision: strings.Repeat("a", 40), Ref: "main", Kind: "main", AsOf: "2026-10-04T10:00:00Z"}
	if _, err = s.Put(context.Background(), current); err != nil {
		t.Fatal(err)
	}
	older := fixture("2026-10-10T17:00:00Z", 20)
	older.Source = &Source{Repository: "org/repo", Revision: strings.Repeat("b", 40), Ref: "main", Kind: "main", AsOf: "2026-09-27T10:00:00Z"}
	if _, err = s.Put(context.Background(), older); err != nil {
		t.Fatal(err)
	}
	summary, err := s.Summary(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(summary.Platforms) != 1 {
		t.Fatal("missing platform")
	}
	p := summary.Platforms[0]
	if p.CapturedAt != older.CapturedAt || p.LatestRows != 1 || p.HistoryRows != 2 || p.ImportedAt == "" {
		t.Fatalf("incorrect summary: %#v", p)
	}
	page, err := s.Page(context.Background(), Query{Platform: p.ID, Phase: "steady", Limit: 10})
	if err != nil || len(page.Items) != 1 || page.Items[0].CapturedAt != current.CapturedAt {
		t.Fatal("historical capture replaced latest", err)
	}
	if _, err = s.Put(context.Background(), older); err != nil {
		t.Fatal(err)
	}
	retry, err := s.Summary(context.Background())
	if err != nil || retry.Revision != summary.Revision || retry.Platforms[0].ImportedAt != p.ImportedAt {
		t.Fatal("retry changed summary", err)
	}
}
