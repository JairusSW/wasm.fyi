package store

import (
	"bytes"
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestDisassemblyWindowsAndPortableRecovery(t *testing.T) {
	text := "image.o: file format elf\n\n0: nop\n1: ret\ntrailing text"
	job, objects, id, err := testutil.DisassemblyFixture("disassembly", time.Now().UTC(), text)
	if err != nil {
		t.Fatal(err)
	}
	s := openTest(t, filepath.Join(t.TempDir(), "live"))
	defer s.Close()
	for hash, b := range objects {
		if err = s.Install(hash, bytes.NewReader(b)); err != nil {
			t.Fatal(err)
		}
	}
	receipt, err := s.Submit(job)
	if err != nil {
		t.Fatal(err)
	}
	revision, err := s.Commit(receipt)
	if err != nil {
		t.Fatal(err)
	}
	check := func(s *Store) {
		all := ""
		offset := 0
		for {
			page, e := s.DisassemblyPage(context.Background(), revision, id, 0, offset, 2)
			if e != nil {
				t.Fatal(e)
			}
			if page.Total != 5 || page.Version != wire.DisassemblyVersion || page.Function.WasmIndex != 7 || page.ImageSHA256 == "" || page.TextSHA256 != wire.Hash([]byte(text)) {
				t.Fatal(page)
			}
			for _, line := range page.Items {
				all += line
			}
			if page.Next == page.Total {
				break
			}
			if page.Next <= offset {
				t.Fatal("no progress")
			}
			offset = page.Next
		}
		if all != text {
			t.Fatal("original diagnostic changed", all)
		}
		page, e := s.DisassemblyPage(context.Background(), revision, id, 0, 2, 1)
		if e != nil || !reflect.DeepEqual(page.Items, []string{"0: nop\n"}) {
			t.Fatal(page, e)
		}
		if _, e = s.DisassemblyPage(context.Background(), revision, id, 1, 0, 1); e == nil {
			t.Fatal("unknown ordinal")
		}
		if _, e = s.DisassemblyPage(context.Background(), revision, id, 0, 6, 1); e == nil {
			t.Fatal("invalid offset")
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, e = s.DisassemblyPage(ctx, revision, id, 0, 0, 1); e == nil {
			t.Fatal("cancellation lost")
		}
	}
	check(s)
	// A selected last window must not fetch earlier diagnostic chunks.
	var first string
	for _, b := range objects {
		var d wire.NativeDisassembly
		if wire.Decode(b, &d) == nil && d.Kind == "native-function-disassembly" {
			first = d.Chunks[0].SHA256
			break
		}
	}
	if first == "" {
		t.Fatal("missing diagnostic fixture")
	}
	path := filepath.Join(s.root, "objects", first)
	if err = os.Remove(path); err != nil {
		t.Fatal(err)
	}
	selected, err := s.DisassemblyPage(context.Background(), revision, id, 0, 4, 1)
	if err != nil || len(selected.Items) != 1 || selected.Items[0] != "trailing text" {
		t.Fatal("unselected chunk loaded", selected, err)
	}
	if _, err = s.DisassemblyPage(context.Background(), revision, id, 0, 0, 1); err == nil {
		t.Fatal("missing selected chunk ignored")
	}
	if err = os.WriteFile(path, objects[first], 0600); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(t.TempDir(), "backup")
	if _, err = s.Backup(context.Background(), backup); err != nil {
		t.Fatal(err)
	}
	rebuilt := filepath.Join(t.TempDir(), "rebuild")
	if err = Rebuild(backup, rebuilt, "fixture"); err != nil {
		t.Fatal(err)
	}
	recovered := openTest(t, rebuilt)
	defer recovered.Close()
	check(recovered)
}

func TestDisassemblyRejectsForgedDiagnostics(t *testing.T) {
	function := wire.NativeFunction{WasmIndex: 7, Offset: 0, Length: 32, Tier: "cranelift"}
	metadata := wire.NativeMetadata{}
	metadata.Image.SHA256 = wire.Hash([]byte("image"))
	metadata.Image.ModuleSHA256 = wire.Hash([]byte("module"))
	metadata.Image.Architecture = "amd64"
	raw, _ := wire.Encode(wire.DisassemblyLines{Kind: "native-disassembly-lines", Lines: []string{"0: nop\n"}})
	chunk := wire.Hash(raw)
	d := wire.NativeDisassembly{Kind: "native-function-disassembly", Version: wire.DisassemblyVersion, SourceVersion: "native-image-disassembly-v2", ImageSHA256: metadata.Image.SHA256, ModuleSHA256: metadata.Image.ModuleSHA256, Architecture: "amd64", Function: function, Tools: []wire.DisassemblyTool{{SHA256: wire.Hash([]byte("a")), Version: "v"}, {SHA256: wire.Hash([]byte("b")), Version: "v"}}, Arguments: []string{"--disassemble", "--disassemble-zeroes", "--section=.text", "--start-address=0", "--stop-address=32", "image.o"}, Interpretation: "Tool-produced diagnostics", TextSHA256: wire.Hash([]byte("0: nop\n")), Bytes: 7, Lines: 1, Chunks: []wire.DisassemblyChunk{{SHA256: chunk, Lines: 1}}, References: []string{chunk}}
	for _, mutate := range []func(*wire.NativeDisassembly){nil, func(d *wire.NativeDisassembly) { d.ImageSHA256 = wire.Hash([]byte("wrong")) }, func(d *wire.NativeDisassembly) { d.Function.WasmIndex++ }, func(d *wire.NativeDisassembly) { d.Arguments[3] = "--start-address=1" }, func(d *wire.NativeDisassembly) { d.TextSHA256 = wire.Hash([]byte("fake")) }, func(d *wire.NativeDisassembly) { d.Bytes++ }, func(d *wire.NativeDisassembly) { d.Chunks[0].Lines++ }, func(d *wire.NativeDisassembly) { d.Tools[0].SHA256 = "bad" }} {
		copy := d
		copy.Arguments = append([]string{}, d.Arguments...)
		copy.Chunks = append([]wire.DisassemblyChunk{}, d.Chunks...)
		copy.Tools = append([]wire.DisassemblyTool{}, d.Tools...)
		if mutate != nil {
			mutate(&copy)
		}
		b, _ := wire.Encode(copy)
		f := function
		f.Disassembly = wire.Hash(b)
		err := validateDisassembly(f, metadata, func(id string) ([]byte, error) {
			if id == f.Disassembly {
				return b, nil
			}
			return raw, nil
		})
		if (err == nil) != (mutate == nil) {
			t.Fatal("forged diagnostic admission", err)
		}
	}
}
