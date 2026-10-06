package store

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestArchiveVerifierReusesExactParentWithoutRetainingBytes(t *testing.T) {
	job, objects := parentArchiveFixture(t, "archive-proof", time.Now().UTC())
	reads := 0
	v := archiveVerifier{fetch: func(o wire.Object) ([]byte, error) { reads++; return objects[o.SHA256], nil }}
	if e := v.verify(job); e != nil {
		t.Fatal(e)
	}
	first := reads
	for i := 0; i < 100; i++ {
		next := job
		next.Corpus = fmt.Sprintf("corpus-%04d", i+1)
		next.Attempt = fmt.Sprintf("attempt-%d", i)
		if e := v.verify(next); e != nil {
			t.Fatal(e)
		}
	}
	if reads != first || first != len(job.ParentArchive.Objects()) || v.count != 1 || v.bytes != archiveVerificationEntryCost {
		t.Fatal("archive repeatedly read or unbounded receipt", reads, first, v.bytes)
	}
	// A receipt is neither stored in the DB nor shared with the next audit.
	delete(objects, job.ParentArchive.Chunks[0].SHA256)
	fresh := archiveVerifier{fetch: v.fetch}
	if e := fresh.verify(job); e == nil {
		t.Fatal("fresh audit accepted missing original bytes")
	}
}
func TestArchiveVerifierIsolatesEverySourceAndTransportBinding(t *testing.T) {
	job, objects := parentArchiveFixture(t, "archive-bindings", time.Now().UTC())
	reads := 0
	v := archiveVerifier{fetch: func(o wire.Object) ([]byte, error) { reads++; return objects[o.SHA256], nil }}
	if e := v.verify(job); e != nil {
		t.Fatal(e)
	}
	for name, change := range map[string]func(*wire.Job){
		"session": func(j *wire.Job) { j.Session = "other-session" },
		"machine": func(j *wire.Job) { j.Machine = "other-machine" },
		"plan":    func(j *wire.Job) { j.Plan = wire.Hash([]byte("other-plan")) },
		"index":   func(j *wire.Job) { j.ParentBundleSHA256 = wire.Hash([]byte("other-index")) },
		"order": func(j *wire.Job) {
			p := *j.ParentArchive
			p.Chunks = append([]wire.Object{}, p.Chunks...)
			p.Chunks[0], p.Chunks[1] = p.Chunks[1], p.Chunks[0]
			j.ParentArchive = &p
		},
		"full hash": func(j *wire.Job) {
			p := *j.ParentArchive
			p.SHA256 = wire.Hash([]byte("other-full-bytes"))
			j.ParentArchive = &p
		},
		"metadata": func(j *wire.Job) {
			p := *j.ParentArchive
			p.Metadata.SHA256 = wire.Hash([]byte("other-metadata"))
			j.ParentArchive = &p
		},
	} {
		t.Run(name, func(t *testing.T) {
			changed := job
			change(&changed)
			if e := v.verify(changed); e == nil {
				t.Fatal("different binding reused receipt")
			}
		})
	}
	// The configured harness pin is not established by archive bytes alone, but
	// a change must still get a separate receipt and reverify those bytes.
	pin := job
	pin.ConfiguredHarnessPin = "other-configured-pin"
	before := reads
	if e := v.verify(pin); e != nil || reads-before != len(job.ParentArchive.Objects()) {
		t.Fatal("pin change reused receipt", e)
	}
	// A new pass catches corruption even when the digest name remains unchanged.
	o := job.ParentArchive.Chunks[0]
	objects[o.SHA256] = bytes.Repeat([]byte{9}, o.Bytes)
	fresh := archiveVerifier{fetch: v.fetch}
	if e := fresh.verify(job); e == nil {
		t.Fatal("fresh pass accepted corrupt archive")
	}
}
func TestArchiveVerifierReceiptsEvictAtFixedBudget(t *testing.T) {
	job, objects := parentArchiveFixture(t, "archive-eviction", time.Now().UTC())
	reads := 0
	v := archiveVerifier{fetch: func(o wire.Object) ([]byte, error) { reads++; return objects[o.SHA256], nil }}
	for i := 0; i < 3*archiveVerificationCacheEntries; i++ {
		other := job
		other.ConfiguredHarnessPin = fmt.Sprintf("pin-%d", i)
		if e := v.verify(other); e != nil {
			t.Fatal(e)
		}
		retained := 0
		for _, key := range v.order {
			if key != "" {
				retained++
			}
		}
		if v.count != retained || v.count > archiveVerificationCacheEntries || v.bytes > archiveVerificationCacheBytes {
			t.Fatal("unbounded archive receipts")
		}
	}
	first := job
	first.ConfiguredHarnessPin = "pin-0"
	before := reads
	if e := v.verify(first); e != nil || reads-before != len(job.ParentArchive.Objects()) {
		t.Fatal("evicted receipt skipped verification", e)
	}
}

func TestRealParentArchiveProofReuse(t *testing.T) {
	directory := os.Getenv("WASMFYI_REAL_PARENT_TRANSPORT")
	if directory == "" {
		t.Skip("set WASMFYI_REAL_PARENT_TRANSPORT to retained parent transport")
	}
	raw, e := os.ReadFile(filepath.Join(directory, "transport.json"))
	if e != nil {
		t.Fatal(e)
	}
	var parent wire.ParentArchive
	if e := wire.Decode(raw, &parent); e != nil {
		t.Fatal(e)
	}
	raw, e = os.ReadFile(filepath.Join(directory, parent.Index.SHA256))
	if e != nil {
		t.Fatal(e)
	}
	var index struct{ ID, Machine string }
	if e := json.Unmarshal(raw, &index); e != nil {
		t.Fatal(e)
	}
	raw, e = os.ReadFile(filepath.Join(directory, parent.Metadata.SHA256))
	if e != nil {
		t.Fatal(e)
	}
	var metadata struct {
		Plan string `json:"planSha256"`
	}
	if e := json.Unmarshal(raw, &metadata); e != nil {
		t.Fatal(e)
	}
	// Actual retained archive bytes; the synthetic job association is only a
	// verification-reuse probe, not a new measurement or operator qualification.
	job := wire.Job{Session: index.ID, Machine: index.Machine, Plan: metadata.Plan, ConfiguredHarnessPin: "fixture-archive-proof", ParentBundleSHA256: parent.Index.SHA256, ParentArchive: &parent}
	reads := 0
	v := archiveVerifier{fetch: func(o wire.Object) ([]byte, error) { reads++; return os.ReadFile(filepath.Join(directory, o.SHA256)) }}
	if e := v.verify(job); e != nil {
		t.Fatal(e)
	}
	first := reads
	for i := 0; i < 100; i++ {
		other := job
		other.Corpus = fmt.Sprintf("corpus-%04d", i)
		other.Attempt = "proof-reuse"
		if e := v.verify(other); e != nil {
			t.Fatal(e)
		}
	}
	if reads != first || first != len(parent.Objects()) {
		t.Fatal("real archive re-read for each job", reads, first)
	}
	fresh := archiveVerifier{fetch: func(o wire.Object) ([]byte, error) {
		if o.SHA256 == parent.Chunks[0].SHA256 {
			return nil, os.ErrNotExist
		}
		return v.fetch(o)
	}}
	if e := fresh.verify(job); e == nil {
		t.Fatal("fresh audit reused earlier real-archive proof")
	}
	t.Logf("verified %d original bytes in %d source reads; 100 reused jobs made no additional archive reads", parent.Bytes, first)
}
