package wire

import "encoding/json"

type Artifact struct {
	ReportID string `json:"reportId"`
	Record   struct {
		Runtime  string `json:"runtime"`
		Workload string `json:"workload"`
		Trial    string `json:"trial"`
	} `json:"record"`
	Content struct {
		Status    string `json:"status"`
		SHA256    string `json:"sha256"`
		Bytes     int    `json:"bytes"`
		MediaType string `json:"mediaType"`
	} `json:"content"`
	Inspection struct {
		Status   string `json:"status"`
		Metadata string `json:"metadata"`
	} `json:"inspection"`
}

func ArtifactData(b []byte) (Artifact, error) {
	var artifact Artifact
	if err := json.Unmarshal(b, &artifact); err != nil {
		return artifact, Invalid("invalid artifact descriptor")
	}
	var raw struct {
		Content map[string]json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return artifact, Invalid("invalid content fields")
	}
	if artifact.Content.Status == "available" {
		if count, ok := raw.Content["bytes"]; !ok || string(count) == "null" {
			return artifact, Invalid("missing original byte count")
		}
	}
	if artifact.Inspection.Status == "available" && artifact.Content.Status != "available" {
		return artifact, Invalid("inspection lacks exported content")
	}
	if artifact.Content.Status == "available" {
		if !IsHash(artifact.Content.SHA256) || artifact.Content.Bytes < 0 || artifact.Content.Bytes > BlobBytes || artifact.Content.MediaType != "application/octet-stream" {
			return artifact, Invalid("invalid artifact content")
		}
	} else if artifact.Content.Status != "unavailable" || artifact.Content.SHA256 != "" || artifact.Content.Bytes != 0 || artifact.Content.MediaType != "" {
		return artifact, Invalid("unavailable artifact advertises content")
	}
	if artifact.Inspection.Status != "available" && artifact.Inspection.Status != "unavailable" || artifact.Inspection.Status == "available" && artifact.Inspection.Metadata == "" {
		return artifact, Invalid("invalid inspection availability")
	}
	if artifact.Inspection.Metadata != "" && !IsHash(artifact.Inspection.Metadata) {
		return artifact, Invalid("invalid inspection metadata")
	}
	return artifact, nil
}
