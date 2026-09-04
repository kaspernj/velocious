// @ts-check

import isPlainObject from "./plain-object.js"

/** @typedef {string | number} ModelPrimaryKeyScalar */
/** @typedef {string | string[]} ModelPrimaryKeyDefinition */
/** @typedef {Record<string, ModelPrimaryKeyScalar>} CompositeModelPrimaryKeyValue */
/** @typedef {ModelPrimaryKeyScalar | CompositeModelPrimaryKeyValue} ModelPrimaryKeyValue */

/**
 * Validates an untrusted composite identity and returns its definition-ordered values.
 * @param {string[]} primaryKey - Composite primary-key definition.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate identity.
 * @returns {CompositeModelPrimaryKeyValue} - Validated identity.
 */
export function validatedCompositePrimaryKeyValue(primaryKey, value) {
  if (!isPlainObject(value)) {
    throw new TypeError("Expected composite primary key identity to be a plain object.")
  }

  const valueKeys = Object.keys(value)

  if (valueKeys.length !== primaryKey.length || primaryKey.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new TypeError(`Expected composite primary key identity fields: ${primaryKey.join(", ")}.`)
  }

  /** @type {CompositeModelPrimaryKeyValue} */
  const validatedValue = {}

  for (const key of primaryKey) {
    const keyValue = value[key]

    if (typeof keyValue !== "string" && typeof keyValue !== "number") {
      throw new TypeError(`Expected composite primary key identity field '${key}' to be a string or number.`)
    }

    validatedValue[key] = keyValue
  }

  return validatedValue
}

/**
 * Returns a scalar primary-key definition or fails at a feature boundary that cannot represent composite identities.
 * @param {ModelPrimaryKeyDefinition} primaryKey - Primary-key definition.
 * @param {string} operation - Operation requiring a scalar identity.
 * @returns {string} - Scalar primary-key column or attribute name.
 */
export function scalarModelPrimaryKey(primaryKey, operation) {
  if (Array.isArray(primaryKey)) {
    throw new Error(`${operation} does not support composite primary keys.`)
  }

  return primaryKey
}

/**
 * Returns a scalar identity or fails at a feature boundary that cannot represent composite identities.
 * @param {ModelPrimaryKeyValue} value - Model identity.
 * @param {string} operation - Operation requiring a scalar identity.
 * @returns {ModelPrimaryKeyScalar} - Scalar identity.
 */
export function scalarModelPrimaryKeyValue(value, operation) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${operation} does not support composite primary keys.`)
  }

  return value
}

/**
 * Builds query conditions from a scalar or composite model identity.
 * @param {ModelPrimaryKeyDefinition} primaryKey - Primary-key definition.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate identity.
 * @returns {Record<string, ModelPrimaryKeyScalar>} - Primary-key query conditions.
 */
export function modelPrimaryKeyConditions(primaryKey, value) {
  if (Array.isArray(primaryKey)) return validatedCompositePrimaryKeyValue(primaryKey, value)

  return {[primaryKey]: /** @type {ModelPrimaryKeyScalar} */ (value)}
}

/**
 * Builds a qualified SQL predicate matching any supplied composite identity.
 * @param {object} args - Arguments.
 * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class owning the identity attributes.
 * @param {string[]} args.primaryKey - Composite primary-key definition.
 * @param {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} args.query - Query receiving the predicate.
 * @param {ModelPrimaryKeyValue[]} args.values - Candidate identities.
 * @returns {string} - Qualified SQL predicate.
 */
export function compositeModelPrimaryKeyCohortSql({modelClass, primaryKey, query, values}) {
  if (values.length === 0) return "(1 = 0)"

  const tableSql = query.driver.quoteTable(query.getTableReferenceForJoin())

  return `(${values.map((value) => {
    const conditions = modelPrimaryKeyConditions(primaryKey, value)
    const identitySql = primaryKey.map((attributeName) => {
      const columnName = modelClass.getColumnNameForAttributeName(attributeName)

      return `${tableSql}.${query.driver.quoteColumn(columnName)} = ${query.driver.quote(conditions[attributeName])}`
    }).join(" AND ")

    return `(${identitySql})`
  }).join(" OR ")})`
}

/**
 * Reads a scalar or composite identity through the owning model's value reader.
 * @param {ModelPrimaryKeyDefinition} primaryKey - Primary-key definition.
 * @param {(key: string) => ReturnType<typeof JSON.parse>} read - Primary-key value reader.
 * @returns {ModelPrimaryKeyValue} - Model identity.
 */
export function readModelPrimaryKeyValue(primaryKey, read) {
  if (!Array.isArray(primaryKey)) return /** @type {ModelPrimaryKeyScalar} */ (read(primaryKey))

  /** @type {CompositeModelPrimaryKeyValue} */
  const value = {}

  for (const key of primaryKey) value[key] = /** @type {ModelPrimaryKeyScalar} */ (read(key))

  return validatedCompositePrimaryKeyValue(primaryKey, value)
}

/**
 * Returns an unambiguous map key while preserving legacy scalar map keys.
 * @param {ModelPrimaryKeyDefinition} primaryKey - Primary-key definition.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate identity.
 * @returns {string} - Canonical identity key.
 */
export function modelPrimaryKeyCacheKey(primaryKey, value) {
  if (!Array.isArray(primaryKey)) return String(value)

  const validatedValue = validatedCompositePrimaryKeyValue(primaryKey, value)

  return JSON.stringify(primaryKey.map((key) => validatedValue[key]))
}

/**
 * Restores a model identity from its canonical string representation.
 * @param {ModelPrimaryKeyDefinition} primaryKey - Primary-key definition.
 * @param {string} cacheKey - Canonical identity key.
 * @returns {ModelPrimaryKeyValue} - Restored identity.
 */
export function modelPrimaryKeyValueFromCacheKey(primaryKey, cacheKey) {
  if (!Array.isArray(primaryKey)) return cacheKey

  let parsed

  try {
    parsed = JSON.parse(cacheKey)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error

    throw new TypeError("Expected composite primary key cache value to be valid JSON.", {cause: error})
  }

  if (!Array.isArray(parsed) || parsed.length !== primaryKey.length) {
    throw new TypeError(`Expected composite primary key cache value with ${primaryKey.length} fields.`)
  }

  /** @type {CompositeModelPrimaryKeyValue} */
  const value = {}

  for (let index = 0; index < primaryKey.length; index += 1) {
    value[primaryKey[index]] = parsed[index]
  }

  return validatedCompositePrimaryKeyValue(primaryKey, value)
}
