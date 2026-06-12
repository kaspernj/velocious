// @ts-check

import AuthorizationBaseResource from "../authorization/base-resource.js"
import * as inflection from "inflection"

/**
 * FrontendModelResourceControllerArgs type.
 * @typedef {object} FrontendModelResourceControllerArgs
 * @property {import("../controller.js").default} controller - Frontend-model controller instance.
 * @property {typeof import("../database/record/index.js").default} modelClass - Backing model class.
 * @property {string} modelName - Model name.
 * @property {import("../configuration-types.js").VelociousParams} params - Request params.
 * @property {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | import("../configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Normalized resource configuration (or raw input shape during early bootstrap).
 */

/**
 * FrontendModelResourceAbilityArgs type.
 * @typedef {object} FrontendModelResourceAbilityArgs
 * @property {import("../authorization/ability.js").default} [ability] - Ability instance when the resource is used directly for authorization.
 * @property {import("../configuration-types.js").VelociousLooseObject} [context] - Ability context.
 * @property {import("../configuration-types.js").VelociousLooseObject} [locals] - Ability locals.
 * @property {typeof import("../database/record/index.js").default} [modelClass] - Optional backing model class override.
 * @property {string} [modelName] - Optional model name override.
 * @property {import("../configuration-types.js").VelociousParams} [params] - Optional params override.
 * @property {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | import("../configuration-types.js").FrontendModelResourceConfiguration} [resourceConfiguration] - Optional normalized resource configuration.
 */

/**
 * Base class for backend frontend-model resources.
 * @template {typeof import("../database/record/index.js").default} [TModelClass=typeof import("../database/record/index.js").default]
 */
export default class FrontendModelBaseResource extends AuthorizationBaseResource {
  /**
   * Backing model class.
    @type {typeof import("../database/record/index.js").default | undefined} */
  static ModelClass = undefined

  /**
   * Attributes.
    @type {Record<string, ?> | string[] | undefined} */
  static attributes = undefined
  /**
   * Abilities.
    @type {string[] | undefined} */
  static abilities = undefined
  /**
   * Attachments.
    @type {Record<string, ?> | undefined} */
  static attachments = undefined
  /**
   * Collection commands.
    @type {string[] | undefined} */
  static collectionCommands = undefined
  /**
   * Built in collection commands.
    @type {string[] | undefined} */
  static builtInCollectionCommands = undefined
  /**
   * Member commands.
    @type {string[] | undefined} */
  static memberCommands = undefined
  /**
   * Built in member commands.
    @type {string[] | undefined} */
  static builtInMemberCommands = undefined
  /**
   * Relationships.
    @type {string[] | undefined} */
  static relationships = undefined
  /**
   * Translated attributes.
    @type {string[] | undefined} */
  static translatedAttributes = undefined

  /**
   * Runs constructor.
   * @param {FrontendModelResourceAbilityArgs | FrontendModelResourceControllerArgs} args - Resource args.
   */
  constructor(args) {
    super({
      ability: "ability" in args ? args.ability : undefined,
      context: "context" in args ? args.context || {} : {},
      locals: "locals" in args ? args.locals || {} : {}
    })

    this.controller = "controller" in args ? args.controller : undefined
    this.modelClassValue = "modelClass" in args ? args.modelClass : /**
                                                                     * Narrows the runtime value to the documented type.
                                                                      @type {typeof import("../database/record/index.js").default | undefined} */ (/**
                                                                                                                                                    * Narrows the runtime value to the documented type.
                                                                                                                                                     @type {typeof FrontendModelBaseResource} */ (this.constructor).modelClass())
    this.modelNameValue = "modelName" in args ? args.modelName : (this.modelClassValue?.getModelName ? this.modelClassValue.getModelName() : this.modelClassValue?.name || "")
    this.paramsValue = "params" in args ? args.params : undefined
    this.resourceConfigurationValue = "resourceConfiguration" in args ? args.resourceConfiguration : /**
                                                                                                      * Narrows the runtime value to the documented type.
                                                                                                       @type {import("../configuration-types.js").FrontendModelResourceConfiguration} */ ({attributes: []})
  }

  /**
   * Runs typed controller instance.
   * @returns {import("../controller.js").default & {
   *   frontendModelAuthorizedQuery: (action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url") => import("../database/query/model-class-query.js").default<TModelClass>,
   *   frontendModelAbilityAction: (action: string) => string,
   *   currentAbility: () => import("../authorization/ability.js").default | undefined,
   *   frontendModelIndexQuery: () => import("../database/query/model-class-query.js").default<TModelClass>,
   *   frontendModelPreload: () => import("../database/query/index.js").NestedPreloadRecord | null,
   *   serializeFrontendModel: (model: import("../database/record/index.js").default) => Promise<Record<string, unknown>>
   * }} - Controller instance with frontend-model helpers.
   */
  typedControllerInstance() {
    return /** Narrows the runtime value to the documented type. @type {?} */ (this.controller)
  }

  /**
   * Runs resource config.
   * @returns {import("../configuration-types.js").FrontendModelResourceConfiguration} - Static resource config (raw user input shape; consumers normalize).
   */
  static resourceConfig() {
    /**
     * Config.
      @type {import("../configuration-types.js").FrontendModelResourceConfiguration} */
    const config = {
      attributes: this.attributes || []
    }

    if (this.abilities) config.abilities = this.abilities
    if (this.attachments) config.attachments = this.attachments
    if (this.builtInCollectionCommands) config.builtInCollectionCommands = this.builtInCollectionCommands
    if (this.builtInMemberCommands) config.builtInMemberCommands = this.builtInMemberCommands
    if (this.collectionCommands) config.collectionCommands = this.collectionCommands
    if (this.memberCommands) config.memberCommands = this.memberCommands
    if (this.relationships) config.relationships = this.relationships

    return config
  }

  /**
   * Runs static model class.
   * @returns {typeof import("../database/record/index.js").default | undefined} - Backing model class.
   */
  static modelClass() {
    return this.ModelClass
  }

  /**
   * Runs controller instance.
   * @returns {import("../controller.js").default} - Controller instance.
   */
  controllerInstance() {
    if (!this.controller) throw new Error(`${this.constructor.name} requires a controller instance.`)

    return this.controller
  }

  /**
   * Runs model class.
   * @returns {TModelClass} - Model class.
   */
  modelClass() {
    if (!this.modelClassValue) {
      throw new Error(`${this.constructor.name} requires a model class.`)
    }

    return /** @type {TModelClass} */ (this.modelClassValue)
  }

  /**
   * Runs model name.
   * @returns {string} - Model name.
   */
  modelName() {
    if (!this.modelNameValue) throw new Error(`${this.constructor.name} requires a model name.`)

    return this.modelNameValue
  }

  /**
   * Runs params.
   * @returns {import("../configuration-types.js").VelociousParams} - Params.
   */
  params() { return /** @type {import("../configuration-types.js").VelociousParams} */ (this.paramsValue || super.params() || {}) }

  /**
   * Runs resource configuration.
   * @returns {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | import("../configuration-types.js").FrontendModelResourceConfiguration} - Resource config (normalized at runtime; raw during early bootstrap).
   */
  resourceConfiguration() {
    if (!this.resourceConfigurationValue) throw new Error(`${this.constructor.name} requires a resource configuration.`)

    return this.resourceConfigurationValue
  }

  /**
   * Returns a Rails-strong-params / api_maker-style permit spec declaring
   * which attributes and nested attributes are writable for the current
   * request. Submitting an attribute or nested-relationship key that is
   * not permitted raises an error and fails the write.
   *
   * The returned value is a flat array that mixes:
   *   - `"attributeName"` strings for plain attribute writes
   *   - `{<relationshipName>Attributes: [...]}` objects where the value
   *     is itself a permit spec for the nested relationship
   *
   * This matches Rails strong_params (`permit(:first_name, :last_name,
   * contact_attributes: [:email, details_attributes: [:detail]])`) and
   * the api_maker sister project. Include `"_destroy"` inside a nested
   * permit to allow `_destroy: true` entries for that relationship —
   * the model must also declare `acceptsNestedAttributesFor(name,
   * {allowDestroy: true})` for the destroy to be applied.
   *
   * Example:
   *
   *   class ProjectResource extends FrontendModelBaseResource {
   *     permittedParams(arg) {
   *       return [
   *         "name",
   *         "description",
   *         {tasksAttributes: ["id", "_destroy", "name",
   *           {subtasksAttributes: ["id", "_destroy", "name"]}
   *         ]}
   *       ]
   *     }
   *   }
   *
   * Default implementation returns `[]` — nothing permitted. Subclasses
   * must override to enable writes. A resource that does not declare
   * `permittedParams` cannot accept any write.
   * @param {{action?: "create" | "update", params?: Record<string, ?>, ability?: import("../authorization/ability.js").default, locals?: Record<string, ?>}} [arg] - Request context.
   * @returns {Array<string | Record<string, ?>>} - Permit spec.
   */
  permittedParams(arg) {
    void arg

    return []
  }

  /**
   * Runs primary key.
   * @returns {string} - Primary key.
   */
  primaryKey() { return this.modelClass().primaryKey() }

  /**
   * Runs authorized query.
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Ability action.
   * @returns {import("../database/query/model-class-query.js").default<TModelClass>} - Authorized query.
   */
  authorizedQuery(action) {
    return this.typedControllerInstance().frontendModelAuthorizedQuery(action)
  }


  /**
   * Runs supports pluck.
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Action.
   * @returns {boolean | Promise<boolean>} - Whether pluck is supported.
   */
  supportsPluck(action) {
    void action

    return Object.getPrototypeOf(this).records === FrontendModelBaseResource.prototype.records
  }

  /**
   * Runs supports count.
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Action.
   * @returns {boolean | Promise<boolean>} - Whether count is supported.
   */
  supportsCount(action) {
    void action

    return Object.getPrototypeOf(this).records === FrontendModelBaseResource.prototype.records ||
      Object.getPrototypeOf(this).count !== FrontendModelBaseResource.prototype.count
  }

  /**
   * Runs before action.
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Action.
   * @returns {boolean | void | Promise<boolean | void>} - Continue processing unless false.
   */
  beforeAction(action) {
    void action

    // No-op by default.
  }

  /**
   * Runs records.
   * @returns {Promise<import("../database/record/index.js").default[]>} - Records for index action.
   */
  async records() {
    return await this.typedControllerInstance().frontendModelIndexQuery().toArray()
  }

  /**
   * Runs count.
   * @returns {Promise<number>} - Records count for index action.
   */
  async count() {
    return await this.typedControllerInstance().frontendModelIndexQuery().count()
  }

  /**
   * Runs find.
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
   * Runs create.
   * @param {Record<string, ?>} attributes - Create attributes.
   * @param {{controller?: ?, nestedAttributes?: Record<string, ?> | null}} [options] - Save options.
   * @returns {Promise<import("../database/record/index.js").default>} - Created model.
   */
  async create(attributes, options = {}) {
    const permit = parsePermittedParams(this.permittedParams({action: "create", ability: this.ability, locals: this.locals, params: attributes}))
    const filtered = filterWritableFrontendModelAttributes(this.modelClass().prototype, attributes, this, permit.attributes)
    const ModelClass = this.modelClass()
    const model = new ModelClass()

    return await this._saveWithNestedAttributes({filtered, model, options, permit})
  }

  /**
   * Runs handle unauthorized created model.
   * @param {import("../database/record/index.js").default} model - Created model.
   * @returns {Promise<void>} - Cleanup after failed authorization.
   */
  async handleUnauthorizedCreatedModel(model) {
    await model.destroy()
  }

  /**
   * Runs update.
   * @param {import("../database/record/index.js").default} model - Existing model.
   * @param {Record<string, ?>} attributes - Update attributes.
   * @param {{controller?: ?, nestedAttributes?: Record<string, ?> | null}} [options] - Save options.
   * @returns {Promise<import("../database/record/index.js").default>} - Updated model.
   */
  async update(model, attributes, options = {}) {
    const permit = parsePermittedParams(this.permittedParams({action: "update", ability: this.ability, locals: this.locals, params: attributes}))
    const filtered = filterWritableFrontendModelAttributes(model, attributes, this, permit.attributes)

    return await this._saveWithNestedAttributes({filtered, model, options, permit})
  }

  /**
   * Saves a model and applies nested attributes in one transaction.
   * @param {{filtered: Record<string, ?>, model: import("../database/record/index.js").default, options: {controller?: ?, nestedAttributes?: Record<string, ?> | null}, permit: {attributes: string[], nested: Record<string, ?>}}} args - Save arguments.
   * @returns {Promise<import("../database/record/index.js").default>} - Saved model.
   */
  async _saveWithNestedAttributes({filtered, model, options, permit}) {
    await this.modelClass().transaction(async () => {
      await this._assignWithVirtualSetters(model, filtered)
      await model.save()

      if (options.nestedAttributes) {
        await this._applyNestedAttributes(model, options.nestedAttributes, options.controller || null, permit)
      }
    })

    await this._preloadNestedWritableRelationships(model, permit)

    return model
  }

  /**
   * Assigns attributes to a model, using virtual setters on the resource when available.
   * @param {import("../database/record/index.js").default} model - Model instance.
   * @param {Record<string, ?>} attributes - Attributes to assign.
   * @returns {Promise<void>}
   */
  async _assignWithVirtualSetters(model, attributes) {
    /**
     * Direct attributes.
      @type {Record<string, ?>} */
    const directAttributes = {}
    const translatedSet = new Set(/**
                                   * Narrows the runtime value to the documented type.
                                    @type {typeof FrontendModelBaseResource} */ (this.constructor).translatedAttributes || [])

    for (const [name, value] of Object.entries(attributes)) {
      const resourceSetterName = `set${inflection.camelize(name)}Attribute`

      if (typeof /**
                  * Narrows the runtime value to the documented type.
                   @type {Record<string, ?>} */ (/**
                                                  * Narrows the runtime value to the documented type.
                                                   @type {?} */ (this))[resourceSetterName] === "function") {
        await /**
               * Narrows the runtime value to the documented type.
                @type {Record<string, ?>} */ (/**
                                               * Narrows the runtime value to the documented type.
                                                @type {?} */ (this))[resourceSetterName](model, value)
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
   * @param {import("../database/record/index.js").default} model - Model instance.
   * @param {string} name - Attribute name.
   * @param {?} value - Attribute value.
   * @returns {Promise<void>}
   */
  async _setTranslatedAttributeOnModel(model, name, value) {
    const locale = this.context?.configuration?.getLocale?.() || "en"
    const instanceRelationship = model.getRelationshipByName("translations")

    /**
     * Defines translation.
      @type {import("../database/record/index.js").default | undefined} */
    let translation

    if (model.isNewRecord()) {
      const loaded = instanceRelationship.loaded()

      if (Array.isArray(loaded)) {
        translation = loaded.find((/**
                                    * Narrows the runtime value to the documented type.
                                     @type {Record<string, ?>} */ t) => t.locale() === locale)
      }
    } else {
      if (!instanceRelationship.getPreloaded()) {
        await model.loadRelationship("translations")
      }

      const loaded = instanceRelationship.loaded()

      if (Array.isArray(loaded)) {
        translation = loaded.find((/**
                                    * Narrows the runtime value to the documented type.
                                     @type {Record<string, ?>} */ t) => t.locale() === locale)
      }
    }

    if (!translation) {
      translation = instanceRelationship.build({locale})
    }

    /**
     * Assignments.
      @type {Record<string, ?>} */
    const assignments = {}

    assignments[name] = value
    translation.assign(assignments)
  }

  /**
   * Runs destroy.
   * @param {import("../database/record/index.js").default} model - Existing model.
   * @returns {Promise<void>} - No return value.
   */
  async destroy(model) {
    await model.destroy()
  }

  /**
   * Runs serialize.
   * @param {import("../database/record/index.js").default} model - Model to serialize.
   * @param {"index" | "find" | "create" | "update"} [action] - Action.
   * @returns {Promise<Record<string, ?>>} - Serialized model payload.
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
   * Attribute filtering for nested children uses the parent resource's
   * permit spec for that relationship — api_maker-style. Policy options
   * (allowDestroy, limit, rejectIf) come from the MODEL's
   * `acceptedNestedAttributesFor(name)` declaration.
   * @param {import("../database/record/index.js").default} parent - Parent model instance.
   * @param {Record<string, ?>} nestedAttributes - Nested-attribute payload keyed by relationship name.
   * @param {?} controller - Controller instance for resource resolution and authorization.
   * @param {{attributes: string[], nested: Record<string, ?>} | null} [parentPermit] - Parsed parent permit spec.
   * @returns {Promise<void>}
   */
  async _applyNestedAttributes(parent, nestedAttributes, controller, parentPermit = null) {
    const resolvedParent = parentPermit
      || parsePermittedParams(this.permittedParams({action: "update", ability: this.ability, locals: this.locals, params: {}}))

    for (const relationshipName of Object.keys(nestedAttributes)) {
      const childPermit = resolvedParent.nested[relationshipName]

      if (!childPermit) {
        throw new Error(`Nested attributes for '${relationshipName}' are not permitted by ${this.constructor.name}.permittedParams(). Include {${relationshipName}Attributes: [...]} in the returned permit.`)
      }

      const entries = nestedAttributes[relationshipName]

      if (!Array.isArray(entries)) {
        throw new Error(`Expected array for nestedAttributes['${relationshipName}'] but got: ${typeof entries}`)
      }

      const parentModelClass = /**
                                * Narrows the runtime value to the documented type.
                                 @type {?} */ (parent.getModelClass())
      const modelAcceptance = parentModelClass.acceptedNestedAttributesFor?.(relationshipName)

      if (!modelAcceptance) {
        throw new Error(`Model ${parentModelClass.name} does not accept nested attributes for '${relationshipName}'. Declare it via ${parentModelClass.name}.acceptsNestedAttributesFor('${relationshipName}').`)
      }

      const destroyPermitted = childPermit.attributes.includes("_destroy")

      if (destroyPermitted && !modelAcceptance.allowDestroy) {
        throw new Error(`Resource permits _destroy on nestedAttributes['${relationshipName}'] but the model ${parentModelClass.name} does not allow destroy for that relationship. Set {allowDestroy: true} on ${parentModelClass.name}.acceptsNestedAttributesFor('${relationshipName}', ...).`)
      }

      if (typeof modelAcceptance.limit === "number" && entries.length > modelAcceptance.limit) {
        throw new Error(`nestedAttributes['${relationshipName}'] exceeds model-declared limit of ${modelAcceptance.limit}.`)
      }

      const parentRelationship = parent.getRelationshipByName(relationshipName)
      const relationshipDefinitions = parentModelClass.relationships?.() || {}
      const definition = relationshipDefinitions[relationshipName]

      if (!definition || definition.type !== "hasMany") {
        throw new Error(`Nested attributes for '${relationshipName}' require a hasMany relationship. v1 does not support '${definition?.type}'.`)
      }

      const targetModelClass = /**
                                * Narrows the runtime value to the documented type.
                                 @type {?} */ (parent.getModelClass()).relationshipModelClass?.(relationshipName)

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

      const foreignKey = definition.foreignKey || this._inferForeignKey(parent, definition)
      const ability = controller?.currentAbility?.()

      const destroyEntries = []
      const updateEntries = []
      const createEntries = []

      for (const entry of entries) {
        if (typeof modelAcceptance.rejectIf === "function" && modelAcceptance.rejectIf(entry?.attributes || {})) continue

        if (entry?._destroy) {
          if (!destroyPermitted) {
            throw new Error(`nestedAttributes['${relationshipName}'] entry requested _destroy but "_destroy" is not in the permit for this relationship.`)
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

      // The permit's attribute list governs what child fields can be written.
      // Exclude `_destroy` from the writable set since it's a control flag,
      // not an attribute on the record.
      const childWritableAttributes = /**
                                       * Narrows the runtime value to the documented type.
                                        @type {string[]} */ (childPermit.attributes).filter((name) => name !== "_destroy")

      for (const entry of destroyEntries) {
        const existing = await this._findScopedChild({
          ability,
          action: "destroy",
          childResourceConfiguration: childResourceConfig.resourceConfiguration,
          foreignKey,
          id: entry.id,
          parent,
          relationshipName,
          targetModelClass
        })

        await childResource.destroy(existing)
      }

      for (const entry of updateEntries) {
        const existing = await this._findScopedChild({
          ability,
          action: "update",
          childResourceConfiguration: childResourceConfig.resourceConfiguration,
          foreignKey,
          id: entry.id,
          parent,
          relationshipName,
          targetModelClass
        })

        if (entry.attributes && typeof entry.attributes === "object") {
          const filtered = filterWritableFrontendModelAttributes(existing, entry.attributes, childResource, childWritableAttributes)
          await /**
                 * Narrows the runtime value to the documented type.
                  @type {?} */ (childResource)._assignWithVirtualSetters(existing, filtered)
          await existing.save()
        }

        if (entry.nestedAttributes) {
          await /**
                 * Narrows the runtime value to the documented type.
                  @type {?} */ (childResource)._applyNestedAttributes(existing, entry.nestedAttributes, controller, childPermit)
        }
      }

      for (const entry of createEntries) {
        const childAttributes = entry?.attributes && typeof entry.attributes === "object" ? entry.attributes : {}

        const child = parentRelationship.build({...childAttributes, [foreignKey]: parent.id()})

        const filtered = filterWritableFrontendModelAttributes(child, childAttributes, childResource, childWritableAttributes)

        await /**
               * Narrows the runtime value to the documented type.
                @type {?} */ (childResource)._assignWithVirtualSetters(child, filtered)
        await child.save()

        await this._authorizeCreatedChild({
          ability,
          child,
          childResourceConfiguration: childResourceConfig.resourceConfiguration,
          relationshipName,
          targetModelClass
        })

        if (entry.nestedAttributes) {
          await /**
                 * Narrows the runtime value to the documented type.
                  @type {?} */ (childResource)._applyNestedAttributes(child, entry.nestedAttributes, controller, childPermit)
        }
      }
    }
  }

  /**
   * Resolves the ability action for a child resource using the child's own
   * `abilities` mapping — never the parent controller's. This preserves
   * custom mappings like `{update: "manage"}` and catches unmapped actions
   * instead of silently defaulting to the raw action name.
   * @param {import("../configuration-types.js").FrontendModelResourceConfiguration} childResourceConfiguration - Child resource configuration.
   * @param {"create" | "update" | "destroy"} action - Frontend action.
   * @returns {string} - Ability action for the child resource.
   */
  _resolveChildAbilityAction(childResourceConfiguration, action) {
    const abilities = childResourceConfiguration?.abilities

    if (!abilities || typeof abilities !== "object" || Array.isArray(abilities)) {
      throw new Error(`Nested child resource must define an 'abilities' object to authorize nested ${action}.`)
    }

    const abilityAction = /**
                           * Narrows the runtime value to the documented type.
                            @type {Record<string, string>} */ (abilities)[action]

    if (typeof abilityAction !== "string" || abilityAction.length < 1) {
      throw new Error(`Nested child resource must define abilities.${action}.`)
    }

    return abilityAction
  }

  /**
   * Finds an existing child for a nested update/destroy, scoped to the
   * child's own model class, the parent's foreign key, AND the child
   * resource's ability mapping for the requested action. Throws when the
   * child does not exist, does not belong to the current parent, or is
   * not authorized — all of which must roll the transaction back.
   * @param {object} args - Arguments.
   * @param {import("../authorization/ability.js").default | undefined} args.ability - Current ability.
   * @param {"update" | "destroy"} args.action - Frontend action.
   * @param {import("../configuration-types.js").FrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
   * @param {string} args.foreignKey - Foreign-key attribute on the child pointing to the parent.
   * @param {string | number} args.id - Child id from the payload.
   * @param {import("../database/record/index.js").default} args.parent - Parent model instance.
   * @param {string} args.relationshipName - Parent's relationship name (for error messages).
   * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
   * @returns {Promise<import("../database/record/index.js").default>} - Authorized, parent-linked child model.
   */
  async _findScopedChild({ability, action, childResourceConfiguration, foreignKey, id, parent, relationshipName, targetModelClass}) {
    const primaryKey = targetModelClass.primaryKey()
    const lookup = {[primaryKey]: id, [foreignKey]: parent.id()}
    const query = ability
      ? /**
         * Narrows the runtime value to the documented type.
          @type {?} */ (targetModelClass).accessibleFor(this._resolveChildAbilityAction(childResourceConfiguration, action), ability)
      : /**
         * Narrows the runtime value to the documented type.
          @type {?} */ (targetModelClass).where({})

    const existing = await query.findBy(lookup)

    if (!existing) {
      throw new Error(`Cannot ${action} nested ${relationshipName}[id=${id}]: record not found, does not belong to parent ${parent.getModelClass().name}[id=${parent.id()}], or is not authorized.`)
    }

    return existing
  }

  /**
   * Verifies an already-saved nested child is authorized under the child
   * resource's own `create` ability. Rolls back via thrown error when not
   * authorized so the outer transaction destroys the insert.
   * @param {object} args - Arguments.
   * @param {import("../authorization/ability.js").default | undefined} args.ability - Current ability.
   * @param {import("../database/record/index.js").default} args.child - Child model instance just created.
   * @param {import("../configuration-types.js").FrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
   * @param {string} args.relationshipName - Parent's relationship name (for error messages).
   * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
   * @returns {Promise<void>}
   */
  async _authorizeCreatedChild({ability, child, childResourceConfiguration, relationshipName, targetModelClass}) {
    if (!ability) return

    const abilityAction = this._resolveChildAbilityAction(childResourceConfiguration, "create")
    const primaryKey = targetModelClass.primaryKey()
    const authorizedIds = await /**
                                 * Narrows the runtime value to the documented type.
                                  @type {?} */ (targetModelClass)
      .accessibleFor(abilityAction, ability)
      .where({[primaryKey]: child.readAttribute(primaryKey)})
      .pluck(primaryKey)

    if (authorizedIds.length === 0) {
      throw new Error(`Nested create on ${relationshipName}[${targetModelClass.name}] not authorized.`)
    }
  }

  /**
   * Best-effort foreign-key inference for relationships that don't declare it.
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
   * After nested writes, preload every relationship declared in the
   * parent's permit so the post-save serialize step emits them and the
   * client can reconcile ids.
   * @param {import("../database/record/index.js").default} model - Saved parent model.
   * @param {{attributes: string[], nested: Record<string, ?>}} permit - Parsed parent permit.
   * @returns {Promise<void>}
   */
  async _preloadNestedWritableRelationships(model, permit) {
    const relationshipNames = Object.keys(permit.nested)

    if (relationshipNames.length === 0) return

    for (const relationshipName of relationshipNames) {
      if (typeof /**
                  * Narrows the runtime value to the documented type.
                   @type {?} */ (model).loadRelationship === "function") {
        await /**
               * Narrows the runtime value to the documented type.
                @type {?} */ (model).loadRelationship(relationshipName)
      }
    }
  }
}

/**
 * Parses the Rails/api_maker-style flat permit spec returned from
 * `permittedParams(arg)` into a structured shape used internally by the
 * write pipeline. Strings become attribute permits; objects whose keys
 * end in `Attributes` become nested permits (the key prefix names the
 * relationship).
 *
 *   parsePermittedParams(["firstName", "lastName",
 *     {tasksAttributes: ["id", "_destroy", "name"]}
 *   ])
 *   // → {
 *   //   attributes: ["firstName", "lastName"],
 *   //   nested: {
 *   //     tasks: {attributes: ["id", "_destroy", "name"], nested: {}}
 *   //   }
 *   // }
 * @param {Array<string | Record<string, ?>> | undefined} permitSpec - Flat permit spec.
 * @returns {{attributes: string[], nested: Record<string, {attributes: string[], nested: Record<string, ?>}>}} - Parsed structure.
 */
function parsePermittedParams(permitSpec) {
  /**
   * Attributes.
    @type {string[]} */
  const attributes = []
  /**
   * Nested.
    @type {Record<string, {attributes: string[], nested: Record<string, ?>}>} */
  const nested = {}

  if (!Array.isArray(permitSpec)) return {attributes, nested}

  for (const entry of permitSpec) {
    if (typeof entry === "string") {
      attributes.push(entry)
    } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      for (const [key, value] of Object.entries(entry)) {
        if (!key.endsWith("Attributes")) {
          throw new Error(`Invalid permittedParams entry: nested relationship keys must end in "Attributes" (got "${key}"). Use "${key}Attributes" instead.`)
        }
        const relationshipName = key.slice(0, -"Attributes".length)

        if (!relationshipName) {
          throw new Error(`Invalid permittedParams entry: empty relationship name in key "${key}".`)
        }
        if (!Array.isArray(value)) {
          throw new Error(`Invalid permittedParams entry for "${key}": expected array permit spec, got ${typeof value}.`)
        }

        nested[relationshipName] = parsePermittedParams(value)
      }
    } else {
      throw new Error(`Invalid permittedParams entry: expected string or nested-attributes object, got ${typeof entry}.`)
    }
  }

  return {attributes, nested}
}

/**
 * Runs filter writable frontend model attributes.
 * @param {Record<string, ?>} receiver - Model instance or prototype.
 * @param {Record<string, ?>} attributes - Incoming frontend-model attributes.
 * @param {FrontendModelBaseResource | null} [resource] - Resource instance for virtual-setter detection.
 * @param {string[] | null} [permittedAttributeNames] - Optional explicit permit list. `null` falls back to setter-existence checks only.
 * @returns {Record<string, ?>} - Writable attributes only.
 */
function filterWritableFrontendModelAttributes(receiver, attributes, resource = /**
                                                                                 * Narrows the runtime value to the documented type.
                                                                                  @type {FrontendModelBaseResource | null} */ (null), permittedAttributeNames = null) {
  // Frontend-model writes should fail fast when callers submit read-only or unknown attrs.
  // Silent drops hide contract mistakes in generated models and app-side wrapper code.
  /**
   * Writable attributes.
    @type {Record<string, ?>} */
  const writableAttributes = {}
  /**
   * Invalid attributes.
    @type {string[]} */
  const invalidAttributes = []
  /**
   * Not permitted attributes.
    @type {string[]} */
  const notPermittedAttributes = []

  const permitSet = Array.isArray(permittedAttributeNames) ? new Set(permittedAttributeNames) : null
  const translatedSet = resource ? new Set(/**
                                            * Narrows the runtime value to the documented type.
                                             @type {typeof FrontendModelBaseResource} */ (resource.constructor).translatedAttributes || []) : new Set()

  for (const [attributeName, value] of Object.entries(attributes)) {
    if (permitSet && !permitSet.has(attributeName)) {
      notPermittedAttributes.push(attributeName)
      continue
    }

    const modelClass = /** Narrows the runtime value to the documented type. @type {?} */ (receiver).constructor
    const resolvedAttributeName = (modelClass && typeof modelClass.resolveAttributeName === "function" && modelClass.resolveAttributeName(attributeName)) || attributeName
    const requestedSetterName = `set${inflection.camelize(resolvedAttributeName)}`
    const setterName = (modelClass && typeof modelClass.findMemberNameInsensitive === "function" && modelClass.findMemberNameInsensitive(receiver, requestedSetterName)) || requestedSetterName
    const resourceSetterName = `set${inflection.camelize(attributeName)}Attribute`

    if (setterName in receiver) {
      writableAttributes[attributeName] = value
    } else if (resource && typeof /**
                                   * Narrows the runtime value to the documented type.
                                    @type {Record<string, ?>} */ (/**
                                                                   * Narrows the runtime value to the documented type.
                                                                    @type {?} */ (resource))[resourceSetterName] === "function") {
      writableAttributes[attributeName] = value
    } else if (translatedSet.has(attributeName)) {
      writableAttributes[attributeName] = value
    } else {
      invalidAttributes.push(attributeName)
    }
  }

  if (notPermittedAttributes.length > 0) {
    throw new Error(`Frontend model write attributes not permitted by permittedParams(): ${notPermittedAttributes.join(", ")}`)
  }

  if (invalidAttributes.length > 0) {
    throw new Error(`Invalid frontend model write attributes: ${invalidAttributes.join(", ")}`)
  }

  return writableAttributes
}
