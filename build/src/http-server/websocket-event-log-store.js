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
     * @throws {Error} When the channel is registered live-only, which forbids replay persistence.
     */
    async markChannelInterested(channel) {
        if (this.configuration.isWebsocketChannelLiveOnly(channel)) {
            throw new Error(`Websocket channel "${channel}" is registered live-only and cannot be marked interested in replay persistence`);
        }
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
        // A channel re-registered live-only can still hold cached or durable
        // interest state from before the re-registration; the live-only
        // contract must hold at the persistence decision, not only at
        // interest marking.
        if (this.configuration.isWebsocketChannelLiveOnly(channel))
            return false;
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
        try {
            for (const sql of await db.alterTableSQLs(tableData)) {
                await db.query(sql);
            }
        }
        catch (error) {
            // A concurrent process can add the column between the presence check
            // and the ALTER (multi-worker or rolling upgrade); the
            // duplicate-column failure is then the expected outcome, not a real
            // error. Anything else re-checks as absent and rethrows.
            if (await this._columnPresent(db, EVENTS_TABLE, "params_json"))
                return;
            throw error;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWV2ZW50LWxvZy1zdG9yZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci93ZWJzb2NrZXQtZXZlbnQtbG9nLXN0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sUUFBUSxDQUFBO0FBQ2pDLE9BQU8sU0FBUyxNQUFNLGlDQUFpQyxDQUFBO0FBQ3ZELE9BQU8sTUFBTSxNQUFNLGNBQWMsQ0FBQTtBQUVqQzs7Ozs7Ozs7O0dBU0c7QUFDSDs7OztHQUlHO0FBQ0g7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBTSxZQUFZLEdBQUcsMEJBQTBCLENBQUE7QUFDL0MsTUFBTSxxQkFBcUIsR0FBRywyQkFBMkIsQ0FBQTtBQUN6RCxNQUFNLG9CQUFvQixHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFBO0FBQzNDLE1BQU0sTUFBTSxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFNUI7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSxzQ0FBc0MsQ0FBQyxhQUFhO0lBQ2xFLElBQUksS0FBSyxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUE7SUFFckMsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ1gsS0FBSyxHQUFHLElBQUkseUNBQXlDLENBQUMsRUFBQyxhQUFhLEVBQUMsQ0FBQyxDQUFBO1FBQ3RFLE1BQU0sQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxDQUFBO0lBQ2xDLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUM7QUFFRCxNQUFNLENBQUMsT0FBTyxPQUFPLHlDQUF5QztJQUM1RDs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLGtCQUFrQixHQUFHLFNBQVMsRUFBRSxXQUFXLEdBQUcsb0JBQW9CLEVBQUM7UUFDN0YsSUFBSSxDQUFDLGFB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Q0FBQyxFQUFFLElBQUksRUFBRSwyQkFBMkIsRUFBQyxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsRUFBRTtZQUNuSixNQUFNLEVBQUUsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUE7WUFFdkMsSUFBSSxDQUFDLEVBQUU7Z0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxvREFBb0QsSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUMsQ0FBQTtZQUV2RyxPQUFPLE1BQU0sUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQzNCLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7cmFuZG9tVVVJRH0gZnJvbSBcImNyeXB0b1wiXG5pbXBvcnQgVGFibGVEYXRhIGZyb20gXCIuLi9kYXRhYmFzZS90YWJsZS1kYXRhL2luZGV4LmpzXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5cbi8qKlxuICogV2Vic29ja2V0RXZlbnRSb3cgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFdlYnNvY2tldEV2ZW50Um93XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7RGF0ZSB8IHN0cmluZ30gY3JlYXRlZF9hdCAtIENyZWF0aW9uIHRpbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaWQgLSBFdmVudCBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBwYXlsb2FkX2pzb24gLSBTZXJpYWxpemVkIHBheWxvYWQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHBhcmFtc19qc29uIC0gU2VyaWFsaXplZCBicm9hZGNhc3QgcGFyYW1zLCBvciBudWxsIHdoZW4gdGhlIHB1Ymxpc2ggY2FycmllZCBub25lLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBzdHJpbmd9IHNlcXVlbmNlIC0gU2VxdWVuY2UgbnVtYmVyLlxuICovXG4vKipcbiAqIFdlYnNvY2tldFJlcGxheUNoYW5uZWxSb3cgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFdlYnNvY2tldFJlcGxheUNoYW5uZWxSb3dcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICovXG4vKipcbiAqIE5vcm1hbGl6ZWQgcGVyc2lzdGVkIHdlYnNvY2tldCBldmVudC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFdlYnNvY2tldFBlcnNpc3RlZEV2ZW50XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjcmVhdGVkQXQgLSBJU08gY3JlYXRpb24gdGltZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBpZCAtIEV2ZW50IGlkLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBwYXJhbXMgLSBQZXJzaXN0ZWQgYnJvYWRjYXN0IHBhcmFtcywgb3IgbnVsbCB3aGVuIHRoZSBwdWJsaXNoIGNhcnJpZWQgbm9uZS5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHBheWxvYWQgLSBFdmVudCBwYXlsb2FkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHNlcXVlbmNlIC0gU2VxdWVuY2UgbnVtYmVyLlxuICovXG5jb25zdCBFVkVOVFNfVEFCTEUgPSBcIndlYnNvY2tldF9jaGFubmVsX2V2ZW50c1wiXG5jb25zdCBSRVBMQVlfQ0hBTk5FTFNfVEFCTEUgPSBcIndlYnNvY2tldF9yZXBsYXlfY2hhbm5lbHNcIlxuY29uc3QgREVGQVVMVF9SRVRFTlRJT05fTVMgPSAxMCAqIDYwICogMTAwMFxuY29uc3Qgc3RvcmVzID0gbmV3IFdlYWtNYXAoKVxuXG4vKipcbiAqIFJ1bnMgdGhlIHdlYnNvY2tldEV2ZW50TG9nU3RvcmVGb3JDb25maWd1cmF0aW9uIGhlbHBlci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAqIEByZXR1cm5zIHtWZWxvY2lvdXNIdHRwU2VydmVyV2Vic29ja2V0RXZlbnRMb2dTdG9yZX0gLSBTaGFyZWQgc3RvcmUgaW5zdGFuY2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3ZWJzb2NrZXRFdmVudExvZ1N0b3JlRm9yQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSB7XG4gIGxldCBzdG9yZSA9IHN0b3Jlcy5nZXQoY29uZmlndXJhdGlvbilcblxuICBpZiAoIXN0b3JlKSB7XG4gICAgc3RvcmUgPSBuZXcgVmVsb2Npb3VzSHR0cFNlcnZlcldlYnNvY2tldEV2ZW50TG9nU3RvcmUoe2NvbmZpZ3VyYXRpb259KVxuICAgIHN0b3Jlcy5zZXQoY29uZmlndXJhdGlvbiwgc3RvcmUpXG4gIH1cblxuICByZXR1cm4gc3RvcmVcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzSHR0cFNlcnZlcldlYnNvY2tldEV2ZW50TG9nU3RvcmUge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRhdGFiYXNlSWRlbnRpZmllcl0gLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmV0ZW50aW9uTXNdIC0gRXZlbnQgcmV0ZW50aW9uIGluIG1pbGxpc2Vjb25kcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIgPSBcImRlZmF1bHRcIiwgcmV0ZW50aW9uTXMgPSBERUZBVUxUX1JFVEVOVElPTl9NU30pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLnJldGVudGlvbk1zID0gcmV0ZW50aW9uTXNcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICB0aGlzLl9pc1JlYWR5ID0gZmFsc2VcbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIHRoaXMuX2ludGVyZXN0ZWRDaGFubmVscyA9IG5ldyBNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIHJlYWR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlUmVhZHkoKSB7XG4gICAgaWYgKGF3YWl0IHRoaXMuX3NjaGVtYVJlYWR5KCkpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuX3JlYWR5UHJvbWlzZVxuXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVtYSgpXG4gICAgICB0aGlzLl9pc1JlYWR5ID0gdHJ1ZVxuICAgIH0pKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKCF0aGlzLl9pc1JlYWR5KSB7XG4gICAgICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmUtdmFsaWRhdGVzIGNhY2hlZCBzY2hlbWEgcmVhZGluZXNzIGJlY2F1c2UgdHJhbnNhY3Rpb25hbCBEREwgY2FuIHJvbGwgdGhlIHRhYmxlcyBiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBjYWNoZWQgcmVhZHkgc3RhdGUgaXMgc3RpbGwgdmFsaWQuXG4gICAqL1xuICBhc3luYyBfc2NoZW1hUmVhZHkoKSB7XG4gICAgaWYgKCF0aGlzLl9pc1JlYWR5KSByZXR1cm4gZmFsc2VcbiAgICBpZiAoYXdhaXQgdGhpcy5fc2NoZW1hUHJlc2VudCgpKSByZXR1cm4gdHJ1ZVxuXG4gICAgdGhpcy5faXNSZWFkeSA9IGZhbHNlXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY2hlbWEgcHJlc2VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBib3RoIGV2ZW50LWxvZyB0YWJsZXMgZXhpc3QgYW5kIHRoZSBldmVudHMgdGFibGUgY2FycmllcyBldmVyeSByZXF1aXJlZCBjb2x1bW4uXG4gICAqL1xuICBhc3luYyBfc2NoZW1hUHJlc2VudCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT5cbiAgICAgIChhd2FpdCBkYi50YWJsZUV4aXN0cyhFVkVOVFNfVEFCTEUpICYmIGF3YWl0IGRiLnRhYmxlRXhpc3RzKFJFUExBWV9DSEFOTkVMU19UQUJMRSkpXG4gICAgICAmJiAoYXdhaXQgdGhpcy5fY29sdW1uUHJlc2VudChkYiwgRVZFTlRTX1RBQkxFLCBcInBhcmFtc19qc29uXCIpKVxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbHVtbiBwcmVzZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBjb2x1bW4gZXhpc3RzIG9uIHRoZSB0YWJsZS5cbiAgICovXG4gIGFzeW5jIF9jb2x1bW5QcmVzZW50KGRiLCB0YWJsZU5hbWUsIGNvbHVtbk5hbWUpIHtcbiAgICBjb25zdCB0YWJsZXMgPSBhd2FpdCBkYi5nZXRUYWJsZXMoKVxuICAgIGNvbnN0IHRhYmxlID0gdGFibGVzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmdldE5hbWUoKSA9PSB0YWJsZU5hbWUpXG5cbiAgICBpZiAoIXRhYmxlKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiAoYXdhaXQgdGFibGUuZ2V0Q29sdW1uQnlOYW1lKGNvbHVtbk5hbWUpKSAhPT0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBlbmQgZXZlbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5wYXlsb2FkIC0gRXZlbnQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBbYXJncy5wYXJhbXNdIC0gQnJvYWRjYXN0IHBhcmFtcyB0byBwZXJzaXN0IGZvciBzdHJlYW0tc2NvcGVkIHJlcGxheSwgb3IgbnVsbCB3aGVuIHRoZSBwdWJsaXNoIGNhcnJpZWQgbm9uZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8V2Vic29ja2V0UGVyc2lzdGVkRXZlbnQ+fSAtIFBlcnNpc3RlZCBldmVudCByb3cuXG4gICAqL1xuICBhc3luYyBhcHBlbmRFdmVudCh7Y2hhbm5lbCwgcGFyYW1zID0gbnVsbCwgcGF5bG9hZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IGlkID0gcmFuZG9tVVVJRCgpXG4gICAgY29uc3QgY3JlYXRlZEF0ID0gbmV3IERhdGUoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IGRiLmluc2VydCh7XG4gICAgICAgIHRhYmxlTmFtZTogRVZFTlRTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgY2hhbm5lbCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBjcmVhdGVkQXQsXG4gICAgICAgICAgaWQsXG4gICAgICAgICAgcGFyYW1zX2pzb246IHBhcmFtcyA9PT0gbnVsbCA/IG51bGwgOiBKU09OLnN0cmluZ2lmeShwYXJhbXMpLFxuICAgICAgICAgIHBheWxvYWRfanNvbjogSlNPTi5zdHJpbmdpZnkocGF5bG9hZClcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIHJldHVybiB7Y2hhbm5lbCwgY3JlYXRlZEF0OiBjcmVhdGVkQXQudG9JU09TdHJpbmcoKSwgaWQsIHBhcmFtcywgcGF5bG9hZH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayBjaGFubmVsIGludGVyZXN0ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjaGFubmVsIGludGVyZXN0IHdhcyBwZXJzaXN0ZWQuXG4gICAqIEB0aHJvd3Mge0Vycm9yfSBXaGVuIHRoZSBjaGFubmVsIGlzIHJlZ2lzdGVyZWQgbGl2ZS1vbmx5LCB3aGljaCBmb3JiaWRzIHJlcGxheSBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIG1hcmtDaGFubmVsSW50ZXJlc3RlZChjaGFubmVsKSB7XG4gICAgaWYgKHRoaXMuY29uZmlndXJhdGlvbi5pc1dlYnNvY2tldENoYW5uZWxMaXZlT25seShjaGFubmVsKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBXZWJzb2NrZXQgY2hhbm5lbCBcIiR7Y2hhbm5lbH1cIiBpcyByZWdpc3RlcmVkIGxpdmUtb25seSBhbmQgY2Fubm90IGJlIG1hcmtlZCBpbnRlcmVzdGVkIGluIHJlcGxheSBwZXJzaXN0ZW5jZWApXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBpbnRlcmVzdGVkVW50aWwgPSBuZXcgRGF0ZShEYXRlLm5vdygpICsgdGhpcy5yZXRlbnRpb25NcylcblxuICAgIHRoaXMuX2ludGVyZXN0ZWRDaGFubmVscy5zZXQoY2hhbm5lbCwgaW50ZXJlc3RlZFVudGlsLmdldFRpbWUoKSlcblxuICAgIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3Vwc2VydFJlcGxheUNoYW5uZWxJbnRlcmVzdChkYiwge2NoYW5uZWwsIGludGVyZXN0ZWRVbnRpbH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNob3VsZCBwZXJzaXN0IGNoYW5uZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBjaGFubmVsIHNob3VsZCBiZSBwZXJzaXN0ZWQgZm9yIHJlcGxheS5cbiAgICovXG4gIGFzeW5jIHNob3VsZFBlcnNpc3RDaGFubmVsKGNoYW5uZWwpIHtcbiAgICAvLyBBIGNoYW5uZWwgcmUtcmVnaXN0ZXJlZCBsaXZlLW9ubHkgY2FuIHN0aWxsIGhvbGQgY2FjaGVkIG9yIGR1cmFibGVcbiAgICAvLyBpbnRlcmVzdCBzdGF0ZSBmcm9tIGJlZm9yZSB0aGUgcmUtcmVnaXN0cmF0aW9uOyB0aGUgbGl2ZS1vbmx5XG4gICAgLy8gY29udHJhY3QgbXVzdCBob2xkIGF0IHRoZSBwZXJzaXN0ZW5jZSBkZWNpc2lvbiwgbm90IG9ubHkgYXRcbiAgICAvLyBpbnRlcmVzdCBtYXJraW5nLlxuICAgIGlmICh0aGlzLmNvbmZpZ3VyYXRpb24uaXNXZWJzb2NrZXRDaGFubmVsTGl2ZU9ubHkoY2hhbm5lbCkpIHJldHVybiBmYWxzZVxuXG4gICAgaWYgKHRoaXMuX2NoYW5uZWxJbnRlcmVzdENhY2hlZChjaGFubmVsKSkgcmV0dXJuIHRydWVcbiAgICBpZiAodGhpcy5faW50ZXJlc3RlZENoYW5uZWxzLnNpemUgPT09IDApIHJldHVybiBmYWxzZVxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKFJFUExBWV9DSEFOTkVMU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtjaGFubmVsfSlcbiAgICAgICAgLndoZXJlKGBpbnRlcmVzdGVkX3VudGlsID4gJHtkYi5xdW90ZShuZXcgRGF0ZSgpKX1gKVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93cy5sZW5ndGggPiAwXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNoYW5uZWwgaW50ZXJlc3QgY2FjaGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBtZW1vcnkgY2FjaGUgc3RpbGwgbWFya3MgdGhlIGNoYW5uZWwgaW50ZXJlc3RlZC5cbiAgICovXG4gIF9jaGFubmVsSW50ZXJlc3RDYWNoZWQoY2hhbm5lbCkge1xuICAgIGNvbnN0IGludGVyZXN0ZWRVbnRpbCA9IHRoaXMuX2ludGVyZXN0ZWRDaGFubmVscy5nZXQoY2hhbm5lbClcblxuICAgIGlmICghaW50ZXJlc3RlZFVudGlsKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoaW50ZXJlc3RlZFVudGlsID4gRGF0ZS5ub3coKSkgcmV0dXJuIHRydWVcblxuICAgIHRoaXMuX2ludGVyZXN0ZWRDaGFubmVscy5kZWxldGUoY2hhbm5lbClcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV2ZW50IGJ5IGlkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmlkIC0gRXZlbnQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFdlYnNvY2tldFBlcnNpc3RlZEV2ZW50IHwgbnVsbD59IC0gRXZlbnQgcm93IG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBnZXRFdmVudEJ5SWQoe2NoYW5uZWwsIGlkfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9nZXRFdmVudEJ5SWQoe2NoYW5uZWwsIGRiLCBpZH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxhdGVzdCBzZXF1ZW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IG51bGw+fSAtIExhdGVzdCBjaGFubmVsIHNlcXVlbmNlLlxuICAgKi9cbiAgYXN5bmMgbGF0ZXN0U2VxdWVuY2UoY2hhbm5lbCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShFVkVOVFNfVEFCTEUpXG4gICAgICAgIC53aGVyZSh7Y2hhbm5lbH0pXG4gICAgICAgIC5vcmRlcihcInNlcXVlbmNlIERFU0NcIilcbiAgICAgICAgLmxpbWl0KDEpXG4gICAgICAgIC5yZXN1bHRzKClcbiAgICAgIGNvbnN0IHJvdyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqLyAocm93c1swXSlcblxuICAgICAgaWYgKCFyb3cpIHJldHVybiBudWxsXG5cbiAgICAgIHJldHVybiBOdW1iZXIocm93LnNlcXVlbmNlKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXZlbnRzIGFmdGVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnNlcXVlbmNlIC0gTG93ZXIgYm91bmQgc2VxdWVuY2UuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gW2FyZ3MudXBUb1NlcXVlbmNlXSAtIEluY2x1c2l2ZSBjZWlsaW5nIHNlcXVlbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxXZWJzb2NrZXRQZXJzaXN0ZWRFdmVudFtdPn0gLSBPcmRlcmVkIGV2ZW50cy5cbiAgICovXG4gIGFzeW5jIGdldEV2ZW50c0FmdGVyKHtjaGFubmVsLCBzZXF1ZW5jZSwgdXBUb1NlcXVlbmNlfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oRVZFTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe2NoYW5uZWx9KVxuICAgICAgICAud2hlcmUoYHNlcXVlbmNlID4gJHtkYi5xdW90ZShzZXF1ZW5jZSl9YClcbiAgICAgICAgLm9yZGVyKFwic2VxdWVuY2UgQVNDXCIpXG5cbiAgICAgIGlmICh0eXBlb2YgdXBUb1NlcXVlbmNlID09PSBcIm51bWJlclwiKSB7XG4gICAgICAgIHF1ZXJ5LndoZXJlKGBzZXF1ZW5jZSA8PSAke2RiLnF1b3RlKHVwVG9TZXF1ZW5jZSl9YClcbiAgICAgIH1cblxuICAgICAgY29uc3Qgcm93cyA9IC8qKiBAdHlwZSB7V2Vic29ja2V0RXZlbnRSb3dbXX0gKi8gKGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKSlcblxuICAgICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IHRoaXMuX25vcm1hbGl6ZUV2ZW50Um93KHJvdykpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFudXAgZXhwaXJlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7RGF0ZX0gW2FyZ3Mubm93XSAtIENsZWFudXAgcmVmZXJlbmNlIHRpbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xlYW51cCBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBjbGVhbnVwRXhwaXJlZCh7bm93ID0gbmV3IERhdGUoKX0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgY3V0b2ZmID0gbmV3IERhdGUobm93LmdldFRpbWUoKSAtIHRoaXMucmV0ZW50aW9uTXMpXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBleHBpcmVkRXZlbnRSb3dzID0gLyoqIEB0eXBlIHtBcnJheTx7aWQ6IHN0cmluZ30+fSAqLyAoYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oRVZFTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoYGNyZWF0ZWRfYXQgPD0gJHtkYi5xdW90ZShjdXRvZmYpfWApXG4gICAgICAgIC5yZXN1bHRzKCkpXG4gICAgICBjb25zdCBleHBpcmVkUmVwbGF5Q2hhbm5lbFJvd3MgPSAvKiogQHR5cGUge1dlYnNvY2tldFJlcGxheUNoYW5uZWxSb3dbXX0gKi8gKGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKFJFUExBWV9DSEFOTkVMU19UQUJMRSlcbiAgICAgICAgLndoZXJlKGBpbnRlcmVzdGVkX3VudGlsIDw9ICR7ZGIucXVvdGUobm93KX1gKVxuICAgICAgICAucmVzdWx0cygpKVxuXG4gICAgICBmb3IgKGNvbnN0IGV4cGlyZWRFdmVudFJvdyBvZiBleHBpcmVkRXZlbnRSb3dzKSB7XG4gICAgICAgIGF3YWl0IGRiLmRlbGV0ZSh7XG4gICAgICAgICAgdGFibGVOYW1lOiBFVkVOVFNfVEFCTEUsXG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiBleHBpcmVkRXZlbnRSb3cuaWR9XG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZXhwaXJlZFJlcGxheUNoYW5uZWxSb3cgb2YgZXhwaXJlZFJlcGxheUNoYW5uZWxSb3dzKSB7XG4gICAgICAgIGF3YWl0IGRiLmRlbGV0ZSh7XG4gICAgICAgICAgdGFibGVOYW1lOiBSRVBMQVlfQ0hBTk5FTFNfVEFCTEUsXG4gICAgICAgICAgY29uZGl0aW9uczoge2NoYW5uZWw6IGV4cGlyZWRSZXBsYXlDaGFubmVsUm93LmNoYW5uZWx9XG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIF9lbnN1cmVTY2hlbWEoKSB7XG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlRXZlbnRzVGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVSZXBsYXlDaGFubmVsc1RhYmxlKGRiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgZXZlbnRzIHRhYmxlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlRXZlbnRzVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoRVZFTlRTX1RBQkxFKSkge1xuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlRXZlbnRzVGFibGVDb2x1bW5zKGRiKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5sb2dnZXIuaW5mbyhcIkFwcGx5aW5nIHdlYnNvY2tldCBldmVudC1sb2cgc2NoZW1hXCIpXG5cbiAgICBjb25zdCBldmVudFRhYmxlID0gbmV3IFRhYmxlRGF0YShFVkVOVFNfVEFCTEUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICBldmVudFRhYmxlLmludGVnZXIoXCJzZXF1ZW5jZVwiLCB7YXV0b0luY3JlbWVudDogdHJ1ZSwgbnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIGV2ZW50VGFibGUuc3RyaW5nKFwiaWRcIiwge2luZGV4OiB0cnVlLCBudWxsOiBmYWxzZX0pXG4gICAgZXZlbnRUYWJsZS5zdHJpbmcoXCJjaGFubmVsXCIsIHtpbmRleDogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuICAgIGV2ZW50VGFibGUudGV4dChcInBhcmFtc19qc29uXCIsIHtudWxsOiB0cnVlfSlcbiAgICBldmVudFRhYmxlLnRleHQoXCJwYXlsb2FkX2pzb25cIiwge251bGw6IGZhbHNlfSlcbiAgICBldmVudFRhYmxlLmRhdGV0aW1lKFwiY3JlYXRlZF9hdFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcblxuICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKGV2ZW50VGFibGUpXG4gIH1cblxuICAvKipcbiAgICogQWRkcyBjb2x1bW5zIHRoZSBjdXJyZW50IHNjaGVtYSByZXF1aXJlcyB0byBhbiBldmVudHMgdGFibGUgY3JlYXRlZCBieSBhblxuICAgKiBvbGRlciBmcmFtZXdvcmsgdmVyc2lvbiwgc28gdXBncmFkZXMga2VlcCB3b3JraW5nIHdpdGhvdXQgYSBtYW51YWwgQUxURVIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgZXZlbnRzIHRhYmxlIHNjaGVtYSBpcyBjdXJyZW50LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUV2ZW50c1RhYmxlQ29sdW1ucyhkYikge1xuICAgIGlmIChhd2FpdCB0aGlzLl9jb2x1bW5QcmVzZW50KGRiLCBFVkVOVFNfVEFCTEUsIFwicGFyYW1zX2pzb25cIikpIHJldHVyblxuXG4gICAgdGhpcy5sb2dnZXIuaW5mbyhcIkFkZGluZyBwYXJhbXNfanNvbiBjb2x1bW4gdG8gd2Vic29ja2V0IGV2ZW50LWxvZyB0YWJsZVwiKVxuXG4gICAgY29uc3QgdGFibGVEYXRhID0gbmV3IFRhYmxlRGF0YShFVkVOVFNfVEFCTEUpXG5cbiAgICB0YWJsZURhdGEuYWRkQ29sdW1uKFwicGFyYW1zX2pzb25cIiwge2lzTmV3Q29sdW1uOiB0cnVlLCBudWxsOiB0cnVlLCB0eXBlOiBcInRleHRcIn0pXG5cbiAgICB0cnkge1xuICAgICAgZm9yIChjb25zdCBzcWwgb2YgYXdhaXQgZGIuYWx0ZXJUYWJsZVNRTHModGFibGVEYXRhKSkge1xuICAgICAgICBhd2FpdCBkYi5xdWVyeShzcWwpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIEEgY29uY3VycmVudCBwcm9jZXNzIGNhbiBhZGQgdGhlIGNvbHVtbiBiZXR3ZWVuIHRoZSBwcmVzZW5jZSBjaGVja1xuICAgICAgLy8gYW5kIHRoZSBBTFRFUiAobXVsdGktd29ya2VyIG9yIHJvbGxpbmcgdXBncmFkZSk7IHRoZVxuICAgICAgLy8gZHVwbGljYXRlLWNvbHVtbiBmYWlsdXJlIGlzIHRoZW4gdGhlIGV4cGVjdGVkIG91dGNvbWUsIG5vdCBhIHJlYWxcbiAgICAgIC8vIGVycm9yLiBBbnl0aGluZyBlbHNlIHJlLWNoZWNrcyBhcyBhYnNlbnQgYW5kIHJldGhyb3dzLlxuICAgICAgaWYgKGF3YWl0IHRoaXMuX2NvbHVtblByZXNlbnQoZGIsIEVWRU5UU19UQUJMRSwgXCJwYXJhbXNfanNvblwiKSkgcmV0dXJuXG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIHJlcGxheSBjaGFubmVscyB0YWJsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVJlcGxheUNoYW5uZWxzVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHMoUkVQTEFZX0NIQU5ORUxTX1RBQkxFKSkgcmV0dXJuXG5cbiAgICBjb25zdCByZXBsYXlDaGFubmVsVGFibGUgPSBuZXcgVGFibGVEYXRhKFJFUExBWV9DSEFOTkVMU19UQUJMRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHJlcGxheUNoYW5uZWxUYWJsZS5zdHJpbmcoXCJjaGFubmVsXCIsIHtudWxsOiBmYWxzZSwgcHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgcmVwbGF5Q2hhbm5lbFRhYmxlLmRhdGV0aW1lKFwiaW50ZXJlc3RlZF91bnRpbFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcblxuICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHJlcGxheUNoYW5uZWxUYWJsZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBldmVudCBieSBpZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaWQgLSBFdmVudCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8V2Vic29ja2V0UGVyc2lzdGVkRXZlbnQgfCBudWxsPn0gLSBFdmVudCByb3cgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIF9nZXRFdmVudEJ5SWQoe2NoYW5uZWwsIGRiLCBpZH0pIHtcbiAgICBjb25zdCByb3dzID0gLyoqIEB0eXBlIHtXZWJzb2NrZXRFdmVudFJvd1tdfSAqLyAoYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShFVkVOVFNfVEFCTEUpXG4gICAgICAud2hlcmUoe2NoYW5uZWwsIGlkfSlcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKSlcblxuICAgIGlmICghcm93c1swXSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB0aGlzLl9ub3JtYWxpemVFdmVudFJvdyhyb3dzWzBdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGV2ZW50IHJvdy5cbiAgICogQHBhcmFtIHtXZWJzb2NrZXRFdmVudFJvd30gcm93IC0gUmF3IHJvdy5cbiAgICogQHJldHVybnMge1dlYnNvY2tldFBlcnNpc3RlZEV2ZW50fSAtIE5vcm1hbGl6ZWQgcm93LlxuICAgKi9cbiAgX25vcm1hbGl6ZUV2ZW50Um93KHJvdykge1xuICAgIGNvbnN0IGNyZWF0ZWRBdFZhbHVlID0gcm93LmNyZWF0ZWRfYXRcblxuICAgIHJldHVybiB7XG4gICAgICBjaGFubmVsOiByb3cuY2hhbm5lbCxcbiAgICAgIGNyZWF0ZWRBdDogY3JlYXRlZEF0VmFsdWUgaW5zdGFuY2VvZiBEYXRlID8gY3JlYXRlZEF0VmFsdWUudG9JU09TdHJpbmcoKSA6IG5ldyBEYXRlKGNyZWF0ZWRBdFZhbHVlKS50b0lTT1N0cmluZygpLFxuICAgICAgaWQ6IHJvdy5pZCxcbiAgICAgIHBhcmFtczogcm93LnBhcmFtc19qc29uID09PSBudWxsIHx8IHJvdy5wYXJhbXNfanNvbiA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IEpTT04ucGFyc2Uocm93LnBhcmFtc19qc29uKSxcbiAgICAgIHBheWxvYWQ6IEpTT04ucGFyc2Uocm93LnBheWxvYWRfanNvbiksXG4gICAgICBzZXF1ZW5jZTogTnVtYmVyKHJvdy5zZXF1ZW5jZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cHNlcnQgcmVwbGF5IGNoYW5uZWwgaW50ZXJlc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge0RhdGV9IGFyZ3MuaW50ZXJlc3RlZFVudGlsIC0gUmV0ZW50aW9uIGRlYWRsaW5lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSByZXBsYXktY2hhbm5lbCByb3cgd2FzIHVwc2VydGVkLlxuICAgKi9cbiAgYXN5bmMgX3Vwc2VydFJlcGxheUNoYW5uZWxJbnRlcmVzdChkYiwge2NoYW5uZWwsIGludGVyZXN0ZWRVbnRpbH0pIHtcbiAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgY29uZmxpY3RDb2x1bW5zOiBbXCJjaGFubmVsXCJdLFxuICAgICAgZGF0YToge1xuICAgICAgICBjaGFubmVsLFxuICAgICAgICBpbnRlcmVzdGVkX3VudGlsOiBpbnRlcmVzdGVkVW50aWxcbiAgICAgIH0sXG4gICAgICB0YWJsZU5hbWU6IFJFUExBWV9DSEFOTkVMU19UQUJMRSxcbiAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcImludGVyZXN0ZWRfdW50aWxcIl1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBkYi5cbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRGIoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBbdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJdLCBuYW1lOiBcIldlYnNvY2tldCBldmVudCBsb2cgc3RvcmVcIn0sIGFzeW5jIChkYnMpID0+IHtcbiAgICAgIGNvbnN0IGRiID0gZGJzW3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyXVxuXG4gICAgICBpZiAoIWRiKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGRhdGFiYXNlIGNvbm5lY3Rpb24gYXZhaWxhYmxlIGZvciBpZGVudGlmaWVyOiAke3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyfWApXG5cbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYilcbiAgICB9KVxuICB9XG59XG4iXX0=