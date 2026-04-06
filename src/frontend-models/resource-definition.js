// @ts-check

import * as inflection from "inflection"
import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js"
import restArgsError from "../utils/rest-args-error.js"
import {validateFrontendModelResourceCommandName} from "./resource-config-validation.js"

/**
 * @param {import("../configuration-types.js").BackendProjectConfiguration} backendProject - Backend project config.
 * @returns {Record<string, typeof FrontendModelBaseResource>} - Resource definitions keyed by model name.
 */
export function frontendModelResourcesForBackendProject(backendProject) {
  const resources = backendProject.frontendModels

  if (resources !== undefined) {
    if (!resources || typeof resources !== "object") {
      throw new Error(`Expected backend project frontendModels object but got: ${resources}`)
    }

    return resources
  }

  return {}
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
  const restArgs = /** @type {Record<string, any>} */ ({...resourceConfiguration})

  for (const key of [
    "abilities",
    "attributes",
    "attachments",
    "builtInCollectionCommands",
    "builtInMemberCommands",
    "collectionCommands",
    "commands",
    "memberCommands",
    "modelName",
    "path",
    "primaryKey",
    "relationships",
    "server"
  ]) {
    delete restArgs[key]
  }

  restArgsError(restArgs)

  const normalizedCommands = normalizeFrontendModelResourceCommands(resourceConfiguration)

  return {
    ...resourceConfiguration,
    abilities: normalizeFrontendModelResourceAbilities(resourceConfiguration.abilities),
    builtInCollectionCommands: normalizedCommands.builtInCollectionCommands,
    builtInMemberCommands: normalizedCommands.builtInMemberCommands,
    collectionCommands: normalizedCommands.collectionCommands,
    memberCommands: normalizedCommands.memberCommands
  }
}

/**
 * @param {Record<string, string> | string[] | undefined} abilities - Resource abilities config.
 * @returns {Record<string, string>} - Normalized abilities config.
 */
function normalizeFrontendModelResourceAbilities(abilities) {
  if (!abilities) {
    return {find: "read", index: "read"}
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
 * @returns {{builtInCollectionCommands: Record<string, string>, builtInMemberCommands: Record<string, string>, collectionCommands: Record<string, string>, memberCommands: Record<string, string>}} - Normalized command configuration.
 */
function normalizeFrontendModelResourceCommands(resourceConfiguration) {
  const builtInCollectionCommands = resourceConfiguration.builtInCollectionCommands
  const builtInMemberCommands = resourceConfiguration.builtInMemberCommands
  const customCollectionCommands = resourceConfiguration.collectionCommands
  const customMemberCommands = resourceConfiguration.memberCommands
  const normalizedBuiltInCollectionCommands = normalizeFrontendModelBuiltInCommands({
    commandDefaults: {
      create: "create",
      index: "index"
    },
    commandsConfig: builtInCollectionCommands,
    modelName: "CollectionCommand"
  })
  const normalizedBuiltInMemberCommands = normalizeFrontendModelBuiltInCommands({
    commandDefaults: {
      attach: "attach",
      destroy: "destroy",
      download: "download",
      find: "find",
      update: "update",
      url: "url"
    },
    commandsConfig: builtInMemberCommands,
    modelName: "MemberCommand"
  })

  return {
    builtInCollectionCommands: normalizedBuiltInCollectionCommands,
    builtInMemberCommands: normalizedBuiltInMemberCommands,
    collectionCommands: normalizeFrontendModelCustomCommands({commandsConfig: customCollectionCommands, modelName: "CollectionCommand"}),
    memberCommands: normalizeFrontendModelCustomCommands({commandsConfig: customMemberCommands, modelName: "MemberCommand"})
  }
}

/**
 * @param {object} args - Arguments.
 * @param {Record<string, string>} args.commandDefaults - Built-in default command names.
 * @param {Record<string, string> | string[] | undefined} args.commandsConfig - Built-in commands config.
 * @param {string} args.modelName - Diagnostic model name.
 * @returns {Record<string, string>} - Normalized built-in command config.
 */
function normalizeFrontendModelBuiltInCommands({commandDefaults, commandsConfig, modelName}) {
  if (!commandsConfig) {
    return commandDefaults
  }

  if (Array.isArray(commandsConfig)) {
    /** @type {Record<string, string>} */
    const normalizedCommands = {}

    for (const commandType of commandsConfig) {
      const defaultCommandName = commandDefaults[commandType]

      if (!defaultCommandName) {
        throw new Error(`Unknown built-in frontend model command '${commandType}' for ${modelName}`)
      }

      normalizedCommands[commandType] = validateFrontendModelResourceCommandName({
        commandName: defaultCommandName,
        commandType: defaultCommandName,
        modelName
      })
    }

    return normalizedCommands
  }

  /** @type {Record<string, string>} */
  const normalizedCommands = {}

  for (const [commandType, commandName] of Object.entries(commandsConfig)) {
    if (!commandDefaults[commandType]) {
      throw new Error(`Unknown built-in frontend model command '${commandType}' for ${modelName}`)
    }

    normalizedCommands[commandType] = validateFrontendModelResourceCommandName({
      commandName,
      commandType: /** @type {string} */ (commandType),
      modelName
    })
  }

  return normalizedCommands
}

/**
 * @param {object} args - Arguments.
 * @param {Record<string, string> | string[] | undefined} args.commandsConfig - Custom commands config.
 * @param {string} args.modelName - Diagnostic model name.
 * @returns {Record<string, string>} - Normalized custom command config.
 */
function normalizeFrontendModelCustomCommands({commandsConfig, modelName}) {
  if (!commandsConfig) {
    return {}
  }

  if (Array.isArray(commandsConfig)) {
    /** @type {Record<string, string>} */
    const normalizedCommands = {}

    for (const commandName of commandsConfig) {
      const validatedCommandName = validateFrontendModelResourceCommandName({
        commandName,
        commandType: commandName,
        modelName
      })

      normalizedCommands[inflection.camelize(validatedCommandName, true)] = validatedCommandName
    }

    return normalizedCommands
  }

  /** @type {Record<string, string>} */
  const normalizedCommands = {}

  for (const methodName of Object.keys(commandsConfig)) {
    const commandName = commandsConfig[methodName]

    normalizedCommands[methodName] = validateFrontendModelResourceCommandName({
      commandName,
      commandType: commandName,
      modelName
    })
  }

  return normalizedCommands
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
    return resourceConfiguration.path
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

  for (const [action, configuredCommandName] of Object.entries({
    ...resourceConfiguration.builtInCollectionCommands,
    ...resourceConfiguration.builtInMemberCommands
  })) {
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
 * @param {object} args - Arguments.
 * @param {import("../configuration-types.js").BackendProjectConfiguration[]} args.backendProjects - Backend projects to scan.
 * @param {string} args.currentPath - Request path without query.
 * @returns {{commandName: string, memberId?: string, methodName: string, modelName: string, resourcePath: string, scope: "collection" | "member"} | null} - Matched custom command metadata.
 */
export function frontendModelCustomCommandForPath({backendProjects, currentPath}) {
  const normalizedCurrentPath = normalizeFrontendModelResourcePathForMatch(currentPath)

  for (const backendProject of backendProjects) {
    const resources = frontendModelResourcesForBackendProject(backendProject)

    for (const modelName in resources) {
      const resourceDefinition = resources[modelName]
      const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition)

      if (!resourceConfiguration) {
        continue
      }

      const resourcePath = normalizeFrontendModelResourcePathForMatch(frontendModelResourcePath(modelName, resourceDefinition))
      const expectedPrefix = `${resourcePath}/`

      if (!normalizedCurrentPath.startsWith(expectedPrefix)) {
        continue
      }

      const pathSegments = normalizedCurrentPath
        .slice(expectedPrefix.length)
        .split("/")
        .filter(Boolean)

      if (pathSegments.length === 1) {
        const matchedCollectionCommand = Object.entries(resourceConfiguration.collectionCommands)
          .find(([, commandName]) => commandName === pathSegments[0])

        if (matchedCollectionCommand) {
          return {
            commandName: matchedCollectionCommand[1],
            methodName: matchedCollectionCommand[0],
            modelName,
            resourcePath,
            scope: "collection"
          }
        }
      }

      if (pathSegments.length === 2) {
        const matchedMemberCommand = Object.entries(resourceConfiguration.memberCommands)
          .find(([, commandName]) => commandName === pathSegments[1])

        if (matchedMemberCommand) {
          return {
            commandName: matchedMemberCommand[1],
            memberId: decodeURIComponent(pathSegments[0]),
            methodName: matchedMemberCommand[0],
            modelName,
            resourcePath,
            scope: "member"
          }
        }
      }
    }
  }

  return null
}

/**
 * @param {string} path - Path value.
 * @returns {string} - Normalized path with leading slash and no trailing slash.
 */
function normalizeFrontendModelResourcePathForMatch(path) {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`

  if (withLeadingSlash.length > 1) {
    return withLeadingSlash.replace(/\/+$/, "")
  }

  return withLeadingSlash
}
