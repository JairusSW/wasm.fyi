package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/JairusSW/wasm.fyi/service/internal/api"
	"github.com/JairusSW/wasm.fyi/service/internal/frontend"
	"github.com/JairusSW/wasm.fyi/service/internal/store"
)

func run(ctx context.Context, args []string) error {
	action := "serve"
	if len(args) > 0 && args[0] == "" {
		return fmt.Errorf("empty command")
	}
	if len(args) > 0 && args[0][0] != '-' {
		action = args[0]
		args = args[1:]
	}
	flags := flag.NewFlagSet("wasmfyi "+action, flag.ContinueOnError)
	root := flags.String("data", ".wasmfyi", "private Pebble and content directory")
	addr := flags.String("listen", "127.0.0.1:8090", "HTTP listen address")
	frontendDirectory := flags.String("frontend", "", "optional fixed static build directory with 404.html application shell")
	publisher := flags.String("publisher", "local-coordinator", "authenticated publisher identity")
	output := flags.String("output", "", "new backup/restore/rebuild destination")
	apply := flags.Bool("apply", false, "apply orphan quarantine/cleanup; gc defaults to preview")
	controlSocket := flags.String("control-socket", "", "optional local maintenance socket in a private directory (serve)")
	control := flags.String("control", "", "live owner's local maintenance socket (backup/gc)")
	limits := store.DefaultLimits()
	flags.IntVar(&limits.PendingJobs, "max-pending-jobs", limits.PendingJobs, "maximum staged imports")
	flags.Int64Var(&limits.PendingBytes, "max-pending-bytes", limits.PendingBytes, "maximum declared bytes across staged imports")
	flags.Int64Var(&limits.ContentBytes, "max-content-bytes", limits.ContentBytes, "maximum bytes in content storage")
	requestLimits := api.DefaultRequestLimits()
	flags.Float64Var(&requestLimits.PublicRate, "public-requests-per-second", requestLimits.PublicRate, "request rate per transport peer")
	flags.IntVar(&requestLimits.PublicBurst, "public-request-burst", requestLimits.PublicBurst, "public request burst per transport peer")
	flags.Float64Var(&requestLimits.PublisherRate, "publisher-requests-per-second", requestLimits.PublisherRate, "authenticated publication rate per transport peer")
	flags.IntVar(&requestLimits.PublisherBurst, "publisher-request-burst", requestLimits.PublisherBurst, "publication request burst per transport peer")
	flags.IntVar(&requestLimits.Clients, "max-request-clients", requestLimits.Clients, "maximum tracked peer/budget pairs")
	trustedProxies := flags.String("trusted-proxies", "", "comma-separated proxy CIDRs allowed to set one X-Real-IP for public rate budgets")
	cert := flags.String("tls-cert", "", "TLS certificate for direct non-loopback serving")
	key := flags.String("tls-key", "", "TLS key for direct non-loopback serving")
	if e := flags.Parse(args); e != nil {
		return e
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments")
	}
	if *trustedProxies != "" {
		for _, cidr := range strings.Split(*trustedProxies, ",") {
			prefix, err := netip.ParsePrefix(cidr)
			if err != nil || prefix.Bits() == 0 || prefix.Addr().Is4In6() {
				return fmt.Errorf("invalid trusted proxy CIDR %q", cidr)
			}
			requestLimits.TrustedProxies = append(requestLimits.TrustedProxies, prefix.Masked())
		}
		if len(requestLimits.TrustedProxies) > 64 {
			return fmt.Errorf("too many trusted proxy CIDRs")
		}
	}
	if *control != "" {
		return callControl(ctx, *control, action, *output, *apply, os.Stdout)
	}
	if *controlSocket != "" && action != "serve" {
		return fmt.Errorf("--control-socket is only valid for serve")
	}
	switch action {
	case "verify-backup":
		manifest, e := store.VerifyBackup(ctx, *root)
		if e != nil {
			return e
		}
		return json.NewEncoder(os.Stdout).Encode(manifest)
	case "restore", "rebuild":
		if *output == "" {
			return fmt.Errorf("%s requires --output", action)
		}
		if action == "restore" {
			return store.Restore(ctx, *root, *output, *publisher)
		}
		return store.Rebuild(*root, *output, *publisher)
	case "serve", "backup", "gc":
	default:
		return fmt.Errorf("unknown command %q; use serve, backup, verify-backup, restore, rebuild or gc", action)
	}
	if action == "backup" && *output == "" {
		return fmt.Errorf("backup requires --output")
	}
	// One process owns the database. CLI backups are offline; attempts to open a
	// live owner's data fail on Pebble's lock rather than bypassing that owner.
	s, e := store.OpenWithLimits(*root, *publisher, limits)
	if e != nil {
		return e
	}
	defer s.Close()
	if action == "gc" {
		report, e := s.GC(ctx, store.GCOptions{Apply: *apply, Grace: 24 * time.Hour, QuarantineGrace: 7 * 24 * time.Hour})
		if e != nil {
			return e
		}
		return json.NewEncoder(os.Stdout).Encode(report)
	}
	if action == "backup" {
		manifest, e := s.Backup(ctx, *output)
		if e != nil {
			return e
		}
		return json.NewEncoder(os.Stdout).Encode(manifest)
	}
	token := os.Getenv("WASMFYI_ADMIN_TOKEN")
	if len(token) < 32 {
		return fmt.Errorf("WASMFYI_ADMIN_TOKEN must contain at least 32 characters")
	}
	if (*cert == "") != (*key == "") {
		return fmt.Errorf("provide both --tls-cert and --tls-key")
	}
	host, _, e := net.SplitHostPort(*addr)
	if e != nil {
		return e
	}
	ip := net.ParseIP(host)
	if *cert == "" && host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("direct non-loopback serving requires TLS; use loopback behind a trusted HTTPS proxy")
	}
	cursorKey, e := s.CursorKey()
	if e != nil {
		return e
	}
	var static http.Handler
	if *frontendDirectory != "" {
		host, e := frontend.Open(*frontendDirectory, func(ctx context.Context, workload string) (bool, error) {
			if s.Current() == "" {
				return false, nil
			}
			return s.HasMeasuredWorkload(ctx, "", workload)
		})
		if e != nil {
			return e
		}
		defer host.Close()
		static = host
	}
	handler, e := api.NewWithFrontend(s, token, cursorKey, requestLimits, static)
	if e != nil {
		return e
	}
	listener, e := net.Listen("tcp", *addr)
	if e != nil {
		return e
	}
	defer listener.Close()
	if *controlSocket != "" {
		controlServer, err := startControl(ctx, *controlSocket, s)
		if err != nil {
			return err
		}
		defer controlServer.Close()
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024, BaseContext: func(net.Listener) context.Context { return ctx }}
	done := make(chan error, 1)
	go func() {
		if *cert != "" {
			done <- server.ServeTLS(listener, *cert, *key)
		} else {
			done <- server.Serve(listener)
		}
	}()
	log.Printf("wasm.fyi API listening on %s", listener.Addr())
	select {
	case e := <-done:
		if errors.Is(e, http.ErrServerClosed) {
			return nil
		}
		return e
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if e = server.Shutdown(shutdown); e != nil {
			_ = server.Close()
		}
		serveError := <-done
		if serveError != nil && !errors.Is(serveError, http.ErrServerClosed) {
			return serveError
		}
		return e
	}
}
func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if e := run(ctx, os.Args[1:]); e != nil {
		log.Fatal(e)
	}
}
