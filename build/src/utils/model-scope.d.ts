/**
 * ModelScopeDescriptor type.
 * @typedef {object} ModelScopeDescriptor
 * @property {true} [velociousModelScopeDescriptor] - Internal marker.
 * @property {(...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} callback - Scope callback.
 * @property {typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass} modelClass - Owning model class.
 * @property {Array<ReturnType<typeof JSON.parse>>} scopeArgs - Scope arguments.
 */
export type ModelScopeDescriptor = {
    /**
     * - Internal marker.
     */
    velociousModelScopeDescriptor?: true;
    /**
     * - Scope callback.
     */
    callback: (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>;
    /**
     * - Owning model class.
     */
    modelClass: typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass;
    /**
     * - Scope arguments.
     */
    scopeArgs: Array<ReturnType<typeof JSON.parse>>;
};
/**
 * Runs the defineModelScope helper.
 * @param {object} args - Definition arguments.
 * @param {(...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} args.callback - Scope callback.
 * @param {typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass} args.modelClass - Owning model class.
 * @param {(modelClass?: typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass) => ReturnType<typeof JSON.parse>} args.startQuery - Factory that returns a fresh query for the invoked model class.
 * @returns {((...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) & {scope: (...args: Array<ReturnType<typeof JSON.parse>>) => ModelScopeDescriptor}} - Scope helper.
 */
export declare function defineModelScope({ callback, modelClass, startQuery }: {
    callback: (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>;
    modelClass: typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass;
    startQuery: (modelClass?: typeof import("../database/record/index.js").default | import("../frontend-models/base.js").FrontendModelClass) => ReturnType<typeof JSON.parse>;
}): ((...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>) & {
    scope: (...args: Array<ReturnType<typeof JSON.parse>>) => ModelScopeDescriptor;
};
/**
 * Runs the isModelScopeDescriptor helper.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate descriptor.
 * @returns {value is ModelScopeDescriptor} - Whether the value is a scope descriptor.
 */
export declare function isModelScopeDescriptor(value: ReturnType<typeof JSON.parse>): value is ModelScopeDescriptor;
//# sourceMappingURL=model-scope.d.ts.map