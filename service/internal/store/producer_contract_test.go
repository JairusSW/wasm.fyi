package store

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// A separately generated producer export exercises the cross-repository wire
// boundary without introducing harness execution packages into this module.
func TestFreshNativeProducerContract(t *testing.T) {
	root := os.Getenv("WASMFYI_NATIVE_PRODUCER_EXPORT")
	if root == "" {
		t.Skip("set WASMFYI_NATIVE_PRODUCER_EXPORT to the fresh producer fixture")
	}
	b, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest wire.Manifest
	if err = wire.Decode(b, &manifest); err != nil {
		t.Fatal(err)
	}
	job := wire.Job{Schema: 2, Session: "producer-contract", Machine: "fixture", Corpus: "corpus", Attempt: "native", Plan: wire.Hash([]byte("plan")), ConfiguredHarnessPin: "0509a0a323f41c58a2f2db15a372fb2e63c692bf", ParentBundleSHA256: wire.Hash([]byte("parent")), Status: "completed", Exports: []wire.Export{{SHA256: wire.Hash(b), Manifest: manifest}}}
	s := openTest(t, t.TempDir())
	defer s.Close()
	id, err := s.Submit(job)
	if err != nil {
		t.Fatal("producer manifest incompatibility", err)
	}
	for _, object := range manifest.Objects {
		data, err := os.ReadFile(filepath.Join(root, "objects", object.SHA256))
		if err != nil {
			t.Fatal(err)
		}
		if err = s.InstallDeclared(object.SHA256, bytes.NewReader(data)); err != nil {
			t.Fatal(err)
		}
	}
	revision, err := s.Commit(id)
	if err != nil {
		t.Fatal("producer records incompatibility", err)
	}
	rows, err := s.Catalog(revision, "artifact")
	if err != nil || len(rows) != 1 {
		t.Fatal("native descriptor missing", err)
	}
	descriptor, data, err := s.ArtifactBytes(context.Background(), revision, rows[0].ID)
	if err != nil || len(data) != 400000 || wire.Hash(data) != descriptor.Content.SHA256 {
		t.Fatal("producer original changed", err)
	}
	if _, err = s.ArtifactEvidence(context.Background(), revision, rows[0].ID, descriptor.Inspection.Metadata); err != nil {
		t.Fatal("producer metadata inaccessible", err)
	}
}
