// @ts-check

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
    throw new Error(`findBy conditions could not be serialized: ${error instanceof Error ? error.message : String(error)}`)
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

    const valueObject = /** @type {Record<string, unknown>} */ (value)

    for (const nestedKey in valueObject) {
      assertDefinedFindByConditionValue(valueObject[nestedKey], `${keyPath}.${nestedKey}`)
    }
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

    for (const nestedKey in originalObject) {
      if (!(nestedKey in normalizedObject)) {
        throw new Error(`findBy condition key was removed during serialization (key: ${keyPath}.${nestedKey})`)
      }

      assertFindByConditionSerializationPreservesValue(originalObject[nestedKey], normalizedObject[nestedKey], `${keyPath}.${nestedKey}`)
    }

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
   * @returns {Record<string, any>} - Attributes hash.
   */
  attributes() {
    return this._attributes
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
    return this._attributes[attributeName]
  }

  /**
   * @param {string} attributeName - Attribute name.
   * @param {any} newValue - New value.
   * @returns {any} - Assigned value.
   */
  setAttribute(attributeName, newValue) {
    this._attributes[attributeName] = newValue

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
    if (!response || typeof response !== "object") {
      throw new Error(`Expected object response but got: ${response}`)
    }

    if (response.model && typeof response.model === "object") {
      return response.model
    }

    if (response.attributes && typeof response.attributes === "object") {
      return response.attributes
    }

    return /** @type {Record<string, any>} */ (response)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} response - Response payload.
   * @returns {InstanceType<T>} - New model instance.
   */
  static instantiateFromResponse(response) {
    const attributes = this.attributesFromResponse(response)

    return /** @type {InstanceType<T>} */ (new this(attributes))
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {number | string} id - Record identifier.
   * @returns {Promise<InstanceType<T>>} - Resolved model.
   */
  static async find(id) {
    const response = await this.executeCommand("find", {id})

    return this.instantiateFromResponse(response)
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} conditions - Attribute match conditions.
   * @returns {Promise<InstanceType<T> | null>} - Found model or null.
   */
  static async findBy(conditions) {
    this.assertFindByConditions(conditions)
    const normalizedConditions = normalizeFindConditions(conditions)

    const response = await this.executeCommand("index", {
      where: normalizedConditions
    })

    if (!response || typeof response !== "object") {
      throw new Error(`Expected object response but got: ${response}`)
    }

    const models = Array.isArray(response.models) ? response.models : []

    for (const modelData of models) {
      const model = this.instantiateFromResponse(modelData)

      if (this.matchesFindByConditions(model, normalizedConditions)) {
        return model
      }
    }

    return null
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @param {Record<string, any>} conditions - Attribute match conditions.
   * @returns {Promise<InstanceType<T>>} - Found model.
   */
  static async findByOrFail(conditions) {
    const model = await this.findBy(conditions)

    if (!model) {
      throw new Error(`${this.name} not found for conditions: ${serializeFindConditions(conditions)}`)
    }

    return model
  }

  /**
   * @template {typeof FrontendModelBase} T
   * @this {T}
   * @returns {Promise<InstanceType<T>[]>} - Loaded model instances.
   */
  static async toArray() {
    const response = await this.executeCommand("index", {})

    if (!response || typeof response !== "object") {
      throw new Error(`Expected object response but got: ${response}`)
    }

    const models = Array.isArray(response.models) ? response.models : []

    return /** @type {InstanceType<T>[]} */ (models.map((model) => this.instantiateFromResponse(model)))
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {Record<string, any>} conditions - findBy conditions.
   * @returns {void}
   */
  static assertFindByConditions(conditions) {
    assertFindByConditionsShape(conditions)
    const normalizedConditions = normalizeFindConditions(conditions)

    for (const key in conditions) {
      assertDefinedFindByConditionValue(conditions[key], key)
      assertFindByConditionSerializationPreservesValue(conditions[key], normalizedConditions[key], key)
    }
  }

  /**
   * @this {typeof FrontendModelBase}
   * @param {FrontendModelBase} model - Candidate model.
   * @param {Record<string, any>} conditions - Match conditions.
   * @returns {boolean} - Whether the model matches all conditions.
   */
  static matchesFindByConditions(model, conditions) {
    for (const key in conditions) {
      const expectedValue = conditions[key]
      const actualValue = model.readAttribute(key)

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

      for (const key in expectedObject) {
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
    const url = frontendModelCommandUrl(this.resourcePath(), commandName)

    if (frontendModelTransportConfig.request) {
      return await frontendModelTransportConfig.request({
        commandName,
        commandType,
        modelClass: this,
        payload,
        url
      })
    }

    const response = await fetch(url, {
      body: JSON.stringify(payload),
      credentials: frontendModelTransportConfig.credentials,
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    })

    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${this.name}#${commandType}`)
    }

    return await response.json()
  }
}
