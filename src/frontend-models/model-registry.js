// @ts-check

/** @type {Map<string, ReturnType<typeof JSON.parse>>} */
const frontendModelRegistry = new Map()

/**
 * Register a frontend model class so it can be resolved by name in relationship lookups.
 * Uses resourceConfig().modelName when available to support minified builds where class names are mangled.
 * @param {ReturnType<typeof JSON.parse>} modelClass - Model class to register.
 * @returns {void}
 */
export function registerFrontendModel(modelClass) {
  const modelName = modelClass.getModelName()

  frontendModelRegistry.set(modelName, modelClass)
}

/**
 * Resolve a relationship model class value that may be a class reference or a string name.
 * @param {ReturnType<typeof JSON.parse>} value - Class or class name string.
 * @returns {ReturnType<typeof JSON.parse>} - Resolved model class or null.
 */
export function resolveFrontendModelClass(value) {
  if (!value) return null
  if (typeof value === "string") return frontendModelRegistry.get(value) || null

  return value
}
