// @ts-check

const MODEL_SCOPE_DESCRIPTOR_MARKER = "velociousModelScopeDescriptor"

/**
 * @typedef {object} ModelScopeDescriptor
 * @property {true} [velociousModelScopeDescriptor] - Internal marker.
 * @property {(...args: any[]) => any} callback - Scope callback.
 * @property {typeof import("../database/record/index.js").default | typeof import("../frontend-models/base.js").default} modelClass - Owning model class.
 * @property {any[]} scopeArgs - Scope arguments.
 */

/**
 * @param {object} args - Definition arguments.
 * @param {(...args: any[]) => any} args.callback - Scope callback.
 * @param {typeof import("../database/record/index.js").default | typeof import("../frontend-models/base.js").default} args.modelClass - Owning model class.
 * @param {() => any} args.startQuery - Factory that returns a fresh query for the owning model class.
 * @returns {((...args: any[]) => any) & {scope: (...args: any[]) => ModelScopeDescriptor}} - Scope helper.
 */
export function defineModelScope({callback, modelClass, startQuery}) {
  /**
   * @param {...any} scopeArgs - Scope arguments.
   * @returns {any} - Scoped root query.
   */
  function definedScope(...scopeArgs) {
    return startQuery().scope(definedScope.scope(...scopeArgs))
  }

  /**
   * @param {...any} scopeArgs - Scope arguments.
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
 * @param {unknown} value - Candidate descriptor.
 * @returns {value is ModelScopeDescriptor} - Whether the value is a scope descriptor.
 */
export function isModelScopeDescriptor(value) {
  return Boolean(value && typeof value === "object" && /** @type {Record<string, any>} */ (value)[MODEL_SCOPE_DESCRIPTOR_MARKER] === true)
}
