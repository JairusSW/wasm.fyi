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
	Functions  []string `json:"functions"`
	References []string `json:"references"`
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
