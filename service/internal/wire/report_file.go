package wire

import (
	"crypto/sha256"
	"encoding/hex"
)

const ReportFileChunkBytes = 1024 * 1024
const ReportFileBytes = 1024 * 1024 * 1024

type FileChunk struct {
	SHA256 string `json:"sha256"`
	Bytes  int    `json:"bytes"`
}
type ReportFile struct {
	Schema    int         `json:"schema"`
	Kind      string      `json:"kind"`
	ReportID  string      `json:"reportId"`
	Name      string      `json:"name"`
	MediaType string      `json:"mediaType"`
	Encoding  string      `json:"encoding"`
	SHA256    string      `json:"sha256"`
	Bytes     int64       `json:"bytes"`
	Chunks    []FileChunk `json:"chunks"`
}

func ReportFileData(data []byte) (ReportFile, error) {
	var file ReportFile
	if err := Decode(data, &file); err != nil {
		return file, err
	}
	names := map[string]bool{"samples.parquet": true, "throughput.parquet": true, "observations.parquet": true, "counters.parquet": true, "engine-events.parquet": true, "code-lifetimes.parquet": true, "memory-samples.parquet": true, "memory-observations.parquet": true}
	if file.Schema != 1 || file.Kind != "report-file" || !IsHash(file.ReportID) || !names[file.Name] || file.MediaType != "application/vnd.apache.parquet" || file.Encoding != "identity" || !IsHash(file.SHA256) || file.Bytes < 0 || file.Bytes > ReportFileBytes || file.Chunks == nil || len(file.Chunks) > 1024 {
		return file, Invalid("invalid report file descriptor")
	}
	var total int64
	for i, chunk := range file.Chunks {
		if !IsHash(chunk.SHA256) || chunk.Bytes < 1 || chunk.Bytes > ReportFileChunkBytes || i < len(file.Chunks)-1 && chunk.Bytes != ReportFileChunkBytes {
			return file, Invalid("invalid report file chunk")
		}
		total += int64(chunk.Bytes)
	}
	if total != file.Bytes || file.Bytes > 0 && len(file.Chunks) == 0 {
		return file, Invalid("report file length differs")
	}
	return file, nil
}
func VerifyReportFile(file ReportFile, fetch func(FileChunk) ([]byte, error)) error {
	hash := sha256.New()
	for _, chunk := range file.Chunks {
		b, err := fetch(chunk)
		if err != nil {
			return err
		}
		if len(b) != chunk.Bytes || Hash(b) != chunk.SHA256 {
			return Invalid("report file chunk differs")
		}
		hash.Write(b)
	}
	if hex.EncodeToString(hash.Sum(nil)) != file.SHA256 {
		return Invalid("report file digest differs")
	}
	return nil
}
