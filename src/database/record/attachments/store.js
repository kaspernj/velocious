// @ts-check

import {randomUUID} from "crypto"
import TableData from "../../table-data/index.js"
import normalizeRecordAttachmentInput from "./normalize-input.js"

const ATTACHMENTS_TABLE = "velocious_attachments"

/** @type {Map<string, RecordAttachmentsStore>} */
const storesByDatabaseIdentifier = new Map()

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
  const key = storeKeyForModel(model)
  let store = storesByDatabaseIdentifier.get(key)

  if (store) return store

  store = new RecordAttachmentsStore({
    configuration: model._getConfiguration(),
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
        if (await db.tableExists(ATTACHMENTS_TABLE)) return

        const table = new TableData(ATTACHMENTS_TABLE, {ifNotExists: true})

        table.string("id", {null: false, primaryKey: true})
        table.string("record_type", {null: false, index: true})
        table.string("record_id", {null: false, index: true})
        table.string("name", {null: false, index: true})
        table.integer("position", {null: false})
        table.string("filename", {null: false})
        table.string("content_type", {null: true})
        table.bigint("byte_size", {null: false})
        table.text("content_base64", {null: false})
        table.bigint("created_at_ms", {null: false})
        table.bigint("updated_at_ms", {null: false})

        await db.createTable(table)
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

    const normalizedInput = await normalizeRecordAttachmentInput(input)
    const now = Date.now()
    const recordType = model.getModelClass().name
    const recordId = String(model.id())

    await this._withDb(async (db) => {
      if (replace) {
        await db.delete({
          conditions: {name, record_id: recordId, record_type: recordType},
          tableName: ATTACHMENTS_TABLE
        })
      }

      const position = replace ? 0 : await this._nextPosition({db, name, recordId, recordType})

      await db.insert({
        data: {
          byte_size: normalizedInput.byteSize,
          content_base64: normalizedInput.contentBase64,
          content_type: normalizedInput.contentType,
          created_at_ms: now,
          filename: normalizedInput.filename,
          id: randomUUID(),
          name,
          position,
          record_id: recordId,
          record_type: recordType,
          updated_at_ms: now
        },
        tableName: ATTACHMENTS_TABLE
      })
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
      const recordType = model.getModelClass().name
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
      const recordType = model.getModelClass().name
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
    const current = Number(rows[0]?.position)

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
