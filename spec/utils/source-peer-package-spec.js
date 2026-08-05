// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  SOURCE_PEER_SHIM_MARKER_FILE,
  prepareSourcePeerPackage
} from "../../scripts/source-peer-package.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @param {string} filePath - File or directory path.
 * @returns {Promise<boolean>} - Whether the path exists.
 */
async function pathExists(filePath) {
  try {
    await fs.access(filePath)

    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false

    throw error
  }
}

/** @returns {Promise<string>} - Temporary source checkout root. */
async function createProjectDirectory() {
  const projectDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-source-peer-package-"))

  await fs.mkdir(path.join(projectDirectory, "node_modules"))
  await fs.mkdir(path.join(projectDirectory, "src"))

  return projectDirectory
}

describe("source peer package shim", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("maps build/src to checkout source and removes its owned shim", async () => {
    const projectDirectory = await createProjectDirectory()
    const packageDirectory = path.join(projectDirectory, "node_modules", "velocious")

    try {
      const shim = await prepareSourcePeerPackage(projectDirectory)

      expect(shim.created).toEqual(true)
      expect(await fs.realpath(path.join(packageDirectory, "build", "src"))).toEqual(
        await fs.realpath(path.join(projectDirectory, "src"))
      )

      await shim.cleanup()

      expect(await pathExists(packageDirectory)).toEqual(false)
    } finally {
      await fs.rm(projectDirectory, {recursive: true, force: true})
    }
  })

  it("does not overwrite or remove an existing Velocious package", async () => {
    const projectDirectory = await createProjectDirectory()
    const packageDirectory = path.join(projectDirectory, "node_modules", "velocious")
    const sentinelPath = path.join(packageDirectory, "sentinel")

    try {
      await fs.mkdir(packageDirectory)
      await fs.writeFile(sentinelPath, "existing-package\n", "utf8")

      const shim = await prepareSourcePeerPackage(projectDirectory)

      expect(shim.created).toEqual(false)
      await shim.cleanup()
      expect(await fs.readFile(sentinelPath, "utf8")).toEqual("existing-package\n")
    } finally {
      await fs.rm(projectDirectory, {recursive: true, force: true})
    }
  })

  it("does not remove a shim whose invocation marker changed", async () => {
    const projectDirectory = await createProjectDirectory()
    const packageDirectory = path.join(projectDirectory, "node_modules", "velocious")

    try {
      const shim = await prepareSourcePeerPackage(projectDirectory)

      await fs.writeFile(path.join(packageDirectory, SOURCE_PEER_SHIM_MARKER_FILE), "another-invocation\n", "utf8")
      await shim.cleanup()

      expect(await pathExists(packageDirectory)).toEqual(true)
    } finally {
      await fs.rm(projectDirectory, {recursive: true, force: true})
    }
  })
})
