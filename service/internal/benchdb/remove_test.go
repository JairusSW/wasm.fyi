package benchdb

import (
	"context"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"strings"
	"testing"
)

func TestRemovePlatformPreservesSharedMeasurementsAndMetadata(t *testing.T) {
	ctx := context.Background()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	old := fixture("2026-10-08T00:00:00Z", 10)
	old.Platform.MemoryBytes = 0
	old.Source = &Source{Kind: "release", Repository: "example/repo", Revision: "v1", Ref: "v1", AsOf: "2026-10-07T00:00:00Z"}
	good := old
	good.Platform.MemoryBytes = 64 << 30
	for _, capture := range []Capture{old, good} {
		if _, err := s.Put(ctx, capture); err != nil {
			t.Fatal(err)
		}
	}
	if n, err := s.RemovePlatform(ctx, identifier(old.Platform)); err != nil || n != 2 {
		t.Fatal(n, err)
	}
	catalog, err := s.Platforms(ctx)
	if err != nil || len(catalog.Items) != 1 || catalog.Items[0].ID != identifier(good.Platform) {
		t.Fatal(catalog, err)
	}
	for _, history := range []bool{false, true} {
		page, err := s.Page(ctx, Query{Platform: identifier(good.Platform), History: history, Limit: 100})
		if err != nil || page.Total != 1 || page.Items[0].Engine != good.Results[0].Engine {
			t.Fatal(page, err)
		}
	}
	if n, err := s.RemovePlatform(ctx, identifier(old.Platform)); err != nil || n != 0 {
		t.Fatal(n, err)
	}
}

func TestRemoveEnginePreservesOtherMeasurements(t *testing.T) {
	ctx := context.Background()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, engine := range []string{"wazero", "wasm2js"} {
		c := fixture("2026-10-08T00:00:00Z", 10)
		c.Results[0].Engine = engine
		c.Source = &Source{Kind: "release", Repository: "example/repo", Revision: "v1", Ref: "v1", AsOf: "2026-10-07T00:00:00Z"}
		if _, err = s.Put(ctx, c); err != nil {
			t.Fatal(err)
		}
	}
	if n, err := s.RemoveEngine(ctx, "wasm2js"); err != nil || n != 2 {
		t.Fatal(n, err)
	}
	for _, history := range []bool{false, true} {
		p, err := s.Page(ctx, Query{Platform: identifier(fixture("", 0).Platform), History: history, Limit: 100})
		if err != nil || p.Total != 1 || len(p.Items) != 1 || p.Items[0].Engine != "wazero" {
			t.Fatal(p, err)
		}
	}
	if n, err := s.RemoveEngine(ctx, "wasm2js"); err != nil || n != 0 {
		t.Fatal(n, err)
	}
}

func TestHistoryPagesFitResponseBudget(t *testing.T) {
	ctx := context.Background()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	c := fixture("2026-10-08T00:00:00Z", 10)
	c.Source = &Source{Kind: "release", Repository: "example/repo", Revision: strings.Repeat("a", 40), Ref: strings.Repeat("v", 200), AsOf: "2026-10-07T00:00:00Z"}
	row := c.Results[0]
	row.Display = &Display{Purpose: strings.Repeat("purpose ", 100)}
	c.Results = nil
	for i := 0; i < 1000; i++ {
		r := row
		r.Workload = fmt.Sprintf("applications/test-%04d", i)
		r.Contract = fmt.Sprintf("%064x", i+10)
		c.Results = append(c.Results, r)
	}
	if _, err = s.Put(ctx, c); err != nil {
		t.Fatal(err)
	}
	q := Query{Platform: identifier(c.Platform), History: true, Limit: 1000}
	seen := map[string]bool{}
	pages := 0
	for {
		page, err := s.Page(ctx, q)
		if err != nil {
			t.Fatal(err)
		}
		pages++
		if len(encode(page)) > wire.ResponseBytes {
			t.Fatal("page exceeds response budget")
		}
		for _, r := range page.Items {
			if seen[r.Workload] {
				t.Fatal("duplicate", r.Workload)
			}
			seen[r.Workload] = true
		}
		if page.NextCursor == nil {
			break
		}
		q.Cursor = *page.NextCursor
	}
	if pages < 2 || len(seen) != 1000 {
		t.Fatal(pages, len(seen))
	}
}
