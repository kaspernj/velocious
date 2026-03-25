// @ts-check

import AuthorizationBaseResource from "../authorization/base-resource.js"
import * as inflection from "inflection"

/**
 * @typedef {object} FrontendModelResourceControllerArgs
 * @property {import("../controller.js").default} controller - Frontend-model controller instance.
 * @property {typeof import("../database/record/index.js").default} modelClass - Backing model class.
 * @property {string} modelName - Model name.
 * @property {Record<string, any>} params - Request params.
 * @property {import("../configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Normalized resource configuration.
 */

/**
 * @typedef {object} FrontendModelResourceAbilityArgs
 * @property {import("../authorization/ability.js").default} [ability] - Ability instance when the resource is used directly for authorization.
 * @property {Record<string, any>} [context] - Ability context.
 * @property {Record<string, any>} [locals] - Ability locals.
 * @property {typeof import("../database/record/index.js").default} [modelClass] - Optional backing model class override.
 * @property {string} [modelName] - Optional model name override.
 * @property {Record<string, any>} [params] - Optional params override.
 * @property {import("../configuration-types.js").FrontendModelResourceConfiguration} [resourceConfiguration] - Optional normalized resource configuration.
 */

/**
 * Base class for backend frontend-model resources.
 */
export default class FrontendModelBaseResource extends AuthorizationBaseResource {
  /** @type {Record<string, any> | string[] | undefined} */
  static attributes = undefined
  /** @type {Record<string, string> | undefined} */
  static abilities = undefined
  /** @type {Record<string, any> | undefined} */
  static attachments = undefined
  /** @type {Record<string, string> | undefined} */
  static collectionCommands = undefined
  /** @type {Record<string, string> | string[] | undefined} */
  static builtInCollectionCommands = undefined
  /** @type {Record<string, string> | string[] | undefined} */
  static memberCommands = undefined
  /** @type {Record<string, string> | string[] | undefined} */
  static builtInMemberCommands = undefined
  /** @type {Record<string, any> | undefined} */
  static relationships = undefined

  /**
   * @param {FrontendModelResourceAbilityArgs | FrontendModelResourceControllerArgs} args - Resource args.
   */
  constructor(args) {
    super({
      ability: "ability" in args ? args.ability : undefined,
      context: "context" in args ? args.context || {} : {},
      locals: "locals" in args ? args.locals || {} : {}
    })

    this.controller = "controller" in args ? args.controller : undefined
    this.modelClassValue = "modelClass" in args ? args.modelClass : /** @type {typeof import("../database/record/index.js").default | undefined} */ (/** @type {typeof FrontendModelBaseResource} */ (this.constructor).modelClass())
    this.modelNameValue = "modelName" in args ? args.modelName : this.modelClassValue?.name || ""
    this.paramsValue = "params" in args ? args.params : undefined
    this.resourceConfigurationValue = "resourceConfiguration" in args ? args.resourceConfiguration : /** @type {import("../configuration-types.js").FrontendModelResourceConfiguration} */ ({abilities: {}, attributes: []})
  }

  /**
   * @returns {import("../controller.js").default & {
   *   frontendModelAuthorizedQuery: (action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url") => import("../database/query/model-class-query.js").default<any>,
   *   frontendModelIndexQuery: () => import("../database/query/model-class-query.js").default<any>,
   *   frontendModelPreload: () => import("../database/query/index.js").NestedPreloadRecord | null,
   *   serializeFrontendModel: (model: import("../database/record/index.js").default) => Promise<Record<string, any>>
   * }} - Controller instance with frontend-model helpers.
   */
  typedControllerInstance() {
    return /** @type {any} */ (this.controller)
  }

  /**
   * @returns {import("../configuration-types.js").FrontendModelResourceConfiguration} - Static resource config.
   */
  static resourceConfig() {
    /** @type {import("../configuration-types.js").FrontendModelResourceConfiguration} */
    const config = {
      abilities: normalizeFrontendModelResourceAbilities(this.abilities),
      attributes: this.attributes || []
    }

    if (this.attachments) config.attachments = this.attachments
    if (this.builtInCollectionCommands) config.builtInCollectionCommands = this.builtInCollectionCommands
    if (this.builtInMemberCommands) config.builtInMemberCommands = this.builtInMemberCommands
    if (this.collectionCommands) config.collectionCommands = this.collectionCommands
    if (this.memberCommands) config.memberCommands = this.memberCommands
    if (this.relationships) config.relationships = this.relationships

    return config
  }

  /** @returns {import("../controller.js").default} - Controller instance. */
  controllerInstance() { return this.controller }

  /** @returns {typeof import("../database/record/index.js").default} - Model class. */
  modelClass() {
    if (!this.modelClassValue) {
      throw new Error(`${this.constructor.name} requires a model class.`)
    }

    return this.modelClassValue
  }

  /** @returns {string} - Model name. */
  modelName() { return this.modelNameValue }

  /** @returns {Record<string, any>} - Params. */
  params() { return this.paramsValue || super.params() || {} }

  /** @returns {import("../configuration-types.js").FrontendModelResourceConfiguration} - Normalized resource config. */
  resourceConfiguration() { return this.resourceConfigurationValue }

  /** @returns {string} - Primary key. */
  primaryKey() { return this.modelClass().primaryKey() }

  /**
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Ability action.
   * @returns {import("../database/query/model-class-query.js").default<any>} - Authorized query.
   */
  authorizedQuery(action) {
    return this.typedControllerInstance().frontendModelAuthorizedQuery(action)
  }

  /**
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Action.
   * @returns {boolean | Promise<boolean>} - Whether pluck is supported.
   */
  supportsPluck(action) {
    void action

    return Object.getPrototypeOf(this).records === FrontendModelBaseResource.prototype.records
  }

  /**
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Action.
   * @returns {boolean | void | Promise<boolean | void>} - Continue processing unless false.
   */
  beforeAction(action) {
    void action

    // No-op by default.
  }

  /**
   * @returns {Promise<import("../database/record/index.js").default[]>} - Records for index action.
   */
  async records() {
    return await this.typedControllerInstance().frontendModelIndexQuery().toArray()
  }

  /**
   * @param {"find" | "update" | "destroy" | "attach" | "download" | "url"} action - Action.
   * @param {string | number} id - Record id.
   * @returns {Promise<import("../database/record/index.js").default | null>} - Located model.
   */
  async find(action, id) {
    let query = this.authorizedQuery(action)
    const preload = action === "find" ? this.typedControllerInstance().frontendModelPreload() : null

    if (preload) {
      query = query.preload(preload)
    }

    return await query.findBy({[this.primaryKey()]: id})
  }

  /**
   * @param {Record<string, any>} attributes - Create attributes.
   * @returns {Promise<import("../database/record/index.js").default>} - Created model.
   */
  async create(attributes) {
    return await this.modelClass().create(filterWritableFrontendModelAttributes(this.modelClass().prototype, attributes))
  }

  /**
   * @param {import("../database/record/index.js").default} model - Created model.
   * @returns {Promise<void>} - Cleanup after failed authorization.
   */
  async handleUnauthorizedCreatedModel(model) {
    await model.destroy()
  }

  /**
   * @param {import("../database/record/index.js").default} model - Existing model.
   * @param {Record<string, any>} attributes - Update attributes.
   * @returns {Promise<import("../database/record/index.js").default>} - Updated model.
   */
  async update(model, attributes) {
    model.assign(filterWritableFrontendModelAttributes(model, attributes))
    await model.save()

    return model
  }

  /**
   * @param {import("../database/record/index.js").default} model - Existing model.
   * @returns {Promise<void>} - No return value.
   */
  async destroy(model) {
    await model.destroy()
  }

  /**
   * @param {import("../database/record/index.js").default} model - Model to serialize.
   * @param {"index" | "find" | "create" | "update"} [action] - Action.
   * @returns {Promise<Record<string, any>>} - Serialized model payload.
   */
  async serialize(model, action) {
    void action

    return await this.typedControllerInstance().serializeFrontendModel(model)
  }
}

/**
 * @param {Record<string, any>} receiver - Model instance or prototype.
 * @param {Record<string, any>} attributes - Incoming frontend-model attributes.
 * @returns {Record<string, any>} - Writable attributes only.
 */
function filterWritableFrontendModelAttributes(receiver, attributes) {
  // Frontend-model writes should fail fast when callers submit read-only or unknown attrs.
  // Silent drops hide contract mistakes in generated models and app-side wrapper code.
  /** @type {Record<string, any>} */
  const writableAttributes = {}
  /** @type {string[]} */
  const invalidAttributes = []

  for (const [attributeName, value] of Object.entries(attributes)) {
    const setterName = `set${inflection.camelize(attributeName)}`

    if (setterName in receiver) {
      writableAttributes[attributeName] = value
    } else {
      invalidAttributes.push(attributeName)
    }
  }

  if (invalidAttributes.length > 0) {
    throw new Error(`Invalid frontend model write attributes: ${invalidAttributes.join(", ")}`)
  }

  return writableAttributes
}

/**
 * @param {Record<string, string> | string[] | undefined} abilities - Resource abilities config.
 * @returns {Record<string, string>} - Normalized abilities config.
 */
function normalizeFrontendModelResourceAbilities(abilities) {
  if (!abilities) {
    return {}
  }

  if (!Array.isArray(abilities)) {
    return abilities
  }

  /** @type {Record<string, string>} */
  const normalized = {}

  if (abilities.includes("manage")) {
    normalized.create = "manage"
    normalized.destroy = "manage"
    normalized.find = "manage"
    normalized.index = "manage"
    normalized.update = "manage"

    return normalized
  }

  if (abilities.includes("create")) normalized.create = "create"
  if (abilities.includes("destroy")) normalized.destroy = "destroy"
  if (abilities.includes("read")) {
    normalized.find = "read"
    normalized.index = "read"
  }
  if (abilities.includes("update")) normalized.update = "update"

  return normalized
}
