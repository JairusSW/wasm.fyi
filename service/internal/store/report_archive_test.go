package store

import (
	"bytes"
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestReportFileCatalogSupportsAllAnalyticalFilesAndArchive(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	job, objects, e := testutil.Fixture("all-report-files", time.Now().UTC())
	if e != nil {
		t.Fatal(e)
	}
	payload := []byte("synthetic opaque file transport")
	chunk := wire.Hash(payload)
	objects[chunk] = payload
	job.Exports[0].Manifest.Objects = append(job.Exports[0].Manifest.Objects, wire.Object{SHA256: chunk, Bytes: len(payload), Kind: "binary"})
	names := []string{"samples.parquet", "throughput.parquet", "observations.parquet", "counters.parquet", "engine-events.parquet", "code-lifetimes.parquet", "memory-samples.parquet", "memory-observations.parquet", "report.tar.gz"}
	for _, name := range names {
		file := wire.ReportFile{Schema: 1, Kind: "report-file", ReportID: job.Exports[0].Manifest.ReportID, Name: name, MediaType: "application/vnd.apache.parquet", Encoding: "identity", SHA256: chunk, Bytes: int64(len(payload)), Chunks: []wire.FileChunk{{SHA256: chunk, Bytes: len(payload)}}}
		if name == "report.tar.gz" {
			file.MediaType = "application/gzip"
			file.PackingVersion = "sealed-files-tar-gzip-v1"
			file.SourceSealSHA256 = job.Exports[0].Manifest.SourceSealSHA256
		}
		data, _ := wire.Encode(file)
		record := wire.Record{Kind: "report-file", ID: wire.Hash(data), Data: data}
		body, _ := wire.Encode(record)
		digest := wire.Hash(body)
		objects[digest] = body
		job.Exports[0].Manifest.Objects = append(job.Exports[0].Manifest.Objects, wire.Object{SHA256: digest, Bytes: len(body), Kind: "record"})
	}
	manifest, _ := wire.Encode(job.Exports[0].Manifest)
	job.Exports[0].SHA256 = wire.Hash(manifest)
	for id, body := range objects {
		if e = s.Install(id, bytes.NewReader(body)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(job)
	if e != nil {
		t.Fatal(e)
	}
	revision, e := s.Commit(id)
	if e != nil {
		t.Fatal(e)
	}
	files, e := s.ReportFiles(context.Background(), revision, job.Exports[0].Manifest.ReportID)
	if e != nil || len(files) != 9 {
		t.Fatal("ninth original resource lost", len(files), e)
	}
	backup := filepath.Join(t.TempDir(), "backup")
	if _, e = s.Backup(context.Background(), backup); e != nil {
		t.Fatal(e)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuilt")
	if e = Rebuild(backup, rebuilt, "fixture-publisher"); e != nil {
		t.Fatal(e)
	}
	recovered := openTest(t, rebuilt)
	defer recovered.Close()
	restored, e := recovered.ReportFiles(context.Background(), revision, job.Exports[0].Manifest.ReportID)
	if e != nil || len(restored) != 9 {
		t.Fatal("ninth resource lost on rebuild", e, len(restored))
	}
}
