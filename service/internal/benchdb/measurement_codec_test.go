package benchdb

import (
	"bytes"
	"reflect"
	"testing"
)

func TestMeasurementObjectsDeduplicateAndRoundTrip(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	b := s.db.NewIndexedBatch()
	defer b.Close()
	latency := 1.125
	original := measurement{Source: &Source{Repository: "repo", Revision: "commit", AsOf: "week"}, Display: &Display{Group: "Numeric", Tags: []string{"mvp"}}, Sampling: &Sampling{GroupSize: 5, RetainedStart: 0}, SamplesNs: []float64{0, 1.125, 2.25, 1.125, 0}, TimingSamples: 5, Contract: "contract", Engine: "engine", CapturedAt: "time", Status: "ok", Latency: &latency, MemoryStatus: "unsupported", CodeStatus: "failed"}
	first, err := marshalMeasurement(b, original)
	if err != nil {
		t.Fatal(err)
	}
	second, err := marshalMeasurement(b, original)
	if err != nil || !bytes.Equal(first, second) {
		t.Fatal("unstable encoding", err)
	}
	var decoded measurement
	if err := unmarshalMeasurement(b, first, &decoded); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original, decoded) {
		t.Fatalf("measurement changed: %#v", decoded)
	}
	iter, err := b.NewIter(nil)
	if err != nil {
		t.Fatal(err)
	}
	defer iter.Close()
	objects := 0
	for iter.First(); iter.Valid(); iter.Next() {
		if bytes.HasPrefix(iter.Key(), []byte("objects/")) {
			objects++
		}
	}
	if objects != 4 {
		t.Fatalf("duplicate metadata/sample objects: %d", objects)
	}
	var legacy measurement
	if err := unmarshalMeasurement(b, encode(original), &legacy); err != nil || !reflect.DeepEqual(original, legacy) {
		t.Fatal("legacy decoding changed", err)
	}
}

func TestMeasurementReferencesFailClosed(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, data := range [][]byte{nil, {2}, {2, 16}, {2, 1, 0}, append([]byte{2, 1}, make([]byte, 32)...)} {
		var decoded measurement
		if unmarshalMeasurement(s.db, data, &decoded) == nil {
			t.Fatal("accepted invalid reference")
		}
	}
}
