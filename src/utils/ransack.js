// @ts-check

import * as inflection from "inflection"
import {isPlainObject} from "is-plain-object"
import {resolveFrontendModelClass} from "../frontend-models/model-registry.js"

/**
 * RansackPredicate type.
 * @typedef {"cont" | "end" | "eq" | "gt" | "gteq" | "in" | "lt" | "lteq" | "not_eq" | "not_in" | "null" | "start"} RansackPredicate
 */

/**
 * RansackCombinator type.
 * @typedef {"and" | "or"} RansackCombinator
 */

/**
 * RansackModelClass type.
 * @typedef {typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass} RansackModelClass
 */

/**
 * RansackAttribute type.
 * @typedef {object} RansackAttribute
 * @property {string} attributeName - Resolved attribute name.
 * @property {string[]} path - Resolved relationship path.
 */

/**
 * RansackCondition type.
 * @typedef {object} RansackCondition
 * @property {RansackAttribute[]} attributes - Resolved attributes to test.
 * @property {RansackCombinator} combinator - How multiple attributes are combined.
 * @property {RansackPredicate} predicate - Parsed Ransack predicate.
 * @property {?} value - Normalized value.
 */

/**
 * RansackGroup type.
 * @typedef {object} RansackGroup
 * @property {RansackCombinator} combinator - How entries inside this group are combined.
 * @property {RansackCondition[]} conditions - Conditions in this group.
 * @property {RansackGroup[]} groupings - Nested groups.
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
 * Runs the normalizeRansackParams helper.
 * @param {RansackModelClass} modelClass - Model class.
 * @param {Record<string, ?>} params - Ransack-style params hash.
 * @returns {RansackCondition[]} - Normalized conditions.
 */
export function normalizeRansackParams(modelClass, params) {
  return normalizeRansackGroup(modelClass, params).conditions
}

/**
 * Runs the normalizeRansackGroup helper.
 * @param {RansackModelClass} modelClass - Model class.
 * @param {Record<string, ?>} params - Ransack-style params hash.
 * @returns {RansackGroup} - Normalized group.
 */
export function normalizeRansackGroup(modelClass, params) {
  if (!isPlainObject(params)) {
    throw new Error(`ransack params must be a plain object, got: ${typeof params}`)
  }

  /**
   * Normalized.
   * @type {RansackGroup} */
  const normalized = {
    combinator: normalizeRansackCombinator(params.m, "and"),
    conditions: [],
    groupings: []
  }

  for (const [key, rawValue] of Object.entries(params)) {
    if (key === "m") {
      continue
    }

    if (key === "c") {
      normalized.conditions.push(...normalizeAdvancedRansackConditions({modelClass, value: rawValue}))
      continue
    }

    if (key === "g") {
      normalized.groupings.push(...normalizeAdvancedRansackGroups({modelClass, value: rawValue}))
      continue
    }

    const condition = normalizeSimpleRansackCondition({key, modelClass, rawValue})
    if (condition) normalized.conditions.push(condition)
  }

  return normalized
}

const SKIP_RANSACK_CONDITION = Symbol("skip-ransack-condition")

/**
 * Runs normalize simple ransack condition.
 * @param {object} args - Options.
 * @param {string} args.key - Simple Ransack key.
 * @param {RansackModelClass} args.modelClass - Model class.
 * @param {?} args.rawValue - Raw condition value.
 * @returns {RansackCondition | null} - Normalized condition, or null when skipped.
 */
function normalizeSimpleRansackCondition({key, modelClass, rawValue}) {
  const parsedKey = parseRansackKey(key)

  if (!parsedKey) {
    throw new Error(`Unsupported ransack predicate in key: ${key}`)
  }

  const value = normalizeRansackValue({
    predicate: parsedKey.predicate,
    value: rawValue
  })

  if (value === SKIP_RANSACK_CONDITION) return null

  const attributes = resolveRansackAttributes({modelClass, value: parsedKey.pathValue})

  return {
    attributes,
    combinator: attributes.length > 1 ? "or" : "and",
    predicate: parsedKey.predicate,
    value
  }
}

/**
 * Runs normalize advanced ransack conditions.
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Model class.
 * @param {?} args.value - Advanced conditions collection.
 * @returns {RansackCondition[]} - Normalized conditions.
 */
function normalizeAdvancedRansackConditions({modelClass, value}) {
  /**
   * Conditions.
   * @type {RansackCondition[]} */
  const conditions = []

  for (const entry of normalizeRansackCollection(value, "conditions")) {
    if (!isPlainObject(entry)) {
      throw new Error(`Ransack condition entries must be plain objects, got: ${typeof entry}`)
    }

    const predicateValue = entry.p

    if (typeof predicateValue !== "string") {
      throw new Error("Ransack condition predicate must be a string")
    }

    if (!supportedPredicates.includes(predicateValue)) {
      throw new Error(`Unsupported ransack predicate in condition: ${predicateValue}`)
    }

    const predicate = /**
                       * Narrows the runtime value to the documented type.
                       * @type {RansackPredicate} */ (predicateValue)
    const rawValue = advancedRansackConditionValue({predicate, value: entry.v})
    const normalizedValue = normalizeRansackValue({predicate, value: rawValue})

    if (normalizedValue === SKIP_RANSACK_CONDITION) continue

    const attributes = resolveRansackAttributesFromAdvancedValue({modelClass, value: entry.a})

    conditions.push({
      attributes,
      combinator: normalizeRansackCombinator(entry.m, attributes.length > 1 ? "or" : "and"),
      predicate,
      value: normalizedValue
    })
  }

  return conditions
}

/**
 * Runs normalize advanced ransack groups.
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Model class.
 * @param {?} args.value - Advanced groups collection.
 * @returns {RansackGroup[]} - Normalized groups.
 */
function normalizeAdvancedRansackGroups({modelClass, value}) {
  /**
   * Groupings.
   * @type {RansackGroup[]} */
  const groupings = []

  for (const entry of normalizeRansackCollection(value, "groupings")) {
    if (!isPlainObject(entry)) {
      throw new Error(`Ransack grouping entries must be plain objects, got: ${typeof entry}`)
    }

    groupings.push(normalizeRansackGroup(modelClass, entry))
  }

  return groupings
}

/**
 * Runs normalize ransack combinator.
 * @param {?} value - Candidate combinator.
 * @param {RansackCombinator} defaultValue - Default combinator.
 * @returns {RansackCombinator} - Normalized combinator.
 */
function normalizeRansackCombinator(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue
  if (value === "and" || value === "or") return value

  throw new Error(`Invalid ransack combinator: ${String(value)}`)
}

/**
 * Runs normalize ransack collection.
 * @param {?} value - Candidate collection.
 * @param {string} name - Collection name for errors.
 * @returns {Array<?>} - Collection values in stable order.
 */
function normalizeRansackCollection(value, name) {
  if (value === undefined || value === null || value === "") return []
  if (Array.isArray(value)) return value

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort((left, right) => {
        const leftNumber = Number(left)
        const rightNumber = Number(right)

        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
          return leftNumber - rightNumber
        }

        return left.localeCompare(right)
      })
      .map((key) => value[key])
  }

  throw new Error(`Ransack ${name} must be an array or object, got: ${typeof value}`)
}

/**
 * Runs advanced ransack condition value.
 * @param {object} args - Options.
 * @param {RansackPredicate} args.predicate - Parsed predicate.
 * @param {?} args.value - Advanced condition value.
 * @returns {?} - Value passed to predicate normalization.
 */
function advancedRansackConditionValue({predicate, value}) {
  if (predicate === "in" || predicate === "not_in") return value

  if (Array.isArray(value)) {
    return value.find((entry) => entry !== undefined && entry !== null && entry !== "")
  }

  return value
}

/**
 * Runs resolve ransack attributes from advanced value.
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Model class.
 * @param {?} args.value - Advanced attribute value.
 * @returns {RansackAttribute[]} - Resolved attributes.
 */
function resolveRansackAttributesFromAdvancedValue({modelClass, value}) {
  const values = normalizeAdvancedAttributeValues(value)
  /**
   * Attributes.
   * @type {RansackAttribute[]} */
  const attributes = []

  for (const attributeValue of values) {
    attributes.push(...resolveRansackAttributes({modelClass, value: attributeValue}))
  }

  if (attributes.length < 1) {
    throw new Error("Ransack condition must include at least one attribute")
  }

  return attributes
}

/**
 * Runs normalize advanced attribute values.
 * @param {?} value - Advanced attribute value.
 * @returns {string[]} - Attribute path strings.
 */
function normalizeAdvancedAttributeValues(value) {
  if (typeof value === "string") return [value]

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeAdvancedAttributeValue(entry))
  }

  if (isPlainObject(value)) {
    return normalizeRansackCollection(value, "attributes").map((entry) => normalizeAdvancedAttributeValue(entry))
  }

  throw new Error(`Ransack condition attributes must be strings, arrays, or objects, got: ${typeof value}`)
}

/**
 * Runs normalize advanced attribute value.
 * @param {?} value - Advanced attribute entry.
 * @returns {string} - Attribute path string.
 */
function normalizeAdvancedAttributeValue(value) {
  if (typeof value === "string") return value

  if (isPlainObject(value) && typeof value.name === "string") {
    return value.name
  }

  throw new Error(`Ransack condition attribute entries must be strings or {name}, got: ${typeof value}`)
}

/**
 * Runs resolve ransack attributes.
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Model class.
 * @param {string} args.value - Attribute path value.
 * @returns {RansackAttribute[]} - Resolved attributes.
 */
function resolveRansackAttributes({modelClass, value}) {
  return value.split("_or_").map((attributeValue) => {
    const resolvedPath = resolveRansackPath({modelClass, value: attributeValue})
    const targetModelClass = modelClassAtPath({modelClass, path: resolvedPath.path})
    const attributeName = resolveAttributeName({modelClass: targetModelClass, value: resolvedPath.attributeValue})

    if (!attributeName) {
      throw new Error(`Unknown ransack attribute "${resolvedPath.attributeValue}" for ${targetModelClass.name}`)
    }

    return {
      attributeName,
      path: resolvedPath.path
    }
  })
}

/**
 * Runs model class at path.
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
 * Runs resolve ransack path.
 * @param {object} args - Options.
 * @param {RansackModelClass} args.modelClass - Current model class.
 * @param {string} args.value - Remaining path value.
 * @returns {{attributeValue: string, path: string[]}} - Resolved relationship path and remaining attribute value.
 */
function resolveRansackPath({modelClass, value}) {
  /**
   * Path.
   * @type {string[]} */
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
 * Runs find relationship prefix.
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
 * Runs relationship candidates.
 * @param {string} relationshipName - Relationship name.
 * @returns {string[]} - Candidate tokens for matching.
 */
function relationshipCandidates(relationshipName) {
  return uniqunize([relationshipName, inflection.underscore(relationshipName)])
}

/**
 * Runs resolve attribute name.
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
 * Runs relationship entries.
 * @param {RansackModelClass} modelClass - Model class.
 * @returns {Record<string, {targetModelClass: RansackModelClass}>} - Relationship entries keyed by name.
 */
function relationshipEntries(modelClass) {
  if (typeof /**
              * Narrows the runtime value to the documented type.
              * @type {?} */ (modelClass).getRelationshipsMap === "function") {
    return backendRelationshipEntries(modelClass)
  }

  if (typeof /**
              * Narrows the runtime value to the documented type.
              * @type {?} */ (modelClass).relationshipDefinitions === "function" &&
    typeof /**
            * Narrows the runtime value to the documented type.
            * @type {?} */ (modelClass).relationshipModelClasses === "function") {
    return frontendRelationshipEntries(modelClass)
  }

  return {}
}

/**
 * Runs backend relationship entries.
 * @param {RansackModelClass} modelClass - Backend model class.
 * @returns {Record<string, {targetModelClass: RansackModelClass}>} - Relationship entries keyed by name.
 */
function backendRelationshipEntries(modelClass) {
  /**
   * Entries.
   * @type {Record<string, {targetModelClass: RansackModelClass}>} */
  const entries = {}
  const relationshipsMap = /**
                            * Narrows the runtime value to the documented type.
                            * @type {?} */ (modelClass).getRelationshipsMap()

  for (const relationshipName of Object.keys(relationshipsMap)) {
    const relationship = relationshipsMap[relationshipName]

    if (typeof relationship.isPolymorphic === "function" && relationship.isPolymorphic()) continue

    const targetModelClass = relationship.getTargetModelClass()

    if (!targetModelClass) continue

    entries[relationshipName] = {targetModelClass}
  }

  return entries
}

/**
 * Runs frontend relationship entries.
 * @param {RansackModelClass} modelClass - Frontend model class.
 * @returns {Record<string, {targetModelClass: RansackModelClass}>} - Relationship entries keyed by name.
 */
function frontendRelationshipEntries(modelClass) {
  /**
   * Entries.
   * @type {Record<string, {targetModelClass: RansackModelClass}>} */
  const entries = {}
  const definitions = /**
                       * Narrows the runtime value to the documented type.
                       * @type {?} */ (modelClass).relationshipDefinitions()
  const relationshipModelClasses = /**
                                    * Narrows the runtime value to the documented type.
                                    * @type {?} */ (modelClass).relationshipModelClasses()

  for (const relationshipName of Object.keys(definitions)) {
    const targetModelClass = resolveFrontendModelClass(relationshipModelClasses[relationshipName])

    if (!targetModelClass) continue

    entries[relationshipName] = {targetModelClass}
  }

  return entries
}

/**
 * Runs attribute entries.
 * @param {RansackModelClass} modelClass - Model class.
 * @returns {Record<string, string>} - Attribute-to-column entries keyed by attribute name.
 */
function attributeEntries(modelClass) {
  if (typeof /**
              * Narrows the runtime value to the documented type.
              * @type {?} */ (modelClass).getAttributeNameToColumnNameMap === "function") {
    return /** @type {Record<string, string>} */ ((/**
                                                    * Narrows the runtime value to the documented type.
                                                    * @type {?} */ (modelClass).getAttributeNameToColumnNameMap()))
  }

  const resourceConfig = typeof /**
                                 * Narrows the runtime value to the documented type.
                                 * @type {?} */ (modelClass).resourceConfig === "function"
    ? /**
       * Narrows the runtime value to the documented type.
       * @type {?} */ (modelClass).resourceConfig()
    : {}
  const attributes = resourceConfig.attributes
  /**
   * Entries.
   * @type {Record<string, string>} */
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
 * Runs matches attribute value.
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
 * Runs parse ransack key.
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
      predicate: /**
                  * Narrows the runtime value to the documented type.
                  * @type {RansackPredicate} */ (predicate)
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
      predicate: /**
                  * Narrows the runtime value to the documented type.
                  * @type {RansackPredicate} */ (predicate)
    }
  }

  return null
}

/**
 * Runs snake to camel suffix.
 * @param {string} value - Snake-case predicate.
 * @returns {string} - CamelCase predicate suffix used in ransack keys.
 */
function snakeToCamelSuffix(value) {
  const segments = value.split("_")

  return segments.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join("")
}

/**
 * Runs normalize ransack value.
 * @param {object} args - Options.
 * @param {RansackPredicate} args.predicate - Parsed predicate.
 * @param {?} args.value - Raw value.
 * @returns {?} - Normalized value.
 */
function normalizeRansackValue({predicate, value}) {
  if (predicate === "null") {
    return normalizeRansackNullValue(value)
  }

  if (predicate === "in" || predicate === "not_in") {
    return normalizeRansackListValue(value)
  }

  if (ransackValueIsBlank(value)) return SKIP_RANSACK_CONDITION

  return value
}

/**
 * Runs normalize ransack null value.
 * @param {?} value - Candidate null predicate value.
 * @returns {boolean | typeof SKIP_RANSACK_CONDITION} - Normalized value.
 */
function normalizeRansackNullValue(value) {
  const booleanValue = normalizeRansackBoolean(value)

  return booleanValue === null ? SKIP_RANSACK_CONDITION : booleanValue
}

/**
 * Runs normalize ransack list value.
 * @param {?} value - Candidate list predicate value.
 * @returns {Array<?> | typeof SKIP_RANSACK_CONDITION} - Normalized value.
 */
function normalizeRansackListValue(value) {
  const normalizedArray = normalizeRansackArray(value)

  return normalizedArray.length < 1 ? SKIP_RANSACK_CONDITION : normalizedArray
}

/**
 * Ransack true values.
 * @type {Set<?>} */
const ransackTrueValues = new Set([true, 1, "1", "true"])
/**
 * Ransack false values.
 * @type {Set<?>} */
const ransackFalseValues = new Set([false, 0, "0", "false"])

/**
 * Runs normalize ransack boolean.
 * @param {?} value - Candidate boolean.
 * @returns {boolean | null} - Normalized boolean or null when blank.
 */
function normalizeRansackBoolean(value) {
  if (ransackTrueValues.has(value)) return true
  if (ransackFalseValues.has(value)) return false
  if (ransackValueIsBlank(value)) return null

  throw new Error(`Invalid ransack boolean value: ${String(value)}`)
}

/**
 * Runs ransack value is blank.
 * @param {?} value - Candidate value.
 * @returns {boolean} - Whether value should be ignored as blank.
 */
function ransackValueIsBlank(value) {
  return value === undefined || value === null || value === ""
}

/**
 * Runs normalize ransack array.
 * @param {?} value - Candidate array-ish value.
 * @returns {Array<?>} - Normalized array values.
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
 * RansackSort type.
 * @typedef {object} RansackSort
 * @property {string} attribute - Resolved attribute name.
 * @property {"asc" | "desc"} direction - Sort direction.
 */

/**
 * Parses and validates a ransack `s` sort string against model attributes.
 * @param {RansackModelClass} modelClass - Model class for attribute validation.
 * @param {string} sortString - Ransack sort string (e.g., "name asc" or "name asc, createdAt desc").
 * @returns {RansackSort[]} - Validated sort definitions.
 */
export function parseRansackSort(modelClass, sortString) {
  const segments = sortString.split(",").map((segment) => segment.trim()).filter((segment) => segment.length > 0)

  /**
   * Sorts.
   * @type {RansackSort[]} */
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
 * Runs uniqunize.
 * @param {string[]} values - Input values.
 * @returns {string[]} - Unique values in original order.
 */
function uniqunize(values) {
  return Array.from(new Set(values))
}
