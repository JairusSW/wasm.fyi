package benchdb

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestNativeCodeEnrichmentPreservesMeasurementsAndHistory(t *testing.T) {
	ctx := context.Background()
	path := t.TempDir()
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if s != nil {
			s.Close()
		}
	}()
	c := fixture("2026-10-08T00:00:00Z", 10)
	c.Source = &Source{Repository: "example/engine", Revision: strings.Repeat("a", 40), Ref: "main", Kind: "snapshot", AsOf: "2026-10-04T00:00:00Z"}
	c.Results[0].SamplesNs = []float64{9, 10, 11, 10, 10}
	c.Results[0].TimingSamples = 5
	c.Results[0].CodeBytes, c.Results[0].CodeKind = nil, nil
	c.Results[0].CodeStatus = "not-measured"
	if _, err = s.Put(ctx, c); err != nil {
		t.Fatal(err)
	}
	before, err := s.Page(ctx, Query{Platform: identifier(c.Platform), Phase: "steady", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	code := 272.0
	kind := "engine-reported"
	c.Results[0].CodeBytes, c.Results[0].CodeKind, c.Results[0].CodeStatus = &code, &kind, "ok"
	if _, err = s.Put(ctx, c); err != nil {
		t.Fatal(err)
	}
	for _, history := range []bool{false, true} {
		after, err := s.Page(ctx, Query{Platform: identifier(c.Platform), Phase: "steady", History: history, Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		if len(after.Items) != 1 {
			t.Fatal(after)
		}
		got := after.Items[0]
		want := before.Items[0]
		if got.CodeBytes == nil || *got.CodeBytes != 272 || got.CodeStatus != "ok" || got.CodeKind == nil || *got.CodeKind != "engine-reported" {
			t.Fatal(got)
		}
		got.CodeBytes, got.CodeKind, got.CodeStatus = want.CodeBytes, want.CodeKind, want.CodeStatus
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("unrelated measurement changed: got=%+v want=%+v", got, want)
		}
	}
	stable, err := s.Page(ctx, Query{Platform: identifier(c.Platform), Phase: "steady", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	code = 999 // Conflicting positive code must not replace a qualified measurement.
	if _, err = s.Put(ctx, c); err != nil {
		t.Fatal(err)
	}
	after, err := s.Page(ctx, Query{Platform: identifier(c.Platform), Phase: "steady", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(stable, after) {
		t.Fatal("conflicting equal-time code changed stored result")
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s = nil
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	persisted, err := reopened.Page(ctx, Query{Platform: identifier(c.Platform), Phase: "steady", History: true, Limit: 10})
	if err != nil || *persisted.Items[0].CodeBytes != 272 {
		t.Fatal(persisted, err)
	}
}

func TestArchivedNativeCodeEnrichmentLeavesLatestUnchanged(t *testing.T) {
	ctx := context.Background()
	path := t.TempDir()
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if s != nil {
			s.Close()
		}
	}()
	old := fixture("2026-10-01T00:00:00Z", 10)
	old.Source = &Source{Repository: "example/engine", Revision: strings.Repeat("a", 40), Ref: "main", Kind: "snapshot", AsOf: "2026-09-27T00:00:00Z"}
	old.Results[0].CodeBytes, old.Results[0].CodeKind = nil, nil
	old.Results[0].CodeStatus = "not-measured"
	latest := fixture("2026-10-08T00:00:00Z", 20)
	latest.Source = &Source{Repository: "example/engine", Revision: strings.Repeat("b", 40), Ref: "main", Kind: "snapshot", AsOf: "2026-10-04T00:00:00Z"}
	for _, capture := range []Capture{old, latest} {
		if _, err := s.Put(ctx, capture); err != nil {
			t.Fatal(err)
		}
	}
	query := Query{Platform: identifier(old.Platform), Phase: "steady", Limit: 10}
	current, err := s.Page(ctx, query)
	if err != nil || len(current.Items) != 1 {
		t.Fatal(current, err)
	}
	query.History = true
	history, err := s.Page(ctx, query)
	if err != nil || len(history.Items) != 2 {
		t.Fatal(history, err)
	}
	code, kind := 128.0, "engine-reported"
	old.Results[0].CodeBytes, old.Results[0].CodeKind, old.Results[0].CodeStatus = &code, &kind, "ok"
	if _, err := s.Put(ctx, old); err != nil {
		t.Fatal(err)
	}
	check := func(store *Store) {
		t.Helper()
		query.History = false
		got, err := store.Page(ctx, query)
		if err != nil || !reflect.DeepEqual(got.Items, current.Items) {
			t.Fatalf("latest changed: %+v, %v", got, err)
		}
		query.History = true
		got, err = store.Page(ctx, query)
		if err != nil || len(got.Items) != 2 {
			t.Fatal(got, err)
		}
		enriched := 0
		for i, item := range got.Items {
			want := history.Items[i]
			if item.CapturedAt == old.CapturedAt {
				enriched++
				if item.CodeBytes == nil || *item.CodeBytes != code || item.CodeKind == nil || *item.CodeKind != kind || item.CodeStatus != "ok" {
					t.Fatal("archive not enriched", item)
				}
				item.CodeBytes, item.CodeKind, item.CodeStatus = want.CodeBytes, want.CodeKind, want.CodeStatus
			}
			if !reflect.DeepEqual(item, want) {
				t.Fatalf("archive timing or latest history changed: %+v != %+v", item, want)
			}
		}
		if enriched != 1 {
			t.Fatalf("expected one repaired archived snapshot, found %d", enriched)
		}
	}
	check(s)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = nil
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	check(reopened)
}

func TestNativeCodeEnrichmentRejectsEveryUnrelatedChange(t *testing.T) {
	code := 272.0
	kind := "engine-reported"
	latency := 10.0
	rss := 4096.0
	old := measurement{CapturedAt: "2026-10-08T00:00:00Z", Status: "ok", Latency: &latency, PeakRSS: &rss, CodeStatus: "not-measured", MemoryStatus: "ok", Contract: "contract", Engine: "engine", SamplesNs: []float64{10, 10}, TimingSamples: 2}
	next := old
	next.Code = &code
	next.CodeKind = &kind
	next.CodeStatus = "ok"
	if !nativeCodeEnrichment(old, next) {
		t.Fatal("exact enrichment rejected")
	}
	cases := map[string]func(*measurement){
		"time":          func(v *measurement) { v.CapturedAt = "2026-10-07T00:00:00Z" },
		"latency":       func(v *measurement) { n := 11.0; v.Latency = &n },
		"rss":           func(v *measurement) { n := 8192.0; v.PeakRSS = &n },
		"samples":       func(v *measurement) { v.SamplesNs = []float64{10, 11} },
		"count":         func(v *measurement) { v.TimingSamples = 3 },
		"status":        func(v *measurement) { v.Status = "failed" },
		"memory status": func(v *measurement) { v.MemoryStatus = "unsupported" },
		"contract":      func(v *measurement) { v.Contract = "different" },
		"engine":        func(v *measurement) { v.Engine = "different" },
		"source":        func(v *measurement) { v.Source = &Source{Revision: "different"} },
		"code status":   func(v *measurement) { v.CodeStatus = "unsupported" },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			changed := next
			change(&changed)
			if nativeCodeEnrichment(old, changed) {
				t.Fatal("unrelated change accepted")
			}
		})
	}
}
