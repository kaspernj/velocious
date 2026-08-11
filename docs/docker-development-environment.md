# Docker development environment

The checked-in root `Dockerfile` and `compose.yml` define one canonical `dev` service used by humans, CI, and agent systems alike. The image is Ubuntu 26.04 LTS (pinned by the approved digest) with Node.js 24.x from signed NodeSource (verified key checksum), the universal apt coding/debugging baseline, and the newest published provider CLIs installed from bare unversioned npm specs. It is source-independent — no project source is copied and no project dependencies are installed at image build time.

## Prerequisites and first-use setup

- Docker with the Compose v2 plugin.
- This repository checked out at `$DEV_HOME_PATH/velocious` (default `DEV_HOME_PATH`: `/home/dev`).
- Copy `.env.example` to the git-ignored `.env`, set `GH_CONFIG_SOURCE_PATH` to an existing host GitHub CLI config directory, and confirm Hermes' shared provider runtime exists:

```bash
cp .env.example .env
test -d /opt/hermes-dind-shared/auth/provider-runtime
```

`$DEV_HOME_PATH` must be a dedicated development home that already exists, holds no credentials or secrets, and is owned by (or at least writable by) UID/GID 1000 — the in-container `dev` user. Do not point it at a general host home directory, and do not recursively chown an existing home; the external environment owns safe initial provisioning.

## Normal usage

```bash
docker compose up --build --detach dev
docker compose exec dev bash
scripts/docker-run.sh npm ci   # one-off command in a disposable container
```

The dev service preserves the complete `$DEV_HOME_PATH` bind at `/home/dev`, so dependencies, caches, settings, and `node_modules` persist naturally across runs. Install dependencies with the normal package commands inside the service (for example `docker compose exec dev npm ci`), never at image build time. `scripts/docker-run.sh <command>` runs a one-off command in a disposable container.

## Concurrent isolated instances

Instance isolation uses the standard Compose project-name contract: `compose.yml` declares the top-level `name: velocious` default, and `COMPOSE_PROJECT_NAME` (or `-p`) plus a distinct development home per instance runs an isolated instance:

```bash
COMPOSE_PROJECT_NAME=velocious-review DEV_HOME_PATH=/srv/dev-homes/review \
  docker compose up --build --detach dev
```

## Credential boundary

GitHub CLI configuration mounts read-only at `/home/dev/.config/gh`. Provider authorization comes from the single external `/opt/hermes-dind-shared/auth/provider-runtime` bind; the UID/GID-1000 bootstrap links `/home/dev/.codex`, `/home/dev/.local/share/opencode`, `/home/dev/.opencode`, and `/home/dev/.kimi-code` to their matching directories below that root. It never copies credentials, changes host ownership, or uses root. Existing non-symlink paths fail closed so local state is not overwritten. Threadwire remains parent orchestration resolved through unversioned `npx` outside the container.

## Contract verification

After changing any Docker artifact, run the checked-in static contract verifier (including its negative probes) before committing:

```bash
npm run verify:docker-dev-environment
```
