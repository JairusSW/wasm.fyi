package testutil

import (
	"encoding/json"
	"fmt"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"strings"
	"time"
)

func DisassemblyFixture(seed string, date time.Time, text string) (wire.Job, map[string][]byte, string, error) {
	function := wire.NativeFunction{WasmIndex: 7, Offset: 0, Length: 32, Tier: "cranelift"}
	job, objects, artifact, err := FunctionFixture(seed, date, []wire.NativeFunction{function}, 1, true)
	if err != nil {
		return job, nil, "", err
	}
	manifest := &job.Exports[0].Manifest
	add := func(v any) string {
		b, _ := wire.Encode(v)
		id := wire.Hash(b)
		objects[id] = b
		manifest.Objects = append(manifest.Objects, wire.Object{SHA256: id, Bytes: len(b), Kind: "evidence"})
		return id
	}
	var descriptor wire.Artifact
	var artifactData map[string]json.RawMessage
	for _, b := range objects {
		var r wire.Record
		if json.Unmarshal(b, &r) == nil && r.Kind == "artifact" && r.ID == artifact {
			descriptor, _ = wire.ArtifactData(r.Data)
			_ = json.Unmarshal(r.Data, &artifactData)
		}
	}
	var metadata wire.NativeMetadata
	if err = wire.Decode(objects[descriptor.Inspection.Metadata], &metadata); err != nil {
		return job, nil, "", err
	}
	lines := strings.SplitAfter(text, "\n")
	if lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	chunks := []wire.DisassemblyChunk{}
	refs := []string{}
	for start := 0; start < len(lines); start += 2 {
		end := min(start+2, len(lines))
		id := add(wire.DisassemblyLines{Kind: "native-disassembly-lines", Lines: lines[start:end]})
		chunks = append(chunks, wire.DisassemblyChunk{SHA256: id, Lines: end - start})
		refs = append(refs, id)
	}
	derivative := wire.NativeDisassembly{Kind: "native-function-disassembly", Version: wire.DisassemblyVersion, SourceVersion: "native-image-disassembly-v2", ImageSHA256: metadata.Image.SHA256, ModuleSHA256: metadata.Image.ModuleSHA256, Architecture: metadata.Image.Architecture, Function: function, Tools: []wire.DisassemblyTool{{SHA256: wire.Hash([]byte("objcopy")), Version: "synthetic fixture"}, {SHA256: wire.Hash([]byte("objdump")), Version: "synthetic fixture"}}, Arguments: []string{"--disassemble", "--disassemble-zeroes", "--section=.text", "--start-address=0", fmt.Sprintf("--stop-address=%d", function.Length), "synthetic-image.o"}, Interpretation: "Synthetic diagnostic fixture; no instruction-only sizes or execution inferred.", TextSHA256: wire.Hash([]byte(text)), Bytes: len(text), Lines: len(lines), Chunks: chunks, References: refs}
	function.Disassembly = add(derivative)
	shard := add(map[string]any{"kind": "native-functions-v2", "functions": []wire.NativeFunction{function}, "references": []string{function.Disassembly}})
	metadata.Functions = []string{shard}
	metadata.References = []string{shard}
	metadata.FunctionShards = []wire.NativeFunctionShard{{SHA256: shard, Count: 1}}
	metaID := add(metadata)
	artifactData["inspection"], _ = wire.Encode(map[string]any{"status": "available", "metadata": metaID, "disassembly": map[string]string{"status": "available", "version": wire.DisassemblyVersion, "selection": "producer-function-ordinal"}})
	data, _ := wire.Encode(artifactData)
	newArtifact := wire.Hash(data)
	for i, o := range manifest.Objects {
		if o.Kind != "record" {
			continue
		}
		var r wire.Record
		_ = json.Unmarshal(objects[o.SHA256], &r)
		if r.Kind == "artifact" && r.ID == artifact {
			r.ID = newArtifact
			r.Data = data
		} else if r.Kind == "result" {
			var result wire.Result
			_ = json.Unmarshal(r.Data, &result)
			var summary map[string]json.RawMessage
			_ = json.Unmarshal(result.Summary, &summary)
			var ref string
			_ = json.Unmarshal(summary["artifactId"], &ref)
			if ref != artifact {
				continue
			}
			summary["artifactId"], _ = wire.Encode(newArtifact)
			result.Summary, _ = wire.Encode(summary)
			r.Data, _ = wire.Encode(result)
			r.ID = wire.Hash(r.Data)
		} else {
			continue
		}
		b, _ := wire.Encode(r)
		id := wire.Hash(b)
		objects[id] = b
		delete(objects, o.SHA256)
		manifest.Objects[i] = wire.Object{SHA256: id, Bytes: len(b), Kind: "record"}
	}
	b, _ := wire.Encode(*manifest)
	job.Exports[0].SHA256 = wire.Hash(b)
	return job, objects, newArtifact, nil
}
