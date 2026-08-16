# Docker development environment

The checked-in root `Dockerfile` and `compose.yml` define one canonical `dev` service used by humans, CI, and agent systems alike. The image is Ubuntu 26.04 LTS (pinned by the approved digest) with Node.js 24.x from signed NodeSource (verified key checksum), the universal apt coding/debugging baseline, and the newest published provider CLIs installed from bare unversioned npm specs. It is source-independent — no project source is copied and no project dependencies are installed at image build time.

## Prerequisites and first-use setup

- Docker with the Compose v2 plugin.
- This repository checked out at `$DEV_HOME_PATH/velocious` (default `DEV_HOME_PATH`: `/home/dev`).
- A dedicated writable provider runtime outside the development home.
- One exact immutable agent-context bundle directory outside the development home. Do not use a `current` symlink, `/opt/data`, or a broad shared parent.
- Copy `.env.example` to the git-ignored `.env`; set `GH_CONFIG_SOURCE_PATH`, `AI_PROVIDER_RUNTIME_SOURCE_PATH`, and the exact `AGENT_CONTEXT_SOURCE_PATH` bundle:

```bash
cp .env.example .env
```

`$DEV_HOME_PATH` must be a dedicated development home that already exists, holds no credentials or secrets, and is owned by (or at least writable by) UID/GID 1000 — the in-container `dev` user. Do not point it at a general host home directory, and do not recursively chown an existing home; the external environment owns safe initial provisioning.

Before starting Compose, export the values from `.env` and run this read-only source-path preflight. All paths must already exist; Compose uses `create_host_path: false` and will not create them:

```bash
set -euo pipefail
set -a
. ./.env
set +a

dev_home_source=$(realpath -e -- "${DEV_HOME_PATH:-/home/dev}")
provider_runtime_source=$(realpath -e -- "$AI_PROVIDER_RUNTIME_SOURCE_PATH")
agent_context_source=$(realpath -e -- "$AGENT_CONTEXT_SOURCE_PATH")
github_config_source=$(realpath -e -- "$GH_CONFIG_SOURCE_PATH")

test -d "$dev_home_source/velocious" && test -w "$dev_home_source"
test -d "$provider_runtime_source" && test -w "$provider_runtime_source"
for provider_home in codex kimi-code opencode; do
  test -d "$provider_runtime_source/$provider_home"
  test ! -L "$provider_runtime_source/$provider_home"
  test -w "$provider_runtime_source/$provider_home"
done
for runtime_parent in .local .local/share; do
  test -d "$provider_runtime_source/$runtime_parent"
  test ! -L "$provider_runtime_source/$runtime_parent"
done
test "$(readlink -- "$provider_runtime_source/.codex")" = codex
test "$(readlink -- "$provider_runtime_source/.kimi-code")" = kimi-code
test "$(readlink -- "$provider_runtime_source/.opencode")" = opencode
test "$(readlink -- "$provider_runtime_source/.local/share/opencode")" = ../../opencode
test "$(realpath -e -- "$provider_runtime_source/.codex")" = "$provider_runtime_source/codex"
test "$(realpath -e -- "$provider_runtime_source/.kimi-code")" = "$provider_runtime_source/kimi-code"
test "$(realpath -e -- "$provider_runtime_source/.opencode")" = "$provider_runtime_source/opencode"
test "$(realpath -e -- "$provider_runtime_source/.local/share/opencode")" = "$provider_runtime_source/opencode"
test -d "$github_config_source"
test ! -L "$AGENT_CONTEXT_SOURCE_PATH"
test -f "$agent_context_source/AGENTS.md" && test -d "$agent_context_source/skills"
test "$(basename -- "$AGENT_CONTEXT_SOURCE_PATH")" != current

case "$provider_runtime_source/" in "$dev_home_source/"*) exit 1;; esac
case "$dev_home_source/" in "$provider_runtime_source/"*) exit 1;; esac
case "$agent_context_source/" in "$dev_home_source/"*) exit 1;; esac
case "$dev_home_source/" in "$agent_context_source/"*) exit 1;; esac
case "$agent_context_source/" in "$provider_runtime_source/"*) exit 1;; esac
case "$provider_runtime_source/" in "$agent_context_source/"*) exit 1;; esac
case "$agent_context_source" in /opt/data|/opt/hermes-dind-shared|/opt/hermes-dind-shared/agent-context) exit 1;; esac

stat -c '%u:%g %A %n' "$dev_home_source" "$provider_runtime_source" "$agent_context_source" "$github_config_source"
```

The final `stat` output must show that UID/GID 1000 can write the development home and provider runtime. Fix ownership in the external provisioner; never recursively chown an existing home or broaden permissions from this repository.

## Normal usage

```bash
docker compose up --build --detach dev
docker compose exec dev bash
scripts/docker-run.sh npm ci   # one-off command in a disposable container
```

The dev service preserves the complete `$DEV_HOME_PATH` bind at `/home/dev`, so dependencies, lane-local caches, settings, and `node_modules` persist naturally across runs. Install dependencies with the normal package commands inside the service (for example `docker compose exec dev npm ci`), never at image build time. `scripts/docker-run.sh <command>` runs a one-off command in a disposable container and uses the same bootstrap.

At every container start, `scripts/bootstrap-provider-runtime.sh` establishes the following idempotent contract:

- The provider runtime already contains real writable `codex`, `kimi-code`, and `opencode` directories, real non-symlink `.local` and `.local/share` parents, plus the exact relative aliases `.codex -> codex`, `.kimi-code -> kimi-code`, `.opencode -> opencode`, and `.local/share/opencode -> ../../opencode`. The bootstrap validates these paths without creating, migrating, or replacing them.
- `~/.codex`, `~/.kimi-code`, and `~/.opencode` point to the matching directories under `/opt/hermes-dind-shared/auth/provider-runtime`. The complete writable Kimi home is shared so atomic OAuth refreshes can replace files inside `credentials/`.
- `~/.config/opencode`, `~/.local/share/opencode`, `~/.local/state/opencode`, and `~/.cache/opencode` are real lane-local writable directories. Only `~/.local/share/opencode/auth.json` points into the shared provider runtime.
- `AGENTS.md` and `CLAUDE.md` in the Codex home, Kimi home, and lane-local OpenCode config point to `/opt/hermes-agent-context/AGENTS.md`; their `skills` links point to `/opt/hermes-agent-context/skills`.

Already-correct links are unchanged. Shared Codex/Kimi discovery-link validation and migration are serialized by locking the provider-runtime directory itself; the lock creates no runtime file and is released before lane-local setup. A wrong symlink, file, or directory at a managed lane-home target or provider discovery-link target is moved intact under `~/.provider-runtime-migration-backups/<timestamp>-<unique-suffix>/` before replacement. Canonical provider-runtime aliases and their resolved directories are validation-only: a mismatch fails clearly and remains untouched. The bootstrap never deletes, chowns, or broadens permissions. It fails with the affected path when a required parent is not writable or cannot safely remain lane-local.

## Concurrent isolated instances

Instance isolation uses the standard Compose project-name contract: `compose.yml` declares the top-level `name: velocious` default, and `COMPOSE_PROJECT_NAME` (or `-p`) plus a distinct development home per instance runs an isolated instance:

```bash
COMPOSE_PROJECT_NAME=velocious-review DEV_HOME_PATH=/srv/dev-homes/review \
  docker compose up --build --detach dev
```

## Runtime and credential boundaries

The provider runtime is mounted read/write at the same stable absolute path `/opt/hermes-dind-shared/auth/provider-runtime`. The exact agent-context bundle is mounted read-only at `/opt/hermes-agent-context`. Their resolved source paths must not contain one another, or the context would remain writable through the runtime bind. Both use long-form bind syntax with `bind.create_host_path: false`, so Compose cannot create missing host paths. GitHub CLI config remains read-only at `/home/dev/.config/gh`, with `GH_CONFIG_DIR` pointing there. The normal dev service must not mount npm credentials, SSH keys, `/opt/data`, mutable `current`, broad shared roots, or any additional credential path.

Threadwire is not installed in the image or project; it remains parent orchestration resolved through unversioned `npx` outside the container. `THREADWIRE_CODEX_BIN`, `THREADWIRE_KIMI_BIN`, and `THREADWIRE_OPENCODE_BIN` explicitly select the provider CLIs installed at `/usr/local/bin`, avoiding host-only fallback adapters. `KIMI_CODE_HOME=/home/dev/.kimi-code` selects the durable Kimi home.

## Contract verification

After changing any Docker artifact, run the checked-in static contract verifier (including its negative probes) before committing:

```bash
npm run verify:docker-dev-environment
```

Render the resolved Compose contract without starting or recreating containers:

```bash
docker compose config
```

The rendered `dev` service must contain only the four documented binds, must keep GitHub and agent context read-only, and must contain no `.npmrc`/npm credential mount.
