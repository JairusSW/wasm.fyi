package store

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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
	functions, err := s.FunctionPage(context.Background(), revision, rows[0].ID, 0, 1)
	if err != nil || !functions.Indexed || functions.Total != 1 || len(functions.Items) != 1 || functions.Items[0].WasmIndex != 7 || functions.Items[0].Length != 32 {
		t.Fatal("producer function index incompatible", functions, err)
	}
	if functions.Items[0].Disassembly != "" {
		var listing strings.Builder
		offset := 0
		expectedHash := ""
		for {
			page, err := s.DisassemblyPage(context.Background(), revision, rows[0].ID, 0, offset, 10)
			if err != nil || page.Version != wire.DisassemblyVersion || page.Function.WasmIndex != 7 || len(page.Tools) != 2 {
				t.Fatal("fresh producer derivative incompatible", page, err)
			}
			expectedHash = page.TextSHA256
			for _, line := range page.Items {
				listing.WriteString(line)
			}
			if page.Next == page.Total {
				break
			}
			offset = page.Next
		}
		if wire.Hash([]byte(listing.String())) != expectedHash || !strings.Contains(listing.String(), "ret") {
			t.Fatal("fresh LLVM listing changed")
		}
	}
	results, err := s.Results(Query{Revision: revision}, false)
	if err != nil || len(results) == 0 {
		t.Fatal(err)
	}
	for _, record := range results {
		var result wire.Result
		if err = wire.Decode(record.Data, &result); err != nil || result.MeasurementMethod == nil || result.ValidateMethod() != nil {
			t.Fatal("fresh producer method incompatible", err)
		}
		selected, err := s.Results(Query{Revision: revision, Method: result.MeasurementMethodID}, false)
		if err != nil || len(selected) != 1 || selected[0].ID != record.ID {
			t.Fatal("producer method filter lost scope", err)
		}
		// Recipes remain source metadata; this boundary does not infer collectors.
		var recipe map[string]json.RawMessage
		if result.MeasurementMethod.Status == "available" && json.Unmarshal(result.MeasurementMethod.Recipe, &recipe) != nil {
			t.Fatal("recipe changed")
		}
	}
}
