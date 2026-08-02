#!/usr/bin/env bash
# Execute project commands inside the Compose dev container.
# The repository must be checked out at $DEV_HOME_PATH/velocious on the
# host (default DEV_HOME_PATH: /home/dev) so the dev service's /home/dev bind
# mount covers it.
set -euo pipefail

if (($# == 0)); then
  printf 'Usage: %s <command> [arguments...]\n' "$0" >&2
  exit 2
fi

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
# Callers select an instance via the standard Compose project-name contract:
# compose.yml declares the default top-level `name: velocious`, and
# COMPOSE_PROJECT_NAME (or `-p`) overrides it for isolated instances.
compose=(docker compose -f "$repo_dir/compose.yml" --project-directory "$repo_dir")

cd "$repo_dir"
exec "${compose[@]}" run --build --rm -T dev "$@"
