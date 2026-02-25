// @ts-check

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
 * @param {import("../database/query/index.js").NestedPreloadRecord | string | string[] | boolean | undefined | null} preload - Preload shorthand.
 * @returns {import("../database/query/index.js").NestedPreloadRecord} - Normalized preload.
 */
function normalizePreload(preload) {
  if (!preload) return {}

  if (preload === true) return {}

  if (typeof preload === "string") {
    return {[preload]: true}
  }

  if (Array.isArray(preload)) {
    /** @type {import("../database/query/index.js").NestedPreloadRecord} */
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

  /** @type {import("../database/query/index.js").NestedPreloadRecord} */
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
        /** @type {import("../database/query/index.js").NestedPreloadRecord} */ (existingValue),
        /** @type {import("../database/query/index.js").NestedPreloadRecord} */ (incomingValue)
      )
      continue
    }

    targetPreload[relationshipName] = normalizePreload(incomingValue)
  }
}

/**
 * @param {unknown} select - Select payload.
 * @returns {Record<string, string[]>} - Normalized model-name keyed select record.
 */
function normalizeSelect(select) {
  if (!select) return {}

  if (!isPlainObject(select)) {
    throw new Error(`Invalid select type: ${typeof select}`)
  }

  /** @type {Record<string, string[]>} */
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
 * @param {Record<string, any>} conditions - findBy conditions.
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
 * @param {Record<string, any>} conditions - findBy conditions.
 * @returns {Record<string, any>} - JSON-normalized conditions.
 */
function normalizeFindConditions(conditions) {
  try {
    return /** @type {Record<string, any>} */ (JSON.parse(JSON.stringify(conditions)))
  } catch (error) {
    throw new Error(`findBy conditions could not be serialized: ${error instanceof Error ? error.message : String(error)}`, {cause: error})
  }
}

/**
 * Query wrapper for frontend model commands.
 * @template {typeof import("./base.js").default} T
 */
export default class FrontendModelQuery {
  /**
   * @param {object} args - Constructor args.
   * @param {T} args.modelClass - Frontend model class.
   * @param {import("../database/query/index.js").NestedPreloadRecord} [args.preload] - Preload map.
   */
  constructor({modelClass, preload = {}}) {
    this.modelClass = modelClass
    this._preload = normalizePreload(preload)
    this._where = {}
    this._searches = []
    this._select = {}
  }

  /**
   * @param {Record<string, any>} conditions - Root-model where conditions.
   * @returns {this} - Query with merged where conditions.
   */
  where(conditions) {
    this.modelClass.assertFindByConditions(conditions)
    const normalizedConditions = normalizeFindConditions(conditions)

    this._where = {
      ...this._where,
      ...normalizedConditions
    }

    return this
  }

  /**
   * @param {string[]} [requiredAttributes] - Extra required attributes for the root model.
   * @returns {Record<string, string[]>} - Select map with required root attributes merged when root select exists.
   */
  selectWithRequiredRootAttributes(requiredAttributes = []) {
    const rootModelName = this.modelClass.name
    const existingRootAttributes = this._select[rootModelName]

    if (!existingRootAttributes) {
      return this._select
    }

    const rootPrimaryKey = this.modelClass.primaryKey()

    return {
      ...this._select,
      [rootModelName]: Array.from(new Set([rootPrimaryKey, ...existingRootAttributes, ...requiredAttributes]))
    }
  }

  /**
   * @param {import("../database/query/index.js").NestedPreloadRecord | string | string[]} preload - Preload to merge.
   * @returns {this} - Query with merged preloads.
   */
  preload(preload) {
    mergePreloadRecord(this._preload, normalizePreload(preload))

    return this
  }

  /**
   * @param {Record<string, string[] | string>} select - Model-aware attribute select map.
   * @returns {this} - Query with merged selected attributes.
   */
  select(select) {
    mergeSelectRecord(this._select, normalizeSelect(select))

    return this
  }

  /**
   * @param {string[]} path - Relationship path.
   * @param {string} column - Column or attribute name.
   * @param {"eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} operator - Search operator.
   * @param {any} value - Search value.
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

    this._searches.push({
      column,
      operator,
      path: [...path],
      value
    })

    return this
  }

  /**
   * @returns {Record<string, any>} - Payload preload hash when present.
   */
  preloadPayload() {
    if (Object.keys(this._preload).length === 0) return {}

    return {preload: this._preload}
  }

  /**
   * @param {string[]} [requiredAttributes] - Extra required attributes for root model selection.
   * @returns {Record<string, any>} - Payload select hash when present.
   */
  selectPayload(requiredAttributes = []) {
    const select = this.selectWithRequiredRootAttributes(requiredAttributes)

    if (Object.keys(select).length === 0) return {}

    return {select}
  }

  /**
   * @returns {Record<string, any>} - Payload searches array when present.
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
   * @returns {Record<string, any>} - Payload where hash when present.
   */
  wherePayload() {
    if (Object.keys(this._where).length === 0) return {}

    return {
      where: this._where
    }
  }

  /**
   * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
   */
  async toArray() {
    const response = await this.modelClass.executeCommand("index", {
      ...this.preloadPayload(),
      ...this.searchPayload(),
      ...this.selectPayload(),
      ...this.wherePayload()
    })

    if (!response || typeof response !== "object") {
      throw new Error(`Expected object response but got: ${response}`)
    }

    const models = Array.isArray(response.models) ? response.models : []

    return /** @type {InstanceType<T>[]} */ (models.map((model) => this.modelClass.instantiateFromResponse(model)))
  }

  /**
   * @returns {Promise<number>} - Number of loaded model instances.
   */
  async count() {
    const models = await this.toArray()

    return models.length
  }

  /**
   * @param {number | string} id - Record id.
   * @returns {Promise<InstanceType<T>>} - Found model.
   */
  async find(id) {
    const response = await this.modelClass.executeCommand("find", {
      id,
      ...this.preloadPayload(),
      ...this.selectPayload()
    })

    return this.modelClass.instantiateFromResponse(response)
  }

  /**
   * @param {Record<string, any>} conditions - Conditions.
   * @returns {Promise<InstanceType<T> | null>} - Found model or null.
   */
  async findBy(conditions) {
    this.modelClass.assertFindByConditions(conditions)
    const normalizedConditions = normalizeFindConditions(conditions)
    const mergedWhere = {
      ...this._where,
      ...normalizedConditions
    }

    const response = await this.modelClass.executeCommand("index", {
      ...this.preloadPayload(),
      ...this.searchPayload(),
      ...this.selectPayload(Object.keys(mergedWhere)),
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
   * @param {Record<string, any>} conditions - Conditions.
   * @returns {Promise<InstanceType<T>>} - Found model.
   */
  async findByOrFail(conditions) {
    const model = await this.findBy(conditions)

    if (!model) {
      throw new Error(`${this.modelClass.name} not found for conditions: ${serializeFindConditions(conditions)}`)
    }

    return model
  }
}
