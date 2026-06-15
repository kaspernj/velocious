// @ts-check

const MODEL_SCOPE_DESCRIPTOR_MARKER = "velociousModelScopeDescriptor"

/**
 * ModelScopeDescriptor type.
 * @typedef {object} ModelScopeDescriptor
 * @property {true} [velociousModelScopeDescriptor] - Internal marker.
 * @property {(...args: Array<?>) => ?} callback - Scope callback.
 * @property {typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass} modelClass - Owning model class.
 * @property {Array<?>} scopeArgs - Scope arguments.
 */

/**
 * Runs the defineModelScope helper.
 * @param {object} args - Definition arguments.
 * @param {(...args: Array<?>) => ?} args.callback - Scope callback.
 * @param {typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass} args.modelClass - Owning model class.
 * @param {() => ?} args.startQuery - Factory that returns a fresh query for the owning model class.
 * @returns {((...args: Array<?>) => ?) & {scope: (...args: Array<?>) => ModelScopeDescriptor}} - Scope helper.
 */
export function defineModelScope({callback, modelClass, startQuery}) {
  /**
   * Runs defined scope.
   * @param {...?} scopeArgs - Scope arguments.
   * @returns {?} - Scoped root query.
   */
  function definedScope(...scopeArgs) {
    return startQuery().scope(definedScope.scope(...scopeArgs))
  }

  /**
   * Builds a reusable scope descriptor.
   * @param {...?} scopeArgs - Scope arguments.
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
 * @param {?} value - Candidate descriptor.
 * @returns {value is ModelScopeDescriptor} - Whether the value is a scope descriptor.
 */
export function isModelScopeDescriptor(value) {
  return Boolean(value && typeof value === "object" && /**
                                                        * Narrows the runtime value to the documented type.
                                                        * @type {Record<string, ?>} */ (value)[MODEL_SCOPE_DESCRIPTOR_MARKER] === true)
}
