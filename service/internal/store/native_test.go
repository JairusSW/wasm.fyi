package store

import (
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"testing"
)

func TestNativeInspectionAdmission(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	module := wire.Hash([]byte("module"))
	image := wire.Hash([]byte("image"))
	report := wire.Hash([]byte("report"))
	descriptor, _ := wire.ArtifactData([]byte(`{"reportId":"` + report + `","record":{"trial":"trial"},"content":{"status":"available","sha256":"` + image + `","bytes":64,"mediaType":"application/octet-stream"},"inspection":{"status":"available","metadata":"` + wire.Hash([]byte("metadata")) + `"}}`))
	functions := []wire.NativeFunction{{ModuleIndex: 0, WasmIndex: 1, Offset: 0, Length: 16, Tier: "cranelift"}, {ModuleIndex: 0, WasmIndex: 2, Offset: 32, Length: 16, Tier: "cranelift"}}
	verify := func(mutate func(*wire.NativeMetadata, *[]wire.NativeFunction)) error {
		metadata := wire.NativeMetadata{Kind: "native-image-metadata", ReportID: report, PassID: "code", TrialID: "trial"}
		metadata.Image.Version = 2
		metadata.Image.ModuleSHA256 = module
		metadata.Image.SHA256 = image
		metadata.Image.Architecture = "amd64"
		metadata.Image.Backend = "cranelift"
		metadata.Image.Format = "raw-native-image"
		metadata.Image.SectionKind = "mixed_code_and_embedded_data"
		metadata.Image.Event = "compiled_snapshot"
		metadata.Image.Attribution = "engine_reported"
		rows := append([]wire.NativeFunction{}, functions...)
		if mutate != nil {
			mutate(&metadata, &rows)
		}
		b, _ := wire.Encode(rows)
		hash := wire.Hash(b)
		metadata.Functions = []string{hash}
		metadata.References = []string{hash}
		raw, _ := wire.Encode(metadata)
		return s.validateNativeInspection(descriptor, module, func(id string) ([]byte, error) {
			if id == descriptor.Inspection.Metadata {
				return raw, nil
			}
			return b, nil
		})
	}
	if err := verify(nil); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*wire.NativeMetadata, *[]wire.NativeFunction){
		func(m *wire.NativeMetadata, r *[]wire.NativeFunction) { m.ReportID = wire.Hash([]byte("other")) },
		func(m *wire.NativeMetadata, r *[]wire.NativeFunction) { m.TrialID = "other" },
		func(m *wire.NativeMetadata, r *[]wire.NativeFunction) { m.Image.SHA256 = wire.Hash([]byte("other")) },
		func(m *wire.NativeMetadata, r *[]wire.NativeFunction) {
			m.Image.ModuleSHA256 = wire.Hash([]byte("other"))
		},
		func(m *wire.NativeMetadata, r *[]wire.NativeFunction) { (*r)[1].Offset = 8 },
		func(m *wire.NativeMetadata, r *[]wire.NativeFunction) { (*r)[0].Length = 100 },
		func(m *wire.NativeMetadata, r *[]wire.NativeFunction) { (*r)[1].WasmIndex = 1 },
		func(m *wire.NativeMetadata, r *[]wire.NativeFunction) { (*r)[0].Generation = 1 },
		func(m *wire.NativeMetadata, r *[]wire.NativeFunction) { *r = nil },
		func(m *wire.NativeMetadata, r *[]wire.NativeFunction) {
			b, _ := wire.Encode(*r)
			m.FunctionIndexVersion = "producer-order-v1"
			m.FunctionShards = []wire.NativeFunctionShard{{SHA256: wire.Hash(b), Count: len(*r) + 1}}
		},
	} {
		if err := verify(mutate); err == nil {
			t.Fatal("accepted invalid native inspection")
		}
	}
}

func TestArtifactByteCountIsRequiredEvenForEmptyOriginal(t *testing.T) {
	descriptor := map[string]any{"reportId": wire.Hash([]byte("report")), "content": map[string]any{"status": "available", "sha256": wire.Hash(nil), "mediaType": "application/octet-stream"}, "inspection": map[string]string{"status": "unavailable"}}
	b, _ := json.Marshal(descriptor)
	if _, err := wire.ArtifactData(b); err == nil {
		t.Fatal("missing size became an empty original")
	}
	descriptor["content"].(map[string]any)["bytes"] = 0
	b, _ = json.Marshal(descriptor)
	if _, err := wire.ArtifactData(b); err != nil {
		t.Fatal("rejected explicit empty original", err)
	}
}
