package sqldb

import (
	"context"
	"encoding/json"
	"reflect"
	"strconv"
	"testing"
)

func TestLocalRunCheckpointReuseAndExactSamples(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err = s.EnsureLocalRuns(ctx); err != nil {
		t.Fatal(err)
	}
	plan := []byte(`{"schema":1,"jobs":[{"key":"job","cacheKey":"build-input-policy-host"}]}`)
	for _, id := range []string{"before", "reused", "different"} {
		if err = s.CreateLocalRun(ctx, id, plan); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.LocalRun(ctx, "before")
	if err != nil || !reflect.DeepEqual([]byte(got.Plan), plan) {
		t.Fatal(got, err)
	}
	if done, err := s.LocalJobDone(ctx, "before", "job"); err != nil || done {
		t.Fatal(done, err)
	}
	c := fixture()
	if err = s.PutLocalCapture(ctx, "before", "job", "build-input-policy-host", c); err != nil {
		t.Fatal(err)
	}
	if pass, err := s.LocalJobPassed(ctx, "before", "job"); err != nil || !pass {
		t.Fatal(pass, err)
	}
	if pass, err := s.LocalJobPassed(ctx, "before", "missing"); err != nil || pass {
		t.Fatal(pass, err)
	}
	if err = s.FinalizeLocalPlan(ctx, "before", plan); err == nil {
		t.Fatal("measured plan must be immutable")
	}
	if reused, err := s.ReuseLocalJob(ctx, "different", "job", "different-artifact"); err != nil || reused {
		t.Fatal(reused, err)
	}
	if reused, err := s.ReuseLocalJob(ctx, "reused", "job", "build-input-policy-host"); err != nil || !reused {
		t.Fatal(reused, err)
	}
	a, err := s.LocalValues(ctx, "before")
	if err != nil || len(a) != 1 {
		t.Fatal(a, err)
	}
	b, err := s.LocalValues(ctx, "reused")
	if err != nil || !reflect.DeepEqual(a, b) {
		t.Fatal(b, err)
	}
	id, err := strconv.ParseInt(a[0].Observation, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	detail, err := s.Detail(ctx, a[0].Platform, id)
	if err != nil || !reflect.DeepEqual(vector(detail.SamplesNs), vector(c.Results[0].SamplesNs)) {
		t.Fatal(detail, err)
	}
	invalid := fixture()
	invalid.CapturedAt = "2026-10-09T00:00:00Z"
	invalid.Results[0].Version = "uncommitted"
	if err = s.PutLocalCapture(ctx, "missing-run", "job", "new-key", invalid); err == nil {
		t.Fatal("accepted missing run")
	}
	var observations int
	if err = s.reader.QueryRow("SELECT count(*) FROM observations").Scan(&observations); err != nil || observations != 1 {
		t.Fatal("capture/checkpoint was not atomic", observations, err)
	}
	var vectors int
	if err = s.reader.QueryRow("SELECT count(*) FROM sample_vectors").Scan(&vectors); err != nil || vectors != 1 {
		t.Fatal(vectors, err)
	}
	for _, status := range []string{"running", "paused", "completed"} {
		if err = s.SetLocalRunStatus(ctx, "reused", status, ""); err != nil {
			t.Fatal(err)
		}
	}
	got, err = s.LocalRun(ctx, "reused")
	if err != nil || got.Completed != 1 || got.Status != "completed" || !json.Valid(got.Plan) {
		t.Fatal(got, err)
	}
	if err = s.Integrity(ctx); err != nil {
		t.Fatal(err)
	}
}
