package store

import "github.com/JairusSW/wasm.fyi/service/internal/wire"

func validateReportSections(id string, report wire.ReportEvidence, fetch func(string) ([]byte, error)) error {
	for field, digest := range report.AnalysisSections {
		b, err := fetch(digest)
		if err != nil {
			return err
		}
		b, err = inspectionJSON(b, fetch)
		if err != nil {
			return err
		}
		if err = wire.ValidateReportAnalysis(b, id, field); err != nil {
			return err
		}
	}
	return nil
}
