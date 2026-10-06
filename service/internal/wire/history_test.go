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
	for _, field := range []string{`"sourceDate":null`, `"release":null`, `"targetDates":null`, `"targetDates":[]`, `"targetDate":""`, `"sourceRevision":""`, `"unknown":1`} {
		body := []byte(`{"reportId":"` + strings.Repeat("a", 64) + `","configurationId":"` + strings.Repeat("b", 64) + `","policy":"declared-build-history-v1","buildRole":"source",` + field + `}`)
		var h HistoryBinding
		if e := Decode(body, &h); e == nil {
			t.Fatal("ambiguous optional field accepted", field)
		}
	}
}

func TestHistoryTargetAliasesAreBoundedCanonicalMetadata(t *testing.T) {
	h := HistoryBinding{ReportID: strings.Repeat("a", 64), ConfigurationID: strings.Repeat("b", 64), Policy: HistoryBindingPolicy, BuildRole: "source", TargetDates: []string{"2026-01-03", "2026-01-10"}}
	if err := h.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, dates := range [][]string{{}, {"2026-01-10", "2026-01-03"}, {"2026-01-03", "2026-01-03"}, {"2026-02-30"}, {"0000-01-01"}, make([]string, HistoryTargetLimit+1)} {
		bad := h
		bad.TargetDates = dates
		if err := bad.Validate(); err == nil {
			t.Fatal("invalid aliases admitted", dates)
		}
	}
	h.TargetDate = "2026-01-03"
	if err := h.Validate(); err == nil {
		t.Fatal("ambiguous singular/plural targets admitted")
	}
}

func TestHistoryReleaseRetainsRecordedDatePrecision(t *testing.T) {
	base := HistoryBinding{ReportID: strings.Repeat("a", 64), ConfigurationID: strings.Repeat("b", 64), Policy: HistoryBindingPolicy, BuildRole: "release"}
	release := HistoryRelease{Version: "v1.2.3", PublishedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), URL: "https://example.test/release"}
	legacy, err := Encode(release)
	if err != nil || strings.Contains(string(legacy), "datePrecision") {
		t.Fatal("legacy release identity changed", err)
	}
	for _, precision := range []string{"day", "second"} {
		r := release
		r.DatePrecision = precision
		h := base
		h.Release = &r
		if err := h.Validate(); err != nil {
			t.Fatal(err)
		}
		body, _ := Encode(h)
		var decoded HistoryBinding
		if err := Decode(body, &decoded); err != nil || decoded.Release.DatePrecision != precision {
			t.Fatal("precision lost", err)
		}
	}
	for _, change := range []HistoryRelease{
		{Version: release.Version, PublishedAt: release.PublishedAt, URL: release.URL, DatePrecision: "guessed"},
		{Version: release.Version, PublishedAt: release.PublishedAt.Add(time.Hour), URL: release.URL, DatePrecision: "day"},
		{Version: release.Version, PublishedAt: release.PublishedAt.Add(time.Nanosecond), URL: release.URL, DatePrecision: "second"},
		{Version: release.Version, PublishedAt: release.PublishedAt.In(time.FixedZone("source", 3600)), URL: release.URL, DatePrecision: "day"},
	} {
		h := base
		h.Release = &change
		if err := h.Validate(); err == nil {
			t.Fatal("misleading release precision admitted", change)
		}
	}
	for _, value := range []string{"null", `""`} {
		var decoded HistoryRelease
		body := []byte(`{"version":"v1.2.3","publishedAt":"2026-01-01T00:00:00Z","url":"https://example.test/release","datePrecision":` + value + `}`)
		if err := Decode(body, &decoded); err == nil {
			t.Fatal("ambiguous optional precision admitted", value)
		}
	}
}
