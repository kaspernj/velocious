// @ts-check

import * as inflection from "inflection"
import {resolveFrontendModelClass} from "../frontend-models/model-registry.js"

/**
 * @typedef {"cont" | "end" | "eq" | "gt" | "gteq" | "in" | "lt" | "lteq" | "not_eq" | "not_in" | "null" | "start"} RansackPredicate
 */

/**
 * @typedef {typeof import("../database/record/index.js").default | typeof import("../frontend-models/base.js").default} RansackModelClass
 */

/**
 * @typedef {object} RansackCondition
 * @property {string} attributeName - Resolved attribute name.
 * @property {string[]} path - Resolved relationship path.
 * @property {RansackPredicate} predicate - Parsed Ransack predicate.
 * @property {any} value - Normalized value.
 */

const supportedPredicates = [
  "not_in",
  "not_eq",
  "gteq",
  "lteq",
  "start",
  "cont",
  "null",
  "end",
  "eq",
  "gt",
  "lt",
  "in"
]

/**
 * @param {RansackModelClass} modelClass - Model class.
 * @param {Record<string, any>} params - Ransack-style params hash.
 * @returns {RansackCondition[]} - Normalized conditions.
 */
export function normalizeRansackParams(modelClass, params) {
  if (!isPlainObject(params)) {
    throw new Error(`ransack params must be a plain object, got: ${typeof params}`)
  }

  /** @type {RansackCondition[]} */
  const normalized = []

  for (const [key, rawValue] of Object.entries(params)) {
    const parsedKey = parseRansackKey(key)

    if (!parsedKey) {
      throw new Error(`Unsupported ransack predicate in key: ${key}`)
    }

    const resolvedPath = resolveRansackPath({modelClass, value: parsedKey.pathValue})
    const targetModelClass = modelClassAtPath({modelClass, path: resolvedPath.path})
    const attributeName = resolveAttributeName({modelClass: targetModelClass, value: resolvedPath.attributeValue})

    if (!attributeName) {
      throw new Error(`Unknown ransack attribute "${resolvedPath.attributeValue}" for ${targetModelClass.name}`)
    }

    const value = normalizeRansackValue({
      predicate: parsedKey.predicate,
      value: rawValue
    })

    if (value === SKIP_RANSACK_CONDITION) continue

    normalized.push({
      attributeName,
      path: resolvedPath.path,
      predicate: parsedKey.predicate,
      value
    })
  }

  return normalized
}

const SKIP_RANSACK_CONDITION = Symbol("skip-ransack-condition")

/**
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Root model class.
 * @param {string[]} args.path - Relationship path.
 * @returns {RansackModelClass} - Target model class.
 */
function modelClassAtPath({modelClass, path}) {
  let currentModelClass = modelClass

  for (const relationshipName of path) {
    const relationship = relationshipEntries(currentModelClass)[relationshipName]

    if (!relationship) {
      throw new Error(`Unknown ransack relationship "${relationshipName}" for ${currentModelClass.name}`)
    }

    currentModelClass = relationship.targetModelClass
  }

  return currentModelClass
}

/**
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Current model class.
 * @param {string} args.value - Remaining path value.
 * @returns {{attributeValue: string, path: string[]}} - Resolved relationship path and remaining attribute value.
 */
function resolveRansackPath({modelClass, value}) {
  /** @type {string[]} */
  const path = []
  let currentModelClass = modelClass
  let remainingValue = value

  while (true) {
    if (resolveAttributeName({modelClass: currentModelClass, value: remainingValue})) {
      break
    }

    const match = findRelationshipPrefix({
      modelClass: currentModelClass,
      value: remainingValue
    })

    if (!match) break

    path.push(match.relationshipName)
    currentModelClass = match.targetModelClass
    remainingValue = match.remainingValue
  }

  if (remainingValue.length < 1) {
    throw new Error(`Invalid ransack key path: ${value}`)
  }

  return {
    attributeValue: remainingValue,
    path
  }
}

/**
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Current model class.
 * @param {string} args.value - Remaining value to match.
 * @returns {{relationshipName: string, remainingValue: string, targetModelClass: RansackModelClass} | null} - Matching relationship prefix.
 */
function findRelationshipPrefix({modelClass, value}) {
  let bestMatch = null

  for (const relationshipName of Object.keys(relationshipEntries(modelClass))) {
    const relationship = relationshipEntries(modelClass)[relationshipName]

    for (const candidate of relationshipCandidates(relationshipName)) {
      const remainingValue = stripRelationshipCandidate(value, candidate)

      if (remainingValue === null) continue
      if (remainingValue.length < 1) continue
      if (bestMatch && candidate.length <= bestMatch.candidateLength) continue

      bestMatch = {
        candidateLength: candidate.length,
        relationshipName,
        remainingValue,
        targetModelClass: relationship.targetModelClass
      }
    }
  }

  if (!bestMatch) return null

  return {
    relationshipName: bestMatch.relationshipName,
    remainingValue: bestMatch.remainingValue,
    targetModelClass: bestMatch.targetModelClass
  }
}

/**
 * Returns the portion of `value` after `candidate` when `candidate`
 * sits at a relationship-path boundary, or null when there's no
 * boundary match. Two boundary forms are accepted:
 * - snake: `<candidate>_` followed by the rest of the path (e.g.
 *   `task_project_id` against candidate `task` returns `project_id`).
 * - camel: `<candidate>` immediately followed by an uppercase letter,
 *   which marks a new word in camelCase (e.g. `taskProjectId` against
 *   candidate `task` returns `projectId` with the leading `P`
 *   lowercased so the remainder stays in caller-form for the next
 *   attribute / relationship match).
 * @param {string} value - Remaining ransack path.
 * @param {string} candidate - Relationship name candidate.
 * @returns {string | null} - Remainder after the candidate, or null.
 */
function stripRelationshipCandidate(value, candidate) {
  if (value.startsWith(`${candidate}_`)) {
    return value.slice(candidate.length + 1)
  }

  if (value.length <= candidate.length) return null
  if (!value.startsWith(candidate)) return null

  const nextChar = value.charAt(candidate.length)

  if (nextChar < "A" || nextChar > "Z") return null

  return nextChar.toLowerCase() + value.slice(candidate.length + 1)
}

/**
 * @param {string} relationshipName - Relationship name.
 * @returns {string[]} - Candidate tokens for matching.
 */
function relationshipCandidates(relationshipName) {
  return uniqunize([relationshipName, inflection.underscore(relationshipName)])
}

/**
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Model class.
 * @param {string} args.value - Attribute candidate.
 * @returns {string | undefined} - Resolved attribute name.
 */
function resolveAttributeName({modelClass, value}) {
  for (const [attributeName, columnName] of Object.entries(attributeEntries(modelClass))) {
    if (matchesAttributeValue({attributeName, columnName, value})) {
      return attributeName
    }
  }

  return undefined
}

/**
 * @param {RansackModelClass} modelClass - Model class.
 * @returns {Record<string, {targetModelClass: RansackModelClass}>} - Relationship entries keyed by name.
 */
function relationshipEntries(modelClass) {
  if (typeof /** @type {any} */ (modelClass).getRelationshipsMap === "function") {
    /** @type {Record<string, {targetModelClass: RansackModelClass}>} */
    const entries = {}
    const relationshipsMap = /** @type {any} */ (modelClass).getRelationshipsMap()

    for (const relationshipName of Object.keys(relationshipsMap)) {
      const relationship = relationshipsMap[relationshipName]

      if (typeof relationship.isPolymorphic === "function" && relationship.isPolymorphic()) continue

      const targetModelClass = relationship.getTargetModelClass()

      if (!targetModelClass) continue

      entries[relationshipName] = {
        targetModelClass
      }
    }

    return entries
  }

  if (typeof /** @type {any} */ (modelClass).relationshipDefinitions === "function" &&
    typeof /** @type {any} */ (modelClass).relationshipModelClasses === "function") {
    /** @type {Record<string, {targetModelClass: RansackModelClass}>} */
    const entries = {}
    const definitions = /** @type {any} */ (modelClass).relationshipDefinitions()
    const relationshipModelClasses = /** @type {any} */ (modelClass).relationshipModelClasses()

    for (const relationshipName of Object.keys(definitions)) {
      const targetModelClass = resolveFrontendModelClass(relationshipModelClasses[relationshipName])

      if (!targetModelClass) continue

      entries[relationshipName] = {targetModelClass}
    }

    return entries
  }

  return {}
}

/**
 * @param {RansackModelClass} modelClass - Model class.
 * @returns {Record<string, string>} - Attribute-to-column entries keyed by attribute name.
 */
function attributeEntries(modelClass) {
  if (typeof /** @type {any} */ (modelClass).getAttributeNameToColumnNameMap === "function") {
    return /** @type {Record<string, string>} */ ((/** @type {any} */ (modelClass).getAttributeNameToColumnNameMap()))
  }

  const resourceConfig = typeof /** @type {any} */ (modelClass).resourceConfig === "function"
    ? /** @type {any} */ (modelClass).resourceConfig()
    : {}
  const attributes = resourceConfig.attributes
  /** @type {Record<string, string>} */
  const entries = {}

  if (Array.isArray(attributes)) {
    for (const attributeName of attributes) {
      if (typeof attributeName !== "string") continue

      entries[attributeName] = attributeName
    }
  } else if (isPlainObject(attributes)) {
    for (const attributeName of Object.keys(attributes)) {
      entries[attributeName] = attributeName
    }
  }

  return entries
}

/**
 * @param {object} args - Options.
 * @param {string} args.attributeName - Attribute name.
 * @param {string} args.columnName - Column name.
 * @param {string} args.value - Candidate value.
 * @returns {boolean} - Whether the candidate resolves to the attribute.
 */
function matchesAttributeValue({attributeName, columnName, value}) {
  return uniqunize([
    attributeName,
    columnName,
    inflection.underscore(attributeName),
    inflection.underscore(columnName)
  ]).includes(value)
}

/**
 * @param {string} key - Ransack key.
 * @returns {{pathValue: string, predicate: RansackPredicate} | null} - Parsed key.
 */
function parseRansackKey(key) {
  for (const predicate of supportedPredicates) {
    const suffix = `_${predicate}`
    if (!key.endsWith(suffix)) continue

    const pathValue = key.slice(0, key.length - suffix.length)

    if (pathValue.length < 1) {
      throw new Error(`Invalid ransack key: ${key}`)
    }

    return {
      pathValue,
      predicate: /** @type {RansackPredicate} */ (predicate)
    }
  }

  for (const predicate of supportedPredicates) {
    const camelSuffix = snakeToCamelSuffix(predicate)

    if (!key.endsWith(camelSuffix)) continue

    const pathValue = key.slice(0, key.length - camelSuffix.length)

    if (pathValue.length < 1) {
      throw new Error(`Invalid ransack key: ${key}`)
    }

    return {
      pathValue,
      predicate: /** @type {RansackPredicate} */ (predicate)
    }
  }

  return null
}

/**
 * @param {string} value - Snake-case predicate.
 * @returns {string} - CamelCase predicate suffix used in ransack keys.
 */
function snakeToCamelSuffix(value) {
  const segments = value.split("_")

  return segments.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join("")
}

/**
 * @param {object} args - Options.
 * @param {RansackPredicate} args.predicate - Parsed predicate.
 * @param {any} args.value - Raw value.
 * @returns {any} - Normalized value.
 */
function normalizeRansackValue({predicate, value}) {
  if (predicate === "null") {
    const booleanValue = normalizeRansackBoolean(value)

    if (booleanValue === null) return SKIP_RANSACK_CONDITION

    return booleanValue
  }

  if (predicate === "in" || predicate === "not_in") {
    const normalizedArray = normalizeRansackArray(value)

    if (normalizedArray.length < 1) return SKIP_RANSACK_CONDITION

    return normalizedArray
  }

  if (value === undefined || value === null) return SKIP_RANSACK_CONDITION
  if (typeof value === "string" && value.length < 1) return SKIP_RANSACK_CONDITION

  return value
}

/**
 * @param {unknown} value - Candidate boolean.
 * @returns {boolean | null} - Normalized boolean or null when blank.
 */
function normalizeRansackBoolean(value) {
  if (value === true || value === false) return value
  if (value === 1 || value === "1" || value === "true") return true
  if (value === 0 || value === "0" || value === "false") return false
  if (value === undefined || value === null || value === "") return null

  throw new Error(`Invalid ransack boolean value: ${String(value)}`)
}

/**
 * @param {unknown} value - Candidate array-ish value.
 * @returns {any[]} - Normalized array values.
 */
function normalizeRansackArray(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined && entry !== null && entry !== "")
  }

  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  }

  if (value === undefined || value === null || value === "") return []

  return [value]
}

/**
 * @typedef {object} RansackSort
 * @property {string} attribute - Resolved attribute name.
 * @property {"asc" | "desc"} direction - Sort direction.
 */

/**
 * Parses and validates a ransack `s` sort string against model attributes.
 *
 * @param {RansackModelClass} modelClass - Model class for attribute validation.
 * @param {string} sortString - Ransack sort string (e.g., "name asc" or "name asc, createdAt desc").
 * @returns {RansackSort[]} - Validated sort definitions.
 */
export function parseRansackSort(modelClass, sortString) {
  const segments = sortString.split(",").map((segment) => segment.trim()).filter((segment) => segment.length > 0)

  /** @type {RansackSort[]} */
  const sorts = []

  for (const segment of segments) {
    const parts = segment.split(/\s+/)
    const columnCandidate = parts[0]
    const directionCandidate = parts.length > 1 ? parts[1].toLowerCase() : "asc"

    if (directionCandidate !== "asc" && directionCandidate !== "desc") {
      throw new Error(`Invalid ransack sort direction "${directionCandidate}" in: ${segment}`)
    }

    const resolvedAttribute = resolveAttributeName({modelClass, value: columnCandidate})

    if (!resolvedAttribute) {
      throw new Error(`Unknown ransack sort attribute "${columnCandidate}" for ${modelClass.name}`)
    }

    sorts.push({attribute: resolvedAttribute, direction: directionCandidate})
  }

  return sorts
}

/**
 * @param {unknown} value - Candidate object.
 * @returns {value is Record<string, any>} - Whether this is a plain object.
 */
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * @param {string[]} values - Input values.
 * @returns {string[]} - Unique values in original order.
 */
function uniqunize(values) {
  return Array.from(new Set(values))
}
