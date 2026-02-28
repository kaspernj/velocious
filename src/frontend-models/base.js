// @ts-check

import FrontendModelQuery from "./query.js"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "./transport-serialization.js"

/** @typedef {{commands?: Record<string, string>, path?: string, primaryKey?: string}} FrontendModelResourceConfig */
/**
 * @typedef {object} FrontendModelTransportConfig
 * @property {string} [baseUrl] - Optional base URL prefixed before resource paths.
 * @property {(() => string | undefined | null)} [baseUrlResolver] - Optional resolver used per request for dynamic base URL.
 * @property {string} [pathPrefix] - Optional path prefix inserted between base URL and resource path.
 * @property {(() => string | undefined | null)} [pathPrefixResolver] - Optional resolver used per request for dynamic path prefix.
 * @property {"omit" | "same-origin" | "include"} [credentials] - Optional credentials mode forwarded to fetch.
 * @property {((args: {commandName: string, commandType: "find" | "index" | "update" | "destroy", modelClass: typeof FrontendModelBase, payload: Record<string, any>, url: string}) => Promise<Record<string, any>>)} [request] - Optional custom transport handler.
 */

/** @type {FrontendModelTransportConfig} */
const frontendModelTransportConfig = {}
const SHARED_FRONTEND_MODEL_API_PATH = "/velocious/api"
const PRELOADED_RELATIONSHIPS_KEY = "__preloadedRelationships"
const SELECTED_ATTRIBUTES_KEY = "__selectedAttributes"
/** @type {Array<{commandType: "find" | "index" | "update" | "destroy", modelClass: typeof FrontendModelBase, payload: Record<string, any>, requestId: string, resolve: (response: Record<string, any>) => void, reject: (error: unknown) => void}>} */
let pendingSharedFrontendModelRequests = []
let sharedFrontendModelRequestId = 0
let sharedFrontendModelFlushScheduled = false

/** Error raised when reading an attribute that was not selected in query payloads. */
export class AttributeNotSelectedError extends Error {
  /**
   * @param {string} modelName - Model class name.
   * @param {string} attributeName - Attribute that was requested.
   */
  constructor(modelName, attributeName) {
    super(`${modelName}#${attributeName} was not selected`)
    this.name = "AttributeNotSelectedError"
  }
}

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
 * Lightweight singular relationship state holder for frontend model instances.
 * @template {typeof FrontendModelBase} S
 * @template {typeof FrontendModelBase} T
 */
export class FrontendModelSingularRelationship {
  /**
   * @param {InstanceType<S>} model - Parent model.
   * @param {string} relationshipName - Relationship name.
   * @param {T | null} targetModelClass - Target model class.
   */
  constructor(model, relationshipName, targetModelClass) {
    this.model = model
    this.relationshipName = relationshipName
    this.targetModelClass = targetModelClass
    this._preloaded = false
    this._loadedValue = null
  }

  /**
   * @param {any} loadedValue - Loaded relationship value.
   * @returns {void}
   */
  setLoaded(loadedValue) {
    this._loadedValue = loadedValue == undefined ? null : loadedValue
    this._preloaded = true
  }

  /**
   * @returns {boolean} - Whether relationship is preloaded.
   */
  getPreloaded() {
    return this._preloaded
  }

  /**
   * @returns {any} - Loaded relationship value.
   */
  loaded() {
    if (!this._preloaded) {
      throw new Error(`${this.model.constructor.name}#${this.relationshipName} hasn't been preloaded`)
    }

    return this._loadedValue
  }

  /**
   * @param {Record<string, any>} [attributes] - New model attributes.
   * @returns {InstanceType<T>} - Built model.
   */
  build(attributes = {}) {
    if (!this.targetModelClass) {
      throw new Error(`No target model class configured for ${this.model.constructor.name}#${this.relationshipName}`)
    }

    const model = /** @type {InstanceType<T>} */ (new this.targetModelClass(attributes))

    this.setLoaded(model)

    return model
  }
}

/**
 * Lightweight has-many relationship state holder for frontend model instances.
 * @template {typeof FrontendModelBase} S
 * @template {typeof FrontendModelBase} T
 */
export class FrontendModelHasManyRelationship {
  /**
   * @param {InstanceType<S>} model - Parent model.
   * @param {string} relationshipName - Relationship name.
   * @param {T | null} targetModelClass - Target model class.
   */
  constructor(model, relationshipName, targetModelClass) {
    this.model = model
    this.relationshipName = relationshipName
    this.targetModelClass = targetModelClass
    this._preloaded = false
    this._loadedValue = []
  }

  /**
   * @param {Array<InstanceType<T>>} loadedValue - Loaded relationship value.
   * @returns {void}
   */
  setLoaded(loadedValue) {
    this._loadedValue = Array.isArray(loadedValue) ? loadedValue : []
    this._preloaded = true
  }

  /**
   * @returns {boolean} - Whether relationship is preloaded.
   */
  getPreloaded() {
    return this._preloaded
  }

  /**
   * @returns {Array<InstanceType<T>>} - Loaded relationship values.
   */
  loaded() {
    if (!this._preloaded) {
      throw new Error(`${this.model.constructor.name}#${this.relationshipName} hasn't been preloaded`)
    }

    return this._loadedValue
  }

  /**
   * @param {Array<InstanceType<T>>} models - Models to append.
   * @returns {void}
   */
  addToLoaded(models) {
    const loadedModels = this.getPreloaded() ? this.loaded() : []

    this.setLoaded([...loadedModels, ...models])
  }

  /**
   * @param {Record<string, any>} [attributes] - New model attributes.
   * @returns {InstanceType<T>} - Built model.
   */
  build(attributes = {}) {
    if (!this.targetModelClass) {
      throw new Error(`No target model class configured for ${this.model.constructor.name}#${this.relationshipName}`)
    }

    const model = /** @type {InstanceType<T>} */ (new this.targetModelClass(attributes))

    this.addToLoaded([model])

    return model
  }
}

/**
 * @param {string} relationshipType - Relationship type.
 * @returns {boolean} - Whether relationship type is has-many.
 */
function relationshipTypeIsCollection(relationshipType) {
  return relationshipType == "hasMany"
}

/**
 * @param {string | undefined | null} value - Base URL candidate.
 * @returns {string} - Normalized base URL without trailing slash.
 */
function normalizeBaseUrl(value) {
  if (typeof value !== "string") return ""

  const trimmed = value.trim()

  if (!trimmed.length) return ""

  return trimmed.replace(/\/+$/, "")
}

/**
 * @param {string | undefined | null} value - Path prefix candidate.
 * @returns {string} - Normalized path prefix with leading slash and no trailing slash.
 */
function normalizePathPrefix(value) {
  if (typeof value !== "string") return ""

  const trimmed = value.trim()

  if (!trimmed.length) return ""

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`

  return withLeadingSlash.replace(/\/+$/, "")
}

/**
 * @param {string} resourcePath - Resource path (expected absolute path).
 * @param {string} commandName - Command name.
 * @returns {string} - Combined command URL.
 */
function frontendModelCommandUrl(resourcePath, commandName) {
  const resolvedBaseUrl = frontendModelTransportConfig.baseUrlResolver
    ? frontendModelTransportConfig.baseUrlResolver()
    : frontendModelTransportConfig.baseUrl
  const baseUrl = normalizeBaseUrl(resolvedBaseUrl)
  const resolvedPathPrefix = frontendModelTransportConfig.pathPrefixResolver
    ? frontendModelTransportConfig.pathPrefixResolver()
    : frontendModelTransportConfig.pathPrefix
  const pathPrefix = normalizePathPrefix(resolvedPathPrefix)
  const normalizedResourcePath = resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`

  return `${baseUrl}${pathPrefix}${normalizedResourcePath}/${commandName}`
}

/**
 * @returns {string} - Shared frontend-model API URL.
 */
function frontendModelApiUrl() {
  const resolvedBaseUrl = frontendModelTransportConfig.baseUrlResolver
    ? frontendModelTransportConfig.baseUrlResolver()
    : frontendModelTransportConfig.baseUrl
  const baseUrl = normalizeBaseUrl(resolvedBaseUrl)
  const resolvedPathPrefix = frontendModelTransportConfig.pathPrefixResolver
    ? frontendModelTransportConfig.pathPrefixResolver()
    : frontendModelTransportConfig.pathPrefix
  const pathPrefix = normalizePathPrefix(resolvedPathPrefix)

  return `${baseUrl}${pathPrefix}${SHARED_FRONTEND_MODEL_API_PATH}`
}

/**
 * @returns {Promise<void>} - Resolves after pending shared frontend-model requests flush.
 */
async function flushPendingSharedFrontendModelRequests() {
  sharedFrontendModelFlushScheduled = false

  if (pendingSharedFrontendModelRequests.length < 1) return

  const batchedRequests = pendingSharedFrontendModelRequests
  pendingSharedFrontendModelRequests = []

  const url = frontendModelApiUrl()
  const requestPayload = {
    requests: batchedRequests.map((request) => ({
      commandType: request.commandType,
      model: request.modelClass.name,
      payload: request.payload,
      requestId: request.requestId
    }))
  }

  try {
    const response = await fetch(url, {
      body: JSON.stringify(serializeFrontendModelTransportValue(requestPayload)),
      credentials: frontendModelTransportConfig.credentials,
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    })

    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for shared frontend model API`)
    }

    const responseText = await response.text()
    const json = responseText.length > 0 ? JSON.parse(responseText) : {}
    const decodedResponse = /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(json))
    const responses = Array.isArray(decodedResponse.responses) ? decodedResponse.responses : []
    const responsesById = new Map(responses.map((entry) => [entry.requestId, entry.response]))

    for (const request of batchedRequests) {
      const responsePayload = responsesById.get(request.requestId)

      if (!responsePayload || typeof responsePayload !== "object") {
        request.reject(new Error(`Missing batched response for ${request.modelClass.name}#${request.commandType}`))
        continue
      }

      request.resolve(/** @type {Record<string, any>} */ (responsePayload))
    }
  } catch (error) {
    for (const request of batchedRequests) {
      request.reject(error)
    }
  }
}

/** @returns {void} */
function scheduleSharedFrontendModelRequestFlush() {
  if (sharedFrontendModelFlushScheduled) return

  sharedFrontendModelFlushScheduled = true
  queueMicrotask(() => {
    void flushPendingSharedFrontendModelRequests()
  })
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
 * @param {unknown} conditions - findBy conditions.
 * @returns {void}
 */
function assertFindByConditionsShape(conditions) {
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) {
    throw new Error(`findBy expects conditions to be a plain object, got: ${conditions}`)
  }

  const conditionsPrototype = Object.getPrototypeOf(conditions)

  if (conditionsPrototype !== Object.prototype && conditionsPrototype !== null) {
    throw new Error(`findBy expects conditions to be a plain object, got: ${conditions}`)
  }

  const symbolKeys = Object.getOwnPropertySymbols(conditions)

  if (symbolKeys.length > 0) {
    throw new Error(`findBy does not support symbol condition keys (keys: ${symbolKeys.map((key) => key.toString()).join(", ")})`)
  }
}

/**
 * @param {unknown} value - Condition value to validate.
 * @param {string} keyPath - Key path for error output.
 * @returns {void}
 */
function assertDefinedFindByConditionValue(value, keyPath) {
  if (value === undefined) {
    throw new Error(`findBy does not support undefined condition values (key: ${keyPath})`)
  }

  if (typeof value === "function") {
    throw new Error(`findBy does not support function condition values (key: ${keyPath})`)
  }

  if (typeof value === "symbol") {
    throw new Error(`findBy does not support symbol condition values (key: ${keyPath})`)
  }

  if (typeof value === "bigint") {
    throw new Error(`findBy does not support bigint condition values (key: ${keyPath})`)
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`findBy does not support non-finite number condition values (key: ${keyPath})`)
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertDefinedFindByConditionValue(entry, `${keyPath}[${index}]`)
    })
    return
  }

  if (value && typeof value === "object") {
    if (value instanceof Date) {
      return
    }

    const objectValue = /** @type {Record<string, unknown>} */ (value)
    const prototype = Object.getPrototypeOf(objectValue)

    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`findBy does not support non-plain object condition values (key: ${keyPath})`)
    }

    const symbolKeys = Object.getOwnPropertySymbols(objectValue)

    if (symbolKeys.length > 0) {
      throw new Error(`findBy does not support symbol condition keys (key: ${keyPath})`)
    }

    const valueObject = /** @type {Record<string, unknown>} */ (value)

    Object.keys(valueObject).forEach((nestedKey) => {
      assertDefinedFindByConditionValue(valueObject[nestedKey], `${keyPath}.${nestedKey}`)
    })
  }
}

/**
 * @param {unknown} originalValue - Original condition value.
 * @param {unknown} normalizedValue - JSON-normalized condition value.
 * @param {string} keyPath - Key path for error output.
 * @returns {void}
 */
function assertFindByConditionSerializationPreservesValue(originalValue, normalizedValue, keyPath) {
  if (originalValue === null) {
    if (normalizedValue !== null) {
      throw new Error(`findBy condition changed during serialization (key: ${keyPath})`)
    }

    return
  }

  if (Array.isArray(originalValue)) {
    if (!Array.isArray(normalizedValue)) {
      throw new Error(`findBy condition changed during serialization (key: ${keyPath})`)
    }

    if (originalValue.length !== normalizedValue.length) {
      throw new Error(`findBy condition changed during serialization (key: ${keyPath})`)
    }

    for (let index = 0; index < originalValue.length; index += 1) {
      assertFindByConditionSerializationPreservesValue(originalValue[index], normalizedValue[index], `${keyPath}[${index}]`)
    }

    return
  }

  if (originalValue instanceof Date) {
    if (typeof normalizedValue !== "string") {
      throw new Error(`findBy condition changed during serialization (key: ${keyPath})`)
    }

    return
  }

  if (originalValue && typeof originalValue === "object") {
    if (!normalizedValue || typeof normalizedValue !== "object" || Array.isArray(normalizedValue)) {
      throw new Error(`findBy condition changed during serialization (key: ${keyPath})`)
    }

    const normalizedObject = /** @type {Record<string, unknown>} */ (normalizedValue)
    const originalObject = /** @type {Record<string, unknown>} */ (originalValue)

    Object.keys(originalObject).forEach((nestedKey) => {
      if (!(nestedKey in normalizedObject)) {
        throw new Error(`findBy condition key was removed during serialization (key: ${keyPath}.${nestedKey})`)
      }

      assertFindByConditionSerializationPreservesValue(originalObject[nestedKey], normalizedObject[nestedKey], `${keyPath}.${nestedKey}`)
    })

    return
  }

  if (normalizedValue !== originalValue) {
    throw new Error(`findBy condition changed during serialization (key: ${keyPath})`)
  }
}

/** Base class for generated frontend model classes. */
export default class FrontendModelBase {
  /**
   * @param {Record<string, any>} [attributes] - Initial attributes.
   */
  constructor(attributes = {}) {
    this._attributes = {}
    this._relationships = {}
    this._selectedAttributes = null
    this.assignAttributes(attributes)
  }

  /**
   * @returns {FrontendModelResourceConfig} - Resource configuration.
   */
  static resourceConfig() {
    throw new Error("resourceConfig() must be implemented by subclasses")
    // eslint-disable-next-line no-unreachable
    return {}
  }

  /**
   * @this {typeof FrontendModelBase}
   * @returns {Record<string, typeof FrontendModelBase>} - Relationship model classes keyed by relationship name.
   */
  static relationshipModelClasses() {
    return {}
  }

  /**
   * @this {typeof FrontendModelBase}
   * @returns {Record<string, {type: "belongsTo" | "hasOne" | "hasMany"}>} - Relationship definitions keyed by relationship name.
   */
  static relationshipDefinitions() {
    return {}
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {string} relationshipName - Relationship name.
   * @returns {{type: "belongsTo" | "hasOne" | "hasMany"} | null} - Relationship definition.
   */
  static relationshipDefinition(relationshipName) {
    const definitions = this.relationshipDefinitions()

    return definitions[relationshipName] || null
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {string} relationshipName - Relationship name.
   * @returns {typeof FrontendModelBase | null} - Target relationship model class.
   */
  static relationshipModelClass(relationshipName) {
    const relationshipModelClasses = this.relationshipModelClasses()

    return relationshipModelClasses[relationshipName] || null
  }

  /**
   * @returns {Record<string, any>} - Attributes hash.
   */
  attributes() {
    return this._attributes
  }

  /**
   * @param {string} relationshipName - Relationship name.
   * @returns {FrontendModelHasManyRelationship<any, any> | FrontendModelSingularRelationship<any, any>} - Relationship state object.
   */
  getRelationshipByName(relationshipName) {
    if (!this._relationships[relationshipName]) {
      const ModelClass = /** @type {typeof FrontendModelBase} */ (this.constructor)
      const relationshipDefinition = ModelClass.relationshipDefinition(relationshipName)
      const targetModelClass = ModelClass.relationshipModelClass(relationshipName)

      if (relationshipDefinition && relationshipTypeIsCollection(relationshipDefinition.type)) {
        this._relationships[relationshipName] = new FrontendModelHasManyRelationship(this, relationshipName, targetModelClass)
      } else {
        this._relationships[relationshipName] = new FrontendModelSingularRelationship(this, relationshipName, targetModelClass)
      }
    }

    return this._relationships[relationshipName]
  }

  /**
   * @param {Record<string, any>} attributes - Attributes to assign.
   * @returns {void} - No return value.
   */
  assignAttributes(attributes) {
    for (const key in attributes) {
      this.setAttribute(key, attributes[key])
    }
  }

  /**
   * @returns {void} - Clears cached relationship state.
   */
  clearRelationshipCache() {
    this._relationships = {}
  }

  /**
   * @this {typeof FrontendModelBase}
   * @returns {string} - Primary key name.
   */
  static primaryKey() {
    return this.resourceConfig().primaryKey || "id"
  }

  /**
   * @returns {number | string} - Primary key value.
   */
  primaryKeyValue() {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.constructor)
    const value = this.readAttribute(ModelClass.primaryKey())

    if (value === undefined || value === null) {
      throw new Error(`Missing primary key '${ModelClass.primaryKey()}' on ${ModelClass.name}`)
    }

    return value
  }

  /**
   * @param {string} attributeName - Attribute name.
   * @returns {any} - Attribute value.
   */
  readAttribute(attributeName) {
    if (this._selectedAttributes && !this._selectedAttributes.has(attributeName)) {
      throw new AttributeNotSelectedError(this.constructor.name, attributeName)
    }

    return this._attributes[attributeName]
  }

  /**
   * @param {string} attributeName - Attribute name.
   * @param {any} newValue - New value.
   * @returns {any} - Assigned value.
   */
  setAttribute(attributeName, newValue) {
    const previousValue = this._attributes[attributeName]

    this._attributes[attributeName] = newValue

    if (this._selectedAttributes) {
      this._selectedAttributes.add(attributeName)
    }

    if (!Object.is(previousValue, newValue)) {
      this.clearRelationshipCache()
    }

    return newValue
  }

  /**
   * @this {typeof FrontendModelBase}
   * @returns {string} - Resource path.
   */
  static resourcePath() {
    const path = this.resourceConfig().path

    if (!path) throw new Error(`Missing resource path for ${this.name}`)

    return path
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {"find" | "index" | "update" | "destroy"} commandType - Command type.
   * @returns {string} - Resolved command name.
   */
  static commandName(commandType) {
    const commands = this.resourceConfig().commands || {}

    return commands[commandType] || commandType
  }

  /**
   * @param {FrontendModelTransportConfig} config - Frontend model transport configuration.
   * @returns {void} - No return value.
   */
  static configureTransport(config) {
    if (!config || typeof config !== "object") {
      return
    }

    if (Object.prototype.hasOwnProperty.call(config, "baseUrl")) {
      frontendModelTransportConfig.baseUrl = config.baseUrl
    }

    if (Object.prototype.hasOwnProperty.call(config, "baseUrlResolver")) {
      frontendModelTransportConfig.baseUrlResolver = config.baseUrlResolver
    }

    if (Object.prototype.hasOwnProperty.call(config, "credentials")) {
      frontendModelTransportConfig.credentials = config.credentials
    }

    if (Object.prototype.hasOwnProperty.call(config, "pathPrefix")) {
      frontendModelTransportConfig.pathPrefix = config.pathPrefix
    }

    if (Object.prototype.hasOwnProperty.call(config, "pathPrefixResolver")) {
      frontendModelTransportConfig.pathPrefixResolver = config.pathPrefixResolver
    }

    if (Object.prototype.hasOwnProperty.call(config, "request")) {
      frontendModelTransportConfig.request = config.request
    }
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {object} response - Response payload.
   * @returns {Record<string, any>} - Attributes from payload.
   */
  static attributesFromResponse(response) {
    const modelData = this.modelDataFromResponse(response)

    return modelData.attributes
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {object} response - Response payload.
   * @returns {{attributes: Record<string, any>, preloadedRelationships: Record<string, any>, selectedAttributes: string[] | null}} - Attributes and preload/select payload.
   */
  static modelDataFromResponse(response) {
    if (!response || typeof response !== "object") {
      throw new Error(`Expected object response but got: ${response}`)
    }

    /** @type {Record<string, any>} */
    let modelData

    if (response.model && typeof response.model === "object") {
      modelData = response.model
    } else if (response.attributes && typeof response.attributes === "object") {
      modelData = response.attributes
    } else {
      modelData = /** @type {Record<string, any>} */ (response)
    }

    const attributes = {...modelData}
    const preloadedRelationships = isPlainObject(attributes[PRELOADED_RELATIONSHIPS_KEY])
      ? /** @type {Record<string, any>} */ (attributes[PRELOADED_RELATIONSHIPS_KEY])
      : {}
    const selectedAttributesFromPayload = Array.isArray(attributes[SELECTED_ATTRIBUTES_KEY])
      ? /** @type {string[]} */ (attributes[SELECTED_ATTRIBUTES_KEY]).filter((attributeName) => typeof attributeName === "string")
      : null

    delete attributes[PRELOADED_RELATIONSHIPS_KEY]
    delete attributes[SELECTED_ATTRIBUTES_KEY]

    const selectedAttributes = selectedAttributesFromPayload || Object.keys(attributes)

    return {attributes, preloadedRelationships, selectedAttributes}
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {FrontendModelBase} model - Model instance.
   * @param {Record<string, any>} preloadedRelationships - Preloaded relationship payload.
   * @returns {void}
   */
  static applyPreloadedRelationships(model, preloadedRelationships) {
    for (const [relationshipName, relationshipPayload] of Object.entries(preloadedRelationships)) {
      const relationship = model.getRelationshipByName(relationshipName)
      const targetModelClass = this.relationshipModelClass(relationshipName)

      if (Array.isArray(relationshipPayload)) {
        relationship.setLoaded(relationshipPayload.map((entry) => this.instantiateRelationshipValue(entry, targetModelClass)))
        continue
      }

      relationship.setLoaded(this.instantiateRelationshipValue(relationshipPayload, targetModelClass))
    }
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {any} relationshipPayload - Relationship payload value.
   * @param {typeof FrontendModelBase | null} targetModelClass - Target model class.
   * @returns {any} - Instantiated relationship value.
   */
  static instantiateRelationshipValue(relationshipPayload, targetModelClass) {
    if (!targetModelClass) return relationshipPayload

    if (!relationshipPayload || typeof relationshipPayload !== "object") return relationshipPayload

    return targetModelClass.instantiateFromResponse(relationshipPayload)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} response - Response payload.
   * @returns {InstanceType<T>} - New model instance.
   */
  static instantiateFromResponse(response) {
    const modelData = this.modelDataFromResponse(response)
    const attributes = modelData.attributes
    const preloadedRelationships = modelData.preloadedRelationships
    const selectedAttributes = modelData.selectedAttributes
    const model = /** @type {InstanceType<T>} */ (new this(attributes))
    model._selectedAttributes = selectedAttributes ? new Set(selectedAttributes) : null

    this.applyPreloadedRelationships(model, preloadedRelationships)

    return model
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {number | string} id - Record identifier.
   * @returns {Promise<InstanceType<T>>} - Resolved model.
   */
  static async find(id) {
    return await this.query().find(id)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} conditions - Attribute match conditions.
   * @returns {Promise<InstanceType<T> | null>} - Found model or null.
   */
  static async findBy(conditions) {
    return await this.query().findBy(conditions)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} conditions - Attribute match conditions.
   * @returns {Promise<InstanceType<T>>} - Found model.
   */
  static async findByOrFail(conditions) {
    return await this.query().findByOrFail(conditions)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
   */
  static async toArray() {
    return await this.query().toArray()
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} conditions - Root-model where conditions.
   * @returns {import("./query.js").default<T>} - Query with where conditions.
   */
  static where(conditions) {
    return this.query().where(conditions)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @returns {Promise<number>} - Number of loaded model instances.
   */
  static async count() {
    return await this.query().count()
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {string[]} path - Relationship path.
   * @param {string} column - Column or attribute name.
   * @param {"eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} operator - Search operator.
   * @param {any} value - Search value.
   * @returns {FrontendModelQuery<T>} - Query builder with search filter.
   */
  static search(path, column, operator, value) {
    return this.query().search(path, column, operator, value)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {string | string[] | [string, string] | Array<[string, string]> | Record<string, any> | Array<Record<string, any>>} sort - Sort definition(s).
   * @returns {FrontendModelQuery<T>} - Query builder with sort definitions.
   */
  static sort(sort) {
    return this.query().sort(sort)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @returns {FrontendModelQuery<T>} - Query builder.
   */
  static query() {
    return /** @type {FrontendModelQuery<T>} */ (new FrontendModelQuery({modelClass: this}))
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {import("../database/query/index.js").NestedPreloadRecord | string | string[]} preload - Preload graph.
   * @returns {FrontendModelQuery<T>} - Query with preload.
   */
  static preload(preload) {
    return /** @type {FrontendModelQuery<T>} */ (this.query().preload(preload))
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, string[] | string>} select - Model-aware attribute select map.
   * @returns {FrontendModelQuery<T>} - Query with selected attributes.
   */
  static select(select) {
    return /** @type {FrontendModelQuery<T>} */ (this.query().select(select))
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {Record<string, any>} conditions - findBy conditions.
   * @returns {void}
   */
  static assertFindByConditions(conditions) {
    assertFindByConditionsShape(conditions)
    const normalizedConditions = normalizeFindConditions(conditions)

    Object.keys(conditions).forEach((key) => {
      assertDefinedFindByConditionValue(conditions[key], key)
      assertFindByConditionSerializationPreservesValue(conditions[key], normalizedConditions[key], key)
    })
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {FrontendModelBase} model - Candidate model.
   * @param {Record<string, any>} conditions - Match conditions.
   * @returns {boolean} - Whether the model matches all conditions.
   */
  static matchesFindByConditions(model, conditions) {
    const modelAttributes = model.attributes()

    for (const key of Object.keys(conditions)) {
      const expectedValue = conditions[key]
      const actualValue = modelAttributes[key]

      if (Array.isArray(expectedValue)) {
        if (Array.isArray(actualValue)) {
          if (!this.findByConditionValueMatches(actualValue, expectedValue)) {
            return false
          }
        } else if (!expectedValue.some((entry) => this.findByConditionValueMatches(actualValue, entry))) {
          return false
        }
      } else if (!this.findByConditionValueMatches(actualValue, expectedValue)) {
        return false
      }
    }

    return true
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {unknown} actualValue - Actual model value.
   * @param {unknown} expectedValue - Expected find condition value.
   * @returns {boolean} - Whether values match.
   */
  static findByConditionValueMatches(actualValue, expectedValue) {
    if (expectedValue === null) {
      return actualValue === null
    }

    if (Array.isArray(expectedValue)) {
      if (!Array.isArray(actualValue)) {
        return false
      }

      if (actualValue.length !== expectedValue.length) {
        return false
      }

      for (let index = 0; index < expectedValue.length; index += 1) {
        if (!this.findByConditionValueMatches(actualValue[index], expectedValue[index])) {
          return false
        }
      }

      return true
    }

    if (expectedValue && typeof expectedValue === "object") {
      if (!actualValue || typeof actualValue !== "object" || Array.isArray(actualValue)) {
        return false
      }

      const actualObject = /** @type {Record<string, unknown>} */ (actualValue)
      const expectedObject = /** @type {Record<string, unknown>} */ (expectedValue)
      const actualKeys = Object.keys(actualObject)
      const expectedKeys = Object.keys(expectedObject)

      if (actualKeys.length !== expectedKeys.length) {
        return false
      }

      for (const key of expectedKeys) {
        if (!Object.prototype.hasOwnProperty.call(actualObject, key)) {
          return false
        }

        if (!this.findByConditionValueMatches(actualObject[key], expectedObject[key])) {
          return false
        }
      }

      return true
    }

    if (actualValue === expectedValue) {
      return true
    }

    return this.findByPrimitiveValuesMatch(actualValue, expectedValue)
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {unknown} actualValue - Actual model value.
   * @param {unknown} expectedValue - Expected find condition value.
   * @returns {boolean} - Whether primitive values match after safe coercion.
   */
  static findByPrimitiveValuesMatch(actualValue, expectedValue) {
    if (actualValue instanceof Date && typeof expectedValue === "string") {
      return actualValue.toISOString() === expectedValue
    }

    if (typeof actualValue === "string" && expectedValue instanceof Date) {
      return actualValue === expectedValue.toISOString()
    }

    if (actualValue instanceof Date && expectedValue instanceof Date) {
      return actualValue.toISOString() === expectedValue.toISOString()
    }

    if (typeof actualValue === "number" && typeof expectedValue === "string") {
      return this.findByNumericStringMatchesNumber(expectedValue, actualValue)
    }

    if (typeof actualValue === "string" && typeof expectedValue === "number") {
      return this.findByNumericStringMatchesNumber(actualValue, expectedValue)
    }

    return false
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {string} numericString - Numeric string value.
   * @param {number} expectedNumber - Number value.
   * @returns {boolean} - Whether values represent the same number.
   */
  static findByNumericStringMatchesNumber(numericString, expectedNumber) {
    if (!Number.isFinite(expectedNumber)) {
      return false
    }

    if (!/^-?\d+(?:\.\d+)?$/.test(numericString)) {
      return false
    }

    return Number(numericString) === expectedNumber
  }

  /**
   * @param {Record<string, any>} [newAttributes] - New values to assign before update.
   * @returns {Promise<this>} - Updated model.
   */
  async update(newAttributes = {}) {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.constructor)

    this.assignAttributes(newAttributes)

    const response = await ModelClass.executeCommand("update", {
      attributes: this.attributes(),
      id: this.primaryKeyValue()
    })

    this.assignAttributes(ModelClass.attributesFromResponse(response))

    return this
  }

  /**
   * @returns {Promise<void>} - Resolves when destroyed on backend.
   */
  async destroy() {
    const ModelClass = /** @type {typeof FrontendModelBase} */ (this.constructor)

    await ModelClass.executeCommand("destroy", {
      id: this.primaryKeyValue()
    })
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {"find" | "index" | "update" | "destroy"} commandType - Command type.
   * @param {Record<string, any>} payload - Command payload.
   * @returns {Promise<Record<string, any>>} - Parsed JSON response.
   */
  static async executeCommand(commandType, payload) {
    const commandName = this.commandName(commandType)
    const serializedPayload = /** @type {Record<string, any>} */ (serializeFrontendModelTransportValue(payload))
    const resourceConfig = /** @type {Record<string, any>} */ (this.resourceConfig())
    const resourcePath = typeof resourceConfig.path === "string" && resourceConfig.path.length > 0 ? this.resourcePath() : null
    const url = resourcePath
      ? frontendModelCommandUrl(resourcePath, commandName)
      : frontendModelApiUrl()

    if (frontendModelTransportConfig.request) {
      const customResponse = await frontendModelTransportConfig.request({
        commandName,
        commandType,
        modelClass: this,
        payload: serializedPayload,
        url
      })

      const decodedResponse = /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(customResponse))

      this.throwOnErrorFrontendModelResponse({
        commandType,
        response: decodedResponse
      })

      return decodedResponse
    }

    if (!resourcePath) {
      return await new Promise((resolve, reject) => {
        pendingSharedFrontendModelRequests.push({
          commandType,
          modelClass: this,
          payload: serializedPayload,
          reject,
          requestId: `${++sharedFrontendModelRequestId}`,
          resolve
        })

        scheduleSharedFrontendModelRequestFlush()
      })
    }

    const response = await fetch(url, {
      body: JSON.stringify(serializedPayload),
      credentials: frontendModelTransportConfig.credentials,
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    })

    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${this.name}#${commandType}`)
    }

    const responseText = await response.text()
    const json = responseText.length > 0 ? JSON.parse(responseText) : {}
    const decodedResponse = /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(json))

    this.throwOnErrorFrontendModelResponse({
      commandType,
      response: decodedResponse
    })

    return decodedResponse
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {object} args - Arguments.
   * @param {"find" | "index" | "update" | "destroy"} args.commandType - Command type.
   * @param {Record<string, any>} args.response - Decoded response.
   * @returns {void}
   */
  static throwOnErrorFrontendModelResponse({commandType, response}) {
    if (response?.status !== "error") return

    const responseKeys = Object.keys(response)
    const hasOnlyStatus = responseKeys.length === 1 && responseKeys[0] === "status"
    const hasErrorMessage = typeof response.errorMessage === "string" && response.errorMessage.length > 0
    const hasErrorEnvelopeKeys = Boolean(
      response.code !== undefined
      || response.error !== undefined
      || response.errors !== undefined
      || response.message !== undefined
    )
    const nonStatusKeys = responseKeys.filter((key) => key !== "status")
    const configuredAttributeNames = this.configuredFrontendModelAttributeNames()
    const looksLikeRawModelPayload = nonStatusKeys.length > 0
      && nonStatusKeys.every((key) => configuredAttributeNames.has(key))

    if (!hasErrorMessage && !hasOnlyStatus && !hasErrorEnvelopeKeys && looksLikeRawModelPayload) return

    const errorMessage = hasErrorMessage
      ? response.errorMessage
      : `Request failed for ${this.name}#${commandType}`

    throw new Error(errorMessage)
  }

  /**
   * @this {typeof FrontendModelBase}
   * @returns {Set<string>} - Configured frontend model attribute names.
   */
  static configuredFrontendModelAttributeNames() {
    const resourceConfig = /** @type {Record<string, any>} */ (this.resourceConfig())
    const attributes = resourceConfig.attributes

    if (Array.isArray(attributes)) {
      return new Set(attributes.filter((attributeName) => typeof attributeName === "string"))
    }

    if (attributes && typeof attributes === "object") {
      return new Set(Object.keys(attributes))
    }

    return new Set()
  }
}
