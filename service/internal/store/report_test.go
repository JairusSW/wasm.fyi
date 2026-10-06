package store

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func analysisJob(t *testing.T, badIdentity bool) (wire.Job, map[string][]byte, string, []byte) {
	t.Helper()
	job, objects, err := testutil.Fixture("analysis", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	reportID := job.Exports[0].Manifest.ReportID
	data := json.RawMessage(`{"counter":9007199254740993,"status":"unavailable","reason":"` + strings.Repeat("diagnostic ", 32000) + `"}`)
	sectionID := reportID
	if badIdentity {
		sectionID = strings.Repeat("f", 64)
	}
	body, err := wire.Encode(wire.ReportAnalysis{Kind: "report-analysis", Schema: 1, ReportID: sectionID, Field: "counter_display", Data: data})
	if err != nil {
		t.Fatal(err)
	}
	manifest := &job.Exports[0].Manifest
	add := func(b []byte, kind string) string {
		id := wire.Hash(b)
		objects[id] = b
		manifest.Objects = append(manifest.Objects, wire.Object{SHA256: id, Bytes: len(b), Kind: kind})
		return id
	}
	refs := []string{}
	for start := 0; start < len(body); start += wire.FragmentBytes {
		end := min(start+wire.FragmentBytes, len(body))
		b, _ := wire.Encode(wire.JSONFragment{Kind: "json-fragment", Schema: 1, Text: string(body[start:end])})
		refs = append(refs, add(b, "evidence"))
	}
	resource, _ := wire.Encode(wire.JSONResource{Kind: "json-resource", Schema: 1, Encoding: "json-utf8", Bytes: len(body), SHA256: wire.Hash(body), References: refs})
	root := add(resource, "evidence")
	for i, o := range manifest.Objects {
		if o.Kind != "record" {
			continue
		}
		var record wire.Record
		if json.Unmarshal(objects[o.SHA256], &record) != nil || record.Kind != "report" {
			continue
		}
		var descriptor map[string]json.RawMessage
		_ = json.Unmarshal(record.Data, &descriptor)
		descriptor["analysisSectionVersion"], _ = wire.Encode("source-fields-v1")
		descriptor["analysisSections"], _ = wire.Encode(map[string]string{"counter_display": root})
		record.Data, _ = wire.Encode(descriptor)
		b, _ := wire.Encode(record)
		digest := wire.Hash(b)
		objects[digest] = b
		delete(objects, o.SHA256)
		manifest.Objects[i] = wire.Object{SHA256: digest, Bytes: len(b), Kind: "record"}
	}
	b, _ := wire.Encode(*manifest)
	job.Exports[0].SHA256 = wire.Hash(b)
	return job, objects, root, body
}

func TestReportAnalysisClosureAndRecovery(t *testing.T) {
	s := openTest(t, filepath.Join(t.TempDir(), "live"))
	defer s.Close()
	job, objects, root, want := analysisJob(t, false)
	for id, b := range objects {
		if err := s.Install(id, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	revision, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	report := job.Exports[0].Manifest.ReportID
	check := func(s *Store) {
		descriptor, err := s.ReportEvidenceContext(context.Background(), revision, report, root)
		if err != nil {
			t.Fatal(err)
		}
		resource, err := wire.Resource(descriptor)
		if err != nil || resource == nil {
			t.Fatal("missing selected section resource", err)
		}
		assembled, err := wire.AssembleResource(*resource, func(ref string) ([]byte, error) {
			return s.ReportEvidenceContext(context.Background(), revision, report, ref)
		})
		if err != nil || !bytes.Equal(assembled, want) {
			t.Fatal("source section changed", err)
		}
		rows, err := s.Results(Query{Revision: revision}, true)
		if err != nil || len(rows) != 3 {
			t.Fatal("analysis generated extra captures", len(rows), err)
		}
	}
	check(s)
	backup := filepath.Join(t.TempDir(), "backup")
	if _, err = s.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	if _, err = VerifyBackup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"restore", "rebuild"} {
		destination := filepath.Join(t.TempDir(), mode)
		if mode == "restore" {
			err = Restore(context.Background(), backup, destination, "fixture")
		} else {
			err = Rebuild(backup, destination, "fixture")
		}
		if err != nil {
			t.Fatal(mode, err)
		}
		recovered := openTest(t, destination)
		check(recovered)
		recovered.Close()
	}
	if _, err = s.GC(context.Background(), GCOptions{Grace: 24 * time.Hour, QuarantineGrace: 7 * 24 * time.Hour, Apply: true, Now: time.Now().Add(48 * time.Hour)}); err != nil {
		t.Fatal(err)
	}
	check(s)
}

func TestReportAnalysisRejectsForeignSectionBeforePublication(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	job, objects, _, _ := analysisJob(t, true)
	for id, b := range objects {
		if err := s.Install(id, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Commit(id); err == nil || s.Current() != "" {
		t.Fatal("foreign section published", err)
	}
}
