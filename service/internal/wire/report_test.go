package wire

import (
	"strings"
	"testing"
)

func TestReportSectionContract(t *testing.T) {
	hash := strings.Repeat("a", 64)
	for _, data := range []string{`{"analysisSections":{"throughput":"` + hash + `"}}`, `{"analysisSectionVersion":"unknown"}`, `{"analysisSectionVersion":"source-fields-v1","analysisSections":{"bad.name":"` + hash + `"}}`, `{"analysisSectionVersion":"source-fields-v1","analysisSections":{"throughput":"bad"}}`} {
		if _, err := ReportEvidenceData([]byte(data)); err == nil {
			t.Fatal("invalid section descriptor accepted", data)
		}
	}
	if report, err := ReportEvidenceData([]byte(`{}`)); err != nil || len(report.Roots()) != 0 {
		t.Fatal("legacy report rejected", err)
	}
	data := []byte(`{"kind":"report-analysis","schema":1,"reportId":"` + hash + `","field":"throughput","data":{"value":9007199254740993}}`)
	if err := ValidateReportAnalysis(data, hash, "throughput"); err != nil {
		t.Fatal(err)
	}
	if err := ValidateReportAnalysis(data, hash, "scaling"); err == nil {
		t.Fatal("foreign field accepted")
	}
}
