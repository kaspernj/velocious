// @ts-check

import fs from "node:fs/promises"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import path from "node:path"

/** @param {import("node:stream").Readable} stream - Readable stream. */
async function readStream(stream) {
  /** @type {Buffer[]} */
  const chunks = []

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk))
  }

  return Buffer.concat(chunks)
}

describe("Node environment attachment path source", () => {
  it("keeps the originally opened file identity when the pathname is replaced", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/attachment-path-identity-"))
    const sourcePath = path.join(temporaryDirectory, "source.txt")
    const replacementPath = path.join(temporaryDirectory, "replacement.txt")
    const environmentHandler = new NodeEnvironmentHandler()
    /** @type {import("../../src/database/record/attachments/normalize-input.js").AttachmentPathSource | null} */
    let pathSource = null

    try {
      await fs.writeFile(sourcePath, "original")
      await fs.writeFile(replacementPath, "replaced")

      pathSource = await environmentHandler.resolveAttachmentInputPath({
        allowedPathPrefixes: [temporaryDirectory],
        inputPath: sourcePath
      })

      await fs.rename(replacementPath, sourcePath)

      expect((await readStream(await pathSource.createReadStream())).toString()).toEqual("original")
      expect((await pathSource.readBuffer()).toString()).toEqual("original")

      await pathSource.close()
      await expect(async () => await pathSource.createReadStream()).toThrow(/closed/)
    } finally {
      if (pathSource) await pathSource.close()
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })

  it("rejects truncation against the opened-handle stat size", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/attachment-path-truncation-"))
    const sourcePath = path.join(temporaryDirectory, "source.txt")
    const environmentHandler = new NodeEnvironmentHandler()
    /** @type {import("../../src/database/record/attachments/normalize-input.js").AttachmentPathSource | null} */
    let pathSource = null

    try {
      await fs.writeFile(sourcePath, "snapshot")

      pathSource = await environmentHandler.resolveAttachmentInputPath({
        allowedPathPrefixes: [temporaryDirectory],
        inputPath: sourcePath
      })

      await fs.truncate(sourcePath, 3)

      await expect(async () => await readStream(await pathSource.createReadStream())).toThrow(/truncated/)
      await expect(async () => await pathSource.readBuffer()).toThrow(/truncated/)
      await pathSource.close()
    } finally {
      if (pathSource) await pathSource.close()
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })

  it("ignores bytes appended beyond the opened-handle stat snapshot", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/attachment-path-extension-"))
    const sourcePath = path.join(temporaryDirectory, "source.txt")
    const environmentHandler = new NodeEnvironmentHandler()
    /** @type {import("../../src/database/record/attachments/normalize-input.js").AttachmentPathSource | null} */
    let pathSource = null

    try {
      await fs.writeFile(sourcePath, "old")

      pathSource = await environmentHandler.resolveAttachmentInputPath({
        allowedPathPrefixes: [temporaryDirectory],
        inputPath: sourcePath
      })

      await fs.appendFile(sourcePath, " extension")

      expect(pathSource.byteSize).toEqual(3)
      expect((await readStream(await pathSource.createReadStream())).toString()).toEqual("old")
      expect((await pathSource.readBuffer()).toString()).toEqual("old")

      await pathSource.close()
    } finally {
      if (pathSource) await pathSource.close()
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })
})
