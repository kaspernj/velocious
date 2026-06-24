// @ts-check

const DEFAULT_STORAGE_KEY = "velocious.sync.localMutationLog"
const PENDING_STATUS_VALUES = /** @type {LocalMutationStatus[]} */ (["pending", "applied-locally", "peer-applied"])
const PENDING_STATUSES = new Set(PENDING_STATUS_VALUES)
const MUTATION_STATUSES = new Set([...PENDING_STATUSES, "conflict", "rejected", "synced"])
const TERMINAL_STATUSES = new Set(["rejected", "synced"])
/** @type {Map<string, Promise<unknown>>} */
const STORAGE_KEY_LOCKS = new Map()

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
 *
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
 * @property {number} sequence - Monotonic local sequence.
 * @property {LocalMutationStatus} status - Local replay/apply status.
 * @property {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} [syncResult] - Backend replay/result metadata.
 * @property {string} updatedAt - ISO timestamp when the record was last changed.
 */

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
  constructor({idGenerator = randomRecordId, now = () => new Date(), storage, storageKey = DEFAULT_STORAGE_KEY}) {
    if (!validStorage(storage)) {
      throw new Error("LocalMutationLog requires row storage with appendRecord/deleteRecords/nextSequence/record/records/updateRecord")
    }

    this.idGenerator = idGenerator
    this.now = now
    this.storage = storage
    this.storageKey = storageKey
  }

  /**
   * Appends a pending mutation record.
   * @param {object} args - Arguments.
   * @param {LocalMutationDependency[]} [args.dependencies] - Mutation dependencies.
   * @param {import("./device-identity.js").SyncMutation} args.mutation - Mutation payload.
   * @returns {Promise<LocalMutationLogRecord>} - Created log record.
   */
  async append({dependencies = [], mutation}) {
    return await withStorageKeyLock(this.storageKey, async () => {
      const timestamp = this.currentTimestamp()
      const record = normalizeRecord({
        createdAt: timestamp,
        dependencies,
        id: this.idGenerator(),
        mutation,
        sequence: await this.storage.nextSequence(this.storageKey),
        status: "pending",
        updatedAt: timestamp
      })

      await this.storage.appendRecord(this.storageKey, cloneRecord(record))

      return cloneRecord(record)
    })
  }

  /**
   * Returns all records ordered by local sequence.
   * @returns {Promise<LocalMutationLogRecord[]>} - Log records.
   */
  async records() {
    return normalizeRecordList(await this.storage.records(this.storageKey))
  }

  /**
   * Returns records that still need local/server reconciliation.
   * @returns {Promise<LocalMutationLogRecord[]>} - Pending records.
   */
  async pendingRecords() {
    return normalizeRecordList(await this.storage.records(this.storageKey, {statuses: PENDING_STATUS_VALUES}))
  }

  /**
   * Updates a record status.
   * @param {object} args - Arguments.
   * @param {string} args.id - Record id.
   * @param {LocalMutationStatus} args.status - New status.
   * @param {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} [args.syncResult] - Result metadata.
   * @returns {Promise<LocalMutationLogRecord>} - Updated record.
   */
  async updateStatus({id, status, syncResult}) {
    if (!MUTATION_STATUSES.has(status)) throw new Error(`Unknown local mutation status '${status}'`)

    return await withStorageKeyLock(this.storageKey, async () => {
      const rawRecord = await this.storage.record(this.storageKey, id)

      if (!rawRecord) throw new Error(`No local mutation log record '${id}'`)

      const record = normalizeRecord(rawRecord)

      record.status = /** @type {LocalMutationStatus} */ (status)
      if (syncResult !== undefined) record.syncResult = cloneJsonObject(syncResult, "syncResult")
      record.updatedAt = this.currentTimestamp()
      await this.storage.updateRecord(this.storageKey, cloneRecord(record))

      return cloneRecord(record)
    })
  }

  /**
   * Prunes terminal records that are no longer needed for replay dependencies.
   * @param {object} [args] - Compaction options.
   * @param {number} [args.maxTerminalRecords] - Maximum terminal records to retain.
   * @param {number} [args.terminalRetentionMs] - Minimum age before pruning terminal records.
   * @returns {Promise<{deletedRecordIds: string[]}>} - Compaction result.
   */
  async compact({maxTerminalRecords, terminalRetentionMs} = {}) {
    return await withStorageKeyLock(this.storageKey, async () => {
      const records = await this.records()
      const protectedClientMutationIds = new Set(
        records
          .filter((record) => PENDING_STATUSES.has(record.status) || record.status === "conflict")
          .flatMap((record) => record.dependencies.map((dependency) => dependency.clientMutationId))
      )
      const terminalRecords = records
        .filter((record) => TERMINAL_STATUSES.has(record.status))
        .filter((record) => !protectedClientMutationIds.has(record.mutation.clientMutationId))
        .sort(compareRecordsNewestFirst)
      const deleteIds = new Set()

      if (typeof maxTerminalRecords === "number" && maxTerminalRecords >= 0) {
        for (const record of terminalRecords.slice(maxTerminalRecords)) deleteIds.add(record.id)
      }

      if (typeof terminalRetentionMs === "number" && terminalRetentionMs >= 0) {
        const cutoff = this.now().getTime() - terminalRetentionMs

        for (const record of terminalRecords) {
          if (new Date(record.updatedAt).getTime() < cutoff) deleteIds.add(record.id)
        }
      }

      const deletedRecordIds = Array.from(deleteIds)

      if (deletedRecordIds.length > 0) await this.storage.deleteRecords(this.storageKey, deletedRecordIds)

      return {deletedRecordIds}
    })
  }

  /**
   * Returns the current log timestamp.
   * @returns {string} - Current ISO timestamp.
   */
  currentTimestamp() {
    const date = this.now()

    if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error("LocalMutationLog now() must return a valid Date")

    return date.toISOString()
  }
}

/**
 * Checks whether a storage adapter has all required row-store methods.
 * @param {unknown} storage - Storage adapter candidate.
 * @returns {storage is LocalMutationLogStorage} - Whether storage is valid.
 */
function validStorage(storage) {
  if (!storage || typeof storage !== "object") return false

  const storageObject = /** @type {Record<string, unknown>} */ (storage)

  return typeof storageObject.appendRecord === "function"
    && typeof storageObject.deleteRecords === "function"
    && typeof storageObject.nextSequence === "function"
    && typeof storageObject.record === "function"
    && typeof storageObject.records === "function"
    && typeof storageObject.updateRecord === "function"
}

/**
 * Sorts records by newest update/sequence first.
 * @param {LocalMutationLogRecord} left - Left record.
 * @param {LocalMutationLogRecord} right - Right record.
 * @returns {number} - Sort result.
 */
function compareRecordsNewestFirst(left, right) {
  const updatedAtComparison = right.updatedAt.localeCompare(left.updatedAt)

  if (updatedAtComparison !== 0) return updatedAtComparison

  return right.sequence - left.sequence
}

/**
 * Normalizes and sorts a list of records.
 * @param {unknown} records - Raw records.
 * @returns {LocalMutationLogRecord[]} - Normalized records.
 */
function normalizeRecordList(records) {
  if (!Array.isArray(records)) throw new Error("Expected local mutation log storage records array")

  return records
    .map(normalizeRecord)
    .sort((left, right) => left.sequence - right.sequence)
    .map((record) => cloneRecord(record))
}

/**
 * Runs a callback after earlier writes for the same storage key have completed.
 * @template T
 * @param {string} storageKey - Storage key to serialize.
 * @param {() => Promise<T>} callback - Callback to run under the storage-key lock.
 * @returns {Promise<T>} - Callback result.
 */
async function withStorageKeyLock(storageKey, callback) {
  const previous = STORAGE_KEY_LOCKS.get(storageKey) || Promise.resolve()
  let release = () => {}
  const current = new Promise((resolve) => { release = () => resolve(undefined) })
  const chained = previous.catch((_error) => {}).then(() => current)

  STORAGE_KEY_LOCKS.set(storageKey, chained)

  try {
    await previous.catch((_error) => {})

    return await callback()
  } finally {
    release()
    if (STORAGE_KEY_LOCKS.get(storageKey) === chained) STORAGE_KEY_LOCKS.delete(storageKey)
  }
}

/**
 * Normalizes a persisted log record.
 * @param {unknown} value - Raw record.
 * @returns {LocalMutationLogRecord} - Normalized record.
 */
function normalizeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected local mutation log record object")

  const record = /** @type {Record<string, unknown>} */ (value)
  const status = requiredString(record.status, "status")

  if (!MUTATION_STATUSES.has(status)) throw new Error(`Unknown local mutation status '${status}'`)

  const baseRecord = {
    createdAt: requiredIsoTimestamp(record.createdAt, "createdAt"),
    dependencies: normalizeDependencies(record.dependencies),
    id: requiredString(record.id, "id"),
    mutation: normalizeMutation(record.mutation),
    sequence: requiredPositiveInteger(record.sequence, "sequence"),
    status: /** @type {LocalMutationStatus} */ (status),
    updatedAt: requiredIsoTimestamp(record.updatedAt, "updatedAt")
  }

  if (record.syncResult === undefined) return baseRecord

  return {
    ...baseRecord,
    syncResult: cloneJsonObject(record.syncResult, "syncResult")
  }
}

/**
 * Normalizes dependency metadata entries.
 * @param {unknown} value - Raw dependencies.
 * @returns {LocalMutationDependency[]} - Normalized dependencies.
 */
function normalizeDependencies(value) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error("Expected local mutation dependencies array")

  return value.map((dependency) => {
    if (!dependency || typeof dependency !== "object" || Array.isArray(dependency)) {
      throw new Error("Expected local mutation dependency object")
    }

    const dependencyObject = /** @type {Record<string, unknown>} */ (dependency)

    return {
      clientMutationId: requiredString(dependencyObject.clientMutationId, "dependency clientMutationId"),
      model: requiredString(dependencyObject.model, "dependency model")
    }
  })
}

/**
 * Normalizes a sync mutation payload.
 * @param {unknown} value - Raw mutation.
 * @returns {import("./device-identity.js").SyncMutation} - Normalized mutation.
 */
function normalizeMutation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected local sync mutation object")

  const mutation = /** @type {Record<string, unknown>} */ (value)
  const normalized = /** @type {import("./device-identity.js").SyncMutation} */ ({
    actorDeviceId: requiredString(mutation.actorDeviceId, "actorDeviceId"),
    actorUserId: requiredString(mutation.actorUserId, "actorUserId"),
    clientMutationId: requiredString(mutation.clientMutationId, "clientMutationId"),
    model: requiredString(mutation.model, "model"),
    occurredAt: requiredIsoTimestamp(mutation.occurredAt, "occurredAt"),
    offlineGrantId: requiredString(mutation.offlineGrantId, "offlineGrantId"),
    operation: requiredString(mutation.operation, "operation"),
    policyHash: requiredString(mutation.policyHash, "policyHash")
  })

  if (mutation.attributes !== undefined) normalized.attributes = cloneJsonObject(mutation.attributes, "attributes")
  if (mutation.baseVersion !== undefined) normalized.baseVersion = cloneBaseVersion(mutation.baseVersion)
  if (mutation.command !== undefined) normalized.command = requiredString(mutation.command, "command")
  if (mutation.payload !== undefined) normalized.payload = cloneJsonObject(mutation.payload, "payload")

  return normalized
}

/**
 * Requires a non-empty string value.
 * @param {unknown} value - Raw value.
 * @param {string} label - Field label.
 * @returns {string} - Required string.
 */
function requiredString(value, label) {
  if (typeof value !== "string" || value.length < 1) throw new Error(`Expected local mutation ${label}`)

  return value
}

/**
 * Requires an ISO timestamp string.
 * @param {unknown} value - Raw value.
 * @param {string} label - Field label.
 * @returns {string} - ISO timestamp.
 */
function requiredIsoTimestamp(value, label) {
  const stringValue = requiredString(value, label)
  const date = new Date(stringValue)

  if (Number.isNaN(date.getTime()) || date.toISOString() !== stringValue) throw new Error(`Expected local mutation ${label} ISO timestamp`)

  return stringValue
}

/**
 * Requires a positive integer value.
 * @param {unknown} value - Raw value.
 * @param {string} label - Field label.
 * @returns {number} - Positive integer.
 */
function requiredPositiveInteger(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`Expected local mutation ${label} positive integer`)

  return value
}

/**
 * Clones a supported base-version value.
 * @param {unknown} value - Raw base version.
 * @returns {string | number | null} - Normalized base version.
 */
function cloneBaseVersion(value) {
  if (value === null || typeof value === "string" || typeof value === "number") return value

  throw new Error("Expected local mutation baseVersion string, number, or null")
}

/**
 * Clones a JSON-compatible value.
 * @param {unknown} value - Raw JSON value.
 * @param {string} label - Field label.
 * @returns {import("../configuration-types.js").FrontendModelSyncJsonValue} - Cloned JSON value.
 */
function cloneJsonValue(value, label) {
  if (value === undefined || typeof value === "function") throw new Error(`Expected JSON-compatible local mutation ${label}`)

  return /** @type {import("../configuration-types.js").FrontendModelSyncJsonValue} */ (JSON.parse(JSON.stringify(value)))
}

/**
 * Clones a JSON-compatible object.
 * @param {unknown} value - Raw JSON object.
 * @param {string} label - Field label.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} - Cloned JSON object.
 */
function cloneJsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected local mutation ${label} object`)

  return /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (cloneJsonValue(value, label))
}

/**
 * Clones a local mutation log record.
 * @param {LocalMutationLogRecord} record - Record to clone.
 * @returns {LocalMutationLogRecord} - Cloned record.
 */
function cloneRecord(record) {
  return /** @type {LocalMutationLogRecord} */ (JSON.parse(JSON.stringify(record)))
}

/**
 * Generates a random local mutation record id.
 * @returns {string} - Random record id.
 */
function randomRecordId() {
  const cryptoProvider = globalThis.crypto

  if (cryptoProvider && typeof cryptoProvider.randomUUID === "function") return cryptoProvider.randomUUID()

  return `local-mutation-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
