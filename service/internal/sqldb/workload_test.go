package sqldb

import (
	"context"
	"errors"
	"testing"
)

func TestHasWorkloadRequiresPublishedBinding(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := t.Context()
	c := fixture()
	workload := c.Results[0].Workload
	if known, err := s.HasWorkload(ctx, workload); err != nil || known {
		t.Fatal("empty database exposed a workload", known, err)
	}
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
	if _, err = s.RemoveRevision(ctx, c.Results[0].Engine, c.Source.Revision); err != nil {
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

func TestHasWorkloadPreservesHistoricalOnlyPages(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	c := fixture()
	if _, err = s.Put(t.Context(), c); err != nil {
		t.Fatal(err)
	}
	// Keep the historical binding and its metadata after the current slot goes.
	if _, err = s.writer.ExecContext(t.Context(), "DELETE FROM latest"); err != nil {
		t.Fatal(err)
	}
	workload := c.Results[0].Workload
	for id, want := range map[string]bool{workload: true, "applications/missing": false, "applications/tes": false, workload + "/child": false} {
		if got, err := s.HasWorkload(t.Context(), id); err != nil || got != want {
			t.Fatalf("historical HasWorkload(%q) = %v, %v; want %v", id, got, err, want)
		}
	}
	if _, err = s.writer.ExecContext(t.Context(), "DELETE FROM history"); err != nil {
		t.Fatal(err)
	}
	if known, err := s.HasWorkload(t.Context(), workload); err != nil || known {
		t.Fatal("orphaned metadata became a historical page", known, err)
	}
}

func TestWorkloadHistoryIndexAddedToExistingDatabase(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.writer.ExecContext(t.Context(), "DROP INDEX history_workload"); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var name string
	if err = s.reader.QueryRowContext(t.Context(), "SELECT name FROM sqlite_master WHERE type='index' AND name='history_workload'").Scan(&name); err != nil {
		t.Fatal("existing database did not receive workload index", err)
	}
}
