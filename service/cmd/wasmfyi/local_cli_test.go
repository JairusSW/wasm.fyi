package main

import (
	"context"
	"flag"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestLocalFlagOrder(t *testing.T) {
	fs := flag.NewFlagSet("test", flag.ContinueOnError)
	port := fs.Int("port", 8788, "")
	json := fs.Bool("json", false, "")
	if err := fs.Parse(localFlagOrder(fs, []string{"before", "--port", "1234", "after", "--json"})); err != nil {
		t.Fatal(err)
	}
	if *port != 1234 || !*json || !reflect.DeepEqual(fs.Args(), []string{"before", "after"}) {
		t.Fatal(*port, *json, fs.Args())
	}
}
func TestLocalCacheLeaseSerializesAcrossDatasets(t *testing.T) {
	cache := t.TempDir()
	release, err := localCacheLease(cache)
	if err != nil {
		t.Fatal(err)
	}
	if other, err := localCacheLease(cache); err == nil {
		other()
		release()
		t.Fatal("stole live cache lease")
	}
	release()
	again, err := localCacheLease(cache)
	if err != nil {
		t.Fatal(err)
	}
	again()
}
func TestLocalHelpDoesNotOpenDatabase(t *testing.T) {
	root := t.TempDir()
	data := filepath.Join(root, "must-not-exist")
	handled, err := localCLI(context.Background(), []string{"bench", "--data", data, "--help"})
	if err != nil || !handled {
		t.Fatal(handled, err)
	}
	if _, err = os.Stat(data); !os.IsNotExist(err) {
		t.Fatal("help created database", err)
	}
}
func TestLocalIdentityDoesNotAcceptRecycledPID(t *testing.T) {
	i := newLocalIdentity("test")
	if !localIdentityAlive(i) {
		t.Fatal("own identity was not live")
	}
	i.Start += "-different"
	if localIdentityAlive(i) {
		t.Fatal("accepted mismatched birth identity")
	}
	for _, id := range []string{"", "..", "a/b", "a;rm -rf"} {
		if localIdentifier(id) {
			t.Fatal("accepted unsafe run id", id)
		}
	}
}

func TestLocalDefaultsStayUnderHome(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	data, cache := localDefaults()
	if data != filepath.Join(home, ".wasmfyi", "data") || cache != filepath.Join(home, ".wasmfyi", "cache") {
		t.Fatal(data, cache)
	}
}
