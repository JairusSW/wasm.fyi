package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
)

func TestRebuildPublishedJobsDoesNotReservePendingImports(t *testing.T) {
	root := t.TempDir()
	source := openTest(t, filepath.Join(root, "source"))
	defer source.Close()
	revision := publishTest(t, source, "published", time.Now().UTC())
	backup := filepath.Join(root, "backup")
	if _, err := source.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	limits := DefaultLimits()
	limits.PendingJobs = 1
	limits.PendingBytes = 1
	destination := filepath.Join(root, "rebuild")
	if err := RebuildWithLimits(backup, destination, "recovered", limits); err != nil {
		t.Fatal("recovery re-admitted already published bytes", err)
	}
	target, err := OpenWithLimits(destination, "recovered", limits)
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	if target.Current() != revision {
		t.Fatal("lost published revision")
	}
	quota, err := target.quota()
	if err != nil || quota.Jobs != 0 || quota.Bytes != 0 {
		t.Fatal("rebuild retained staging reservations", quota, err)
	}
	original, err := source.Revision(revision)
	if err != nil {
		t.Fatal(err)
	}
	job, err := source.Job(original.Job)
	if err != nil {
		t.Fatal(err)
	}
	id, err := target.Submit(job)
	if err != nil || id != original.Job {
		t.Fatal("acknowledged duplicate required pending quota", err)
	}
	if actual, err := target.Commit(id); err != nil || actual != revision {
		t.Fatal("lost acknowledged receipt", actual, err)
	}
	newJob, _, err := testutil.Fixture("new-unpublished", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = target.Submit(newJob); !errors.Is(err, ErrQuota) {
		t.Fatal("new imports bypassed normal admission", err)
	}
}
