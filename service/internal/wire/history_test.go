package wire

import (
	"strings"
	"testing"
	"time"
)

func TestHistoryBindingDatesAndReleaseRoles(t *testing.T) {
	source := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	valid := HistoryBinding{ReportID: strings.Repeat("a", 64), ConfigurationID: strings.Repeat("b", 64), Policy: HistoryBindingPolicy, TargetDate: "2026-01-01", SourceDate: &source, SourceRevision: strings.Repeat("c", 40), BuildRole: "source"}
	if e := valid.Validate(); e != nil {
		t.Fatal(e)
	}
	release := HistoryRelease{Version: "v1.2.3", PublishedAt: source, URL: "https://example.test/releases/v1.2.3"}
	cases := []HistoryBinding{}
	for _, mutate := range []func(*HistoryBinding){func(h *HistoryBinding) { h.Release = &release }, func(h *HistoryBinding) { h.BuildRole = "release" }, func(h *HistoryBinding) { h.TargetDate = "2026-02-30" }, func(h *HistoryBinding) { h.SourceRevision = "main" }, func(h *HistoryBinding) { h.BuildRole = "stable" }, func(h *HistoryBinding) { h.Policy = "guess" }} {
		h := valid
		mutate(&h)
		cases = append(cases, h)
	}
	for _, h := range cases {
		if e := h.Validate(); e == nil {
			t.Fatal("invalid history accepted", h)
		}
	}
	valid.BuildRole = "release"
	valid.Release = &release
	if e := valid.Validate(); e != nil {
		t.Fatal(e)
	}
	j := Job{History: []HistoryBinding{valid}, Exports: []Export{{Manifest: Manifest{ReportID: valid.ReportID}}}}
	if e := j.ValidateHistory(); e != nil {
		t.Fatal(e)
	}
	j.History = append(j.History, valid)
	if e := j.ValidateHistory(); e == nil {
		t.Fatal("duplicate binding accepted")
	}
	j.History = []HistoryBinding{valid}
	j.Exports = nil
	if e := j.ValidateHistory(); e == nil {
		t.Fatal("foreign report accepted")
	}
	for _, bad := range []string{"http://example.test/release", "https://user:password@example.test/release", "https:///release"} {
		r := release
		r.URL = bad
		h := valid
		h.Release = &r
		if e := h.Validate(); e == nil {
			t.Fatal("invalid release URL accepted")
		}
	}
}

func TestHistoryBindingRejectsAmbiguousOptionalFields(t *testing.T) {
	for _, field := range []string{`"sourceDate":null`, `"release":null`, `"targetDate":""`, `"sourceRevision":""`, `"unknown":1`} {
		body := []byte(`{"reportId":"` + strings.Repeat("a", 64) + `","configurationId":"` + strings.Repeat("b", 64) + `","policy":"declared-build-history-v1","buildRole":"source",` + field + `}`)
		var h HistoryBinding
		if e := Decode(body, &h); e == nil {
			t.Fatal("ambiguous optional field accepted", field)
		}
	}
}
