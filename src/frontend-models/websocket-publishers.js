// @ts-check

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
 * @param {import("../configuration.js").default} configuration - Configuration instance.
 * @returns {void}
 */
export function ensureFrontendModelWebsocketPublishersRegistered(configuration) {
  const modelClasses = configuration.getModelClasses()

  for (const backendProject of configuration.getBackendProjects()) {
    const frontendModels = frontendModelResourcesForBackendProject(backendProject)

    for (const modelName of Object.keys(frontendModels)) {
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
}
