package agent

import (
	"context"
	"fmt"
	"github.com/wasmbench/wasmbench/protocol"
	"path/filepath"
	"sync"
	"time"
)

// Retry metadata-only JVM startup, never preparation or a guest execution.
// Some Graal JVMs deadlock while initializing JVMCI with synchronous compilation.
// The compiler, command, actual measured PID, and workload deadline stay intact.
func StartIsolated(parent context.Context, command []string, logPath string, timeout time.Duration, policy ResourcePolicy) (*Client, error) {
	enabled := false
	for _, arg := range command {
		name := filepath.Base(arg)
		if name == "adapter-chicory.jar" || name == "adapter-chicory-jit.jar" || arg == "GraalWasmAdapter" || arg == "EndiveAdapter" {
			enabled = true
		}
	}
	if !enabled {
		return startIsolatedOnce(parent, command, logPath, timeout, policy)
	}
	return startWithStartupRetries(parent, command, logPath, timeout, policy, 3, 12*time.Second)
}

func startWithStartupRetries(parent context.Context, command []string, logPath string, timeout time.Duration, policy ResourcePolicy, attempts int, budget time.Duration) (*Client, error) {
	// One shared deadline includes every failed startup attempt.
	ctx, cancel := context.WithTimeout(parent, timeout)
	for attempt := 0; attempt < attempts; attempt++ {
		if err := ctx.Err(); err != nil {
			cancel()
			return nil, err
		}
		log := logPath
		if attempt > 0 {
			log = fmt.Sprintf("%s.startup-attempt-%d", logPath, attempt+1)
		}
		client, err := startIsolatedOnce(ctx, command, log, timeout, policy)
		if err != nil {
			cancel()
			return nil, err
		}
		var guard sync.Mutex
		timedOut := false
		timer := time.AfterFunc(budget, func() { guard.Lock(); defer guard.Unlock(); timedOut = true; client.cancel() })
		response, err := client.Call(protocol.Request{Method: "describe"})
		guard.Lock()
		timer.Stop()
		expired := timedOut
		guard.Unlock()
		if !expired && err == nil {
			// Replay metadata to the normal caller; avoid a second describe/extra setup.
			client.startupDescription = &response
			originalCancel := client.cancel
			client.cancel = func() { originalCancel(); cancel() }
			return client, nil
		}
		client.Close() // Reap the actual child and release its resource isolation.
		if !expired || ctx.Err() != nil {
			cancel()
			return nil, fmt.Errorf("adapter startup: %w", err)
		}
	}
	cancel()
	return nil, fmt.Errorf("adapter startup did not answer describe after %d bounded attempts", attempts)
}
