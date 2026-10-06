package wire

import (
	"bytes"
	"encoding/json"
	"unicode/utf8"
)

const ResourceBytes = 64 * 1024 * 1024
const FragmentBytes = 120 * 1024
const ResourceFragments = 1024

const EvidenceIndexReferences = 128

type EvidenceIndex struct {
	Kind       string   `json:"kind"`
	Schema     int      `json:"schema"`
	References []string `json:"references"`
}

type JSONResource struct {
	Kind       string   `json:"kind"`
	Schema     int      `json:"schema"`
	Encoding   string   `json:"encoding"`
	Bytes      int      `json:"bytes"`
	SHA256     string   `json:"sha256"`
	References []string `json:"references"`
}
type JSONFragment struct {
	Kind   string `json:"kind"`
	Schema int    `json:"schema"`
	Text   string `json:"text"`
}

// Resource checks transport envelopes without interpreting scientific payloads.
func Resource(b []byte) (*JSONResource, error) {
	b = bytes.TrimSpace(b)
	var header struct {
		Kind string `json:"kind"`
	}
	if len(b) == 0 || b[0] != '{' {
		return nil, nil
	}
	if err := json.Unmarshal(b, &header); err != nil {
		return nil, Invalid("invalid evidence envelope")
	}
	switch header.Kind {
	case "evidence-index":
		var index EvidenceIndex
		if err := Decode(b, &index); err != nil {
			return nil, err
		}
		if index.Schema != 1 || len(index.References) < 1 || len(index.References) > EvidenceIndexReferences {
			return nil, Invalid("invalid evidence index")
		}
		for _, ref := range index.References {
			if !IsHash(ref) {
				return nil, Invalid("invalid evidence index reference")
			}
		}
	case "json-fragment":
		var fragment JSONFragment
		if err := Decode(b, &fragment); err != nil {
			return nil, err
		}
		if fragment.Schema != 1 || fragment.Text == "" || len(fragment.Text) > FragmentBytes || !utf8.Valid(b) {
			return nil, Invalid("invalid JSON fragment")
		}
	case "json-resource":
		var resource JSONResource
		if err := Decode(b, &resource); err != nil {
			return nil, err
		}
		if resource.Schema != 1 || resource.Encoding != "json-utf8" || resource.Bytes < 1 || resource.Bytes > ResourceBytes || !IsHash(resource.SHA256) || len(resource.References) < 1 || len(resource.References) > ResourceFragments {
			return nil, Invalid("invalid JSON resource")
		}
		for _, ref := range resource.References {
			if !IsHash(ref) {
				return nil, Invalid("invalid fragment reference")
			}
		}
		return &resource, nil
	}
	return nil, nil
}

// VerifyResource verifies the original JSON, not only the fragment files. The
// maximum allocation is explicit; HTTP reads return fragments without assembly.
func VerifyResource(resource JSONResource, fetch func(string) ([]byte, error)) error {
	_, err := AssembleResource(resource, fetch)
	return err
}
func AssembleResource(resource JSONResource, fetch func(string) ([]byte, error)) ([]byte, error) {
	if resource.Kind != "json-resource" || resource.Schema != 1 || resource.Encoding != "json-utf8" || resource.Bytes < 1 || resource.Bytes > ResourceBytes || !IsHash(resource.SHA256) || len(resource.References) < 1 || len(resource.References) > ResourceFragments {
		return nil, Invalid("invalid JSON resource")
	}
	for _, digest := range resource.References {
		if !IsHash(digest) {
			return nil, Invalid("invalid fragment reference")
		}
	}
	value := make([]byte, 0, resource.Bytes)
	for _, digest := range resource.References {
		b, err := fetch(digest)
		if err != nil {
			return nil, err
		}
		if len(b) > ChunkBytes {
			return nil, Invalid("oversized fragment representation")
		}
		if Hash(b) != digest {
			return nil, Invalid("fragment hash differs")
		}
		var fragment JSONFragment
		if err = Decode(b, &fragment); err != nil {
			return nil, err
		}
		if fragment.Kind != "json-fragment" || fragment.Schema != 1 || fragment.Text == "" || len(fragment.Text) > FragmentBytes || !utf8.Valid(b) {
			return nil, Invalid("resource references invalid fragment")
		}
		if len(fragment.Text) > resource.Bytes-len(value) {
			return nil, Invalid("resource exceeds declared bytes")
		}
		value = append(value, fragment.Text...)
	}
	if len(value) != resource.Bytes || Hash(value) != resource.SHA256 || !utf8.Valid(value) || !json.Valid(bytes.TrimSpace(value)) {
		return nil, Invalid("reassembled JSON differs")
	}
	if err := uniqueKeys(json.NewDecoder(bytes.NewReader(value))); err != nil {
		return nil, err
	}
	return value, nil
}
