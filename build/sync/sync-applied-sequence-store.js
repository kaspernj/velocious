// @ts-check

import TableData from "../database/table-data/index.js"
import TableIndex from "../database/table-data/table-index.js"
import UUID from "pure-uuid"

/**
 * @typedef {object} SyncAppliedSequenceRow
 * @property {string} resourceId - Resource identifier the change applied to.
 * @property {string} resourceType - Resource/model name the change applied to.
 * @property {number} serverSequence - Highest applied server sequence for the resource.
 * @property {string} storeIdentity - Physical store identity owning this row.
 */
const TABLE_NAME = "velocious_sync_applied_sequences"
const IDENTITY_INDEX_NAME = "index_velocious_sync_applied_sequences_on_identity"

/**
 * Builds the stable in-memory key for one resource identity.
 * @param {{resourceType: string, resourceId: string}} args - Resource identity.
 * @returns {string} Memory key.
 */
function memoryKey({resourceId, resourceType}) {
  return `${resourceType}:${resourceId}`
}

/**
 * Framework-owned local bookkeeping of the newest server change sequence
 * already applied to each record.
 *
 * The server change feed is at-least-once: a realtime push does not advance a
 * pull cursor, so the next pull re-delivers the same `serverSequence`, and a
 * resumed page can repeat a row. Applying such a duplicate after a newer local
 * provisional write used to let the older server payload win. Tracking the
 * highest applied sequence per record makes the applier idempotent: a change at
 * or below the recorded sequence is skipped, while any higher sequence still
 * applies.
 *
 * Backed by an auto-created `velocious_sync_applied_sequences` table on the
 * configured database, with a process-local memory fallback when no database is
 * configured (mirroring the scope store).
 */
export default class SyncAppliedSequenceStore {
  /**
   * Creates an applied-sequence store.
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration owning the database.
   * @param {string} [args.databaseIdentifier] - Database identifier.
   * @param {import("../tenants/tenant-handle.js").default} [args.tenantHandle] - Immutable tenant handle owning the physical store.
   */
  constructor({configuration, databaseIdentifier = "default", tenantHandle}) {
    if (tenantHandle) tenantHandle.assertConfiguration(configuration)

    this.configuration = configuration
    this.databaseIdentifier = databaseIdentifier
    this.tenantHandle = tenantHandle
    this.storeIdentity = tenantHandle
      ? tenantHandle.databaseIdentity(databaseIdentifier)
      : `configuration:${databaseIdentifier}`
    /** @type {Map<string, number>} */
    this._memorySequences = new Map()
    /** @type {Map<string, Promise<void>>} */
    this._writeQueues = new Map()
    this._isReady = false
    /** @type {Promise<void> | null} */
    this._readyPromise = null
    /** @type {WeakMap<import("../database/drivers/base.js").default, {completion: Promise<void>, promise: Promise<void>}>} */
    this._transactionReadyPromises = new WeakMap()
  }

  /**
   * Ensures the backing table exists.
   * @returns {Promise<void>} Resolves when ready.
   */
  async ensureReady() {
    if (this._isReady) return

    if (this._usesMemoryStorage()) {
      this._isReady = true
      return
    }

    await this._withDb(async (db) => await this._ensureReadyWithDb(db))
  }

  /**
   * Returns the highest server sequence already applied to a record.
   * @param {{resourceType: string, resourceId: string}} identity - Resource identity.
   * @returns {Promise<number | null>} Applied sequence, or null when none is recorded.
   */
  async lastAppliedSequence(identity) {
    await this.ensureReady()

    if (this._usesMemoryStorage()) {
      return this._memorySequences.get(memoryKey(identity)) ?? null
    }

    return await this._withDb(async (db) => {
      const row = await this._rowByResource(db, identity)

      return row ? row.serverSequence : null
    })
  }

  /**
   * Records a successfully applied server sequence for a record, keeping only
   * the highest value. Writes for the same record are serialized in-process so
   * concurrent pull/realtime applies cannot move the watermark backwards.
   * @param {{resourceType: string, resourceId: string, serverSequence: number}} args - Applied change identity and sequence.
   * @returns {Promise<void>} Resolves when recorded.
   */
  async recordAppliedSequence({resourceId, resourceType, serverSequence}) {
    await this.ensureReady()

    const identity = {resourceId, resourceType}
    const key = memoryKey(identity)
    const previousWrite = this._writeQueues.get(key) || Promise.resolve()
    const write = previousWrite
      .then(async () => await this._recordSequential({identity, key, serverSequence}))
      .finally(() => {
        if (this._writeQueues.get(key) === write) this._writeQueues.delete(key)
      })

    this._writeQueues.set(key, write)
    await write
  }

  /**
   * Applies one serialized watermark write.
   * @param {{identity: {resourceType: string, resourceId: string}, key: string, serverSequence: number}} args - Write args.
   * @returns {Promise<void>} Resolves when written.
   */
  async _recordSequential({identity, key, serverSequence}) {
    const currentSequence = await this.lastAppliedSequence(identity)

    if (currentSequence !== null && currentSequence >= serverSequence) return

    if (this._usesMemoryStorage()) {
      this._memorySequences.set(key, serverSequence)
      return
    }

    await this._withDb(async (db) => {
      await db.upsert({
        conflictColumns: ["resource_type", "resource_id"],
        data: {
          created_at: new Date(),
          id: new UUID(4).format(),
          resource_id: identity.resourceId,
          resource_type: identity.resourceType,
          server_sequence: serverSequence,
          updated_at: new Date()
        },
        tableName: TABLE_NAME,
        updateColumns: ["server_sequence", "updated_at"]
      })
    })
  }

  /**
   * Coordinates durable and transaction-local readiness on one connection.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} Resolves when this caller can use the table.
   */
  async _ensureReadyWithDb(db) {
    if (this._isReady) return

    const transactionCompletion = db.insideTransaction() ? db.transactionCompletion() : null
    const transactionReady = this._transactionReadyPromises.get(db)

    if (transactionCompletion && transactionReady?.completion === transactionCompletion) {
      await transactionReady.promise
      return
    }

    if (this._readyPromise) {
      const readyPromise = this._readyPromise

      await readyPromise
      if (this._readyPromise === readyPromise) this._readyPromise = null
      if (this._isReady) return

      await this.ensureReady()
      return
    }

    if (transactionCompletion) {
      const tableReadyPromise = this._ensureTable(db)
      const transactionReadyPromise = tableReadyPromise.then(() => undefined)

      const durableReadyPromise = tableReadyPromise.then(async (created) => {
        if (!created) {
          this._isReady = true
          return
        }

        await transactionCompletion
      })

      this._transactionReadyPromises.set(db, {completion: transactionCompletion, promise: transactionReadyPromise})
      this._readyPromise = durableReadyPromise
      await transactionReadyPromise
      return
    }

    this._readyPromise = this._ensureTable(db).then(() => {
      this._isReady = true
    })

    try {
      await this._readyPromise
    } finally {
      if (!this._isReady) this._readyPromise = null
    }
  }

  /**
   * Whether the store runs without a configured database.
   * @returns {boolean} Whether memory storage is used.
   */
  _usesMemoryStorage() {
    try {
      return !this.configuration.getDatabaseConfiguration()[this.databaseIdentifier]
    } catch {
      return true
    }
  }

  /**
   * Runs a callback with a database connection.
   * @template Result
   * @param {(db: import("../database/drivers/base.js").default) => Promise<Result>} callback - Database callback.
   * @returns {Promise<Result>} Callback result.
   */
  async _withDb(callback) {
    if (this.tenantHandle) {
      return await this.tenantHandle.databaseOperation({databaseIdentifier: this.databaseIdentifier, name: "Tenant sync applied-sequence store"}, async (operation) => {
        return await callback(operation.connection())
      })
    }

    return await this.configuration.ensureConnections({databaseIdentifiers: [this.databaseIdentifier], name: "Sync applied-sequence store"}, async (dbs) => {
      const db = dbs[this.databaseIdentifier]

      if (!db) throw new Error(`No database connection available for identifier: ${this.databaseIdentifier}`)

      return await callback(db)
    })
  }

  /**
   * Ensures the applied-sequences table exists.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<boolean>} Whether the table had to be created.
   */
  async _ensureTable(db) {
    if (await db.tableExists(TABLE_NAME)) return false

    const table = new TableData(TABLE_NAME, {ifNotExists: true})

    table.string("id", {null: false, primaryKey: true})
    table.string("resource_type", {null: false})
    table.string("resource_id", {null: false})
    table.bigint("server_sequence", {null: false})
    table.datetime("created_at", {null: false})
    table.datetime("updated_at", {null: false})
    table.addIndex(new TableIndex(["resource_type", "resource_id"], {name: IDENTITY_INDEX_NAME, unique: true}))

    await db.createTable(table)

    return true
  }

  /**
   * Resolves the stored row for one resource identity.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {{resourceType: string, resourceId: string}} identity - Resource identity.
   * @returns {Promise<SyncAppliedSequenceRow | null>} Stored row, or null.
   */
  async _rowByResource(db, identity) {
    const rows = /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */ (await db
      .newQuery()
      .from(TABLE_NAME)
      .where({resource_id: identity.resourceId, resource_type: identity.resourceType})
      .limit(1)
      .results())

    const row = rows[0]

    if (!row) return null

    return {
      resourceId: String(row.resource_id),
      resourceType: String(row.resource_type),
      serverSequence: Number(row.server_sequence),
      storeIdentity: this.storeIdentity
    }
  }
}
