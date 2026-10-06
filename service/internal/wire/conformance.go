package wire

import (
	"bytes"
	"encoding/json"
	"strings"
	"time"
)

const ConformancePolicy = "reported-suite-lanes-v1"

type ConformanceSource struct {
	Schema                 int         `json:"schema"`
	ReportID               string      `json:"reportId"`
	SHA256                 string      `json:"sha256"`
	Bytes                  int64       `json:"bytes"`
	Chunks                 []FileChunk `json:"chunks"`
	Receipt                FileChunk   `json:"receipt"`
	Integrity              string      `json:"integrity"`
	CollectionVerification string      `json:"collectionVerification"`
}

func ConformanceSourceData(data []byte) (ConformanceSource, error) {
	var source ConformanceSource
	if err := Decode(data, &source); err != nil {
		return source, err
	}
	if source.Schema != 1 || !IsHash(source.ReportID) || !IsHash(source.SHA256) || source.Bytes < 1 || source.Bytes > ReportFileBytes || source.Chunks == nil || len(source.Chunks) < 1 || len(source.Chunks) > 1024 || !IsHash(source.Receipt.SHA256) || source.Receipt.Bytes < 64 || source.Receipt.Bytes > 256 || source.Integrity != "content-hash-verified" || source.CollectionVerification != "publisher-asserted" {
		return source, Invalid("invalid conformance source")
	}
	var total int64
	for i, chunk := range source.Chunks {
		if !IsHash(chunk.SHA256) || chunk.Bytes < 1 || chunk.Bytes > ReportFileChunkBytes || i < len(source.Chunks)-1 && chunk.Bytes != ReportFileChunkBytes {
			return source, Invalid("invalid conformance source chunk")
		}
		total += int64(chunk.Bytes)
	}
	if total != source.Bytes {
		return source, Invalid("conformance source length differs")
	}
	identity, _ := Encode([]string{"conformance-v1", source.SHA256, source.Receipt.SHA256})
	if Hash(identity) != source.ReportID {
		return source, Invalid("conformance source identity differs")
	}
	return source, nil
}

func (source ConformanceSource) Verify(fetch func(FileChunk) ([]byte, error)) error {
	receipt, err := fetch(source.Receipt)
	if err != nil {
		return err
	}
	if len(receipt) != source.Receipt.Bytes || Hash(receipt) != source.Receipt.SHA256 || strings.TrimSpace(string(receipt)) != source.SHA256 {
		return Invalid("conformance checksum receipt differs")
	}
	return VerifyReportFile(ReportFile{SHA256: source.SHA256, Bytes: source.Bytes, Chunks: source.Chunks}, fetch)
}

type ConformanceLane struct {
	Schema               int              `json:"schema"`
	Policy               string           `json:"policy"`
	SourceID             string           `json:"sourceId"`
	Lane                 string           `json:"lane"`
	Created              time.Time        `json:"created"`
	Unit                 *string          `json:"unit"`
	Status               *string          `json:"status"`
	Totals               map[string]int64 `json:"totals"`
	Engine               json.RawMessage  `json:"engine"`
	Suite                json.RawMessage  `json:"suite"`
	Reason               *string          `json:"reason"`
	ParserVersion        *string          `json:"parserVersion"`
	InterpretationSource string           `json:"interpretationSource"`
}

func ConformanceLaneData(data []byte) (ConformanceLane, error) {
	var lane ConformanceLane
	if len(data)+512 > 10*1024 {
		return lane, Invalid("conformance lane descriptor exceeds budget")
	}
	if err := Decode(data, &lane); err != nil {
		return lane, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return lane, err
	}
	for _, name := range []string{"unit", "status", "totals", "engine", "suite", "reason", "parserVersion"} {
		if _, present := fields[name]; !present {
			return lane, Invalid("missing conformance availability field")
		}
	}
	if lane.Schema != 1 || lane.Policy != ConformancePolicy || !IsHash(lane.SourceID) || !IsIdentity(lane.Lane) || lane.Created.IsZero() || lane.Created.Year() < 1 || lane.Created.Year() > 9999 || lane.InterpretationSource != "publisher-asserted" {
		return lane, Invalid("invalid conformance lane")
	}
	if lane.Unit != nil && (len(*lane.Unit) == 0 || len(*lane.Unit) > 128) || lane.Reason != nil && len(*lane.Reason) > 2048 || lane.ParserVersion != nil && !IsIdentity(*lane.ParserVersion) {
		return lane, Invalid("invalid conformance lane metadata")
	}
	statuses := map[string]bool{"passed": true, "failed": true, "unsupported": true, "skipped": true, "runner-error": true, "crashed": true}
	if lane.Status != nil && !statuses[*lane.Status] {
		return lane, Invalid("invalid conformance lane status")
	}
	if len(lane.Totals) > 8 {
		return lane, Invalid("invalid conformance outcome counts")
	}
	for status, n := range lane.Totals {
		if (!statuses[status] && status != "xfailed" && status != "xpassed") || n < 0 || n > 9007199254740991 {
			return lane, Invalid("invalid conformance outcome count")
		}
	}
	for _, value := range []json.RawMessage{lane.Engine, lane.Suite} {
		if len(value) == 0 {
			return lane, Invalid("missing conformance metadata availability")
		}
		if !bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			var fields map[string]json.RawMessage
			if err := Decode(value, &fields); err != nil || fields == nil {
				return lane, Invalid("invalid conformance metadata object")
			}
			if len(fields) == 0 {
				return lane, Invalid("empty conformance metadata object")
			}
			allowed := map[string]bool{"repository": true, "revision": true, "tag": true, "version": true, "sha256": true, "assetSha256": true, "url": true, "label": true}
			for name, v := range fields {
				if !allowed[name] {
					return lane, Invalid("unprojected conformance metadata")
				}
				var text string
				if err := json.Unmarshal(v, &text); err != nil || len(text) > 2048 {
					return lane, Invalid("invalid conformance metadata field")
				}
			}
		}
	}
	return lane, nil
}
