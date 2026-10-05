// Package wire owns the site-v2 transport. Scientific summaries remain producer JSON.
package wire

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"time"
)

const ChunkBytes = 256 * 1024
const ResponseBytes = 1024 * 1024
const MaxObjects = 512

var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func IsHash(s string) bool         { return hashPattern.MatchString(s) }
func Hash(b []byte) string         { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func Encode(v any) ([]byte, error) { return json.Marshal(v) }

type Object struct {
	SHA256 string `json:"sha256"`
	Bytes  int    `json:"bytes"`
	Kind   string `json:"kind"`
}
type Manifest struct {
	Schema             int      `json:"schema"`
	Format             string   `json:"format"`
	ReportID           string   `json:"reportId"`
	SourceReportSHA256 string   `json:"sourceReportSha256"`
	SourceSealSHA256   string   `json:"sourceSealSha256"`
	Exporter           string   `json:"exporter"`
	Verification       string   `json:"verification"`
	Objects            []Object `json:"objects"`
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
	if j.Schema != 2 || j.Status != "completed" || j.Session == "" || j.Machine == "" || j.Corpus == "" || j.Attempt == "" || !IsHash(j.Plan) || !IsHash(j.ParentBundleSHA256) || j.ConfiguredHarnessPin == "" || len(j.Exports) == 0 || len(j.Exports) > 8 {
		return fmt.Errorf("invalid completed job")
	}
	reports := map[string]bool{}
	for _, e := range j.Exports {
		m := e.Manifest
		b, err := Encode(m)
		if err != nil {
			return err
		}
		// The producer marshals the same field order. Export manifests use this
		// canonical encoding; object payloads retain their exact original bytes.
		if !IsHash(e.SHA256) || Hash(b) != e.SHA256 || m.Schema != 2 || m.Format != "site-v2" || !IsHash(m.ReportID) || !IsHash(m.SourceReportSHA256) || !IsHash(m.SourceSealSHA256) || m.Verification != "source-recomputed" || m.Exporter == "" || len(m.Objects) == 0 || len(m.Objects) > MaxObjects || reports[m.ReportID] {
			return fmt.Errorf("invalid export manifest")
		}
		reports[m.ReportID] = true
		seen := map[string]bool{}
		for _, o := range m.Objects {
			if !IsHash(o.SHA256) || o.Bytes <= 0 || o.Bytes > ChunkBytes || (o.Kind != "record" && o.Kind != "evidence") || seen[o.SHA256] {
				return fmt.Errorf("invalid object descriptor")
			}
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
