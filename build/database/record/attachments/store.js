// @ts-check

import {createHash} from "node:crypto"
import UUID from "pure-uuid"
import TableData from "../../table-data/index.js"
import TableIndex from "../../table-data/table-index.js"
import {modelPrimaryKeyCacheKey} from "../../../utils/model-primary-key.js"
import normalizeRecordAttachmentInput from "./normalize-input.js"

/**
 * AttachmentDriverConstructor type.
 * @typedef {import("../../../configuration-types.js").AttachmentDriverConstructor} AttachmentDriverConstructor */
const ATTACHMENTS_TABLE = "velocious_attachments"
const ATTACHMENT_OWNER_INDEX_NAME = "index_velocious_attachments_on_record_type_and_record_id_digest"
const ATTACHMENT_RECORD_ID_DIGEST_LENGTH = 64
const ATTACHMENT_RECORD_ID_DIGEST_MIGRATION_BATCH_SIZE = 100

/**
 * Stores by configuration.
 * @type {WeakMap<import("../../../configuration.js").default, Map<string, RecordAttachmentsStore>>} */
const storesByConfiguration = new WeakMap()

/**
 * Runs generate uuid.
 * @returns {string} - Generated UUID v4 value.
 */
function generateUUID() {
  return new UUID(4).format()
}

/**
 * Returns the canonical stored owner identity for a model attachment.
 * @param {import("../index.js").default} model - Attachment owner.
 * @returns {string} - Canonical owner identity.
 */
function attachmentRecordId(model) {
  return modelPrimaryKeyCacheKey(model.getModelClass().primaryKey(), model.id())
}

/**
 * Returns a bounded digest for indexed attachment owner lookups.
 * @param {string} recordId - Canonical attachment owner identity.
 * @returns {string} - SHA-256 digest.
 */
function attachmentRecordIdDigest(recordId) {
  return createHash("sha256").update(recordId).digest("hex")
}

/**
 * Builds collision-safe attachment owner lookup conditions.
 * @param {object} args - Owner lookup values.
 * @param {string} [args.name] - Optional attachment name.
 * @param {string} args.recordId - Canonical owner identity.
 * @param {string} args.recordType - Owner model name.
 * @returns {Record<string, string>} - Indexed digest and canonical identity conditions.
 */
function attachmentOwnerConditions({name, recordId, recordType}) {
  /** @type {Record<string, string>} */
  const conditions = {
    record_id: recordId,
    record_id_digest: attachmentRecordIdDigest(recordId),
    record_type: recordType
  }

  if (name !== undefined) conditions.name = name

  return conditions
}

/**
 * Runs store key for model.
 * @param {import("../index.js").default} model - Model instance.
 * @returns {string} - Store key.
 */
function storeKeyForModel(model) {
  const operation = model.databaseOperation()

  if (operation) return operation.databaseIdentity()

  return `${model.getModelClass().getDatabaseIdentifier()}`
}

/**
 * Runs the recordAttachmentsStoreForModel helper.
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
    databaseIdentifier: model.databaseOperation()?.databaseIdentifier() || model.getModelClass().getDatabaseIdentifier()
  })

  storesByDatabaseIdentifier.set(key, store)

  return store
}

/**
 * Attachment persistence store.
 */
export default class RecordAttachmentsStore {
  /**
   * Runs constructor.
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
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<string, Record<string, ReturnType<typeof JSON.parse>>>} */
    this._attachmentDriversByName = new Map()
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, Record<string, ReturnType<typeof JSON.parse>>>} */
    this._attachmentDriversByReference = new Map()
  }

  /**
   * Runs ensure ready.
   * @param {import("../index.js").default} [model] - Operation-owning model.
   * @returns {Promise<void>} - Resolves when schema is ready.
   */
  async ensureReady(model) {
    if (this._readyPromise) {
      await this._readyPromise
      return
    }

    this._readyPromise = (async () => {
      await this._withDb(async (db) => {
        await this.ensureSchema(db)
      }, model)
    })()

    try {
      await this._readyPromise
    } finally {
      this._readyPromise = null
    }
  }

  /**
   * Ensures attachment schema through an already-owned connection.
   * @param {import("../../drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when schema is ready.
   */
  async ensureSchema(db) {
    db.clearSchemaCache()

    if (await db.tableExists(ATTACHMENTS_TABLE)) {
      await this.ensureAttachmentStoreSchema({db})
      return
    }

    const table = new TableData(ATTACHMENTS_TABLE, {ifNotExists: true})

    table.string("id", {null: false, primaryKey: true})
    table.string("record_type", {null: false, index: true})
    table.text("record_id", {null: false})
    table.string("record_id_digest", {maxLength: ATTACHMENT_RECORD_ID_DIGEST_LENGTH, null: false})
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
    table.addIndex(new TableIndex(["record_type", "record_id_digest"], {name: ATTACHMENT_OWNER_INDEX_NAME}))

    await db.createTable(table)
    this._driverColumnsAvailable = true
    this._contentBase64Nullable = true
  }

  /**
   * Runs attach.
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {ReturnType<typeof JSON.parse>} args.input - Attachment input.
   * @param {boolean} args.replace - Whether to replace existing attachments.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async attach({input, model, name, replace}) {
    await this.ensureReady(model)
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
    /**
     * Attachment persistence error.
     * This stays opaque so any JavaScript thrown value is preserved exactly.
     * @type {unknown} */
    let persistenceError = null
    let persistenceFailed = false

    try {
      const persistenceInput = await this.persistenceInputFor(normalizedInput)

      await this.persistNormalizedAttachment({
        model,
        name,
        normalizedInput: persistenceInput,
        replace
      })
    } catch (error) {
      persistenceFailed = true
      persistenceError = error
    }

    if (normalizedInput.pathSource) {
      try {
        await normalizedInput.pathSource.close()
      } catch (closeError) {
        if (persistenceFailed) {
          throw new AggregateError(
            [persistenceError, closeError],
            `Attachment persistence and path-source close both failed for ${model.getModelClass().getModelName()}#${attachmentRecordId(model)} (${name})`,
            {cause: closeError}
          )
        }

        throw closeError
      }
    }

    if (persistenceFailed) throw persistenceError
  }

  /**
   * Materializes path content once when a legacy schema requires Base64.
   * @param {import("./normalize-input.js").NormalizedAttachmentInput} normalizedInput - Normalized attachment input.
   * @returns {Promise<import("./normalize-input.js").NormalizedAttachmentInput>} - Input used by the driver and database.
   */
  async persistenceInputFor(normalizedInput) {
    if (this._contentBase64Nullable || !normalizedInput.pathSource) return normalizedInput

    const contentBuffer = await normalizedInput.pathSource.readBuffer()

    return {
      ...normalizedInput,
      contentBase64: contentBuffer.toString("base64"),
      contentBuffer,
      pathSource: null
    }
  }

  /**
   * Persists one normalized attachment while its path source remains open.
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {import("./normalize-input.js").NormalizedAttachmentInput} args.normalizedInput - Normalized attachment.
   * @param {boolean} args.replace - Whether to replace existing attachments.
   * @returns {Promise<void>} - Resolves after persistence.
   */
  async persistNormalizedAttachment({model, name, normalizedInput, replace}) {
    const attachmentDriver = await this.resolveAttachmentDriver({model, name})
    const attachmentDriverName = this._attachmentDriverNameFor({model, name})
    const now = Date.now()
    const recordType = model.getModelClass().getModelName()
    const recordId = attachmentRecordId(model)
    const attachmentId = generateUUID()
    /**
     * Written storage key.
     * @type {string | null} */
    let storageKey = null
    let rowPersisted = false

    try {
      const writeResult = await attachmentDriver.write({
        attachmentId,
        input: normalizedInput,
        model,
        name
      })

      storageKey = writeResult.storageKey

      // Current schemas keep content_base64 nullable and avoid duplicating
      // driver-backed content. Legacy path input was materialized once before
      // the driver write so this value describes those exact persisted bytes.
      const databaseContentBase64 = await this.databaseContentBase64For(normalizedInput)

      await this._withDb(async (db) => {
        if (replace) {
          const existingRows = await db
            .newQuery()
            .from(ATTACHMENTS_TABLE)
            .where(attachmentOwnerConditions({name, recordId, recordType}))
            .results()

          for (const existingRow of existingRows) {
            await this.deleteAttachmentRowStorage({model, name, row: existingRow})
          }

          await db.delete({
            conditions: attachmentOwnerConditions({name, recordId, recordType}),
            tableName: ATTACHMENTS_TABLE
          })
        }

        const position = replace ? 0 : await this._nextPosition({db, name, recordId, recordType})
        /**
         * Insert data.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const insertData = {
          byte_size: normalizedInput.byteSize,
          content_base64: databaseContentBase64,
          content_type: normalizedInput.contentType,
          created_at_ms: now,
          filename: normalizedInput.filename,
          id: attachmentId,
          name,
          position,
          record_id: recordId,
          record_id_digest: attachmentRecordIdDigest(recordId),
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

        rowPersisted = true
      }, model)
    } catch (error) {
      if (!rowPersisted && storageKey && typeof attachmentDriver.delete === "function") {
        try {
          await attachmentDriver.delete({
            model,
            name,
            row: {id: attachmentId, storage_key: storageKey},
            storageKey
          })
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            `Attachment write finalization and new-storage cleanup both failed for ${recordType}#${recordId} (${name})`,
            {cause: cleanupError}
          )
        }
      }

      throw error
    }
  }

  /**
   * Resolves the database content_base64 value for current and legacy schemas.
   * @param {import("./normalize-input.js").NormalizedAttachmentInput} normalizedInput - Normalized attachment input.
   * @returns {Promise<string | null>} - Nullable or legacy Base64 database value.
   */
  async databaseContentBase64For(normalizedInput) {
    if (this._contentBase64Nullable) return null
    if (normalizedInput.contentBase64 !== null) return normalizedInput.contentBase64

    throw new Error("Legacy attachment schema requires materialized content bytes")
  }

  /**
   * Runs ensure attachment store schema.
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
    const recordIdColumn = columns.find((column) => column.getName() === "record_id")
    const recordIdDigestColumn = columns.find((column) => column.getName() === "record_id_digest")
    const alterTable = new TableData(ATTACHMENTS_TABLE)
    let shouldAlter = false

    if (!recordIdColumn) throw new Error(`${ATTACHMENTS_TABLE}.record_id is missing`)

    const recordIdMaxLength = recordIdColumn.getMaxLength()

    if (typeof recordIdMaxLength === "number" && recordIdMaxLength > 0) {
      for (const index of await recordIdColumn.getIndexes()) {
        if (index.isPrimaryKey()) continue

        const indexName = index.getName()

        if (!indexName) throw new Error(`Expected a name for ${ATTACHMENTS_TABLE}.record_id index`)

        for (const sql of await db.removeIndexSQLs({name: indexName, tableName: ATTACHMENTS_TABLE})) {
          await db.query(sql)
        }
      }

      db.clearSchemaCache()
      const recordIdAlterTable = new TableData(ATTACHMENTS_TABLE)

      recordIdAlterTable.text("record_id", {
        isNewColumn: false,
        null: db.getType() === "pgsql" ? undefined : false
      })

      for (const sql of await db.alterTableSQLs(recordIdAlterTable)) {
        await db.query(sql)
      }

      db.clearSchemaCache()
    }

    if (!hasDriverColumn) {
      alterTable.string("driver", {null: true})
      shouldAlter = true
    }

    if (!hasStorageKeyColumn) {
      alterTable.string("storage_key", {null: true})
      shouldAlter = true
    }

    if (!recordIdDigestColumn) {
      alterTable.string("record_id_digest", {maxLength: ATTACHMENT_RECORD_ID_DIGEST_LENGTH, null: true})
      shouldAlter = true
    }

    if (shouldAlter) {
      const alterTableSQLs = await db.alterTableSQLs(alterTable)

      for (const sql of alterTableSQLs) {
        await db.query(sql)
      }

      db.clearSchemaCache()
    }

    if (!recordIdDigestColumn || recordIdDigestColumn.getNull()) {
      await this.backfillAttachmentRecordIdDigests(db)
      await this.ensureAttachmentRecordIdDigestNotNull(db)
    }

    await this.ensureAttachmentOwnerIndex(db)

    this._driverColumnsAvailable = true
    this._contentBase64Nullable = contentBase64Column ? contentBase64Column.getNull() : true
  }

  /**
   * Backfills bounded attachment owner digests in small batches.
   * @param {import("../../../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when every existing row has a digest.
   */
  async backfillAttachmentRecordIdDigests(db) {
    while (true) {
      const rows = await db
        .newQuery()
        .from(ATTACHMENTS_TABLE)
        .where({record_id_digest: null})
        .limit(ATTACHMENT_RECORD_ID_DIGEST_MIGRATION_BATCH_SIZE)
        .results()

      for (const row of rows) {
        if (typeof row.id !== "string" || typeof row.record_id !== "string") {
          throw new Error(`Expected canonical attachment identity strings while backfilling ${ATTACHMENTS_TABLE}`)
        }

        await db.update({
          conditions: {id: row.id},
          data: {record_id_digest: attachmentRecordIdDigest(row.record_id)},
          tableName: ATTACHMENTS_TABLE
        })
      }

      if (rows.length < ATTACHMENT_RECORD_ID_DIGEST_MIGRATION_BATCH_SIZE) return
    }
  }

  /**
   * Makes the backfilled attachment owner digest required.
   * @param {import("../../../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when the digest column is non-nullable.
   */
  async ensureAttachmentRecordIdDigestNotNull(db) {
    db.clearSchemaCache()
    const table = await db.getTableByNameOrFail(ATTACHMENTS_TABLE)
    const recordIdDigestColumn = await table.getColumnByNameOrFail("record_id_digest")

    if (!recordIdDigestColumn.getNull()) return

    const alterTable = new TableData(ATTACHMENTS_TABLE)

    alterTable.string("record_id_digest", {
      isNewColumn: false,
      maxLength: ATTACHMENT_RECORD_ID_DIGEST_LENGTH,
      null: false
    })

    for (const sql of await db.alterTableSQLs(alterTable)) await db.query(sql)

    db.clearSchemaCache()
  }

  /**
   * Ensures attachment owner queries retain a bounded composite index.
   * @param {import("../../../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when the owner index exists.
   */
  async ensureAttachmentOwnerIndex(db) {
    const table = await db.getTableByNameOrFail(ATTACHMENTS_TABLE)
    const indexes = await table.getIndexes()
    const ownerIndex = indexes.find((index) => {
      const columnNames = index.getColumnNames()

      return columnNames.length === 2 && columnNames[0] === "record_type" && columnNames[1] === "record_id_digest"
    })

    if (ownerIndex) return

    for (const sql of await db.createIndexSQLs({
      columns: ["record_type", "record_id_digest"],
      ifNotExists: true,
      name: ATTACHMENT_OWNER_INDEX_NAME,
      tableName: ATTACHMENTS_TABLE
    })) await db.query(sql)

    db.clearSchemaCache()
  }

  /**
   * Runs read attachment row.
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
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
   * Runs attachment row url.
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
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
   * Runs find one.
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {string} [args.id] - Optional attachment id.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Attachment row.
   */
  async findOne({id, model, name}) {
    await this.ensureReady(model)

    return await this._withDb(async (db) => {
      const recordType = model.getModelClass().getModelName()
      const recordId = attachmentRecordId(model)
      let query = db
        .newQuery()
        .from(ATTACHMENTS_TABLE)
        .where(attachmentOwnerConditions({name, recordId, recordType}))
        .order("position ASC")
        .order("created_at_ms DESC")
        .limit(1)

      if (id) {
        query = query.where({id})
      }

      const rows = await query.results()

      return rows[0] || null
    }, model)
  }

  /**
   * Runs find many.
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - Attachment rows.
   */
  async findMany({model, name}) {
    await this.ensureReady(model)

    return await this._withDb(async (db) => {
      const recordType = model.getModelClass().getModelName()
      const recordId = attachmentRecordId(model)
      const query = db
        .newQuery()
        .from(ATTACHMENTS_TABLE)
        .where(attachmentOwnerConditions({name, recordId, recordType}))
        .order("position ASC")
        .order("created_at_ms ASC")

      return await query.results()
    }, model)
  }

  /**
   * Moves every attachment row to a record's new primary-key identity.
   * @param {object} args - Options.
   * @param {import("../../drivers/base.js").default} args.connection - Transaction-owning database connection.
   * @param {import("../index.js").default} args.model - Attachment owner after the key change.
   * @param {import("../../../utils/model-primary-key.js").ModelPrimaryKeyValue} args.nextIdentity - New owner identity.
   * @param {import("../../../utils/model-primary-key.js").ModelPrimaryKeyValue} args.previousIdentity - Persisted owner identity.
   * @returns {Promise<void>} - Resolves after ownership is migrated.
   */
  async migrateRecordIdentity({connection, model, nextIdentity, previousIdentity}) {
    const primaryKey = model.getModelClass().primaryKey()
    const nextRecordId = modelPrimaryKeyCacheKey(primaryKey, nextIdentity)
    const previousRecordId = modelPrimaryKeyCacheKey(primaryKey, previousIdentity)

    if (nextRecordId === previousRecordId) return

    if (!await connection.tableExists(ATTACHMENTS_TABLE)) return

    await this.ensureAttachmentStoreSchema({db: connection})

    await connection.update({
      conditions: attachmentOwnerConditions({
        recordId: previousRecordId,
        recordType: model.getModelClass().getModelName()
      }),
      data: {
        record_id: nextRecordId,
        record_id_digest: attachmentRecordIdDigest(nextRecordId)
      },
      tableName: ATTACHMENTS_TABLE
    })
  }

  /**
   * Runs delete attachment row storage.
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Attachment row.
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
   * Purges every attachment stored under (model, name): deletes each row's
   * backing storage and then removes the attachment rows. Used to clean up an
   * owner record's attachments before/when the owner is destroyed.
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @returns {Promise<number>} - Number of attachments purged.
   */
  async purgeAll({model, name}) {
    await this.ensureReady(model)

    return await this._withDb(async (db) => {
      const recordType = model.getModelClass().getModelName()
      const recordId = attachmentRecordId(model)
      /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
      const rows = await db
        .newQuery()
        .from(ATTACHMENTS_TABLE)
        .where(attachmentOwnerConditions({name, recordId, recordType}))
        .results()

      // Refuse to purge when any row's driver cannot delete its backing storage:
      // removing the row while the object stays behind would leak storage and
      // discard the metadata needed to retry cleanup. Fail loudly instead.
      for (const row of rows) {
        const attachmentDriver = await this.resolveAttachmentDriver({model, name, row})

        if (typeof attachmentDriver.delete !== "function") {
          throw new Error(`Cannot purge attachment ${row.id} for ${recordType}#${recordId} (${name}): its storage driver does not support deletion.`)
        }
      }

      for (const row of rows) {
        await this.deleteAttachmentRowStorage({model, name, row})
        // Delete only the snapshotted row by id, so an attachment inserted for the
        // same (record, name) after the snapshot is not removed with its storage
        // still present (which would leave it as unreachable storage).
        await db.delete({conditions: {id: row.id}, tableName: ATTACHMENTS_TABLE})
      }

      return rows.length
    }, model)
  }

  /**
   * Runs attachment driver by name.
   * @param {string} driverName - Driver name.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Attachment storage driver instance.
   */
  async attachmentDriverByName(driverName) {
    if (this._attachmentDriversByName.has(driverName)) {
      return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (this._attachmentDriversByName.get(driverName))
    }

    const attachmentConfiguration = this.configuration.getAttachmentsConfiguration?.() || {}
    const configuredDriver = attachmentConfiguration.drivers?.[driverName]
    /**
     * Defines attachmentDriver.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
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
   * Runs attachment driver by reference.
   * @param {object} args - Options.
   * @param {AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>} args.driverReference - Driver class or instance.
   * @param {string} args.attachmentName - Attachment name.
   * @param {typeof import("../index.js").default} args.modelClass - Model class.
   * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Attachment driver instance.
   */
  attachmentDriverByReference({attachmentName, driverReference, modelClass}) {
    if (this._attachmentDriversByReference.has(driverReference)) {
      return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (this._attachmentDriversByReference.get(driverReference))
    }

    /**
     * Defines attachmentDriver.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
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
   * Runs attachment driver name for.
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
   * Runs resolve attachment driver.
   * @param {object} args - Options.
   * @param {import("../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.row] - Attachment row.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Attachment storage driver instance.
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
   * Runs next position.
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
      .where(attachmentOwnerConditions({name, recordId, recordType}))
      .order("position DESC")
      .limit(1)
    const rows = await query.results()
    const currentRow = /** @type {{position?: string | number | null} | undefined} */ (rows[0])
    const current = Number(currentRow?.position)

    if (!Number.isFinite(current)) return 0

    return current + 1
  }

  /**
   * Runs with db.
   * @template T
   * @param {(db: import("../../../database/drivers/base.js").default) => Promise<T>} callback - Callback.
   * @param {import("../index.js").default} [model] - Operation-owning model.
   * @returns {Promise<T>} - Callback result.
   */
  async _withDb(callback, model) {
    if (model && model.databaseOperation()) return await callback(model.connection())

    const pool = this.configuration.getDatabasePool(this.databaseIdentifier)
    /**
     * Defines result.
     * @type {T | undefined} */
    let result

    await pool.withConnection({name: "Record attachment store"}, async (db) => {
      result = await callback(db)
    })

    return /** @type {T} */ (result)
  }
}
