package store

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
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
