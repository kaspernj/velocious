/**
 * ModelScopeDescriptor type.
 * @typedef {object} ModelScopeDescriptor
 * @property {true} [velociousModelScopeDescriptor] - Internal marker.
 * @property {(...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} callback - Scope callback.
 * @property {typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass} modelClass - Owning model class.
 * @property {Array<ReturnType<typeof JSON.parse>>} scopeArgs - Scope arguments.
 */
// @ts-check

const MODEL_SCOPE_DESCRIPTOR_MARKER = "velociousModelScopeDescriptor"

/**
 * Runs the defineModelScope helper.
 * @param {object} args - Definition arguments.
 * @param {(...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} args.callback - Scope callback.
 * @param {typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass} args.modelClass - Owning model class.
 * @param {(modelClass?: typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass) => ReturnType<typeof JSON.parse>} args.startQuery - Factory that returns a fresh query for the invoked model class.
 * @returns {((...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) & {scope: (...args: Array<ReturnType<typeof JSON.parse>>) => ModelScopeDescriptor}} - Scope helper.
 */
export function defineModelScope({callback, modelClass, startQuery}) {
  /**
   * Runs defined scope.
   * @this {typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass | undefined}
   * @param {...ReturnType<typeof JSON.parse>} scopeArgs - Scope arguments.
   * @returns {ReturnType<typeof JSON.parse>} - Scoped root query.
   */
  function definedScope(...scopeArgs) {
    const invokedModelClass = typeof this === "function" ? this : modelClass

    return startQuery(invokedModelClass).scope(definedScope.scope(...scopeArgs))
  }

  /**
   * Builds a reusable scope descriptor.
   * @param {...ReturnType<typeof JSON.parse>} scopeArgs - Scope arguments.
   * @returns {ModelScopeDescriptor} - Reusable scope descriptor.
   */
  definedScope.scope = (...scopeArgs) => ({
    [MODEL_SCOPE_DESCRIPTOR_MARKER]: true,
    callback,
    modelClass,
    scopeArgs
  })

  return definedScope
}

/**
 * Runs the isModelScopeDescriptor helper.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate descriptor.
 * @returns {value is ModelScopeDescriptor} - Whether the value is a scope descriptor.
 */
export function isModelScopeDescriptor(value) {
  return Boolean(value && typeof value === "object" && /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value)[MODEL_SCOPE_DESCRIPTOR_MARKER] === true)
}
