// @ts-check

import BaseEnvironmentHandler from "../../../../src/environment-handlers/base.js"
import Configuration from "../../../../src/configuration.js"
import RecordAttachmentsStore from "../../../../src/database/record/attachments/store.js"

class LegacyContentEnvironmentHandler extends BaseEnvironmentHandler {
  constructor() {
    super()
    this.readCalls = 0
  }

  /** @returns {Promise<Buffer>} - Never reads normalized path content. */
  async readAttachmentInputFile() {
    this.readCalls += 1
    throw new Error("Legacy path content must come from its opened source")
  }
}

class LegacyContentPathSource {
  constructor() {
    this.contentBuffer = Buffer.from("legacy path content")
    this.byteSize = this.contentBuffer.length
    this.filePath = "/allowed/source.bin"
    this.readCalls = 0
  }

  /** @returns {Promise<void>} - No-op close. */
  async close() {}

  /** @returns {Promise<import("node:stream").Readable>} - Never opens a stream. */
  async createReadStream() {
    throw new Error("Legacy compatibility must use readBuffer")
  }

  /** @returns {Promise<Buffer>} - Legacy path content. */
  async readBuffer() {
    this.readCalls += 1

    return this.contentBuffer
  }
}

describe("Record attachment store content_base64 compatibility", () => {
  it("keeps path input streaming and stores null for the current nullable schema", async () => {
    const environmentHandler = new LegacyContentEnvironmentHandler()
    const store = new RecordAttachmentsStore({
      configuration: new Configuration({environmentHandler}),
      databaseIdentifier: "default"
    })
    const pathSource = new LegacyContentPathSource()
    const normalizedInput = {
      byteSize: pathSource.contentBuffer.length,
      contentBase64: null,
      contentBuffer: null,
      contentType: null,
      filename: "source.bin",
      pathSource
    }
    const persistenceInput = await store.persistenceInputFor(normalizedInput)
    const databaseValue = await store.databaseContentBase64For(persistenceInput)

    expect(persistenceInput).toBe(normalizedInput)
    expect(persistenceInput.contentBuffer).toEqual(null)
    expect(persistenceInput.contentBase64).toEqual(null)
    expect(persistenceInput.pathSource).toBe(pathSource)
    expect(databaseValue).toEqual(null)
    expect(pathSource.readCalls).toEqual(0)
    expect(environmentHandler.readCalls).toEqual(0)
  })

  it("materializes path bytes and Base64 before persistence only for a legacy non-null schema", async () => {
    const environmentHandler = new LegacyContentEnvironmentHandler()
    const store = new RecordAttachmentsStore({
      configuration: new Configuration({environmentHandler}),
      databaseIdentifier: "default"
    })
    const pathSource = new LegacyContentPathSource()

    store._contentBase64Nullable = false

    const normalizedInput = await store.persistenceInputFor({
      byteSize: pathSource.contentBuffer.length,
      contentBase64: null,
      contentBuffer: null,
      contentType: null,
      filename: "source.bin",
      pathSource
    })

    expect(normalizedInput.contentBuffer).toBe(pathSource.contentBuffer)
    expect(normalizedInput.contentBase64).toEqual(pathSource.contentBuffer.toString("base64"))
    expect(normalizedInput.pathSource).toEqual(null)
    expect(pathSource.readCalls).toEqual(1)
    expect(environmentHandler.readCalls).toEqual(0)
  })

  it("reuses in-memory Base64 for a legacy non-null schema", async () => {
    const environmentHandler = new LegacyContentEnvironmentHandler()
    const store = new RecordAttachmentsStore({
      configuration: new Configuration({environmentHandler}),
      databaseIdentifier: "default"
    })
    const contentBuffer = Buffer.from("memory")

    store._contentBase64Nullable = false

    const databaseValue = await store.databaseContentBase64For({
      byteSize: contentBuffer.length,
      contentBase64: contentBuffer.toString("base64"),
      contentBuffer,
      contentType: null,
      filename: "memory.bin",
      pathSource: null
    })

    expect(databaseValue).toEqual(contentBuffer.toString("base64"))
    expect(environmentHandler.readCalls).toEqual(0)
  })
})
