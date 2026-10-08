package benchdb

import (
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"math"
	"path/filepath"
	"strings"
	"time"
)

type Platform struct {
	OS          string `json:"os"`
	Arch        string `json:"arch"`
	CPU         string `json:"cpu"`
	Cores       int    `json:"cores"`
	Kernel      string `json:"kernel"`
	MemoryBytes int64  `json:"memoryBytes"`
}
type Source struct {
	Repository string `json:"repository"`
	Revision   string `json:"revision"`
	Ref        string `json:"ref"`
	AsOf       string `json:"asOf"`
	Kind       string `json:"kind"`
	DateBasis  string `json:"dateBasis,omitempty"`
}
type Display struct {
	Group   string   `json:"group"`
	Purpose string   `json:"purpose"`
	Tags    []string `json:"tags"`
	ABI     string   `json:"abi"`
	Bytes   int64    `json:"bytes"`
	Source  string   `json:"source"`
	Reset   string   `json:"reset"`
}
type Row struct {
	Source        *Source   `json:"source,omitempty"`
	Display       *Display  `json:"display,omitempty"`
	TimingSamples int       `json:"timingSamples,omitempty"`
	SamplesNs     []float64 `json:"samplesNs,omitempty"`
	Workload      string    `json:"workload"`
	Wasm          string    `json:"wasm"`
	Artifact      string    `json:"artifactSha256"`
	Contract      string    `json:"contractSha256"`
	Engine        string    `json:"engine"`
	Version       string    `json:"version"`
	Backend       string    `json:"backend"`
	Phase         string    `json:"phase"`
	Status        string    `json:"latencyStatus"`
	Value         *float64  `json:"latencyNs"`
	PeakRSS       *float64  `json:"peakRssBytes"`
	CodeBytes     *float64  `json:"codeBytes"`
	CodeKind      *string   `json:"codeKind"`
	MemoryStatus  string    `json:"memoryStatus"`
	CodeStatus    string    `json:"codeStatus"`
}
type Result struct {
	Row
	CapturedAt string `json:"capturedAt"`
}
type Capture struct {
	Source     *Source  `json:"source,omitempty"`
	CapturedAt string   `json:"capturedAt"`
	Platform   Platform `json:"platform"`
	Results    []Row    `json:"results"`
}

func Validate(c Capture) error {
	if len(c.Results) == 0 || len(c.Results) > 4096 {
		return wire.Invalid("invalid capture")
	}
	if _, err := time.Parse(time.RFC3339Nano, c.CapturedAt); err != nil {
		return wire.Invalid("invalid capture time")
	}
	if c.Platform.OS == "" || c.Platform.Arch == "" || c.Platform.CPU == "" || c.Platform.Cores < 1 || c.Platform.MemoryBytes < 0 || len(c.Platform.OS) > 64 || len(c.Platform.Arch) > 64 || len(c.Platform.CPU) > 256 || len(c.Platform.Kernel) > 512 {
		return wire.Invalid("invalid platform")
	}
	if c.Source != nil {
		if err := validateSource(c.Source); err != nil {
			return err
		}
	}
	seen := map[string]bool{}
	for _, r := range c.Results {
		if r.Source != nil {
			if err := validateSource(r.Source); err != nil {
				return err
			}
		}
		if len(r.SamplesNs) > 4096 || len(r.SamplesNs) > 0 && (r.Status != "ok" || len(r.SamplesNs) != r.TimingSamples) {
			return wire.Invalid("invalid timing samples")
		}
		for _, sample := range r.SamplesNs {
			if sample < 0 || math.IsNaN(sample) || math.IsInf(sample, 0) {
				return wire.Invalid("invalid timing sample")
			}
		}
		if r.TimingSamples < 0 || r.TimingSamples > 10000000 {
			return wire.Invalid("invalid sample count")
		}
		if r.Display != nil {
			d := r.Display
			if len(d.Group) > 256 || len(d.Purpose) > 2048 || len(d.Tags) > 64 || len(d.ABI) > 64 || d.Bytes < 0 || len(d.Source) > 2048 || len(d.Reset) > 128 {
				return wire.Invalid("invalid workload display metadata")
			}
			for _, tag := range d.Tags {
				if len(tag) > 128 {
					return wire.Invalid("invalid workload tag")
				}
			}
		}

		key := r.Workload + "|" + r.Engine + "|" + r.Phase
		if seen[key] || r.Workload == "" || strings.ContainsAny(r.Workload, "\x00|\n") || r.Version == "" || r.Backend == "" || len(r.Workload) > 256 || !wire.IsHash(r.Artifact) || !wire.IsHash(r.Contract) || !wire.IsIdentity(r.Engine) || len(r.Version) > 256 || len(r.Backend) > 128 || r.Wasm == "" || len(r.Wasm) > 256 || filepath.Base(r.Wasm) != r.Wasm || strings.Contains(r.Wasm, "\\") || !strings.HasSuffix(r.Wasm, ".wasm") {
			return wire.Invalid("invalid benchmark row")
		}
		for _, resource := range []struct {
			value  *float64
			status string
		}{{r.PeakRSS, r.MemoryStatus}, {r.CodeBytes, r.CodeStatus}} {
			switch resource.status {
			case "ok", "failed", "unsupported", "disabled", "not-measured":
			default:
				return wire.Invalid("invalid resource status")
			}
			if resource.status == "ok" && resource.value == nil || resource.status != "ok" && resource.value != nil {
				return wire.Invalid("invalid resource value")
			}
			if resource.value != nil && (*resource.value < 0 || math.IsNaN(*resource.value) || math.IsInf(*resource.value, 0)) {
				return wire.Invalid("invalid resource value")
			}
		}
		if r.CodeStatus == "ok" {
			if r.CodeKind == nil || (*r.CodeKind != "native-image" && *r.CodeKind != "engine-reported") {
				return wire.Invalid("successful code size requires its definition")
			}
		} else if r.CodeKind != nil {
			return wire.Invalid("unavailable code must not carry a definition")
		}
		seen[key] = true
		if !ValidPhase(r.Phase) {
			return wire.Invalid("invalid latency phase")
		}
		switch r.Status {
		case "ok", "failed", "unsupported", "disabled", "not-measured":
		default:
			return wire.Invalid("invalid latency status")
		}
		if r.Status == "ok" && (r.Value == nil || *r.Value < 0 || math.IsNaN(*r.Value) || math.IsInf(*r.Value, 0)) || r.Status != "ok" && r.Value != nil {
			return wire.Invalid("failed cells must not carry latency")
		}
	}
	return nil
}
func ValidPhase(p string) bool {
	return p == "compile" || p == "instantiate" || p == "first-call" || p == "steady"
}

func validateSource(s *Source) error {
	if s.DateBasis != "" && ((s.DateBasis != "go-module-commit" && s.DateBasis != "git-tag-commit") || s.Kind != "release") {
		return wire.Invalid("invalid source date basis")
	}
	if len(s.Repository) > 256 || s.Repository == "" || len(s.Revision) > 128 || s.Revision == "" || len(s.Ref) > 256 || (s.Kind != "current" && s.Kind != "main" && s.Kind != "release" && s.Kind != "snapshot") {
		return wire.Invalid("invalid source identity")
	}
	if _, err := time.Parse(time.RFC3339Nano, s.AsOf); err != nil {
		return wire.Invalid("invalid source date")
	}
	return nil
}
