/**
 * Asserts a class satisfies the V1 factory model contract: it must be an
 * initialized backend Velocious `DatabaseRecord` subclass. Uninitialized backend
 * classes and non-backend classes (e.g. generated frontend models) are rejected
 * with a named, actionable error rather than failing deep inside construction.
 * @param {ReturnType<typeof JSON.parse>} modelClass - The candidate model class.
 * @param {string} factoryName - Factory name, for the error message.
 * @returns {new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => import("../../database/record/index.js").default} - The validated model class.
 */
export declare function assertModelClass(modelClass: ReturnType<typeof JSON.parse>, factoryName: string): new (attributes?: Record<string, ReturnType<typeof JSON.parse>>) => import("../../database/record/index.js").default;
//# sourceMappingURL=model-contract.d.ts.map