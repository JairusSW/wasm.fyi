package benchdb

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/cockroachdb/pebble/v2"
	"testing"
)

func TestHasWorkloadSeeksCurrentBindingsAcrossPhases(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := t.Context()
	c := fixture("2026-10-08T00:00:00Z", 10)
	workload := c.Results[0].Workload
	if known, err := s.HasWorkload(ctx, workload); err != nil || known {
		t.Fatal("empty database exposed a workload", known, err)
	}
	// A workload need not have steady-state results to have a working page.
	c.Results[0].Phase = "compile"
	if _, err = s.Put(ctx, c); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]bool{workload: true, "applications/missing": false, "applications/tes": false, workload + "/child": false, "": false} {
		if got, err := s.HasWorkload(ctx, id); err != nil || got != want {
			t.Fatalf("HasWorkload(%q) = %v, %v; want %v", id, got, err, want)
		}
	}
	before, err := s.Summary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.HasWorkload(ctx, workload); err != nil {
		t.Fatal(err)
	}
	after, err := s.Summary(ctx)
	if err != nil || before.Revision != after.Revision {
		t.Fatal("lookup changed the published revision", err)
	}
	if _, err = s.RemoveEngine(ctx, c.Results[0].Engine); err != nil {
		t.Fatal(err)
	}
	if known, err := s.HasWorkload(ctx, workload); err != nil || known {
		t.Fatal("retained metadata exposed a removed workload", known, err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = s.HasWorkload(cancelled, workload); !errors.Is(err, context.Canceled) {
		t.Fatal("lookup ignored cancellation", err)
	}
}

func TestHasWorkloadPreservesHistoricalOnlyPagesAcrossDates(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for i, phase := range []string{"compile", "instantiate", "first-call", "steady", "compile"} {
		c := fixture("2026-10-08T00:00:00Z", 10)
		c.Results[0].Workload = fmt.Sprint("applications/history-", i)
		c.Results[0].Contract = fmt.Sprintf("%064x", i+10)
		c.Results[0].Phase = phase
		c.Source = &Source{Kind: "snapshot", Repository: "example/repo", Revision: strings.Repeat("a", 40), Ref: "main", AsOf: fmt.Sprintf("2026-10-%02dT00:00:00Z", i+1)}
		if _, err = s.Put(t.Context(), c); err != nil {
			t.Fatal(err)
		}
	}
	// Remove current slots only. HasWorkload must use the surviving bindings,
	// not historical contract metadata or prepared current-row counters.
	if err = s.db.DeleteRange([]byte("rows/"), prefixEnd("rows/"), pebble.Sync); err != nil {
		t.Fatal(err)
	}
	for i := range 5 {
		workload := fmt.Sprint("applications/history-", i)
		for id, want := range map[string]bool{workload: true, workload + "-child": false, "applications/history": false} {
			if got, err := s.HasWorkload(t.Context(), id); err != nil || got != want {
				t.Fatalf("historical HasWorkload(%q) = %v, %v; want %v", id, got, err, want)
			}
		}
	}
	if err = s.db.DeleteRange([]byte("history/"), prefixEnd("history/"), pebble.Sync); err != nil {
		t.Fatal(err)
	}
	if known, err := s.HasWorkload(t.Context(), "applications/history-0"); err != nil || known {
		t.Fatal("orphaned metadata became a historical page", known, err)
	}
}
