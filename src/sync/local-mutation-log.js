// @ts-check

const DEFAULT_STORAGE_KEY = "velocious.sync.localMutationLog"
const PENDING_STATUSES = new Set(["pending", "applied-locally", "peer-applied"])
const MUTATION_STATUSES = new Set([...PENDING_STATUSES, "conflict", "rejected", "synced"])

/**
 * Local mutation log storage adapter.
 * @typedef {object} LocalMutationLogStorage
 * @property {(key: string) => Promise<string | null | undefined> | string | null | undefined} getItem - Reads a stored value.
 * @property {(key: string, value: string) => Promise<void> | void} setItem - Stores a value.
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
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new Error("LocalMutationLog requires storage with getItem/setItem")
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
    const state = await this.loadState()
    const timestamp = this.currentTimestamp()
    const record = {
      createdAt: timestamp,
      dependencies: normalizeDependencies(dependencies),
      id: this.idGenerator(),
      mutation: normalizeMutation(mutation),
      sequence: state.nextSequence,
      status: /** @type {LocalMutationStatus} */ ("pending"),
      updatedAt: timestamp
    }

    state.nextSequence += 1
    state.records.push(record)
    await this.saveState(state)

    return cloneRecord(record)
  }

  /**
   * Returns all records ordered by local sequence.
   * @returns {Promise<LocalMutationLogRecord[]>} - Log records.
   */
  async records() {
    const state = await this.loadState()

    return state.records
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .map((record) => cloneRecord(record))
  }

  /**
   * Returns records that still need local/server reconciliation.
   * @returns {Promise<LocalMutationLogRecord[]>} - Pending records.
   */
  async pendingRecords() {
    const records = await this.records()

    return records.filter((record) => PENDING_STATUSES.has(record.status))
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

    const state = await this.loadState()
    const record = state.records.find((candidate) => candidate.id === id)

    if (!record) throw new Error(`No local mutation log record '${id}'`)

    record.status = status
    if (syncResult !== undefined) record.syncResult = cloneJsonObject(syncResult, "syncResult")
    record.updatedAt = this.currentTimestamp()
    await this.saveState(state)

    return cloneRecord(record)
  }

  /**
   * Loads the persisted log state.
   * @returns {Promise<{nextSequence: number, records: LocalMutationLogRecord[]}>} - Log state.
   */
  async loadState() {
    const raw = await this.storage.getItem(this.storageKey)

    if (raw === undefined || raw === null || raw === "") return {nextSequence: 1, records: []}
    if (typeof raw !== "string") throw new Error("Local mutation log storage returned a non-string value")

    const parsed = JSON.parse(raw)

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Local mutation log storage payload must be an object")
    }

    const rawState = /** @type {{nextSequence?: unknown, records?: unknown}} */ (parsed)
    const records = Array.isArray(rawState.records) ? rawState.records.map(normalizeRecord) : []
    const rawNextSequence = rawState.nextSequence
    const nextSequence = Number.isInteger(rawNextSequence) && typeof rawNextSequence === "number" && rawNextSequence > 0
      ? rawNextSequence
      : records.reduce((max, record) => Math.max(max, record.sequence + 1), 1)

    return {nextSequence, records}
  }

  /**
   * Persists the log state.
   * @param {{nextSequence: number, records: LocalMutationLogRecord[]}} state - Log state.
   * @returns {Promise<void>} - Resolves when stored.
   */
  async saveState(state) {
    await this.storage.setItem(this.storageKey, JSON.stringify(state))
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
