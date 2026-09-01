export type InstanceRelationshipsBaseArgs<MC extends typeof import("../index.js").default = typeof import("../index.js").default, TMC extends typeof import("../index.js").default = typeof import("../index.js").default> = {
    /**
     * - Parent model instance.
     */
    model: InstanceType<MC>;
    /**
     * - Relationship metadata definition.
     */
    relationship: import("../relationships/base.js").default;
};
/**
 * InstanceRelationshipsBaseArgs type.
 * @template {typeof import("../index.js").default} [MC=typeof import("../index.js").default]
 * @template {typeof import("../index.js").default} [TMC=typeof import("../index.js").default]
 * @typedef {object} InstanceRelationshipsBaseArgs
 * @property {InstanceType<MC>} model - Parent model instance.
 * @property {import("../relationships/base.js").default} relationship - Relationship metadata definition.
 */
/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} [MC=typeof import("../index.js").default]
 * @template {typeof import("../index.js").default} [TMC=typeof import("../index.js").default]
 */
export default class VelociousDatabaseRecordBaseInstanceRelationship<MC extends typeof import("../index.js").default = typeof import("../index.js").default, TMC extends typeof import("../index.js").default = typeof import("../index.js").default> {
    _dirty: boolean;
    model: InstanceType<MC>;
    relationship: import("../relationships/base.js").default;
    /**
     * Auto save.
     * @type {boolean | undefined} */
    _autoSave: boolean | undefined;
    /**
     * Preloaded.
     * @type {boolean | undefined} */
    _preloaded: boolean | undefined;
    /**
     * Loaded.
     * @type {InstanceType<TMC> | Array<InstanceType<TMC>> | undefined} */
    _loaded: InstanceType<TMC> | Array<InstanceType<TMC>> | undefined;
    /**
     * Runs constructor.
     * @param {InstanceRelationshipsBaseArgs<MC, TMC>} args - Options object.
     */
    constructor({ model, relationship }: InstanceRelationshipsBaseArgs<MC, TMC>);
    /**
     * Runs add to loaded.
     * @abstract
     * @param {InstanceType<TMC>[] | InstanceType<TMC>} models - Model instances.
     * @returns {void} - No return value.
     */
    addToLoaded(models: InstanceType<TMC>[] | InstanceType<TMC>): void;
    /**
     * Runs build.
     * @abstract
     * @param {ConstructorParameters<TMC>[0]} attributes - Target model write attributes.
     * @returns {InstanceType<TMC>} - The build.
     */
    build(attributes: ConstructorParameters<TMC>[0]): InstanceType<TMC>;
    /**
     * Resolves a relationship target through the source record's operation and
     * metadata generation before construction.
     * @returns {TMC | undefined} - Bound target model class.
     */
    getBoundTargetModelClass(): TMC | undefined;
    /**
     * Runs get auto save.
     * @returns {boolean | undefined} Whether the relationship should be auto-saved before saving the parent model
     */
    getAutoSave(): boolean | undefined;
    /**
     * Runs set auto save.
     * @param {boolean} newAutoSaveValue Whether the relationship should be auto-saved before saving the parent model
     * @returns {void} - No return value.
     */
    setAutoSave(newAutoSaveValue: boolean): void;
    /**
     * Runs set dirty.
     * @param {boolean} newValue Whether the relationship is dirty (has been modified)
     * @returns {void} - No return value.
     */
    setDirty(newValue: boolean): void;
    /**
     * Runs get dirty.
     * @returns {boolean} Whether the relationship is dirty (has been modified)
     */
    getDirty(): boolean;
    /**
     * Runs load.
     * @abstract
     * @returns {Promise<InstanceType<TMC> | Array<InstanceType<TMC>> | undefined>} - Resolves with loaded relationship value.
     */
    load(): Promise<InstanceType<TMC> | Array<InstanceType<TMC>> | undefined>;
    /**
     * Loads the relationship if not already loaded. When the parent record was
     * loaded as part of a batch (cohort) and autoload is enabled, siblings in
     * the cohort that share this relationship and have not preloaded it yet
     * are batched into a single query via the existing preloader path.
     * @returns {Promise<InstanceType<TMC> | Array<InstanceType<TMC>> | undefined>} - Resolves with loaded relationship value.
     */
    autoloadOrLoad(): Promise<InstanceType<TMC> | Array<InstanceType<TMC>> | undefined>;
    /**
     * Attempts to batch-load this relationship across cohort siblings via the
     * existing preloader path. Returns true when a batch ran (self is always
     * included because callers reset their own `_preloaded` state before
     * calling), false when autoload is off, there is no cohort, or no batch
     * candidates remain. Siblings that have already preloaded this relationship
     * are skipped so their cached value is preserved.
     * @returns {Promise<boolean>} - Whether a cohort batch preload ran.
     */
    _tryCohortPreload(): Promise<boolean>;
    /**
     * Runs is loaded.
     * @returns {boolean} Whether the relationship has been preloaded
     */
    isLoaded(): boolean;
    /**
     * Runs loaded.
     * @returns {InstanceType<TMC> | Array<InstanceType<TMC>> | undefined} The loaded model or models (depending on relationship type)
     */
    loaded(): InstanceType<TMC> | Array<InstanceType<TMC>> | undefined;
    /**
     * Runs set loaded.
     * @param {InstanceType<TMC> | Array<InstanceType<TMC>> | undefined} model - Related model(s) to mark as loaded.
     */
    setLoaded(model: InstanceType<TMC> | Array<InstanceType<TMC>> | undefined): void;
    /**
     * Runs get loaded or undefined.
     * @returns {InstanceType<TMC> | InstanceType<TMC>[] | undefined} - The loaded or undefined.
     */
    getLoadedOrUndefined(): InstanceType<TMC> | InstanceType<TMC>[] | undefined;
    /**
     * Runs get preloaded.
     * @returns {boolean} The loaded model or models (depending on relationship type)
     */
    getPreloaded(): boolean;
    /**
     * Runs set preloaded.
     * @param {boolean} isPreloaded - Whether the relationship is preloaded.
     */
    setPreloaded(isPreloaded: boolean): void;
    /**
     * Runs get foreign key.
     * @returns {string} The foreign key for this relationship
     */
    getForeignKey(): string;
    /**
     * Runs get model.
     * @returns {InstanceType<MC>} - The model.
     */
    getModel(): InstanceType<MC>;
    /**
     * Runs get primary key.
     * @returns {string} The primary key for this relationship's model
     */
    getPrimaryKey(): string;
    /**
     * Runs get relationship.
     * @returns {import("../relationships/base.js").default} The relationship object that this instance relationship is based on
     */
    getRelationship(): import("../relationships/base.js").default;
    /**
     * Runs apply scope.
     * @template T
     * @param {T} query - Query instance.
     * @returns {T} - Scoped query.
     */
    applyScope<T>(query: T): T;
    /**
     * Runs get target model class.
     * @returns {TMC | undefined} The model class that this instance relationship
     */
    getTargetModelClass(): TMC | undefined;
    /**
     * Runs get type.
     * @returns {string} The type of relationship (e.g. "has_many", "belongs_to", etc.)
     */
    getType(): string;
}
//# sourceMappingURL=base.d.ts.map