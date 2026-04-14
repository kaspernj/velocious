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
  /** @type {string[] | undefined} */
  static relationships = undefined
  /** @type {string[] | undefined} */
  static translatedAttributes = undefined
  /**
   * Declares relationships on this resource that accept nested writes through `save()`.
   * Keys are relationship names (matching the model's relationship definitions).
   * Values describe the policy for each relationship.
   *
   * Example:
   *   static nestedAttributes = {
   *     aiActions: {allowDestroy: true, limit: 100}
   *   }
   *
   * Recursion into deeper levels follows each child resource's own `nestedAttributes`
   * declaration — parents do NOT inline the full tree, so authorization and policy
   * stay on the child resource that actually owns the records being written.
   *
   * @type {Record<string, {allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, any>) => boolean}> | undefined}
   */
  static nestedAttributes = undefined

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
    this.modelNameValue = "modelName" in args ? args.modelName : (this.modelClassValue?.getModelName ? this.modelClassValue.getModelName() : this.modelClassValue?.name || "")
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
    if (this.nestedAttributes) config.nestedAttributes = this.nestedAttributes
    if (this.relationships) config.relationships = this.relationships

    return config
  }

  /** @returns {import("../controller.js").default} - Controller instance. */
  controllerInstance() {
    if (!this.controller) throw new Error(`${this.constructor.name} requires a controller instance.`)

    return this.controller
  }

  /** @returns {typeof import("../database/record/index.js").default} - Model class. */
  modelClass() {
    if (!this.modelClassValue) {
      throw new Error(`${this.constructor.name} requires a model class.`)
    }

    return this.modelClassValue
  }

  /** @returns {string} - Model name. */
  modelName() {
    if (!this.modelNameValue) throw new Error(`${this.constructor.name} requires a model name.`)

    return this.modelNameValue
  }

  /** @returns {Record<string, any>} - Params. */
  params() { return this.paramsValue || super.params() || {} }

  /** @returns {import("../configuration-types.js").FrontendModelResourceConfiguration} - Normalized resource config. */
  resourceConfiguration() {
    if (!this.resourceConfigurationValue) throw new Error(`${this.constructor.name} requires a resource configuration.`)

    return this.resourceConfigurationValue
  }

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
   * @param {{controller?: any, nestedAttributes?: Record<string, any> | null}} [options] - Save options.
   * @returns {Promise<import("../database/record/index.js").default>} - Created model.
   */
  async create(attributes, options = {}) {
    const filtered = filterWritableFrontendModelAttributes(this.modelClass().prototype, attributes, this)
    const ModelClass = this.modelClass()
    const model = new ModelClass()

    await ModelClass.transaction(async () => {
      await this._assignWithVirtualSetters(model, filtered)
      await model.save()

      if (options.nestedAttributes) {
        await this._applyNestedAttributes(model, options.nestedAttributes, options.controller || null)
      }
    })

    await this._preloadNestedWritableRelationships(model)

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
   * @param {{controller?: any, nestedAttributes?: Record<string, any> | null}} [options] - Save options.
   * @returns {Promise<import("../database/record/index.js").default>} - Updated model.
   */
  async update(model, attributes, options = {}) {
    const filtered = filterWritableFrontendModelAttributes(model, attributes, this)
    const ModelClass = this.modelClass()

    await ModelClass.transaction(async () => {
      await this._assignWithVirtualSetters(model, filtered)
      await model.save()

      if (options.nestedAttributes) {
        await this._applyNestedAttributes(model, options.nestedAttributes, options.controller || null)
      }
    })

    await this._preloadNestedWritableRelationships(model)

    return model
  }

  /**
   * Assigns attributes to a model, using virtual setters on the resource when available.
   *
   * @param {import("../database/record/index.js").default} model - Model instance.
   * @param {Record<string, any>} attributes - Attributes to assign.
   * @returns {Promise<void>}
   */
  async _assignWithVirtualSetters(model, attributes) {
    /** @type {Record<string, any>} */
    const directAttributes = {}
    const translatedSet = new Set(/** @type {typeof FrontendModelBaseResource} */ (this.constructor).translatedAttributes || [])

    for (const [name, value] of Object.entries(attributes)) {
      const resourceSetterName = `set${inflection.camelize(name)}Attribute`

      if (typeof /** @type {Record<string, any>} */ (/** @type {unknown} */ (this))[resourceSetterName] === "function") {
        await /** @type {Record<string, any>} */ (/** @type {unknown} */ (this))[resourceSetterName](model, value)
      } else if (translatedSet.has(name)) {
        await this._setTranslatedAttributeOnModel(model, name, value)
      } else {
        directAttributes[name] = value
      }
    }

    if (Object.keys(directAttributes).length > 0) {
      model.assign(directAttributes)
    }
  }

  /**
   * Sets a translated attribute on a model via the translations relationship.
   *
   * @param {import("../database/record/index.js").default} model - Model instance.
   * @param {string} name - Attribute name.
   * @param {any} value - Attribute value.
   * @returns {Promise<void>}
   */
  async _setTranslatedAttributeOnModel(model, name, value) {
    const locale = this.context?.configuration?.getLocale?.() || "en"
    const instanceRelationship = model.getRelationshipByName("translations")

    /** @type {import("../database/record/index.js").default | undefined} */
    let translation

    if (model.isNewRecord()) {
      const loaded = instanceRelationship.loaded()

      if (Array.isArray(loaded)) {
        translation = loaded.find((/** @type {Record<string, any>} */ t) => t.locale() === locale)
      }
    } else {
      if (!instanceRelationship.getPreloaded()) {
        await model.loadRelationship("translations")
      }

      const loaded = instanceRelationship.loaded()

      if (Array.isArray(loaded)) {
        translation = loaded.find((/** @type {Record<string, any>} */ t) => t.locale() === locale)
      }
    }

    if (!translation) {
      translation = instanceRelationship.build({locale})
    }

    /** @type {Record<string, any>} */
    const assignments = {}

    assignments[name] = value
    translation.assign(assignments)
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

  /**
   * Applies a `nestedAttributes` payload to a freshly-saved parent model,
   * cascading create/update/destroy writes across the declared relationships.
   *
   * Each child is authorized against its own resource's abilities (never the
   * parent's). Destroys run before updates, updates before creates, to avoid
   * unique-constraint conflicts when replacing a child at the same natural key.
   *
   * @param {import("../database/record/index.js").default} parent - Parent model instance.
   * @param {Record<string, any>} nestedAttributes - Nested-attribute payload keyed by relationship name.
   * @param {any} controller - Controller instance for resource resolution and authorization.
   * @returns {Promise<void>}
   */
  async _applyNestedAttributes(parent, nestedAttributes, controller) {
    const declared = /** @type {typeof FrontendModelBaseResource} */ (this.constructor).nestedAttributes || {}

    for (const relationshipName of Object.keys(nestedAttributes)) {
      const policy = declared[relationshipName]

      if (!policy) {
        throw new Error(`Nested attributes for '${relationshipName}' are not declared on ${this.constructor.name}. Add it to 'static nestedAttributes'.`)
      }

      const entries = nestedAttributes[relationshipName]

      if (!Array.isArray(entries)) {
        throw new Error(`Expected array for nestedAttributes['${relationshipName}'] but got: ${typeof entries}`)
      }

      if (typeof policy.limit === "number" && entries.length > policy.limit) {
        throw new Error(`nestedAttributes['${relationshipName}'] exceeds declared limit of ${policy.limit}.`)
      }

      const parentRelationship = parent.getRelationshipByName(relationshipName)
      const relationshipDefinitions = /** @type {any} */ (parent.getModelClass()).relationships?.() || {}
      const definition = relationshipDefinitions[relationshipName]

      if (!definition || definition.type !== "hasMany") {
        throw new Error(`Nested attributes for '${relationshipName}' require a hasMany relationship. v1 does not support '${definition?.type}'.`)
      }

      const targetModelClass = /** @type {any} */ (parent.getModelClass()).relationshipModelClass?.(relationshipName)

      if (!targetModelClass) {
        throw new Error(`No target model class resolved for relationship '${relationshipName}' on ${parent.getModelClass().name}.`)
      }

      const childResourceConfig = controller?.frontendModelResourceConfigurationForModelClass?.(targetModelClass)

      if (!childResourceConfig) {
        throw new Error(`No frontend-model resource registered for child model '${targetModelClass.getModelName?.() || targetModelClass.name}' under relationship '${relationshipName}'.`)
      }

      const childResource = new childResourceConfig.resourceClass({
        ability: this.ability,
        controller,
        context: this.context || {},
        locals: this.locals || {},
        modelClass: targetModelClass,
        modelName: childResourceConfig.modelName,
        params: controller?.frontendModelParams?.() || {},
        resourceConfiguration: childResourceConfig.resourceConfiguration
      })

      const destroyEntries = []
      const updateEntries = []
      const createEntries = []

      for (const entry of entries) {
        if (typeof policy.rejectIf === "function" && policy.rejectIf(entry?.attributes || {})) continue

        if (entry?._destroy) {
          if (!policy.allowDestroy) {
            throw new Error(`nestedAttributes['${relationshipName}'] entry requested _destroy but allowDestroy is not enabled on this resource.`)
          }
          if (!entry.id) {
            throw new Error(`nestedAttributes['${relationshipName}'] _destroy entry is missing an id.`)
          }
          destroyEntries.push(entry)
        } else if (entry?.id) {
          updateEntries.push(entry)
        } else {
          createEntries.push(entry)
        }
      }

      for (const entry of destroyEntries) {
        const existing = await childResource.find("destroy", entry.id)

        if (!existing) throw new Error(`Cannot destroy ${relationshipName}[id=${entry.id}]: record not found or not authorized.`)

        await this._authorizeNestedChild(targetModelClass, existing, "destroy", controller)
        await childResource.destroy(existing)
      }

      for (const entry of updateEntries) {
        const existing = await childResource.find("update", entry.id)

        if (!existing) throw new Error(`Cannot update ${relationshipName}[id=${entry.id}]: record not found or not authorized.`)

        await this._authorizeNestedChild(targetModelClass, existing, "update", controller)

        if (entry.attributes && typeof entry.attributes === "object") {
          await childResource.update(existing, entry.attributes, {nestedAttributes: entry.nestedAttributes, controller})
        } else if (entry.nestedAttributes) {
          await childResource._applyNestedAttributes(existing, entry.nestedAttributes, controller)
        }
      }

      for (const entry of createEntries) {
        const childAttributes = entry?.attributes && typeof entry.attributes === "object" ? entry.attributes : {}

        const child = parentRelationship.build({...childAttributes, [definition.foreignKey || this._inferForeignKey(parent, definition)]: parent.id()})

        const filtered = filterWritableFrontendModelAttributes(child, childAttributes, childResource)

        await /** @type {any} */ (childResource)._assignWithVirtualSetters(child, filtered)
        await child.save()

        await this._authorizeNestedChild(targetModelClass, child, "create", controller)

        if (entry.nestedAttributes) {
          await childResource._applyNestedAttributes(child, entry.nestedAttributes, controller)
        }
      }
    }
  }

  /**
   * Re-authorizes a nested child against its own resource class abilities.
   * Throws when the child fails authorization, so the outer transaction rolls back.
   *
   * @param {typeof import("../database/record/index.js").default} childModelClass - Child model class.
   * @param {import("../database/record/index.js").default} childModel - Child model instance.
   * @param {"create" | "update" | "destroy"} action - Ability action.
   * @param {any} controller - Controller for ability lookup.
   * @returns {Promise<void>}
   */
  async _authorizeNestedChild(childModelClass, childModel, action, controller) {
    const ability = controller?.currentAbility?.()

    if (!ability) return

    const abilityAction = action === "destroy" ? "destroy" : action

    const authorizedQuery = /** @type {any} */ (childModelClass).accessibleFor(abilityAction, ability)
    const primaryKey = childModelClass.primaryKey()
    const authorizedIds = await authorizedQuery.where({[primaryKey]: childModel.readAttribute(primaryKey)}).pluck(primaryKey)

    if (authorizedIds.length === 0) {
      throw new Error(`Nested ${action} on ${childModelClass.name} not authorized.`)
    }
  }

  /**
   * Best-effort foreign-key inference for relationships that don't declare it.
   *
   * @param {import("../database/record/index.js").default} parent - Parent model.
   * @param {{foreignKey?: string}} definition - Relationship definition.
   * @returns {string} - Foreign-key attribute name.
   */
  _inferForeignKey(parent, definition) {
    if (definition.foreignKey) return definition.foreignKey

    const parentModelName = parent.getModelClass().name || ""
    const underscored = parentModelName.replace(/([A-Z])/g, (match, letter, index) => (index === 0 ? letter.toLowerCase() : `_${letter.toLowerCase()}`))

    return `${inflection.camelize(underscored, true)}Id`
  }

  /**
   * After nested writes, preload every relationship declared in `nestedAttributes`
   * so the post-save serialize step emits them and the client can reconcile ids.
   *
   * @param {import("../database/record/index.js").default} model - Saved parent model.
   * @returns {Promise<void>}
   */
  async _preloadNestedWritableRelationships(model) {
    const declared = /** @type {typeof FrontendModelBaseResource} */ (this.constructor).nestedAttributes

    if (!declared) return

    for (const relationshipName of Object.keys(declared)) {
      if (typeof /** @type {any} */ (model).loadRelationship === "function") {
        await /** @type {any} */ (model).loadRelationship(relationshipName)
      }
    }
  }
}

/**
 * @param {Record<string, any>} receiver - Model instance or prototype.
 * @param {Record<string, any>} attributes - Incoming frontend-model attributes.
 * @returns {Record<string, any>} - Writable attributes only.
 */
function filterWritableFrontendModelAttributes(receiver, attributes, resource = /** @type {FrontendModelBaseResource | null} */ (null)) {
  // Frontend-model writes should fail fast when callers submit read-only or unknown attrs.
  // Silent drops hide contract mistakes in generated models and app-side wrapper code.
  /** @type {Record<string, any>} */
  const writableAttributes = {}
  /** @type {string[]} */
  const invalidAttributes = []

  const translatedSet = resource ? new Set(/** @type {typeof FrontendModelBaseResource} */ (resource.constructor).translatedAttributes || []) : new Set()

  for (const [attributeName, value] of Object.entries(attributes)) {
    const setterName = `set${inflection.camelize(attributeName)}`
    const resourceSetterName = `${setterName}Attribute`

    if (setterName in receiver) {
      writableAttributes[attributeName] = value
    } else if (resource && typeof /** @type {Record<string, any>} */ (/** @type {unknown} */ (resource))[resourceSetterName] === "function") {
      writableAttributes[attributeName] = value
    } else if (translatedSet.has(attributeName)) {
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
    return {
      create: "create",
      destroy: "destroy",
      find: "read",
      index: "read",
      update: "update"
    }
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
