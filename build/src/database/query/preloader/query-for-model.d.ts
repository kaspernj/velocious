/**
 * Binds a preload target to the source records' physical database generation.
 * @template {typeof import("../../record/index.js").default} MC
 * @param {import("../../record/index.js").default[]} models - Source records.
 * @param {MC} ModelClass - Target model class.
 * @returns {MC} - Generation-bound target model class.
 */
export declare function bindPreloadModelClass<MC extends typeof import("../../record/index.js").default>(models: import("../../record/index.js").default[], ModelClass: MC): MC;
/**
 * Builds a target query preserving the explicit database operation owned by
 * the source records.
 * @template {typeof import("../../record/index.js").default} MC
 * @param {import("../../record/index.js").default[]} models - Source records.
 * @param {MC} ModelClass - Target model class.
 * @returns {import("../model-class-query.js").default<MC>} - Target query.
 */
export default function preloadQueryForModel<MC extends typeof import("../../record/index.js").default>(models: import("../../record/index.js").default[], ModelClass: MC): import("../model-class-query.js").default<MC>;
//# sourceMappingURL=query-for-model.d.ts.map