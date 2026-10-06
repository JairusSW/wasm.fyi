package wire

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

type ParentArchive struct {
	Schema   int      `json:"schema"`
	Index    Object   `json:"index"`
	Metadata Object   `json:"metadata"`
	SHA256   string   `json:"sha256"`
	Bytes    int64    `json:"bytes"`
	Chunks   []Object `json:"chunks"`
}

func (p ParentArchive) Objects() []Object { return append([]Object{p.Index, p.Metadata}, p.Chunks...) }
func (p ParentArchive) Validate(job Job) error {
	if p.Schema != 1 || p.Index.Kind != "evidence" || p.Index.SHA256 != job.ParentBundleSHA256 || !ValidPayload(p.Index) || p.Metadata.Kind != "evidence" || !ValidPayload(p.Metadata) || !IsHash(p.SHA256) || p.Bytes < 1 || p.Bytes > ReportFileBytes || len(p.Chunks) < 1 || len(p.Chunks) > 2048 {
		return Invalid("invalid parent archive transport")
	}
	var total int64
	for _, o := range p.Chunks {
		if o.Kind != "binary" || !ValidPayload(o) || o.Bytes < 1 || o.Bytes > ReportFileChunkBytes {
			return Invalid("invalid parent archive chunk")
		}
		total += int64(o.Bytes)
	}
	if total != p.Bytes {
		return Invalid("parent archive transport size differs")
	}
	return nil
}
func (p ParentArchive) Verify(job Job, fetch func(Object) ([]byte, error)) error {
	if err := p.Validate(job); err != nil {
		return err
	}
	load := func(o Object) ([]byte, error) {
		b, e := fetch(o)
		if e != nil {
			return nil, e
		}
		if len(b) != o.Bytes || Hash(b) != o.SHA256 {
			return nil, Invalid("parent archive object differs")
		}
		var value map[string]json.RawMessage
		if e = Decode(b, &value); e != nil {
			return nil, e
		}
		return b, nil
	}
	raw, e := load(p.Index)
	if e != nil {
		return e
	}
	var index struct {
		Schema         int    `json:"schema"`
		ID             string `json:"id"`
		Machine        string `json:"machine"`
		Metadata       string `json:"metadata"`
		MetadataSHA256 string `json:"metadataSha256"`
		SHA256         string `json:"sha256"`
		Bytes          int64  `json:"bytes"`
		Parts          []struct {
			Path   string `json:"path"`
			SHA256 string `json:"sha256"`
			Bytes  int    `json:"bytes"`
		} `json:"parts"`
	}
	if e = json.Unmarshal(raw, &index); e != nil {
		return e
	}
	if index.Schema != 1 || index.ID != job.Session || index.Machine != job.Machine || index.Metadata != "metadata.json" || index.MetadataSHA256 != p.Metadata.SHA256 || index.SHA256 != p.SHA256 || index.Bytes != p.Bytes || len(index.Parts) < 1 || len(index.Parts) > 2048 {
		return Invalid("parent archive source binding differs")
	}
	var total int64
	for i, part := range index.Parts {
		if part.Path != fmt.Sprintf("bundle.tar.gz.part-%03d", i) || !IsHash(part.SHA256) || part.Bytes < 1 || part.Bytes > 32*1024*1024 {
			return Invalid("invalid parent archive source part")
		}
		total += int64(part.Bytes)
	}
	if total != p.Bytes {
		return Invalid("parent archive source size differs")
	}
	raw, e = load(p.Metadata)
	if e != nil {
		return e
	}
	var metadata struct {
		Plan string `json:"planSha256"`
	}
	if e = json.Unmarshal(raw, &metadata); e != nil {
		return e
	}
	if metadata.Plan != job.Plan {
		return Invalid("parent archive plan differs")
	}
	whole, partHash := sha256.New(), sha256.New()
	partIndex, partBytes := 0, 0
	for _, chunk := range p.Chunks {
		b, e := fetch(chunk)
		if e != nil {
			return e
		}
		if len(b) != chunk.Bytes || Hash(b) != chunk.SHA256 {
			return Invalid("parent archive chunk differs")
		}
		whole.Write(b)
		for len(b) > 0 {
			if partIndex == len(index.Parts) {
				return Invalid("parent archive has extra bytes")
			}
			part := index.Parts[partIndex]
			n := min(len(b), part.Bytes-partBytes)
			partHash.Write(b[:n])
			partBytes += n
			b = b[n:]
			if partBytes == part.Bytes {
				if hex.EncodeToString(partHash.Sum(nil)) != part.SHA256 {
					return Invalid("parent archive source part digest differs")
				}
				partIndex++
				partBytes = 0
				partHash.Reset()
			}
		}
	}
	if partIndex != len(index.Parts) || partBytes != 0 || hex.EncodeToString(whole.Sum(nil)) != p.SHA256 {
		return Invalid("parent archive original digest differs")
	}
	return nil
}
