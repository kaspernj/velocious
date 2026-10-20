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
     * acknowledged predecessor supplies the authoritative base for its successor
     * and when an offline session re-signs a pending record under a refreshed
     * grant (pass the new `signedMutation` envelope together with the mutation).
     * @param {{id: string, mutation: import("./device-identity.js").SyncMutation, signedMutation?: import("./device-identity.js").SignedSyncMutation}} args - Record and replacement mutation.
     * @returns {Promise<LocalMutationLogRecord>} Updated record.
     */
    async updateMutation({ id, mutation, signedMutation }) {
        if (signedMutation !== undefined && stableJsonStringify(signedMutation.mutation) !== stableJsonStringify(mutation)) {
            throw new Error("signedMutation must match the mutation payload it signs");
        }
        return await withStorageKeyLock(this.storageKey, async () => {
            const rawRecord = await this.storage.record(this.storageKey, id);
            if (!rawRecord)
                throw new Error(`No local mutation log record '${id}'`);
            const record = normalizeRecord(rawRecord);
            if (!PENDING_STATUSES.has(record.status))
                throw new Error(`Cannot update mutation for ${record.status} local mutation '${id}'`);
            record.mutation = normalizeMutation(mutation);
            if (signedMutation !== undefined)
                record.signedMutation = /** @type {import("./device-identity.js").SignedSyncMutation} */ (JSON.parse(JSON.stringify(signedMutation)));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jYWwtbXV0YXRpb24tbG9nLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvbG9jYWwtbXV0YXRpb24tbG9nLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7O0dBSUc7QUFDSDs7Ozs7Ozs7Ozs7OztHQWFHO0FBQ0g7Ozs7O0dBS0c7QUFDSDs7O0tBR0s7QUFDTDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCxZQUFZO0FBRVosT0FBTyxFQUFDLHNDQUFzQyxFQUFFLG9DQUFvQyxFQUFDLE1BQU0sK0NBQStDLENBQUE7QUFDMUksT0FBTyxtQkFBbUIsTUFBTSxrQkFBa0IsQ0FBQTtBQUVsRCxNQUFNLG1CQUFtQixHQUFHLGlDQUFpQyxDQUFBO0FBQzdELE1BQU0scUJBQXFCLEdBQUcsb0NBQW9DLENBQUMsQ0FBQyxDQUFDLFNBQVMsRUFBRSxpQkFBaUIsRUFBRSxjQUFjLENBQUMsQ0FBQyxDQUFBO0FBQ25ILE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxHQUFHLENBQUMscUJBQXFCLENBQUMsQ0FBQTtBQUN2RCxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxnQkFBZ0IsRUFBRSxVQUFVLEVBQUUsVUFBVSxFQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUE7QUFDMUYsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQyxDQUFBO0FBQ3pELDRDQUE0QztBQUM1QyxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFFbkMsbUZBQW1GO0FBQ25GLE1BQU0sQ0FBQyxPQUFPLE9BQU8sZ0JBQWdCO0lBQ25DOzs7Ozs7O09BT0c7SUFDSCxZQUFZLEVBQUMsV0FBVyxHQUFHLGNBQWMsRUFBRSxHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUMsSUFBSSxJQUFJLEVBQUUsRUFBRSxPQUFPLEVBQUUsVUFBVSxHQUFHLG1CQUFtQixFQUFD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LENBQUMsQ0FBQyxDQUFDLENBQUE7QUFDbkYsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQVMsY0FBYztJQUNyQixNQUFNLGNBQWMsR0FBRyxVQUFVLENBQUMsTUFBTSxDQUFBO0lBRXhDLElBQUksY0FBYyxJQUFJLE9BQU8sY0FBYyxDQUFDLFVBQVUsS0FBSyxVQUFVO1FBQUUsT0FBTyxjQUFjLENBQUMsVUFBVSxFQUFFLENBQUE7SUFFekcsT0FBTyxrQkFBa0IsSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7QUFDOUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTG9jYWwgbXV0YXRpb24gbG9nIHJlY29yZCBxdWVyeSBvcHRpb25zLlxuICogQHR5cGVkZWYge29iamVjdH0gTG9jYWxNdXRhdGlvbkxvZ1JlY29yZHNPcHRpb25zXG4gKiBAcHJvcGVydHkge0xvY2FsTXV0YXRpb25TdGF0dXNbXX0gW3N0YXR1c2VzXSAtIE9wdGlvbmFsIHN0YXR1cyBmaWx0ZXIuXG4gKi9cbi8qKlxuICogTG9jYWwgbXV0YXRpb24gbG9nIHJvdy1vcmllbnRlZCBzdG9yYWdlIGFkYXB0ZXIuXG4gKlxuICogSW1wbGVtZW50YXRpb25zIHNob3VsZCBzdG9yZSBlYWNoIG11dGF0aW9uIGxvZyByZWNvcmQgYXMgaXRzIG93biByb3cvZW50cnkuXG4gKiBOYXRpdmUgYXBwcyBzaG91bGQgYmFjayB0aGlzIHdpdGggU1FMaXRlIGFuZCBpbmRleGVzIG9uIHN0b3JhZ2Uga2V5LCBzdGF0dXMsXG4gKiBhbmQgc2VxdWVuY2UuIEF2b2lkIHN0b3JpbmcgdGhlIHdob2xlIGxvZyBhcyBvbmUgSlNPTiBibG9iLlxuICogQHR5cGVkZWYge29iamVjdH0gTG9jYWxNdXRhdGlvbkxvZ1N0b3JhZ2VcbiAqIEBwcm9wZXJ0eSB7KHN0b3JhZ2VLZXk6IHN0cmluZywgcmVjb3JkOiBMb2NhbE11dGF0aW9uTG9nUmVjb3JkKSA9PiBQcm9taXNlPHZvaWQ+IHwgdm9pZH0gYXBwZW5kUmVjb3JkIC0gQXBwZW5kcyBvbmUgbG9nIHJlY29yZC5cbiAqIEBwcm9wZXJ0eSB7KHN0b3JhZ2VLZXk6IHN0cmluZywgaWRzOiBzdHJpbmdbXSkgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWR9IGRlbGV0ZVJlY29yZHMgLSBEZWxldGVzIGxvZyByZWNvcmRzIGJ5IGlkLlxuICogQHByb3BlcnR5IHsoc3RvcmFnZUtleTogc3RyaW5nKSA9PiBQcm9taXNlPG51bWJlcj4gfCBudW1iZXJ9IG5leHRTZXF1ZW5jZSAtIFJldHVybnMgdGhlIG5leHQgbG9jYWwgc2VxdWVuY2UgbnVtYmVyLlxuICogQHByb3BlcnR5IHsoc3RvcmFnZUtleTogc3RyaW5nLCBpZDogc3RyaW5nKSA9PiBQcm9taXNlPExvY2FsTXV0YXRpb25Mb2dSZWNvcmQgfCBudWxsIHwgdW5kZWZpbmVkPiB8IExvY2FsTXV0YXRpb25Mb2dSZWNvcmQgfCBudWxsIHwgdW5kZWZpbmVkfSByZWNvcmQgLSBSZWFkcyBvbmUgbG9nIHJlY29yZCBieSBpZC5cbiAqIEBwcm9wZXJ0eSB7KHN0b3JhZ2VLZXk6IHN0cmluZywgb3B0aW9ucz86IExvY2FsTXV0YXRpb25Mb2dSZWNvcmRzT3B0aW9ucykgPT4gUHJvbWlzZTxMb2NhbE11dGF0aW9uTG9nUmVjb3JkW10+IHwgTG9jYWxNdXRhdGlvbkxvZ1JlY29yZFtdfSByZWNvcmRzIC0gUmVhZHMgbG9nIHJlY29yZHMuXG4gKiBAcHJvcGVydHkgeyhzdG9yYWdlS2V5OiBzdHJpbmcsIHJlY29yZDogTG9jYWxNdXRhdGlvbkxvZ1JlY29yZCkgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWR9IHVwZGF0ZVJlY29yZCAtIFJlcGxhY2VzIG9uZSBsb2cgcmVjb3JkLlxuICovXG4vKipcbiAqIExvY2FsIHN5bmMgbXV0YXRpb24gZGVwZW5kZW5jeSBtZXRhZGF0YS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IExvY2FsTXV0YXRpb25EZXBlbmRlbmN5XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY2xpZW50TXV0YXRpb25JZCAtIENsaWVudCBtdXRhdGlvbiBpZCB0aGlzIG11dGF0aW9uIGRlcGVuZHMgb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbW9kZWwgLSBEZXBlbmRlbnQgbW9kZWwvcmVzb3VyY2UgbmFtZS5cbiAqL1xuLyoqXG4gKiBMb2NhbCBtdXRhdGlvbiBsb2cgc3RhdHVzLlxuICogQHR5cGVkZWYge1wicGVuZGluZ1wiIHwgXCJhcHBsaWVkLWxvY2FsbHlcIiB8IFwicGVlci1hcHBsaWVkXCIgfCBcImNvbmZsaWN0XCIgfCBcInJlamVjdGVkXCIgfCBcInN5bmNlZFwifSBMb2NhbE11dGF0aW9uU3RhdHVzXG4gKiAqL1xuLyoqXG4gKiBMb2NhbCBtdXRhdGlvbiBsb2cgcmVjb3JkLlxuICogQHR5cGVkZWYge29iamVjdH0gTG9jYWxNdXRhdGlvbkxvZ1JlY29yZFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNyZWF0ZWRBdCAtIElTTyB0aW1lc3RhbXAgd2hlbiB0aGUgcmVjb3JkIHdhcyBjcmVhdGVkIGxvY2FsbHkuXG4gKiBAcHJvcGVydHkge0xvY2FsTXV0YXRpb25EZXBlbmRlbmN5W119IGRlcGVuZGVuY2llcyAtIE90aGVyIGxvY2FsIG11dGF0aW9ucyB0aGF0IG11c3QgcmVwbGF5IGZpcnN0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGlkIC0gTG9jYWwgbG9nIHJlY29yZCBpZC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBtdXRhdGlvbiAtIERldmljZSBtdXRhdGlvbiBwYXlsb2FkLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259IFtzaWduZWRNdXRhdGlvbl0gLSBPcmlnaW5hbCBzaWduZWQgbXV0YXRpb24gZW52ZWxvcGUsIHJldGFpbmVkIGZvciBwZWVyLWZvcndhcmRlZCBtdXRhdGlvbnMuXG4gKiBAcHJvcGVydHkge251bWJlcn0gc2VxdWVuY2UgLSBNb25vdG9uaWMgbG9jYWwgc2VxdWVuY2UuXG4gKiBAcHJvcGVydHkge0xvY2FsTXV0YXRpb25TdGF0dXN9IHN0YXR1cyAtIExvY2FsIHJlcGxheS9hcHBseSBzdGF0dXMuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZT59IFtzeW5jUmVzdWx0XSAtIEJhY2tlbmQgcmVwbGF5L3Jlc3VsdCBtZXRhZGF0YS4gU3RvcmVkIGFzIHRyYW5zcG9ydCBtYXJrZXJzIHNvIERhdGUgKGFuZCBvdGhlciB0eXBlZCkgdmFsdWVzIHN1cnZpdmUgdGhlIGR1cmFibGUgSlNPTiByb3VuZCB0cmlwIGFuZCBhcmUgcmVzdG9yZWQgb24gcmVhZGJhY2suXG4gKiBAcHJvcGVydHkge3N0cmluZ30gdXBkYXRlZEF0IC0gSVNPIHRpbWVzdGFtcCB3aGVuIHRoZSByZWNvcmQgd2FzIGxhc3QgY2hhbmdlZC5cbiAqL1xuLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7ZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUsIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4uL2Zyb250ZW5kLW1vZGVscy90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiXG5pbXBvcnQgc3RhYmxlSnNvblN0cmluZ2lmeSBmcm9tIFwiLi9zdGFibGUtanNvbi5qc1wiXG5cbmNvbnN0IERFRkFVTFRfU1RPUkFHRV9LRVkgPSBcInZlbG9jaW91cy5zeW5jLmxvY2FsTXV0YXRpb25Mb2dcIlxuY29uc3QgUEVORElOR19TVEFUVVNfVkFMVUVTID0gLyoqIEB0eXBlIHtMb2NhbE11dGF0aW9uU3RhdHVzW119ICovIChbXCJwZW5kaW5nXCIsIFwiYXBwbGllZC1sb2NhbGx5XCIsIFwicGVlci1hcHBsaWVkXCJdKVxuY29uc3QgUEVORElOR19TVEFUVVNFUyA9IG5ldyBTZXQoUEVORElOR19TVEFUVVNfVkFMVUVTKVxuY29uc3QgTVVUQVRJT05fU1RBVFVTRVMgPSBuZXcgU2V0KFsuLi5QRU5ESU5HX1NUQVRVU0VTLCBcImNvbmZsaWN0XCIsIFwicmVqZWN0ZWRcIiwgXCJzeW5jZWRcIl0pXG5jb25zdCBURVJNSU5BTF9TVEFUVVNFUyA9IG5ldyBTZXQoW1wicmVqZWN0ZWRcIiwgXCJzeW5jZWRcIl0pXG4vKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8dW5rbm93bj4+fSAqL1xuY29uc3QgU1RPUkFHRV9LRVlfTE9DS1MgPSBuZXcgTWFwKClcblxuLyoqIENsaWVudC1zaWRlIGFwcGVuZC1vbmx5IHN5bmMgbXV0YXRpb24gbG9nIHdpdGggcGx1Z2dhYmxlIHBlcnNpc3RlbnQgc3RvcmFnZS4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIExvY2FsTXV0YXRpb25Mb2cge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIGxvY2FsIG11dGF0aW9uIGxvZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7KCkgPT4gc3RyaW5nfSBbYXJncy5pZEdlbmVyYXRvcl0gLSBSZWNvcmQgaWQgZ2VuZXJhdG9yLlxuICAgKiBAcGFyYW0geygpID0+IERhdGV9IFthcmdzLm5vd10gLSBDbG9jayBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtMb2NhbE11dGF0aW9uTG9nU3RvcmFnZX0gYXJncy5zdG9yYWdlIC0gUGVyc2lzdGVudCBzdG9yYWdlIGFkYXB0ZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zdG9yYWdlS2V5XSAtIFN0b3JhZ2Uga2V5LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2lkR2VuZXJhdG9yID0gcmFuZG9tUmVjb3JkSWQsIG5vdyA9ICgpID0+IG5ldyBEYXRlKCksIHN0b3JhZ2UsIHN0b3JhZ2VLZXkgPSBERUZBVUxUX1NUT1JBR0VfS0VZfSkge1xuICAgIGlmICghdmFsaWRTdG9yYWdlKHN0b3JhZ2UpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJMb2NhbE11dGF0aW9uTG9nIHJlcXVpcmVzIHJvdyBzdG9yYWdlIHdpdGggYXBwZW5kUmVjb3JkL2RlbGV0ZVJlY29yZHMvbmV4dFNlcXVlbmNlL3JlY29yZC9yZWNvcmRzL3VwZGF0ZVJlY29yZFwiKVxuICAgIH1cblxuICAgIHRoaXMuaWRHZW5lcmF0b3IgPSBpZEdlbmVyYXRvclxuICAgIHRoaXMubm93ID0gbm93XG4gICAgdGhpcy5zdG9yYWdlID0gc3RvcmFnZVxuICAgIHRoaXMuc3RvcmFnZUtleSA9IHN0b3JhZ2VLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgbG9nIHZpZXcgd2l0aCBzZXF1ZW5jZSwgcmVjb3JkcywgYW5kIGxvY2tzIHBhcnRpdGlvbmVkIGJ5IGFuXG4gICAqIGltbXV0YWJsZSBwaHlzaWNhbCB0ZW5hbnQgaWRlbnRpdHkgd2hpbGUgcmV1c2luZyB0aGUgc2FtZSByb3cgc3RvcmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwYXJ0aXRpb25LZXkgLSBTdGFibGUgb3BhcXVlIHBhcnRpdGlvbiBpZGVudGl0eS5cbiAgICogQHJldHVybnMge0xvY2FsTXV0YXRpb25Mb2d9IFBhcnRpdGlvbmVkIGxvZy5cbiAgICovXG4gIHBhcnRpdGlvbihwYXJ0aXRpb25LZXkpIHtcbiAgICBpZiAoIXBhcnRpdGlvbktleSkgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWxNdXRhdGlvbkxvZyBwYXJ0aXRpb24ga2V5IG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nXCIpXG5cbiAgICByZXR1cm4gbmV3IExvY2FsTXV0YXRpb25Mb2coe1xuICAgICAgaWRHZW5lcmF0b3I6IHRoaXMuaWRHZW5lcmF0b3IsXG4gICAgICBub3c6IHRoaXMubm93LFxuICAgICAgc3RvcmFnZTogdGhpcy5zdG9yYWdlLFxuICAgICAgc3RvcmFnZUtleTogYCR7dGhpcy5zdG9yYWdlS2V5fToke3BhcnRpdGlvbktleS5sZW5ndGh9OiR7cGFydGl0aW9uS2V5fWBcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGVuZHMgYSBwZW5kaW5nIG11dGF0aW9uIHJlY29yZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7TG9jYWxNdXRhdGlvbkRlcGVuZGVuY3lbXX0gW2FyZ3MuZGVwZW5kZW5jaWVzXSAtIE11dGF0aW9uIGRlcGVuZGVuY2llcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBNdXRhdGlvbiBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlNpZ25lZFN5bmNNdXRhdGlvbn0gW2FyZ3Muc2lnbmVkTXV0YXRpb25dIC0gT3JpZ2luYWwgc2lnbmVkIG11dGF0aW9uIGVudmVsb3BlLCByZXRhaW5lZCBmb3IgcGVlci1mb3J3YXJkZWQgbXV0YXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxMb2NhbE11dGF0aW9uTG9nUmVjb3JkPn0gLSBDcmVhdGVkIGxvZyByZWNvcmQuXG4gICAqL1xuICBhc3luYyBhcHBlbmQoe2RlcGVuZGVuY2llcyA9IFtdLCBtdXRhdGlvbiwgc2lnbmVkTXV0YXRpb259KSB7XG4gICAgaWYgKHNpZ25lZE11dGF0aW9uICE9PSB1bmRlZmluZWQgJiYgc3RhYmxlSnNvblN0cmluZ2lmeShzaWduZWRNdXRhdGlvbi5tdXRhdGlvbikgIT09IHN0YWJsZUpzb25TdHJpbmdpZnkobXV0YXRpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTaWduZWQgbXV0YXRpb24gcGF5bG9hZCBkb2VzIG5vdCBtYXRjaCB0aGUgbXV0YXRpb25cIilcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgd2l0aFN0b3JhZ2VLZXlMb2NrKHRoaXMuc3RvcmFnZUtleSwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgdGltZXN0YW1wID0gdGhpcy5jdXJyZW50VGltZXN0YW1wKClcbiAgICAgIGNvbnN0IHJlY29yZCA9IG5vcm1hbGl6ZVJlY29yZCh7XG4gICAgICAgIGNyZWF0ZWRBdDogdGltZXN0YW1wLFxuICAgICAgICBkZXBlbmRlbmNpZXMsXG4gICAgICAgIGlkOiB0aGlzLmlkR2VuZXJhdG9yKCksXG4gICAgICAgIG11dGF0aW9uLFxuICAgICAgICBzZXF1ZW5jZTogYXdhaXQgdGhpcy5zdG9yYWdlLm5leHRTZXF1ZW5jZSh0aGlzLnN0b3JhZ2VLZXkpLFxuICAgICAgICBzaWduZWRNdXRhdGlvbixcbiAgICAgICAgc3RhdHVzOiBcInBlbmRpbmdcIixcbiAgICAgICAgdXBkYXRlZEF0OiB0aW1lc3RhbXBcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IHRoaXMuc3RvcmFnZS5hcHBlbmRSZWNvcmQodGhpcy5zdG9yYWdlS2V5LCBjbG9uZVJlY29yZChyZWNvcmQpKVxuXG4gICAgICByZXR1cm4gY2xvbmVSZWNvcmQocmVjb3JkKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhbGwgcmVjb3JkcyBvcmRlcmVkIGJ5IGxvY2FsIHNlcXVlbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxMb2NhbE11dGF0aW9uTG9nUmVjb3JkW10+fSAtIExvZyByZWNvcmRzLlxuICAgKi9cbiAgYXN5bmMgcmVjb3JkcygpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplUmVjb3JkTGlzdChhd2FpdCB0aGlzLnN0b3JhZ2UucmVjb3Jkcyh0aGlzLnN0b3JhZ2VLZXkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgcmVjb3JkcyB0aGF0IHN0aWxsIG5lZWQgbG9jYWwvc2VydmVyIHJlY29uY2lsaWF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxMb2NhbE11dGF0aW9uTG9nUmVjb3JkW10+fSAtIFBlbmRpbmcgcmVjb3Jkcy5cbiAgICovXG4gIGFzeW5jIHBlbmRpbmdSZWNvcmRzKCkge1xuICAgIHJldHVybiBub3JtYWxpemVSZWNvcmRMaXN0KGF3YWl0IHRoaXMuc3RvcmFnZS5yZWNvcmRzKHRoaXMuc3RvcmFnZUtleSwge3N0YXR1c2VzOiBQRU5ESU5HX1NUQVRVU19WQUxVRVN9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGVzIGEgcmVjb3JkIHN0YXR1cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmlkIC0gUmVjb3JkIGlkLlxuICAgKiBAcGFyYW0ge0xvY2FsTXV0YXRpb25TdGF0dXN9IGFyZ3Muc3RhdHVzIC0gTmV3IHN0YXR1cy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSBbYXJncy5zeW5jUmVzdWx0XSAtIFJlc3VsdCBtZXRhZGF0YSAobWF5IGNhcnJ5IHRyYW5zcG9ydC1yZXN0b3JlZCB0eXBlZCB2YWx1ZXMpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxMb2NhbE11dGF0aW9uTG9nUmVjb3JkPn0gLSBVcGRhdGVkIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIHVwZGF0ZVN0YXR1cyh7aWQsIHN0YXR1cywgc3luY1Jlc3VsdH0pIHtcbiAgICBpZiAoIU1VVEFUSU9OX1NUQVRVU0VTLmhhcyhzdGF0dXMpKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gbG9jYWwgbXV0YXRpb24gc3RhdHVzICcke3N0YXR1c30nYClcblxuICAgIHJldHVybiBhd2FpdCB3aXRoU3RvcmFnZUtleUxvY2sodGhpcy5zdG9yYWdlS2V5LCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByYXdSZWNvcmQgPSBhd2FpdCB0aGlzLnN0b3JhZ2UucmVjb3JkKHRoaXMuc3RvcmFnZUtleSwgaWQpXG5cbiAgICAgIGlmICghcmF3UmVjb3JkKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGxvY2FsIG11dGF0aW9uIGxvZyByZWNvcmQgJyR7aWR9J2ApXG5cbiAgICAgIGNvbnN0IHJlY29yZCA9IG5vcm1hbGl6ZVJlY29yZChyYXdSZWNvcmQpXG5cbiAgICAgIHJlY29yZC5zdGF0dXMgPSAvKiogQHR5cGUge0xvY2FsTXV0YXRpb25TdGF0dXN9ICovIChzdGF0dXMpXG4gICAgICBpZiAoc3luY1Jlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIC8vIEVuY29kZSB0cmFuc3BvcnQtcmVzdG9yZWQgdHlwZWQgdmFsdWVzIChlLmcuIERhdGUgYXR0cmlidXRlcyBpbiBhXG4gICAgICAgIC8vIGNvbmZsaWN0IHNlcnZlck1vZGVsKSBhcyBtYXJrZXJzIGJlZm9yZSB0aGUgSlNPTiBjbG9uZSBzbyB0aGVcbiAgICAgICAgLy8gZHVyYWJsZSBwZXJzaXN0ZW5jZSByb3VuZCB0cmlwIGNhbm5vdCBzdHJpbmdpZnkgdGhlbS5cbiAgICAgICAgcmVjb3JkLnN5bmNSZXN1bHQgPSBjbG9uZUpzb25PYmplY3Qoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHN5bmNSZXN1bHQpLCBcInN5bmNSZXN1bHRcIilcbiAgICAgIH1cbiAgICAgIHJlY29yZC51cGRhdGVkQXQgPSB0aGlzLmN1cnJlbnRUaW1lc3RhbXAoKVxuICAgICAgYXdhaXQgdGhpcy5zdG9yYWdlLnVwZGF0ZVJlY29yZCh0aGlzLnN0b3JhZ2VLZXksIGNsb25lUmVjb3JkKHJlY29yZCkpXG5cbiAgICAgIHJldHVybiByZXN0b3JlU3luY1Jlc3VsdFR5cGVzKGNsb25lUmVjb3JkKHJlY29yZCkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYWNlcyB0aGUgbXV0YXRpb24gcGF5bG9hZCBvZiBhIHN0aWxsLXBlbmRpbmcgcmVjb3JkLiBVc2VkIHdoZW4gYW5cbiAgICogYWNrbm93bGVkZ2VkIHByZWRlY2Vzc29yIHN1cHBsaWVzIHRoZSBhdXRob3JpdGF0aXZlIGJhc2UgZm9yIGl0cyBzdWNjZXNzb3JcbiAgICogYW5kIHdoZW4gYW4gb2ZmbGluZSBzZXNzaW9uIHJlLXNpZ25zIGEgcGVuZGluZyByZWNvcmQgdW5kZXIgYSByZWZyZXNoZWRcbiAgICogZ3JhbnQgKHBhc3MgdGhlIG5ldyBgc2lnbmVkTXV0YXRpb25gIGVudmVsb3BlIHRvZ2V0aGVyIHdpdGggdGhlIG11dGF0aW9uKS5cbiAgICogQHBhcmFtIHt7aWQ6IHN0cmluZywgbXV0YXRpb246IGltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbiwgc2lnbmVkTXV0YXRpb24/OiBpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259fSBhcmdzIC0gUmVjb3JkIGFuZCByZXBsYWNlbWVudCBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8TG9jYWxNdXRhdGlvbkxvZ1JlY29yZD59IFVwZGF0ZWQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgdXBkYXRlTXV0YXRpb24oe2lkLCBtdXRhdGlvbiwgc2lnbmVkTXV0YXRpb259KSB7XG4gICAgaWYgKHNpZ25lZE11dGF0aW9uICE9PSB1bmRlZmluZWQgJiYgc3RhYmxlSnNvblN0cmluZ2lmeShzaWduZWRNdXRhdGlvbi5tdXRhdGlvbikgIT09IHN0YWJsZUpzb25TdHJpbmdpZnkobXV0YXRpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJzaWduZWRNdXRhdGlvbiBtdXN0IG1hdGNoIHRoZSBtdXRhdGlvbiBwYXlsb2FkIGl0IHNpZ25zXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHdpdGhTdG9yYWdlS2V5TG9jayh0aGlzLnN0b3JhZ2VLZXksIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJhd1JlY29yZCA9IGF3YWl0IHRoaXMuc3RvcmFnZS5yZWNvcmQodGhpcy5zdG9yYWdlS2V5LCBpZClcblxuICAgICAgaWYgKCFyYXdSZWNvcmQpIHRocm93IG5ldyBFcnJvcihgTm8gbG9jYWwgbXV0YXRpb24gbG9nIHJlY29yZCAnJHtpZH0nYClcblxuICAgICAgY29uc3QgcmVjb3JkID0gbm9ybWFsaXplUmVjb3JkKHJhd1JlY29yZClcblxuICAgICAgaWYgKCFQRU5ESU5HX1NUQVRVU0VTLmhhcyhyZWNvcmQuc3RhdHVzKSkgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgdXBkYXRlIG11dGF0aW9uIGZvciAke3JlY29yZC5zdGF0dXN9IGxvY2FsIG11dGF0aW9uICcke2lkfSdgKVxuXG4gICAgICByZWNvcmQubXV0YXRpb24gPSBub3JtYWxpemVNdXRhdGlvbihtdXRhdGlvbilcbiAgICAgIGlmIChzaWduZWRNdXRhdGlvbiAhPT0gdW5kZWZpbmVkKSByZWNvcmQuc2lnbmVkTXV0YXRpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlNpZ25lZFN5bmNNdXRhdGlvbn0gKi8gKEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoc2lnbmVkTXV0YXRpb24pKSlcbiAgICAgIHJlY29yZC51cGRhdGVkQXQgPSB0aGlzLmN1cnJlbnRUaW1lc3RhbXAoKVxuICAgICAgYXdhaXQgdGhpcy5zdG9yYWdlLnVwZGF0ZVJlY29yZCh0aGlzLnN0b3JhZ2VLZXksIGNsb25lUmVjb3JkKHJlY29yZCkpXG5cbiAgICAgIHJldHVybiByZXN0b3JlU3luY1Jlc3VsdFR5cGVzKGNsb25lUmVjb3JkKHJlY29yZCkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIGR1cmFibGUgY29uZmxpY3QgZXhwbGljaXRseS4gS2VlcGluZyB0aGUgc2VydmVyIGFja25vd2xlZGdlcyB0aGVcbiAgICogcHJlc2VydmVkIGxvY2FsIGludGVudCB3aXRob3V0IHJlcGxheWluZyBpdDsgcmV0cnlpbmcgbG9jYWwgaW50ZW50IHJlYmFzZXNcbiAgICogaXQgb250byB0aGUgY29uZmxpY3QncyBhdXRob3JpdGF0aXZlIHNlcnZlclZlcnNpb24gYW5kIHJldHVybnMgaXQgdG8gdGhlXG4gICAqIHBlbmRpbmcgcXVldWUuIFRoZSBwcmlvciBjb25mbGljdCByZXN1bHQgc3RheXMgYXR0YWNoZWQgYXMgYXVkaXQgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7e2lkOiBzdHJpbmcsIHJlc29sdXRpb246IFwia2VlcC1zZXJ2ZXJcIiB8IFwicmV0cnktbG9jYWxcIn19IGFyZ3MgLSBSZXNvbHV0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxMb2NhbE11dGF0aW9uTG9nUmVjb3JkPn0gUmVzb2x2ZWQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZUNvbmZsaWN0KHtpZCwgcmVzb2x1dGlvbn0pIHtcbiAgICBpZiAoIVtcImtlZXAtc2VydmVyXCIsIFwicmV0cnktbG9jYWxcIl0uaW5jbHVkZXMocmVzb2x1dGlvbikpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBsb2NhbCBtdXRhdGlvbiBjb25mbGljdCByZXNvbHV0aW9uICcke3Jlc29sdXRpb259J2ApXG5cbiAgICByZXR1cm4gYXdhaXQgd2l0aFN0b3JhZ2VLZXlMb2NrKHRoaXMuc3RvcmFnZUtleSwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmF3UmVjb3JkID0gYXdhaXQgdGhpcy5zdG9yYWdlLnJlY29yZCh0aGlzLnN0b3JhZ2VLZXksIGlkKVxuXG4gICAgICBpZiAoIXJhd1JlY29yZCkgdGhyb3cgbmV3IEVycm9yKGBObyBsb2NhbCBtdXRhdGlvbiBsb2cgcmVjb3JkICcke2lkfSdgKVxuXG4gICAgICBjb25zdCByZWNvcmQgPSBub3JtYWxpemVSZWNvcmQocmF3UmVjb3JkKVxuXG4gICAgICBpZiAocmVjb3JkLnN0YXR1cyAhPT0gXCJjb25mbGljdFwiKSB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCByZXNvbHZlICR7cmVjb3JkLnN0YXR1c30gbG9jYWwgbXV0YXRpb24gJyR7aWR9JyBhcyBhIGNvbmZsaWN0YClcblxuICAgICAgaWYgKHJlc29sdXRpb24gPT09IFwia2VlcC1zZXJ2ZXJcIikge1xuICAgICAgICByZWNvcmQuc3RhdHVzID0gXCJzeW5jZWRcIlxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3Qgc2VydmVyVmVyc2lvbiA9IGNvbmZsaWN0U2VydmVyVmVyc2lvbihyZWNvcmQpXG5cbiAgICAgICAgcmVjb3JkLm11dGF0aW9uID0gey4uLnJlY29yZC5tdXRhdGlvbiwgYmFzZVZlcnNpb246IHNlcnZlclZlcnNpb259XG4gICAgICAgIHJlY29yZC5zdGF0dXMgPSBcInBlbmRpbmdcIlxuICAgICAgfVxuXG4gICAgICByZWNvcmQudXBkYXRlZEF0ID0gdGhpcy5jdXJyZW50VGltZXN0YW1wKClcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmFnZS51cGRhdGVSZWNvcmQodGhpcy5zdG9yYWdlS2V5LCBjbG9uZVJlY29yZChyZWNvcmQpKVxuXG4gICAgICByZXR1cm4gcmVzdG9yZVN5bmNSZXN1bHRUeXBlcyhjbG9uZVJlY29yZChyZWNvcmQpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUHJ1bmVzIHRlcm1pbmFsIHJlY29yZHMgdGhhdCBhcmUgbm8gbG9uZ2VyIG5lZWRlZCBmb3IgcmVwbGF5IGRlcGVuZGVuY2llcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIENvbXBhY3Rpb24gb3B0aW9ucy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLm1heFRlcm1pbmFsUmVjb3Jkc10gLSBNYXhpbXVtIHRlcm1pbmFsIHJlY29yZHMgdG8gcmV0YWluLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MudGVybWluYWxSZXRlbnRpb25Nc10gLSBNaW5pbXVtIGFnZSBiZWZvcmUgcHJ1bmluZyB0ZXJtaW5hbCByZWNvcmRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7ZGVsZXRlZFJlY29yZElkczogc3RyaW5nW119Pn0gLSBDb21wYWN0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNvbXBhY3Qoe21heFRlcm1pbmFsUmVjb3JkcywgdGVybWluYWxSZXRlbnRpb25Nc30gPSB7fSkge1xuICAgIHJldHVybiBhd2FpdCB3aXRoU3RvcmFnZUtleUxvY2sodGhpcy5zdG9yYWdlS2V5LCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmRzID0gYXdhaXQgdGhpcy5yZWNvcmRzKClcbiAgICAgIGNvbnN0IHByb3RlY3RlZENsaWVudE11dGF0aW9uSWRzID0gbmV3IFNldChcbiAgICAgICAgcmVjb3Jkc1xuICAgICAgICAgIC5maWx0ZXIoKHJlY29yZCkgPT4gUEVORElOR19TVEFUVVNFUy5oYXMocmVjb3JkLnN0YXR1cykgfHwgcmVjb3JkLnN0YXR1cyA9PT0gXCJjb25mbGljdFwiKVxuICAgICAgICAgIC5mbGF0TWFwKChyZWNvcmQpID0+IHJlY29yZC5kZXBlbmRlbmNpZXMubWFwKChkZXBlbmRlbmN5KSA9PiBkZXBlbmRlbmN5LmNsaWVudE11dGF0aW9uSWQpKVxuICAgICAgKVxuICAgICAgY29uc3QgdGVybWluYWxSZWNvcmRzID0gcmVjb3Jkc1xuICAgICAgICAuZmlsdGVyKChyZWNvcmQpID0+IFRFUk1JTkFMX1NUQVRVU0VTLmhhcyhyZWNvcmQuc3RhdHVzKSlcbiAgICAgICAgLmZpbHRlcigocmVjb3JkKSA9PiAhcHJvdGVjdGVkQ2xpZW50TXV0YXRpb25JZHMuaGFzKHJlY29yZC5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkKSlcbiAgICAgICAgLnNvcnQoY29tcGFyZVJlY29yZHNOZXdlc3RGaXJzdClcbiAgICAgIGNvbnN0IGRlbGV0ZUlkcyA9IG5ldyBTZXQoKVxuXG4gICAgICBpZiAodHlwZW9mIG1heFRlcm1pbmFsUmVjb3JkcyA9PT0gXCJudW1iZXJcIiAmJiBtYXhUZXJtaW5hbFJlY29yZHMgPj0gMCkge1xuICAgICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiB0ZXJtaW5hbFJlY29yZHMuc2xpY2UobWF4VGVybWluYWxSZWNvcmRzKSkgZGVsZXRlSWRzLmFkZChyZWNvcmQuaWQpXG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgdGVybWluYWxSZXRlbnRpb25NcyA9PT0gXCJudW1iZXJcIiAmJiB0ZXJtaW5hbFJldGVudGlvbk1zID49IDApIHtcbiAgICAgICAgY29uc3QgY3V0b2ZmID0gdGhpcy5ub3coKS5nZXRUaW1lKCkgLSB0ZXJtaW5hbFJldGVudGlvbk1zXG5cbiAgICAgICAgZm9yIChjb25zdCByZWNvcmQgb2YgdGVybWluYWxSZWNvcmRzKSB7XG4gICAgICAgICAgaWYgKG5ldyBEYXRlKHJlY29yZC51cGRhdGVkQXQpLmdldFRpbWUoKSA8IGN1dG9mZikgZGVsZXRlSWRzLmFkZChyZWNvcmQuaWQpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgZGVsZXRlZFJlY29yZElkcyA9IEFycmF5LmZyb20oZGVsZXRlSWRzKVxuXG4gICAgICBpZiAoZGVsZXRlZFJlY29yZElkcy5sZW5ndGggPiAwKSBhd2FpdCB0aGlzLnN0b3JhZ2UuZGVsZXRlUmVjb3Jkcyh0aGlzLnN0b3JhZ2VLZXksIGRlbGV0ZWRSZWNvcmRJZHMpXG5cbiAgICAgIHJldHVybiB7ZGVsZXRlZFJlY29yZElkc31cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGN1cnJlbnQgbG9nIHRpbWVzdGFtcC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBDdXJyZW50IElTTyB0aW1lc3RhbXAuXG4gICAqL1xuICBjdXJyZW50VGltZXN0YW1wKCkge1xuICAgIGNvbnN0IGRhdGUgPSB0aGlzLm5vdygpXG5cbiAgICBpZiAoIShkYXRlIGluc3RhbmNlb2YgRGF0ZSkgfHwgTnVtYmVyLmlzTmFOKGRhdGUuZ2V0VGltZSgpKSkgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWxNdXRhdGlvbkxvZyBub3coKSBtdXN0IHJldHVybiBhIHZhbGlkIERhdGVcIilcblxuICAgIHJldHVybiBkYXRlLnRvSVNPU3RyaW5nKClcbiAgfVxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGEgc3RvcmFnZSBhZGFwdGVyIGhhcyBhbGwgcmVxdWlyZWQgcm93LXN0b3JlIG1ldGhvZHMuXG4gKiBAcGFyYW0ge3Vua25vd259IHN0b3JhZ2UgLSBTdG9yYWdlIGFkYXB0ZXIgY2FuZGlkYXRlLlxuICogQHJldHVybnMge3N0b3JhZ2UgaXMgTG9jYWxNdXRhdGlvbkxvZ1N0b3JhZ2V9IC0gV2hldGhlciBzdG9yYWdlIGlzIHZhbGlkLlxuICovXG5mdW5jdGlvbiB2YWxpZFN0b3JhZ2Uoc3RvcmFnZSkge1xuICBpZiAoIXN0b3JhZ2UgfHwgdHlwZW9mIHN0b3JhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuXG4gIGNvbnN0IHN0b3JhZ2VPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoc3RvcmFnZSlcblxuICByZXR1cm4gdHlwZW9mIHN0b3JhZ2VPYmplY3QuYXBwZW5kUmVjb3JkID09PSBcImZ1bmN0aW9uXCJcbiAgICAmJiB0eXBlb2Ygc3RvcmFnZU9iamVjdC5kZWxldGVSZWNvcmRzID09PSBcImZ1bmN0aW9uXCJcbiAgICAmJiB0eXBlb2Ygc3RvcmFnZU9iamVjdC5uZXh0U2VxdWVuY2UgPT09IFwiZnVuY3Rpb25cIlxuICAgICYmIHR5cGVvZiBzdG9yYWdlT2JqZWN0LnJlY29yZCA9PT0gXCJmdW5jdGlvblwiXG4gICAgJiYgdHlwZW9mIHN0b3JhZ2VPYmplY3QucmVjb3JkcyA9PT0gXCJmdW5jdGlvblwiXG4gICAgJiYgdHlwZW9mIHN0b3JhZ2VPYmplY3QudXBkYXRlUmVjb3JkID09PSBcImZ1bmN0aW9uXCJcbn1cblxuLyoqXG4gKiBSZWFkcyB0aGUgYXV0aG9yaXRhdGl2ZSB2ZXJzaW9uIGZyb20gYSBjb25mbGljdGVkIG11dGF0aW9uLlxuICogQHBhcmFtIHtMb2NhbE11dGF0aW9uTG9nUmVjb3JkfSByZWNvcmQgLSBDb25mbGljdGVkIHJlY29yZC5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSAtIEF1dGhvcml0YXRpdmUgdmVyc2lvbi5cbiAqL1xuZnVuY3Rpb24gY29uZmxpY3RTZXJ2ZXJWZXJzaW9uKHJlY29yZCkge1xuICBjb25zdCBjb25mbGljdCA9IHJlY29yZC5zeW5jUmVzdWx0Py5jb25mbGljdFxuXG4gIGlmICghY29uZmxpY3QgfHwgY29uZmxpY3QgaW5zdGFuY2VvZiBEYXRlIHx8IHR5cGVvZiBjb25mbGljdCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNvbmZsaWN0KSB8fCAhT2JqZWN0Lmhhc093bihjb25mbGljdCwgXCJzZXJ2ZXJWZXJzaW9uXCIpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmV0cnkgbG9jYWwgbXV0YXRpb24gJyR7cmVjb3JkLmlkfScgd2l0aG91dCBhIGNvbmZsaWN0IHNlcnZlclZlcnNpb25gKVxuICB9XG5cbiAgY29uc3QgY29uZmxpY3RNZXRhZGF0YSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChjb25mbGljdClcblxuICByZXR1cm4gY2xvbmVCYXNlVmVyc2lvbihjb25mbGljdE1ldGFkYXRhLnNlcnZlclZlcnNpb24pXG59XG5cbi8qKlxuICogU29ydHMgcmVjb3JkcyBieSBuZXdlc3QgdXBkYXRlL3NlcXVlbmNlIGZpcnN0LlxuICogQHBhcmFtIHtMb2NhbE11dGF0aW9uTG9nUmVjb3JkfSBsZWZ0IC0gTGVmdCByZWNvcmQuXG4gKiBAcGFyYW0ge0xvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IHJpZ2h0IC0gUmlnaHQgcmVjb3JkLlxuICogQHJldHVybnMge251bWJlcn0gLSBTb3J0IHJlc3VsdC5cbiAqL1xuZnVuY3Rpb24gY29tcGFyZVJlY29yZHNOZXdlc3RGaXJzdChsZWZ0LCByaWdodCkge1xuICBjb25zdCB1cGRhdGVkQXRDb21wYXJpc29uID0gcmlnaHQudXBkYXRlZEF0LmxvY2FsZUNvbXBhcmUobGVmdC51cGRhdGVkQXQpXG5cbiAgaWYgKHVwZGF0ZWRBdENvbXBhcmlzb24gIT09IDApIHJldHVybiB1cGRhdGVkQXRDb21wYXJpc29uXG5cbiAgcmV0dXJuIHJpZ2h0LnNlcXVlbmNlIC0gbGVmdC5zZXF1ZW5jZVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYW5kIHNvcnRzIGEgbGlzdCBvZiByZWNvcmRzLlxuICogQHBhcmFtIHt1bmtub3dufSByZWNvcmRzIC0gUmF3IHJlY29yZHMuXG4gKiBAcmV0dXJucyB7TG9jYWxNdXRhdGlvbkxvZ1JlY29yZFtdfSAtIE5vcm1hbGl6ZWQgcmVjb3Jkcy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplUmVjb3JkTGlzdChyZWNvcmRzKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShyZWNvcmRzKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgbG9jYWwgbXV0YXRpb24gbG9nIHN0b3JhZ2UgcmVjb3JkcyBhcnJheVwiKVxuXG4gIHJldHVybiByZWNvcmRzXG4gICAgLm1hcChub3JtYWxpemVSZWNvcmQpXG4gICAgLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0LnNlcXVlbmNlIC0gcmlnaHQuc2VxdWVuY2UpXG4gICAgLm1hcCgocmVjb3JkKSA9PiBjbG9uZVJlY29yZChyZWNvcmQpKVxuICAgIC5tYXAocmVzdG9yZVN5bmNSZXN1bHRUeXBlcylcbn1cblxuLyoqXG4gKiBSZXN0b3JlcyB0cmFuc3BvcnQtcmVzdG9yZWQgdHlwZWQgdmFsdWVzIGluIGEgcmVjb3JkJ3Mgc3luY1Jlc3VsdCBhZnRlciB0aGVcbiAqIGZpbmFsIEpTT04gY2xvbmUsIHNvIGNhbGxlcnMgc2VlIERhdGUgKGFuZCBvdGhlciB0eXBlZCkgdmFsdWVzIG9uIGR1cmFibGVcbiAqIHJlYWRiYWNrIGluc3RlYWQgb2YgbWFya2VyLWVuY29kZWQgSVNPIHN0cmluZ3MuXG4gKiBAcGFyYW0ge0xvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IHJlY29yZCAtIENsb25lZCByZWNvcmQuXG4gKiBAcmV0dXJucyB7TG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gLSBSZWNvcmQgd2l0aCByZXN0b3JlZCBzeW5jUmVzdWx0IHR5cGVzLlxuICovXG5mdW5jdGlvbiByZXN0b3JlU3luY1Jlc3VsdFR5cGVzKHJlY29yZCkge1xuICBpZiAocmVjb3JkLnN5bmNSZXN1bHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHJlY29yZFxuXG4gIHJldHVybiB7XG4gICAgLi4ucmVjb3JkLFxuICAgIHN5bmNSZXN1bHQ6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gKi8gKFxuICAgICAgZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocmVjb3JkLnN5bmNSZXN1bHQpXG4gICAgKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBhIGNhbGxiYWNrIGFmdGVyIGVhcmxpZXIgd3JpdGVzIGZvciB0aGUgc2FtZSBzdG9yYWdlIGtleSBoYXZlIGNvbXBsZXRlZC5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAcGFyYW0ge3N0cmluZ30gc3RvcmFnZUtleSAtIFN0b3JhZ2Uga2V5IHRvIHNlcmlhbGl6ZS5cbiAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4gdW5kZXIgdGhlIHN0b3JhZ2Uta2V5IGxvY2suXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHdpdGhTdG9yYWdlS2V5TG9jayhzdG9yYWdlS2V5LCBjYWxsYmFjaykge1xuICBjb25zdCBwcmV2aW91cyA9IFNUT1JBR0VfS0VZX0xPQ0tTLmdldChzdG9yYWdlS2V5KSB8fCBQcm9taXNlLnJlc29sdmUoKVxuICBsZXQgcmVsZWFzZSA9ICgpID0+IHt9XG4gIGNvbnN0IGN1cnJlbnQgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4geyByZWxlYXNlID0gKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpIH0pXG4gIGNvbnN0IGNoYWluZWQgPSBwcmV2aW91cy5jYXRjaCgoX2Vycm9yKSA9PiB7fSkudGhlbigoKSA9PiBjdXJyZW50KVxuXG4gIFNUT1JBR0VfS0VZX0xPQ0tTLnNldChzdG9yYWdlS2V5LCBjaGFpbmVkKVxuXG4gIHRyeSB7XG4gICAgYXdhaXQgcHJldmlvdXMuY2F0Y2goKF9lcnJvcikgPT4ge30pXG5cbiAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICB9IGZpbmFsbHkge1xuICAgIHJlbGVhc2UoKVxuICAgIGlmIChTVE9SQUdFX0tFWV9MT0NLUy5nZXQoc3RvcmFnZUtleSkgPT09IGNoYWluZWQpIFNUT1JBR0VfS0VZX0xPQ0tTLmRlbGV0ZShzdG9yYWdlS2V5KVxuICB9XG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhIHBlcnNpc3RlZCBsb2cgcmVjb3JkLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFJhdyByZWNvcmQuXG4gKiBAcmV0dXJucyB7TG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gLSBOb3JtYWxpemVkIHJlY29yZC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplUmVjb3JkKHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkodmFsdWUpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBsb2NhbCBtdXRhdGlvbiBsb2cgcmVjb3JkIG9iamVjdFwiKVxuXG4gIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICh2YWx1ZSlcbiAgY29uc3Qgc3RhdHVzID0gcmVxdWlyZWRTdHJpbmcocmVjb3JkLnN0YXR1cywgXCJzdGF0dXNcIilcblxuICBpZiAoIU1VVEFUSU9OX1NUQVRVU0VTLmhhcyhzdGF0dXMpKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gbG9jYWwgbXV0YXRpb24gc3RhdHVzICcke3N0YXR1c30nYClcblxuICBjb25zdCBiYXNlUmVjb3JkID0ge1xuICAgIGNyZWF0ZWRBdDogcmVxdWlyZWRJc29UaW1lc3RhbXAocmVjb3JkLmNyZWF0ZWRBdCwgXCJjcmVhdGVkQXRcIiksXG4gICAgZGVwZW5kZW5jaWVzOiBub3JtYWxpemVEZXBlbmRlbmNpZXMocmVjb3JkLmRlcGVuZGVuY2llcyksXG4gICAgaWQ6IHJlcXVpcmVkU3RyaW5nKHJlY29yZC5pZCwgXCJpZFwiKSxcbiAgICBtdXRhdGlvbjogbm9ybWFsaXplTXV0YXRpb24ocmVjb3JkLm11dGF0aW9uKSxcbiAgICBzZXF1ZW5jZTogcmVxdWlyZWRQb3NpdGl2ZUludGVnZXIocmVjb3JkLnNlcXVlbmNlLCBcInNlcXVlbmNlXCIpLFxuICAgIHN0YXR1czogLyoqIEB0eXBlIHtMb2NhbE11dGF0aW9uU3RhdHVzfSAqLyAoc3RhdHVzKSxcbiAgICB1cGRhdGVkQXQ6IHJlcXVpcmVkSXNvVGltZXN0YW1wKHJlY29yZC51cGRhdGVkQXQsIFwidXBkYXRlZEF0XCIpXG4gIH1cblxuICBpZiAocmVjb3JkLnNpZ25lZE11dGF0aW9uID09PSB1bmRlZmluZWQgJiYgcmVjb3JkLnN5bmNSZXN1bHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGJhc2VSZWNvcmRcblxuICAvKiogQHR5cGUge0xvY2FsTXV0YXRpb25Mb2dSZWNvcmR9ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWRSZWNvcmQgPSB7Li4uYmFzZVJlY29yZH1cblxuICBpZiAocmVjb3JkLnNpZ25lZE11dGF0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgICBub3JtYWxpemVkUmVjb3JkLnNpZ25lZE11dGF0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259ICovIChjbG9uZUpzb25PYmplY3QocmVjb3JkLnNpZ25lZE11dGF0aW9uLCBcInNpZ25lZE11dGF0aW9uXCIpKVxuICB9XG4gIGlmIChyZWNvcmQuc3luY1Jlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gUGVyc2lzdGVkIHN5bmNSZXN1bHQgaXMgbWFya2VyLWVuY29kZWQgc28gaXQgc3Vydml2ZXMgdGhlIEpTT04gY2xvbmU7XG4gICAgLy8gdHlwZWQgdmFsdWVzIGFyZSByZXN0b3JlZCBieSByZXN0b3JlU3luY1Jlc3VsdFR5cGVzIGF0IHRoZSByZWFkIGJvdW5kYXJ5LlxuICAgIG5vcm1hbGl6ZWRSZWNvcmQuc3luY1Jlc3VsdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlPn0gKi8gKFxuICAgICAgY2xvbmVKc29uT2JqZWN0KHJlY29yZC5zeW5jUmVzdWx0LCBcInN5bmNSZXN1bHRcIilcbiAgICApXG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZFJlY29yZFxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgZGVwZW5kZW5jeSBtZXRhZGF0YSBlbnRyaWVzLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFJhdyBkZXBlbmRlbmNpZXMuXG4gKiBAcmV0dXJucyB7TG9jYWxNdXRhdGlvbkRlcGVuZGVuY3lbXX0gLSBOb3JtYWxpemVkIGRlcGVuZGVuY2llcy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRGVwZW5kZW5jaWVzKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gW11cbiAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgbG9jYWwgbXV0YXRpb24gZGVwZW5kZW5jaWVzIGFycmF5XCIpXG5cbiAgcmV0dXJuIHZhbHVlLm1hcCgoZGVwZW5kZW5jeSkgPT4ge1xuICAgIGlmICghZGVwZW5kZW5jeSB8fCB0eXBlb2YgZGVwZW5kZW5jeSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGRlcGVuZGVuY3kpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBsb2NhbCBtdXRhdGlvbiBkZXBlbmRlbmN5IG9iamVjdFwiKVxuICAgIH1cblxuICAgIGNvbnN0IGRlcGVuZGVuY3lPYmplY3QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoZGVwZW5kZW5jeSlcblxuICAgIHJldHVybiB7XG4gICAgICBjbGllbnRNdXRhdGlvbklkOiByZXF1aXJlZFN0cmluZyhkZXBlbmRlbmN5T2JqZWN0LmNsaWVudE11dGF0aW9uSWQsIFwiZGVwZW5kZW5jeSBjbGllbnRNdXRhdGlvbklkXCIpLFxuICAgICAgbW9kZWw6IHJlcXVpcmVkU3RyaW5nKGRlcGVuZGVuY3lPYmplY3QubW9kZWwsIFwiZGVwZW5kZW5jeSBtb2RlbFwiKVxuICAgIH1cbiAgfSlcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgc3luYyBtdXRhdGlvbiBwYXlsb2FkLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFJhdyBtdXRhdGlvbi5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb259IC0gTm9ybWFsaXplZCBtdXRhdGlvbi5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplTXV0YXRpb24odmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIGxvY2FsIHN5bmMgbXV0YXRpb24gb2JqZWN0XCIpXG5cbiAgY29uc3QgbXV0YXRpb24gPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAodmFsdWUpXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gKi8gKHtcbiAgICBhY3RvckRldmljZUlkOiByZXF1aXJlZFN0cmluZyhtdXRhdGlvbi5hY3RvckRldmljZUlkLCBcImFjdG9yRGV2aWNlSWRcIiksXG4gICAgYWN0b3JVc2VySWQ6IHJlcXVpcmVkU3RyaW5nKG11dGF0aW9uLmFjdG9yVXNlcklkLCBcImFjdG9yVXNlcklkXCIpLFxuICAgIGNsaWVudE11dGF0aW9uSWQ6IHJlcXVpcmVkU3RyaW5nKG11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsIFwiY2xpZW50TXV0YXRpb25JZFwiKSxcbiAgICBtb2RlbDogcmVxdWlyZWRTdHJpbmcobXV0YXRpb24ubW9kZWwsIFwibW9kZWxcIiksXG4gICAgb2NjdXJyZWRBdDogcmVxdWlyZWRJc29UaW1lc3RhbXAobXV0YXRpb24ub2NjdXJyZWRBdCwgXCJvY2N1cnJlZEF0XCIpLFxuICAgIG9mZmxpbmVHcmFudElkOiByZXF1aXJlZFN0cmluZyhtdXRhdGlvbi5vZmZsaW5lR3JhbnRJZCwgXCJvZmZsaW5lR3JhbnRJZFwiKSxcbiAgICBvcGVyYXRpb246IHJlcXVpcmVkU3RyaW5nKG11dGF0aW9uLm9wZXJhdGlvbiwgXCJvcGVyYXRpb25cIiksXG4gICAgcG9saWN5SGFzaDogcmVxdWlyZWRTdHJpbmcobXV0YXRpb24ucG9saWN5SGFzaCwgXCJwb2xpY3lIYXNoXCIpXG4gIH0pXG5cbiAgaWYgKG11dGF0aW9uLmF0dHJpYnV0ZXMgIT09IHVuZGVmaW5lZCkgbm9ybWFsaXplZC5hdHRyaWJ1dGVzID0gY2xvbmVKc29uT2JqZWN0KG11dGF0aW9uLmF0dHJpYnV0ZXMsIFwiYXR0cmlidXRlc1wiKVxuICBpZiAobXV0YXRpb24uYmFzZVZlcnNpb24gIT09IHVuZGVmaW5lZCkgbm9ybWFsaXplZC5iYXNlVmVyc2lvbiA9IGNsb25lQmFzZVZlcnNpb24obXV0YXRpb24uYmFzZVZlcnNpb24pXG4gIGlmIChtdXRhdGlvbi5jb21tYW5kICE9PSB1bmRlZmluZWQpIG5vcm1hbGl6ZWQuY29tbWFuZCA9IHJlcXVpcmVkU3RyaW5nKG11dGF0aW9uLmNvbW1hbmQsIFwiY29tbWFuZFwiKVxuICBpZiAobXV0YXRpb24ucGF5bG9hZCAhPT0gdW5kZWZpbmVkKSBub3JtYWxpemVkLnBheWxvYWQgPSBjbG9uZUpzb25PYmplY3QobXV0YXRpb24ucGF5bG9hZCwgXCJwYXlsb2FkXCIpXG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRcbn1cblxuLyoqXG4gKiBSZXF1aXJlcyBhIG5vbi1lbXB0eSBzdHJpbmcgdmFsdWUuXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gUmF3IHZhbHVlLlxuICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gRmllbGQgbGFiZWwuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlcXVpcmVkIHN0cmluZy5cbiAqL1xuZnVuY3Rpb24gcmVxdWlyZWRTdHJpbmcodmFsdWUsIGxhYmVsKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgfHwgdmFsdWUubGVuZ3RoIDwgMSkgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBsb2NhbCBtdXRhdGlvbiAke2xhYmVsfWApXG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogUmVxdWlyZXMgYW4gSVNPIHRpbWVzdGFtcCBzdHJpbmcuXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gUmF3IHZhbHVlLlxuICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gRmllbGQgbGFiZWwuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIElTTyB0aW1lc3RhbXAuXG4gKi9cbmZ1bmN0aW9uIHJlcXVpcmVkSXNvVGltZXN0YW1wKHZhbHVlLCBsYWJlbCkge1xuICBjb25zdCBzdHJpbmdWYWx1ZSA9IHJlcXVpcmVkU3RyaW5nKHZhbHVlLCBsYWJlbClcbiAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKHN0cmluZ1ZhbHVlKVxuXG4gIGlmIChOdW1iZXIuaXNOYU4oZGF0ZS5nZXRUaW1lKCkpIHx8IGRhdGUudG9JU09TdHJpbmcoKSAhPT0gc3RyaW5nVmFsdWUpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbG9jYWwgbXV0YXRpb24gJHtsYWJlbH0gSVNPIHRpbWVzdGFtcGApXG5cbiAgcmV0dXJuIHN0cmluZ1ZhbHVlXG59XG5cbi8qKlxuICogUmVxdWlyZXMgYSBwb3NpdGl2ZSBpbnRlZ2VyIHZhbHVlLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFJhdyB2YWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCAtIEZpZWxkIGxhYmVsLlxuICogQHJldHVybnMge251bWJlcn0gLSBQb3NpdGl2ZSBpbnRlZ2VyLlxuICovXG5mdW5jdGlvbiByZXF1aXJlZFBvc2l0aXZlSW50ZWdlcih2YWx1ZSwgbGFiZWwpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkgfHwgdmFsdWUgPCAxKSB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGxvY2FsIG11dGF0aW9uICR7bGFiZWx9IHBvc2l0aXZlIGludGVnZXJgKVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIENsb25lcyBhIHN1cHBvcnRlZCBiYXNlLXZlcnNpb24gdmFsdWUuXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gUmF3IGJhc2UgdmVyc2lvbi5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSAtIE5vcm1hbGl6ZWQgYmFzZSB2ZXJzaW9uLlxuICovXG5mdW5jdGlvbiBjbG9uZUJhc2VWZXJzaW9uKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gdmFsdWVcblxuICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBsb2NhbCBtdXRhdGlvbiBiYXNlVmVyc2lvbiBzdHJpbmcsIG51bWJlciwgb3IgbnVsbFwiKVxufVxuXG4vKipcbiAqIENsb25lcyBhIEpTT04tY29tcGF0aWJsZSB2YWx1ZS5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBSYXcgSlNPTiB2YWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCAtIEZpZWxkIGxhYmVsLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWV9IC0gQ2xvbmVkIEpTT04gdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGNsb25lSnNvblZhbHVlKHZhbHVlLCBsYWJlbCkge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBKU09OLWNvbXBhdGlibGUgbG9jYWwgbXV0YXRpb24gJHtsYWJlbH1gKVxuXG4gIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWV9ICovIChKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHZhbHVlKSkpXG59XG5cbi8qKlxuICogQ2xvbmVzIGEgSlNPTi1jb21wYXRpYmxlIG9iamVjdC5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBSYXcgSlNPTiBvYmplY3QuXG4gKiBAcGFyYW0ge3N0cmluZ30gbGFiZWwgLSBGaWVsZCBsYWJlbC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gLSBDbG9uZWQgSlNPTiBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIGNsb25lSnNvbk9iamVjdCh2YWx1ZSwgbGFiZWwpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgbG9jYWwgbXV0YXRpb24gJHtsYWJlbH0gb2JqZWN0YClcblxuICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gKi8gKGNsb25lSnNvblZhbHVlKHZhbHVlLCBsYWJlbCkpXG59XG5cbi8qKlxuICogQ2xvbmVzIGEgbG9jYWwgbXV0YXRpb24gbG9nIHJlY29yZC5cbiAqIEBwYXJhbSB7TG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gcmVjb3JkIC0gUmVjb3JkIHRvIGNsb25lLlxuICogQHJldHVybnMge0xvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IC0gQ2xvbmVkIHJlY29yZC5cbiAqL1xuZnVuY3Rpb24gY2xvbmVSZWNvcmQocmVjb3JkKSB7XG4gIHJldHVybiAvKiogQHR5cGUge0xvY2FsTXV0YXRpb25Mb2dSZWNvcmR9ICovIChKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHJlY29yZCkpKVxufVxuXG4vKipcbiAqIEdlbmVyYXRlcyBhIHJhbmRvbSBsb2NhbCBtdXRhdGlvbiByZWNvcmQgaWQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJhbmRvbSByZWNvcmQgaWQuXG4gKi9cbmZ1bmN0aW9uIHJhbmRvbVJlY29yZElkKCkge1xuICBjb25zdCBjcnlwdG9Qcm92aWRlciA9IGdsb2JhbFRoaXMuY3J5cHRvXG5cbiAgaWYgKGNyeXB0b1Byb3ZpZGVyICYmIHR5cGVvZiBjcnlwdG9Qcm92aWRlci5yYW5kb21VVUlEID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiBjcnlwdG9Qcm92aWRlci5yYW5kb21VVUlEKClcblxuICByZXR1cm4gYGxvY2FsLW11dGF0aW9uLSR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDE2KS5zbGljZSgyKX1gXG59XG4iXX0=