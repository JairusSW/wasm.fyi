package wire

import "encoding/json"

type NativeMetadata struct {
	Kind     string `json:"kind"`
	ReportID string `json:"reportId"`
	PassID   string `json:"passId"`
	TrialID  string `json:"trialId"`
	Image    struct {
		Version         int             `json:"version"`
		ModuleSHA256    string          `json:"module_sha256"`
		SHA256          string          `json:"sha256"`
		Architecture    string          `json:"architecture"`
		Backend         string          `json:"backend"`
		Format          string          `json:"format"`
		SectionKind     string          `json:"section_kind"`
		Event           string          `json:"event"`
		Attribution     string          `json:"function_attribution"`
		Materialization json.RawMessage `json:"materialization,omitempty"`
	} `json:"image"`
	Functions            []string              `json:"functions"`
	References           []string              `json:"references"`
	FunctionIndexVersion string                `json:"functionIndexVersion,omitempty"`
	FunctionShards       []NativeFunctionShard `json:"functionShards,omitempty"`
}
type NativeFunctionShard struct {
	SHA256 string `json:"sha256"`
	Count  int    `json:"count"`
}

func (m NativeMetadata) FunctionCounts() ([]int, error) {
	if m.FunctionIndexVersion == "" {
		if len(m.FunctionShards) > 0 {
			return nil, Invalid("function shards lack index version")
		}
		return nil, nil
	}
	if m.FunctionIndexVersion != "producer-order-v1" || len(m.FunctionShards) != len(m.Functions) || len(m.FunctionShards) > 4096 {
		return nil, Invalid("invalid native function index")
	}
	counts := []int{}
	total := 0
	for i, shard := range m.FunctionShards {
		if shard.SHA256 != m.Functions[i] || !IsHash(shard.SHA256) || shard.Count <= 0 || shard.Count > 1000000 {
			return nil, Invalid("invalid native function shard")
		}
		total += shard.Count
		if total > 1000000 {
			return nil, Invalid("native function count exceeds ceiling")
		}
		counts = append(counts, shard.Count)
	}
	return counts, nil
}

type NativeFunction struct {
	ModuleIndex uint32 `json:"module_index"`
	WasmIndex   uint32 `json:"wasm_index"`
	Name        string `json:"name,omitempty"`
	Offset      uint64 `json:"offset"`
	Length      uint64 `json:"length"`
	Tier        string `json:"tier"`
	Generation  uint32 `json:"generation"`
}
