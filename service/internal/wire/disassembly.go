package wire

import (
	"bytes"
	"encoding/json"
)

const DisassemblyVersion = "llvm-function-listing-v1"

type DisassemblyTool struct {
	SHA256  string `json:"sha256"`
	Version string `json:"version"`
}
type DisassemblyChunk struct {
	SHA256 string `json:"sha256"`
	Lines  int    `json:"lines"`
}

// Archive identities are producer attestations, not downloadable blob
// descriptors or independent verification of absent original evidence.
type DisassemblySource struct {
	Location         string `json:"location"`
	CodePassID       string `json:"codePassId"`
	CodeSealSHA256   string `json:"codeSealSha256"`
	NativeSealSHA256 string `json:"nativeSealSha256"`
	Verification     string `json:"verification"`
}

func (s DisassemblySource) Validate() error {
	if (s.Location != "embedded-report" && s.Location != "external-archive") || s.CodePassID == "" || len(s.CodePassID) > 1024 || !IsHash(s.CodeSealSHA256) || !IsHash(s.NativeSealSHA256) || s.Verification != "producer-asserted" {
		return Invalid("invalid disassembly source attestation")
	}
	return nil
}

type NativeDisassembly struct {
	Source         *DisassemblySource `json:"source,omitempty"`
	Kind           string             `json:"kind"`
	Version        string             `json:"version"`
	SourceVersion  string             `json:"sourceVersion"`
	ImageSHA256    string             `json:"imageSha256"`
	ModuleSHA256   string             `json:"moduleSha256"`
	Architecture   string             `json:"architecture"`
	Function       NativeFunction     `json:"function"`
	Tools          []DisassemblyTool  `json:"tools"`
	Arguments      []string           `json:"arguments"`
	Interpretation string             `json:"interpretation"`
	TextSHA256     string             `json:"textSha256"`
	Bytes          int                `json:"bytes"`
	Lines          int                `json:"lines"`
	Chunks         []DisassemblyChunk `json:"chunks"`
	References     []string           `json:"references"`
}
type DisassemblyLines struct {
	Kind  string   `json:"kind"`
	Lines []string `json:"lines"`
}

// Legacy arrays remain readable. New shards explicitly authorize their
// derivatives; hashes inside scientific arrays are never inferred as references.
func NativeFunctions(b []byte) ([]NativeFunction, error) {
	if bytes.HasPrefix(bytes.TrimSpace(b), []byte("[")) {
		var rows []NativeFunction
		err := Decode(b, &rows)
		for _, row := range rows {
			if row.Disassembly != "" {
				return nil, Invalid("derivative lacks explicit shard references")
			}
		}
		return rows, err
	}
	var shard struct {
		Kind       string           `json:"kind"`
		Functions  []NativeFunction `json:"functions"`
		References []string         `json:"references"`
	}
	if err := Decode(b, &shard); err != nil {
		return nil, err
	}
	if shard.Kind != "native-functions-v2" || len(shard.Functions) == 0 || len(shard.Functions) > 128 {
		return nil, Invalid("invalid native function shard")
	}
	refs := []string{}
	for _, row := range shard.Functions {
		if row.Disassembly != "" {
			if !IsHash(row.Disassembly) {
				return nil, Invalid("invalid derivative identity")
			}
			refs = append(refs, row.Disassembly)
		}
	}
	a, _ := json.Marshal(refs)
	c, _ := json.Marshal(shard.References)
	if !bytes.Equal(a, c) {
		return nil, Invalid("derivative references differ")
	}
	return shard.Functions, nil
}

func (d NativeDisassembly) Validate() error {
	if d.Source != nil {
		if err := d.Source.Validate(); err != nil {
			return err
		}
	}
	if d.Kind != "native-function-disassembly" || d.Version != DisassemblyVersion || (d.SourceVersion != "native-image-disassembly-v2" && d.SourceVersion != "native-image-disassembly-v3") || !IsHash(d.ImageSHA256) || !IsHash(d.ModuleSHA256) || !IsHash(d.TextSHA256) || (d.Architecture != "amd64" && d.Architecture != "arm64") || d.Function.Disassembly != "" || d.Function.Length == 0 || len(d.Tools) != 2 || len(d.Arguments) != 6 || d.Interpretation == "" || len(d.Interpretation) > 8192 || d.Bytes <= 0 || d.Bytes > 64<<20 || d.Lines <= 0 || len(d.Chunks) == 0 || len(d.Chunks) > 4096 || len(d.Chunks) != len(d.References) {
		return Invalid("invalid disassembly descriptor")
	}
	for _, t := range d.Tools {
		if !IsHash(t.SHA256) || t.Version == "" || len(t.Version) > 4096 {
			return Invalid("invalid disassembly tool identity")
		}
	}
	lines := 0
	for i, c := range d.Chunks {
		if !IsHash(c.SHA256) || c.SHA256 != d.References[i] || c.Lines <= 0 || c.Lines > 256 {
			return Invalid("invalid disassembly chunk index")
		}
		lines += c.Lines
	}
	if lines != d.Lines {
		return Invalid("disassembly line count differs")
	}
	for _, arg := range d.Arguments {
		if arg == "" || len(arg) > 4096 {
			return Invalid("invalid disassembly arguments")
		}
	}
	return nil
}
