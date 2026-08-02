# Docker development environment

The checked-in root `Dockerfile` and `compose.yml` define one canonical `dev` service used by humans, CI, and agent systems alike. The image is Ubuntu 26.04 LTS (pinned by the approved digest) with Node.js 24.x from signed NodeSource (verified key checksum), the universal apt coding/debugging baseline, and the newest published provider CLIs installed from bare unversioned npm specs. It is source-independent — no project source is copied and no project dependencies are installed at image build time.

## Prerequisites and first-use setup

- Docker with the Compose v2 plugin.
- This repository checked out at `$DEV_HOME_PATH/velocious` (default `DEV_HOME_PATH`: `/home/dev`).
- Copy `.env.example` to the git-ignored `.env` and set `GH_CONFIG_SOURCE_PATH` to an existing host GitHub CLI config directory:

```bash
cp .env.example .env
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

GitHub CLI authentication is the sole authorized credential mount: the host config directory named by `GH_CONFIG_SOURCE_PATH` is mounted read-only at `/home/dev/.config/gh`, with container-side `GH_CONFIG_DIR` pointing there. Do not add SSH keys or other credential mounts to the tracked Compose files. Kimi (and other provider) credentials are intentionally kept out of the tracked Compose files — they are an external operational override layered on by the calling environment. Threadwire is not installed in the image or the project; it remains parent orchestration resolved through unversioned `npx` outside the container.

## Contract verification

After changing any Docker artifact, run the checked-in static contract verifier (including its negative probes) before committing:

```bash
npm run verify:docker-dev-environment
```
