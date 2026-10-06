package api

import (
	"encoding/json"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

const configurationProjection = "configuration-display-v1"

// Catalog selectors need display facts, not invocations or host dependency paths.
// IDs still reference the unchanged canonical record at configurations/{id}.
func configurationSummary(record wire.Record) (wire.Record, error) {
	var source map[string]json.RawMessage
	if err := wire.Decode(record.Data, &source); err != nil {
		return record, err
	}
	data := map[string]json.RawMessage{}
	for _, field := range []string{"id", "runtime", "version", "backend"} {
		if value, ok := source[field]; ok {
			data[field] = value
		}
	}
	if raw := source["description"]; len(raw) != 0 && string(raw) != "null" {
		var description map[string]json.RawMessage
		if err := wire.Decode(raw, &description); err != nil {
			return record, err
		}
		public := map[string]json.RawMessage{}
		for _, field := range []string{"runtime", "runtime_version", "backend", "embedding", "capabilities", "scenarios", "abis", "features", "phase_release_policy", "phase_barrier_scenarios"} {
			if value, ok := description[field]; ok {
				public[field] = value
			}
		}
		encoded, err := wire.Encode(public)
		if err != nil {
			return record, err
		}
		data["description"] = encoded
	}
	var err error
	record.Data, err = wire.Encode(data)
	return record, err
}
