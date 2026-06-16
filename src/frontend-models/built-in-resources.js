// @ts-check

import VelociousAttachmentResource from "../frontend-model-resource/velocious-attachment-resource.js"
import {frontendModelResourcesForBackendProject} from "./resource-definition.js"

/** @type {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} */
const builtInFrontendModelResources = {
  VelociousAttachment: VelociousAttachmentResource
}

/**
 * Returns backend project resources with framework-owned frontend models.
 * @param {import("../configuration-types.js").BackendProjectConfiguration} backendProject - Backend project config.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelResourceClassType>} - Resource definitions keyed by model name.
 */
export function frontendModelResourcesWithBuiltInsForBackendProject(backendProject) {
  return {
    ...builtInFrontendModelResources,
    ...frontendModelResourcesForBackendProject(backendProject)
  }
}

/**
 * Checks whether a resource definition is a framework-owned built-in resource.
 * @param {object} args - Arguments.
 * @param {string} args.modelName - Frontend model name.
 * @param {import("../configuration-types.js").FrontendModelResourceClassType} args.resourceDefinition - Resource definition.
 * @returns {boolean} - Whether the resource is a framework built-in.
 */
export function frontendModelResourceIsBuiltIn({modelName, resourceDefinition}) {
  return builtInFrontendModelResources[modelName] === resourceDefinition
}
