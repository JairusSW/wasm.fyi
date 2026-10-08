package wire

import (
	"bytes"
	"encoding/json"
	"net/url"
	"sort"
	"strings"
	"time"
)

const HistoryBindingPolicy = "declared-build-history-v1"
const HistoryBindingLimit = 256
const HistoryTargetLimit = 256

// HistoryBinding is website interpretation supplied by the publisher. It does
// not alter a producer result, its collection time, or independent observations.
type HistoryBinding struct {
	ReportID        string          `json:"reportId"`
	ConfigurationID string          `json:"configurationId"`
	Policy          string          `json:"policy"`
	TargetDate      string          `json:"targetDate,omitempty"`
	TargetDates     []string        `json:"targetDates,omitempty"`
	SourceDate      *time.Time      `json:"sourceDate,omitempty"`
	SourceRevision  string          `json:"sourceRevision,omitempty"`
	BuildRole       string          `json:"buildRole"`
	Release         *HistoryRelease `json:"release,omitempty"`
}

// Optional dates are absent when unknown; explicit null/empty fields must not
// silently become absence during decoding and change a publication identity.
func (h *HistoryBinding) UnmarshalJSON(data []byte) error {
	type plain HistoryBinding
	var decoded plain
	if e := Decode(data, &decoded); e != nil {
		return e
	}
	var fields map[string]json.RawMessage
	if e := json.Unmarshal(data, &fields); e != nil {
		return e
	}
	for name, value := range fields {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return Invalid("null history binding field")
		}
		if (name == "targetDate" || name == "sourceRevision") && bytes.Equal(bytes.TrimSpace(value), []byte(`""`)) {
			return Invalid("empty history binding field")
		}
	}
	if _, present := fields["targetDates"]; present && len(decoded.TargetDates) == 0 {
		return Invalid("empty history target aliases")
	}
	*h = HistoryBinding(decoded)
	return nil
}

type HistoryRelease struct {
	Version       string    `json:"version"`
	PublishedAt   time.Time `json:"publishedAt"`
	URL           string    `json:"url"`
	DatePrecision string    `json:"datePrecision,omitempty"`
}

func (r *HistoryRelease) UnmarshalJSON(data []byte) error {
	type plain HistoryRelease
	var decoded plain
	if err := Decode(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if value, present := fields["datePrecision"]; present &&
		(bytes.Equal(bytes.TrimSpace(value), []byte("null")) || bytes.Equal(bytes.TrimSpace(value), []byte(`""`))) {
		return Invalid("empty release date precision")
	}
	*r = HistoryRelease(decoded)
	return nil
}

func (h HistoryBinding) Validate() error {
	if !IsHash(h.ReportID) || !IsHash(h.ConfigurationID) || h.Policy != HistoryBindingPolicy {
		return Invalid("invalid history binding identity")
	}
	if h.TargetDate != "" {
		d, e := time.Parse("2006-01-02", h.TargetDate)
		if e != nil || d.Year() < 1 || d.Format("2006-01-02") != h.TargetDate {
			return Invalid("invalid history target date")
		}
	}
	if h.TargetDates != nil {
		if h.TargetDate != "" || len(h.TargetDates) == 0 || len(h.TargetDates) > HistoryTargetLimit || !sort.StringsAreSorted(h.TargetDates) {
			return Invalid("invalid history target aliases")
		}
		for i, target := range h.TargetDates {
			d, e := time.Parse("2006-01-02", target)
			if e != nil || d.Year() < 1 || d.Format("2006-01-02") != target || i > 0 && h.TargetDates[i-1] == target {
				return Invalid("invalid history target alias date")
			}
		}
	}
	if h.SourceDate != nil && (h.SourceDate.IsZero() || h.SourceDate.Year() < 1 || h.SourceDate.Year() > 9999) {
		return Invalid("invalid history source date")
	}
	if h.SourceRevision != "" && !revisionPattern.MatchString(h.SourceRevision) {
		return Invalid("invalid history source revision")
	}
	switch h.BuildRole {
	case "source", "unknown", "fixed-baseline":
		if h.Release != nil {
			return Invalid("release association requires release role")
		}
	case "release":
		if h.Release == nil {
			return Invalid("release role requires explicit association")
		}
	default:
		return Invalid("invalid history build role")
	}
	if h.Release != nil {
		r := h.Release
		_, offset := r.PublishedAt.Zone()
		if r.DatePrecision != "" && r.DatePrecision != "day" && r.DatePrecision != "second" ||
			r.DatePrecision == "second" && r.PublishedAt.Nanosecond() != 0 ||
			r.DatePrecision == "day" && (offset != 0 || r.PublishedAt.Hour() != 0 || r.PublishedAt.Minute() != 0 || r.PublishedAt.Second() != 0 || r.PublishedAt.Nanosecond() != 0) {
			return Invalid("invalid release date precision")
		}
		u, e := url.Parse(r.URL)
		if len(r.Version) == 0 || strings.TrimSpace(r.Version) != r.Version || strings.ContainsAny(r.Version, "\n\r\x00") || len(r.Version) > 256 || (r.PublishedAt.IsZero() || r.PublishedAt.Year() < 1 || r.PublishedAt.Year() > 9999) || len(r.URL) > 2048 || e != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
			return Invalid("invalid history release association")
		}
	}
	return nil
}
func (j Job) ValidateHistory() error {
	if len(j.History) > HistoryBindingLimit {
		return Invalid("history binding count exceeds ceiling")
	}
	if len(j.History) == 0 {
		return nil
	}
	reports := map[string]bool{}
	for _, x := range j.Exports {
		reports[x.Manifest.ReportID] = true
	}
	seen := map[string]bool{}
	for _, h := range j.History {
		if e := h.Validate(); e != nil {
			return e
		}
		key := h.ReportID + ":" + h.ConfigurationID
		if seen[key] || !reports[h.ReportID] {
			return Invalid("duplicate or foreign history binding")
		}
		seen[key] = true
	}
	return nil
}
