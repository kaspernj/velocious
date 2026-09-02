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
 * @property {number | string} sequence - Sequence number.
 */
/**
 * WebsocketReplayChannelRow type.
 * @typedef {object} WebsocketReplayChannelRow
 * @property {string} channel - Channel name.
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
     * @returns {Promise<boolean>} - Whether both event-log tables physically exist.
     */
    async _schemaPresent() {
        return await this._withDb(async (db) => await db.tableExists(EVENTS_TABLE) && await db.tableExists(REPLAY_CHANNELS_TABLE));
    }
    /**
     * Runs append event.
     * @param {object} args - Options.
     * @param {string} args.channel - Channel name.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Event payload.
     * @returns {Promise<{channel: string, createdAt: string, id: string, payload: ReturnType<typeof JSON.parse>}>} - Persisted event row.
     */
    async appendEvent({ channel, payload }) {
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
                    payload_json: JSON.stringify(payload)
                }
            });
            return { channel, createdAt: createdAt.toISOString(), id, payload };
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
     * @returns {Promise<{channel: string, createdAt: string, id: string, payload: ReturnType<typeof JSON.parse>, sequence: number} | null>} - Event row or null.
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
     * @returns {Promise<Array<{channel: string, createdAt: string, id: string, payload: ReturnType<typeof JSON.parse>, sequence: number}>>} - Ordered events.
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
        this.logger.info("Applying websocket event-log schema");
        if (await db.tableExists(EVENTS_TABLE)) {
            this.logger.info("Websocket event-log table already exists - skipping create");
            return;
        }
        const eventTable = new TableData(EVENTS_TABLE, { ifNotExists: true });
        eventTable.integer("sequence", { autoIncrement: true, null: false, primaryKey: true });
        eventTable.string("id", { index: true, null: false });
        eventTable.string("channel", { index: true, null: false });
        eventTable.text("payload_json", { null: false });
        eventTable.datetime("created_at", { index: true, null: false });
        await db.createTable(eventTable);
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
     * @returns {Promise<{channel: string, createdAt: string, id: string, payload: ReturnType<typeof JSON.parse>, sequence: number} | null>} - Event row or null.
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
     * @returns {{channel: string, createdAt: string, id: string, payload: ReturnType<typeof JSON.parse>, sequence: number}} - Normalized row.
     */
    _normalizeEventRow(row) {
        const createdAtValue = row.created_at;
        return {
            channel: row.channel,
            createdAt: createdAtValue instanceof Date ? createdAtValue.toISOString() : new Date(createdAtValue).toISOString(),
            id: row.id,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWV2ZW50LWxvZy1zdG9yZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci93ZWJzb2NrZXQtZXZlbnQtbG9nLXN0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sUUFBUSxDQUFBO0FBQ2pDLE9BQU8sU0FBUyxNQUFNLGlDQUFpQyxDQUFBO0FBQ3ZELE9BQU8sTUFBTSxNQUFNLGNBQWMsQ0FBQTtBQUVqQzs7Ozs7Ozs7R0FRRztBQUNIOzs7O0dBSUc7QUFDSCxNQUFNLFlBQVksR0FBRywwQkFBMEIsQ0FBQTtBQUMvQyxNQUFNLHFCQUFxQixHQUFHLDJCQUEyQixDQUFBO0FBQ3pELE1BQU0sb0JBQW9CLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUE7QUFDM0MsTUFBTSxNQUFNLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUU1Qjs7OztHQUlHO0FBQ0gsTUFBTSxVQUFVLHNDQUFzQyxDQUFDLGFBQWE7SUFDbEUsSUFBSSxLQUFLLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQTtJQUVyQyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDWCxLQUFLLEdBQUcsSUFBSSx5Q0FBeUMsQ0FBQyxFQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7UUFDdEUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsS0FBSyxDQUFDLENBQUE7SUFDbEMsQ0FBQztJQUVELE9BQU8sS0FBSyxDQUFBO0FBQ2QsQ0FBQztBQUVELE1BQU0sQ0FBQyxPQUFPLE9BQU8seUNBQXlDO0lBQzVEOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsa0JBQWtCLEdBQUcsU0FBUyxFQUFFLFdBQVcsR0FBRyxvQkFBb0IsRUFBQztRQUM3RixJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQTtR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TUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsbUJBQW1CLEVBQUUsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsRUFBRSxJQUFJLEVBQUUsMkJBQTJCLEVBQUMsRUFBRSxLQUFLLEVBQUUsR0FBRyxFQUFFLEVBQUU7WUFDbkosTUFBTSxFQUFFLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1lBRXZDLElBQUksQ0FBQyxFQUFFO2dCQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0RBQW9ELElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDLENBQUE7WUFFdkcsT0FBTyxNQUFNLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUMzQixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge3JhbmRvbVVVSUR9IGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vZGF0YWJhc2UvdGFibGUtZGF0YS9pbmRleC5qc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuXG4vKipcbiAqIFdlYnNvY2tldEV2ZW50Um93IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXZWJzb2NrZXRFdmVudFJvd1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gKiBAcHJvcGVydHkge0RhdGUgfCBzdHJpbmd9IGNyZWF0ZWRfYXQgLSBDcmVhdGlvbiB0aW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGlkIC0gRXZlbnQgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcGF5bG9hZF9qc29uIC0gU2VyaWFsaXplZCBwYXlsb2FkLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBzdHJpbmd9IHNlcXVlbmNlIC0gU2VxdWVuY2UgbnVtYmVyLlxuICovXG4vKipcbiAqIFdlYnNvY2tldFJlcGxheUNoYW5uZWxSb3cgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFdlYnNvY2tldFJlcGxheUNoYW5uZWxSb3dcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICovXG5jb25zdCBFVkVOVFNfVEFCTEUgPSBcIndlYnNvY2tldF9jaGFubmVsX2V2ZW50c1wiXG5jb25zdCBSRVBMQVlfQ0hBTk5FTFNfVEFCTEUgPSBcIndlYnNvY2tldF9yZXBsYXlfY2hhbm5lbHNcIlxuY29uc3QgREVGQVVMVF9SRVRFTlRJT05fTVMgPSAxMCAqIDYwICogMTAwMFxuY29uc3Qgc3RvcmVzID0gbmV3IFdlYWtNYXAoKVxuXG4vKipcbiAqIFJ1bnMgdGhlIHdlYnNvY2tldEV2ZW50TG9nU3RvcmVGb3JDb25maWd1cmF0aW9uIGhlbHBlci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAqIEByZXR1cm5zIHtWZWxvY2lvdXNIdHRwU2VydmVyV2Vic29ja2V0RXZlbnRMb2dTdG9yZX0gLSBTaGFyZWQgc3RvcmUgaW5zdGFuY2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3ZWJzb2NrZXRFdmVudExvZ1N0b3JlRm9yQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSB7XG4gIGxldCBzdG9yZSA9IHN0b3Jlcy5nZXQoY29uZmlndXJhdGlvbilcblxuICBpZiAoIXN0b3JlKSB7XG4gICAgc3RvcmUgPSBuZXcgVmVsb2Npb3VzSHR0cFNlcnZlcldlYnNvY2tldEV2ZW50TG9nU3RvcmUoe2NvbmZpZ3VyYXRpb259KVxuICAgIHN0b3Jlcy5zZXQoY29uZmlndXJhdGlvbiwgc3RvcmUpXG4gIH1cblxuICByZXR1cm4gc3RvcmVcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzSHR0cFNlcnZlcldlYnNvY2tldEV2ZW50TG9nU3RvcmUge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRhdGFiYXNlSWRlbnRpZmllcl0gLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmV0ZW50aW9uTXNdIC0gRXZlbnQgcmV0ZW50aW9uIGluIG1pbGxpc2Vjb25kcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIgPSBcImRlZmF1bHRcIiwgcmV0ZW50aW9uTXMgPSBERUZBVUxUX1JFVEVOVElPTl9NU30pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLnJldGVudGlvbk1zID0gcmV0ZW50aW9uTXNcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgICB0aGlzLl9pc1JlYWR5ID0gZmFsc2VcbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIHRoaXMuX2ludGVyZXN0ZWRDaGFubmVscyA9IG5ldyBNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIHJlYWR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlUmVhZHkoKSB7XG4gICAgaWYgKGF3YWl0IHRoaXMuX3NjaGVtYVJlYWR5KCkpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuX3JlYWR5UHJvbWlzZVxuXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcbiAgICAgIGF3YWl0IHRoaXMuX2Vuc3VyZVNjaGVtYSgpXG4gICAgICB0aGlzLl9pc1JlYWR5ID0gdHJ1ZVxuICAgIH0pKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKCF0aGlzLl9pc1JlYWR5KSB7XG4gICAgICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IG51bGxcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmUtdmFsaWRhdGVzIGNhY2hlZCBzY2hlbWEgcmVhZGluZXNzIGJlY2F1c2UgdHJhbnNhY3Rpb25hbCBEREwgY2FuIHJvbGwgdGhlIHRhYmxlcyBiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBjYWNoZWQgcmVhZHkgc3RhdGUgaXMgc3RpbGwgdmFsaWQuXG4gICAqL1xuICBhc3luYyBfc2NoZW1hUmVhZHkoKSB7XG4gICAgaWYgKCF0aGlzLl9pc1JlYWR5KSByZXR1cm4gZmFsc2VcbiAgICBpZiAoYXdhaXQgdGhpcy5fc2NoZW1hUHJlc2VudCgpKSByZXR1cm4gdHJ1ZVxuXG4gICAgdGhpcy5faXNSZWFkeSA9IGZhbHNlXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzY2hlbWEgcHJlc2VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBib3RoIGV2ZW50LWxvZyB0YWJsZXMgcGh5c2ljYWxseSBleGlzdC5cbiAgICovXG4gIGFzeW5jIF9zY2hlbWFQcmVzZW50KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PlxuICAgICAgYXdhaXQgZGIudGFibGVFeGlzdHMoRVZFTlRTX1RBQkxFKSAmJiBhd2FpdCBkYi50YWJsZUV4aXN0cyhSRVBMQVlfQ0hBTk5FTFNfVEFCTEUpXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwZW5kIGV2ZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucGF5bG9hZCAtIEV2ZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjaGFubmVsOiBzdHJpbmcsIGNyZWF0ZWRBdDogc3RyaW5nLCBpZDogc3RyaW5nLCBwYXlsb2FkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSAtIFBlcnNpc3RlZCBldmVudCByb3cuXG4gICAqL1xuICBhc3luYyBhcHBlbmRFdmVudCh7Y2hhbm5lbCwgcGF5bG9hZH0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IGlkID0gcmFuZG9tVVVJRCgpXG4gICAgY29uc3QgY3JlYXRlZEF0ID0gbmV3IERhdGUoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IGRiLmluc2VydCh7XG4gICAgICAgIHRhYmxlTmFtZTogRVZFTlRTX1RBQkxFLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgY2hhbm5lbCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBjcmVhdGVkQXQsXG4gICAgICAgICAgaWQsXG4gICAgICAgICAgcGF5bG9hZF9qc29uOiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgcmV0dXJuIHtjaGFubmVsLCBjcmVhdGVkQXQ6IGNyZWF0ZWRBdC50b0lTT1N0cmluZygpLCBpZCwgcGF5bG9hZH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFyayBjaGFubmVsIGludGVyZXN0ZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjaGFubmVsIGludGVyZXN0IHdhcyBwZXJzaXN0ZWQuXG4gICAqL1xuICBhc3luYyBtYXJrQ2hhbm5lbEludGVyZXN0ZWQoY2hhbm5lbCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgaW50ZXJlc3RlZFVudGlsID0gbmV3IERhdGUoRGF0ZS5ub3coKSArIHRoaXMucmV0ZW50aW9uTXMpXG5cbiAgICB0aGlzLl9pbnRlcmVzdGVkQ2hhbm5lbHMuc2V0KGNoYW5uZWwsIGludGVyZXN0ZWRVbnRpbC5nZXRUaW1lKCkpXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl91cHNlcnRSZXBsYXlDaGFubmVsSW50ZXJlc3QoZGIsIHtjaGFubmVsLCBpbnRlcmVzdGVkVW50aWx9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaG91bGQgcGVyc2lzdCBjaGFubmVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgY2hhbm5lbCBzaG91bGQgYmUgcGVyc2lzdGVkIGZvciByZXBsYXkuXG4gICAqL1xuICBhc3luYyBzaG91bGRQZXJzaXN0Q2hhbm5lbChjaGFubmVsKSB7XG4gICAgaWYgKHRoaXMuX2NoYW5uZWxJbnRlcmVzdENhY2hlZChjaGFubmVsKSkgcmV0dXJuIHRydWVcbiAgICBpZiAodGhpcy5faW50ZXJlc3RlZENoYW5uZWxzLnNpemUgPT09IDApIHJldHVybiBmYWxzZVxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKFJFUExBWV9DSEFOTkVMU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtjaGFubmVsfSlcbiAgICAgICAgLndoZXJlKGBpbnRlcmVzdGVkX3VudGlsID4gJHtkYi5xdW90ZShuZXcgRGF0ZSgpKX1gKVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuXG4gICAgICByZXR1cm4gcm93cy5sZW5ndGggPiAwXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNoYW5uZWwgaW50ZXJlc3QgY2FjaGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBtZW1vcnkgY2FjaGUgc3RpbGwgbWFya3MgdGhlIGNoYW5uZWwgaW50ZXJlc3RlZC5cbiAgICovXG4gIF9jaGFubmVsSW50ZXJlc3RDYWNoZWQoY2hhbm5lbCkge1xuICAgIGNvbnN0IGludGVyZXN0ZWRVbnRpbCA9IHRoaXMuX2ludGVyZXN0ZWRDaGFubmVscy5nZXQoY2hhbm5lbClcblxuICAgIGlmICghaW50ZXJlc3RlZFVudGlsKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoaW50ZXJlc3RlZFVudGlsID4gRGF0ZS5ub3coKSkgcmV0dXJuIHRydWVcblxuICAgIHRoaXMuX2ludGVyZXN0ZWRDaGFubmVscy5kZWxldGUoY2hhbm5lbClcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV2ZW50IGJ5IGlkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmlkIC0gRXZlbnQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjaGFubmVsOiBzdHJpbmcsIGNyZWF0ZWRBdDogc3RyaW5nLCBpZDogc3RyaW5nLCBwYXlsb2FkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2VxdWVuY2U6IG51bWJlcn0gfCBudWxsPn0gLSBFdmVudCByb3cgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIGdldEV2ZW50QnlJZCh7Y2hhbm5lbCwgaWR9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2dldEV2ZW50QnlJZCh7Y2hhbm5lbCwgZGIsIGlkfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGF0ZXN0IHNlcXVlbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyIHwgbnVsbD59IC0gTGF0ZXN0IGNoYW5uZWwgc2VxdWVuY2UuXG4gICAqL1xuICBhc3luYyBsYXRlc3RTZXF1ZW5jZShjaGFubmVsKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKEVWRU5UU19UQUJMRSlcbiAgICAgICAgLndoZXJlKHtjaGFubmVsfSlcbiAgICAgICAgLm9yZGVyKFwic2VxdWVuY2UgREVTQ1wiKVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuICAgICAgY29uc3Qgcm93ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9ICovIChyb3dzWzBdKVxuXG4gICAgICBpZiAoIXJvdykgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIE51bWJlcihyb3cuc2VxdWVuY2UpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBldmVudHMgYWZ0ZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY2hhbm5lbCAtIENoYW5uZWwgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Muc2VxdWVuY2UgLSBMb3dlciBib3VuZCBzZXF1ZW5jZS5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBbYXJncy51cFRvU2VxdWVuY2VdIC0gSW5jbHVzaXZlIGNlaWxpbmcgc2VxdWVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PHtjaGFubmVsOiBzdHJpbmcsIGNyZWF0ZWRBdDogc3RyaW5nLCBpZDogc3RyaW5nLCBwYXlsb2FkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc2VxdWVuY2U6IG51bWJlcn0+Pn0gLSBPcmRlcmVkIGV2ZW50cy5cbiAgICovXG4gIGFzeW5jIGdldEV2ZW50c0FmdGVyKHtjaGFubmVsLCBzZXF1ZW5jZSwgdXBUb1NlcXVlbmNlfSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oRVZFTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoe2NoYW5uZWx9KVxuICAgICAgICAud2hlcmUoYHNlcXVlbmNlID4gJHtkYi5xdW90ZShzZXF1ZW5jZSl9YClcbiAgICAgICAgLm9yZGVyKFwic2VxdWVuY2UgQVNDXCIpXG5cbiAgICAgIGlmICh0eXBlb2YgdXBUb1NlcXVlbmNlID09PSBcIm51bWJlclwiKSB7XG4gICAgICAgIHF1ZXJ5LndoZXJlKGBzZXF1ZW5jZSA8PSAke2RiLnF1b3RlKHVwVG9TZXF1ZW5jZSl9YClcbiAgICAgIH1cblxuICAgICAgY29uc3Qgcm93cyA9IC8qKiBAdHlwZSB7V2Vic29ja2V0RXZlbnRSb3dbXX0gKi8gKGF3YWl0IHF1ZXJ5LnJlc3VsdHMoKSlcblxuICAgICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IHRoaXMuX25vcm1hbGl6ZUV2ZW50Um93KHJvdykpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFudXAgZXhwaXJlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7RGF0ZX0gW2FyZ3Mubm93XSAtIENsZWFudXAgcmVmZXJlbmNlIHRpbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xlYW51cCBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBjbGVhbnVwRXhwaXJlZCh7bm93ID0gbmV3IERhdGUoKX0gPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgY3V0b2ZmID0gbmV3IERhdGUobm93LmdldFRpbWUoKSAtIHRoaXMucmV0ZW50aW9uTXMpXG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBleHBpcmVkRXZlbnRSb3dzID0gLyoqIEB0eXBlIHtBcnJheTx7aWQ6IHN0cmluZ30+fSAqLyAoYXdhaXQgZGJcbiAgICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgICAgLmZyb20oRVZFTlRTX1RBQkxFKVxuICAgICAgICAud2hlcmUoYGNyZWF0ZWRfYXQgPD0gJHtkYi5xdW90ZShjdXRvZmYpfWApXG4gICAgICAgIC5yZXN1bHRzKCkpXG4gICAgICBjb25zdCBleHBpcmVkUmVwbGF5Q2hhbm5lbFJvd3MgPSAvKiogQHR5cGUge1dlYnNvY2tldFJlcGxheUNoYW5uZWxSb3dbXX0gKi8gKGF3YWl0IGRiXG4gICAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAgIC5mcm9tKFJFUExBWV9DSEFOTkVMU19UQUJMRSlcbiAgICAgICAgLndoZXJlKGBpbnRlcmVzdGVkX3VudGlsIDw9ICR7ZGIucXVvdGUobm93KX1gKVxuICAgICAgICAucmVzdWx0cygpKVxuXG4gICAgICBmb3IgKGNvbnN0IGV4cGlyZWRFdmVudFJvdyBvZiBleHBpcmVkRXZlbnRSb3dzKSB7XG4gICAgICAgIGF3YWl0IGRiLmRlbGV0ZSh7XG4gICAgICAgICAgdGFibGVOYW1lOiBFVkVOVFNfVEFCTEUsXG4gICAgICAgICAgY29uZGl0aW9uczoge2lkOiBleHBpcmVkRXZlbnRSb3cuaWR9XG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZXhwaXJlZFJlcGxheUNoYW5uZWxSb3cgb2YgZXhwaXJlZFJlcGxheUNoYW5uZWxSb3dzKSB7XG4gICAgICAgIGF3YWl0IGRiLmRlbGV0ZSh7XG4gICAgICAgICAgdGFibGVOYW1lOiBSRVBMQVlfQ0hBTk5FTFNfVEFCTEUsXG4gICAgICAgICAgY29uZGl0aW9uczoge2NoYW5uZWw6IGV4cGlyZWRSZXBsYXlDaGFubmVsUm93LmNoYW5uZWx9XG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIF9lbnN1cmVTY2hlbWEoKSB7XG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlRXZlbnRzVGFibGUoZGIpXG4gICAgICBhd2FpdCB0aGlzLl9lbnN1cmVSZXBsYXlDaGFubmVsc1RhYmxlKGRiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgZXZlbnRzIHRhYmxlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlRXZlbnRzVGFibGUoZGIpIHtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQXBwbHlpbmcgd2Vic29ja2V0IGV2ZW50LWxvZyBzY2hlbWFcIilcblxuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhFVkVOVFNfVEFCTEUpKSB7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiV2Vic29ja2V0IGV2ZW50LWxvZyB0YWJsZSBhbHJlYWR5IGV4aXN0cyAtIHNraXBwaW5nIGNyZWF0ZVwiKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgZXZlbnRUYWJsZSA9IG5ldyBUYWJsZURhdGEoRVZFTlRTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgZXZlbnRUYWJsZS5pbnRlZ2VyKFwic2VxdWVuY2VcIiwge2F1dG9JbmNyZW1lbnQ6IHRydWUsIG51bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICBldmVudFRhYmxlLnN0cmluZyhcImlkXCIsIHtpbmRleDogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuICAgIGV2ZW50VGFibGUuc3RyaW5nKFwiY2hhbm5lbFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcbiAgICBldmVudFRhYmxlLnRleHQoXCJwYXlsb2FkX2pzb25cIiwge251bGw6IGZhbHNlfSlcbiAgICBldmVudFRhYmxlLmRhdGV0aW1lKFwiY3JlYXRlZF9hdFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcblxuICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKGV2ZW50VGFibGUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgcmVwbGF5IGNoYW5uZWxzIHRhYmxlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlUmVwbGF5Q2hhbm5lbHNUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhSRVBMQVlfQ0hBTk5FTFNfVEFCTEUpKSByZXR1cm5cblxuICAgIGNvbnN0IHJlcGxheUNoYW5uZWxUYWJsZSA9IG5ldyBUYWJsZURhdGEoUkVQTEFZX0NIQU5ORUxTX1RBQkxFLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgcmVwbGF5Q2hhbm5lbFRhYmxlLnN0cmluZyhcImNoYW5uZWxcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICByZXBsYXlDaGFubmVsVGFibGUuZGF0ZXRpbWUoXCJpbnRlcmVzdGVkX3VudGlsXCIsIHtpbmRleDogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUocmVwbGF5Q2hhbm5lbFRhYmxlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV2ZW50IGJ5IGlkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5uZWwgLSBDaGFubmVsIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pZCAtIEV2ZW50IGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7Y2hhbm5lbDogc3RyaW5nLCBjcmVhdGVkQXQ6IHN0cmluZywgaWQ6IHN0cmluZywgcGF5bG9hZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNlcXVlbmNlOiBudW1iZXJ9IHwgbnVsbD59IC0gRXZlbnQgcm93IG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBfZ2V0RXZlbnRCeUlkKHtjaGFubmVsLCBkYiwgaWR9KSB7XG4gICAgY29uc3Qgcm93cyA9IC8qKiBAdHlwZSB7V2Vic29ja2V0RXZlbnRSb3dbXX0gKi8gKGF3YWl0IGRiXG4gICAgICAubmV3UXVlcnkoKVxuICAgICAgLmZyb20oRVZFTlRTX1RBQkxFKVxuICAgICAgLndoZXJlKHtjaGFubmVsLCBpZH0pXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKCkpXG5cbiAgICBpZiAoIXJvd3NbMF0pIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplRXZlbnRSb3cocm93c1swXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBldmVudCByb3cuXG4gICAqIEBwYXJhbSB7V2Vic29ja2V0RXZlbnRSb3d9IHJvdyAtIFJhdyByb3cuXG4gICAqIEByZXR1cm5zIHt7Y2hhbm5lbDogc3RyaW5nLCBjcmVhdGVkQXQ6IHN0cmluZywgaWQ6IHN0cmluZywgcGF5bG9hZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHNlcXVlbmNlOiBudW1iZXJ9fSAtIE5vcm1hbGl6ZWQgcm93LlxuICAgKi9cbiAgX25vcm1hbGl6ZUV2ZW50Um93KHJvdykge1xuICAgIGNvbnN0IGNyZWF0ZWRBdFZhbHVlID0gcm93LmNyZWF0ZWRfYXRcblxuICAgIHJldHVybiB7XG4gICAgICBjaGFubmVsOiByb3cuY2hhbm5lbCxcbiAgICAgIGNyZWF0ZWRBdDogY3JlYXRlZEF0VmFsdWUgaW5zdGFuY2VvZiBEYXRlID8gY3JlYXRlZEF0VmFsdWUudG9JU09TdHJpbmcoKSA6IG5ldyBEYXRlKGNyZWF0ZWRBdFZhbHVlKS50b0lTT1N0cmluZygpLFxuICAgICAgaWQ6IHJvdy5pZCxcbiAgICAgIHBheWxvYWQ6IEpTT04ucGFyc2Uocm93LnBheWxvYWRfanNvbiksXG4gICAgICBzZXF1ZW5jZTogTnVtYmVyKHJvdy5zZXF1ZW5jZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cHNlcnQgcmVwbGF5IGNoYW5uZWwgaW50ZXJlc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jaGFubmVsIC0gQ2hhbm5lbCBuYW1lLlxuICAgKiBAcGFyYW0ge0RhdGV9IGFyZ3MuaW50ZXJlc3RlZFVudGlsIC0gUmV0ZW50aW9uIGRlYWRsaW5lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSByZXBsYXktY2hhbm5lbCByb3cgd2FzIHVwc2VydGVkLlxuICAgKi9cbiAgYXN5bmMgX3Vwc2VydFJlcGxheUNoYW5uZWxJbnRlcmVzdChkYiwge2NoYW5uZWwsIGludGVyZXN0ZWRVbnRpbH0pIHtcbiAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgY29uZmxpY3RDb2x1bW5zOiBbXCJjaGFubmVsXCJdLFxuICAgICAgZGF0YToge1xuICAgICAgICBjaGFubmVsLFxuICAgICAgICBpbnRlcmVzdGVkX3VudGlsOiBpbnRlcmVzdGVkVW50aWxcbiAgICAgIH0sXG4gICAgICB0YWJsZU5hbWU6IFJFUExBWV9DSEFOTkVMU19UQUJMRSxcbiAgICAgIHVwZGF0ZUNvbHVtbnM6IFtcImludGVyZXN0ZWRfdW50aWxcIl1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBkYi5cbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRGIoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBbdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJdLCBuYW1lOiBcIldlYnNvY2tldCBldmVudCBsb2cgc3RvcmVcIn0sIGFzeW5jIChkYnMpID0+IHtcbiAgICAgIGNvbnN0IGRiID0gZGJzW3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyXVxuXG4gICAgICBpZiAoIWRiKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGRhdGFiYXNlIGNvbm5lY3Rpb24gYXZhaWxhYmxlIGZvciBpZGVudGlmaWVyOiAke3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyfWApXG5cbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYilcbiAgICB9KVxuICB9XG59XG4iXX0=