package wire

import "time"

type SamplingGroup struct {
	Schema         int       `json:"schema"`
	ID             string    `json:"id"`
	PassID         string    `json:"passId"`
	CapturedAt     time.Time `json:"capturedAt"`
	Runtime        string    `json:"runtime"`
	Workload       string    `json:"workload"`
	Scenario       string    `json:"scenario"`
	Profile        string    `json:"profile"`
	ManifestSHA256 string    `json:"manifestSha256"`
	TrialsSHA256   string    `json:"trialsSha256"`
	TrialCount     int       `json:"trialCount"`
}

func (g SamplingGroup) Digest() string { g.ID = ""; b, _ := Encode(g); return Hash(b) }
func (g SamplingGroup) Validate(result Result) error {
	if g.Schema != 1 || !IsHash(g.ID) || g.ID != g.Digest() || !IsHash(g.ManifestSHA256) || !IsHash(g.TrialsSHA256) || g.PassID == "" || len(g.PassID) > 4096 || g.CapturedAt.IsZero() || g.TrialCount < 1 || g.TrialCount > 1000000 || g.Runtime != result.Runtime || g.Workload != result.Workload || g.Scenario != result.Scenario || g.Profile != result.Profile {
		return Invalid("invalid source sampling group")
	}
	return nil
}
