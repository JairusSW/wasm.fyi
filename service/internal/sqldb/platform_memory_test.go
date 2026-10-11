package sqldb

import (
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"reflect"
	"testing"
)

func TestUnknownMemoryPutMatchesOnlyOneExactHost(t *testing.T) {
	for _, kind := range []string{"exact", "ambiguous", "kernel", "cpu", "cores"} {
		t.Run(kind, func(t *testing.T) {
			ctx := context.Background()
			s, e := Open(t.TempDir())
			if e != nil {
				t.Fatal(e)
			}
			defer s.Close()
			known := fixture()
			known.Platform.MemoryBytes = 1024
			if _, e = s.Put(ctx, known); e != nil {
				t.Fatal(e)
			}
			if kind == "ambiguous" {
				other := known
				other.Platform.MemoryBytes = 2048
				if _, e = s.Put(ctx, other); e != nil {
					t.Fatal(e)
				}
			}
			unknown := known
			unknown.Platform.MemoryBytes = 0
			unknown.CapturedAt = "2026-10-09T00:00:00Z"
			switch kind {
			case "kernel":
				unknown.Platform.Kernel = "different"
			case "cpu":
				unknown.Platform.CPU = "different"
			case "cores":
				unknown.Platform.Cores++
			}
			if _, e = s.Put(ctx, unknown); e != nil {
				t.Fatal(e)
			}
			var count int
			s.reader.QueryRow("SELECT count(*) FROM platforms WHERE memory_bytes=0").Scan(&count)
			if (kind == "exact" && count != 0) || (kind != "exact" && count != 1) {
				t.Fatal(kind, count)
			}
			if kind == "exact" {
				p, e := s.Matrix(ctx, MatrixQuery{Platform: hash(known.Platform), Phase: "steady", Limit: 10})
				if e != nil || p.Items[0].CapturedAt != unknown.CapturedAt {
					t.Fatal(p, e)
				}
			}
		})
	}
}
func TestMemoryStartupRepairPreservesBindingsVectorsAndEnrichment(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	s, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	original := fixture()
	original.Platform.MemoryBytes = 1024
	original.Results[0].CodeStatus = "unsupported"
	original.Results[0].CodeBytes = nil
	original.Results[0].CodeKind = nil
	if _, e = s.Put(ctx, original); e != nil {
		t.Fatal(e)
	}
	next := fixture()
	next.Platform.MemoryBytes = 0
	next.Results[0].Source = next.Source
	r := benchdb.Result{Row: next.Results[0], CapturedAt: next.CapturedAt}
	if e = s.ImportBatch(ctx, []Binding{{Scope: "latest", Platform: next.Platform, Result: r}, {Scope: "history", Platform: next.Platform, Result: r}}); e != nil {
		t.Fatal(e)
	}
	var observations, vectors int
	s.reader.QueryRow("SELECT count(*) FROM observations").Scan(&observations)
	s.reader.QueryRow("SELECT count(*) FROM sample_vectors").Scan(&vectors)
	beforeSummary, e := s.Summary(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	s, e = Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()

	afterSummary, e := s.Summary(ctx)
	if e != nil || len(afterSummary.Platforms) != 1 {
		t.Fatal(afterSummary, e)
	}
	var beforeKnown benchdb.PlatformSummary
	for _, p := range beforeSummary.Platforms {
		if p.ID == hash(original.Platform) {
			beforeKnown = p
		}
	}
	afterKnown := afterSummary.Platforms[0]
	if afterKnown.LatestRevision == beforeKnown.LatestRevision || afterKnown.HistoryRevision == beforeKnown.HistoryRevision || afterKnown.LatestRows != 1 || afterKnown.HistoryRows != 1 || afterKnown.LatestTimingSamples != 5 || afterKnown.AllTimingSamples != 5 {
		t.Fatal(beforeKnown, afterKnown)
	}
	var platforms, nobs, nvec int
	s.reader.QueryRow("SELECT count(*) FROM platforms").Scan(&platforms)
	s.reader.QueryRow("SELECT count(*) FROM observations").Scan(&nobs)
	s.reader.QueryRow("SELECT count(*) FROM sample_vectors").Scan(&nvec)
	if platforms != 1 || nobs != observations || nvec != vectors {
		t.Fatal(platforms, nobs, nvec, observations, vectors)
	}
	for _, history := range []bool{false, true} {
		var page Matrix
		if history {
			page, e = s.History(ctx, MatrixQuery{Platform: hash(original.Platform), Phase: "steady", Limit: 10}, "", "")
		} else {
			page, e = s.Matrix(ctx, MatrixQuery{Platform: hash(original.Platform), Phase: "steady", Limit: 10})
		}
		if e != nil || page.Total != 1 || page.Items[0].CodeStatus != "ok" {
			t.Fatal(page, e)
		}
		asof := ""
		if history {
			asof = next.Source.AsOf
		}
		var detail benchdb.Result
			if history {
				detail, e = s.Detail(ctx, hash(original.Platform), page.Items[0].ObservationID, asof)
			} else {
				detail, e = s.Detail(ctx, hash(original.Platform), page.Items[0].ObservationID)
			}
		if e != nil || !reflect.DeepEqual(vector(detail.SamplesNs), vector(r.SamplesNs)) || !reflect.DeepEqual(metrics(detail.Row), metrics(r.Row)) || detail.Source.Revision != r.Source.Revision {
			t.Fatal(detail, e)
		}
	}
	if e = s.Integrity(ctx); e != nil {
		t.Fatal(e)
	}
	repairs, e := s.RepairUnknownMemoryPlatforms(ctx)
	if e != nil || len(repairs) != 0 {
		t.Fatal(repairs, e)
	}
}
