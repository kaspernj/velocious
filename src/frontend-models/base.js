// @ts-check

/** @typedef {{commands?: Record<string, string>, path?: string, primaryKey?: string}} FrontendModelResourceConfig */

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
    const response = await fetch(`${this.resourcePath()}/${commandName}`, {
      body: JSON.stringify(payload),
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
