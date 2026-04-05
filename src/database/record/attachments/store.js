// @ts-check

import UUID from "pure-uuid"
import TableData from "../../table-data/index.js"
import normalizeRecordAttachmentInput from "./normalize-input.js"

const ATTACHMENTS_TABLE = "velocious_attachments"

/** @typedef {new (...args: any[]) => Record<string, any>} AttachmentDriverConstructor */
/** @type {WeakMap<import("../../../configuration.js").default, Map<string, RecordAttachmentsStore>>} */
const storesByConfiguration = new WeakMap()

/**
 * @returns {string} - Generated UUID v4 value.
 */
function generateUUID() {
  return new UUID(4).format()
}

/**
 * @param {import("../index.js").default} model - Model instance.
 * @returns {string} - Store key.
 */
function storeKeyForModel(model) {
  return `${model.getModelClass().getDatabaseIdentifier()}`
}

/**
 * @param {import("../index.js").default} model - Model instance.
 * @returns {RecordAttachmentsStore} - Store instance.
 */
export function recordAttachmentsStoreForModel(model) {
  const configuration = model._getConfiguration()
  let storesByDatabaseIdentifier = storesByConfiguration.get(configuration)

  if (!storesByDatabaseIdentifier) {
    storesByDatabaseIdentifier = new Map()
    storesByConfiguration.set(configuration, storesByDatabaseIdentifier)
  }

  const key = storeKeyForModel(model)
  let store = storesByDatabaseIdentifier.get(key)

  if (store) return store

  store = new RecordAttachmentsStore({
    configuration,
    databaseIdentifier: model.getModelClass().getDatabaseIdentifier()
  })

  storesByDatabaseIdentifier.set(key, store)

  return store
}

/**
 * Attachment persistence store.
 */
export default class RecordAttachmentsStore {
  /**
   * @param {object} args - Options.
   * @param {import("../../../configuration.js").default} args.configuration - Configuration instance.
   * @param {string} args.databaseIdentifier - Database identifier.
   */
  constructor({configuration, databaseIdentifier}) {
    this.configuration = configuration
    this.databaseIdentifier = databaseIdentifier
    this._readyPromise = null
    this._driverColumnsAvailable = false
    this._contentBase64Nullable = true
    /** @type {Map<string, Record<string, any>>} */
    this._attachmentDriversByName = new Map()
    /** @type {Map<AttachmentDriverConstructor | Record<string, any>, Record<string, any>>} */
    this._attachmentDriversByReference = new Map()
  }

  /**
   * @returns {Promise<void>} - Resolves when schema is ready.
   */
  async ensureReady() {
    if (this._readyPromise) {
      await this._readyPromise
      return
    }

    this._readyPromise = (async () => {
      await this._withDb(async (db) => {
        if (await db.tableExists(ATTACHMENTS_TABLE)) {
          await this.ensureAttachmentStoreSchema({db})
          return
        }

        const table = new TableData(ATTACHMENTS_TABLE, {ifNotExists: true})

        table.string("id", {null: false, primaryKey: true})
        table.string("record_type", {null: false, index: true})
        table.string("record_id", {null: false, index: true})
        table.string("name", {null: false, index: true})
        table.integer("position", {null: false})
        table.string("filename", {null: false})
        table.string("content_type", {null: true})
        table.bigint("byte_size", {null: false})
        table.string("driver", {null: true})
        table.string("storage_key", {null: true})
        table.text("content_base64", {null: true})
        table.bigint("created_at_ms", {null: false})
        table.bigint("updated_at_ms", {null: false})

        await db.createTable(table)
        this._driverColumnsAvailable = true
        this._contentBase64Nullable = true
      })
    })()

    try {
      await this._readyPromise
    } finally {
      this._readyPromise = null
    }
  }

  /**
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {unknown} args.input - Attachment input.
   * @param {boolean} args.replace - Whether to replace existing attachments.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async attach({input, model, name, replace}) {
    await this.ensureReady()
    const attachmentsConfiguration = this.configuration.getAttachmentsConfiguration?.() || {}
    const allowPathInput = attachmentsConfiguration.allowPathInput === true
    const allowedPathPrefixes = Array.isArray(attachmentsConfiguration.allowedPathPrefixes)
      ? attachmentsConfiguration.allowedPathPrefixes
      : undefined

    const normalizedInput = await normalizeRecordAttachmentInput(input, {
      allowPathInput,
      allowedPathPrefixes,
      environmentHandler: this.configuration.getEnvironmentHandler()
    })
    const attachmentDriver = await this.resolveAttachmentDriver({model, name})
    const attachmentDriverName = this._attachmentDriverNameFor({model, name})
    const now = Date.now()
    const recordType = model.getModelClass().getModelName()
    const recordId = String(model.id())
    const attachmentId = generateUUID()
    const {storageKey} = await attachmentDriver.write({
      attachmentId,
      input: normalizedInput,
      model,
      name
    })

    await this._withDb(async (db) => {
      if (replace) {
        const existingRows = await db
          .newQuery()
          .from(ATTACHMENTS_TABLE)
          .where({name, record_id: recordId, record_type: recordType})
          .results()

        for (const existingRow of existingRows) {
          await this.deleteAttachmentRowStorage({model, name, row: existingRow})
        }

        await db.delete({
          conditions: {name, record_id: recordId, record_type: recordType},
          tableName: ATTACHMENTS_TABLE
        })
      }

      const position = replace ? 0 : await this._nextPosition({db, name, recordId, recordType})
      /** @type {Record<string, any>} */
      const insertData = {
        byte_size: normalizedInput.byteSize,
        content_base64: this._contentBase64Nullable ? null : normalizedInput.contentBase64,
        content_type: normalizedInput.contentType,
        created_at_ms: now,
        filename: normalizedInput.filename,
        id: attachmentId,
        name,
        position,
        record_id: recordId,
        record_type: recordType,
        updated_at_ms: now
      }

      if (this._driverColumnsAvailable) {
        insertData.driver = attachmentDriverName
        insertData.storage_key = storageKey
      }

      await db.insert({
        data: insertData,
        tableName: ATTACHMENTS_TABLE
      })
    })
  }

  /**
   * @param {object} args - Options.
   * @param {import("../../../database/drivers/base.js").default} args.db - DB connection.
   * @returns {Promise<void>} - Resolves when schema columns are ensured.
   */
  async ensureAttachmentStoreSchema({db}) {
    const table = await db.getTableByNameOrFail(ATTACHMENTS_TABLE)
    const columns = await table.getColumns()
    const hasDriverColumn = columns.some((column) => column.getName() === "driver")
    const hasStorageKeyColumn = columns.some((column) => column.getName() === "storage_key")
    const contentBase64Column = columns.find((column) => column.getName() === "content_base64")
    const alterTable = new TableData(ATTACHMENTS_TABLE)
    let shouldAlter = false

    if (!hasDriverColumn) {
      alterTable.string("driver", {null: true})
      shouldAlter = true
    }

    if (!hasStorageKeyColumn) {
      alterTable.string("storage_key", {null: true})
      shouldAlter = true
    }

    if (shouldAlter) {
      const alterTableSQLs = await db.alterTableSQLs(alterTable)

      for (const sql of alterTableSQLs) {
        await db.query(sql)
      }
    }

    this._driverColumnsAvailable = true
    this._contentBase64Nullable = contentBase64Column ? contentBase64Column.getNull() : true
  }

  /**
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {Record<string, any>} args.row - Attachment row.
   * @returns {Promise<Buffer>} - Attachment bytes.
   */
  async readAttachmentRow({model, name, row}) {
    if (typeof row.content_base64 === "string" && row.content_base64.length > 0) {
      return Buffer.from(row.content_base64, "base64")
    }

    const storageKey = typeof row.storage_key === "string" && row.storage_key.length > 0 ? row.storage_key : null

    if (!storageKey) {
      throw new Error(`Attachment row ${String(row.id)} is missing storage key`)
    }

    const attachmentDriver = await this.resolveAttachmentDriver({model, name, row})

    return await attachmentDriver.read({
      model,
      name,
      row,
      storageKey
    })
  }

  /**
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {Record<string, any>} args.row - Attachment row.
   * @returns {Promise<string | null>} - Attachment URL.
   */
  async attachmentRowUrl({model, name, row}) {
    const attachmentDriver = await this.resolveAttachmentDriver({model, name, row})

    if (typeof attachmentDriver.url !== "function") return null

    const storageKey = typeof row.storage_key === "string" && row.storage_key.length > 0
      ? row.storage_key
      : (typeof row.id === "string" ? row.id : "")

    if (!storageKey) return null

    return await attachmentDriver.url({
      model,
      name,
      row,
      storageKey
    })
  }

  /**
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {string} [args.id] - Optional attachment id.
   * @returns {Promise<Record<string, any> | null>} - Attachment row.
   */
  async findOne({id, model, name}) {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      const recordType = model.getModelClass().getModelName()
      const recordId = String(model.id())
      let query = db
        .newQuery()
        .from(ATTACHMENTS_TABLE)
        .where({name, record_id: recordId, record_type: recordType})
        .order("position ASC")
        .order("created_at_ms DESC")
        .limit(1)

      if (id) {
        query = query.where({id})
      }

      const rows = await query.results()

      return rows[0] || null
    })
  }

  /**
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @returns {Promise<Array<Record<string, any>>>} - Attachment rows.
   */
  async findMany({model, name}) {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      const recordType = model.getModelClass().getModelName()
      const recordId = String(model.id())
      const query = db
        .newQuery()
        .from(ATTACHMENTS_TABLE)
        .where({name, record_id: recordId, record_type: recordType})
        .order("position ASC")
        .order("created_at_ms ASC")

      return await query.results()
    })
  }

  /**
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {Record<string, any>} args.row - Attachment row.
   * @returns {Promise<void>} - Resolves when row storage has been deleted.
   */
  async deleteAttachmentRowStorage({model, name, row}) {
    const storageKey = typeof row.storage_key === "string" && row.storage_key.length > 0 ? row.storage_key : null

    if (!storageKey) return

    const attachmentDriver = await this.resolveAttachmentDriver({model, name, row})

    if (typeof attachmentDriver.delete !== "function") return

    await attachmentDriver.delete({
      model,
      name,
      row,
      storageKey
    })
  }

  /**
   * @param {string} driverName - Driver name.
   * @returns {Promise<Record<string, any>>} - Attachment storage driver instance.
   */
  async attachmentDriverByName(driverName) {
    if (this._attachmentDriversByName.has(driverName)) {
      return /** @type {Record<string, any>} */ (this._attachmentDriversByName.get(driverName))
    }

    const attachmentConfiguration = this.configuration.getAttachmentsConfiguration?.() || {}
    const configuredDriver = attachmentConfiguration.drivers?.[driverName]
    /** @type {Record<string, any>} */
    let attachmentDriver

    if (!configuredDriver) {
      throw new Error(`No configured attachment storage driver named "${driverName}"`)
    } else if (configuredDriver.instance && typeof configuredDriver.instance === "object") {
      attachmentDriver = configuredDriver.instance
    } else if (typeof configuredDriver.driverClass === "function") {
      attachmentDriver = new configuredDriver.driverClass({
        configuration: this.configuration,
        name: driverName,
        options: configuredDriver
      })
    } else if (typeof configuredDriver.create === "function") {
      attachmentDriver = configuredDriver.create({
        configuration: this.configuration,
        name: driverName,
        options: configuredDriver
      })
    } else {
      throw new Error(`Attachment storage driver "${driverName}" must define instance, driverClass, or create`)
    }

    if (!attachmentDriver || typeof attachmentDriver.write !== "function" || typeof attachmentDriver.read !== "function") {
      throw new Error(`Attachment storage driver "${driverName}" must implement write/read`)
    }

    this._attachmentDriversByName.set(driverName, attachmentDriver)

    return attachmentDriver
  }

  /**
   * @param {object} args - Options.
   * @param {AttachmentDriverConstructor | Record<string, any>} args.driverReference - Driver class or instance.
   * @param {string} args.attachmentName - Attachment name.
   * @param {typeof import("../index.js").default} args.modelClass - Model class.
   * @returns {Record<string, any>} - Attachment driver instance.
   */
  attachmentDriverByReference({attachmentName, driverReference, modelClass}) {
    if (this._attachmentDriversByReference.has(driverReference)) {
      return /** @type {Record<string, any>} */ (this._attachmentDriversByReference.get(driverReference))
    }

    /** @type {Record<string, any>} */
    let attachmentDriver

    if (typeof driverReference === "function") {
      const DriverClass = /** @type {AttachmentDriverConstructor} */ (driverReference)

      attachmentDriver = new DriverClass({
        attachmentName,
        configuration: this.configuration,
        modelClass
      })
    } else if (driverReference && typeof driverReference === "object") {
      attachmentDriver = driverReference
    } else {
      throw new Error(`Invalid attachment driver reference for ${modelClass.name}#${attachmentName}`)
    }

    if (typeof attachmentDriver.write !== "function" || typeof attachmentDriver.read !== "function") {
      throw new Error(`Attachment driver for ${modelClass.name}#${attachmentName} must implement write/read`)
    }

    this._attachmentDriversByReference.set(driverReference, attachmentDriver)

    return attachmentDriver
  }

  /**
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @returns {string} - Attachment driver name.
   */
  _attachmentDriverNameFor({model, name}) {
    const attachmentDefinition = model.getModelClass().getAttachmentByName(name)
    const configuredDriver = attachmentDefinition.driver
    const attachmentsConfiguration = this.configuration.getAttachmentsConfiguration?.() || {}
    const defaultDriver = attachmentsConfiguration.defaultDriver

    if (typeof configuredDriver === "string" && configuredDriver.length > 0) {
      return configuredDriver
    }

    if (typeof configuredDriver === "function") {
      return configuredDriver.name || "custom"
    }

    if (configuredDriver && typeof configuredDriver === "object") {
      const constructorName = configuredDriver.constructor?.name

      if (typeof constructorName === "string" && constructorName.length > 0 && constructorName !== "Object") {
        return constructorName
      }

      return "custom"
    }

    if (typeof defaultDriver === "string" && defaultDriver.length > 0) {
      return defaultDriver
    }

    throw new Error(`No attachment driver configured for ${model.getModelClass().name}#${name}`)
  }

  /**
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {Record<string, any>} [args.row] - Attachment row.
   * @returns {Promise<Record<string, any>>} - Attachment storage driver instance.
   */
  async resolveAttachmentDriver({model, name, row}) {
    const attachmentDefinition = model.getModelClass().getAttachmentByName(name)
    const configuredDriver = attachmentDefinition.driver
    if (typeof configuredDriver === "function" || (configuredDriver && typeof configuredDriver === "object")) {
      return this.attachmentDriverByReference({
        attachmentName: name,
        driverReference: configuredDriver,
        modelClass: model.getModelClass()
      })
    }

    const fallbackDriverName = typeof row?.driver === "string" && row.driver.length > 0
      ? row.driver
      : this._attachmentDriverNameFor({model, name})

    return await this.attachmentDriverByName(fallbackDriverName)
  }

  /**
   * @param {object} args - Options.
   * @param {import("../../../database/drivers/base.js").default} args.db - DB connection.
   * @param {string} args.name - Attachment name.
   * @param {string} args.recordId - Record id.
   * @param {string} args.recordType - Record type.
   * @returns {Promise<number>} - Next position.
   */
  async _nextPosition({db, name, recordId, recordType}) {
    const query = db
      .newQuery()
      .from(ATTACHMENTS_TABLE)
      .where({name, record_id: recordId, record_type: recordType})
      .order("position DESC")
      .limit(1)
    const rows = await query.results()
    const currentRow = /** @type {{position?: string | number | null} | undefined} */ (rows[0])
    const current = Number(currentRow?.position)

    if (!Number.isFinite(current)) return 0

    return current + 1
  }

  /**
   * @template T
   * @param {(db: import("../../../database/drivers/base.js").default) => Promise<T>} callback - Callback.
   * @returns {Promise<T>} - Callback result.
   */
  async _withDb(callback) {
    const pool = this.configuration.getDatabasePool(this.databaseIdentifier)
    /** @type {T | undefined} */
    let result

    await pool.withConnection(async (db) => {
      result = await callback(db)
    })

    return /** @type {T} */ (result)
  }
}
