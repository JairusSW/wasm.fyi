package main

import (
	"crypto/rand"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/api"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
)

func run() error {
	root := flag.String("data", ".wasmfyi", "Pebble and local content directory")
	addr := flag.String("listen", "127.0.0.1:8090", "HTTP listen address")
	publisher := flag.String("publisher", "local-coordinator", "authenticated publisher identity")
	flag.Parse()
	token := os.Getenv("WASMFYI_ADMIN_TOKEN")
	if len(token) < 32 {
		return fmt.Errorf("WASMFYI_ADMIN_TOKEN must contain at least 32 characters")
	}
	s, e := store.Open(*root, *publisher)
	if e != nil {
		return e
	}
	defer s.Close()
	path := filepath.Join(*root, "cursor.key")
	key, e := os.ReadFile(path)
	if os.IsNotExist(e) {
		key = make([]byte, 32)
		if _, e = rand.Read(key); e != nil {
			return e
		}
		f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return e
		}
		if _, e = f.Write(key); e != nil {
			f.Close()
			return e
		}
		if e = f.Sync(); e != nil {
			f.Close()
			return e
		}
		if e = f.Close(); e != nil {
			return e
		}
	} else if e != nil {
		return e
	}
	handler, e := api.New(s, token, key)
	if e != nil {
		return e
	}
	server := &http.Server{Addr: *addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
	log.Printf("wasm.fyi API listening on %s", *addr)
	return server.ListenAndServe()
}
func main() {
	if e := run(); e != nil {
		log.Fatal(e)
	}
}
