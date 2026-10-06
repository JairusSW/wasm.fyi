package main

import (
	"bytes"
	"context"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
	"github.com/JairusSW/wasm.fyi/service/internal/testutil"
	"path/filepath"
	"testing"
	"time"
)

func TestOperationalCommands(t *testing.T) {
	root := t.TempDir()
	data := filepath.Join(root, "data")
	s, e := store.Open(data, "fixture")
	if e != nil {
		t.Fatal(e)
	}
	j, objects, e := testutil.Fixture("cli", time.Now().UTC())
	if e != nil {
		t.Fatal(e)
	}
	for id, b := range objects {
		if e = s.Install(id, bytes.NewReader(b)); e != nil {
			t.Fatal(e)
		}
	}
	id, e := s.Submit(j)
	if e != nil {
		t.Fatal(e)
	}
	revision, e := s.Commit(id)
	if e != nil {
		t.Fatal(e)
	}
	key, e := s.CursorKey()
	if e != nil || len(key) != 32 {
		t.Fatal(e)
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	ctx := context.Background()
	backup := filepath.Join(root, "backup")
	for _, args := range [][]string{{"backup", "--data", data, "--output", backup}, {"verify-backup", "--data", backup}, {"restore", "--data", backup, "--output", filepath.Join(root, "restored")}, {"rebuild", "--data", backup, "--output", filepath.Join(root, "rebuilt")}} {
		if e = run(ctx, args); e != nil {
			t.Fatalf("%v: %v", args, e)
		}
	}
	for _, name := range []string{"restored", "rebuilt"} {
		s, e = store.Open(filepath.Join(root, name), "test")
		if e != nil {
			t.Fatal(e)
		}
		if s.Current() != revision {
			t.Fatal("operational command changed active revision")
		}
		actual, e := s.CursorKey()
		if e != nil || !bytes.Equal(actual, key) {
			t.Fatal("lost persistent cursor key")
		}
		s.Close()
	}
	if e = run(ctx, []string{""}); e == nil {
		t.Fatal("empty command accepted")
	}
	if e = run(ctx, []string{"restore", "--data", backup}); e == nil {
		t.Fatal("missing destination accepted")
	}
}

func TestTrustedProxyFlagRejectsUnboundedOrMalformedTrust(t *testing.T) {
	for _, value := range []string{"0.0.0.0/0", "::/0", "example.com/32", "192.0.2.1/32,", "::ffff:192.0.2.1/128"} {
		if err := run(context.Background(), []string{"serve", "--trusted-proxies", value, "--data", t.TempDir() + "/data"}); err == nil {
			t.Fatal("invalid proxy trust accepted", value)
		}
	}
}
