# Remote deployment

The native production service runs on `root@remote`, at **https://wasm.fyi**.
Caddy owns ports 80 and 443, redirects HTTP to HTTPS, and manages the certificate.
The Go API serves the static frontend and benchmark database on `127.0.0.1:8090`.

## Redeploy

After preparing `build/`, run:

```sh
just deploy
```

The script uploads a new release and compiles the API on Remote under the same
host lock used by benchmark builders and measurements. It then switches
`/opt/wasmfyi/current` and restarts the services so the frontend asset map matches
the new build. It does not replace the database or run benchmarks. Earlier
releases remain in `/opt/wasmfyi/releases`.

`just deploy` uses the existing `build/` directory and leaves local benchmark
work paused. After frontend changes, prepare a fresh build with `just build`
when this device is free. An alternate SSH destination can be supplied as
`just deploy root@another-host`. The original Pages command is now
`just deploy-pages`.

## CI/CD

`deploy-remote.yml` automatically deploys pushes to `main`. It checks and tests
the frontend, tests the Go service and activation command, and builds both
production artifacts on GitHub. Deployments are serialized. Pages is now a
manual preview workflow.

The GitHub `production` environment permits only `main` and holds
`REMOTE_HOST`, `REMOTE_USER`, `REMOTE_DEPLOY_KEY`, and `REMOTE_KNOWN_HOSTS`.
The SSH host key is pinned. The dedicated `wasmfyi-deploy` account uploads into
`/var/lib/wasmfyi-deploy/incoming`; its only sudo command is the root-owned
`/usr/local/sbin/wasmfyi-activate`, which accepts one full Git commit SHA.

Activation copies the static API and frontend into a root-owned release, switches
`current`, and restarts the API. An unhealthy release automatically restores the
previous release. The database, Caddy configuration and certificate state stay
on Remote. The publisher runs from `/usr/local/lib/wasmfyi`, independently of
CI-uploaded releases. CI activation performs no compilation on Remote.

```sh
just deploy-ci       # Manually deploy committed main through the same workflow
just deploy-status   # Show recent production runs
```

A static Linux amd64 API binary built under another host's benchmark lock can
also be staged as `wasmfyi` in the release. The installer then performs no
compilation on Remote and configures services on CPUs 0–1. The initial deployment
used this path while Remote was building WasmEdge.

Caddy is installed from its official stable package repository using the
[official installation instructions](https://caddyserver.com/docs/install#debian-ubuntu-raspbian).

## Services and data

- `wasmfyi.service`: API/frontend, with the database at `/var/lib/wasmfyi`.
- `caddy.service`: HTTPS proxy, configured in `/etc/caddy/Caddyfile`.
- `wasmfyi-publisher.service`: imports completed Remote captures and polls Hub
  using a persistent SSH connection. It also publishes compact feature captures
  when available. Compatibility trial logs remain private.
- `/etc/wasmfyi/environment`: private publisher token; mode 0600.
- `/var/lib/wasmfyi-publisher`: publication receipts and Hub capture mirror.

All three services start at boot. They use CPUs 0–1; benchmark measurement uses
CPU 2, and builds use CPUs 3–4. Apple's paused benchmark and import workers stay
paused. Its previously published measurements are included in the Remote dataset.

```sh
ssh root@remote systemctl status wasmfyi caddy wasmfyi-publisher
ssh root@remote journalctl -u wasmfyi -u caddy -u wasmfyi-publisher --since '10 minutes ago'
curl https://wasm.fyi/healthz
curl https://wasm.fyi/api/platforms
```

Keep offline database copies consistent by stopping `wasmfyi.service` before
copying `/var/lib/wasmfyi`; restart it afterwards. Never copy an active Pebble
directory as a backup. Retain `/var/lib/caddy` to preserve certificate state.
