// Package wire owns the site-v2 transport. Scientific summaries remain producer JSON.
package wire

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"time"
)

const ChunkBytes = 256 * 1024
const ResponseBytes = 1024 * 1024
const MaxObjects = 512
const MaxInventoryPages = 512

var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var identityPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`)
var revisionPattern = regexp.MustCompile(`^[a-f0-9]{40}$`)
var ErrInvalid = errors.New("invalid wire data")

func Invalid(message string) error { return fmt.Errorf("%w: %s", ErrInvalid, message) }

// Decode rejects unknown fields, duplicate object keys and trailing documents.
// json.Unmarshal alone accepts ambiguous packages with duplicate identities.
func Decode(b []byte, v any) error {
	if !json.Valid(b) {
		return Invalid("malformed JSON")
	}
	if err := uniqueKeys(json.NewDecoder(bytes.NewReader(b))); err != nil {
		return err
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return Invalid("trailing input")
	}
	return nil
}
func uniqueKeys(d *json.Decoder) error {
	token, err := d.Token()
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if delim, ok := token.(json.Delim); ok {
		switch delim {
		case '{':
			keys := map[string]bool{}
			for d.More() {
				key, err := d.Token()
				if err != nil {
					return Invalid("invalid key")
				}
				name, ok := key.(string)
				if !ok || keys[name] {
					return Invalid("duplicate JSON key")
				}
				keys[name] = true
				if err = uniqueKeys(d); err != nil {
					return err
				}
			}
		case '[':
			for d.More() {
				if err = uniqueKeys(d); err != nil {
					return err
				}
			}
		default:
			return Invalid("unexpected delimiter")
		}
		_, err = d.Token()
		if err != nil {
			return Invalid("unclosed JSON object")
		}
	}
	return nil
}

func IsHash(s string) bool         { return hashPattern.MatchString(s) }
func Hash(b []byte) string         { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func Encode(v any) ([]byte, error) { return json.Marshal(v) }

type ExporterIdentity struct {
	Format        string            `json:"format"`
	BinarySHA256  string            `json:"binarySha256"`
	GoVersion     string            `json:"goVersion,omitempty"`
	Module        string            `json:"module,omitempty"`
	ModuleVersion string            `json:"moduleVersion,omitempty"`
	Build         map[string]string `json:"build,omitempty"`
}

type Object struct {
	SHA256 string `json:"sha256"`
	Bytes  int    `json:"bytes"`
	Kind   string `json:"kind"`
}
type Manifest struct {
	Schema             int               `json:"schema"`
	Format             string            `json:"format"`
	ReportID           string            `json:"reportId"`
	SourceReportSHA256 string            `json:"sourceReportSha256"`
	SourceSealSHA256   string            `json:"sourceSealSha256"`
	Exporter           string            `json:"exporter"`
	Verification       string            `json:"verification"`
	Objects            []Object          `json:"objects"`
	InventoryPages     []Inventory       `json:"inventoryPages,omitempty"`
	ExporterIdentity   *ExporterIdentity `json:"exporterIdentity,omitempty"`
}
type Inventory struct {
	SHA256       string `json:"sha256"`
	Bytes        int    `json:"bytes"`
	Objects      int    `json:"objects"`
	ContentBytes int64  `json:"contentBytes"`
}
type InventoryPage struct {
	Schema  int      `json:"schema"`
	Objects []Object `json:"objects"`
}

func (p Inventory) Object() Object {
	return Object{SHA256: p.SHA256, Bytes: p.Bytes, Kind: "inventory"}
}
func (p Inventory) Validate() error {
	if !IsHash(p.SHA256) || p.Bytes < 1 || p.Bytes > ChunkBytes || p.Objects < 1 || p.Objects > MaxObjects || p.ContentBytes < int64(p.Objects) || p.ContentBytes > int64(p.Objects)*ChunkBytes {
		return Invalid("invalid inventory descriptor")
	}
	return nil
}
func (p Inventory) Decode(b []byte) ([]Object, error) {
	if err := p.Validate(); err != nil {
		return nil, err
	}
	if len(b) != p.Bytes || Hash(b) != p.SHA256 {
		return nil, Invalid("inventory bytes differ")
	}
	var page InventoryPage
	if err := Decode(b, &page); err != nil {
		return nil, err
	}
	if page.Schema != 1 || len(page.Objects) != p.Objects {
		return nil, Invalid("inventory count differs")
	}
	var size int64
	seen := map[string]bool{}
	for _, o := range page.Objects {
		if !IsHash(o.SHA256) || o.Bytes < 1 || o.Bytes > ChunkBytes || (o.Kind != "record" && o.Kind != "evidence") || seen[o.SHA256] {
			return nil, Invalid("invalid inventory payload")
		}
		seen[o.SHA256] = true
		size += int64(o.Bytes)
	}
	if size != p.ContentBytes {
		return nil, Invalid("inventory payload bytes differ")
	}
	return page.Objects, nil
}

type Export struct {
	SHA256   string   `json:"sha256"`
	Manifest Manifest `json:"manifest"`
}

// Job is submitted only after the coordinator verifies every completed pass and
// parent bundle. Producer assertions and authenticated delivery are separate.
type Job struct {
	Schema               int      `json:"schema"`
	Session              string   `json:"session"`
	Machine              string   `json:"machine"`
	Corpus               string   `json:"corpus"`
	Attempt              string   `json:"attempt"`
	Plan                 string   `json:"plan"`
	ConfiguredHarnessPin string   `json:"configuredHarnessPin"`
	ParentBundleSHA256   string   `json:"parentBundleSha256"`
	Status               string   `json:"status"`
	Exports              []Export `json:"exports"`
}

func (j Job) Validate() error {
	if j.Schema != 2 || j.Status != "completed" || !identityPattern.MatchString(j.Session) || !identityPattern.MatchString(j.Machine) || !identityPattern.MatchString(j.Corpus) || !identityPattern.MatchString(j.Attempt) || !IsHash(j.Plan) || !IsHash(j.ParentBundleSHA256) || !revisionPattern.MatchString(j.ConfiguredHarnessPin) || len(j.Exports) == 0 || len(j.Exports) > 8 {
		return Invalid("invalid completed job")
	}
	reports := map[string]bool{}
	objects := map[string]Object{}
	inventories := map[string]Inventory{}
	for _, e := range j.Exports {
		m := e.Manifest
		b, err := Encode(m)
		if err != nil {
			return err
		}
		// The producer marshals the same field order. Export manifests use this
		// canonical encoding; object payloads retain their exact original bytes.
		if !IsHash(e.SHA256) || Hash(b) != e.SHA256 || m.Schema != 2 || m.Format != "site-v2" || !IsHash(m.ReportID) || !IsHash(m.SourceReportSHA256) || !IsHash(m.SourceSealSHA256) || m.Verification != "source-recomputed" || m.Exporter == "" || m.Objects == nil || (len(m.Objects) == 0 && len(m.InventoryPages) == 0) || (len(m.Objects) > 0 && len(m.InventoryPages) > 0) || len(m.Objects) > MaxObjects || len(m.InventoryPages) > MaxInventoryPages || reports[m.ReportID] {
			return Invalid("invalid export manifest")
		}
		if identity := m.ExporterIdentity; identity != nil {
			if identity.Format != m.Format || !IsHash(identity.BinarySHA256) {
				return Invalid("invalid exporter identity")
			}
		}
		reports[m.ReportID] = true
		seen := map[string]bool{}
		for _, page := range m.InventoryPages {
			if err := page.Validate(); err != nil {
				return err
			}
			if seen[page.SHA256] {
				return Invalid("duplicate inventory page")
			}
			if old, ok := inventories[page.SHA256]; ok && old != page {
				return Invalid("conflicting inventory commitments")
			}
			inventories[page.SHA256] = page
			seen[page.SHA256] = true
			o := page.Object()
			if old, ok := objects[o.SHA256]; ok && old != o {
				return Invalid("conflicting inventory descriptor")
			}
			objects[o.SHA256] = o
		}
		for _, o := range m.Objects {
			if !IsHash(o.SHA256) || o.Bytes <= 0 || o.Bytes > ChunkBytes || (o.Kind != "record" && o.Kind != "evidence") || seen[o.SHA256] {
				return Invalid("invalid object descriptor")
			}
			if old, ok := objects[o.SHA256]; ok && old != o {
				return Invalid("conflicting object descriptors")
			}
			objects[o.SHA256] = o
			seen[o.SHA256] = true
		}
	}
	return nil
}

type Record struct {
	Kind string          `json:"kind"`
	ID   string          `json:"id"`
	Data json.RawMessage `json:"data"`
}
type Result struct {
	ReportID               string          `json:"reportId"`
	EnvironmentID          string          `json:"environmentId"`
	ConfigurationID        string          `json:"configurationId"`
	TrackID                string          `json:"trackId"`
	MetricDefinitionID     string          `json:"metricDefinitionId"`
	MetricDefinitionStatus string          `json:"metricDefinitionStatus"`
	Runtime                string          `json:"runtime"`
	ContractID             string          `json:"contractId"`
	Workload               string          `json:"workload"`
	Scenario               string          `json:"scenario"`
	Profile                string          `json:"profile"`
	Metric                 string          `json:"metric"`
	Statistic              string          `json:"statistic"`
	Created                time.Time       `json:"created"`
	AnalysisVersion        string          `json:"analysisVersion"`
	Summary                json.RawMessage `json:"summary"`
	Evidence               []string        `json:"evidence"`
}

func (r Result) Cell() string {
	b, _ := Encode([]string{r.EnvironmentID, r.TrackID, r.ContractID, r.Scenario, r.Profile, r.MetricDefinitionID, r.Statistic})
	return Hash(b)
}

// EvidenceReferences recognizes transport links only at the object envelope.
// Scientific payloads in data and array rows are never interpreted as links.
func EvidenceReferences(b []byte) ([]string, error) {
	var raw json.RawMessage
	if err := Decode(b, &raw); err != nil {
		return nil, err
	}
	if len(raw) == 0 || raw[0] != '{' {
		return nil, nil
	}
	if _, err := Resource(raw); err != nil {
		return nil, err
	}
	var envelope struct {
		Samples      []string `json:"samples"`
		Observations []string `json:"observations"`
		References   []string `json:"references"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, Invalid("invalid evidence references")
	}
	refs := append(append(envelope.Samples, envelope.Observations...), envelope.References...)
	for _, ref := range refs {
		if !IsHash(ref) {
			return nil, Invalid("invalid evidence reference hash")
		}
	}
	return refs, nil
}
