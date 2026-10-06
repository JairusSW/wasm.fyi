package wire

import "testing"

func TestNativeFunctionDerivativeReferences(t *testing.T) {
	function := NativeFunction{WasmIndex: 7, Length: 16, Tier: "cranelift"}
	b, _ := Encode([]NativeFunction{function})
	if rows, err := NativeFunctions(b); err != nil || len(rows) != 1 {
		t.Fatal("legacy array changed", err)
	}
	function.Disassembly = Hash([]byte("derivative"))
	b, _ = Encode([]NativeFunction{function})
	if _, err := NativeFunctions(b); err == nil {
		t.Fatal("array hash inferred as authorization")
	}
	valid := map[string]any{"kind": "native-functions-v2", "functions": []NativeFunction{function}, "references": []string{function.Disassembly}}
	b, _ = Encode(valid)
	if rows, err := NativeFunctions(b); err != nil || rows[0].Disassembly != function.Disassembly {
		t.Fatal(err)
	}
	for _, refs := range [][]string{nil, {}, {Hash([]byte("other"))}, {function.Disassembly, function.Disassembly}} {
		valid["references"] = refs
		b, _ = Encode(valid)
		if _, err := NativeFunctions(b); err == nil {
			t.Fatal("unmatched derivative references", refs)
		}
	}
}
