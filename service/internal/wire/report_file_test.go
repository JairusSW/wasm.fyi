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

func TestReportArchiveDescriptorAndSourceSeal(t *testing.T) {
	file := ReportFile{Schema: 1, Kind: "report-file", ReportID: Hash([]byte("report")), Name: "report.tar.gz", MediaType: "application/gzip", Encoding: "identity", SHA256: Hash([]byte("opaque archive")), Bytes: 14, Chunks: []FileChunk{{Hash([]byte("opaque archive")), 14}}, PackingVersion: "sealed-files-tar-gzip-v1", SourceSealSHA256: Hash([]byte("seal"))}
	body, _ := Encode(file)
	if _, e := ReportFileData(body); e != nil {
		t.Fatal(e)
	}
	source, _ := Encode(map[string]string{"sourceSealSha256": file.SourceSealSHA256})
	if e := file.ValidateSource(source); e != nil {
		t.Fatal(e)
	}
	if e := file.ValidateSource([]byte(`{"sourceSealSha256":"different"}`)); e == nil {
		t.Fatal("foreign source seal accepted")
	}
	for _, change := range []func(*ReportFile){func(f *ReportFile) { f.PackingVersion = "" }, func(f *ReportFile) { f.MediaType = "application/vnd.apache.parquet" }, func(f *ReportFile) { f.SourceSealSHA256 = "" }, func(f *ReportFile) { f.Name = "samples.parquet" }, func(f *ReportFile) { f.Bytes = 0; f.Chunks = []FileChunk{} }} {
		invalid := file
		change(&invalid)
		body, _ := Encode(invalid)
		if _, e := ReportFileData(body); e == nil {
			t.Fatal("invalid archive accepted", invalid)
		}
	}
}
