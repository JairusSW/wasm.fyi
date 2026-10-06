package store

import (
	"bytes"
	"context"
	"errors"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"testing"
	"time"
)

func TestAdmissionQuotaAbortAndReferenceSharing(t *testing.T) {
	s, e := OpenWithLimits(t.TempDir(), "test", Limits{PendingJobs: 2, PendingBytes: 10 << 20, ContentBytes: 50 << 20})
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	j, objects, e := testutil.Fixture("first", time.Now().UTC())
	if e != nil {
		t.Fatal(e)
	}
	id, e := s.Submit(j)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.Submit(j)
	if e != nil || again != id {
		t.Fatal("idempotent submission consumed another slot")
	}
	q, e := s.quota()
	if e != nil || q.Jobs != 1 {
		t.Fatal(q, e)
	}
	second := j
	second.Corpus = "corpus-0002"
	secondID, e := s.Submit(second)
	if e != nil {
		t.Fatal(e)
	}
	third := j
	third.Corpus = "corpus-0003"
	if _, e = s.Submit(third); !errors.Is(e, ErrQuota) {
		t.Fatal("pending quota bypassed", e)
	}
	if e = s.Abort(id); e != nil {
		t.Fatal(e)
	}
	for digest, b := range objects {
		if e = s.InstallDeclared(digest, bytes.NewReader(b)); e != nil {
			t.Fatal("shared permit removed too early", e)
		}
	}
	if _, e = s.Commit(id); !errors.Is(e, ErrConflict) {
		t.Fatal("aborted attempt published", e)
	}
	if _, e = s.Submit(j); !errors.Is(e, ErrConflict) {
		t.Fatal("aborted attempt silently reused", e)
	}
	revision, e := s.Commit(secondID)
	if e != nil {
		t.Fatal(e)
	}
	status, e := s.ImportStatus(secondID)
	if e != nil || status.State != "published" || status.Revision != revision {
		t.Fatal(status, e)
	}
	q, e = s.quota()
	if e != nil || q.Jobs != 0 || q.Bytes != 0 {
		t.Fatal("quota was not released atomically", q, e)
	}
	for digest, b := range objects {
		if e = s.InstallDeclared(digest, bytes.NewReader(b)); !errors.Is(e, ErrUndeclared) {
			t.Fatal("closed permit retained", e)
		}
		break
	}
}
func TestUndeclaredUploadAndStorageCap(t *testing.T) {
	s, e := OpenWithLimits(t.TempDir(), "test", Limits{PendingJobs: 2, PendingBytes: 10 << 20, ContentBytes: wire.ChunkBytes})
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	b := []byte("unrequested")
	if e = s.InstallDeclared(wire.Hash(b), bytes.NewReader(b)); !errors.Is(e, ErrUndeclared) {
		t.Fatal("undeclared content admitted", e)
	}
	full := bytes.Repeat([]byte{1}, wire.ChunkBytes)
	if e = s.Install(wire.Hash(full), bytes.NewReader(full)); e != nil {
		t.Fatal(e)
	}
	if e = s.Install(wire.Hash(b), bytes.NewReader(b)); !errors.Is(e, ErrQuota) {
		t.Fatal("content quota bypassed", e)
	}
	if e = s.Install(wire.Hash(full), bytes.NewReader(full)); e != nil {
		t.Fatal("same content charged twice", e)
	}
}
func TestPendingByteQuotaAndPartialBackup(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	j, _, e := testutil.Fixture("pending", time.Now().UTC())
	if e != nil {
		t.Fatal(e)
	}
	s.limits.PendingBytes = 1
	if _, e = s.Submit(j); !errors.Is(e, ErrQuota) {
		t.Fatal("byte reservation cap bypassed", e)
	}
	s.limits = DefaultLimits()
	id, e := s.Submit(j)
	if e != nil {
		t.Fatal(e)
	}
	status, e := s.ImportStatus(id)
	if e != nil || status.Missing == 0 || status.State != "staged" {
		t.Fatal(status, e)
	}
	backup := t.TempDir() + "/backup"
	if _, e = s.Backup(context.Background(), backup); e != nil {
		t.Fatal("pending missing content prevented backup", e)
	}
}
