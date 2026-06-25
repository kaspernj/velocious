// @ts-check

const CONFLICT_STRATEGIES = new Set(["optimisticVersion", "serverWins", "lastWriterWins", "fieldThreeWay", "appendOnly"])

/**
 * @typedef {null | string | number | boolean | unknown[] | Record<string, unknown>} SyncJsonValue
 */

/**
 * @typedef {object} SyncConflictRecord
 * @property {Record<string, SyncJsonValue>} attributes - Record attributes.
 * @property {string | number | boolean | null} [version] - Record version value.
 */

/**
 * @typedef {object} SyncConflictResult
 * @property {Record<string, SyncJsonValue>} [attributes] - Attributes to apply when replay may continue.
 * @property {Record<string, SyncJsonValue>} [conflict] - Structured conflict payload for the client/local log.
 * @property {"applied" | "conflict" | "rejected"} status - Conflict decision.
 * @property {string} strategy - Strategy that produced the decision.
 */

/**
 * Evaluates a replay mutation against server/base state using a sync conflict strategy.
 * @param {object} args - Arguments.
 * @param {SyncConflictRecord | null} [args.baseRecord] - Record state observed when the mutation was made.
 * @param {function(object): (SyncConflictResult | Promise<SyncConflictResult>)} [args.customHandler] - Resource-specific conflict hook.
 * @param {import("./device-identity.js").SyncMutation} args.mutation - Replayed mutation.
 * @param {SyncConflictRecord | null} [args.serverRecord] - Current authoritative server record.
 * @param {string} [args.strategy] - Conflict strategy.
 * @param {string} [args.versionAttribute] - Attribute used for optimistic version checks.
 * @returns {Promise<SyncConflictResult>} - Conflict decision.
 */
export async function resolveSyncConflict({baseRecord = null, customHandler, mutation, serverRecord = null, strategy = "optimisticVersion", versionAttribute = "updatedAt"}) {
  if (customHandler) return normalizeConflictResult(await customHandler({baseRecord, mutation, serverRecord, strategy, versionAttribute}), strategy)
  if (!CONFLICT_STRATEGIES.has(strategy)) throw new Error(`Unknown sync conflict strategy '${strategy}'`)

  const mutationAttributes = mutationAttributesFor(mutation)

  if (strategy === "appendOnly" || strategy === "lastWriterWins") return {attributes: mutationAttributes, status: "applied", strategy}
  if (strategy === "fieldThreeWay") return fieldThreeWayResult({baseRecord, mutation, serverRecord, strategy, versionAttribute})
  if (hasVersionConflict({mutation, serverRecord, versionAttribute})) return conflictResult({baseRecord, mutation, serverRecord, strategy, versionAttribute})

  return {attributes: mutationAttributes, status: "applied", strategy}
}

/**
 * Applies a server replay result to a local mutation-log record.
 * @param {object} args - Arguments.
 * @param {import("./local-mutation-log.js").default} args.mutationLog - Local mutation log.
 * @param {import("./local-mutation-log.js").LocalMutationLogRecord} args.record - Local mutation-log record.
 * @param {Record<string, SyncJsonValue>} args.result - Server replay result payload.
 * @returns {Promise<import("./local-mutation-log.js").LocalMutationLogRecord>} - Updated local record.
 */
export async function applySyncReplayResultToLocalMutationLog({mutationLog, record, result}) {
  return await mutationLog.updateStatus({
    id: record.id,
    status: replayResultLocalStatus(result),
    syncResult: result
  })
}

/**
 * Maps a server replay result to a local mutation-log status.
 * @param {Record<string, SyncJsonValue>} result - Replay result.
 * @returns {import("./local-mutation-log.js").LocalMutationStatus} - Local mutation-log status.
 */
export function replayResultLocalStatus(result) {
  if (result.status === "conflict") return "conflict"
  if (result.status === "error" || result.status === "rejected") return "rejected"
  if (result.status === "success" || result.status === "applied" || result.status === "duplicate") return "synced"

  throw new Error(`Unknown sync replay result status '${String(result.status)}'`)
}

/**
 * Runs a field-level three-way merge.
 * @param {object} args - Arguments.
 * @param {SyncConflictRecord | null} args.baseRecord - Base record.
 * @param {import("./device-identity.js").SyncMutation} args.mutation - Mutation.
 * @param {SyncConflictRecord | null} args.serverRecord - Server record.
 * @param {string} args.strategy - Strategy.
 * @param {string} args.versionAttribute - Version attribute.
 * @returns {SyncConflictResult} - Conflict decision.
 */
function fieldThreeWayResult({baseRecord, mutation, serverRecord, strategy, versionAttribute}) {
  if (!baseRecord || !serverRecord) return {attributes: mutationAttributesFor(mutation), status: "applied", strategy}

  const mutationAttributes = mutationAttributesFor(mutation)
  /** @type {string[]} */
  const affectedFields = []
  /** @type {Record<string, SyncJsonValue>} */
  const mergedAttributes = {}

  for (const [field, localValue] of Object.entries(mutationAttributes)) {
    const baseValue = baseRecord.attributes[field]
    const serverValue = serverRecord.attributes[field]

    if (jsonValuesEqual(serverValue, baseValue) || jsonValuesEqual(serverValue, localValue)) {
      mergedAttributes[field] = localValue
    } else {
      affectedFields.push(field)
    }
  }

  if (affectedFields.length > 0) return conflictResult({affectedFields, baseRecord, mutation, serverRecord, strategy, versionAttribute})

  return {attributes: mergedAttributes, status: "applied", strategy}
}

/**
 * Checks whether current server state conflicts with a mutation base version.
 * @param {object} args - Arguments.
 * @param {import("./device-identity.js").SyncMutation} args.mutation - Mutation.
 * @param {SyncConflictRecord | null} args.serverRecord - Server record.
 * @param {string} args.versionAttribute - Version attribute.
 * @returns {boolean} - Whether versions conflict.
 */
function hasVersionConflict({mutation, serverRecord, versionAttribute}) {
  if (!serverRecord) return false
  if (mutation.baseVersion === undefined || mutation.baseVersion === null) return false

  const serverVersion = serverRecord.version ?? serverRecord.attributes[versionAttribute] ?? null

  return !jsonValuesEqual(serverVersion, mutation.baseVersion)
}

/**
 * Builds a structured conflict result.
 * @param {object} args - Arguments.
 * @param {string[]} [args.affectedFields] - Explicit affected fields.
 * @param {SyncConflictRecord | null} args.baseRecord - Base record.
 * @param {import("./device-identity.js").SyncMutation} args.mutation - Mutation.
 * @param {SyncConflictRecord | null} args.serverRecord - Server record.
 * @param {string} args.strategy - Strategy.
 * @param {string} args.versionAttribute - Version attribute.
 * @returns {SyncConflictResult} - Conflict result.
 */
function conflictResult({affectedFields, baseRecord, mutation, serverRecord, strategy, versionAttribute}) {
  const mutationAttributes = mutationAttributesFor(mutation)

  return {
    conflict: {
      affectedFields: affectedFields || Object.keys(mutationAttributes),
      baseRecord: baseRecord ? baseRecord.attributes : null,
      baseVersion: /** @type {SyncJsonValue} */ (mutation.baseVersion ?? null),
      localMutation: {
        attributes: mutationAttributes,
        clientMutationId: mutation.clientMutationId,
        model: mutation.model,
        operation: mutation.operation,
        payload: /** @type {SyncJsonValue} */ (mutation.payload || null)
      },
      serverModel: serverRecord ? serverRecord.attributes : null,
      serverVersion: serverRecord ? /** @type {SyncJsonValue} */ (serverRecord.version ?? serverRecord.attributes[versionAttribute] ?? null) : null,
      suggestedResolution: strategy === "serverWins" ? "keep_server" : "manual",
      versionAttribute
    },
    status: "conflict",
    strategy
  }
}

/**
 * Normalizes a custom resource conflict result.
 * @param {unknown} result - Raw result.
 * @param {string} strategy - Requested strategy.
 * @returns {SyncConflictResult} - Normalized result.
 */
function normalizeConflictResult(result, strategy) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Sync conflict handler must return an object")
  const resultRecord = /** @type {Record<string, unknown>} */ (result)
  if (!["applied", "conflict", "rejected"].includes(String(resultRecord.status))) throw new Error("Sync conflict handler returned an unknown status")

  return /** @type {SyncConflictResult} */ ({strategy, ...resultRecord})
}

/**
 * Returns mutation attributes as a JSON object.
 * @param {import("./device-identity.js").SyncMutation} mutation - Mutation.
 * @returns {Record<string, SyncJsonValue>} - Attributes.
 */
function mutationAttributesFor(mutation) {
  if (!mutation.attributes || typeof mutation.attributes !== "object" || Array.isArray(mutation.attributes)) return {}

  return /** @type {Record<string, SyncJsonValue>} */ (JSON.parse(JSON.stringify(mutation.attributes)))
}

/**
 * Compares JSON values by stable serialization.
 * @param {unknown} left - Left value.
 * @param {unknown} right - Right value.
 * @returns {boolean} - Whether values match.
 */
function jsonValuesEqual(left, right) {
  return stableJsonStringify(left) === stableJsonStringify(right)
}

/**
 * Stable JSON stringify helper.
 * @param {unknown} value - Value.
 * @returns {string} - Stable JSON.
 */
function stableJsonStringify(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(/** @type {Record<string, unknown>} */ (value)[key])}`).join(",")}}`
  }

  return JSON.stringify(value)
}
