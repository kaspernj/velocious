import PreloaderSelection from "./selection.js";
export default class VelociousDatabaseQueryPreloaderHasOne {
    models: import("../../record/index.js").default<Record<string, any>>[];
    relationship: import("../../record/relationships/has-one.js").default;
    selection: PreloaderSelection;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Array<import("../../record/index.js").default>} args.models - Model instances.
     * @param {import("../../record/relationships/has-one.js").default} args.relationship - Relationship.
     * @param {PreloaderSelection} [args.selection] - Column selection and idempotency rules.
     */
    constructor({ models, relationship, selection, ...restArgs }: {
        models: Array<import("../../record/index.js").default>;
        relationship: import("../../record/relationships/has-one.js").default;
        selection?: PreloaderSelection;
    });
    run(): Promise<import("../../record/index.js").default<Record<string, any>>[]>;
}
//# sourceMappingURL=has-one.d.ts.map