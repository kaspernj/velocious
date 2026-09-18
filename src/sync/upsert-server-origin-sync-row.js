// @ts-check

import restArgsError from "../utils/rest-args-error.js"
import sha256Hex from "../utils/sha256-hex.js"
import stableJsonStringify from "../utils/stable-json.js"

import {upsertSyncRow} from "./sync-change-fanout.js"
import {declaredSyncScopeAttributes} from "./sync-scope-attributes.js"

/**
 * Atomically reconciles and upserts one server-origin sync row by its complete,
 * null-safe logical identity. The identity contains the null actor, resource
 * type/id, and every scope column declared by the sync model. A stable portable
 * advisory lock serializes runtime publication and maintenance/backfill calls;
 * legacy duplicates converge to the newest server sequence, then the lowest
 * immutable id, before the survivor is updated and re-sequenced.
 *
 * The lock is acquired through the static sync model on a dedicated connection.
 * `persistenceModel` may be an operation-bound model facade so reads/writes keep
 * their owning operation while sharing the same identity lock as ordinary
 * publisher calls.
 * @param {object} args - Persistence arguments.
 * @param {string} [args.actorForeignKeyColumn] - Persisted actor foreign-key column.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} args.attributes - Complete sync-row mutation attributes.
 * @param {ReturnType<typeof JSON.parse>} [args.persistenceModel] - Optional operation-bound model used for row reads/writes.
 * @param {string[]} [args.scopeColumnNames] - Additional persisted scope columns used by deprecated publisher declarations.
 * @param {ReturnType<typeof JSON.parse>} args.syncModel - Static sync model owning scope metadata and the advisory lock.
 * @returns {Promise<ReturnType<typeof JSON.parse>>} Created or reconciled sync row.
 */
export async function upsertServerOriginSyncRow({
  actorForeignKeyColumn = "authentication_token_id",
  attributes,
  persistenceModel,
  scopeColumnNames = [],
  syncModel,
  ...restArgs
}) {
  restArgsError(restArgs)

  if (typeof actorForeignKeyColumn !== "string" || !actorForeignKeyColumn) {
    throw new Error("Server-origin sync row actorForeignKeyColumn must be a non-empty string")
  }
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    throw new Error("Server-origin sync row attributes must be a plain object")
  }
  if (!Object.hasOwn(attributes, actorForeignKeyColumn) || attributes[actorForeignKeyColumn] === undefined) {
    throw new Error(`Server-origin sync row identity must include the actor column ${actorForeignKeyColumn}`)
  }
  if (attributes[actorForeignKeyColumn] !== null) {
    throw new Error(`Server-origin sync row actor column ${actorForeignKeyColumn} must be null`)
  }

  validateRequiredIdentityString({attributes, columnName: "resource_id"})
  validateRequiredIdentityString({attributes, columnName: "resource_type"})

  /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
  const identity = {
    [actorForeignKeyColumn]: null,
    resource_id: attributes.resource_id,
    resource_type: attributes.resource_type
  }
  const attributeToColumnName = syncModel.getAttributeNameToColumnNameMap()
  const scopeColumns = new Set(scopeColumnNames)

  for (const scopeAttribute of declaredSyncScopeAttributes(syncModel) || []) {
    const columnName = attributeToColumnName[scopeAttribute]

    if (!columnName) {
      throw new Error(`${syncModel.name} declares the sync scope attribute ${scopeAttribute} but has no matching column for it`)
    }

    scopeColumns.add(columnName)
  }

  for (const columnName of scopeColumns) {
    if (typeof columnName !== "string" || !columnName || !Object.values(attributeToColumnName).includes(columnName)) {
      throw new Error(`Server-origin sync row received an unknown scope column: ${String(columnName)}`)
    }

    if (!Object.hasOwn(attributes, columnName) || attributes[columnName] === undefined) {
      throw new Error(`Server-origin sync row identity must include the declared scope column ${columnName}`)
    }

    const value = attributes[columnName]

    if (value !== null && typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error(`Server-origin sync row scope column ${columnName} must be a string, finite number, or null`)
    }

    identity[columnName] = value
  }

  const rowModel = persistenceModel || syncModel

  return await syncModel.withAdvisoryLock(serverOriginSyncRowLockName(identity), async () => {
    const matchingSyncs = await rowModel
      .where(identity)
      .toArray()

    matchingSyncs.sort(compareServerOriginSyncRowsByRecency)

    const [existingSync, ...duplicateSyncs] = matchingSyncs

    for (const duplicateSync of duplicateSyncs) {
      await duplicateSync.destroy()
    }

    return await upsertSyncRow({attributes, existingSync, syncModel: rowModel})
  }, {dedicatedConnection: true})
}

/**
 * Validates one required string component of the server-origin identity.
 * @param {{attributes: Record<string, ReturnType<typeof JSON.parse>>, columnName: "resource_id" | "resource_type"}} args - Attributes and required column.
 * @returns {void}
 */
function validateRequiredIdentityString({attributes, columnName}) {
  const value = attributes[columnName]

  if (typeof value !== "string" || !value) {
    throw new Error(`Server-origin sync row ${columnName} must be a non-empty string`)
  }
}

/**
 * Returns the stable MySQL-safe advisory-lock name shared by every caller of a
 * complete server-origin identity. Stable JSON preserves null identity values,
 * while the truncated SHA-256 digest keeps the name under GET_LOCK's limit.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} identity - Complete sync-row identity in column form.
 * @returns {string} Advisory-lock name.
 */
function serverOriginSyncRowLockName(identity) {
  const hash = sha256Hex(stableJsonStringify(identity)).slice(0, 32)

  return `vsp:${hash}`
}

/**
 * Orders matching rows with the canonical deterministic survivor first:
 * newest server sequence, then lowest immutable id. A null legacy sequence is
 * older than every assigned sequence.
 * @param {ReturnType<typeof JSON.parse>} left - First matching sync row.
 * @param {ReturnType<typeof JSON.parse>} right - Second matching sync row.
 * @returns {number} Sort comparison.
 */
function compareServerOriginSyncRowsByRecency(left, right) {
  const leftSequence = left.serverSequence()
  const rightSequence = right.serverSequence()

  if (leftSequence === null && rightSequence !== null) return 1
  if (leftSequence !== null && rightSequence === null) return -1
  if (leftSequence !== rightSequence) return rightSequence - leftSequence

  return left.id().localeCompare(right.id())
}
