package wire

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestPlanRegistrationBeforeAnyAttempt(t *testing.T) {
	pin := strings.Repeat("a", 40)
	raw := []byte(`{"schema":1,"configuredHarnessPin":"` + pin + `","machines":[{"name":"local"},{"name":"hub"}],"jobs":[{"id":"corpus-0001"},{"id":"corpus-0002"}],"note":"<λ>"}`)
	r := PlanRegistration{Schema: 1, Session: "planned-session", Plan: Hash(raw), ConfiguredHarnessPin: pin, SessionPlan: SessionPlan{Schema: 1, Bytes: len(raw), Chunks: []Object{{SHA256: Hash(raw), Bytes: len(raw), Kind: "binary"}}}}
	fetch := func(Object) ([]byte, error) { return raw, nil }
	scope, e := r.Verify(context.Background(), fetch)
	if e != nil {
		t.Fatal(e)
	}
	if len(scope.Members) != 2 || len(scope.Corpora) != 2 || !scope.Contains("hub", "corpus-0002") {
		t.Fatal(scope)
	}
	// The same proof retains completed-job membership validation.
	for _, pair := range [][2]string{{"local", "corpus-0001"}, {"hub", "corpus-0002"}} {
		j := Job{Plan: r.Plan, ConfiguredHarnessPin: pin, Machine: pair[0], Corpus: pair[1]}
		got, e := r.SessionPlan.Verify(j, fetch)
		if e != nil || got.Plan != scope.Plan {
			t.Fatal(got, e)
		}
	}
	if _, e := r.SessionPlan.Verify(Job{Plan: r.Plan, ConfiguredHarnessPin: pin, Machine: "outside", Corpus: "corpus-0001"}, fetch); e == nil {
		t.Fatal("outside job admitted")
	}
	for _, mutate := range []func(*PlanRegistration){func(r *PlanRegistration) { r.Schema = 2 }, func(r *PlanRegistration) { r.Session = "../escape" }, func(r *PlanRegistration) { r.Plan = Hash([]byte("wrong")) }, func(r *PlanRegistration) { r.ConfiguredHarnessPin = strings.Repeat("b", 40) }, func(r *PlanRegistration) { r.ConfiguredHarnessPin = "short" }, func(r *PlanRegistration) { r.SessionPlan.Bytes++ }} {
		bad := r
		mutate(&bad)
		if _, e := bad.Verify(context.Background(), fetch); e == nil {
			t.Fatal("invalid registration admitted", bad)
		}
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	if _, e := r.Verify(canceled, func(Object) ([]byte, error) { called = true; return raw, nil }); !errors.Is(e, context.Canceled) || called {
		t.Fatal(e, called)
	}
	// Cancellation during the last read must not publish a complete proof.
	ctx, cancel := context.WithCancel(context.Background())
	if _, e := r.Verify(ctx, func(Object) ([]byte, error) { cancel(); return raw, nil }); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
}
