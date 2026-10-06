package testutil

import (
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"time"
)

// BinaryFixture is synthetic transport evidence, never a performance measurement.
func BinaryFixture(seed string, created time.Time, data []byte) (wire.Job, map[string][]byte, string, error) {
	job, objects, err := Fixture(seed, created)
	if err != nil {
		return job, nil, "", err
	}
	manifest := &job.Exports[0].Manifest
	digest := wire.Hash(data)
	objects[digest] = data
	manifest.Objects = append(manifest.Objects, wire.Object{SHA256: digest, Bytes: len(data), Kind: "binary"})
	metadata, _ := wire.Encode(map[string]any{"kind": "native-image-metadata", "references": []string{}, "image": map[string]string{"sha256": digest, "architecture": "amd64"}})
	metaID := wire.Hash(metadata)
	objects[metaID] = metadata
	manifest.Objects = append(manifest.Objects, wire.Object{SHA256: metaID, Bytes: len(metadata), Kind: "evidence"})
	oldArtifact, newArtifact := "", ""
	for i, object := range manifest.Objects {
		if object.Kind != "record" {
			continue
		}
		var record wire.Record
		_ = json.Unmarshal(objects[object.SHA256], &record)
		if record.Kind != "artifact" {
			continue
		}
		oldArtifact = record.ID
		var value map[string]json.RawMessage
		_ = json.Unmarshal(record.Data, &value)
		value["content"], _ = wire.Encode(map[string]any{"status": "available", "sha256": digest, "bytes": len(data), "mediaType": "application/octet-stream"})
		value["inspection"], _ = wire.Encode(map[string]string{"status": "available", "metadata": metaID})
		record.Data, _ = wire.Encode(value)
		record.ID = wire.Hash(record.Data)
		newArtifact = record.ID
		b, _ := wire.Encode(record)
		delete(objects, object.SHA256)
		object.SHA256, object.Bytes = wire.Hash(b), len(b)
		objects[object.SHA256] = b
		manifest.Objects[i] = object
	}
	for i, object := range manifest.Objects {
		if object.Kind != "record" {
			continue
		}
		var record wire.Record
		_ = json.Unmarshal(objects[object.SHA256], &record)
		if record.Kind != "result" {
			continue
		}
		var result wire.Result
		_ = json.Unmarshal(record.Data, &result)
		var summary map[string]json.RawMessage
		_ = json.Unmarshal(result.Summary, &summary)
		var artifact string
		_ = json.Unmarshal(summary["artifactId"], &artifact)
		if artifact != oldArtifact {
			continue
		}
		summary["artifactId"], _ = wire.Encode(newArtifact)
		var raw map[string]json.RawMessage
		_ = json.Unmarshal(record.Data, &raw)
		raw["summary"], _ = wire.Encode(summary)
		record.Data, _ = wire.Encode(raw)
		record.ID = wire.Hash(record.Data)
		b, _ := wire.Encode(record)
		delete(objects, object.SHA256)
		object.SHA256, object.Bytes = wire.Hash(b), len(b)
		objects[object.SHA256] = b
		manifest.Objects[i] = object
	}
	b, _ := wire.Encode(manifest)
	job.Exports[0].SHA256 = wire.Hash(b)
	return job, objects, newArtifact, nil
}
