// @ts-check

import Configuration from "../../../../src/configuration.js"
import Project from "../../../dummy/src/models/project.js"
import RecordAttachmentsStore from "../../../../src/database/record/attachments/store.js"
import Task from "../../../dummy/src/models/task.js"

class TrackingAttachmentStorageDriver {
  constructor() {
    this.deleteCalls = 0
    /** @type {Map<string, Buffer>} */
    this.storedContent = new Map()
  }

  /**
   * @param {{attachmentId: string, input: import("../../../../src/database/record/attachments/normalize-input.js").NormalizedAttachmentInput}} args - Write args.
   * @returns {Promise<{storageKey: string}>} - Storage key.
   */
  async write({attachmentId, input}) {
    if (!input.contentBuffer) throw new Error("Expected in-memory content")

    const storageKey = `${attachmentId}-tracking`

    this.storedContent.set(storageKey, input.contentBuffer)

    return {storageKey}
  }

  /**
   * @param {{storageKey: string}} args - Read args.
   * @returns {Promise<Buffer>} - Stored content.
   */
  async read({storageKey}) {
    return this.storedContent.get(storageKey) || Buffer.alloc(0)
  }

  /** @param {{storageKey: string}} args - Delete args. */
  async delete({storageKey}) {
    this.deleteCalls += 1
    this.storedContent.delete(storageKey)
  }
}

class FailingDatabaseLifecycleAttachmentStore extends RecordAttachmentsStore {
  /**
   * @param {object} args - Store args.
   * @param {Configuration} args.configuration - Configuration.
   * @param {string} args.databaseIdentifier - Database identifier.
   * @param {boolean} args.failAfterCallback - Whether to fail after the database callback persists.
   */
  constructor({configuration, databaseIdentifier, failAfterCallback}) {
    super({configuration, databaseIdentifier})
    this.failAfterCallback = failAfterCallback
  }

  /** @returns {Promise<void>} - Marks the existing schema ready. */
  async ensureReady() {
    this._contentBase64Nullable = true
    this._driverColumnsAvailable = true
  }

  /**
   * @template T
   * @param {(db: import("../../../../src/database/drivers/base.js").default) => Promise<T>} callback - Database callback.
   * @returns {Promise<T>} - Callback result.
   */
  async _withDb(callback) {
    if (!this.failAfterCallback) {
      throw new Error("Database insert failed before persistence")
    }

    await super._withDb(callback)

    throw new Error("Connection check-in failed after persistence")
  }
}

describe("Record attachment store commit-aware cleanup", {tags: ["dummy"], databaseCleaning: {transaction: true}}, () => {
  it("does not delete new storage when insert persisted before connection check-in failed", async () => {
    const attachmentDefinition = Task.getAttachmentByName("descriptionFile")
    const previousDriver = attachmentDefinition.driver
    const driver = new TrackingAttachmentStorageDriver()

    attachmentDefinition.driver = driver

    try {
      const project = await Project.create({name: "Committed attachment cleanup project"})
      const task = await Task.create({name: "Committed attachment cleanup task", projectId: project.id()})
      await new RecordAttachmentsStore({
        configuration: Configuration.current(),
        databaseIdentifier: "default"
      }).ensureReady()
      const store = new FailingDatabaseLifecycleAttachmentStore({
        configuration: Configuration.current(),
        databaseIdentifier: "default",
        failAfterCallback: true
      })

      await expect(async () => await store.attach({
        input: {content: "persisted content", filename: "persisted.txt"},
        model: task,
        name: "descriptionFile",
        replace: false
      })).toThrow(/Connection check-in failed/)

      expect(driver.deleteCalls).toEqual(0)

      const rows = await new RecordAttachmentsStore({
        configuration: Configuration.current(),
        databaseIdentifier: "default"
      }).findMany({model: task, name: "descriptionFile"})

      expect(rows).toHaveLength(1)
      expect(driver.storedContent.has(String(rows[0].storage_key))).toEqual(true)
    } finally {
      attachmentDefinition.driver = previousDriver
    }
  })

  it("deletes new storage when database persistence fails before insert", async () => {
    const attachmentDefinition = Task.getAttachmentByName("descriptionFile")
    const previousDriver = attachmentDefinition.driver
    const driver = new TrackingAttachmentStorageDriver()

    attachmentDefinition.driver = driver

    try {
      const project = await Project.create({name: "Failed attachment cleanup project"})
      const task = await Task.create({name: "Failed attachment cleanup task", projectId: project.id()})
      await new RecordAttachmentsStore({
        configuration: Configuration.current(),
        databaseIdentifier: "default"
      }).ensureReady()
      const store = new FailingDatabaseLifecycleAttachmentStore({
        configuration: Configuration.current(),
        databaseIdentifier: "default",
        failAfterCallback: false
      })

      await expect(async () => await store.attach({
        input: {content: "failed content", filename: "failed.txt"},
        model: task,
        name: "descriptionFile",
        replace: false
      })).toThrow(/before persistence/)

      expect(driver.deleteCalls).toEqual(1)
      expect(driver.storedContent.size).toEqual(0)
    } finally {
      attachmentDefinition.driver = previousDriver
    }
  })
})
