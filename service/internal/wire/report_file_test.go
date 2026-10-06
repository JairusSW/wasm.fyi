package wire

import (
	"bytes"
	"testing"
)

func TestReportFileIntegrityAndBounds(t *testing.T) {
	payload := []byte("original analytical bytes")
	file := ReportFile{Schema: 1, Kind: "report-file", ReportID: Hash([]byte("report")), Name: "samples.parquet", MediaType: "application/vnd.apache.parquet", Encoding: "identity", SHA256: Hash(payload), Bytes: int64(len(payload)), Chunks: []FileChunk{{Hash(payload), len(payload)}}}
	encode := func(v ReportFile) []byte { b, _ := Encode(v); return b }
	if _, err := ReportFileData(encode(file)); err != nil {
		t.Fatal(err)
	}
	if err := VerifyReportFile(file, func(FileChunk) ([]byte, error) { return payload, nil }); err != nil {
		t.Fatal(err)
	}
	if err := VerifyReportFile(file, func(FileChunk) ([]byte, error) { return bytes.Repeat([]byte{0}, len(payload)), nil }); err == nil {
		t.Fatal("corrupt binary accepted")
	}
	mismatch := file
	mismatch.SHA256 = Hash([]byte("different original"))
	if err := VerifyReportFile(mismatch, func(FileChunk) ([]byte, error) { return payload, nil }); err == nil {
		t.Fatal("wrong original digest accepted")
	}
	for name, change := range map[string]func(*ReportFile){"path": func(v *ReportFile) { v.Name = "../samples.parquet" }, "size": func(v *ReportFile) { v.Bytes++ }, "ceiling": func(v *ReportFile) { v.Bytes = ReportFileBytes + 1 }, "nil": func(v *ReportFile) { v.Chunks = nil }, "encoding": func(v *ReportFile) { v.Encoding = "gzip" }, "short-inner": func(v *ReportFile) { v.Chunks = append(v.Chunks, v.Chunks[0]); v.Bytes *= 2 }} {
		t.Run(name, func(t *testing.T) {
			v := file
			change(&v)
			if _, err := ReportFileData(encode(v)); err == nil {
				t.Fatal("invalid file contract accepted")
			}
		})
	}
}
