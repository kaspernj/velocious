// @ts-check

import * as inflection from "inflection"
import {validateFrontendModelResourceCommandName, validateFrontendModelResourcePath} from "../../frontend-models/resource-config-validation.js"

const SHARED_FRONTEND_MODEL_API_PATH = "/velocious/api"

/**
 * @param {object} args - Hook args.
 * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
 * @param {string} args.currentPath - Request path without query.
 * @returns {Promise<import("../../configuration-types.js").RouteResolverHookResult | null>} - Route override or null.
 */
export default async function frontendModelCommandRouteHook({configuration, currentPath}) {
  const normalizedCurrentPath = normalizePath(currentPath)

  if (normalizedCurrentPath === SHARED_FRONTEND_MODEL_API_PATH) {
    return {
      action: "frontend-api",
      controller: "velocious/api",
      controllerPath: "../frontend-model-controller.js"
    }
  }

  const backendProjects = configuration.getBackendProjects?.() || []

  for (const backendProject of backendProjects) {
    const resources = backendProject.frontendModels || backendProject.resources || {}

    for (const modelName in resources) {
      const resourceConfiguration = resources[modelName]
      const resourcePath = frontendModelResourcePath(modelName, resourceConfiguration)
      const normalizedResourcePath = normalizePath(resourcePath)
      const expectedPrefix = `${normalizedResourcePath}/`

      if (!normalizedCurrentPath.startsWith(expectedPrefix)) continue

      const commandName = normalizedCurrentPath.slice(expectedPrefix.length)
      if (commandName.includes("/")) continue

      const action = frontendModelActionForCommand({commandName, modelName, resourceConfiguration})
      if (!action) continue

      return {
        action: `frontend-${action}`,
        controller: normalizedResourcePath.replace(/^\/+/, "")
      }
    }
  }

  return null
}

/**
 * @param {object} args - Arguments.
 * @param {string} args.commandName - Command path segment.
 * @param {string} args.modelName - Model class name.
 * @param {import("../../configuration-types.js").FrontendModelResourceConfiguration} args.resourceConfiguration - Resource configuration.
 * @returns {"destroy" | "find" | "index" | "create" | "update" | null} - Frontend action for command.
 */
function frontendModelActionForCommand({commandName, modelName, resourceConfiguration}) {
  const commands = {
    create: validateFrontendModelResourceCommandName({
      commandName: resourceConfiguration.commands?.create ?? "create",
      commandType: "create",
      modelName
    }),
    destroy: validateFrontendModelResourceCommandName({
      commandName: resourceConfiguration.commands?.destroy ?? "destroy",
      commandType: "destroy",
      modelName
    }),
    find: validateFrontendModelResourceCommandName({
      commandName: resourceConfiguration.commands?.find ?? "find",
      commandType: "find",
      modelName
    }),
    index: validateFrontendModelResourceCommandName({
      commandName: resourceConfiguration.commands?.index ?? "index",
      commandType: "index",
      modelName
    }),
    update: validateFrontendModelResourceCommandName({
      commandName: resourceConfiguration.commands?.update ?? "update",
      commandType: "update",
      modelName
    })
  }

  if (commandName === commands.create) return "create"
  if (commandName === commands.destroy) return "destroy"
  if (commandName === commands.find) return "find"
  if (commandName === commands.index) return "index"
  if (commandName === commands.update) return "update"

  return null
}

/**
 * @param {string} modelName - Model class name.
 * @param {import("../../configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Resource configuration.
 * @returns {string} - Normalized frontend model resource path.
 */
function frontendModelResourcePath(modelName, resourceConfiguration) {
  if (resourceConfiguration.path) {
    return validateFrontendModelResourcePath({
      modelName,
      resourcePath: `/${resourceConfiguration.path.replace(/^\/+/, "")}`
    })
  }

  return `/${inflection.dasherize(inflection.pluralize(modelName))}`
}

/**
 * @param {string} path - Path value.
 * @returns {string} - Normalized path with leading slash and no trailing slash.
 */
function normalizePath(path) {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`

  if (withLeadingSlash.length > 1) {
    return withLeadingSlash.replace(/\/+$/, "")
  }

  return withLeadingSlash
}
