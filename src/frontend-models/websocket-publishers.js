// @ts-check

import AuthorizationBaseResource from "../authorization/base-resource.js"
import {frontendModelResourcesWithBuiltInsForBackendProject} from "./built-in-resources.js"
import {frontendModelResourceDefinitionIsClass} from "./resource-definition.js"
import {serializeFrontendModelTransportValue} from "./transport-serialization.js"
import {modelPrimaryKeyCacheKey, readModelPrimaryKeyValue} from "../utils/model-primary-key.js"

/** @typedef {{primaryKey: import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition}} FrontendModelPublisherResource */
/** @typedef {Record<string, import("./query.js").FrontendModelTransportValue>} FrontendModelDestroyAuthorizationRecord */
/** @typedef {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update", __frontendModelWebsocketDestroyAuthorizationRecord?: FrontendModelDestroyAuthorizationRecord, __frontendModelWebsocketPreviousIds?: Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>}} FrontendModelWebsocketRecord */

const modelClassesWithRegisteredHooks = new WeakSet()
const channelClassRegisteredConfigurations = new WeakSet()
/** @type {WeakMap<import("../configuration.js").default, WeakMap<typeof import("../database/record/index.js").default, Map<string, FrontendModelPublisherResource>>>} */
const publisherResourcesByConfiguration = new WeakMap()

/** Shared channel name for all frontend-model lifecycle subscriptions. */
export const FRONTEND_MODELS_CHANNEL_NAME = "frontend-models"

/**
 * Runs transport serialization options for a configuration.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @returns {import("./transport-serialization.js").FrontendModelTransportSerializationOptions} - Serialization options.
 */
function transportSerializationOptionsForConfiguration(configuration) {
  return {
    timeZone: configuration.getEnvironmentHandler().getTimeZone(configuration)
  }
}

/**
 * Runs the frontendModelBroadcastChannelName helper.
 * @param {string} modelName - Model class name.
 * @returns {string} - Broadcast channel name (legacy, retained for migration compatibility).
 */
export function frontendModelBroadcastChannelName(modelName) {
  return `frontend-models:${modelName}`
}

/**
 * Runs frontend model resources from ability resources list.
 * @param {import("../configuration-types.js").AbilityResourceClassType[]} abilityResources - Ability resource classes.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} - Resource definitions keyed by model name.
 */
function frontendModelResourcesFromAbilityResourcesList(abilityResources) {
  /**
   * Resources.
   * @type {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} */
  const resources = {}

  if (!Array.isArray(abilityResources)) {
    throw new Error(`Expected ability resources to be an array but got: ${typeof abilityResources}`)
  }

  if (abilityResources.length === 0) return resources

  for (const resourceClass of abilityResources) {
    if (typeof resourceClass !== "function") {
      throw new Error(`Expected ability resource to be a class but got: ${typeof resourceClass}`)
    }

    if (frontendModelResourceDefinitionIsClass(resourceClass)) {
      // An abstract base resource (no static ModelClass — e.g. an app's shared
      // `BaseResource` that other resources extend) backs no model, so it isn't a
      // publishable frontend model. Skip it instead of letting `modelClass()`
      // throw `requires a static ModelClass` during ability-resource discovery.
      if (!resourceClass.ModelClass) continue

      const modelName = resourceClass.resourceConfig().modelName || resourceClass.modelClass().getModelName()

      resources[modelName] = resourceClass
    } else if (resourceClass.prototype instanceof AuthorizationBaseResource) {
      // Authorization-only resource — valid but not relevant for WebSocket publishing
    } else {
      throw new Error(`Unexpected ability resource class: ${resourceClass.name}. Expected AuthorizationBaseResource or FrontendModelBaseResource subclass.`)
    }
  }

  return resources
}

/**
 * Runs the ensureFrontendModelWebsocketPublishersRegistered helper.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @returns {Promise<void>}
 */
export async function ensureFrontendModelWebsocketPublishersRegistered(configuration) {
  /**
   * All frontend models.
   * @type {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} */
  let allFrontendModels = {}

  for (const backendProject of configuration.getBackendProjects()) {
    const projectResources = frontendModelResourcesWithBuiltInsForBackendProject(backendProject)

    allFrontendModels = {...allFrontendModels, ...projectResources}
  }

  // Always merge the ability resolver's resource list too. A project can expose some
  // resources as discoverable `src/resources/*.js` files (configured or auto-discovered)
  // and others only through `getAbilityResources()`; both sets need lifecycle publishers,
  // so resource discovery must not suppress this list.
  const abilityResources = configuration.getAbilityResources()

  allFrontendModels = {
    ...allFrontendModels,
    ...frontendModelResourcesFromAbilityResourcesList(abilityResources)
  }

  // Phase 3: register the V2 channel class once per configuration so
  // `subscribeChannel("frontend-models", {params: {model}})` finds it.
  // Dynamic import keeps server-only WebsocketRequest + Node utilities
  // out of browser bundles that transitively pull in this module via
  // configuration → logger.
  if (!channelClassRegisteredConfigurations.has(configuration)) {
    channelClassRegisteredConfigurations.add(configuration)
    const {default: FrontendModelWebsocketChannel} = await import("./websocket-channel.js")

    configuration.registerWebsocketChannel(FRONTEND_MODELS_CHANNEL_NAME, FrontendModelWebsocketChannel)
  }

  for (const [modelName, resourceClass] of Object.entries(allFrontendModels)) {
    // An abstract base resource (no static ModelClass — e.g. an app's shared
    // `BaseResource` that other resources extend) backs no model, so there is
    // nothing to publish realtime events for. Skip it instead of throwing.
    if (!resourceClass.ModelClass) continue

    const modelClass = resourceClass.modelClass()
    const resourceConfiguration = resourceClass.resourceConfig()
    const configuredPrimaryKey = resourceConfiguration.primaryKey
    const modelPrimaryKey = modelClass.primaryKey()
    const primaryKey = configuredPrimaryKey || (Array.isArray(modelPrimaryKey)
      ? modelPrimaryKey.map((columnName) => modelClass.resolveAttributeName(columnName) || columnName)
      : modelClass.resolveAttributeName(modelPrimaryKey) || modelPrimaryKey)
    let publisherResourcesByModelClass = publisherResourcesByConfiguration.get(configuration)

    if (!publisherResourcesByModelClass) {
      publisherResourcesByModelClass = new WeakMap()
      publisherResourcesByConfiguration.set(configuration, publisherResourcesByModelClass)
    }

    let publisherResources = publisherResourcesByModelClass.get(modelClass)

    if (!publisherResources) {
      publisherResources = new Map()
      publisherResourcesByModelClass.set(modelClass, publisherResources)
    }

    publisherResources.set(modelName, {
      primaryKey
    })

    // Register lifecycle hooks once per model class, not per configuration. A model class belongs to a
    // single backend project/config in production, so per-config registration only differs in tests where
    // the same model class is reachable from multiple configs — there it attaches duplicate beforeCreate/
    // afterSave/afterDestroy hooks that double-fire broadcasts (and leak across specs). The hooks read the
    // model's runtime configuration when broadcasting, so a single registration is sufficient.
    if (modelClassesWithRegisteredHooks.has(modelClass)) continue

    modelClassesWithRegisteredHooks.add(modelClass)

    modelClass.beforeCreate((model) => {
      /** @type {FrontendModelWebsocketRecord} */ (model).__frontendModelWebsocketAction = "create"
    })

    modelClass.beforeUpdate(async (model) => {
      const websocketModel = /** @type {FrontendModelWebsocketRecord} */ (model)

      websocketModel.__frontendModelWebsocketAction = "update"
      websocketModel.__frontendModelWebsocketPreviousIds = await frontendModelPreviousResourceIdentities(model)
    })

    modelClass.beforeDestroy(async (model) => {
      const websocketModel = /** @type {FrontendModelWebsocketRecord} */ (model)
      const persistedModel = await model
        .queryForModel(model.getModelClass())
        .find(model._persistedPrimaryKeyValue())

      if (!persistedModel) throw new Error(`Cannot capture websocket destroy authorization for missing ${model.getModelClass().name}`)

      websocketModel.__frontendModelWebsocketPreviousIds = frontendModelResourceIdentities(persistedModel)
      websocketModel.__frontendModelWebsocketDestroyAuthorizationRecord = frontendModelDestroyAuthorizationRecord(persistedModel)
    })

    modelClass.afterSave((model) => {
      const modelWithWebsocketAction = /** @type {FrontendModelWebsocketRecord} */ (model)
      const action = modelWithWebsocketAction.__frontendModelWebsocketAction

      if (action !== "create" && action !== "update") return
      const previousIds = modelWithWebsocketAction.__frontendModelWebsocketPreviousIds

      void model.connection().afterCommit(async () => {
        broadcastFrontendModelEvents(model, action, previousIds)
      })
      delete modelWithWebsocketAction.__frontendModelWebsocketAction
      delete modelWithWebsocketAction.__frontendModelWebsocketPreviousIds
    })

    modelClass.afterDestroy((model) => {
      const websocketModel = /** @type {FrontendModelWebsocketRecord} */ (model)
      const destroyAuthorizationRecord = websocketModel.__frontendModelWebsocketDestroyAuthorizationRecord
      const previousIds = websocketModel.__frontendModelWebsocketPreviousIds

      void model.connection().afterCommit(async () => {
        broadcastFrontendModelEvents(model, "destroy", previousIds, destroyAuthorizationRecord)
      })
      delete websocketModel.__frontendModelWebsocketDestroyAuthorizationRecord
      delete websocketModel.__frontendModelWebsocketPreviousIds
    })
  }
}

/**
 * Returns every resource identity represented by the record before its pending changes or destruction.
 * @param {import("../database/record/index.js").default} model - Backing model before update or destroy.
 * @returns {Promise<Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>>} - Previous identities by resource name.
 */
async function frontendModelPreviousResourceIdentities(model) {
  const publisherResources = publisherResourcesByConfiguration.get(model._getConfiguration())?.get(model.getModelClass())
  /** @type {Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>} */
  const previousIds = new Map()

  if (!publisherResources) return previousIds

  for (const [modelName, {primaryKey}] of publisherResources) {
    const previousId = frontendModelResourceIdentity({model, previous: true, primaryKey})

    if (previousId !== null) previousIds.set(modelName, previousId)
  }

  if (previousIds.size === publisherResources.size) return previousIds

  const persistedModel = await model
    .queryForModel(model.getModelClass())
    .find(model._persistedPrimaryKeyValue())

  for (const [modelName, {primaryKey}] of publisherResources) {
    if (previousIds.has(modelName)) continue

    const persistedId = frontendModelResourceIdentity({model: persistedModel, primaryKey})

    if (persistedId !== null) previousIds.set(modelName, persistedId)
  }

  return previousIds
}

/**
 * Returns every configured resource identity represented by a persisted backing record.
 * @param {import("../database/record/index.js").default} model - Fully loaded persisted backing record.
 * @returns {Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>} - Identities by resource name.
 */
function frontendModelResourceIdentities(model) {
  const publisherResources = publisherResourcesByConfiguration.get(model._getConfiguration())?.get(model.getModelClass())
  /** @type {Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>} */
  const identities = new Map()

  if (!publisherResources) return identities

  for (const [modelName, {primaryKey}] of publisherResources) {
    const id = frontendModelResourceIdentity({model, primaryKey})

    if (id !== null) identities.set(modelName, id)
  }

  return identities
}

/**
 * Serializes the persisted record for server-side destroy authorization. Binary values
 * use a dedicated byte-array marker because the shared transport serializer otherwise
 * leaves Buffers to the JSON implementation used by the worker or Beacon transport.
 * @param {import("../database/record/index.js").default} model - Fully loaded persisted backing record.
 * @returns {FrontendModelDestroyAuthorizationRecord} - Column-keyed transport values.
 */
function frontendModelDestroyAuthorizationRecord(model) {
  const serializationOptions = transportSerializationOptionsForConfiguration(model._getConfiguration())
  /** @type {FrontendModelDestroyAuthorizationRecord} */
  const authorizationRecord = {}

  for (const [columnName, value] of Object.entries(model.rawAttributes())) {
    authorizationRecord[columnName] = value instanceof Uint8Array
      ? {__velociousDestroyAuthorizationType: "binary", value: Array.from(value)}
      : serializeFrontendModelTransportValue(value, serializationOptions)
  }

  if (Object.keys(authorizationRecord).length === 0) {
    throw new Error(`Cannot capture websocket destroy authorization without attributes for ${model.getModelClass().name}`)
  }

  return authorizationRecord
}

/**
 * Reads a resource identity only when every identity attribute was loaded on the backing record.
 * @param {object} args - Identity arguments.
 * @param {import("../database/record/index.js").default} args.model - Backing model.
 * @param {boolean} [args.previous] - Read values from before pending changes.
 * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition} args.primaryKey - Resource identity definition.
 * @returns {import("../utils/model-primary-key.js").ModelPrimaryKeyValue | null} - Complete identity or null when unavailable.
 */
function frontendModelResourceIdentity({model, previous = false, primaryKey}) {
  const attributes = model.attributes()
  const changes = model.changes()
  /** @type {Record<string, import("../utils/model-primary-key.js").ModelPrimaryKeyScalar>} */
  const identityAttributes = {}
  const primaryKeyAttributes = Array.isArray(primaryKey) ? primaryKey : [primaryKey]

  for (const attributeName of primaryKeyAttributes) {
    const columnName = model.getModelClass().getColumnNameForAttributeName(attributeName)
    let value

    if (previous && Object.hasOwn(changes, columnName)) {
      value = changes[columnName][0]
    } else {
      if (!Object.hasOwn(attributes, attributeName)) return null

      value = attributes[attributeName]
    }

    if (typeof value !== "string" && typeof value !== "number") return null

    identityAttributes[attributeName] = value
  }

  return readModelPrimaryKeyValue(primaryKey, (attributeName) => identityAttributes[attributeName])
}

/**
 * Fans one backing-record lifecycle event out through every configured frontend-resource identity.
 * @param {import("../database/record/index.js").default} model - Backing model instance.
 * @param {"create" | "update" | "destroy"} action - Lifecycle action.
 * @param {Map<string, import("../utils/model-primary-key.js").ModelPrimaryKeyValue>} [previousIds] - Persisted identities captured before update or destroy.
 * @param {FrontendModelDestroyAuthorizationRecord} [destroyAuthorizationRecord] - Server-only pre-delete row used to authorize a destroyed record.
 * @returns {void}
 */
function broadcastFrontendModelEvents(model, action, previousIds, destroyAuthorizationRecord) {
  const configuration = model._getConfiguration()
  const publisherResources = publisherResourcesByConfiguration.get(configuration)?.get(model.getModelClass())

  if (!publisherResources) return

  for (const [modelName, {primaryKey}] of publisherResources) {
    const previousId = previousIds?.get(modelName)
    const currentId = frontendModelResourceIdentity({model, primaryKey})
    const id = action === "destroy" ? previousId : currentId ?? previousId

    if (id === null || id === undefined) continue

    const identityChanged = action === "update"
      && currentId !== null
      && previousId !== undefined
      && modelPrimaryKeyCacheKey(primaryKey, previousId) !== modelPrimaryKeyCacheKey(primaryKey, id)

    broadcastFrontendModelEvent(configuration, modelName, {
      action,
      id,
      ...(destroyAuthorizationRecord !== undefined ? {destroyAuthorizationRecord} : {}),
      ...(identityChanged ? {previousId} : {})
    })
  }
}

/**
 * Fans a lifecycle event out to all V2 "frontend-models" subscribers
 * whose `params.model` matches. Record attributes go through the
 * transport serializer so Date/undefined/etc. survive the JSON hop.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @param {string} modelName - Model class name.
 * @param {{action: "create" | "update" | "destroy", destroyAuthorizationRecord?: FrontendModelDestroyAuthorizationRecord, id: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, previousId?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, record?: Record<string, import("./query.js").FrontendModelTransportValue>}} event - Lifecycle event.
 * @returns {void}
 */
function broadcastFrontendModelEvent(configuration, modelName, event) {
  const body = {
    action: event.action,
    id: event.id,
    model: modelName,
    ...(event.previousId !== undefined ? {previousId: event.previousId} : {}),
    ...(event.record ? {record: serializeFrontendModelTransportValue(event.record, transportSerializationOptionsForConfiguration(configuration))} : {})
  }

  configuration.broadcastToChannel(FRONTEND_MODELS_CHANNEL_NAME, {
    ...(event.destroyAuthorizationRecord !== undefined ? {destroyAuthorizationRecord: event.destroyAuthorizationRecord} : {}),
    model: modelName
  }, body)
}
