package benchdb

import (
	"math"
	"testing"
)

func TestSamplesPreserveOrderedBits(t *testing.T) {
	cases := [][]float64{
		{}, {0, math.Copysign(0, -1), math.SmallestNonzeroFloat64},
		{3.25, 2.125, 3.25, 0, 9007199254740992, math.MaxFloat64},
		{100, 100, 100, 101, 99, 100.001},
	}
	for _, original := range cases {
		encoded := encodeSamples(original)
		decoded, err := decodeSamples(encoded)
		if err != nil || len(decoded) != len(original) {
			t.Fatalf("round trip: %v (%d/%d)", err, len(decoded), len(original))
		}
		if len(encoded) > 1+8*len(original) {
			t.Fatal("encoding exceeds raw binary size")
		}
		for i := range original {
			if math.Float64bits(original[i]) != math.Float64bits(decoded[i]) {
				t.Fatalf("sample %d changed bits", i)
			}
		}
	}
}

func TestSampleVectorRejectsCorruption(t *testing.T) {
	for _, encoded := range [][]byte{nil, {2}, {0, 1}, {1, 128}, {1, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255}} {
		if _, err := decodeSamples(encoded); err == nil {
			t.Fatalf("accepted corrupt vector %x", encoded)
		}
	}
	for _, invalid := range []float64{-1, math.Inf(1), math.NaN()} {
		if _, err := decodeSamples(encodeSamples([]float64{invalid})); err == nil {
			t.Fatal("accepted invalid sample")
		}
	}
}
