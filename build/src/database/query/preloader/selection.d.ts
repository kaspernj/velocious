/**
 * Encapsulates the column selection and idempotency rules for preloading.
 *
 * Two per-target-model-name maps drive the behaviour, both keyed by the target
 * model name (e.g. `"Account"`):
 *
 * - `preloadSelects` (from `.select({Account: ["id"]})`) narrows the columns
 *   loaded for that target to the listed attributes (plus the primary/foreign
 *   keys needed to map results back to their parents).
 * - `preloadSelectsExtra` (from `.selectsExtra({Account: ["..."]})`) keeps the
 *   default `SELECT *` columns and loads the listed extra selects in addition.
 *
 * `force` re-loads relationships even when they are already preloaded.
 */
export default class VelociousDatabaseQueryPreloaderSelection {
    preloadSelects: Record<string, string[]>;
    preloadSelectsExtra: Record<string, string[]>;
    force: boolean;
    /**
     * Runs constructor.
     * @param {object} [args] - Options object.
     * @param {Record<string, string[]>} [args.preloadSelects] - Narrowing selects keyed by target model name.
     * @param {Record<string, string[]>} [args.preloadSelectsExtra] - Extra selects keyed by target model name.
     * @param {boolean} [args.force] - Whether to re-load already-preloaded relationships.
     */
    constructor({ preloadSelects, preloadSelectsExtra, force }?: {
        preloadSelects?: Record<string, string[]>;
        preloadSelectsExtra?: Record<string, string[]>;
        force?: boolean;
    });
    /**
     * Runs get force.
     * @returns {boolean} - Whether already-preloaded relationships should still be re-loaded.
     */
    getForce(): boolean;
    /**
     * Runs narrowing for.
     * @param {typeof import("../../record/index.js").default} targetModelClass - Target model class.
     * @returns {string[] | undefined} - Narrowing select attributes for the class, if any.
     */
    _narrowingFor(targetModelClass: typeof import("../../record/index.js").default): string[] | undefined;
    /**
     * Runs extra for.
     * @param {typeof import("../../record/index.js").default} targetModelClass - Target model class.
     * @returns {string[] | undefined} - Extra select attributes/expressions for the class, if any.
     */
    _extraFor(targetModelClass: typeof import("../../record/index.js").default): string[] | undefined;
    /**
     * Apply the configured select clauses to a target query.
     * @template {import("../model-class-query.js").default} T
     * @param {object} args - Options object.
     * @param {T} args.query - Target query to apply selects to.
     * @param {typeof import("../../record/index.js").default} args.targetModelClass - Target model class.
     * @param {string[]} args.mappingColumns - Columns that must always be loaded so results can be mapped back to parents (primary/foreign keys).
     * @returns {T} - The query, with selects applied when a selection is configured.
     */
    applyToQuery<T extends import("../model-class-query.js").default>({ query, targetModelClass, mappingColumns }: {
        query: T;
        targetModelClass: typeof import("../../record/index.js").default;
        mappingColumns: string[];
    }): T;
    /**
     * Whether an already-preloaded relationship's loaded target(s) satisfy the
     * configured selection, so the relationship can be skipped. Returns false
     * when `force` is set, when the relationship hasn't been preloaded, or when a
     * required column is missing from a loaded target.
     * @param {object} args - Options object.
     * @param {import("../../record/instance-relationships/base.js").default} args.instanceRelationship - The source model's instance relationship.
     * @param {typeof import("../../record/index.js").default} args.targetModelClass - Target model class.
     * @param {string[]} args.mappingColumns - Primary/foreign key columns required for mapping.
     * @returns {boolean} - Whether the relationship is already satisfied.
     */
    isSatisfied({ instanceRelationship, targetModelClass, mappingColumns }: {
        instanceRelationship: import("../../record/instance-relationships/base.js").default;
        targetModelClass: typeof import("../../record/index.js").default;
        mappingColumns: string[];
    }): boolean;
    /**
     * The set of columns that must be present on a loaded target for it to count
     * as satisfied. Returns null when satisfaction can't be verified (an extra
     * select is a raw SQL expression whose resulting column can't be derived), in
     * which case the relationship is always re-loaded.
     * @param {object} args - Options object.
     * @param {typeof import("../../record/index.js").default} args.targetModelClass - Target model class.
     * @param {string[]} args.mappingColumns - Primary/foreign key columns required for mapping.
     * @returns {string[] | null} - Required column names, or null when unverifiable.
     */
    _requiredColumnsFor({ targetModelClass, mappingColumns }: {
        targetModelClass: typeof import("../../record/index.js").default;
        mappingColumns: string[];
    }): string[] | null;
}
//# sourceMappingURL=selection.d.ts.map