// @ts-check

import AuthorizationBaseResource from "../authorization/base-resource.js"
import * as inflection from "inflection"
import isPlainObject from "../utils/plain-object.js"
import normalizeAttributesWithSchema, {schemaTypeFromColumnType} from "../sync/sync-attribute-normalizer.js"
import VelociousError from "../velocious-error.js"

/**
 * Built-in frontend-model resource action.
 * @typedef {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} FrontendModelResourceAction
 */

/**
 * Frontend-model controller methods used by resources.
 * @typedef {import("../controller.js").default & {
 *   currentAbility: () => import("../authorization/ability.js").default | undefined,
 *   applyFrontendModelPagination: (args: {pagination: FrontendModelResourcePagination, query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>}) => void,
 *   applyFrontendModelSearch: (args: {query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>, search: FrontendModelResourceSearch}) => void,
 *   applyFrontendModelSort: (args: {query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>, sort: FrontendModelResourceSort}) => void,
 *   frontendModelAbilityAction: (action: FrontendModelResourceAction) => string,
 *   frontendModelAbilityAuthorizedQuery: (action: FrontendModelResourceAction) => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>,
 *   frontendModelAuthorizedQuery: (action: FrontendModelResourceAction) => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>,
 *   frontendModelIndexQuery: (options?: FrontendModelResourceIndexQueryOptions & {resource?: FrontendModelBaseResource}) => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>,
 *   frontendModelParams: () => import("../configuration-types.js").VelociousParams,
 *   frontendModelPreload: () => import("../database/query/index.js").NestedPreloadRecord | null,
 *   frontendModelResourceConfigurationForModelClass: (modelClass: typeof import("../database/record/index.js").default) => FrontendModelResolvedResourceConfiguration | null,
 *   serializeFrontendModel: (model: import("../database/record/index.js").default) => Promise<Record<string, object | string | number | boolean | null>>
 * }} FrontendModelResourceController
 */

/**
 * Generic frontend-model index query passed to resource query hooks.
 * @typedef {import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} FrontendModelResourceAnyQuery
 */

/**
 * Options for building a frontend-model resource index query.
 * @typedef {object} FrontendModelResourceIndexQueryOptions
 * @property {boolean} [includePagination] - Whether frontend-model pagination params should be applied.
 * @property {boolean} [includeSort] - Whether frontend-model sort params should be applied.
 */

/**
 * FrontendModelResourcePagination type.
 * @typedef {object} FrontendModelResourcePagination
 * @property {number | null} limit - Maximum number of records.
 * @property {number | null} offset - Number of records to skip.
 * @property {number | null} page - 1-based page number.
 * @property {number | null} perPage - Page size.
 */

/**
 * FrontendModelResourceSearch type.
 * @typedef {object} FrontendModelResourceSearch
 * @property {string} column - Column or attribute name.
 * @property {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} operator - Search operator.
 * @property {string[]} path - Relationship path.
 * @property {?} value - Search value.
 */

/**
 * FrontendModelResourceSort type.
 * @typedef {object} FrontendModelResourceSort
 * @property {string} column - Attribute name to sort by.
 * @property {"asc" | "desc"} direction - Sort direction.
 * @property {string[]} path - Relationship path from root model.
 */

/**
 * FrontendModelResourceControllerArgs type.
 * @typedef {object} FrontendModelResourceControllerArgs
 * @property {FrontendModelResourceController} controller - Frontend-model controller instance.
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
 * Normalized sync replay mutation passed to the resource sync hooks.
 * @typedef {import("../sync/sync-envelope-replay-service.js").SyncReplayMutation} FrontendModelSyncMutation
 */

/**
 * Sync mutation authorization result.
 * @typedef {object} FrontendModelSyncAuthorization
 * @property {boolean} allowed - Whether the mutation may be applied.
 * @property {string} [reason] - Stable failure reason code when denied.
 */

/**
 * Arguments for the applySync full-escape-hatch hook.
 * @typedef {object} FrontendModelApplySyncArgs
 * @property {Record<string, ?>} context - Replay context.
 * @property {import("../database/record/index.js").default | null} existingSync - Existing sync row or null.
 * @property {FrontendModelSyncMutation} mutation - Normalized replay mutation.
 */

/**
 * Apply result produced by routed sync mutation application.
 * @typedef {object} FrontendModelSyncApplyResult
 * @property {boolean} created - Whether a record was created.
 * @property {boolean} [deleted] - Whether a record was deleted.
 * @property {import("../database/record/index.js").default | null} record - Applied record or null.
 */

/**
 * Resolved frontend-model resource registration.
 * @typedef {object} FrontendModelResolvedResourceConfiguration
 * @property {import("../configuration-types.js").BackendProjectConfiguration} backendProject - Backend project owning the resource.
 * @property {string} modelName - Frontend model name.
 * @property {import("../configuration-types.js").FrontendModelResourceClassType} resourceClass - Resource class.
 * @property {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} resourceConfiguration - Normalized resource configuration.
 */

/**
 * Transport-safe value accepted in frontend-model resource mutation payloads.
 * Nested object/array values are intentionally opaque because TypeScript rejects
 * recursive JSDoc typedefs for this transport payload contract.
 * @typedef {import("../frontend-models/base.js").FrontendModelTransportValue | import("../database/record/index.js").default | Record<string, unknown> | Array<unknown>} FrontendModelResourcePayloadValue
 */

/**
 * Attribute payload accepted by frontend-model resource mutations.
 * @typedef {Record<string, FrontendModelResourcePayloadValue>} FrontendModelResourceAttributePayload
 */

/**
 * Virtual setter method on a frontend-model resource.
 * @typedef {function(import("../database/record/index.js").default, FrontendModelResourcePayloadValue): (void | Promise<void>)} FrontendModelResourceVirtualSetter
 */

/**
 * Static helpers used when checking whether a model-like receiver accepts an attribute.
 * @typedef {object} WritableAttributeReceiverClass
 * @property {function(string): string | null} resolveAttributeName - Resolves aliases to canonical attribute names.
 * @property {function(Record<string, ?>, string): string | null} findMemberNameInsensitive - Locates a setter method on the receiver.
 */

/**
 * Options passed while saving frontend-model resource mutations.
 * @typedef {object} FrontendModelResourceSaveOptions
 * @property {FrontendModelResourceAttributePayload | null} [attachments] - Uploaded attachment attributes.
 * @property {FrontendModelResourceController | null} [controller] - Controller handling the mutation.
 * @property {FrontendModelResourceAttributePayload | null} [nestedAttributes] - Nested attributes payload.
 */

/**
 * Normalized nested attributes entry.
 * @typedef {FrontendModelResourceAttributePayload & {id?: string | number, _destroy?: boolean, attributes?: FrontendModelResourceAttributePayload, attachments?: FrontendModelResourceAttributePayload, nestedAttributes?: FrontendModelResourceAttributePayload}} FrontendModelResourceNestedEntry
 */

/**
 * Base class for backend frontend-model resources.
 * @template {typeof import("../database/record/index.js").default} [TModelClass=typeof import("../database/record/index.js").default]
 */
export default class FrontendModelBaseResource extends AuthorizationBaseResource {
  /** @type {typeof import("../database/record/index.js").default | undefined} */
  static ModelClass = undefined

  /** @type {Record<string, ?> | string[] | undefined} */
  static attributes = undefined
  /** @type {string[] | undefined} */
  static abilities = undefined
  /** @type {Record<string, ?> | undefined} */
  static attachments = undefined
  /** @type {string[] | undefined} */
  static commands = undefined
  /** @type {string[] | undefined} */
  static collectionCommands = undefined
  /** @type {string[] | undefined} */
  static builtInCollectionCommands = undefined
  /** @type {string[] | undefined} */
  static memberCommands = undefined
  /** @type {string[] | undefined} */
  static builtInMemberCommands = undefined
  /** @type {string[] | undefined} */
  static relationships = undefined
  /** @type {string | undefined} */
  static modelName = undefined
  /** @type {string | undefined} */
  static primaryKey = undefined
  /** @type {import("../configuration-types.js").FrontendModelResourceServerConfiguration | undefined} */
  static server = undefined
  /** @type {import("../configuration-types.js").FrontendModelResourceSyncConfiguration | boolean | undefined} */
  static sync = undefined
  /** @type {string[] | undefined} */
  static translatedAttributes = undefined
  /** @type {?} */
  static SharedResource = undefined

  /**
   * Declarative writable-attribute schema consumed by
   * {@link FrontendModelBaseResource#normalizeWritableAttributes}, keyed by
   * camelCase attribute name. An entry value of `true` infers the whole entry
   * from the backing model's column metadata; partial entries infer their
   * missing `type`, `maxLength` and `required` fields the same way (explicit
   * fields always win). See
   * {@link FrontendModelBaseResource#resolvedWritableAttributes}.
   * @type {Record<string, import("../sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry | true> | null} */
  static writableAttributes = null

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

    const ResourceClass = /** @type {typeof FrontendModelBaseResource} */ (this.constructor)
    const defaultResourceConfiguration = /** @type {import("../configuration-types.js").FrontendModelResourceConfiguration} */ ({attributes: []})

    this.controller = "controller" in args ? args.controller : undefined
    this.modelClassValue = "modelClass" in args ? args.modelClass : ResourceClass.modelClass()
    this.modelNameValue = "modelName" in args ? args.modelName : this.modelClass().getModelName()
    this.paramsValue = "params" in args ? args.params : undefined
    this.resourceConfigurationValue = "resourceConfiguration" in args ? args.resourceConfiguration : defaultResourceConfiguration
    /** @type {FrontendModelBaseResource | null | undefined} */
    this.sharedResourceInstanceValue = undefined
  }

  /**
   * Returns the configured shared resource class.
   * @returns {?} - Shared resource class.
   */
  static sharedResourceClass() {
    return this.SharedResource
  }

  /**
   * Reads a static resource config value from the environment resource first,
   * then from the shared resource.
   * @param {"abilities" | "attachments" | "attributes" | "builtInCollectionCommands" | "builtInMemberCommands" | "collectionCommands" | "commands" | "memberCommands" | "modelName" | "primaryKey" | "relationships" | "server" | "sync" | "translatedAttributes"} name - Static config property name.
   * @returns {?} - Resolved config value.
   */
  static sharedResourceStaticValue(name) {
    if (this[name] !== undefined) return this[name]

    const SharedResource = /** @type {typeof FrontendModelBaseResource | undefined} */ (this.sharedResourceClass())

    if (!SharedResource) return undefined
    if (SharedResource[name] !== undefined) return SharedResource[name]

    return undefined
  }

  /**
   * Resolves translated attributes from environment and shared resources.
   * @returns {string[] | undefined} - Translated attribute names.
   */
  static translatedAttributesConfig() {
    return /** @type {string[] | undefined} */ (this.sharedResourceStaticValue("translatedAttributes"))
  }

  /**
   * Builds a resource instance for shared-resource fallback calls.
   * @returns {FrontendModelBaseResource | null} - Shared resource instance when configured.
   */
  sharedResourceInstance() {
    if (this.sharedResourceInstanceValue !== undefined) return this.sharedResourceInstanceValue

    const ResourceClass = /** @type {typeof FrontendModelBaseResource} */ (this.constructor)
    const SharedResource = /** @type {typeof FrontendModelBaseResource | undefined} */ (ResourceClass.sharedResourceClass())

    if (!SharedResource) {
      this.sharedResourceInstanceValue = null
      return this.sharedResourceInstanceValue
    }

    if (SharedResource === ResourceClass) {
      throw new Error(`${ResourceClass.name}.SharedResource cannot point to itself.`)
    }

    this.sharedResourceInstanceValue = new SharedResource({
      ability: this.ability,
      controller: this.controller,
      context: this.context,
      locals: this.locals,
      modelClass: this.modelClass(),
      modelName: this.modelName(),
      params: this.params(),
      resourceConfiguration: this.resourceConfiguration()
    })

    return this.sharedResourceInstanceValue
  }

  /**
   * Calls a shared-resource method only when the shared resource overrides the framework default.
   * @param {string} methodName - Method name to resolve.
   * @param {unknown[]} args - Method args.
   * @returns {{called: boolean, result: unknown}} - Shared method call result.
   */
  callSharedResourceMethod(methodName, args) {
    const sharedResource = this.sharedResourceInstance()

    if (!sharedResource) return {called: false, result: undefined}

    const methodOwner = prototypeOwnerForMethod(sharedResource, methodName)

    if (!methodOwner || methodOwner === FrontendModelBaseResource.prototype || methodOwner === AuthorizationBaseResource.prototype) {
      return {called: false, result: undefined}
    }

    const method = /** @type {Record<string, (...methodArgs: unknown[]) => unknown>} */ (/** @type {unknown} */ (sharedResource))[methodName]

    return {called: true, result: method.apply(sharedResource, args)}
  }

  /**
   * Runs shared method result or a fallback callback.
   * @template Result
   * @param {string} methodName - Shared method name.
   * @param {unknown[]} args - Shared method args.
   * @param {() => Result} fallback - Fallback callback.
   * @returns {Result} - Shared or fallback result.
   */
  sharedResourceMethodOr(methodName, args, fallback) {
    const sharedResult = this.callSharedResourceMethod(methodName, args)

    if (sharedResult.called) return /** @type {Result} */ (sharedResult.result)

    return fallback()
  }

  /**
   * Resolves a method on this resource or its shared fallback.
   * @param {string} methodName - Method name.
   * @returns {{method: (...methodArgs: unknown[]) => unknown, resource: FrontendModelBaseResource} | null} - Resolved method and receiver.
   */
  resourceMethod(methodName) {
    const ownMethod = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (this))[methodName]

    if (typeof ownMethod === "function") {
      return {
        method: /** @type {(...methodArgs: unknown[]) => unknown} */ (ownMethod),
        resource: this
      }
    }

    const sharedResource = this.sharedResourceInstance()

    if (!sharedResource) return null

    const sharedMethod = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (sharedResource))[methodName]

    if (typeof sharedMethod !== "function") return null

    return {
      method: /** @type {(...methodArgs: unknown[]) => unknown} */ (sharedMethod),
      resource: sharedResource
    }
  }

  /**
   * Runs abilities.
   * @returns {void} - No return value.
   */
  abilities() {
    this.sharedResourceMethodOr("abilities", [], () => undefined)
  }

  /**
   * Runs typed controller instance.
   * @returns {FrontendModelResourceController} - Controller instance with frontend-model helpers.
   */
  typedControllerInstance() {
    return /** @type {FrontendModelResourceController} */ (this.controller)
  }

  /**
   * Runs resource config.
   * @returns {import("../configuration-types.js").FrontendModelResourceConfiguration} - Static resource config (raw user input shape; consumers normalize).
   */
  static resourceConfig() {
    const attributes = this.sharedResourceStaticValue("attributes")
    const abilities = this.sharedResourceStaticValue("abilities")
    const attachments = this.sharedResourceStaticValue("attachments")
    const commands = this.sharedResourceStaticValue("commands")
    const builtInCollectionCommands = this.sharedResourceStaticValue("builtInCollectionCommands")
    const builtInMemberCommands = this.sharedResourceStaticValue("builtInMemberCommands")
    const collectionCommands = this.sharedResourceStaticValue("collectionCommands")
    const memberCommands = this.sharedResourceStaticValue("memberCommands")
    const modelName = this.sharedResourceStaticValue("modelName")
    const primaryKey = this.sharedResourceStaticValue("primaryKey")
    const relationships = this.sharedResourceStaticValue("relationships")
    const server = this.sharedResourceStaticValue("server")
    const sync = this.sharedResourceStaticValue("sync")
    /** @type {import("../configuration-types.js").FrontendModelResourceConfiguration} */
    const config = {
      attributes: /** @type {Record<string, ?> | string[]} */ (attributes || [])
    }

    if (abilities) config.abilities = /** @type {string[]} */ (abilities)
    if (attachments) config.attachments = /** @type {Record<string, ?>} */ (attachments)
    if (commands) config.commands = /** @type {string[]} */ (commands)
    if (builtInCollectionCommands) config.builtInCollectionCommands = /** @type {string[]} */ (builtInCollectionCommands)
    if (builtInMemberCommands) config.builtInMemberCommands = /** @type {string[]} */ (builtInMemberCommands)
    if (collectionCommands) config.collectionCommands = /** @type {string[]} */ (collectionCommands)
    if (memberCommands) config.memberCommands = /** @type {string[]} */ (memberCommands)
    if (modelName) config.modelName = /** @type {string} */ (modelName)
    if (primaryKey) config.primaryKey = /** @type {string} */ (primaryKey)
    if (relationships) config.relationships = /** @type {string[]} */ (relationships)
    if (server) config.server = /** @type {import("../configuration-types.js").FrontendModelResourceServerConfiguration} */ (server)
    if (sync !== undefined) config.sync = /** @type {import("../configuration-types.js").FrontendModelResourceSyncConfiguration | boolean} */ (sync)

    return config
  }

  /**
   * Runs static model class.
   * @returns {typeof import("../database/record/index.js").default} - Backing model class.
   */
  static modelClass() {
    if (!this.ModelClass) throw new Error(`${this.name} requires a static ModelClass.`)

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
   * Runs required model class for authorization helpers.
   * @returns {TModelClass} - Backing model class.
   */
  requiredModelClass() {
    return this.modelClass()
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
   * Default implementation derives the permit from the declared
   * {@link FrontendModelBaseResource.writableAttributes} schema (its camelCase
   * keys, including `ignored` entries) and returns `[]` — nothing permitted —
   * without a schema. Subclasses override to customize; an explicit override
   * always wins over schema derivation.
   * @param {{action?: "create" | "update", params?: Record<string, ?>, ability?: import("../authorization/ability.js").default, locals?: Record<string, ?>}} [arg] - Request context.
   * @returns {Array<string | Record<string, ?>>} - Permit spec.
   */
  permittedParams(arg) {
    return this.sharedResourceMethodOr("permittedParams", [arg], () => {
      void arg

      const schema = /** @type {typeof FrontendModelBaseResource} */ (this.constructor).writableAttributes

      if (schema) return Object.keys(schema)

      return []
    })
  }

  /**
   * Normalizes incoming writable attributes through the declared
   * {@link FrontendModelBaseResource.writableAttributes} schema: camelCase and
   * snake_case input keys are accepted, values are validated per type and the
   * normalized values are written under snake_case column keys. Validation
   * failures throw client-safe errors built by
   * {@link FrontendModelBaseResource#writableAttributeError}.
   * @param {Record<string, ?>} attributes - Raw incoming attributes.
   * @param {{keyCase?: "attribute" | "column", unknownAttributes?: "error" | "ignore"}} [options] - Output key casing (defaults to "column") and unknown input-key handling (defaults to "error").
   * @returns {Record<string, ?>} Normalized attributes keyed per the requested key casing.
   */
  normalizeWritableAttributes(attributes, options = {}) {
    const schema = this.resolvedWritableAttributes()

    if (!schema) throw new Error(`${this.constructor.name} must define static writableAttributes to use normalizeWritableAttributes`)

    return normalizeAttributesWithSchema({
      attributes,
      errorFactory: (message, details) => this.writableAttributeError(message, details),
      keyCase: options.keyCase,
      schema,
      translator: this.writableAttributeTranslator(),
      unknownAttributes: options.unknownAttributes
    })
  }

  /**
   * Resolves the declared {@link FrontendModelBaseResource.writableAttributes}
   * schema into full entries: `true` entries are inferred entirely from the
   * backing model's column metadata and partial entries infer their missing
   * `type`, `maxLength` and `required` fields the same way. Explicit entry
   * fields always win over inferred ones.
   * @returns {Record<string, import("../sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry> | null} Resolved schema or null without a declared schema.
   */
  resolvedWritableAttributes() {
    const schema = /** @type {typeof FrontendModelBaseResource} */ (this.constructor).writableAttributes

    if (!schema) return null

    /** @type {Record<string, import("../sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry>} */
    const resolvedSchema = {}

    for (const [attributeName, rawEntry] of Object.entries(schema)) {
      resolvedSchema[attributeName] = this._resolvedWritableAttributeEntry({attributeName, rawEntry})
    }

    return resolvedSchema
  }

  /**
   * Resolves one writable-attribute schema entry, inferring missing fields
   * from the backing model's column metadata when needed.
   * @param {object} args - Options.
   * @param {string} args.attributeName - camelCase attribute name.
   * @param {import("../sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry | true} args.rawEntry - Declared entry or `true` for full inference.
   * @returns {import("../sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry} Resolved entry.
   */
  _resolvedWritableAttributeEntry({attributeName, rawEntry}) {
    const entry = rawEntry === true ? /** @type {import("../sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry} */ ({}) : {...rawEntry}

    if (entry.type == "ignored" || entry.type == "raw" || entry.type == "rawOrNull" || entry.type == "json") return entry

    const needsType = entry.type === undefined
    const needsRequired = entry.required === undefined
    const needsMaxLength = entry.maxLength === undefined && (entry.type === undefined || entry.type == "string")

    if (!needsType && !needsRequired && !needsMaxLength) return entry

    const column = this._writableAttributeColumn({attributeName, columnName: entry.column ?? inflection.underscore(attributeName)})

    if (!column) {
      if (needsType) {
        throw new Error(`Cannot infer writable attribute '${attributeName}' on ${this.constructor.name}: no backing model column metadata is available. Declare the entry's type explicitly or fix the column name.`)
      }

      return entry
    }

    if (needsType) {
      const columnType = column.getType()
      const inferredType = columnType == null ? null : schemaTypeFromColumnType(columnType)

      if (!inferredType) {
        throw new Error(`Cannot infer writable attribute '${attributeName}' on ${this.constructor.name}: column type ${String(columnType)} has no schema type mapping. Declare the entry's type explicitly.`)
      }

      entry.type = inferredType
    }

    if (needsRequired) entry.required = column.getNull() === false && column.getDefault() == null

    if (entry.type == "string" && entry.maxLength === undefined) {
      const columnMaxLength = column.getMaxLength()

      if (columnMaxLength != null) entry.maxLength = columnMaxLength
    }

    return entry
  }

  /**
   * Looks up the backing model column for a writable attribute, when column
   * metadata is available on the resolved model class.
   * @param {object} args - Options.
   * @param {string} args.attributeName - camelCase attribute name.
   * @param {string} args.columnName - snake_case column name.
   * @returns {import("../database/drivers/base-column.js").default | null} Backing column or null when unavailable.
   */
  _writableAttributeColumn({attributeName, columnName}) {
    void attributeName

    const ModelClass = this.modelClassValue ?? /** @type {typeof FrontendModelBaseResource} */ (this.constructor).ModelClass

    if (!ModelClass || typeof (/** @type {Record<string, ?>} */ (/** @type {unknown} */ (ModelClass))).getColumnsHash != "function") return null

    return /** @type {typeof import("../database/record/index.js").default} */ (ModelClass).getColumnsHash()[columnName] ?? null
  }

  /**
   * Resolves the translator used for derived writable-attribute validation
   * messages: the controller configuration when available, otherwise the
   * backing model class configuration. Resources without a configured model
   * class (e.g. plain unit-test resources) get untranslated English defaults.
   * @returns {import("../database/record/validation-messages.js").ValidationMessageTranslator | null} Message translator.
   */
  writableAttributeTranslator() {
    if (this.controller) return this.controllerInstance().getConfiguration().getTranslator()

    const ModelClass = this.modelClassValue ?? /** @type {typeof FrontendModelBaseResource} */ (this.constructor).ModelClass

    if (ModelClass && typeof (/** @type {Record<string, ?>} */ (/** @type {unknown} */ (ModelClass)))._getConfiguration == "function") {
      return /** @type {typeof import("../database/record/index.js").default} */ (ModelClass)._getConfiguration().getTranslator()
    }

    return null
  }

  /**
   * Builds the client-safe error thrown for a failed writable-attribute validation.
   * @param {string} message - Human-readable validation message.
   * @param {{cause?: Error, code: string}} details - Stable machine-readable code and optional cause.
   * @returns {Error} Client-safe error.
   */
  writableAttributeError(message, {cause, code}) {
    return VelociousError.safe(message, cause ? {cause, code} : {code})
  }

  /**
   * Authorizes one routed sync replay mutation before it is applied.
   * Defaults to allowing every mutation; record-level authorization still
   * applies through {@link FrontendModelBaseResource#findSyncRecord} scoping
   * and the create membership check.
   * @param {object} args - Options.
   * @param {Record<string, ?>} args.context - Replay context.
   * @param {FrontendModelSyncMutation} args.mutation - Normalized replay mutation.
   * @returns {FrontendModelSyncAuthorization | Promise<FrontendModelSyncAuthorization>} Authorization result.
   */
  authorizeSyncMutation({context, mutation}) {
    void context
    void mutation

    return {allowed: true}
  }

  /**
   * Returns the per-sync failure reason reported when a routed sync mutation
   * fails record-level authorization. Defaults to null, which reports the
   * generic "access-denied" reason.
   * @param {object} args - Options.
   * @param {"create" | "destroy" | "update"} args.action - Denied action.
   * @param {FrontendModelSyncMutation} args.mutation - Normalized replay mutation.
   * @returns {string | null} Stable failure reason code or null for the generic default.
   */
  syncAuthorizationFailureReason({action, mutation}) {
    void action
    void mutation

    return null
  }

  /**
   * Finds the existing record targeted by a routed sync replay mutation.
   * Defaults to an `accessibleFor` lookup by primary key through the
   * resource's normalized ability action for update (or destroy for delete
   * mutations), falling back to an unscoped lookup without an ability.
   * @param {object} args - Options.
   * @param {import("../authorization/ability.js").default} [args.ability] - Ability override. Defaults to the resource ability.
   * @param {boolean} [args.forDelete] - Whether the lookup is for a delete mutation.
   * @param {FrontendModelSyncMutation} args.mutation - Normalized replay mutation.
   * @returns {Promise<import("../database/record/index.js").default | null>} Existing record or null.
   */
  async findSyncRecord({ability = this.ability, forDelete = false, mutation}) {
    const ModelClass = this.modelClass()
    const primaryKey = ModelClass.primaryKey()
    const query = ability
      ? ModelClass.accessibleFor(this.syncAbilityAction(forDelete ? "destroy" : "update"), ability)
      : ModelClass.where({})

    return await query.findBy({[primaryKey]: mutation.resourceId})
  }

  /**
   * Maps a raw sync action to the resource's normalized ability action when
   * the resource configuration declares an abilities mapping, otherwise the
   * raw action name is used directly.
   * @param {"create" | "destroy" | "update"} action - Raw sync action.
   * @returns {string} Ability action.
   */
  syncAbilityAction(action) {
    const abilities = this.resourceConfigurationValue?.abilities

    if (abilities && typeof abilities == "object" && !Array.isArray(abilities)) {
      const abilityAction = /** @type {Record<string, ?>} */ (abilities)[action]

      if (typeof abilityAction == "string" && abilityAction.length > 0) return abilityAction
    }

    return action
  }

  /**
   * Returns how routed delete mutations treat found records: "destroy"
   * destroys the record, "ignore" leaves it untouched.
   * @returns {"destroy" | "ignore"} Delete behavior.
   */
  syncDeleteBehavior() {
    return "destroy"
  }

  /**
   * Returns how routed upsert mutations treat missing records: "create"
   * creates the record with the mutation's resource id, "ignore" skips the
   * mutation without applying anything.
   * @returns {"create" | "ignore"} Missing-record behavior.
   */
  syncMissingRecordBehavior() {
    return "create"
  }

  /**
   * Decides whether a routed sync mutation should be applied over the
   * existing sync row. Returning null (the default) keeps the replay
   * service's timestamp-based staleness default.
   * @param {object} args - Options.
   * @param {import("../database/record/index.js").default | null} args.existingSync - Existing sync row or null.
   * @param {FrontendModelSyncMutation} args.mutation - Normalized replay mutation.
   * @returns {boolean | null | Promise<boolean | null>} Whether to apply, or null for the service default.
   */
  shouldApplySync({existingSync, mutation}) {
    void existingSync
    void mutation

    return null
  }

  /**
   * Full escape hatch for routed sync mutation application. Returning a
   * non-null result replaces the whole default apply flow (authorization,
   * record lookup, normalization and save) with the returned apply result.
   * @param {FrontendModelApplySyncArgs} args - Apply args.
   * @returns {FrontendModelSyncApplyResult | null | Promise<FrontendModelSyncApplyResult | null>} Apply result or null for the default flow.
   */
  applySync(args) {
    void args

    return null
  }

  /**
   * Runs after a routed sync mutation was applied. Returned entries are
   * merged into the apply result, reaching persistExtraAttributes and
   * broadcasts.
   * @param {object} args - Options.
   * @param {Record<string, ?>} args.context - Replay context.
   * @param {boolean} args.created - Whether the record was created.
   * @param {FrontendModelSyncMutation} args.mutation - Normalized replay mutation.
   * @param {import("../database/record/index.js").default | null} args.record - Applied record or null.
   * @returns {Record<string, ?> | Promise<Record<string, ?>>} Extra apply-result entries.
   */
  afterSyncApply({context, created, mutation, record}) {
    void context
    void created
    void mutation
    void record

    return {}
  }

  /**
   * Returns the writable-attribute schema used to normalize routed sync
   * mutation data. Defaults to the resolved
   * {@link FrontendModelBaseResource.writableAttributes} schema; override
   * when the sync schema legitimately differs from the HTTP one.
   * @returns {Record<string, import("../sync/sync-attribute-normalizer.js").SyncAttributeSchemaEntry> | null} Sync schema or null when undeclared.
   */
  syncWritableAttributes() {
    return this.resolvedWritableAttributes()
  }

  /**
   * Normalizes create attributes before permission filtering and saving.
   * @param {FrontendModelResourceAttributePayload} attributes - Incoming create attributes.
   * @param {FrontendModelResourceSaveOptions} options - Save options.
   * @returns {FrontendModelResourceAttributePayload | Promise<FrontendModelResourceAttributePayload>} - Normalized attributes.
   */
  normalizeCreateAttributes(attributes, options) {
    return this.sharedResourceMethodOr("normalizeCreateAttributes", [attributes, options], () => {
      void options

      if (/** @type {typeof FrontendModelBaseResource} */ (this.constructor).writableAttributes) {
        return this.normalizeWritableAttributes(attributes, {keyCase: "attribute"})
      }

      return attributes
    })
  }

  /**
   * Normalizes update attributes before permission filtering and saving.
   * @param {import("../database/record/index.js").default} model - Existing model.
   * @param {FrontendModelResourceAttributePayload} attributes - Incoming update attributes.
   * @param {FrontendModelResourceSaveOptions} options - Save options.
   * @returns {FrontendModelResourceAttributePayload | Promise<FrontendModelResourceAttributePayload>} - Normalized attributes.
   */
  normalizeUpdateAttributes(model, attributes, options) {
    return this.sharedResourceMethodOr("normalizeUpdateAttributes", [model, attributes, options], () => {
      void model
      void options

      if (/** @type {typeof FrontendModelBaseResource} */ (this.constructor).writableAttributes) {
        return this.normalizeWritableAttributes(attributes, {keyCase: "attribute"})
      }

      return attributes
    })
  }

  /**
   * Runs before create.
   * @param {import("../database/record/index.js").default} model - New model before assignment/save.
   * @param {FrontendModelResourceAttributePayload} attributes - Normalized create attributes.
   * @param {FrontendModelResourceSaveOptions} options - Save options.
   * @returns {void | Promise<void>} - Resolves when the hook finishes.
   */
  beforeCreate(model, attributes, options) {
    return this.sharedResourceMethodOr("beforeCreate", [model, attributes, options], () => {
      void model
      void attributes
      void options
    })
  }

  /**
   * Runs after create.
   * @param {import("../database/record/index.js").default} model - Created model.
   * @param {FrontendModelResourceAttributePayload} attributes - Normalized create attributes.
   * @param {FrontendModelResourceSaveOptions} options - Save options.
   * @returns {void | Promise<void>} - Resolves when the hook finishes.
   */
  afterCreate(model, attributes, options) {
    return this.sharedResourceMethodOr("afterCreate", [model, attributes, options], () => {
      void model
      void attributes
      void options
    })
  }

  /**
   * Runs before update.
   * @param {import("../database/record/index.js").default} model - Existing model before assignment/save.
   * @param {FrontendModelResourceAttributePayload} attributes - Normalized update attributes.
   * @param {FrontendModelResourceSaveOptions} options - Save options.
   * @returns {void | Promise<void>} - Resolves when the hook finishes.
   */
  beforeUpdate(model, attributes, options) {
    return this.sharedResourceMethodOr("beforeUpdate", [model, attributes, options], () => {
      void model
      void attributes
      void options
    })
  }

  /**
   * Runs after update.
   * @param {import("../database/record/index.js").default} model - Updated model.
   * @param {FrontendModelResourceAttributePayload} attributes - Normalized update attributes.
   * @param {FrontendModelResourceSaveOptions} options - Save options.
   * @returns {void | Promise<void>} - Resolves when the hook finishes.
   */
  afterUpdate(model, attributes, options) {
    return this.sharedResourceMethodOr("afterUpdate", [model, attributes, options], () => {
      void model
      void attributes
      void options
    })
  }

  /**
   * Runs before destroy.
   * @param {import("../database/record/index.js").default} model - Model before destroy.
   * @returns {void | Promise<void>} - Resolves when the hook finishes.
   */
  beforeDestroy(model) {
    return this.sharedResourceMethodOr("beforeDestroy", [model], () => {
      void model
    })
  }

  /**
   * Runs after destroy.
   * @param {import("../database/record/index.js").default} model - Destroyed model.
   * @returns {void | Promise<void>} - Resolves when the hook finishes.
   */
  afterDestroy(model) {
    return this.sharedResourceMethodOr("afterDestroy", [model], () => {
      void model
    })
  }

  /**
   * Wraps create/update/destroy resource mutations.
   * @template Result
   * @param {object} args - Transaction args.
   * @param {"create" | "update" | "destroy"} args.action - Mutation action.
   * @param {import("../database/record/index.js").default} args.model - Mutated model.
   * @param {() => Promise<Result>} args.callback - Mutation callback.
   * @returns {Promise<Result>} - Callback result.
   */
  async runMutationTransaction({action, model, callback}) {
    return await this.sharedResourceMethodOr("runMutationTransaction", [{action, model, callback}], async () => {
      void action
      void model

      return await callback()
    })
  }

  /**
   * Runs primary key.
   * @returns {string} - Primary key.
   */
  primaryKey() { return this.modelClass().primaryKey() }

  /**
   * Runs authorized query.
   * @param {FrontendModelResourceAction} action - Ability action.
   * @returns {import("../database/query/model-class-query.js").default<TModelClass>} - Authorized query.
   */
  authorizedQuery(action) {
    // Narrows the controller query to this resource's model class.
    return /** @type {import("../database/query/model-class-query.js").default<TModelClass>} */ (this.typedControllerInstance().frontendModelAbilityAuthorizedQuery(action))
  }

  /**
   * Runs index query.
   * @param {FrontendModelResourceIndexQueryOptions} [options] - Query options.
   * @returns {import("../database/query/model-class-query.js").default<TModelClass>} - Frontend-model index query.
   */
  indexQuery(options = {}) {
    return /** @type {import("../database/query/model-class-query.js").default<TModelClass>} */ (this.typedControllerInstance().frontendModelIndexQuery({
      ...options,
      resource: this
    }))
  }

  /**
   * Applies frontend-model index pagination.
   * @param {object} args - Pagination args.
   * @param {FrontendModelResourceController} args.controller - Controller handling the query.
   * @param {FrontendModelResourcePagination} args.pagination - Pagination params.
   * @param {FrontendModelResourceAnyQuery} args.query - Query instance.
   * @returns {void}
   */
  applyFrontendModelIndexPagination({controller, pagination, query}) {
    controller.applyFrontendModelPagination({pagination, query})
  }

  /**
   * Applies frontend-model index search.
   * @param {object} args - Search args.
   * @param {FrontendModelResourceController} args.controller - Controller handling the query.
   * @param {FrontendModelResourceAnyQuery} args.query - Query instance.
   * @param {FrontendModelResourceSearch} args.search - Search params.
   * @returns {void}
   */
  applyFrontendModelIndexSearch({controller, query, search}) {
    controller.applyFrontendModelSearch({query, search})
  }

  /**
   * Applies frontend-model index sort.
   * @param {object} args - Sort args.
   * @param {FrontendModelResourceController} args.controller - Controller handling the query.
   * @param {FrontendModelResourceAnyQuery} args.query - Query instance.
   * @param {FrontendModelResourceSort} args.sort - Sort params.
   * @returns {void}
   */
  applyFrontendModelIndexSort({controller, query, sort}) {
    controller.applyFrontendModelSort({query, sort})
  }

  /**
   * Runs supports pluck.
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Action.
   * @returns {boolean | Promise<boolean>} - Whether pluck is supported.
   */
  supportsPluck(action) {
    void action

    return Object.getPrototypeOf(this).records === FrontendModelBaseResource.prototype.records
  }

  /**
   * Runs supports count.
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Action.
   * @returns {boolean | Promise<boolean>} - Whether count is supported.
   */
  supportsCount(action) {
    void action

    return Object.getPrototypeOf(this).records === FrontendModelBaseResource.prototype.records ||
      Object.getPrototypeOf(this).count !== FrontendModelBaseResource.prototype.count
  }

  /**
   * Runs before action.
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Action.
   * @returns {boolean | void | Promise<boolean | void>} - Continue processing unless false.
   */
  beforeAction(action) {
    return this.sharedResourceMethodOr("beforeAction", [action], () => {
      void action

      // No-op by default.
    })
  }

  /**
   * Runs records.
   * @returns {Promise<import("../database/record/index.js").default[]>} - Records for index action.
   */
  async records() {
    return await this.indexQuery().toArray()
  }

  /**
   * Runs index query options for count.
   * @returns {FrontendModelResourceIndexQueryOptions} - Index query options for count.
   */
  countIndexQueryOptions() {
    return {}
  }

  /**
   * Runs count.
   * @returns {Promise<number>} - Records count for index action.
   */
  async count() {
    return await this.indexQuery(this.countIndexQueryOptions()).count()
  }

  /**
   * Runs find.
   * @param {"find" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Action.
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
   * @param {FrontendModelResourceAttributePayload} attributes - Create attributes.
   * @param {FrontendModelResourceSaveOptions} [options] - Save options.
   * @returns {Promise<import("../database/record/index.js").default>} - Created model.
   */
  async create(attributes, options = {}) {
    const normalizedAttributes = await this.normalizeCreateAttributes(attributes, options)
    const attachmentSplit = this._extractAttachmentAttributes(normalizedAttributes, options.attachments ?? null)
    const permit = parsePermittedParams(this.permittedParams({action: "create", ability: this.ability, locals: this.locals, params: normalizedAttributes}))
    const ModelClass = this.modelClass()
    const filtered = filterWritableFrontendModelAttributes(this.modelClass().prototype, ModelClass, attachmentSplit.attributes, this, permit.attributes)
    const model = new ModelClass()

    return await this.runMutationTransaction({
      action: "create",
      model,
      callback: async () => {
        await this.beforeCreate(model, normalizedAttributes, options)
        const savedModel = await this._saveWithNestedAttributes({filtered, model, options: {...options, attachments: attachmentSplit.attachments}, permit})

        await this.afterCreate(savedModel, normalizedAttributes, options)

        return savedModel
      }
    })
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
   * @param {FrontendModelResourceAttributePayload} attributes - Update attributes.
   * @param {FrontendModelResourceSaveOptions} [options] - Save options.
   * @returns {Promise<import("../database/record/index.js").default>} - Updated model.
   */
  async update(model, attributes, options = {}) {
    const normalizedAttributes = await this.normalizeUpdateAttributes(model, attributes, options)
    const attachmentSplit = this._extractAttachmentAttributes(normalizedAttributes, options.attachments ?? null)
    const permit = parsePermittedParams(this.permittedParams({action: "update", ability: this.ability, locals: this.locals, params: normalizedAttributes}))
    const filtered = filterWritableFrontendModelAttributes(model, model.getModelClass(), attachmentSplit.attributes, this, permit.attributes)

    return await this.runMutationTransaction({
      action: "update",
      model,
      callback: async () => {
        await this.beforeUpdate(model, normalizedAttributes, options)
        const savedModel = await this._saveWithNestedAttributes({filtered, model, options: {...options, attachments: attachmentSplit.attachments}, permit})

        await this.afterUpdate(savedModel, normalizedAttributes, options)

        return savedModel
      }
    })
  }

  /**
   * Saves a model and applies nested attributes in one transaction.
   * @param {{filtered: Record<string, ?>, model: import("../database/record/index.js").default, options: FrontendModelResourceSaveOptions, permit: {attributes: string[], nested: Record<string, ?>}}} args - Save arguments.
   * @returns {Promise<import("../database/record/index.js").default>} - Saved model.
   */
  async _saveWithNestedAttributes({filtered, model, options, permit}) {
    await this.modelClass().transaction(async () => {
      await this._assignWithVirtualSetters(model, filtered)
      this._assignAttachments(model, options.attachments ?? null, permit.attributes)

      if (options.nestedAttributes) {
        await this._applyBelongsToNestedAttributes(model, options.nestedAttributes, options.controller || null, permit)
      }

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
    /** @type {Record<string, ?>} */
    const directAttributes = {}
    const ResourceClass = /** @type {typeof FrontendModelBaseResource} */ (this.constructor)
    const translatedSet = new Set(ResourceClass.translatedAttributesConfig() || [])

    for (const [name, value] of Object.entries(attributes)) {
      const resourceSetterName = `set${inflection.camelize(name)}Attribute`
      const resourceSetter = this.resourceMethod(resourceSetterName)

      if (resourceSetter) {
        await resourceSetter.method.call(resourceSetter.resource, model, value)
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
   * Splits attachment-named attributes into the attachment payload while preserving legacy callers
   * that submitted attachments as normal frontend-model attributes.
   * @param {Record<string, ?>} attributes - Incoming mutation attributes.
   * @param {Record<string, ?> | null} attachments - Explicit attachment payload.
   * @returns {{attributes: Record<string, ?>, attachments: Record<string, ?> | null}} Attributes with attachment keys removed and merged attachment payload.
   */
  _extractAttachmentAttributes(attributes, attachments) {
    const attachmentDefinitions = this.modelClass().getAttachmentsMap()
    const attachmentNames = new Set(Object.keys(attachmentDefinitions))

    if (attachmentNames.size === 0) return {attributes, attachments}

    if (attachments !== null && !isPlainObject(attachments)) {
      throw new Error("Expected attachments to be an object.")
    }

    /** @type {Record<string, ?>} */
    const regularAttributes = {}
    /** @type {Record<string, ?> | null} */
    let mergedAttachments = attachments ? {...attachments} : null

    for (const [attributeName, value] of Object.entries(attributes)) {
      if (!attachmentNames.has(attributeName)) {
        regularAttributes[attributeName] = value
        continue
      }

      if (!mergedAttachments) mergedAttachments = {}
      if (Object.prototype.hasOwnProperty.call(mergedAttachments, attributeName)) {
        throw new Error(`Attachment '${attributeName}' was submitted in both attributes and attachments.`)
      }

      mergedAttachments[attributeName] = value
    }

    return {attributes: regularAttributes, attachments: mergedAttachments}
  }

  /**
   * Queues attachment payloads on a model after validating permits and attachment definitions.
   * @param {import("../database/record/index.js").default} model - Model receiving attachments.
   * @param {Record<string, ?> | null} attachments - Attachments keyed by attachment name.
   * @param {string[]} permittedAttributeNames - Attribute/attachment names permitted by the resource.
   * @returns {void}
   */
  _assignAttachments(model, attachments, permittedAttributeNames) {
    if (!attachments) return
    if (!isPlainObject(attachments)) throw new Error("Expected attachments to be an object.")

    const permitSet = new Set(permittedAttributeNames)
    const modelClass = model.getModelClass()
    const attachmentDefinitions = modelClass.getAttachmentsMap()
    /** @type {string[]} */
    const notPermittedAttachments = []
    /** @type {string[]} */
    const invalidAttachments = []

    for (const [attachmentName, value] of Object.entries(attachments)) {
      if (!permitSet.has(attachmentName)) {
        notPermittedAttachments.push(attachmentName)
        continue
      }
      if (!attachmentDefinitions[attachmentName]) {
        invalidAttachments.push(attachmentName)
        continue
      }

      model.getAttachmentByName(attachmentName).queueAttach(value)
    }

    if (notPermittedAttachments.length > 0) {
      throw new Error(`Frontend model attachment names not permitted by permittedParams(): ${notPermittedAttachments.join(", ")}`)
    }
    if (invalidAttachments.length > 0) {
      throw new Error(`Invalid frontend model attachment names: ${invalidAttachments.join(", ")}`)
    }
  }

  /**
   * Sets a translated attribute on a model via the translations relationship.
   * @param {import("../database/record/index.js").default} model - Model instance.
   * @param {string} name - Attribute name.
   * @param {FrontendModelResourcePayloadValue} value - Attribute value.
   * @returns {Promise<void>}
   */
  async _setTranslatedAttributeOnModel(model, name, value) {
    const configuration = this.context?.configuration
    const locale = configuration ? configuration.getLocale() : "en"
    const instanceRelationship = model.getRelationshipByName("translations")

    /** @type {import("../database/record/index.js").default | undefined} */
    let translation

    if (model.isNewRecord()) {
      const loaded = instanceRelationship.loaded()

      if (Array.isArray(loaded)) {
        translation = loaded.find((t) => /** @type {Record<string, ?>} */ (t).locale() === locale)
      }
    } else {
      if (!instanceRelationship.getPreloaded()) {
        await model.loadRelationship("translations")
      }

      const loaded = instanceRelationship.loaded()

      if (Array.isArray(loaded)) {
        translation = loaded.find((t) => /** @type {Record<string, ?>} */ (t).locale() === locale)
      }
    }

    if (!translation) {
      translation = instanceRelationship.build({locale})
    }

    /** @type {Record<string, ?>} */
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
    await this.runMutationTransaction({
      action: "destroy",
      model,
      callback: async () => {
        await this.beforeDestroy(model)
        await model.destroy()
        await this.afterDestroy(model)
      }
    })
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
   * Resolves common metadata for one nested-attributes relationship.
   * @param {object} args - Nested relationship inputs.
   * @param {import("../database/record/index.js").default} args.parent - Parent model instance.
   * @param {string} args.relationshipName - Relationship receiving nested attributes.
   * @param {FrontendModelResourcePayloadValue} args.rawEntries - Raw nested entries from the request payload.
   * @param {{attributes: string[], nested: Record<string, ?>}} args.childPermit - Parsed child permit.
   * @param {FrontendModelResourceController | null | undefined} args.controller - Controller instance for child resource lookup.
   * @returns {{ability: import("../authorization/ability.js").default | undefined, childResource: FrontendModelBaseResource, childResourceConfig: FrontendModelResolvedResourceConfiguration, childWritableAttributes: string[], destroyPermitted: boolean, entries: Array<FrontendModelResourceNestedEntry>, relationship: import("../database/record/relationships/base.js").default, targetModelClass: typeof import("../database/record/index.js").default}} Nested relationship context.
   */
  _nestedRelationshipContext({parent, relationshipName, rawEntries, childPermit, controller}) {
    if (!controller) {
      throw new Error(`Nested attributes for '${relationshipName}' require a controller instance.`)
    }

    const parentModelClass = parent.getModelClass()
    const modelAcceptance = parentModelClass.acceptedNestedAttributesFor(relationshipName)

    if (!modelAcceptance) {
      throw new Error(`Model ${parentModelClass.name} does not accept nested attributes for '${relationshipName}'. Declare it via ${parentModelClass.name}.acceptsNestedAttributesFor('${relationshipName}').`)
    }

    const relationship = parentModelClass.getRelationshipByName(relationshipName)
    const relationshipType = relationship.getType()
    const rawNormalizedEntries = this._nestedRelationshipEntries({rawEntries, relationshipName, relationshipType})
    const destroyPermitted = childPermit.attributes.includes("_destroy")

    if (destroyPermitted && !modelAcceptance.allowDestroy) {
      throw new Error(`Resource permits _destroy on nestedAttributes['${relationshipName}'] but the model ${parentModelClass.name} does not allow destroy for that relationship. Set {allowDestroy: true} on ${parentModelClass.name}.acceptsNestedAttributesFor('${relationshipName}', ...).`)
    }
    if (typeof modelAcceptance.limit === "number" && rawNormalizedEntries.length > modelAcceptance.limit) {
      throw new Error(`nestedAttributes['${relationshipName}'] exceeds model-declared limit of ${modelAcceptance.limit}.`)
    }
    if (relationshipType !== "hasMany" && rawNormalizedEntries.length > 1) {
      throw new Error(`nestedAttributes['${relationshipName}'] accepts one entry for ${relationshipType} relationships.`)
    }

    const targetModelClass = relationship.getTargetModelClass()

    if (!targetModelClass) {
      throw new Error(`No target model class resolved for relationship '${relationshipName}' on ${parentModelClass.name}.`)
    }

    const childResourceConfig = controller.frontendModelResourceConfigurationForModelClass(targetModelClass)

    if (!childResourceConfig) {
      throw new Error(`No frontend-model resource registered for child model '${targetModelClass.getModelName()}' under relationship '${relationshipName}'.`)
    }

    const childResource = new childResourceConfig.resourceClass({
      ability: this.ability,
      controller,
      context: this.context || {},
      locals: this.locals || {},
      modelClass: targetModelClass,
      modelName: childResourceConfig.modelName,
      params: controller.frontendModelParams(),
      resourceConfiguration: childResourceConfig.resourceConfiguration
    })
    const childWritableAttributes = childPermit.attributes.filter((name) => name !== "_destroy")
    const entries = rawNormalizedEntries
      .map((entry) => this._normalizeNestedRelationshipEntry({childPermit, entry, relationshipName, targetModelClass}))
      .filter((entry) => {
        if (typeof modelAcceptance.rejectIf !== "function") return true

        return !modelAcceptance.rejectIf(isPlainObject(entry.attributes) ? entry.attributes : {})
      })

    return {
      ability: controller.currentAbility() || this.ability,
      childResource,
      childResourceConfig,
      childWritableAttributes,
      destroyPermitted,
      entries,
      relationship,
      targetModelClass
    }
  }

  /**
   * Normalizes nested entries for collection and singular relationships.
   * @param {object} args - Nested entries inputs.
   * @param {FrontendModelResourcePayloadValue} args.rawEntries - Raw nested entries value.
   * @param {string} args.relationshipName - Relationship name.
   * @param {string} args.relationshipType - Relationship type.
   * @returns {Array<FrontendModelResourceNestedEntry>} Normalized nested entry objects.
   */
  _nestedRelationshipEntries({rawEntries, relationshipName, relationshipType}) {
    if (relationshipType === "hasMany") {
      if (!Array.isArray(rawEntries)) {
        throw new Error(`Expected array for nestedAttributes['${relationshipName}'] but got: ${typeof rawEntries}`)
      }

      return rawEntries.map((entry) => {
        if (!isPlainObject(entry)) throw new Error(`nestedAttributes['${relationshipName}'] entries must be objects.`)

        // Narrows the plain-object payload to a normalized nested-entry object.
        return /** @type {FrontendModelResourceNestedEntry} */ (entry)
      })
    }

    if (rawEntries == null) return []
    if (Array.isArray(rawEntries)) {
      return rawEntries.map((entry) => {
        if (!isPlainObject(entry)) throw new Error(`nestedAttributes['${relationshipName}'] entries must be objects.`)

        // Narrows the plain-object payload to a normalized nested-entry object.
        return /** @type {FrontendModelResourceNestedEntry} */ (entry)
      })
    }
    if (!isPlainObject(rawEntries)) {
      throw new Error(`Expected object for nestedAttributes['${relationshipName}'] but got: ${typeof rawEntries}`)
    }

    // Narrows the plain-object payload to a normalized nested-entry object.
    return [/** @type {FrontendModelResourceNestedEntry} */ (rawEntries)]
  }

  /**
   * Normalizes one nested entry from either internal transport shape
   * (`{attributes, attachments, nestedAttributes}`) or direct Rails-style
   * fields (`{name, file, commentsAttributes}`).
   * @param {object} args - Normalization inputs.
   * @param {{attributes: string[], nested: Record<string, ?>}} args.childPermit - Parsed child permit spec.
   * @param {FrontendModelResourceNestedEntry} args.entry - Raw nested entry.
   * @param {string} args.relationshipName - Relationship name for error messages.
   * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
   * @returns {FrontendModelResourceNestedEntry} Normalized nested entry.
   */
  _normalizeNestedRelationshipEntry({childPermit, entry, relationshipName, targetModelClass}) {
    /** @type {FrontendModelResourceAttributePayload} */
    const attributes = {}
    /** @type {FrontendModelResourceAttributePayload} */
    const attachments = {}
    /** @type {FrontendModelResourceAttributePayload} */
    const nestedAttributes = {}
    /** @type {FrontendModelResourceNestedEntry} */
    const normalized = {}
    const attachmentDefinitions = targetModelClass.getAttachmentsMap()

    for (const [attributeName, value] of Object.entries(entry)) {
      if (attributeName === "id") {
        if (typeof value !== "string" && typeof value !== "number") {
          throw new Error(`nestedAttributes['${relationshipName}'] entry id must be a string or number.`)
        }

        normalized.id = value
        continue
      }

      if (attributeName === "_destroy") {
        if (typeof value !== "boolean") {
          throw new Error(`nestedAttributes['${relationshipName}'] entry _destroy must be a boolean.`)
        }

        normalized._destroy = value
        continue
      }

      if (attributeName === "attributes") {
        if (!isPlainObject(value)) throw new Error(`nestedAttributes['${relationshipName}'] entry attributes must be an object.`)
        Object.assign(attributes, value)
        continue
      }

      if (attributeName === "attachments") {
        if (!isPlainObject(value)) throw new Error(`nestedAttributes['${relationshipName}'] entry attachments must be an object.`)
        Object.assign(attachments, value)
        continue
      }

      if (attributeName === "nestedAttributes") {
        if (!isPlainObject(value)) throw new Error(`nestedAttributes['${relationshipName}'] entry nestedAttributes must be an object.`)
        Object.assign(nestedAttributes, value)
        continue
      }

      if (attributeName.endsWith("Attributes")) {
        const nestedRelationshipName = attributeName.slice(0, -"Attributes".length)

        if (!nestedRelationshipName) throw new Error(`Invalid nested attributes key: ${attributeName}`)
        if (!childPermit.nested[nestedRelationshipName]) {
          throw new Error(`Nested attributes for '${nestedRelationshipName}' are not permitted under '${relationshipName}'. Include {${attributeName}: [...]} in that nested permit.`)
        }

        nestedAttributes[nestedRelationshipName] = value
        continue
      }

      if (attachmentDefinitions[attributeName]) {
        attachments[attributeName] = value
      } else {
        attributes[attributeName] = value
      }
    }

    if (Object.keys(attributes).length > 0) normalized.attributes = attributes
    if (Object.keys(attachments).length > 0) normalized.attachments = attachments
    if (Object.keys(nestedAttributes).length > 0) normalized.nestedAttributes = nestedAttributes

    return normalized
  }

  /**
   * Applies belongs-to nested attributes before the parent save so the parent FK can be set.
   * @param {import("../database/record/index.js").default} parent - Parent model instance.
   * @param {FrontendModelResourceAttributePayload} nestedAttributes - Nested-attribute payload keyed by relationship name.
   * @param {FrontendModelResourceController | null | undefined} controller - Controller instance for resource resolution and authorization.
   * @param {{attributes: string[], nested: Record<string, ?>} | null} [parentPermit] - Parsed parent permit spec.
   * @returns {Promise<void>}
   */
  async _applyBelongsToNestedAttributes(parent, nestedAttributes, controller, parentPermit = null) {
    const resolvedParent = parentPermit
      || parsePermittedParams(this.permittedParams({action: "update", ability: this.ability, locals: this.locals, params: {}}))

    for (const relationshipName of Object.keys(nestedAttributes)) {
      const childPermit = resolvedParent.nested[relationshipName]

      if (!childPermit) continue

      const context = this._nestedRelationshipContext({
        childPermit,
        controller,
        parent,
        rawEntries: nestedAttributes[relationshipName],
        relationshipName
      })

      if (context.relationship.getType() !== "belongsTo") continue

      const foreignKey = this._foreignKeyAttributeForModel(context.relationship, parent.getModelClass())

      for (const entry of context.entries) {
        if (entry._destroy) {
          if (!context.destroyPermitted) {
            throw new Error(`nestedAttributes['${relationshipName}'] entry requested _destroy but "_destroy" is not in the permit for this relationship.`)
          }
          const id = entry.id

          if (id == undefined) throw new Error(`nestedAttributes['${relationshipName}'] _destroy entry is missing an id.`)

          const existing = await this._findNestedRecord({
            ability: context.ability,
            action: "destroy",
            childResourceConfiguration: context.childResourceConfig.resourceConfiguration,
            id,
            relationshipName,
            targetModelClass: context.targetModelClass
          })

          await context.childResource.destroy(existing)
          parent.setAttribute(foreignKey, null)
          continue
        }

        const id = entry.id
        const child = id != undefined
          ? await this._findNestedRecord({
            ability: context.ability,
            action: "update",
            childResourceConfiguration: context.childResourceConfig.resourceConfiguration,
            id,
            relationshipName,
            targetModelClass: context.targetModelClass
          })
          : new context.targetModelClass()

        await context.childResource._assignNestedEntryToChild({
          child,
          childWritableAttributes: context.childWritableAttributes,
          entry
        })
        await context.childResource._applyBelongsToNestedAttributes(child, entry.nestedAttributes || {}, controller, childPermit)
        await child.save()

        if (id == undefined) {
          await this._authorizeCreatedChild({
            ability: context.ability,
            child,
            childResourceConfiguration: context.childResourceConfig.resourceConfiguration,
            relationshipName,
            targetModelClass: context.targetModelClass
          })
        }

        if (entry.nestedAttributes) {
          await context.childResource._applyNestedAttributes(child, entry.nestedAttributes, controller, childPermit)
        }

        parent.setAttribute(foreignKey, child.id())
      }
    }
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
   * @param {FrontendModelResourceAttributePayload} nestedAttributes - Nested-attribute payload keyed by relationship name.
   * @param {FrontendModelResourceController | null | undefined} controller - Controller instance for resource resolution and authorization.
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

      const context = this._nestedRelationshipContext({
        childPermit,
        controller,
        parent,
        rawEntries: nestedAttributes[relationshipName],
        relationshipName
      })

      if (context.relationship.getType() === "belongsTo") continue

      const parentLinkAttributes = this._parentLinkAttributesForNestedChild({
        parent,
        relationship: context.relationship,
        targetModelClass: context.targetModelClass
      })

      const destroyEntries = []
      const updateEntries = []
      const createEntries = []

      for (const entry of context.entries) {
        if (entry?._destroy) {
          if (!context.destroyPermitted) {
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

      for (const entry of destroyEntries) {
        const id = entry.id

        if (id == undefined) {
          throw new Error(`nestedAttributes['${relationshipName}'] _destroy entry is missing an id.`)
        }

        const existing = await this._findScopedChild({
          ability: context.ability,
          action: "destroy",
          childResourceConfiguration: context.childResourceConfig.resourceConfiguration,
          id,
          parent,
          parentLinkAttributes,
          relationshipName,
          targetModelClass: context.targetModelClass
        })

        await context.childResource.destroy(existing)
      }

      for (const entry of updateEntries) {
        const id = entry.id

        if (id == undefined) {
          throw new Error(`nestedAttributes['${relationshipName}'] update entry is missing an id.`)
        }

        const existing = await this._findScopedChild({
          ability: context.ability,
          action: "update",
          childResourceConfiguration: context.childResourceConfig.resourceConfiguration,
          id,
          parent,
          parentLinkAttributes,
          relationshipName,
          targetModelClass: context.targetModelClass
        })

        await context.childResource._assignNestedEntryToChild({
          child: existing,
          childWritableAttributes: context.childWritableAttributes,
          entry
        })
        await context.childResource._applyBelongsToNestedAttributes(existing, entry.nestedAttributes || {}, controller, childPermit)
        await existing.save()

        if (entry.nestedAttributes) {
          await context.childResource._applyNestedAttributes(existing, entry.nestedAttributes, controller, childPermit)
        }
      }

      for (const entry of createEntries) {
        const child = new context.targetModelClass()

        child.assign(parentLinkAttributes)
        await context.childResource._assignNestedEntryToChild({
          child,
          childWritableAttributes: context.childWritableAttributes,
          entry
        })
        await context.childResource._applyBelongsToNestedAttributes(child, entry.nestedAttributes || {}, controller, childPermit)
        await child.save()

        await this._authorizeCreatedChild({
          ability: context.ability,
          child,
          childResourceConfiguration: context.childResourceConfig.resourceConfiguration,
          relationshipName,
          targetModelClass: context.targetModelClass
        })

        if (entry.nestedAttributes) {
          await context.childResource._applyNestedAttributes(child, entry.nestedAttributes, controller, childPermit)
        }
      }
    }
  }

  /**
   * Assigns one nested entry's attributes and attachments to a child model.
   * @param {object} args - Assignment inputs.
   * @param {import("../database/record/index.js").default} args.child - Child model receiving data.
   * @param {string[]} args.childWritableAttributes - Permitted child attribute and attachment names.
   * @param {Record<string, ?>} args.entry - Nested entry payload.
   * @returns {Promise<void>}
   */
  async _assignNestedEntryToChild({child, childWritableAttributes, entry}) {
    if (entry.attributes !== undefined) {
      if (!isPlainObject(entry.attributes)) throw new Error("Expected nested entry attributes to be an object.")

      const filtered = filterWritableFrontendModelAttributes(child, child.getModelClass(), entry.attributes, this, childWritableAttributes)
      await this._assignWithVirtualSetters(child, filtered)
    }

    if (entry.attachments !== undefined && !isPlainObject(entry.attachments)) {
      throw new Error("Expected nested entry attachments to be an object.")
    }

    this._assignAttachments(child, entry.attachments ?? null, childWritableAttributes)
  }

  /**
   * Converts a relationship's foreign-key column/name to the target model's attribute name.
   * @param {import("../database/record/relationships/base.js").default} relationship - Relationship metadata.
   * @param {typeof import("../database/record/index.js").default} modelClass - Model class containing the FK.
   * @returns {string} Foreign-key attribute name.
   */
  _foreignKeyAttributeForModel(relationship, modelClass) {
    const foreignKey = relationship.getForeignKey()

    return modelClass.getColumnNameToAttributeNameMap()[foreignKey] || foreignKey
  }

  /**
   * Returns the FK attributes that bind a nested child to its parent.
   * @param {object} args - Parent-link inputs.
   * @param {import("../database/record/index.js").default} args.parent - Parent model instance.
   * @param {import("../database/record/relationships/base.js").default} args.relationship - Relationship metadata.
   * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
   * @returns {Record<string, string | number>} Attributes that scope the child to the parent.
   */
  _parentLinkAttributesForNestedChild({parent, relationship, targetModelClass}) {
    const foreignKey = this._foreignKeyAttributeForModel(relationship, targetModelClass)
    /** @type {Record<string, string | number>} */
    const attributes = {[foreignKey]: /** @type {string | number} */ (parent.id())}

    if (relationship.getPolymorphic()) {
      const typeAttribute = this._polymorphicTypeAttributeForModel(relationship, targetModelClass)

      attributes[typeAttribute] = parent.getModelClass().getModelName()
    }

    return attributes
  }

  /**
   * Converts a relationship's polymorphic type column/name to a child attribute name.
   * @param {import("../database/record/relationships/base.js").default} relationship - Relationship metadata.
   * @param {typeof import("../database/record/index.js").default} modelClass - Model class containing the type column.
   * @returns {string} Polymorphic type attribute name.
   */
  _polymorphicTypeAttributeForModel(relationship, modelClass) {
    const typeColumn = relationship.getPolymorphicTypeColumn()

    return modelClass.getColumnNameToAttributeNameMap()[typeColumn] || typeColumn
  }

  /**
   * Finds an authorized nested record by id without parent scoping.
   * @param {object} args - Lookup inputs.
   * @param {import("../authorization/ability.js").default | undefined} args.ability - Current ability.
   * @param {"update" | "destroy"} args.action - Frontend action.
   * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
   * @param {string | number} args.id - Child id from the payload.
   * @param {string} args.relationshipName - Parent's relationship name for error messages.
   * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
   * @returns {Promise<import("../database/record/index.js").default>} Authorized child model.
   */
  async _findNestedRecord({ability, action, childResourceConfiguration, id, relationshipName, targetModelClass}) {
    const primaryKey = targetModelClass.primaryKey()
    const query = ability
      ? targetModelClass.accessibleFor(this._resolveChildAbilityAction(childResourceConfiguration, action), ability)
      : targetModelClass.where({})
    const existing = await query.findBy({[primaryKey]: id})

    if (!existing) {
      throw new Error(`Cannot ${action} nested ${relationshipName}[id=${id}]: record not found or not authorized.`)
    }

    return existing
  }

  /**
   * Resolves the ability action for a child resource using the child's own
   * `abilities` mapping — never the parent controller's. This preserves
   * custom mappings like `{update: "manage"}` and catches unmapped actions
   * instead of silently defaulting to the raw action name.
   * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} childResourceConfiguration - Child resource configuration.
   * @param {"create" | "update" | "destroy"} action - Frontend action.
   * @returns {string} - Ability action for the child resource.
   */
  _resolveChildAbilityAction(childResourceConfiguration, action) {
    const abilities = childResourceConfiguration?.abilities

    if (!abilities || typeof abilities !== "object" || Array.isArray(abilities)) {
      throw new Error(`Nested child resource must define an 'abilities' object to authorize nested ${action}.`)
    }

    const abilityAction = /** @type {Record<string, string>} */ (abilities)[action]

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
   * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
   * @param {string | number} args.id - Child id from the payload.
   * @param {import("../database/record/index.js").default} args.parent - Parent model instance.
   * @param {Record<string, string | number>} args.parentLinkAttributes - Attributes that scope the child to the parent.
   * @param {string} args.relationshipName - Parent's relationship name (for error messages).
   * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
   * @returns {Promise<import("../database/record/index.js").default>} - Authorized, parent-linked child model.
   */
  async _findScopedChild({ability, action, childResourceConfiguration, id, parent, parentLinkAttributes, relationshipName, targetModelClass}) {
    const primaryKey = targetModelClass.primaryKey()
    const lookup = {[primaryKey]: id, ...parentLinkAttributes}
    const query = ability
      ? targetModelClass.accessibleFor(this._resolveChildAbilityAction(childResourceConfiguration, action), ability)
      : targetModelClass.where({})

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
   * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
   * @param {string} args.relationshipName - Parent's relationship name (for error messages).
   * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
   * @returns {Promise<void>}
   */
  async _authorizeCreatedChild({ability, child, childResourceConfiguration, relationshipName, targetModelClass}) {
    if (!ability) return

    const abilityAction = this._resolveChildAbilityAction(childResourceConfiguration, "create")
    const primaryKey = targetModelClass.primaryKey()
    const authorizedIds = await targetModelClass
      .accessibleFor(abilityAction, ability)
      .where({[primaryKey]: child.readAttribute(primaryKey)})
      .pluck(primaryKey)

    if (authorizedIds.length === 0) {
      throw new Error(`Nested create on ${relationshipName}[${targetModelClass.name}] not authorized.`)
    }
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
      await model.loadRelationship(relationshipName)
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
  /** @type {string[]} */
  const attributes = []
  /** @type {Record<string, {attributes: string[], nested: Record<string, ?>}>} */
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
 * Locates which prototype owns a method implementation.
 * @param {object} instance - Instance receiving the method.
 * @param {string} methodName - Method name.
 * @returns {object | null} - Prototype that owns the method.
 */
function prototypeOwnerForMethod(instance, methodName) {
  let prototype = Object.getPrototypeOf(instance)

  while (prototype) {
    if (Object.prototype.hasOwnProperty.call(prototype, methodName)) return prototype

    prototype = Object.getPrototypeOf(prototype)
  }

  return null
}

/**
 * Runs filter writable frontend model attributes.
 * @param {Record<string, ?>} receiver - Model instance or prototype.
 * @param {WritableAttributeReceiverClass} receiverClass - Static helper owner for the receiver.
 * @param {Record<string, ?>} attributes - Incoming frontend-model attributes.
 * @param {FrontendModelBaseResource | null} [resource] - Resource instance for virtual-setter detection.
 * @param {string[] | null} [permittedAttributeNames] - Optional explicit permit list. `null` falls back to setter-existence checks only.
 * @returns {Record<string, ?>} - Writable attributes only.
 */
function filterWritableFrontendModelAttributes(
  receiver,
  receiverClass,
  attributes,
  resource = /** @type {FrontendModelBaseResource | null} */ (null),
  permittedAttributeNames = null
) {
  // Frontend-model writes should fail fast when callers submit read-only or unknown attrs.
  // Silent drops hide contract mistakes in generated models and app-side wrapper code.
  /** @type {Record<string, ?>} */
  const writableAttributes = {}
  /** @type {string[]} */
  const invalidAttributes = []
  /** @type {string[]} */
  const notPermittedAttributes = []

  const permitSet = Array.isArray(permittedAttributeNames) ? new Set(permittedAttributeNames) : null
  /** @type {string[]} */
  let translatedAttributes = []

  if (resource) {
    const ResourceClass = /** @type {typeof FrontendModelBaseResource} */ (resource.constructor)

    translatedAttributes = ResourceClass.translatedAttributesConfig() || []
  }

  const translatedSet = new Set(translatedAttributes)

  for (const [attributeName, value] of Object.entries(attributes)) {
    if (permitSet && !permitSet.has(attributeName)) {
      notPermittedAttributes.push(attributeName)
      continue
    }

    const resolvedAttributeName = receiverClass.resolveAttributeName(attributeName) || attributeName
    const requestedSetterName = `set${inflection.camelize(resolvedAttributeName)}`
    const setterName = receiverClass.findMemberNameInsensitive(receiver, requestedSetterName) || requestedSetterName
    const resourceSetterName = `set${inflection.camelize(attributeName)}Attribute`
    const resourceSetter = resource?.resourceMethod(resourceSetterName)

    if (setterName in receiver) {
      writableAttributes[attributeName] = value
    } else if (resourceSetter) {
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
