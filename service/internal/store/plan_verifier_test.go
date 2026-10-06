package store

import (
	"fmt"
	"strings"
	"testing"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func verifierFixture(t *testing.T, note string, corpora []string) (wire.Job, map[string][]byte) {
	t.Helper()
	job, _ := plannedFixture(t, "verify-source", "local", "corpus-0001", false)
	jobs := []any{}
	for _, id := range corpora {
		jobs = append(jobs, map[string]any{"id": id})
	}
	raw, e := wire.Encode(map[string]any{"schema": 1, "configuredHarnessPin": job.ConfiguredHarnessPin, "machines": []any{map[string]any{"name": "local"}}, "jobs": jobs, "note": note})
	if e != nil {
		t.Fatal(e)
	}
	job.Corpus = corpora[0]
	job.Plan = wire.Hash(raw)
	job.SessionPlan = &wire.SessionPlan{Schema: 1, Bytes: len(raw)}
	objects := map[string][]byte{}
	for start := 0; start < len(raw); start += wire.ReportFileChunkBytes {
		b := raw[start:min(len(raw), start+wire.ReportFileChunkBytes)]
		o := wire.Object{SHA256: wire.Hash(b), Bytes: len(b), Kind: "binary"}
		job.SessionPlan.Chunks = append(job.SessionPlan.Chunks, o)
		objects[o.SHA256] = b
	}
	return job, objects
}
func TestPlanVerifierSharesProofButChecksEveryMembership(t *testing.T) {
	job, objects := verifierFixture(t, strings.Repeat("x", 2*wire.ReportFileChunkBytes), []string{"corpus-0001", "corpus-0002"})
	reads := 0
	v := planVerifier{fetch: func(o wire.Object) ([]byte, error) { reads++; return objects[o.SHA256], nil }}
	scope, e := v.verify(job)
	if e != nil {
		t.Fatal(e)
	}
	firstReads := reads
	for i := 0; i < 100; i++ {
		other := job
		other.Corpus = "corpus-0002"
		other.Attempt = fmt.Sprintf("retry-%d", i)
		other.Session = "another-session"
		if _, e := v.verify(other); e != nil {
			t.Fatal(e)
		}
	}
	if reads != firstReads || firstReads != len(job.SessionPlan.Chunks) {
		t.Fatal("shared plan re-read for each job", reads, firstReads)
	}
	outside := job
	outside.Machine = "outside"
	if _, e := v.verify(outside); e == nil || reads != firstReads {
		t.Fatal("cached proof bypassed membership admission")
	}
	outside = job
	outside.Corpus = "outside"
	if _, e := v.verify(outside); e == nil {
		t.Fatal("cached proof bypassed corpus admission")
	}
	// Returned slices must not let a consumer corrupt later membership projection.
	scope.Members[0] = "mutated"
	scope.Corpora[0] = "mutated"
	again, e := v.verify(job)
	if e != nil || again.Members[0] != "local" || again.Corpora[0] != "corpus-0001" {
		t.Fatal(again, e)
	}
	// No proof crosses validation passes. A new pass must observe lost evidence.
	delete(objects, job.SessionPlan.Chunks[0].SHA256)
	fresh := planVerifier{fetch: v.fetch}
	if _, e := fresh.verify(job); e == nil {
		t.Fatal("new pass accepted missing source")
	}
}
func TestPlanVerifierExactTransportAndPinIdentity(t *testing.T) {
	job, objects := verifierFixture(t, strings.Repeat("x", 2*wire.ReportFileChunkBytes), []string{"corpus-0001"})
	v := planVerifier{fetch: func(o wire.Object) ([]byte, error) { return objects[o.SHA256], nil }}
	if _, e := v.verify(job); e != nil {
		t.Fatal(e)
	}
	pin := job
	pin.ConfiguredHarnessPin = "different-pin"
	if _, e := v.verify(pin); e == nil {
		t.Fatal("changed pin reused cached proof")
	}
	changed := job
	transport := *job.SessionPlan
	transport.Chunks = append([]wire.Object{}, transport.Chunks...)
	transport.Chunks[0], transport.Chunks[1] = transport.Chunks[1], transport.Chunks[0]
	changed.SessionPlan = &transport
	if _, e := v.verify(changed); e == nil {
		t.Fatal("changed chunk ordering reused cached proof")
	}
	changed = job
	changed.Plan = wire.Hash([]byte("different locked identity"))
	if _, e := v.verify(changed); e == nil {
		t.Fatal("changed full plan identity reused proof")
	}
}
func TestPlanVerifierEvictsAndDeclinesOversizedScopes(t *testing.T) {
	objects := map[string][]byte{}
	reads := 0
	v := planVerifier{fetch: func(o wire.Object) ([]byte, error) { reads++; return objects[o.SHA256], nil }}
	var oldest wire.Job
	for i := 0; i < 5; i++ {
		job, payload := verifierFixture(t, fmt.Sprintf("distinct-%d", i), []string{"corpus-0001"})
		for id, b := range payload {
			objects[id] = b
		}
		if i == 0 {
			oldest = job
		}
		if _, e := v.verify(job); e != nil {
			t.Fatal(e)
		}
		if len(v.entries) > planVerificationCacheEntries || v.bytes > planVerificationCacheBytes {
			t.Fatal("unbounded proof cache")
		}
	}
	before := reads
	if _, e := v.verify(oldest); e != nil || reads == before {
		t.Fatal("evicted scope did not verify again", e)
	}
	names := []string{}
	for i := 0; i < 10000; i++ {
		names = append(names, fmt.Sprintf("corpus-%05d-", i)+strings.Repeat("x", 115))
	}
	job, payload := verifierFixture(t, "large membership", names)
	fresh := planVerifier{fetch: func(o wire.Object) ([]byte, error) { return payload[o.SHA256], nil }}
	scope, e := fresh.verify(job)
	if e != nil || len(scope.Corpora) != 10000 {
		t.Fatal(e)
	}
	if len(fresh.entries) != 0 || fresh.bytes != 0 {
		t.Fatal("oversized scope retained")
	}
}
