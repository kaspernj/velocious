// @ts-check

import Configuration from "../configuration.js"
import Logger from "../logger.js"
import restArgsError from "../utils/rest-args-error.js"

import {declaredSyncScopeAttributes} from "./sync-scope-attributes.js"
import {deliverDeclaredBroadcasts, upsertSyncRow} from "./sync-change-fanout.js"
import {isPublishingSuppressed} from "./sync-publish-suppression.js"
import {VELOCIOUS_SYNC_CHANNEL} from "./sync-channel-name.js"

/** @type {{create: "afterCreate", update: "afterUpdate", destroy: "afterDestroy"}} */
const PUBLISHED_CALLBACK_NAMES = {create: "afterCreate", destroy: "afterDestroy", update: "afterUpdate"}

/**
 * Operations published by default for models declaring `static sync` publish
 * without an `operations` key: server-side creates and updates publish
 * automatically. Destroys are not published by default because a server
 * destroy is often cleanup rather than a synced delete; opt in with an
 * operations list.
 * @type {Array<"create" | "update" | "destroy">} */
const DEFAULT_PUBLISHED_OPERATIONS = ["create", "update"]

/** @type {WeakMap<Configuration, SyncPublisher>} */
const startedPublishersByConfiguration = new WeakMap()

/**
 * Declarative server-side sync publisher — the server mirror of the client's
 * track-by-default mutation tracking.
 *
 * Server models declare what to publish through `static sync`'s `publish`
 * key, and Velocious writes every committed server-side change to the sync
 * change feed (model-backed Sync-row upsert with server re-sequencing) and
 * broadcasts the standard sync envelope (`{echoOrigin, syncs: [...]}`) on the
 * framework sync channel ({@link VELOCIOUS_SYNC_CHANNEL}) scoped by the
 * change's derived scope-partition values, so devices receive server-origin
 * changes without app code declaring channels or calling manual
 * upsert/broadcast helpers:
 *
 *     static sync = {publish: true} // default payload (attributes) + default scope partition
 *     static sync = {publish: {serialize: (record) => ({id: record.id(), pin: record.pin()})}}
 *
 * The scope partition comes from the sync model's `static
 * syncScopeAttributes` declaration (for example `["eventId"]` or
 * `["accountId"]` — Velocious has no built-in partition name): each declared
 * scope attribute reads the record's attribute of the same name when the
 * model has one, else the record's own id (scope-root models), overridable
 * per model through `publish: {scopeAttributes: {accountId: "ownerId"}}`.
 * The pre-framework-channel `broadcasts` list and the `eventId`
 * string/resolver-function declaration forms keep working but are deprecated.
 *
 * Replayed device mutations never double-publish: the framework's routed
 * replay apply marks its written records through `markServerApply(record)`
 * (see sync-publish-suppression.js), and app code applying already-synced
 * data can use `markServerApply`/`withoutPublishing` the same way.
 */
export default class SyncPublisher {
  /**
   * Builds the sync publisher by deriving published resources from the
   * configuration's registered models: every model declaring `static sync`
   * with a `publish` declaration becomes a published resource
   * (`publish: false` opts out). The sync/change model is the registered
   * "Sync" model and broadcasts default to the configuration's channel
   * broadcast.
   * @param {import("./sync-publisher-types.js").SyncPublisherOptions} [options] - Optional overrides.
   */
  constructor(options = {}) {
    const {actorForeignKeyColumn = "authentication_token_id", broadcaster, configuration = Configuration.current(), onError, syncModel, ...restOptions} = options

    restArgsError(restOptions)

    const modelClasses = configuration.getModelClasses()
    const publishingModelClasses = Object.values(modelClasses).filter((modelClass) => publishDeclarationFor(modelClass))

    if (publishingModelClasses.length === 0) {
      throw new Error("SyncPublisher found no registered models declaring static sync publish - declare `static sync = {publish: {serialize}}` on the models whose server-side changes should publish to the sync feed")
    }

    const resolvedSyncModel = syncModel || modelClasses.Sync

    if (!resolvedSyncModel) {
      throw new Error("SyncPublisher requires a registered \"Sync\" model for published sync change rows (or pass options.syncModel)")
    }

    const scopeAttributes = declaredSyncScopeAttributes(resolvedSyncModel)
    /** @type {Record<string, import("./sync-publisher-types.js").SyncPublisherResourceConfig>} */
    const resources = {}

    for (const modelClass of publishingModelClasses) {
      const publish = publishDeclarationFor(modelClass)
      const resourceConfig = resourceConfigFromPublishDeclaration({modelClass, publish, scopeAttributes, syncModel: resolvedSyncModel})

      resources[resourceConfig.resourceType] = resourceConfig
    }

    /** @type {{actorForeignKeyColumn: string, broadcaster: import("./sync-publisher-types.js").SyncPublisherOptions["broadcaster"], configuration: Configuration, onError: import("./sync-publisher-types.js").SyncPublisherOptions["onError"], resources: Record<string, import("./sync-publisher-types.js").SyncPublisherResourceConfig>, syncModel: ?}} */
    this.config = {actorForeignKeyColumn, broadcaster, configuration, onError, resources, syncModel: resolvedSyncModel}
    /** @type {Array<{callback: (record: ?) => Promise<void>, callbackName: "afterCreate" | "afterUpdate" | "afterDestroy", modelClass: ?}>} */
    this._publishedCallbacks = []
    /** @type {Logger | null} */
    this._logger = null
    this._started = false
  }

  /**
   * Builds a sync publisher derived from the given configuration. Alias for
   * `new SyncPublisher({configuration, ...options})`.
   * @param {Configuration} [configuration] - Configuration owning the registered models. Defaults to the current configuration.
   * @param {Omit<import("./sync-publisher-types.js").SyncPublisherOptions, "configuration">} [options] - Optional overrides.
   * @returns {SyncPublisher} Sync publisher derived from the configuration.
   */
  static fromConfiguration(configuration = Configuration.current(), options = {}) {
    return new SyncPublisher({...options, configuration})
  }

  /**
   * Starts (and memoizes per configuration) the sync publisher for a server
   * boot: no-op when no registered model declares a publish config, guarded so
   * repeated boots with the same configuration register the publish callbacks
   * only once.
   * @param {Configuration} configuration - Configuration owning the registered models.
   * @returns {Promise<SyncPublisher | null>} Started publisher, or null when no models declare publish.
   */
  static async startFromConfiguration(configuration) {
    const startedPublisher = startedPublishersByConfiguration.get(configuration)

    if (startedPublisher) return startedPublisher

    if (!Object.values(configuration.getModelClasses()).some((modelClass) => publishDeclarationFor(modelClass))) return null

    const publisher = new SyncPublisher({configuration})

    startedPublishersByConfiguration.set(configuration, publisher)
    await publisher.start()

    return publisher
  }

  /**
   * Registers the publish callbacks for every published resource: server-side
   * creates and updates (destroys when opted in) upsert a sync change row and
   * fan out the declared broadcasts once their transaction commits.
   * @returns {Promise<void>}
   */
  async start() {
    if (this._started) return

    this._started = true

    for (const resourceConfig of Object.values(this.config.resources)) {
      for (const operation of resourceConfig.operations) {
        const callbackName = PUBLISHED_CALLBACK_NAMES[operation]
        const callback = this.publishedMutationCallback({operation, resourceConfig})

        resourceConfig.modelClass[callbackName](callback)
        this._publishedCallbacks.push({callback, callbackName, modelClass: resourceConfig.modelClass})
      }
    }
  }

  /**
   * Unregisters all publish callbacks (tests, shutdown).
   * @returns {void}
   */
  stop() {
    for (const {callback, callbackName, modelClass} of this._publishedCallbacks) {
      modelClass.unregisterLifecycleCallback(callbackName, callback)
    }

    this._publishedCallbacks = []
    this._started = false
  }

  /**
   * Builds the lifecycle callback publishing one server-side mutation. The
   * published payload (declaration `serialize`), event scope, and sync type
   * are snapshotted at mutation-callback time, so afterSave hooks assigning
   * unsaved attributes (or any later drift on the record) cannot change what
   * gets published vs what was committed. Persisting and broadcasting are
   * deferred through the model connection's afterCommit hook so they only run
   * once the mutation's transaction has committed (immediately when no
   * transaction is open) - rolled-back mutations never publish. Post-commit
   * publish failures are reported without rethrowing into the driver's
   * afterCommit chain (see reportAfterCommitError).
   * @param {{operation: "create" | "update" | "destroy", resourceConfig: import("./sync-publisher-types.js").SyncPublisherResourceConfig}} args - Operation and resource config.
   * @returns {(record: ?) => Promise<void>} Lifecycle callback.
   */
  publishedMutationCallback({operation, resourceConfig}) {
    return async (record) => {
      if (isPublishingSuppressed(record)) return

      const data = await resourceConfig.serialize(record)
      const resourceId = String(record.id())
      const syncType = operation === "destroy" ? "delete" : "update"
      const scopeValues = await this.publishedScopeValues({record, resourceConfig})
      /** @type {Record<string, ?>} */
      const attributes = {
        [this.config.actorForeignKeyColumn]: null,
        client_updated_at: new Date(),
        data: JSON.stringify(data),
        resource_id: resourceId,
        resource_type: resourceConfig.resourceType,
        sync_type: syncType,
        ...scopeValues.columns
      }

      await resourceConfig.modelClass.connection().afterCommit(async () => {
        try {
          const syncRow = await this.upsertPublishedSyncRow(attributes)

          await this.broadcaster()({
            body: {
              echoOrigin: null,
              syncs: [{data, resourceId, resourceType: resourceConfig.resourceType, syncType}]
            },
            channel: VELOCIOUS_SYNC_CHANNEL,
            params: {...scopeValues.params, resourceType: resourceConfig.resourceType}
          })

          if (resourceConfig.broadcasts) {
            await deliverDeclaredBroadcasts({
              args: {data, operation, record, resourceId, resourceType: resourceConfig.resourceType, syncRow, syncType},
              broadcaster: this.broadcaster(),
              broadcasts: resourceConfig.broadcasts
            })
          }
        } catch (error) {
          await this.reportAfterCommitError(/** @type {Error} */ (error))
        }
      })
    }
  }

  /**
   * Resolves the scope-partition values for one published mutation from the
   * resource's derived scope plan: each entry reads its record attribute (or
   * the record's own id for scope-root models, or the deprecated resolver
   * function). The values are persisted onto the sync row's partition columns
   * and broadcast as the framework sync channel's scoping params.
   * @param {{record: ?, resourceConfig: import("./sync-publisher-types.js").SyncPublisherResourceConfig}} args - Mutated record and resource config.
   * @returns {Promise<{columns: Record<string, string | null>, params: Record<string, string | null>}>} Scope values keyed by sync-row column and by scope attribute.
   */
  async publishedScopeValues({record, resourceConfig}) {
    /** @type {Record<string, string | null>} */
    const columns = {}
    /** @type {Record<string, string | null>} */
    const params = {}

    for (const scopePlanEntry of resourceConfig.scopePlan) {
      /** @type {?} */
      let rawValue

      if (scopePlanEntry.resolver) {
        rawValue = await scopePlanEntry.resolver(record)
      } else if (scopePlanEntry.recordAttribute) {
        rawValue = record.readAttribute(scopePlanEntry.recordAttribute)
      } else {
        rawValue = record.id()
      }

      const value = rawValue === undefined || rawValue === null ? null : String(rawValue)

      columns[scopePlanEntry.columnName] = value
      params[scopePlanEntry.scopeAttribute] = value
    }

    return {columns, params}
  }

  /**
   * Upserts the published server-origin sync row for a resource identity:
   * server-origin rows carry a null actor column (no device to echo the
   * change back to), so repeated server changes to one resource reuse and
   * re-sequence one feed row.
   * @param {Record<string, ?>} attributes - Snapshotted sync row attributes.
   * @returns {Promise<?>} Upserted sync row.
   */
  async upsertPublishedSyncRow(attributes) {
    const existingSync = await this.config.syncModel
      .where({
        [this.config.actorForeignKeyColumn]: null,
        resource_id: attributes.resource_id,
        resource_type: attributes.resource_type
      })
      .first()

    return await upsertSyncRow({attributes, existingSync, syncModel: this.config.syncModel})
  }

  /**
   * Returns the broadcaster delivering declared broadcasts: the injected one,
   * or the configuration's channel broadcast awaited through the pending
   * broadcast queue.
   * @returns {NonNullable<import("./sync-publisher-types.js").SyncPublisherOptions["broadcaster"]>} Broadcast deliverer.
   */
  broadcaster() {
    if (this.config.broadcaster) return this.config.broadcaster

    return async ({body, channel, params}) => {
      this.config.configuration.broadcastToChannel(channel, params, body)
      await this.config.configuration.awaitPendingBroadcasts()
    }
  }

  /**
   * Reports a post-commit publish failure. The transaction has already
   * committed when afterCommit callbacks run, so rethrowing here would poison
   * the driver's awaited afterCommit chain (breaking unrelated callbacks) -
   * instead the failure goes to the configured onError hook, or is emitted on
   * the configuration's framework-error/all-error channels (so production bug
   * reporting via `configuration.getErrorEvents()` sees a broken publish
   * path) and logged loudly through the publisher's logger when none is
   * configured.
   * @param {Error} error - Post-commit publish failure.
   * @returns {Promise<void>}
   */
  async reportAfterCommitError(error) {
    if (this.config.onError) {
      this.config.onError(error)

      return
    }

    const errorEvents = this.config.configuration.getErrorEvents()
    const payload = {context: {stage: "sync-publish-after-commit"}, error}

    errorEvents.emit("framework-error", payload)
    errorEvents.emit("all-error", {...payload, errorType: "framework-error"})

    await this.logger().error("SyncPublisher failed to publish a server-side sync change after commit", error)
  }

  /**
   * Returns the lazily built publisher logger.
   * @returns {Logger} Publisher logger.
   */
  logger() {
    this._logger ||= new Logger("SyncPublisher", {configuration: this.config.configuration})

    return this._logger
  }
}

/**
 * Resolves a model class's active publish declaration from `static sync`.
 * Opted-out (`publish: false`) and undeclared models resolve to null; every
 * other declared value flows into loud declaration validation.
 * @param {?} modelClass - Registered model class.
 * @returns {import("./sync-publisher-types.js").SyncPublishDeclaration | null} Active publish declaration, or null.
 */
function publishDeclarationFor(modelClass) {
  const declaration = modelClass.sync

  if (!declaration || typeof declaration !== "object" || declaration.publish === undefined || declaration.publish === false) return null

  return declaration.publish
}

/**
 * Builds one published resource config from a model's `static sync` publish
 * declaration. `publish: true` opts in with all defaults (attribute payload,
 * derived scope partition, created/updated operations).
 * @param {{modelClass: ?, publish: import("./sync-publisher-types.js").SyncPublishDeclaration | null, scopeAttributes: string[] | null, syncModel: ?}} args - Declaration args plus the sync model's declared scope attributes.
 * @returns {import("./sync-publisher-types.js").SyncPublisherResourceConfig} Derived resource config.
 */
function resourceConfigFromPublishDeclaration({modelClass, publish, scopeAttributes: syncScopeAttributes, syncModel}) {
  const modelName = modelClass.getModelName()
  const normalizedPublish = publish === true ? {} : publish

  if (!normalizedPublish || typeof normalizedPublish !== "object" || Array.isArray(normalizedPublish)) {
    throw new Error(`${modelName} static sync publish must be true, false or a publish declaration object, got: ${String(publish)}`)
  }

  const {broadcasts, eventId, operations, resourceType, scopeAttributes, serialize, ...restDeclaration} = normalizedPublish
  const unknownKeys = Object.keys(restDeclaration)

  if (unknownKeys.length > 0) {
    throw new Error(`${modelName} static sync publish received unknown keys: ${unknownKeys.join(", ")} (supported: broadcasts, eventId (deprecated), operations, resourceType, scopeAttributes, serialize)`)
  }
  if (serialize !== undefined && typeof serialize !== "function") {
    throw new Error(`${modelName} static sync publish serialize must be a function building the published payload, got: ${String(serialize)}`)
  }
  if (operations !== undefined) {
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new Error(`${modelName} static sync publish operations must be a non-empty array of create/update/destroy`)
    }

    for (const operation of operations) {
      if (!(operation in PUBLISHED_CALLBACK_NAMES)) {
        throw new Error(`${modelName} static sync publish operations must be create/update/destroy, got: ${String(operation)}`)
      }
    }
  }

  return {
    broadcasts,
    modelClass,
    operations: operations === undefined ? DEFAULT_PUBLISHED_OPERATIONS : operations,
    resourceType: resourceType === undefined ? modelName : resourceType,
    scopePlan: scopePlanFor({eventId, modelClass, modelName, scopeAttributes, syncModel, syncScopeAttributes}),
    serialize: serialize === undefined ? defaultSerializedAttributes : serialize
  }
}

/**
 * Derives the scope plan partitioning a published model's changes: one entry
 * per scope attribute declared on the sync model (`static
 * syncScopeAttributes`), each reading the record attribute named like the
 * scope attribute (overridable through the declaration's `scopeAttributes`
 * name map), or the record's own id when the model has no such attribute
 * (scope-root models). The deprecated `eventId` declaration forms map to a
 * fixed `eventId`/`event_id` plan for 1.0.503 compatibility.
 * @param {{eventId: import("./sync-publisher-types.js").SyncPublishDeclarationConfig["eventId"], modelClass: ?, modelName: string, scopeAttributes: Record<string, string> | undefined, syncModel: ?, syncScopeAttributes: string[] | null}} args - Declaration and sync-model scope args.
 * @returns {Array<import("./sync-publisher-types.js").SyncPublisherScopePlanEntry>} Derived scope plan.
 */
function scopePlanFor({eventId, modelClass, modelName, scopeAttributes, syncModel, syncScopeAttributes}) {
  const attributeNames = Object.values(modelClass.getColumnNameToAttributeNameMap())

  if (eventId !== undefined) {
    if (scopeAttributes !== undefined) {
      throw new Error(`${modelName} static sync publish can't declare both scopeAttributes and the deprecated eventId form`)
    }
    if (typeof eventId === "function") {
      return [{columnName: "event_id", recordAttribute: null, resolver: eventId, scopeAttribute: "eventId"}]
    }
    if (typeof eventId !== "string") {
      throw new Error(`${modelName} static sync publish eventId must be an attribute-name string (or a deprecated resolver function), got: ${String(eventId)}`)
    }
    if (!attributeNames.includes(eventId)) {
      throw new Error(`${modelName} static sync publish eventId attribute doesn't exist on the model: ${eventId}`)
    }

    return [{columnName: "event_id", recordAttribute: eventId, resolver: undefined, scopeAttribute: "eventId"}]
  }

  if (scopeAttributes !== undefined && !syncScopeAttributes) {
    throw new Error(`${modelName} static sync publish declares scopeAttributes but the sync model declares no static syncScopeAttributes`)
  }

  if (!syncScopeAttributes) return []

  if (scopeAttributes !== undefined && (typeof scopeAttributes !== "object" || Array.isArray(scopeAttributes))) {
    throw new Error(`${modelName} static sync publish scopeAttributes must be an object mapping scope attributes to record attribute names, got: ${String(scopeAttributes)}`)
  }

  for (const scopeAttribute of Object.keys(scopeAttributes || {})) {
    if (!syncScopeAttributes.includes(scopeAttribute)) {
      throw new Error(`${modelName} static sync publish scopeAttributes received unknown scope attribute: ${scopeAttribute} (the sync model declares: ${syncScopeAttributes.join(", ")})`)
    }
  }

  return syncScopeAttributes.map((scopeAttribute) => {
    const declaredRecordAttribute = scopeAttributes?.[scopeAttribute]

    if (declaredRecordAttribute !== undefined) {
      if (typeof declaredRecordAttribute !== "string" || !attributeNames.includes(declaredRecordAttribute)) {
        throw new Error(`${modelName} static sync publish scopeAttributes.${scopeAttribute} must name an existing record attribute, got: ${String(declaredRecordAttribute)}`)
      }

      return {columnName: syncScopeColumnName({scopeAttribute, syncModel}), recordAttribute: declaredRecordAttribute, resolver: undefined, scopeAttribute}
    }

    return {
      columnName: syncScopeColumnName({scopeAttribute, syncModel}),
      recordAttribute: attributeNames.includes(scopeAttribute) ? scopeAttribute : null,
      resolver: undefined,
      scopeAttribute
    }
  })
}

/**
 * Resolves the sync-row column persisting a declared scope attribute.
 * @param {{scopeAttribute: string, syncModel: ?}} args - Scope attribute and sync model.
 * @returns {string} Sync-row column name.
 */
function syncScopeColumnName({scopeAttribute, syncModel}) {
  const columnName = syncModel.getAttributeNameToColumnNameMap()[scopeAttribute]

  if (!columnName) {
    throw new Error(`${syncModel.name} declares the sync scope attribute ${scopeAttribute} but has no matching column for it`)
  }

  return columnName
}

/**
 * Default publish serializer: the record's attributes with Date values
 * serialized to ISO strings.
 * @param {?} record - Mutated server model record.
 * @returns {Record<string, ?>} Serialized attributes payload.
 */
function defaultSerializedAttributes(record) {
  /** @type {Record<string, ?>} */
  const attributes = {...record.attributes()}

  for (const [attributeName, value] of Object.entries(attributes)) {
    if (value instanceof Date) attributes[attributeName] = value.toISOString()
  }

  return attributes
}
