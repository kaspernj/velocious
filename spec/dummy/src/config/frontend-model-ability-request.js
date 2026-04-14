import {
  frontendModelActionForCommand,
  frontendModelCustomCommandForPath,
  frontendModelResourcePath,
  frontendModelResourcesForBackendProject
} from "../../../../src/frontend-models/resource-definition.js"

/**
 * @param {object} args - Arguments.
 * @param {import("../../../../src/configuration-types.js").BackendProjectConfiguration[]} args.backendProjects - Backend projects.
 * @param {string} args.currentPath - Current request path.
 * @returns {boolean} - Whether the path targets a direct frontend-model route.
 */
function isDirectFrontendModelCommandPath({backendProjects, currentPath}) {
  const normalizedCurrentPath = currentPath.startsWith("/") ? currentPath : `/${currentPath}`
  
  if (frontendModelCustomCommandForPath({backendProjects, currentPath: normalizedCurrentPath})) {
    return true
  }

  for (const backendProject of backendProjects) {
    const resources = frontendModelResourcesForBackendProject(backendProject)

    for (const modelName in resources) {
      const resourceDefinition = resources[modelName]
      const resourcePath = frontendModelResourcePath(modelName, resourceDefinition)
      const expectedPrefix = `${resourcePath}/`

      if (!normalizedCurrentPath.startsWith(expectedPrefix)) continue

      const commandName = normalizedCurrentPath.slice(expectedPrefix.length)

      if (!commandName.includes("/") && frontendModelActionForCommand({commandName, modelName, resourceDefinition})) {
        return true
      }
    }
  }

  return false
}

/**
 * @param {object} args - Arguments.
 * @param {import("../../../../src/configuration-types.js").BackendProjectConfiguration[]} args.backendProjects - Backend projects.
 * @param {Record<string, any>} args.params - Request params.
 * @param {import("../../../../src/http-server/client/request.js").default | import("../../../../src/http-server/client/websocket-request.js").default} args.request - Request object.
 * @returns {boolean} - Whether this request should resolve frontend-model ability resources.
 */
export default function isFrontendModelAbilityRequest({backendProjects, params, request}) {
  const requestPath = request.path().split("?")[0]
  const frontendModelRequests = Array.isArray(params.requests) ? params.requests : [params]
  const includesFrontendModelRequest = frontendModelRequests.some((requestEntry) => typeof requestEntry?.model === "string")
  const isSharedFrontendModelApi = requestPath === "/velocious/api" || requestPath === "/frontend-models" || requestPath === "/frontend-models/request"

  if (isSharedFrontendModelApi && includesFrontendModelRequest) {
    return true
  }

  return isDirectFrontendModelCommandPath({backendProjects, currentPath: requestPath})
}
