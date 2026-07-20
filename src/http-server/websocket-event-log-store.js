// @ts-check

import {randomUUID} from "crypto"
import TableData from "../database/table-data/index.js"
import Logger from "../logger.js"

const EVENTS_TABLE = "websocket_channel_events"
const REPLAY_CHANNELS_TABLE = "websocket_replay_channels"
const DEFAULT_RETENTION_MS = 10 * 60 * 1000
const stores = new WeakMap()

/**
 * WebsocketEventRow type.
 * @typedef {object} WebsocketEventRow
 * @property {string} channel - Channel name.
 * @property {Date | string} created_at - Creation time.
 * @property {string} id - Event id.
 * @property {string} payload_json - Serialized payload.
 * @property {number | string} sequence - Sequence number.
 */

/**
 * WebsocketReplayChannelRow type.
 * @typedef {object} WebsocketReplayChannelRow
 * @property {string} channel - Channel name.
 */

/**
 * Runs the websocketEventLogStoreForConfiguration helper.
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
   * Runs constructor.
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
    this._isReady = false
    this._readyPromise = null
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<string, number>} */
    this._interestedChannels = new Map()
  }

  /**
   * Runs ensure ready.
   * @returns {Promise<void>} - Resolves when ready.
   */
  async ensureReady() {
    if (await this._schemaReady()) return

    if (this._readyPromise) return await this._readyPromise

    this._readyPromise = (async () => {
      this.configuration.setCurrent()
      await this._ensureSchema()
      this._isReady = true
    })()

    try {
      await this._readyPromise
    } finally {
      if (!this._isReady) {
        this._readyPromise = null
      }
    }
  }

  /**
   * Re-validates cached schema readiness because transactional DDL can roll the tables back.
   * @returns {Promise<boolean>} - Whether the cached ready state is still valid.
   */
  async _schemaReady() {
    if (!this._isReady) return false
    if (await this._schemaPresent()) return true

    this._isReady = false
    this._readyPromise = null

    return false
  }

  /**
   * Runs schema present.
   * @returns {Promise<boolean>} - Whether both event-log tables physically exist.
   */
  async _schemaPresent() {
    return await this._withDb(async (db) =>
      await db.tableExists(EVENTS_TABLE) && await db.tableExists(REPLAY_CHANNELS_TABLE)
    )
  }

  /**
   * Runs append event.
   * @param {object} args - Options.
   * @param {string} args.channel - Channel name.
   * @param {?} args.payload - Event payload.
   * @returns {Promise<{channel: string, createdAt: string, id: string, payload: ?}>} - Persisted event row.
   */
  async appendEvent({channel, payload}) {
    await this.ensureReady()

    const id = randomUUID()
    const createdAt = new Date()

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
      return {channel, createdAt: createdAt.toISOString(), id, payload}
    })
  }

  /**
   * Runs mark channel interested.
   * @param {string} channel - Channel name.
   * @returns {Promise<void>} - Resolves when the channel interest was persisted.
   */
  async markChannelInterested(channel) {
    await this.ensureReady()

    const interestedUntil = new Date(Date.now() + this.retentionMs)

    this._interestedChannels.set(channel, interestedUntil.getTime())

    await this._withDb(async (db) => {
      await this._upsertReplayChannelInterest(db, {channel, interestedUntil})
    })
  }

  /**
   * Runs should persist channel.
   * @param {string} channel - Channel name.
   * @returns {Promise<boolean>} - Whether the channel should be persisted for replay.
   */
  async shouldPersistChannel(channel) {
    if (this._channelInterestCached(channel)) return true
    if (this._interestedChannels.size === 0) return false

    await this.ensureReady()

    return await this._withDb(async (db) => {
      const rows = await db
        .newQuery()
        .from(REPLAY_CHANNELS_TABLE)
        .where({channel})
        .where(`interested_until > ${db.quote(new Date())}`)
        .limit(1)
        .results()

      return rows.length > 0
    })
  }

  /**
   * Runs channel interest cached.
   * @param {string} channel - Channel name.
   * @returns {boolean} - Whether memory cache still marks the channel interested.
   */
  _channelInterestCached(channel) {
    const interestedUntil = this._interestedChannels.get(channel)

    if (!interestedUntil) return false
    if (interestedUntil > Date.now()) return true

    this._interestedChannels.delete(channel)

    return false
  }

  /**
   * Runs get event by id.
   * @param {object} args - Options.
   * @param {string} args.channel - Channel name.
   * @param {string} args.id - Event id.
   * @returns {Promise<{channel: string, createdAt: string, id: string, payload: ?, sequence: number} | null>} - Event row or null.
   */
  async getEventById({channel, id}) {
    await this.ensureReady()

    return await this._withDb(async (db) => {
      return await this._getEventById({channel, db, id})
    })
  }

  /**
   * Runs latest sequence.
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
      const row = /** @type {Record<string, ?> | undefined} */ (rows[0])

      if (!row) return null

      return Number(row.sequence)
    })
  }

  /**
   * Runs get events after.
   * @param {object} args - Options.
   * @param {string} args.channel - Channel name.
   * @param {number} args.sequence - Lower bound sequence.
   * @param {number | null | undefined} [args.upToSequence] - Inclusive ceiling sequence.
   * @returns {Promise<Array<{channel: string, createdAt: string, id: string, payload: ?, sequence: number}>>} - Ordered events.
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

      const rows = /** @type {WebsocketEventRow[]} */ (await query.results())

      return rows.map((row) => this._normalizeEventRow(row))
    })
  }

  /**
   * Runs cleanup expired.
   * @param {object} [args] - Options.
   * @param {Date} [args.now] - Cleanup reference time.
   * @returns {Promise<void>} - Resolves when cleanup completes.
   */
  async cleanupExpired({now = new Date()} = {}) {
    await this.ensureReady()

    const cutoff = new Date(now.getTime() - this.retentionMs)

    await this._withDb(async (db) => {
      const expiredEventRows = /** @type {Array<{id: string}>} */ (await db
        .newQuery()
        .from(EVENTS_TABLE)
        .where(`created_at <= ${db.quote(cutoff)}`)
        .results())
      const expiredReplayChannelRows = /** @type {WebsocketReplayChannelRow[]} */ (await db
        .newQuery()
        .from(REPLAY_CHANNELS_TABLE)
        .where(`interested_until <= ${db.quote(now)}`)
        .results())

      for (const expiredEventRow of expiredEventRows) {
        await db.delete({
          tableName: EVENTS_TABLE,
          conditions: {id: expiredEventRow.id}
        })
      }

      for (const expiredReplayChannelRow of expiredReplayChannelRows) {
        await db.delete({
          tableName: REPLAY_CHANNELS_TABLE,
          conditions: {channel: expiredReplayChannelRow.channel}
        })
      }
    })
  }

  async _ensureSchema() {
    await this._withDb(async (db) => {
      await this._ensureEventsTable(db)
      await this._ensureReplayChannelsTable(db)
    })
  }

  /**
   * Runs ensure events table.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _ensureEventsTable(db) {
    this.logger.info("Applying websocket event-log schema")

    if (await db.tableExists(EVENTS_TABLE)) {
      this.logger.info("Websocket event-log table already exists - skipping create")
      return
    }

    const eventTable = new TableData(EVENTS_TABLE, {ifNotExists: true})

    eventTable.integer("sequence", {autoIncrement: true, null: false, primaryKey: true})
    eventTable.string("id", {index: true, null: false})
    eventTable.string("channel", {index: true, null: false})
    eventTable.text("payload_json", {null: false})
    eventTable.datetime("created_at", {index: true, null: false})

    await db.createTable(eventTable)
  }

  /**
   * Runs ensure replay channels table.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _ensureReplayChannelsTable(db) {
    if (await db.tableExists(REPLAY_CHANNELS_TABLE)) return

    const replayChannelTable = new TableData(REPLAY_CHANNELS_TABLE, {ifNotExists: true})

    replayChannelTable.string("channel", {null: false, primaryKey: true})
    replayChannelTable.datetime("interested_until", {index: true, null: false})

    await db.createTable(replayChannelTable)
  }

  /**
   * Runs get event by id.
   * @param {object} args - Options.
   * @param {string} args.channel - Channel name.
   * @param {import("../database/drivers/base.js").default} args.db - Database connection.
   * @param {string} args.id - Event id.
   * @returns {Promise<{channel: string, createdAt: string, id: string, payload: ?, sequence: number} | null>} - Event row or null.
   */
  async _getEventById({channel, db, id}) {
    const rows = /** @type {WebsocketEventRow[]} */ (await db
      .newQuery()
      .from(EVENTS_TABLE)
      .where({channel, id})
      .limit(1)
      .results())

    if (!rows[0]) return null

    return this._normalizeEventRow(rows[0])
  }

  /**
   * Runs normalize event row.
   * @param {WebsocketEventRow} row - Raw row.
   * @returns {{channel: string, createdAt: string, id: string, payload: ?, sequence: number}} - Normalized row.
   */
  _normalizeEventRow(row) {
    const createdAtValue = row.created_at

    return {
      channel: row.channel,
      createdAt: createdAtValue instanceof Date ? createdAtValue.toISOString() : new Date(createdAtValue).toISOString(),
      id: row.id,
      payload: JSON.parse(row.payload_json),
      sequence: Number(row.sequence)
    }
  }

  /**
   * Runs upsert replay channel interest.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {object} args - Options.
   * @param {string} args.channel - Channel name.
   * @param {Date} args.interestedUntil - Retention deadline.
   * @returns {Promise<void>} - Resolves when the replay-channel row was upserted.
   */
  async _upsertReplayChannelInterest(db, {channel, interestedUntil}) {
    await db.upsert({
      conflictColumns: ["channel"],
      data: {
        channel,
        interested_until: interestedUntil
      },
      tableName: REPLAY_CHANNELS_TABLE,
      updateColumns: ["interested_until"]
    })
  }

  /**
   * Runs with db.
   * @param {(db: import("../database/drivers/base.js").default) => Promise<?>} callback - Callback.
   * @returns {Promise<?>} - Callback result.
   */
  async _withDb(callback) {
    return await this.configuration.ensureConnections({databaseIdentifiers: [this.databaseIdentifier], name: "Websocket event log store"}, async (dbs) => {
      const db = dbs[this.databaseIdentifier]

      if (!db) throw new Error(`No database connection available for identifier: ${this.databaseIdentifier}`)

      return await callback(db)
    })
  }
}
