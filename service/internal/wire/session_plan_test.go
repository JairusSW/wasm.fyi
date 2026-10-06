package wire

import (
	"bytes"
	"strings"
	"testing"
)

func TestSessionPlanExactBytesMembershipAndBounds(t *testing.T) {
	raw := []byte(`{"schema":1,"machines":[{"name":"local","workers":"25%"}],"jobs":[{"id":"corpus-0001","workloads":[]}],"configuredHarnessPin":"0509a0a","note":"<unicode: λ>"}`)
	job := Job{Plan: Hash(raw), ConfiguredHarnessPin: "0509a0a", Machine: "local", Corpus: "corpus-0001"}
	p := SessionPlan{Schema: 1, Bytes: len(raw), Chunks: []Object{{SHA256: Hash(raw), Bytes: len(raw), Kind: "binary"}}}
	fetch := func(o Object) ([]byte, error) { return raw, nil }
	scope, e := p.Verify(job, fetch)
	if e != nil || !scope.Contains("local", "corpus-0001") || scope.Contains("other", "corpus-0001") {
		t.Fatal(scope, e)
	}
	for _, change := range []func(*Job){func(j *Job) { j.Plan = Hash([]byte("wrong")) }, func(j *Job) { j.Machine = "other" }, func(j *Job) { j.Corpus = "unknown" }, func(j *Job) { j.ConfiguredHarnessPin = "different" }} {
		bad := job
		change(&bad)
		if _, e := p.Verify(bad, fetch); e == nil {
			t.Fatal("bad source binding admitted")
		}
	}
	if _, e := p.Verify(job, func(Object) ([]byte, error) { return bytes.Repeat([]byte("x"), len(raw)), nil }); e == nil {
		t.Fatal("corrupt source admitted")
	}
	for _, bad := range []string{
		strings.Replace(string(raw), `"machines":[{"name":"local","workers":"25%"}]`, `"machines":[{"name":"local"},{"name":"local"}]`, 1),
		strings.Replace(string(raw), `"schema":1`, `"schema":1,"id":"unlocked-session"`, 1),
		strings.Replace(string(raw), `"schema":1`, `"schema":1,"schema":1`, 1),
		strings.Replace(string(raw), `"jobs":[{"id":"corpus-0001","workloads":[]}]`, `"jobs":[]`, 1),
	} {
		b := []byte(bad)
		j := job
		j.Plan = Hash(b)
		transport := SessionPlan{Schema: 1, Bytes: len(b), Chunks: []Object{{SHA256: Hash(b), Bytes: len(b), Kind: "binary"}}}
		if _, e := transport.Verify(j, func(Object) ([]byte, error) { return b, nil }); e == nil {
			t.Fatal("invalid locked plan admitted", bad)
		}
	}
	// A large source plan is a bounded multi-chunk object, not an ordinary JSON
	// response or an inline job manifest. Exact original ordering is retained.
	large := []byte(strings.Replace(string(raw), "<unicode: λ>", strings.Repeat("x", ReportFileChunkBytes+31), 1))
	transport := SessionPlan{Schema: 1, Bytes: len(large)}
	objects := map[string][]byte{}
	for start := 0; start < len(large); start += ReportFileChunkBytes {
		end := min(len(large), start+ReportFileChunkBytes)
		b := large[start:end]
		o := Object{SHA256: Hash(b), Bytes: len(b), Kind: "binary"}
		transport.Chunks = append(transport.Chunks, o)
		objects[o.SHA256] = b
	}
	job.Plan = Hash(large)
	if _, e := transport.Verify(job, func(o Object) ([]byte, error) { return objects[o.SHA256], nil }); e != nil {
		t.Fatal(e)
	}
	transport.Bytes = SessionPlanBytes + 1
	if e := transport.Validate(); e == nil {
		t.Fatal("oversized plan admitted")
	}
}
