package store

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParentArchiveAdmissionReuseAndRecovery(t *testing.T) {
	dir := t.TempDir()
	s := openTest(t, filepath.Join(dir, "live"))
	defer s.Close()
	job, objects := parentArchiveFixture(t, "parent-ingestion", time.Now().UTC())
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Commit(id); err == nil || s.Current() != "" {
		t.Fatal("partial parent archive published")
	}
	missing, err := s.Missing(id)
	if err != nil {
		t.Fatal(err)
	}
	for _, o := range missing {
		if err = s.InstallDeclared(o.SHA256, bytes.NewReader(objects[o.SHA256])); err != nil {
			t.Fatal(err)
		}
	}
	rev, err := s.Commit(id)
	if err != nil {
		t.Fatal(err)
	}
	second := job
	second.Corpus = "corpus-0002"
	second.Attempt = "other-corpus"
	other, err := s.Submit(second)
	if err != nil {
		t.Fatal(err)
	}
	missing, err = s.Missing(other)
	if err != nil || len(missing) != 0 {
		t.Fatal("shared parent content requested again", len(missing), err)
	}
	current, err := s.Commit(other)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := s.Results(Query{Revision: current}, true)
	if err != nil || len(rows) != 3 {
		t.Fatal("parent publication changed measurement history", len(rows), err)
	}
	backup := filepath.Join(dir, "backup")
	if _, err = s.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, "rebuilt")
	if err = Rebuild(backup, target, "fixture"); err != nil {
		t.Fatal(err)
	}
	rebuilt := openTest(t, target)
	defer rebuilt.Close()
	stored, err := rebuilt.Job(id)
	if err != nil || stored.ParentArchive == nil {
		t.Fatal("rebuild lost parent archive", err)
	}
	if err = stored.ParentArchive.Verify(stored, rebuilt.objectRepresentation); err != nil {
		t.Fatal(err)
	}
	rows, err = rebuilt.Results(Query{Revision: rev}, true)
	if err != nil || len(rows) != 3 {
		t.Fatal("rebuild changed frozen measurement history", err)
	}
}

func TestRealParentArchiveIngestion(t *testing.T) {
	directory := os.Getenv("WASMFYI_REAL_PARENT_TRANSPORT")
	if directory == "" {
		t.Skip("set WASMFYI_REAL_PARENT_TRANSPORT to generated parent transport folder")
	}
	raw, err := os.ReadFile(filepath.Join(directory, "transport.json"))
	if err != nil {
		t.Fatal(err)
	}
	var parent wire.ParentArchive
	if err = wire.Decode(raw, &parent); err != nil {
		t.Fatal(err)
	}
	indexRaw, err := os.ReadFile(filepath.Join(directory, parent.Index.SHA256))
	if err != nil {
		t.Fatal(err)
	}
	var index struct{ ID, Machine string }
	if err = json.Unmarshal(indexRaw, &index); err != nil {
		t.Fatal(err)
	}
	metadataRaw, err := os.ReadFile(filepath.Join(directory, parent.Metadata.SHA256))
	if err != nil {
		t.Fatal(err)
	}
	var metadata struct {
		Plan string `json:"planSha256"`
	}
	if err = json.Unmarshal(metadataRaw, &metadata); err != nil {
		t.Fatal(err)
	}
	// The measurement fixture is synthetic; this gate verifies the real parent
	// bytes and source binding, not an actual completed measurement association.
	job, objects, err := testutil.Fixture("real-parent-byte-gate", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	job.Session = index.ID
	job.Machine = index.Machine
	job.Plan = metadata.Plan
	job.ParentBundleSHA256 = parent.Index.SHA256
	job.ParentArchive = &parent
	s := openTest(t, t.TempDir())
	defer s.Close()
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	for hash, b := range objects {
		if err = s.InstallDeclared(hash, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	for _, o := range parent.Objects() {
		b, err := os.ReadFile(filepath.Join(directory, o.SHA256))
		if err != nil {
			t.Fatal(err)
		}
		if err = s.InstallDeclared(o.SHA256, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = s.Commit(id); err != nil {
		t.Fatal(err)
	}
	stored, err := s.Job(id)
	if err != nil {
		t.Fatal(err)
	}
	if err = stored.ParentArchive.Verify(stored, s.objectRepresentation); err != nil {
		t.Fatal(err)
	}
	t.Logf("imported %d original parent bytes in %d chunks", parent.Bytes, len(parent.Chunks))
}

func parentArchiveFixture(t *testing.T, seed string, date time.Time) (wire.Job, map[string][]byte) {
	t.Helper()
	job, objects, err := testutil.Fixture(seed, date)
	if err != nil {
		t.Fatal(err)
	}
	job.Session = "parent-archive-session"
	parts := [][]byte{bytes.Repeat([]byte{7}, wire.ReportFileChunkBytes+23), []byte("second original part")}
	full := append(append([]byte{}, parts[0]...), parts[1]...)
	metadata, _ := wire.Encode(map[string]any{"schema": 1, "id": job.Session, "planSha256": job.Plan, "scope": "source archive; no execution"})
	indexParts := []any{}
	for i, b := range parts {
		indexParts = append(indexParts, map[string]any{"path": fmt.Sprintf("bundle.tar.gz.part-%03d", i), "bytes": len(b), "sha256": wire.Hash(b)})
	}
	index, _ := wire.Encode(map[string]any{"schema": 1, "id": job.Session, "machine": job.Machine, "metadata": "metadata.json", "metadataSha256": wire.Hash(metadata), "parts": indexParts, "bytes": len(full), "sha256": wire.Hash(full)})
	parent := &wire.ParentArchive{Schema: 1, Index: wire.Object{SHA256: wire.Hash(index), Bytes: len(index), Kind: "evidence"}, Metadata: wire.Object{SHA256: wire.Hash(metadata), Bytes: len(metadata), Kind: "evidence"}, SHA256: wire.Hash(full), Bytes: int64(len(full)), Chunks: []wire.Object{}}
	objects[wire.Hash(index)] = index
	objects[wire.Hash(metadata)] = metadata
	for start := 0; start < len(full); start += wire.ReportFileChunkBytes {
		b := full[start:min(start+wire.ReportFileChunkBytes, len(full))]
		objects[wire.Hash(b)] = b
		parent.Chunks = append(parent.Chunks, wire.Object{SHA256: wire.Hash(b), Bytes: len(b), Kind: "binary"})
	}
	job.ParentBundleSHA256 = parent.Index.SHA256
	job.ParentArchive = parent
	return job, objects
}
