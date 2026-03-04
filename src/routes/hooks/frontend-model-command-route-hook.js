// @ts-check

import * as inflection from "inflection"
import {validateFrontendModelResourceCommandName, validateFrontendModelResourcePath} from "../../frontend-models/resource-config-validation.js"

const SHARED_FRONTEND_MODEL_API_PATH = "/velocious/api"
/** @type {typeof import("../../frontend-model-controller.js").default | null | undefined} */
let frontendModelControllerClass

/**
 * @param {Error} error - Import error.
 * @returns {string | undefined} - Missing module specifier from an ERR_MODULE_NOT_FOUND message.
 */
function missingModuleSpecifierFromError(error) {
  const firstLine = error.message.split("\n")[0] || ""
  const match = firstLine.match(/^Cannot find (?:module|package) ['"](.+?)['"] imported from /)

  return match?.[1]
}

/**
 * @param {object} args - Arguments.
 * @param {Error} args.error - Import error.
 * @param {string} args.targetImportPath - Relative module specifier used in dynamic import.
 * @returns {boolean} - True when the target frontend-model-controller module is missing.
 */
function isMissingFrontendModelControllerModuleError({error, targetImportPath}) {
  const isModuleNotFoundError = "code" in error && error.code === "ERR_MODULE_NOT_FOUND"

  if (!isModuleNotFoundError) return false

  const missingSpecifier = missingModuleSpecifierFromError(error)

  if (!missingSpecifier) return false

  const targetImportUrl = new URL(targetImportPath, import.meta.url).href
  const targetImportFilePath = decodeURIComponent(new URL(targetImportUrl).pathname)

  return missingSpecifier === targetImportUrl || missingSpecifier === targetImportFilePath
}

/**
 * @param {object} args - Hook args.
 * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
 * @param {string} args.currentPath - Request path without query.
 * @returns {Promise<import("../../configuration-types.js").RouteResolverHookResult | null>} - Route override or null.
 */
export default async function frontendModelCommandRouteHook({configuration, currentPath}) {
  const normalizedCurrentPath = normalizePath(currentPath)
  const resolvedFrontendModelControllerClass = await resolveFrontendModelControllerClass()

  if (normalizedCurrentPath === SHARED_FRONTEND_MODEL_API_PATH) {
    return {
      action: "frontend-api",
      controller: "velocious/api",
      ...(resolvedFrontendModelControllerClass ? {controllerClass: resolvedFrontendModelControllerClass} : {})
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
      const controller = normalizedResourcePath.replace(/^\/+/, "")

      return {
        action: `frontend-${action}`,
        controller,
        ...(resolvedFrontendModelControllerClass ? {controllerClass: resolvedFrontendModelControllerClass} : {})
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
 * @returns {"destroy" | "find" | "index" | "create" | "update" | "attach" | "download" | "url" | null} - Frontend action for command.
 */
function frontendModelActionForCommand({commandName, modelName, resourceConfiguration}) {
  const commands = {
    attach: validateFrontendModelResourceCommandName({
      commandName: resourceConfiguration.commands?.attach ?? "attach",
      commandType: "attach",
      modelName
    }),
    create: validateFrontendModelResourceCommandName({
      commandName: resourceConfiguration.commands?.create ?? "create",
      commandType: "create",
      modelName
    }),
    download: validateFrontendModelResourceCommandName({
      commandName: resourceConfiguration.commands?.download ?? "download",
      commandType: "download",
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
    }),
    url: validateFrontendModelResourceCommandName({
      commandName: resourceConfiguration.commands?.url ?? "url",
      commandType: "url",
      modelName
    })
  }

  if (commandName === commands.attach) return "attach"
  if (commandName === commands.create) return "create"
  if (commandName === commands.download) return "download"
  if (commandName === commands.destroy) return "destroy"
  if (commandName === commands.find) return "find"
  if (commandName === commands.index) return "index"
  if (commandName === commands.update) return "update"
  if (commandName === commands.url) return "url"

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

/**
 * @returns {Promise<typeof import("../../frontend-model-controller.js").default | null>} - Frontend model controller class or null when unavailable.
 */
async function resolveFrontendModelControllerClass() {
  if (frontendModelControllerClass !== undefined) return frontendModelControllerClass

  const importPath = ["..", "..", "frontend-model-controller.js"].join("/")

  try {
    const frontendModelControllerImport = await import(importPath)
    frontendModelControllerClass = frontendModelControllerImport.default

    return frontendModelControllerClass
  } catch (error) {
    const isErrorObject = typeof error === "object" && error

    if (!isErrorObject || !isMissingFrontendModelControllerModuleError({error, targetImportPath: importPath})) throw error

    frontendModelControllerClass = null

    return null
  }
}
