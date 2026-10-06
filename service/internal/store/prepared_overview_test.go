package store

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/comparison"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/cockroachdb/pebble/v2"
)

func TestPreparedOverviewParityAndPortable(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	s := openTest(t, filepath.Join(root, "live"))
	defer s.Close()
	rev := publishCohort(t, s, "prepared", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}, {Runtime: "b", Workload: "fixture/one", Value: 16}})
	scope := cohortScope(t, s, rev)
	cohort, e := s.ComputeCohort(ctx, scope)
	if e != nil {
		t.Fatal(e)
	}
	expected, e := s.BuildOverview(&cohort)
	if e != nil {
		t.Fatal(e)
	}
	prepared, e := s.PrepareOverview(ctx, scope)
	if e != nil || !reflect.DeepEqual(prepared, expected) {
		t.Fatal("projection drift", prepared, e)
	}
	duplicate, e := s.PrepareOverview(ctx, scope)
	if e != nil || !reflect.DeepEqual(duplicate, expected) || s.overviewCount != 1 {
		t.Fatal(duplicate, e, s.overviewCount)
	}
	backup := filepath.Join(root, "backup")
	if _, e = s.Backup(ctx, backup); e != nil {
		t.Fatal(e)
	}
	for _, mode := range []string{"restore", "rebuild"} {
		dest := filepath.Join(root, mode)
		if mode == "restore" {
			e = Restore(ctx, backup, dest, "fixture")
		} else {
			e = Rebuild(backup, dest, "fixture")
		}
		if e != nil {
			t.Fatal(mode, e)
		}
		copy, e := Open(dest, "fixture")
		if e != nil {
			t.Fatal(e)
		}
		got, e := copy.PreparedOverview(ctx, scope)
		if e != nil || !reflect.DeepEqual(got, expected) {
			t.Fatal(mode, got, e)
		}
		copy.Close()
	}
	// Break the result-selection path only after portable verification. A prepared
	// read must remain independent of a complete cohort scan.
	original := s.published[rev]
	broken := original
	broken.Selection = "invalid"
	s.published[rev] = broken
	if _, e = s.ComputeCohort(ctx, scope); e == nil {
		t.Fatal("broken selection remained computable")
	}
	got, e := s.PreparedOverview(ctx, scope)
	s.published[rev] = original
	if e != nil || !reflect.DeepEqual(got, expected) {
		t.Fatal("prepared read scanned results", got, e)
	}
}
func TestPreparedOverviewFaultVisibility(t *testing.T) {
	for _, stage := range []string{"overview-before-commit", "overview-after-commit"} {
		t.Run(stage, func(t *testing.T) {
			ctx := context.Background()
			root := t.TempDir()
			s := openTest(t, root)
			rev := publishCohort(t, s, "fault", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}, {Runtime: "b", Workload: "fixture/one", Value: 16}})
			scope := cohortScope(t, s, rev)
			injected := errors.New("fault")
			s.fail = func(at string) error {
				if at == stage {
					return injected
				}
				return nil
			}
			if _, e := s.PrepareOverview(ctx, scope); !errors.Is(e, injected) {
				t.Fatal(e)
			}
			if _, e := s.PreparedOverview(ctx, scope); e != ErrNotFound {
				t.Fatal("unacknowledged view exposed", e)
			}
			s.Close()
			s, e := Open(root, "fixture")
			if e != nil {
				t.Fatal(e)
			}
			defer s.Close()
			if _, e = s.PrepareOverview(ctx, scope); e != nil {
				t.Fatal(e)
			}
		})
	}
}

func TestPreparedOverviewDoesNotReuseOlderCompatibilityPolicy(t *testing.T) {
	ctx := context.Background()
	s := openTest(t, t.TempDir())
	defer s.Close()
	revision := publishCohort(t, s, "compatibility-projection", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}})
	scope, e := s.NormalizeCohort(cohortScope(t, s, revision))
	if e != nil {
		t.Fatal(e)
	}
	cohort, e := s.ComputeCohort(ctx, scope)
	if e != nil {
		t.Fatal(e)
	}
	old, e := s.BuildOverview(&cohort)
	if e != nil {
		t.Fatal(e)
	}
	old.Interpretation.Version = "wasmfyi-cohort-v3"
	object, e := s.put(old)
	if e != nil {
		t.Fatal(e)
	}
	root, e := s.mapSet(s.overviewRoot(), overviewVersionKey(scope, old.Interpretation.Version, comparison.CategoryVersion), object, 0)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.db.Set(key("overviews"), []byte(root), pebble.Sync); e != nil {
		t.Fatal(e)
	}
	s.overviews = root
	s.overviewCount = 1
	if e = s.portableRoots(s.Current(), s.registrationRoot(), root); e != nil {
		t.Fatal(e)
	}
	if _, e = s.PreparedOverview(ctx, scope); !errors.Is(e, ErrNotFound) {
		t.Fatal("older compatibility projection reused", e)
	}
	current, e := s.PrepareOverview(ctx, scope)
	if e != nil || current.Interpretation.Version != comparison.Version || s.overviewCount != 2 {
		t.Fatal("new policy projection not prepared separately", e)
	}
	if !reflect.DeepEqual(current.Cards, old.Cards) {
		t.Fatal("valid point estimates drifted")
	}
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e = s.Backup(ctx, backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if e = Rebuild(backup, rebuilt, "fixture"); e != nil {
		t.Fatal(e)
	}
	recovered := openTest(t, rebuilt)
	defer recovered.Close()
	got, e := recovered.PreparedOverview(ctx, scope)
	if e != nil || !reflect.DeepEqual(got, current) {
		t.Fatal("version-separated projections not portable", e)
	}
}
