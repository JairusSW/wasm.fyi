package api

import (
	"bytes"
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestReportFileChunksAndRecovery(t *testing.T) {
	dir := t.TempDir()
	s, err := store.Open(filepath.Join(dir, "live"), "test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	job, objects, err := testutil.Fixture("bulk-files", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	content := append(bytes.Repeat([]byte{17}, wire.ReportFileChunkBytes), []byte("tail")...)
	file := wire.ReportFile{Schema: 1, Kind: "report-file", ReportID: job.Exports[0].Manifest.ReportID, Name: "samples.parquet", MediaType: "application/vnd.apache.parquet", Encoding: "identity", SHA256: wire.Hash(content), Bytes: int64(len(content)), Chunks: []wire.FileChunk{}}
	for start := 0; start < len(content); start += wire.ReportFileChunkBytes {
		b := content[start:min(start+wire.ReportFileChunkBytes, len(content))]
		id := wire.Hash(b)
		objects[id] = b
		job.Exports[0].Manifest.Objects = append(job.Exports[0].Manifest.Objects, wire.Object{SHA256: id, Bytes: len(b), Kind: "binary"})
		file.Chunks = append(file.Chunks, wire.FileChunk{SHA256: id, Bytes: len(b)})
	}
	data, _ := wire.Encode(file)
	record := wire.Record{Kind: "report-file", ID: wire.Hash(data), Data: data}
	b, _ := wire.Encode(record)
	objects[wire.Hash(b)] = b
	job.Exports[0].Manifest.Objects = append(job.Exports[0].Manifest.Objects, wire.Object{SHA256: wire.Hash(b), Bytes: len(b), Kind: "record"})
	b, _ = wire.Encode(job.Exports[0].Manifest)
	job.Exports[0].SHA256 = wire.Hash(b)
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	for digest, b := range objects {
		if err = s.InstallDeclared(digest, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	rev, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	check := func(s *store.Store) {
		t.Helper()
		h, err := New(s, strings.Repeat("x", 32), bytes.Repeat([]byte{1}, 32))
		if err != nil {
			t.Fatal(err)
		}
		list := request(t, h, "GET", "/api/v1/files?revision="+rev, nil, nil)
		if list.Code != 200 {
			t.Fatal(list.Body.String())
		}
		selected := request(t, h, "GET", "/api/v1/reports/"+file.ReportID+"/files?revision="+rev, nil, nil)
		if selected.Code != 200 || !bytes.Contains(selected.Body.Bytes(), []byte(record.ID)) {
			t.Fatal("selected report file index", selected.Code, selected.Body.String())
		}
		var assembled []byte
		for _, chunk := range file.Chunks {
			path := "/api/v1/files/" + record.ID + "/chunks/" + chunk.SHA256 + "?revision=" + rev
			response := request(t, h, "GET", path, nil, nil)
			if response.Code != 200 || response.Body.Len() != chunk.Bytes {
				t.Fatal(response.Code, response.Body.String())
			}
			assembled = append(assembled, response.Body.Bytes()...)
			head := request(t, h, "HEAD", path, nil, nil)
			if head.Code != 200 || head.Body.Len() != 0 {
				t.Fatal("invalid HEAD")
			}
		}
		if !bytes.Equal(content, assembled) {
			t.Fatal("original bytes changed")
		}
		forged := request(t, h, "GET", "/api/v1/files/"+record.ID+"/chunks/"+wire.Hash([]byte("other"))+"?revision="+rev, nil, nil)
		if forged.Code != 404 {
			t.Fatal("unbound bytes exposed", forged.Code)
		}
	}
	check(s)
	backup := filepath.Join(dir, "backup")
	if _, err = s.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	if err = store.Rebuild(backup, filepath.Join(dir, "rebuilt"), "test"); err != nil {
		t.Fatal(err)
	}
	r, err := store.Open(filepath.Join(dir, "rebuilt"), "test")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	check(r)
}
