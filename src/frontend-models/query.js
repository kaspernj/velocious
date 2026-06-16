// @ts-check

import {resolveFrontendModelClass} from "./model-registry.js"
import {normalizeRansackGroup, parseRansackSort} from "../utils/ransack.js"
import {isModelScopeDescriptor} from "../utils/model-scope.js"
import isPlainObject from "../utils/plain-object.js"

/**
 * FrontendModelSearch type.
 * @typedef {object} FrontendModelSearch
 * @property {string} column - Attribute name to search.
 * @property {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} operator - Search operator.
 * @property {string[]} path - Relationship path from root model.
 * @property {?} value - Search value.
 */
/**
 * FrontendModelTransportValue type.
 * @typedef {null | boolean | number | string | object} FrontendModelTransportValue
 */
/**
 * FrontendModelAttributeValue type.
 * @typedef {import("./base.js").FrontendModelAttributeValue} FrontendModelAttributeValue
 */
/**
 * Defines this typedef.
 * @typedef {{attributeName: string, relationshipName: string, where?: Record<string, FrontendModelTransportValue>}} FrontendModelWithCountPayloadEntry
 */
/**
 * Defines this typedef.
 * @typedef {{modelName: string, actions: string[]}} FrontendModelAbilitiesPayloadEntry
 */
/**
 * FrontendModelProjectionOptions type.
 * @typedef {object} FrontendModelProjectionOptions
 * @property {Record<string, string[] | string> | string | string[]} [select] - Model-aware attribute select map or root-model shorthand.
 * @property {Record<string, string[] | string> | string | string[]} [selectsExtra] - Extra attributes to load in addition to the defaults, keyed by model name or root-model shorthand.
 * @property {import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>} [preload] - Relationship preload tree.
 * @property {string | string[] | Record<string, boolean | {relationship?: string, where?: Record<string, FrontendModelTransportValue>}>} [withCount] - Association count spec.
 * @property {string[] | Record<string, string[]>} [abilities] - Ability actions to compute per record.
 * @property {string | Array<string | Record<string, FrontendModelTransportValue>> | Record<string, FrontendModelTransportValue>} [queryData] - Backend query data names/spec.
 */
/**
 * Defines this typedef.
 * @typedef {FrontendModelProjectionOptions & {query?: FrontendModelQuery<import("./base.js").FrontendModelClass>}} FrontendModelEventOptionsObject
 */
/**
 * FrontendModelEventOptions type.
 * @typedef {FrontendModelEventOptionsObject | FrontendModelQuery<import("./base.js").FrontendModelClass>} FrontendModelEventOptions
 */
/**
 * FrontendModelProjectionPayload type.
 * @typedef {object} FrontendModelProjectionPayload
 * @property {Record<string, string[]>} [select] - Normalized select map.
 * @property {Record<string, string[]>} [selectsExtra] - Normalized extra select map.
 * @property {import("../database/query/index.js").NestedPreloadRecord} [preload] - Normalized preload tree.
 * @property {FrontendModelWithCountPayloadEntry[]} [withCount] - Normalized count specs.
 * @property {FrontendModelAbilitiesPayloadEntry[]} [abilities] - Normalized ability specs.
 * @property {FrontendModelTransportValue} [queryData] - Normalized queryData spec.
 */
/**
 * FrontendModelEventFilterPayload type.
 * @typedef {object} FrontendModelEventFilterPayload
 * @property {Record<string, FrontendModelTransportValue>} [joins] - Relationship joins needed for matching.
 * @property {FrontendModelSearch[]} [searches] - Search predicates needed for matching.
 * @property {Record<string, FrontendModelTransportValue>} [where] - Structured where predicates needed for matching.
 */
/**
 * Defines this typedef.
 * @typedef {FrontendModelEventFilterPayload & {key: string}} FrontendModelEventFilterPayloadEntry
 */
/**
 * FrontendModelEventOptionsPayload type.
 * @typedef {object} FrontendModelEventOptionsPayload
 * @property {string | null} eventFilterKey - Stable event filter key, or null when no filter is present.
 * @property {FrontendModelEventFilterPayload | null} eventFilterPayload - Normalized event filter payload, or null when unfiltered.
 * @property {FrontendModelProjectionPayload} projectionPayload - Normalized event serialization projection payload.
 */

/**
 * Runs the normalizePreload helper.
 * @param {import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord> | boolean | undefined | null} preload - Preload shorthand.
 * @returns {import("../database/query/index.js").NestedPreloadRecord} - Normalized preload.
 */
export function normalizePreload(preload) {
  if (!preload) return {}

  if (preload === true) return {}

  if (typeof preload === "string") {
    return {[preload]: true}
  }

  if (Array.isArray(preload)) {
    /**
     * Normalized.
     * @type {import("../database/query/index.js").NestedPreloadRecord} */
    const normalized = {}

    for (const entry of preload) {
      if (typeof entry === "string") {
        normalized[entry] = true
        continue
      }

      if (isPlainObject(entry)) {
        mergePreloadRecord(normalized, normalizePreload(entry))
        continue
      }

      throw new Error(`Invalid preload entry type: ${typeof entry}`)
    }

    return normalized
  }

  if (!isPlainObject(preload)) {
    throw new Error(`Invalid preload type: ${typeof preload}`)
  }

  /**
   * Normalized.
   * @type {import("../database/query/index.js").NestedPreloadRecord} */
  const normalized = {}

  for (const [relationshipName, relationshipPreload] of Object.entries(preload)) {
    if (relationshipPreload === true || relationshipPreload === false) {
      normalized[relationshipName] = relationshipPreload
      continue
    }

    if (typeof relationshipPreload === "string" || Array.isArray(relationshipPreload) || isPlainObject(relationshipPreload)) {
      normalized[relationshipName] = normalizePreload(relationshipPreload)
      continue
    }

    throw new Error(`Invalid preload value for ${relationshipName}: ${typeof relationshipPreload}`)
  }

  return normalized
}

/**
 * Normalize the shorthand `withCount` argument from the frontend-model
 * query API into the strict internal entries used in the transport
 * payload. Shares the shape semantics with the backend normalizer in
 * `database/query/with-count.js`.
 * @param {string | string[] | Record<string, boolean | {relationship?: string, where?: Record<string, ?>}>} spec
 * @returns {Array<{attributeName: string, relationshipName: string, where?: Record<string, ?>}>}
 */
function normalizeWithCountFrontend(spec) {
  if (spec == null) return []

  if (typeof spec === "string") {
    return [{attributeName: `${spec}Count`, relationshipName: spec}]
  }

  if (Array.isArray(spec)) {
    return spec.flatMap((item) => {
      if (typeof item !== "string") {
        throw new Error(`withCount array entries must be strings; got ${typeof item}`)
      }

      return [{attributeName: `${item}Count`, relationshipName: item}]
    })
  }

  if (!isPlainObject(spec)) {
    throw new Error(`Invalid withCount spec: ${typeof spec}`)
  }

  const entries = []

  for (const [key, value] of Object.entries(spec)) {
    if (value === true) {
      entries.push({attributeName: `${key}Count`, relationshipName: key})
      continue
    }

    if (value === false) continue

    if (isPlainObject(value)) {
      const options = /**
                       * Narrows the runtime value to the documented type.
                       * @type {{relationship?: string, where?: Record<string, ?>}} */ (value)
      entries.push({
        attributeName: key,
        relationshipName: options.relationship || key,
        where: options.where
      })
      continue
    }

    throw new Error(`Invalid withCount value for ${key}: ${typeof value}`)
  }

  return entries
}

/**
 * Normalize a frontend `.abilities(...)` spec into a flat list of
 * `{modelName, actions}` entries. Accepts the flat actions-array
 * shorthand (applies to the query's own model class) and the keyed
 * `{ModelName: [action, ...]}` form (applies to records of that model
 * class, useful for preloaded children).
 * @param {string[] | Record<string, string[]>} spec
 * @param {{getModelName: () => string}} rootModelClass
 * @returns {Array<{modelName: string, actions: string[]}>}
 */
function normalizeAbilitiesSpec(spec, rootModelClass) {
  if (spec == null) return []

  if (Array.isArray(spec)) {
    for (const action of spec) {
      if (typeof action !== "string" || action.length < 1) {
        throw new Error(`abilities flat-form actions must be non-empty strings; got ${typeof action}`)
      }
    }

    const rootModelName = rootModelClass.getModelName()
    if (!rootModelName) {
      throw new Error("abilities flat-form requires a root model class with getModelName()")
    }

    return [{actions: [...spec], modelName: rootModelName}]
  }

  if (!isPlainObject(spec)) {
    throw new Error(`Invalid abilities spec: ${typeof spec}`)
  }

  /**
   * Entries.
   * @type {Array<{modelName: string, actions: string[]}>} */
  const entries = []

  for (const [modelName, actions] of Object.entries(spec)) {
    if (!Array.isArray(actions)) {
      throw new Error(`abilities[${modelName}] must be an array of action names; got ${typeof actions}`)
    }

    const sanitized = actions.map((action) => {
      if (typeof action !== "string" || action.length < 1) {
        throw new Error(`abilities[${modelName}] entries must be non-empty strings; got ${typeof action}`)
      }

      return action
    })

    entries.push({actions: sanitized, modelName})
  }

  return entries
}

/**
 * Runs merge preload record.
 * @param {import("../database/query/index.js").NestedPreloadRecord} targetPreload - Existing preload data.
 * @param {import("../database/query/index.js").NestedPreloadRecord} incomingPreload - New preload data.
 * @returns {void}
 */
function mergePreloadRecord(targetPreload, incomingPreload) {
  for (const [relationshipName, incomingValue] of Object.entries(incomingPreload)) {
    const existingValue = targetPreload[relationshipName]

    if (incomingValue === false) {
      targetPreload[relationshipName] = false
      continue
    }

    if (incomingValue === true) {
      if (existingValue === undefined) {
        targetPreload[relationshipName] = true
      }
      continue
    }

    if (!isPlainObject(incomingValue)) {
      throw new Error(`Invalid preload value for ${relationshipName}: ${typeof incomingValue}`)
    }

    if (isPlainObject(existingValue)) {
      mergePreloadRecord(
        /**
         * Narrows the runtime value to the documented type.
         * @type {import("../database/query/index.js").NestedPreloadRecord} */ (existingValue),
        /**
         * Narrows the runtime value to the documented type.
         * @type {import("../database/query/index.js").NestedPreloadRecord} */ (incomingValue)
      )
      continue
    }

    targetPreload[relationshipName] = normalizePreload(incomingValue)
  }
}

/**
 * Runs normalize select.
 * @param {?} select - Select payload.
 * @param {string | null} [rootModelName] - Optional root model name for shorthand select payloads.
 * @returns {Record<string, string[]>} - Normalized model-name keyed select record.
 */
function normalizeSelect(select, rootModelName = null) {
  if (!select) return {}

  if (typeof select === "string") {
    if (!rootModelName) throw new Error("Invalid select shorthand without root model name")

    return {[rootModelName]: [select]}
  }

  if (Array.isArray(select)) {
    if (!rootModelName) throw new Error("Invalid select shorthand without root model name")

    for (const attributeName of select) {
      if (typeof attributeName !== "string") {
        throw new Error(`Invalid select attribute for ${rootModelName}: ${typeof attributeName}`)
      }
    }

    return {[rootModelName]: Array.from(new Set(select))}
  }

  if (!isPlainObject(select)) {
    throw new Error(`Invalid select type: ${typeof select}`)
  }

  /**
   * Normalized.
   * @type {Record<string, string[]>} */
  const normalized = {}

  for (const [modelName, selection] of Object.entries(select)) {
    if (typeof selection === "string") {
      normalized[modelName] = [selection]
      continue
    }

    if (!Array.isArray(selection)) {
      throw new Error(`Invalid select value for ${modelName}: ${typeof selection}`)
    }

    for (const attributeName of selection) {
      if (typeof attributeName !== "string") {
        throw new Error(`Invalid select attribute for ${modelName}: ${typeof attributeName}`)
      }
    }

    normalized[modelName] = Array.from(new Set(selection))
  }

  return normalized
}

/**
 * Runs merge select record.
 * @param {Record<string, string[]>} targetSelect - Existing select record.
 * @param {Record<string, string[]>} incomingSelect - Incoming select record.
 * @returns {void}
 */
function mergeSelectRecord(targetSelect, incomingSelect) {
  for (const [modelName, incomingAttributes] of Object.entries(incomingSelect)) {
    const existingAttributes = targetSelect[modelName] || []

    targetSelect[modelName] = Array.from(new Set([...existingAttributes, ...incomingAttributes]))
  }
}

/**
 * Runs the normalizeSearchOperator helper.
 * @param {string} operator - Raw search operator.
 * @returns {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} - Normalized operator.
 */
export function normalizeSearchOperator(operator) {
  const operatorAliases = {
    "<": "lt",
    "<=": "lteq",
    ">": "gt",
    ">=": "gteq"
  }
  const normalizedOperator = operatorAliases[/**
                                              * Narrows the runtime value to the documented type.
                                              * @type {"<" | "<=" | ">" | ">="} */ (operator)] || operator
  const supportedOperators = new Set(["eq", "like", "notEq", "gt", "gteq", "lt", "lteq"])

  if (!supportedOperators.has(normalizedOperator)) {
    throw new Error(`search operator must be one of: eq, like, notEq, gt, gteq, lt, lteq, >, >=, <, <= (got: ${operator})`)
  }

  return /** @type {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} */ (normalizedOperator)
}

/**
 * Runs merge join record.
 * @param {Record<string, ?>} targetJoins - Existing join record.
 * @param {Record<string, ?>} incomingJoins - Incoming join record.
 * @returns {void}
 */
function mergeJoinRecord(targetJoins, incomingJoins) {
  for (const [relationshipName, incomingValue] of Object.entries(incomingJoins)) {
    const existingValue = targetJoins[relationshipName]

    if (incomingValue === true) {
      if (existingValue === undefined) {
        targetJoins[relationshipName] = true
      }
      continue
    }

    if (!isPlainObject(incomingValue)) {
      throw new Error(`Invalid join value for ${relationshipName}: ${typeof incomingValue}`)
    }

    if (isPlainObject(existingValue)) {
      mergeJoinRecord(existingValue, incomingValue)
      continue
    }

    if (existingValue === true) {
      targetJoins[relationshipName] = normalizeJoins(incomingValue)
      continue
    }

    targetJoins[relationshipName] = normalizeJoins(incomingValue)
  }
}

/**
 * Runs the normalizeJoins helper.
 * @param {?} joins - Join payload.
 * @returns {Record<string, ?>} - Normalized relationship descriptor joins.
 */
export function normalizeJoins(joins) {
  if (!joins) return {}

  if (Array.isArray(joins)) {
    /**
     * Normalized.
     * @type {Record<string, ?>} */
    const normalized = {}

    for (const joinEntry of joins) {
      if (!isPlainObject(joinEntry)) {
        throw new Error(`Invalid joins entry type: ${typeof joinEntry}`)
      }

      mergeJoinRecord(normalized, normalizeJoins(joinEntry))
    }

    return normalized
  }

  if (!isPlainObject(joins)) {
    throw new Error(`Invalid joins type: ${typeof joins}`)
  }

  /**
   * Normalized.
   * @type {Record<string, ?>} */
  const normalized = {}

  for (const [relationshipName, relationshipJoin] of Object.entries(joins)) {
    if (relationshipJoin === true) {
      normalized[relationshipName] = true
      continue
    }

    if (isPlainObject(relationshipJoin)) {
      normalized[relationshipName] = normalizeJoins(relationshipJoin)
      continue
    }

    throw new Error(`Invalid join definition for "${relationshipName}": ${typeof relationshipJoin}`)
  }

  return normalized
}

/**
 * FrontendModelSort type.
 * @typedef {object} FrontendModelSort
 * @property {string} column - Attribute name to sort by.
 * @property {"asc" | "desc"} direction - Sort direction.
 * @property {string[]} path - Relationship path from root model.
 */

/**
 * FrontendModelGroup type.
 * @typedef {object} FrontendModelGroup
 * @property {string} column - Attribute name to group by.
 * @property {string[]} path - Relationship path from root model.
 */

/**
 * FrontendModelPluck type.
 * @typedef {object} FrontendModelPluck
 * @property {string} column - Attribute name to pluck.
 * @property {string[]} path - Relationship path from root model.
 */

/**
 * Runs normalize sort direction.
 * @param {?} direction - Direction value.
 * @returns {"asc" | "desc"} - Normalized direction.
 */
function normalizeSortDirection(direction) {
  if (typeof direction !== "string") {
    throw new Error(`Invalid sort direction type: ${typeof direction}`)
  }

  const normalizedDirection = direction.trim().toLowerCase()

  if (normalizedDirection !== "asc" && normalizedDirection !== "desc") {
    throw new Error(`Invalid sort direction: ${direction}`)
  }

  return normalizedDirection
}

/**
 * Check whether a value is a two-item `[column, direction]` sort tuple.
 * @param {?} value - Candidate tuple.
 * @returns {value is [string, string]} - Whether value is a sort tuple.
 */
function sortTuple(value) {
  if (!Array.isArray(value)) return false
  if (value.length !== 2) return false
  if (typeof value[0] !== "string") return false
  if (typeof value[1] !== "string") return false
  if (value[0].trim().length < 1) return false

  const direction = value[1].trim().toLowerCase()

  return direction === "asc" || direction === "desc"
}

/**
 * Check whether a value is a structured sort descriptor with a relationship path.
 * @param {?} value - Candidate descriptor.
 * @returns {value is {column: string, direction: string, path: string[]}} - Whether value is an explicit sort descriptor object.
 */
function sortDescriptor(value) {
  if (!isPlainObject(value)) return false
  if (!("column" in value) || !("direction" in value) || !("path" in value)) return false
  if (typeof value.column !== "string") return false
  if (typeof value.direction !== "string") return false
  if (!Array.isArray(value.path)) return false

  return value.path.every((pathEntry) => typeof pathEntry === "string")
}

/**
 * Parse a string shorthand into a sort descriptor.
 * @param {string} sortValue - Sort string.
 * @param {string[]} [path] - Relationship path.
 * @returns {FrontendModelSort} - Normalized sort descriptor.
 */
function parseSortString(sortValue, path = []) {
  const trimmed = sortValue.trim()

  if (trimmed.length < 1) {
    throw new Error("sort value must be a non-empty string")
  }

  if (trimmed.startsWith("-")) {
    const column = trimmed.slice(1).trim()

    if (column.length < 1) {
      throw new Error(`Invalid sort definition: ${sortValue}`)
    }

    return {
      column,
      direction: "desc",
      path: [...path]
    }
  }

  const sortParts = trimmed.split(/\s+/).filter(Boolean)

  if (sortParts.length > 2) {
    throw new Error(`Invalid sort definition: ${sortValue}`)
  }

  const column = sortParts[0]

  if (column.length < 1) {
    throw new Error(`Invalid sort definition: ${sortValue}`)
  }

  const direction = sortParts.length === 2
    ? normalizeSortDirection(sortParts[1])
    : "asc"

  return {
    column,
    direction,
    path: [...path]
  }
}

/**
 * Parse a tuple shorthand into a sort descriptor.
 * @param {[string, string]} sortValue - Sort tuple.
 * @param {string[]} [path] - Relationship path.
 * @returns {FrontendModelSort} - Normalized sort descriptor.
 */
function parseSortTuple(sortValue, path = []) {
  const [columnValue, directionValue] = sortValue
  const column = columnValue.trim()

  if (column.length < 1) {
    throw new Error("sort tuple column must be a non-empty string")
  }

  return {
    column,
    direction: normalizeSortDirection(directionValue),
    path: [...path]
  }
}

/**
 * Normalize a nested object sort payload into flat sort descriptors.
 * @param {Record<string, ?>} sortValue - Nested sort object.
 * @param {string[]} path - Relationship path.
 * @returns {FrontendModelSort[]} - Normalized sort descriptors.
 */
function normalizeSortObject(sortValue, path) {
  /**
   * Normalized sorts.
   * @type {FrontendModelSort[]} */
  const normalizedSorts = []

  for (const [sortKey, sortEntry] of Object.entries(sortValue)) {
    if (typeof sortEntry === "string") {
      normalizedSorts.push({
        column: sortKey,
        direction: normalizeSortDirection(sortEntry),
        path: [...path]
      })
      continue
    }

    if (sortTuple(sortEntry)) {
      normalizedSorts.push(parseSortTuple(sortEntry, [...path, sortKey]))
      continue
    }

    if (Array.isArray(sortEntry)) {
      if (sortEntry.length < 1) {
        throw new Error(`Invalid sort definition for "${sortKey}": empty array`)
      }

      for (const nestedSortEntry of sortEntry) {
        if (!sortTuple(nestedSortEntry)) {
          throw new Error(`Invalid sort definition for "${sortKey}": expected [column, direction] tuples`)
        }

        normalizedSorts.push(parseSortTuple(nestedSortEntry, [...path, sortKey]))
      }
      continue
    }

    if (isPlainObject(sortEntry)) {
      normalizedSorts.push(...normalizeSortObject(sortEntry, [...path, sortKey]))
      continue
    }

    throw new Error(`Invalid sort definition for "${sortKey}": ${typeof sortEntry}`)
  }

  return normalizedSorts
}

/**
 * Normalize any supported sort payload into flat sort descriptors.
 * @param {?} sort - Sort payload.
 * @returns {FrontendModelSort[]} - Normalized sort definitions.
 */
export function normalizeSort(sort) {
  if (!sort) return []

  if (typeof sort === "string") {
    return [parseSortString(sort)]
  }

  if (sortTuple(sort)) {
    return [parseSortTuple(sort)]
  }

  if (sortDescriptor(sort)) {
    return [{
      column: sort.column.trim(),
      direction: normalizeSortDirection(sort.direction),
      path: [...sort.path]
    }]
  }

  if (isPlainObject(sort)) {
    return normalizeSortObject(sort, [])
  }

  if (Array.isArray(sort)) {
    /**
     * Normalized.
     * @type {FrontendModelSort[]} */
    const normalized = []

    for (const sortEntry of sort) {
      if (typeof sortEntry === "string") {
        normalized.push(parseSortString(sortEntry))
        continue
      }

      if (sortTuple(sortEntry)) {
        normalized.push(parseSortTuple(sortEntry))
        continue
      }

      if (sortDescriptor(sortEntry)) {
        normalized.push({
          column: sortEntry.column.trim(),
          direction: normalizeSortDirection(sortEntry.direction),
          path: [...sortEntry.path]
        })
        continue
      }

      if (isPlainObject(sortEntry)) {
        normalized.push(...normalizeSortObject(sortEntry, []))
        continue
      }

      throw new Error(`Invalid sort entry type: ${typeof sortEntry}`)
    }

    return normalized
  }

  throw new Error(`Invalid sort type: ${typeof sort}`)
}

/**
 * Parse a string shorthand into a group descriptor.
 * @param {string} groupValue - Group string.
 * @param {string[]} [path] - Relationship path.
 * @returns {FrontendModelGroup} - Normalized group descriptor.
 */
function parseGroupString(groupValue, path = []) {
  const trimmed = groupValue.trim()

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    throw new Error(`Invalid group column: ${groupValue}`)
  }

  return {
    column: trimmed,
    path: [...path]
  }
}

/**
 * Check whether a value is a structured column/path descriptor.
 * @param {?} value - Candidate descriptor.
 * @returns {value is {column: string, path: string[]}} - Whether candidate is an explicit column descriptor object.
 */
function columnPathDescriptor(value) {
  if (!isPlainObject(value)) return false
  if (!("column" in value) || !("path" in value)) return false
  if (typeof value.column !== "string") return false
  if (!Array.isArray(value.path)) return false

  return value.path.every((pathEntry) => typeof pathEntry === "string")
}

/**
 * Normalize a nested object column projection payload into flat descriptors.
 * @template {{column: string, path: string[]}} T
 * @param {Record<string, ?>} value - Nested projection object.
 * @param {string[]} path - Relationship path.
 * @param {(columnValue: string, path?: string[]) => T} parseString - String projection parser.
 * @param {string} label - Projection label for errors.
 * @returns {T[]} - Normalized projection descriptors.
 */
function normalizeColumnProjectionObject(value, path, parseString, label) {
  /**
   * Normalized.
   * @type {T[]} */
  const normalized = []

  for (const [projectionKey, projectionEntry] of Object.entries(value)) {
    if (typeof projectionEntry === "string") {
      normalized.push(parseString(projectionEntry, [...path, projectionKey]))
      continue
    }

    if (Array.isArray(projectionEntry)) {
      if (projectionEntry.length < 1) {
        throw new Error(`Invalid ${label} definition for "${projectionKey}": empty array`)
      }

      for (const nestedProjectionEntry of projectionEntry) {
        if (typeof nestedProjectionEntry !== "string") {
          throw new Error(`Invalid ${label} definition for "${projectionKey}": expected string columns`)
        }

        normalized.push(parseString(nestedProjectionEntry, [...path, projectionKey]))
      }

      continue
    }

    if (isPlainObject(projectionEntry)) {
      normalized.push(...normalizeColumnProjectionObject(projectionEntry, [...path, projectionKey], parseString, label))
      continue
    }

    throw new Error(`Invalid ${label} definition for "${projectionKey}": ${typeof projectionEntry}`)
  }

  return normalized
}

/**
 * Normalize any supported group payload into flat group descriptors.
 * @param {?} group - Group payload.
 * @returns {FrontendModelGroup[]} - Normalized group definitions.
 */
export function normalizeGroup(group) {
  if (!group) return []

  if (typeof group === "string") {
    return [parseGroupString(group)]
  }

  if (columnPathDescriptor(group)) {
    return [{
      column: parseGroupString(group.column).column,
      path: [...group.path]
    }]
  }

  if (isPlainObject(group)) {
    return normalizeColumnProjectionObject(group, [], parseGroupString, "group")
  }

  if (Array.isArray(group)) {
    /**
     * Normalized.
     * @type {FrontendModelGroup[]} */
    const normalized = []

    for (const groupEntry of group) {
      if (typeof groupEntry === "string") {
        normalized.push(parseGroupString(groupEntry))
        continue
      }

      if (columnPathDescriptor(groupEntry)) {
        normalized.push({
          column: parseGroupString(groupEntry.column).column,
          path: [...groupEntry.path]
        })
        continue
      }

      if (isPlainObject(groupEntry)) {
        normalized.push(...normalizeColumnProjectionObject(groupEntry, [], parseGroupString, "group"))
        continue
      }

      throw new Error(`Invalid group entry type: ${typeof groupEntry}`)
    }

    return normalized
  }

  throw new Error(`Invalid group type: ${typeof group}`)
}

/**
 * Parse a string shorthand into a pluck descriptor.
 * @param {string} pluckValue - Pluck string.
 * @param {string[]} [path] - Relationship path.
 * @returns {FrontendModelPluck} - Normalized pluck descriptor.
 */
function parsePluckString(pluckValue, path = []) {
  const trimmed = pluckValue.trim()

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    throw new Error(`Invalid pluck column: ${pluckValue}`)
  }

  return {
    column: trimmed,
    path: [...path]
  }
}

/**
 * Normalize any supported pluck payload into flat pluck descriptors.
 * @param {?} pluck - Pluck payload.
 * @returns {FrontendModelPluck[]} - Normalized pluck definitions.
 */
export function normalizePluck(pluck) {
  if (!pluck) return []

  if (typeof pluck === "string") {
    return [parsePluckString(pluck)]
  }

  if (columnPathDescriptor(pluck)) {
    return [{
      column: parsePluckString(pluck.column).column,
      path: [...pluck.path]
    }]
  }

  if (isPlainObject(pluck)) {
    return normalizeColumnProjectionObject(pluck, [], parsePluckString, "pluck")
  }

  if (Array.isArray(pluck)) {
    /**
     * Normalized.
     * @type {FrontendModelPluck[]} */
    const normalized = []

    for (const pluckEntry of pluck) {
      if (typeof pluckEntry === "string") {
        normalized.push(parsePluckString(pluckEntry))
        continue
      }

      if (columnPathDescriptor(pluckEntry)) {
        normalized.push({
          column: parsePluckString(pluckEntry.column).column,
          path: [...pluckEntry.path]
        })
        continue
      }

      if (isPlainObject(pluckEntry)) {
        normalized.push(...normalizeColumnProjectionObject(pluckEntry, [], parsePluckString, "pluck"))
        continue
      }

      throw new Error(`Invalid pluck entry type: ${typeof pluckEntry}`)
    }

    return normalized
  }

  throw new Error(`Invalid pluck type: ${typeof pluck}`)
}

/**
 * Runs frontend model resource attributes.
 * @param {import("./base.js").FrontendModelClass} modelClass - Model class.
 * @returns {Set<string>} - Resource attribute names.
 */
function frontendModelResourceAttributes(modelClass) {
  const resourceConfig = /**
                          * Narrows the runtime value to the documented type.
                          * @type {Record<string, ?>} */ (modelClass.resourceConfig())
  const attributes = resourceConfig.attributes

  if (Array.isArray(attributes)) {
    return new Set(attributes)
  }

  if (isPlainObject(attributes)) {
    return new Set(Object.keys(attributes))
  }

  return new Set()
}

/**
 * Runs frontend model pluck target model class.
 * @param {import("./base.js").FrontendModelClass} modelClass - Root model class.
 * @param {string[]} path - Relationship path.
 * @returns {import("./base.js").FrontendModelClass} - Target model class for path.
 */
function frontendModelPluckTargetModelClass(modelClass, path) {
  let targetModelClass = modelClass

  for (const relationshipName of path) {
    const relationshipDefinitions = targetModelClass.relationshipDefinitions()
    const relationshipModelClasses = targetModelClass.relationshipModelClasses()
    const relationshipDefinition = relationshipDefinitions[relationshipName]
    const relationshipTargetModelClass = resolveFrontendModelClass(relationshipModelClasses[relationshipName])

    if (!relationshipDefinition) {
      throw new Error(`Unknown pluck relationship "${relationshipName}" for ${targetModelClass.name}`)
    }

    if (!relationshipTargetModelClass) {
      throw new Error(`No relationship model class configured for ${targetModelClass.name}#${relationshipName}`)
    }

    targetModelClass = relationshipTargetModelClass
  }

  return targetModelClass
}

/**
 * Runs validate pluck definitions.
 * @param {object} args - Pluck validation args.
 * @param {import("./base.js").FrontendModelClass} args.modelClass - Root model class.
 * @param {FrontendModelPluck[]} args.pluck - Pluck descriptors.
 * @returns {FrontendModelPluck[]} - Validated pluck descriptors.
 */
function validatePluckDefinitions({modelClass, pluck}) {
  return pluck.map((pluckEntry) => {
    const targetModelClass = frontendModelPluckTargetModelClass(modelClass, pluckEntry.path)
    const targetAttributes = frontendModelResourceAttributes(targetModelClass)

    if (!targetAttributes.has(pluckEntry.column)) {
      throw new Error(`Unknown pluck column "${pluckEntry.column}" for ${targetModelClass.name}`)
    }

    return {
      column: pluckEntry.column,
      path: [...pluckEntry.path]
    }
  })
}

/**
 * Runs serialize find conditions.
 * @param {Record<string, ?>} conditions - findBy conditions.
 * @returns {string} - Serialized conditions for error messages.
 */
function serializeFindConditions(conditions) {
  try {
    return JSON.stringify(conditions)
  } catch {
    return "[unserializable conditions]"
  }
}

/**
 * Runs normalize integer argument.
 * @param {?} value - Candidate integer value.
 * @param {string} argumentName - Argument name for errors.
 * @param {object} options - Validation options.
 * @param {number} options.min - Minimum allowed value.
 * @returns {number} - Normalized integer value.
 */
function normalizeIntegerArgument(value, argumentName, {min}) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${argumentName} must be an integer number`)
  }

  if (value < min) {
    throw new Error(`${argumentName} must be greater than or equal to ${min}`)
  }

  return value
}

/**
 * Runs reverse sort direction.
 * @param {"asc" | "desc"} direction - Current sort direction.
 * @returns {"asc" | "desc"} - Reversed direction.
 */
function reverseSortDirection(direction) {
  return direction === "asc" ? "desc" : "asc"
}

/**
 * Query wrapper for frontend model commands.
 * @template {import("./base.js").FrontendModelClass} T
 */
export default class FrontendModelQuery {
  /**
   * Ransack.
   * @type {Record<string, ?>[]} */
  _ransack = []
  /**
   * Searches.
   * @type {FrontendModelSearch[]} */
  _searches = []
  /**
   * Sort.
   * @type {FrontendModelSort[]} */
  _sort = []
  /**
   * Group.
   * @type {FrontendModelGroup[]} */
  _group = []

  /**
   * Runs constructor.
   * @param {object} args - Constructor args.
   * @param {T} args.modelClass - Frontend model class.
   * @param {import("../database/query/index.js").NestedPreloadRecord} [args.preload] - Preload map.
   */
  constructor({modelClass, preload = {}}) {
    this.modelClass = modelClass
    this._preload = normalizePreload(preload)
    this._joins = {}
    this._where = {}
    this._searches = []
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, string[]>} */
    this._select = {}
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, string[]>} */
    this._selectsExtra = {}
    this._sort = []
    this._group = []
    this._distinct = false
    this._limit = null
    this._offset = null
    this._page = null
    this._perPage = null
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<{attributeName: string, relationshipName: string, where?: Record<string, ?>}>} */
    this._withCount = []
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<string | Record<string, ?>>} */
    this._queryData = []
    /**
     * Per-record ability spec. Normalized to a list of
     * `{modelName, actions}` entries — one entry per model that should
     * have ability results attached. The root query's model class
     * name is implicit via `"__root__"` when the caller used the flat
     * array form.
     * @type {Array<{modelName: string, actions: string[]}>}
     */
    this._abilities = []
  }

  /**
   * Tell the backend to evaluate one or more ability actions against
   * each returned record (and its preloaded relations, when keyed by
   * model name) and ship the results back so the frontend can read
   * them via `record.can(action)`.
   *
   * Flat form — applies to the query's own model class:
   *   ```
   *   const timelogs = await Timelog.where({taskId})
   *     .abilities(["update", "destroy"])
   *     .toArray()
   *   timelogs[0].can("update") // → boolean
   *   ```
   *
   * Keyed form — targets records by model name, useful for preloaded
   * children:
   *   ```
   *   const project = await Project
   *     .preload("timelogs")
   *     .abilities({Timelog: ["update", "destroy"]})
   *     .first()
   *   project.timelogs().loaded()[0].can("update") // → boolean
   *   ```
   *
   * Keys in the keyed form are the backend model names (as returned by
   * `ModelClass.getModelName()` / the `modelName` field of the
   * frontend-model resource config). Values are the ability-action
   * strings — typically `"update"` / `"destroy"` / `"create"` /
   * `"read"`, but any custom action registered on the resource's
   * authorization ability is accepted.
   * @param {string[] | Record<string, string[]>} spec
   * @returns {this}
   */
  abilities(spec) {
    for (const entry of normalizeAbilitiesSpec(spec, this.modelClass)) {
      this._mergeAbilityEntry(entry)
    }

    return this
  }

  /**
   * Runs merge ability entry.
   * @param {{modelName: string, actions: string[]}} entry
   * @returns {void}
   */
  _mergeAbilityEntry(entry) {
    const existing = this._abilities.find((candidate) => candidate.modelName === entry.modelName)

    if (!existing) {
      this._abilities.push({actions: [...entry.actions], modelName: entry.modelName})
      return
    }

    for (const action of entry.actions) {
      if (!existing.actions.includes(action)) existing.actions.push(action)
    }
  }

  /**
   * Tell the backend index query to attach one or more association
   * counts to each returned record. Parses the same shapes as the
   * backend `ModelClassQuery#withCount`, then ships the normalized
   * entries as part of the `index` command payload.
   * @param {string | string[] | Record<string, boolean | {relationship?: string, where?: Record<string, ?>}>} spec
   * @returns {this}
   */
  withCount(spec) {
    for (const entry of normalizeWithCountFrontend(spec)) {
      this._withCount.push(entry)
    }

    return this
  }

  /**
   * Request one or more backend queryData entries for each returned
   * record. The spec is a name or nested-record shape matching the
   * `Model.queryData(name, fn)` registrations on the backend — the
   * frontend ships only these names; the SQL fragments stay server-
   * side. All resulting aliases are attached to the root record and
   * read back with `record.queryData(aliasName)`.
   * @param {string | Array<string | Record<string, ?>> | Record<string, ?>} spec
   * @returns {this}
   */
  queryData(spec) {
    if (spec == null) return this

    this._queryData.push(/**
                          * Narrows the runtime value to the documented type.
                          * @type {?} */ (spec))

    return this
  }

  /**
   * Runs where.
   * @param {Record<string, ?>} conditions - Root-model where conditions.
   * @returns {this} - Query with merged where conditions.
   */
  where(conditions) {
    this.modelClass.assertFindByConditions(conditions)

    this._where = {
      ...this._where,
      ...conditions
    }

    return this
  }

  /**
   * Runs scope.
   * @param {import("../utils/model-scope.js").ModelScopeDescriptor} scopeDescriptor - Scope descriptor.
   * @returns {this} - Scoped query.
   */
  scope(scopeDescriptor) {
    if (!isModelScopeDescriptor(scopeDescriptor)) {
      throw new Error("scope() expects a descriptor returned by defineScope(...).scope(...)")
    }

    if (scopeDescriptor.modelClass !== this.modelClass) {
      throw new Error(`Cannot apply ${scopeDescriptor.modelClass.name} scope to ${this.modelClass.name} query`)
    }

    const scopedQuery = /**
                         * Narrows the runtime value to the documented type.
                         * @type {this | void} */ (scopeDescriptor.callback({
      driver: null,
      modelClass: this.modelClass,
      query: this,
      table: null
    }, ...scopeDescriptor.scopeArgs))

    return scopedQuery || this
  }

  /**
   * Runs ransack.
   * @param {Record<string, ?>} params - Ransack-style params hash. Supports `s` key for sorting (e.g., `{s: "name asc"}`).
   * @returns {this} - Query with Ransack filters and sort applied.
   */
  ransack(params) {
    const {s, ...filterParams} = params
    const hasFilters = Object.keys(filterParams).length > 0

    if (hasFilters) {
      normalizeRansackGroup(this.modelClass, filterParams)
      this._ransack.push(filterParams)
    }

    if (typeof s === "string" && s.trim().length > 0) {
      const sorts = parseRansackSort(this.modelClass, s)

      for (const sortDef of sorts) {
        this.sort([[sortDef.attribute, sortDef.direction]])
      }
    }

    return this
  }

  /**
   * Runs select with required root attributes.
   * @param {string[]} [requiredAttributes] - Extra required attributes for the root model.
   * @returns {Record<string, string[]>} - Select map with required root attributes merged when root select exists.
   */
  selectWithRequiredRootAttributes(requiredAttributes = []) {
    const rootModelName = this.modelClass.getModelName()
    const selectMap = /**
                       * Narrows the runtime value to the documented type.
                       * @type {Record<string, string[]>} */ (this._select)
    const existingRootAttributes = selectMap[rootModelName]

    if (!existingRootAttributes) {
      return selectMap
    }

    const rootPrimaryKey = this.modelClass.primaryKey()

    return {
      ...selectMap,
      [rootModelName]: Array.from(new Set([rootPrimaryKey, ...existingRootAttributes, ...requiredAttributes]))
    }
  }

  /**
   * Runs preload.
   * @param {import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>} preload - Preload to merge.
   * @returns {this} - Query with merged preloads.
   */
  preload(preload) {
    mergePreloadRecord(this._preload, normalizePreload(preload))

    return this
  }

  /**
   * Runs select.
   * @param {Record<string, string[] | string> | string | string[]} select - Model-aware attribute select map or root-model shorthand.
   * @returns {this} - Query with merged selected attributes.
   */
  select(select) {
    mergeSelectRecord(this._select, normalizeSelect(select, this.modelClass.getModelName()))

    return this
  }

  /**
   * Like `select(...)`, but keeps the default serialized attributes and loads
   * the given extras in addition (for example attributes declared
   * `selectedByDefault: false`). Keyed by model name, with root-model shorthand.
   * @param {Record<string, string[] | string> | string | string[]} select - Extra attributes to load, keyed by model name or root-model shorthand.
   * @returns {this} - Query with merged extra selected attributes.
   */
  selectsExtra(select) {
    mergeSelectRecord(this._selectsExtra, normalizeSelect(select, this.modelClass.getModelName()))

    return this
  }

  /**
   * Runs joins.
   * @param {Record<string, ?> | Array<Record<string, ?>>} joins - Relationship descriptor joins.
   * @returns {this} - Query with merged joins.
   */
  joins(joins) {
    mergeJoinRecord(this._joins, normalizeJoins(joins))

    return this
  }

  /**
   * Returns the search result.
   * @param {string[]} path - Relationship path.
   * @param {string} column - Column or attribute name.
   * @param {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | ">" | ">=" | "<" | "<="} operator - Search operator.
   * @param {?} value - Search value.
   * @returns {this} - Query with appended search.
   */
  search(path, column, operator, value) {
    if (!Array.isArray(path)) {
      throw new Error(`search path must be an array, got: ${typeof path}`)
    }

    for (const pathEntry of path) {
      if (typeof pathEntry !== "string" || pathEntry.length < 1) {
        throw new Error("search path entries must be non-empty strings")
      }
    }

    if (typeof column !== "string" || column.length < 1) {
      throw new Error("search column must be a non-empty string")
    }

    if (typeof operator !== "string" || operator.length < 1) {
      throw new Error("search operator must be a non-empty string")
    }

    const normalizedOperator = normalizeSearchOperator(operator)

    this._searches.push({
      column,
      operator: normalizedOperator,
      path: [...path],
      value
    })

    return this
  }

  /**
   * Runs sort.
   * @param {string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ?> | Array<Record<string, ?>>} sort - Sort definition(s).
   * @returns {this} - Query with appended sort definitions.
   */
  sort(sort) {
    this._sort.push(...normalizeSort(sort))

    return this
  }

  /**
   * Runs order.
   * @param {string | string[] | string[][] | [string, string] | Array<[string, string]> | Record<string, ?> | Array<Record<string, ?>>} order - Order definition(s).
   * @returns {this} - Query with appended sort definitions.
   */
  order(order) {
    return this.sort(order)
  }

  /**
   * Runs group.
   * @param {string | string[] | Record<string, ?> | Array<Record<string, ?>>} group - Group definition(s).
   * @returns {this} - Query with appended group definitions.
   */
  group(group) {
    this._group.push(...normalizeGroup(group))

    return this
  }

  /**
   * Runs distinct.
   * @param {boolean} [value] - Whether to request distinct rows.
   * @returns {this} - Query with distinct flag.
   */
  distinct(value = true) {
    if (typeof value !== "boolean") {
      throw new Error(`distinct must be a boolean, got: ${typeof value}`)
    }

    this._distinct = value

    return this
  }

  /**
   * Returns the limit result.
   * @param {number} value - Maximum number of records.
   * @returns {this} - Query with limit.
   */
  limit(value) {
    this._limit = normalizeIntegerArgument(value, "limit", {min: 0})
    this._page = null

    return this
  }

  /**
   * Runs offset.
   * @param {number} value - Number of records to skip.
   * @returns {this} - Query with offset.
   */
  offset(value) {
    this._offset = normalizeIntegerArgument(value, "offset", {min: 0})
    this._page = null

    return this
  }

  /**
   * Runs page.
   * @param {number} pageNumber - 1-based page number.
   * @returns {this} - Query with page applied.
   */
  page(pageNumber) {
    this._page = normalizeIntegerArgument(pageNumber, "page", {min: 1})
    const pageSize = this._perPage || 30

    this._limit = pageSize
    this._offset = (this._page - 1) * pageSize

    return this
  }

  /**
   * Runs per page.
   * @param {number} perPage - Page size.
   * @returns {this} - Query with per-page applied.
   */
  perPage(perPage) {
    this._perPage = normalizeIntegerArgument(perPage, "perPage", {min: 1})

    if (this._page !== null) {
      this._limit = this._perPage
      this._offset = (this._page - 1) * this._perPage
    }

    return this
  }

  /**
   * Runs clone.
   * @returns {FrontendModelQuery<T>} - Cloned query instance.
   */
  clone() {
    const newQuery = /**
                      * Narrows the runtime value to the documented type.
                      * @type {FrontendModelQuery<T>} */ (new FrontendModelQuery({
      modelClass: this.modelClass,
      preload: normalizePreload(this._preload)
    }))

    newQuery._joins = normalizeJoins(this._joins)
    newQuery._where = {...this._where}
    newQuery._ransack = this._ransack.map((ransackParams) => ({...ransackParams}))
    newQuery._searches = this._searches.map((search) => ({
      column: search.column,
      operator: search.operator,
      path: [...search.path],
      value: search.value
    }))
    newQuery._select = normalizeSelect(this._select)
    newQuery._selectsExtra = normalizeSelect(this._selectsExtra)
    newQuery._sort = this._sort.map((sortEntry) => ({
      column: sortEntry.column,
      direction: sortEntry.direction,
      path: [...sortEntry.path]
    }))
    newQuery._group = this._group.map((groupEntry) => ({
      column: groupEntry.column,
      path: [...groupEntry.path]
    }))
    newQuery._distinct = this._distinct
    newQuery._limit = this._limit
    newQuery._offset = this._offset
    newQuery._page = this._page
    newQuery._perPage = this._perPage
    newQuery._withCount = this._withCount.map((entry) => ({
      attributeName: entry.attributeName,
      relationshipName: entry.relationshipName,
      where: entry.where ? {...entry.where} : undefined
    }))
    newQuery._queryData = this._queryData.map((entry) => (
      typeof entry === "string" ? entry : {...entry}
    ))
    newQuery._abilities = this._abilities.map((entry) => ({
      actions: [...entry.actions],
      modelName: entry.modelName
    }))

    return newQuery
  }

  /**
   * Runs get model class.
   * @returns {T} - Root model class.
   */
  getModelClass() {
    return this.modelClass
  }

  /**
   * Runs preload payload.
   * @returns {Record<string, ?>} - Payload preload hash when present.
   */
  preloadPayload() {
    if (Object.keys(this._preload).length === 0) return {}

    return {preload: this._preload}
  }

  /**
   * Runs with count payload.
   * @returns {Record<string, ?>} - Payload withCount array when present.
   */
  withCountPayload() {
    if (this._withCount.length === 0) return {}

    return {
      withCount: this._withCount.map((entry) => ({
        attributeName: entry.attributeName,
        relationshipName: entry.relationshipName,
        where: entry.where || undefined
      }))
    }
  }

  /**
   * Runs abilities payload.
   * @returns {Record<string, ?>} - Payload abilities array when present.
   */
  abilitiesPayload() {
    if (this._abilities.length === 0) return {}

    return {
      abilities: this._abilities.map((entry) => ({
        actions: [...entry.actions],
        modelName: entry.modelName
      }))
    }
  }

  /**
   * Runs query data payload.
   * @returns {Record<string, ?>} - Payload queryData spec when present.
   */
  queryDataPayload() {
    if (this._queryData.length === 0) return {}

    // Single accumulated spec goes on the wire verbatim. The backend
    // normalizer accepts string/array/object at each level, so we can
    // ship multiple `.queryData(...)` calls as an array.
    return {
      queryData: this._queryData.length === 1 ? this._queryData[0] : this._queryData
    }
  }

  /**
   * Runs select payload.
   * @param {string[]} [requiredAttributes] - Extra required attributes for root model selection.
   * @returns {Record<string, ?>} - Payload select hash when present.
   */
  selectPayload(requiredAttributes = []) {
    const select = this.selectWithRequiredRootAttributes(requiredAttributes)

    if (Object.keys(select).length === 0) return {}

    return {select}
  }

  /**
   * Runs selects extra payload.
   * @returns {Record<string, ?>} - Payload selectsExtra hash when present.
   */
  selectsExtraPayload() {
    if (Object.keys(this._selectsExtra).length === 0) return {}

    return {selectsExtra: this._selectsExtra}
  }

  /**
   * Runs search payload.
   * @returns {Record<string, ?>} - Payload searches array when present.
   */
  searchPayload() {
    if (this._searches.length === 0) return {}

    return {
      searches: this._searches.map((search) => ({
        column: search.column,
        operator: search.operator,
        path: [...search.path],
        value: search.value
      }))
    }
  }

  /**
   * Runs ransack payload.
   * @returns {Record<string, ?>} - Payload ransack hash when present.
   */
  ransackPayload() {
    if (this._ransack.length === 0) return {}

    if (this._ransack.length === 1) {
      return {ransack: this._ransack[0]}
    }

    return {
      ransack: {
        g: this._ransack,
        m: "and"
      }
    }
  }

  /**
   * Runs joins payload.
   * @returns {Record<string, ?>} - Payload joins hash when present.
   */
  joinsPayload() {
    if (Object.keys(this._joins).length === 0) return {}

    return {
      joins: normalizeJoins(this._joins)
    }
  }

  /**
   * Runs sort payload.
   * @returns {Record<string, ?>} - Payload sort array when present.
   */
  sortPayload() {
    if (this._sort.length === 0) return {}

    return {
      sort: this._sort.map((sortEntry) => ({
        column: sortEntry.column,
        direction: sortEntry.direction,
        path: [...sortEntry.path]
      }))
    }
  }

  /**
   * Runs group payload.
   * @returns {Record<string, ?>} - Payload group array when present.
   */
  groupPayload() {
    if (this._group.length === 0) return {}

    return {
      group: this._group.map((groupEntry) => ({
        column: groupEntry.column,
        path: [...groupEntry.path]
      }))
    }
  }

  /**
   * Runs distinct payload.
   * @returns {Record<string, ?>} - Payload distinct flag when enabled.
   */
  distinctPayload() {
    if (!this._distinct) return {}

    return {
      distinct: true
    }
  }

  /**
   * Runs where payload.
   * @returns {Record<string, ?>} - Payload where hash when present.
   */
  wherePayload() {
    if (Object.keys(this._where).length === 0) return {}

    return {
      where: this._where
    }
  }

  /**
   * Runs pagination payload.
   * @returns {Record<string, ?>} - Payload pagination params when present.
   */
  paginationPayload() {
    /**
     * Payload.
     * @type {Record<string, ?>} */
    const payload = {}

    if (this._limit !== null) payload.limit = this._limit
    if (this._offset !== null) payload.offset = this._offset
    if (this._page !== null) payload.page = this._page
    if (this._perPage !== null) payload.perPage = this._perPage

    return payload
  }

  /**
   * Runs assert event query supported.
   * @returns {void}
   * @throws {Error} When the query contains list-only options that cannot filter a single lifecycle event.
   */
  assertEventQuerySupported() {
    /**
     * Unsupported options.
     * @type {string[]} */
    const unsupportedOptions = []

    if (this._sort.length > 0) unsupportedOptions.push("sort")
    if (this._group.length > 0) unsupportedOptions.push("group")
    if (this._distinct) unsupportedOptions.push("distinct")
    if (this._ransack.length > 0) unsupportedOptions.push("ransack")
    if (this._limit !== null || this._offset !== null || this._page !== null || this._perPage !== null) unsupportedOptions.push("pagination")

    if (unsupportedOptions.length === 0) return

    throw new Error(`Frontend model event queries do not support ${unsupportedOptions.join(", ")}`)
  }

  /**
   * Runs event projection payload.
   * @returns {FrontendModelProjectionPayload} - Projection payload used when serializing lifecycle events.
   */
  eventProjectionPayload() {
    this.assertEventQuerySupported()

    return {
      ...this.preloadPayload(),
      ...this.selectPayload(),
      ...this.selectsExtraPayload(),
      ...this.withCountPayload(),
      ...this.abilitiesPayload(),
      ...this.queryDataPayload()
    }
  }

  /**
   * Runs event filter payload.
   * @returns {FrontendModelEventFilterPayload | null} - Query pieces used to match lifecycle events.
   */
  eventFilterPayload() {
    this.assertEventQuerySupported()

    const payload = {
      ...this.joinsPayload(),
      ...this.searchPayload(),
      ...this.wherePayload()
    }

    return Object.keys(payload).length === 0 ? null : payload
  }

  /**
   * Returns the eventOptionsPayload result.
   * @returns {FrontendModelEventOptionsPayload} - Combined event filter and projection payload.
   */
  eventOptionsPayload() {
    const eventFilterPayload = this.eventFilterPayload()

    return {
      eventFilterKey: eventFilterPayload ? frontendModelEventFilterKey(eventFilterPayload) : null,
      eventFilterPayload,
      projectionPayload: this.eventProjectionPayload()
    }
  }

  /**
   * Runs load.
   * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
   */
  async load() {
    const response = await this.modelClass.executeCommand("index", {
      ...this.preloadPayload(),
      ...this.joinsPayload(),
      ...this.ransackPayload(),
      ...this.searchPayload(),
      ...this.selectPayload(),
      ...this.selectsExtraPayload(),
      ...this.groupPayload(),
      ...this.distinctPayload(),
      ...this.sortPayload(),
      ...this.wherePayload(),
      ...this.withCountPayload(),
      ...this.abilitiesPayload(),
      ...this.queryDataPayload(),
      ...this.paginationPayload()
    })

    if (!response || typeof response !== "object") {
      throw new Error(`Expected object response but got: ${response}`)
    }

    const modelsData = Array.isArray(response.models) ? response.models : []
    /**
     * Models.
     * @type {InstanceType<T>[]} */
    const models = modelsData.map((model) => this.modelClass.instantiateFromResponse(model))

    // Share a single cohort reference across every sibling so auto-batch-preload
    // can batch lazy relationship access later. Single-record lookups still flow
    // through here (with a cohort of one) and degrade cleanly to per-record load.
    for (const model of models) {
      /**
       * Narrows the runtime value to the documented type.
       * @type {?} */ (model)._loadCohort = models
    }

    return models
  }

  /**
   * Runs to array.
   * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
   */
  async toArray() {
    return await this.load()
  }

  /**
   * Runs count.
   * @returns {Promise<number>} - Number of loaded model instances.
   */
  async count() {
    const response = await this.modelClass.executeCommand("index", {
      ...this.joinsPayload(),
      ...this.ransackPayload(),
      ...this.searchPayload(),
      ...this.groupPayload(),
      ...this.distinctPayload(),
      ...this.wherePayload(),
      ...this.paginationPayload(),
      count: true
    })

    if (!response || typeof response !== "object") {
      throw new Error(`Expected object response but got: ${response}`)
    }

    if (!Number.isFinite(response.count)) {
      throw new Error(`Expected numeric count response but got: ${response.count}`)
    }

    return response.count
  }

  /**
   * Runs first.
   * @returns {Promise<InstanceType<T> | null>} - First model matching query.
   */
  async first() {
    const query = this.clone()

    if (query._sort.length < 1) {
      query.sort([[this.modelClass.primaryKey(), "asc"]])
    }

    query.limit(1)

    const models = await query.toArray()

    return models[0] || null
  }

  /**
   * Runs last.
   * @returns {Promise<InstanceType<T> | null>} - Last model matching query.
   */
  async last() {
    // When pagination is already applied, fetch that scoped window and return its last item.
    if (this._offset !== null || this._page !== null || this._perPage !== null) {
      const models = await this.toArray()

      if (models.length < 1) return null

      return models[models.length - 1]
    }

    const query = this.clone()

    if (query._sort.length < 1) {
      query.sort([[this.modelClass.primaryKey(), "desc"]])
    } else {
      query._sort = query._sort.map((sortEntry) => ({
        ...sortEntry,
        direction: reverseSortDirection(sortEntry.direction)
      }))
    }

    query.limit(1)

    const models = await query.toArray()

    return models[0] || null
  }

  /**
   * Runs pluck.
   * @param {...(string | string[] | Record<string, ?> | Array<Record<string, ?>>)} columns - Pluck definition(s).
   * @returns {Promise<Array<?>>} - Plucked values.
   */
  async pluck(...columns) {
    if (columns.length < 1) {
      throw new Error("No columns given to pluck")
    }

    const normalizedPluck = normalizePluck(columns.length === 1 ? columns[0] : columns)
    const validatedPluck = validatePluckDefinitions({
      modelClass: this.modelClass,
      pluck: normalizedPluck
    })
    const response = await this.modelClass.executeCommand("index", {
      ...this.joinsPayload(),
      ...this.searchPayload(),
      ...this.groupPayload(),
      ...this.distinctPayload(),
      ...this.sortPayload(),
      ...this.wherePayload(),
      ...this.paginationPayload(),
      pluck: validatedPluck
    })

    if (!response || typeof response !== "object") {
      throw new Error(`Expected object response but got: ${response}`)
    }

    if (!Array.isArray(response.values)) {
      return []
    }

    return response.values
  }

  /**
   * Runs find.
   * @param {number | string} id - Record id.
   * @returns {Promise<InstanceType<T>>} - Found model.
   */
  async find(id) {
    const pk = this.modelClass.primaryKey()
    const model = await this.findBy({[pk]: id})

    if (!model) {
      throw new Error(`${this.modelClass.getModelName()} not found with ${pk}=${id}`)
    }

    return model
  }

  /**
   * Runs find by.
   * @param {Record<string, ?>} conditions - Conditions.
   * @returns {Promise<InstanceType<T> | null>} - Found model or null.
   */
  async findBy(conditions) {
    const normalizedConditions = this.validatedStructuredConditions(conditions)
    const mergedWhere = {
      ...this._where,
      ...normalizedConditions
    }

    const response = await this.modelClass.executeCommand("index", {
      ...this.preloadPayload(),
      ...this.joinsPayload(),
      ...this.searchPayload(),
      ...this.selectPayload(Object.keys(mergedWhere)),
      ...this.selectsExtraPayload(),
      ...this.groupPayload(),
      ...this.distinctPayload(),
      ...this.sortPayload(),
      ...this.abilitiesPayload(),
      ...this.paginationPayload(),
      where: mergedWhere
    })

    if (!response || typeof response !== "object") {
      throw new Error(`Expected object response but got: ${response}`)
    }

    const models = Array.isArray(response.models) ? response.models : []

    for (const modelData of models) {
      const model = this.modelClass.instantiateFromResponse(modelData)

      if (this.modelClass.matchesFindByConditions(model, mergedWhere)) {
        return model
      }
    }

    return null
  }

  /**
   * Runs find by or fail.
   * @param {Record<string, ?>} conditions - Conditions.
   * @returns {Promise<InstanceType<T>>} - Found model.
   */
  async findByOrFail(conditions) {
    const model = await this.findBy(conditions)

    if (!model) {
      throw new Error(`${this.modelClass.name} not found for conditions: ${serializeFindConditions(conditions)}`)
    }

    return model
  }

  /**
   * Runs find or initialize by.
   * @param {Record<string, ?>} conditions - Conditions.
   * @returns {Promise<InstanceType<T>>} - Existing or initialized model.
   */
  async findOrInitializeBy(conditions) {
    const normalizedConditions = this.validatedStructuredConditions(conditions)
    const model = await this.findBy(conditions)

    if (model) return model

    const ModelClass = /** @type {new (attributes?: Record<string, FrontendModelAttributeValue>) => InstanceType<T>} */ (/** @type {unknown} */ (this.modelClass))

    return new ModelClass(/** @type {Record<string, FrontendModelAttributeValue>} */ (normalizedConditions))
  }

  /**
   * Runs find or create by.
   * @param {Record<string, ?>} conditions - Conditions.
   * @param {(model: InstanceType<T>) => Promise<void> | void} [callback] - Optional callback before save.
   * @returns {Promise<InstanceType<T>>} - Existing or newly created model.
   */
  async findOrCreateBy(conditions, callback) {
    const normalizedConditions = this.validatedStructuredConditions(conditions)
    const model = await this.findBy(conditions)

    if (model) return model

    const ModelClass = /** @type {new (attributes?: Record<string, FrontendModelAttributeValue>) => InstanceType<T>} */ (/** @type {unknown} */ (this.modelClass))
    const newModel = new ModelClass(/** @type {Record<string, FrontendModelAttributeValue>} */ (normalizedConditions))

    if (callback) {
      await callback(newModel)
    }

    await newModel.save()

    return newModel
  }

  /**
   * Runs validated structured conditions.
   * @param {Record<string, ?>} conditions - Candidate structured conditions.
   * @returns {Record<string, ?>} - Validated conditions.
   */
  validatedStructuredConditions(conditions) {
    this.modelClass.assertFindByConditions(conditions)

    return conditions
  }
}

/**
 * Runs frontend model event filter key.
 * @param {FrontendModelEventFilterPayload} payload - Event filter payload.
 * @returns {string} - Stable key for event filter matching.
 */
function frontendModelEventFilterKey(payload) {
  return JSON.stringify(payload)
}

/**
 * Runs apply frontend model projection options.
 * @param {FrontendModelQuery<import("./base.js").FrontendModelClass>} query - Query receiving projection options.
 * @param {FrontendModelProjectionOptions} options - Projection options.
 * @returns {void}
 */
function applyFrontendModelProjectionOptions(query, options) {
  if (options.select !== undefined) query.select(options.select)
  if (options.selectsExtra !== undefined) query.selectsExtra(options.selectsExtra)
  if (options.preload !== undefined) query.preload(options.preload)
  if (options.withCount !== undefined) query.withCount(options.withCount)
  if (options.abilities !== undefined) query.abilities(options.abilities)
  if (options.queryData !== undefined) query.queryData(options.queryData)
}

/**
 * Runs assert frontend model event query class.
 * @param {import("./base.js").FrontendModelClass} modelClass - Expected frontend model class.
 * @param {FrontendModelQuery<import("./base.js").FrontendModelClass>} query - Event query.
 * @returns {void}
 */
function assertFrontendModelEventQueryClass(modelClass, query) {
  if (query.modelClass === modelClass) return

  throw new Error(`Cannot subscribe ${modelClass.name} events with a ${query.modelClass.name} query`)
}

/**
 * Runs assert frontend model event options object.
 * @param {FrontendModelEventOptions} options - Candidate event options.
 * @returns {void}
 */
function assertFrontendModelEventOptionsObject(options) {
  if (options && typeof options === "object" && !Array.isArray(options)) return

  throw new Error(`Frontend model event options must be a query or an options object, got: ${options}`)
}

/**
 * Runs cloned frontend model event query.
 * @param {import("./base.js").FrontendModelClass} modelClass - Frontend model class.
 * @param {FrontendModelQuery<import("./base.js").FrontendModelClass>} query - Event query.
 * @returns {FrontendModelQuery<import("./base.js").FrontendModelClass>} - Cloned query used by event subscriptions.
 */
function clonedFrontendModelEventQuery(modelClass, query) {
  assertFrontendModelEventQueryClass(modelClass, query)

  return query.clone()
}

/**
 * Runs frontend model event query from options object.
 * @param {import("./base.js").FrontendModelClass} modelClass - Frontend model class.
 * @param {FrontendModelEventOptionsObject} options - Event options object.
 * @returns {FrontendModelQuery<import("./base.js").FrontendModelClass>} - Query used by event subscriptions.
 */
function frontendModelEventQueryFromOptionsObject(modelClass, options) {
  if (options.query !== undefined && !(options.query instanceof FrontendModelQuery)) {
    throw new Error("Frontend model event option query must be a FrontendModelQuery")
  }

  const query = options.query
    ? options.query.clone()
    : new FrontendModelQuery({modelClass})

  assertFrontendModelEventQueryClass(modelClass, query)

  return query
}

/**
 * Runs frontend model event query.
 * @param {import("./base.js").FrontendModelClass} modelClass - Frontend model class.
 * @param {FrontendModelEventOptions} [options] - Event query or projection options.
 * @returns {FrontendModelQuery<import("./base.js").FrontendModelClass>} - Normalized query used by event subscriptions.
 */
function frontendModelEventQuery(modelClass, options = {}) {
  if (options instanceof FrontendModelQuery) return clonedFrontendModelEventQuery(modelClass, options)

  assertFrontendModelEventOptionsObject(options)

  const optionsObject = /**
                         * Narrows the runtime value to the documented type.
                         * @type {FrontendModelEventOptionsObject} */ (options)
  const query = frontendModelEventQueryFromOptionsObject(modelClass, optionsObject)

  applyFrontendModelProjectionOptions(query, optionsObject)

  return query
}

/**
 * Runs the frontendModelEventOptionsPayload helper.
 * @param {import("./base.js").FrontendModelClass} modelClass - Frontend model class.
 * @param {FrontendModelEventOptions} [options] - Event query or projection options.
 * @returns {FrontendModelEventOptionsPayload} - Normalized event subscription payload.
 */
export function frontendModelEventOptionsPayload(modelClass, options = {}) {
  return frontendModelEventQuery(modelClass, options).eventOptionsPayload()
}
