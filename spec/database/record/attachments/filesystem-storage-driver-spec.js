// @ts-check

import Configuration from "../../../../src/configuration.js"
import FilesystemAttachmentStorageDriver from "../../../../src/database/record/attachments/storage-drivers/filesystem.js"
import fs from "node:fs/promises"
import NodeEnvironmentHandler from "../../../../src/environment-handlers/node.js"
import path from "node:path"
import { Readable } from "node:stream"

describe("Filesystem attachment storage driver path input", () => {
  it("copies path input bytes without requiring a content buffer", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/filesystem-attachment-driver-"))
    const sourcePath = path.join(temporaryDirectory, "source.bin")
    const destinationDirectory = path.join(temporaryDirectory, "stored")
    const sourceBytes = Buffer.from([0, 255, 34, 128, 10, 13])
    const driver = new FilesystemAttachmentStorageDriver({
      configuration: new Configuration({environmentHandler: new NodeEnvironmentHandler()}),
      options: {directory: destinationDirectory}
    })
    /** @type {import("../../../../src/database/record/attachments/normalize-input.js").AttachmentPathSource | null} */
    let pathSource = null

    try {
      await fs.writeFile(sourcePath, sourceBytes)
      pathSource = await new NodeEnvironmentHandler().resolveAttachmentInputPath({
        allowedPathPrefixes: [temporaryDirectory],
        inputPath: sourcePath
      })

      const {storageKey} = await driver.write({
        attachmentId: "path-id",
        input: {
          byteSize: sourceBytes.length,
          contentBase64: null,
          contentBuffer: null,
          contentType: "application/octet-stream",
          filename: "stored.bin",
          pathSource
        }
      })

      const storedBytes = await fs.readFile(path.join(destinationDirectory, storageKey))

      expect(storedBytes.toString("base64")).toEqual(sourceBytes.toString("base64"))
    } finally {
      if (pathSource) await pathSource.close()
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })

  it("continues writing in-memory attachment buffers", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/filesystem-memory-attachment-driver-"))
    const contentBuffer = Buffer.from("in-memory content")
    const driver = new FilesystemAttachmentStorageDriver({
      configuration: new Configuration({environmentHandler: new NodeEnvironmentHandler()}),
      options: {directory: temporaryDirectory}
    })

    try {
      const {storageKey} = await driver.write({
        attachmentId: "memory-id",
        input: {
          byteSize: contentBuffer.length,
          contentBase64: contentBuffer.toString("base64"),
          contentBuffer,
          contentType: "text/plain",
          filename: "memory.txt",
          pathSource: null
        }
      })

      const storedBytes = await fs.readFile(path.join(temporaryDirectory, storageKey))

      expect(storedBytes.toString("base64")).toEqual(contentBuffer.toString("base64"))
    } finally {
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })

  it("removes a partial destination when the source read fails", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/filesystem-failed-attachment-driver-"))
    const destinationDirectory = path.join(temporaryDirectory, "stored")
    const driver = new FilesystemAttachmentStorageDriver({
      configuration: new Configuration({environmentHandler: new NodeEnvironmentHandler()}),
      options: {directory: destinationDirectory}
    })
    const pathSource = {
      byteSize: 10,
      close: async () => {},
      createReadStream: async () => Readable.from((async function *() {
        yield Buffer.from("partial")
        throw new Error("Source read failed")
      })()),
      filePath: path.join(temporaryDirectory, "source.bin"),
      readBuffer: async () => {
        throw new Error("Unexpected source buffering")
      }
    }

    try {
      await expect(async () => await driver.write({
        attachmentId: "missing-id",
        input: {
          byteSize: 10,
          contentBase64: null,
          contentBuffer: null,
          contentType: null,
          filename: "missing.bin",
          pathSource
        }
      })).toThrow()

      await expect(async () => await fs.stat(path.join(destinationDirectory, "missing-id-missing.bin"))).toThrow()
    } finally {
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })

  it("propagates destination setup errors without opening the source", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/filesystem-destination-error-"))
    const sourcePath = path.join(temporaryDirectory, "source.bin")
    const destinationPath = path.join(temporaryDirectory, "not-a-directory")
    const driver = new FilesystemAttachmentStorageDriver({
      configuration: new Configuration({environmentHandler: new NodeEnvironmentHandler()}),
      options: {directory: destinationPath}
    })
    let createReadStreamCalls = 0
    const pathSource = {
      byteSize: 6,
      close: async () => {},
      createReadStream: async () => {
        createReadStreamCalls += 1

        return Readable.from(["source"])
      },
      filePath: sourcePath,
      readBuffer: async () => {
        throw new Error("Unexpected source buffering")
      }
    }

    try {
      await fs.writeFile(sourcePath, "source")
      await fs.writeFile(destinationPath, "destination blocker")

      await expect(async () => await driver.write({
        attachmentId: "destination-error-id",
        input: {
          byteSize: 6,
          contentBase64: null,
          contentBuffer: null,
          contentType: null,
          filename: "source.bin",
          pathSource
        }
      })).toThrow()

      expect(await fs.readFile(destinationPath, "utf8")).toEqual("destination blocker")
      expect(createReadStreamCalls).toEqual(0)
    } finally {
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })

  it("removes a partial destination when the opened source is truncated", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/filesystem-truncated-attachment-driver-"))
    const sourcePath = path.join(temporaryDirectory, "source.bin")
    const destinationDirectory = path.join(temporaryDirectory, "stored")
    const driver = new FilesystemAttachmentStorageDriver({
      configuration: new Configuration({environmentHandler: new NodeEnvironmentHandler()}),
      options: {directory: destinationDirectory}
    })
    /** @type {import("../../../../src/database/record/attachments/normalize-input.js").AttachmentPathSource | null} */
    let pathSource = null

    try {
      await fs.writeFile(sourcePath, "snapshot")
      pathSource = await new NodeEnvironmentHandler().resolveAttachmentInputPath({
        allowedPathPrefixes: [temporaryDirectory],
        inputPath: sourcePath
      })
      await fs.truncate(sourcePath, 3)

      await expect(async () => await driver.write({
        attachmentId: "truncated-id",
        input: {
          byteSize: pathSource.byteSize,
          contentBase64: null,
          contentBuffer: null,
          contentType: null,
          filename: "source.bin",
          pathSource
        }
      })).toThrow(/truncated/)

      await expect(async () => await fs.stat(path.join(destinationDirectory, "truncated-id-source.bin"))).toThrow()
    } finally {
      if (pathSource) await pathSource.close()
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })
})
