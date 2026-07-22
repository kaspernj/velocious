// @ts-check

import DatabaseRecord from "../../database/record/index.js"
import {ModelContractError} from "./errors.js"

/**
 * Asserts a class satisfies the V1 factory model contract: it must be an
 * initialized backend Velocious `DatabaseRecord` subclass. Uninitialized backend
 * classes and non-backend classes (e.g. generated frontend models) are rejected
 * with a named, actionable error rather than failing deep inside construction.
 * @param {?} modelClass - The candidate model class.
 * @param {string} factoryName - Factory name, for the error message.
 * @returns {new (attributes?: Record<string, ?>) => import("../../database/record/index.js").default} - The validated model class.
 */
export function assertModelClass(modelClass, factoryName) {
  if (typeof modelClass !== "function") {
    throw new ModelContractError(`Factory "${factoryName}" has no model class to construct. Declare one with factory("${factoryName}", ModelClass, ...).`)
  }

  if (!(modelClass.prototype instanceof DatabaseRecord)) {
    throw new ModelContractError(`Factory "${factoryName}" model ${modelClass.name || "class"} is not a supported Velocious backend record. build/create require an initialized DatabaseRecord subclass; generated frontend models are not supported in V1.`)
  }

  const backendModelClass = /** @type {typeof import("../../database/record/index.js").default} */ (modelClass)

  if (!backendModelClass.isInitialized()) {
    throw new ModelContractError(`Factory "${factoryName}" model ${backendModelClass.name} has not been initialized. Ensure the model class is initialized (e.g. via configuration.initialize()/ensureInitialized) before build/create.`)
  }

  return /** @type {new (attributes?: Record<string, ?>) => import("../../database/record/index.js").default} */ (modelClass)
}
