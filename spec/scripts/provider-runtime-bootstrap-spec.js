// @ts-check

import {execFile, spawn} from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import {setImmediate as waitForImmediate} from "node:timers/promises"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"
import {describe, expect, it} from "../../src/testing/test.js"

const execFileAsync = promisify(execFile)
const repositoryDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const bootstrapPath = path.join(repositoryDirectory, "scripts", "bootstrap-provider-runtime.sh")

/**
 * @returns {Promise<{agentContext: string, directory: string, home: string, runtime: string}>} - Isolated bootstrap fixture.
 */
async function createFixture() {
  await fs.mkdir(path.join(repositoryDirectory, "tmp"), {recursive: true})

  const directory = await fs.mkdtemp(path.join(repositoryDirectory, "tmp", "provider-runtime-bootstrap-spec-"))
  const agentContext = path.join(directory, "agent-context")
  const home = path.join(directory, "home")
  const runtime = path.join(directory, "provider-runtime")

  await fs.mkdir(path.join(agentContext, "skills"), {recursive: true})
  await fs.mkdir(home)
  await fs.mkdir(path.join(runtime, ".local", "share"), {recursive: true})
  await fs.mkdir(path.join(runtime, "codex"))
  await fs.mkdir(path.join(runtime, "kimi-code", "credentials"), {recursive: true})
  await fs.mkdir(path.join(runtime, "opencode"))
  await fs.symlink("codex", path.join(runtime, ".codex"))
  await fs.symlink("kimi-code", path.join(runtime, ".kimi-code"))
  await fs.symlink("opencode", path.join(runtime, ".opencode"))
  await fs.symlink("../../opencode", path.join(runtime, ".local", "share", "opencode"))
  await fs.writeFile(path.join(agentContext, "AGENTS.md"), "qualified agent context\n")
  await fs.writeFile(path.join(runtime, "codex", "auth.json"), "codex auth\n")
  await fs.writeFile(path.join(runtime, "kimi-code", "credentials", "oauth.json"), "kimi auth\n")
  await fs.writeFile(path.join(runtime, "opencode", "auth.json"), "durable auth\n")

  return {agentContext, directory, home, runtime}
}

/**
 * @param {{agentContext: string, home: string, runtime: string}} fixture - Bootstrap paths.
 * @returns {Promise<{stderr: string, stdout: string}>} - Child output.
 */
async function runBootstrap({agentContext, home, runtime}) {
  return await execFileAsync("bash", [
    bootstrapPath,
    home,
    runtime,
    agentContext,
    "printf",
    "bootstrap-complete"
  ])
}

/**
 * @param {{agentContext: string, home: string, runtime: string}} fixture - Bootstrap paths.
 * @returns {{child: import("node:child_process").ChildProcessWithoutNullStreams, completion: Promise<{code: number | null, stderr: string, stdout: string}>}} - Running bootstrap.
 */
function startBootstrap({agentContext, home, runtime}) {
  const child = spawn("bash", [
    bootstrapPath,
    home,
    runtime,
    agentContext,
    "printf",
    "bootstrap-complete"
  ])
  let stderr = ""
  let stdout = ""

  child.stderr.on("data", (data) => {
    stderr += data
  })
  child.stdout.on("data", (data) => {
    stdout += data
  })

  const completion = new Promise((resolve, reject) => {
    child.on("error", reject)
    child.on("close", (code) => resolve({code, stderr, stdout}))
  })

  return {child, completion}
}

/**
 * @param {import("node:child_process").ChildProcessWithoutNullStreams} child - Bootstrap process.
 * @returns {Promise<void>} - Resolves when the process is waiting in flock.
 */
async function waitForFlockChild(child) {
  if (!child.pid) throw new Error("Bootstrap process has no PID")

  while (child.exitCode === null) {
    let childIds

    try {
      childIds = (await fs.readFile(`/proc/${child.pid}/task/${child.pid}/children`, "utf8"))
        .trim()
        .split(/\s+/u)
        .filter(Boolean)
    } catch (error) {
      if (error.code != "ENOENT" && error.code != "ESRCH") throw error

      break
    }

    for (const childId of childIds) {
      let command

      try {
        command = await fs.readFile(`/proc/${childId}/comm`, "utf8")
      } catch (error) {
        if (error.code != "ENOENT" && error.code != "ESRCH") throw error

        continue
      }

      if (command.trim() == "flock") return
    }

    await waitForImmediate()
  }

  throw new Error("Bootstrap exited before waiting for the provider lock")
}

describe("provider runtime bootstrap", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("preserves exact provider aliases and auth idempotently while keeping OpenCode lane state local", async () => {
    const fixture = await createFixture()

    try {
      const firstRun = await runBootstrap(fixture)
      const secondRun = await runBootstrap(fixture)

      expect(firstRun.stdout).toEqual("bootstrap-complete")
      expect(secondRun.stdout).toEqual("bootstrap-complete")

      for (const [alias, target] of [
        [".codex", "codex"],
        [".kimi-code", "kimi-code"],
        [".opencode", "opencode"],
        [".local/share/opencode", "../../opencode"]
      ]) {
        expect(await fs.readlink(path.join(fixture.runtime, alias))).toEqual(target)
      }

      for (const target of ["codex", "kimi-code", "opencode"]) {
        const stats = await fs.lstat(path.join(fixture.runtime, target))

        expect(stats.isDirectory()).toEqual(true)
        expect(stats.isSymbolicLink()).toEqual(false)
      }

      expect(await fs.readlink(path.join(fixture.home, ".codex"))).toEqual(path.join(fixture.runtime, ".codex"))
      expect(await fs.readlink(path.join(fixture.home, ".kimi-code"))).toEqual(path.join(fixture.runtime, ".kimi-code"))
      expect(await fs.readlink(path.join(fixture.home, ".opencode"))).toEqual(path.join(fixture.runtime, ".opencode"))
      expect(await fs.readFile(path.join(fixture.home, ".codex", "auth.json"), "utf8")).toEqual("codex auth\n")
      expect(await fs.readFile(path.join(fixture.home, ".kimi-code", "credentials", "oauth.json"), "utf8"))
        .toEqual("kimi auth\n")
      expect(await fs.readFile(path.join(fixture.home, ".opencode", "auth.json"), "utf8")).toEqual("durable auth\n")

      for (const relativeDirectory of [
        ".config/opencode",
        ".local/share/opencode",
        ".local/state/opencode",
        ".cache/opencode"
      ]) {
        const stats = await fs.lstat(path.join(fixture.home, relativeDirectory))

        expect(stats.isDirectory()).toEqual(true)
        expect(stats.isSymbolicLink()).toEqual(false)
      }

      expect(await fs.readlink(path.join(fixture.home, ".local/share/opencode/auth.json")))
        .toEqual(path.join(fixture.runtime, ".local/share/opencode/auth.json"))
      expect(await fs.readFile(path.join(fixture.home, ".local/share/opencode/auth.json"), "utf8"))
        .toEqual("durable auth\n")

      for (const providerHome of [
        path.join(fixture.runtime, "codex"),
        path.join(fixture.runtime, "kimi-code"),
        path.join(fixture.home, ".config/opencode")
      ]) {
        expect(await fs.readlink(path.join(providerHome, "AGENTS.md"))).toEqual(path.join(fixture.agentContext, "AGENTS.md"))
        expect(await fs.readlink(path.join(providerHome, "CLAUDE.md"))).toEqual(path.join(fixture.agentContext, "AGENTS.md"))
        expect(await fs.readlink(path.join(providerHome, "skills"))).toEqual(path.join(fixture.agentContext, "skills"))
      }

      expect((await fs.readdir(fixture.home)).includes(".provider-runtime-migration-backups")).toEqual(false)
    } finally {
      await fs.rm(fixture.directory, {recursive: true, force: true})
    }
  })

  it("preserves conflicting provider state in one timestamped migration backup before replacing it", async () => {
    const fixture = await createFixture()

    try {
      await fs.mkdir(path.join(fixture.home, ".kimi-code", "credentials"), {recursive: true})
      await fs.writeFile(path.join(fixture.home, ".kimi-code", "credentials", "existing-oauth"), "preserve me\n")
      await fs.writeFile(path.join(fixture.runtime, "codex", "AGENTS.md"), "old instructions\n")
      await fs.mkdir(path.join(fixture.home, ".local", "share", "opencode"), {recursive: true})
      await fs.writeFile(path.join(fixture.home, ".local", "share", "opencode", "auth.json"), "old auth\n")
      await fs.symlink("/wrong/opencode", path.join(fixture.home, ".opencode"))

      await runBootstrap(fixture)

      const backupRoot = path.join(fixture.home, ".provider-runtime-migration-backups")
      const backupDirectories = await fs.readdir(backupRoot)

      expect(backupDirectories.length).toEqual(1)
      expect(backupDirectories[0]).toMatch(/^\d{8}T\d{6}Z-[A-Za-z0-9]+$/u)

      const backupDirectory = path.join(backupRoot, backupDirectories[0])

      expect(await fs.readFile(path.join(backupDirectory, ".kimi-code", "credentials", "existing-oauth"), "utf8"))
        .toEqual("preserve me\n")
      expect(await fs.readlink(path.join(backupDirectory, ".opencode"))).toEqual("/wrong/opencode")
      expect(await fs.readFile(path.join(backupDirectory, ".local", "share", "opencode", "auth.json"), "utf8"))
        .toEqual("old auth\n")
      expect(await fs.readFile(path.join(backupDirectory, "provider-runtime", "codex", "AGENTS.md"), "utf8"))
        .toEqual("old instructions\n")
    } finally {
      await fs.rm(fixture.directory, {recursive: true, force: true})
    }
  })

  it("serializes shared provider-link migration across concurrent lane starts", async () => {
    const fixture = await createFixture()
    const secondHome = path.join(fixture.directory, "second-home")
    let firstBootstrap
    let secondBootstrap
    let lockHolder

    try {
      await fs.mkdir(secondHome)
      await fs.writeFile(path.join(fixture.runtime, "codex", "AGENTS.md"), "shared conflict\n")
      lockHolder = spawn("flock", ["--exclusive", fixture.runtime, "sh", "-c", "printf lock-held; cat >/dev/null"])
      const lockHeld = await new Promise((resolve, reject) => {
        lockHolder.on("error", reject)
        lockHolder.stdout.once("data", (data) => resolve(data.toString()))
      })

      expect(lockHeld).toEqual("lock-held")

      firstBootstrap = startBootstrap(fixture)
      secondBootstrap = startBootstrap({...fixture, home: secondHome})

      await Promise.all([
        waitForFlockChild(firstBootstrap.child),
        waitForFlockChild(secondBootstrap.child)
      ])
      expect(await fs.readdir(fixture.home)).toEqual([])
      expect(await fs.readdir(secondHome)).toEqual([])
      expect(await fs.readFile(path.join(fixture.runtime, "codex", "AGENTS.md"), "utf8"))
        .toEqual("shared conflict\n")
      lockHolder.stdin.end()

      const [firstResult, secondResult] = await Promise.all([
        firstBootstrap.completion,
        secondBootstrap.completion
      ])

      expect(firstResult.code).toEqual(0)
      expect(secondResult.code).toEqual(0)
      expect(firstResult.stdout).toEqual("bootstrap-complete")
      expect(secondResult.stdout).toEqual("bootstrap-complete")

      for (const [alias, target] of [
        [".codex", "codex"],
        [".kimi-code", "kimi-code"],
        [".opencode", "opencode"],
        [".local/share/opencode", "../../opencode"]
      ]) {
        expect(await fs.readlink(path.join(fixture.runtime, alias))).toEqual(target)
      }

      for (const providerHome of ["codex", "kimi-code"]) {
        expect(await fs.readlink(path.join(fixture.runtime, providerHome, "AGENTS.md")))
          .toEqual(path.join(fixture.agentContext, "AGENTS.md"))
        expect(await fs.readlink(path.join(fixture.runtime, providerHome, "CLAUDE.md")))
          .toEqual(path.join(fixture.agentContext, "AGENTS.md"))
        expect(await fs.readlink(path.join(fixture.runtime, providerHome, "skills")))
          .toEqual(path.join(fixture.agentContext, "skills"))
      }

      const backupHomes = []

      for (const home of [fixture.home, secondHome]) {
        try {
          await fs.access(path.join(home, ".provider-runtime-migration-backups"))
          backupHomes.push(home)
        } catch (error) {
          if (error.code != "ENOENT") throw error
        }
      }

      expect(backupHomes.length).toEqual(1)

      const backupRoot = path.join(backupHomes[0], ".provider-runtime-migration-backups")
      const backupDirectories = await fs.readdir(backupRoot)

      expect(backupDirectories.length).toEqual(1)
      expect(await fs.readFile(path.join(
        backupRoot,
        backupDirectories[0],
        "provider-runtime",
        "codex",
        "AGENTS.md"
      ), "utf8")).toEqual("shared conflict\n")

      for (const home of [fixture.home, secondHome]) {
        expect(await fs.readlink(path.join(home, ".codex"))).toEqual(path.join(fixture.runtime, ".codex"))
        expect(await fs.readlink(path.join(home, ".kimi-code"))).toEqual(path.join(fixture.runtime, ".kimi-code"))
        expect(await fs.readlink(path.join(home, ".opencode"))).toEqual(path.join(fixture.runtime, ".opencode"))
        expect(await fs.readlink(path.join(home, ".config", "opencode", "AGENTS.md")))
          .toEqual(path.join(fixture.agentContext, "AGENTS.md"))
        expect(await fs.readlink(path.join(home, ".config", "opencode", "CLAUDE.md")))
          .toEqual(path.join(fixture.agentContext, "AGENTS.md"))
        expect(await fs.readlink(path.join(home, ".config", "opencode", "skills")))
          .toEqual(path.join(fixture.agentContext, "skills"))
      }
    } finally {
      if (lockHolder) lockHolder.stdin.end()

      for (const bootstrap of [firstBootstrap, secondBootstrap]) {
        if (bootstrap && bootstrap.child.exitCode === null) bootstrap.child.kill()
      }

      await fs.rm(fixture.directory, {recursive: true, force: true})
    }
  })

  it("rejects a noncanonical provider runtime alias without migrating or replacing it", async () => {
    const fixture = await createFixture()
    const codexAlias = path.join(fixture.runtime, ".codex")

    try {
      await fs.unlink(codexAlias)
      await fs.symlink("wrong-codex", codexAlias)

      let failure

      try {
        await runBootstrap(fixture)
      } catch (error) {
        failure = error
      }

      expect(failure?.stderr).toContain("Provider runtime alias must be exact")
      expect(await fs.readlink(codexAlias)).toEqual("wrong-codex")
      expect((await fs.readdir(fixture.home)).includes(".provider-runtime-migration-backups")).toEqual(false)
    } finally {
      await fs.rm(fixture.directory, {recursive: true, force: true})
    }
  })

  it("rejects an exact-text runtime alias redirected through a symlinked parent without changing it", async () => {
    const fixture = await createFixture()
    const localPath = path.join(fixture.runtime, ".local")
    const outsideLocal = path.join(fixture.directory, "outside-local")

    try {
      await fs.rm(localPath, {recursive: true})
      await fs.mkdir(path.join(outsideLocal, "share"), {recursive: true})
      await fs.mkdir(path.join(fixture.directory, "opencode"))
      await fs.symlink("../../opencode", path.join(outsideLocal, "share", "opencode"))
      await fs.symlink("../outside-local", localPath)

      let failure

      try {
        await runBootstrap(fixture)
      } catch (error) {
        failure = error
      }

      expect(failure?.stderr).toContain("Provider runtime directory must be a real directory")
      expect(await fs.readlink(localPath)).toEqual("../outside-local")
      expect(await fs.readlink(path.join(localPath, "share", "opencode"))).toEqual("../../opencode")
      expect((await fs.readdir(fixture.home)).includes(".provider-runtime-migration-backups")).toEqual(false)
    } finally {
      await fs.rm(fixture.directory, {recursive: true, force: true})
    }
  })

  it("rejects a symlinked runtime parent even when its alias currently resolves to the expected target", async () => {
    const fixture = await createFixture()
    const localPath = path.join(fixture.runtime, ".local")
    const redirectedLocal = path.join(fixture.runtime, "redirected-local")

    try {
      await fs.rm(localPath, {recursive: true})
      await fs.mkdir(path.join(redirectedLocal, "share"), {recursive: true})
      await fs.symlink("../../opencode", path.join(redirectedLocal, "share", "opencode"))
      await fs.symlink("redirected-local", localPath)

      let failure

      try {
        await runBootstrap(fixture)
      } catch (error) {
        failure = error
      }

      expect(failure?.stderr).toContain("Provider runtime directory must be a real directory")
      expect(await fs.realpath(path.join(localPath, "share", "opencode"))).toEqual(path.join(fixture.runtime, "opencode"))
      expect(await fs.readlink(localPath)).toEqual("redirected-local")
      expect(await fs.readlink(path.join(localPath, "share", "opencode"))).toEqual("../../opencode")
      expect(await fs.readdir(fixture.home)).toEqual([])
    } finally {
      await fs.rm(fixture.directory, {recursive: true, force: true})
    }
  })

  it("fails clearly when a required lane-local parent is not writable", async () => {
    const fixture = await createFixture()
    const configDirectory = path.join(fixture.home, ".config")

    try {
      await fs.mkdir(configDirectory)
      await fs.chmod(configDirectory, 0o500)

      let failure

      try {
        await runBootstrap(fixture)
      } catch (error) {
        failure = error
      }

      expect(failure?.stderr).toContain("Required parent directory is not writable")
    } finally {
      await fs.chmod(configDirectory, 0o700)
      await fs.rm(fixture.directory, {recursive: true, force: true})
    }
  })
})
