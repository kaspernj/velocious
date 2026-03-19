// @ts-check

/**
 * Base class for backend frontend-model resources.
 */
export default class FrontendModelBaseResource {
  /** @type {Record<string, any> | string[] | undefined} */
  static attributes = undefined
  /** @type {Record<string, string> | undefined} */
  static abilities = undefined
  /** @type {Record<string, any> | undefined} */
  static attachments = undefined
  /** @type {Record<string, string> | undefined} */
  static commands = undefined
  /** @type {string | undefined} */
  static path = undefined
  /** @type {string | undefined} */
  static primaryKey = undefined
  /** @type {Record<string, any> | undefined} */
  static relationships = undefined

  /**
   * @param {object} args - Resource args.
   * @param {import("../controller.js").default} args.controller - Frontend-model controller.
   * @param {typeof import("../database/record/index.js").default} args.modelClass - Model class.
   * @param {string} args.modelName - Model class name.
   * @param {Record<string, any>} args.params - Request params.
   * @param {import("../configuration-types.js").FrontendModelResourceConfiguration} args.resourceConfiguration - Normalized resource config.
   */
  constructor({controller, modelClass, modelName, params, resourceConfiguration}) {
    this.controller = controller
    this.modelClassValue = modelClass
    this.modelNameValue = modelName
    this.paramsValue = params
    this.resourceConfigurationValue = resourceConfiguration
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
      abilities: this.abilities || {},
      attributes: this.attributes || []
    }

    if (this.attachments) config.attachments = this.attachments
    if (this.commands) config.commands = this.commands
    if (this.path) config.path = this.path
    if (this.primaryKey) config.primaryKey = this.primaryKey
    if (this.relationships) config.relationships = this.relationships

    return config
  }

  /** @returns {import("../controller.js").default} - Controller instance. */
  controllerInstance() { return this.controller }

  /** @returns {typeof import("../database/record/index.js").default} - Model class. */
  modelClass() { return this.modelClassValue }

  /** @returns {string} - Model name. */
  modelName() { return this.modelNameValue }

  /** @returns {Record<string, any>} - Params. */
  params() { return this.paramsValue }

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
    const model = new (this.modelClass())(attributes)
    await model.save()

    return model
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
    model.assign(attributes)
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
