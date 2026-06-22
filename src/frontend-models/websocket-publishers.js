// @ts-check

import AuthorizationBaseResource from "../authorization/base-resource.js"
import {frontendModelResourcesWithBuiltInsForBackendProject} from "./built-in-resources.js"
import {frontendModelResourceDefinitionIsClass} from "./resource-definition.js"
import {serializeFrontendModelTransportValue} from "./transport-serialization.js"

const modelClassesWithRegisteredHooks = new WeakSet()
const channelClassRegisteredConfigurations = new WeakSet()

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

      const modelName = resourceClass.modelClass().getModelName()

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

  for (const resourceClass of Object.values(allFrontendModels)) {
    // An abstract base resource (no static ModelClass — e.g. an app's shared
    // `BaseResource` that other resources extend) backs no model, so there is
    // nothing to publish realtime events for. Skip it instead of throwing.
    if (!resourceClass.ModelClass) continue

    const modelClass = resourceClass.modelClass()
    const modelName = modelClass.getModelName()

    // Register lifecycle hooks once per model class, not per configuration. A model class belongs to a
    // single backend project/config in production, so per-config registration only differs in tests where
    // the same model class is reachable from multiple configs — there it attaches duplicate beforeCreate/
    // afterSave/afterDestroy hooks that double-fire broadcasts (and leak across specs). The hooks read the
    // model's runtime configuration when broadcasting, so a single registration is sufficient.
    if (modelClassesWithRegisteredHooks.has(modelClass)) continue

    modelClassesWithRegisteredHooks.add(modelClass)

    modelClass.beforeCreate((model) => {
      /** @type {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update"}} */ (model).__frontendModelWebsocketAction = "create"
    })

    modelClass.beforeUpdate((model) => {
      /** @type {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update"}} */ (model).__frontendModelWebsocketAction = "update"
    })

    modelClass.afterSave((model) => {
      const modelWithWebsocketAction = /** @type {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update"}} */ (model)
      const action = modelWithWebsocketAction.__frontendModelWebsocketAction

      if (action !== "create" && action !== "update") return

      void model.getModelClass().connection().afterCommit(async () => {
        broadcastFrontendModelEvent(model._getConfiguration(), modelName, {
          action,
          id: model.id(),
          record: model.attributes()
        })
      })
      delete modelWithWebsocketAction.__frontendModelWebsocketAction
    })

    modelClass.afterDestroy((model) => {
      void model.getModelClass().connection().afterCommit(async () => {
        broadcastFrontendModelEvent(model._getConfiguration(), modelName, {
          action: "destroy",
          id: model.id()
        })
      })
    })
  }
}

/**
 * Fans a lifecycle event out to all V2 "frontend-models" subscribers
 * whose `params.model` matches. Record attributes go through the
 * transport serializer so Date/undefined/etc. survive the JSON hop.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @param {string} modelName - Model class name.
 * @param {{action: "create" | "update" | "destroy", id: ?, record?: Record<string, ?>}} event - Lifecycle event.
 * @returns {void}
 */
function broadcastFrontendModelEvent(configuration, modelName, event) {
  const body = {
    action: event.action,
    id: event.id,
    model: modelName,
    ...(event.record ? {record: serializeFrontendModelTransportValue(event.record, transportSerializationOptionsForConfiguration(configuration))} : {})
  }

  configuration.broadcastToChannel(FRONTEND_MODELS_CHANNEL_NAME, {model: modelName}, body)
}
