package wire

import "time"

// Progress is a trusted coordinator's operational assertion, not measurement
// evidence or a claim that a completed attempt has been published.
type Progress struct {
	Schema     int       `json:"schema"`
	Session    string    `json:"session"`
	Plan       string    `json:"plan"`
	Machine    string    `json:"machine"`
	Corpus     string    `json:"corpus"`
	Attempt    string    `json:"attempt"`
	Sequence   int       `json:"sequence"`
	Status     string    `json:"status"`
	Phase      string    `json:"phase,omitempty"`
	ObservedAt time.Time `json:"observedAt"`
}

func (p Progress) Validate() error {
	if p.Schema != 1 || !IsIdentity(p.Session) || !IsHash(p.Plan) || !IsIdentity(p.Machine) || !IsIdentity(p.Corpus) || !IsIdentity(p.Attempt) || p.Sequence < 1 || p.Sequence > 10000 || (!IsIdentity(p.Phase) && p.Phase != "") || p.ObservedAt.IsZero() || p.ObservedAt.Year() < 2000 || p.ObservedAt.Year() > 9999 {
		return Invalid("invalid attempt progress")
	}
	switch p.Status {
	case "running", "completed", "interrupted", "failed":
		return nil
	}
	return Invalid("invalid attempt progress status")
}
