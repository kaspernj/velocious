/**
 * Register a frontend model class so it can be resolved by name in relationship lookups.
 * Uses resourceConfig().modelName when available to support minified builds where class names are mangled.
 * @param {ReturnType<typeof JSON.parse>} modelClass - Model class to register.
 * @returns {void}
 */
export declare function registerFrontendModel(modelClass: ReturnType<typeof JSON.parse>): void;
/**
 * Resolve a relationship model class value that may be a class reference or a string name.
 * @param {ReturnType<typeof JSON.parse>} value - Class or class name string.
 * @returns {ReturnType<typeof JSON.parse>} - Resolved model class or null.
 */
export declare function resolveFrontendModelClass(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
//# sourceMappingURL=model-registry.d.ts.map