package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strings"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/api"
	"github.com/JairusSW/wasm.fyi/service/internal/benchdb"
	"github.com/JairusSW/wasm.fyi/service/internal/frontend"
	"github.com/JairusSW/wasm.fyi/service/internal/wire"
)

func runCompact(ctx context.Context, action string, args []string) error {
	f := flag.NewFlagSet("wasmfyi "+action, flag.ContinueOnError)
	root := f.String("data", ".wasmfyi", "private benchmark database directory")
	addr := f.String("listen", "127.0.0.1:8090", "HTTP listen address")
	assets := f.String("frontend", "", "static frontend build")
	engine := f.String("engine", "", "engine to remove (remove-engine)")
	platform := f.String("platform", "", "obsolete platform to remove (remove-platform)")
	input := f.String("input", "", "compact capture JSON file (ingest)")
	readOnly := f.Bool("read-only", false, "disable publication")
	proxies := f.String("trusted-proxies", "", "comma-separated trusted proxy CIDRs")
	if e := f.Parse(args); e != nil {
		return e
	}
	if f.NArg() != 0 {
		return fmt.Errorf("unexpected arguments")
	}
	db, e := benchdb.Open(*root)
	if e != nil {
		return e
	}
	defer db.Close()
	if action == "remove-platform" {
		if *platform == "" {
			return fmt.Errorf("remove-platform requires --platform")
		}
		n, err := db.RemovePlatform(ctx, *platform)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]int{"removed": n})
	}
	if action == "remove-engine" {
		if *engine == "" {
			return fmt.Errorf("remove-engine requires --engine")
		}
		n, err := db.RemoveEngine(ctx, *engine)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]int{"removed": n})
	}
	if action == "ingest" {
		if *input == "" {
			return fmt.Errorf("ingest requires --input")
		}
		b, e := os.ReadFile(*input)
		if e != nil {
			return e
		}
		var capture benchdb.Capture
		if len(b) > wire.ResponseBytes {
			return fmt.Errorf("capture exceeds byte limit")
		}
		if e = wire.Decode(b, &capture); e != nil {
			return e
		}
		id, e := db.Put(ctx, capture)
		if e != nil {
			return e
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]string{"id": id})
	}
	token := os.Getenv("WASMFYI_ADMIN_TOKEN")
	if len(token) < 32 {
		return fmt.Errorf("WASMFYI_ADMIN_TOKEN must contain at least 32 characters")
	}
	host, _, e := net.SplitHostPort(*addr)
	if e != nil {
		return e
	}
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("serve on loopback behind a HTTPS proxy")
	}
	limits := api.DefaultRequestLimits()
	if *proxies != "" {
		if e = addCompactProxies(&limits, *proxies); e != nil {
			return e
		}
	}
	var static http.Handler
	if *assets != "" {
		h, e := frontend.Open(*assets, func(context.Context, string) (bool, error) { return false, nil })
		if e != nil {
			return e
		}
		defer h.Close()
		static = h
	}
	handler, e := api.NewBenchmarks(db, token, limits, static)
	if e != nil {
		return e
	}
	if *readOnly {
		handler = api.ReadOnlyBenchmarks(handler)
	}
	listener, e := net.Listen("tcp", *addr)
	if e != nil {
		return e
	}
	defer listener.Close()
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	shutdownDone := make(chan struct{})
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			stop, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			server.Shutdown(stop)
			close(shutdownDone)
		case <-done:
		}
	}()
	log.Printf("Benchmark database: %s; listening on %s", *root, *addr)
	e = server.Serve(listener)
	if e == http.ErrServerClosed {
		<-shutdownDone
		return nil
	}
	return e
}

func addCompactProxies(limits *api.RequestLimits, value string) error {
	for _, cidr := range strings.Split(value, ",") {
		p, e := netip.ParsePrefix(cidr)
		if e != nil || p.Bits() == 0 || p.Addr().Is4In6() {
			return fmt.Errorf("invalid proxy CIDR")
		}
		limits.TrustedProxies = append(limits.TrustedProxies, p.Masked())
	}
	if len(limits.TrustedProxies) > 64 {
		return fmt.Errorf("too many trusted proxies")
	}
	return nil
}
