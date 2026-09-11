// @ts-check

import {execFile} from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import {promisify} from "node:util"

import {describe, expect, it} from "../../src/testing/test.js"
import repoRoot from "../helpers/repo-root.js"

const execFileAsync = promisify(execFile)

describe("@velocious/testing packed consumer", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("installs offline with exactly one valid physical 0.0.12 package", {timeoutMs: 120_000}, async () => {
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
      const archiveSpecifier = `file:./${packResult[0].filename}`
      const packageManifest = JSON.parse(await fs.readFile(path.join(repoRoot(), "package.json"), "utf8"))
      const packageLock = JSON.parse(await fs.readFile(path.join(repoRoot(), "package-lock.json"), "utf8"))
      const consumerDependencies = {
        "@velocious/testing": packageManifest.devDependencies["@velocious/testing"],
        "smtp-connection": packageLock.packages["node_modules/smtp-connection"].version,
        velocious: archiveSpecifier
      }

      await fs.writeFile(path.join(consumerDirectory, "package.json"), JSON.stringify({
        name: "velocious-testing-consumer-fixture",
        private: true,
        dependencies: consumerDependencies
      }, null, 2))
      await fs.writeFile(path.join(consumerDirectory, "package-lock.json"), JSON.stringify({
        name: "velocious-testing-consumer-fixture",
        lockfileVersion: packageLock.lockfileVersion,
        requires: true,
        packages: {
          ...packageLock.packages,
          "": {
            name: "velocious-testing-consumer-fixture",
            dependencies: consumerDependencies
          },
          "node_modules/velocious": {
            version: packageManifest.version,
            resolved: archiveSpecifier,
            integrity: packResult[0].integrity,
            license: packageManifest.license,
            dependencies: packageManifest.dependencies,
            bin: packageManifest.bin,
            peerDependencies: packageManifest.peerDependencies,
            peerDependenciesMeta: packageManifest.peerDependenciesMeta
          }
        }
      }, null, 2))
      await execFileAsync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--offline"], {
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
      expect(installedManifest.version).toBe("0.0.12")
    } finally {
      await fs.rm(consumerDirectory, {force: true, recursive: true})
    }
  })
})
