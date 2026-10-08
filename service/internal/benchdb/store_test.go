package benchdb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/cockroachdb/pebble/v2"
	"strings"
	"sync"
	"testing"
	"time"
)

func fixture(stamp string, value float64) Capture {
	rss, code := 4096.0, 64.0
	return Capture{CapturedAt: stamp, Platform: Platform{OS: "linux", Arch: "amd64", CPU: "Fixture", Cores: 8, Kernel: "test"}, Results: []Row{{Workload: "applications/test", Wasm: "test.wasm", Artifact: fmt.Sprintf("%064x", 1), Contract: fmt.Sprintf("%064x", 2), Engine: "wazero", Version: "1", Backend: "compiler", Phase: "steady", Status: "ok", Value: &value, PeakRSS: &rss, CodeBytes: &code, MemoryStatus: "ok", CodeStatus: "ok", CodeKind: func() *string { kind := "native-image"; return &kind }()}}}
}
func TestCaptureReplacementPersistenceAndMetadataReclamation(t *testing.T) {
	ctx := context.Background()
	path := t.TempDir()
	s, e := Open(path)
	if e != nil {
		t.Fatal(e)
	}
	first := fixture("2026-10-08T00:00:00Z", 10)
	id, e := s.Put(ctx, first)
	if e != nil {
		t.Fatal(e)
	}
	page, e := s.Page(ctx, Query{Limit: 1, Platform: identifier(first.Platform)})
	if e != nil {
		t.Fatal(e)
	}
	pin := s.cursor(pageCursor{page.Revision, page.Platform, page.Phase, "rows/" + page.Platform + "/steady/" + first.Results[0].Workload + "\x00wazero"})
	if page.Total != 1 || len(page.Items) != 1 || *page.Items[0].PeakRSS != 4096 || *page.Items[0].CodeBytes != 64 {
		t.Fatal(page)
	}
	next := fixture("2026-10-08T01:00:00Z", 20)
	next.Results[0].Version = "2"
	next.Results[0].Contract = fmt.Sprintf("%064x", 3)
	replaced, e := s.Put(ctx, next)
	if e != nil || id != replaced {
		t.Fatal(replaced, e)
	}
	if _, e = s.Page(ctx, Query{Limit: 1, Cursor: pin}); !errors.Is(e, ErrChanged) {
		t.Fatal(e)
	}
	stale := fixture("2026-10-08T00:30:00Z", 2)
	if _, e = s.Put(ctx, stale); e != nil {
		t.Fatal(e)
	}
	page, e = s.Page(ctx, Query{Limit: 1, Platform: identifier(fixture("", 0).Platform)})
	if e != nil || page.Total != 1 || *page.Items[0].Value != 20 || page.Items[0].Version != "2" {
		t.Fatal(page, e)
	}
	if _, e = get(s.db, "contracts/"+first.Results[0].Contract); !errors.Is(e, pebble.ErrNotFound) {
		t.Fatal("old contract metadata retained", e)
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	s, e = Open(path)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	page, e = s.Page(ctx, Query{Limit: 1, Platform: identifier(fixture("", 0).Platform)})
	if e != nil || *page.Items[0].Value != 20 {
		t.Fatal(page, e)
	}

}
func TestAtomicValidationAndPlatformPhaseIsolation(t *testing.T) {
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	ctx := context.Background()
	c := fixture("2026-10-08T00:00:00Z", 1)
	c.Results = append(c.Results, c.Results[0])
	c.Results[1].Phase = "compile"
	c.Results[1].Wasm = "different.wasm"
	if _, e = s.Put(ctx, c); e == nil {
		t.Fatal("conflicting contract metadata accepted")
	}
	empty, e := s.Platforms(ctx)
	if e != nil || len(empty.Items) != 0 {
		t.Fatal("partial transaction visible", empty, e)
	}
	c.Results[1].Wasm = "test.wasm"
	if _, e = s.Put(ctx, c); e != nil {
		t.Fatal(e)
	}
	page, e := s.Page(ctx, Query{Limit: 1, Platform: identifier(c.Platform), Phase: "compile"})
	if e != nil || page.Total != 1 || page.Items[0].Phase != "compile" {
		t.Fatal(page, e)
	}
	other := fixture("2026-10-08T00:00:00Z", 3)
	other.Platform.CPU = "Another CPU"
	if _, e = s.Put(ctx, other); e != nil {
		t.Fatal(e)
	}
	page, e = s.Page(ctx, Query{Limit: 1, Platform: page.Platform, Phase: "steady"})
	if e != nil || page.Total != 1 || *page.Items[0].Value != 1 {
		t.Fatal(page, e)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, e = s.Put(canceled, fixture("2026-10-08T03:00:00Z", 100)); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
}
func BenchmarkCaptureCommit(b *testing.B) {
	s, e := Open(b.TempDir())
	if e != nil {
		b.Fatal(e)
	}
	defer s.Close()
	ctx := context.Background()
	c := fixture("2026-10-08T00:00:00Z", 1)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c.CapturedAt = time.Unix(1800000000, int64(i)).UTC().Format(time.RFC3339Nano)
		if _, e = s.Put(ctx, c); e != nil {
			b.Fatal(e)
		}
	}
}
func BenchmarkIndexedPage(b *testing.B) {
	s, e := Open(b.TempDir())
	if e != nil {
		b.Fatal(e)
	}
	defer s.Close()
	ctx := context.Background()
	for i := 0; i < 1000; i++ {
		c := fixture("2026-10-08T00:00:00Z", 1)
		c.Results[0].Workload = fmt.Sprintf("applications/%04d", i)
		c.Results[0].Contract = fmt.Sprintf("%064x", i+100)
		if _, e = s.Put(ctx, c); e != nil {
			b.Fatal(e)
		}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, e = s.Page(ctx, Query{Limit: 100, Platform: identifier(fixture("", 0).Platform)}); e != nil {
			b.Fatal(e)
		}
	}
}

func TestConcurrentPublicationAndSnapshotReads(t *testing.T) {
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	ctx := context.Background()
	failures := make(chan error, 100)
	var writers sync.WaitGroup
	for i := 0; i < 16; i++ {
		writers.Add(1)
		go func(i int) {
			defer writers.Done()
			c := fixture(time.Unix(1800000000, int64(i)).UTC().Format(time.RFC3339Nano), float64(i))
			c.Results[0].Version = fmt.Sprint(i)
			_, e := s.Put(ctx, c)
			if e != nil {
				failures <- e
			}
		}(i)
	}
	for i := 0; i < 40; i++ {
		page, e := s.Page(ctx, Query{Limit: 100, Platform: identifier(fixture("", 0).Platform)})
		if errors.Is(e, ErrNotFound) {
			continue
		}
		if e != nil {
			failures <- e
			continue
		}
		if len(page.Items) != page.Total {
			failures <- fmt.Errorf("snapshot total differs from rows")
		}
		for _, row := range page.Items {
			if row.Value == nil || row.Version == "" || row.Wasm == "" {
				failures <- fmt.Errorf("incomplete snapshot metadata")
			}
		}
	}
	writers.Wait()
	close(failures)
	for e := range failures {
		t.Error(e)
	}
	page, e := s.Page(ctx, Query{Limit: 1, Platform: identifier(fixture("", 0).Platform)})
	if e != nil || page.Total != 1 || *page.Items[0].Value != 15 || page.Items[0].Version != "15" {
		t.Fatal(page, e)
	}
}

func TestCursorPagesAreBoundedToRevisionAndScope(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	s, e := Open(root)
	if e != nil {
		t.Fatal(e)
	}
	c := fixture("2026-10-08T00:00:00Z", 1)
	base := c.Results[0]
	for i := 1; i < 4; i++ {
		row := base
		row.Workload = fmt.Sprintf("applications/test-%d", i)
		row.Contract = fmt.Sprintf("%064x", i+50)
		c.Results = append(c.Results, row)
	}
	if _, e = s.Put(ctx, c); e != nil {
		t.Fatal(e)
	}
	page, e := s.Page(ctx, Query{Platform: identifier(c.Platform), Limit: 2})
	if e != nil || len(page.Items) != 2 || page.NextCursor == nil {
		t.Fatal(page, e)
	}
	token := *page.NextCursor
	next, e := s.Page(ctx, Query{Cursor: token, Limit: 2})
	if e != nil || len(next.Items) != 2 || next.NextCursor != nil || next.Items[0].Workload == page.Items[1].Workload {
		t.Fatal(next, e)
	}
	if _, e = s.Page(ctx, Query{Cursor: token, Phase: "compile", Limit: 1}); e == nil {
		t.Fatal("cursor accepted a changed scope")
	}
	parts := strings.Split(token, ".")
	if parts[1][0] == 'A' {
		parts[1] = "B" + parts[1][1:]
	} else {
		parts[1] = "A" + parts[1][1:]
	}
	if _, e = s.Page(ctx, Query{Cursor: strings.Join(parts, "."), Limit: 1}); e == nil {
		t.Fatal("tampered cursor accepted")
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	s, e = Open(root)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	if _, e = s.Page(ctx, Query{Cursor: token, Limit: 2}); e != nil {
		t.Fatal("cursor failed after server restart", e)
	}
	newer := fixture("2026-10-08T01:00:00Z", 2)
	if _, e = s.Put(ctx, newer); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Page(ctx, Query{Cursor: token, Limit: 2}); !errors.Is(e, ErrChanged) {
		t.Fatal("stale revision accepted", e)
	}
}

func TestOtherPlatformPublicationDoesNotInvalidateCursor(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	c := fixture("2026-10-08T00:00:00Z", 1)
	second := c.Results[0]
	second.Workload = "applications/second"
	second.Contract = fmt.Sprintf("%064x", 88)
	c.Results = append(c.Results, second)
	if _, e = s.Put(ctx, c); e != nil {
		t.Fatal(e)
	}
	first, e := s.Page(ctx, Query{Platform: identifier(c.Platform), Limit: 1})
	if e != nil || first.NextCursor == nil {
		t.Fatal(first, e)
	}
	other := fixture("2026-10-08T01:00:00Z", 20)
	other.Platform.CPU = "Another CPU"
	if _, e = s.Put(ctx, other); e != nil {
		t.Fatal(e)
	}
	next, e := s.Page(ctx, Query{Cursor: *first.NextCursor, Limit: 1})
	if e != nil || next.Revision != first.Revision || len(next.Items) != 1 || next.NextCursor != nil {
		t.Fatal("unrelated platform invalidated cursor", next, e)
	}
	// Same-platform publication still invalidates old pages, including new phases.
	c.CapturedAt = "2026-10-08T02:00:00Z"
	c.Results[0].Phase = "compile"
	c.Results = c.Results[:1]
	if _, e = s.Put(ctx, c); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Page(ctx, Query{Cursor: *first.NextCursor, Limit: 1}); !errors.Is(e, ErrChanged) {
		t.Fatal("same-platform cursor was not invalidated", e)
	}
}
func TestResultPreservesCaptureTimeAndCodeDefinition(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	c := fixture("2026-10-08T00:00:00Z", 1)
	if _, e = s.Put(ctx, c); e != nil {
		t.Fatal(e)
	}
	page, e := s.Page(ctx, Query{Platform: identifier(c.Platform), Limit: 1})
	if e != nil {
		t.Fatal(e)
	}
	r := page.Items[0]
	if r.CapturedAt != c.CapturedAt || r.CodeKind == nil || *r.CodeKind != "native-image" {
		t.Fatal(r)
	}
	c.CapturedAt = "2026-10-08T01:00:00Z"
	c.Results[0].CodeKind = nil
	if _, e = s.Put(ctx, c); e == nil {
		t.Fatal("unclassified code measurement accepted")
	}
}

func TestUnclassifiedExistingCodeRemainsUnknown(t *testing.T) {
	ctx := context.Background()
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	c := fixture("2026-10-08T00:00:00Z", 1)
	if _, e = s.Put(ctx, c); e != nil {
		t.Fatal(e)
	}
	key := "rows/" + identifier(c.Platform) + "/steady/" + c.Results[0].Workload + "\x00" + c.Results[0].Engine
	raw, e := get(s.db, key)
	if e != nil {
		t.Fatal(e)
	}
	var old measurement
	if e = json.Unmarshal(raw, &old); e != nil {
		t.Fatal(e)
	}
	old.CodeKind = nil
	if e = s.db.Set([]byte(key), encode(old), pebble.Sync); e != nil {
		t.Fatal(e)
	}
	page, e := s.Page(ctx, Query{Platform: identifier(c.Platform), Limit: 1})
	if e != nil || page.Items[0].CodeKind == nil || *page.Items[0].CodeKind != "unknown" {
		t.Fatal(page, e)
	}
}

func TestHistoricalCapturesRetainVersionsWithoutReplacingCurrent(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	current := fixture("2026-10-08T02:00:00Z", 10)
	current.Source = &Source{Repository: "example/engine", Revision: "current", Ref: "main", Kind: "main", AsOf: "2026-10-07T12:00:00Z"}
	current.Results[0].Display = &Display{Group: "Compression", Purpose: "Decode fixture", ABI: "core", Bytes: 128, Tags: []string{"scalar"}, Reset: "stateless"}
	if _, err = s.Put(ctx, current); err != nil {
		t.Fatal(err)
	}
	old := fixture("2026-10-08T03:00:00Z", 20)
	old.Results[0].Version = "old"
	old.Source = &Source{Repository: "example/engine", Revision: "old", Ref: "v0", Kind: "release", AsOf: "2026-05-01T12:00:00Z", DateBasis: "go-module-commit"}
	if _, err = s.Put(ctx, old); err != nil {
		t.Fatal(err)
	}
	page, err := s.Page(ctx, Query{Platform: identifier(current.Platform), Limit: 100})
	if err != nil || page.Total != 1 || page.Items[0].Version != "1" {
		t.Fatal(page, err)
	}
	history, err := s.Page(ctx, Query{History: true, Platform: page.Platform, Limit: 1})
	if err != nil || history.Total != 2 || history.Items[0].Source.Ref != "v0" || history.Items[0].Source.DateBasis != "go-module-commit" || history.NextCursor == nil {
		t.Fatal(history, err)
	}
	next, err := s.Page(ctx, Query{History: true, Cursor: *history.NextCursor, Limit: 1})
	if err != nil || next.Items[0].Source.Ref != "main" || next.Items[0].Display.Purpose != "Decode fixture" {
		t.Fatal(next, err)
	}
	if _, err = s.Page(ctx, Query{Cursor: *history.NextCursor, Limit: 1}); err == nil {
		t.Fatal("history cursor accepted on current route")
	}
	if _, err = s.Put(ctx, old); err != nil {
		t.Fatal(err)
	}
	history, err = s.Page(ctx, Query{History: true, Platform: page.Platform, Limit: 100})
	if err != nil || history.Total != 2 {
		t.Fatal(history, err)
	}
}

func TestCurrentUsesNewestQualifiedSourceRegardlessOfCollectionOrder(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	installed := fixture("2026-10-08T03:00:00Z", 46)
	installed.Source = &Source{Repository: "example/engine", Revision: "46", Ref: "46", Kind: "current", AsOf: "2026-10-08T00:00:00Z"}
	installed.Results[0].Version = "46"
	if _, err := s.Put(ctx, installed); err != nil {
		t.Fatal(err)
	}
	latest := fixture("2026-10-08T02:00:00Z", 49)
	latest.Source = &Source{Repository: "example/engine", Revision: strings.Repeat("b", 40), Ref: "main", Kind: "snapshot", AsOf: "2026-10-04T00:00:00Z"}
	latest.Results[0].Version = "49"
	if _, err := s.Put(ctx, latest); err != nil {
		t.Fatal(err)
	}
	older := fixture("2026-10-08T04:00:00Z", 48)
	older.Source = &Source{Repository: "example/engine", Revision: strings.Repeat("a", 40), Ref: "old", Kind: "snapshot", AsOf: "2026-09-01T00:00:00Z"}
	older.Results[0].Version = "48"
	if _, err := s.Put(ctx, older); err != nil {
		t.Fatal(err)
	}
	page, err := s.Page(ctx, Query{Platform: identifier(latest.Platform), Limit: 100})
	if err != nil || len(page.Items) != 1 || page.Items[0].Version != "49" {
		t.Fatal(page, err)
	}
	history, err := s.Page(ctx, Query{History: true, Platform: page.Platform, Limit: 100})
	if err != nil || history.Total != 3 {
		t.Fatal(history, err)
	}
}

func TestTimingSamplesPersistAndRejectInvalidArrays(t *testing.T) {
	c := fixture("2026-10-08T00:00:00Z", 3)
	c.Results[0].TimingSamples = 5
	c.Results[0].SamplesNs = []float64{1, 2, 3, 4, 5}
	if err := Validate(c); err != nil {
		t.Fatal(err)
	}
	db, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Put(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	page, err := db.Page(context.Background(), Query{Phase: "steady", Platform: identifier(c.Platform), Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || len(page.Items[0].SamplesNs) != 5 || page.Items[0].SamplesNs[4] != 5 {
		t.Fatal("timing samples were not preserved", page)
	}
	c.Results[0].SamplesNs = []float64{1, 2}
	if Validate(c) == nil {
		t.Fatal("accepted a mismatched sample count")
	}
}
