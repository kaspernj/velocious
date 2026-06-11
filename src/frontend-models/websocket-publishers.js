// @ts-check

import AuthorizationBaseResource from "../authorization/base-resource.js"
import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js"
import {frontendModelResourcesForBackendProject} from "./resource-definition.js"
import {serializeFrontendModelTransportValue} from "./transport-serialization.js"

const modelClassesWithRegisteredHooks = new WeakSet()
const channelClassRegisteredConfigurations = new WeakSet()

/** Shared channel name for all frontend-model lifecycle subscriptions. */
export const FRONTEND_MODELS_CHANNEL_NAME = "frontend-models"

/**
 * Runs the frontendModelBroadcastChannelName helper.
 * @param {string} modelName - Model class name.
 * @returns {string} - Broadcast channel name (legacy, retained for migration compatibility).
 */
export function frontendModelBroadcastChannelName(modelName) {
  return `frontend-models:${modelName}`
}

/**
 * Builds a frontend models map from the configuration's ability resources.
 * Each resource class with a static ModelClass property is keyed by model name.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} - Resource definitions keyed by model name.
 */
/**
 * Runs resolve ability resources list.
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @returns {Promise<import("../configuration-types.js").AbilityResourceClassType[]>} - Resolved ability resources.
 */
async function resolveAbilityResourcesList(configuration) {
  // First check explicitly set ability resources
  const explicit = configuration.getAbilityResources()

  if (explicit && explicit.length > 0) return explicit

  // Resolve from the ability resolver by calling it with a synthetic context.
  // The resolver must handle undefined request/response gracefully.
  const resolver = configuration.getAbilityResolver?.()

  if (typeof resolver === "function") {
    const ability = await resolver({configuration, params: {}, request: /**
                                                                         * Narrows the runtime value to the documented type.
                                                                          @type {?} */ (undefined), response: /**
                                                                                                               * Narrows the runtime value to the documented type.
                                                                                                                @type {?} */ (undefined)})

    if (ability?.resources && Array.isArray(ability.resources)) {
      return ability.resources
    }
  }

  return []
}

/**
 * Runs frontend model resources from ability resources list.
 * @param {import("../configuration-types.js").AbilityResourceClassType[]} abilityResources - Ability resource classes.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} - Resource definitions keyed by model name.
 */
function frontendModelResourcesFromAbilityResourcesList(abilityResources) {
  /**
   * Resources.
    @type {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} */
  const resources = {}

  if (!abilityResources || abilityResources.length === 0) return resources

  if (!Array.isArray(abilityResources)) {
    throw new Error(`Expected ability resources to be an array but got: ${typeof abilityResources}`)
  }

  for (const resourceClass of abilityResources) {
    if (typeof resourceClass !== "function") {
      throw new Error(`Expected ability resource to be a class but got: ${typeof resourceClass}`)
    }

    if (resourceClass.prototype instanceof FrontendModelBaseResource) {
      const modelClass = /**
                          * Narrows the runtime value to the documented type.
                           @type {import("../configuration-types.js").FrontendModelResourceClassType} */ (resourceClass).ModelClass

      if (!modelClass) {
        throw new Error(`Resource class ${resourceClass.name} is missing a static ModelClass property`)
      }

      const modelName = modelClass.getModelName()

      if (!modelName) {
        throw new Error(`Model class ${modelClass.name} returned empty model name from getModelName()`)
      }

      resources[modelName] = /**
                              * Narrows the runtime value to the documented type.
                               @type {import("../configuration-types.js").FrontendModelResourceClassType} */ (resourceClass)
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
  const modelClasses = configuration.getModelClasses()

  /**
   * All frontend models.
    @type {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} */
  let allFrontendModels = {}

  for (const backendProject of configuration.getBackendProjects()) {
    const projectResources = frontendModelResourcesForBackendProject(backendProject)

    allFrontendModels = {...allFrontendModels, ...projectResources}
  }

  // Auto-discover from ability resources when backend projects didn't provide any
  if (Object.keys(allFrontendModels).length === 0) {
    const abilityResources = await resolveAbilityResourcesList(configuration)

    allFrontendModels = frontendModelResourcesFromAbilityResourcesList(abilityResources)
  }

  // Phase 3: register the V2 channel class once per configuration so
  // `subscribeChannel("frontend-models", {params: {model}})` finds it.
  // Dynamic import keeps server-only WebsocketRequest + Node utilities
  // out of browser bundles that transitively pull in this module via
  // configuration → logger.
  if (!channelClassRegisteredConfigurations.has(configuration)) {
    channelClassRegisteredConfigurations.add(configuration)
    const {default: FrontendModelWebsocketChannel} = await import("./websocket-channel.js")

    configuration.registerWebsocketChannel?.(FRONTEND_MODELS_CHANNEL_NAME, FrontendModelWebsocketChannel)
  }

  for (const modelName of Object.keys(allFrontendModels)) {
    const modelClass = modelClasses[modelName]

    if (!modelClass) continue

    // Register lifecycle hooks once per model class, not per configuration. A model class belongs to a
    // single backend project/config in production, so per-config registration only differs in tests where
    // the same model class is reachable from multiple configs — there it attaches duplicate beforeCreate/
    // afterSave/afterDestroy hooks that double-fire broadcasts (and leak across specs). The hooks read the
    // model's runtime configuration when broadcasting, so a single registration is sufficient.
    if (modelClassesWithRegisteredHooks.has(modelClass)) continue

    modelClassesWithRegisteredHooks.add(modelClass)

    modelClass.beforeCreate((model) => {
      /**
       * Narrows the runtime value to the documented type.
        @type {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update"}} */ (model).__frontendModelWebsocketAction = "create"
    })

    modelClass.beforeUpdate((model) => {
      /**
       * Narrows the runtime value to the documented type.
        @type {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update"}} */ (model).__frontendModelWebsocketAction = "update"
    })

    modelClass.afterSave((model) => {
      const modelWithWebsocketAction = /**
                                        * Narrows the runtime value to the documented type.
                                         @type {import("../database/record/index.js").default & {__frontendModelWebsocketAction?: "create" | "update"}} */ (model)
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
  if (typeof configuration.broadcastToChannel !== "function") return

  const body = {
    action: event.action,
    id: event.id,
    model: modelName,
    ...(event.record ? {record: serializeFrontendModelTransportValue(event.record)} : {})
  }

  configuration.broadcastToChannel(FRONTEND_MODELS_CHANNEL_NAME, {model: modelName}, body)
}
