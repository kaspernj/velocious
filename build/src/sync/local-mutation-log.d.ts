/**
 * Local mutation log record query options.
 * @typedef {object} LocalMutationLogRecordsOptions
 * @property {LocalMutationStatus[]} [statuses] - Optional status filter.
 */
/**
 * Local mutation log row-oriented storage adapter.
 *
 * Implementations should store each mutation log record as its own row/entry.
 * Native apps should back this with SQLite and indexes on storage key, status,
 * and sequence. Avoid storing the whole log as one JSON blob.
 * @typedef {object} LocalMutationLogStorage
 * @property {(storageKey: string, record: LocalMutationLogRecord) => Promise<void> | void} appendRecord - Appends one log record.
 * @property {(storageKey: string, ids: string[]) => Promise<void> | void} deleteRecords - Deletes log records by id.
 * @property {(storageKey: string) => Promise<number> | number} nextSequence - Returns the next local sequence number.
 * @property {(storageKey: string, id: string) => Promise<LocalMutationLogRecord | null | undefined> | LocalMutationLogRecord | null | undefined} record - Reads one log record by id.
 * @property {(storageKey: string, options?: LocalMutationLogRecordsOptions) => Promise<LocalMutationLogRecord[]> | LocalMutationLogRecord[]} records - Reads log records.
 * @property {(storageKey: string, record: LocalMutationLogRecord) => Promise<void> | void} updateRecord - Replaces one log record.
 */
/**
 * Local sync mutation dependency metadata.
 * @typedef {object} LocalMutationDependency
 * @property {string} clientMutationId - Client mutation id this mutation depends on.
 * @property {string} model - Dependent model/resource name.
 */
/**
 * Local mutation log status.
 * @typedef {"pending" | "applied-locally" | "peer-applied" | "conflict" | "rejected" | "synced"} LocalMutationStatus
 * */
/**
 * Local mutation log record.
 * @typedef {object} LocalMutationLogRecord
 * @property {string} createdAt - ISO timestamp when the record was created locally.
 * @property {LocalMutationDependency[]} dependencies - Other local mutations that must replay first.
 * @property {string} id - Local log record id.
 * @property {import("./device-identity.js").SyncMutation} mutation - Device mutation payload.
 * @property {import("./device-identity.js").SignedSyncMutation} [signedMutation] - Original signed mutation envelope, retained for peer-forwarded mutations.
 * @property {number} sequence - Monotonic local sequence.
 * @property {LocalMutationStatus} status - Local replay/apply status.
 * @property {Record<string, import("../frontend-models/base.js").FrontendModelTransportValue>} [syncResult] - Backend replay/result metadata. Stored as transport markers so Date (and other typed) values survive the durable JSON round trip and are restored on readback.
 * @property {string} updatedAt - ISO timestamp when the record was last changed.
 */
export type LocalMutationLogRecordsOptions = {
    /**
     * - Optional status filter.
     */
    statuses?: LocalMutationStatus[];
};
export type LocalMutationLogStorage = {
    /**
     * - Appends one log record.
     */
    appendRecord: (storageKey: string, record: LocalMutationLogRecord) => Promise<void> | void;
    /**
     * - Deletes log records by id.
     */
    deleteRecords: (storageKey: string, ids: string[]) => Promise<void> | void;
    /**
     * - Returns the next local sequence number.
     */
    nextSequence: (storageKey: string) => Promise<number> | number;
    /**
     * - Reads one log record by id.
     */
    record: (storageKey: string, id: string) => Promise<LocalMutationLogRecord | null | undefined> | LocalMutationLogRecord | null | undefined;
    /**
     * - Reads log records.
     */
    records: (storageKey: string, options?: LocalMutationLogRecordsOptions) => Promise<LocalMutationLogRecord[]> | LocalMutationLogRecord[];
    /**
     * - Replaces one log record.
     */
    updateRecord: (storageKey: string, record: LocalMutationLogRecord) => Promise<void> | void;
};
export type LocalMutationDependency = {
    /**
     * - Client mutation id this mutation depends on.
     */
    clientMutationId: string;
    /**
     * - Dependent model/resource name.
     */
    model: string;
};
export type LocalMutationStatus = "pending" | "applied-locally" | "peer-applied" | "conflict" | "rejected" | "synced";
export type LocalMutationLogRecord = {
    /**
     * - ISO timestamp when the record was created locally.
     */
    createdAt: string;
    /**
     * - Other local mutations that must replay first.
     */
    dependencies: LocalMutationDependency[];
    /**
     * - Local log record id.
     */
    id: string;
    /**
     * - Device mutation payload.
     */
    mutation: import("./device-identity.js").SyncMutation;
    /**
     * - Original signed mutation envelope, retained for peer-forwarded mutations.
     */
    signedMutation?: import("./device-identity.js").SignedSyncMutation;
    /**
     * - Monotonic local sequence.
     */
    sequence: number;
    /**
     * - Local replay/apply status.
     */
    status: LocalMutationStatus;
    /**
     * - Backend replay/result metadata. Stored as transport markers so Date (and other typed) values survive the durable JSON round trip and are restored on readback.
     */
    syncResult?: Record<string, import("../frontend-models/base.js").FrontendModelTransportValue>;
    /**
     * - ISO timestamp when the record was last changed.
     */
    updatedAt: string;
};
/** Client-side append-only sync mutation log with pluggable persistent storage. */
export default class LocalMutationLog {
    idGenerator: () => string;
    now: () => Date;
    storage: LocalMutationLogStorage;
    storageKey: string;
    /**
     * Creates a local mutation log.
     * @param {object} args - Arguments.
     * @param {() => string} [args.idGenerator] - Record id generator.
     * @param {() => Date} [args.now] - Clock callback.
     * @param {LocalMutationLogStorage} args.storage - Persistent storage adapter.
     * @param {string} [args.storageKey] - Storage key.
     */
    constructor({ idGenerator, now, storage, storageKey }: {
        idGenerator?: () => string;
        now?: () => Date;
        storage: LocalMutationLogStorage;
        storageKey?: string;
    });
    /**
     * Returns a log view with sequence, records, and locks partitioned by an
     * immutable physical tenant identity while reusing the same row store.
     * @param {string} partitionKey - Stable opaque partition identity.
     * @returns {LocalMutationLog} Partitioned log.
     */
    partition(partitionKey: string): LocalMutationLog;
    /**
     * Appends a pending mutation record.
     * @param {object} args - Arguments.
     * @param {LocalMutationDependency[]} [args.dependencies] - Mutation dependencies.
     * @param {import("./device-identity.js").SyncMutation} args.mutation - Mutation payload.
     * @param {import("./device-identity.js").SignedSyncMutation} [args.signedMutation] - Original signed mutation envelope, retained for peer-forwarded mutations.
     * @returns {Promise<LocalMutationLogRecord>} - Created log record.
     */
    append({ dependencies, mutation, signedMutation }: {
        dependencies?: LocalMutationDependency[];
        mutation: import("./device-identity.js").SyncMutation;
        signedMutation?: import("./device-identity.js").SignedSyncMutation;
    }): Promise<LocalMutationLogRecord>;
    /**
     * Returns all records ordered by local sequence.
     * @returns {Promise<LocalMutationLogRecord[]>} - Log records.
     */
    records(): Promise<LocalMutationLogRecord[]>;
    /**
     * Returns records that still need local/server reconciliation.
     * @returns {Promise<LocalMutationLogRecord[]>} - Pending records.
     */
    pendingRecords(): Promise<LocalMutationLogRecord[]>;
    /**
     * Updates a record status.
     * @param {object} args - Arguments.
     * @param {string} args.id - Record id.
     * @param {LocalMutationStatus} args.status - New status.
     * @param {Record<string, import("../frontend-models/base.js").FrontendModelTransportValue>} [args.syncResult] - Result metadata (may carry transport-restored typed values).
     * @returns {Promise<LocalMutationLogRecord>} - Updated record.
     */
    updateStatus({ id, status, syncResult }: {
        id: string;
        status: LocalMutationStatus;
        syncResult?: Record<string, import("../frontend-models/base.js").FrontendModelTransportValue>;
    }): Promise<LocalMutationLogRecord>;
    /**
     * Replaces the mutation payload of a still-pending record. Used when an
     * acknowledged predecessor supplies the authoritative base for its successor.
     * @param {{id: string, mutation: import("./device-identity.js").SyncMutation}} args - Record and replacement mutation.
     * @returns {Promise<LocalMutationLogRecord>} Updated record.
     */
    updateMutation({ id, mutation }: {
        id: string;
        mutation: import("./device-identity.js").SyncMutation;
    }): Promise<LocalMutationLogRecord>;
    /**
     * Prunes terminal records that are no longer needed for replay dependencies.
     * @param {object} [args] - Compaction options.
     * @param {number} [args.maxTerminalRecords] - Maximum terminal records to retain.
     * @param {number} [args.terminalRetentionMs] - Minimum age before pruning terminal records.
     * @returns {Promise<{deletedRecordIds: string[]}>} - Compaction result.
     */
    compact({ maxTerminalRecords, terminalRetentionMs }?: {
        maxTerminalRecords?: number;
        terminalRetentionMs?: number;
    }): Promise<{
        deletedRecordIds: string[];
    }>;
    /**
     * Returns the current log timestamp.
     * @returns {string} - Current ISO timestamp.
     */
    currentTimestamp(): string;
}
//# sourceMappingURL=local-mutation-log.d.ts.map