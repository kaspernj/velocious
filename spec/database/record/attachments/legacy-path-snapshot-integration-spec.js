// @ts-check

import BaseEnvironmentHandler from "../../../../src/environment-handlers/base.js"
import Configuration from "../../../../src/configuration.js"
import Project from "../../../dummy/src/models/project.js"
import RecordAttachmentsStore from "../../../../src/database/record/attachments/store.js"
import Task from "../../../dummy/src/models/task.js"

class ChangingLegacyPathSource {
  constructor() {
    this.byteSize = 6
    this.closeCalls = 0
    this.currentContent = Buffer.from("first!")
    this.filePath = "/allowed/source.bin"
    this.readCalls = 0
  }

  /** @returns {Promise<void>} - Records source closure. */
  async close() {
    this.closeCalls += 1
  }

  /** @returns {Promise<import("node:stream").Readable>} - Never streams in the legacy materialized flow. */
  async createReadStream() {
    throw new Error("Legacy path input must be materialized before driver write")
  }

  /** @returns {Promise<Buffer>} - Current opened-source bytes. */
  async readBuffer() {
    this.readCalls += 1

    return this.currentContent
  }

  /** @returns {void} - Simulates a same-inode modification after driver persistence. */
  modifyAfterWrite() {
    this.currentContent = Buffer.from("second")
  }
}

class LegacyPathEnvironmentHandler extends BaseEnvironmentHandler {
  /** @param {ChangingLegacyPathSource} pathSource - Test path source. */
  constructor(pathSource) {
    super()
    this.pathSource = pathSource
  }

  /**
   * @returns {Promise<ChangingLegacyPathSource>} - Test path source.
   */
  async resolveAttachmentInputPath() {
    return this.pathSource
  }
}

class DatabaseSharingConfiguration extends Configuration {
  /**
   * @param {object} args - Configuration args.
   * @param {ChangingLegacyPathSource} args.pathSource - Test path source.
   * @param {Configuration} args.sourceConfiguration - Configuration owning the dummy database pool.
   */
  constructor({pathSource, sourceConfiguration}) {
    super({
      attachments: {
        allowPathInput: true,
        allowedPathPrefixes: ["/allowed"]
      },
      environmentHandler: new LegacyPathEnvironmentHandler(pathSource)
    })
    this.sourceConfiguration = sourceConfiguration
  }

  /**
   * @param {string} databaseIdentifier - Database identifier.
   * @returns {import("../../../../src/database/pool/base.js").default} - Shared database pool.
   */
  getDatabasePool(databaseIdentifier) {
    return this.sourceConfiguration.getDatabasePool(databaseIdentifier)
  }
}

class LegacySchemaAttachmentStore extends RecordAttachmentsStore {
  /** @returns {Promise<void>} - Ensures the table while emulating a legacy non-null column. */
  async ensureReady() {
    await super.ensureReady()
    this._contentBase64Nullable = false
  }
}

class SnapshotCapturingDriver {
  /** @param {ChangingLegacyPathSource} pathSource - Mutable test source. */
  constructor(pathSource) {
    this.pathSource = pathSource
    /** @type {Buffer | null} */
    this.receivedBuffer = null
    /** @type {string | null} */
    this.receivedContentBase64 = null
    /** @type {Buffer | null} */
    this.storedContent = null
  }

  /**
   * @param {object} args - Write args.
   * @param {string} args.attachmentId - Attachment id.
   * @param {import("../../../../src/database/record/attachments/normalize-input.js").NormalizedAttachmentInput} args.input - Normalized input.
   * @returns {Promise<{storageKey: string}>} - Storage key.
   */
  async write({attachmentId, input}) {
    this.receivedBuffer = input.contentBuffer
    this.receivedContentBase64 = input.contentBase64

    if (input.pathSource) {
      this.storedContent = await input.pathSource.readBuffer()
    } else if (input.contentBuffer) {
      this.storedContent = input.contentBuffer
    } else {
      throw new Error("Expected legacy attachment bytes")
    }

    this.pathSource.modifyAfterWrite()

    return {storageKey: attachmentId}
  }

  /** @returns {Promise<Buffer>} - Stored bytes. */
  async read() {
    if (!this.storedContent) throw new Error("Attachment has not been stored")

    return this.storedContent
  }
}

describe("Legacy attachment path snapshot persistence", {tags: ["dummy"], databaseCleaning: {transaction: true}}, () => {
  it("uses one materialized path read for both driver storage and content_base64", async () => {
    const pathSource = new ChangingLegacyPathSource()
    const configuration = new DatabaseSharingConfiguration({
      pathSource,
      sourceConfiguration: Configuration.current()
    })
    const store = new LegacySchemaAttachmentStore({
      configuration,
      databaseIdentifier: "default"
    })
    const driver = new SnapshotCapturingDriver(pathSource)
    const attachmentDefinition = Task.getAttachmentByName("descriptionFile")
    const previousDriver = attachmentDefinition.driver

    attachmentDefinition.driver = driver

    try {
      const project = await Project.create({name: "Legacy path snapshot project"})
      const task = await Task.create({name: "Legacy path snapshot task", projectId: project.id()})

      await store.attach({
        input: {path: pathSource.filePath},
        model: task,
        name: "descriptionFile",
        replace: false
      })

      const rows = await store.findMany({model: task, name: "descriptionFile"})
      const storedContent = driver.storedContent

      if (!storedContent) throw new Error("Expected stored attachment content")

      expect(pathSource.readCalls).toEqual(1)
      expect(pathSource.closeCalls).toEqual(1)
      expect(driver.receivedBuffer).toBe(storedContent)
      expect(driver.receivedContentBase64).toEqual(storedContent.toString("base64"))
      expect(rows[0].content_base64).toEqual(storedContent.toString("base64"))
      expect(storedContent.toString()).toEqual("first!")
      expect(pathSource.currentContent.toString()).toEqual("second")
    } finally {
      attachmentDefinition.driver = previousDriver
    }
  })
})
