package testutil

import (
	"encoding/json"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

// FunctionFixture supplies attributed synthetic evidence in producer order.
func FunctionFixture(seed string, date time.Time, functions []wire.NativeFunction, pageSize int, indexed bool) (wire.Job, map[string][]byte, string, error) {
	if pageSize < 1 {
		return wire.Job{}, nil, "", wire.Invalid("invalid fixture page size")
	}
	job, objects, oldArtifact, err := BinaryFixture(seed, date, make([]byte, 64))
	if err != nil {
		return job, nil, "", err
	}
	manifest := &job.Exports[0].Manifest
	add := func(b []byte, kind string) string {
		id := wire.Hash(b)
		objects[id] = b
		manifest.Objects = append(manifest.Objects, wire.Object{SHA256: id, Bytes: len(b), Kind: kind})
		return id
	}
	var artifactData map[string]json.RawMessage
	var descriptor wire.Artifact
	for _, b := range objects {
		var r wire.Record
		if json.Unmarshal(b, &r) == nil && r.Kind == "artifact" {
			artifactData = map[string]json.RawMessage{}
			_ = json.Unmarshal(r.Data, &artifactData)
			descriptor, _ = wire.ArtifactData(r.Data)
		}
	}
	var metadata wire.NativeMetadata
	if err = wire.Decode(objects[descriptor.Inspection.Metadata], &metadata); err != nil {
		return job, nil, "", err
	}
	metadata.Image.Version = 2
	metadata.Image.Backend = "cranelift"
	metadata.Image.Attribution = "engine_reported"
	metadata.Functions = []string{}
	metadata.References = []string{}
	if indexed {
		metadata.FunctionIndexVersion = "producer-order-v1"
		metadata.FunctionShards = []wire.NativeFunctionShard{}
	}
	for start := 0; start < len(functions); start += pageSize {
		end := min(start+pageSize, len(functions))
		b, _ := wire.Encode(functions[start:end])
		id := add(b, "evidence")
		metadata.Functions = append(metadata.Functions, id)
		metadata.References = append(metadata.References, id)
		if indexed {
			metadata.FunctionShards = append(metadata.FunctionShards, wire.NativeFunctionShard{SHA256: id, Count: end - start})
		}
	}
	b, _ := wire.Encode(metadata)
	metaID := add(b, "evidence")
	artifactData["inspection"], _ = wire.Encode(map[string]string{"status": "available", "metadata": metaID})
	data, _ := wire.Encode(artifactData)
	newArtifact := wire.Hash(data)
	for i, o := range manifest.Objects {
		if o.Kind != "record" {
			continue
		}
		var record wire.Record
		_ = json.Unmarshal(objects[o.SHA256], &record)
		if record.Kind == "artifact" {
			record.ID = newArtifact
			record.Data = data
		} else if record.Kind == "result" {
			var result wire.Result
			_ = json.Unmarshal(record.Data, &result)
			var summary map[string]json.RawMessage
			_ = json.Unmarshal(result.Summary, &summary)
			var artifactID string
			_ = json.Unmarshal(summary["artifactId"], &artifactID)
			if artifactID != oldArtifact {
				continue
			}
			summary["artifactId"], _ = wire.Encode(newArtifact)
			result.Summary, _ = wire.Encode(summary)
			record.Data, _ = wire.Encode(result)
			record.ID = wire.Hash(record.Data)
		} else {
			continue
		}
		b, _ := wire.Encode(record)
		id := wire.Hash(b)
		objects[id] = b
		delete(objects, o.SHA256)
		manifest.Objects[i] = wire.Object{SHA256: id, Bytes: len(b), Kind: "record"}
	}
	b, _ = wire.Encode(*manifest)
	job.Exports[0].SHA256 = wire.Hash(b)
	return job, objects, newArtifact, nil
}
