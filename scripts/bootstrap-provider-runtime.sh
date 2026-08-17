#!/usr/bin/env bash
# Bootstrap durable provider homes and immutable agent-context discovery links.
set -euo pipefail

fail() {
  printf 'Provider runtime bootstrap failed: %s\n' "$1" >&2
  exit 1
}

if (($# < 4)); then
  fail "usage: $0 <home> <provider-runtime> <agent-context> <command> [args...]"
fi

dev_home=$1
provider_runtime=$2
agent_context=$3
shift 3

for required_path in "$dev_home" "$provider_runtime" "$agent_context"; do
  if [[ $required_path != /* ]]; then
    fail "Required path must be absolute: $required_path"
  fi

  if [[ ! -d $required_path ]]; then
    fail "Required directory does not exist: $required_path"
  fi
done

if [[ ! -w $dev_home ]]; then
  fail "Development home is not writable: $dev_home"
fi

if [[ ! -w $provider_runtime ]]; then
  fail "Provider runtime is not writable: $provider_runtime"
fi

if [[ ! -f $agent_context/AGENTS.md || ! -d $agent_context/skills ]]; then
  fail "Agent context must contain AGENTS.md and skills/: $agent_context"
fi

umask 077
backup_directory=

ensure_writable_parent() {
  local parent_path=$1

  if [[ -L $parent_path ]]; then
    fail "Required parent directory must be lane-local, not a symlink: $parent_path"
  fi

  if [[ -e $parent_path && ! -d $parent_path ]]; then
    fail "Required parent path is not a directory: $parent_path"
  fi

  if [[ ! -d $parent_path ]] && ! mkdir -p -- "$parent_path"; then
    fail "Could not create required parent directory; verify ownership: $parent_path"
  fi

  if [[ ! -w $parent_path ]]; then
    fail "Required parent directory is not writable; verify ownership: $parent_path"
  fi
}

backup_relative_path() {
  local target_path=$1

  case $target_path in
    "$dev_home"/*)
      printf '%s\n' "${target_path#"$dev_home"/}"
      ;;
    "$provider_runtime"/*)
      printf '%s\n' "provider-runtime/${target_path#"$provider_runtime"/}"
      ;;
    *)
      fail "Refusing to migrate a path outside the development home or provider runtime: $target_path"
      ;;
  esac
}

preserve_conflict() {
  local target_path=$1
  local relative_path
  local backup_path

  if [[ -z $backup_directory ]]; then
    ensure_writable_parent "$dev_home/.provider-runtime-migration-backups"

    if ! backup_directory=$(mktemp -d "$dev_home/.provider-runtime-migration-backups/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX"); then
      fail "Could not create a timestamped migration backup under $dev_home/.provider-runtime-migration-backups"
    fi
  fi

  relative_path=$(backup_relative_path "$target_path")
  backup_path="$backup_directory/$relative_path"

  if [[ -e $backup_path || -L $backup_path ]]; then
    fail "Migration backup target already exists: $backup_path"
  fi

  if ! mkdir -p -- "$(dirname -- "$backup_path")"; then
    fail "Could not create migration backup parent: $(dirname -- "$backup_path")"
  fi

  if ! mv -- "$target_path" "$backup_path"; then
    fail "Could not preserve conflicting path at $backup_path: $target_path"
  fi

  printf 'Provider runtime bootstrap preserved %s at %s\n' "$target_path" "$backup_path" >&2
}

ensure_real_directory() {
  local directory_path=$1

  ensure_writable_parent "$(dirname -- "$directory_path")"

  if [[ -L $directory_path || (-e $directory_path && ! -d $directory_path) ]]; then
    preserve_conflict "$directory_path"
  fi

  if [[ ! -d $directory_path ]] && ! mkdir -- "$directory_path"; then
    fail "Could not create required directory: $directory_path"
  fi

  if [[ ! -w $directory_path ]]; then
    fail "Required directory is not writable; verify ownership: $directory_path"
  fi
}

ensure_exact_link() {
  local target_path=$1
  local source_path=$2

  ensure_writable_parent "$(dirname -- "$target_path")"

  if [[ -L $target_path ]] && [[ $(readlink -- "$target_path") == "$source_path" ]]; then
    return
  fi

  if [[ -e $target_path || -L $target_path ]]; then
    preserve_conflict "$target_path"
  fi

  if ! ln -s -- "$source_path" "$target_path"; then
    fail "Could not create required symlink: $target_path -> $source_path"
  fi
}

require_real_runtime_directory() {
  local directory_path=$1

  if [[ -L $directory_path || ! -d $directory_path ]]; then
    fail "Provider runtime directory must be a real directory: $directory_path"
  fi
}

require_exact_runtime_alias() {
  local alias_path=$1
  local expected_link=$2
  local resolved_directory=$3
  local resolved_alias_path
  local resolved_directory_path

  if [[ ! -L $alias_path ]] || [[ $(readlink -- "$alias_path") != "$expected_link" ]]; then
    fail "Provider runtime alias must be exact: $alias_path -> $expected_link"
  fi

  if [[ -L $resolved_directory || ! -d $resolved_directory ]]; then
    fail "Provider runtime alias target must be an existing real directory: $resolved_directory"
  fi

  if ! resolved_alias_path=$(realpath -e -- "$alias_path"); then
    fail "Provider runtime alias does not resolve: $alias_path"
  fi

  if ! resolved_directory_path=$(realpath -e -- "$resolved_directory"); then
    fail "Provider runtime alias target does not resolve: $resolved_directory"
  fi

  if [[ $resolved_alias_path != "$resolved_directory_path" ]]; then
    fail "Provider runtime alias must resolve to $resolved_directory: $alias_path"
  fi

  if [[ ! -w $resolved_directory ]]; then
    fail "Provider runtime alias target is not writable; verify ownership: $resolved_directory"
  fi
}

validate_runtime_aliases() {
  require_real_runtime_directory "$provider_runtime/.local"
  require_real_runtime_directory "$provider_runtime/.local/share"
  require_exact_runtime_alias "$provider_runtime/.codex" "codex" "$provider_runtime/codex"
  require_exact_runtime_alias "$provider_runtime/.kimi-code" "kimi-code" "$provider_runtime/kimi-code"
  require_exact_runtime_alias "$provider_runtime/.opencode" "opencode" "$provider_runtime/opencode"
  require_exact_runtime_alias "$provider_runtime/.local/share/opencode" "../../opencode" "$provider_runtime/opencode"
}

validate_runtime_aliases

if ! exec {provider_lock_fd}<"$provider_runtime"; then
  fail "Could not open the provider runtime for shared-link locking: $provider_runtime"
fi

if ! flock --exclusive "$provider_lock_fd"; then
  fail "Could not lock shared provider links: $provider_runtime"
fi

validate_runtime_aliases

for provider_home in \
  "$provider_runtime/codex" \
  "$provider_runtime/kimi-code"; do
  ensure_exact_link "$provider_home/AGENTS.md" "$agent_context/AGENTS.md"
  ensure_exact_link "$provider_home/CLAUDE.md" "$agent_context/AGENTS.md"
  ensure_exact_link "$provider_home/skills" "$agent_context/skills"
done

if ! flock --unlock "$provider_lock_fd"; then
  fail "Could not unlock shared provider links: $provider_runtime"
fi

exec {provider_lock_fd}<&-

for lane_parent in \
  "$dev_home/.config" \
  "$dev_home/.local" \
  "$dev_home/.local/share" \
  "$dev_home/.local/state" \
  "$dev_home/.cache"; do
  ensure_writable_parent "$lane_parent"
done

for lane_directory in \
  "$dev_home/.config/opencode" \
  "$dev_home/.local/share/opencode" \
  "$dev_home/.local/state/opencode" \
  "$dev_home/.cache/opencode"; do
  ensure_real_directory "$lane_directory"
done

ensure_exact_link "$dev_home/.codex" "$provider_runtime/.codex"
ensure_exact_link "$dev_home/.kimi-code" "$provider_runtime/.kimi-code"
ensure_exact_link "$dev_home/.opencode" "$provider_runtime/.opencode"
ensure_exact_link "$dev_home/.local/share/opencode/auth.json" "$provider_runtime/.local/share/opencode/auth.json"

ensure_exact_link "$dev_home/.config/opencode/AGENTS.md" "$agent_context/AGENTS.md"
ensure_exact_link "$dev_home/.config/opencode/CLAUDE.md" "$agent_context/AGENTS.md"
ensure_exact_link "$dev_home/.config/opencode/skills" "$agent_context/skills"

exec "$@"
