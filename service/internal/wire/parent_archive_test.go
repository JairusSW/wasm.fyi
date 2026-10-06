package wire

import (
	"bytes"
	"testing"
)

func TestParentArchiveChecksOriginalPartsAndScope(t *testing.T) {
	first, second := []byte("first original part"), []byte("second original part")
	full := append(append([]byte{}, first...), second...)
	job := Job{Session: "session", Machine: "machine", Plan: Hash([]byte("plan"))}
	metadata, _ := Encode(map[string]any{"planSha256": job.Plan, "scope": "original archive only"})
	index, _ := Encode(map[string]any{"schema": 1, "id": job.Session, "machine": job.Machine, "metadata": "metadata.json", "metadataSha256": Hash(metadata), "sha256": Hash(full), "bytes": len(full), "parts": []any{map[string]any{"path": "bundle.tar.gz.part-000", "sha256": Hash(first), "bytes": len(first)}, map[string]any{"path": "bundle.tar.gz.part-001", "sha256": Hash(second), "bytes": len(second)}}})
	job.ParentBundleSHA256 = Hash(index)
	parent := ParentArchive{Schema: 1, Index: Object{Hash(index), len(index), "evidence"}, Metadata: Object{Hash(metadata), len(metadata), "evidence"}, SHA256: Hash(full), Bytes: int64(len(full)), Chunks: []Object{{Hash(full[:23]), 23, "binary"}, {Hash(full[23:]), len(full) - 23, "binary"}}}
	objects := map[string][]byte{Hash(index): index, Hash(metadata): metadata, Hash(full[:23]): full[:23], Hash(full[23:]): full[23:]}
	fetch := func(o Object) ([]byte, error) { return objects[o.SHA256], nil }
	if err := parent.Verify(job, fetch); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Job){func(j *Job) { j.Machine = "other" }, func(j *Job) { j.Plan = Hash([]byte("other")) }, func(j *Job) { j.Session = "other" }} {
		other := job
		change(&other)
		if err := parent.Verify(other, fetch); err == nil {
			t.Fatal("different collection scope accepted")
		}
	}
	bad := parent
	bad.Chunks = append([]Object{}, parent.Chunks...)
	bad.Chunks[0], bad.Chunks[1] = bad.Chunks[1], bad.Chunks[0]
	if err := bad.Verify(job, fetch); err == nil {
		t.Fatal("reordered original bytes accepted")
	}
	if err := parent.Verify(job, func(o Object) ([]byte, error) {
		if o.Kind == "binary" {
			return bytes.Repeat([]byte{0}, o.Bytes), nil
		}
		return fetch(o)
	}); err == nil {
		t.Fatal("corrupt archive accepted")
	}
}
