package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestNestedEvidencePublicationAndRecovery(t *testing.T) {
	j, objects, err := testutil.Fixture("nested-evidence", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	add := func(value any) string {
		b, _ := wire.Encode(value)
		hash := wire.Hash(b)
		objects[hash] = b
		j.Exports[0].Manifest.Objects = append(j.Exports[0].Manifest.Objects, wire.Object{SHA256: hash, Bytes: len(b), Kind: "evidence"})
		return hash
	}
	leaf := add(map[string]any{"kind": "trial-details", "data": map[string]any{"log": "diagnostic"}})
	contextID := add(map[string]any{"kind": "pass-context", "manifest": map[string]any{"id": "pass", "profile": "timing"}})
	middle := add(map[string]any{"references": []string{leaf}})
	root := add(map[string]any{"references": []string{middle, contextID}})
	unrelated := add(map[string]any{"kind": "unrelated"})
	result := ""
	for i, obj := range j.Exports[0].Manifest.Objects {
		if obj.Kind != "record" {
			continue
		}
		var record wire.Record
		_ = json.Unmarshal(objects[obj.SHA256], &record)
		var data map[string]json.RawMessage
		_ = json.Unmarshal(record.Data, &data)
		if record.Kind == "result" && result == "" {
			data["evidence"], _ = wire.Encode([]string{root})
			record.Data, _ = wire.Encode(data)
			record.ID = wire.Hash(record.Data)
			result = record.ID
		} else if record.Kind == "report" {
			data["passContexts"], _ = wire.Encode([]string{contextID})
			record.Data, _ = wire.Encode(data)
		} else {
			continue
		}
		b, _ := wire.Encode(record)
		delete(objects, obj.SHA256)
		obj.SHA256, obj.Bytes = wire.Hash(b), len(b)
		objects[obj.SHA256] = b
		j.Exports[0].Manifest.Objects[i] = obj
	}
	b, _ := wire.Encode(j.Exports[0].Manifest)
	j.Exports[0].SHA256 = wire.Hash(b)
	dir := t.TempDir()
	s := openTest(t, filepath.Join(dir, "live"))
	defer s.Close()
	for hash, body := range objects {
		if err = s.Install(hash, bytes.NewReader(body)); err != nil {
			t.Fatal(err)
		}
	}
	job, err := s.Submit(j)
	if err != nil {
		t.Fatal(err)
	}
	revision, err := s.Commit(job)
	if err != nil {
		t.Fatal(err)
	}
	for _, hash := range []string{root, middle, leaf, contextID} {
		body, err := s.Evidence(revision, result, hash)
		if err != nil || !bytes.Equal(body, objects[hash]) {
			t.Fatalf("lost nested evidence %s: %v", hash, err)
		}
	}
	if _, err = s.Evidence(revision, result, unrelated); !errors.Is(err, ErrNotFound) {
		t.Fatal("leaked unrelated evidence", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = s.EvidenceContext(ctx, revision, result, leaf); !errors.Is(err, context.Canceled) {
		t.Fatal("ignored request cancellation", err)
	}
	backup := filepath.Join(dir, "backup")
	if _, err = s.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	if _, err = VerifyBackup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	rebuilt := filepath.Join(dir, "rebuilt")
	if err = Rebuild(backup, rebuilt, "fixture"); err != nil {
		t.Fatal(err)
	}
	recovered := openTest(t, rebuilt)
	defer recovered.Close()
	if body, err := recovered.Evidence(revision, result, leaf); err != nil || !bytes.Equal(body, objects[leaf]) {
		t.Fatal("rebuild lost evidence closure", err)
	}
}

func TestRejectUnresolvedEvidenceAndPassContexts(t *testing.T) {
	for _, kind := range []string{"evidence", "report"} {
		t.Run(kind, func(t *testing.T) {
			j, objects, err := testutil.Fixture("missing-"+kind, time.Now().UTC())
			if err != nil {
				t.Fatal(err)
			}
			missing := wire.Hash([]byte("not-in-this-export"))
			if kind == "evidence" {
				b, _ := wire.Encode(map[string]any{"references": []string{missing}})
				digest := wire.Hash(b)
				objects[digest] = b
				j.Exports[0].Manifest.Objects = append(j.Exports[0].Manifest.Objects, wire.Object{SHA256: digest, Bytes: len(b), Kind: "evidence"})
			} else {
				for i, object := range j.Exports[0].Manifest.Objects {
					if object.Kind != "record" {
						continue
					}
					var record wire.Record
					_ = json.Unmarshal(objects[object.SHA256], &record)
					if record.Kind != "report" {
						continue
					}
					var data map[string]json.RawMessage
					_ = json.Unmarshal(record.Data, &data)
					data["passContexts"], _ = wire.Encode([]string{missing})
					record.Data, _ = wire.Encode(data)
					b, _ := wire.Encode(record)
					delete(objects, object.SHA256)
					object.SHA256, object.Bytes = wire.Hash(b), len(b)
					objects[object.SHA256] = b
					j.Exports[0].Manifest.Objects[i] = object
				}
			}
			b, _ := wire.Encode(j.Exports[0].Manifest)
			j.Exports[0].SHA256 = wire.Hash(b)
			s := openTest(t, t.TempDir())
			defer s.Close()
			for digest, body := range objects {
				if err = s.Install(digest, bytes.NewReader(body)); err != nil {
					t.Fatal(err)
				}
			}
			id, err := s.Submit(j)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = s.Commit(id); !errors.Is(err, wire.ErrInvalid) {
				t.Fatal("accepted unresolved reference", err)
			}
			if s.Current() != "" {
				t.Fatal("exposed incomplete revision")
			}
		})
	}
}
