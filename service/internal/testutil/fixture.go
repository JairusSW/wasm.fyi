// Package testutil loads synthetic producer fixtures, never qualified evidence.
package testutil

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func Fixture(seed string, created time.Time) (wire.Job, map[string][]byte, error) {
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(file), "../../testdata/site-v2")
	b, e := os.ReadFile(filepath.Join(root, "manifest.json"))
	if e != nil {
		return wire.Job{}, nil, e
	}
	var m wire.Manifest
	if e = json.Unmarshal(b, &m); e != nil {
		return wire.Job{}, nil, e
	}
	objects := map[string][]byte{}
	original := m.Objects
	m.Objects = nil
	for _, o := range original {
		b, e := os.ReadFile(filepath.Join(root, "objects", o.SHA256))
		if e != nil {
			return wire.Job{}, nil, e
		}
		objects[o.SHA256] = b
	}
	m.SourceReportSHA256 = wire.Hash([]byte(seed))
	m.SourceSealSHA256 = wire.Hash([]byte("seal:" + seed))
	identity, _ := wire.Encode([]string{"synthetic-single-launch:" + seed, m.SourceReportSHA256, m.SourceSealSHA256})
	m.ReportID = wire.Hash(identity)
	changed := map[string][]byte{}
	remap := map[string]string{}
	artifactIDs := map[string]string{}
	contracts := map[string]string{}
	for _, o := range original {
		b := objects[o.SHA256]
		if o.Kind == "evidence" {
			var d map[string]json.RawMessage
			if json.Unmarshal(b, &d) == nil && d != nil {
				d["reportId"], _ = wire.Encode(m.ReportID)
				b, _ = wire.Encode(d)
			}
			changed[o.SHA256] = b
			remap[o.SHA256] = wire.Hash(b)
		}
	}
	for _, o := range original {
		if o.Kind != "record" {
			continue
		}
		var record wire.Record
		_ = json.Unmarshal(objects[o.SHA256], &record)
		if record.Kind != "workload" {
			continue
		}
		var data map[string]json.RawMessage
		_ = json.Unmarshal(record.Data, &data)
		data["sha256"], _ = wire.Encode(wire.Hash([]byte("synthetic-module")))
		record.Data, _ = wire.Encode(data)
		old := record.ID
		record.ID = wire.Hash(record.Data)
		contracts[old] = record.ID
		b, _ := wire.Encode(record)
		changed[o.SHA256] = b
	}
	for _, o := range original {
		if o.Kind != "record" {
			continue
		}
		var r wire.Record
		_ = json.Unmarshal(objects[o.SHA256], &r)
		if r.Kind != "artifact" {
			continue
		}
		var d map[string]json.RawMessage
		_ = json.Unmarshal(r.Data, &d)
		d["reportId"], _ = wire.Encode(m.ReportID)
		old := r.ID
		r.Data, _ = wire.Encode(d)
		r.ID = wire.Hash(r.Data)
		artifactIDs[old] = r.ID
		b, _ := wire.Encode(r)
		changed[o.SHA256] = b
	}
	out := map[string][]byte{}
	for _, o := range original {
		b := objects[o.SHA256]
		if rewritten, ok := changed[o.SHA256]; ok {
			b = rewritten
		} else if o.Kind == "record" {
			var r wire.Record
			_ = json.Unmarshal(b, &r)
			if r.Kind == "report" {
				var d map[string]any
				_ = json.Unmarshal(r.Data, &d)
				d["runId"] = "synthetic-single-launch:" + seed
				d["sourceReportSha256"] = m.SourceReportSHA256
				d["sourceSealSha256"] = m.SourceSealSHA256
				r.ID = m.ReportID
				r.Data, _ = wire.Encode(d)
			}
			if r.Kind == "result" {
				var d map[string]json.RawMessage
				_ = json.Unmarshal(r.Data, &d)
				d["reportId"], _ = wire.Encode(m.ReportID)
				d["created"], _ = wire.Encode(created)
				var contract string
				_ = json.Unmarshal(d["contractId"], &contract)
				if mapped := contracts[contract]; mapped != "" {
					d["contractId"], _ = wire.Encode(mapped)
				}

				var refs []string
				_ = json.Unmarshal(d["evidence"], &refs)
				for i, ref := range refs {
					if n := remap[ref]; n != "" {
						refs[i] = n
					}
				}
				d["evidence"], _ = wire.Encode(refs)
				var summary map[string]json.RawMessage
				_ = json.Unmarshal(d["summary"], &summary)
				var artifact string
				_ = json.Unmarshal(summary["artifactId"], &artifact)
				if mapped := artifactIDs[artifact]; mapped != "" {
					summary["artifactId"], _ = wire.Encode(mapped)
					d["summary"], _ = wire.Encode(summary)
				}
				r.Data, _ = wire.Encode(d)
				r.ID = wire.Hash(r.Data)
			}
			b, _ = wire.Encode(r)
		}
		o.SHA256 = wire.Hash(b)
		o.Bytes = len(b)
		out[o.SHA256] = b
		m.Objects = append(m.Objects, o)
	}
	mb, _ := wire.Encode(m)
	j := wire.Job{Schema: 2, Session: "synthetic-session", Machine: "test", Corpus: "corpus-0001", Attempt: seed, Plan: wire.Hash([]byte("plan")), ConfiguredHarnessPin: "0509a0a323f41c58a2f2db15a372fb2e63c692bf", ParentBundleSHA256: wire.Hash([]byte("parent")), Status: "completed", Exports: []wire.Export{{SHA256: wire.Hash(mb), Manifest: m}}}
	return j, out, nil
}
