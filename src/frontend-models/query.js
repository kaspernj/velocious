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
 * @typedef {object} FrontendModelSort
 * @property {string} column - Attribute name to sort by.
 * @property {"asc" | "desc"} direction - Sort direction.
 * @property {string[]} path - Relationship path from root model.
 */

/**
 * @param {unknown} direction - Direction value.
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
 * @param {unknown} value - Candidate tuple.
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
 * @param {Record<string, any>} sortValue - Nested sort object.
 * @param {string[]} path - Relationship path.
 * @returns {FrontendModelSort[]} - Normalized sort descriptors.
 */
function normalizeSortObject(sortValue, path) {
  /** @type {FrontendModelSort[]} */
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
 * @param {unknown} sort - Sort payload.
 * @returns {FrontendModelSort[]} - Normalized sort definitions.
 */
function normalizeSort(sort) {
  if (!sort) return []

  if (typeof sort === "string") {
    return [parseSortString(sort)]
  }

  if (sortTuple(sort)) {
    return [parseSortTuple(sort)]
  }

  if (isPlainObject(sort)) {
    return normalizeSortObject(sort, [])
  }

  if (Array.isArray(sort)) {
    /** @type {FrontendModelSort[]} */
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
    this._sort = []
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
   * @param {string | string[] | [string, string] | Array<[string, string]> | Record<string, any> | Array<Record<string, any>>} sort - Sort definition(s).
   * @returns {this} - Query with appended sort definitions.
   */
  sort(sort) {
    this._sort.push(...normalizeSort(sort))

    return this
  }

  /**
   * @param {string | string[] | [string, string] | Array<[string, string]> | Record<string, any> | Array<Record<string, any>>} sort - Sort definition(s).
   * @returns {this} - Query with appended sort definitions.
   */
  order(sort) {
    return this.sort(sort)
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
   * @returns {Record<string, any>} - Payload sort array when present.
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
      ...this.sortPayload(),
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
      ...this.sortPayload(),
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

  /**
   * @returns {Promise<InstanceType<T> | null>} - First model or null.
   */
  async first() {
    const models = await this.toArray()

    return models[0] || null
  }

  /**
   * @returns {Promise<InstanceType<T> | null>} - Last model or null.
   */
  async last() {
    const models = await this.toArray()

    if (models.length < 1) return null

    return models[models.length - 1]
  }

  /**
   * @param {Record<string, any>} conditions - Conditions.
   * @returns {Promise<InstanceType<T>>} - Existing or initialized model.
   */
  async findOrInitializeBy(conditions) {
    const model = await this.findBy(conditions)

    if (model) return model

    return /** @type {InstanceType<T>} */ (new this.modelClass(conditions))
  }

  /**
   * @param {Record<string, any>} conditions - Conditions.
   * @param {(model: InstanceType<T>) => Promise<void> | void} [callback] - Optional callback before save.
   * @returns {Promise<InstanceType<T>>} - Existing or newly created model.
   */
  async findOrCreateBy(conditions, callback) {
    const model = await this.findBy(conditions)

    if (model) return model

    const newModel = /** @type {InstanceType<T>} */ (new this.modelClass(conditions))

    if (callback) {
      await callback(newModel)
    }

    await newModel.save()

    return newModel
  }
}
