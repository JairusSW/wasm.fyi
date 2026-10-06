package wire

import (
	"bytes"
	"encoding/json"
	"net/url"
	"sort"
	"strings"
	"time"
)

type CoverageBuild struct {
	Engine        string  `json:"engine"`
	Role          string  `json:"role"`
	Repository    *string `json:"repository"`
	Version       *string `json:"version"`
	Revision      *string `json:"revision"`
	SourceDate    *string `json:"sourceDate"`
	ReleaseDate   *string `json:"releaseDate"`
	DatePrecision *string `json:"datePrecision"`
	URL           *string `json:"url"`
}

type HistoryCoverage struct {
	Schema                 int           `json:"schema"`
	CoverageID             string        `json:"coverageId"`
	Policy                 string        `json:"policy"`
	Host                   string        `json:"host"`
	CorpusSHA256           string        `json:"corpusSha256"`
	RecipeSHA256           string        `json:"recipeSha256"`
	JobID                  *string       `json:"jobId"`
	Configuration          *string       `json:"configuration"`
	TargetDates            []string      `json:"targetDates"`
	TargetRelease          *string       `json:"targetRelease,omitempty"`
	TargetType             string        `json:"targetType"`
	DesiredBuild           CoverageBuild `json:"desiredBuild"`
	Configured             *bool         `json:"configured"`
	Status                 string        `json:"status"`
	RecordedStatus         *string       `json:"recordedStatus"`
	Reason                 *string       `json:"reason"`
	ObservedSourceRevision *string       `json:"observedSourceRevision"`
	SourceReportSHA256     *string       `json:"sourceReportSha256"`
	CollectedAt            *string       `json:"collectedAt"`
	PublishedRevision      *string       `json:"publishedRevision"`
	InterpretationSource   string        `json:"interpretationSource"`
}

// Logical coverage identities use JSON.stringify-compatible ASCII scope fields.
// Descriptor hashes use the exact canonical publication bytes independently.
func coverageHash(value any) string {
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	encoder.SetEscapeHTML(false)
	encoder.Encode(value)
	return Hash(bytes.TrimSuffix(body.Bytes(), []byte("\n")))
}
func (v HistoryCoverage) Scope() string {
	return coverageHash([]string{"history-coverage-scope-v1", v.Host, v.CorpusSHA256, v.RecipeSHA256})
}
func coverageRevision(value string) bool {
	return revisionPattern.MatchString(value) || len(value) == 64 && IsHash(value)
}
func coverageDate(value string) bool {
	parsed, err := time.Parse("2006-01-02", value)
	return err == nil && parsed.Year() > 0 && parsed.Format("2006-01-02") == value
}
func coverageTime(value *string) bool {
	if value == nil {
		return true
	}
	parsed, err := time.Parse(time.RFC3339Nano, *value)
	return err == nil && parsed.Year() > 0 && parsed.Year() <= 9999
}
func HistoryCoverageData(data []byte) (HistoryCoverage, error) {
	var v HistoryCoverage
	if len(data)+512 > 10*1024 {
		return v, Invalid("history coverage descriptor exceeds budget")
	}
	if err := Decode(data, &v); err != nil {
		return v, err
	}
	var fields map[string]json.RawMessage
	json.Unmarshal(data, &fields)
	for _, field := range []string{"jobId", "configuration", "configured", "recordedStatus", "reason", "observedSourceRevision", "sourceReportSha256", "collectedAt", "publishedRevision"} {
		if _, ok := fields[field]; !ok {
			return v, Invalid("missing history coverage availability")
		}
	}
	if v.Schema != 1 || v.Policy != "recorded-history-coverage-v1" || !IsHash(v.CoverageID) || !IsHash(v.CorpusSHA256) || !IsHash(v.RecipeSHA256) || len(v.Host) > 128 || strings.Count(v.Host, "/") != 1 || v.InterpretationSource != "trusted-publisher-assertion" {
		return v, Invalid("invalid history coverage scope")
	}
	for _, part := range strings.Split(v.Host, "/") {
		if !IsIdentity(part) {
			return v, Invalid("invalid historical host scope")
		}
	}
	if v.TargetType != "weekly" && v.TargetType != "main" && v.TargetType != "release" {
		return v, Invalid("invalid historical target type")
	}
	if v.TargetDates == nil || len(v.TargetDates) > 256 || !sort.StringsAreSorted(v.TargetDates) {
		return v, Invalid("invalid history coverage targets")
	}
	for i, date := range v.TargetDates {
		if !coverageDate(date) || i > 0 && date == v.TargetDates[i-1] {
			return v, Invalid("invalid history coverage target date")
		}
	}
	if v.TargetRelease != nil && (len(*v.TargetRelease) == 0 || len(*v.TargetRelease) > 256 || strings.ContainsAny(*v.TargetRelease, "\r\n\x00\u2028\u2029")) {
		return v, Invalid("invalid unavailable release identity")
	}
	statuses := map[string]bool{"collected": true, "uncollected": true, "pending-binding": true, "unavailable": true, "runner-error": true, "building": true, "running": true}
	if !statuses[v.Status] || v.RecordedStatus == nil && v.Status != "uncollected" {
		return v, Invalid("invalid history coverage status")
	}
	if v.RecordedStatus != nil {
		expected := *v.RecordedStatus
		if expected == "uncollected" {
			return v, Invalid("unknown recorded collector status")
		}
		if expected == "not-collected" {
			expected = "uncollected"
		}
		if expected != v.Status {
			return v, Invalid("recorded history status differs")
		}
	}
	if v.Configuration != nil && !IsIdentity(*v.Configuration) || v.Reason != nil && len(*v.Reason) > 2048 || !coverageTime(v.CollectedAt) {
		return v, Invalid("invalid history coverage metadata")
	}
	if v.ObservedSourceRevision != nil && !coverageRevision(*v.ObservedSourceRevision) {
		return v, Invalid("invalid observed history revision")
	}
	if v.Status == "collected" {
		if v.JobID == nil || v.Configuration == nil || v.SourceReportSHA256 == nil || !IsHash(*v.SourceReportSHA256) || v.CollectedAt == nil {
			return v, Invalid("collected history lacks recorded source")
		}
	} else if v.SourceReportSHA256 != nil || v.CollectedAt != nil || v.ObservedSourceRevision != nil || v.PublishedRevision != nil {
		return v, Invalid("uncollected history claims measurement evidence")
	}
	if v.PublishedRevision != nil && !IsHash(*v.PublishedRevision) {
		return v, Invalid("invalid history publication reference")
	}
	b := v.DesiredBuild
	var buildFields map[string]json.RawMessage
	json.Unmarshal(fields["desiredBuild"], &buildFields)
	for _, name := range []string{"repository", "version", "revision", "sourceDate", "releaseDate", "datePrecision", "url"} {
		if _, ok := buildFields[name]; !ok {
			return v, Invalid("missing requested build availability")
		}
	}
	if !IsIdentity(b.Engine) || (b.Role != "source" && b.Role != "release") || b.Revision != nil && !coverageRevision(*b.Revision) {
		return v, Invalid("invalid requested history build")
	}
	for _, text := range []*string{b.Repository, b.Version, b.URL} {
		if text != nil && (len(*text) > 2048 || strings.ContainsAny(*text, "\r\n\x00")) {
			return v, Invalid("invalid requested build metadata")
		}
	}
	if !coverageTime(b.SourceDate) || !coverageTime(b.ReleaseDate) {
		return v, Invalid("invalid requested history date")
	}
	if b.Role == "source" && (b.Version != nil || b.ReleaseDate != nil) {
		return v, Invalid("source target claims a release marker")
	}
	if b.DatePrecision != nil && *b.DatePrecision != "day" && *b.DatePrecision != "second" {
		return v, Invalid("invalid requested date precision")
	}
	if b.DatePrecision != nil && b.ReleaseDate != nil {
		parsed, _ := time.Parse(time.RFC3339Nano, *b.ReleaseDate)
		_, offset := parsed.Zone()
		if *b.DatePrecision == "second" && parsed.Nanosecond() != 0 || *b.DatePrecision == "day" && (offset != 0 || parsed.Hour() != 0 || parsed.Minute() != 0 || parsed.Second() != 0 || parsed.Nanosecond() != 0) {
			return v, Invalid("requested release precision differs")
		}
	}
	if b.URL != nil {
		u, err := url.Parse(*b.URL)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
			return v, Invalid("invalid requested release URL")
		}
	}
	if v.JobID != nil {
		if !IsHash(*v.JobID) || v.Configuration == nil || v.Configured == nil || len(v.TargetDates) == 0 || v.CoverageID != coverageHash([]any{"history-coverage-v1", v.Host, v.CorpusSHA256, v.RecipeSHA256, *v.JobID, *v.Configuration}) {
			return v, Invalid("queued history coverage identity differs")
		}
	} else {
		if v.Status != "unavailable" || len(v.TargetDates) > 1 || len(v.TargetDates) == 0 && v.TargetRelease == nil || v.Configuration == nil && v.Configured != nil {
			return v, Invalid("invalid unresolved historical target")
		}
		var target any
		if len(v.TargetDates) == 1 {
			target = v.TargetDates[0]
		}
		var key []byte
		// Target release strings are ordinary recorded version labels; HTML escaping
		// is disabled for identity parity with the producer's logical tuple.
		var keyBuffer bytes.Buffer
		encoder := json.NewEncoder(&keyBuffer)
		encoder.SetEscapeHTML(false)
		encoder.Encode([]any{b.Engine, v.TargetType, target, v.TargetRelease})
		key = bytes.TrimSuffix(keyBuffer.Bytes(), []byte("\n"))
		if v.CoverageID != coverageHash([]any{"history-unavailable-v1", v.Host, v.CorpusSHA256, v.RecipeSHA256, string(key), v.Configuration}) {
			return v, Invalid("unavailable history coverage identity differs")
		}
	}
	return v, nil
}
