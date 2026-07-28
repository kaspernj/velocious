// @ts-check

import fs from "node:fs/promises"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import path from "node:path"

class NonReadingNodeEnvironmentHandler extends NodeEnvironmentHandler {
  constructor() {
    super()
    this.readCalls = 0
  }

  /** @returns {Promise<Buffer>} - Never returns file bytes. */
  async readAttachmentInputFile() {
    this.readCalls += 1
    throw new Error("Path resolution must use stat, not readFile")
  }
}

describe("Node environment attachment input paths", () => {
  it("resolves allowlisted regular files with stat-derived byte size without reading them", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/node-attachment-input-"))
    const sourcePath = path.join(temporaryDirectory, "source.bin")
    const sourceBytes = Buffer.from([0, 255, 1, 128, 2, 64])
    /** @type {import("../../src/database/record/attachments/normalize-input.js").AttachmentPathSource | null} */
    let pathSource = null

    try {
      await fs.writeFile(sourcePath, sourceBytes)

      const environmentHandler = new NonReadingNodeEnvironmentHandler()
      pathSource = await environmentHandler.resolveAttachmentInputPath({
        allowedPathPrefixes: [temporaryDirectory],
        inputPath: sourcePath
      })

      expect(pathSource.byteSize).toEqual(sourceBytes.length)
      expect(pathSource.filePath).toEqual(sourcePath)
      expect(environmentHandler.readCalls).toEqual(0)
    } finally {
      if (pathSource) await pathSource.close()
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })

  it("rejects directories instead of accepting non-regular path inputs", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/node-attachment-input-directory-"))
    const environmentHandler = new NodeEnvironmentHandler()

    try {
      await expect(async () => await environmentHandler.resolveAttachmentInputPath({
        allowedPathPrefixes: [temporaryDirectory],
        inputPath: temporaryDirectory
      })).toThrow(/regular file/)
    } finally {
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })

  it("rejects resolved paths outside the configured allowlist", async () => {
    const allowedDirectory = await fs.mkdtemp(path.resolve("tmp/node-attachment-allowed-"))
    const outsideDirectory = await fs.mkdtemp(path.resolve("tmp/node-attachment-outside-"))
    const outsidePath = path.join(outsideDirectory, "outside.bin")
    const environmentHandler = new NodeEnvironmentHandler()

    try {
      await fs.writeFile(outsidePath, "outside")

      await expect(async () => await environmentHandler.resolveAttachmentInputPath({
        allowedPathPrefixes: [allowedDirectory],
        inputPath: outsidePath
      })).toThrow(/outside allowed directories/)
    } finally {
      await fs.rm(allowedDirectory, {force: true, recursive: true})
      await fs.rm(outsideDirectory, {force: true, recursive: true})
    }
  })
})
