package wire

import (
	"errors"
	"testing"
)

func TestStrictJSON(t *testing.T) {
	for _, input := range []string{`{"schema":2,"schema":1}`, `{"outer":{"id":"a","id":"b"}}`, `{"id":1} {"id":2}`, `{"unexpected":true}`} {
		var v struct {
			Schema int `json:"schema"`
			Outer  any `json:"outer"`
		}
		if err := Decode([]byte(input), &v); !errors.Is(err, ErrInvalid) {
			t.Fatalf("accepted ambiguous JSON %s: %v", input, err)
		}
	}
	var exact struct {
		Value string `json:"value"`
	}
	if err := Decode([]byte(`{"value":"18446744073709551615"}`), &exact); err != nil || exact.Value != "18446744073709551615" {
		t.Fatal("exact integer changed")
	}
}
