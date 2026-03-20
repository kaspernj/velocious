// @ts-check

import * as inflection from "inflection"
import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js"
import {validateFrontendModelResourceCommandName, validateFrontendModelResourcePath} from "./resource-config-validation.js"

/**
 * @param {import("../configuration-types.js").BackendProjectConfiguration} backendProject - Backend project config.
 * @returns {Record<string, typeof FrontendModelBaseResource>} - Resource definitions keyed by model name.
 */
export function frontendModelResourcesForBackendProject(backendProject) {
  const resources = backendProject.frontendModels || backendProject.resources

  if (resources !== undefined) {
    if (!resources || typeof resources !== "object") {
      throw new Error(`Expected backend project resources object but got: ${resources}`)
    }

    return resources
  }

  const resourcesRequireContext = backendProject.frontendModelsRequireContext || backendProject.resourcesRequireContext

  if (resourcesRequireContext === undefined) {
    return {}
  }

  if (typeof resourcesRequireContext !== "function" || typeof resourcesRequireContext.keys !== "function") {
    throw new Error("Expected backend project resourcesRequireContext to be a webpack-style require context")
  }

  /** @type {Record<string, typeof FrontendModelBaseResource>} */
  const resolvedResources = {}

  for (const resourcePath of resourcesRequireContext.keys()) {
    const importedModule = resourcesRequireContext(resourcePath)
    const resourceDefinition = importedModule?.default

    if (!frontendModelResourceDefinitionIsClass(resourceDefinition)) continue

    const modelName = frontendModelModelNameFromResourcePath(resourcePath)

    if (resolvedResources[modelName]) {
      throw new Error(`Duplicate frontend model resource definition for '${modelName}' from '${resourcePath}'`)
    }

    resolvedResources[modelName] = resourceDefinition
  }

  return resolvedResources
}

/**
 * @param {unknown} value - Candidate resource definition.
 * @returns {value is typeof FrontendModelBaseResource} - Whether value is a resource class.
 */
export function frontendModelResourceDefinitionIsClass(value) {
  return typeof value === "function" && (value === FrontendModelBaseResource || value.prototype instanceof FrontendModelBaseResource)
}

/**
 * @param {unknown} resourceDefinition - Resource definition.
 * @returns {typeof FrontendModelBaseResource | null} - Resource class when definition is class-based.
 */
export function frontendModelResourceClassFromDefinition(resourceDefinition) {
  return frontendModelResourceDefinitionIsClass(resourceDefinition) ? resourceDefinition : null
}

/**
 * @param {unknown} resourceDefinition - Resource definition.
 * @returns {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | null} - Normalized resource configuration.
 */
export function frontendModelResourceConfigurationFromDefinition(resourceDefinition) {
  if (!frontendModelResourceDefinitionIsClass(resourceDefinition)) return null

  return normalizeFrontendModelResourceConfiguration(resourceDefinition.resourceConfig())
}

/**
 * @param {import("../configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Raw resource configuration.
 * @returns {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} - Normalized resource configuration.
 */
function normalizeFrontendModelResourceConfiguration(resourceConfiguration) {
  const normalizedCommands = normalizeFrontendModelResourceCommands(resourceConfiguration)

  return {
    ...resourceConfiguration,
    abilities: normalizeFrontendModelResourceAbilities(resourceConfiguration.abilities),
    collectionCommands: normalizedCommands.collectionCommands,
    commands: normalizedCommands.commands,
    memberCommands: normalizedCommands.memberCommands
  }
}

/**
 * @param {Record<string, string> | string[] | undefined} abilities - Resource abilities config.
 * @returns {Record<string, string>} - Normalized abilities config.
 */
function normalizeFrontendModelResourceAbilities(abilities) {
  /** @type {Record<string, string>} */
  const defaultAbilities = {
    create: "create",
    destroy: "destroy",
    find: "read",
    index: "read",
    update: "update"
  }

  if (!abilities) {
    return defaultAbilities
  }

  if (!Array.isArray(abilities)) {
    return abilities
  }

  /** @type {Record<string, string>} */
  const normalized = {}

  if (abilities.includes("manage")) {
    normalized.create = "manage"
    normalized.destroy = "manage"
    normalized.find = "manage"
    normalized.index = "manage"
    normalized.update = "manage"

    return normalized
  }

  if (abilities.includes("create")) normalized.create = "create"
  if (abilities.includes("destroy")) normalized.destroy = "destroy"
  if (abilities.includes("read")) {
    normalized.find = "read"
    normalized.index = "read"
  }
  if (abilities.includes("update")) normalized.update = "update"

  return normalized
}

/**
 * @param {import("../configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Raw resource configuration.
 * @returns {{collectionCommands: Record<string, string>, commands: Record<string, string>, memberCommands: Record<string, string>}} - Normalized command configuration.
 */
function normalizeFrontendModelResourceCommands(resourceConfiguration) {
  const legacyCommands = resourceConfiguration.commands
  const collectionCommands = resourceConfiguration.collectionCommands
  const memberCommands = resourceConfiguration.memberCommands
  const usesSplitCommandConfig = collectionCommands !== undefined || memberCommands !== undefined
  /** @type {Record<string, string>} */
  const normalizedCollectionCommands = usesSplitCommandConfig ? {} : {
    create: "create",
    index: "index"
  }
  /** @type {Record<string, string>} */
  const normalizedMemberCommands = usesSplitCommandConfig ? {} : {
    attach: "attach",
    destroy: "destroy",
    download: "download",
    find: "find",
    update: "update",
    url: "url"
  }

  for (const commandType of /** @type {const} */ (["create", "index"])) {
    const commandName = frontendModelResourceCommandNameFromConfigs({
      collectionCommands,
      commandType,
      legacyCommands
    })

    if (commandName !== undefined) {
      normalizedCollectionCommands[commandType] = commandName
    }
  }

  for (const commandType of /** @type {const} */ (["attach", "destroy", "download", "find", "update", "url"])) {
    const commandName = frontendModelResourceCommandNameFromConfigs({
      commandType,
      legacyCommands,
      memberCommands
    })

    if (commandName !== undefined) {
      normalizedMemberCommands[commandType] = commandName
    }
  }

  return {
    collectionCommands: normalizedCollectionCommands,
    commands: {
      ...normalizedCollectionCommands,
      ...normalizedMemberCommands
    },
    memberCommands: normalizedMemberCommands
  }
}

/**
 * @param {object} args - Arguments.
 * @param {"attach" | "create" | "destroy" | "download" | "find" | "index" | "update" | "url"} args.commandType - Command type.
 * @param {Record<string, string> | string[] | undefined} [args.collectionCommands] - Collection command config.
 * @param {Record<string, string> | string[] | undefined} [args.legacyCommands] - Legacy command config.
 * @param {Record<string, string> | string[] | undefined} [args.memberCommands] - Member command config.
 * @returns {string | undefined} - Resolved command name.
 */
function frontendModelResourceCommandNameFromConfigs({collectionCommands, commandType, legacyCommands, memberCommands}) {
  return frontendModelResourceCommandNameFromConfig(collectionCommands, commandType)
    ?? frontendModelResourceCommandNameFromConfig(memberCommands, commandType)
    ?? frontendModelResourceCommandNameFromConfig(legacyCommands, commandType)
}

/**
 * @param {Record<string, string> | string[] | undefined} commandsConfig - Command config.
 * @param {"attach" | "create" | "destroy" | "download" | "find" | "index" | "update" | "url"} commandType - Command type.
 * @returns {string | undefined} - Resolved command name.
 */
function frontendModelResourceCommandNameFromConfig(commandsConfig, commandType) {
  if (!commandsConfig) {
    return undefined
  }

  if (Array.isArray(commandsConfig)) {
    return commandsConfig.includes(commandType) ? commandType : undefined
  }

  return commandsConfig[commandType]
}

/**
 * @param {string} modelName - Model class name.
 * @param {unknown} resourceDefinition - Resource definition.
 * @returns {string} - Normalized resource path.
 */
export function frontendModelResourcePath(modelName, resourceDefinition) {
  const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition)

  if (!resourceConfiguration) {
    throw new Error(`Invalid frontend model resource definition for ${modelName}`)
  }

  if (resourceConfiguration.path) {
    return validateFrontendModelResourcePath({
      modelName,
      resourcePath: `/${resourceConfiguration.path.replace(/^\/+/, "")}`
    })
  }

  return `/${inflection.dasherize(inflection.pluralize(inflection.underscore(modelName)))}`
}

/**
 * @param {object} args - Arguments.
 * @param {string} args.commandName - Command path segment.
 * @param {string} args.modelName - Model class name.
 * @param {unknown} args.resourceDefinition - Resource definition.
 * @returns {"destroy" | "find" | "index" | "create" | "update" | "attach" | "download" | "url" | null} - Frontend action.
 */
export function frontendModelActionForCommand({commandName, modelName, resourceDefinition}) {
  const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition)

  if (!resourceConfiguration) {
    throw new Error(`Invalid frontend model resource definition for ${modelName}`)
  }

  for (const [action, configuredCommandName] of Object.entries(resourceConfiguration.commands)) {
    if (configuredCommandName === undefined) continue

    const validatedCommandName = validateFrontendModelResourceCommandName({
      commandName: configuredCommandName,
      commandType: /** @type {"attach" | "create" | "destroy" | "download" | "find" | "index" | "update" | "url"} */ (action),
      modelName
    })

    if (commandName === validatedCommandName) {
      return /** @type {"attach" | "create" | "destroy" | "download" | "find" | "index" | "update" | "url"} */ (action)
    }
  }

  return null
}

/**
 * @param {string} resourcePath - Relative resource path from require context.
 * @returns {string} - Derived frontend model class name.
 */
function frontendModelModelNameFromResourcePath(resourcePath) {
  const pathWithoutExtension = resourcePath.replace(/\.[^.]+$/, "")
  const pathSegments = pathWithoutExtension.split("/")
  const fileName = pathSegments[pathSegments.length - 1].replace(/^\.\//, "")

  return inflection.camelize(fileName.replaceAll("-", "_"))
}
