export type FrontendModelInstance = import("./base.js").default;
/**
 * Runs the modelsFromInput helper.
 * @param {FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelOrModels - Model or models.
 * @returns {FrontendModelInstance[]} - Normalized model list.
 */
export declare function modelsFromInput(modelOrModels: FrontendModelInstance | FrontendModelInstance[] | null | undefined): FrontendModelInstance[];
/**
 * Runs the modelsDependencyKey helper.
 * @param {FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelOrModels - Model or models.
 * @returns {string} - Stable dependency key.
 */
export declare function modelsDependencyKey(modelOrModels: FrontendModelInstance | FrontendModelInstance[] | null | undefined): string;
//# sourceMappingURL=event-hook-models.d.ts.map