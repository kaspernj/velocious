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
     * Resolves a durable conflict explicitly. Keeping the server acknowledges the
     * preserved local intent without replaying it; retrying local intent rebases
     * it onto the conflict's authoritative serverVersion and returns it to the
     * pending queue. The prior conflict result stays attached as audit metadata.
     * @param {{id: string, resolution: "keep-server" | "retry-local"}} args - Resolution.
     * @returns {Promise<LocalMutationLogRecord>} Resolved record.
     */
    async resolveConflict({ id, resolution }) {
        if (!["keep-server", "retry-local"].includes(resolution))
            throw new Error(`Unknown local mutation conflict resolution '${resolution}'`);
        return await withStorageKeyLock(this.storageKey, async () => {
            const rawRecord = await this.storage.record(this.storageKey, id);
            if (!rawRecord)
                throw new Error(`No local mutation log record '${id}'`);
            const record = normalizeRecord(rawRecord);
            if (record.status !== "conflict")
                throw new Error(`Cannot resolve ${record.status} local mutation '${id}' as a conflict`);
            if (resolution === "keep-server") {
                record.status = "synced";
            }
            else {
                const serverVersion = conflictServerVersion(record);
                record.mutation = { ...record.mutation, baseVersion: serverVersion };
                record.status = "pending";
            }
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
 * Reads the authoritative version from a conflicted mutation.
 * @param {LocalMutationLogRecord} record - Conflicted record.
 * @returns {string | number | null} - Authoritative version.
 */
function conflictServerVersion(record) {
    const conflict = record.syncResult?.conflict;
    if (!conflict || conflict instanceof Date || typeof conflict !== "object" || Array.isArray(conflict) || !Object.hasOwn(conflict, "serverVersion")) {
        throw new Error(`Cannot retry local mutation '${record.id}' without a conflict serverVersion`);
    }
    const conflictMetadata = /** @type {Record<string, unknown>} */ (conflict);
    return cloneBaseVersion(conflictMetadata.serverVersion);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jYWwtbXV0YXRpb24tbG9nLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvbG9jYWwtbXV0YXRpb24tbG9nLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7O0dBSUc7QUFDSDs7Ozs7Ozs7Ozs7OztHQWFHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7O0tBR0s7QUFDTDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCxZQUFZO0FBRVosT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sK0NBQStDLENBQUE7QUFDMUksT0FBTyxtQkFBbUIsTUFBTSxrQkFBa0IsQ0FBQTtBQUVsRCxNQUFNLG1CQUFtQixHQUFHLGlDQUFpQyxDQUFBO0FBQzdELE1BQU0scUJBQXFCLEdBQUcsb0NBQW9DLENBQUMsQ0FBQyxDQUFDLFNBQVMsRUFBRSxpQkFBaUIsRUFBRSxjQUFjLENBQUMsQ0FBQyxDQUFBO0FBQ25ILE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxHQUFHLENBQUMscUJBQXFCLENBQUMsQ0FBQTtBQUN2RCxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxnQkFBZ0IsRUFBRSxVQUFVLEVBQUUsVUFBVSxFQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUE7QUFDMUYsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQyxDQUFBO0FBQ3pELDRDQUE0QztBQUM1QyxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFFbkMsbUZBQW1GO0FBQ25GLE1BQU0sQ0FBQyxPQUFPLE9BQU8sZ0JBQWdCO0lBQ25DOzs7Ozs7O09BT0c7SUFDSCxZQUFZLEVBQUMsV0FBVyxHQUFHLGNBQWMsRUFBRSxHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUMsSUFBSSxJQUFJLEVBQUUsRUFBRSxPQUFPLEVBQUUsVUFBVSxHQUFHLG1CQUFtQixFQUFD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RUFBRSxDQUFBO0FBQzlFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIExvY2FsIG11dGF0aW9uIGxvZyByZWNvcmQgcXVlcnkgb3B0aW9ucy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IExvY2FsTXV0YXRpb25Mb2dSZWNvcmRzT3B0aW9uc1xuICogQHByb3BlcnR5IHtMb2NhbE11dGF0aW9uU3RhdHVzW119IFtzdGF0dXNlc10gLSBPcHRpb25hbCBzdGF0dXMgZmlsdGVyLlxuICovXG4vKipcbiAqIExvY2FsIG11dGF0aW9uIGxvZyByb3ctb3JpZW50ZWQgc3RvcmFnZSBhZGFwdGVyLlxuICpcbiAqIEltcGxlbWVudGF0aW9ucyBzaG91bGQgc3RvcmUgZWFjaCBtdXRhdGlvbiBsb2cgcmVjb3JkIGFzIGl0cyBvd24gcm93L2VudHJ5LlxuICogTmF0aXZlIGFwcHMgc2hvdWxkIGJhY2sgdGhpcyB3aXRoIFNRTGl0ZSBhbmQgaW5kZXhlcyBvbiBzdG9yYWdlIGtleSwgc3RhdHVzLFxuICogYW5kIHNlcXVlbmNlLiBBdm9pZCBzdG9yaW5nIHRoZSB3aG9sZSBsb2cgYXMgb25lIEpTT04gYmxvYi5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IExvY2FsTXV0YXRpb25Mb2dTdG9yYWdlXG4gKiBAcHJvcGVydHkgeyhzdG9yYWdlS2V5OiBzdHJpbmcsIHJlY29yZDogTG9jYWxNdXRhdGlvbkxvZ1JlY29yZCkgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWR9IGFwcGVuZFJlY29yZCAtIEFwcGVuZHMgb25lIGxvZyByZWNvcmQuXG4gKiBAcHJvcGVydHkgeyhzdG9yYWdlS2V5OiBzdHJpbmcsIGlkczogc3RyaW5nW10pID0+IFByb21pc2U8dm9pZD4gfCB2b2lkfSBkZWxldGVSZWNvcmRzIC0gRGVsZXRlcyBsb2cgcmVjb3JkcyBieSBpZC5cbiAqIEBwcm9wZXJ0eSB7KHN0b3JhZ2VLZXk6IHN0cmluZykgPT4gUHJvbWlzZTxudW1iZXI+IHwgbnVtYmVyfSBuZXh0U2VxdWVuY2UgLSBSZXR1cm5zIHRoZSBuZXh0IGxvY2FsIHNlcXVlbmNlIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7KHN0b3JhZ2VLZXk6IHN0cmluZywgaWQ6IHN0cmluZykgPT4gUHJvbWlzZTxMb2NhbE11dGF0aW9uTG9nUmVjb3JkIHwgbnVsbCB8IHVuZGVmaW5lZD4gfCBMb2NhbE11dGF0aW9uTG9nUmVjb3JkIHwgbnVsbCB8IHVuZGVmaW5lZH0gcmVjb3JkIC0gUmVhZHMgb25lIGxvZyByZWNvcmQgYnkgaWQuXG4gKiBAcHJvcGVydHkgeyhzdG9yYWdlS2V5OiBzdHJpbmcsIG9wdGlvbnM/OiBMb2NhbE11dGF0aW9uTG9nUmVjb3Jkc09wdGlvbnMpID0+IFByb21pc2U8TG9jYWxNdXRhdGlvbkxvZ1JlY29yZFtdPiB8IExvY2FsTXV0YXRpb25Mb2dSZWNvcmRbXX0gcmVjb3JkcyAtIFJlYWRzIGxvZyByZWNvcmRzLlxuICogQHByb3BlcnR5IHsoc3RvcmFnZUtleTogc3RyaW5nLCByZWNvcmQ6IExvY2FsTXV0YXRpb25Mb2dSZWNvcmQpID0+IFByb21pc2U8dm9pZD4gfCB2b2lkfSB1cGRhdGVSZWNvcmQgLSBSZXBsYWNlcyBvbmUgbG9nIHJlY29yZC5cbiAqL1xuLyoqXG4gKiBMb2NhbCBzeW5jIG11dGF0aW9uIGRlcGVuZGVuY3kgbWV0YWRhdGEuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBMb2NhbE11dGF0aW9uRGVwZW5kZW5jeVxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNsaWVudE11dGF0aW9uSWQgLSBDbGllbnQgbXV0YXRpb24gaWQgdGhpcyBtdXRhdGlvbiBkZXBlbmRzIG9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG1vZGVsIC0gRGVwZW5kZW50IG1vZGVsL3Jlc291cmNlIG5hbWUuXG4gKi9cbi8qKlxuICogTG9jYWwgbXV0YXRpb24gbG9nIHN0YXR1cy5cbiAqIEB0eXBlZGVmIHtcInBlbmRpbmdcIiB8IFwiYXBwbGllZC1sb2NhbGx5XCIgfCBcInBlZXItYXBwbGllZFwiIHwgXCJjb25mbGljdFwiIHwgXCJyZWplY3RlZFwiIHwgXCJzeW5jZWRcIn0gTG9jYWxNdXRhdGlvblN0YXR1c1xuICogKi9cbi8qKlxuICogTG9jYWwgbXV0YXRpb24gbG9nIHJlY29yZC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IExvY2FsTXV0YXRpb25Mb2dSZWNvcmRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjcmVhdGVkQXQgLSBJU08gdGltZXN0YW1wIHdoZW4gdGhlIHJlY29yZCB3YXMgY3JlYXRlZCBsb2NhbGx5LlxuICogQHByb3BlcnR5IHtMb2NhbE11dGF0aW9uRGVwZW5kZW5jeVtdfSBkZXBlbmRlbmNpZXMgLSBPdGhlciBsb2NhbCBtdXRhdGlvbnMgdGhhdCBtdXN0IHJlcGxheSBmaXJzdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBpZCAtIExvY2FsIGxvZyByZWNvcmQgaWQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gbXV0YXRpb24gLSBEZXZpY2UgbXV0YXRpb24gcGF5bG9hZC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU2lnbmVkU3luY011dGF0aW9ufSBbc2lnbmVkTXV0YXRpb25dIC0gT3JpZ2luYWwgc2lnbmVkIG11dGF0aW9uIGVudmVsb3BlLCByZXRhaW5lZCBmb3IgcGVlci1mb3J3YXJkZWQgbXV0YXRpb25zLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHNlcXVlbmNlIC0gTW9ub3RvbmljIGxvY2FsIHNlcXVlbmNlLlxuICogQHByb3BlcnR5IHtMb2NhbE11dGF0aW9uU3RhdHVzfSBzdGF0dXMgLSBMb2NhbCByZXBsYXkvYXBwbHkgc3RhdHVzLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBbc3luY1Jlc3VsdF0gLSBCYWNrZW5kIHJlcGxheS9yZXN1bHQgbWV0YWRhdGEuIFN0b3JlZCBhcyB0cmFuc3BvcnQgbWFya2VycyBzbyBEYXRlIChhbmQgb3RoZXIgdHlwZWQpIHZhbHVlcyBzdXJ2aXZlIHRoZSBkdXJhYmxlIEpTT04gcm91bmQgdHJpcCBhbmQgYXJlIHJlc3RvcmVkIG9uIHJlYWRiYWNrLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHVwZGF0ZWRBdCAtIElTTyB0aW1lc3RhbXAgd2hlbiB0aGUgcmVjb3JkIHdhcyBsYXN0IGNoYW5nZWQuXG4gKi9cbi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2Rlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlLCBzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbHMvdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIlxuaW1wb3J0IHN0YWJsZUpzb25TdHJpbmdpZnkgZnJvbSBcIi4vc3RhYmxlLWpzb24uanNcIlxuXG5jb25zdCBERUZBVUxUX1NUT1JBR0VfS0VZID0gXCJ2ZWxvY2lvdXMuc3luYy5sb2NhbE11dGF0aW9uTG9nXCJcbmNvbnN0IFBFTkRJTkdfU1RBVFVTX1ZBTFVFUyA9IC8qKiBAdHlwZSB7TG9jYWxNdXRhdGlvblN0YXR1c1tdfSAqLyAoW1wicGVuZGluZ1wiLCBcImFwcGxpZWQtbG9jYWxseVwiLCBcInBlZXItYXBwbGllZFwiXSlcbmNvbnN0IFBFTkRJTkdfU1RBVFVTRVMgPSBuZXcgU2V0KFBFTkRJTkdfU1RBVFVTX1ZBTFVFUylcbmNvbnN0IE1VVEFUSU9OX1NUQVRVU0VTID0gbmV3IFNldChbLi4uUEVORElOR19TVEFUVVNFUywgXCJjb25mbGljdFwiLCBcInJlamVjdGVkXCIsIFwic3luY2VkXCJdKVxuY29uc3QgVEVSTUlOQUxfU1RBVFVTRVMgPSBuZXcgU2V0KFtcInJlamVjdGVkXCIsIFwic3luY2VkXCJdKVxuLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHVua25vd24+Pn0gKi9cbmNvbnN0IFNUT1JBR0VfS0VZX0xPQ0tTID0gbmV3IE1hcCgpXG5cbi8qKiBDbGllbnQtc2lkZSBhcHBlbmQtb25seSBzeW5jIG11dGF0aW9uIGxvZyB3aXRoIHBsdWdnYWJsZSBwZXJzaXN0ZW50IHN0b3JhZ2UuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBMb2NhbE11dGF0aW9uTG9nIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBsb2NhbCBtdXRhdGlvbiBsb2cuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0geygpID0+IHN0cmluZ30gW2FyZ3MuaWRHZW5lcmF0b3JdIC0gUmVjb3JkIGlkIGdlbmVyYXRvci5cbiAgICogQHBhcmFtIHsoKSA9PiBEYXRlfSBbYXJncy5ub3ddIC0gQ2xvY2sgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7TG9jYWxNdXRhdGlvbkxvZ1N0b3JhZ2V9IGFyZ3Muc3RvcmFnZSAtIFBlcnNpc3RlbnQgc3RvcmFnZSBhZGFwdGVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc3RvcmFnZUtleV0gLSBTdG9yYWdlIGtleS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtpZEdlbmVyYXRvciA9IHJhbmRvbVJlY29yZElkLCBub3cgPSAoKSA9PiBuZXcgRGF0ZSgpLCBzdG9yYWdlLCBzdG9yYWdlS2V5ID0gREVGQVVMVF9TVE9SQUdFX0tFWX0pIHtcbiAgICBpZiAoIXZhbGlkU3RvcmFnZShzdG9yYWdlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWxNdXRhdGlvbkxvZyByZXF1aXJlcyByb3cgc3RvcmFnZSB3aXRoIGFwcGVuZFJlY29yZC9kZWxldGVSZWNvcmRzL25leHRTZXF1ZW5jZS9yZWNvcmQvcmVjb3Jkcy91cGRhdGVSZWNvcmRcIilcbiAgICB9XG5cbiAgICB0aGlzLmlkR2VuZXJhdG9yID0gaWRHZW5lcmF0b3JcbiAgICB0aGlzLm5vdyA9IG5vd1xuICAgIHRoaXMuc3RvcmFnZSA9IHN0b3JhZ2VcbiAgICB0aGlzLnN0b3JhZ2VLZXkgPSBzdG9yYWdlS2V5XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIGxvZyB2aWV3IHdpdGggc2VxdWVuY2UsIHJlY29yZHMsIGFuZCBsb2NrcyBwYXJ0aXRpb25lZCBieSBhblxuICAgKiBpbW11dGFibGUgcGh5c2ljYWwgdGVuYW50IGlkZW50aXR5IHdoaWxlIHJldXNpbmcgdGhlIHNhbWUgcm93IHN0b3JlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcGFydGl0aW9uS2V5IC0gU3RhYmxlIG9wYXF1ZSBwYXJ0aXRpb24gaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtMb2NhbE11dGF0aW9uTG9nfSBQYXJ0aXRpb25lZCBsb2cuXG4gICAqL1xuICBwYXJ0aXRpb24ocGFydGl0aW9uS2V5KSB7XG4gICAgaWYgKCFwYXJ0aXRpb25LZXkpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsTXV0YXRpb25Mb2cgcGFydGl0aW9uIGtleSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZ1wiKVxuXG4gICAgcmV0dXJuIG5ldyBMb2NhbE11dGF0aW9uTG9nKHtcbiAgICAgIGlkR2VuZXJhdG9yOiB0aGlzLmlkR2VuZXJhdG9yLFxuICAgICAgbm93OiB0aGlzLm5vdyxcbiAgICAgIHN0b3JhZ2U6IHRoaXMuc3RvcmFnZSxcbiAgICAgIHN0b3JhZ2VLZXk6IGAke3RoaXMuc3RvcmFnZUtleX06JHtwYXJ0aXRpb25LZXkubGVuZ3RofToke3BhcnRpdGlvbktleX1gXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBlbmRzIGEgcGVuZGluZyBtdXRhdGlvbiByZWNvcmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge0xvY2FsTXV0YXRpb25EZXBlbmRlbmN5W119IFthcmdzLmRlcGVuZGVuY2llc10gLSBNdXRhdGlvbiBkZXBlbmRlbmNpZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTXV0YXRpb24gcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259IFthcmdzLnNpZ25lZE11dGF0aW9uXSAtIE9yaWdpbmFsIHNpZ25lZCBtdXRhdGlvbiBlbnZlbG9wZSwgcmV0YWluZWQgZm9yIHBlZXItZm9yd2FyZGVkIG11dGF0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8TG9jYWxNdXRhdGlvbkxvZ1JlY29yZD59IC0gQ3JlYXRlZCBsb2cgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgYXBwZW5kKHtkZXBlbmRlbmNpZXMgPSBbXSwgbXV0YXRpb24sIHNpZ25lZE11dGF0aW9ufSkge1xuICAgIGlmIChzaWduZWRNdXRhdGlvbiAhPT0gdW5kZWZpbmVkICYmIHN0YWJsZUpzb25TdHJpbmdpZnkoc2lnbmVkTXV0YXRpb24ubXV0YXRpb24pICE9PSBzdGFibGVKc29uU3RyaW5naWZ5KG11dGF0aW9uKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU2lnbmVkIG11dGF0aW9uIHBheWxvYWQgZG9lcyBub3QgbWF0Y2ggdGhlIG11dGF0aW9uXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHdpdGhTdG9yYWdlS2V5TG9jayh0aGlzLnN0b3JhZ2VLZXksIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHRpbWVzdGFtcCA9IHRoaXMuY3VycmVudFRpbWVzdGFtcCgpXG4gICAgICBjb25zdCByZWNvcmQgPSBub3JtYWxpemVSZWNvcmQoe1xuICAgICAgICBjcmVhdGVkQXQ6IHRpbWVzdGFtcCxcbiAgICAgICAgZGVwZW5kZW5jaWVzLFxuICAgICAgICBpZDogdGhpcy5pZEdlbmVyYXRvcigpLFxuICAgICAgICBtdXRhdGlvbixcbiAgICAgICAgc2VxdWVuY2U6IGF3YWl0IHRoaXMuc3RvcmFnZS5uZXh0U2VxdWVuY2UodGhpcy5zdG9yYWdlS2V5KSxcbiAgICAgICAgc2lnbmVkTXV0YXRpb24sXG4gICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgIHVwZGF0ZWRBdDogdGltZXN0YW1wXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB0aGlzLnN0b3JhZ2UuYXBwZW5kUmVjb3JkKHRoaXMuc3RvcmFnZUtleSwgY2xvbmVSZWNvcmQocmVjb3JkKSlcblxuICAgICAgcmV0dXJuIGNsb25lUmVjb3JkKHJlY29yZClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYWxsIHJlY29yZHMgb3JkZXJlZCBieSBsb2NhbCBzZXF1ZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8TG9jYWxNdXRhdGlvbkxvZ1JlY29yZFtdPn0gLSBMb2cgcmVjb3Jkcy5cbiAgICovXG4gIGFzeW5jIHJlY29yZHMoKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVJlY29yZExpc3QoYXdhaXQgdGhpcy5zdG9yYWdlLnJlY29yZHModGhpcy5zdG9yYWdlS2V5KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHJlY29yZHMgdGhhdCBzdGlsbCBuZWVkIGxvY2FsL3NlcnZlciByZWNvbmNpbGlhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8TG9jYWxNdXRhdGlvbkxvZ1JlY29yZFtdPn0gLSBQZW5kaW5nIHJlY29yZHMuXG4gICAqL1xuICBhc3luYyBwZW5kaW5nUmVjb3JkcygpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplUmVjb3JkTGlzdChhd2FpdCB0aGlzLnN0b3JhZ2UucmVjb3Jkcyh0aGlzLnN0b3JhZ2VLZXksIHtzdGF0dXNlczogUEVORElOR19TVEFUVVNfVkFMVUVTfSkpXG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlcyBhIHJlY29yZCBzdGF0dXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pZCAtIFJlY29yZCBpZC5cbiAgICogQHBhcmFtIHtMb2NhbE11dGF0aW9uU3RhdHVzfSBhcmdzLnN0YXR1cyAtIE5ldyBzdGF0dXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gW2FyZ3Muc3luY1Jlc3VsdF0gLSBSZXN1bHQgbWV0YWRhdGEgKG1heSBjYXJyeSB0cmFuc3BvcnQtcmVzdG9yZWQgdHlwZWQgdmFsdWVzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8TG9jYWxNdXRhdGlvbkxvZ1JlY29yZD59IC0gVXBkYXRlZCByZWNvcmQuXG4gICAqL1xuICBhc3luYyB1cGRhdGVTdGF0dXMoe2lkLCBzdGF0dXMsIHN5bmNSZXN1bHR9KSB7XG4gICAgaWYgKCFNVVRBVElPTl9TVEFUVVNFUy5oYXMoc3RhdHVzKSkgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGxvY2FsIG11dGF0aW9uIHN0YXR1cyAnJHtzdGF0dXN9J2ApXG5cbiAgICByZXR1cm4gYXdhaXQgd2l0aFN0b3JhZ2VLZXlMb2NrKHRoaXMuc3RvcmFnZUtleSwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmF3UmVjb3JkID0gYXdhaXQgdGhpcy5zdG9yYWdlLnJlY29yZCh0aGlzLnN0b3JhZ2VLZXksIGlkKVxuXG4gICAgICBpZiAoIXJhd1JlY29yZCkgdGhyb3cgbmV3IEVycm9yKGBObyBsb2NhbCBtdXRhdGlvbiBsb2cgcmVjb3JkICcke2lkfSdgKVxuXG4gICAgICBjb25zdCByZWNvcmQgPSBub3JtYWxpemVSZWNvcmQocmF3UmVjb3JkKVxuXG4gICAgICByZWNvcmQuc3RhdHVzID0gLyoqIEB0eXBlIHtMb2NhbE11dGF0aW9uU3RhdHVzfSAqLyAoc3RhdHVzKVxuICAgICAgaWYgKHN5bmNSZXN1bHQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvLyBFbmNvZGUgdHJhbnNwb3J0LXJlc3RvcmVkIHR5cGVkIHZhbHVlcyAoZS5nLiBEYXRlIGF0dHJpYnV0ZXMgaW4gYVxuICAgICAgICAvLyBjb25mbGljdCBzZXJ2ZXJNb2RlbCkgYXMgbWFya2VycyBiZWZvcmUgdGhlIEpTT04gY2xvbmUgc28gdGhlXG4gICAgICAgIC8vIGR1cmFibGUgcGVyc2lzdGVuY2Ugcm91bmQgdHJpcCBjYW5ub3Qgc3RyaW5naWZ5IHRoZW0uXG4gICAgICAgIHJlY29yZC5zeW5jUmVzdWx0ID0gY2xvbmVKc29uT2JqZWN0KHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShzeW5jUmVzdWx0KSwgXCJzeW5jUmVzdWx0XCIpXG4gICAgICB9XG4gICAgICByZWNvcmQudXBkYXRlZEF0ID0gdGhpcy5jdXJyZW50VGltZXN0YW1wKClcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmFnZS51cGRhdGVSZWNvcmQodGhpcy5zdG9yYWdlS2V5LCBjbG9uZVJlY29yZChyZWNvcmQpKVxuXG4gICAgICByZXR1cm4gcmVzdG9yZVN5bmNSZXN1bHRUeXBlcyhjbG9uZVJlY29yZChyZWNvcmQpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVwbGFjZXMgdGhlIG11dGF0aW9uIHBheWxvYWQgb2YgYSBzdGlsbC1wZW5kaW5nIHJlY29yZC4gVXNlZCB3aGVuIGFuXG4gICAqIGFja25vd2xlZGdlZCBwcmVkZWNlc3NvciBzdXBwbGllcyB0aGUgYXV0aG9yaXRhdGl2ZSBiYXNlIGZvciBpdHMgc3VjY2Vzc29yLlxuICAgKiBAcGFyYW0ge3tpZDogc3RyaW5nLCBtdXRhdGlvbjogaW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufX0gYXJncyAtIFJlY29yZCBhbmQgcmVwbGFjZW1lbnQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPExvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+fSBVcGRhdGVkIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIHVwZGF0ZU11dGF0aW9uKHtpZCwgbXV0YXRpb259KSB7XG4gICAgcmV0dXJuIGF3YWl0IHdpdGhTdG9yYWdlS2V5TG9jayh0aGlzLnN0b3JhZ2VLZXksIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJhd1JlY29yZCA9IGF3YWl0IHRoaXMuc3RvcmFnZS5yZWNvcmQodGhpcy5zdG9yYWdlS2V5LCBpZClcblxuICAgICAgaWYgKCFyYXdSZWNvcmQpIHRocm93IG5ldyBFcnJvcihgTm8gbG9jYWwgbXV0YXRpb24gbG9nIHJlY29yZCAnJHtpZH0nYClcblxuICAgICAgY29uc3QgcmVjb3JkID0gbm9ybWFsaXplUmVjb3JkKHJhd1JlY29yZClcblxuICAgICAgaWYgKCFQRU5ESU5HX1NUQVRVU0VTLmhhcyhyZWNvcmQuc3RhdHVzKSkgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgdXBkYXRlIG11dGF0aW9uIGZvciAke3JlY29yZC5zdGF0dXN9IGxvY2FsIG11dGF0aW9uICcke2lkfSdgKVxuXG4gICAgICByZWNvcmQubXV0YXRpb24gPSBub3JtYWxpemVNdXRhdGlvbihtdXRhdGlvbilcbiAgICAgIHJlY29yZC51cGRhdGVkQXQgPSB0aGlzLmN1cnJlbnRUaW1lc3RhbXAoKVxuICAgICAgYXdhaXQgdGhpcy5zdG9yYWdlLnVwZGF0ZVJlY29yZCh0aGlzLnN0b3JhZ2VLZXksIGNsb25lUmVjb3JkKHJlY29yZCkpXG5cbiAgICAgIHJldHVybiByZXN0b3JlU3luY1Jlc3VsdFR5cGVzKGNsb25lUmVjb3JkKHJlY29yZCkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIGR1cmFibGUgY29uZmxpY3QgZXhwbGljaXRseS4gS2VlcGluZyB0aGUgc2VydmVyIGFja25vd2xlZGdlcyB0aGVcbiAgICogcHJlc2VydmVkIGxvY2FsIGludGVudCB3aXRob3V0IHJlcGxheWluZyBpdDsgcmV0cnlpbmcgbG9jYWwgaW50ZW50IHJlYmFzZXNcbiAgICogaXQgb250byB0aGUgY29uZmxpY3QncyBhdXRob3JpdGF0aXZlIHNlcnZlclZlcnNpb24gYW5kIHJldHVybnMgaXQgdG8gdGhlXG4gICAqIHBlbmRpbmcgcXVldWUuIFRoZSBwcmlvciBjb25mbGljdCByZXN1bHQgc3RheXMgYXR0YWNoZWQgYXMgYXVkaXQgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7e2lkOiBzdHJpbmcsIHJlc29sdXRpb246IFwia2VlcC1zZXJ2ZXJcIiB8IFwicmV0cnktbG9jYWxcIn19IGFyZ3MgLSBSZXNvbHV0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxMb2NhbE11dGF0aW9uTG9nUmVjb3JkPn0gUmVzb2x2ZWQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZUNvbmZsaWN0KHtpZCwgcmVzb2x1dGlvbn0pIHtcbiAgICBpZiAoIVtcImtlZXAtc2VydmVyXCIsIFwicmV0cnktbG9jYWxcIl0uaW5jbHVkZXMocmVzb2x1dGlvbikpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBsb2NhbCBtdXRhdGlvbiBjb25mbGljdCByZXNvbHV0aW9uICcke3Jlc29sdXRpb259J2ApXG5cbiAgICByZXR1cm4gYXdhaXQgd2l0aFN0b3JhZ2VLZXlMb2NrKHRoaXMuc3RvcmFnZUtleSwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmF3UmVjb3JkID0gYXdhaXQgdGhpcy5zdG9yYWdlLnJlY29yZCh0aGlzLnN0b3JhZ2VLZXksIGlkKVxuXG4gICAgICBpZiAoIXJhd1JlY29yZCkgdGhyb3cgbmV3IEVycm9yKGBObyBsb2NhbCBtdXRhdGlvbiBsb2cgcmVjb3JkICcke2lkfSdgKVxuXG4gICAgICBjb25zdCByZWNvcmQgPSBub3JtYWxpemVSZWNvcmQocmF3UmVjb3JkKVxuXG4gICAgICBpZiAocmVjb3JkLnN0YXR1cyAhPT0gXCJjb25mbGljdFwiKSB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCByZXNvbHZlICR7cmVjb3JkLnN0YXR1c30gbG9jYWwgbXV0YXRpb24gJyR7aWR9JyBhcyBhIGNvbmZsaWN0YClcblxuICAgICAgaWYgKHJlc29sdXRpb24gPT09IFwia2VlcC1zZXJ2ZXJcIikge1xuICAgICAgICByZWNvcmQuc3RhdHVzID0gXCJzeW5jZWRcIlxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3Qgc2VydmVyVmVyc2lvbiA9IGNvbmZsaWN0U2VydmVyVmVyc2lvbihyZWNvcmQpXG5cbiAgICAgICAgcmVjb3JkLm11dGF0aW9uID0gey4uLnJlY29yZC5tdXRhdGlvbiwgYmFzZVZlcnNpb246IHNlcnZlclZlcnNpb259XG4gICAgICAgIHJlY29yZC5zdGF0dXMgPSBcInBlbmRpbmdcIlxuICAgICAgfVxuXG4gICAgICByZWNvcmQudXBkYXRlZEF0ID0gdGhpcy5jdXJyZW50VGltZXN0YW1wKClcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmFnZS51cGRhdGVSZWNvcmQodGhpcy5zdG9yYWdlS2V5LCBjbG9uZVJlY29yZChyZWNvcmQpKVxuXG4gICAgICByZXR1cm4gcmVzdG9yZVN5bmNSZXN1bHRUeXBlcyhjbG9uZVJlY29yZChyZWNvcmQpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUHJ1bmVzIHRlcm1pbmFsIHJlY29yZHMgdGhhdCBhcmUgbm8gbG9uZ2VyIG5lZWRlZCBmb3IgcmVwbGF5IGRlcGVuZGVuY2llcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIENvbXBhY3Rpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm1heFRlcm1pbmFsUmVjb3Jkc10gLSBNYXhpbXVtIHRlcm1pbmFsIHJlY29yZHMgdG8gcmV0YWluLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MudGVybWluYWxSZXRlbnRpb25Nc10gLSBNaW5pbXVtIGFnZSBiZWZvcmUgcHJ1bmluZyB0ZXJtaW5hbCByZWNvcmRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7ZGVsZXRlZFJlY29yZElkczogc3RyaW5nW119Pn0gLSBDb21wYWN0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNvbXBhY3Qoe21heFRlcm1pbmFsUmVjb3JkcywgdGVybWluYWxSZXRlbnRpb25Nc30gPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB3aXRoU3RvcmFnZUtleUxvY2sodGhpcy5zdG9yYWdlS2V5LCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmRzID0gYXdhaXQgdGhpcy5yZWNvcmRzKClcbiAgICAgIGNvbnN0IHByb3RlY3RlZENsaWVudE11dGF0aW9uSWRzID0gbmV3IFNldChcbiAgICAgICAgcmVjb3Jkc1xuICAgICAgICAgIC5maWx0ZXIoKHJlY29yZCkgPT4gUEVORElOR19TVEFUVVNFUy5oYXMocmVjb3JkLnN0YXR1cykgfHwgcmVjb3JkLnN0YXR1cyA9PT0gXCJjb25mbGljdFwiKVxuICAgICAgICAgIC5mbGF0TWFwKChyZWNvcmQpID0+IHJlY29yZC5kZXBlbmRlbmNpZXMubWFwKChkZXBlbmRlbmN5KSA9PiBkZXBlbmRlbmN5LmNsaWVudE11dGF0aW9uSWQpKVxuICAgICAgKVxuICAgICAgY29uc3QgdGVybWluYWxSZWNvcmRzID0gcmVjb3Jkc1xuICAgICAgICAuZmlsdGVyKChyZWNvcmQpID0+IFRFUk1JTkFMX1NUQVRVU0VTLmhhcyhyZWNvcmQuc3RhdHVzKSlcbiAgICAgICAgLmZpbHRlcigocmVjb3JkKSA9PiAhcHJvdGVjdGVkQ2xpZW50TXV0YXRpb25JZHMuaGFzKHJlY29yZC5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkKSlcbiAgICAgICAgLnNvcnQoY29tcGFyZVJlY29yZHNOZXdlc3RGaXJzdClcbiAgICAgIGNvbnN0IGRlbGV0ZUlkcyA9IG5ldyBTZXQoKVxuXG4gICAgICBpZiAodHlwZW9mIG1heFRlcm1pbmFsUmVjb3JkcyA9PT0gXCJudW1iZXJcIiAmJiBtYXhUZXJtaW5hbFJlY29yZHMgPj0gMCkge1xuICAgICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiB0ZXJtaW5hbFJlY29yZHMuc2xpY2UobWF4VGVybWluYWxSZWNvcmRzKSkgZGVsZXRlSWRzLmFkZChyZWNvcmQuaWQpXG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgdGVybWluYWxSZXRlbnRpb25NcyA9PT0gXCJudW1iZXJcIiAmJiB0ZXJtaW5hbFJldGVudGlvbk1zID49IDApIHtcbiAgICAgICAgY29uc3QgY3V0b2ZmID0gdGhpcy5ub3coKS5nZXRUaW1lKCkgLSB0ZXJtaW5hbFJldGVudGlvbk1zXG5cbiAgICAgICAgZm9yIChjb25zdCByZWNvcmQgb2YgdGVybWluYWxSZWNvcmRzKSB7XG4gICAgICAgICAgaWYgKG5ldyBEYXRlKHJlY29yZC51cGRhdGVkQXQpLmdldFRpbWUoKSA8IGN1dG9mZikgZGVsZXRlSWRzLmFkZChyZWNvcmQuaWQpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgZGVsZXRlZFJlY29yZElkcyA9IEFycmF5LmZyb20oZGVsZXRlSWRzKVxuXG4gICAgICBpZiAoZGVsZXRlZFJlY29yZElkcy5sZW5ndGggPiAwKSBhd2FpdCB0aGlzLnN0b3JhZ2UuZGVsZXRlUmVjb3Jkcyh0aGlzLnN0b3JhZ2VLZXksIGRlbGV0ZWRSZWNvcmRJZHMpXG5cbiAgICAgIHJldHVybiB7ZGVsZXRlZFJlY29yZElkc31cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGN1cnJlbnQgbG9nIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBDdXJyZW50IElTTyB0aW1lc3RhbXAuXG4gICAqL1xuICBjdXJyZW50VGltZXN0YW1wKCkge1xuICAgIGNvbnN0IGRhdGUgPSB0aGlzLm5vdygpXG5cbiAgICBpZiAoIShkYXRlIGluc3RhbmNlb2YgRGF0ZSkgfHwgTnVtYmVyLmlzTmFOKGRhdGUuZ2V0VGltZSgpKSkgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWxNdXRhdGlvbkxvZyBub3coKSBtdXN0IHJldHVybiBhIHZhbGlkIERhdGVcIilcblxuICAgIHJldHVybiBkYXRlLnRvSVNPU3RyaW5nKClcbiAgfVxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGEgc3RvcmFnZSBhZGFwdGVyIGhhcyBhbGwgcmVxdWlyZWQgcm93LXN0b3JlIG1ldGhvZHMuXG4gKiBAcGFyYW0ge3Vua25vd259IHN0b3JhZ2UgLSBTdG9yYWdlIGFkYXB0ZXIgY2FuZGlkYXRlLlxuICogQHJldHVybnMge3N0b3JhZ2UgaXMgTG9jYWxNdXRhdGlvbkxvZ1N0b3JhZ2V9IC0gV2hldGhlciBzdG9yYWdlIGlzIHZhbGlkLlxuICovXG5mdW5jdGlvbiB2YWxpZFN0b3JhZ2Uoc3RvcmFnZSkge1xuICBpZiAoIXN0b3JhZ2UgfHwgdHlwZW9mIHN0b3JhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IHN0b3JhZ2VPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoc3RvcmFnZSlcblxuICByZXR1cm4gdHlwZW9mIHN0b3JhZ2VPYmplY3QuYXBwZW5kUmVjb3JkID09PSBcImZ1bmN0aW9uXCJcbiAgICAmJiB0eXBlb2Ygc3RvcmFnZU9iamVjdC5kZWxldGVSZWNvcmRzID09PSBcImZ1bmN0aW9uXCJcbiAgICAmJiB0eXBlb2Ygc3RvcmFnZU9iamVjdC5uZXh0U2VxdWVuY2UgPT09IFwiZnVuY3Rpb25cIlxuICAgICYmIHR5cGVvZiBzdG9yYWdlT2JqZWN0LnJlY29yZCA9PT0gXCJmdW5jdGlvblwiXG4gICAgJiYgdHlwZW9mIHN0b3JhZ2VPYmplY3QucmVjb3JkcyA9PT0gXCJmdW5jdGlvblwiXG4gICAgJiYgdHlwZW9mIHN0b3JhZ2VPYmplY3QudXBkYXRlUmVjb3JkID09PSBcImZ1bmN0aW9uXCJcbn1cblxuLyoqXG4gKiBSZWFkcyB0aGUgYXV0aG9yaXRhdGl2ZSB2ZXJzaW9uIGZyb20gYSBjb25mbGljdGVkIG11dGF0aW9uLlxuICogQHBhcmFtIHtMb2NhbE11dGF0aW9uTG9nUmVjb3JkfSByZWNvcmQgLSBDb25mbGljdGVkIHJlY29yZC5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSAtIEF1dGhvcml0YXRpdmUgdmVyc2lvbi5cbiAqL1xuZnVuY3Rpb24gY29uZmxpY3RTZXJ2ZXJWZXJzaW9uKHJlY29yZCkge1xuICBjb25zdCBjb25mbGljdCA9IHJlY29yZC5zeW5jUmVzdWx0Py5jb25mbGljdFxuXG4gIGlmICghY29uZmxpY3QgfHwgY29uZmxpY3QgaW5zdGFuY2VvZiBEYXRlIHx8IHR5cGVvZiBjb25mbGljdCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNvbmZsaWN0KSB8fCAhT2JqZWN0Lmhhc093bihjb25mbGljdCwgXCJzZXJ2ZXJWZXJzaW9uXCIpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmV0cnkgbG9jYWwgbXV0YXRpb24gJyR7cmVjb3JkLmlkfScgd2l0aG91dCBhIGNvbmZsaWN0IHNlcnZlclZlcnNpb25gKVxuICB9XG5cbiAgY29uc3QgY29uZmxpY3RNZXRhZGF0YSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChjb25mbGljdClcblxuICByZXR1cm4gY2xvbmVCYXNlVmVyc2lvbihjb25mbGljdE1ldGFkYXRhLnNlcnZlclZlcnNpb24pXG59XG5cbi8qKlxuICogU29ydHMgcmVjb3JkcyBieSBuZXdlc3QgdXBkYXRlL3NlcXVlbmNlIGZpcnN0LlxuICogQHBhcmFtIHtMb2NhbE11dGF0aW9uTG9nUmVjb3JkfSBsZWZ0IC0gTGVmdCByZWNvcmQuXG4gKiBAcGFyYW0ge0xvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IHJpZ2h0IC0gUmlnaHQgcmVjb3JkLlxuICogQHJldHVybnMge251bWJlcn0gLSBTb3J0IHJlc3VsdC5cbiAqL1xuZnVuY3Rpb24gY29tcGFyZVJlY29yZHNOZXdlc3RGaXJzdChsZWZ0LCByaWdodCkge1xuICBjb25zdCB1cGRhdGVkQXRDb21wYXJpc29uID0gcmlnaHQudXBkYXRlZEF0LmxvY2FsZUNvbXBhcmUobGVmdC51cGRhdGVkQXQpXG5cbiAgaWYgKHVwZGF0ZWRBdENvbXBhcmlzb24gIT09IDApIHJldHVybiB1cGRhdGVkQXRDb21wYXJpc29uXG5cbiAgcmV0dXJuIHJpZ2h0LnNlcXVlbmNlIC0gbGVmdC5zZXF1ZW5jZVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYW5kIHNvcnRzIGEgbGlzdCBvZiByZWNvcmRzLlxuICogQHBhcmFtIHt1bmtub3dufSByZWNvcmRzIC0gUmF3IHJlY29yZHMuXG4gKiBAcmV0dXJucyB7TG9jYWxNdXRhdGlvbkxvZ1JlY29yZFtdfSAtIE5vcm1hbGl6ZWQgcmVjb3Jkcy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplUmVjb3JkTGlzdChyZWNvcmRzKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShyZWNvcmRzKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgbG9jYWwgbXV0YXRpb24gbG9nIHN0b3JhZ2UgcmVjb3JkcyBhcnJheVwiKVxuXG4gIHJldHVybiByZWNvcmRzXG4gICAgLm1hcChub3JtYWxpemVSZWNvcmQpXG4gICAgLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0LnNlcXVlbmNlIC0gcmlnaHQuc2VxdWVuY2UpXG4gICAgLm1hcCgocmVjb3JkKSA9PiBjbG9uZVJlY29yZChyZWNvcmQpKVxuICAgIC5tYXAocmVzdG9yZVN5bmNSZXN1bHRUeXBlcylcbn1cblxuLyoqXG4gKiBSZXN0b3JlcyB0cmFuc3BvcnQtcmVzdG9yZWQgdHlwZWQgdmFsdWVzIGluIGEgcmVjb3JkJ3Mgc3luY1Jlc3VsdCBhZnRlciB0aGVcbiAqIGZpbmFsIEpTT04gY2xvbmUsIHNvIGNhbGxlcnMgc2VlIERhdGUgKGFuZCBvdGhlciB0eXBlZCkgdmFsdWVzIG9uIGR1cmFibGVcbiAqIHJlYWRiYWNrIGluc3RlYWQgb2YgbWFya2VyLWVuY29kZWQgSVNPIHN0cmluZ3MuXG4gKiBAcGFyYW0ge0xvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IHJlY29yZCAtIENsb25lZCByZWNvcmQuXG4gKiBAcmV0dXJucyB7TG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gLSBSZWNvcmQgd2l0aCByZXN0b3JlZCBzeW5jUmVzdWx0IHR5cGVzLlxuICovXG5mdW5jdGlvbiByZXN0b3JlU3luY1Jlc3VsdFR5cGVzKHJlY29yZCkge1xuICBpZiAocmVjb3JkLnN5bmNSZXN1bHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHJlY29yZFxuXG4gIHJldHVybiB7XG4gICAgLi4ucmVjb3JkLFxuICAgIHN5bmNSZXN1bHQ6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gKi8gKFxuICAgICAgZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocmVjb3JkLnN5bmNSZXN1bHQpXG4gICAgKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBhIGNhbGxiYWNrIGFmdGVyIGVhcmxpZXIgd3JpdGVzIGZvciB0aGUgc2FtZSBzdG9yYWdlIGtleSBoYXZlIGNvbXBsZXRlZC5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAcGFyYW0ge3N0cmluZ30gc3RvcmFnZUtleSAtIFN0b3JhZ2Uga2V5IHRvIHNlcmlhbGl6ZS5cbiAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4gdW5kZXIgdGhlIHN0b3JhZ2Uta2V5IGxvY2suXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHdpdGhTdG9yYWdlS2V5TG9jayhzdG9yYWdlS2V5LCBjYWxsYmFjaykge1xuICBjb25zdCBwcmV2aW91cyA9IFNUT1JBR0VfS0VZX0xPQ0tTLmdldChzdG9yYWdlS2V5KSB8fCBQcm9taXNlLnJlc29sdmUoKVxuICBsZXQgcmVsZWFzZSA9ICgpID0+IHt9XG4gIGNvbnN0IGN1cnJlbnQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4geyByZWxlYXNlID0gKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpIH0pXG4gIGNvbnN0IGNoYWluZWQgPSBwcmV2aW91cy5jYXRjaCgoX2Vycm9yKSA9PiB7fSkudGhlbigoKSA9PiBjdXJyZW50KVxuXG4gIFNUT1JBR0VfS0VZX0xPQ0tTLnNldChzdG9yYWdlS2V5LCBjaGFpbmVkKVxuXG4gIHRyeSB7XG4gICAgYXdhaXQgcHJldmlvdXMuY2F0Y2goKF9lcnJvcikgPT4ge30pXG5cbiAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICB9IGZpbmFsbHkge1xuICAgIHJlbGVhc2UoKVxuICAgIGlmIChTVE9SQUdFX0tFWV9MT0NLUy5nZXQoc3RvcmFnZUtleSkgPT09IGNoYWluZWQpIFNUT1JBR0VfS0VZX0xPQ0tTLmRlbGV0ZShzdG9yYWdlS2V5KVxuICB9XG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhIHBlcnNpc3RlZCBsb2cgcmVjb3JkLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFJhdyByZWNvcmQuXG4gKiBAcmV0dXJucyB7TG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gLSBOb3JtYWxpemVkIHJlY29yZC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplUmVjb3JkKHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBsb2NhbCBtdXRhdGlvbiBsb2cgcmVjb3JkIG9iamVjdFwiKVxuXG4gIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICh2YWx1ZSlcbiAgY29uc3Qgc3RhdHVzID0gcmVxdWlyZWRTdHJpbmcocmVjb3JkLnN0YXR1cywgXCJzdGF0dXNcIilcblxuICBpZiAoIU1VVEFUSU9OX1NUQVRVU0VTLmhhcyhzdGF0dXMpKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gbG9jYWwgbXV0YXRpb24gc3RhdHVzICcke3N0YXR1c30nYClcblxuICBjb25zdCBiYXNlUmVjb3JkID0ge1xuICAgIGNyZWF0ZWRBdDogcmVxdWlyZWRJc29UaW1lc3RhbXAocmVjb3JkLmNyZWF0ZWRBdCwgXCJjcmVhdGVkQXRcIiksXG4gICAgZGVwZW5kZW5jaWVzOiBub3JtYWxpemVEZXBlbmRlbmNpZXMocmVjb3JkLmRlcGVuZGVuY2llcyksXG4gICAgaWQ6IHJlcXVpcmVkU3RyaW5nKHJlY29yZC5pZCwgXCJpZFwiKSxcbiAgICBtdXRhdGlvbjogbm9ybWFsaXplTXV0YXRpb24ocmVjb3JkLm11dGF0aW9uKSxcbiAgICBzZXF1ZW5jZTogcmVxdWlyZWRQb3NpdGl2ZUludGVnZXIocmVjb3JkLnNlcXVlbmNlLCBcInNlcXVlbmNlXCIpLFxuICAgIHN0YXR1czogLyoqIEB0eXBlIHtMb2NhbE11dGF0aW9uU3RhdHVzfSAqLyAoc3RhdHVzKSxcbiAgICB1cGRhdGVkQXQ6IHJlcXVpcmVkSXNvVGltZXN0YW1wKHJlY29yZC51cGRhdGVkQXQsIFwidXBkYXRlZEF0XCIpXG4gIH1cblxuICBpZiAocmVjb3JkLnNpZ25lZE11dGF0aW9uID09PSB1bmRlZmluZWQgJiYgcmVjb3JkLnN5bmNSZXN1bHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGJhc2VSZWNvcmRcblxuICAvKiogQHR5cGUge0xvY2FsTXV0YXRpb25Mb2dSZWNvcmR9ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWRSZWNvcmQgPSB7Li4uYmFzZVJlY29yZH1cblxuICBpZiAocmVjb3JkLnNpZ25lZE11dGF0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgICBub3JtYWxpemVkUmVjb3JkLnNpZ25lZE11dGF0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259ICovIChjbG9uZUpzb25PYmplY3QocmVjb3JkLnNpZ25lZE11dGF0aW9uLCBcInNpZ25lZE11dGF0aW9uXCIpKVxuICB9XG4gIGlmIChyZWNvcmQuc3luY1Jlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gUGVyc2lzdGVkIHN5bmNSZXN1bHQgaXMgbWFya2VyLWVuY29kZWQgc28gaXQgc3Vydml2ZXMgdGhlIEpTT04gY2xvbmU7XG4gICAgLy8gdHlwZWQgdmFsdWVzIGFyZSByZXN0b3JlZCBieSByZXN0b3JlU3luY1Jlc3VsdFR5cGVzIGF0IHRoZSByZWFkIGJvdW5kYXJ5LlxuICAgIG5vcm1hbGl6ZWRSZWNvcmQuc3luY1Jlc3VsdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gKi8gKFxuICAgICAgY2xvbmVKc29uT2JqZWN0KHJlY29yZC5zeW5jUmVzdWx0LCBcInN5bmNSZXN1bHRcIilcbiAgICApXG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZFJlY29yZFxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgZGVwZW5kZW5jeSBtZXRhZGF0YSBlbnRyaWVzLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFJhdyBkZXBlbmRlbmNpZXMuXG4gKiBAcmV0dXJucyB7TG9jYWxNdXRhdGlvbkRlcGVuZGVuY3lbXX0gLSBOb3JtYWxpemVkIGRlcGVuZGVuY2llcy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRGVwZW5kZW5jaWVzKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gW11cbiAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgbG9jYWwgbXV0YXRpb24gZGVwZW5kZW5jaWVzIGFycmF5XCIpXG5cbiAgcmV0dXJuIHZhbHVlLm1hcCgoZGVwZW5kZW5jeSkgPT4ge1xuICAgIGlmICghZGVwZW5kZW5jeSB8fCB0eXBlb2YgZGVwZW5kZW5jeSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGRlcGVuZGVuY3kpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBsb2NhbCBtdXRhdGlvbiBkZXBlbmRlbmN5IG9iamVjdFwiKVxuICAgIH1cblxuICAgIGNvbnN0IGRlcGVuZGVuY3lPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoZGVwZW5kZW5jeSlcblxuICAgIHJldHVybiB7XG4gICAgICBjbGllbnRNdXRhdGlvbklkOiByZXF1aXJlZFN0cmluZyhkZXBlbmRlbmN5T2JqZWN0LmNsaWVudE11dGF0aW9uSWQsIFwiZGVwZW5kZW5jeSBjbGllbnRNdXRhdGlvbklkXCIpLFxuICAgICAgbW9kZWw6IHJlcXVpcmVkU3RyaW5nKGRlcGVuZGVuY3lPYmplY3QubW9kZWwsIFwiZGVwZW5kZW5jeSBtb2RlbFwiKVxuICAgIH1cbiAgfSlcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgc3luYyBtdXRhdGlvbiBwYXlsb2FkLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFJhdyBtdXRhdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb259IC0gTm9ybWFsaXplZCBtdXRhdGlvbi5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplTXV0YXRpb24odmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIGxvY2FsIHN5bmMgbXV0YXRpb24gb2JqZWN0XCIpXG5cbiAgY29uc3QgbXV0YXRpb24gPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAodmFsdWUpXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gKi8gKHtcbiAgICBhY3RvckRldmljZUlkOiByZXF1aXJlZFN0cmluZyhtdXRhdGlvbi5hY3RvckRldmljZUlkLCBcImFjdG9yRGV2aWNlSWRcIiksXG4gICAgYWN0b3JVc2VySWQ6IHJlcXVpcmVkU3RyaW5nKG11dGF0aW9uLmFjdG9yVXNlcklkLCBcImFjdG9yVXNlcklkXCIpLFxuICAgIGNsaWVudE11dGF0aW9uSWQ6IHJlcXVpcmVkU3RyaW5nKG11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsIFwiY2xpZW50TXV0YXRpb25JZFwiKSxcbiAgICBtb2RlbDogcmVxdWlyZWRTdHJpbmcobXV0YXRpb24ubW9kZWwsIFwibW9kZWxcIiksXG4gICAgb2NjdXJyZWRBdDogcmVxdWlyZWRJc29UaW1lc3RhbXAobXV0YXRpb24ub2NjdXJyZWRBdCwgXCJvY2N1cnJlZEF0XCIpLFxuICAgIG9mZmxpbmVHcmFudElkOiByZXF1aXJlZFN0cmluZyhtdXRhdGlvbi5vZmZsaW5lR3JhbnRJZCwgXCJvZmZsaW5lR3JhbnRJZFwiKSxcbiAgICBvcGVyYXRpb246IHJlcXVpcmVkU3RyaW5nKG11dGF0aW9uLm9wZXJhdGlvbiwgXCJvcGVyYXRpb25cIiksXG4gICAgcG9saWN5SGFzaDogcmVxdWlyZWRTdHJpbmcobXV0YXRpb24ucG9saWN5SGFzaCwgXCJwb2xpY3lIYXNoXCIpXG4gIH0pXG5cbiAgaWYgKG11dGF0aW9uLmF0dHJpYnV0ZXMgIT09IHVuZGVmaW5lZCkgbm9ybWFsaXplZC5hdHRyaWJ1dGVzID0gY2xvbmVKc29uT2JqZWN0KG11dGF0aW9uLmF0dHJpYnV0ZXMsIFwiYXR0cmlidXRlc1wiKVxuICBpZiAobXV0YXRpb24uYmFzZVZlcnNpb24gIT09IHVuZGVmaW5lZCkgbm9ybWFsaXplZC5iYXNlVmVyc2lvbiA9IGNsb25lQmFzZVZlcnNpb24obXV0YXRpb24uYmFzZVZlcnNpb24pXG4gIGlmIChtdXRhdGlvbi5jb21tYW5kICE9PSB1bmRlZmluZWQpIG5vcm1hbGl6ZWQuY29tbWFuZCA9IHJlcXVpcmVkU3RyaW5nKG11dGF0aW9uLmNvbW1hbmQsIFwiY29tbWFuZFwiKVxuICBpZiAobXV0YXRpb24ucGF5bG9hZCAhPT0gdW5kZWZpbmVkKSBub3JtYWxpemVkLnBheWxvYWQgPSBjbG9uZUpzb25PYmplY3QobXV0YXRpb24ucGF5bG9hZCwgXCJwYXlsb2FkXCIpXG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRcbn1cblxuLyoqXG4gKiBSZXF1aXJlcyBhIG5vbi1lbXB0eSBzdHJpbmcgdmFsdWUuXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gUmF3IHZhbHVlLlxuICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gRmllbGQgbGFiZWwuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlcXVpcmVkIHN0cmluZy5cbiAqL1xuZnVuY3Rpb24gcmVxdWlyZWRTdHJpbmcodmFsdWUsIGxhYmVsKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgfHwgdmFsdWUubGVuZ3RoIDwgMSkgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBsb2NhbCBtdXRhdGlvbiAke2xhYmVsfWApXG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogUmVxdWlyZXMgYW4gSVNPIHRpbWVzdGFtcCBzdHJpbmcuXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gUmF3IHZhbHVlLlxuICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gRmllbGQgbGFiZWwuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIElTTyB0aW1lc3RhbXAuXG4gKi9cbmZ1bmN0aW9uIHJlcXVpcmVkSXNvVGltZXN0YW1wKHZhbHVlLCBsYWJlbCkge1xuICBjb25zdCBzdHJpbmdWYWx1ZSA9IHJlcXVpcmVkU3RyaW5nKHZhbHVlLCBsYWJlbClcbiAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKHN0cmluZ1ZhbHVlKVxuXG4gIGlmIChOdW1iZXIuaXNOYU4oZGF0ZS5nZXRUaW1lKCkpIHx8IGRhdGUudG9JU09TdHJpbmcoKSAhPT0gc3RyaW5nVmFsdWUpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbG9jYWwgbXV0YXRpb24gJHtsYWJlbH0gSVNPIHRpbWVzdGFtcGApXG5cbiAgcmV0dXJuIHN0cmluZ1ZhbHVlXG59XG5cbi8qKlxuICogUmVxdWlyZXMgYSBwb3NpdGl2ZSBpbnRlZ2VyIHZhbHVlLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFJhdyB2YWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCAtIEZpZWxkIGxhYmVsLlxuICogQHJldHVybnMge251bWJlcn0gLSBQb3NpdGl2ZSBpbnRlZ2VyLlxuICovXG5mdW5jdGlvbiByZXF1aXJlZFBvc2l0aXZlSW50ZWdlcih2YWx1ZSwgbGFiZWwpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPCAxKSB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGxvY2FsIG11dGF0aW9uICR7bGFiZWx9IHBvc2l0aXZlIGludGVnZXJgKVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIENsb25lcyBhIHN1cHBvcnRlZCBiYXNlLXZlcnNpb24gdmFsdWUuXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gUmF3IGJhc2UgdmVyc2lvbi5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSAtIE5vcm1hbGl6ZWQgYmFzZSB2ZXJzaW9uLlxuICovXG5mdW5jdGlvbiBjbG9uZUJhc2VWZXJzaW9uKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcblxuICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBsb2NhbCBtdXRhdGlvbiBiYXNlVmVyc2lvbiBzdHJpbmcsIG51bWJlciwgb3IgbnVsbFwiKVxufVxuXG4vKipcbiAqIENsb25lcyBhIEpTT04tY29tcGF0aWJsZSB2YWx1ZS5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBSYXcgSlNPTiB2YWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCAtIEZpZWxkIGxhYmVsLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWV9IC0gQ2xvbmVkIEpTT04gdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGNsb25lSnNvblZhbHVlKHZhbHVlLCBsYWJlbCkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBKU09OLWNvbXBhdGlibGUgbG9jYWwgbXV0YXRpb24gJHtsYWJlbH1gKVxuXG4gIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWV9ICovIChKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHZhbHVlKSkpXG59XG5cbi8qKlxuICogQ2xvbmVzIGEgSlNPTi1jb21wYXRpYmxlIG9iamVjdC5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBSYXcgSlNPTiBvYmplY3QuXG4gKiBAcGFyYW0ge3N0cmluZ30gbGFiZWwgLSBGaWVsZCBsYWJlbC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gLSBDbG9uZWQgSlNPTiBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIGNsb25lSnNvbk9iamVjdCh2YWx1ZSwgbGFiZWwpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbG9jYWwgbXV0YXRpb24gJHtsYWJlbH0gb2JqZWN0YClcblxuICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gKi8gKGNsb25lSnNvblZhbHVlKHZhbHVlLCBsYWJlbCkpXG59XG5cbi8qKlxuICogQ2xvbmVzIGEgbG9jYWwgbXV0YXRpb24gbG9nIHJlY29yZC5cbiAqIEBwYXJhbSB7TG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gcmVjb3JkIC0gUmVjb3JkIHRvIGNsb25lLlxuICogQHJldHVybnMge0xvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IC0gQ2xvbmVkIHJlY29yZC5cbiAqL1xuZnVuY3Rpb24gY2xvbmVSZWNvcmQocmVjb3JkKSB7XG4gIHJldHVybiAvKiogQHR5cGUge0xvY2FsTXV0YXRpb25Mb2dSZWNvcmR9ICovIChKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHJlY29yZCkpKVxufVxuXG4vKipcbiAqIEdlbmVyYXRlcyBhIHJhbmRvbSBsb2NhbCBtdXRhdGlvbiByZWNvcmQgaWQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJhbmRvbSByZWNvcmQgaWQuXG4gKi9cbmZ1bmN0aW9uIHJhbmRvbVJlY29yZElkKCkge1xuICBjb25zdCBjcnlwdG9Qcm92aWRlciA9IGdsb2JhbFRoaXMuY3J5cHRvXG5cbiAgaWYgKGNyeXB0b1Byb3ZpZGVyICYmIHR5cGVvZiBjcnlwdG9Qcm92aWRlci5yYW5kb21VVUlEID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiBjcnlwdG9Qcm92aWRlci5yYW5kb21VVUlEKClcblxuICByZXR1cm4gYGxvY2FsLW11dGF0aW9uLSR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX1gXG59XG4iXX0=