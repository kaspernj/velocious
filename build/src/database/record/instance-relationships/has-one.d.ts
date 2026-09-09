import BaseInstanceRelationship from "./base.js";
/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} MC
 * @template {typeof import("../index.js").default} TMC
 * @augments {BaseInstanceRelationship<MC, TMC>}
 */
export default class VelociousDatabaseRecordHasOneInstanceRelationship<MC extends typeof import("../index.js").default, TMC extends typeof import("../index.js").default> extends BaseInstanceRelationship<MC, TMC> {
    /**
     * Runs constructor.
     * @param {import("./base.js").InstanceRelationshipsBaseArgs<MC, TMC>} args - Options object.
     */
    constructor(args: import("./base.js").InstanceRelationshipsBaseArgs<MC, TMC>);
    /**
     * Loaded.
     * @type {InstanceType<TMC> | undefined} */
    _loaded: InstanceType<TMC> | undefined;
    /**
     * Runs build.
     * @param {ConstructorParameters<TMC>[0]} data - Target model write attributes.
     * @returns {InstanceType<TMC>} - The build.
     */
    build(data: ConstructorParameters<TMC>[0]): InstanceType<TMC>;
    load(): Promise<InstanceType<TMC>[] | InstanceType<TMC> | undefined>;
    /**
     * Runs loaded.
     * @returns {InstanceType<TMC> | Array<InstanceType<TMC>> | undefined} The loaded model or models (depending on relationship type)
     */
    loaded(): InstanceType<TMC> | Array<InstanceType<TMC>> | undefined;
    getLoadedOrUndefined(): InstanceType<TMC> | undefined;
    /**
     * Runs set loaded.
     * @param {InstanceType<TMC> | Array<InstanceType<TMC>> | undefined} model - Related model(s).
     */
    setLoaded(model: InstanceType<TMC> | Array<InstanceType<TMC>> | undefined): void;
    getTargetModelClass(): TMC | undefined;
}
//# sourceMappingURL=has-one.d.ts.map