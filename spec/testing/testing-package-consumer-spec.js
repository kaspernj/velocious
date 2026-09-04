// @ts-check

import {execFile} from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import {promisify} from "node:util"

import {describe, expect, it} from "../../src/testing/test.js"
import repoRoot from "../helpers/repo-root.js"

const execFileAsync = promisify(execFile)

describe("@velocious/testing packed consumer", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("installs exactly one valid physical 0.0.9 package", async () => {
    const temporaryRoot = path.join(repoRoot(), "tmp")

    await fs.mkdir(temporaryRoot, {recursive: true})
    const consumerDirectory = await fs.mkdtemp(path.join(temporaryRoot, "testing-package-consumer-"))

    try {
      const packed = await execFileAsync("npm", [
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        consumerDirectory,
        repoRoot()
      ], {encoding: "utf8"})
      const packResult = JSON.parse(packed.stdout)
      const archivePath = path.join(consumerDirectory, packResult[0].filename)

      await fs.writeFile(path.join(consumerDirectory, "package.json"), JSON.stringify({
        name: "velocious-testing-consumer-fixture",
        private: true,
        dependencies: {velocious: `file:${archivePath}`}
      }, null, 2))
      await execFileAsync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
        cwd: consumerDirectory,
        encoding: "utf8"
      })
      const listed = await execFileAsync("npm", ["ls", "@velocious/testing", "--all", "--parseable"], {
        cwd: consumerDirectory,
        encoding: "utf8"
      })
      const physicalPaths = listed.stdout.trim().split("\n").filter((entry) => entry.includes("node_modules/@velocious/testing"))

      expect(physicalPaths).toHaveLength(1)
      const installedManifest = JSON.parse(await fs.readFile(path.join(physicalPaths[0], "package.json"), "utf8"))
      expect(installedManifest.version).toBe("0.0.9")
    } finally {
      await fs.rm(consumerDirectory, {force: true, recursive: true})
    }
  })
})
