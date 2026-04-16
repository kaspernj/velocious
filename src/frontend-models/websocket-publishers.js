// @ts-check

import AuthorizationBaseResource from "../authorization/base-resource.js"
import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js"
import FrontendModelWebsocketChannelV2 from "./websocket-channel-v2.js"
import {frontendModelResourcesForBackendProject} from "./resource-definition.js"
import {serializeFrontendModelTransportValue} from "./transport-serialization.js"

const registeredConfigurationsByModelClass = new WeakMap()
const channelClassRegisteredConfigurations = new WeakSet()

/** Shared channel name for all frontend-model lifecycle subscriptions. */
export const FRONTEND_MODELS_CHANNEL_NAME = "frontend-models"

/**
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
 * @returns {Record<string, typeof FrontendModelBaseResource>} - Resource definitions keyed by model name.
 */
/**
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
    const ability = await resolver({configuration, params: {}, request: /** @type {any} */ (undefined), response: /** @type {any} */ (undefined)})

    if (ability?.resources && Array.isArray(ability.resources)) {
      return ability.resources
    }
  }

  return []
}

/**
 * @param {import("../configuration-types.js").AbilityResourceClassType[]} abilityResources - Ability resource classes.
 * @returns {Record<string, typeof FrontendModelBaseResource>} - Resource definitions keyed by model name.
 */
function frontendModelResourcesFromAbilityResourcesList(abilityResources) {
  /** @type {Record<string, typeof FrontendModelBaseResource>} */
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
      const modelClass = /** @type {typeof FrontendModelBaseResource} */ (resourceClass).ModelClass

      if (!modelClass) {
        throw new Error(`Resource class ${resourceClass.name} is missing a static ModelClass property`)
      }

      const modelName = modelClass.getModelName()

      if (!modelName) {
        throw new Error(`Model class ${modelClass.name} returned empty model name from getModelName()`)
      }

      resources[modelName] = /** @type {typeof FrontendModelBaseResource} */ (resourceClass)
    } else if (resourceClass.prototype instanceof AuthorizationBaseResource) {
      // Authorization-only resource — valid but not relevant for WebSocket publishing
    } else {
      throw new Error(`Unexpected ability resource class: ${resourceClass.name}. Expected AuthorizationBaseResource or FrontendModelBaseResource subclass.`)
    }
  }

  return resources
}

/**
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @returns {Promise<void>}
 */
export async function ensureFrontendModelWebsocketPublishersRegistered(configuration) {
  const modelClasses = configuration.getModelClasses()

  /** @type {Record<string, typeof FrontendModelBaseResource>} */
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
  if (!channelClassRegisteredConfigurations.has(configuration)) {
    channelClassRegisteredConfigurations.add(configuration)
    configuration.registerWebsocketChannel?.(FRONTEND_MODELS_CHANNEL_NAME, FrontendModelWebsocketChannelV2)
  }

  for (const modelName of Object.keys(allFrontendModels)) {
    const modelClass = modelClasses[modelName]

    if (!modelClass) continue

    let registeredConfigurations = registeredConfigurationsByModelClass.get(modelClass)

    if (!registeredConfigurations) {
      registeredConfigurations = new WeakSet()
      registeredConfigurationsByModelClass.set(modelClass, registeredConfigurations)
    }

    if (registeredConfigurations.has(configuration)) continue

    registeredConfigurations.add(configuration)

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
        broadcastFrontendModelEvent(configuration, modelName, {
          action,
          id: model.id(),
          record: model.attributes()
        })
      })
      delete modelWithWebsocketAction.__frontendModelWebsocketAction
    })

    modelClass.afterDestroy((model) => {
      void model.getModelClass().connection().afterCommit(async () => {
        broadcastFrontendModelEvent(configuration, modelName, {
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
 *
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @param {string} modelName - Model class name.
 * @param {{action: "create" | "update" | "destroy", id: any, record?: Record<string, any>}} event - Lifecycle event.
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
