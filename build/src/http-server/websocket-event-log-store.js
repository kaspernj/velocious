// @ts-check
import { randomUUID } from "crypto";
import TableData from "../database/table-data/index.js";
import Logger from "../logger.js";
/**
 * WebsocketEventRow type.
 * @typedef {object} WebsocketEventRow
 * @property {string} channel - Channel name.
 * @property {Date | string} created_at - Creation time.
 * @property {string} id - Event id.
 * @property {string} payload_json - Serialized payload.
 * @property {string | null} params_json - Serialized broadcast params, or null when the publish carried none.
 * @property {number | string} sequence - Sequence number.
 */
/**
 * WebsocketReplayChannelRow type.
 * @typedef {object} WebsocketReplayChannelRow
 * @property {string} channel - Channel name.
 */
/**
 * Normalized persisted websocket event.
 * @typedef {object} WebsocketPersistedEvent
 * @property {string} channel - Channel name.
 * @property {string} createdAt - ISO creation time.
 * @property {string} id - Event id.
 * @property {Record<string, ReturnType<typeof JSON.parse>> | null} params - Persisted broadcast params, or null when the publish carried none.
 * @property {ReturnType<typeof JSON.parse>} payload - Event payload.
 * @property {number} sequence - Sequence number.
 */
const EVENTS_TABLE = "websocket_channel_events";
const REPLAY_CHANNELS_TABLE = "websocket_replay_channels";
const DEFAULT_RETENTION_MS = 10 * 60 * 1000;
const stores = new WeakMap();
/**
 * Runs the websocketEventLogStoreForConfiguration helper.
 * @param {import("../configuration.js").default} configuration - Configuration.
 * @returns {VelociousHttpServerWebsocketEventLogStore} - Shared store instance.
 */
export function websocketEventLogStoreForConfiguration(configuration) {
    let store = stores.get(configuration);
    if (!store) {
        store = new VelociousHttpServerWebsocketEventLogStore({ configuration });
        stores.set(configuration, store);
    }
    return store;
}
export default class VelociousHttpServerWebsocketEventLogStore {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} [args.databaseIdentifier] - Database identifier.
     * @param {number} [args.retentionMs] - Event retention in milliseconds.
     */
    constructor({ configuration, databaseIdentifier = "default", retentionMs = DEFAULT_RETENTION_MS }) {
        this.configuration = configuration;
        this.databaseIdentifier = databaseIdentifier;
        this.retentionMs = retentionMs;
        this.logger = new Logger(this);
        this._isReady = false;
        this._readyPromise = null;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Map<string, number>} */
        this._interestedChannels = new Map();
    }
    /**
     * Runs ensure ready.
     * @returns {Promise<void>} - Resolves when ready.
     */
    async ensureReady() {
        if (await this._schemaReady())
            return;
        if (this._readyPromise)
            return await this._readyPromise;
        this._readyPromise = (async () => {
            this.configuration.setCurrent();
            await this._ensureSchema();
            this._isReady = true;
        })();
        try {
            await this._readyPromise;
        }
        finally {
            if (!this._isReady) {
                this._readyPromise = null;
            }
        }
    }
    /**
     * Re-validates cached schema readiness because transactional DDL can roll the tables back.
     * @returns {Promise<boolean>} - Whether the cached ready state is still valid.
     */
    async _schemaReady() {
        if (!this._isReady)
            return false;
        if (await this._schemaPresent())
            return true;
        this._isReady = false;
        this._readyPromise = null;
        return false;
    }
    /**
     * Runs schema present.
     * @returns {Promise<boolean>} - Whether both event-log tables exist and the events table carries every required column.
     */
    async _schemaPresent() {
        return await this._withDb(async (db) => (await db.tableExists(EVENTS_TABLE) && await db.tableExists(REPLAY_CHANNELS_TABLE))
            && (await this._columnPresent(db, EVENTS_TABLE, "params_json")));
    }
    /**
     * Runs column present.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} tableName - Table name.
     * @param {string} columnName - Column name.
     * @returns {Promise<boolean>} - Whether the column exists on the table.
     */
    async _columnPresent(db, tableName, columnName) {
        const tables = await db.getTables();
        const table = tables.find((candidate) => candidate.getName() == tableName);
        if (!table)
            return false;
        return (await table.getColumnByName(columnName)) !== undefined;
    }
    /**
     * Runs append event.
     * @param {object} args - Options.
     * @param {string} args.channel - Channel name.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Event payload.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | null} [args.params] - Broadcast params to persist for stream-scoped replay, or null when the publish carried none.
     * @returns {Promise<WebsocketPersistedEvent>} - Persisted event row.
     */
    async appendEvent({ channel, params = null, payload }) {
        await this.ensureReady();
        const id = randomUUID();
        const createdAt = new Date();
        return await this._withDb(async (db) => {
            await db.insert({
                tableName: EVENTS_TABLE,
                data: {
                    channel,
                    created_at: createdAt,
                    id,
                    params_json: params === null ? null : JSON.stringify(params),
                    payload_json: JSON.stringify(payload)
                }
            });
            return { channel, createdAt: createdAt.toISOString(), id, params, payload };
        });
    }
    /**
     * Runs mark channel interested.
     * @param {string} channel - Channel name.
     * @returns {Promise<void>} - Resolves when the channel interest was persisted.
     */
    async markChannelInterested(channel) {
        await this.ensureReady();
        const interestedUntil = new Date(Date.now() + this.retentionMs);
        this._interestedChannels.set(channel, interestedUntil.getTime());
        await this._withDb(async (db) => {
            await this._upsertReplayChannelInterest(db, { channel, interestedUntil });
        });
    }
    /**
     * Runs should persist channel.
     * @param {string} channel - Channel name.
     * @returns {Promise<boolean>} - Whether the channel should be persisted for replay.
     */
    async shouldPersistChannel(channel) {
        if (this._channelInterestCached(channel))
            return true;
        if (this._interestedChannels.size === 0)
            return false;
        await this.ensureReady();
        return await this._withDb(async (db) => {
            const rows = await db
                .newQuery()
                .from(REPLAY_CHANNELS_TABLE)
                .where({ channel })
                .where(`interested_until > ${db.quote(new Date())}`)
                .limit(1)
                .results();
            return rows.length > 0;
        });
    }
    /**
     * Runs channel interest cached.
     * @param {string} channel - Channel name.
     * @returns {boolean} - Whether memory cache still marks the channel interested.
     */
    _channelInterestCached(channel) {
        const interestedUntil = this._interestedChannels.get(channel);
        if (!interestedUntil)
            return false;
        if (interestedUntil > Date.now())
            return true;
        this._interestedChannels.delete(channel);
        return false;
    }
    /**
     * Runs get event by id.
     * @param {object} args - Options.
     * @param {string} args.channel - Channel name.
     * @param {string} args.id - Event id.
     * @returns {Promise<WebsocketPersistedEvent | null>} - Event row or null.
     */
    async getEventById({ channel, id }) {
        await this.ensureReady();
        return await this._withDb(async (db) => {
            return await this._getEventById({ channel, db, id });
        });
    }
    /**
     * Runs latest sequence.
     * @param {string} channel - Channel name.
     * @returns {Promise<number | null>} - Latest channel sequence.
     */
    async latestSequence(channel) {
        await this.ensureReady();
        return await this._withDb(async (db) => {
            const rows = await db
                .newQuery()
                .from(EVENTS_TABLE)
                .where({ channel })
                .order("sequence DESC")
                .limit(1)
                .results();
            const row = /** @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */ (rows[0]);
            if (!row)
                return null;
            return Number(row.sequence);
        });
    }
    /**
     * Runs get events after.
     * @param {object} args - Options.
     * @param {string} args.channel - Channel name.
     * @param {number} args.sequence - Lower bound sequence.
     * @param {number | null | undefined} [args.upToSequence] - Inclusive ceiling sequence.
     * @returns {Promise<WebsocketPersistedEvent[]>} - Ordered events.
     */
    async getEventsAfter({ channel, sequence, upToSequence }) {
        await this.ensureReady();
        return await this._withDb(async (db) => {
            const query = db
                .newQuery()
                .from(EVENTS_TABLE)
                .where({ channel })
                .where(`sequence > ${db.quote(sequence)}`)
                .order("sequence ASC");
            if (typeof upToSequence === "number") {
                query.where(`sequence <= ${db.quote(upToSequence)}`);
            }
            const rows = /** @type {WebsocketEventRow[]} */ (await query.results());
            return rows.map((row) => this._normalizeEventRow(row));
        });
    }
    /**
     * Runs cleanup expired.
     * @param {object} [args] - Options.
     * @param {Date} [args.now] - Cleanup reference time.
     * @returns {Promise<void>} - Resolves when cleanup completes.
     */
    async cleanupExpired({ now = new Date() } = {}) {
        await this.ensureReady();
        const cutoff = new Date(now.getTime() - this.retentionMs);
        await this._withDb(async (db) => {
            const expiredEventRows = /** @type {Array<{id: string}>} */ (await db
                .newQuery()
                .from(EVENTS_TABLE)
                .where(`created_at <= ${db.quote(cutoff)}`)
                .results());
            const expiredReplayChannelRows = /** @type {WebsocketReplayChannelRow[]} */ (await db
                .newQuery()
                .from(REPLAY_CHANNELS_TABLE)
                .where(`interested_until <= ${db.quote(now)}`)
                .results());
            for (const expiredEventRow of expiredEventRows) {
                await db.delete({
                    tableName: EVENTS_TABLE,
                    conditions: { id: expiredEventRow.id }
                });
            }
            for (const expiredReplayChannelRow of expiredReplayChannelRows) {
                await db.delete({
                    tableName: REPLAY_CHANNELS_TABLE,
                    conditions: { channel: expiredReplayChannelRow.channel }
                });
            }
        });
    }
    async _ensureSchema() {
        await this._withDb(async (db) => {
            await this._ensureEventsTable(db);
            await this._ensureReplayChannelsTable(db);
        });
    }
    /**
     * Runs ensure events table.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _ensureEventsTable(db) {
        if (await db.tableExists(EVENTS_TABLE)) {
            await this._ensureEventsTableColumns(db);
            return;
        }
        this.logger.info("Applying websocket event-log schema");
        const eventTable = new TableData(EVENTS_TABLE, { ifNotExists: true });
        eventTable.integer("sequence", { autoIncrement: true, null: false, primaryKey: true });
        eventTable.string("id", { index: true, null: false });
        eventTable.string("channel", { index: true, null: false });
        eventTable.text("params_json", { null: true });
        eventTable.text("payload_json", { null: false });
        eventTable.datetime("created_at", { index: true, null: false });
        await db.createTable(eventTable);
    }
    /**
     * Adds columns the current schema requires to an events table created by an
     * older framework version, so upgrades keep working without a manual ALTER.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when the events table schema is current.
     */
    async _ensureEventsTableColumns(db) {
        if (await this._columnPresent(db, EVENTS_TABLE, "params_json"))
            return;
        this.logger.info("Adding params_json column to websocket event-log table");
        const tableData = new TableData(EVENTS_TABLE);
        tableData.addColumn("params_json", { isNewColumn: true, null: true, type: "text" });
        for (const sql of await db.alterTableSQLs(tableData)) {
            await db.query(sql);
        }
    }
    /**
     * Runs ensure replay channels table.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _ensureReplayChannelsTable(db) {
        if (await db.tableExists(REPLAY_CHANNELS_TABLE))
            return;
        const replayChannelTable = new TableData(REPLAY_CHANNELS_TABLE, { ifNotExists: true });
        replayChannelTable.string("channel", { null: false, primaryKey: true });
        replayChannelTable.datetime("interested_until", { index: true, null: false });
        await db.createTable(replayChannelTable);
    }
    /**
     * Runs get event by id.
     * @param {object} args - Options.
     * @param {string} args.channel - Channel name.
     * @param {import("../database/drivers/base.js").default} args.db - Database connection.
     * @param {string} args.id - Event id.
     * @returns {Promise<WebsocketPersistedEvent | null>} - Event row or null.
     */
    async _getEventById({ channel, db, id }) {
        const rows = /** @type {WebsocketEventRow[]} */ (await db
            .newQuery()
            .from(EVENTS_TABLE)
            .where({ channel, id })
            .limit(1)
            .results());
        if (!rows[0])
            return null;
        return this._normalizeEventRow(rows[0]);
    }
    /**
     * Runs normalize event row.
     * @param {WebsocketEventRow} row - Raw row.
     * @returns {WebsocketPersistedEvent} - Normalized row.
     */
    _normalizeEventRow(row) {
        const createdAtValue = row.created_at;
        return {
            channel: row.channel,
            createdAt: createdAtValue instanceof Date ? createdAtValue.toISOString() : new Date(createdAtValue).toISOString(),
            id: row.id,
            params: row.params_json === null || row.params_json === undefined ? null : JSON.parse(row.params_json),
            payload: JSON.parse(row.payload_json),
            sequence: Number(row.sequence)
        };
    }
    /**
     * Runs upsert replay channel interest.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} args - Options.
     * @param {string} args.channel - Channel name.
     * @param {Date} args.interestedUntil - Retention deadline.
     * @returns {Promise<void>} - Resolves when the replay-channel row was upserted.
     */
    async _upsertReplayChannelInterest(db, { channel, interestedUntil }) {
        await db.upsert({
            conflictColumns: ["channel"],
            data: {
                channel,
                interested_until: interestedUntil
            },
            tableName: REPLAY_CHANNELS_TABLE,
            updateColumns: ["interested_until"]
        });
    }
    /**
     * Runs with db.
     * @param {(db: import("../database/drivers/base.js").default) => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    async _withDb(callback) {
        return await this.configuration.ensureConnections({ databaseIdentifiers: [this.databaseIdentifier], name: "Websocket event log store" }, async (dbs) => {
            const db = dbs[this.databaseIdentifier];
            if (!db)
                throw new Error(`No database connection available for identifier: ${this.databaseIdentifier}`);
            return await callback(db);
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWV2ZW50LWxvZy1zdG9yZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci93ZWJzb2NrZXQtZXZlbnQtbG9nLXN0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sUUFBUSxDQUFBO0FBQ2pDLE9BQU8sU0FBUyxNQUFNLGlDQUFpQyxDQUFBO0FBQ3ZELE9BQU8sTUFBTSxNQUFNLGNBQWMsQ0FBQTtBQUVqQzs7Ozs7Ozs7O0dBU0c7QUFDSDs7OztHQUlHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBTSxZQUFZLEdBQUcsMEJBQTBCLENBQUE7QUFDL0MsTUFBTSxxQkFBcUIsR0FBRywyQkFBMkIsQ0FBQTtBQUN6RCxNQUFNLG9CQUFvQixHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFBO0FBQzNDLE1BQU0sTUFBTSxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFNUI7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSxzQ0FBc0MsQ0FBQyxhQUFhO0lBQ2xFLElBQUksS0FBSyxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUE7SUFFckMsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ1gsS0FBSyxHQUFHLElBQUkseUNBQXlDLENBQUMsRUFBQyxhQUFhLEVBQUMsQ0FBQyxDQUFBO1FBQ3RFLE1BQU0sQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxDQUFBO0lBQ2xDLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUM7QUFFRCxNQUFNLENBQUMsT0FBTyxPQUFPLHlDQUF5QztJQUM1RDs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLGtCQUFrQixHQUFHLFNBQVMsRUFBRSxXQUFXLEdBQUcsb0JBQW9CLEVBQUM7UUFDN0YsSUFBSSxDQUFDLGFB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QUFRLENBQUM7U0FDL0IsQ0FBQTtJQUNILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLDRCQUE0QixDQUFDLEVBQUUsRUFBRSxFQUFDLE9BQU8sRUFBRSxlQUFlLEVBQUM7UUFDL0QsTUFBTSxFQUFFLENBQUMsTUFBTSxDQUFDO1lBQ2QsZUFBZSxFQUFFLENBQUMsU0FBUyxDQUFDO1lBQzVCLElBQUksRUFBRTtnQkFDSixPQUFPO2dCQUNQLGdCQUFnQixFQUFFLGVBQWU7YUFDbEM7WUFDRCxTQUFTLEVBQUUscUJBQXFCO1lBQ2hDLGFBQWEsRUFBRSxDQUFDLGtCQUFrQixDQUFDO1NBQ3BDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLE9BQU8sQ0FBQyxRQUFRO1FBQ3BCLE9BQU8sTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsbUJBQW1CLEVBQUUsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsRUFBRSxJQUFJLEVBQUUsMkJBQTJCLEVBQUMsRUFBRSxLQUFLLEVBQUUsR0FBRyxFQUFFLEVBQUU7WUFDbkosTUFBTSxFQUFFLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1lBRXZDLElBQUksQ0FBQyxFQUFFO2dCQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0RBQW9ELElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDLENBQUE7WUFFdkcsT0FBTyxNQUFNLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUMzQixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge3JhbmRvbVVVSUR9IGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vZGF0YWJhc2UvdGFibGUtZGF0YS9pbmRleC5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuXG4vKipcbiAqIFdlYnNvY2tldEV2ZW50Um93IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXZWJzb2NrZXRFdmVudFJvd1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gKiBAcHJvcGVydHkge0RhdGUgfCBzdHJpbmd9IGNyZWF0ZWRfYXQgLSBDcmVhdGlvbiB0aW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGlkIC0gRXZlbnQgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcGF5bG9hZF9qc29uIC0gU2VyaWFsaXplZCBwYXlsb2FkLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBwYXJhbXNfanNvbiAtIFNlcmlhbGl6ZWQgYnJvYWRjYXN0IHBhcmFtcywgb3IgbnVsbCB3aGVuIHRoZSBwdWJsaXNoIGNhcnJpZWQgbm9uZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgc3RyaW5nfSBzZXF1ZW5jZSAtIFNlcXVlbmNlIG51bWJlci5cbiAqL1xuLyoqXG4gKiBXZWJzb2NrZXRSZXBsYXlDaGFubmVsUm93IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXZWJzb2NrZXRSZXBsYXlDaGFubmVsUm93XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAqL1xuLyoqXG4gKiBOb3JtYWxpemVkIHBlcnNpc3RlZCB3ZWJzb2NrZXQgZXZlbnQuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXZWJzb2NrZXRQZXJzaXN0ZWRFdmVudFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY3JlYXRlZEF0IC0gSVNPIGNyZWF0aW9uIHRpbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaWQgLSBFdmVudCBpZC5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gcGFyYW1zIC0gUGVyc2lzdGVkIGJyb2FkY2FzdCBwYXJhbXMsIG9yIG51bGwgd2hlbiB0aGUgcHVibGlzaCBjYXJyaWVkIG5vbmUuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBwYXlsb2FkIC0gRXZlbnQgcGF5bG9hZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzZXF1ZW5jZSAtIFNlcXVlbmNlIG51bWJlci5cbiAqL1xuY29uc3QgRVZFTlRTX1RBQkxFID0gXCJ3ZWJzb2NrZXRfY2hhbm5lbF9ldmVudHNcIlxuY29uc3QgUkVQTEFZX0NIQU5ORUxTX1RBQkxFID0gXCJ3ZWJzb2NrZXRfcmVwbGF5X2NoYW5uZWxzXCJcbmNvbnN0IERFRkFVTFRfUkVURU5USU9OX01TID0gMTAgKiA2MCAqIDEwMDBcbmNvbnN0IHN0b3JlcyA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBSdW5zIHRoZSB3ZWJzb2NrZXRFdmVudExvZ1N0b3JlRm9yQ29uZmlndXJhdGlvbiBoZWxwZXIuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7VmVsb2Npb3VzSHR0cFNlcnZlcldlYnNvY2tldEV2ZW50TG9nU3RvcmV9IC0gU2hhcmVkIHN0b3JlIGluc3RhbmNlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gd2Vic29ja2V0RXZlbnRMb2dTdG9yZUZvckNvbmZpZ3VyYXRpb24oY29uZmlndXJhdGlvbikge1xuICBsZXQgc3RvcmUgPSBzdG9yZXMuZ2V0KGNvbmZpZ3VyYXRpb24pXG5cbiAgaWYgKCFzdG9yZSkge1xuICAgIHN0b3JlID0gbmV3IFZlbG9jaW91c0h0dHBTZXJ2ZXJXZWJzb2NrZXRFdmVudExvZ1N0b3JlKHtjb25maWd1cmF0aW9ufSlcbiAgICBzdG9yZXMuc2V0KGNvbmZpZ3VyYXRpb24sIHN0b3JlKVxuICB9XG5cbiAgcmV0dXJuIHN0b3JlXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0h0dHBTZXJ2ZXJXZWJzb2NrZXRFdmVudExvZ1N0b3JlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kYXRhYmFzZUlkZW50aWZpZXJdIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJldGVudGlvbk1zXSAtIEV2ZW50IHJldGVudGlvbiBpbiBtaWxsaXNlY29uZHMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVyID0gXCJkZWZhdWx0XCIsIHJldGVudGlvbk1zID0gREVGQVVMVF9SRVRFTlRJT05fTVN9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5yZXRlbnRpb25NcyA9IHJldGVudGlvbk1zXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gICAgdGhpcy5faXNSZWFkeSA9IGZhbHNlXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICB0aGlzLl9pbnRlcmVzdGVkQ2hhbm5lbHMgPSBuZXcgTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSByZWFkeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVJlYWR5KCkge1xuICAgIGlmIChhd2FpdCB0aGlzLl9zY2hlbWFSZWFkeSgpKSByZXR1cm5cblxuICAgIGlmICh0aGlzLl9yZWFkeVByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcblxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0Q3VycmVudCgpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVTY2hlbWEoKVxuICAgICAgdGhpcy5faXNSZWFkeSA9IHRydWVcbiAgICB9KSgpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICghdGhpcy5faXNSZWFkeSkge1xuICAgICAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlLXZhbGlkYXRlcyBjYWNoZWQgc2NoZW1hIHJlYWRpbmVzcyBiZWNhdXNlIHRyYW5zYWN0aW9uYWwgRERMIGNhbiByb2xsIHRoZSB0YWJsZXMgYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgY2FjaGVkIHJlYWR5IHN0YXRlIGlzIHN0aWxsIHZhbGlkLlxuICAgKi9cbiAgYXN5bmMgX3NjaGVtYVJlYWR5KCkge1xuICAgIGlmICghdGhpcy5faXNSZWFkeSkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKGF3YWl0IHRoaXMuX3NjaGVtYVByZXNlbnQoKSkgcmV0dXJuIHRydWVcblxuICAgIHRoaXMuX2lzUmVhZHkgPSBmYWxzZVxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2NoZW1hIHByZXNlbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYm90aCBldmVudC1sb2cgdGFibGVzIGV4aXN0IGFuZCB0aGUgZXZlbnRzIHRhYmxlIGNhcnJpZXMgZXZlcnkgcmVxdWlyZWQgY29sdW1uLlxuICAgKi9cbiAgYXN5bmMgX3NjaGVtYVByZXNlbnQoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+XG4gICAgICAoYXdhaXQgZGIudGFibGVFeGlzdHMoRVZFTlRTX1RBQkxFKSAmJiBhd2FpdCBkYi50YWJsZUV4aXN0cyhSRVBMQVlfQ0hBTk5FTFNfVEFCTEUpKVxuICAgICAgJiYgKGF3YWl0IHRoaXMuX2NvbHVtblByZXNlbnQoZGIsIEVWRU5UU19UQUJMRSwgXCJwYXJhbXNfanNvblwiKSlcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb2x1bW4gcHJlc2VudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgY29sdW1uIGV4aXN0cyBvbiB0aGUgdGFibGUuXG4gICAqL1xuICBhc3luYyBfY29sdW1uUHJlc2VudChkYiwgdGFibGVOYW1lLCBjb2x1bW5OYW1lKSB7XG4gICAgY29uc3QgdGFibGVzID0gYXdhaXQgZGIuZ2V0VGFibGVzKClcbiAgICBjb25zdCB0YWJsZSA9IHRhYmxlcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5nZXROYW1lKCkgPT0gdGFibGVOYW1lKVxuXG4gICAgaWYgKCF0YWJsZSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gKGF3YWl0IHRhYmxlLmdldENvbHVtbkJ5TmFtZShjb2x1bW5OYW1lKSkgIT09IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwZW5kIGV2ZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucGF5bG9hZCAtIEV2ZW50IHBheWxvYWQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gW2FyZ3MucGFyYW1zXSAtIEJyb2FkY2FzdCBwYXJhbXMgdG8gcGVyc2lzdCBmb3Igc3RyZWFtLXNjb3BlZCByZXBsYXksIG9yIG51bGwgd2hlbiB0aGUgcHVibGlzaCBjYXJyaWVkIG5vbmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFdlYnNvY2tldFBlcnNpc3RlZEV2ZW50Pn0gLSBQZXJzaXN0ZWQgZXZlbnQgcm93LlxuICAgKi9cbiAgYXN5bmMgYXBwZW5kRXZlbnQoe2NoYW5uZWwsIHBhcmFtcyA9IG51bGwsIHBheWxvYWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBpZCA9IHJhbmRvbVVVSUQoKVxuICAgIGNvbnN0IGNyZWF0ZWRBdCA9IG5ldyBEYXRlKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBhd2FpdCBkYi5pbnNlcnQoe1xuICAgICAgICB0YWJsZU5hbWU6IEVWRU5UU19UQUJMRSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIGNoYW5uZWwsXG4gICAgICAgICAgY3JlYXRlZF9hdDogY3JlYXRlZEF0LFxuICAgICAgICAgIGlkLFxuICAgICAgICAgIHBhcmFtc19qc29uOiBwYXJhbXMgPT09IG51bGwgPyBudWxsIDogSlNPTi5zdHJpbmdpZnkocGFyYW1zKSxcbiAgICAgICAgICBwYXlsb2FkX2pzb246IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICByZXR1cm4ge2NoYW5uZWwsIGNyZWF0ZWRBdDogY3JlYXRlZEF0LnRvSVNPU3RyaW5nKCksIGlkLCBwYXJhbXMsIHBheWxvYWR9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1hcmsgY2hhbm5lbCBpbnRlcmVzdGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY2hhbm5lbCBpbnRlcmVzdCB3YXMgcGVyc2lzdGVkLlxuICAgKi9cbiAgYXN5bmMgbWFya0NoYW5uZWxJbnRlcmVzdGVkKGNoYW5uZWwpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IGludGVyZXN0ZWRVbnRpbCA9IG5ldyBEYXRlKERhdGUubm93KCkgKyB0aGlzLnJldGVudGlvbk1zKVxuXG4gICAgdGhpcy5faW50ZXJlc3RlZENoYW5uZWxzLnNldChjaGFubmVsLCBpbnRlcmVzdGVkVW50aWwuZ2V0VGltZSgpKVxuXG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fdXBzZXJ0UmVwbGF5Q2hhbm5lbEludGVyZXN0KGRiLCB7Y2hhbm5lbCwgaW50ZXJlc3RlZFVudGlsfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hvdWxkIHBlcnNpc3QgY2hhbm5lbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGNoYW5uZWwgc2hvdWxkIGJlIHBlcnNpc3RlZCBmb3IgcmVwbGF5LlxuICAgKi9cbiAgYXN5bmMgc2hvdWxkUGVyc2lzdENoYW5uZWwoY2hhbm5lbCkge1xuICAgIGlmICh0aGlzLl9jaGFubmVsSW50ZXJlc3RDYWNoZWQoY2hhbm5lbCkpIHJldHVybiB0cnVlXG4gICAgaWYgKHRoaXMuX2ludGVyZXN0ZWRDaGFubmVscy5zaXplID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShSRVBMQVlfQ0hBTk5FTFNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7Y2hhbm5lbH0pXG4gICAgICAgIC53aGVyZShgaW50ZXJlc3RlZF91bnRpbCA+ICR7ZGIucXVvdGUobmV3IERhdGUoKSl9YClcbiAgICAgICAgLmxpbWl0KDEpXG4gICAgICAgIC5yZXN1bHRzKClcblxuICAgICAgcmV0dXJuIHJvd3MubGVuZ3RoID4gMFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjaGFubmVsIGludGVyZXN0IGNhY2hlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgbWVtb3J5IGNhY2hlIHN0aWxsIG1hcmtzIHRoZSBjaGFubmVsIGludGVyZXN0ZWQuXG4gICAqL1xuICBfY2hhbm5lbEludGVyZXN0Q2FjaGVkKGNoYW5uZWwpIHtcbiAgICBjb25zdCBpbnRlcmVzdGVkVW50aWwgPSB0aGlzLl9pbnRlcmVzdGVkQ2hhbm5lbHMuZ2V0KGNoYW5uZWwpXG5cbiAgICBpZiAoIWludGVyZXN0ZWRVbnRpbCkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKGludGVyZXN0ZWRVbnRpbCA+IERhdGUubm93KCkpIHJldHVybiB0cnVlXG5cbiAgICB0aGlzLl9pbnRlcmVzdGVkQ2hhbm5lbHMuZGVsZXRlKGNoYW5uZWwpXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBldmVudCBieSBpZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pZCAtIEV2ZW50IGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxXZWJzb2NrZXRQZXJzaXN0ZWRFdmVudCB8IG51bGw+fSAtIEV2ZW50IHJvdyBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgZ2V0RXZlbnRCeUlkKHtjaGFubmVsLCBpZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fZ2V0RXZlbnRCeUlkKHtjaGFubmVsLCBkYiwgaWR9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsYXRlc3Qgc2VxdWVuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXIgfCBudWxsPn0gLSBMYXRlc3QgY2hhbm5lbCBzZXF1ZW5jZS5cbiAgICovXG4gIGFzeW5jIGxhdGVzdFNlcXVlbmNlKGNoYW5uZWwpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oRVZFTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe2NoYW5uZWx9KVxuICAgICAgICAub3JkZXIoXCJzZXF1ZW5jZSBERVNDXCIpXG4gICAgICAgIC5saW1pdCgxKVxuICAgICAgICAucmVzdWx0cygpXG4gICAgICBjb25zdCByb3cgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gKi8gKHJvd3NbMF0pXG5cbiAgICAgIGlmICghcm93KSByZXR1cm4gbnVsbFxuXG4gICAgICByZXR1cm4gTnVtYmVyKHJvdy5zZXF1ZW5jZSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV2ZW50cyBhZnRlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5zZXF1ZW5jZSAtIExvd2VyIGJvdW5kIHNlcXVlbmNlLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IFthcmdzLnVwVG9TZXF1ZW5jZV0gLSBJbmNsdXNpdmUgY2VpbGluZyBzZXF1ZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8V2Vic29ja2V0UGVyc2lzdGVkRXZlbnRbXT59IC0gT3JkZXJlZCBldmVudHMuXG4gICAqL1xuICBhc3luYyBnZXRFdmVudHNBZnRlcih7Y2hhbm5lbCwgc2VxdWVuY2UsIHVwVG9TZXF1ZW5jZX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEVWRU5UU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtjaGFubmVsfSlcbiAgICAgICAgLndoZXJlKGBzZXF1ZW5jZSA+ICR7ZGIucXVvdGUoc2VxdWVuY2UpfWApXG4gICAgICAgIC5vcmRlcihcInNlcXVlbmNlIEFTQ1wiKVxuXG4gICAgICBpZiAodHlwZW9mIHVwVG9TZXF1ZW5jZSA9PT0gXCJudW1iZXJcIikge1xuICAgICAgICBxdWVyeS53aGVyZShgc2VxdWVuY2UgPD0gJHtkYi5xdW90ZSh1cFRvU2VxdWVuY2UpfWApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJvd3MgPSAvKiogQHR5cGUge1dlYnNvY2tldEV2ZW50Um93W119ICovIChhd2FpdCBxdWVyeS5yZXN1bHRzKCkpXG5cbiAgICAgIHJldHVybiByb3dzLm1hcCgocm93KSA9PiB0aGlzLl9ub3JtYWxpemVFdmVudFJvdyhyb3cpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhbnVwIGV4cGlyZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge0RhdGV9IFthcmdzLm5vd10gLSBDbGVhbnVwIHJlZmVyZW5jZSB0aW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsZWFudXAgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgY2xlYW51cEV4cGlyZWQoe25vdyA9IG5ldyBEYXRlKCl9ID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IGN1dG9mZiA9IG5ldyBEYXRlKG5vdy5nZXRUaW1lKCkgLSB0aGlzLnJldGVudGlvbk1zKVxuXG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgZXhwaXJlZEV2ZW50Um93cyA9IC8qKiBAdHlwZSB7QXJyYXk8e2lkOiBzdHJpbmd9Pn0gKi8gKGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEVWRU5UU19UQUJMRSlcbiAgICAgICAgLndoZXJlKGBjcmVhdGVkX2F0IDw9ICR7ZGIucXVvdGUoY3V0b2ZmKX1gKVxuICAgICAgICAucmVzdWx0cygpKVxuICAgICAgY29uc3QgZXhwaXJlZFJlcGxheUNoYW5uZWxSb3dzID0gLyoqIEB0eXBlIHtXZWJzb2NrZXRSZXBsYXlDaGFubmVsUm93W119ICovIChhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShSRVBMQVlfQ0hBTk5FTFNfVEFCTEUpXG4gICAgICAgIC53aGVyZShgaW50ZXJlc3RlZF91bnRpbCA8PSAke2RiLnF1b3RlKG5vdyl9YClcbiAgICAgICAgLnJlc3VsdHMoKSlcblxuICAgICAgZm9yIChjb25zdCBleHBpcmVkRXZlbnRSb3cgb2YgZXhwaXJlZEV2ZW50Um93cykge1xuICAgICAgICBhd2FpdCBkYi5kZWxldGUoe1xuICAgICAgICAgIHRhYmxlTmFtZTogRVZFTlRTX1RBQkxFLFxuICAgICAgICAgIGNvbmRpdGlvbnM6IHtpZDogZXhwaXJlZEV2ZW50Um93LmlkfVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGV4cGlyZWRSZXBsYXlDaGFubmVsUm93IG9mIGV4cGlyZWRSZXBsYXlDaGFubmVsUm93cykge1xuICAgICAgICBhd2FpdCBkYi5kZWxldGUoe1xuICAgICAgICAgIHRhYmxlTmFtZTogUkVQTEFZX0NIQU5ORUxTX1RBQkxFLFxuICAgICAgICAgIGNvbmRpdGlvbnM6IHtjaGFubmVsOiBleHBpcmVkUmVwbGF5Q2hhbm5lbFJvdy5jaGFubmVsfVxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICBhc3luYyBfZW5zdXJlU2NoZW1hKCkge1xuICAgIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUV2ZW50c1RhYmxlKGRiKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlUmVwbGF5Q2hhbm5lbHNUYWJsZShkYilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGV2ZW50cyB0YWJsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUV2ZW50c1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKEVWRU5UU19UQUJMRSkpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUV2ZW50c1RhYmxlQ29sdW1ucyhkYilcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLmluZm8oXCJBcHBseWluZyB3ZWJzb2NrZXQgZXZlbnQtbG9nIHNjaGVtYVwiKVxuXG4gICAgY29uc3QgZXZlbnRUYWJsZSA9IG5ldyBUYWJsZURhdGEoRVZFTlRTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgZXZlbnRUYWJsZS5pbnRlZ2VyKFwic2VxdWVuY2VcIiwge2F1dG9JbmNyZW1lbnQ6IHRydWUsIG51bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICBldmVudFRhYmxlLnN0cmluZyhcImlkXCIsIHtpbmRleDogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuICAgIGV2ZW50VGFibGUuc3RyaW5nKFwiY2hhbm5lbFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcbiAgICBldmVudFRhYmxlLnRleHQoXCJwYXJhbXNfanNvblwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgZXZlbnRUYWJsZS50ZXh0KFwicGF5bG9hZF9qc29uXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgZXZlbnRUYWJsZS5kYXRldGltZShcImNyZWF0ZWRfYXRcIiwge2luZGV4OiB0cnVlLCBudWxsOiBmYWxzZX0pXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZShldmVudFRhYmxlKVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgY29sdW1ucyB0aGUgY3VycmVudCBzY2hlbWEgcmVxdWlyZXMgdG8gYW4gZXZlbnRzIHRhYmxlIGNyZWF0ZWQgYnkgYW5cbiAgICogb2xkZXIgZnJhbWV3b3JrIHZlcnNpb24sIHNvIHVwZ3JhZGVzIGtlZXAgd29ya2luZyB3aXRob3V0IGEgbWFudWFsIEFMVEVSLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGV2ZW50cyB0YWJsZSBzY2hlbWEgaXMgY3VycmVudC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVFdmVudHNUYWJsZUNvbHVtbnMoZGIpIHtcbiAgICBpZiAoYXdhaXQgdGhpcy5fY29sdW1uUHJlc2VudChkYiwgRVZFTlRTX1RBQkxFLCBcInBhcmFtc19qc29uXCIpKSByZXR1cm5cblxuICAgIHRoaXMubG9nZ2VyLmluZm8oXCJBZGRpbmcgcGFyYW1zX2pzb24gY29sdW1uIHRvIHdlYnNvY2tldCBldmVudC1sb2cgdGFibGVcIilcblxuICAgIGNvbnN0IHRhYmxlRGF0YSA9IG5ldyBUYWJsZURhdGEoRVZFTlRTX1RBQkxFKVxuXG4gICAgdGFibGVEYXRhLmFkZENvbHVtbihcInBhcmFtc19qc29uXCIsIHtpc05ld0NvbHVtbjogdHJ1ZSwgbnVsbDogdHJ1ZSwgdHlwZTogXCJ0ZXh0XCJ9KVxuXG4gICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkge1xuICAgICAgYXdhaXQgZGIucXVlcnkoc3FsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSByZXBsYXkgY2hhbm5lbHMgdGFibGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVSZXBsYXlDaGFubmVsc1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFJFUExBWV9DSEFOTkVMU19UQUJMRSkpIHJldHVyblxuXG4gICAgY29uc3QgcmVwbGF5Q2hhbm5lbFRhYmxlID0gbmV3IFRhYmxlRGF0YShSRVBMQVlfQ0hBTk5FTFNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICByZXBsYXlDaGFubmVsVGFibGUuc3RyaW5nKFwiY2hhbm5lbFwiLCB7bnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHJlcGxheUNoYW5uZWxUYWJsZS5kYXRldGltZShcImludGVyZXN0ZWRfdW50aWxcIiwge2luZGV4OiB0cnVlLCBudWxsOiBmYWxzZX0pXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZShyZXBsYXlDaGFubmVsVGFibGUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXZlbnQgYnkgaWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmlkIC0gRXZlbnQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFdlYnNvY2tldFBlcnNpc3RlZEV2ZW50IHwgbnVsbD59IC0gRXZlbnQgcm93IG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBfZ2V0RXZlbnRCeUlkKHtjaGFubmVsLCBkYiwgaWR9KSB7XG4gICAgY29uc3Qgcm93cyA9IC8qKiBAdHlwZSB7V2Vic29ja2V0RXZlbnRSb3dbXX0gKi8gKGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oRVZFTlRTX1RBQkxFKVxuICAgICAgLndoZXJlKHtjaGFubmVsLCBpZH0pXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKCkpXG5cbiAgICBpZiAoIXJvd3NbMF0pIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplRXZlbnRSb3cocm93c1swXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBldmVudCByb3cuXG4gICAqIEBwYXJhbSB7V2Vic29ja2V0RXZlbnRSb3d9IHJvdyAtIFJhdyByb3cuXG4gICAqIEByZXR1cm5zIHtXZWJzb2NrZXRQZXJzaXN0ZWRFdmVudH0gLSBOb3JtYWxpemVkIHJvdy5cbiAgICovXG4gIF9ub3JtYWxpemVFdmVudFJvdyhyb3cpIHtcbiAgICBjb25zdCBjcmVhdGVkQXRWYWx1ZSA9IHJvdy5jcmVhdGVkX2F0XG5cbiAgICByZXR1cm4ge1xuICAgICAgY2hhbm5lbDogcm93LmNoYW5uZWwsXG4gICAgICBjcmVhdGVkQXQ6IGNyZWF0ZWRBdFZhbHVlIGluc3RhbmNlb2YgRGF0ZSA/IGNyZWF0ZWRBdFZhbHVlLnRvSVNPU3RyaW5nKCkgOiBuZXcgRGF0ZShjcmVhdGVkQXRWYWx1ZSkudG9JU09TdHJpbmcoKSxcbiAgICAgIGlkOiByb3cuaWQsXG4gICAgICBwYXJhbXM6IHJvdy5wYXJhbXNfanNvbiA9PT0gbnVsbCB8fCByb3cucGFyYW1zX2pzb24gPT09IHVuZGVmaW5lZCA/IG51bGwgOiBKU09OLnBhcnNlKHJvdy5wYXJhbXNfanNvbiksXG4gICAgICBwYXlsb2FkOiBKU09OLnBhcnNlKHJvdy5wYXlsb2FkX2pzb24pLFxuICAgICAgc2VxdWVuY2U6IE51bWJlcihyb3cuc2VxdWVuY2UpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBzZXJ0IHJlcGxheSBjaGFubmVsIGludGVyZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtEYXRlfSBhcmdzLmludGVyZXN0ZWRVbnRpbCAtIFJldGVudGlvbiBkZWFkbGluZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgcmVwbGF5LWNoYW5uZWwgcm93IHdhcyB1cHNlcnRlZC5cbiAgICovXG4gIGFzeW5jIF91cHNlcnRSZXBsYXlDaGFubmVsSW50ZXJlc3QoZGIsIHtjaGFubmVsLCBpbnRlcmVzdGVkVW50aWx9KSB7XG4gICAgYXdhaXQgZGIudXBzZXJ0KHtcbiAgICAgIGNvbmZsaWN0Q29sdW1uczogW1wiY2hhbm5lbFwiXSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgY2hhbm5lbCxcbiAgICAgICAgaW50ZXJlc3RlZF91bnRpbDogaW50ZXJlc3RlZFVudGlsXG4gICAgICB9LFxuICAgICAgdGFibGVOYW1lOiBSRVBMQVlfQ0hBTk5FTFNfVEFCTEUsXG4gICAgICB1cGRhdGVDb2x1bW5zOiBbXCJpbnRlcmVzdGVkX3VudGlsXCJdXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggZGIuXG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfd2l0aERiKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyXSwgbmFtZTogXCJXZWJzb2NrZXQgZXZlbnQgbG9nIHN0b3JlXCJ9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICBjb25zdCBkYiA9IGRic1t0aGlzLmRhdGFiYXNlSWRlbnRpZmllcl1cblxuICAgICAgaWYgKCFkYikgdGhyb3cgbmV3IEVycm9yKGBObyBkYXRhYmFzZSBjb25uZWN0aW9uIGF2YWlsYWJsZSBmb3IgaWRlbnRpZmllcjogJHt0aGlzLmRhdGFiYXNlSWRlbnRpZmllcn1gKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soZGIpXG4gICAgfSlcbiAgfVxufVxuIl19