// @ts-check

import {randomUUID} from "crypto"
import TableData from "../database/table-data/index.js"
import Logger from "../logger.js"

const MIGRATIONS_TABLE = "velocious_internal_migrations"
const MIGRATION_SCOPE = "websocket_event_log"
const MIGRATION_VERSION = "20260407000000"
const EVENTS_TABLE = "websocket_channel_events"
const DEFAULT_RETENTION_MS = 10 * 60 * 1000
const stores = new WeakMap()

/**
 * @param {import("../configuration.js").default} configuration - Configuration.
 * @returns {VelociousHttpServerWebsocketEventLogStore} - Shared store instance.
 */
export function websocketEventLogStoreForConfiguration(configuration) {
  let store = stores.get(configuration)

  if (!store) {
    store = new VelociousHttpServerWebsocketEventLogStore({configuration})
    stores.set(configuration, store)
  }

  return store
}

export default class VelociousHttpServerWebsocketEventLogStore {
  /**
   * @param {object} args - Options.
   * @param {import("../configuration.js").default} args.configuration - Configuration.
   * @param {string} [args.databaseIdentifier] - Database identifier.
   * @param {number} [args.retentionMs] - Event retention in milliseconds.
   */
  constructor({configuration, databaseIdentifier = "default", retentionMs = DEFAULT_RETENTION_MS}) {
    this.configuration = configuration
    this.databaseIdentifier = databaseIdentifier
    this.retentionMs = retentionMs
    this.logger = new Logger(this)
    this._readyPromise = null
  }

  /**
   * @returns {Promise<void>} - Resolves when ready.
   */
  async ensureReady() {
    if (this._readyPromise) return await this._readyPromise

    this._readyPromise = (async () => {
      this.configuration.setCurrent()
      await this._ensureSchema()
    })()

    try {
      await this._readyPromise
    } finally {
      this._readyPromise = null
    }
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.channel - Channel name.
   * @param {unknown} args.payload - Event payload.
   * @returns {Promise<{channel: string, createdAt: string, id: string, payload: unknown}>} - Persisted event row.
   */
  async appendEvent({channel, payload}) {
    await this.ensureReady()

    const id = randomUUID()
    const createdAt = new Date().toISOString()

    return await this._withDb(async (db) => {
      await db.insert({
        tableName: EVENTS_TABLE,
        data: {
          channel,
          created_at: createdAt,
          id,
          payload_json: JSON.stringify(payload)
        }
      })
      return {channel, createdAt, id, payload}
    })
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.channel - Channel name.
   * @param {string} args.id - Event id.
   * @returns {Promise<{channel: string, createdAt: string, id: string, payload: unknown, sequence: number} | null>} - Event row or null.
   */
  async getEventById({channel, id}) {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      return await this._getEventById({channel, db, id})
    })
  }

  /**
   * @param {string} channel - Channel name.
   * @returns {Promise<number | null>} - Latest channel sequence.
   */
  async latestSequence(channel) {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      const rows = await db
        .newQuery()
        .from(EVENTS_TABLE)
        .where({channel})
        .order("sequence DESC")
        .limit(1)
        .results()

      if (!rows[0]) return null

      return Number(rows[0].sequence)
    })
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.channel - Channel name.
   * @param {number} args.sequence - Lower bound sequence.
   * @param {number | null | undefined} [args.upToSequence] - Inclusive ceiling sequence.
   * @returns {Promise<Array<{channel: string, createdAt: string, id: string, payload: unknown, sequence: number}>>} - Ordered events.
   */
  async getEventsAfter({channel, sequence, upToSequence}) {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      const query = db
        .newQuery()
        .from(EVENTS_TABLE)
        .where({channel})
        .where(`sequence > ${db.quote(sequence)}`)
        .order("sequence ASC")

      if (typeof upToSequence === "number") {
        query.where(`sequence <= ${db.quote(upToSequence)}`)
      }

      const rows = await query.results()

      return rows.map((row) => this._normalizeEventRow(row))
    })
  }

  /**
   * @param {object} [args] - Options.
   * @param {Date} [args.now] - Cleanup reference time.
   * @returns {Promise<void>} - Resolves when cleanup completes.
   */
  async cleanupExpired({now = new Date()} = {}) {
    await this.ensureReady()

    const cutoff = new Date(now.getTime() - this.retentionMs).toISOString()

    await this._withDb(async (db) => {
      await db.query(`DELETE FROM ${db.quoteTable(EVENTS_TABLE)} WHERE created_at <= ${db.quote(cutoff)}`)
    })
  }

  async _ensureSchema() {
    await this._withDb(async (db) => {
      await this._ensureMigrationsTable(db)

      const alreadyApplied = await this._hasMigration(db)

      if (alreadyApplied) return

      await this._applyMigrations(db)
      await db.insert({
        tableName: MIGRATIONS_TABLE,
        data: {
          applied_at_ms: Date.now(),
          key: this._migrationKey(),
          scope: MIGRATION_SCOPE,
          version: MIGRATION_VERSION
        }
      })
    })
  }

  /**
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _ensureMigrationsTable(db) {
    if (await db.tableExists(MIGRATIONS_TABLE)) return

    const table = new TableData(MIGRATIONS_TABLE, {ifNotExists: true})

    table.string("key", {null: false, primaryKey: true})
    table.string("scope", {null: false})
    table.string("version", {null: false})
    table.bigint("applied_at_ms", {null: false})

    await db.createTable(table)
  }

  /**
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<boolean>} - Whether the migration exists.
   */
  async _hasMigration(db) {
    const rows = await db
      .newQuery()
      .from(MIGRATIONS_TABLE)
      .where({key: this._migrationKey()})
      .limit(1)
      .results()

    return rows.length > 0
  }

  /**
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _applyMigrations(db) {
    this.logger.info("Applying websocket event-log schema")

    if (await db.tableExists(EVENTS_TABLE)) {
      this.logger.info("Websocket event-log table already exists - skipping create")
      return
    }

    const table = new TableData(EVENTS_TABLE, {ifNotExists: true})

    table.integer("sequence", {autoIncrement: true, null: false, primaryKey: true})
    table.string("id", {index: true, null: false})
    table.string("channel", {index: true, null: false})
    table.text("payload_json", {null: false})
    table.datetime("created_at", {index: true, null: false})

    await db.createTable(table)
  }

  /**
   * @returns {string} - Migration key.
   */
  _migrationKey() {
    return `${MIGRATION_SCOPE}:${MIGRATION_VERSION}`
  }

  /**
   * @param {object} args - Options.
   * @param {string} args.channel - Channel name.
   * @param {import("../database/drivers/base.js").default} args.db - Database connection.
   * @param {string} args.id - Event id.
   * @returns {Promise<{channel: string, createdAt: string, id: string, payload: unknown, sequence: number} | null>} - Event row or null.
   */
  async _getEventById({channel, db, id}) {
    const rows = await db
      .newQuery()
      .from(EVENTS_TABLE)
      .where({channel, id})
      .limit(1)
      .results()

    if (!rows[0]) return null

    return this._normalizeEventRow(rows[0])
  }

  /**
   * @param {Record<string, any>} row - Raw row.
   * @returns {{channel: string, createdAt: string, id: string, payload: unknown, sequence: number}} - Normalized row.
   */
  _normalizeEventRow(row) {
    return {
      channel: String(row.channel),
      createdAt: String(row.created_at),
      id: String(row.id),
      payload: JSON.parse(String(row.payload_json)),
      sequence: Number(row.sequence)
    }
  }

  /**
   * @param {(db: import("../database/drivers/base.js").default) => Promise<any>} callback - Callback.
   * @returns {Promise<any>} - Callback result.
   */
  async _withDb(callback) {
    return await this.configuration.getDatabasePool(this.databaseIdentifier).withConnection(async (db) => {
      return await callback(db)
    })
  }
}
