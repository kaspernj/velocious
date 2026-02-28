// @ts-check

import * as inflection from "inflection"
import FrontendModelController from "../../frontend-model-controller.js"

const SHARED_FRONTEND_MODEL_API_PATH = "/velocious/api"

/**
 * @param {object} args - Hook args.
 * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
 * @param {string} args.currentPath - Request path without query.
 * @returns {import("../../configuration-types.js").RouteResolverHookResult | null} - Route override or null.
 */
export default function frontendModelCommandRouteHook({configuration, currentPath}) {
  const normalizedCurrentPath = normalizePath(currentPath)

  if (normalizedCurrentPath === SHARED_FRONTEND_MODEL_API_PATH) {
    return {
      action: "frontend-api",
      controller: "velocious/api",
      controllerClass: FrontendModelController
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

      const action = frontendModelActionForCommand({commandName, resourceConfiguration})
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
 * @param {import("../../configuration-types.js").FrontendModelResourceConfiguration} args.resourceConfiguration - Resource configuration.
 * @returns {"destroy" | "find" | "index" | "update" | null} - Frontend action for command.
 */
function frontendModelActionForCommand({commandName, resourceConfiguration}) {
  const commands = {
    destroy: resourceConfiguration.commands?.destroy || "destroy",
    find: resourceConfiguration.commands?.find || "find",
    index: resourceConfiguration.commands?.index || "index",
    update: resourceConfiguration.commands?.update || "update"
  }

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
  if (resourceConfiguration.path) return `/${resourceConfiguration.path.replace(/^\/+/, "")}`

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
