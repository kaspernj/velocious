// @ts-check

import Configuration from "../configuration.js"
import Logger from "../logger.js"
import restArgsError from "../utils/rest-args-error.js"

import {deliverDeclaredBroadcasts, upsertSyncRow} from "./sync-change-fanout.js"
import {isPublishingSuppressed} from "./sync-publish-suppression.js"

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
 * fans out the declared broadcasts, so devices receive server-origin changes
 * without app code calling manual upsert/broadcast helpers:
 *
 *     static sync = {
 *       publish: {
 *         serialize: (event) => ({id: event.id(), eventPin: event.eventPin()}),
 *         eventId: (event) => event.id(),
 *         broadcasts: [{channel: "ticket-scans", broadcastParams: ..., body: ...}]
 *       }
 *     }
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
    /** @type {Record<string, import("./sync-publisher-types.js").SyncPublisherResourceConfig>} */
    const resources = {}

    for (const modelClass of Object.values(modelClasses)) {
      const publish = publishDeclarationFor(modelClass)

      if (!publish) continue

      const resourceConfig = resourceConfigFromPublishDeclaration({modelClass, publish})

      resources[resourceConfig.resourceType] = resourceConfig
    }

    if (Object.keys(resources).length === 0) {
      throw new Error("SyncPublisher found no registered models declaring static sync publish - declare `static sync = {publish: {serialize}}` on the models whose server-side changes should publish to the sync feed")
    }

    const resolvedSyncModel = syncModel || modelClasses.Sync

    if (!resolvedSyncModel) {
      throw new Error("SyncPublisher requires a registered \"Sync\" model for published sync change rows (or pass options.syncModel)")
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
      /** @type {Record<string, ?>} */
      const attributes = {
        [this.config.actorForeignKeyColumn]: null,
        client_updated_at: new Date(),
        data: JSON.stringify(data),
        resource_id: resourceId,
        resource_type: resourceConfig.resourceType,
        sync_type: syncType
      }

      if (resourceConfig.eventId) {
        const eventId = await resourceConfig.eventId(record)

        attributes.event_id = eventId === undefined || eventId === null ? null : String(eventId)
      }

      await resourceConfig.modelClass.connection().afterCommit(async () => {
        try {
          const syncRow = await this.upsertPublishedSyncRow(attributes)

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
   * instead the failure goes to the configured onError hook, or is logged
   * loudly through the publisher's logger when none is configured.
   * @param {Error} error - Post-commit publish failure.
   * @returns {Promise<void>}
   */
  async reportAfterCommitError(error) {
    if (this.config.onError) {
      this.config.onError(error)

      return
    }

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
 * @returns {import("./sync-publisher-types.js").SyncPublishDeclarationConfig | null} Active publish declaration, or null.
 */
function publishDeclarationFor(modelClass) {
  const declaration = modelClass.sync

  if (!declaration || typeof declaration !== "object" || declaration.publish === undefined || declaration.publish === false) return null

  return declaration.publish
}

/**
 * Builds one published resource config from a model's `static sync` publish
 * declaration.
 * @param {{modelClass: ?, publish: import("./sync-publisher-types.js").SyncPublishDeclarationConfig}} args - Declaration args.
 * @returns {import("./sync-publisher-types.js").SyncPublisherResourceConfig} Derived resource config.
 */
function resourceConfigFromPublishDeclaration({modelClass, publish}) {
  const modelName = modelClass.getModelName()

  if (!publish || typeof publish !== "object" || Array.isArray(publish)) {
    throw new Error(`${modelName} static sync publish must be false or a publish declaration object, got: ${String(publish)}`)
  }

  const {broadcasts, eventId, operations, resourceType, serialize, ...restDeclaration} = publish
  const unknownKeys = Object.keys(restDeclaration)

  if (unknownKeys.length > 0) {
    throw new Error(`${modelName} static sync publish received unknown keys: ${unknownKeys.join(", ")} (supported: broadcasts, eventId, operations, resourceType, serialize)`)
  }
  if (typeof serialize !== "function") {
    throw new Error(`${modelName} static sync publish requires a serialize(record) function building the published payload`)
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
    eventId,
    modelClass,
    operations: operations === undefined ? DEFAULT_PUBLISHED_OPERATIONS : operations,
    resourceType: resourceType === undefined ? modelName : resourceType,
    serialize
  }
}
