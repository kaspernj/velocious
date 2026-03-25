// @ts-check

/** @type {Map<string, any>} */
const frontendModelRegistry = new Map()

/**
 * Register a frontend model class so it can be resolved by name in relationship lookups.
 * @param {any} modelClass - Model class to register.
 * @returns {void}
 */
export function registerFrontendModel(modelClass) {
  frontendModelRegistry.set(modelClass.name, modelClass)
}

/**
 * Resolve a relationship model class value that may be a class reference or a string name.
 * @param {any} value - Class or class name string.
 * @returns {any} - Resolved model class or null.
 */
export function resolveFrontendModelClass(value) {
  if (!value) return null
  if (typeof value === "string") return frontendModelRegistry.get(value) || null

  return value
}
