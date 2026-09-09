import BaseInstanceRelationship from "./base.js";
/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} MC
 * @template {typeof import("../index.js").default} TMC
 * @augments {BaseInstanceRelationship<MC, TMC>}
 */
export default class VelociousDatabaseRecordBelongsToInstanceRelationship<MC extends typeof import("../index.js").default, TMC extends typeof import("../index.js").default> extends BaseInstanceRelationship<MC, TMC> {
    /**
     * Runs constructor.
     * @param {import("./base.js").InstanceRelationshipsBaseArgs<MC, TMC>} args - Options object.
     */
    constructor(args: import("./base.js").InstanceRelationshipsBaseArgs<MC, TMC>);
    /**
     * Runs build.
     * @param {ConstructorParameters<TMC>[0]} data - Target model write attributes.
     * @returns {InstanceType<TMC>} - The build.
     */
    build(data: ConstructorParameters<TMC>[0]): InstanceType<TMC>;
    getLoadedOrUndefined(): InstanceType<TMC>[] | InstanceType<TMC> | undefined;
    load(): Promise<InstanceType<TMC>[] | InstanceType<TMC> | undefined>;
    /**
     * Loads the foreign model, or marks the relationship blank for empty keys.
     * @returns {Promise<void>} - Resolves after the loaded value is assigned.
     */
    _loadForeignModelOrBlank(): Promise<void>;
    /**
     * Loads the related model from the foreign key value.
     * @param {object} args - Options.
     * @param {string | number | null | undefined} args.foreignModelID - Foreign model ID.
     * @param {TMC} args.TargetModelClass - Target model class.
     * @returns {Promise<InstanceType<TMC> | undefined>} - Loaded foreign model.
     */
    _loadForeignModel({ foreignModelID, TargetModelClass }: {
        foreignModelID: string | number | null | undefined;
        TargetModelClass: TMC;
    }): Promise<InstanceType<TMC> | undefined>;
    /**
     * Gets the required target model class.
     * @returns {TMC} - Target model class.
     */
    _getTargetModelClassOrFail(): TMC;
    /**
     * Reads the current foreign key value from the parent record.
     * @returns {string | number | null | undefined} - Foreign model ID.
     */
    _readForeignModelID(): string | number | null | undefined;
}
//# sourceMappingURL=belongs-to.d.ts.map