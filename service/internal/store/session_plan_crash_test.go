package store

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func stagePlanCrash(t *testing.T, s *Store) string {
	t.Helper()
	j, objects := plannedFixture(t, "plan-crash", "local", "corpus-0001", true)
	id, e := s.Submit(j)
	if e != nil {
		t.Fatal(e)
	}
	missing, e := s.Missing(id)
	if e != nil {
		t.Fatal(e)
	}
	for _, o := range missing {
		if e := s.InstallDeclared(o.SHA256, bytes.NewReader(objects[o.SHA256])); e != nil {
			t.Fatal(e)
		}
	}
	return id
}
func TestSessionPlanCrashHelper(t *testing.T) {
	point := os.Getenv("WASMFYI_TEST_PLAN_CRASH_POINT")
	if point == "" {
		return
	}
	s := openTest(t, os.Getenv("WASMFYI_TEST_PLAN_CRASH_ROOT"))
	id := stagePlanCrash(t, s)
	s.fail = func(stage string) error {
		if point == stage {
			os.Exit(99)
		}
		return nil
	}
	if _, e := s.Commit(id); e != nil {
		t.Fatal(e)
	}
	t.Fatal("crash point not reached")
}
func TestActualSessionPlanCrashPublicationAndRebuild(t *testing.T) {
	binary, e := os.Executable()
	if e != nil {
		t.Fatal(e)
	}
	for _, point := range []string{"files", "indexes", "before-commit", "after-commit", "after-portable"} {
		t.Run(point, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "live")
			crashContext, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			command := exec.CommandContext(crashContext, binary, "-test.run=^TestSessionPlanCrashHelper$")
			command.Env = append(os.Environ(), "WASMFYI_TEST_PLAN_CRASH_POINT="+point, "WASMFYI_TEST_PLAN_CRASH_ROOT="+root)
			output, e := command.CombinedOutput()
			var exit *exec.ExitError
			if !errors.As(e, &exit) || exit.ExitCode() != 99 {
				t.Fatalf("did not crash at %s: %v %s", point, e, output)
			}
			s := openTest(t, root)
			defer s.Close()
			ctx := context.Background()
			committed := point == "after-commit" || point == "after-portable"
			if committed != (s.Current() != "") {
				t.Fatal("wrong public boundary")
			}
			if !committed {
				if _, e := s.SessionInfo(ctx, "", "synthetic-session"); !errors.Is(e, ErrNotFound) {
					t.Fatal("unpublished plan visible", e)
				}
				j, objects := plannedFixture(t, "plan-crash", "local", "corpus-0001", true)
				id, e := s.Submit(j)
				if e != nil {
					t.Fatal(e)
				}
				chunk := j.SessionPlan.Chunks[0]
				if e := os.Remove(filepath.Join(root, "objects", chunk.SHA256)); e != nil {
					t.Fatal(e)
				}
				if _, e := s.Commit(id); e == nil || s.Current() != "" {
					t.Fatal("missing plan published")
				}
				missing, e := s.Missing(id)
				if e != nil || len(missing) != 1 || missing[0] != chunk {
					t.Fatal(missing, e)
				}
				if e := s.InstallDeclared(chunk.SHA256, bytes.NewReader(objects[chunk.SHA256])); e != nil {
					t.Fatal(e)
				}
			}
			id := stagePlanCrash(t, s)
			revision, e := s.Commit(id)
			if e != nil {
				t.Fatal(e)
			}
			check := func(s *Store) {
				t.Helper()
				info, e := s.SessionInfo(ctx, revision, "synthetic-session")
				if e != nil || info.PlannedJobs == nil || *info.PlannedJobs != 4 || info.PublishedCorpusJobs != 1 || info.CollectionComplete == nil || *info.CollectionComplete {
					t.Fatal(info, e)
				}
			}
			check(s)
			if again, e := s.Commit(id); e != nil || again != revision {
				t.Fatal("receipt lost", again, e)
			}
			backup := filepath.Join(t.TempDir(), "backup")
			if _, e := s.Backup(ctx, backup); e != nil {
				t.Fatal(e)
			}
			rebuilt := filepath.Join(t.TempDir(), "rebuilt")
			if e := Rebuild(backup, rebuilt, "test"); e != nil {
				t.Fatal(e)
			}
			r := openTest(t, rebuilt)
			defer r.Close()
			check(r)
		})
	}
}
