/**
 * Loads Velocious factory definition files (Node only). Each file must
 * default-export a `(registry) => void` function that defines into the registry.
 * Files load in deterministic path order. This module is intentionally Node-only
 * (filesystem + dynamic import) and must never be imported from browser/Metro
 * bundles; import the browser-safe core from `../index.js` there instead.
 * @param {import("../factory-registry.js").default} registry - Registry to define into.
 * @param {string | string[]} target - File path, directory, or list of paths.
 * @param {{reload?: boolean}} [options] - Options.
 * @returns {Promise<string[]>} - The loaded file paths, in load order.
 */
export declare function loadDefinitions(registry: import("../factory-registry.js").default, target: string | string[], { reload }?: {
    reload?: boolean;
}): Promise<string[]>;
/**
 * Fully reloads definitions: resets the registry (dropping every factory, trait,
 * sequence, callback and default) and re-imports the target files with cache
 * busting so edited definitions take effect. The resolved batch is preflighted
 * against the process-global import budget before the reset, and a
 * `DefinitionRecycleRequiredError` is raised before any mutation when the batch
 * would exceed the budget.
 * @param {import("../factory-registry.js").default} registry - Registry to reload.
 * @param {string | string[]} target - File path, directory, or list of paths.
 * @returns {Promise<string[]>} - The reloaded file paths, in load order.
 */
export declare function reloadDefinitions(registry: import("../factory-registry.js").default, target: string | string[]): Promise<string[]>;
//# sourceMappingURL=load-definitions.d.ts.map