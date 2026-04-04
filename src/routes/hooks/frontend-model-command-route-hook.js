// @ts-check

import {frontendModelActionForCommand, frontendModelCustomCommandForPath, frontendModelResourcePath, frontendModelResourcesForBackendProject} from "../../frontend-models/resource-definition.js"

const SHARED_FRONTEND_MODEL_API_PATH = "/frontend-models"
const FRONTEND_MODEL_CONTROLLER_PATH = new URL("../../frontend-model-controller.js", import.meta.url).href

/**
 * @param {object} args - Hook args.
 * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
 * @param {string} args.currentPath - Request path without query.
 * @returns {Promise<import("../../configuration-types.js").RouteResolverHookResult | null>} - Route override or null.
 */
export default async function frontendModelCommandRouteHook({configuration, currentPath, hasMatchingCustomRoute}) {
  const normalizedCurrentPath = normalizePath(currentPath)

  if (normalizedCurrentPath === SHARED_FRONTEND_MODEL_API_PATH) {
    return {
      action: "frontend-api",
      controller: "velocious/api",
      controllerPath: FRONTEND_MODEL_CONTROLLER_PATH
    }
  }

  // Don't intercept paths that match explicitly defined custom routes
  if (hasMatchingCustomRoute) return null

  const backendProjects = configuration.getBackendProjects?.() || []
  const customCommandMatch = frontendModelCustomCommandForPath({
    backendProjects,
    currentPath: normalizedCurrentPath
  })

  if (customCommandMatch) {
    /** @type {Record<string, any>} */
    const params = {
      frontendModelCustomCommandMethodName: customCommandMatch.methodName,
      frontendModelCustomCommandScope: customCommandMatch.scope,
      model: customCommandMatch.modelName
    }

    if (customCommandMatch.memberId) {
      params.id = customCommandMatch.memberId
    }

    return {
      action: "frontend-custom-command",
      controller: customCommandMatch.resourcePath.replace(/^\/+/, ""),
      controllerPath: FRONTEND_MODEL_CONTROLLER_PATH,
      params
    }
  }

  for (const backendProject of backendProjects) {
    const resources = frontendModelResourcesForBackendProject(backendProject)

    for (const modelName in resources) {
      const resourceDefinition = resources[modelName]
      const resourcePath = frontendModelResourcePath(modelName, resourceDefinition)
      const normalizedResourcePath = normalizePath(resourcePath)
      const expectedPrefix = `${normalizedResourcePath}/`

      if (!normalizedCurrentPath.startsWith(expectedPrefix)) continue

      const commandName = normalizedCurrentPath.slice(expectedPrefix.length)
      if (commandName.includes("/")) continue

      const action = frontendModelActionForCommand({commandName, modelName, resourceDefinition})
      if (!action) continue
      const controller = normalizedResourcePath.replace(/^\/+/, "")

      return {
        action: `frontend-${action}`,
        controller,
        controllerPath: FRONTEND_MODEL_CONTROLLER_PATH
      }
    }
  }

  return null
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
