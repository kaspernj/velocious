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
// @ts-check
import { deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue } from "../frontend-models/transport-serialization.js";
import stableJsonStringify from "./stable-json.js";
const DEFAULT_STORAGE_KEY = "velocious.sync.localMutationLog";
const PENDING_STATUS_VALUES = /** @type {LocalMutationStatus[]} */ (["pending", "applied-locally", "peer-applied"]);
const PENDING_STATUSES = new Set(PENDING_STATUS_VALUES);
const MUTATION_STATUSES = new Set([...PENDING_STATUSES, "conflict", "rejected", "synced"]);
const TERMINAL_STATUSES = new Set(["rejected", "synced"]);
/** @type {Map<string, Promise<unknown>>} */
const STORAGE_KEY_LOCKS = new Map();
/** Client-side append-only sync mutation log with pluggable persistent storage. */
export default class LocalMutationLog {
    /**
     * Creates a local mutation log.
     * @param {object} args - Arguments.
     * @param {() => string} [args.idGenerator] - Record id generator.
     * @param {() => Date} [args.now] - Clock callback.
     * @param {LocalMutationLogStorage} args.storage - Persistent storage adapter.
     * @param {string} [args.storageKey] - Storage key.
     */
    constructor({ idGenerator = randomRecordId, now = () => new Date(), storage, storageKey = DEFAULT_STORAGE_KEY }) {
        if (!validStorage(storage)) {
            throw new Error("LocalMutationLog requires row storage with appendRecord/deleteRecords/nextSequence/record/records/updateRecord");
        }
        this.idGenerator = idGenerator;
        this.now = now;
        this.storage = storage;
        this.storageKey = storageKey;
    }
    /**
     * Returns a log view with sequence, records, and locks partitioned by an
     * immutable physical tenant identity while reusing the same row store.
     * @param {string} partitionKey - Stable opaque partition identity.
     * @returns {LocalMutationLog} Partitioned log.
     */
    partition(partitionKey) {
        if (!partitionKey)
            throw new Error("LocalMutationLog partition key must be a non-empty string");
        return new LocalMutationLog({
            idGenerator: this.idGenerator,
            now: this.now,
            storage: this.storage,
            storageKey: `${this.storageKey}:${partitionKey.length}:${partitionKey}`
        });
    }
    /**
     * Appends a pending mutation record.
     * @param {object} args - Arguments.
     * @param {LocalMutationDependency[]} [args.dependencies] - Mutation dependencies.
     * @param {import("./device-identity.js").SyncMutation} args.mutation - Mutation payload.
     * @param {import("./device-identity.js").SignedSyncMutation} [args.signedMutation] - Original signed mutation envelope, retained for peer-forwarded mutations.
     * @returns {Promise<LocalMutationLogRecord>} - Created log record.
     */
    async append({ dependencies = [], mutation, signedMutation }) {
        if (signedMutation !== undefined && stableJsonStringify(signedMutation.mutation) !== stableJsonStringify(mutation)) {
            throw new Error("Signed mutation payload does not match the mutation");
        }
        return await withStorageKeyLock(this.storageKey, async () => {
            const timestamp = this.currentTimestamp();
            const record = normalizeRecord({
                createdAt: timestamp,
                dependencies,
                id: this.idGenerator(),
                mutation,
                sequence: await this.storage.nextSequence(this.storageKey),
                signedMutation,
                status: "pending",
                updatedAt: timestamp
            });
            await this.storage.appendRecord(this.storageKey, cloneRecord(record));
            return cloneRecord(record);
        });
    }
    /**
     * Returns all records ordered by local sequence.
     * @returns {Promise<LocalMutationLogRecord[]>} - Log records.
     */
    async records() {
        return normalizeRecordList(await this.storage.records(this.storageKey));
    }
    /**
     * Returns records that still need local/server reconciliation.
     * @returns {Promise<LocalMutationLogRecord[]>} - Pending records.
     */
    async pendingRecords() {
        return normalizeRecordList(await this.storage.records(this.storageKey, { statuses: PENDING_STATUS_VALUES }));
    }
    /**
     * Updates a record status.
     * @param {object} args - Arguments.
     * @param {string} args.id - Record id.
     * @param {LocalMutationStatus} args.status - New status.
     * @param {Record<string, import("../frontend-models/base.js").FrontendModelTransportValue>} [args.syncResult] - Result metadata (may carry transport-restored typed values).
     * @returns {Promise<LocalMutationLogRecord>} - Updated record.
     */
    async updateStatus({ id, status, syncResult }) {
        if (!MUTATION_STATUSES.has(status))
            throw new Error(`Unknown local mutation status '${status}'`);
        return await withStorageKeyLock(this.storageKey, async () => {
            const rawRecord = await this.storage.record(this.storageKey, id);
            if (!rawRecord)
                throw new Error(`No local mutation log record '${id}'`);
            const record = normalizeRecord(rawRecord);
            record.status = /** @type {LocalMutationStatus} */ (status);
            if (syncResult !== undefined) {
                // Encode transport-restored typed values (e.g. Date attributes in a
                // conflict serverModel) as markers before the JSON clone so the
                // durable persistence round trip cannot stringify them.
                record.syncResult = cloneJsonObject(serializeFrontendModelTransportValue(syncResult), "syncResult");
            }
            record.updatedAt = this.currentTimestamp();
            await this.storage.updateRecord(this.storageKey, cloneRecord(record));
            return restoreSyncResultTypes(cloneRecord(record));
        });
    }
    /**
     * Replaces the mutation payload of a still-pending record. Used when an
     * acknowledged predecessor supplies the authoritative base for its successor.
     * @param {{id: string, mutation: import("./device-identity.js").SyncMutation}} args - Record and replacement mutation.
     * @returns {Promise<LocalMutationLogRecord>} Updated record.
     */
    async updateMutation({ id, mutation }) {
        return await withStorageKeyLock(this.storageKey, async () => {
            const rawRecord = await this.storage.record(this.storageKey, id);
            if (!rawRecord)
                throw new Error(`No local mutation log record '${id}'`);
            const record = normalizeRecord(rawRecord);
            if (!PENDING_STATUSES.has(record.status))
                throw new Error(`Cannot update mutation for ${record.status} local mutation '${id}'`);
            record.mutation = normalizeMutation(mutation);
            record.updatedAt = this.currentTimestamp();
            await this.storage.updateRecord(this.storageKey, cloneRecord(record));
            return restoreSyncResultTypes(cloneRecord(record));
        });
    }
    /**
     * Prunes terminal records that are no longer needed for replay dependencies.
     * @param {object} [args] - Compaction options.
     * @param {number} [args.maxTerminalRecords] - Maximum terminal records to retain.
     * @param {number} [args.terminalRetentionMs] - Minimum age before pruning terminal records.
     * @returns {Promise<{deletedRecordIds: string[]}>} - Compaction result.
     */
    async compact({ maxTerminalRecords, terminalRetentionMs } = {}) {
        return await withStorageKeyLock(this.storageKey, async () => {
            const records = await this.records();
            const protectedClientMutationIds = new Set(records
                .filter((record) => PENDING_STATUSES.has(record.status) || record.status === "conflict")
                .flatMap((record) => record.dependencies.map((dependency) => dependency.clientMutationId)));
            const terminalRecords = records
                .filter((record) => TERMINAL_STATUSES.has(record.status))
                .filter((record) => !protectedClientMutationIds.has(record.mutation.clientMutationId))
                .sort(compareRecordsNewestFirst);
            const deleteIds = new Set();
            if (typeof maxTerminalRecords === "number" && maxTerminalRecords >= 0) {
                for (const record of terminalRecords.slice(maxTerminalRecords))
                    deleteIds.add(record.id);
            }
            if (typeof terminalRetentionMs === "number" && terminalRetentionMs >= 0) {
                const cutoff = this.now().getTime() - terminalRetentionMs;
                for (const record of terminalRecords) {
                    if (new Date(record.updatedAt).getTime() < cutoff)
                        deleteIds.add(record.id);
                }
            }
            const deletedRecordIds = Array.from(deleteIds);
            if (deletedRecordIds.length > 0)
                await this.storage.deleteRecords(this.storageKey, deletedRecordIds);
            return { deletedRecordIds };
        });
    }
    /**
     * Returns the current log timestamp.
     * @returns {string} - Current ISO timestamp.
     */
    currentTimestamp() {
        const date = this.now();
        if (!(date instanceof Date) || Number.isNaN(date.getTime()))
            throw new Error("LocalMutationLog now() must return a valid Date");
        return date.toISOString();
    }
}
/**
 * Checks whether a storage adapter has all required row-store methods.
 * @param {unknown} storage - Storage adapter candidate.
 * @returns {storage is LocalMutationLogStorage} - Whether storage is valid.
 */
function validStorage(storage) {
    if (!storage || typeof storage !== "object")
        return false;
    const storageObject = /** @type {Record<string, unknown>} */ (storage);
    return typeof storageObject.appendRecord === "function"
        && typeof storageObject.deleteRecords === "function"
        && typeof storageObject.nextSequence === "function"
        && typeof storageObject.record === "function"
        && typeof storageObject.records === "function"
        && typeof storageObject.updateRecord === "function";
}
/**
 * Sorts records by newest update/sequence first.
 * @param {LocalMutationLogRecord} left - Left record.
 * @param {LocalMutationLogRecord} right - Right record.
 * @returns {number} - Sort result.
 */
function compareRecordsNewestFirst(left, right) {
    const updatedAtComparison = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedAtComparison !== 0)
        return updatedAtComparison;
    return right.sequence - left.sequence;
}
/**
 * Normalizes and sorts a list of records.
 * @param {unknown} records - Raw records.
 * @returns {LocalMutationLogRecord[]} - Normalized records.
 */
function normalizeRecordList(records) {
    if (!Array.isArray(records))
        throw new Error("Expected local mutation log storage records array");
    return records
        .map(normalizeRecord)
        .sort((left, right) => left.sequence - right.sequence)
        .map((record) => cloneRecord(record))
        .map(restoreSyncResultTypes);
}
/**
 * Restores transport-restored typed values in a record's syncResult after the
 * final JSON clone, so callers see Date (and other typed) values on durable
 * readback instead of marker-encoded ISO strings.
 * @param {LocalMutationLogRecord} record - Cloned record.
 * @returns {LocalMutationLogRecord} - Record with restored syncResult types.
 */
function restoreSyncResultTypes(record) {
    if (record.syncResult === undefined)
        return record;
    return {
        ...record,
        syncResult: /** @type {Record<string, import("../frontend-models/base.js").FrontendModelTransportValue>} */ (deserializeFrontendModelTransportValue(record.syncResult))
    };
}
/**
 * Runs a callback after earlier writes for the same storage key have completed.
 * @template T
 * @param {string} storageKey - Storage key to serialize.
 * @param {() => Promise<T>} callback - Callback to run under the storage-key lock.
 * @returns {Promise<T>} - Callback result.
 */
async function withStorageKeyLock(storageKey, callback) {
    const previous = STORAGE_KEY_LOCKS.get(storageKey) || Promise.resolve();
    let release = () => { };
    const current = new Promise((resolve) => { release = () => resolve(undefined); });
    const chained = previous.catch((_error) => { }).then(() => current);
    STORAGE_KEY_LOCKS.set(storageKey, chained);
    try {
        await previous.catch((_error) => { });
        return await callback();
    }
    finally {
        release();
        if (STORAGE_KEY_LOCKS.get(storageKey) === chained)
            STORAGE_KEY_LOCKS.delete(storageKey);
    }
}
/**
 * Normalizes a persisted log record.
 * @param {unknown} value - Raw record.
 * @returns {LocalMutationLogRecord} - Normalized record.
 */
function normalizeRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Expected local mutation log record object");
    const record = /** @type {Record<string, unknown>} */ (value);
    const status = requiredString(record.status, "status");
    if (!MUTATION_STATUSES.has(status))
        throw new Error(`Unknown local mutation status '${status}'`);
    const baseRecord = {
        createdAt: requiredIsoTimestamp(record.createdAt, "createdAt"),
        dependencies: normalizeDependencies(record.dependencies),
        id: requiredString(record.id, "id"),
        mutation: normalizeMutation(record.mutation),
        sequence: requiredPositiveInteger(record.sequence, "sequence"),
        status: /** @type {LocalMutationStatus} */ (status),
        updatedAt: requiredIsoTimestamp(record.updatedAt, "updatedAt")
    };
    if (record.signedMutation === undefined && record.syncResult === undefined)
        return baseRecord;
    /** @type {LocalMutationLogRecord} */
    const normalizedRecord = { ...baseRecord };
    if (record.signedMutation !== undefined) {
        normalizedRecord.signedMutation = /** @type {import("./device-identity.js").SignedSyncMutation} */ (cloneJsonObject(record.signedMutation, "signedMutation"));
    }
    if (record.syncResult !== undefined) {
        // Persisted syncResult is marker-encoded so it survives the JSON clone;
        // typed values are restored by restoreSyncResultTypes at the read boundary.
        normalizedRecord.syncResult = /** @type {Record<string, import("../frontend-models/base.js").FrontendModelTransportValue>} */ (cloneJsonObject(record.syncResult, "syncResult"));
    }
    return normalizedRecord;
}
/**
 * Normalizes dependency metadata entries.
 * @param {unknown} value - Raw dependencies.
 * @returns {LocalMutationDependency[]} - Normalized dependencies.
 */
function normalizeDependencies(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        throw new Error("Expected local mutation dependencies array");
    return value.map((dependency) => {
        if (!dependency || typeof dependency !== "object" || Array.isArray(dependency)) {
            throw new Error("Expected local mutation dependency object");
        }
        const dependencyObject = /** @type {Record<string, unknown>} */ (dependency);
        return {
            clientMutationId: requiredString(dependencyObject.clientMutationId, "dependency clientMutationId"),
            model: requiredString(dependencyObject.model, "dependency model")
        };
    });
}
/**
 * Normalizes a sync mutation payload.
 * @param {unknown} value - Raw mutation.
 * @returns {import("./device-identity.js").SyncMutation} - Normalized mutation.
 */
function normalizeMutation(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Expected local sync mutation object");
    const mutation = /** @type {Record<string, unknown>} */ (value);
    const normalized = /** @type {import("./device-identity.js").SyncMutation} */ ({
        actorDeviceId: requiredString(mutation.actorDeviceId, "actorDeviceId"),
        actorUserId: requiredString(mutation.actorUserId, "actorUserId"),
        clientMutationId: requiredString(mutation.clientMutationId, "clientMutationId"),
        model: requiredString(mutation.model, "model"),
        occurredAt: requiredIsoTimestamp(mutation.occurredAt, "occurredAt"),
        offlineGrantId: requiredString(mutation.offlineGrantId, "offlineGrantId"),
        operation: requiredString(mutation.operation, "operation"),
        policyHash: requiredString(mutation.policyHash, "policyHash")
    });
    if (mutation.attributes !== undefined)
        normalized.attributes = cloneJsonObject(mutation.attributes, "attributes");
    if (mutation.baseVersion !== undefined)
        normalized.baseVersion = cloneBaseVersion(mutation.baseVersion);
    if (mutation.command !== undefined)
        normalized.command = requiredString(mutation.command, "command");
    if (mutation.payload !== undefined)
        normalized.payload = cloneJsonObject(mutation.payload, "payload");
    return normalized;
}
/**
 * Requires a non-empty string value.
 * @param {unknown} value - Raw value.
 * @param {string} label - Field label.
 * @returns {string} - Required string.
 */
function requiredString(value, label) {
    if (typeof value !== "string" || value.length < 1)
        throw new Error(`Expected local mutation ${label}`);
    return value;
}
/**
 * Requires an ISO timestamp string.
 * @param {unknown} value - Raw value.
 * @param {string} label - Field label.
 * @returns {string} - ISO timestamp.
 */
function requiredIsoTimestamp(value, label) {
    const stringValue = requiredString(value, label);
    const date = new Date(stringValue);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== stringValue)
        throw new Error(`Expected local mutation ${label} ISO timestamp`);
    return stringValue;
}
/**
 * Requires a positive integer value.
 * @param {unknown} value - Raw value.
 * @param {string} label - Field label.
 * @returns {number} - Positive integer.
 */
function requiredPositiveInteger(value, label) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
        throw new Error(`Expected local mutation ${label} positive integer`);
    return value;
}
/**
 * Clones a supported base-version value.
 * @param {unknown} value - Raw base version.
 * @returns {string | number | null} - Normalized base version.
 */
function cloneBaseVersion(value) {
    if (value === null || typeof value === "string" || typeof value === "number")
        return value;
    throw new Error("Expected local mutation baseVersion string, number, or null");
}
/**
 * Clones a JSON-compatible value.
 * @param {unknown} value - Raw JSON value.
 * @param {string} label - Field label.
 * @returns {import("../configuration-types.js").FrontendModelSyncJsonValue} - Cloned JSON value.
 */
function cloneJsonValue(value, label) {
    if (value === undefined || typeof value === "function")
        throw new Error(`Expected JSON-compatible local mutation ${label}`);
    return /** @type {import("../configuration-types.js").FrontendModelSyncJsonValue} */ (JSON.parse(JSON.stringify(value)));
}
/**
 * Clones a JSON-compatible object.
 * @param {unknown} value - Raw JSON object.
 * @param {string} label - Field label.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} - Cloned JSON object.
 */
function cloneJsonObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`Expected local mutation ${label} object`);
    return /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (cloneJsonValue(value, label));
}
/**
 * Clones a local mutation log record.
 * @param {LocalMutationLogRecord} record - Record to clone.
 * @returns {LocalMutationLogRecord} - Cloned record.
 */
function cloneRecord(record) {
    return /** @type {LocalMutationLogRecord} */ (JSON.parse(JSON.stringify(record)));
}
/**
 * Generates a random local mutation record id.
 * @returns {string} - Random record id.
 */
function randomRecordId() {
    const cryptoProvider = globalThis.crypto;
    if (cryptoProvider && typeof cryptoProvider.randomUUID === "function")
        return cryptoProvider.randomUUID();
    return `local-mutation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jYWwtbXV0YXRpb24tbG9nLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvbG9jYWwtbXV0YXRpb24tbG9nLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7O0dBSUc7QUFDSDs7Ozs7Ozs7Ozs7OztHQWFHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7O0tBR0s7QUFDTDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCxZQUFZO0FBRVosT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sK0NBQStDLENBQUE7QUFDMUksT0FBTyxtQkFBbUIsTUFBTSxrQkFBa0IsQ0FBQTtBQUVsRCxNQUFNLG1CQUFtQixHQUFHLGlDQUFpQyxDQUFBO0FBQzdELE1BQU0scUJBQXFCLEdBQUcsb0NBQW9DLENBQUMsQ0FBQyxDQUFDLFNBQVMsRUFBRSxpQkFBaUIsRUFBRSxjQUFjLENBQUMsQ0FBQyxDQUFBO0FBQ25ILE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxHQUFHLENBQUMscUJBQXFCLENBQUMsQ0FBQTtBQUN2RCxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxnQkFBZ0IsRUFBRSxVQUFVLEVBQUUsVUFBVSxFQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUE7QUFDMUYsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQyxDQUFBO0FBQ3pELDRDQUE0QztBQUM1QyxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFFbkMsbUZBQW1GO0FBQ25GLE1BQU0sQ0FBQyxPQUFPLE9BQU8sZ0JBQWdCO0lBQ25DOzs7Ozs7O09BT0c7SUFDSCxZQUFZLEVBQUMsV0FBVyxHQUFHLGNBQWMsRUFBRSxHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUMsSUFBSSxJQUFJLEVBQUUsRUFBRSxPQUFPLEVBQUUsVUFBVSxHQUFHLG1CQUFtQixFQUFD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QUMsQ0FBQTtBQUNuRixDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBUyxjQUFjO0lBQ3JCLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxNQUFNLENBQUE7SUFFeEMsSUFBSSxjQUFjLElBQUksT0FBTyxjQUFjLENBQUMsVUFBVSxLQUFLLFVBQVU7UUFBRSxPQUFPLGNBQWMsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtJQUV6RyxPQUFPLGtCQUFrQixJQUFJLENBQUMsR0FBRyxFQUFFLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtBQUM5RSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBMb2NhbCBtdXRhdGlvbiBsb2cgcmVjb3JkIHF1ZXJ5IG9wdGlvbnMuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBMb2NhbE11dGF0aW9uTG9nUmVjb3Jkc09wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7TG9jYWxNdXRhdGlvblN0YXR1c1tdfSBbc3RhdHVzZXNdIC0gT3B0aW9uYWwgc3RhdHVzIGZpbHRlci5cbiAqL1xuLyoqXG4gKiBMb2NhbCBtdXRhdGlvbiBsb2cgcm93LW9yaWVudGVkIHN0b3JhZ2UgYWRhcHRlci5cbiAqXG4gKiBJbXBsZW1lbnRhdGlvbnMgc2hvdWxkIHN0b3JlIGVhY2ggbXV0YXRpb24gbG9nIHJlY29yZCBhcyBpdHMgb3duIHJvdy9lbnRyeS5cbiAqIE5hdGl2ZSBhcHBzIHNob3VsZCBiYWNrIHRoaXMgd2l0aCBTUUxpdGUgYW5kIGluZGV4ZXMgb24gc3RvcmFnZSBrZXksIHN0YXR1cyxcbiAqIGFuZCBzZXF1ZW5jZS4gQXZvaWQgc3RvcmluZyB0aGUgd2hvbGUgbG9nIGFzIG9uZSBKU09OIGJsb2IuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBMb2NhbE11dGF0aW9uTG9nU3RvcmFnZVxuICogQHByb3BlcnR5IHsoc3RvcmFnZUtleTogc3RyaW5nLCByZWNvcmQ6IExvY2FsTXV0YXRpb25Mb2dSZWNvcmQpID0+IFByb21pc2U8dm9pZD4gfCB2b2lkfSBhcHBlbmRSZWNvcmQgLSBBcHBlbmRzIG9uZSBsb2cgcmVjb3JkLlxuICogQHByb3BlcnR5IHsoc3RvcmFnZUtleTogc3RyaW5nLCBpZHM6IHN0cmluZ1tdKSA9PiBQcm9taXNlPHZvaWQ+IHwgdm9pZH0gZGVsZXRlUmVjb3JkcyAtIERlbGV0ZXMgbG9nIHJlY29yZHMgYnkgaWQuXG4gKiBAcHJvcGVydHkgeyhzdG9yYWdlS2V5OiBzdHJpbmcpID0+IFByb21pc2U8bnVtYmVyPiB8IG51bWJlcn0gbmV4dFNlcXVlbmNlIC0gUmV0dXJucyB0aGUgbmV4dCBsb2NhbCBzZXF1ZW5jZSBudW1iZXIuXG4gKiBAcHJvcGVydHkgeyhzdG9yYWdlS2V5OiBzdHJpbmcsIGlkOiBzdHJpbmcpID0+IFByb21pc2U8TG9jYWxNdXRhdGlvbkxvZ1JlY29yZCB8IG51bGwgfCB1bmRlZmluZWQ+IHwgTG9jYWxNdXRhdGlvbkxvZ1JlY29yZCB8IG51bGwgfCB1bmRlZmluZWR9IHJlY29yZCAtIFJlYWRzIG9uZSBsb2cgcmVjb3JkIGJ5IGlkLlxuICogQHByb3BlcnR5IHsoc3RvcmFnZUtleTogc3RyaW5nLCBvcHRpb25zPzogTG9jYWxNdXRhdGlvbkxvZ1JlY29yZHNPcHRpb25zKSA9PiBQcm9taXNlPExvY2FsTXV0YXRpb25Mb2dSZWNvcmRbXT4gfCBMb2NhbE11dGF0aW9uTG9nUmVjb3JkW119IHJlY29yZHMgLSBSZWFkcyBsb2cgcmVjb3Jkcy5cbiAqIEBwcm9wZXJ0eSB7KHN0b3JhZ2VLZXk6IHN0cmluZywgcmVjb3JkOiBMb2NhbE11dGF0aW9uTG9nUmVjb3JkKSA9PiBQcm9taXNlPHZvaWQ+IHwgdm9pZH0gdXBkYXRlUmVjb3JkIC0gUmVwbGFjZXMgb25lIGxvZyByZWNvcmQuXG4gKi9cbi8qKlxuICogTG9jYWwgc3luYyBtdXRhdGlvbiBkZXBlbmRlbmN5IG1ldGFkYXRhLlxuICogQHR5cGVkZWYge29iamVjdH0gTG9jYWxNdXRhdGlvbkRlcGVuZGVuY3lcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjbGllbnRNdXRhdGlvbklkIC0gQ2xpZW50IG11dGF0aW9uIGlkIHRoaXMgbXV0YXRpb24gZGVwZW5kcyBvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtb2RlbCAtIERlcGVuZGVudCBtb2RlbC9yZXNvdXJjZSBuYW1lLlxuICovXG4vKipcbiAqIExvY2FsIG11dGF0aW9uIGxvZyBzdGF0dXMuXG4gKiBAdHlwZWRlZiB7XCJwZW5kaW5nXCIgfCBcImFwcGxpZWQtbG9jYWxseVwiIHwgXCJwZWVyLWFwcGxpZWRcIiB8IFwiY29uZmxpY3RcIiB8IFwicmVqZWN0ZWRcIiB8IFwic3luY2VkXCJ9IExvY2FsTXV0YXRpb25TdGF0dXNcbiAqICovXG4vKipcbiAqIExvY2FsIG11dGF0aW9uIGxvZyByZWNvcmQuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBMb2NhbE11dGF0aW9uTG9nUmVjb3JkXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY3JlYXRlZEF0IC0gSVNPIHRpbWVzdGFtcCB3aGVuIHRoZSByZWNvcmQgd2FzIGNyZWF0ZWQgbG9jYWxseS5cbiAqIEBwcm9wZXJ0eSB7TG9jYWxNdXRhdGlvbkRlcGVuZGVuY3lbXX0gZGVwZW5kZW5jaWVzIC0gT3RoZXIgbG9jYWwgbXV0YXRpb25zIHRoYXQgbXVzdCByZXBsYXkgZmlyc3QuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaWQgLSBMb2NhbCBsb2cgcmVjb3JkIGlkLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb259IG11dGF0aW9uIC0gRGV2aWNlIG11dGF0aW9uIHBheWxvYWQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlNpZ25lZFN5bmNNdXRhdGlvbn0gW3NpZ25lZE11dGF0aW9uXSAtIE9yaWdpbmFsIHNpZ25lZCBtdXRhdGlvbiBlbnZlbG9wZSwgcmV0YWluZWQgZm9yIHBlZXItZm9yd2FyZGVkIG11dGF0aW9ucy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzZXF1ZW5jZSAtIE1vbm90b25pYyBsb2NhbCBzZXF1ZW5jZS5cbiAqIEBwcm9wZXJ0eSB7TG9jYWxNdXRhdGlvblN0YXR1c30gc3RhdHVzIC0gTG9jYWwgcmVwbGF5L2FwcGx5IHN0YXR1cy5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gW3N5bmNSZXN1bHRdIC0gQmFja2VuZCByZXBsYXkvcmVzdWx0IG1ldGFkYXRhLiBTdG9yZWQgYXMgdHJhbnNwb3J0IG1hcmtlcnMgc28gRGF0ZSAoYW5kIG90aGVyIHR5cGVkKSB2YWx1ZXMgc3Vydml2ZSB0aGUgZHVyYWJsZSBKU09OIHJvdW5kIHRyaXAgYW5kIGFyZSByZXN0b3JlZCBvbiByZWFkYmFjay5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB1cGRhdGVkQXQgLSBJU08gdGltZXN0YW1wIHdoZW4gdGhlIHJlY29yZCB3YXMgbGFzdCBjaGFuZ2VkLlxuICovXG4vLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSwgc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBmcm9tIFwiLi4vZnJvbnRlbmQtbW9kZWxzL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcbmltcG9ydCBzdGFibGVKc29uU3RyaW5naWZ5IGZyb20gXCIuL3N0YWJsZS1qc29uLmpzXCJcblxuY29uc3QgREVGQVVMVF9TVE9SQUdFX0tFWSA9IFwidmVsb2Npb3VzLnN5bmMubG9jYWxNdXRhdGlvbkxvZ1wiXG5jb25zdCBQRU5ESU5HX1NUQVRVU19WQUxVRVMgPSAvKiogQHR5cGUge0xvY2FsTXV0YXRpb25TdGF0dXNbXX0gKi8gKFtcInBlbmRpbmdcIiwgXCJhcHBsaWVkLWxvY2FsbHlcIiwgXCJwZWVyLWFwcGxpZWRcIl0pXG5jb25zdCBQRU5ESU5HX1NUQVRVU0VTID0gbmV3IFNldChQRU5ESU5HX1NUQVRVU19WQUxVRVMpXG5jb25zdCBNVVRBVElPTl9TVEFUVVNFUyA9IG5ldyBTZXQoWy4uLlBFTkRJTkdfU1RBVFVTRVMsIFwiY29uZmxpY3RcIiwgXCJyZWplY3RlZFwiLCBcInN5bmNlZFwiXSlcbmNvbnN0IFRFUk1JTkFMX1NUQVRVU0VTID0gbmV3IFNldChbXCJyZWplY3RlZFwiLCBcInN5bmNlZFwiXSlcbi8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx1bmtub3duPj59ICovXG5jb25zdCBTVE9SQUdFX0tFWV9MT0NLUyA9IG5ldyBNYXAoKVxuXG4vKiogQ2xpZW50LXNpZGUgYXBwZW5kLW9ubHkgc3luYyBtdXRhdGlvbiBsb2cgd2l0aCBwbHVnZ2FibGUgcGVyc2lzdGVudCBzdG9yYWdlLiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTG9jYWxNdXRhdGlvbkxvZyB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbG9jYWwgbXV0YXRpb24gbG9nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHsoKSA9PiBzdHJpbmd9IFthcmdzLmlkR2VuZXJhdG9yXSAtIFJlY29yZCBpZCBnZW5lcmF0b3IuXG4gICAqIEBwYXJhbSB7KCkgPT4gRGF0ZX0gW2FyZ3Mubm93XSAtIENsb2NrIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge0xvY2FsTXV0YXRpb25Mb2dTdG9yYWdlfSBhcmdzLnN0b3JhZ2UgLSBQZXJzaXN0ZW50IHN0b3JhZ2UgYWRhcHRlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnN0b3JhZ2VLZXldIC0gU3RvcmFnZSBrZXkuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7aWRHZW5lcmF0b3IgPSByYW5kb21SZWNvcmRJZCwgbm93ID0gKCkgPT4gbmV3IERhdGUoKSwgc3RvcmFnZSwgc3RvcmFnZUtleSA9IERFRkFVTFRfU1RPUkFHRV9LRVl9KSB7XG4gICAgaWYgKCF2YWxpZFN0b3JhZ2Uoc3RvcmFnZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkxvY2FsTXV0YXRpb25Mb2cgcmVxdWlyZXMgcm93IHN0b3JhZ2Ugd2l0aCBhcHBlbmRSZWNvcmQvZGVsZXRlUmVjb3Jkcy9uZXh0U2VxdWVuY2UvcmVjb3JkL3JlY29yZHMvdXBkYXRlUmVjb3JkXCIpXG4gICAgfVxuXG4gICAgdGhpcy5pZEdlbmVyYXRvciA9IGlkR2VuZXJhdG9yXG4gICAgdGhpcy5ub3cgPSBub3dcbiAgICB0aGlzLnN0b3JhZ2UgPSBzdG9yYWdlXG4gICAgdGhpcy5zdG9yYWdlS2V5ID0gc3RvcmFnZUtleVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBsb2cgdmlldyB3aXRoIHNlcXVlbmNlLCByZWNvcmRzLCBhbmQgbG9ja3MgcGFydGl0aW9uZWQgYnkgYW5cbiAgICogaW1tdXRhYmxlIHBoeXNpY2FsIHRlbmFudCBpZGVudGl0eSB3aGlsZSByZXVzaW5nIHRoZSBzYW1lIHJvdyBzdG9yZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHBhcnRpdGlvbktleSAtIFN0YWJsZSBvcGFxdWUgcGFydGl0aW9uIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7TG9jYWxNdXRhdGlvbkxvZ30gUGFydGl0aW9uZWQgbG9nLlxuICAgKi9cbiAgcGFydGl0aW9uKHBhcnRpdGlvbktleSkge1xuICAgIGlmICghcGFydGl0aW9uS2V5KSB0aHJvdyBuZXcgRXJyb3IoXCJMb2NhbE11dGF0aW9uTG9nIHBhcnRpdGlvbiBrZXkgbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmdcIilcblxuICAgIHJldHVybiBuZXcgTG9jYWxNdXRhdGlvbkxvZyh7XG4gICAgICBpZEdlbmVyYXRvcjogdGhpcy5pZEdlbmVyYXRvcixcbiAgICAgIG5vdzogdGhpcy5ub3csXG4gICAgICBzdG9yYWdlOiB0aGlzLnN0b3JhZ2UsXG4gICAgICBzdG9yYWdlS2V5OiBgJHt0aGlzLnN0b3JhZ2VLZXl9OiR7cGFydGl0aW9uS2V5Lmxlbmd0aH06JHtwYXJ0aXRpb25LZXl9YFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwZW5kcyBhIHBlbmRpbmcgbXV0YXRpb24gcmVjb3JkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtMb2NhbE11dGF0aW9uRGVwZW5kZW5jeVtdfSBbYXJncy5kZXBlbmRlbmNpZXNdIC0gTXV0YXRpb24gZGVwZW5kZW5jaWVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE11dGF0aW9uIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU2lnbmVkU3luY011dGF0aW9ufSBbYXJncy5zaWduZWRNdXRhdGlvbl0gLSBPcmlnaW5hbCBzaWduZWQgbXV0YXRpb24gZW52ZWxvcGUsIHJldGFpbmVkIGZvciBwZWVyLWZvcndhcmRlZCBtdXRhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPExvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+fSAtIENyZWF0ZWQgbG9nIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIGFwcGVuZCh7ZGVwZW5kZW5jaWVzID0gW10sIG11dGF0aW9uLCBzaWduZWRNdXRhdGlvbn0pIHtcbiAgICBpZiAoc2lnbmVkTXV0YXRpb24gIT09IHVuZGVmaW5lZCAmJiBzdGFibGVKc29uU3RyaW5naWZ5KHNpZ25lZE11dGF0aW9uLm11dGF0aW9uKSAhPT0gc3RhYmxlSnNvblN0cmluZ2lmeShtdXRhdGlvbikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlNpZ25lZCBtdXRhdGlvbiBwYXlsb2FkIGRvZXMgbm90IG1hdGNoIHRoZSBtdXRhdGlvblwiKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB3aXRoU3RvcmFnZUtleUxvY2sodGhpcy5zdG9yYWdlS2V5LCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB0aW1lc3RhbXAgPSB0aGlzLmN1cnJlbnRUaW1lc3RhbXAoKVxuICAgICAgY29uc3QgcmVjb3JkID0gbm9ybWFsaXplUmVjb3JkKHtcbiAgICAgICAgY3JlYXRlZEF0OiB0aW1lc3RhbXAsXG4gICAgICAgIGRlcGVuZGVuY2llcyxcbiAgICAgICAgaWQ6IHRoaXMuaWRHZW5lcmF0b3IoKSxcbiAgICAgICAgbXV0YXRpb24sXG4gICAgICAgIHNlcXVlbmNlOiBhd2FpdCB0aGlzLnN0b3JhZ2UubmV4dFNlcXVlbmNlKHRoaXMuc3RvcmFnZUtleSksXG4gICAgICAgIHNpZ25lZE11dGF0aW9uLFxuICAgICAgICBzdGF0dXM6IFwicGVuZGluZ1wiLFxuICAgICAgICB1cGRhdGVkQXQ6IHRpbWVzdGFtcFxuICAgICAgfSlcblxuICAgICAgYXdhaXQgdGhpcy5zdG9yYWdlLmFwcGVuZFJlY29yZCh0aGlzLnN0b3JhZ2VLZXksIGNsb25lUmVjb3JkKHJlY29yZCkpXG5cbiAgICAgIHJldHVybiBjbG9uZVJlY29yZChyZWNvcmQpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGFsbCByZWNvcmRzIG9yZGVyZWQgYnkgbG9jYWwgc2VxdWVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPExvY2FsTXV0YXRpb25Mb2dSZWNvcmRbXT59IC0gTG9nIHJlY29yZHMuXG4gICAqL1xuICBhc3luYyByZWNvcmRzKCkge1xuICAgIHJldHVybiBub3JtYWxpemVSZWNvcmRMaXN0KGF3YWl0IHRoaXMuc3RvcmFnZS5yZWNvcmRzKHRoaXMuc3RvcmFnZUtleSkpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyByZWNvcmRzIHRoYXQgc3RpbGwgbmVlZCBsb2NhbC9zZXJ2ZXIgcmVjb25jaWxpYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPExvY2FsTXV0YXRpb25Mb2dSZWNvcmRbXT59IC0gUGVuZGluZyByZWNvcmRzLlxuICAgKi9cbiAgYXN5bmMgcGVuZGluZ1JlY29yZHMoKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVJlY29yZExpc3QoYXdhaXQgdGhpcy5zdG9yYWdlLnJlY29yZHModGhpcy5zdG9yYWdlS2V5LCB7c3RhdHVzZXM6IFBFTkRJTkdfU1RBVFVTX1ZBTFVFU30pKVxuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZXMgYSByZWNvcmQgc3RhdHVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaWQgLSBSZWNvcmQgaWQuXG4gICAqIEBwYXJhbSB7TG9jYWxNdXRhdGlvblN0YXR1c30gYXJncy5zdGF0dXMgLSBOZXcgc3RhdHVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IFthcmdzLnN5bmNSZXN1bHRdIC0gUmVzdWx0IG1ldGFkYXRhIChtYXkgY2FycnkgdHJhbnNwb3J0LXJlc3RvcmVkIHR5cGVkIHZhbHVlcykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPExvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+fSAtIFVwZGF0ZWQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgdXBkYXRlU3RhdHVzKHtpZCwgc3RhdHVzLCBzeW5jUmVzdWx0fSkge1xuICAgIGlmICghTVVUQVRJT05fU1RBVFVTRVMuaGFzKHN0YXR1cykpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBsb2NhbCBtdXRhdGlvbiBzdGF0dXMgJyR7c3RhdHVzfSdgKVxuXG4gICAgcmV0dXJuIGF3YWl0IHdpdGhTdG9yYWdlS2V5TG9jayh0aGlzLnN0b3JhZ2VLZXksIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJhd1JlY29yZCA9IGF3YWl0IHRoaXMuc3RvcmFnZS5yZWNvcmQodGhpcy5zdG9yYWdlS2V5LCBpZClcblxuICAgICAgaWYgKCFyYXdSZWNvcmQpIHRocm93IG5ldyBFcnJvcihgTm8gbG9jYWwgbXV0YXRpb24gbG9nIHJlY29yZCAnJHtpZH0nYClcblxuICAgICAgY29uc3QgcmVjb3JkID0gbm9ybWFsaXplUmVjb3JkKHJhd1JlY29yZClcblxuICAgICAgcmVjb3JkLnN0YXR1cyA9IC8qKiBAdHlwZSB7TG9jYWxNdXRhdGlvblN0YXR1c30gKi8gKHN0YXR1cylcbiAgICAgIGlmIChzeW5jUmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgLy8gRW5jb2RlIHRyYW5zcG9ydC1yZXN0b3JlZCB0eXBlZCB2YWx1ZXMgKGUuZy4gRGF0ZSBhdHRyaWJ1dGVzIGluIGFcbiAgICAgICAgLy8gY29uZmxpY3Qgc2VydmVyTW9kZWwpIGFzIG1hcmtlcnMgYmVmb3JlIHRoZSBKU09OIGNsb25lIHNvIHRoZVxuICAgICAgICAvLyBkdXJhYmxlIHBlcnNpc3RlbmNlIHJvdW5kIHRyaXAgY2Fubm90IHN0cmluZ2lmeSB0aGVtLlxuICAgICAgICByZWNvcmQuc3luY1Jlc3VsdCA9IGNsb25lSnNvbk9iamVjdChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoc3luY1Jlc3VsdCksIFwic3luY1Jlc3VsdFwiKVxuICAgICAgfVxuICAgICAgcmVjb3JkLnVwZGF0ZWRBdCA9IHRoaXMuY3VycmVudFRpbWVzdGFtcCgpXG4gICAgICBhd2FpdCB0aGlzLnN0b3JhZ2UudXBkYXRlUmVjb3JkKHRoaXMuc3RvcmFnZUtleSwgY2xvbmVSZWNvcmQocmVjb3JkKSlcblxuICAgICAgcmV0dXJuIHJlc3RvcmVTeW5jUmVzdWx0VHlwZXMoY2xvbmVSZWNvcmQocmVjb3JkKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxhY2VzIHRoZSBtdXRhdGlvbiBwYXlsb2FkIG9mIGEgc3RpbGwtcGVuZGluZyByZWNvcmQuIFVzZWQgd2hlbiBhblxuICAgKiBhY2tub3dsZWRnZWQgcHJlZGVjZXNzb3Igc3VwcGxpZXMgdGhlIGF1dGhvcml0YXRpdmUgYmFzZSBmb3IgaXRzIHN1Y2Nlc3Nvci5cbiAgICogQHBhcmFtIHt7aWQ6IHN0cmluZywgbXV0YXRpb246IGltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn19IGFyZ3MgLSBSZWNvcmQgYW5kIHJlcGxhY2VtZW50IG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxMb2NhbE11dGF0aW9uTG9nUmVjb3JkPn0gVXBkYXRlZCByZWNvcmQuXG4gICAqL1xuICBhc3luYyB1cGRhdGVNdXRhdGlvbih7aWQsIG11dGF0aW9ufSkge1xuICAgIHJldHVybiBhd2FpdCB3aXRoU3RvcmFnZUtleUxvY2sodGhpcy5zdG9yYWdlS2V5LCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByYXdSZWNvcmQgPSBhd2FpdCB0aGlzLnN0b3JhZ2UucmVjb3JkKHRoaXMuc3RvcmFnZUtleSwgaWQpXG5cbiAgICAgIGlmICghcmF3UmVjb3JkKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGxvY2FsIG11dGF0aW9uIGxvZyByZWNvcmQgJyR7aWR9J2ApXG5cbiAgICAgIGNvbnN0IHJlY29yZCA9IG5vcm1hbGl6ZVJlY29yZChyYXdSZWNvcmQpXG5cbiAgICAgIGlmICghUEVORElOR19TVEFUVVNFUy5oYXMocmVjb3JkLnN0YXR1cykpIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHVwZGF0ZSBtdXRhdGlvbiBmb3IgJHtyZWNvcmQuc3RhdHVzfSBsb2NhbCBtdXRhdGlvbiAnJHtpZH0nYClcblxuICAgICAgcmVjb3JkLm11dGF0aW9uID0gbm9ybWFsaXplTXV0YXRpb24obXV0YXRpb24pXG4gICAgICByZWNvcmQudXBkYXRlZEF0ID0gdGhpcy5jdXJyZW50VGltZXN0YW1wKClcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmFnZS51cGRhdGVSZWNvcmQodGhpcy5zdG9yYWdlS2V5LCBjbG9uZVJlY29yZChyZWNvcmQpKVxuXG4gICAgICByZXR1cm4gcmVzdG9yZVN5bmNSZXN1bHRUeXBlcyhjbG9uZVJlY29yZChyZWNvcmQpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUHJ1bmVzIHRlcm1pbmFsIHJlY29yZHMgdGhhdCBhcmUgbm8gbG9uZ2VyIG5lZWRlZCBmb3IgcmVwbGF5IGRlcGVuZGVuY2llcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIENvbXBhY3Rpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm1heFRlcm1pbmFsUmVjb3Jkc10gLSBNYXhpbXVtIHRlcm1pbmFsIHJlY29yZHMgdG8gcmV0YWluLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MudGVybWluYWxSZXRlbnRpb25Nc10gLSBNaW5pbXVtIGFnZSBiZWZvcmUgcHJ1bmluZyB0ZXJtaW5hbCByZWNvcmRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7ZGVsZXRlZFJlY29yZElkczogc3RyaW5nW119Pn0gLSBDb21wYWN0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNvbXBhY3Qoe21heFRlcm1pbmFsUmVjb3JkcywgdGVybWluYWxSZXRlbnRpb25Nc30gPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB3aXRoU3RvcmFnZUtleUxvY2sodGhpcy5zdG9yYWdlS2V5LCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmRzID0gYXdhaXQgdGhpcy5yZWNvcmRzKClcbiAgICAgIGNvbnN0IHByb3RlY3RlZENsaWVudE11dGF0aW9uSWRzID0gbmV3IFNldChcbiAgICAgICAgcmVjb3Jkc1xuICAgICAgICAgIC5maWx0ZXIoKHJlY29yZCkgPT4gUEVORElOR19TVEFUVVNFUy5oYXMocmVjb3JkLnN0YXR1cykgfHwgcmVjb3JkLnN0YXR1cyA9PT0gXCJjb25mbGljdFwiKVxuICAgICAgICAgIC5mbGF0TWFwKChyZWNvcmQpID0+IHJlY29yZC5kZXBlbmRlbmNpZXMubWFwKChkZXBlbmRlbmN5KSA9PiBkZXBlbmRlbmN5LmNsaWVudE11dGF0aW9uSWQpKVxuICAgICAgKVxuICAgICAgY29uc3QgdGVybWluYWxSZWNvcmRzID0gcmVjb3Jkc1xuICAgICAgICAuZmlsdGVyKChyZWNvcmQpID0+IFRFUk1JTkFMX1NUQVRVU0VTLmhhcyhyZWNvcmQuc3RhdHVzKSlcbiAgICAgICAgLmZpbHRlcigocmVjb3JkKSA9PiAhcHJvdGVjdGVkQ2xpZW50TXV0YXRpb25JZHMuaGFzKHJlY29yZC5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkKSlcbiAgICAgICAgLnNvcnQoY29tcGFyZVJlY29yZHNOZXdlc3RGaXJzdClcbiAgICAgIGNvbnN0IGRlbGV0ZUlkcyA9IG5ldyBTZXQoKVxuXG4gICAgICBpZiAodHlwZW9mIG1heFRlcm1pbmFsUmVjb3JkcyA9PT0gXCJudW1iZXJcIiAmJiBtYXhUZXJtaW5hbFJlY29yZHMgPj0gMCkge1xuICAgICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiB0ZXJtaW5hbFJlY29yZHMuc2xpY2UobWF4VGVybWluYWxSZWNvcmRzKSkgZGVsZXRlSWRzLmFkZChyZWNvcmQuaWQpXG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgdGVybWluYWxSZXRlbnRpb25NcyA9PT0gXCJudW1iZXJcIiAmJiB0ZXJtaW5hbFJldGVudGlvbk1zID49IDApIHtcbiAgICAgICAgY29uc3QgY3V0b2ZmID0gdGhpcy5ub3coKS5nZXRUaW1lKCkgLSB0ZXJtaW5hbFJldGVudGlvbk1zXG5cbiAgICAgICAgZm9yIChjb25zdCByZWNvcmQgb2YgdGVybWluYWxSZWNvcmRzKSB7XG4gICAgICAgICAgaWYgKG5ldyBEYXRlKHJlY29yZC51cGRhdGVkQXQpLmdldFRpbWUoKSA8IGN1dG9mZikgZGVsZXRlSWRzLmFkZChyZWNvcmQuaWQpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgZGVsZXRlZFJlY29yZElkcyA9IEFycmF5LmZyb20oZGVsZXRlSWRzKVxuXG4gICAgICBpZiAoZGVsZXRlZFJlY29yZElkcy5sZW5ndGggPiAwKSBhd2FpdCB0aGlzLnN0b3JhZ2UuZGVsZXRlUmVjb3Jkcyh0aGlzLnN0b3JhZ2VLZXksIGRlbGV0ZWRSZWNvcmRJZHMpXG5cbiAgICAgIHJldHVybiB7ZGVsZXRlZFJlY29yZElkc31cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGN1cnJlbnQgbG9nIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBDdXJyZW50IElTTyB0aW1lc3RhbXAuXG4gICAqL1xuICBjdXJyZW50VGltZXN0YW1wKCkge1xuICAgIGNvbnN0IGRhdGUgPSB0aGlzLm5vdygpXG5cbiAgICBpZiAoIShkYXRlIGluc3RhbmNlb2YgRGF0ZSkgfHwgTnVtYmVyLmlzTmFOKGRhdGUuZ2V0VGltZSgpKSkgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWxNdXRhdGlvbkxvZyBub3coKSBtdXN0IHJldHVybiBhIHZhbGlkIERhdGVcIilcblxuICAgIHJldHVybiBkYXRlLnRvSVNPU3RyaW5nKClcbiAgfVxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGEgc3RvcmFnZSBhZGFwdGVyIGhhcyBhbGwgcmVxdWlyZWQgcm93LXN0b3JlIG1ldGhvZHMuXG4gKiBAcGFyYW0ge3Vua25vd259IHN0b3JhZ2UgLSBTdG9yYWdlIGFkYXB0ZXIgY2FuZGlkYXRlLlxuICogQHJldHVybnMge3N0b3JhZ2UgaXMgTG9jYWxNdXRhdGlvbkxvZ1N0b3JhZ2V9IC0gV2hldGhlciBzdG9yYWdlIGlzIHZhbGlkLlxuICovXG5mdW5jdGlvbiB2YWxpZFN0b3JhZ2Uoc3RvcmFnZSkge1xuICBpZiAoIXN0b3JhZ2UgfHwgdHlwZW9mIHN0b3JhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IHN0b3JhZ2VPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoc3RvcmFnZSlcblxuICByZXR1cm4gdHlwZW9mIHN0b3JhZ2VPYmplY3QuYXBwZW5kUmVjb3JkID09PSBcImZ1bmN0aW9uXCJcbiAgICAmJiB0eXBlb2Ygc3RvcmFnZU9iamVjdC5kZWxldGVSZWNvcmRzID09PSBcImZ1bmN0aW9uXCJcbiAgICAmJiB0eXBlb2Ygc3RvcmFnZU9iamVjdC5uZXh0U2VxdWVuY2UgPT09IFwiZnVuY3Rpb25cIlxuICAgICYmIHR5cGVvZiBzdG9yYWdlT2JqZWN0LnJlY29yZCA9PT0gXCJmdW5jdGlvblwiXG4gICAgJiYgdHlwZW9mIHN0b3JhZ2VPYmplY3QucmVjb3JkcyA9PT0gXCJmdW5jdGlvblwiXG4gICAgJiYgdHlwZW9mIHN0b3JhZ2VPYmplY3QudXBkYXRlUmVjb3JkID09PSBcImZ1bmN0aW9uXCJcbn1cblxuLyoqXG4gKiBTb3J0cyByZWNvcmRzIGJ5IG5ld2VzdCB1cGRhdGUvc2VxdWVuY2UgZmlyc3QuXG4gKiBAcGFyYW0ge0xvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IGxlZnQgLSBMZWZ0IHJlY29yZC5cbiAqIEBwYXJhbSB7TG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gcmlnaHQgLSBSaWdodCByZWNvcmQuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIFNvcnQgcmVzdWx0LlxuICovXG5mdW5jdGlvbiBjb21wYXJlUmVjb3Jkc05ld2VzdEZpcnN0KGxlZnQsIHJpZ2h0KSB7XG4gIGNvbnN0IHVwZGF0ZWRBdENvbXBhcmlzb24gPSByaWdodC51cGRhdGVkQXQubG9jYWxlQ29tcGFyZShsZWZ0LnVwZGF0ZWRBdClcblxuICBpZiAodXBkYXRlZEF0Q29tcGFyaXNvbiAhPT0gMCkgcmV0dXJuIHVwZGF0ZWRBdENvbXBhcmlzb25cblxuICByZXR1cm4gcmlnaHQuc2VxdWVuY2UgLSBsZWZ0LnNlcXVlbmNlXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhbmQgc29ydHMgYSBsaXN0IG9mIHJlY29yZHMuXG4gKiBAcGFyYW0ge3Vua25vd259IHJlY29yZHMgLSBSYXcgcmVjb3Jkcy5cbiAqIEByZXR1cm5zIHtMb2NhbE11dGF0aW9uTG9nUmVjb3JkW119IC0gTm9ybWFsaXplZCByZWNvcmRzLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVSZWNvcmRMaXN0KHJlY29yZHMpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHJlY29yZHMpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBsb2NhbCBtdXRhdGlvbiBsb2cgc3RvcmFnZSByZWNvcmRzIGFycmF5XCIpXG5cbiAgcmV0dXJuIHJlY29yZHNcbiAgICAubWFwKG5vcm1hbGl6ZVJlY29yZClcbiAgICAuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuc2VxdWVuY2UgLSByaWdodC5zZXF1ZW5jZSlcbiAgICAubWFwKChyZWNvcmQpID0+IGNsb25lUmVjb3JkKHJlY29yZCkpXG4gICAgLm1hcChyZXN0b3JlU3luY1Jlc3VsdFR5cGVzKVxufVxuXG4vKipcbiAqIFJlc3RvcmVzIHRyYW5zcG9ydC1yZXN0b3JlZCB0eXBlZCB2YWx1ZXMgaW4gYSByZWNvcmQncyBzeW5jUmVzdWx0IGFmdGVyIHRoZVxuICogZmluYWwgSlNPTiBjbG9uZSwgc28gY2FsbGVycyBzZWUgRGF0ZSAoYW5kIG90aGVyIHR5cGVkKSB2YWx1ZXMgb24gZHVyYWJsZVxuICogcmVhZGJhY2sgaW5zdGVhZCBvZiBtYXJrZXItZW5jb2RlZCBJU08gc3RyaW5ncy5cbiAqIEBwYXJhbSB7TG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gcmVjb3JkIC0gQ2xvbmVkIHJlY29yZC5cbiAqIEByZXR1cm5zIHtMb2NhbE11dGF0aW9uTG9nUmVjb3JkfSAtIFJlY29yZCB3aXRoIHJlc3RvcmVkIHN5bmNSZXN1bHQgdHlwZXMuXG4gKi9cbmZ1bmN0aW9uIHJlc3RvcmVTeW5jUmVzdWx0VHlwZXMocmVjb3JkKSB7XG4gIGlmIChyZWNvcmQuc3luY1Jlc3VsdCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gcmVjb3JkXG5cbiAgcmV0dXJuIHtcbiAgICAuLi5yZWNvcmQsXG4gICAgc3luY1Jlc3VsdDogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoXG4gICAgICBkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShyZWNvcmQuc3luY1Jlc3VsdClcbiAgICApXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGEgY2FsbGJhY2sgYWZ0ZXIgZWFybGllciB3cml0ZXMgZm9yIHRoZSBzYW1lIHN0b3JhZ2Uga2V5IGhhdmUgY29tcGxldGVkLlxuICogQHRlbXBsYXRlIFRcbiAqIEBwYXJhbSB7c3RyaW5nfSBzdG9yYWdlS2V5IC0gU3RvcmFnZSBrZXkgdG8gc2VyaWFsaXplLlxuICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1biB1bmRlciB0aGUgc3RvcmFnZS1rZXkgbG9jay5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gd2l0aFN0b3JhZ2VLZXlMb2NrKHN0b3JhZ2VLZXksIGNhbGxiYWNrKSB7XG4gIGNvbnN0IHByZXZpb3VzID0gU1RPUkFHRV9LRVlfTE9DS1MuZ2V0KHN0b3JhZ2VLZXkpIHx8IFByb21pc2UucmVzb2x2ZSgpXG4gIGxldCByZWxlYXNlID0gKCkgPT4ge31cbiAgY29uc3QgY3VycmVudCA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7IHJlbGVhc2UgPSAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZCkgfSlcbiAgY29uc3QgY2hhaW5lZCA9IHByZXZpb3VzLmNhdGNoKChfZXJyb3IpID0+IHt9KS50aGVuKCgpID0+IGN1cnJlbnQpXG5cbiAgU1RPUkFHRV9LRVlfTE9DS1Muc2V0KHN0b3JhZ2VLZXksIGNoYWluZWQpXG5cbiAgdHJ5IHtcbiAgICBhd2FpdCBwcmV2aW91cy5jYXRjaCgoX2Vycm9yKSA9PiB7fSlcblxuICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gIH0gZmluYWxseSB7XG4gICAgcmVsZWFzZSgpXG4gICAgaWYgKFNUT1JBR0VfS0VZX0xPQ0tTLmdldChzdG9yYWdlS2V5KSA9PT0gY2hhaW5lZCkgU1RPUkFHRV9LRVlfTE9DS1MuZGVsZXRlKHN0b3JhZ2VLZXkpXG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgcGVyc2lzdGVkIGxvZyByZWNvcmQuXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gUmF3IHJlY29yZC5cbiAqIEByZXR1cm5zIHtMb2NhbE11dGF0aW9uTG9nUmVjb3JkfSAtIE5vcm1hbGl6ZWQgcmVjb3JkLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVSZWNvcmQodmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIGxvY2FsIG11dGF0aW9uIGxvZyByZWNvcmQgb2JqZWN0XCIpXG5cbiAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKHZhbHVlKVxuICBjb25zdCBzdGF0dXMgPSByZXF1aXJlZFN0cmluZyhyZWNvcmQuc3RhdHVzLCBcInN0YXR1c1wiKVxuXG4gIGlmICghTVVUQVRJT05fU1RBVFVTRVMuaGFzKHN0YXR1cykpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBsb2NhbCBtdXRhdGlvbiBzdGF0dXMgJyR7c3RhdHVzfSdgKVxuXG4gIGNvbnN0IGJhc2VSZWNvcmQgPSB7XG4gICAgY3JlYXRlZEF0OiByZXF1aXJlZElzb1RpbWVzdGFtcChyZWNvcmQuY3JlYXRlZEF0LCBcImNyZWF0ZWRBdFwiKSxcbiAgICBkZXBlbmRlbmNpZXM6IG5vcm1hbGl6ZURlcGVuZGVuY2llcyhyZWNvcmQuZGVwZW5kZW5jaWVzKSxcbiAgICBpZDogcmVxdWlyZWRTdHJpbmcocmVjb3JkLmlkLCBcImlkXCIpLFxuICAgIG11dGF0aW9uOiBub3JtYWxpemVNdXRhdGlvbihyZWNvcmQubXV0YXRpb24pLFxuICAgIHNlcXVlbmNlOiByZXF1aXJlZFBvc2l0aXZlSW50ZWdlcihyZWNvcmQuc2VxdWVuY2UsIFwic2VxdWVuY2VcIiksXG4gICAgc3RhdHVzOiAvKiogQHR5cGUge0xvY2FsTXV0YXRpb25TdGF0dXN9ICovIChzdGF0dXMpLFxuICAgIHVwZGF0ZWRBdDogcmVxdWlyZWRJc29UaW1lc3RhbXAocmVjb3JkLnVwZGF0ZWRBdCwgXCJ1cGRhdGVkQXRcIilcbiAgfVxuXG4gIGlmIChyZWNvcmQuc2lnbmVkTXV0YXRpb24gPT09IHVuZGVmaW5lZCAmJiByZWNvcmQuc3luY1Jlc3VsdCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gYmFzZVJlY29yZFxuXG4gIC8qKiBAdHlwZSB7TG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gKi9cbiAgY29uc3Qgbm9ybWFsaXplZFJlY29yZCA9IHsuLi5iYXNlUmVjb3JkfVxuXG4gIGlmIChyZWNvcmQuc2lnbmVkTXV0YXRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgIG5vcm1hbGl6ZWRSZWNvcmQuc2lnbmVkTXV0YXRpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlNpZ25lZFN5bmNNdXRhdGlvbn0gKi8gKGNsb25lSnNvbk9iamVjdChyZWNvcmQuc2lnbmVkTXV0YXRpb24sIFwic2lnbmVkTXV0YXRpb25cIikpXG4gIH1cbiAgaWYgKHJlY29yZC5zeW5jUmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAvLyBQZXJzaXN0ZWQgc3luY1Jlc3VsdCBpcyBtYXJrZXItZW5jb2RlZCBzbyBpdCBzdXJ2aXZlcyB0aGUgSlNPTiBjbG9uZTtcbiAgICAvLyB0eXBlZCB2YWx1ZXMgYXJlIHJlc3RvcmVkIGJ5IHJlc3RvcmVTeW5jUmVzdWx0VHlwZXMgYXQgdGhlIHJlYWQgYm91bmRhcnkuXG4gICAgbm9ybWFsaXplZFJlY29yZC5zeW5jUmVzdWx0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoXG4gICAgICBjbG9uZUpzb25PYmplY3QocmVjb3JkLnN5bmNSZXN1bHQsIFwic3luY1Jlc3VsdFwiKVxuICAgIClcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkUmVjb3JkXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBkZXBlbmRlbmN5IG1ldGFkYXRhIGVudHJpZXMuXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gUmF3IGRlcGVuZGVuY2llcy5cbiAqIEByZXR1cm5zIHtMb2NhbE11dGF0aW9uRGVwZW5kZW5jeVtdfSAtIE5vcm1hbGl6ZWQgZGVwZW5kZW5jaWVzLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVEZXBlbmRlbmNpZXModmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiBbXVxuICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBsb2NhbCBtdXRhdGlvbiBkZXBlbmRlbmNpZXMgYXJyYXlcIilcblxuICByZXR1cm4gdmFsdWUubWFwKChkZXBlbmRlbmN5KSA9PiB7XG4gICAgaWYgKCFkZXBlbmRlbmN5IHx8IHR5cGVvZiBkZXBlbmRlbmN5ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZGVwZW5kZW5jeSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIGxvY2FsIG11dGF0aW9uIGRlcGVuZGVuY3kgb2JqZWN0XCIpXG4gICAgfVxuXG4gICAgY29uc3QgZGVwZW5kZW5jeU9iamVjdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChkZXBlbmRlbmN5KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNsaWVudE11dGF0aW9uSWQ6IHJlcXVpcmVkU3RyaW5nKGRlcGVuZGVuY3lPYmplY3QuY2xpZW50TXV0YXRpb25JZCwgXCJkZXBlbmRlbmN5IGNsaWVudE11dGF0aW9uSWRcIiksXG4gICAgICBtb2RlbDogcmVxdWlyZWRTdHJpbmcoZGVwZW5kZW5jeU9iamVjdC5tb2RlbCwgXCJkZXBlbmRlbmN5IG1vZGVsXCIpXG4gICAgfVxuICB9KVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYSBzeW5jIG11dGF0aW9uIHBheWxvYWQuXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gUmF3IG11dGF0aW9uLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gLSBOb3JtYWxpemVkIG11dGF0aW9uLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVNdXRhdGlvbih2YWx1ZSkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgbG9jYWwgc3luYyBtdXRhdGlvbiBvYmplY3RcIilcblxuICBjb25zdCBtdXRhdGlvbiA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICh2YWx1ZSlcbiAgY29uc3Qgbm9ybWFsaXplZCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSAqLyAoe1xuICAgIGFjdG9yRGV2aWNlSWQ6IHJlcXVpcmVkU3RyaW5nKG11dGF0aW9uLmFjdG9yRGV2aWNlSWQsIFwiYWN0b3JEZXZpY2VJZFwiKSxcbiAgICBhY3RvclVzZXJJZDogcmVxdWlyZWRTdHJpbmcobXV0YXRpb24uYWN0b3JVc2VySWQsIFwiYWN0b3JVc2VySWRcIiksXG4gICAgY2xpZW50TXV0YXRpb25JZDogcmVxdWlyZWRTdHJpbmcobXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCwgXCJjbGllbnRNdXRhdGlvbklkXCIpLFxuICAgIG1vZGVsOiByZXF1aXJlZFN0cmluZyhtdXRhdGlvbi5tb2RlbCwgXCJtb2RlbFwiKSxcbiAgICBvY2N1cnJlZEF0OiByZXF1aXJlZElzb1RpbWVzdGFtcChtdXRhdGlvbi5vY2N1cnJlZEF0LCBcIm9jY3VycmVkQXRcIiksXG4gICAgb2ZmbGluZUdyYW50SWQ6IHJlcXVpcmVkU3RyaW5nKG11dGF0aW9uLm9mZmxpbmVHcmFudElkLCBcIm9mZmxpbmVHcmFudElkXCIpLFxuICAgIG9wZXJhdGlvbjogcmVxdWlyZWRTdHJpbmcobXV0YXRpb24ub3BlcmF0aW9uLCBcIm9wZXJhdGlvblwiKSxcbiAgICBwb2xpY3lIYXNoOiByZXF1aXJlZFN0cmluZyhtdXRhdGlvbi5wb2xpY3lIYXNoLCBcInBvbGljeUhhc2hcIilcbiAgfSlcblxuICBpZiAobXV0YXRpb24uYXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkKSBub3JtYWxpemVkLmF0dHJpYnV0ZXMgPSBjbG9uZUpzb25PYmplY3QobXV0YXRpb24uYXR0cmlidXRlcywgXCJhdHRyaWJ1dGVzXCIpXG4gIGlmIChtdXRhdGlvbi5iYXNlVmVyc2lvbiAhPT0gdW5kZWZpbmVkKSBub3JtYWxpemVkLmJhc2VWZXJzaW9uID0gY2xvbmVCYXNlVmVyc2lvbihtdXRhdGlvbi5iYXNlVmVyc2lvbilcbiAgaWYgKG11dGF0aW9uLmNvbW1hbmQgIT09IHVuZGVmaW5lZCkgbm9ybWFsaXplZC5jb21tYW5kID0gcmVxdWlyZWRTdHJpbmcobXV0YXRpb24uY29tbWFuZCwgXCJjb21tYW5kXCIpXG4gIGlmIChtdXRhdGlvbi5wYXlsb2FkICE9PSB1bmRlZmluZWQpIG5vcm1hbGl6ZWQucGF5bG9hZCA9IGNsb25lSnNvbk9iamVjdChtdXRhdGlvbi5wYXlsb2FkLCBcInBheWxvYWRcIilcblxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG4vKipcbiAqIFJlcXVpcmVzIGEgbm9uLWVtcHR5IHN0cmluZyB2YWx1ZS5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBSYXcgdmFsdWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gbGFiZWwgLSBGaWVsZCBsYWJlbC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUmVxdWlyZWQgc3RyaW5nLlxuICovXG5mdW5jdGlvbiByZXF1aXJlZFN0cmluZyh2YWx1ZSwgbGFiZWwpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIiB8fCB2YWx1ZS5sZW5ndGggPCAxKSB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGxvY2FsIG11dGF0aW9uICR7bGFiZWx9YClcblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBSZXF1aXJlcyBhbiBJU08gdGltZXN0YW1wIHN0cmluZy5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBSYXcgdmFsdWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gbGFiZWwgLSBGaWVsZCBsYWJlbC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gSVNPIHRpbWVzdGFtcC5cbiAqL1xuZnVuY3Rpb24gcmVxdWlyZWRJc29UaW1lc3RhbXAodmFsdWUsIGxhYmVsKSB7XG4gIGNvbnN0IHN0cmluZ1ZhbHVlID0gcmVxdWlyZWRTdHJpbmcodmFsdWUsIGxhYmVsKVxuICBjb25zdCBkYXRlID0gbmV3IERhdGUoc3RyaW5nVmFsdWUpXG5cbiAgaWYgKE51bWJlci5pc05hTihkYXRlLmdldFRpbWUoKSkgfHwgZGF0ZS50b0lTT1N0cmluZygpICE9PSBzdHJpbmdWYWx1ZSkgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBsb2NhbCBtdXRhdGlvbiAke2xhYmVsfSBJU08gdGltZXN0YW1wYClcblxuICByZXR1cm4gc3RyaW5nVmFsdWVcbn1cblxuLyoqXG4gKiBSZXF1aXJlcyBhIHBvc2l0aXZlIGludGVnZXIgdmFsdWUuXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gUmF3IHZhbHVlLlxuICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gRmllbGQgbGFiZWwuXG4gKiBAcmV0dXJucyB7bnVtYmVyfSAtIFBvc2l0aXZlIGludGVnZXIuXG4gKi9cbmZ1bmN0aW9uIHJlcXVpcmVkUG9zaXRpdmVJbnRlZ2VyKHZhbHVlLCBsYWJlbCkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8IDEpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbG9jYWwgbXV0YXRpb24gJHtsYWJlbH0gcG9zaXRpdmUgaW50ZWdlcmApXG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogQ2xvbmVzIGEgc3VwcG9ydGVkIGJhc2UtdmVyc2lvbiB2YWx1ZS5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBSYXcgYmFzZSB2ZXJzaW9uLlxuICogQHJldHVybnMge3N0cmluZyB8IG51bWJlciB8IG51bGx9IC0gTm9ybWFsaXplZCBiYXNlIHZlcnNpb24uXG4gKi9cbmZ1bmN0aW9uIGNsb25lQmFzZVZlcnNpb24odmFsdWUpIHtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiB2YWx1ZVxuXG4gIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIGxvY2FsIG11dGF0aW9uIGJhc2VWZXJzaW9uIHN0cmluZywgbnVtYmVyLCBvciBudWxsXCIpXG59XG5cbi8qKlxuICogQ2xvbmVzIGEgSlNPTi1jb21wYXRpYmxlIHZhbHVlLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFJhdyBKU09OIHZhbHVlLlxuICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gRmllbGQgbGFiZWwuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZX0gLSBDbG9uZWQgSlNPTiB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gY2xvbmVKc29uVmFsdWUodmFsdWUsIGxhYmVsKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIEpTT04tY29tcGF0aWJsZSBsb2NhbCBtdXRhdGlvbiAke2xhYmVsfWApXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZX0gKi8gKEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkodmFsdWUpKSlcbn1cblxuLyoqXG4gKiBDbG9uZXMgYSBKU09OLWNvbXBhdGlibGUgb2JqZWN0LlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFJhdyBKU09OIG9iamVjdC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCAtIEZpZWxkIGxhYmVsLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAtIENsb25lZCBKU09OIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gY2xvbmVKc29uT2JqZWN0KHZhbHVlLCBsYWJlbCkge1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBsb2NhbCBtdXRhdGlvbiAke2xhYmVsfSBvYmplY3RgKVxuXG4gIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAqLyAoY2xvbmVKc29uVmFsdWUodmFsdWUsIGxhYmVsKSlcbn1cblxuLyoqXG4gKiBDbG9uZXMgYSBsb2NhbCBtdXRhdGlvbiBsb2cgcmVjb3JkLlxuICogQHBhcmFtIHtMb2NhbE11dGF0aW9uTG9nUmVjb3JkfSByZWNvcmQgLSBSZWNvcmQgdG8gY2xvbmUuXG4gKiBAcmV0dXJucyB7TG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gLSBDbG9uZWQgcmVjb3JkLlxuICovXG5mdW5jdGlvbiBjbG9uZVJlY29yZChyZWNvcmQpIHtcbiAgcmV0dXJuIC8qKiBAdHlwZSB7TG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gKi8gKEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkocmVjb3JkKSkpXG59XG5cbi8qKlxuICogR2VuZXJhdGVzIGEgcmFuZG9tIGxvY2FsIG11dGF0aW9uIHJlY29yZCBpZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUmFuZG9tIHJlY29yZCBpZC5cbiAqL1xuZnVuY3Rpb24gcmFuZG9tUmVjb3JkSWQoKSB7XG4gIGNvbnN0IGNyeXB0b1Byb3ZpZGVyID0gZ2xvYmFsVGhpcy5jcnlwdG9cblxuICBpZiAoY3J5cHRvUHJvdmlkZXIgJiYgdHlwZW9mIGNyeXB0b1Byb3ZpZGVyLnJhbmRvbVVVSUQgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIGNyeXB0b1Byb3ZpZGVyLnJhbmRvbVVVSUQoKVxuXG4gIHJldHVybiBgbG9jYWwtbXV0YXRpb24tJHtEYXRlLm5vdygpfS0ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMTYpLnNsaWNlKDIpfWBcbn1cbiJdfQ==