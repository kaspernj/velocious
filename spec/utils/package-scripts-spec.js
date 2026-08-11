// @ts-check

import {execFile} from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"
import {promisify} from "node:util"
import {describe, expect, it} from "../../src/testing/test.js"

const execFileAsync = promisify(execFile)

/** @returns {string} - Repository directory. */
function repositoryDirectory() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
}

/**
 * @returns {Promise<Record<string, string>>} - Package scripts.
 */
async function readPackageScripts() {
  const packageJsonPath = path.join(repositoryDirectory(), "package.json")
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"))

  return packageJson.scripts
}

/**
 * @param {Record<string, string>} scripts - Script map.
 * @returns {void} - No return value.
 */
function expectNoPosixOnlyCommands(scripts) {
  expect(scripts.build.includes("rm -rf")).toEqual(false)
  expect(scripts.compile.includes("chmod +x build/bin/velocious.js")).toEqual(false)
  expect(scripts.test.includes("VELOCIOUS_TEST_DIR=$(pwd)/..")).toEqual(false)
}

describe("package scripts", {databaseCleaning: {transaction: true}}, () => {
  it("uses cross-platform scripts for build and test", async () => {
    const scripts = await readPackageScripts()

    expectNoPosixOnlyCommands(scripts)
    expect(scripts.build).toEqual("node scripts/clean-build.js && npm run compile")
    expect(scripts.compile).toEqual("tsc -b && npm run copy:js && npm run copy:ejs && npm run copy:templates && node scripts/ensure-bin-executable.js")
    expect(scripts.test).toEqual("node scripts/run-tests.js")
  })

  it("builds when dependencies change or the package is packed", async () => {
    const scripts = await readPackageScripts()

    expect(scripts.dependencies).toEqual("npm run build")
    expect(scripts.prepare).toEqual(undefined)
    expect(scripts.prepublishOnly).toEqual(undefined)
    expect(scripts.prepack).toEqual("npm run build")
  })

  it("emits a valid SQLite base driver declaration", {timeoutSeconds: 180}, async () => {
    const npmExecutable = process.env.npm_execpath

    if (!npmExecutable) throw new Error("Expected npm_execpath while running the declaration build spec")

    await execFileAsync(process.execPath, [npmExecutable, "run", "build"], {cwd: repositoryDirectory()})

    const declarationPath = path.join(repositoryDirectory(), "build", "src", "database", "drivers", "sqlite", "base.d.ts")
    const typescriptExecutable = path.join(repositoryDirectory(), "node_modules", "typescript", "bin", "tsc")

    await execFileAsync(process.execPath, [typescriptExecutable, "--ignoreConfig", "--noEmit", "--skipLibCheck", declarationPath])
  })

  it("builds the declared package entry points when installed from Git", {timeoutSeconds: 180}, async () => {
    const temporaryDirectoryParent = path.join(repositoryDirectory(), "tmp")

    await fs.mkdir(temporaryDirectoryParent, {recursive: true})

    const temporaryDirectory = await fs.mkdtemp(path.join(temporaryDirectoryParent, "git-install-spec-"))
    const sourceDirectory = path.join(temporaryDirectory, "source")
    const consumerDirectory = path.join(temporaryDirectory, "consumer")
    const npmExecutable = process.env.npm_execpath

    if (!npmExecutable) throw new Error("Expected npm_execpath while running the package lifecycle spec")

    try {
      await execFileAsync("git", ["clone", "--local", "--no-hardlinks", repositoryDirectory(), sourceDirectory])
      await fs.copyFile(path.join(repositoryDirectory(), "package.json"), path.join(sourceDirectory, "package.json"))
      await execFileAsync("git", [
        "-c", "user.name=Velocious test",
        "-c", "user.email=velocious@example.invalid",
        "commit", "--all", "--allow-empty", "--message=Use current package lifecycle"
      ], {cwd: sourceDirectory})
      await fs.mkdir(consumerDirectory)
      await fs.writeFile(path.join(consumerDirectory, "package.json"), JSON.stringify({
        allowScripts: {
          esbuild: true,
          sqlite3: true,
          velocious: true
        },
        dependencies: {
          velocious: `git+${pathToFileURL(sourceDirectory).href}`
        },
        name: "velocious-git-install-consumer",
        private: true,
        type: "module"
      }))
      await execFileAsync(process.execPath, [
        npmExecutable,
        "install",
        "--allow-git=all",
        "--allow-remote=all",
        "--no-audit",
        "--no-fund"
      ], {cwd: consumerDirectory})

      await fs.access(path.join(consumerDirectory, "node_modules", "velocious", "build", "index.js"))
      await fs.access(path.join(consumerDirectory, "node_modules", "velocious", "build", "index.d.ts"))
      await fs.access(path.join(consumerDirectory, "node_modules", "velocious", "build", "bin", "velocious.js"))
    } finally {
      await fs.rm(temporaryDirectory, {recursive: true, force: true})
    }
  })
})
