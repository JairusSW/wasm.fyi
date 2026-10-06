package testutil

import (
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func HistoryCoverageFixture(seed, host string) (wire.Job, error) {
	configuration, jobID, recorded, reason := "wago", wire.Hash([]byte(seed)), "unavailable", "No completed source <available> & no execution."
	enabled := true
	value := wire.HistoryCoverage{Schema: 1, Policy: "recorded-history-coverage-v1", Host: host, CorpusSHA256: wire.Hash([]byte("contracts")), RecipeSHA256: wire.Hash([]byte("recipe")), JobID: &jobID, Configuration: &configuration, TargetDates: []string{"2026-10-03"}, TargetType: "main", DesiredBuild: wire.CoverageBuild{Engine: "wago", Role: "source"}, Configured: &enabled, Status: "unavailable", RecordedStatus: &recorded, Reason: &reason, InterpretationSource: "trusted-publisher-assertion"}
	identity, _ := wire.Encode([]any{"history-coverage-v1", host, value.CorpusSHA256, value.RecipeSHA256, jobID, configuration})
	value.CoverageID = wire.Hash(identity)
	data, err := wire.Encode(value)
	if err != nil {
		return wire.Job{}, err
	}
	scope := value.Scope()
	return wire.Job{Schema: 3, Kind: "history-coverage", Session: "coverage-" + scope, Machine: "reported-host", Corpus: "history-coverage", Attempt: seed, Plan: scope, Status: "completed", Exports: []wire.Export{}, HistoryCoverage: []json.RawMessage{data}}, nil
}
