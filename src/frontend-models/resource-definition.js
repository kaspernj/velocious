// @ts-check

import * as inflection from "inflection"
import FrontendModelBaseResource from "../frontend-model-resource/base-resource.js"
import {validateFrontendModelResourceCommandName, validateFrontendModelResourcePath} from "./resource-config-validation.js"

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
 * @returns {import("../configuration-types.js").FrontendModelResourceConfiguration | null} - Normalized resource configuration.
 */
export function frontendModelResourceConfigurationFromDefinition(resourceDefinition) {
  if (!frontendModelResourceDefinitionIsClass(resourceDefinition)) return null

  return resourceDefinition.resourceConfig()
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

  return `/${inflection.dasherize(inflection.pluralize(modelName))}`
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
