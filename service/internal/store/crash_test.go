package store

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestStoreCrashHelper(t *testing.T) {
	stageName := os.Getenv("WASMFYI_TEST_CRASH_STAGE")
	if stageName == "" {
		return
	}
	s := openTest(t, os.Getenv("WASMFYI_TEST_CRASH_ROOT"))
	if os.Getenv("WASMFYI_TEST_OFFLINE") == "1" {
		s.EnableOfflineImport()
	}
	date := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	id := stage(t, s, "crash-new", date.Add(time.Hour))
	s.fail = func(stage string) error {
		if stage == stageName {
			os.Exit(99)
		}
		return nil
	}
	if _, e := s.Commit(id); e != nil {
		t.Fatal(e)
	}
	t.Fatal("crash stage was not reached")
}
func TestActualProcessCrashPublicationStages(t *testing.T) {
	testProcessCrashPublicationStages(t, false)
}

func TestActualOfflineCrashPublicationStages(t *testing.T) {
	testProcessCrashPublicationStages(t, true)
}

func testProcessCrashPublicationStages(t *testing.T, offline bool) {
	binary, e := os.Executable()
	if e != nil {
		t.Fatal(e)
	}
	for _, stageName := range []string{"files", "indexes", "before-commit", "after-commit", "after-portable"} {
		t.Run(stageName, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "data")
			s := openTest(t, root)
			date := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
			previous := publishTest(t, s, "first", date)
			if e = s.Close(); e != nil {
				t.Fatal(e)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, binary, "-test.run=^TestStoreCrashHelper$")
			command.Env = append(os.Environ(), "WASMFYI_TEST_CRASH_STAGE="+stageName, "WASMFYI_TEST_CRASH_ROOT="+root)
			if offline {
				command.Env = append(command.Env, "WASMFYI_TEST_OFFLINE=1")
			}
			output, e := command.CombinedOutput()
			exit, ok := e.(*exec.ExitError)
			if !ok || exit.ExitCode() != 99 {
				t.Fatalf("helper did not crash at requested stage: %v %s", e, output)
			}
			s = openTest(t, root)
			defer s.Close()
			committed := stageName == "after-commit" || stageName == "after-portable"
			if committed == (s.Current() == previous) {
				t.Fatal("recovered wrong publication boundary")
			}
			rows, e := s.Results(Query{Revision: s.Current()}, true)
			want := 3
			if committed {
				want = 6
			}
			if e != nil || len(rows) != want {
				t.Fatalf("partial or lost history after crash: %d %v", len(rows), e)
			}
			id := stage(t, s, "crash-new", date.Add(time.Hour))
			if _, e = s.Commit(id); e != nil {
				t.Fatal("idempotent recovery failed", e)
			}
			rows, e = s.Results(Query{Revision: s.Current()}, true)
			if e != nil || len(rows) != 6 {
				t.Fatal("redelivery duplicated crash evidence")
			}
		})
	}
}
