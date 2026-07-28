// @ts-check

import Configuration from "../../../../src/configuration.js"
import fs from "node:fs/promises"
import path from "node:path"
import Project from "../../../dummy/src/models/project.js"
import Task from "../../../dummy/src/models/task.js"

describe("Record path attachment persistence", {tags: ["dummy"], databaseCleaning: {transaction: true}}, () => {
  it("persists allowlisted path bytes with exact metadata and keeps rows durable", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/path-attachment-integration-"))
    const sourcePath = path.join(temporaryDirectory, "source.bin")
    const sourceBytes = Buffer.from([0, 255, 1, 128, 2, 64])
    const attachmentsConfiguration = Configuration.current().getAttachmentsConfiguration()
    const previousAllowPathInput = attachmentsConfiguration.allowPathInput
    const previousAllowedPathPrefixes = attachmentsConfiguration.allowedPathPrefixes

    try {
      await fs.writeFile(sourcePath, sourceBytes)
      attachmentsConfiguration.allowPathInput = true
      attachmentsConfiguration.allowedPathPrefixes = [temporaryDirectory]

      const project = await Project.create({name: "Path attachment project"})
      const task = await Task.create({name: "Path attachment task", projectId: project.id()})

      await task.descriptionFile().attach({
        contentType: "application/octet-stream",
        filename: "renamed.bin",
        path: sourcePath
      })

      const metadata = await task.descriptionFile().listMetadata()
      const downloadedAttachment = await task.descriptionFile().download()

      expect(metadata).toHaveLength(1)
      expect(metadata[0].byteSize).toEqual(sourceBytes.length)
      expect(metadata[0].filename).toEqual("renamed.bin")
      expect(downloadedAttachment.byteSize()).toEqual(sourceBytes.length)
      expect(downloadedAttachment.content().toString("base64")).toEqual(sourceBytes.toString("base64"))
    } finally {
      attachmentsConfiguration.allowPathInput = previousAllowPathInput
      attachmentsConfiguration.allowedPathPrefixes = previousAllowedPathPrefixes
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })

  it("preserves the existing attachment row when a replacement source cannot be opened", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/path-attachment-replace-"))
    const attachmentsConfiguration = Configuration.current().getAttachmentsConfiguration()
    const previousAllowPathInput = attachmentsConfiguration.allowPathInput
    const previousAllowedPathPrefixes = attachmentsConfiguration.allowedPathPrefixes

    try {
      attachmentsConfiguration.allowPathInput = true
      attachmentsConfiguration.allowedPathPrefixes = [temporaryDirectory]

      const project = await Project.create({name: "Failed path attachment project"})
      const task = await Task.create({name: "Failed path attachment task", projectId: project.id()})

      await task.descriptionFile().attach({
        content: "existing content",
        filename: "existing.txt"
      })
      await expect(async () => await task.descriptionFile().attach({
        path: path.join(temporaryDirectory, "missing.bin")
      })).toThrow()

      const metadata = await task.descriptionFile().listMetadata()
      const downloadedAttachment = await task.descriptionFile().download()

      expect(metadata).toHaveLength(1)
      expect(metadata[0].filename).toEqual("existing.txt")
      expect(downloadedAttachment.content().toString()).toEqual("existing content")
    } finally {
      attachmentsConfiguration.allowPathInput = previousAllowPathInput
      attachmentsConfiguration.allowedPathPrefixes = previousAllowedPathPrefixes
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })

  it("preserves the existing row when the selected path storage driver rejects its write", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/path-attachment-driver-failure-"))
    const sourcePath = path.join(temporaryDirectory, "replacement.bin")
    const attachmentsConfiguration = Configuration.current().getAttachmentsConfiguration()
    const previousAllowPathInput = attachmentsConfiguration.allowPathInput
    const previousAllowedPathPrefixes = attachmentsConfiguration.allowedPathPrefixes
    const attachmentDefinition = Task.getAttachmentByName("descriptionFile")
    const previousDriver = attachmentDefinition.driver
    /** @type {import("../../../../src/database/record/attachments/normalize-input.js").NormalizedAttachmentInput | null} */
    let receivedInput = null
    const failingDriver = {
      /**
       * @param {{input: import("../../../../src/database/record/attachments/normalize-input.js").NormalizedAttachmentInput}} args - Write args.
       * @returns {Promise<{storageKey: string}>} - Never resolves.
       */
      async write({input}) {
        receivedInput = input
        throw new Error("Destination write failed")
      },
      /** @returns {Promise<Buffer>} - Unused content. */
      async read() {
        return Buffer.alloc(0)
      }
    }

    try {
      await fs.writeFile(sourcePath, "replacement")
      attachmentsConfiguration.allowPathInput = true
      attachmentsConfiguration.allowedPathPrefixes = [temporaryDirectory]

      const project = await Project.create({name: "Rejected path attachment project"})
      const task = await Task.create({name: "Rejected path attachment task", projectId: project.id()})

      await task.descriptionFile().attach({
        content: "existing content",
        filename: "existing.txt"
      })

      attachmentDefinition.driver = failingDriver

      await expect(async () => await task.descriptionFile().attach({
        path: sourcePath
      })).toThrow(/Destination write failed/)

      expect(receivedInput?.contentBuffer).toEqual(null)
      expect(receivedInput?.contentBase64).toEqual(null)
      expect(receivedInput?.pathSource?.filePath).toEqual(sourcePath)
      if (!receivedInput?.pathSource) throw new Error("Expected normalized path source")

      await expect(async () => await receivedInput.pathSource.createReadStream()).toThrow(/closed/)

      attachmentDefinition.driver = previousDriver

      const metadata = await task.descriptionFile().listMetadata()
      const downloadedAttachment = await task.descriptionFile().download()

      expect(metadata).toHaveLength(1)
      expect(metadata[0].filename).toEqual("existing.txt")
      expect(downloadedAttachment.content().toString()).toEqual("existing content")
    } finally {
      attachmentDefinition.driver = previousDriver
      attachmentsConfiguration.allowPathInput = previousAllowPathInput
      attachmentsConfiguration.allowedPathPrefixes = previousAllowedPathPrefixes
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })

  it("closes the opened path source after successful persistence", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.resolve("tmp/path-attachment-source-close-"))
    const sourcePath = path.join(temporaryDirectory, "source.bin")
    const attachmentsConfiguration = Configuration.current().getAttachmentsConfiguration()
    const previousAllowPathInput = attachmentsConfiguration.allowPathInput
    const previousAllowedPathPrefixes = attachmentsConfiguration.allowedPathPrefixes
    const attachmentDefinition = Task.getAttachmentByName("descriptionFile")
    const previousDriver = attachmentDefinition.driver
    /** @type {import("../../../../src/database/record/attachments/normalize-input.js").AttachmentPathSource | null} */
    let receivedPathSource = null
    let storedContent = Buffer.alloc(0)
    const driver = {
      /**
       * @param {{input: import("../../../../src/database/record/attachments/normalize-input.js").NormalizedAttachmentInput}} args - Write args.
       * @returns {Promise<{storageKey: string}>} - Storage key.
       */
      async write({input}) {
        if (!input.pathSource) throw new Error("Expected normalized path source")

        receivedPathSource = input.pathSource
        /** @type {Buffer[]} */
        const chunks = []

        for await (const chunk of await input.pathSource.createReadStream()) {
          chunks.push(Buffer.from(chunk))
        }

        storedContent = Buffer.concat(chunks)

        return {storageKey: "source-close"}
      },
      /** @returns {Promise<Buffer>} - Stored content. */
      async read() {
        return storedContent
      }
    }

    try {
      await fs.writeFile(sourcePath, "closed after success")
      attachmentsConfiguration.allowPathInput = true
      attachmentsConfiguration.allowedPathPrefixes = [temporaryDirectory]
      attachmentDefinition.driver = driver

      const project = await Project.create({name: "Path source close project"})
      const task = await Task.create({name: "Path source close task", projectId: project.id()})

      await task.descriptionFile().attach({path: sourcePath})

      expect((await task.descriptionFile().download()).content().toString()).toEqual("closed after success")
      if (!receivedPathSource) throw new Error("Expected driver to receive path source")

      await expect(async () => await receivedPathSource.createReadStream()).toThrow(/closed/)
    } finally {
      attachmentDefinition.driver = previousDriver
      attachmentsConfiguration.allowPathInput = previousAllowPathInput
      attachmentsConfiguration.allowedPathPrefixes = previousAllowedPathPrefixes
      await fs.rm(temporaryDirectory, {force: true, recursive: true})
    }
  })
})
