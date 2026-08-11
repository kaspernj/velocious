#!/bin/sh
set -eu

runtime_root=/opt/hermes-dind-shared/auth/provider-runtime

fail() {
  printf '%s\n' "provider-runtime bootstrap: $1" >&2
  exit 1
}

[ "$(id -u)" = 1000 ] || fail "must run as UID 1000"
[ "$(id -g)" = 1000 ] || fail "must run as GID 1000"
[ "${HOME:-}" = /home/dev ] || fail "HOME must be /home/dev"
[ -d "$runtime_root" ] || fail "$runtime_root is not mounted"

link_runtime_home() {
  link_path=$1
  target_path=$2

  [ -d "$target_path" ] || fail "$target_path is missing from the shared runtime"
  mkdir -p "$(dirname "$link_path")"

  if [ -L "$link_path" ]; then
    [ "$(readlink "$link_path")" = "$target_path" ] || fail "$link_path points outside the shared runtime"
  elif [ -e "$link_path" ]; then
    fail "$link_path already exists and is not a symbolic link"
  else
    ln -s "$target_path" "$link_path"
  fi
}

link_runtime_home "$HOME/.codex" "$runtime_root/.codex"
link_runtime_home "$HOME/.local/share/opencode" "$runtime_root/.local/share/opencode"
link_runtime_home "$HOME/.opencode" "$runtime_root/.opencode"
link_runtime_home "$HOME/.kimi-code" "$runtime_root/.kimi-code"

[ "$#" -gt 0 ] || fail "no command supplied"
exec "$@"
