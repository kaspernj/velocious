import PreloaderSelection from "./selection.js";
export default class VelociousDatabaseQueryPreloaderBelongsTo {
    models: import("../../record/index.js").default<Record<string, any>>[];
    relationship: import("../../record/relationships/belongs-to.js").default;
    selection: PreloaderSelection;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../record/index.js").default[]} args.models - Model instances.
     * @param {import("../../record/relationships/belongs-to.js").default} args.relationship - Relationship.
     * @param {PreloaderSelection} [args.selection] - Column selection and idempotency rules.
     */
    constructor({ models, relationship, selection, ...restArgs }: {
        models: import("../../record/index.js").default[];
        relationship: import("../../record/relationships/belongs-to.js").default;
        selection?: PreloaderSelection;
    });
    run(): Promise<import("../../record/index.js").default<Record<string, any>>[] | {
        targetModels: import("../../record/index.js").default[];
        targetModelsByClassName: Record<string, import("../../record/index.js").default[]>;
    }>;
    /**
     * Preload a polymorphic belongsTo, grouping models by their target type so
     * each concrete target model class is queried separately.
     * @param {object} args - Options object.
     * @param {string} args.foreignKey - Foreign key column.
     * @param {string} args.primaryKey - Primary key column on the target.
     * @param {string} args.relationshipName - Relationship name.
     * @returns {Promise<{targetModels: import("../../record/index.js").default[], targetModelsByClassName: Record<string, import("../../record/index.js").default[]>}>} - Loaded targets and a per-class-name grouping.
     */
    _runPolymorphic({ foreignKey, primaryKey, relationshipName }: {
        foreignKey: string;
        primaryKey: string;
        relationshipName: string;
    }): Promise<{
        targetModels: import("../../record/index.js").default[];
        targetModelsByClassName: Record<string, import("../../record/index.js").default[]>;
    }>;
}
//# sourceMappingURL=belongs-to.d.ts.map