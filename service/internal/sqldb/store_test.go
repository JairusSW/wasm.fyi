package sqldb

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func fixture() benchdb.Capture {
	v, rss, code := 10.0, 4096.0, 64.0
	kind := "native-image"
	return benchdb.Capture{CapturedAt: "2026-10-08T00:00:00Z", Platform: benchdb.Platform{OS: "linux", Arch: "amd64", CPU: "Fixture", Cores: 8, Kernel: "test"}, Source: &benchdb.Source{Repository: "test/project", Revision: fmt.Sprintf("%040x", 1), Ref: "main", Kind: "snapshot", AsOf: "2026-10-04T00:00:00Z"}, Results: []benchdb.Row{{Workload: "applications/test", Wasm: "test.wasm", Artifact: fmt.Sprintf("%064x", 1), Contract: fmt.Sprintf("%064x", 2), Engine: "wazero", Version: "1", Backend: "compiler", Phase: "steady", Status: "ok", Value: &v, PeakRSS: &rss, CodeBytes: &code, MemoryStatus: "ok", CodeStatus: "ok", CodeKind: &kind, TimingSamples: 5, SamplesNs: []float64{math.Copysign(0, -1), 1, 2, math.Nextafter(3, 4), 5}, Sampling: &benchdb.Sampling{Method: "same-process-stability-v1", GroupSize: 5, MaxSamples: 25, Warmup: 0, StopReason: "stable"}}}}
}
func TestLosslessAliasesBrowsingAndPersistence(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	s, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	c := fixture()
	if _, e = s.Put(ctx, c); e != nil {
		t.Fatal(e)
	}
	alias := c
	source := *c.Source
	source.AsOf = "2026-10-05T00:00:00Z"
	alias.Source = &source
	if _, e = s.Put(ctx, alias); e != nil {
		t.Fatal(e)
	}
	var obs, vectors int
	s.reader.QueryRow("SELECT count(*) FROM observations").Scan(&obs)
	s.reader.QueryRow("SELECT count(*) FROM sample_vectors").Scan(&vectors)
	if obs != 1 || vectors != 1 {
		t.Fatal(obs, vectors)
	}
	matrix, e := s.Matrix(ctx, MatrixQuery{Platform: hash(c.Platform), Phase: "steady", Limit: 10})
	if e != nil || len(matrix.Items) != 1 || matrix.Items[0].SamplesNs != nil {
		t.Fatal(matrix, e)
	}
	full, e := s.Detail(ctx, hash(c.Platform), matrix.Items[0].ObservationID)
	if e != nil || !reflect.DeepEqual(vector(full.SamplesNs), vector(c.Results[0].SamplesNs)) {
		t.Fatal(full, e)
	}
	if full.Source.AsOf != source.AsOf {
		t.Fatal(full.Source)
	}
	if e = s.Integrity(ctx); e != nil {
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
	full, e = s.Detail(ctx, hash(c.Platform), matrix.Items[0].ObservationID, c.Source.AsOf)
	if e != nil || !reflect.DeepEqual(vector(full.SamplesNs), vector(c.Results[0].SamplesNs)) {
		t.Fatal(full, e)
	}
}
func TestPutParityCodeEnrichmentAndAtomicConflict(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	legacy, e := benchdb.Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer legacy.Close()
	a := fixture()
	a.Results[0].SamplesNs = nil
	a.Results[0].TimingSamples = 0
	a.Results[0].Sampling = nil
	a.Results[0].CodeStatus = "unsupported"
	a.Results[0].CodeBytes = nil
	a.Results[0].CodeKind = nil
	captures := []benchdb.Capture{a, a}
	b := a
	b.Results = append([]benchdb.Row(nil), a.Results...)
	v := 20.0
	b.CapturedAt = "2026-10-09T00:00:00Z"
	b.Results[0].Value = &v
	b.Results[0].Version = "2"
	captures = append(captures, b, a)
	enrich := a
	enrich.Results = append([]benchdb.Row(nil), a.Results...)
	code := 272.0
	kind := "engine-reported"
	enrich.Results[0].CodeStatus = "ok"
	enrich.Results[0].CodeBytes = &code
	enrich.Results[0].CodeKind = &kind
	captures = append(captures, enrich)
	for _, c := range captures {
		if _, e = s.Put(ctx, c); e != nil {
			t.Fatal(e)
		}
		if _, e = legacy.Put(ctx, c); e != nil {
			t.Fatal(e)
		}
	}
	for _, history := range []bool{false, true} {
		q := benchdb.Query{Platform: hash(a.Platform), Phase: "steady", History: history, Limit: 100}
		got, e := s.Page(ctx, q)
		if e != nil {
			t.Fatal(e)
		}
		want, e := legacy.Page(ctx, q)
		if e != nil {
			t.Fatal(e)
		}
		gb, _ := json.Marshal(got.Items)
		wb, _ := json.Marshal(want.Items)
		if string(gb) != string(wb) {
			t.Fatalf("parity history=%v\n%s\n%s", history, gb, wb)
		}
	}
	before, _ := s.Summary(ctx)
	bad := fixture()
	bad.Results = append(bad.Results, bad.Results[0])
	bad.Results[1].Workload = "different"
	if _, e = s.Put(ctx, bad); e == nil {
		t.Fatal("conflicting contract accepted")
	}
	after, _ := s.Summary(ctx)
	if before.Revision != after.Revision {
		t.Fatal("partial commit")
	}
}
func TestMigrationBindingExportAndCursorScope(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	a := fixture()
	r := benchdb.Result{Row: a.Results[0], CapturedAt: a.CapturedAt}
	r.Source = a.Source
	for _, scope := range []string{"latest", "history"} {
		if e = s.ImportBinding(ctx, scope, a.Platform, r); e != nil {
			t.Fatal(e)
		}
	}
	dest, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer dest.Close()
	n := 0
	e = s.Export(ctx, func(scope string, p benchdb.Platform, row benchdb.Result) error {
		n++
		if !reflect.DeepEqual(vector(row.SamplesNs), vector(r.SamplesNs)) {
			t.Fatal("bits changed")
		}
		return dest.ImportBinding(ctx, scope, p, row)
	})
	if e != nil || n != 2 {
		t.Fatal(n, e)
	}
	if e = dest.Integrity(ctx); e != nil {
		t.Fatal(e)
	}
	b := fixture()
	b.Results[0].Workload = "applications/other"
	b.Results[0].Contract = fmt.Sprintf("%064x", 3)
	if _, e = s.Put(ctx, b); e != nil {
		t.Fatal(e)
	}
	page, e := s.Page(ctx, benchdb.Query{Platform: hash(a.Platform), Limit: 1})
	if e != nil || page.NextCursor == nil {
		t.Fatal(page, e)
	}
	next, e := s.Page(ctx, benchdb.Query{Limit: 1, Cursor: *page.NextCursor})
	if e != nil || len(next.Items) != 1 {
		t.Fatal(next, e)
	}
	if _, e = s.Page(ctx, benchdb.Query{Limit: 1, Cursor: *page.NextCursor, History: true}); e == nil {
		t.Fatal("scope cursor accepted")
	}
}

func TestMatrixHistoryPaginationAndScopedRevision(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	for i := 0; i < 7; i++ {
		c := fixture()
		c.Results[0].Workload = fmt.Sprintf("applications/%02d", i)
		c.Results[0].Contract = fmt.Sprintf("%064x", i+10)
		if _, e = s.Put(ctx, c); e != nil {
			t.Fatal(e)
		}
	}
	for _, history := range []bool{false, true} {
		q := MatrixQuery{Platform: hash(fixture().Platform), Limit: 2}
		seen := map[string]bool{}
		for {
			var page Matrix
			if history {
				page, e = s.History(ctx, q, "", "")
			} else {
				page, e = s.Matrix(ctx, q)
			}
			if e != nil {
				t.Fatal(e)
			}
			if page.Total != 7 {
				t.Fatal(page.Total)
			}
			for _, cell := range page.Items {
				if seen[cell.Workload] {
					t.Fatal("duplicate", cell.Workload)
				}
				seen[cell.Workload] = true
			}
			q.Revision = page.Revision
			if page.NextOffset == nil {
				break
			}
			q.Offset = *page.NextOffset
		}
		if len(seen) != 7 {
			t.Fatal("missing", seen)
		}
		q.Offset = 2
		q.Engine = "other"
		if history {
			_, e = s.History(ctx, q, "", "")
		} else {
			_, e = s.Matrix(ctx, q)
		}
		if e != benchdb.ErrChanged {
			t.Fatal("query scope not rejected", e)
		}
	}
	first, e := s.Matrix(ctx, MatrixQuery{Platform: hash(fixture().Platform), Limit: 2})
	if e != nil {
		t.Fatal(e)
	}
	c := fixture()
	c.CapturedAt = "2026-10-10T00:00:00Z"
	if _, e = s.Put(ctx, c); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Matrix(ctx, MatrixQuery{Platform: hash(c.Platform), Limit: 2, Offset: 2, Revision: first.Revision}); e != benchdb.ErrChanged {
		t.Fatal("revision not rejected", e)
	}
}

func TestSummaryChronologyAndPreservedMigrationImportTime(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	a := fixture()
	r := benchdb.Result{Row: a.Results[0], CapturedAt: "2026-10-08T04:00:00+03:00"}
	r.Source = a.Source
	if e = s.ImportBinding(ctx, "history", a.Platform, r); e != nil {
		t.Fatal(e)
	}
	r.CapturedAt = "2026-10-08T02:00:00Z"
	if e = s.ImportBinding(ctx, "latest", a.Platform, r); e != nil {
		t.Fatal(e)
	}
	stamp := []byte("2026-10-09T00:00:00Z")
	if e = s.SetMetadata(ctx, "legacy/prepared/imported/"+hash(a.Platform), stamp); e != nil {
		t.Fatal(e)
	}
	summary, e := s.Summary(ctx)
	if e != nil || len(summary.Platforms) != 1 || summary.Platforms[0].CapturedAt != r.CapturedAt || summary.Platforms[0].ImportedAt != string(stamp) {
		t.Fatal(summary, e)
	}
	found := false
	if e = s.ExportMetadata(ctx, func(key string, data []byte) error {
		if key == "prepared/imported/"+hash(a.Platform) {
			found = reflect.DeepEqual(data, stamp)
		}
		return nil
	}); e != nil || !found {
		t.Fatal(found, e)
	}
}

func TestMaterializedSampleTotalsDeduplicateAliasesAndUpgrade(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	s, e := Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	a := fixture()
	if _, e = s.Put(ctx, a); e != nil {
		t.Fatal(e)
	}
	alias := a
	src := *a.Source
	src.AsOf = "2026-10-05T00:00:00Z"
	alias.Source = &src
	if _, e = s.Put(ctx, alias); e != nil {
		t.Fatal(e)
	}
	summary, e := s.Summary(ctx)
	if e != nil {
		t.Fatal(e)
	}
	p := summary.Platforms[0]
	if p.LatestRows != 1 || p.HistoryRows != 2 || p.LatestTimingSamples != 5 || p.AllTimingSamples != 5 {
		t.Fatal(p)
	}
	next := alias
	next.CapturedAt = "2026-10-10T00:00:00Z"
	next.Results = append([]benchdb.Row(nil), alias.Results...)
	next.Results[0].SamplesNs = []float64{1, 2, 3, 4, 5}
	if _, e = s.Put(ctx, next); e != nil {
		t.Fatal(e)
	}
	summary, e = s.Summary(ctx)
	if e != nil || summary.Platforms[0].LatestTimingSamples != 5 || summary.Platforms[0].AllTimingSamples != 10 {
		t.Fatal(summary, e)
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	db, e := sql.Open("sqlite3", filepath.Join(dir, "benchmarks.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	rows, e := db.Query("SELECT name FROM sqlite_master WHERE type='trigger'")
	if e != nil {
		t.Fatal(e)
	}
	names := []string{}
	for rows.Next() {
		var n string
		rows.Scan(&n)
		names = append(names, n)
	}
	rows.Close()
	for _, n := range names {
		if _, e = db.Exec("DROP TRIGGER " + n); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = db.Exec("DROP TABLE platform_observations;DROP TABLE platform_totals;DELETE FROM metadata WHERE key='summary-schema-v2';PRAGMA user_version=1"); e != nil {
		t.Fatal(e)
	}
	db.Close()
	s, e = Open(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	upgraded, e := s.Summary(ctx)
	if e != nil || !reflect.DeepEqual(summary, upgraded) {
		t.Fatal(summary, upgraded, e)
	}
	if e = s.Integrity(ctx); e != nil {
		t.Fatal(e)
	}
}

func TestSummaryPlatformRevisionIsIndependent(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	a := fixture()
	if _, e = s.Put(ctx, a); e != nil {
		t.Fatal(e)
	}
	before, e := s.Summary(ctx)
	if e != nil {
		t.Fatal(e)
	}
	b := fixture()
	b.Platform.CPU = "Other"
	if _, e = s.Put(ctx, b); e != nil {
		t.Fatal(e)
	}
	after, e := s.Summary(ctx)
	if e != nil || before.Revision == after.Revision {
		t.Fatal(after, e)
	}
	var original benchdb.PlatformSummary
	for _, p := range after.Platforms {
		if p.ID == hash(a.Platform) {
			original = p
		}
	}
	if original.Revision == "" || original.Revision != before.Platforms[0].Revision {
		t.Fatal("other host invalidated selected platform", before, after)
	}
}

// Only the SQLite file is carried forward. Transport JSON and its directory
// disappear before reopening, including any opportunity for filesystem fallback.
func TestReopenedDatabaseOwnsRawMeasurementsWithoutTransportFiles(t *testing.T) {
	ctx := context.Background()
	transport := t.TempDir()
	originalDB := t.TempDir()
	isolatedDB := t.TempDir()
	c := fixture()
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(transport, "capture.json")
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	s, err := Open(originalDB)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Put(ctx, c); err != nil {
		s.Close()
		t.Fatal(err)
	}
	matrix, err := s.Matrix(ctx, MatrixQuery{Platform: hash(c.Platform), Phase: "steady", Limit: 10})
	if err != nil || len(matrix.Items) != 1 {
		s.Close()
		t.Fatal(matrix, err)
	}
	before, err := s.Detail(ctx, hash(c.Platform), matrix.Items[0].ObservationID)
	if err != nil {
		s.Close()
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(filepath.Join(originalDB, "benchmarks.sqlite"), filepath.Join(isolatedDB, "benchmarks.sqlite")); err != nil {
		t.Fatal(err)
	}
	if err = os.RemoveAll(transport); err != nil {
		t.Fatal(err)
	}
	if err = os.RemoveAll(originalDB); err != nil {
		t.Fatal(err)
	}
	s, err = Open(isolatedDB)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	after, err := s.Detail(ctx, hash(c.Platform), matrix.Items[0].ObservationID, c.Source.AsOf)
	if err != nil || !reflect.DeepEqual(before, after) || !reflect.DeepEqual(vector(before.SamplesNs), vector(after.SamplesNs)) {
		t.Fatal(before, after, err)
	}
	if err = s.Integrity(ctx); err != nil {
		t.Fatal(err)
	}
}
