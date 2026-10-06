package wire

import (
	"encoding/json"
	"sort"
	"strings"
)

type ReportEvidence struct {
	PassContexts           []string          `json:"passContexts"`
	AnalysisSectionVersion string            `json:"analysisSectionVersion"`
	AnalysisSections       map[string]string `json:"analysisSections"`
}

func ReportEvidenceData(data []byte) (ReportEvidence, error) {
	var report ReportEvidence
	if err := json.Unmarshal(data, &report); err != nil {
		return report, Invalid("invalid report evidence")
	}
	if len(report.AnalysisSections) > 64 || report.AnalysisSectionVersion != "" && report.AnalysisSectionVersion != "source-fields-v1" || len(report.AnalysisSections) > 0 && report.AnalysisSectionVersion == "" {
		return report, Invalid("invalid report analysis sections")
	}
	for field, digest := range report.AnalysisSections {
		if len(field) == 0 || len(field) > 128 || !IsHash(digest) {
			return report, Invalid("invalid report analysis reference")
		}
		for _, c := range field {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_') {
				return report, Invalid("invalid source field name")
			}
		}
		if strings.HasSuffix(field, "_version") {
			return report, Invalid("analysis version is not a section")
		}
	}
	for _, digest := range report.PassContexts {
		if !IsHash(digest) {
			return report, Invalid("invalid pass context reference")
		}
	}
	return report, nil
}
func (r ReportEvidence) Roots() []string {
	roots := append([]string{}, r.PassContexts...)
	fields := []string{}
	for field := range r.AnalysisSections {
		fields = append(fields, field)
	}
	sort.Strings(fields)
	for _, field := range fields {
		roots = append(roots, r.AnalysisSections[field])
	}
	return roots
}

type ReportAnalysis struct {
	Kind     string          `json:"kind"`
	Schema   int             `json:"schema"`
	ReportID string          `json:"reportId"`
	Field    string          `json:"field"`
	Data     json.RawMessage `json:"data"`
}

func ValidateReportAnalysis(data []byte, reportID, field string) error {
	var section ReportAnalysis
	if err := Decode(data, &section); err != nil {
		return err
	}
	if section.Kind != "report-analysis" || section.Schema != 1 || section.ReportID != reportID || section.Field != field || len(section.Data) == 0 || !json.Valid(section.Data) {
		return Invalid("report analysis identity differs")
	}
	return nil
}
