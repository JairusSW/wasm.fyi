package store

import (
	"bytes"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"sort"
)

func (s *Store) validateNativeInspection(artifact wire.Artifact, module string, fetch func(string) ([]byte, error)) error {
	if artifact.Inspection.Metadata == "" {
		return nil
	}
	b, err := fetch(artifact.Inspection.Metadata)
	if err != nil {
		return err
	}
	b, err = inspectionJSON(b, fetch)
	if err != nil {
		return err
	}
	var metadata wire.NativeMetadata
	if err = wire.Decode(b, &metadata); err != nil {
		return err
	}
	image := metadata.Image
	if metadata.Kind != "native-image-metadata" || metadata.ReportID != artifact.ReportID || metadata.TrialID != artifact.Record.Trial || metadata.PassID == "" || image.SHA256 != artifact.Content.SHA256 || !wire.IsHash(image.ModuleSHA256) || module != "" && image.ModuleSHA256 != module || image.Format != "raw-native-image" || image.SectionKind != "mixed_code_and_embedded_data" || image.Event != "compiled_snapshot" || image.Backend == "" || (image.Architecture != "arm64" && image.Architecture != "amd64") {
		return wire.Invalid("native metadata identity differs")
	}
	if image.Version != 1 && image.Version != 2 && image.Version != 3 {
		return wire.Invalid("unsupported native image version")
	}
	if image.Version == 1 && image.Attribution != "unavailable" || image.Version != 1 && image.Attribution != "engine_reported" {
		return wire.Invalid("invalid function attribution")
	}
	materialization := bytes.TrimSpace(image.Materialization)
	present := len(materialization) > 0 && string(materialization) != "null"
	if image.Version == 3 && (!present || materialization[0] != '{') {
		return wire.Invalid("missing compile materialization")
	}
	if image.Version != 3 && present {
		return wire.Invalid("legacy image declares materialization")
	}
	if len(metadata.Functions) != len(metadata.References) {
		return wire.Invalid("function references differ")
	}
	counts, err := metadata.FunctionCounts()
	if err != nil {
		return err
	}
	seenPages := map[string]bool{}
	functions := []wire.NativeFunction{}
	seenIndices := map[uint32]bool{}
	for i, ref := range metadata.Functions {
		if ref != metadata.References[i] || seenPages[ref] {
			return wire.Invalid("function references differ")
		}
		seenPages[ref] = true
		b, err := fetch(ref)
		if err != nil {
			return err
		}
		b, err = inspectionJSON(b, fetch)
		if err != nil {
			return err
		}
		var rows []wire.NativeFunction
		if err = wire.Decode(b, &rows); err != nil {
			return err
		}
		if len(rows) == 0 {
			return wire.Invalid("empty function shard")
		}
		if counts != nil && counts[i] != len(rows) {
			return wire.Invalid("native function shard count differs")
		}
		for _, f := range rows {
			if f.ModuleIndex != 0 || seenIndices[f.WasmIndex] || f.Tier != image.Backend || f.Generation != 0 || f.Length == 0 || f.Offset > uint64(artifact.Content.Bytes) || f.Length > uint64(artifact.Content.Bytes)-f.Offset {
				return wire.Invalid("invalid native function range")
			}
			seenIndices[f.WasmIndex] = true
			functions = append(functions, f)
			if len(functions) > 1000000 {
				return ErrLimit
			}
		}
	}
	if image.Version == 1 && len(functions) != 0 {
		return wire.Invalid("legacy image declares function ranges")
	}
	if image.Version > 1 && image.Backend != "cranelift" && image.Backend != "winch" {
		return wire.Invalid("unsupported attributed backend")
	}
	sort.Slice(functions, func(i, j int) bool { return functions[i].Offset < functions[j].Offset })
	for i := 1; i < len(functions); i++ {
		if functions[i].Offset < functions[i-1].Offset+functions[i-1].Length {
			return wire.Invalid("overlapping native function ranges")
		}
	}
	if artifact.Inspection.Status == "available" && len(functions) == 0 {
		return wire.Invalid("inspection has no functions")
	}
	return nil
}

func inspectionJSON(b []byte, fetch func(string) ([]byte, error)) ([]byte, error) {
	resource, err := wire.Resource(b)
	if err != nil {
		return nil, err
	}
	if resource == nil {
		return b, nil
	}
	return wire.AssembleResource(*resource, fetch)
}
