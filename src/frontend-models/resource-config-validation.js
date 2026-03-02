// @ts-check

const frontendModelSafeUrlSegmentPattern = /^[A-Za-z0-9_-]+$/u

/**
 * @param {object} args - Args.
 * @param {string} args.commandName - Command name candidate.
 * @param {string} args.modelName - Model class name.
 * @param {string} args.commandType - Command type key.
 * @returns {string} - Validated command name.
 */
export function validateFrontendModelResourceCommandName({commandName, modelName, commandType}) {
  if (typeof commandName !== "string" || commandName.length < 1) {
    throw new Error(`Invalid frontend model command for ${modelName}.${commandType}: expected non-empty string`)
  }

  if (!frontendModelSafeUrlSegmentPattern.test(commandName)) {
    throw new Error(`Invalid frontend model command for ${modelName}.${commandType}: "${commandName}"`)
  }

  return commandName
}

/**
 * @param {object} args - Args.
 * @param {string} args.resourcePath - Resource path candidate.
 * @param {string} args.modelName - Model class name.
 * @returns {string} - Validated resource path.
 */
export function validateFrontendModelResourcePath({resourcePath, modelName}) {
  if (typeof resourcePath !== "string" || resourcePath.length < 1) {
    throw new Error(`Invalid frontend model resource path for ${modelName}: expected non-empty string`)
  }

  if (resourcePath.includes("?") || resourcePath.includes("#")) {
    throw new Error(`Invalid frontend model resource path for ${modelName}: "${resourcePath}"`)
  }

  const normalizedPath = resourcePath.replace(/^\/+|\/+$/g, "")

  if (normalizedPath.length < 1) {
    throw new Error(`Invalid frontend model resource path for ${modelName}: "${resourcePath}"`)
  }

  const pathSegments = normalizedPath.split("/")

  for (const pathSegment of pathSegments) {
    if (!frontendModelSafeUrlSegmentPattern.test(pathSegment)) {
      throw new Error(`Invalid frontend model resource path for ${modelName}: "${resourcePath}"`)
    }
  }

  return resourcePath
}
