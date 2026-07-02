// @ts-check

import TableData from "../database/table-data/index.js"
import UUID from "pure-uuid"

import {scopeKey} from "./query-scope.js"
import stableJsonStringify from "./stable-json.js"

const TABLE_NAME = "velocious_sync_scopes"

/**
 * @typedef {object} SyncScopeRow
 * @property {Record<string, ?>} conditions - Scope attribute conditions.
 * @property {string | null} cursorPayload - Persisted cursor JSON payload.
 * @property {string} id - Scope row id.
 * @property {string} resourceType - Scope resource/model name.
 * @property {string} scopeKey - Stable canonical scope key.
 * @property {string} state - Scope state ("active" or "removed").
 */

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
   */
  constructor({configuration, databaseIdentifier = "default"}) {
    this.configuration = configuration
    this.databaseIdentifier = databaseIdentifier
    /** @type {Map<string, SyncScopeRow>} */
    this._memoryScopes = new Map()
    this._isReady = false
    /** @type {Promise<void> | null} */
    this._readyPromise = null
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

    if (this._readyPromise) return await this._readyPromise

    this._readyPromise = this._withDb(async (db) => {
      await this._ensureScopesTable(db)
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

    const key = scopeKey(scope)

    if (this._usesMemoryStorage()) {
      const existingScope = this._memoryScopes.get(key)

      if (existingScope) {
        if (existingScope.state !== "active") existingScope.state = "active"

        return existingScope
      }

      const newScope = {
        conditions: scope.conditions,
        cursorPayload: null,
        id: new UUID(4).format(),
        resourceType: scope.resourceType,
        scopeKey: key,
        state: "active"
      }

      this._memoryScopes.set(key, newScope)

      return newScope
    }

    return await this._withDb(async (db) => {
      const existingRow = await this._rowByScopeKey(db, key)

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
          resource_type: scope.resourceType,
          scope_key: key,
          state: "active",
          updated_at: new Date()
        }
      })

      const createdRow = await this._rowByScopeKey(db, key)

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
      const rows = /** @type {Array<Record<string, ?>>} */ (await db
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
    await this.ensureReady()

    if (this._usesMemoryStorage()) {
      return this._memoryScopes.get(scopeRow.scopeKey)?.cursorPayload ?? null
    }

    return await this._withDb(async (db) => {
      const row = await this._rowByScopeKey(db, scopeRow.scopeKey)

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
    if (!cursor) return

    await this.ensureReady()

    const cursorPayload = JSON.stringify(cursor)

    if (this._usesMemoryStorage()) {
      const memoryScope = this._memoryScopes.get(scopeRow.scopeKey)

      if (!memoryScope) throw new Error(`No sync scope found for: ${scopeRow.scopeKey}`)

      memoryScope.cursorPayload = cursorPayload
      return
    }

    await this._withDb(async (db) => {
      await db.update({
        conditions: {scope_key: scopeRow.scopeKey},
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

    const key = scopeKey(scope)

    if (this._usesMemoryStorage()) {
      const memoryScope = this._memoryScopes.get(key)

      if (memoryScope) memoryScope.state = "removed"

      return
    }

    await this._withDb(async (db) => {
      await db.update({conditions: {scope_key: key}, data: {state: "removed", updated_at: new Date()}, tableName: TABLE_NAME})
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
    return await this.configuration.ensureConnections({name: "Sync scope store"}, async (dbs) => {
      const db = dbs[this.databaseIdentifier]

      if (!db) throw new Error(`No database connection available for identifier: ${this.databaseIdentifier}`)

      return await callback(db)
    })
  }

  /**
   * Ensures the scopes table exists.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>}
   */
  async _ensureScopesTable(db) {
    if (await db.tableExists(TABLE_NAME)) return

    const table = new TableData(TABLE_NAME, {ifNotExists: true})

    table.string("id", {null: false, primaryKey: true})
    table.string("scope_key", {index: true, null: false})
    table.string("resource_type", {index: true, null: false})
    table.text("conditions_json", {null: false})
    table.text("cursor_json", {null: true})
    table.string("state", {index: true, null: false})
    table.datetime("created_at", {null: false})
    table.datetime("updated_at", {null: false})

    await db.createTable(table)
  }

  /**
   * Resolves a scope row by its stable key.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} key - Stable scope key.
   * @returns {Promise<SyncScopeRow | null>} Scope row or null.
   */
  async _rowByScopeKey(db, key) {
    const rows = /** @type {Array<Record<string, ?>>} */ (await db
      .newQuery()
      .from(TABLE_NAME)
      .where({scope_key: key})
      .limit(1)
      .results())

    return rows[0] ? this._normalizeScopeRow(rows[0]) : null
  }

  /**
   * Normalizes a raw scope table row.
   * @param {Record<string, ?>} row - Raw table row.
   * @returns {SyncScopeRow} Normalized scope row.
   */
  _normalizeScopeRow(row) {
    return {
      conditions: /** @type {Record<string, ?>} */ (JSON.parse(String(row.conditions_json))),
      cursorPayload: row.cursor_json === null || row.cursor_json === undefined ? null : String(row.cursor_json),
      id: String(row.id),
      resourceType: String(row.resource_type),
      scopeKey: String(row.scope_key),
      state: String(row.state)
    }
  }
}
