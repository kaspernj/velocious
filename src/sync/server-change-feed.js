// @ts-check

import {randomUUID} from "crypto"
import TableData from "../database/table-data/index.js"
import stableJsonStringify from "./stable-json.js"

const DEFAULT_RETENTION_SIZE = 10000
const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 1000
const TABLE_NAME = "frontend_model_sync_changes"
const stores = new WeakMap()

/**
 * Shared server change-feed store for a configuration.
 * @param {import("../configuration.js").default} configuration - Configuration.
 * @returns {ServerChangeFeedStore} - Store.
 */
export function serverChangeFeedStoreForConfiguration(configuration) {
  let store = stores.get(configuration)

  if (!store) {
    store = new ServerChangeFeedStore({configuration})
    stores.set(configuration, store)
  }

  return store
}

export default class ServerChangeFeedStore {
  /**
   * Runs constructor.
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} [args.databaseIdentifier] - Database identifier.
   * @param {number} [args.retentionSize] - Number of feed entries to retain.
   */
  constructor({configuration, databaseIdentifier = "default", retentionSize}) {
    const syncConfiguration = configuration.getSyncConfiguration()

    this.configuration = configuration
    this.databaseIdentifier = databaseIdentifier
    this.retentionSize = retentionSize || syncConfiguration.changeFeedRetentionSize || DEFAULT_RETENTION_SIZE
    /** @type {ServerChangeFeedEntry[]} */
    this._memoryChanges = []
    this._memorySequence = 0
    this._isReady = false
    this._readyPromise = null
  }

  /**
   * Ensures the backing table exists.
   * @returns {Promise<void>} - Resolves when ready.
   */
  async ensureReady() {
    if (this._usesMemoryStorage()) {
      this._isReady = true
      return
    }

    if (await this._schemaReady()) return
    if (this._readyPromise) return await this._readyPromise

    this._readyPromise = (async () => {
      this.configuration.setCurrent()
      await this._withDb(async (db) => {
        await this._ensureChangesTable(db)
      })
      this._isReady = true
    })()

    try {
      await this._readyPromise
    } finally {
      if (!this._isReady) this._readyPromise = null
    }
  }

  /**
   * Appends a change and assigns the next server sequence.
   * @param {Omit<ServerChangeFeedEntry, "createdAt" | "id" | "serverSequence"> & {createdAt?: string, id?: string}} change - Change payload.
   * @returns {Promise<ServerChangeFeedEntry>} - Persisted change.
   */
  async append(change) {
    await this.ensureReady()

    const id = change.id || randomUUID()
    const createdAt = change.createdAt || new Date().toISOString()

    if (this._usesMemoryStorage()) return this._appendMemory({...change, createdAt, id})

    return await this._withDb(async (db) => {
      await db.insert({
        tableName: TABLE_NAME,
        data: {
          actor_device_id: change.actorDeviceId,
          actor_user_id: change.actorUserId,
          attributes_json: JSON.stringify(change.attributes || null),
          created_at: new Date(createdAt),
          id,
          idempotency_key: change.idempotencyKey,
          model: change.model,
          operation: change.operation,
          payload_json: JSON.stringify(change.payload || null),
          record_id: change.recordId === null || change.recordId === undefined ? null : String(change.recordId),
          response_json: JSON.stringify(change.response || null),
          scope_json: stableJsonStringify(change.scope || null)
        }
      })

      const row = await this._changeById(db, id)
      if (!row) throw new Error("Failed to persist server change-feed entry")

      await this._pruneRetainedChanges(db, row.serverSequence)

      return row
    })
  }

  /**
   * Returns current latest server sequence.
   * @returns {Promise<number>} - Latest sequence.
   */
  async latestSequence() {
    await this.ensureReady()

    if (this._usesMemoryStorage()) return this._memorySequence

    return await this._withDb(async (db) => {
      const rows = await db
        .newQuery()
        .from(TABLE_NAME)
        .order("server_sequence DESC")
        .limit(1)
        .results()
      const row = /** @type {{server_sequence?: number | string} | undefined} */ (rows[0])

      return row ? Number(row.server_sequence) : 0
    })
  }

  /**
   * Returns oldest retained server sequence.
   * @returns {Promise<number | null>} - Oldest retained sequence.
   */
  async oldestSequence() {
    await this.ensureReady()

    if (this._usesMemoryStorage()) return this._memoryChanges[0]?.serverSequence || null

    return await this._withDb(async (db) => await this._oldestSequence(db))
  }

  /**
   * Returns ordered changes after a cursor.
   * @param {object} args - Arguments.
   * @param {number} args.afterSequence - Exclusive lower bound.
   * @param {number} [args.limit] - Maximum number of changes.
   * @param {number} [args.upToSequence] - Inclusive upper bound.
   * @param {Record<string, ?>} [args.scope] - Caller sync scope.
   * @returns {Promise<{changes: ServerChangeFeedEntry[], hasMore: boolean, nextSequence: number, oldestSequence: number | null, snapshotRequired: boolean, upToSequence: number}>} - Ordered page.
   */
  async changesAfter({afterSequence, limit = DEFAULT_PAGE_SIZE, scope, upToSequence}) {
    await this.ensureReady()

    const pageSize = normalizeLimit(limit)

    if (this._usesMemoryStorage()) return this._memoryChangesAfter({afterSequence, limit: pageSize, scope, upToSequence})

    return await this._withDb(async (db) => {
      const latestSequence = typeof upToSequence === "number" ? upToSequence : await this._latestSequence(db)
      const oldestSequence = await this._oldestSequence(db)
      const snapshotRequired = afterSequence > 0 && oldestSequence !== null && oldestSequence > afterSequence + 1

      if (snapshotRequired) {
        return {
          changes: [],
          hasMore: false,
          nextSequence: afterSequence,
          oldestSequence,
          snapshotRequired: true,
          upToSequence: latestSequence
        }
      }

      const rows = /** @type {ServerChangeFeedRow[]} */ (await db
        .newQuery()
        .from(TABLE_NAME)
        .where(`server_sequence > ${db.quote(afterSequence)}`)
        .where(`server_sequence <= ${db.quote(latestSequence)}`)
        .where(scope === undefined ? "1 = 1" : {scope_json: stableJsonStringify(scope)})
        .order("server_sequence ASC")
        .limit(pageSize + 1)
        .results())
      const hasMore = rows.length > pageSize
      const pageRows = rows.slice(0, pageSize)
      const changes = pageRows.map((row) => this._normalizeChangeRow(row))
      const lastChange = changes[changes.length - 1]

      return {
        changes,
        hasMore,
        nextSequence: lastChange ? lastChange.serverSequence : afterSequence,
        oldestSequence,
        snapshotRequired: false,
        upToSequence: latestSequence
      }
    })
  }

  /**
   * Ensures schema is still present.
   * @returns {Promise<boolean>} - Whether ready.
   */
  async _schemaReady() {
    if (this._usesMemoryStorage()) return this._isReady
    if (!this._isReady) return false
    if (await this._withDb(async (db) => await db.tableExists(TABLE_NAME))) return true

    this._isReady = false
    this._readyPromise = null

    return false
  }

  /**
   * Ensures changes table exists.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _ensureChangesTable(db) {
    if (await db.tableExists(TABLE_NAME)) return

    const table = new TableData(TABLE_NAME, {ifNotExists: true})

    table.integer("server_sequence", {autoIncrement: true, null: false, primaryKey: true})
    table.string("id", {index: true, null: false})
    table.string("model", {index: true, null: false})
    table.string("operation", {null: false})
    table.string("record_id", {index: true, null: true})
    table.text("payload_json", {null: true})
    table.text("attributes_json", {null: true})
    table.string("idempotency_key", {index: true, null: true})
    table.string("actor_user_id", {index: true, null: true})
    table.string("actor_device_id", {index: true, null: true})
    table.text("scope_json", {null: true})
    table.text("response_json", {null: true})
    table.datetime("created_at", {index: true, null: false})

    await db.createTable(table)
  }

  /**
   * Resolves a persisted change by id.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} id - Entry id.
   * @returns {Promise<ServerChangeFeedEntry | null>} - Entry or null.
   */
  async _changeById(db, id) {
    const rows = /** @type {ServerChangeFeedRow[]} */ (await db
      .newQuery()
      .from(TABLE_NAME)
      .where({id})
      .limit(1)
      .results())

    return rows[0] ? this._normalizeChangeRow(rows[0]) : null
  }

  /**
   * Resolves current latest sequence without readiness checks.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<number>} - Latest sequence.
   */
  async _latestSequence(db) {
    const rows = /** @type {Array<{server_sequence?: number | string}>} */ (await db
      .newQuery()
      .from(TABLE_NAME)
      .order("server_sequence DESC")
      .limit(1)
      .results())

    return rows[0] ? Number(rows[0].server_sequence) : 0
  }

  /**
   * Resolves current oldest sequence without readiness checks.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<number | null>} - Oldest sequence.
   */
  async _oldestSequence(db) {
    const rows = /** @type {Array<{server_sequence?: number | string}>} */ (await db
      .newQuery()
      .from(TABLE_NAME)
      .order("server_sequence ASC")
      .limit(1)
      .results())

    return rows[0] ? Number(rows[0].server_sequence) : null
  }

  /**
   * Prunes old retained changes.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {number} latestSequence - Latest sequence after append.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _pruneRetainedChanges(db, latestSequence) {
    if (!Number.isInteger(this.retentionSize) || this.retentionSize < 1) return

    const pruneBeforeOrAt = latestSequence - this.retentionSize
    if (pruneBeforeOrAt < 1) return

    const rows = /** @type {Array<{id: string}>} */ (await db
      .newQuery()
      .from(TABLE_NAME)
      .where(`server_sequence <= ${db.quote(pruneBeforeOrAt)}`)
      .results())

    for (const row of rows) {
      await db.delete({conditions: {id: row.id}, tableName: TABLE_NAME})
    }
  }

  /**
   * Normalizes a change row.
   * @param {ServerChangeFeedRow} row - Raw database row.
   * @returns {ServerChangeFeedEntry} - Normalized change.
   */
  _normalizeChangeRow(row) {
    const createdAtValue = row.created_at

    return {
      actorDeviceId: row.actor_device_id || null,
      actorUserId: row.actor_user_id || null,
      attributes: parseJsonOrNull(row.attributes_json),
      createdAt: createdAtValue instanceof Date ? createdAtValue.toISOString() : new Date(createdAtValue).toISOString(),
      id: row.id,
      idempotencyKey: row.idempotency_key || null,
      model: row.model,
      operation: row.operation,
      payload: parseJsonOrNull(row.payload_json),
      recordId: row.record_id || null,
      response: parseJsonOrNull(row.response_json),
      scope: parseJsonOrNull(row.scope_json),
      serverSequence: Number(row.server_sequence)
    }
  }

  /**
   * Whether this store should use process-local memory because no database identifier is configured.
   * @returns {boolean} - Whether memory storage is active.
   */
  _usesMemoryStorage() {
    try {
      return !this.configuration.getDatabaseConfiguration()[this.databaseIdentifier]
    } catch {
      return true
    }
  }

  /**
   * Appends a process-local memory entry when no database is configured.
   * @param {Omit<ServerChangeFeedEntry, "serverSequence">} change - Change payload.
   * @returns {ServerChangeFeedEntry} - Appended entry.
   */
  _appendMemory(change) {
    const entry = /** @type {ServerChangeFeedEntry} */ ({
      actorDeviceId: change.actorDeviceId,
      actorUserId: change.actorUserId,
      attributes: change.attributes || null,
      createdAt: change.createdAt,
      id: change.id,
      idempotencyKey: change.idempotencyKey,
      model: change.model,
      operation: change.operation,
      payload: change.payload || null,
      recordId: change.recordId === null || change.recordId === undefined ? null : String(change.recordId),
      response: change.response || null,
      scope: change.scope || null,
      serverSequence: ++this._memorySequence
    })

    this._memoryChanges.push(entry)
    if (this._memoryChanges.length > this.retentionSize) this._memoryChanges.splice(0, this._memoryChanges.length - this.retentionSize)

    return entry
  }

  /**
   * Returns a process-local memory change page.
   * @param {object} args - Arguments.
   * @param {number} args.afterSequence - Exclusive lower bound.
   * @param {number} args.limit - Page size.
   * @param {number} [args.upToSequence] - Inclusive upper bound.
   * @param {Record<string, ?>} [args.scope] - Caller sync scope.
   * @returns {{changes: ServerChangeFeedEntry[], hasMore: boolean, nextSequence: number, oldestSequence: number | null, snapshotRequired: boolean, upToSequence: number}} - Ordered page.
   */
  _memoryChangesAfter({afterSequence, limit, scope, upToSequence}) {
    const latestSequence = typeof upToSequence === "number" ? upToSequence : this._memorySequence
    const oldestSequence = this._memoryChanges[0]?.serverSequence || null
    const snapshotRequired = afterSequence > 0 && oldestSequence !== null && oldestSequence > afterSequence + 1

    if (snapshotRequired) {
      return {changes: [], hasMore: false, nextSequence: afterSequence, oldestSequence, snapshotRequired: true, upToSequence: latestSequence}
    }

    const rows = this._memoryChanges.filter((change) => {
      return change.serverSequence > afterSequence && change.serverSequence <= latestSequence && scopesEqual(change.scope, scope)
    })
    const hasMore = rows.length > limit
    const changes = rows.slice(0, limit)
    const lastChange = changes[changes.length - 1]

    return {changes, hasMore, nextSequence: lastChange ? lastChange.serverSequence : afterSequence, oldestSequence, snapshotRequired: false, upToSequence: latestSequence}
  }

  /**
   * Runs with db.
   * @param {(db: import("../database/drivers/base.js").default) => Promise<?>} callback - Callback.
   * @returns {Promise<?>} - Callback result.
   */
  async _withDb(callback) {
    return await this.configuration.ensureConnections({databaseIdentifiers: [this.databaseIdentifier], name: "Server change-feed store"}, async (dbs) => {
      const db = dbs[this.databaseIdentifier]

      if (!db) throw new Error(`No database connection available for identifier: ${this.databaseIdentifier}`)

      return await callback(db)
    })
  }
}

/**
 * Normalizes page limit.
 * @param {?} limit - Requested limit.
 * @returns {number} - Page size.
 */
function normalizeLimit(limit) {
  if (typeof limit === "number" && Number.isInteger(limit) && limit > 0) return Math.min(limit, MAX_PAGE_SIZE)
  if (typeof limit === "string" && /^\d+$/.test(limit)) return Math.min(Number(limit), MAX_PAGE_SIZE)

  return DEFAULT_PAGE_SIZE
}

/**
 * Parses JSON-ish values.
 * @param {?} value - JSON string.
 * @returns {?} - Parsed value.
 */
function parseJsonOrNull(value) {
  if (typeof value !== "string" || value.length < 1) return null

  return JSON.parse(value)
}

/**
 * Compares sync scopes by stable JSON representation.
 * @param {Record<string, ?> | null} changeScope - Persisted change scope.
 * @param {Record<string, ?> | undefined} requestedScope - Caller scope.
 * @returns {boolean} - Whether the change is visible for the requested scope.
 */
function scopesEqual(changeScope, requestedScope) {
  if (requestedScope === undefined) return true

  return stableJsonStringify(changeScope || null) === stableJsonStringify(requestedScope)
}

/**
 * @typedef {object} ServerChangeFeedEntry
 * @property {string | null} actorDeviceId - Signed mutation actor device id when available.
 * @property {string | null} actorUserId - Signed mutation actor user id when available.
 * @property {Record<string, ?> | null} attributes - Serialized mutation attributes.
 * @property {string} createdAt - Server change creation timestamp.
 * @property {string} id - Server change id.
 * @property {string | null} idempotencyKey - Mutation idempotency key when available.
 * @property {string} model - Frontend model name.
 * @property {string} operation - Mutation operation.
 * @property {Record<string, ?> | null} payload - Serialized mutation payload.
 * @property {string | null} recordId - Changed record id when known.
 * @property {Record<string, ?> | null} response - Command response payload.
 * @property {Record<string, ?> | null} scope - Offline grant scope.
 * @property {number} serverSequence - Monotonic server sequence.
 */

/**
 * @typedef {object} ServerChangeFeedRow
 * @property {string | null} actor_device_id - Actor device id.
 * @property {string | null} actor_user_id - Actor user id.
 * @property {string | null} attributes_json - Attributes JSON.
 * @property {Date | string} created_at - Creation time.
 * @property {string} id - Entry id.
 * @property {string | null} idempotency_key - Mutation idempotency key.
 * @property {string} model - Frontend model name.
 * @property {string} operation - Mutation operation.
 * @property {string | null} payload_json - Mutation payload JSON.
 * @property {string | null} record_id - Record id.
 * @property {string | null} response_json - Response JSON.
 * @property {string | null} scope_json - Scope JSON.
 * @property {number | string} server_sequence - Server sequence.
 */
