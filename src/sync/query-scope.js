// @ts-check

import stableJsonStringify from "./stable-json.js"

/**
 * Serializes a model query into a transportable sync scope.
 *
 * Only plain attribute equality conditions are supported: the scope must be
 * expressible as `{resourceType, conditions}` so servers can match it against
 * their change feeds. Anything else (raw SQL, negations, joins, orders,
 * limits, offsets, groups) fails loudly.
 * @param {import("../database/query/model-class-query.js").default<?>} query - Model query declaring the sync scope.
 * @returns {import("./sync-client-types.js").SerializedSyncScope} Serialized sync scope.
 */
export function serializedScopeFromQuery(query) {
  if (query.getJoins().length > 0) throw new Error("sync(query) does not support joins")
  if (query.getOrders().length > 0) throw new Error("sync(query) does not support orders")
  if (query.getLimit() !== null && query.getLimit() !== undefined) throw new Error("sync(query) does not support limit")
  if (query.getOffset() !== null && query.getOffset() !== undefined) throw new Error("sync(query) does not support offset")
  if (query.getGroups().length > 0) throw new Error("sync(query) does not support groups")

  const modelClass = query.getModelClass()
  const conditions = /** @type {Record<string, ?>} */ ({})

  for (const where of query.getWheres()) {
    const whereHash = /** @type {{hash?: Record<string, ?>}} */ (where).hash

    if (!whereHash || typeof whereHash !== "object" || Array.isArray(whereHash) || /** @type {{where?: ?}} */ (where).where) {
      throw new Error(`sync(query) only supports plain attribute conditions, got: ${where.constructor.name}`)
    }

    for (const [attributeName, value] of Object.entries(whereHash)) {
      const conditionValue = scalarConditionValue(attributeName, value)

      if (attributeName in conditions && stableJsonStringify(conditions[attributeName]) !== stableJsonStringify(conditionValue)) {
        throw new Error(`sync(query) got conflicting conditions for: ${attributeName}`)
      }

      conditions[attributeName] = conditionValue
    }
  }

  return {conditions, resourceType: modelClass.getModelName()}
}

/**
 * Returns a stable canonical key identifying a sync scope.
 * @param {import("./sync-client-types.js").SerializedSyncScope} scope - Serialized sync scope.
 * @returns {string} Stable scope key.
 */
export function scopeKey(scope) {
  return `${scope.resourceType}:${stableJsonStringify(scope.conditions)}`
}

/**
 * Validates one scope condition value as a scalar or array of scalars.
 * @param {string} attributeName - Condition attribute name for error messages.
 * @param {?} value - Condition value.
 * @returns {?} Validated condition value.
 */
function scalarConditionValue(attributeName, value) {
  if (Array.isArray(value)) {
    for (const item of value) validateScalar(attributeName, item)

    return value
  }

  validateScalar(attributeName, value)

  return value
}

/**
 * Validates one scalar condition value.
 * @param {string} attributeName - Condition attribute name for error messages.
 * @param {?} value - Condition value.
 * @returns {void}
 */
function validateScalar(attributeName, value) {
  if (value === null) return
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return

  throw new Error(`sync(query) condition values must be scalar, got ${typeof value} for: ${attributeName}`)
}
