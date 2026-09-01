// @ts-check

import TableData from "../database/table-data/index.js"
import UUID from "pure-uuid"

import {scopeKey} from "./query-scope.js"
import stableJsonStringify from "./stable-json.js"

/**
 * @typedef {object} SyncScopeRow
 * @property {Record<string, ReturnType<typeof JSON.parse>>} conditions - Scope attribute conditions.
 * @property {string | null} cursorPayload - Persisted cursor JSON payload.
 * @property {string} id - Scope row id.
 * @property {string | null} resourceType - Scope resource/model name, or null for the all-types (user) scope.
 * @property {string} scopeDigest - Fixed-size deterministic digest of the canonical scope key.
 * @property {string} state - Scope state ("active" or "removed").
 * @property {string} storeIdentity - Physical store identity owning this row.
 */
const TABLE_NAME = "velocious_sync_scopes"
const SCOPE_DIGEST_PREFIX = "velocious-sync-scope:"

/**
 * Digests a serialized scope into a fixed-size deterministic key, so scope
 * identities with long condition values fit an indexed string column.
 * @param {import("./sync-client-types.js").SerializedSyncScope} scope - Serialized sync scope.
 * @returns {string} Deterministic UUIDv5 digest of the canonical scope key.
 */
function scopeDigestForScope(scope) {
  return new UUID(5, "ns:URL", `${SCOPE_DIGEST_PREFIX}${scopeKey(scope)}`).format()
}

/**
 * Framework-owned local persistence for declared sync scopes and their cursors.
 *
 * Backed by an auto-created `velocious_sync_scopes` table on the configured
 * database, with a process-local memory fallback when no database is
 * configured (mirroring the server change-feed store).
 */
export default class SyncScopeStore {
  /**
   * Creates a sync scope store.
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
    /** @type {Map<string, SyncScopeRow>} */
    this._memoryScopes = new Map()
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
      const tableReadyPromise = this._ensureScopesTable(db)
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

    this._readyPromise = this._ensureScopesTable(db).then(() => {
      this._isReady = true
    })

    try {
      await this._readyPromise
    } finally {
      if (!this._isReady) this._readyPromise = null
    }
  }

  /**
   * Finds or creates the scope row for a serialized scope, reactivating removed scopes.
   * @param {import("./sync-client-types.js").SerializedSyncScope} scope - Serialized sync scope.
   * @returns {Promise<SyncScopeRow>} Persisted scope row.
   */
  async findOrCreateScope(scope) {
    await this.ensureReady()

    const digest = scopeDigestForScope(scope)

    if (this._usesMemoryStorage()) {
      const existingScope = this._memoryScopes.get(digest)

      if (existingScope) {
        if (existingScope.state !== "active") existingScope.state = "active"

        return existingScope
      }

      const newScope = {
        conditions: scope.conditions,
        cursorPayload: null,
        id: new UUID(4).format(),
        resourceType: scope.resourceType ?? null,
        scopeDigest: digest,
        state: "active",
        storeIdentity: this.storeIdentity
      }

      this._memoryScopes.set(digest, newScope)

      return newScope
    }

    return await this._withDb(async (db) => {
      const existingRow = await this._rowByScopeDigest(db, digest)

      if (existingRow) {
        if (existingRow.state !== "active") {
          await db.update({conditions: {id: existingRow.id}, data: {state: "active", updated_at: new Date()}, tableName: TABLE_NAME})
          existingRow.state = "active"
        }

        return existingRow
      }

      await db.insert({
        tableName: TABLE_NAME,
        data: {
          conditions_json: stableJsonStringify(scope.conditions),
          created_at: new Date(),
          cursor_json: null,
          id: new UUID(4).format(),
          // The all-types (user) scope has no resource type; the column is non-null, so it
          // stores as an empty string and normalizes back to null on read.
          resource_type: scope.resourceType ?? "",
          scope_digest: digest,
          state: "active",
          updated_at: new Date()
        }
      })

      const createdRow = await this._rowByScopeDigest(db, digest)

      if (!createdRow) throw new Error("Failed to persist sync scope")

      return createdRow
    })
  }

  /**
   * Returns all active scope rows.
   * @returns {Promise<SyncScopeRow[]>} Active scope rows.
   */
  async activeScopes() {
    await this.ensureReady()

    if (this._usesMemoryStorage()) {
      return [...this._memoryScopes.values()].filter((scope) => scope.state === "active")
    }

    return await this._withDb(async (db) => {
      const rows = /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */ (await db
        .newQuery()
        .from(TABLE_NAME)
        .where({state: "active"})
        .order("created_at ASC")
        .results())

      return rows.map((row) => this._normalizeScopeRow(row))
    })
  }

  /**
   * Loads the persisted cursor payload for a scope row.
   * @param {SyncScopeRow} scopeRow - Scope row.
   * @returns {Promise<string | null>} Cursor JSON payload.
   */
  async loadCursor(scopeRow) {
    this._assertScopeRow(scopeRow)
    await this.ensureReady()

    if (this._usesMemoryStorage()) {
      return this._memoryScopes.get(scopeRow.scopeDigest)?.cursorPayload ?? null
    }

    return await this._withDb(async (db) => {
      const row = await this._rowByScopeDigest(db, scopeRow.scopeDigest)

      return row ? row.cursorPayload : null
    })
  }

  /**
   * Persists the acknowledged cursor for a scope row.
   * @param {SyncScopeRow} scopeRow - Scope row.
   * @param {import("./sync-api-client-types.js").SyncCursor} cursor - Acknowledged cursor.
   * @returns {Promise<void>}
   */
  async saveCursor(scopeRow, cursor) {
    this._assertScopeRow(scopeRow)
    if (!cursor) return

    await this.ensureReady()

    const cursorPayload = JSON.stringify(cursor)

    if (this._usesMemoryStorage()) {
      const memoryScope = this._memoryScopes.get(scopeRow.scopeDigest)

      if (!memoryScope) throw new Error(`No sync scope found for: ${scopeRow.scopeDigest}`)

      memoryScope.cursorPayload = cursorPayload
      return
    }

    await this._withDb(async (db) => {
      await db.update({
        conditions: {scope_digest: scopeRow.scopeDigest},
        data: {cursor_json: cursorPayload, updated_at: new Date()},
        tableName: TABLE_NAME
      })
    })
  }

  /**
   * Deactivates the scope row for a serialized scope.
   * @param {import("./sync-client-types.js").SerializedSyncScope} scope - Serialized sync scope.
   * @returns {Promise<void>}
   */
  async deactivate(scope) {
    await this.ensureReady()

    const digest = scopeDigestForScope(scope)

    if (this._usesMemoryStorage()) {
      const memoryScope = this._memoryScopes.get(digest)

      if (memoryScope) memoryScope.state = "removed"

      return
    }

    await this._withDb(async (db) => {
      await db.update({conditions: {scope_digest: digest}, data: {state: "removed", updated_at: new Date()}, tableName: TABLE_NAME})
    })
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
      return await this.tenantHandle.databaseOperation({databaseIdentifier: this.databaseIdentifier, name: "Tenant sync scope store"}, async (operation) => {
        return await callback(operation.connection())
      })
    }

    return await this.configuration.ensureConnections({databaseIdentifiers: [this.databaseIdentifier], name: "Sync scope store"}, async (dbs) => {
      const db = dbs[this.databaseIdentifier]

      if (!db) throw new Error(`No database connection available for identifier: ${this.databaseIdentifier}`)

      return await callback(db)
    })
  }

  /**
   * Ensures the scopes table exists.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<boolean>} Whether the table had to be created.
   */
  async _ensureScopesTable(db) {
    if (await db.tableExists(TABLE_NAME)) return false

    const table = new TableData(TABLE_NAME, {ifNotExists: true})

    table.string("id", {null: false, primaryKey: true})
    table.string("scope_digest", {index: true, null: false})
    table.string("resource_type", {index: true, null: false})
    table.text("conditions_json", {null: false})
    table.text("cursor_json", {null: true})
    table.string("state", {index: true, null: false})
    table.datetime("created_at", {null: false})
    table.datetime("updated_at", {null: false})

    await db.createTable(table)

    return true
  }

  /**
   * Resolves a scope row by its digest.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} digest - Fixed-size scope digest.
   * @returns {Promise<SyncScopeRow | null>} Scope row or null.
   */
  async _rowByScopeDigest(db, digest) {
    const rows = /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */ (await db
      .newQuery()
      .from(TABLE_NAME)
      .where({scope_digest: digest})
      .limit(1)
      .results())

    return rows[0] ? this._normalizeScopeRow(rows[0]) : null
  }

  /**
   * Normalizes a raw scope table row.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} row - Raw table row.
   * @returns {SyncScopeRow} Normalized scope row.
   */
  _normalizeScopeRow(row) {
    return {
      conditions: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (JSON.parse(String(row.conditions_json))),
      cursorPayload: row.cursor_json === null || row.cursor_json === undefined ? null : String(row.cursor_json),
      id: String(row.id),
      resourceType: String(row.resource_type) === "" ? null : String(row.resource_type),
      scopeDigest: String(row.scope_digest),
      state: String(row.state),
      storeIdentity: this.storeIdentity
    }
  }

  /**
   * Rejects passing a scope row captured from another physical store.
   * @param {SyncScopeRow} scopeRow - Scope row to validate.
   * @returns {void}
   */
  _assertScopeRow(scopeRow) {
    if (scopeRow.storeIdentity !== this.storeIdentity) {
      throw new Error("Sync scope row belongs to another physical tenant database")
    }
  }
}
