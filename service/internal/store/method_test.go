package store

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestMethodEnrichmentKeepsCapturesAndRevisionScope(t *testing.T) {
	root := filepath.Join(t.TempDir(), "live")
	s := openTest(t, root)
	defer func() {
		if s != nil {
			s.Close()
		}
	}()
	date := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	old := publishTest(t, s, "capture", date)
	publishTest(t, s, "later", date.Add(time.Hour))
	job, objects, e := testutil.Fixture("capture", date)
	if e != nil {
		t.Fatal(e)
	}
	job.Attempt = "method-enrichment"
	methodID, newResult := "", ""
	manifest := &job.Exports[0].Manifest
	for i, o := range manifest.Objects {
		if o.Kind != "record" {
			continue
		}
		var record wire.Record
		_ = json.Unmarshal(objects[o.SHA256], &record)
		if record.Kind != "result" {
			continue
		}
		var result wire.Result
		_ = json.Unmarshal(record.Data, &result)
		if result.Metric != "time.wall" {
			continue
		}
		recipe, _ := wire.Encode(map[string]any{"protocol": 1, "options": map[string]any{"profile": result.Profile, "scenarios": []string{result.Scenario}}})
		method := wire.MeasurementMethod{Schema: 1, Status: "available", Metric: result.Metric, Scenario: result.Scenario, Profile: result.Profile, Statistic: result.Statistic, Recipe: recipe, RecipeSHA256: wire.Hash(recipe), CollectorStatus: "not_recorded", Observations: []wire.ObservationIdentity{}}
		methodID = method.ID()
		var raw map[string]json.RawMessage
		_ = json.Unmarshal(record.Data, &raw)
		raw["measurementMethod"], _ = wire.Encode(method)
		raw["measurementMethodId"], _ = wire.Encode(methodID)
		record.Data, _ = wire.Encode(raw)
		record.ID = wire.Hash(record.Data)
		newResult = record.ID
		b, _ := wire.Encode(record)
		delete(objects, o.SHA256)
		o.SHA256, o.Bytes = wire.Hash(b), len(b)
		objects[o.SHA256] = b
		manifest.Objects[i] = o
	}
	if methodID == "" {
		t.Fatal("no timing fixture")
	}
	b, _ := wire.Encode(manifest)
	job.Exports[0].SHA256 = wire.Hash(b)
	for id, b := range objects {
		if e = s.Install(id, bytes.NewReader(b)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(job)
	if e != nil {
		t.Fatal(e)
	}
	rev, e := s.Commit(id)
	if e != nil {
		t.Fatal(e)
	}
	check := func(s *Store) {
		t.Helper()
		rows, e := s.Results(Query{Revision: rev}, true)
		if e != nil || len(rows) != 6 {
			t.Fatal("method created independent capture", len(rows), e)
		}
		rows, e = s.Results(Query{Revision: rev, Selection: "previous", Method: methodID}, false)
		if e != nil || len(rows) != 1 || rows[0].ID != newResult {
			t.Fatal("method index/previous selection drifted", len(rows), e)
		}
		rows, e = s.Results(Query{Revision: rev, Method: methodID}, false)
		if e != nil || len(rows) != 0 {
			t.Fatal("current selection fell back to matching old method", e)
		}
		rows, e = s.Results(Query{Revision: old, Method: methodID}, false)
		if e != nil || len(rows) != 0 {
			t.Fatal("method enrichment changed frozen revision", e)
		}
	}
	check(s)
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e = s.Backup(context.Background(), backup); e != nil {
		t.Fatal(e)
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	s = openTest(t, root)
	check(s)
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if e = Rebuild(backup, rebuilt, "test"); e != nil {
		t.Fatal(e)
	}
	r := openTest(t, rebuilt)
	defer r.Close()
	check(r)
}
