#!/usr/bin/env node
/**
 * Static contract verifier for the canonical Docker development environment.
 *
 * Dependency-free: checks the tracked Dockerfile, compose.yml, .env.example,
 * .dockerignore, .gitignore, and development bootstrap scripts against the
 * canonical development-environment contract, then runs negative probes
 * derived from the real files to prove the checks actually catch regressions
 * (for example a standalone project `npm install` or a `COPY` of project
 * source).
 */

import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const APPROVED_BASE_DIGEST = "sha256:3131b4cc82a783df6c9df078f86e01819a13594b865c2cad47bd1bca2b7063bb"
const PROVIDER_PACKAGES = ["@moonshot-ai/kimi-code", "@openai/codex", "@anthropic-ai/claude-code", "opencode-ai"]
const COMPOSE_CREDENTIAL_VALUE_PATTERN = /^\s+[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)[A-Z0-9_]*:\s*\S.*$/mu

// The complete universal apt coding/debugging baseline shared with the
// current awesome_tasks canonical image.
const BASELINE_APT_PACKAGES = [
  "bash",
  "ca-certificates",
  "curl",
  "wget",
  "git",
  "git-lfs",
  "gh",
  "openssh-client",
  "gnupg",
  "jq",
  "ripgrep",
  "fd-find",
  "fzf",
  "less",
  "file",
  "tree",
  "bat",
  "nano",
  "vim-tiny",
  "unzip",
  "zip",
  "xz-utils",
  "bzip2",
  "tar",
  "gzip",
  "rsync",
  "patch",
  "diffutils",
  "gawk",
  "findutils",
  "coreutils",
  "procps",
  "psmisc",
  "lsof",
  "iproute2",
  "iputils-ping",
  "dnsutils",
  "netcat-openbsd",
  "socat",
  "util-linux",
  "tini",
  "python3",
  "python3-venv",
  "python3-pip",
  "sqlite3",
  "shellcheck",
  "tmux",
  "zsh",
  "man-db",
  "build-essential",
  "pkg-config",
  "libssl-dev"
]

/**
 * Escapes a string for use inside a regular expression.
 *
 * @param {string} value - The literal to escape.
 * @returns {string} - The escaped literal.
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Checks whether an apt package name appears as a whole token.
 *
 * @param {string} content - The Dockerfile content.
 * @param {string} packageName - The apt package name.
 * @returns {boolean} - True when the package name is present.
 */
function containsAptPackage(content, packageName) {
  const pattern = new RegExp(`(?<![\\w+.-])${escapeRegExp(packageName)}(?![\\w+.-])`, "u")

  return pattern.test(content)
}

/**
 * Joins backslash line continuations so per-instruction checks see each
 * logical Dockerfile instruction as a single line.
 *
 * @param {string} content - The Dockerfile content.
 * @returns {string[]} - The logical lines.
 */
function dockerfileLogicalLines(content) {
  return content.replace(/\\\r?\n[ \t]*/g, " ").split("\n")
}

/**
 * Verifies canonical artifact names at the repository root.
 *
 * @param {string[]} entries - Root directory entries.
 * @returns {string[]} - The problems found.
 */
function verifyRootEntries(entries) {
  const problems = []

  for (const required of ["Dockerfile", "compose.yml", ".env.example", ".dockerignore"]) {
    if (!entries.includes(required)) {
      problems.push(`Missing required canonical artifact: ${required}`)
    }
  }

  const allowedDockerNames = new Set(["Dockerfile", "compose.yml", ".dockerignore"])

  for (const entry of entries) {
    if (/dockerfile|compose/iu.test(entry) && !allowedDockerNames.has(entry)) {
      problems.push(`Forbidden Dockerfile/Compose variant basename: ${entry}`)
    }
  }

  return problems
}

/**
 * Verifies the source-independent canonical Dockerfile.
 *
 * @param {string} content - The Dockerfile content.
 * @returns {string[]} - The problems found.
 */
function verifyDockerfile(content) {
  const problems = []

  if (!content.includes(`FROM ubuntu:26.04@${APPROVED_BASE_DIGEST}`)) {
    problems.push(`Dockerfile must be based on ubuntu:26.04 pinned by the approved digest ${APPROVED_BASE_DIGEST}`)
  }

  if (/^COPY\s/imu.test(content)) {
    problems.push("Dockerfile must be source-independent: COPY instructions are forbidden")
  }

  for (const match of content.matchAll(/^ADD\s+(\S+)/gmu)) {
    if (!match[1].startsWith("https://registry.npmjs.org/")) {
      problems.push(`Dockerfile must be source-independent: ADD source is not remote registry metadata: ${match[1]}`)
    }
  }

  for (const providerPackage of PROVIDER_PACKAGES) {
    if (!content.includes(`https://registry.npmjs.org/${providerPackage}/latest`)) {
      problems.push(`Missing remote latest-metadata cache key for provider package: ${providerPackage}`)
    }
  }

  if (/npm\s+ci/iu.test(content)) {
    problems.push("Dockerfile must not install project dependencies: npm ci is forbidden")
  }

  for (const line of dockerfileLogicalLines(content)) {
    if (/npm\s+install/iu.test(line) && !line.includes("--global")) {
      problems.push(`Dockerfile must not install project dependencies: npm install without --global: ${line.trim()}`)
    }
  }

  for (const providerPackage of PROVIDER_PACKAGES) {
    if (!content.includes(`"${providerPackage}"`)) {
      problems.push(`Missing bare unversioned provider CLI install spec: ${providerPackage}`)
    }

    if (content.includes(`${providerPackage}@`)) {
      problems.push(`Provider CLI install spec must stay bare and unversioned: ${providerPackage}`)
    }
  }

  if (/^ARG\s+\w*(KIMI|CODEX|CLAUDE|OPENCODE|PROVIDER)\w*/imu.test(content)) {
    problems.push("Provider version ARGs/pins are forbidden in the Dockerfile")
  }

  if (!content.includes("--strict-allow-scripts")) {
    problems.push("Missing --strict-allow-scripts lifecycle-script allowlisting")
  }

  if (!content.includes("--allow-scripts")) {
    problems.push("Missing --allow-scripts lifecycle-script allowlisting")
  }

  for (const probe of ["kimi --version", "codex --version", "claude --version", "opencode --version"]) {
    if (!content.includes(probe)) {
      problems.push(`Missing provider CLI command probe: ${probe}`)
    }
  }

  if (!content.includes("deb.nodesource.com/gpgkey/nodesource-repo.gpg.key")) {
    problems.push("Missing signed NodeSource gpg key download")
  }

  if (!/NODESOURCE_KEY_SHA256=[0-9a-f]{64}/u.test(content)) {
    problems.push("Missing pinned NodeSource key checksum (NODESOURCE_KEY_SHA256)")
  }

  if (!/sha256sum\s+--check/u.test(content)) {
    problems.push("Missing sha256sum verification of the NodeSource key")
  }

  if (!content.includes("node_24.x")) {
    problems.push("Missing NodeSource Node.js 24.x repository")
  }

  for (const aptPackage of BASELINE_APT_PACKAGES) {
    if (!containsAptPackage(content, aptPackage)) {
      problems.push(`Missing baseline apt package: ${aptPackage}`)
    }
  }

  if (/threadwire/iu.test(content)) {
    problems.push("Threadwire must not be installed in the image: it stays parent orchestration")
  }

  if (!/usermod\s+--login\s+dev/u.test(content)) {
    problems.push("Dockerfile must rename Ubuntu's existing UID/GID 1000 identity to dev")
  }

  if (!/^USER\s+dev\s*$/mu.test(content)) {
    problems.push("Dockerfile must run as USER dev (UID/GID 1000)")
  }

  if (!/^ENV\s+HOME=\/home\/dev\s*$/mu.test(content)) {
    problems.push("Dockerfile must set ENV HOME=/home/dev")
  }

  if (!/^WORKDIR\s+\/home\/dev\/velocious\s*$/mu.test(content)) {
    problems.push("Dockerfile must set WORKDIR /home/dev/velocious")
  }

  if (/chown/iu.test(content)) {
    problems.push("Dockerfile must not contain source ownership fixups (chown)")
  }

  return problems
}

/**
 * Extracts the service names declared under the top-level services key.
 *
 * @param {string} content - The compose.yml content.
 * @returns {string[] | null} - The service names, or null when no services key exists.
 */
function composeServiceNames(content) {
  const lines = content.split("\n")
  const servicesIndex = lines.findIndex((line) => /^services:\s*$/u.test(line))

  if (servicesIndex == -1) return null

  const names = []

  for (let i = servicesIndex + 1; i < lines.length; i++) {
    const line = lines[i]

    if (/^\S/u.test(line)) break

    const match = line.match(/^ {2}([^\s:]+):\s*$/u)

    if (match) names.push(match[1])
  }

  return names
}

/**
 * Extracts normalized volume entries from the first service-level volumes
 * block.
 *
 * @param {string} content - The compose.yml content.
 * @returns {string[]} - The volume entries.
 */
function composeServiceVolumes(content) {
  const lines = content.split("\n")
  const volumes = []
  let volumesIndent = null
  /** @type {string[] | null} */
  let currentVolume = null

  for (const line of lines) {
    if (volumesIndent === null) {
      const volumesMatch = line.match(/^(\s+)volumes:\s*$/u)

      if (volumesMatch) volumesIndent = volumesMatch[1].length

      continue
    }

    const entryMatch = line.match(/^(\s+)-\s+(.+?)\s*$/u)

    if (entryMatch && entryMatch[1].length == volumesIndent + 2) {
      if (currentVolume) volumes.push(currentVolume.join("\n"))

      currentVolume = [`- ${entryMatch[2]}`]
      continue
    }

    if (line.trim() == "" || line.trimStart().startsWith("#")) continue

    const indentation = line.match(/^\s*/u)?.[0].length || 0

    if (currentVolume && indentation > volumesIndent + 2) {
      currentVolume.push(line.trim())
      continue
    }

    break
  }

  if (currentVolume) volumes.push(currentVolume.join("\n"))

  return volumes
}

/**
 * Verifies the canonical compose.yml.
 *
 * @param {string} content - The compose.yml content.
 * @returns {string[]} - The problems found.
 */
function verifyCompose(content) {
  const problems = []

  if (!/^name:\s*velocious\s*$/mu.test(content)) {
    problems.push("compose.yml must declare the standard Compose project name: velocious")
  }

  const serviceNames = composeServiceNames(content)

  if (!serviceNames || serviceNames.length != 1 || serviceNames[0] != "dev") {
    problems.push(`compose.yml must declare exactly one dev service (found: ${serviceNames ? serviceNames.join(", ") : "none"})`)
  }

  if (COMPOSE_CREDENTIAL_VALUE_PATTERN.test(content)) {
    problems.push(`compose.yml must not contain credential values (matched: ${content.match(COMPOSE_CREDENTIAL_VALUE_PATTERN)?.[0].trim()})`)
  }

  if (!/^\s+init:\s*true\s*$/mu.test(content)) {
    problems.push("The dev service must set init: true")
  }

  if (!/^\s+user:\s*"?1000:1000"?\s*$/mu.test(content)) {
    problems.push("The dev service must run as user 1000:1000")
  }

  if (!/^\s+working_dir:\s*\/home\/dev\/velocious\s*$/mu.test(content)) {
    problems.push("The dev service must set working_dir /home/dev/velocious")
  }

  for (const envLine of [
    "GH_CONFIG_DIR: /home/dev/.config/gh",
    "HOME: /home/dev",
    "KIMI_CODE_HOME: /home/dev/.kimi-code",
    "NODE_ENV: development",
    "THREADWIRE_CODEX_BIN: /usr/local/bin/codex",
    "THREADWIRE_KIMI_BIN: /usr/local/bin/kimi",
    "THREADWIRE_OPENCODE_BIN: /usr/local/bin/opencode"
  ]) {
    if (!content.includes(envLine)) {
      problems.push(`The dev service is missing environment entry: ${envLine}`)
    }
  }

  const expectedVolumes = [
    "- type: bind\nsource: ${DEV_HOME_PATH:-/home/dev}\ntarget: /home/dev\nbind:\ncreate_host_path: false",
    "- type: bind\nsource: ${AI_PROVIDER_RUNTIME_SOURCE_PATH:?Set AI_PROVIDER_RUNTIME_SOURCE_PATH in .env}\ntarget: /opt/hermes-dind-shared/auth/provider-runtime\nbind:\ncreate_host_path: false",
    "- type: bind\nsource: ${AGENT_CONTEXT_SOURCE_PATH:?Set AGENT_CONTEXT_SOURCE_PATH in .env}\ntarget: /opt/hermes-agent-context\nread_only: true\nbind:\ncreate_host_path: false",
    "- type: bind\nsource: ${GH_CONFIG_SOURCE_PATH:?Set GH_CONFIG_SOURCE_PATH in .env}\ntarget: /home/dev/.config/gh\nread_only: true\nbind:\ncreate_host_path: false"
  ]
  const actualVolumes = composeServiceVolumes(content)

  if (actualVolumes.length != expectedVolumes.length || !expectedVolumes.every((volume) => actualVolumes.includes(volume))) {
    problems.push(`The dev service must mount exactly the development home, provider runtime, immutable agent context, and read-only GH config binds (found: ${actualVolumes.join(" | ") || "none"})`)
  }

  const expectedEntrypoint = "    entrypoint: [\"/home/dev/velocious/scripts/bootstrap-provider-runtime.sh\", \"/home/dev\", \"/opt/hermes-dind-shared/auth/provider-runtime\", \"/opt/hermes-agent-context\"]"

  if (!content.includes(expectedEntrypoint)) {
    problems.push("The dev service must use the provider runtime bootstrap as its entrypoint so Compose command overrides remain bootstrapped")
  }

  if (!/^\s+command:\s*(\[\s*"sleep",\s*"infinity"\s*\]|sleep\s+infinity)\s*$/mu.test(content)) {
    problems.push("The dev service must run sleep infinity by default")
  }

  if (/\.npmrc|NPM_CONFIG_USERCONFIG/iu.test(content)) {
    problems.push("The normal dev service must not mount or configure npm credentials")
  }

  if (/container_name:/u.test(content)) {
    problems.push("The dev service must not declare a fixed container_name")
  }

  if (/^\s+ports:\s*$/mu.test(content)) {
    problems.push("The dev service must not publish fixed host ports")
  }

  if (/^volumes:\s*$/mu.test(content)) {
    problems.push("compose.yml must not declare top-level named volumes")
  }

  return problems
}

/**
 * Verifies the portable .env.example.
 *
 * @param {string} content - The .env.example content.
 * @returns {string[]} - The problems found.
 */
function verifyEnvExample(content) {
  const problems = []

  if (!content.includes("GH_CONFIG_SOURCE_PATH")) {
    problems.push(".env.example must document GH_CONFIG_SOURCE_PATH")
  }

  if (!content.includes("AI_PROVIDER_RUNTIME_SOURCE_PATH")) {
    problems.push(".env.example must document AI_PROVIDER_RUNTIME_SOURCE_PATH")
  }

  if (!content.includes("AGENT_CONTEXT_SOURCE_PATH")) {
    problems.push(".env.example must document AGENT_CONTEXT_SOURCE_PATH")
  }

  if (!content.includes("DEV_HOME_PATH")) {
    problems.push(".env.example must document DEV_HOME_PATH")
  }

  return problems
}

/**
 * Verifies the .dockerignore exclusions.
 *
 * @param {string} content - The .dockerignore content.
 * @returns {string[]} - The problems found.
 */
function verifyDockerignore(content) {
  const problems = []

  for (const required of [".git", ".env", "!.env.example", "node_modules", "build", "coverage", "tmp", "log"]) {
    if (!content.split("\n").some((line) => line.trim() == required || line.trim() == `**/${required}`)) {
      problems.push(`.dockerignore must exclude ${required}`)
    }
  }

  return problems
}

/**
 * Verifies that the root .env is gitignored.
 *
 * @param {string} content - The .gitignore content.
 * @returns {string[]} - The problems found.
 */
function verifyGitignore(content) {
  if (!/^\/?\.env\s*$/mu.test(content)) {
    return [".gitignore must ignore the root .env file"]
  }

  return []
}

/**
 * Verifies the canonical scripts/docker-run.sh helper.
 *
 * @param {string} content - The docker-run.sh content.
 * @returns {string[]} - The problems found.
 */
function verifyDockerRunSh(content) {
  const problems = []

  for (const required of ["DEV_HOME_PATH", "velocious", "compose.yml", "--project-directory", "--rm"]) {
    if (!content.includes(required)) {
      problems.push(`scripts/docker-run.sh must reference ${required}`)
    }
  }

  if (!/compose[^\n]*\brun\b/iu.test(content)) {
    problems.push("scripts/docker-run.sh must execute commands through docker compose run")
  }

  return problems
}

/**
 * Verifies that the provider bootstrap preserves the canonical runtime aliases.
 *
 * @param {string} content - The bootstrap script content.
 * @returns {string[]} - The problems found.
 */
function verifyProviderBootstrap(content) {
  const problems = []
  const firstAliasValidation = content.indexOf('require_exact_runtime_alias "$provider_runtime/.codex"')

  for (const requiredParent of [
    'require_real_runtime_directory "$provider_runtime/.local"',
    'require_real_runtime_directory "$provider_runtime/.local/share"'
  ]) {
    const parentValidation = content.indexOf(requiredParent)

    if (parentValidation == -1 || firstAliasValidation == -1 || parentValidation > firstAliasValidation) {
      problems.push(`scripts/bootstrap-provider-runtime.sh must validate the real runtime parent before aliases: ${requiredParent}`)
    }
  }

  for (const requiredAlias of [
    'require_exact_runtime_alias "$provider_runtime/.codex" "codex" "$provider_runtime/codex"',
    'require_exact_runtime_alias "$provider_runtime/.kimi-code" "kimi-code" "$provider_runtime/kimi-code"',
    'require_exact_runtime_alias "$provider_runtime/.opencode" "opencode" "$provider_runtime/opencode"',
    'require_exact_runtime_alias "$provider_runtime/.local/share/opencode" "../../opencode" "$provider_runtime/opencode"'
  ]) {
    if (!content.includes(requiredAlias)) {
      problems.push(`scripts/bootstrap-provider-runtime.sh must validate canonical provider runtime alias: ${requiredAlias}`)
    }
  }

  for (const resolutionCheck of [
    'resolved_alias_path=$(realpath -e -- "$alias_path")',
    'resolved_directory_path=$(realpath -e -- "$resolved_directory")',
    'if [[ $resolved_alias_path != "$resolved_directory_path" ]]; then'
  ]) {
    if (!content.includes(resolutionCheck)) {
      problems.push(`scripts/bootstrap-provider-runtime.sh must verify canonical provider runtime aliases resolve to their target: ${resolutionCheck}`)
    }
  }

  return problems
}

/**
 * Builds negative probes derived from the real files. Each probe mutates the
 * real content with a regression and must be caught by the matching verifier.
 *
 * @param {{dockerfile: string, compose: string, providerBootstrap: string}} contents - The real file contents.
 * @returns {{name: string, problems: string[], expected: string}[]} - The probes.
 */
function negativeProbes(contents) {
  return [
    {
      name: "Dockerfile COPY project source regression",
      problems: verifyDockerfile(`${contents.dockerfile}\nCOPY package.json ./\n`),
      expected: "COPY"
    },
    {
      name: "Dockerfile standalone project npm ci regression",
      problems: verifyDockerfile(`${contents.dockerfile}\nRUN npm ci\n`),
      expected: "npm ci"
    },
    {
      name: "Dockerfile multiline project npm install regression",
      problems: verifyDockerfile(`${contents.dockerfile}\nRUN npm \\\n  install left-pad\n`),
      expected: "npm install"
    },
    {
      name: "Dockerfile unapproved base digest regression",
      problems: verifyDockerfile(contents.dockerfile.replaceAll(APPROVED_BASE_DIGEST, `sha256:${"0".repeat(64)}`)),
      expected: "digest"
    },
    {
      name: "compose fixed container_name regression",
      problems: verifyCompose(contents.compose.replace("    init: true", "    container_name: velocious-dev\n    init: true")),
      expected: "container_name"
    },
    {
      name: "compose credential mount regression",
      problems: verifyCompose(contents.compose.replace("    entrypoint:", "      - type: bind\n        source: $" + "{HOME}/.kimi\n        target: /home/dev/.kimi\n    entrypoint:")),
      expected: "mount exactly"
    },
    {
      name: "compose credential value regression",
      problems: verifyCompose(contents.compose.replace("      HOME: /home/dev", "      HOME: /home/dev\n      KIMI_API_KEY: secret")),
      expected: "credential values"
    },
    {
      name: "compose stale provider runtime target regression",
      problems: verifyCompose(contents.compose.replace("target: /opt/hermes-dind-shared/auth/provider-runtime", "target: /run/ai-provider-runtime")),
      expected: "mount exactly"
    },
    {
      name: "compose mutable agent context source regression",
      problems: verifyCompose(contents.compose.replace("${AGENT_CONTEXT_SOURCE_PATH:?Set AGENT_CONTEXT_SOURCE_PATH in .env}", "/opt/hermes-dind-shared/agent-context/current")),
      expected: "mount exactly"
    },
    {
      name: "compose stale agent context target regression",
      problems: verifyCompose(contents.compose.replaceAll("/opt/hermes-agent-context", "/opt/agent-context")),
      expected: "mount exactly"
    },
    {
      name: "compose npm credential mount regression",
      problems: verifyCompose(contents.compose.replace("    entrypoint:", "      - type: bind\n        source: $" + "{HOME}/.npmrc\n        target: /home/dev/.npmrc\n        read_only: true\n    entrypoint:")),
      expected: "npm credentials"
    },
    {
      name: "compose bootstrap entrypoint regression",
      problems: verifyCompose(contents.compose.replace("    entrypoint:", "    x-entrypoint:")),
      expected: "command overrides"
    },
    {
      name: "compose second service regression",
      problems: verifyCompose(`${contents.compose}\n  worker:\n    image: ubuntu\n`),
      expected: "dev"
    },
    {
      name: "provider runtime alias regression",
      problems: verifyProviderBootstrap(contents.providerBootstrap.replace(
        'require_exact_runtime_alias "$provider_runtime/.local/share/opencode" "../../opencode" "$provider_runtime/opencode"',
        'require_exact_runtime_alias "$provider_runtime/.local/share/opencode" "opencode" "$provider_runtime/opencode"'
      )),
      expected: "canonical provider runtime alias"
    },
    {
      name: "provider runtime alias resolution regression",
      problems: verifyProviderBootstrap(contents.providerBootstrap.replace(
        'resolved_alias_path=$(realpath -e -- "$alias_path")',
        'resolved_alias_path=$(realpath -e -- "$resolved_directory")'
      )),
      expected: "resolve to their target"
    },
    {
      name: "provider runtime real parent regression",
      problems: verifyProviderBootstrap(contents.providerBootstrap.replace(
        'require_real_runtime_directory "$provider_runtime/.local/share"',
        'require_real_runtime_directory "$provider_runtime/.local-share"'
      )),
      expected: "real runtime parent"
    }
  ]
}

/**
 * Runs the full repository verification.
 *
 * @returns {number} - The process exit code.
 */
function main() {
  const problems = []

  problems.push(...verifyRootEntries(fs.readdirSync(repoRoot)))

  const dockerfilePath = path.join(repoRoot, "Dockerfile")
  const composePath = path.join(repoRoot, "compose.yml")
  const dockerfile = fs.existsSync(dockerfilePath) ? fs.readFileSync(dockerfilePath, "utf8") : null
  const compose = fs.existsSync(composePath) ? fs.readFileSync(composePath, "utf8") : null

  if (dockerfile !== null) problems.push(...verifyDockerfile(dockerfile))
  if (compose !== null) problems.push(...verifyCompose(compose))

  for (const [relativePath, verify] of [
    [".env.example", verifyEnvExample],
    [".dockerignore", verifyDockerignore],
    [".gitignore", verifyGitignore],
    [path.join("scripts", "docker-run.sh"), verifyDockerRunSh]
  ]) {
    const absolutePath = path.join(repoRoot, relativePath)

    if (!fs.existsSync(absolutePath)) {
      problems.push(`Missing required file: ${relativePath}`)
      continue
    }

    problems.push(...verify(fs.readFileSync(absolutePath, "utf8")))
  }

  const dockerRunPath = path.join(repoRoot, "scripts", "docker-run.sh")
  const providerBootstrapPath = path.join(repoRoot, "scripts", "bootstrap-provider-runtime.sh")
  const providerBootstrap = fs.existsSync(providerBootstrapPath) ? fs.readFileSync(providerBootstrapPath, "utf8") : null

  if (providerBootstrap === null) {
    problems.push("Missing required file: scripts/bootstrap-provider-runtime.sh")
  } else {
    problems.push(...verifyProviderBootstrap(providerBootstrap))
  }

  if (process.platform != "win32") {
    for (const executablePath of [dockerRunPath, providerBootstrapPath]) {
      if (!fs.existsSync(executablePath)) continue

      const mode = fs.statSync(executablePath).mode

      if ((mode & 0o111) == 0) {
        problems.push(`${path.relative(repoRoot, executablePath)} must be executable`)
      }
    }
  }

  if (dockerfile !== null && compose !== null && providerBootstrap !== null) {
    for (const probe of negativeProbes({dockerfile, compose, providerBootstrap})) {
      if (!probe.problems.some((problem) => problem.toLowerCase().includes(probe.expected.toLowerCase()))) {
        problems.push(`Negative probe was not caught by the verifier: ${probe.name}`)
      }
    }
  }

  if (problems.length > 0) {
    console.error("Docker development environment verification failed:")

    for (const problem of problems) {
      console.error(`- ${problem}`)
    }

    return 1
  }

  console.log("Docker development environment verification passed (contract checks and negative probes).")

  return 0
}

process.exitCode = main()
