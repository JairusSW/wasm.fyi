package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func disassemblyDescriptor(b []byte, function wire.NativeFunction, metadata wire.NativeMetadata) (wire.NativeDisassembly, error) {
	var d wire.NativeDisassembly
	if err := wire.Decode(b, &d); err != nil {
		return d, err
	}
	if err := d.Validate(); err != nil {
		return d, err
	}
	if d.Source != nil && d.Source.CodePassID != metadata.PassID {
		return d, wire.Invalid("disassembly code-pass attestation differs")
	}
	function.Disassembly = ""
	if d.Function != function || d.ImageSHA256 != metadata.Image.SHA256 || d.ModuleSHA256 != metadata.Image.ModuleSHA256 || d.Architecture != metadata.Image.Architecture {
		return d, wire.Invalid("disassembly source identity differs")
	}
	expected := []string{"--disassemble", "--disassemble-zeroes", "--section=.text", fmt.Sprintf("--start-address=%d", function.Offset), fmt.Sprintf("--stop-address=%d", function.Offset+function.Length)}
	for i, arg := range expected {
		if d.Arguments[i] != arg {
			return d, wire.Invalid("disassembly range arguments differ")
		}
	}
	return d, nil
}
func disassemblyChunk(b []byte, count int) ([]string, error) {
	if len(b) > 128<<10 {
		return nil, wire.Invalid("disassembly chunk exceeds ceiling")
	}
	var chunk wire.DisassemblyLines
	if err := wire.Decode(b, &chunk); err != nil {
		return nil, err
	}
	if chunk.Kind != "native-disassembly-lines" || len(chunk.Lines) != count {
		return nil, wire.Invalid("disassembly chunk count differs")
	}
	for _, line := range chunk.Lines {
		if line == "" || len(line) > 16<<10 || !utf8.ValidString(line) || strings.ContainsRune(strings.TrimSuffix(line, "\n"), '\n') {
			return nil, wire.Invalid("invalid disassembly line")
		}
	}
	return chunk.Lines, nil
}
func validateDisassembly(function wire.NativeFunction, metadata wire.NativeMetadata, fetch func(string) ([]byte, error)) error {
	if function.Disassembly == "" {
		return nil
	}
	b, err := fetch(function.Disassembly)
	if err != nil {
		return err
	}
	b, err = inspectionJSON(b, fetch)
	if err != nil {
		return err
	}
	d, err := disassemblyDescriptor(b, function, metadata)
	if err != nil {
		return err
	}
	hash := sha256.New()
	size, position := 0, 0
	for _, chunk := range d.Chunks {
		b, err = fetch(chunk.SHA256)
		if err != nil {
			return err
		}
		lines, err := disassemblyChunk(b, chunk.Lines)
		if err != nil {
			return err
		}
		for _, line := range lines {
			position++
			if position < d.Lines && !strings.HasSuffix(line, "\n") {
				return wire.Invalid("disassembly line boundary differs")
			}
			size += len(line)
			if size > d.Bytes {
				return wire.Invalid("disassembly exceeds declared bytes")
			}
			hash.Write([]byte(line))
		}
	}
	if size != d.Bytes || hex.EncodeToString(hash.Sum(nil)) != d.TextSHA256 {
		return wire.Invalid("disassembly original text differs")
	}
	return nil
}

type DisassemblyPage struct {
	Source         *wire.DisassemblySource `json:"source,omitempty"`
	Version        string                  `json:"version"`
	SourceVersion  string                  `json:"sourceVersion"`
	ImageSHA256    string                  `json:"imageSha256"`
	TextSHA256     string                  `json:"textSha256"`
	Function       wire.NativeFunction     `json:"function"`
	Tools          []wire.DisassemblyTool  `json:"tools"`
	Arguments      []string                `json:"arguments"`
	Interpretation string                  `json:"interpretation"`
	Items          []string                `json:"items"`
	Total          int                     `json:"total"`
	Next           int                     `json:"-"`
}

// Ordinal follows the same immutable producer order as FunctionPage. Only the
// selected function descriptor and intersecting line chunks are decoded.
func (s *Store) DisassemblyPage(ctx context.Context, revision, id string, ordinal, offset, limit int) (DisassemblyPage, error) {
	page := DisassemblyPage{Items: []string{}}
	if ordinal < 0 || offset < 0 || limit < 1 || limit > 1000 {
		return page, wire.Invalid("invalid disassembly window")
	}
	functions, err := s.FunctionPage(ctx, revision, id, ordinal, 1)
	if err != nil {
		return page, err
	}
	if len(functions.Items) != 1 || functions.Items[0].Disassembly == "" {
		return page, ErrNotFound
	}
	function := functions.Items[0]
	record, err := s.Record(revision, "artifact", id)
	if err != nil {
		return page, err
	}
	artifact, err := wire.ArtifactData(record.Data)
	if err != nil {
		return page, err
	}
	bytesRead := 0
	fetch := func(digest string) ([]byte, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		b, err := s.representationContext(ctx, digest, wire.ChunkBytes)
		bytesRead += len(b)
		if bytesRead > 32<<20 {
			return nil, ErrLimit
		}
		return b, err
	}
	b, err := fetch(artifact.Inspection.Metadata)
	if err != nil {
		return page, err
	}
	b, err = inspectionJSON(b, fetch)
	if err != nil {
		return page, err
	}
	var metadata wire.NativeMetadata
	if err = wire.Decode(b, &metadata); err != nil {
		return page, err
	}
	b, err = fetch(function.Disassembly)
	if err != nil {
		return page, err
	}
	b, err = inspectionJSON(b, fetch)
	if err != nil {
		return page, err
	}
	d, err := disassemblyDescriptor(b, function, metadata)
	if err != nil {
		return page, err
	}
	if offset > d.Lines {
		return page, wire.Invalid("disassembly cursor offset invalid")
	}
	page.Source = d.Source
	page.Version = d.Version
	page.SourceVersion = d.SourceVersion
	page.ImageSHA256 = d.ImageSHA256
	page.TextSHA256 = d.TextSHA256
	page.Function = function
	page.Tools = d.Tools
	page.Arguments = d.Arguments
	page.Interpretation = d.Interpretation
	page.Total = d.Lines
	header, err := wire.Encode(page)
	if err != nil {
		return page, err
	}
	position, size := 0, len(header)+4096
	if size >= wire.ResponseBytes {
		return page, ErrLimit
	}
	for _, chunk := range d.Chunks {
		if position+chunk.Lines <= offset {
			position += chunk.Lines
			continue
		}
		if len(page.Items) >= limit {
			break
		}
		b, err = fetch(chunk.SHA256)
		if err != nil {
			return page, err
		}
		lines, err := disassemblyChunk(b, chunk.Lines)
		if err != nil {
			return page, err
		}
		for _, line := range lines {
			if position < offset {
				position++
				continue
			}
			encoded, err := wire.Encode(line)
			if err != nil {
				return page, err
			}
			if len(page.Items) >= limit || size+len(encoded)+1 > wire.ResponseBytes {
				page.Next = offset + len(page.Items)
				return page, nil
			}
			size += len(encoded) + 1
			page.Items = append(page.Items, line)
			position++
		}
	}
	page.Next = offset + len(page.Items)
	return page, ctx.Err()
}
