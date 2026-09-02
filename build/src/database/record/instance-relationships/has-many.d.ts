import BaseInstanceRelationship from "./base.js";
/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} MC
 * @template {typeof import("../index.js").default} TMC
 * @augments {BaseInstanceRelationship<MC, TMC>}
 */
export default class VelociousDatabaseRecordHasManyInstanceRelationship<MC extends typeof import("../index.js").default, TMC extends typeof import("../index.js").default> extends BaseInstanceRelationship<MC, TMC> {
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
    /**
     * Runs create.
     * @param {ConstructorParameters<TMC>[0]} data - Target model write attributes.
     * @returns {Promise<InstanceType<TMC>>} - Resolves with the create.
     */
    create(data: ConstructorParameters<TMC>[0]): Promise<InstanceType<TMC>>;
    /**
     * Runs load.
     * @returns {Promise<InstanceType<TMC>[]>} - Resolves with loaded models.
     */
    load(): Promise<InstanceType<TMC>[]>;
    /**
     * Runs to array.
     * @returns {Promise<InstanceType<TMC>[]>} - Resolves with the array.
     */
    toArray(): Promise<InstanceType<TMC>[]>;
    /**
     * Runs size.
     * @returns {Promise<number>} - Resolves with the relationship size, using loaded records when available.
     */
    size(): Promise<number>;
    /**
     * Runs preload.
     * @param {import("../../query/index.js").NestedPreloadRecord} preloads - Preload map for related records.
     * @returns {import("../../query/model-class-query.js").default<TMC>} - The preload.
     */
    preload(preloads: import("../../query/index.js").NestedPreloadRecord): import("../../query/model-class-query.js").default<TMC>;
    /**
     * Runs find.
     * @param {string | number} modelID - Related model identifier.
     * @returns {Promise<InstanceType<TMC>>} - Resolves with the find.
     */
    find(modelID: string | number): Promise<InstanceType<TMC>>;
    /**
     * Runs query.
     * @returns {import("../../query/model-class-query.js").default<TMC>} - The query.
     */
    query(): import("../../query/model-class-query.js").default<TMC>;
    /**
     * Runs loaded.
     * @returns {Array<InstanceType<TMC>>} The loaded model or models (depending on relationship type)
     */
    loaded(): Array<InstanceType<TMC>>;
    /**
     * Runs add to loaded.
     * @param {InstanceType<TMC>[] | InstanceType<TMC>} models - Model instances.
     * @returns {void} - No return value.
     */
    addToLoaded(models: InstanceType<TMC>[] | InstanceType<TMC>): void;
    /**
     * Runs set loaded.
     * @param {InstanceType<TMC>[]} models - Model instances.
     * @returns {void} - No return value.
     */
    setLoaded(models: InstanceType<TMC>[]): void;
}
//# sourceMappingURL=has-many.d.ts.map