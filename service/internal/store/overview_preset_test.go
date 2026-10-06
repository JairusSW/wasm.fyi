package store

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
)

func TestOverviewPresetPublicationAndRebuild(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	s := openTest(t, filepath.Join(root, "live"))
	defer s.Close()
	first := publishCohort(t, s, "first-preset", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}, {Runtime: "b", Workload: "fixture/one", Value: 16}})
	scope := cohortScope(t, s, first)
	preset, e := s.RegisterOverviewPreset(ctx, "execution", scope)
	if e != nil || preset.Scope.Revision != "" || preset.SeedRevision != first {
		t.Fatal(preset, e)
	}
	next := publishCohort(t, s, "second-preset", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/two", Value: 16}, {Runtime: "b", Workload: "fixture/two", Value: 64}})
	scope.Revision = next
	prepared, e := s.PreparedOverview(ctx, scope)
	if e != nil {
		t.Fatal("publication omitted preset", e)
	}
	cohort, e := s.ComputeCohort(ctx, scope)
	if e != nil {
		t.Fatal(e)
	}
	expected, e := s.BuildOverview(&cohort)
	if e != nil || !reflect.DeepEqual(prepared, expected) {
		t.Fatal("automatic projection drift", e)
	}
	backup := filepath.Join(root, "backup")
	if _, e = s.Backup(ctx, backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(root, "rebuilt")
	if e = Rebuild(backup, rebuilt, "fixture"); e != nil {
		t.Fatal(e)
	}
	copy, e := Open(rebuilt, "fixture")
	if e != nil {
		t.Fatal(e)
	}
	defer copy.Close()
	presets, e := copy.overviewPresets(ctx, copy.overviewRoot())
	if e != nil || len(presets) != 1 || presets[0].Name != "execution" {
		t.Fatal(presets, e)
	}
	if e = copy.DeleteOverviewPreset(ctx, "execution"); e != nil {
		t.Fatal(e)
	}
	if list, e := copy.OverviewPresets(ctx); e != nil || len(list) != 0 {
		t.Fatal(list, e)
	}
	if _, e = copy.PreparedOverview(ctx, scope); e != nil {
		t.Fatal("removal erased historical projection", e)
	}
	if _, e = copy.RegisterOverviewPreset(ctx, "execution", scope); e != nil {
		t.Fatal(e)
	}
	latest := publishCohort(t, copy, "rebuilt-preset", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/three", Value: 9}, {Runtime: "b", Workload: "fixture/three", Value: 36}})
	scope.Revision = latest
	if _, e = copy.PreparedOverview(ctx, scope); e != nil {
		t.Fatal("rebuilt preset did not prepare next publication", e)
	}
}
func TestOverviewPresetFailureKeepsRevisionHidden(t *testing.T) {
	ctx := context.Background()
	s := openTest(t, t.TempDir())
	defer s.Close()
	first := publishCohort(t, s, "preset-fault-seed", []testutil.CohortCell{{Runtime: "a", Workload: "fixture/one", Value: 4}, {Runtime: "b", Workload: "fixture/one", Value: 16}})
	scope := cohortScope(t, s, first)
	if _, e := s.RegisterOverviewPreset(ctx, "execution", scope); e != nil {
		t.Fatal(e)
	}
	job, objects, e := testutil.CohortFixture("preset-fault-new", time.Date(2026, 10, 6, 1, 0, 0, 0, time.UTC), []testutil.CohortCell{{Runtime: "a", Workload: "fixture/two", Value: 16}, {Runtime: "b", Workload: "fixture/two", Value: 64}})
	if e != nil {
		t.Fatal(e)
	}
	for hash, body := range objects {
		if e = s.Install(hash, bytes.NewReader(body)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(job)
	if e != nil {
		t.Fatal(e)
	}
	injected := errors.New("prepared projection fault")
	s.fail = func(stage string) error {
		if stage == "prepared-overviews" {
			return injected
		}
		return nil
	}
	if _, e = s.CommitContext(ctx, id); !errors.Is(e, injected) {
		t.Fatal(e)
	}
	if s.Current() != first {
		t.Fatal("partial publication became current")
	}
	s.fail = nil
	next, e := s.CommitContext(ctx, id)
	if e != nil {
		t.Fatal(e)
	}
	scope.Revision = next
	if _, e = s.PreparedOverview(ctx, scope); e != nil {
		t.Fatal(e)
	}
}

func TestProjectionEvictionProtectsPresetsAndCandidateViews(t *testing.T) {
	ctx := context.Background()
	s := openTest(t, t.TempDir())
	defer s.Close()
	values := map[string]string{presetPrefix + "execution": "preset-object", "aaa": "candidate-view", "bbb": "older-view", "ccc": "other-view"}
	root, e := s.mapSetMany(ctx, "", values, 0)
	if e != nil {
		t.Fatal(e)
	}
	next, count, e := s.evictOverviewProjection(ctx, root, map[string]bool{"aaa": true})
	if e != nil || count != 3 {
		t.Fatal(count, e)
	}
	for key, want := range map[string]string{presetPrefix + "execution": "preset-object", "aaa": "candidate-view", "bbb": "", "ccc": "other-view"} {
		got, e := s.mapGet(next, key)
		if e != nil || got != want {
			t.Fatal(key, got, e)
		}
	}
}
