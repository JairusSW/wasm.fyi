package wire

import "encoding/json"

const SessionPlanBytes = 16 << 20

type SessionPlan struct {
	Schema int      `json:"schema"`
	Bytes  int      `json:"bytes"`
	Chunks []Object `json:"chunks"`
}

type PlanScope struct {
	members              map[string]bool
	corpora              map[string]bool
	Plan                 string
	ConfiguredHarnessPin string
	Members              []string
	Corpora              []string
}

func (p SessionPlan) Validate() error {
	if p.Schema != 1 || p.Bytes < 1 || p.Bytes > SessionPlanBytes || len(p.Chunks) < 1 || len(p.Chunks) > 16 {
		return Invalid("invalid session plan transport")
	}
	total := 0
	for i, o := range p.Chunks {
		if o.Kind != "binary" || !ValidPayload(o) || o.Bytes < 1 || o.Bytes > ReportFileChunkBytes || i < len(p.Chunks)-1 && o.Bytes != ReportFileChunkBytes {
			return Invalid("invalid session plan chunk")
		}
		total += o.Bytes
	}
	if total != p.Bytes {
		return Invalid("session plan size differs")
	}
	return nil
}

// Verify preserves the coordinator's JSON.stringify identity. It does not
// reconstruct the locked JSON with Go's different ordering or escaping rules.
func (p SessionPlan) Verify(job Job, fetch func(Object) ([]byte, error)) (PlanScope, error) {
	var out PlanScope
	if e := p.Validate(); e != nil {
		return out, e
	}
	raw := make([]byte, 0, p.Bytes)
	for _, o := range p.Chunks {
		b, e := fetch(o)
		if e != nil {
			return out, e
		}
		if len(b) != o.Bytes || Hash(b) != o.SHA256 {
			return out, Invalid("session plan chunk differs")
		}
		raw = append(raw, b...)
	}
	if Hash(raw) != job.Plan {
		return out, Invalid("session plan identity differs")
	}
	var fields map[string]json.RawMessage
	if e := Decode(raw, &fields); e != nil {
		return out, e
	}
	for _, key := range []string{"id", "created", "identity"} {
		if _, ok := fields[key]; ok {
			return out, Invalid("session plan includes unlocked fields")
		}
	}
	var source struct {
		Schema               int    `json:"schema"`
		ConfiguredHarnessPin string `json:"configuredHarnessPin"`
		Machines             []struct {
			Name string `json:"name"`
		} `json:"machines"`
		Jobs []struct {
			ID string `json:"id"`
		} `json:"jobs"`
	}
	if e := json.Unmarshal(raw, &source); e != nil {
		return out, e
	}
	if source.Schema != 1 || source.ConfiguredHarnessPin != job.ConfiguredHarnessPin || len(source.Machines) < 1 || len(source.Machines) > 128 || len(source.Jobs) < 1 || len(source.Jobs) > 10000 || len(source.Machines)*len(source.Jobs) > 100000 {
		return out, Invalid("invalid session plan scope")
	}
	members, corpora := map[string]bool{}, map[string]bool{}
	for _, m := range source.Machines {
		if !identityPattern.MatchString(m.Name) || members[m.Name] {
			return out, Invalid("invalid session plan member")
		}
		members[m.Name] = true
		out.Members = append(out.Members, m.Name)
	}
	for _, j := range source.Jobs {
		if !identityPattern.MatchString(j.ID) || corpora[j.ID] {
			return out, Invalid("invalid session plan corpus")
		}
		corpora[j.ID] = true
		out.Corpora = append(out.Corpora, j.ID)
	}
	if !members[job.Machine] || !corpora[job.Corpus] {
		return out, Invalid("job outside session plan")
	}
	out.members, out.corpora = members, corpora
	out.Plan, out.ConfiguredHarnessPin = job.Plan, job.ConfiguredHarnessPin
	return out, nil
}
func (p PlanScope) Contains(machine, corpus string) bool {
	return p.members[machine] && p.corpora[corpus]
}
