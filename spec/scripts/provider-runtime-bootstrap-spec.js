// @ts-check

import {execFile} from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
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
