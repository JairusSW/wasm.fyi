package wire

import (
	"bytes"
	"encoding/json"
	"testing"
)

func FuzzDecodeTransport(f *testing.F) {
	for _, seed := range [][]byte{[]byte(`{"schema":2}`), []byte(`{"a":1,"a":2}`), []byte(`{"a":{"x":1,"x":2}}`), []byte(`{"value":9007199254740993}`), []byte(`{"value":1e999}`), []byte(`{"text":"\ud83e\udd80"}`), []byte(`{"text":"\ud800"}`), []byte{'"', 0xff, '"'}, []byte(`null`), []byte(`[]`), []byte(`{} {}`)} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, b []byte) {
		if len(b) > ChunkBytes {
			return
		}
		var raw json.RawMessage
		err := Decode(b, &raw)
		if err == nil {
			if !json.Valid(raw) || !bytes.Equal(bytes.TrimSpace(b), raw) {
				t.Fatal("decode changed raw source representation")
			}
			var again json.RawMessage
			if err = Decode(raw, &again); err != nil || !bytes.Equal(raw, again) {
				t.Fatal("accepted representation cannot decode identically", err)
			}
		}
		var job Job
		if err = Decode(b, &job); err == nil {
			_ = job.Validate()
		}
		var result Result
		if err = Decode(b, &result); err == nil {
			_ = result.ValidateMethod()
		}
		_, _ = Resource(b)
	})
}

func TestDecodeRejectsUnicodeReplacementAndPreservesNumbers(t *testing.T) {
	for _, b := range [][]byte{[]byte{'"', 0xff, '"'}, []byte(`"\ud800"`), []byte(`"\udfff"`), []byte(`"\ud800x"`), []byte(`"\ud800\u0061"`), []byte(`{"\ud800":1}`)} {
		var raw json.RawMessage
		if Decode(b, &raw) == nil {
			t.Fatal("malformed Unicode silently normalized", string(b))
		}
	}
	for _, b := range [][]byte{[]byte(`"λ 🦀"`), []byte(`"\ud83e\udd80"`), []byte(`"\\ud800"`), []byte(`{"value":1e999,"counter":9007199254740993}`)} {
		var raw json.RawMessage
		if err := Decode(b, &raw); err != nil || !bytes.Equal(b, raw) {
			t.Fatal("valid source representation changed", string(b), err)
		}
	}
}
