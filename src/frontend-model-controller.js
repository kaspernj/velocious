// @ts-check

import Controller from "./controller.js"
import * as inflection from "inflection"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "./frontend-models/transport-serialization.js"

/**
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, any>} - Whether value is a plain object.
 */
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * @param {import("./database/query/index.js").NestedPreloadRecord | string | string[] | boolean | undefined | null} preload - Preload shorthand.
 * @returns {import("./database/query/index.js").NestedPreloadRecord | null} - Normalized preload.
 */
function normalizeFrontendModelPreload(preload) {
  if (!preload) return null

  if (preload === true) return {}

  if (typeof preload === "string") {
    return {[preload]: true}
  }

  if (Array.isArray(preload)) {
    /** @type {import("./database/query/index.js").NestedPreloadRecord} */
    const normalized = {}

    for (const entry of preload) {
      if (typeof entry === "string") {
        normalized[entry] = true
        continue
      }

      if (isPlainObject(entry)) {
        const nested = normalizeFrontendModelPreload(entry)

        if (nested) {
          mergeNormalizedPreload(normalized, nested)
        }
        continue
      }

      throw new Error(`Invalid preload entry type: ${typeof entry}`)
    }

    return normalized
  }

  if (!isPlainObject(preload)) {
    throw new Error(`Invalid preload type: ${typeof preload}`)
  }

  /** @type {import("./database/query/index.js").NestedPreloadRecord} */
  const normalized = {}

  for (const [relationshipName, relationshipPreload] of Object.entries(preload)) {
    if (relationshipPreload === true || relationshipPreload === false) {
      normalized[relationshipName] = relationshipPreload
      continue
    }

    if (typeof relationshipPreload === "string" || Array.isArray(relationshipPreload) || isPlainObject(relationshipPreload)) {
      const nested = normalizeFrontendModelPreload(relationshipPreload)

      normalized[relationshipName] = nested || {}
      continue
    }

    throw new Error(`Invalid preload value for ${relationshipName}: ${typeof relationshipPreload}`)
  }

  return normalized
}

/**
 * @param {import("./database/query/index.js").NestedPreloadRecord} target - Target preload object.
 * @param {import("./database/query/index.js").NestedPreloadRecord} source - Source preload object.
 * @returns {void} - Mutates target with merged nested preload tree.
 */
function mergeNormalizedPreload(target, source) {
  for (const [relationshipName, relationshipPreload] of Object.entries(source)) {
    const existingValue = target[relationshipName]

    if (relationshipPreload === false) {
      target[relationshipName] = false
      continue
    }

    if (relationshipPreload === true) {
      if (existingValue === undefined) {
        target[relationshipName] = true
      }
      continue
    }

    if (!isPlainObject(relationshipPreload)) {
      throw new Error(`Invalid preload value for ${relationshipName}: ${typeof relationshipPreload}`)
    }

    if (isPlainObject(existingValue)) {
      mergeNormalizedPreload(
        /** @type {import("./database/query/index.js").NestedPreloadRecord} */ (existingValue),
        /** @type {import("./database/query/index.js").NestedPreloadRecord} */ (relationshipPreload)
      )
      continue
    }

    target[relationshipName] = relationshipPreload
  }
}

/**
 * @param {Record<string, any>} target - Target joins object.
 * @param {Record<string, any>} source - Source joins object.
 * @returns {void} - Mutates target with merged nested joins tree.
 */
function mergeNormalizedJoins(target, source) {
  for (const [relationshipName, relationshipJoin] of Object.entries(source)) {
    const existingValue = target[relationshipName]

    if (relationshipJoin === true) {
      if (existingValue === undefined) {
        target[relationshipName] = true
      }
      continue
    }

    if (!isPlainObject(relationshipJoin)) {
      throw new Error(`Invalid join definition for "${relationshipName}": ${typeof relationshipJoin}`)
    }

    if (isPlainObject(existingValue)) {
      mergeNormalizedJoins(existingValue, relationshipJoin)
      continue
    }

    target[relationshipName] = relationshipJoin
  }
}

/**
 * @param {unknown} joins - Joins payload.
 * @returns {Record<string, any> | null} - Normalized relationship-object joins.
 */
function normalizeFrontendModelJoins(joins) {
  if (!joins) return null

  if (Array.isArray(joins)) {
    /** @type {Record<string, any>} */
    const normalized = {}

    for (const joinEntry of joins) {
      if (!isPlainObject(joinEntry)) {
        throw new Error(`Invalid joins entry type: ${typeof joinEntry}`)
      }

      const nested = normalizeFrontendModelJoins(joinEntry)

      if (nested) {
        mergeNormalizedJoins(normalized, nested)
      }
    }

    return normalized
  }

  if (!isPlainObject(joins)) {
    throw new Error(`Invalid joins type: ${typeof joins}`)
  }

  /** @type {Record<string, any>} */
  const normalized = {}

  for (const [relationshipName, relationshipJoin] of Object.entries(joins)) {
    if (relationshipJoin === true) {
      normalized[relationshipName] = true
      continue
    }

    if (isPlainObject(relationshipJoin)) {
      normalized[relationshipName] = normalizeFrontendModelJoins(relationshipJoin) || {}
      continue
    }

    throw new Error(`Invalid join definition for "${relationshipName}": ${typeof relationshipJoin}`)
  }

  return normalized
}

/**
 * @param {unknown} select - Select payload.
 * @returns {Record<string, string[]> | null} - Normalized model-name keyed select record.
 */
function normalizeFrontendModelSelect(select) {
  if (!select) return null

  if (!isPlainObject(select)) {
    throw new Error(`Invalid select type: ${typeof select}`)
  }

  /** @type {Record<string, string[]>} */
  const normalized = {}

  for (const [modelName, selectValue] of Object.entries(select)) {
    if (typeof selectValue === "string") {
      normalized[modelName] = [selectValue]
      continue
    }

    if (!Array.isArray(selectValue)) {
      throw new Error(`Invalid select value for ${modelName}: ${typeof selectValue}`)
    }

    for (const attributeName of selectValue) {
      if (typeof attributeName !== "string") {
        throw new Error(`Invalid select attribute for ${modelName}: ${typeof attributeName}`)
      }
    }

    normalized[modelName] = Array.from(new Set(selectValue))
  }

  return normalized
}

/**
 * @typedef {object} FrontendModelSearch
 * @property {string[]} path - Relationship path.
 * @property {string} column - Column or attribute name.
 * @property {"eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} operator - Search operator.
 * @property {any} value - Search value.
 */

/**
 * @typedef {object} FrontendModelSort
 * @property {string} column - Attribute name to sort by.
 * @property {"asc" | "desc"} direction - Sort direction.
 * @property {string[]} path - Relationship path from root model.
 */

/**
 * @typedef {object} FrontendModelGroup
 * @property {string} column - Attribute name to group by.
 * @property {string[]} path - Relationship path from root model.
 */

/**
 * @typedef {object} FrontendModelPluck
 * @property {string} column - Attribute name to pluck.
 * @property {string[]} path - Relationship path from root model.
 */

/**
 * @typedef {object} FrontendModelPagination
 * @property {number | null} limit - Maximum number of records.
 * @property {number | null} offset - Number of records to skip.
 * @property {number | null} page - 1-based page number.
 * @property {number | null} perPage - Page size.
 */

const frontendModelJoinedPathsSymbol = Symbol("frontendModelJoinedPaths")
const frontendModelGroupedColumnsSymbol = Symbol("frontendModelGroupedColumns")
const frontendModelWhereNoMatchSymbol = Symbol("frontendModelWhereNoMatch")
const frontendModelClientSafeErrorMessage = "Request failed."

/**
 * @param {unknown} direction - Direction candidate.
 * @returns {"asc" | "desc"} - Normalized direction.
 */
function normalizeFrontendModelSortDirection(direction) {
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
 * @param {unknown} value - Candidate tuple.
 * @returns {value is [string, string]} - Whether candidate is a sort tuple.
 */
function frontendModelSortTuple(value) {
  if (!Array.isArray(value)) return false
  if (value.length !== 2) return false
  if (typeof value[0] !== "string") return false
  if (typeof value[1] !== "string") return false
  if (value[0].trim().length < 1) return false

  const direction = value[1].trim().toLowerCase()

  return direction === "asc" || direction === "desc"
}

/**
 * @param {unknown} value - Candidate descriptor.
 * @returns {value is {column: string, direction: string, path: string[]}} - Whether candidate is an explicit sort descriptor object.
 */
function frontendModelSortDescriptor(value) {
  if (!isPlainObject(value)) return false
  if (!("column" in value) || !("direction" in value) || !("path" in value)) return false
  if (typeof value.column !== "string") return false
  if (typeof value.direction !== "string") return false
  if (!Array.isArray(value.path)) return false

  return value.path.every((pathEntry) => typeof pathEntry === "string")
}

/**
 * @param {unknown} value - Candidate descriptor.
 * @returns {value is {column: string, path: string[]}} - Whether candidate is an explicit group descriptor object.
 */
function frontendModelGroupDescriptor(value) {
  if (!isPlainObject(value)) return false
  if (!("column" in value) || !("path" in value)) return false
  if (typeof value.column !== "string") return false
  if (!Array.isArray(value.path)) return false

  return value.path.every((pathEntry) => typeof pathEntry === "string")
}

/**
 * @param {string} sortValue - Sort string.
 * @param {string[]} [path] - Relationship path.
 * @returns {FrontendModelSort} - Normalized sort descriptor.
 */
function frontendModelSortFromString(sortValue, path = []) {
  const trimmed = sortValue.trim()

  if (trimmed.length < 1) {
    throw new Error("Invalid sort value: expected non-empty string")
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
    ? normalizeFrontendModelSortDirection(sortParts[1])
    : "asc"

  return {
    column,
    direction,
    path: [...path]
  }
}

/**
 * @param {[string, string]} sortValue - Sort tuple.
 * @param {string[]} [path] - Relationship path.
 * @returns {FrontendModelSort} - Normalized sort descriptor.
 */
function frontendModelSortFromTuple(sortValue, path = []) {
  const [columnValue, directionValue] = sortValue
  const column = columnValue.trim()

  if (column.length < 1) {
    throw new Error("sort tuple column must be a non-empty string")
  }

  return {
    column,
    direction: normalizeFrontendModelSortDirection(directionValue),
    path: [...path]
  }
}

/**
 * @param {string} groupValue - Group string.
 * @param {string[]} [path] - Relationship path.
 * @returns {FrontendModelGroup} - Normalized group descriptor.
 */
function frontendModelGroupFromString(groupValue, path = []) {
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
 * @param {Record<string, any>} sortValue - Nested sort object.
 * @param {string[]} path - Relationship path.
 * @returns {FrontendModelSort[]} - Normalized sort descriptors.
 */
function normalizeFrontendModelSortObject(sortValue, path) {
  /** @type {FrontendModelSort[]} */
  const normalizedSorts = []

  for (const [sortKey, sortEntry] of Object.entries(sortValue)) {
    if (typeof sortEntry === "string") {
      normalizedSorts.push({
        column: sortKey,
        direction: normalizeFrontendModelSortDirection(sortEntry),
        path: [...path]
      })
      continue
    }

    if (frontendModelSortTuple(sortEntry)) {
      normalizedSorts.push(frontendModelSortFromTuple(sortEntry, [...path, sortKey]))
      continue
    }

    if (Array.isArray(sortEntry)) {
      if (sortEntry.length < 1) {
        throw new Error(`Invalid sort definition for "${sortKey}": empty array`)
      }

      for (const nestedSortEntry of sortEntry) {
        if (!frontendModelSortTuple(nestedSortEntry)) {
          throw new Error(`Invalid sort definition for "${sortKey}": expected [column, direction] tuples`)
        }

        normalizedSorts.push(frontendModelSortFromTuple(nestedSortEntry, [...path, sortKey]))
      }

      continue
    }

    if (isPlainObject(sortEntry)) {
      normalizedSorts.push(...normalizeFrontendModelSortObject(sortEntry, [...path, sortKey]))
      continue
    }

    throw new Error(`Invalid sort definition for "${sortKey}": ${typeof sortEntry}`)
  }

  return normalizedSorts
}

/**
 * @param {Record<string, any>} groupValue - Nested group object.
 * @param {string[]} path - Relationship path.
 * @returns {FrontendModelGroup[]} - Normalized group descriptors.
 */
function normalizeFrontendModelGroupObject(groupValue, path) {
  /** @type {FrontendModelGroup[]} */
  const normalizedGroups = []

  for (const [groupKey, groupEntry] of Object.entries(groupValue)) {
    if (typeof groupEntry === "string") {
      normalizedGroups.push(frontendModelGroupFromString(groupEntry, [...path, groupKey]))
      continue
    }

    if (Array.isArray(groupEntry)) {
      if (groupEntry.length < 1) {
        throw new Error(`Invalid group definition for "${groupKey}": empty array`)
      }

      for (const nestedGroupEntry of groupEntry) {
        if (typeof nestedGroupEntry !== "string") {
          throw new Error(`Invalid group definition for "${groupKey}": expected string columns`)
        }

        normalizedGroups.push(frontendModelGroupFromString(nestedGroupEntry, [...path, groupKey]))
      }

      continue
    }

    if (isPlainObject(groupEntry)) {
      normalizedGroups.push(...normalizeFrontendModelGroupObject(groupEntry, [...path, groupKey]))
      continue
    }

    throw new Error(`Invalid group definition for "${groupKey}": ${typeof groupEntry}`)
  }

  return normalizedGroups
}

/**
 * @param {unknown} searches - Search payload.
 * @returns {FrontendModelSearch[]} - Normalized searches.
 */
function normalizeFrontendModelSearches(searches) {
  if (!searches) return []

  if (!Array.isArray(searches)) {
    throw new Error(`Invalid searches type: ${typeof searches}`)
  }

  /** @type {FrontendModelSearch[]} */
  const normalized = []
  const supportedOperators = new Set(["eq", "notEq", "gt", "gteq", "lt", "lteq"])

  for (const search of searches) {
    if (!isPlainObject(search)) {
      throw new Error(`Invalid search entry type: ${typeof search}`)
    }

    const path = search.path
    const column = search.column
    const operator = search.operator

    if (!Array.isArray(path)) {
      throw new Error("Invalid search path: expected an array")
    }

    for (const pathEntry of path) {
      if (typeof pathEntry !== "string" || pathEntry.length < 1) {
        throw new Error("Invalid search path entry: expected non-empty string")
      }
    }

    if (typeof column !== "string" || column.length < 1) {
      throw new Error("Invalid search column: expected non-empty string")
    }

    if (typeof operator !== "string" || !supportedOperators.has(operator)) {
      throw new Error(`Invalid search operator: ${operator}`)
    }

    normalized.push({
      column,
      operator: /** @type {FrontendModelSearch["operator"]} */ (operator),
      path: [...path],
      value: search.value
    })
  }

  return normalized
}

/**
 * @param {unknown} where - Where payload.
 * @returns {Record<string, any> | null} - Normalized where hash.
 */
function normalizeFrontendModelWhere(where) {
  if (!where) return null

  if (!isPlainObject(where)) {
    throw new Error(`Invalid where type: ${typeof where}`)
  }

  return /** @type {Record<string, any>} */ (JSON.parse(JSON.stringify(where)))
}

/**
 * @param {unknown} value - Candidate integer.
 * @param {string} name - Param name for errors.
 * @param {number} min - Minimum allowed value.
 * @returns {number | null} - Normalized integer.
 */
function normalizeFrontendModelIntegerParam(value, name, min) {
  if (value == null) return null

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Invalid ${name}: expected integer number`)
  }

  if (value < min) {
    throw new Error(`Invalid ${name}: expected value >= ${min}`)
  }

  return value
}

/**
 * @param {object} args - Pagination args.
 * @param {unknown} args.limit - Limit payload.
 * @param {unknown} args.offset - Offset payload.
 * @param {unknown} args.page - Page payload.
 * @param {unknown} args.perPage - Per-page payload.
 * @returns {FrontendModelPagination} - Normalized pagination data.
 */
function normalizeFrontendModelPagination({limit, offset, page, perPage}) {
  return {
    limit: normalizeFrontendModelIntegerParam(limit, "limit", 0),
    offset: normalizeFrontendModelIntegerParam(offset, "offset", 0),
    page: normalizeFrontendModelIntegerParam(page, "page", 1),
    perPage: normalizeFrontendModelIntegerParam(perPage, "perPage", 1)
  }
}

/**
 * @param {unknown} distinct - Distinct payload.
 * @returns {boolean | null} - Normalized distinct flag when provided.
 */
function normalizeFrontendModelDistinct(distinct) {
  if (distinct == null) return null

  if (typeof distinct !== "boolean") {
    throw new Error(`Invalid distinct: expected boolean`)
  }

  return distinct
}

/**
 * @param {unknown} sort - Sort payload.
 * @returns {FrontendModelSort[]} - Normalized sort definitions.
 */
function normalizeFrontendModelSort(sort) {
  if (!sort) return []

  if (typeof sort === "string") {
    return [frontendModelSortFromString(sort)]
  }

  if (frontendModelSortTuple(sort)) {
    return [frontendModelSortFromTuple(sort)]
  }

  if (frontendModelSortDescriptor(sort)) {
    return [{
      column: sort.column.trim(),
      direction: normalizeFrontendModelSortDirection(sort.direction),
      path: [...sort.path]
    }]
  }

  if (isPlainObject(sort)) {
    return normalizeFrontendModelSortObject(sort, [])
  }

  if (Array.isArray(sort)) {
    /** @type {FrontendModelSort[]} */
    const normalized = []

    for (const sortEntry of sort) {
      if (typeof sortEntry === "string") {
        normalized.push(frontendModelSortFromString(sortEntry))
        continue
      }

      if (frontendModelSortTuple(sortEntry)) {
        normalized.push(frontendModelSortFromTuple(sortEntry))
        continue
      }

      if (frontendModelSortDescriptor(sortEntry)) {
        normalized.push({
          column: sortEntry.column.trim(),
          direction: normalizeFrontendModelSortDirection(sortEntry.direction),
          path: [...sortEntry.path]
        })
        continue
      }

      if (isPlainObject(sortEntry)) {
        normalized.push(...normalizeFrontendModelSortObject(sortEntry, []))
        continue
      }

      throw new Error(`Invalid sort entry type: ${typeof sortEntry}`)
    }

    return normalized
  }

  throw new Error(`Invalid sort type: ${typeof sort}`)
}

/**
 * @param {unknown} group - Group payload.
 * @returns {FrontendModelGroup[]} - Normalized group definitions.
 */
function normalizeFrontendModelGroup(group) {
  if (!group) return []

  if (typeof group === "string") {
    return [frontendModelGroupFromString(group)]
  }

  if (frontendModelGroupDescriptor(group)) {
    return [{
      column: frontendModelGroupFromString(group.column).column,
      path: [...group.path]
    }]
  }

  if (isPlainObject(group)) {
    return normalizeFrontendModelGroupObject(group, [])
  }

  if (Array.isArray(group)) {
    /** @type {FrontendModelGroup[]} */
    const normalized = []

    for (const groupEntry of group) {
      if (typeof groupEntry === "string") {
        normalized.push(frontendModelGroupFromString(groupEntry))
        continue
      }

      if (frontendModelGroupDescriptor(groupEntry)) {
        normalized.push({
          column: frontendModelGroupFromString(groupEntry.column).column,
          path: [...groupEntry.path]
        })
        continue
      }

      if (isPlainObject(groupEntry)) {
        normalized.push(...normalizeFrontendModelGroupObject(groupEntry, []))
        continue
      }

      throw new Error(`Invalid group entry type: ${typeof groupEntry}`)
    }

    return normalized
  }

  throw new Error(`Invalid group type: ${typeof group}`)
}

/**
 * @param {unknown} value - Candidate descriptor.
 * @returns {value is {column: string, path: string[]}} - Whether candidate is an explicit pluck descriptor object.
 */
function frontendModelPluckDescriptor(value) {
  if (!isPlainObject(value)) return false
  if (!("column" in value) || !("path" in value)) return false
  if (typeof value.column !== "string") return false
  if (!Array.isArray(value.path)) return false

  return value.path.every((pathEntry) => typeof pathEntry === "string")
}

/**
 * @param {string} pluckValue - Pluck string.
 * @param {string[]} [path] - Relationship path.
 * @returns {FrontendModelPluck} - Normalized pluck descriptor.
 */
function frontendModelPluckFromString(pluckValue, path = []) {
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
 * @param {Record<string, any>} pluckValue - Nested pluck object.
 * @param {string[]} path - Relationship path.
 * @returns {FrontendModelPluck[]} - Normalized pluck descriptors.
 */
function normalizeFrontendModelPluckObject(pluckValue, path) {
  /** @type {FrontendModelPluck[]} */
  const normalizedPlucks = []

  for (const [pluckKey, pluckEntry] of Object.entries(pluckValue)) {
    if (typeof pluckEntry === "string") {
      normalizedPlucks.push(frontendModelPluckFromString(pluckEntry, [...path, pluckKey]))
      continue
    }

    if (Array.isArray(pluckEntry)) {
      if (pluckEntry.length < 1) {
        throw new Error(`Invalid pluck definition for "${pluckKey}": empty array`)
      }

      for (const nestedPluckEntry of pluckEntry) {
        if (typeof nestedPluckEntry !== "string") {
          throw new Error(`Invalid pluck definition for "${pluckKey}": expected string columns`)
        }

        normalizedPlucks.push(frontendModelPluckFromString(nestedPluckEntry, [...path, pluckKey]))
      }

      continue
    }

    if (isPlainObject(pluckEntry)) {
      normalizedPlucks.push(...normalizeFrontendModelPluckObject(pluckEntry, [...path, pluckKey]))
      continue
    }

    throw new Error(`Invalid pluck definition for "${pluckKey}": ${typeof pluckEntry}`)
  }

  return normalizedPlucks
}

/**
 * @param {unknown} pluck - Pluck payload.
 * @returns {FrontendModelPluck[]} - Normalized pluck definitions.
 */
function normalizeFrontendModelPluck(pluck) {
  if (!pluck) return []

  if (typeof pluck === "string") {
    return [frontendModelPluckFromString(pluck)]
  }

  if (frontendModelPluckDescriptor(pluck)) {
    return [{
      column: frontendModelPluckFromString(pluck.column).column,
      path: [...pluck.path]
    }]
  }

  if (isPlainObject(pluck)) {
    return normalizeFrontendModelPluckObject(pluck, [])
  }

  if (Array.isArray(pluck)) {
    /** @type {FrontendModelPluck[]} */
    const normalized = []

    for (const pluckEntry of pluck) {
      if (typeof pluckEntry === "string") {
        normalized.push(frontendModelPluckFromString(pluckEntry))
        continue
      }

      if (frontendModelPluckDescriptor(pluckEntry)) {
        normalized.push({
          column: frontendModelPluckFromString(pluckEntry.column).column,
          path: [...pluckEntry.path]
        })
        continue
      }

      if (isPlainObject(pluckEntry)) {
        normalized.push(...normalizeFrontendModelPluckObject(pluckEntry, []))
        continue
      }

      throw new Error(`Invalid pluck entry type: ${typeof pluckEntry}`)
    }

    return normalized
  }

  throw new Error(`Invalid pluck type: ${typeof pluck}`)
}

/**
 * @param {string[]} path - Relationship path.
 * @returns {Record<string, any>} - Join object.
 */
function buildFrontendModelJoinObjectFromPath(path) {
  /** @type {Record<string, any>} */
  const joinObject = {}
  /** @type {Record<string, any>} */
  let currentNode = joinObject

  for (const relationshipName of path) {
    currentNode[relationshipName] = {}
    currentNode = currentNode[relationshipName]
  }

  return joinObject
}

/** Controller with built-in frontend model resource actions. */
export default class FrontendModelController extends Controller {
  /** @type {Record<string, any> | undefined} */
  _frontendModelParams = undefined
  /** @type {Record<string, any> | undefined} */
  _frontendModelParamsOverride = undefined

  /**
   * @returns {Record<string, any>} - Decoded request params.
   */
  frontendModelParams() {
    if (this._frontendModelParamsOverride) {
      return this._frontendModelParamsOverride
    }

    this._frontendModelParams ||= /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(this.params()))

    return this._frontendModelParams
  }

  /**
   * @template T
   * @param {Record<string, any>} params - Temporary frontend model params.
   * @param {() => Promise<T>} callback - Callback executed with temporary params.
   * @returns {Promise<T>} - Callback return value.
   */
  async withFrontendModelParams(params, callback) {
    const previousOverride = this._frontendModelParamsOverride
    const previousParams = this._frontendModelParams

    this._frontendModelParamsOverride = params
    this._frontendModelParams = undefined

    try {
      return await callback()
    } finally {
      this._frontendModelParamsOverride = previousOverride
      this._frontendModelParams = previousParams
    }
  }

  /**
   * @returns {typeof import("./database/record/index.js").default} - Frontend model class for controller resource actions.
   */
  frontendModelClass() {
    const frontendModelClass = this.frontendModelClassFromConfiguration()
    const params = this.frontendModelParams()
    const modelName = typeof params.model === "string" ? params.model : undefined
    const controllerName = typeof params.controller === "string" ? params.controller : undefined

    if (frontendModelClass) return frontendModelClass

    throw new Error(`No frontend model configured for model '${modelName || "unknown"}' and controller '${controllerName || "unknown"}'. Configure backendProjects resources.`)
  }

  /**
   * @returns {{backendProject: import("./configuration-types.js").BackendProjectConfiguration, modelName: string, resourceConfiguration: import("./configuration-types.js").FrontendModelResourceConfiguration} | null} - Frontend model resource configuration for current controller.
   */
  frontendModelResourceConfiguration() {
    const params = this.frontendModelParams()
    const modelName = typeof params.model === "string" ? params.model : undefined
    const controllerName = typeof params.controller === "string" ? params.controller : undefined
    const backendProjects = this.getConfiguration().getBackendProjects()

    for (const backendProject of backendProjects) {
      const resources = backendProject.frontendModels || backendProject.resources || {}

      if (modelName && modelName.length > 0 && resources[modelName]) {
        return {
          backendProject,
          modelName,
          resourceConfiguration: resources[modelName]
        }
      }

      if (!controllerName || controllerName.length < 1) continue

      for (const resourceModelName in resources) {
        const resourceConfiguration = resources[resourceModelName]
        const resourcePath = this.frontendModelResourcePath(resourceModelName, resourceConfiguration)

        if (this.frontendModelResourceMatchesController({controllerName, resourcePath})) {
          return {backendProject, modelName: resourceModelName, resourceConfiguration}
        }
      }
    }

    return null
  }

  /**
   * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
   * @returns {{modelName: string, resourceConfiguration: import("./configuration-types.js").FrontendModelResourceConfiguration} | null} - Frontend model resource configuration for model class.
   */
  frontendModelResourceConfigurationForModelClass(modelClass) {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) return null

    const resources = frontendModelResource.backendProject.frontendModels || frontendModelResource.backendProject.resources || {}
    const resourceConfiguration = resources[modelClass.name]

    if (!resourceConfiguration) return null

    return {
      modelName: modelClass.name,
      resourceConfiguration
    }
  }

  /**
   * @returns {typeof import("./database/record/index.js").default | null} - Frontend model class resolved from backend project configuration.
   */
  frontendModelClassFromConfiguration() {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) return null

    const modelClasses = this.getConfiguration().getModelClasses()
    const modelClass = modelClasses[frontendModelResource.modelName]

    if (!modelClass) {
      throw new Error(`Frontend model '${frontendModelResource.modelName}' is configured for '${this.frontendModelParams().controller}', but no model class was registered. Registered models: ${Object.keys(modelClasses).join(", ")}`)
    }

    return modelClass
  }

  /**
   * @param {string} modelName - Model class name.
   * @param {import("./configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Resource configuration.
   * @returns {string} - Normalized resource path.
   */
  frontendModelResourcePath(modelName, resourceConfiguration) {
    if (resourceConfiguration.path) return `/${resourceConfiguration.path.replace(/^\/+/, "")}`

    return `/${inflection.dasherize(inflection.pluralize(modelName))}`
  }

  /**
   * @param {object} args - Arguments.
   * @param {string} args.controllerName - Controller name from params.
   * @param {string} args.resourcePath - Resource path from configuration.
   * @returns {boolean} - Whether resource path matches current controller.
   */
  frontendModelResourceMatchesController({controllerName, resourcePath}) {
    const normalizedController = controllerName.replace(/^\/+|\/+$/g, "")
    const normalizedResourcePath = resourcePath.replace(/^\/+|\/+$/g, "")

    if (normalizedResourcePath === normalizedController) return true

    return normalizedResourcePath.endsWith(`/${normalizedController}`)
  }

  /**
   * @returns {import("./configuration-types.js").FrontendModelResourceServerConfiguration | null} - Optional server behavior config for frontend model actions.
   */
  frontendModelServerConfiguration() {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) return null

    return frontendModelResource.resourceConfiguration.server || null
  }

  /**
   * @returns {string} - Frontend model primary key.
   */
  frontendModelPrimaryKey() {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) {
      throw new Error(`No frontend model resource configuration for controller '${this.frontendModelParams().controller}'`)
    }

    return frontendModelResource.resourceConfiguration.primaryKey || "id"
  }

  /**
   * @param {"index" | "find" | "create" | "update" | "destroy"} action - Frontend action.
   * @returns {string} - Ability action configured for the frontend action.
   */
  frontendModelAbilityAction(action) {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) {
      throw new Error(`No frontend model resource configuration for controller '${this.frontendModelParams().controller}'`)
    }

    const abilities = frontendModelResource.resourceConfiguration.abilities

    if (!abilities || typeof abilities !== "object") {
      throw new Error(`Resource '${frontendModelResource.modelName}' must define an 'abilities' object`)
    }

    const abilityAction = abilities[action]

    if (typeof abilityAction !== "string" || abilityAction.length < 1) {
      throw new Error(`Resource '${frontendModelResource.modelName}' must define abilities.${action}`)
    }

    return abilityAction
  }

  /**
   * @param {"index" | "find" | "create" | "update" | "destroy"} action - Frontend action.
   * @returns {import("./database/query/model-class-query.js").default<any>} - Authorized query for the action.
   */
  frontendModelAuthorizedQuery(action) {
    const abilityAction = this.frontendModelAbilityAction(action)

    return this.frontendModelClass().accessibleFor(abilityAction)
  }

  /**
   * @param {import("./database/record/index.js").default} model - Model instance.
   * @returns {string} - Primary key value as string.
   */
  frontendModelPrimaryKeyValue(model) {
    const value = model.attributes()[this.frontendModelPrimaryKey()]

    return String(value)
  }

  /**
   * @param {object} args - Arguments.
   * @param {"index" | "find" | "create" | "update" | "destroy"} args.action - Frontend action.
   * @param {import("./database/record/index.js").default[]} args.models - Candidate models.
   * @returns {Promise<import("./database/record/index.js").default[]>} - Authorized models.
   */
  async frontendModelFilterAuthorizedModels({action, models}) {
    if (models.length === 0) return models

    const primaryKey = this.frontendModelPrimaryKey()
    const ids = models.map((model) => this.frontendModelPrimaryKeyValue(model))
    const authorizedIdsRaw = await this.frontendModelAuthorizedQuery(action).where({[primaryKey]: ids}).pluck(primaryKey)
    const authorizedIds = new Set(authorizedIdsRaw.map((id) => String(id)))

    return models.filter((model) => authorizedIds.has(this.frontendModelPrimaryKeyValue(model)))
  }

  /**
   * @param {"index" | "find" | "create" | "update" | "destroy"} action - Frontend action.
   * @returns {Promise<boolean>} - Whether action should continue.
   */
  async runFrontendModelBeforeAction(action) {
    const serverConfiguration = this.frontendModelServerConfiguration()

    if (!serverConfiguration?.beforeAction) return true

    const modelClass = this.frontendModelClass()
    const result = await serverConfiguration.beforeAction({
      action,
      controller: this,
      modelClass,
      params: this.frontendModelParams()
    })

    return result !== false
  }

  /**
   * @param {"find" | "update" | "destroy"} action - Frontend action.
   * @param {string | number} id - Record id.
   * @returns {Promise<import("./database/record/index.js").default | null>} - Located model record.
   */
  async frontendModelFindRecord(action, id) {
    const modelClass = this.frontendModelClass()
    const serverConfiguration = this.frontendModelServerConfiguration()
    const primaryKey = this.frontendModelPrimaryKey()

    if (serverConfiguration?.find) {
      const model = await serverConfiguration.find({
        action,
        controller: this,
        id,
        modelClass,
        params: this.frontendModelParams()
      })

      if (!model) return null

      const authorizedModels = await this.frontendModelFilterAuthorizedModels({action, models: [model]})

      return authorizedModels[0] || null
    }

    let query = this.frontendModelAuthorizedQuery(action)
    const preload = action === "find" ? this.frontendModelPreload() : null

    if (preload) {
      query = query.preload(preload)
    }

    return await query.findBy({[primaryKey]: id})
  }

  /**
   * @param {Record<string, any>} attributes - Create attributes.
   * @returns {Promise<import("./database/record/index.js").default | null>} - Created model when authorized.
   */
  async frontendModelCreateRecord(attributes) {
    const modelClass = this.frontendModelClass()
    const serverConfiguration = this.frontendModelServerConfiguration()
    const params = this.frontendModelParams()
    /** @type {import("./database/record/index.js").default} */
    let model

    if (serverConfiguration?.create) {
      const callbackModel = await serverConfiguration.create({
        action: "create",
        attributes,
        controller: this,
        modelClass,
        params
      })

      if (!callbackModel) {
        throw new Error("Expected server.create to return a model.")
      }

      model = callbackModel
    } else {
      model = new modelClass(attributes)
      await model.save()
    }

    const authorizedModels = await this.frontendModelFilterAuthorizedModels({action: "create", models: [model]})

    if (authorizedModels.length > 0) {
      return authorizedModels[0]
    }

    if (!serverConfiguration?.create) {
      await model.destroy()
    }

    return null
  }

  /**
   * @returns {Promise<import("./database/record/index.js").default[]>} - Frontend model records.
   */
  async frontendModelRecords() {
    const modelClass = this.frontendModelClass()
    const serverConfiguration = this.frontendModelServerConfiguration()

    if (serverConfiguration?.records) {
      const models = await serverConfiguration.records({
        action: "index",
        controller: this,
        modelClass,
        params: this.frontendModelParams()
      })

      return await this.frontendModelFilterAuthorizedModels({action: "index", models})
    }

    return await this.frontendModelIndexQuery().toArray()
  }

  /**
   * @returns {import("./database/query/index.js").NestedPreloadRecord | null} - Frontend preload data.
   */
  frontendModelPreload() {
    return normalizeFrontendModelPreload(this.frontendModelParams().preload)
  }

  /**
   * @returns {Record<string, string[]> | null} - Frontend select data.
   */
  frontendModelSelect() {
    return normalizeFrontendModelSelect(this.frontendModelParams().select)
  }

  /**
   * @returns {FrontendModelSearch[]} - Frontend search filters.
   */
  frontendModelSearches() {
    return normalizeFrontendModelSearches(this.frontendModelParams().searches)
  }

  /**
   * @returns {Record<string, any> | null} - Frontend where filters.
   */
  frontendModelWhere() {
    return normalizeFrontendModelWhere(this.frontendModelParams().where)
  }

  /** @returns {Record<string, any> | null} - Frontend joins descriptors. */
  frontendModelJoins() {
    return normalizeFrontendModelJoins(this.frontendModelParams().joins)
  }

  /** @returns {FrontendModelSort[]} - Frontend sort definitions. */
  frontendModelSort() {
    return normalizeFrontendModelSort(this.frontendModelParams().sort)
  }

  /** @returns {FrontendModelGroup[]} - Frontend group definitions. */
  frontendModelGroup() {
    return normalizeFrontendModelGroup(this.frontendModelParams().group)
  }

  /** @returns {FrontendModelPagination} - Frontend pagination params. */
  frontendModelPagination() {
    const params = this.frontendModelParams()

    return normalizeFrontendModelPagination({
      limit: params.limit,
      offset: params.offset,
      page: params.page,
      perPage: params.perPage
    })
  }

  /** @returns {boolean | null} - Frontend distinct flag when provided. */
  frontendModelDistinct() {
    return normalizeFrontendModelDistinct(this.frontendModelParams().distinct)
  }

  /** @returns {FrontendModelPluck[]} - Frontend pluck definitions. */
  frontendModelPluck() {
    return normalizeFrontendModelPluck(this.frontendModelParams().pluck)
  }

  /**
   * @returns {import("./database/query/model-class-query.js").default} - Frontend index query with normalized params applied.
   */
  frontendModelIndexQuery() {
    let query = this.frontendModelAuthorizedQuery("index")
    const preload = this.frontendModelPreload()

    if (preload) {
      query = query.preload(preload)
    }

    const joins = this.frontendModelJoins()
    const where = this.frontendModelWhere()
    const pagination = this.frontendModelPagination()
    const distinct = this.frontendModelDistinct()

    this.applyFrontendModelPagination({pagination, query})

    if (distinct !== null) {
      query.distinct(distinct)
    }

    if (where) {
      this.applyFrontendModelWhere({query, where})
    }

    if (joins) {
      this.applyFrontendModelJoins({joins, query})
    }

    const searches = this.frontendModelSearches()

    for (const search of searches) {
      this.applyFrontendModelSearch({query, search})
    }

    const groups = this.frontendModelGroup()

    if (groups.length > 0) {
      this.applyFrontendModelRootGroupColumns({query})
    }

    for (const group of groups) {
      this.applyFrontendModelGroup({group, query})
    }

    const sorts = this.frontendModelSort()

    for (const sort of sorts) {
      this.applyFrontendModelSort({query, sort})
    }

    if (query._distinct && query.driver.getType() === "mssql") {
      return this.frontendModelMssqlDistinctByPrimaryKeyQuery({query})
    }

    return query
  }

  /**
   * MSSQL cannot apply DISTINCT over non-comparable text columns in table.* selects.
   * This rewrites distinct frontend-model queries to select root records by distinct PK subquery.
   * @param {object} args - Args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query with distinct and filters.
   * @returns {import("./database/query/model-class-query.js").default} - MSSQL-safe distinct query.
   */
  frontendModelMssqlDistinctByPrimaryKeyQuery({query}) {
    const modelClass = this.frontendModelClass()
    const primaryKey = modelClass.primaryKey()
    const rootTableSql = query.driver.quoteTable(modelClass.tableName())
    const primaryKeySql = `${rootTableSql}.${query.driver.quoteColumn(primaryKey)}`
    const distinctIdsQuery = query.clone()

    distinctIdsQuery._preload = {}
    distinctIdsQuery._selects = []
    distinctIdsQuery.select(primaryKeySql)
    distinctIdsQuery.distinct(true)

    const distinctRootQuery = modelClass._newQuery()

    distinctRootQuery.where(`${primaryKeySql} IN (${distinctIdsQuery.toSql()})`)
    distinctRootQuery._preload = {...query._preload}

    return distinctRootQuery
  }

  /**
   * @param {object} args - Pluck args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {FrontendModelPluck[]} args.pluck - Pluck descriptors.
   * @returns {Promise<any[]>} - Plucked values.
   */
  async frontendModelPluckValues({query, pluck}) {
    if (pluck.length < 1) {
      throw new Error("No columns given to pluck")
    }

    const modelClass = this.frontendModelClass()
    const pluckQuery = query.clone()
    const aliases = []
    const joinedPaths = query[frontendModelJoinedPathsSymbol]

    pluckQuery._preload = {}
    pluckQuery._selects = []
    pluckQuery[frontendModelJoinedPathsSymbol] = joinedPaths ? new Set(joinedPaths) : new Set()

    for (const [pluckIndex, pluckEntry] of pluck.entries()) {
      const targetModelClass = this.frontendModelSearchTargetModelClass({
        modelClass,
        path: pluckEntry.path
      })
      const attributeNameToColumnNameMap = targetModelClass.getAttributeNameToColumnNameMap()
      const columnName = attributeNameToColumnNameMap[pluckEntry.column]

      if (!columnName) {
        throw new Error(`Unknown pluck column "${pluckEntry.column}" for ${targetModelClass.name}`)
      }

      if (pluckEntry.path.length > 0) {
        this.ensureFrontendModelJoinPath({path: pluckEntry.path, query: pluckQuery})
      }

      const tableReference = pluckQuery.getTableReferenceForJoin(...pluckEntry.path)
      const columnSql = `${pluckQuery.driver.quoteTable(tableReference)}.${pluckQuery.driver.quoteColumn(columnName)}`
      const alias = `frontend_model_pluck_${pluckIndex}`

      pluckQuery.select(`${columnSql} AS ${pluckQuery.driver.quoteColumn(alias)}`)
      aliases.push(alias)
    }

    const rows = await pluckQuery.results()

    if (aliases.length === 1) {
      const [alias] = aliases

      return rows.map((row) => row[alias])
    }

    return rows.map((row) => aliases.map((alias) => row[alias]))
  }

  /**
   * @param {object} args - Search args.
   * @param {typeof import("./database/record/index.js").default} args.modelClass - Root model class.
   * @param {string[]} args.path - Relationship path.
   * @returns {typeof import("./database/record/index.js").default} - Target model class.
   */
  frontendModelSearchTargetModelClass({modelClass, path}) {
    let targetModelClass = modelClass

    for (const relationshipName of path) {
      const relationship = targetModelClass.getRelationshipsMap()[relationshipName]

      if (!relationship) {
        throw new Error(`Unknown search relationship "${relationshipName}" for ${targetModelClass.name}`)
      }

      const relationshipTargetModelClass = relationship.getTargetModelClass()

      if (!relationshipTargetModelClass) {
        throw new Error(`No target model class for ${targetModelClass.name}#${relationshipName}`)
      }

      targetModelClass = relationshipTargetModelClass
    }

    return targetModelClass
  }

  /**
   * @param {object} args - Search args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {FrontendModelSearch} args.search - Search filter.
   * @returns {void}
   */
  applyFrontendModelSearch({query, search}) {
    const modelClass = this.frontendModelClass()
    const targetModelClass = this.frontendModelSearchTargetModelClass({
      modelClass,
      path: search.path
    })
    const columnName = targetModelClass.getAttributeNameToColumnNameMap()[search.column]

    if (!columnName) {
      throw new Error(`Unknown search column "${search.column}" for ${targetModelClass.name}`)
    }

    if (search.path.length > 0) {
      this.ensureFrontendModelJoinPath({path: search.path, query})
    }

    const tableReference = query.getTableReferenceForJoin(...search.path)
    const columnSql = `${query.driver.quoteTable(tableReference)}.${query.driver.quoteColumn(columnName)}`
    const operatorMap = {
      eq: "=",
      gt: ">",
      gteq: ">=",
      lt: "<",
      lteq: "<=",
      notEq: "!="
    }
    const sqlOperator = operatorMap[search.operator]

    if (search.operator === "eq") {
      if (Array.isArray(search.value)) {
        if (search.value.length === 0) {
          query.where("1=0")
        } else {
          query.where(`${columnSql} IN (${search.value.map((entry) => query.driver.quote(entry)).join(", ")})`)
        }

        return
      }

      if (search.value === null) {
        query.where(`${columnSql} IS NULL`)
        return
      }
    }

    if (search.operator === "notEq") {
      if (Array.isArray(search.value)) {
        if (search.value.length === 0) {
          query.where("1=1")
        } else {
          query.where(`${columnSql} NOT IN (${search.value.map((entry) => query.driver.quote(entry)).join(", ")})`)
        }

        return
      }

      if (search.value === null) {
        query.where(`${columnSql} IS NOT NULL`)
        return
      }
    }

    query.where(`${columnSql} ${sqlOperator} ${query.driver.quote(search.value)}`)
  }

  /**
   * @param {object} args - Pagination args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {FrontendModelPagination} args.pagination - Pagination values.
   * @returns {void}
   */
  applyFrontendModelPagination({query, pagination}) {
    if (pagination.limit !== null) {
      query.limit(pagination.limit)
    }

    if (pagination.offset !== null) {
      query.offset(pagination.offset)
    }

    if (pagination.perPage !== null) {
      query.perPage(pagination.perPage)
    }

    if (pagination.page !== null) {
      query.page(pagination.page)
    }
  }

  /**
   * @param {object} args - Where args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {Record<string, any>} args.where - Root-model where conditions.
   * @returns {void}
   */
  applyFrontendModelWhere({query, where}) {
    this.applyFrontendModelWhereForPath({
      modelClass: this.frontendModelClass(),
      path: [],
      query,
      where
    })
  }

  /**
   * @param {object} args - Joins args.
   * @param {Record<string, any>} args.joins - Relationship-object joins.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @returns {void}
   */
  applyFrontendModelJoins({joins, query}) {
    const joinPathKeys = new Set()

    this.applyFrontendModelJoinsForPath({
      joins,
      joinPathKeys,
      modelClass: this.frontendModelClass(),
      path: [],
      query
    })

    query.joins(joins)

    const joinedPaths = query[frontendModelJoinedPathsSymbol] || new Set()

    for (const joinPathKey of joinPathKeys) {
      joinedPaths.add(joinPathKey)
    }

    query[frontendModelJoinedPathsSymbol] = joinedPaths
  }

  /**
   * @param {object} args - Joins args.
   * @param {Record<string, any>} args.joins - Joins for current path.
   * @param {Set<string>} args.joinPathKeys - Joined path keys.
   * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class for current path.
   * @param {string[]} args.path - Relationship path.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @returns {void}
   */
  applyFrontendModelJoinsForPath({joins, joinPathKeys, modelClass, path, query}) {
    void query

    for (const [relationshipName, relationshipJoin] of Object.entries(joins)) {
      const relationship = modelClass.getRelationshipsMap()[relationshipName]

      if (!relationship) {
        throw new Error(`Unknown join relationship "${relationshipName}" for ${modelClass.name}`)
      }

      const targetModelClass = relationship.getTargetModelClass()

      if (!targetModelClass) {
        throw new Error(`No target model class for join relationship "${relationshipName}" on ${modelClass.name}`)
      }

      const relationshipPath = [...path, relationshipName]
      joinPathKeys.add(relationshipPath.join("."))

      if (relationshipJoin === true) continue

      this.applyFrontendModelJoinsForPath({
        joins: relationshipJoin,
        joinPathKeys,
        modelClass: targetModelClass,
        path: relationshipPath,
        query
      })
    }
  }

  /**
   * @param {object} args - Where args.
   * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class for current where scope.
   * @param {string[]} args.path - Relationship path from root.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {Record<string, any>} args.where - Where conditions for current scope.
   * @returns {void}
   */
  applyFrontendModelWhereForPath({modelClass, path, query, where}) {
    const attributeNameToColumnNameMap = modelClass.getAttributeNameToColumnNameMap()

    for (const [attributeName, value] of Object.entries(where)) {
      const columnName = attributeNameToColumnNameMap[attributeName]

      if (columnName) {
        this.ensureFrontendModelJoinPath({path, query})

        const tableReference = query.getTableReferenceForJoin(...path)
        const columnSql = `${query.driver.quoteTable(tableReference)}.${query.driver.quoteColumn(columnName)}`

        if (Array.isArray(value)) {
          if (value.length === 0) {
            query.where("1=0")
          } else {
            const normalizedValues = value.map((entry) => this.normalizeFrontendModelWhereColumnValue({columnName, modelClass, value: entry}))

            if (normalizedValues.includes(frontendModelWhereNoMatchSymbol)) {
              query.where("1=0")
            } else {
              query.where(`${columnSql} IN (${normalizedValues.map((entry) => query.driver.quote(entry)).join(", ")})`)
            }
          }

          continue
        }

        if (value == null) {
          query.where(`${columnSql} IS NULL`)
        } else {
          const normalizedValue = this.normalizeFrontendModelWhereColumnValue({columnName, modelClass, value})

          if (normalizedValue === frontendModelWhereNoMatchSymbol) {
            query.where("1=0")
          } else {
            query.where(`${columnSql} = ${query.driver.quote(normalizedValue)}`)
          }
        }

        continue
      }

      if (isPlainObject(value)) {
        const relationship = modelClass.getRelationshipsMap()[attributeName]

        if (!relationship) {
          throw new Error(`Unknown where relationship "${attributeName}" for ${modelClass.name}`)
        }

        const targetModelClass = relationship.getTargetModelClass()

        if (!targetModelClass) {
          throw new Error(`No target model class for where relationship "${attributeName}" on ${modelClass.name}`)
        }

        const relationshipPath = [...path, attributeName]

        this.applyFrontendModelWhereForPath({
          modelClass: targetModelClass,
          path: relationshipPath,
          query,
          where: value
        })

        continue
      }

      throw new Error(`Unknown where column "${attributeName}" for ${modelClass.name}`)
    }
  }

  /**
   * @param {object} args - Args.
   * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class.
   * @param {string} args.columnName - Column name.
   * @param {unknown} args.value - Where value.
   * @returns {unknown | symbol} - SQL-safe where value.
   */
  normalizeFrontendModelWhereColumnValue({columnName, modelClass, value}) {
    if (isPlainObject(value)) {
      const columnType = modelClass.getColumnTypeByName(columnName)

      if (typeof columnType !== "string") {
        return frontendModelWhereNoMatchSymbol
      }

      const normalizedType = columnType.toLowerCase()
      const objectValueTypes = new Set(["char", "varchar", "nvarchar", "string", "enum", "json", "jsonb", "citext", "binary", "varbinary"])
      const supportsObjectValues = normalizedType.includes("text") || objectValueTypes.has(normalizedType)

      if (!supportsObjectValues) {
        return frontendModelWhereNoMatchSymbol
      }

      return JSON.stringify(value)
    }

    return value
  }

  /**
   * @param {object} args - Group args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {FrontendModelGroup} args.group - Group definition.
   * @returns {void}
   */
  applyFrontendModelGroup({query, group}) {
    const modelClass = this.frontendModelClass()
    const targetModelClass = this.frontendModelSearchTargetModelClass({
      modelClass,
      path: group.path
    })
    const attributeNameToColumnNameMap = targetModelClass.getAttributeNameToColumnNameMap()
    const columnName = attributeNameToColumnNameMap[group.column]

    if (!columnName) {
      throw new Error(`Unknown group column "${group.column}" for ${targetModelClass.name}`)
    }

    this.ensureFrontendModelJoinPath({path: group.path, query})

    const tableReference = query.getTableReferenceForJoin(...group.path)
    const columnSql = `${query.driver.quoteTable(tableReference)}.${query.driver.quoteColumn(columnName)}`

    this.ensureFrontendModelGroupColumn({columnSql, query})
  }

  /**
   * Adds root-model columns to GROUP BY so strict SQL engines accept default root-table selects.
   * @param {object} args - Args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @returns {void}
   */
  applyFrontendModelRootGroupColumns({query}) {
    const modelClass = this.frontendModelClass()
    const attributeNameToColumnNameMap = modelClass.getAttributeNameToColumnNameMap()
    const rootTableReference = query.getTableReferenceForJoin()

    for (const columnName of Object.values(attributeNameToColumnNameMap)) {
      const columnSql = `${query.driver.quoteTable(rootTableReference)}.${query.driver.quoteColumn(columnName)}`

      this.ensureFrontendModelGroupColumn({columnSql, query})
    }
  }

  /**
   * Ensures a group-by SQL column is only appended once.
   * @param {object} args - Args.
   * @param {string} args.columnSql - Fully-qualified column SQL.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @returns {void}
   */
  ensureFrontendModelGroupColumn({columnSql, query}) {
    const groupedColumns = query[frontendModelGroupedColumnsSymbol] || new Set()

    if (groupedColumns.has(columnSql)) return

    query.group(columnSql)
    groupedColumns.add(columnSql)
    query[frontendModelGroupedColumnsSymbol] = groupedColumns
  }

  /**
   * @param {object} args - Sort args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {FrontendModelSort} args.sort - Sort definition.
   * @returns {void}
   */
  applyFrontendModelSort({query, sort}) {
    const modelClass = this.frontendModelClass()
    const targetModelClass = this.frontendModelSearchTargetModelClass({
      modelClass,
      path: sort.path
    })
    const attributeNameToColumnNameMap = targetModelClass.getAttributeNameToColumnNameMap()
    const translatedAttributesMap = targetModelClass.getTranslationsMap()
    const translatedAttributeNames = Object.keys(translatedAttributesMap)
    const isTranslatedSortAttribute = translatedAttributeNames.includes(sort.column)

    const columnName = attributeNameToColumnNameMap[sort.column]
    const direction = sort.direction.toUpperCase()

    if (isTranslatedSortAttribute) {
      const translationModelClass = targetModelClass.getTranslationClass()
      const translationAttributeNameToColumnNameMap = translationModelClass.getAttributeNameToColumnNameMap()
      const translationColumnName = translationAttributeNameToColumnNameMap[sort.column]
      const translationPath = sort.path.concat(["translations"])

      if (!translationColumnName) {
        throw new Error(`Unknown translated sort column "${sort.column}" for ${targetModelClass.name}`)
      }

      this.ensureFrontendModelSortJoinPath({path: translationPath, query})

      const translationTableReference = query.getTableReferenceForJoin(...translationPath)
      const translationColumnSql = `${query.driver.quoteTable(translationTableReference)}.${query.driver.quoteColumn(translationColumnName)}`

      query.order(`${translationColumnSql} ${direction}`)

      return
    }

    if (!columnName) {
      throw new Error(`Unknown sort column "${sort.column}" for ${targetModelClass.name}`)
    }

    this.ensureFrontendModelSortJoinPath({path: sort.path, query})

    const tableReference = query.getTableReferenceForJoin(...sort.path)
    const columnSql = `${query.driver.quoteTable(tableReference)}.${query.driver.quoteColumn(columnName)}`

    query.order(`${columnSql} ${direction}`)
  }

  /**
   * Ensures a sort join path has been joined on query.
   * @param {object} args - Join args.
   * @param {string[]} args.path - Relationship join path.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @returns {void}
   */
  ensureFrontendModelSortJoinPath({path, query}) {
    this.ensureFrontendModelJoinPath({path, query})
  }

  /**
   * Ensures a relationship path has exactly one SQL join.
   * @param {object} args - Join args.
   * @param {string[]} args.path - Relationship join path.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @returns {void}
   */
  ensureFrontendModelJoinPath({path, query}) {
    if (path.length < 1) return

    const joinedPaths = query[frontendModelJoinedPathsSymbol] || new Set()
    const pathKey = path.join(".")

    if (joinedPaths.has(pathKey)) return

    query.joins(buildFrontendModelJoinObjectFromPath(path))
    joinedPaths.add(pathKey)
    query[frontendModelJoinedPathsSymbol] = joinedPaths
  }

  /**
   * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
   * @returns {string[] | null} - Selected attributes for model class.
   */
  frontendModelSelectedAttributesForModelClass(modelClass) {
    const select = this.frontendModelSelect()

    if (!select) return null

    return select[modelClass.name] || null
  }

  /**
   * @param {import("./database/record/index.js").default} model - Model instance.
   * @returns {Record<string, any>} - Serialized attributes filtered by select map.
   */
  serializeFrontendModelAttributes(model) {
    const modelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor)
    const selectedAttributes = this.frontendModelSelectedAttributesForModelClass(modelClass)
    const modelAttributes = model.attributes()

    if (!selectedAttributes) {
      return modelAttributes
    }

    /** @type {Record<string, any>} */
    const serializedAttributes = {}

    for (const attributeName of selectedAttributes) {
      if (attributeName in modelAttributes) {
        serializedAttributes[attributeName] = modelAttributes[attributeName]
      }
    }

    return serializedAttributes
  }

  /**
   * @param {object} args - Arguments.
   * @param {import("./database/record/index.js").default[]} args.models - Frontend model records.
   * @param {boolean} args.relationshipIsCollection - Whether relation is has-many.
   * @returns {Promise<import("./database/record/index.js").default[]>} - Serializable related models.
   */
  async frontendModelFilterSerializableRelatedModels({models, relationshipIsCollection}) {
    if (!this.currentAbility()) return models
    if (models.length === 0) return models

    /** @type {Map<typeof import("./database/record/index.js").default, import("./database/record/index.js").default[]>} */
    const modelsByClass = new Map()

    for (const model of models) {
      const relatedModelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor)
      const existingModelsForClass = modelsByClass.get(relatedModelClass) || []

      existingModelsForClass.push(model)
      modelsByClass.set(relatedModelClass, existingModelsForClass)
    }

    /** @type {Map<typeof import("./database/record/index.js").default, Set<string>>} */
    const authorizedIdsByClass = new Map()
    /** @type {Map<typeof import("./database/record/index.js").default, string>} */
    const primaryKeysByClass = new Map()

    for (const [relatedModelClass, relatedModels] of modelsByClass.entries()) {
      const relatedResource = this.frontendModelResourceConfigurationForModelClass(relatedModelClass)

      if (!relatedResource) {
        authorizedIdsByClass.set(relatedModelClass, new Set())
        continue
      }

      const abilityAction = relationshipIsCollection
        ? relatedResource.resourceConfiguration.abilities?.index
        : relatedResource.resourceConfiguration.abilities?.find

      if (typeof abilityAction !== "string" || abilityAction.length < 1) {
        authorizedIdsByClass.set(relatedModelClass, new Set())
        continue
      }

      const primaryKey = relatedResource.resourceConfiguration.primaryKey || "id"
      const ids = relatedModels
        .map((model) => model.attributes()[primaryKey])
        .filter((id) => id !== undefined && id !== null)

      if (ids.length < 1) {
        authorizedIdsByClass.set(relatedModelClass, new Set())
        continue
      }

      const authorizedIdsRaw = await relatedModelClass
        .accessibleFor(abilityAction)
        .where({[primaryKey]: ids})
        .pluck(primaryKey)

      primaryKeysByClass.set(relatedModelClass, primaryKey)
      authorizedIdsByClass.set(relatedModelClass, new Set(authorizedIdsRaw.map((id) => String(id))))
    }

    return models.filter((model) => {
      const relatedModelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor)
      const authorizedIds = authorizedIdsByClass.get(relatedModelClass)
      const primaryKey = primaryKeysByClass.get(relatedModelClass)

      if (!authorizedIds || !primaryKey) return false

      const primaryKeyValue = model.attributes()[primaryKey]

      if (primaryKeyValue === undefined || primaryKeyValue === null) return false

      return authorizedIds.has(String(primaryKeyValue))
    })
  }

  /**
   * @param {unknown} value - Candidate preloaded value.
   * @returns {value is import("./database/record/index.js").default} - Whether value behaves like a model.
   */
  isSerializableFrontendModel(value) {
    return Boolean(value && typeof value === "object" && typeof /** @type {any} */ (value).attributes === "function")
  }

  /**
   * @param {import("./database/record/index.js").default[]} models - Models to serialize.
   * @returns {Promise<Record<string, any>[]>} - Serialized model payloads.
   */
  async serializeFrontendModels(models) {
    if (models.length < 1) return []

    /** @type {Array<Record<string, any>>} */
    const preloadedRelationshipsPerModel = Array.from({length: models.length}, () => ({}))

    /** @type {Array<{loadedModels: import("./database/record/index.js").default[], modelIndex: number, relationshipName: string}>} */
    const collectionRelationshipEntries = []
    /** @type {Array<{loadedModel: import("./database/record/index.js").default, modelIndex: number, relationshipName: string}>} */
    const singularRelationshipEntries = []

    models.forEach((model, modelIndex) => {
      const modelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor)
      const relationshipsMap = modelClass.getRelationshipsMap()

      for (const relationshipName in relationshipsMap) {
        const relationship = model.getRelationshipByName(relationshipName)

        if (!relationship.getPreloaded()) continue

        const loadedRelationship = relationship.loaded()

        if (Array.isArray(loadedRelationship)) {
          collectionRelationshipEntries.push({loadedModels: loadedRelationship, modelIndex, relationshipName})
          continue
        }

        if (this.isSerializableFrontendModel(loadedRelationship)) {
          singularRelationshipEntries.push({loadedModel: loadedRelationship, modelIndex, relationshipName})
          continue
        }

        preloadedRelationshipsPerModel[modelIndex][relationshipName] = loadedRelationship == undefined ? null : loadedRelationship
      }
    })

    if (collectionRelationshipEntries.length > 0) {
      const allCollectionModels = collectionRelationshipEntries.flatMap((entry) => entry.loadedModels)
      const serializableCollectionModels = await this.frontendModelFilterSerializableRelatedModels({
        models: allCollectionModels,
        relationshipIsCollection: true
      })
      const serializableCollectionModelsSet = new Set(serializableCollectionModels)

      for (const relationshipEntry of collectionRelationshipEntries) {
        const allowedModels = relationshipEntry.loadedModels.filter((relatedModel) => serializableCollectionModelsSet.has(relatedModel))
        const serializedRelatedModels = await this.serializeFrontendModels(allowedModels)

        preloadedRelationshipsPerModel[relationshipEntry.modelIndex][relationshipEntry.relationshipName] = serializedRelatedModels
      }
    }

    if (singularRelationshipEntries.length > 0) {
      const allSingularModels = singularRelationshipEntries.map((entry) => entry.loadedModel)
      const serializableSingularModels = await this.frontendModelFilterSerializableRelatedModels({
        models: allSingularModels,
        relationshipIsCollection: false
      })
      const serializableSingularModelsSet = new Set(serializableSingularModels)

      for (const relationshipEntry of singularRelationshipEntries) {
        if (!serializableSingularModelsSet.has(relationshipEntry.loadedModel)) {
          preloadedRelationshipsPerModel[relationshipEntry.modelIndex][relationshipEntry.relationshipName] = null
          continue
        }

        const serializedModel = (await this.serializeFrontendModels([relationshipEntry.loadedModel]))[0]
        preloadedRelationshipsPerModel[relationshipEntry.modelIndex][relationshipEntry.relationshipName] = serializedModel
      }
    }

    return models.map((model, modelIndex) => {
      const serializedAttributes = this.serializeFrontendModelAttributes(model)
      const preloadedRelationships = preloadedRelationshipsPerModel[modelIndex]

      if (Object.keys(preloadedRelationships).length < 1) {
        return serializedAttributes
      }

      return {
        ...serializedAttributes,
        __preloadedRelationships: preloadedRelationships
      }
    })
  }

  /**
   * @param {import("./database/record/index.js").default} model - Frontend model record.
   * @returns {Promise<Record<string, any>>} - Serialized frontend model payload.
   */
  async serializeFrontendModel(model) {
    const serializedModels = await this.serializeFrontendModels([model])

    return serializedModels[0]
  }

  /**
   * @param {string} errorMessage - Error message.
   * @returns {Promise<void>} - Resolves when error has been rendered.
   */
  async frontendModelRenderError(errorMessage) {
    await this.logger.error(`Frontend model request failed: ${errorMessage}`)

    const renderError = /** @type {((errorMessage: string) => Promise<void>) | undefined} */ (
      /** @type {any} */ (this).renderError
    )

    if (typeof renderError === "function") {
      await renderError.call(this, frontendModelClientSafeErrorMessage)
      return
    }

    await this.render({
      json: /** @type {Record<string, any>} */ (serializeFrontendModelTransportValue({
        errorMessage: frontendModelClientSafeErrorMessage,
        status: "error"
      }))
    })
  }

  /**
   * @param {string} errorMessage - Error message.
   * @returns {Record<string, any>} - Error payload.
   */
  frontendModelErrorPayload(errorMessage) {
    return {
      errorMessage,
      status: "error"
    }
  }

  /**
   * @returns {Record<string, any>} - Client-safe error payload.
   */
  frontendModelClientSafeErrorPayload() {
    return this.frontendModelErrorPayload(frontendModelClientSafeErrorMessage)
  }

  /**
   * @param {object} args - Error log args.
   * @param {string} args.action - Endpoint/action label.
   * @param {unknown} args.error - Caught error.
   * @param {"index" | "find" | "create" | "update" | "destroy"} [args.commandType] - Frontend-model command type.
   * @param {string | undefined} [args.model] - Request model name when available.
   * @param {string | undefined} [args.requestId] - Batch request id when available.
   * @returns {Promise<void>} - Resolves after logging.
   */
  async frontendModelLogEndpointError({action, error, commandType, model, requestId}) {
    let resolvedModel = model

    if (!resolvedModel) {
      try {
        resolvedModel = this.frontendModelParams().model
      } catch {
        resolvedModel = undefined
      }
    }

    const errorMessage = error instanceof Error
      ? `${error.message}\n${error.stack || ""}`
      : String(error)

    await this.logger.error(() => ["Frontend model endpoint request failed", {
      action,
      commandType,
      error: errorMessage,
      model: resolvedModel,
      requestId
    }])
  }

  /**
   * @param {"index" | "find" | "create" | "update" | "destroy"} action - Frontend action.
   * @returns {Promise<void>} - Resolves when response has been rendered.
   */
  async frontendModelRenderCommandResponse(action) {
    try {
      const responsePayload = await this.frontendModelCommandPayload(action)
      if (!responsePayload) return

      await this.render({
        json: /** @type {Record<string, any>} */ (serializeFrontendModelTransportValue(responsePayload))
      })
    } catch (error) {
      await this.frontendModelLogEndpointError({action, commandType: action, error})
      await this.render({
        json: /** @type {Record<string, any>} */ (serializeFrontendModelTransportValue(this.frontendModelClientSafeErrorPayload()))
      })
    }
  }

  /**
   * @param {"index" | "find" | "create" | "update" | "destroy"} action - Frontend action.
   * @returns {Promise<Record<string, any> | null>} - Response payload.
   */
  async frontendModelCommandPayload(action) {
    if (!(await this.runFrontendModelBeforeAction(action))) {
      return null
    }

    if (action === "index") {
      const pluck = this.frontendModelPluck()
      const serverConfiguration = this.frontendModelServerConfiguration()

      if (pluck.length > 0) {
        if (serverConfiguration?.records) {
          throw new Error("pluck is not supported when server.records callback is configured")
        }

        const values = await this.frontendModelPluckValues({
          pluck,
          query: this.frontendModelIndexQuery()
        })

        return {
          status: "success",
          values
        }
      }

      const models = await this.frontendModelRecords()
      const serializedModels = serverConfiguration?.serialize
        ? await Promise.all(models.map(async (model) => {
          return await serverConfiguration.serialize({
            action: "index",
            controller: this,
            model,
            modelClass: this.frontendModelClass(),
            params: this.frontendModelParams()
          })
        }))
        : await this.serializeFrontendModels(models)

      return {
        models: serializedModels,
        status: "success"
      }
    }

    const params = this.frontendModelParams()
    const modelClass = this.frontendModelClass()
    const id = params.id

    if (action === "create") {
      const attributes = params.attributes

      if (!attributes || typeof attributes !== "object") {
        return this.frontendModelErrorPayload("Expected model attributes.")
      }

      const model = await this.frontendModelCreateRecord(attributes)

      if (!model) {
        return this.frontendModelErrorPayload(`${modelClass.name} not found.`)
      }

      const serverConfiguration = this.frontendModelServerConfiguration()
      const serializedModel = serverConfiguration?.serialize
        ? await serverConfiguration.serialize({
          action: "create",
          controller: this,
          model,
          modelClass,
          params
        })
        : await this.serializeFrontendModel(model)

      return {
        model: serializedModel,
        status: "success"
      }
    }

    if ((typeof id !== "string" && typeof id !== "number") || `${id}`.length < 1) {
      return this.frontendModelErrorPayload("Expected model id.")
    }

    if (action === "find") {
      const model = await this.frontendModelFindRecord("find", id)

      if (!model) {
        return this.frontendModelErrorPayload(`${modelClass.name} not found.`)
      }

      const serverConfiguration = this.frontendModelServerConfiguration()
      const serializedModel = serverConfiguration?.serialize
        ? await serverConfiguration.serialize({
          action: "find",
          controller: this,
          model,
          modelClass,
          params
        })
        : await this.serializeFrontendModel(model)

      return {
        model: serializedModel,
        status: "success"
      }
    }

    if (action === "update") {
      const attributes = params.attributes

      if (!attributes || typeof attributes !== "object") {
        return this.frontendModelErrorPayload("Expected model attributes.")
      }

      const serverConfiguration = this.frontendModelServerConfiguration()
      const model = await this.frontendModelFindRecord("update", id)

      if (!model) {
        return this.frontendModelErrorPayload(`${modelClass.name} not found.`)
      }

      let updatedModel = model

      if (serverConfiguration?.update) {
        const callbackModel = await serverConfiguration.update({
          action: "update",
          attributes,
          controller: this,
          model,
          modelClass,
          params
        })

        if (callbackModel) updatedModel = callbackModel
      } else {
        model.assign(attributes)
        await model.save()
      }

      const serializedModel = serverConfiguration?.serialize
        ? await serverConfiguration.serialize({
          action: "update",
          controller: this,
          model: updatedModel,
          modelClass,
          params
        })
        : await this.serializeFrontendModel(updatedModel)

      return {
        model: serializedModel,
        status: "success"
      }
    }

    const serverConfiguration = this.frontendModelServerConfiguration()
    const model = await this.frontendModelFindRecord("destroy", id)

    if (!model) {
      return this.frontendModelErrorPayload(`${modelClass.name} not found.`)
    }

    if (serverConfiguration?.destroy) {
      await serverConfiguration.destroy({
        action: "destroy",
        controller: this,
        model,
        modelClass,
        params
      })
    } else {
      await model.destroy()
    }

    return {status: "success"}
  }

  /** @returns {Promise<void>} - Shared frontend model API action with batch support. */
  async frontendApi() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    const params = /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(this.params()))
    const requests = Array.isArray(params.requests) ? params.requests : [params]
    /** @type {Array<Record<string, any>>} */
    const responses = []

    for (const requestEntry of requests) {
      const commandType = requestEntry?.commandType
      const model = requestEntry?.model
      const payload = requestEntry?.payload
      const requestId = requestEntry?.requestId

      if (typeof model !== "string" || model.length < 1) {
        responses.push({
          requestId,
          response: this.frontendModelErrorPayload("Expected request model.")
        })
        continue
      }

      if (!["index", "find", "create", "update", "destroy"].includes(commandType)) {
        responses.push({
          requestId,
          response: this.frontendModelErrorPayload("Expected request commandType.")
        })
        continue
      }

      const commandParams = {
        ...(payload && typeof payload === "object" ? payload : {}),
        model
      }

      try {
        const responsePayload = await this.withFrontendModelParams(commandParams, async () => {
          return await this.frontendModelCommandPayload(commandType)
        })

        responses.push({
          requestId,
          response: responsePayload || this.frontendModelErrorPayload("Action halted by beforeAction.")
        })
      } catch (error) {
        await this.frontendModelLogEndpointError({
          action: "frontendApi",
          commandType,
          error,
          model,
          requestId
        })

        responses.push({
          requestId,
          response: this.frontendModelClientSafeErrorPayload()
        })
      }
    }

    await this.render({
      json: /** @type {Record<string, any>} */ (serializeFrontendModelTransportValue({
        responses,
        status: "success"
      }))
    })
  }

  /** @returns {Promise<void>} - Collection action for frontend model resources. */
  async frontendIndex() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    await this.frontendModelRenderCommandResponse("index")
  }

  /** @returns {Promise<void>} - Member find action for frontend model resources. */
  async frontendFind() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    await this.frontendModelRenderCommandResponse("find")
  }

  /** @returns {Promise<void>} - Member update action for frontend model resources. */
  async frontendUpdate() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    await this.frontendModelRenderCommandResponse("update")
  }

  /** @returns {Promise<void>} - Member create action for frontend model resources. */
  async frontendCreate() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    await this.frontendModelRenderCommandResponse("create")
  }

  /** @returns {Promise<void>} - Member destroy action for frontend model resources. */
  async frontendDestroy() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    await this.frontendModelRenderCommandResponse("destroy")
  }
}
