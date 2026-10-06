package wire

import (
	"strings"
	"testing"
)

func methodFixture() (MeasurementMethod, Result) {
	recipe := []byte(`{"options":{"profile":"timing","scenarios":["steady"]},"protocol":1}`)
	m := MeasurementMethod{Schema: 1, Status: "available", Metric: "time.wall", Scenario: "steady", Profile: "timing", Statistic: "median_ns_per_operation", Recipe: recipe, RecipeSHA256: Hash(recipe), CollectorStatus: "not_recorded", Observations: []ObservationIdentity{}}
	r := Result{Metric: m.Metric, Scenario: m.Scenario, Profile: m.Profile, Statistic: m.Statistic, MeasurementMethodID: m.ID()}
	return m, r
}

func TestMethodIdentityAndScopeValidation(t *testing.T) {
	m, r := methodFixture()
	if e := m.Validate(r); e != nil {
		t.Fatal(e)
	}
	for _, change := range []func(*MeasurementMethod, *Result){
		func(m *MeasurementMethod, r *Result) { r.Metric = "process.rss" },
		func(m *MeasurementMethod, r *Result) { m.Schema = 2 },
		func(m *MeasurementMethod, r *Result) { m.RecipeSHA256 = strings.Repeat("0", 64) },
		func(m *MeasurementMethod, r *Result) {
			m.Recipe = []byte(`{"options":{"profile":"memory","scenarios":["steady"]}}`)
			m.RecipeSHA256 = Hash(m.Recipe)
		},
		func(m *MeasurementMethod, r *Result) { m.Status = "unavailable"; m.Reason = "fixture" },
		func(m *MeasurementMethod, r *Result) { m.CollectorStatus = "recorded" },
		func(m *MeasurementMethod, r *Result) {
			m.Observations = []ObservationIdentity{{Collector: "test"}, {Collector: "test"}}
			m.CollectorStatus = "recorded"
		},
	} {
		m, r := methodFixture()
		change(&m, &r)
		r.MeasurementMethodID = m.ID()
		if e := m.Validate(r); e == nil {
			t.Fatal("invalid method accepted")
		}
	}
	m, r = methodFixture()
	r.MeasurementMethodID = strings.Repeat("0", 64)
	if e := m.Validate(r); e == nil {
		t.Fatal("wrong method digest accepted")
	}
	m, r = methodFixture()
	m.Status = "unavailable"
	m.Reason = "source absent"
	m.Recipe = nil
	m.RecipeSHA256 = ""
	r.MeasurementMethodID = m.ID()
	if e := m.Validate(r); e != nil {
		t.Fatal(e)
	}
}
