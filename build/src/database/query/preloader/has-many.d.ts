import PreloaderSelection from "./selection.js";
/**
 * Resolves the target column that references the through model.
 * @param {import("../../record/relationships/has-many.js").default} relationship - Has-many through relationship.
 * @param {typeof import("../../record/index.js").default} throughModelClass - Model used by the through relationship.
 * @param {typeof import("../../record/index.js").default} targetModelClass - Model loaded by the through relationship.
 * @returns {string} Target model foreign key column.
 */
export declare function hasManyThroughTargetForeignKey(relationship: import("../../record/relationships/has-many.js").default, throughModelClass: typeof import("../../record/index.js").default, targetModelClass: typeof import("../../record/index.js").default): string;
export default class VelociousDatabaseQueryPreloaderHasMany {
    models: import("../../record/index.js").default<Record<string, any>>[];
    relationship: import("../../record/relationships/has-many.js").default;
    selection: PreloaderSelection;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../record/index.js").default[]} args.models - Model instances.
     * @param {import("../../record/relationships/has-many.js").default} args.relationship - Relationship.
     * @param {PreloaderSelection} [args.selection] - Column selection and idempotency rules.
     */
    constructor({ models, relationship, selection, ...restArgs }: {
        models: import("../../record/index.js").default[];
        relationship: import("../../record/relationships/has-many.js").default;
        selection?: PreloaderSelection;
    });
    /**
     * Runs run.
     * @returns {Promise<import("../../record/index.js").default[]>} - Loaded target models.
     */
    run(): Promise<import("../../record/index.js").default[]>;
    /**
     * Partitions `this.models` into those already satisfied by the current
     * selection (skip) and those that still need loading. Satisfied models'
     * already-loaded targets are collected so nested preloads keep working.
     * @param {typeof import("../../record/index.js").default} targetModelClass - Target model class.
     * @param {string[]} mappingColumns - Columns required for mapping (foreign key).
     * @returns {{modelsToLoad: import("../../record/index.js").default[], satisfiedTargets: import("../../record/index.js").default[]}} - The partition.
     */
    _partition(targetModelClass: typeof import("../../record/index.js").default, mappingColumns: string[]): {
        modelsToLoad: import("../../record/index.js").default[];
        satisfiedTargets: import("../../record/index.js").default[];
    };
    /**
     * Preload through a join table (e.g. hasMany("invoiceGroups", {through: "invoiceGroupLinks"})).
     * @returns {Promise<import("../../record/index.js").default[]>} - Loaded target models.
     */
    _runThrough(): Promise<import("../../record/index.js").default[]>;
    /**
     * Preload direct has-many relationships.
     * @returns {Promise<import("../../record/index.js").default[]>} - Loaded target models.
     */
    _runDirect(): Promise<import("../../record/index.js").default[]>;
}
//# sourceMappingURL=has-many.d.ts.map