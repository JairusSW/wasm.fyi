package sqldb

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"math"
)

func encode(v any) []byte    { b, _ := json.Marshal(v); return b }
func digest(b []byte) []byte { d := sha256.Sum256(b); return d[:] }
func hash(v any) string      { return hex.EncodeToString(digest(encode(v))) }

var phases = []string{"compile", "instantiate", "first-call", "steady"}

func phaseID(p string) int {
	for i, v := range phases {
		if v == p {
			return i
		}
	}
	return -1
}

var statuses = []string{"", "ok", "failed", "unsupported", "disabled", "not-measured", "unavailable"}

func statusID(s string) int {
	for i, v := range statuses {
		if v == s {
			return i
		}
	}
	return -1
}
func statusName(i int) string {
	if i >= 0 && i < len(statuses) {
		return statuses[i]
	}
	return ""
}
func vector(v []float64) []byte {
	b := make([]byte, len(v)*8)
	for i, f := range v {
		binary.LittleEndian.PutUint64(b[i*8:], math.Float64bits(f))
	}
	return b
}
func unvector(b []byte) []float64 {
	if b == nil {
		return nil
	}
	v := make([]float64, len(b)/8)
	for i := range v {
		v[i] = math.Float64frombits(binary.LittleEndian.Uint64(b[i*8:]))
	}
	return v
}
func metrics(r benchdb.Row) []byte {
	b := make([]byte, 25)
	for i, p := range []*float64{r.Value, r.PeakRSS, r.CodeBytes} {
		if p != nil {
			b[0] |= 1 << i
			binary.LittleEndian.PutUint64(b[1+i*8:], math.Float64bits(*p))
		}
	}
	return b
}
func unmetrics(b []byte, r *benchdb.Row) {
	for i, p := range []**float64{&r.Value, &r.PeakRSS, &r.CodeBytes} {
		if b[0]&(1<<i) != 0 {
			f := math.Float64frombits(binary.LittleEndian.Uint64(b[1+i*8:]))
			*p = &f
		}
	}
}
