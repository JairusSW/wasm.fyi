package store

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

const ScanLimit = 100000

type Query struct {
	Revision      string `json:"revision"`
	Selection     string `json:"selection"`
	Environment   string `json:"environment,omitempty"`
	Runtime       string `json:"runtime,omitempty"`
	Track         string `json:"track,omitempty"`
	Definition    string `json:"definition,omitempty"`
	Configuration string `json:"configuration,omitempty"`
	Contract      string `json:"contract,omitempty"`
	Workload      string `json:"workload,omitempty"`
	Metric        string `json:"metric,omitempty"`
	Scenario      string `json:"scenario,omitempty"`
	Profile       string `json:"profile,omitempty"`
	Statistic     string `json:"statistic,omitempty"`
	Sort          string `json:"sort"`
	Limit         int    `json:"limit"`
}

func (q Query) Matches(r wire.Result) bool {
	return (q.Environment == "" || q.Environment == r.EnvironmentID) && (q.Runtime == "" || q.Runtime == r.Runtime) && (q.Configuration == "" || q.Configuration == r.ConfigurationID) && (q.Contract == "" || q.Contract == r.ContractID) && (q.Workload == "" || q.Workload == r.Workload) && (q.Metric == "" || q.Metric == r.Metric) && (q.Scenario == "" || q.Scenario == r.Scenario) && (q.Profile == "" || q.Profile == r.Profile) && (q.Statistic == "" || q.Statistic == r.Statistic) && (q.Track == "" || q.Track == r.TrackID) && (q.Definition == "" || q.Definition == r.MetricDefinitionID)
}

var numericValue = regexp.MustCompile(`^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]{1,3})?$`)

func value(r wire.Record) (*big.Rat, bool) {
	var v wire.Result
	if json.Unmarshal(r.Data, &v) != nil {
		return nil, false
	}
	var summary map[string]json.RawMessage
	if json.Unmarshal(v.Summary, &summary) != nil {
		return nil, false
	}
	b := summary[v.Statistic]
	if len(b) == 0 || string(b) == "null" {
		return nil, false
	}
	text := string(b)
	if b[0] == '"' {
		if json.Unmarshal(b, &text) != nil {
			return nil, false
		}
	}
	if len(text) > 128 || !numericValue.MatchString(text) {
		return nil, false
	}
	if at := strings.IndexAny(text, "eE"); at >= 0 {
		exponent, e := strconv.Atoi(text[at+1:])
		if e != nil || exponent > 308 || exponent < -308 {
			return nil, false
		}
	}
	f, ok := new(big.Rat).SetString(text)
	return f, ok
}
func (s *Store) Results(q Query, historical bool) ([]wire.Record, error) {
	return s.ResultsContext(context.Background(), q, historical)
}
func (s *Store) ResultsContext(ctx context.Context, q Query, historical bool) ([]wire.Record, error) {
	if (q.Sort == "value" || q.Sort == "-value") && (q.Metric == "" || q.Statistic == "") {
		return nil, wire.Invalid("value sort requires metric and statistic")
	}
	rev, e := s.Revision(q.Revision)
	if e != nil {
		return nil, e
	}
	out := []wire.Record{}
	budget := ScanLimit
	decoded := 0
	seenObservations := map[string]bool{}
	add := func(id string) error {
		id, e = s.resolveObservation(rev, id)
		if e != nil {
			return e
		}
		if historical {
			if seenObservations[id] {
				return nil
			}
			seenObservations[id] = true
		}
		if e := ctx.Err(); e != nil {
			return e
		}
		budget--
		if budget < 0 {
			return ErrLimit
		}
		r, e := s.record(rev.Catalog, "result", id)
		if e != nil {
			return e
		}
		var v wire.Result
		if e = json.Unmarshal(r.Data, &v); e != nil {
			return e
		}
		if !q.Matches(v) {
			return nil
		}
		decoded += len(r.Data)
		if decoded > 32*1024*1024 {
			return ErrLimit
		}
		v.Evidence = nil
		b, e := wire.Encode(v)
		if e != nil {
			return e
		}
		r.Data = b
		out = append(out, r)
		return nil
	}
	e = s.candidates(ctx, rev, q, &budget, func(cellKey string) error {
		digest, e := s.mapGet(rev.Selection, cellKey)
		if e != nil {
			return e
		}
		if digest == "" {
			return fmt.Errorf("corrupt selection index")
		}
		var c cell
		if e := s.load(digest, &c); e != nil {
			return e
		}
		if historical {
			for h := c.History; h != ""; {
				budget--
				if budget < 0 {
					return ErrLimit
				}
				var p history
				if e := s.load(h, &p); e != nil {
					return e
				}
				if e := add(p.Result); e != nil {
					return e
				}
				h = p.Previous
			}
			return nil
		}
		id := c.Current
		if q.Selection == "previous" {
			id = c.Previous
		}
		if id == "" {
			return nil
		}
		return add(id)
	})
	if e != nil {
		return nil, e
	}
	if (q.Sort == "value" || q.Sort == "-value") && (q.Metric == "" || q.Statistic == "") {
		return nil, wire.Invalid("value sort requires metric and statistic")
	}
	sort.Slice(out, func(i, j int) bool {
		if q.Sort == "value" || q.Sort == "-value" {
			a, okA := value(out[i])
			b, okB := value(out[j])
			if okA != okB {
				return okA
			}
			if okA && a.Cmp(b) != 0 {
				if q.Sort == "-value" {
					return a.Cmp(b) > 0
				}
				return a.Cmp(b) < 0
			}
		}
		var a, b wire.Result
		_ = json.Unmarshal(out[i].Data, &a)
		_ = json.Unmarshal(out[j].Data, &b)
		if historical && !a.Created.Equal(b.Created) {
			return a.Created.Before(b.Created)
		}
		if a.Workload != b.Workload {
			return a.Workload < b.Workload
		}
		if a.Runtime != b.Runtime {
			return a.Runtime < b.Runtime
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}
func (s *Store) Catalog(revision, kind string) ([]wire.Record, error) {
	return s.CatalogContext(context.Background(), revision, kind)
}
func (s *Store) CatalogContext(ctx context.Context, revision, kind string) ([]wire.Record, error) {
	rev, e := s.Revision(revision)
	if e != nil {
		return nil, e
	}
	out := []wire.Record{}
	budget := ScanLimit
	e = s.indexedCatalog(ctx, rev, kind, &budget, func(r wire.Record) error {
		out = append(out, r)
		return nil
	})
	if e != nil {
		return nil, e
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
func (s *Store) Evidence(revision, result, digest string) ([]byte, error) {
	return s.EvidenceContext(context.Background(), revision, result, digest)
}
func (s *Store) EvidenceContext(ctx context.Context, revision, result, digest string) ([]byte, error) {
	r, e := s.Record(revision, "result", result)
	if e != nil {
		return nil, e
	}
	var v wire.Result
	if e = json.Unmarshal(r.Data, &v); e != nil {
		return nil, e
	}
	return s.evidenceContext(ctx, v.Evidence, digest)
}

func (s *Store) ReportEvidenceContext(ctx context.Context, revision, report, digest string) ([]byte, error) {
	record, err := s.Record(revision, "report", report)
	if err != nil {
		return nil, err
	}
	var descriptor struct {
		PassContexts []string `json:"passContexts"`
	}
	if err = json.Unmarshal(record.Data, &descriptor); err != nil {
		return nil, err
	}
	return s.evidenceContext(ctx, descriptor.PassContexts, digest)
}

func (s *Store) evidenceContext(ctx context.Context, roots []string, digest string) ([]byte, error) {
	if !wire.IsHash(digest) {
		return nil, wire.Invalid("invalid evidence digest")
	}
	// Traverse only this selected record's evidence graph, with explicit work
	// and decoded-byte limits. This permits nested pass/detail resources without
	// turning a digest lookup into global evidence discovery.
	pending := append([]string{}, roots...)
	seen := map[string]bool{}
	decoded, processed := 0, 0
	for len(pending) > 0 {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		processed++
		if processed > ScanLimit {
			return nil, ErrLimit
		}
		h := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if seen[h] {
			continue
		}
		if len(seen) >= ScanLimit {
			return nil, ErrLimit
		}
		seen[h] = true
		b, e := s.content(h)
		if e != nil {
			return nil, e
		}
		decoded += len(b)
		if decoded > 32*1024*1024 {
			return nil, ErrLimit
		}
		if h == digest {
			return b, nil
		}
		refs, e := wire.EvidenceReferences(b)
		if e != nil {
			return nil, e
		}
		// Authorize a directly named child from the verified envelope without
		// walking every sibling fragment of a large resource first.
		for _, ref := range refs {
			if ref == digest {
				child, err := s.content(ref)
				if err != nil {
					return nil, err
				}
				if decoded+len(child) > 32*1024*1024 {
					return nil, ErrLimit
				}
				return child, nil
			}
		}
		if len(pending)+len(refs)+processed > ScanLimit {
			return nil, ErrLimit
		}
		pending = append(pending, refs...)
	}
	return nil, ErrNotFound
}
