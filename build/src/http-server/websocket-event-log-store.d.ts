import Logger from "../logger.js";
export type WebsocketEventRow = {
    /**
     * - Channel name.
     */
    channel: string;
    /**
     * - Creation time.
     */
    created_at: Date | string;
    /**
     * - Event id.
     */
    id: string;
    /**
     * - Serialized payload.
     */
    payload_json: string;
    /**
     * - Sequence number.
     */
    sequence: number | string;
};
export type WebsocketReplayChannelRow = {
    /**
     * - Channel name.
     */
    channel: string;
};
/**
 * Runs the websocketEventLogStoreForConfiguration helper.
 * @param {import("../configuration.js").default} configuration - Configuration.
 * @returns {VelociousHttpServerWebsocketEventLogStore} - Shared store instance.
 */
export declare function websocketEventLogStoreForConfiguration(configuration: import("../configuration.js").default): VelociousHttpServerWebsocketEventLogStore;
export default class VelociousHttpServerWebsocketEventLogStore {
    configuration: import("../configuration.js").default;
    databaseIdentifier: string;
    retentionMs: number;
    logger: Logger;
    _isReady: boolean;
    _readyPromise: Promise<void> | null;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<string, number>} */
    _interestedChannels: Map<string, number>;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} [args.databaseIdentifier] - Database identifier.
     * @param {number} [args.retentionMs] - Event retention in milliseconds.
     */
    constructor({ configuration, databaseIdentifier, retentionMs }: {
        configuration: import("../configuration.js").default;
        databaseIdentifier?: string;
        retentionMs?: number;
    });
    /**
     * Runs ensure ready.
     * @returns {Promise<void>} - Resolves when ready.
     */
    ensureReady(): Promise<void>;
    /**
     * Re-validates cached schema readiness because transactional DDL can roll the tables back.
     * @returns {Promise<boolean>} - Whether the cached ready state is still valid.
     */
    _schemaReady(): Promise<boolean>;
    /**
     * Runs schema present.
     * @returns {Promise<boolean>} - Whether both event-log tables physically exist.
     */
    _schemaPresent(): Promise<boolean>;
    /**
     * Runs append event.
     * @param {object} args - Options.
     * @param {string} args.channel - Channel name.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Event payload.
     * @returns {Promise<{channel: string, createdAt: string, id: string, payload: ReturnType<typeof JSON.parse>}>} - Persisted event row.
     */
    appendEvent({ channel, payload }: {
        channel: string;
        payload: ReturnType<typeof JSON.parse>;
    }): Promise<{
        channel: string;
        createdAt: string;
        id: string;
        payload: ReturnType<typeof JSON.parse>;
    }>;
    /**
     * Runs mark channel interested.
     * @param {string} channel - Channel name.
     * @returns {Promise<void>} - Resolves when the channel interest was persisted.
     */
    markChannelInterested(channel: string): Promise<void>;
    /**
     * Runs should persist channel.
     * @param {string} channel - Channel name.
     * @returns {Promise<boolean>} - Whether the channel should be persisted for replay.
     */
    shouldPersistChannel(channel: string): Promise<boolean>;
    /**
     * Runs channel interest cached.
     * @param {string} channel - Channel name.
     * @returns {boolean} - Whether memory cache still marks the channel interested.
     */
    _channelInterestCached(channel: string): boolean;
    /**
     * Runs get event by id.
     * @param {object} args - Options.
     * @param {string} args.channel - Channel name.
     * @param {string} args.id - Event id.
     * @returns {Promise<{channel: string, createdAt: string, id: string, payload: ReturnType<typeof JSON.parse>, sequence: number} | null>} - Event row or null.
     */
    getEventById({ channel, id }: {
        channel: string;
        id: string;
    }): Promise<{
        channel: string;
        createdAt: string;
        id: string;
        payload: ReturnType<typeof JSON.parse>;
        sequence: number;
    } | null>;
    /**
     * Runs latest sequence.
     * @param {string} channel - Channel name.
     * @returns {Promise<number | null>} - Latest channel sequence.
     */
    latestSequence(channel: string): Promise<number | null>;
    /**
     * Runs get events after.
     * @param {object} args - Options.
     * @param {string} args.channel - Channel name.
     * @param {number} args.sequence - Lower bound sequence.
     * @param {number | null | undefined} [args.upToSequence] - Inclusive ceiling sequence.
     * @returns {Promise<Array<{channel: string, createdAt: string, id: string, payload: ReturnType<typeof JSON.parse>, sequence: number}>>} - Ordered events.
     */
    getEventsAfter({ channel, sequence, upToSequence }: {
        channel: string;
        sequence: number;
        upToSequence?: number | null | undefined;
    }): Promise<Array<{
        channel: string;
        createdAt: string;
        id: string;
        payload: ReturnType<typeof JSON.parse>;
        sequence: number;
    }>>;
    /**
     * Runs cleanup expired.
     * @param {object} [args] - Options.
     * @param {Date} [args.now] - Cleanup reference time.
     * @returns {Promise<void>} - Resolves when cleanup completes.
     */
    cleanupExpired({ now }?: {
        now?: Date;
    }): Promise<void>;
    _ensureSchema(): Promise<void>;
    /**
     * Runs ensure events table.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _ensureEventsTable(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Runs ensure replay channels table.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _ensureReplayChannelsTable(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Runs get event by id.
     * @param {object} args - Options.
     * @param {string} args.channel - Channel name.
     * @param {import("../database/drivers/base.js").default} args.db - Database connection.
     * @param {string} args.id - Event id.
     * @returns {Promise<{channel: string, createdAt: string, id: string, payload: ReturnType<typeof JSON.parse>, sequence: number} | null>} - Event row or null.
     */
    _getEventById({ channel, db, id }: {
        channel: string;
        db: import("../database/drivers/base.js").default;
        id: string;
    }): Promise<{
        channel: string;
        createdAt: string;
        id: string;
        payload: ReturnType<typeof JSON.parse>;
        sequence: number;
    } | null>;
    /**
     * Runs normalize event row.
     * @param {WebsocketEventRow} row - Raw row.
     * @returns {{channel: string, createdAt: string, id: string, payload: ReturnType<typeof JSON.parse>, sequence: number}} - Normalized row.
     */
    _normalizeEventRow(row: WebsocketEventRow): {
        channel: string;
        createdAt: string;
        id: string;
        payload: ReturnType<typeof JSON.parse>;
        sequence: number;
    };
    /**
     * Runs upsert replay channel interest.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {object} args - Options.
     * @param {string} args.channel - Channel name.
     * @param {Date} args.interestedUntil - Retention deadline.
     * @returns {Promise<void>} - Resolves when the replay-channel row was upserted.
     */
    _upsertReplayChannelInterest(db: import("../database/drivers/base.js").default, { channel, interestedUntil }: {
        channel: string;
        interestedUntil: Date;
    }): Promise<void>;
    /**
     * Runs with db.
     * @param {(db: import("../database/drivers/base.js").default) => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    _withDb(callback: (db: import("../database/drivers/base.js").default) => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
}
//# sourceMappingURL=websocket-event-log-store.d.ts.map