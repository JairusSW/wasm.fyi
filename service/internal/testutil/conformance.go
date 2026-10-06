package testutil

import (
	"fmt"
	"strings"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func ConformanceFixture(seed string) (wire.Job, map[string][]byte, error) {
	objects := map[string][]byte{}
	manifest := wire.Manifest{Schema: 2, Format: "conformance-v1", Exporter: "synthetic-conformance-fixture", Verification: "source-integrity-checked", Objects: []wire.Object{}}
	add := func(kind string, bytes []byte) wire.Object {
		hash := wire.Hash(bytes)
		objects[hash] = bytes
		object := wire.Object{SHA256: hash, Bytes: len(bytes), Kind: kind}
		for _, old := range manifest.Objects {
			if old.SHA256 == hash {
				return old
			}
		}
		manifest.Objects = append(manifest.Objects, object)
		return object
	}
	rows := []map[string]any{}
	inventory := []map[string]any{}
	for i, status := range []string{"passed", "passed", "failed", "skipped", "skipped", "skipped"} {
		path := fmt.Sprintf("synthetic-%d.wast", i)
		hash := wire.Hash([]byte(path))
		rows = append(rows, map[string]any{"path": path, "sha256": hash, "status": status})
		inventory = append(inventory, map[string]any{"path": path, "sha256": hash})
	}
	bytes, _ := wire.Encode(map[string]any{"schema": 1, "created": "2026-10-06T00:00:00Z", "host": wire.ConformanceHost{Hostname: "synthetic", OS: "darwin", Arch: "arm64"}, "coverage": []map[string]any{{"engine": "wago", "status": "uncollected", "reason": "No archived capture"}}, "lanes": []any{map[string]any{"id": "synthetic-wast", "kind": "wast", "unit": "files", "status": "failed", "totals": map[string]int{"passed": 2, "failed": 1, "skipped": 3}, "engine": map[string]any{"tag": "v1.0.0", "sha256": wire.Hash([]byte("synthetic engine"))}, "suite": map[string]any{"repository": "fixture/suite", "revision": strings.Repeat("a", 40), "inventory": inventory}, "results": rows}}, "padding": strings.Repeat("synthetic ", 160000), "seed": seed})
	manifest.SourceReportSHA256 = wire.Hash(bytes)
	receipt := add("binary", []byte(manifest.SourceReportSHA256+"\n"))
	manifest.SourceSealSHA256 = receipt.SHA256
	identity, _ := wire.Encode([]string{"conformance-v1", manifest.SourceReportSHA256, receipt.SHA256})
	manifest.ReportID = wire.Hash(identity)
	source := wire.ConformanceSource{Schema: 1, ReportID: manifest.ReportID, SHA256: manifest.SourceReportSHA256, Bytes: int64(len(bytes)), Chunks: []wire.FileChunk{}, Receipt: wire.FileChunk{SHA256: receipt.SHA256, Bytes: receipt.Bytes}, Integrity: "content-hash-verified", CollectionVerification: "publisher-asserted"}
	for start := 0; start < len(bytes); start += wire.ReportFileChunkBytes {
		chunk := add("binary", bytes[start:min(start+wire.ReportFileChunkBytes, len(bytes))])
		source.Chunks = append(source.Chunks, wire.FileChunk{SHA256: chunk.SHA256, Bytes: chunk.Bytes})
	}
	data, _ := wire.Encode(source)
	sourceID := wire.Hash(data)
	record, _ := wire.Encode(wire.Record{Kind: "conformance-source", ID: sourceID, Data: data})
	add("record", record)
	created := time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC)
	host := wire.ConformanceHost{Hostname: "synthetic", OS: "darwin", Arch: "arm64"}
	hostBytes, _ := wire.Encode(host)
	coverageCount := 1
	context := wire.ConformanceContext{Schema: 1, SourceID: sourceID, Created: created, Host: host, HostIdentity: wire.Hash(hostBytes), CoverageCount: &coverageCount, InterpretationSource: "publisher-asserted"}
	data, _ = wire.Encode(context)
	record, _ = wire.Encode(wire.Record{Kind: "conformance-context", ID: wire.Hash(data), Data: data})
	add("record", record)
	reason := "No archived capture"
	coverage := wire.ConformanceCoverage{Schema: 1, SourceID: sourceID, Created: created, Engine: "wago", Status: "uncollected", Reason: &reason, InterpretationSource: "publisher-asserted"}
	data, _ = wire.Encode(coverage)
	record, _ = wire.Encode(wire.Record{Kind: "conformance-coverage", ID: wire.Hash(data), Data: data})
	add("record", record)
	status, unit := "failed", "files"
	lane := wire.ConformanceLane{Schema: 1, Policy: wire.ConformancePolicy, SourceID: sourceID, Lane: "synthetic-wast", Created: time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC), Unit: &unit, Status: &status, Totals: map[string]int64{"passed": 2, "failed": 1, "skipped": 3}, Engine: []byte(`{"tag":"v1.0.0"}`), Suite: []byte(`{"repository":"fixture/suite","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`), InterpretationSource: "publisher-asserted"}
	data, _ = wire.Encode(lane)
	record, _ = wire.Encode(wire.Record{Kind: "conformance", ID: wire.Hash(data), Data: data})
	add("record", record)
	manifestBytes, _ := wire.Encode(manifest)
	job := wire.Job{Schema: 3, Kind: "conformance", Session: "conformance-" + seed, Machine: "fixture", Corpus: "suite-capture", Attempt: seed, Plan: wire.Hash([]byte("conformance plan:" + seed)), Status: "completed", Exports: []wire.Export{{SHA256: wire.Hash(manifestBytes), Manifest: manifest}}}
	return job, objects, nil
}
