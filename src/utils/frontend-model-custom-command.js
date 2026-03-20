// @ts-check

import {validateFrontendModelResourceCommandName, validateFrontendModelResourcePath} from "../frontend-models/resource-config-validation.js"

/**
 * @param {object} args - Arguments.
 * @param {string} args.commandName - Command path segment.
 * @param {string} args.modelName - Frontend model class name.
 * @param {string | number | null | undefined} [args.memberId] - Optional member id.
 * @param {string} args.resourcePath - Resource path prefix.
 * @returns {string} - Command URL.
 */
export function frontendModelCustomCommandUrl({commandName, memberId, modelName, resourcePath}) {
  const validatedResourcePath = validateFrontendModelResourcePath({modelName, resourcePath})
  const validatedCommandName = validateFrontendModelResourceCommandName({commandName, commandType: commandName, modelName})

  if (memberId === undefined || memberId === null || memberId === "") {
    return `${validatedResourcePath}/${validatedCommandName}`
  }

  return `${validatedResourcePath}/${encodeURIComponent(String(memberId))}/${validatedCommandName}`
}
