export type RelationshipScopeCallback = (query: import("../../query/model-class-query.js").default<typeof import("../index.js").default>) => (import("../../query/model-class-query.js").default<typeof import("../index.js").default> | void);
export type RelationshipRecordResolver = (record: import("../index.js").default) => VelociousDatabaseRecordBaseRelationship;
export type RelationshipBaseArgsType = {
    /**
     * - Whether to auto-batch-preload siblings when this relationship is lazy-loaded. Default true.
     */
    autoload?: boolean;
    /**
     * - Name of the related model class.
     */
    className?: string;
    /**
     * - Auto-sync parent count column on create/update/destroy.
     */
    counterCache?: boolean;
    /**
     * - Dependent action when parent is destroyed.
     */
    dependent?: string;
    /**
     * - Explicit foreign key column name.
     */
    foreignKey?: string | undefined;
    /**
     * - Inverse relationship name on the related model.
     */
    inverseOf?: string;
    /**
     * - Related model class.
     */
    klass?: typeof import("../index.js").default;
    /**
     * - Owning model class.
     */
    modelClass: typeof import("../index.js").default;
    /**
     * - Primary key column on the owning model.
     */
    primaryKey?: string;
    /**
     * - Whether the relationship is polymorphic.
     */
    polymorphic?: boolean;
    /**
     * - Name of the relationship on the model.
     */
    relationshipName: string;
    /**
     * - Optional scope callback for the relationship.
     */
    scope?: RelationshipScopeCallback;
    /**
     * - Name of the through association.
     */
    through?: string;
    /**
     * - Relationship type (e.g. "hasMany").
     */
    type: string;
};
/**
 * RelationshipScopeCallback type.
 * @typedef {(query: import("../../query/model-class-query.js").default<typeof import("../index.js").default>) => (import("../../query/model-class-query.js").default<typeof import("../index.js").default> | void)} RelationshipScopeCallback
 */
/**
 * RelationshipRecordResolver type.
 * @typedef {(record: import("../index.js").default) => VelociousDatabaseRecordBaseRelationship} RelationshipRecordResolver
 */
/**
 * RelationshipBaseArgsType type.
 * @typedef {object} RelationshipBaseArgsType
 * @property {boolean} [autoload] - Whether to auto-batch-preload siblings when this relationship is lazy-loaded. Default true.
 * @property {string} [className] - Name of the related model class.
 * @property {boolean} [counterCache] - Auto-sync parent count column on create/update/destroy.
 * @property {string} [dependent] - Dependent action when parent is destroyed.
 * @property {string | undefined} [foreignKey] - Explicit foreign key column name.
 * @property {string} [inverseOf] - Inverse relationship name on the related model.
 * @property {typeof import("../index.js").default} [klass] - Related model class.
 * @property {typeof import("../index.js").default} modelClass - Owning model class.
 * @property {string} [primaryKey] - Primary key column on the owning model.
 * @property {boolean} [polymorphic] - Whether the relationship is polymorphic.
 * @property {string} relationshipName - Name of the relationship on the model.
 * @property {RelationshipScopeCallback} [scope] - Optional scope callback for the relationship.
 * @property {string} [through] - Name of the through association.
 * @property {string} type - Relationship type (e.g. "hasMany").
 */
export default class VelociousDatabaseRecordBaseRelationship {
    _autoload: boolean;
    className: string | undefined;
    _counterCache: boolean;
    _dependent: string | undefined;
    foreignKey: string | undefined;
    _explicitForeignKey: string | undefined;
    _inverseOf: string | undefined;
    klass: typeof import("../index.js").default | undefined;
    modelClass: typeof import("../index.js").default;
    _polymorphic: boolean | undefined;
    _primaryKey: string;
    relationshipName: string;
    _scope: RelationshipScopeCallback | undefined;
    through: string | undefined;
    type: string;
    _recordResolver: RelationshipRecordResolver | undefined;
    _polymorphicTypeColumn: string | undefined;
    /**
     * Runs constructor.
     * @param {RelationshipBaseArgsType} args - Relationship definition arguments.
     */
    constructor({ autoload, className, counterCache, dependent, foreignKey, inverseOf, klass, modelClass, primaryKey, polymorphic, relationshipName, scope, through, type, ...restArgs }: RelationshipBaseArgsType);
    /**
     * Installs metadata selection for relationships whose physical definition varies by record operation.
     * @param {RelationshipRecordResolver} resolver - Record-owned relationship resolver.
     * @returns {void}
     */
    setRecordResolver(resolver: RelationshipRecordResolver): void;
    /**
     * Resolves this relationship for a record's captured physical database identity.
     * @param {import("../index.js").default} record - Record owning the relationship access.
     * @returns {VelociousDatabaseRecordBaseRelationship} - Physical relationship metadata.
     */
    resolveForRecord(record: import("../index.js").default): VelociousDatabaseRecordBaseRelationship;
    /**
     * Runs get autoload.
     * @returns {boolean} Whether this relationship auto-batch-preloads siblings on lazy access.
     */
    getAutoload(): boolean;
    getConfiguration(): import("../../../configuration.js").default;
    /**
     * Runs get counter cache.
     * @returns {boolean} Whether a counter cache column is synced on the parent.
     */
    getCounterCache(): boolean;
    /**
     * Runs get dependent.
     * @returns {string | undefined} What will be done when the parent record is destroyed. E.g. "destroy", "nullify", "restrict" etc.
     */
    getDependent(): string | undefined;
    /**
     * The foreign key explicitly passed when the relationship was declared, if any. Unlike
     * `getForeignKey()` this never falls back to a computed default, so callers can tell whether the
     * developer named a specific column (e.g. to disambiguate multiple belongs-to on a through target).
     * @returns {string | undefined} - The explicitly declared foreign key, or undefined.
     */
    getExplicitForeignKey(): string | undefined;
    /**
     * Runs get foreign key.
     * @abstract
     * @returns {string} The name of the foreign key, e.g. "user_id", "post_id" etc.
     */
    getForeignKey(): string;
    /**
     * Resolves an attribute-form foreign key through the model class that owns the physical column.
     * @param {object} args - Bound relationship model classes.
     * @param {typeof import("../index.js").default} args.modelClass - Relationship source model class.
     * @param {typeof import("../index.js").default} args.targetModelClass - Relationship target model class.
     * @returns {string} - Physical foreign-key column name.
     */
    getForeignKeyForModelClasses({ modelClass, targetModelClass }: {
        modelClass: typeof import("../index.js").default;
        targetModelClass: typeof import("../index.js").default;
    }): string;
    /**
     * Runs get inverse of.
     * @abstract
     * @returns {string | undefined} The name of the inverse relationship, e.g. "posts", "comments" etc.
     */
    getInverseOf(): string | undefined;
    /**
     * Runs get model class.
     * @returns {typeof import("../index.js").default} - The model class.
     */
    getModelClass(): typeof import("../index.js").default;
    /**
     * Runs get relationship name.
     * @returns {string} The name of the relationship, e.g. "posts", "user", "comments" etc.
     */
    getRelationshipName(): string;
    /**
     * Runs get scope.
     * @returns {RelationshipScopeCallback | undefined} - The scope callback.
     */
    getScope(): RelationshipScopeCallback | undefined;
    /**
     * Runs apply scope.
     * @template T
     * @param {T} query - Query instance.
     * @returns {T} - Scoped query.
     */
    applyScope<T>(query: T): T;
    /**
     * Runs get polymorphic.
     * @returns {boolean} - Whether polymorphic.
     */
    getPolymorphic(): boolean;
    /**
     * Runs get polymorphic type column.
     * @returns {string} - The polymorphic type column.
     */
    getPolymorphicTypeColumn(): string;
    /**
     * Runs get primary key.
     * @returns {string} The name of the foreign key, e.g. "id" etc.
     */
    getPrimaryKey(): string;
    /**
     * Runs get type.
     * @returns {string} The type of the relationship, e.g. "has_many", "belongs_to", "has_one", "has_and_belongs_to_many" etc.
     */
    getType(): string;
    /**
     * Runs get target model class.
     * @returns {typeof import("../index.js").default | undefined} The target model class for this relationship, e.g. if the relationship is "posts" then the target model class is the Post class.
     */
    getTargetModelClass(): typeof import("../index.js").default | undefined;
}
//# sourceMappingURL=base.d.ts.map