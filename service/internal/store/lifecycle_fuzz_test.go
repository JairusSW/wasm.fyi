package store

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

type lifecycleJob struct {
	job                 wire.Job
	id, state, revision string
	objects             map[string][]byte
	keys                []string
	bytes               int64
}

func FuzzImportLifecycle(f *testing.F) {
	for _, seed := range [][]byte{{0, 2, 3, 5, 8, 3}, {0, 9, 4, 11, 12, 5, 8}, {0, 1, 6, 3, 2, 3, 4}, {0, 7, 5, 4, 0, 3}, {9, 11, 12, 0, 2, 3, 12, 5}} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, operations []byte) {
		operations = operations[:min(len(operations), 24)]
		root := filepath.Join(t.TempDir(), "data")
		s := openTest(t, root)
		defer func() {
			if s != nil {
				s.Close()
			}
		}()
		cursorKey, err := s.CursorKey()
		if err != nil {
			t.Fatal(err)
		}
		jobs := []lifecycleJob{}
		for i, seed := range []string{"fuzz-a", "fuzz-b"} {
			job, objects, err := testutil.Fixture(seed, time.Date(2026, 10, 5, 0, i, 0, 0, time.UTC))
			if err != nil {
				t.Fatal(err)
			}
			b, _ := wire.Encode(job)
			m := lifecycleJob{job: job, id: wire.Hash(b), state: "unseen", objects: objects}
			for key := range objects {
				m.keys = append(m.keys, key)
			}
			sort.Strings(m.keys)
			for _, o := range job.Exports[0].Manifest.Objects {
				m.bytes += int64(o.Bytes)
			}
			jobs = append(jobs, m)
		}
		uploaded := map[string]bool{}
		current := ""
		bound := false
		backupCount := 0
		permitted := func(digest string) bool {
			for _, j := range jobs {
				if j.state == "staged" && j.objects[digest] != nil {
					return true
				}
			}
			return false
		}
		verify := func(step int) {
			t.Helper()
			if s.Current() != current {
				t.Fatalf("step %d: publication changed outside successful commit", step)
			}
			quota, err := s.quota()
			if err != nil {
				t.Fatal(err)
			}
			expectedJobs, expectedBytes := 0, int64(0)
			for _, j := range jobs {
				if j.state == "staged" {
					expectedJobs++
					expectedBytes += j.bytes
				}
				status, err := s.ImportStatus(j.id)
				if j.state == "unseen" {
					if !errors.Is(err, ErrNotFound) {
						t.Fatalf("step %d: unseen import visible: %v", step, err)
					}
					continue
				}
				if err != nil || status.State != j.state || status.Revision != j.revision {
					t.Fatalf("step %d: import state mismatch: %+v expected %s/%s error %v", step, status, j.state, j.revision, err)
				}
				if j.state == "staged" {
					missing := 0
					for _, digest := range j.keys {
						if !uploaded[digest] {
							missing++
						}
					}
					if status.Missing != missing {
						t.Fatalf("step %d: missing count %d expected %d", step, status.Missing, missing)
					}
				}
			}
			if quota.Jobs != expectedJobs || quota.Bytes != expectedBytes {
				t.Fatalf("step %d: quota %+v expected %d/%d", step, quota, expectedJobs, expectedBytes)
			}
			actualKey, err := s.CursorKey()
			if err != nil || !bytes.Equal(actualKey, cursorKey) {
				t.Fatal("recovery changed cursor secret", err)
			}
		}
		verify(-1)
		for step, command := range operations {
			which := int(command/9) % len(jobs)
			j := &jobs[which]
			switch command % 9 {
			case 0:
				id, err := s.Submit(j.job)
				if j.state == "aborted" {
					if !errors.Is(err, ErrConflict) {
						t.Fatal("aborted delivery reused", err)
					}
				} else {
					if err != nil || id != j.id {
						t.Fatal("submit identity changed", id, err)
					}
					if j.state == "unseen" {
						j.state = "staged"
					}
					bound = true
				}
			case 1, 2, 6:
				keys := j.keys
				if command%9 != 2 {
					keys = keys[int(command/18)%len(keys) : int(command/18)%len(keys)+1]
				}
				for _, digest := range keys {
					data := append([]byte{}, j.objects[digest]...)
					corrupt := command%9 == 6
					if corrupt {
						data[0] ^= 1
					}
					err := s.InstallDeclared(digest, bytes.NewReader(data))
					if !permitted(digest) {
						if !errors.Is(err, ErrUndeclared) {
							t.Fatal("closed grant accepted upload", err)
						}
					} else if corrupt {
						if !errors.Is(err, wire.ErrInvalid) {
							t.Fatal("corrupt bytes admitted", err)
						}
					} else {
						if err != nil {
							t.Fatal(err)
						}
						uploaded[digest] = true
					}
				}
			case 3:
				revision, err := s.Commit(j.id)
				switch j.state {
				case "unseen":
					if !errors.Is(err, ErrNotFound) {
						t.Fatal("unsubmitted import committed", err)
					}
				case "aborted":
					if !errors.Is(err, ErrConflict) {
						t.Fatal("aborted import committed", err)
					}
				case "published":
					if err != nil || revision != j.revision {
						t.Fatal("retry changed accepted revision", err)
					}
				case "staged":
					complete := true
					for _, digest := range j.keys {
						if !uploaded[digest] {
							complete = false
						}
					}
					if complete {
						if err != nil {
							t.Fatal("complete import failed", err)
						}
						j.state = "published"
						j.revision = revision
						current = revision
					} else if err == nil {
						t.Fatal("partial import published")
					}
				}
			case 4:
				err := s.Abort(j.id)
				switch j.state {
				case "unseen":
					if !errors.Is(err, ErrNotFound) {
						t.Fatal("unseen abort succeeded", err)
					}
				case "published":
					if !errors.Is(err, ErrConflict) {
						t.Fatal("accepted import aborted", err)
					}
				default:
					if err != nil {
						t.Fatal("abort not idempotent", err)
					}
					j.state = "aborted"
				}
			case 5:
				if err := s.Close(); err != nil {
					t.Fatal(err)
				}
				s = nil
				s = openTest(t, root)
			case 7:
				if bound {
					conflict := j.job
					conflict.Plan = wire.Hash([]byte("different immutable plan"))
					if _, err := s.Submit(conflict); !errors.Is(err, ErrConflict) {
						t.Fatal("immutable plan drift admitted", err)
					}
				}
			case 8:
				if backupCount < 2 {
					destination := filepath.Join(t.TempDir(), "backup")
					manifest, err := s.Backup(context.Background(), destination)
					if err != nil || manifest.Current != current {
						t.Fatal("backup publication drift", err)
					}
					if _, err = VerifyBackup(context.Background(), destination); err != nil {
						t.Fatal("lifecycle backup incomplete", err)
					}
					backupCount++
				}
			}
			verify(step)
		}
	})
}
