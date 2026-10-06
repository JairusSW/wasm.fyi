package store

import (
	"bytes"
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
)

func TestBackupReachabilityMatchesRequiredAndStagedClosures(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	job, objects, _, err := testutil.DisassemblyFixture("backup-closure", time.Now().UTC(), "header\n0: nop\n1: ret\n")
	if err != nil {
		t.Fatal(err)
	}
	job.Session = "backup-published-session"
	for id, data := range objects {
		if err = s.Install(id, bytes.NewReader(data)); err != nil {
			t.Fatal(err)
		}
	}
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Commit(id); err != nil {
		t.Fatal(err)
	}
	pending, _ := pagedFixture(t, "backup-pending")
	pending.Session = "backup-pending-session"
	if _, err = s.Submit(pending); err != nil {
		t.Fatal(err)
	}
	plan, rawPlan := planFixture(t)
	planID, err := s.SubmitPlan(context.Background(), plan)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	all, required, err := s.backupReachability(ctx)
	if err != nil {
		t.Fatal(err)
	}
	oldAll, err := s.reachableContext(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	oldRequired, err := s.reachableContext(ctx, false)
	if err != nil || !reflect.DeepEqual(all, oldAll) || !reflect.DeepEqual(required, oldRequired) {
		t.Fatal("backup retention semantics changed", err)
	}
	page := pending.Exports[0].Manifest.InventoryPages[0].SHA256
	if !all[page] || required[page] {
		t.Fatal("missing staged inventory became required")
	}
	for id := range required {
		if !all[id] {
			t.Fatal("required object absent from all closure", id)
		}
	}
	// The snapshot must own its map; adding staged keys cannot mutate it.
	all["staged-only-test"] = true
	if required["staged-only-test"] {
		t.Fatal("required closure aliases staged map")
	}
	chunk := plan.SessionPlan.Chunks[0].SHA256
	if !all[chunk] || required[chunk] {
		t.Fatal("staged plan chunk became required")
	}
	if err = s.InstallDeclared(chunk, bytes.NewReader(rawPlan)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.CommitPlan(ctx, planID); err != nil {
		t.Fatal(err)
	}
	all, required, err = s.backupReachability(ctx)
	if err != nil || !all[chunk] || !required[chunk] {
		t.Fatal("registered plan source not required", err)
	}
	oldRequired, err = s.reachableContext(ctx, false)
	if err != nil || !reflect.DeepEqual(required, oldRequired) {
		t.Fatal("registered required closure changed", err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, _, err = s.backupReachability(canceled); !errors.Is(err, context.Canceled) {
		t.Fatal("backup reachability ignored cancellation", err)
	}
}
