package store

import (
	"fmt"
	"testing"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func TestPublicationPostingBoundsReuseNodesAndEnforceDepth(t *testing.T) {
	blobs := map[string][]byte{}
	put := func(value any) string {
		b, e := wire.Encode(value)
		if e != nil {
			t.Fatal(e)
		}
		id := wire.Hash(b)
		blobs[id] = b
		return id
	}
	job := wire.Hash([]byte("published-job"))
	created := time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC)
	summary := put(PublishedJob{ID: job, PublishedAt: created})
	leaf := put(node{Entries: map[string]string{"job": summary}})
	reads := 0
	verifier := publicationPostingVerifier{origins: map[string]publicationOrigin{job: {rank: 0, created: created}}, read: func(id string, value any) error { reads++; return wire.Decode(blobs[id], value) }}
	if rank, e := verifier.newest(leaf); e != nil || rank != 0 {
		t.Fatal(rank, e)
	}
	first := reads
	for i := 0; i < 100; i++ {
		if rank, e := verifier.newest(leaf); e != nil || rank != 0 {
			t.Fatal(rank, e)
		}
	}
	if reads != first {
		t.Fatal("shared posting nodes decoded repeatedly")
	}
	// The leaf was cached at shallow depth. An excessive later path must still
	// be rejected, rather than hiding its depth behind that cached proof.
	deep := leaf
	for i := 0; i < 65; i++ {
		deep = put(node{Children: map[string]string{"a": deep}})
	}
	if _, e := verifier.newest(deep); e == nil {
		t.Fatal("excessive radix depth accepted")
	}
}
func TestPublicationOriginsRejectDuplicateJobRevisions(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	defer s.Close()
	job, objects := plannedFixture(t, "duplicate-origin", "local", "corpus-0001", true)
	revision, e := s.Commit(stagePlannedFixture(t, s, job, objects))
	if e != nil {
		t.Fatal(e)
	}
	rev, e := s.Revision(revision)
	if e != nil {
		t.Fatal(e)
	}
	rev.Parent = revision
	rev.Created = rev.Created.Add(time.Hour)
	duplicate, e := s.put(rev)
	if e != nil {
		t.Fatal(e)
	}
	s.mu.Lock()
	s.published[duplicate] = rev
	s.current = duplicate
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.published, duplicate); s.current = revision; s.mu.Unlock() }()
	if _, _, e := s.publicationOrigins(func(id string, value any) error { return s.load(id, value) }); e == nil {
		t.Fatal(fmt.Sprintf("job %s acquired two publication origins", rev.Job))
	}
}
