// @ts-check

import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js"
import {frontendModelResourcesForBackendProject} from "./resource-definition.js"

const registeredConfigurationsByModelClass = new WeakMap()

/**
 * @param {string} modelName - Model class name.
 * @returns {string} - Broadcast channel name.
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
function frontendModelResourcesFromAbilityResources(configuration) {
  /** @type {Record<string, typeof FrontendModelBaseResource>} */
  const resources = {}

  try {
    const abilityResources = configuration.getAbilityResources()

    for (const resourceClass of abilityResources) {
      if (typeof resourceClass === "function" && resourceClass.prototype instanceof FrontendModelBaseResource) {
        const modelClass = /** @type {typeof FrontendModelBaseResource} */ (resourceClass).ModelClass

        if (modelClass) {
          const modelName = modelClass.getModelName?.() || modelClass.name

          if (modelName) {
            resources[modelName] = /** @type {typeof FrontendModelBaseResource} */ (resourceClass)
          }
        }
      }
    }
  } catch {
    // Ability resources not configured — no auto-discovery
  }

  return resources
}

/**
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @returns {void}
 */
export function ensureFrontendModelWebsocketPublishersRegistered(configuration) {
  const modelClasses = configuration.getModelClasses()

  /** @type {Record<string, typeof FrontendModelBaseResource>} */
  let allFrontendModels = {}
  let hasExplicitConfig = false

  for (const backendProject of configuration.getBackendProjects()) {
    if (backendProject.frontendModels !== undefined || backendProject.frontendModelsRequireContext !== undefined) {
      hasExplicitConfig = true
    }

    const projectResources = frontendModelResourcesForBackendProject(backendProject)

    allFrontendModels = {...allFrontendModels, ...projectResources}
  }

  // Auto-discover from ability resources only when no backend project
  // explicitly defines frontendModels or frontendModelsRequireContext
  if (!hasExplicitConfig) {
    allFrontendModels = frontendModelResourcesFromAbilityResources(configuration)
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
        configuration.getWebsocketEvents()?.publish(frontendModelBroadcastChannelName(modelName), {
          action,
          id: String(model.id()),
          record: model.attributes(),
          modelName
        })
      })
      delete modelWithWebsocketAction.__frontendModelWebsocketAction
    })

    modelClass.afterDestroy((model) => {
      void model.getModelClass().connection().afterCommit(async () => {
        configuration.getWebsocketEvents()?.publish(frontendModelBroadcastChannelName(modelName), {
          action: "destroy",
          id: String(model.id()),
          modelName
        })
      })
    })
  }
}
