package benchdb

import (
	"encoding/binary"
	"fmt"
	"math"
)

// Sample vectors retain acquisition order and every IEEE-754 bit. XOR encoding
// exploits nearby values without quantizing fractional nanoseconds.
func encodeSamples(samples []float64) []byte {
	raw := make([]byte, 1, 1+8*len(samples))
	xor := []byte{1}
	var previous uint64
	for _, sample := range samples {
		bits := math.Float64bits(sample)
		raw = binary.LittleEndian.AppendUint64(raw, bits)
		xor = binary.AppendUvarint(xor, bits^previous)
		previous = bits
	}
	if len(xor) < len(raw) {
		return xor
	}
	return raw
}

func decodeSamples(encoded []byte) ([]float64, error) {
	if len(encoded) == 0 || encoded[0] > 1 {
		return nil, fmt.Errorf("invalid sample vector encoding")
	}
	mode, data := encoded[0], encoded[1:]
	if mode == 0 && len(data)%8 != 0 {
		return nil, fmt.Errorf("truncated sample vector")
	}
	samples := make([]float64, 0, len(data)/8)
	var previous uint64
	for len(data) > 0 {
		var bits uint64
		if mode == 0 {
			bits, data = binary.LittleEndian.Uint64(data), data[8:]
		} else {
			value, n := binary.Uvarint(data)
			if n <= 0 {
				return nil, fmt.Errorf("invalid sample vector delta")
			}
			bits, data = value^previous, data[n:]
		}
		value := math.Float64frombits(bits)
		if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) || len(samples) >= 4096 {
			return nil, fmt.Errorf("invalid sample vector value")
		}
		samples = append(samples, value)
		previous = bits
	}
	return samples, nil
}
