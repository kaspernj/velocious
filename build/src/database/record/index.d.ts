export type ValidationErrorObjectType = {
    type: string;
    message: string;
};
export type LifecycleCallbackType<T = VelociousDatabaseRecord> = ((model: T) => void | Promise<void>) | string;
export type ModelConstructor<T> = {
    new (changes?: Record<string, unknown>): T;
};
export type RestrictInstanceRelationship = import("./instance-relationships/base.js").default & {
    query: () => ModelClassQuery<typeof VelociousDatabaseRecord>;
};
export type TenantDatabaseProviderType = import("../../configuration-types.js").TenantDatabaseProviderType;
export type RecordMetadataValue = boolean | null | string | undefined | Promise<void> | string[] | import("../drivers/base-column.js").default[] | import("../drivers/base-table.js").default | Record<string, string> | Record<string, string | undefined> | Record<string, import("../drivers/base-column.js").default>;
/**
 * Defines this typedef.
 * @typedef {{type: string, message: string}} ValidationErrorObjectType
 */
/**
 * LifecycleCallbackType type.
 * @template [T=VelociousDatabaseRecord]
 * @typedef {((model: T) => void | Promise<void>) | string} LifecycleCallbackType
 */
/**
 * Model class constructor type used for static `this` typing.
 * @template T
 * @typedef {{new (changes?: Record<string, unknown>): T}} ModelConstructor
 */
/**
 * RestrictInstanceRelationship type.
 * @typedef {import("./instance-relationships/base.js").default & {query: () => ModelClassQuery<typeof VelociousDatabaseRecord>}} RestrictInstanceRelationship
 */
/** @typedef {import("../../configuration-types.js").TenantDatabaseProviderType} TenantDatabaseProviderType */
/**
 * Schema metadata cached for one record class and physical database generation.
 * @typedef {boolean | null | string | undefined | Promise<void> | string[] | import("../drivers/base-column.js").default[] | import("../drivers/base-table.js").default | Record<string, string> | Record<string, string | undefined> | Record<string, import("../drivers/base-column.js").default>} RecordMetadataValue
 */
import { AdvisoryLockBusyError, AdvisoryLockHoldTimeoutError, AdvisoryLockTimeoutError } from "../advisory-lock-runner.js";
import Configuration from "../../configuration.js";
import RecordAttachmentHandle from "./attachments/handle.js";
import ModelClassQuery from "../query/model-class-query.js";
import TenantModelScope from "../../tenants/tenant-model-scope.js";
export type TranslationBase = VelociousDatabaseRecord & {
    locale: () => string;
};
export type AttachmentDriverConstructor = import("../../configuration-types.js").AttachmentDriverConstructor;
export type AttachmentSyncConfiguration = import("../../configuration-types.js").AttachmentSyncConfiguration;
export type RecordAttachmentConfiguration = import("../../configuration-types.js").RecordAttachmentConfiguration;
declare class ValidationError extends Error {
    _model: VelociousDatabaseRecord<Record<string, any>> | undefined;
    _validationErrors: Record<string, ValidationErrorObjectType[]> | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} - Velocious metadata for frontend-model error reporting.
     */
    velocious: Record<string, ReturnType<typeof JSON.parse>> | undefined;
    /**
     * Runs get model.
     * @returns {VelociousDatabaseRecord} - The model.
     */
    getModel(): VelociousDatabaseRecord;
    /**
     * Runs set model.
     * @param {VelociousDatabaseRecord} model - Model instance.
     * @returns {void} - No return value.
     */
    setModel(model: VelociousDatabaseRecord): void;
    /**
     * Runs get validation errors.
     * @returns {Record<string, ValidationErrorObjectType[]>} - The validation errors.
     */
    getValidationErrors(): Record<string, ValidationErrorObjectType[]>;
    /**
     * Runs set validation errors.
     * @param {Record<string, ValidationErrorObjectType[]>} validationErrors - Validation errors to assign.
     */
    setValidationErrors(validationErrors: Record<string, ValidationErrorObjectType[]>): void;
}
declare class TenantDatabaseScopeError extends Error {
    modelName: string;
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {{modelName: string}} args - Context for the failed tenant-scoped model.
     */
    constructor(message: string, { modelName }: {
        modelName: string;
    });
}
export type RelationshipScopeCallback = (query: import("../query/model-class-query.js").default<typeof VelociousDatabaseRecord>) => (import("../query/model-class-query.js").default<typeof VelociousDatabaseRecord> | void);
export type RelationshipDataArgumentType = {
    /**
     * - Disable auto-batch-preload for this relationship by passing false. Default true.
     */
    autoload?: boolean;
    /**
     * - Model class name for the related record.
     */
    className?: string;
    /**
     * - Dependent action when parent is destroyed (e.g. "destroy").
     */
    dependent?: string;
    /**
     * - Model class for the related record.
     */
    klass?: typeof VelociousDatabaseRecord;
    /**
     * - Optional scope callback for the relationship.
     */
    scope?: RelationshipScopeCallback;
    /**
     * - Relationship type (e.g. "hasMany", "belongsTo").
     */
    type?: string;
};
/**
 * Base database record.
 * @template {Record<string, ReturnType<typeof JSON.parse>>} [WriteAttributes=Record<string, ReturnType<typeof JSON.parse>>]
 */
declare class VelociousDatabaseRecord<WriteAttributes extends Record<string, ReturnType<typeof JSON.parse>> = Record<string, ReturnType<typeof JSON.parse>>> {
    static _configuration: Configuration | undefined;
    static _initialized: boolean | undefined;
    static _databaseType: string | undefined;
    static _table: import("../drivers/base-table.js").default | undefined;
    static _columns: import("../drivers/base-column.js").default[] | undefined;
    static _databaseIdentifier: string | undefined;
    static _tenantDatabaseIdentifierResolver: string | ((args: {
        modelClass: typeof VelociousDatabaseRecord;
        tenant: Record<string, unknown> | null | undefined;
    }) => string | undefined) | undefined;
    static _primaryKey: string | undefined;
    static _tableName: string | undefined;
    static _translationClass: {
        new (changes?: Record<string, any>): {
            /**
             * Attributes.
             * @type {Record<string, ReturnType<typeof JSON.parse>>} */
            _attributes: Record<string, ReturnType<typeof JSON.parse>>;
            /**
             * Changes.
             * @type {Record<string, ReturnType<typeof JSON.parse>>} */
            _changes: Record<string, ReturnType<typeof JSON.parse>>;
            /**
             * Changes captured before a create audit is written.
             * @type {import("./auditing.js").AuditChanges | undefined} */
            _pendingCreateAuditChanges: import("./auditing.js").AuditChanges | undefined;
            /**
             * Changes captured before an update audit is written.
             * @type {import("./auditing.js").AuditChanges | undefined} */
            _pendingUpdateAuditChanges: import("./auditing.js").AuditChanges | undefined;
            /**
             * Attribute names explicitly assigned in the current update call.
             * @type {Set<string> | undefined}
             */
            _assignedAttributeNames: Set<string> | undefined;
            /**
             * Columns as hash.
             * @type {Record<string, import("../drivers/base-column.js").default>} */
            _columnsAsHash: Record<string, import("../drivers/base-column.js").default>;
            /**
             * Connection.
             * @type {import("../drivers/base.js").default | undefined} */
            __connection: import("../drivers/base.js").default | undefined;
            /**
             * Explicit operation owning this record's database work.
             * @type {import("../operation.js").default | undefined} */
            _databaseOperation: import("../operation.js").default | undefined;
            /**
             * Instance relationships.
             * @type {Record<string, import("./instance-relationships/base.js").default>} */
            _instanceRelationships: Record<string, import("./instance-relationships/base.js").default>;
            /**
             * Attachments.
             * @type {Record<string, RecordAttachmentHandle>} */
            _attachments: Record<string, RecordAttachmentHandle>;
            /**
             * Load cohort.
             * @type {Array<VelociousDatabaseRecord> | undefined} - Shared reference to sibling records loaded in the same batch. Used by auto-preload.
             */
            _loadCohort: Array<VelociousDatabaseRecord> | undefined;
            /**
             * Table name.
             * @type {string | undefined} */
            __tableName: string | undefined;
            /**
             * Validation errors.
             * @type {Record<string, ValidationErrorObjectType[]>} */
            _validationErrors: Record<string, ValidationErrorObjectType[]>;
            /**
             * Runs get relationship by name.
             * @param {string} relationshipName - Relationship name.
             * @returns {import("./instance-relationships/base.js").default} - The relationship by name.
             */
            getRelationshipByName(relationshipName: string): import("./instance-relationships/base.js").default;
            /**
             * Preloads relationship(s) onto this already-loaded record. Accepts either a
             * query built via `Model.preload(...).select(...)` or a raw preload spec
             * (string / array / nested object). A relationship that is already preloaded
             * with all the required columns present is left untouched unless `force` is
             * set. Preloading onto the relationship cache lets later accessors reuse the
             * loaded data instead of issuing identical queries.
             * @param {import("../query/model-class-query.js").default | import("../query/index.js").NestedPreloadRecord | string | Array<string | import("../query/index.js").NestedPreloadRecord>} queryOrSpec - Preload source.
             * @param {{force?: boolean}} [options] - Options.
             * @returns {Promise<void>} - Resolves when preloading completes.
             */
            preload(queryOrSpec: import("../query/model-class-query.js").default | import("../query/index.js").NestedPreloadRecord | string | Array<string | import("../query/index.js").NestedPreloadRecord>, options?: {
                force?: boolean;
            }): Promise<void>;
            /**
             * Runs load relationship.
             * @param {string} relationshipName - Relationship name.
             * @returns {Promise<ReturnType<typeof JSON.parse>>} - Loaded relationship value.
             */
            loadRelationship(relationshipName: string): Promise<ReturnType<typeof JSON.parse>>;
            /**
             * Runs relationship or load.
             * @param {string} relationshipName - Relationship name.
             * @param {{preloadTranslations?: boolean}} [options] - Load options.
             * @returns {Promise<ReturnType<typeof JSON.parse>>} - Loaded relationship value.
             */
            relationshipOrLoad(relationshipName: string, options?: {
                preloadTranslations?: boolean;
            }): Promise<ReturnType<typeof JSON.parse>>;
            /**
             * Preloads translations on a loaded relationship target when explicitly requested.
             * @param {ReturnType<typeof JSON.parse>} loaded - Loaded relationship value.
             * @returns {Promise<ReturnType<typeof JSON.parse>>} - Relationship value after translation preload.
             */
            _preloadLoadedRelationshipTranslations(loaded: ReturnType<typeof JSON.parse>): Promise<ReturnType<typeof JSON.parse>>;
            /**
             * Runs get attachment by name.
             * @param {string} attachmentName - Attachment name.
             * @returns {RecordAttachmentHandle} - Attachment handle.
             */
            getAttachmentByName(attachmentName: string): RecordAttachmentHandle;
            /**
             * Runs get configuration.
             * @returns {import("../../configuration.js").default} - The configuration.
             */
            _getConfiguration(): import("../../configuration.js").default;
            /**
             * Runs has attribute.
             * @param {ReturnType<typeof JSON.parse>} value - Value to use.
             * @returns {boolean} - Whether attribute.
             */
            _hasAttribute(value: ReturnType<typeof JSON.parse>): boolean;
            /**
             * Runs get attribute.
             * @param {string} name - Name.
             * @returns {ReturnType<typeof JSON.parse>} - The attribute.
             */
            getAttribute(name: string): ReturnType<typeof JSON.parse>;
            /**
             * Runs get model class.
             * @abstract
             * @returns {typeof VelociousDatabaseRecord} - The model class.
             */
            getModelClass(): typeof VelociousDatabaseRecord;
            /**
             * Runs set attribute.
             * @param {string} name - Name.
             * @param {ReturnType<typeof JSON.parse>} newValue - New value.
             * @returns {void} - No return value.
             */
            setAttribute(name: string, newValue: ReturnType<typeof JSON.parse>): void;
            /**
             * Runs set column attribute.
             * @param {string} name - Name.
             * @param {ReturnType<typeof JSON.parse>} newValue - New value.
             */
            _setColumnAttribute(name: string, newValue: ReturnType<typeof JSON.parse>): void;
            /**
             * Clears loaded belongs-to caches when callers assign the foreign key directly.
             * @param {string} columnName - Changed database column name.
             * @param {ReturnType<typeof JSON.parse>} normalizedValue - New normalized column value.
             * @returns {void} - No return value.
             */
            _clearBelongsToRelationshipForChangedForeignKey(columnName: string, normalizedValue: ReturnType<typeof JSON.parse>): void;
            /**
             * Runs belongs to relationships for foreign key.
             * @param {string} columnName - Changed database column name.
             * @returns {Array<ReturnType<typeof JSON.parse>>} - Loaded relationship instances that use the changed foreign key.
             */
            _belongsToRelationshipsForForeignKey(columnName: string): Array<ReturnType<typeof JSON.parse>>;
            /**
             * Runs belongs to relationship uses foreign key.
             * @param {object} args - Relationship match arguments.
             * @param {string} args.columnName - Changed database column name.
             * @param {ReturnType<typeof JSON.parse>} args.relationship - Relationship instance.
             * @returns {boolean} - Whether the relationship is a belongs-to using the changed foreign key.
             */
            _belongsToRelationshipUsesForeignKey({ columnName, relationship }: {
                columnName: string;
                relationship: ReturnType<typeof JSON.parse>;
            }): boolean;
            /**
             * Runs belongs to relationship matches foreign key value.
             * @param {object} args - Relationship cache arguments.
             * @param {ReturnType<typeof JSON.parse>} args.normalizedValue - New normalized column value.
             * @param {ReturnType<typeof JSON.parse>} args.relationship - Relationship instance.
             * @returns {boolean} - Whether the loaded related record still matches the changed foreign key.
             */
            _belongsToRelationshipMatchesForeignKeyValue({ normalizedValue, relationship }: {
                normalizedValue: ReturnType<typeof JSON.parse>;
                relationship: ReturnType<typeof JSON.parse>;
            }): boolean;
            /**
             * Returns the foreign key value for a belongs-to relationship assignment.
             * @param {object} args - Relationship assignment arguments.
             * @param {VelociousDatabaseRecord | null | undefined} args.model - Assigned model.
             * @param {import("./instance-relationships/base.js").default} args.relationship - Belongs-to relationship instance.
             * @returns {string | number | null | undefined} - Foreign key value for the assignment.
             */
            _belongsToForeignKeyValue({ model, relationship }: {
                model: VelociousDatabaseRecord | null | undefined;
                relationship: import("./instance-relationships/base.js").default;
            }): string | number | null | undefined;
            /**
             * Runs clear loaded belongs to relationship.
             * @param {ReturnType<typeof JSON.parse>} relationship - Relationship instance.
             * @returns {void} - No return value.
             */
            _clearLoadedBelongsToRelationship(relationship: ReturnType<typeof JSON.parse>): void;
            /**
             * Runs normalize date value.
             * @param {ReturnType<typeof JSON.parse>} value - Value to use.
             * @returns {ReturnType<typeof JSON.parse>} - The date value.
             */
            _normalizeDateValue(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
            /**
             * Runs normalize sqlite boolean value.
             * @param {object} args - Options object.
             * @param {string | undefined} args.columnType - Column type.
             * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
             * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
             */
            _normalizeSqliteBooleanValue({ columnType, value }: {
                columnType: string | undefined;
                value: ReturnType<typeof JSON.parse>;
            }): ReturnType<typeof JSON.parse>;
            /**
             * Normalizes a boolean value before storing. A declared `"boolean"` attribute cast stores
             * booleans as 1/0 only for integer-backed columns (e.g. an MSSQL `bit`). Columns whose
             * underlying type is already a native boolean (e.g. Postgres `boolean`) keep `true`/`false`
             * so the driver can emit the proper boolean literal; otherwise the sqlite-only normalizer applies.
             * @param {object} args - Options object.
             * @param {string} args.attributeName - Attribute name being written.
             * @param {string | undefined} args.columnType - Column type.
             * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
             * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
             */
            _normalizeBooleanValueForWrite({ attributeName, columnType, value }: {
                attributeName: string;
                columnType: string | undefined;
                value: ReturnType<typeof JSON.parse>;
            }): ReturnType<typeof JSON.parse>;
            /**
             * Runs save.
             * @returns {Promise<void>} - Resolves when complete.
             */
            save(): Promise<void>;
            _autoSaveBelongsToRelationships(): Promise<{
                savedCount: number;
            }>;
            _autoSaveHasManyAndHasOneRelationshipsToSave(): import("./instance-relationships/base.js").default<typeof VelociousDatabaseRecord, typeof VelociousDatabaseRecord>[];
            /**
             * Resolves a relationship foreign-key column to this model's public attribute name.
             * @param {import("./instance-relationships/base.js").default<typeof VelociousDatabaseRecord, typeof VelociousDatabaseRecord>} instanceRelationship - Relationship instance.
             * @returns {string} Attribute name accepted by setAttribute/assign.
             */
            _relationshipForeignKeyAttribute(instanceRelationship: import("./instance-relationships/base.js").default<typeof VelociousDatabaseRecord, typeof VelociousDatabaseRecord>): string;
            /**
             * Runs auto save has many and has one relationships.
             * @param {object} args - Options object.
             * @param {boolean} args.isNewRecord - Whether is new record.
             */
            _autoSaveHasManyAndHasOneRelationships({ isNewRecord }: {
                isNewRecord: boolean;
            }): Promise<void>;
            /**
             * Runs auto save attachments.
             * @returns {Promise<void>} - Resolves when pending attachments have been saved.
             */
            _autoSaveAttachments(): Promise<void>;
            /**
             * Runs translations loaded.
             * @abstract
             * @returns {TranslationBase[]} - The translations loaded.
             */
            translationsLoaded(): TranslationBase[];
            /**
             * Runs get translated attribute.
             * @param {string} name - Name.
             * @param {string} locale - Locale.
             * @returns {string | undefined} - The translated attribute, if found.
             */
            _getTranslatedAttribute(name: string, locale: string): string | undefined;
            /**
             * Runs get translated attribute with fallback.
             * @param {string} name - Name.
             * @param {string} locale - Locale.
             * @returns {string | undefined} - The translated attribute with fallback, if found.
             */
            _getTranslatedAttributeWithFallback(name: string, locale: string): string | undefined;
            /**
             * Runs set translated attribute.
             * @param {string} name - Name.
             * @param {string} locale - Locale.
             * @param {ReturnType<typeof JSON.parse>} newValue - New value.
             * @returns {void} - No return value.
             */
            _setTranslatedAttribute(name: string, locale: string, newValue: ReturnType<typeof JSON.parse>): void;
            _isNewRecord: boolean;
            /**
             * Binds future query, lifecycle, relationship, and persistence work to an operation.
             * @param {import("../operation.js").default} operation - Owning operation.
             * @returns {this} - Bound record.
             */
            bindDatabaseOperation(operation: import("../operation.js").default): /*elided*/ any;
            /**
             * Captures and validates the physical database identity that owns this record.
             * @param {string} databaseIdentity - Opaque operation/connection identity.
             * @returns {this} This record.
             */
            captureDatabaseIdentity(databaseIdentity: string): /*elided*/ any;
            _databaseIdentity: string | undefined;
            /**
             * Returns the captured physical database identity.
             * @returns {string | undefined} Captured physical database identity.
             */
            databaseIdentity(): string | undefined;
            /**
             * Releases this record from a completed eager-helper operation while
             * preserving the legacy ambient follow-up behavior of `usingTenant` finders.
             * @param {import("../operation.js").default} operation - Releasing operation.
             * @returns {this} - Record.
             */
            releaseDatabaseOperation(operation: import("../operation.js").default): /*elided*/ any;
            /**
             * Returns the explicit operation owning this record, if any.
             * @returns {import("../operation.js").default | undefined} - Owning operation.
             */
            databaseOperation(): import("../operation.js").default | undefined;
            /**
             * Binds a related record to the same operation as this record.
             * @template {VelociousDatabaseRecord} Model
             * @param {Model} record - Related record.
             * @returns {Model} - Related record.
             */
            bindRelatedRecord<Model extends VelociousDatabaseRecord>(record: Model): Model;
            /**
             * Builds a model query preserving this record's operation ownership.
             * @template {typeof VelociousDatabaseRecord} MC
             * @param {MC} ModelClass - Target model class.
             * @returns {ModelClassQuery<MC>} - Target query.
             */
            queryForModel<MC extends typeof VelociousDatabaseRecord>(ModelClass: MC): ModelClassQuery<MC>;
            /**
             * Initializes a relationship/preload target without dropping this record's
             * explicit operation connection.
             * @param {typeof VelociousDatabaseRecord} ModelClass - Target model class.
             * @param {import("../../configuration.js").default} configuration - Owning configuration.
             * @returns {Promise<void>} - Resolves when initialized.
             */
            ensureModelClassInitialized(ModelClass: typeof VelociousDatabaseRecord, configuration: import("../../configuration.js").default): Promise<void>;
            /**
             * Runs load existing record.
             * @param {object} attributes - Attributes.
             * @returns {void} - No return value.
             */
            loadExistingRecord(attributes: object): void;
            /**
             * Assigns the given attributes to the record.
             * @param {Record<string, ReturnType<typeof JSON.parse>>} attributesToAssign - Attributes to assign.
             * @returns {void} - No return value.
             */
            assign(attributesToAssign: Record<string, ReturnType<typeof JSON.parse>>): void;
            /**
             * Returns a the current attributes of the record (original attributes from database plus changes)
             * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The attributes.
             */
            attributes(): Record<string, ReturnType<typeof JSON.parse>>;
            /**
             * Returns column-name keyed data (original attributes from database plus changes)
             * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The raw attributes.
             */
            rawAttributes(): Record<string, ReturnType<typeof JSON.parse>>;
            /**
             * Runs connection.
             * @returns {import("../drivers/base.js").default} - The connection.
             */
            _connection(): import("../drivers/base.js").default;
            /**
             * Resolves the identity of an already selected concrete connection.
             * @param {import("../drivers/base.js").default} connection - Concrete connection.
             * @returns {string} Physical database identity.
             */
            _databaseIdentityForConnection(connection: import("../drivers/base.js").default): string;
            /**
             * Returns the connection that owns this record's database work.
             * @returns {import("../drivers/base.js").default} - Connection.
             */
            connection(): import("../drivers/base.js").default;
            /**
             * Counts dependent records for a `dependent: "restrict"` relationship.
             * @param {RestrictInstanceRelationship} instanceRelationship - Relationship instance to count.
             * @returns {Promise<number>} - Dependent row count.
             */
            _dependentRestrictCount(instanceRelationship: RestrictInstanceRelationship): Promise<number>;
            /**
             * Counts tenant-scoped dependent records across all provider-listed tenants.
             * @param {RestrictInstanceRelationship} instanceRelationship - Relationship instance to count.
             * @param {typeof VelociousDatabaseRecord} TargetModelClass - Related model class.
             * @returns {Promise<number>} - Dependent row count.
             */
            _dependentRestrictTenantCount(instanceRelationship: RestrictInstanceRelationship, TargetModelClass: typeof VelociousDatabaseRecord): Promise<number>;
            /**
             * Counts tenant-scoped dependent records for one configured tenant provider.
             * @param {RestrictInstanceRelationship} instanceRelationship - Relationship instance to count.
             * @param {typeof VelociousDatabaseRecord} TargetModelClass - Related model class.
             * @param {string} identifier - Tenant database identifier.
             * @param {TenantDatabaseProviderType} provider - Tenant database provider.
             * @returns {Promise<number>} - Dependent row count.
             */
            _dependentRestrictProviderCount(instanceRelationship: RestrictInstanceRelationship, TargetModelClass: typeof VelociousDatabaseRecord, identifier: string, provider: TenantDatabaseProviderType): Promise<number>;
            /**
             * Lists restrict-check tenants for one configured tenant provider.
             * @param {RestrictInstanceRelationship} instanceRelationship - Relationship instance to count.
             * @param {typeof VelociousDatabaseRecord} TargetModelClass - Related model class.
             * @param {string} identifier - Tenant database identifier.
             * @param {TenantDatabaseProviderType} provider - Tenant database provider.
             * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Listed tenant objects.
             */
            _dependentRestrictProviderTenants(instanceRelationship: RestrictInstanceRelationship, TargetModelClass: typeof VelociousDatabaseRecord, identifier: string, provider: TenantDatabaseProviderType): Promise<Array<ReturnType<typeof JSON.parse>>>;
            /**
             * Destroys the record in the database and all of its dependent records.
             * @returns {Promise<void>} - Resolves when complete.
             */
            destroy(): Promise<void>;
            /**
             * Emits a committed record-change event after the surrounding transaction
             * commits, so live queries re-run uniformly for local writes, pull applies, and
             * realtime applies (which all end as local saves/destroys). Registered through
             * the connection's afterCommit hook so a rolled-back save emits nothing, and
             * skipped entirely when nothing observes this model class so server-side saves
             * stay free of live-query overhead.
             * @param {import("../record-changes.js").RecordChangeOperation} operation - The committed operation.
             * @returns {Promise<void>}
             */
            _emitRecordChangeAfterCommit(operation: import("../record-changes.js").RecordChangeOperation): Promise<void>;
            /**
             * Stores an audit row for this record.
             * @param {import("./auditing.js").CreateAuditArgs} args - Audit row options.
             * @returns {Promise<number | string>} Created audit row id.
             */
            createAudit(args: import("./auditing.js").CreateAuditArgs): Promise<number | string>;
            /**
             * Captures create changes before persistence clears the change set.
             * @returns {void}
             */
            captureCreateAuditChanges(): void;
            /**
             * Writes the create audit row.
             * @returns {Promise<void>}
             */
            createCreateAudit(): Promise<void>;
            /**
             * Captures update changes before persistence clears the change set.
             * @returns {void}
             */
            captureUpdateAuditChanges(): void;
            /**
             * Writes the update audit row.
             * @returns {Promise<void>}
             */
            createUpdateAudit(): Promise<void>;
            /**
             * Writes the destroy audit row.
             * @returns {Promise<void>}
             */
            createDestroyAudit(): Promise<void>;
            /**
             * Runs run lifecycle callbacks.
             * @param {"afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation"} callbackName - Callback type.
             * @returns {Promise<void>}
             */
            _runLifecycleCallbacks(callbackName: "afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation"): Promise<void>;
            /**
             * Runs has changes.
             * @returns {boolean} - Whether changes.
             */
            _hasChanges(): boolean;
            /**
             * Returns true if the model has been changed since it was loaded from the database.
             * @returns {boolean} - Whether changed.
             */
            isChanged(): boolean;
            /**
             * Returns the changes that have been made to this record since it was loaded from the database.
             * @returns {Record<string, Array<ReturnType<typeof JSON.parse>>>} - The changes.
             */
            changes(): Record<string, Array<ReturnType<typeof JSON.parse>>>;
            /**
             * Runs table name.
             * @returns {string} - The table name.
             */
            _tableName(): string;
            /**
             * Reads an attribute value from the record. Read dynamically by name, so the value can be any
             * column type and may be overridden by a user-defined getter on the model.
             * @template V
             * @param {string} attributeName The name of the attribute to read. This is the attribute name, not the column name.
             * @returns {V} The attribute value, typed by the caller's accessor contract.
             */
            readAttribute<V>(attributeName: string): V;
            /**
             * Read an association count attached by `.withCount(...)`. Counts are
             * stored on a separate map from the record's `_attributes` so a
             * virtual count like `tasksCount` cannot silently shadow a real
             * column of the same name. Returns the attached number, or 0 when
             * `.withCount(...)` wasn't requested for this attribute.
             * @param {string} attributeName - Attribute name, e.g. `"tasksCount"` or a custom `"activeMembersCount"` from `.withCount({activeMembersCount: {...}})`.
             * @returns {number} - Attached association count, or zero when absent.
             */
            readCount(attributeName: string): number;
            /**
             * Attach an association count to this record. Internal helper used by
             * the `withCount` runner; outside code should not call this directly.
             * @param {string} attributeName - Attribute name.
             * @param {number} value - Count value.
             * @returns {void}
             */
            _setAssociationCount(attributeName: string, value: number): void;
            /**
             * All attached association counts as a plain object. Used by the
             * frontend-model serializer to ship counts alongside the record
             * attributes on the wire.
             * @returns {Record<string, number>} - Association counts keyed by attribute name.
             */
            associationCounts(): Record<string, number>;
            /**
             * Read a value attached by `.queryData(...)`. Stored on a dedicated
             * map rather than on `_attributes`, so a virtual queryData key like
             * `transportSecondsSum` cannot silently shadow a real column of the
             * same name. Returns `null` when the key wasn't produced by any
             * registered fn for this record (e.g. no child rows matched the
             * aggregate).
             * @param {string} name - queryData attribute name (matches a SELECT alias from the registered fn).
             * @returns {ReturnType<typeof JSON.parse>} - Attached query-data value.
             */
            queryData(name: string): ReturnType<typeof JSON.parse>;
            /**
             * Attach a queryData value to this record. Internal helper used by
             * the `queryData` runner and by frontend-model hydration; outside
             * code should not call this directly.
             * @param {string} name - queryData attribute name.
             * @param {ReturnType<typeof JSON.parse>} value - Value to attach.
             * @returns {void}
             */
            _setQueryData(name: string, value: ReturnType<typeof JSON.parse>): void;
            /**
             * All attached queryData values as a plain object. Used by the
             * frontend-model serializer to ship queryData alongside the record
             * attributes on the wire.
             * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Query-data values keyed by name.
             */
            queryDataValues(): Record<string, ReturnType<typeof JSON.parse>>;
            /**
             * Read a per-record ability result attached by `.abilities(...)`. The
             * backend evaluates each requested action against the current ability
             * for this record instance and ships the result alongside the
             * record's attributes. Returns `false` when the action wasn't
             * requested for this record — so UI code can safely branch on
             * `record.can("update")` without first checking whether the ability
             * was loaded.
             * @param {string} action - Ability action name, e.g. `"update"`.
             * @returns {boolean} - Whether the requested ability is allowed.
             */
            can(action: string): boolean;
            /**
             * Attach a per-record ability result to this record. Internal helper
             * used by the `abilities` runner and by frontend-model hydration;
             * outside code should not call this directly.
             * @param {string} action - Ability action name.
             * @param {boolean} value - Whether the current ability permits the action on this record.
             * @returns {void}
             */
            _setComputedAbility(action: string, value: boolean): void;
            /**
             * All attached per-record ability results as a plain object. Used
             * by the frontend-model serializer to ship results alongside the
             * record attributes on the wire.
             * @returns {Record<string, boolean>} - Ability results keyed by action.
             */
            computedAbilities(): Record<string, boolean>;
            /**
             * Reads a column value from the record.
             * @param {string} attributeName The name of the column to read. This is the column name, not the attribute name.
             * @returns {ReturnType<typeof JSON.parse>} - The column.
             */
            readColumn(attributeName: string): ReturnType<typeof JSON.parse>;
            /**
             * Resolves any declared per-attribute cast for a database column name.
             * @param {string} columnName - Database column name.
             * @returns {string | undefined} - Declared cast type, or undefined when none is declared.
             */
            _declaredAttributeCastForColumn(columnName: string): string | undefined;
            /**
             * Converts a stored value to a real boolean for a declared `"boolean"` cast.
             * Leaves null/undefined untouched; treats 1/true/"1" as true and 0/false/"0" as false.
             * @param {ReturnType<typeof JSON.parse>} value - Stored database value.
             * @returns {ReturnType<typeof JSON.parse>} - Converted boolean, or the original value when not recognized.
             */
            _castDeclaredBooleanForRead(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
            /**
             * Whether a column value is currently loaded on this record (either as a
             * persisted attribute or a pending change). Used to decide whether a preload
             * can be skipped because the required columns are already present.
             * @param {string} columnName - The column name to check.
             * @returns {boolean} - Whether the column is loaded.
             */
            hasLoadedColumn(columnName: string): boolean;
            /**
             * Runs normalize boolean value for read. A declared `"boolean"` attribute cast converts the
             * stored value (e.g. an MSSQL `bit` 0/1) to a real boolean; otherwise the existing
             * introspected-type normalization applies (no behaviour change for non-declared columns).
             * @param {object} args - Options object.
             * @param {string} args.columnName - Database column name being read.
             * @param {string | undefined} args.columnType - Column type.
             * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
             * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
             */
            _normalizeBooleanValueForRead({ columnName, columnType, value }: {
                columnName: string;
                columnType: string | undefined;
                value: ReturnType<typeof JSON.parse>;
            }): ReturnType<typeof JSON.parse>;
            /**
             * Runs normalize date value for read.
             * @param {ReturnType<typeof JSON.parse>} value - Value from database.
             * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
             */
            _normalizeDateValueForRead(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
            _belongsToChanges(): Record<string, any>;
            /**
             * Runs create new record.
             * @returns {Promise<void>} - Resolves when complete.
             */
            _createNewRecord(): Promise<void>;
            /**
             * Marks only relationships with in-memory loaded values as preloaded after create.
             * @returns {void} - No return value.
             */
            _markLoadedRelationshipsPreloadedAfterCreate(): void;
            /**
             * Applies the database insert response to this record.
             * @param {{connection: import("../drivers/base.js").default, data: Record<string, string | number | boolean | Date | null | undefined>, insertResult: Array<Record<string, string | number | boolean | Date | null | undefined>> | null | undefined, primaryKey: string}} options - Pinned insert connection, inserted data, connection result, and primary key column name.
             * @returns {Promise<void>} - Resolves when complete.
             */
            _applyInsertResult({ connection, data, insertResult, primaryKey }: {
                connection: import("../drivers/base.js").default;
                data: Record<string, string | number | boolean | Date | null | undefined>;
                insertResult: Array<Record<string, string | number | boolean | Date | null | undefined>> | null | undefined;
                primaryKey: string;
            }): Promise<void>;
            /**
             * Sets timestamp defaults for a new record insert.
             * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Column-keyed data.
             * @returns {void} - No return value.
             */
            _setDefaultTimestampValues(data: Record<string, ReturnType<typeof JSON.parse>>): void;
            /**
             * Runs normalize date values for write.
             * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Column-keyed data.
             * @returns {void} - No return value.
             */
            _normalizeDateValuesForWrite(data: Record<string, ReturnType<typeof JSON.parse>>): void;
            /**
             * Runs update record with changes.
             * @returns {Promise<void>} - Resolves when complete.
             */
            _updateRecordWithChanges(): Promise<void>;
            /**
             * Runs id.
             * @returns {number|string} - The id.
             */
            id(): number | string;
            /**
             * Runs is persisted.
             * @returns {boolean} - Whether persisted.
             */
            isPersisted(): boolean;
            /**
             * Runs is new record.
             * @returns {boolean} - Whether new record.
             */
            isNewRecord(): boolean;
            /**
             * Runs set is new record.
             * @param {boolean} newIsNewRecord - New is new record.
             * @returns {void} - No return value.
             */
            setIsNewRecord(newIsNewRecord: boolean): void;
            /**
             * Runs reload with id.
             * @template {typeof VelociousDatabaseRecord} MC
             * @param {string | number} id - Record identifier.
             * @returns {Promise<void>} - Resolves when complete.
             */
            _reloadWithId<MC extends typeof VelociousDatabaseRecord>(id: string | number): Promise<void>;
            /**
             * Runs reload.
             * @returns {Promise<void>} - Resolves when complete.
             */
            reload(): Promise<void>;
            _runValidations(): Promise<void>;
            /**
             * Runs full error messages.
             * @returns {string[]} - The full error messages.
             */
            fullErrorMessages(): string[];
            /**
             * Assigns the attributes to the record and saves it.
             * @param {WriteAttributes} attributesToAssign - The attributes to assign to the record.
             */
            update(attributesToAssign: Record<string, any>): Promise<void>;
        };
        /** @type {Record<string, string> | undefined} */
        _attributeNameToColumnName: Record<string, string> | undefined;
        /** @type {Record<string, string> | undefined} */
        _columnNameToAttributeName: Record<string, string> | undefined;
        /** @type {Record<string, object> | undefined} */
        _translations: Record<string, object> | undefined;
        /** @type {Record<string, import("./validators/base.js").default[]> | undefined} */
        _validators: Record<string, import("./validators/base.js").default[]> | undefined;
        /** @type {Record<string, LifecycleCallbackType[]> | undefined} */
        _lifecycleCallbacks: Record<string, LifecycleCallbackType[]> | undefined;
        /** @type {Record<string, typeof import("./validators/base.js").default> | undefined} */
        _validatorTypes: Record<string, typeof import("./validators/base.js").default> | undefined;
        /** @type {Record<string, RecordAttachmentConfiguration> | undefined} */
        _attachmentsMap: Record<string, RecordAttachmentConfiguration> | undefined;
        /** @type {Record<string, import("./relationships/base.js").default> | undefined} */
        _relationships: Record<string, import("./relationships/base.js").default> | undefined;
        /** @type {Record<string, import("../query/query-data.js").QueryDataFn> | undefined} */
        _queryDataRegistrations: Record<string, import("../query/query-data.js").QueryDataFn> | undefined;
        /** @type {Record<string, {allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean}> | undefined} */
        _acceptedNestedAttributes: Record<string, {
            allowDestroy?: boolean;
            limit?: number;
            rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean;
        }> | undefined;
        /** @type {Record<string, string> | undefined} */
        _attributeCasts: Record<string, string> | undefined;
        /** @type {Record<string, import("../drivers/base-column.js").default> | undefined} */
        _columnsAsHash: Record<string, import("../drivers/base-column.js").default> | undefined;
        /** @type {Array<string> | undefined} */
        _columnNames: Array<string> | undefined;
        /** @type {Record<string, string> | undefined} */
        _columnTypeByName: Record<string, string> | undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {string | undefined} */
        modelName: string | undefined;
        /**
         * Opt-in client sync declaration consumed by `SyncClient.fromConfiguration(...)`.
         * Declare `static sync = true` (all defaults) or a declaration object like
         * `static sync = {track: ["create", "update"], syncType: "upsert"}` to have the
         * sync client auto-discover this model and derive its resource config from
         * column metadata.
         * @type {import("../../sync/sync-client-types.js").ModelSyncDeclaration | undefined} */
        sync: import("../../sync/sync-client-types.js").ModelSyncDeclaration | undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Promise<void> | null | undefined} */
        _initializeRecordPromise: Promise<void> | null | undefined;
        /** @type {typeof VelociousDatabaseRecord | undefined} Canonical model class exposed only by an operation-bound metadata proxy. */
        _recordMetadataModelClass: typeof VelociousDatabaseRecord | undefined;
        /** @type {((modelClass: typeof VelociousDatabaseRecord) => typeof VelociousDatabaseRecord) | undefined} Binds related generated model classes to the same operation metadata generation. */
        _recordMetadataBinder: ((modelClass: typeof VelociousDatabaseRecord) => typeof VelociousDatabaseRecord) | undefined;
        /** @type {import("../operation.js").default | undefined} Operation exposed only by a constructing metadata proxy. */
        _recordMetadataOperation: import("../operation.js").default | undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {boolean | undefined} */
        _eagerLoadRecordMetadata: boolean | undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<string, import("./auditing.js").AuditCallback[]> | undefined} */
        _auditCallbacks: Record<string, import("./auditing.js").AuditCallback[]> | undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {boolean | undefined} */
        _auditLifecycleCallbacksRegistered: boolean | undefined;
        /**
         * Returns the model name, preferring an explicit `static modelName` declaration
         * over the JavaScript class `.name` property. This allows minified builds to
         * preserve correct model names without relying on `keep_classnames`.
         * @returns {string} - The model name.
         */
        getModelName(): string;
        getAttributeNameToColumnNameMap(): Record<string, string>;
        /**
         * Resolves the database column name for a record attribute name.
         * @param {string} attributeName - Attribute name to resolve.
         * @returns {string} - Mapped column name, or the underscored attribute name when no mapping exists.
         */
        getColumnNameForAttributeName(attributeName: string): string;
        /**
         * Resolves an incoming attribute or column name to the canonical attribute name this model exposes.
         * Accepts the canonical (deburred) attribute name, a raw umlaut/acronym column name, a pre-deburr
         * camelization, and camelCase casing variants (e.g. "vAFunktionID" vs "vAFunktionid"). Returns null
         * when nothing matches, so callers keep their own not-found handling.
         * @param {string} name - Attribute name or column name to resolve.
         * @returns {string | null} - Canonical attribute name, or null.
         */
        resolveAttributeName(name: string): string | null;
        /**
         * Finds the member name on a target's prototype chain matching `memberName`, falling back to a
         * case-insensitive match. Resolves setters when a read-only attribute alias differs only in camelCase
         * casing from the generated accessor (e.g. a "vAFunktionID" alias whose setter is "setVAFunktionid").
         * @param {object} target - Instance or prototype to search.
         * @param {string} memberName - Member name to find.
         * @returns {string | null} - Matching member name, or null when absent.
         */
        findMemberNameInsensitive(target: object, memberName: string): string | null;
        /**
         * Runs define scope.
         * @param {(...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} callback - Scope callback.
         * @returns {((...args: Array<ReturnType<typeof JSON.parse>>) => import("../query/model-class-query.js").default<typeof VelociousDatabaseRecord>) & {scope: (...args: Array<ReturnType<typeof JSON.parse>>) => import("../../utils/model-scope.js").ModelScopeDescriptor}} - Scope helper.
         */
        defineScope(callback: (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>): ((...args: Array<ReturnType<typeof JSON.parse>>) => import("../query/model-class-query.js").default<typeof VelociousDatabaseRecord>) & {
            scope: (...args: Array<ReturnType<typeof JSON.parse>>) => import("../../utils/model-scope.js").ModelScopeDescriptor;
        };
        /**
         * Returns the application model class behind an operation-bound metadata view.
         * @returns {typeof VelociousDatabaseRecord} - Canonical model class.
         */
        canonicalRecordMetadataModelClass(): typeof VelociousDatabaseRecord;
        /**
         * Binds a relationship target to this model class's metadata generation.
         * @param {typeof VelociousDatabaseRecord} modelClass - Relationship target.
         * @returns {typeof VelociousDatabaseRecord} - Generation-bound target, or the unchanged target for legacy queries.
         */
        bindRecordMetadataModelClass(modelClass: typeof VelociousDatabaseRecord): typeof VelociousDatabaseRecord;
        getColumnNameToAttributeNameMap(): Record<string, string>;
        getTranslationsMap(): Record<string, object>;
        getValidatorsMap(): Record<string, import("./validators/base.js").default[]>;
        /**
         * Runs get lifecycle callbacks map.
         * @returns {Record<string, LifecycleCallbackType[]>} - Lifecycle callbacks keyed by name.
         */
        getLifecycleCallbacksMap(): Record<string, LifecycleCallbackType[]>;
        getValidatorTypesMap(): Record<string, typeof import("./validators/base.js").default>;
        /**
         * Runs get attachments map.
         * @returns {Record<string, RecordAttachmentConfiguration>} - Attachment definitions keyed by name.
         */
        getAttachmentsMap(): Record<string, RecordAttachmentConfiguration>;
        validatorTypes(): Record<string, typeof import("./validators/base.js").default>;
        /**
         * Runs register validator type.
         * @param {string} name - Name.
         * @param {typeof import("./validators/base.js").default} validatorClass - Validator class.
         */
        registerValidatorType(name: string, validatorClass: typeof import("./validators/base.js").default): void;
        /**
         * Runs register lifecycle callback.
         * @param {"afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation"} callbackName - Callback type.
         * @param {LifecycleCallbackType} callback - Callback function or instance method name.
         * @returns {void}
         */
        registerLifecycleCallback(callbackName: "afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation", callback: LifecycleCallbackType): void;
        /**
         * Runs unregister lifecycle callback.
         * @param {"afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation"} callbackName - Callback type.
         * @param {LifecycleCallbackType} callback - Previously registered callback.
         * @returns {void}
         */
        unregisterLifecycleCallback(callbackName: "afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation", callback: LifecycleCallbackType): void;
        /**
         * Runs before validation.
         * @template R
         * @this {ModelConstructor<R>}
         * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
         * @returns {void}
         */
        beforeValidation<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
        /**
         * Runs before save.
         * @template R
         * @this {ModelConstructor<R>}
         * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
         * @returns {void}
         */
        beforeSave<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
        /**
         * Runs before create.
         * @template R
         * @this {ModelConstructor<R>}
         * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
         * @returns {void}
         */
        beforeCreate<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
        /**
         * Runs before update.
         * @template R
         * @this {ModelConstructor<R>}
         * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
         * @returns {void}
         */
        beforeUpdate<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
        /**
         * Runs before destroy.
         * @template R
         * @this {ModelConstructor<R>}
         * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
         * @returns {void}
         */
        beforeDestroy<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
        /**
         * Runs after save.
         * @template R
         * @this {ModelConstructor<R>}
         * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
         * @returns {void}
         */
        afterSave<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
        /**
         * Runs after create.
         * @template R
         * @this {ModelConstructor<R>}
         * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
         * @returns {void}
         */
        afterCreate<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
        /**
         * Runs after update.
         * @template R
         * @this {ModelConstructor<R>}
         * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
         * @returns {void}
         */
        afterUpdate<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
        /**
         * Runs after destroy.
         * @template R
         * @this {ModelConstructor<R>}
         * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
         * @returns {void}
         */
        afterDestroy<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
        /**
         * Enables automatic create/update/destroy auditing for this model.
         * @returns {void}
         */
        audited(): void;
        /**
         * Declares an aasm-style state machine on this model: named states, events
         * (guarded transitions), and enter/exit + before/after transition hooks. See
         * `state-machine.js`. Generates `event()` / `eventAndSave()` / `canEvent()`
         * transition methods per declared event.
         * @param {import("./state-machine.js").StateMachineDefinition} definition - State machine definition.
         * @returns {void}
         */
        stateMachine(definition: import("./state-machine.js").StateMachineDefinition): void;
        /**
         * Returns this model's state machine definition, or null when it declares none.
         * `Model.stateMachine(...)` overrides this on classes that declare a machine.
         * @returns {import("./state-machine.js").StateMachineDefinition | null} - The state machine definition, or null when none is declared.
         */
        getStateMachineDefinition(): import("./state-machine.js").StateMachineDefinition | null;
        /**
         * Returns this model's state column, or null when it declares no state machine.
         * @returns {string | null} - The state column name, or null when no state machine is declared.
         */
        getStateMachineColumn(): string | null;
        /**
         * Returns this model's declared state names (empty when it has no state machine).
         * @returns {string[]} - The declared state names, or an empty array when no state machine is declared.
         */
        getStateMachineStateNames(): string[];
        /**
         * Maintains a counter column on a `belongsTo` parent as the sum of a per-record
         * magnitude, kept current by atomic increments diffed on every create/update/
         * destroy (and moved between parents when the foreign key changes). See
         * `counter-cache-magnitude.js`.
         * @param {import("./counter-cache-magnitude.js").MagnitudeCounterCacheDefinition} definition - Counter cache definition.
         * @returns {void}
         */
        magnitudeCounterCache(definition: import("./counter-cache-magnitude.js").MagnitudeCounterCacheDefinition): void;
        /**
         * Registers a callback invoked after this model writes an audit row for the action.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {string} action - Audit action name.
         * @param {import("./auditing.js").AuditCallback} callback - Callback to run after audit creation.
         * @returns {() => void} Unsubscribe function.
         */
        onAudit<MC extends typeof VelociousDatabaseRecord>(this: MC, action: string, callback: import("./auditing.js").AuditCallback): () => void;
        /**
         * Returns records that do not have an audit row for the given action.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {string} action - Audit action name.
         * @returns {ModelClassQuery<MC>} Query scoped to records without that audit action.
         */
        withoutAudit<MC extends typeof VelociousDatabaseRecord>(this: MC, action: string): ModelClassQuery<MC>;
        /**
         * Runs get validator type.
         * @param {string} validatorName - Validator name.
         * @returns {typeof import("./validators/base.js").default} - The validator type.
         */
        getValidatorType(validatorName: string): typeof import("./validators/base.js").default;
        /**
         * Runs relationship exists.
         * @param {string} relationshipName - Relationship name.
         * @returns {boolean} - Whether relationship exists.
         */
        _relationshipExists(relationshipName: string): boolean;
        /**
         * RelationshipScopeCallback type.
         * @typedef {(query: import("../query/model-class-query.js").default<typeof VelociousDatabaseRecord>) => (import("../query/model-class-query.js").default<typeof VelociousDatabaseRecord> | void)} RelationshipScopeCallback
         */
        /**
         * RelationshipDataArgumentType type.
         * @typedef {object} RelationshipDataArgumentType
         * @property {boolean} [autoload] - Disable auto-batch-preload for this relationship by passing false. Default true.
         * @property {string} [className] - Model class name for the related record.
         * @property {string} [dependent] - Dependent action when parent is destroyed (e.g. "destroy").
         * @property {typeof VelociousDatabaseRecord} [klass] - Model class for the related record.
         * @property {RelationshipScopeCallback} [scope] - Optional scope callback for the relationship.
         * @property {string} [type] - Relationship type (e.g. "hasMany", "belongsTo").
         */
        /**
         * Runs define relationship.
         * @param {string} relationshipName - Relationship name.
         * @param {RelationshipDataArgumentType} data - Data payload.
         */
        _defineRelationship(relationshipName: string, data: RelationshipDataArgumentType): void;
        /**
         * Runs normalize relationship args.
         * @param {RelationshipScopeCallback | object | undefined} scopeOrOptions - Scope callback or options.
         * @param {object | undefined} options - Options.
         * @returns {{scope: (RelationshipScopeCallback | undefined), relationshipOptions: object}} - Normalized arguments.
         */
        _normalizeRelationshipArgs(scopeOrOptions: RelationshipScopeCallback | object | undefined, options: object | undefined): {
            scope: (RelationshipScopeCallback | undefined);
            relationshipOptions: object;
        };
        /**
         * Registers afterCreate, afterSave, and afterDestroy callbacks to sync
         * a counter cache column on the parent model. The column name follows
         * the convention `<childModelPluralCamelCase>Count`.
         * @param {string} relationshipName - The belongsTo relationship name.
         */
        _registerCounterCacheCallbacks(relationshipName: string): void;
        /**
         * Runs get relationship by name.
         * @param {string} relationshipName - Relationship name.
         * @returns {import("./relationships/base.js").default} - The relationship by name.
         */
        getRelationshipByName(relationshipName: string): import("./relationships/base.js").default;
        /**
         * Runs get relationships.
         * @returns {Array<import("./relationships/base.js").default>} - The relationships.
         */
        getRelationships(): Array<import("./relationships/base.js").default>;
        /**
         * Runs get relationships map.
         * @returns {Record<string, import("./relationships/base.js").default>} - Relationship definitions keyed by name.
         */
        getRelationshipsMap(): Record<string, import("./relationships/base.js").default>;
        /**
         * Runs get relationship names.
         * @returns {Array<string>} - The relationship names.
         */
        getRelationshipNames(): Array<string>;
        /**
         * Register a consumer-defined queryData entry. The callback receives
         * a grouped query already joined down the relationship chain from the
         * root of `.queryData(...)` to this model, already filtered by the
         * root parent IDs, and with `parent_id` pre-selected — so the fn
         * only needs to add its own SELECT (and optionally joins/where). Any
         * aliases the fn selects are attached to each **root** record via
         * `record.queryData(aliasName)`. Multi-column selects are fine — one
         * alias maps to one queryData key.
         *
         * **Quote AS aliases on PostgreSQL.** PostgreSQL folds unquoted
         * identifiers (including SELECT aliases) to lowercase, so a
         * `... AS manualTasksCount` lands in the result row as
         * `manualtaskscount` while the lookup `record.queryData("manualTasksCount")`
         * never finds it. Use `driver.quoteColumn("manualTasksCount")` for the
         * alias to preserve the case on every supported driver:
         *   query.select(`COUNT(...) AS ${driver.quoteColumn("manualTasksCount")}`)
         * @param {string} name - Identifier used in the `.queryData(...)` spec.
         * @param {import("../query/query-data.js").QueryDataFn} fn - Callback that mutates the query.
         * @returns {void}
         */
        queryData(name: string, fn: import("../query/query-data.js").QueryDataFn): void;
        /**
         * Runs get query data map.
         * @returns {Record<string, import("../query/query-data.js").QueryDataFn>} - queryData registrations keyed by name.
         */
        getQueryDataMap(): Record<string, import("../query/query-data.js").QueryDataFn>;
        /**
         * Runs get query data by name.
         * @param {string} name - queryData name.
         * @returns {import("../query/query-data.js").QueryDataFn | null} - Registered fn or null when not found.
         */
        getQueryDataByName(name: string): import("../query/query-data.js").QueryDataFn | null;
        /**
         * Runs get attachments.
         * @returns {Record<string, RecordAttachmentConfiguration>} - Attachment definitions.
         */
        getAttachments(): Record<string, RecordAttachmentConfiguration>;
        /**
         * Returns attachment definitions through the model contract shared with
         * frontend model classes.
         * @returns {Record<string, RecordAttachmentConfiguration>} - Attachment definitions.
         */
        attachmentDefinitions(): Record<string, RecordAttachmentConfiguration>;
        /**
         * Runs get attachment by name.
         * @param {string} attachmentName - Attachment name.
         * @returns {RecordAttachmentConfiguration} - Attachment definition.
         */
        getAttachmentByName(attachmentName: string): RecordAttachmentConfiguration;
        /**
         * Adds a belongs-to-relationship to the model.
         * @param {string} relationshipName The name of the relationship.
         * @param {RelationshipScopeCallback | object} [scopeOrOptions] The scope callback or options for the relationship.
         * @param {object} [options] The options for the relationship.
         */
        belongsTo(relationshipName: string, scopeOrOptions?: RelationshipScopeCallback | object, options?: object): void;
        /**
         * Runs connection.
         * @param {object} [args] - Options.
         * @param {boolean} [args.enforceTenantDatabaseScope] - Whether tenant-switched models must resolve a tenant database identifier.
         * @returns {import("../drivers/base.js").default} - The connection.
         */
        connection({ enforceTenantDatabaseScope, ...restArgs }?: {
            enforceTenantDatabaseScope?: boolean;
        }): import("../drivers/base.js").default;
        /**
         * Runs create.
         * @template {Record<string, ReturnType<typeof JSON.parse>>} CreateAttributes
         * @template {VelociousDatabaseRecord<CreateAttributes>} Model
         * @this {{new (changes?: CreateAttributes): Model} & typeof VelociousDatabaseRecord}
         * @param {CreateAttributes} [attributes] - Attributes.
         * @returns {Promise<Model>} - Resolves with the create.
         */
        create<CreateAttributes extends Record<string, ReturnType<typeof JSON.parse>>, Model extends VelociousDatabaseRecord<CreateAttributes>>(this: {
            new (changes?: CreateAttributes): Model;
        } & typeof VelociousDatabaseRecord, attributes?: CreateAttributes): Promise<Model>;
        /**
         * Runs get configuration.
         * @returns {import("../../configuration.js").default} - The configuration.
         */
        _getConfiguration(): import("../../configuration.js").default;
        _configuration: Configuration | undefined;
        /**
         * Adds a has-many-relationship to the model class.
         * @param {string} relationshipName The name of the relationship (e.g. "posts")
         * @param {RelationshipScopeCallback | object} [scopeOrOptions] The scope callback or options for the relationship.
         * @param {object} [options] The options for the relationship (e.g. {className: "Post"})
         * @returns {void} - No return value.
         */
        hasMany(relationshipName: string, scopeOrOptions?: RelationshipScopeCallback | object, options?: object): void;
        /**
         * Rails-style declaration that this model accepts nested-attribute writes
         * for a relationship when saved through a parent. Required — Velocious
         * will refuse nested writes for any relationship not listed here, even
         * if a frontend-model resource permits them.
         *
         * Options:
         *   - allowDestroy: whether `_destroy: true` entries are allowed. Default false.
         *   - limit: optional upper bound on the number of nested entries per request.
         *   - rejectIf: optional predicate `(attributes) => boolean` that silently skips entries.
         *
         * Usage:
         *   class Project extends Record {}
         *   Project.hasMany("tasks")
         *   Project.acceptsNestedAttributesFor("tasks", {allowDestroy: true})
         * @param {string} relationshipName - Relationship name on this model.
         * @param {{allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean}} [options] - Policy options.
         * @returns {void}
         */
        acceptsNestedAttributesFor(relationshipName: string, options?: {
            allowDestroy?: boolean;
            limit?: number;
            rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean;
        }): void;
        /**
         * Runs accepted nested attributes for.
         * @param {string} relationshipName - Relationship name.
         * @returns {{allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean} | null} - Policy declared via `acceptsNestedAttributesFor`, or null when not accepted.
         */
        acceptedNestedAttributesFor(relationshipName: string): {
            allowDestroy?: boolean;
            limit?: number;
            rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean;
        } | null;
        /**
         * Adds a has-one-relationship to the model class.
         * @param {string} relationshipName The name of the relationship (e.g. "post")
         * @param {RelationshipScopeCallback | object} [scopeOrOptions] The scope callback or options for the relationship.
         * @param {object} [options] The options for the relationship (e.g. {className: "Post"})
         * @returns {void} - No return value.
         */
        hasOne(relationshipName: string, scopeOrOptions?: RelationshipScopeCallback | object, options?: object): void;
        /**
         * Runs define attachment.
         * @param {string} attachmentName - Attachment name.
         * @param {object} args - Attachment args.
         * @param {string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>} [args.driver] - Attachment driver name, class, or instance.
         * @param {AttachmentSyncConfiguration} [args.sync] - Client-safe synchronized asset policy.
         * @param {"hasOne" | "hasMany"} args.type - Attachment type.
         * @returns {void} - No return value.
         */
        _defineAttachment(attachmentName: string, { driver, sync, type }: {
            driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>;
            sync?: AttachmentSyncConfiguration;
            type: "hasOne" | "hasMany";
        }): void;
        /**
         * Adds a single attachment helper to the model.
         * @param {string} attachmentName - Attachment name.
         * @param {{driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, sync?: AttachmentSyncConfiguration}} [args] - Attachment options.
         * @returns {void} - No return value.
         */
        hasOneAttachment(attachmentName: string, args?: {
            driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>;
            sync?: AttachmentSyncConfiguration;
        }): void;
        /**
         * Adds a collection attachment helper to the model.
         * @param {string} attachmentName - Attachment name.
         * @param {{driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, sync?: AttachmentSyncConfiguration}} [args] - Attachment options.
         * @returns {void} - No return value.
         */
        hasManyAttachments(attachmentName: string, args?: {
            driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>;
            sync?: AttachmentSyncConfiguration;
        }): void;
        /**
         * Runs human attribute name.
         * @param {string} attributeName - Attribute name.
         * @returns {string} - The human attribute name.
         */
        humanAttributeName(attributeName: string): string;
        /**
         * Runs get database type.
         * @returns {string} - The database type.
         */
        getDatabaseType(): string;
        /**
         * Runs set eager load record metadata.
         * @param {boolean} eagerLoadRecordMetadata - Whether require-context initialization should load table metadata for this model.
         * @returns {void} - No return value.
         */
        setEagerLoadRecordMetadata(eagerLoadRecordMetadata: boolean): void;
        /**
         * Runs get eager load record metadata.
         * @returns {boolean} - Whether require-context initialization should load table metadata for this model.
         */
        getEagerLoadRecordMetadata(): boolean;
        /**
         * Runs reset record metadata.
         * @returns {void} - No return value.
         */
        resetRecordMetadata(): void;
        _initialized: boolean | undefined;
        _databaseType: string | undefined;
        _table: import("../drivers/base-table.js").default | undefined;
        _columns: import("../drivers/base-column.js").default[] | undefined;
        /**
         * Static fields that belong to one physical database/schema generation.
         * @returns {Set<string>} - Metadata property names.
         */
        recordMetadataPropertyNames(): Set<string>;
        /**
         * Reads one operation-bound metadata field.
         * @param {string} metadataKey - Physical database and schema generation key.
         * @param {string} property - Static metadata property.
         * @returns {RecordMetadataValue} - Stored metadata value.
         */
        recordMetadataValue(metadataKey: string, property: string): RecordMetadataValue;
        /**
         * Writes one operation-bound metadata field.
         * @param {string} metadataKey - Physical database and schema generation key.
         * @param {string} property - Static metadata property.
         * @param {RecordMetadataValue} value - Metadata value.
         * @returns {void}
         */
        setRecordMetadataValue(metadataKey: string, property: string, value: RecordMetadataValue): void;
        /** Clears every tenant/generation metadata snapshot for this model. */
        clearRecordMetadataValues(): void;
        /**
         * Clears snapshots whose key belongs to one physical database identity.
         * @param {string} databaseIdentity - Logical identifier plus pool reuse key.
         * @returns {void}
         */
        clearRecordMetadataValuesForDatabaseIdentity(databaseIdentity: string): void;
        /**
         * Registers the model class with a configuration without loading table metadata.
         * @param {object} args - Options object.
         * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
         * @returns {void} - No return value.
         */
        registerRecordClass({ configuration, ...restArgs }: {
            configuration: import("../../configuration.js").default;
        }): void;
        /**
         * Runs initialize record.
         * @param {object} args - Options object.
         * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
         * @param {import("../drivers/base.js").default} [args.connection] - Explicit metadata connection.
         * @returns {Promise<void>} - Resolves when complete.
         */
        initializeRecord({ configuration, connection: explicitConnection, ...restArgs }: {
            configuration: import("../../configuration.js").default;
            connection?: import("../drivers/base.js").default;
        }): Promise<void>;
        /**
         * Initializes the model class the first time an async record API needs table
         * metadata. Concurrent callers share the same initialization promise, and a
         * failed initialization can be retried by a later call.
         * @param {{configuration?: import("../../configuration.js").default, connection?: import("../drivers/base.js").default}} [args] - Optional configuration and explicit metadata connection.
         * @returns {Promise<void>} - Resolves when the model class is initialized.
         */
        ensureInitialized(args?: {
            configuration?: import("../../configuration.js").default;
            connection?: import("../drivers/base.js").default;
        }): Promise<void>;
        /**
         * Runs is initialized.
         * @returns {boolean} - Whether initialized.
         */
        isInitialized(): boolean;
        /**
         * Runs assert has been initialized.
         * @returns {void} - No return value.
         */
        _assertHasBeenInitialized(): void;
        /**
         * Defines translation accessors and initializes the generated translation
         * class through the same metadata connection as the translated model.
         * @param {import("../drivers/base.js").default} connection - Metadata connection.
         * @returns {Promise<void>} - Resolves when translation metadata is ready.
         */
        _defineTranslationMethods(connection: import("../drivers/base.js").default): Promise<void>;
        /**
         * Runs get configured database identifier.
         * @returns {string} - The configured non-tenant database identifier.
         */
        getConfiguredDatabaseIdentifier(): string;
        /**
         * Runs get database identifier.
         * @param {object} [args] - Options.
         * @param {boolean} [args.enforceTenantDatabaseScope] - Whether tenant-switched models must resolve a tenant database identifier.
         * @param {object} [args.tenant] - Explicit tenant descriptor instead of the ambient tenant.
         * @returns {string} - The database identifier.
         */
        getDatabaseIdentifier({ enforceTenantDatabaseScope, tenant, ...restArgs }?: {
            enforceTenantDatabaseScope?: boolean;
            tenant?: object;
        }): string;
        /**
         * Runs set database identifier.
         * @param {string} databaseIdentifier - Database identifier.
         * @returns {void} - No return value.
         */
        setDatabaseIdentifier(databaseIdentifier: string): void;
        _databaseIdentifier: string | undefined;
        /**
         * Declares a tenant-aware database identifier resolver for this model class.
         * @param {string | ((args: {modelClass: typeof VelociousDatabaseRecord, tenant: Record<string, unknown> | null | undefined}) => string | undefined)} databaseIdentifierOrResolver - Static identifier or resolver.
         * @returns {void} - No return value.
         */
        switchesTenantDatabase(databaseIdentifierOrResolver: string | ((args: {
            modelClass: typeof VelociousDatabaseRecord;
            tenant: Record<string, unknown> | null | undefined;
        }) => string | undefined)): void;
        _tenantDatabaseIdentifierResolver: string | ((args: {
            modelClass: typeof VelociousDatabaseRecord;
            tenant: Record<string, unknown> | null | undefined;
        }) => string | undefined) | undefined;
        /**
         * Runs has tenant database identifier resolver.
         * @returns {boolean} - Whether this model resolves its database from the current tenant.
         */
        hasTenantDatabaseIdentifierResolver(): boolean;
        /**
         * Runs get tenant database identifier.
         * @param {ReturnType<typeof JSON.parse>} [tenant] - Tenant override.
         * @returns {string | undefined} - Tenant-scoped database identifier when configured.
         */
        getTenantDatabaseIdentifier(tenant?: ReturnType<typeof JSON.parse>): string | undefined;
        /**
         * Whether a declared `"boolean"` attribute cast is backed by an integer column (e.g. an MSSQL
         * `bit`), so booleans must be stored as 1/0. A native boolean column (e.g. Postgres `boolean`)
         * returns false and keeps `true`/`false` for the driver.
         * @param {string} attributeName - Attribute name.
         * @returns {boolean} - Whether the declared boolean is stored as an integer.
         */
        _declaredBooleanStoresAsInteger(attributeName: string): boolean;
        /**
         * Runs get columns.
         * @returns {import("../drivers/base-column.js").default[]} - The columns.
         */
        getColumns(): import("../drivers/base-column.js").default[];
        /**
         * Runs get columns hash.
         * @returns {Record<string, import("../drivers/base-column.js").default>} - The columns hash.
         */
        getColumnsHash(): Record<string, import("../drivers/base-column.js").default>;
        /**
         * Runs get column type by name.
         * @param {string} name - Name.
         * @returns {string | undefined} - The column type by name.
         */
        getColumnTypeByName(name: string): string | undefined;
        /**
         * Runs is date like type.
         * @param {string} type - Type identifier.
         * @returns {boolean} - Whether date like type.
         */
        _isDateLikeType(type: string): boolean;
        /**
         * Runs get column names.
         * @returns {Array<string>} - The column names.
         */
        getColumnNames(): Array<string>;
        /**
         * Runs get table.
         * @returns {import("../drivers/base-table.js").default} - The table.
         */
        _getTable(): import("../drivers/base-table.js").default;
        /**
         * Runs insert multiple.
         * @param {Array<string>} columns - Column names.
         * @param {Array<Array<ReturnType<typeof JSON.parse>>>} rows - Rows to insert.
         * @param {object} [args] - Options object.
         * @param {boolean} [args.cast] - Whether to cast values based on column types.
         * @param {boolean} [args.retryIndividuallyOnFailure] - Retry rows individually if a batch insert fails.
         * @param {boolean} [args.returnResults] - Return succeeded/failed rows instead of throwing when retries fail.
         * @returns {Promise<void | {succeededRows: Array<Array<ReturnType<typeof JSON.parse>>>, failedRows: Array<Array<ReturnType<typeof JSON.parse>>>, errors: Array<{row: Array<ReturnType<typeof JSON.parse>>, error: ReturnType<typeof JSON.parse>}>}>} - Resolves when complete.
         */
        insertMultiple(columns: Array<string>, rows: Array<Array<ReturnType<typeof JSON.parse>>>, args?: {
            cast?: boolean;
            retryIndividuallyOnFailure?: boolean;
            returnResults?: boolean;
        }): Promise<void | {
            succeededRows: Array<Array<ReturnType<typeof JSON.parse>>>;
            failedRows: Array<Array<ReturnType<typeof JSON.parse>>>;
            errors: Array<{
                row: Array<ReturnType<typeof JSON.parse>>;
                error: ReturnType<typeof JSON.parse>;
            }>;
        }>;
        /**
         * Runs normalize insert multiple rows.
         * @param {object} args - Options object.
         * @param {Array<string>} args.columns - Column names.
         * @param {Array<Array<ReturnType<typeof JSON.parse>>>} args.rows - Rows to insert.
         * @returns {Array<Array<ReturnType<typeof JSON.parse>>>} - Normalized rows.
         */
        _normalizeInsertMultipleRows({ columns, rows }: {
            columns: Array<string>;
            rows: Array<Array<ReturnType<typeof JSON.parse>>>;
        }): Array<Array<ReturnType<typeof JSON.parse>>>;
        /**
         * Runs safe serialize insert row.
         * @param {Array<ReturnType<typeof JSON.parse>>} row - Row to serialize.
         * @returns {string} - Safe row representation.
         */
        _safeSerializeInsertRow(row: Array<ReturnType<typeof JSON.parse>>): string;
        /**
         * Runs normalize insert value for column.
         * @param {object} args - Options object.
         * @param {string} args.columnName - Column name.
         * @param {ReturnType<typeof JSON.parse>} args.value - Column value.
         * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
         */
        _normalizeInsertValueForColumn({ columnName, value }: {
            columnName: string;
            value: ReturnType<typeof JSON.parse>;
        }): ReturnType<typeof JSON.parse>;
        /**
         * Runs is string type.
         * @param {string | undefined} columnType - Column type.
         * @returns {boolean} - Whether string-like type.
         */
        _isStringType(columnType: string | undefined): boolean;
        /**
         * Runs is numeric type.
         * @param {string} columnType - Column type.
         * @returns {boolean} - Whether numeric-like type.
         */
        _isNumericType(columnType: string): boolean;
        /**
         * Runs normalize numeric value.
         * @param {object} args - Options object.
         * @param {string} args.columnType - Column type.
         * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
         * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
         */
        _normalizeNumericValue({ columnType, value }: {
            columnType: string;
            value: ReturnType<typeof JSON.parse>;
        }): ReturnType<typeof JSON.parse>;
        /**
         * Runs normalize date value for insert.
         * @param {ReturnType<typeof JSON.parse>} value - Value to normalize.
         * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
         */
        _normalizeDateValueForInsert(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
        /**
         * Runs normalize date string for insert.
         * @param {string} value - Date string value.
         * @returns {string | Date} - Parsed date or original string.
         */
        _normalizeDateStringForInsert(value: string): string | Date;
        /**
         * Runs time zone for date writes.
         * @returns {string | undefined} - Active timezone identifier.
         */
        _timeZoneForDateWrite(): string | undefined;
        /**
         * Runs normalize sqlite boolean value for insert.
         * @param {object} args - Options object.
         * @param {string | undefined} args.columnType - Column type.
         * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
         * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
         */
        _normalizeSqliteBooleanValueForInsert({ columnType, value }: {
            columnType: string | undefined;
            value: ReturnType<typeof JSON.parse>;
        }): ReturnType<typeof JSON.parse>;
        /**
         * Runs next primary key.
         * @returns {Promise<number>} - Resolves with the next primary key.
         */
        nextPrimaryKey(): Promise<number>;
        /**
         * Runs set primary key.
         * @param {string} primaryKey - Primary key.
         * @returns {void} - No return value.
         */
        setPrimaryKey(primaryKey: string): void;
        _primaryKey: string | undefined;
        /**
         * Returns this class's own attribute-cast map, creating it on the class itself
         * (never inherited from a parent) so subclasses don't share the same object.
         * @returns {Record<string, string>} - Declared casts keyed by attribute name.
         */
        getAttributeCastsMap(): Record<string, string>;
        /**
         * Declares a Rails-style per-attribute cast so a column whose introspected type
         * isn't what the app wants (e.g. an MSSQL `bit` mapped to `number`) can be
         * exposed as another type with real runtime conversion. Currently fully
         * implements the `"boolean"` cast (0/1 <-> false/true); other types only record
         * the label so the effective type and generated typings reflect them.
         * @param {string} attributeName - Attribute name (camelCase), e.g. `"sichtbarVVK"`.
         * @param {string} type - Declared type, e.g. `"boolean"`.
         * @returns {void} - No return value.
         */
        attribute(attributeName: string, type: string): void;
        /**
         * Returns the declared cast type for an attribute, if any.
         * @param {string} attributeName - Attribute name (camelCase).
         * @returns {string | undefined} - Declared cast type, or undefined when none is declared.
         */
        getAttributeCast(attributeName: string): string | undefined;
        /**
         * Runs primary key.
         * @returns {string} - The primary key.
         */
        primaryKey(): string;
        /**
         * Whether the model has a single primary key column. `setPrimaryKey(null)` (e.g. composite-key
         * legacy tables) declares no single primary key; `primaryKey()` still falls back to "id" for the
         * default case, so callers that must distinguish "no primary key" use this instead.
         * @returns {boolean} - False only when the primary key was explicitly set to null.
         */
        hasPrimaryKey(): boolean;
        /**
         * Runs table name.
         * @returns {string} - The table name.
         */
        tableName(): string;
        _tableName: string | undefined;
        /**
         * Runs set table name.
         * @param {string} tableName - Table name.
         * @returns {void} - No return value.
         */
        setTableName(tableName: string): void;
        /**
         * Runs transaction.
         * @param {() => Promise<void>} callback - Callback function.
         * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the transaction.
         */
        transaction(callback: () => Promise<void>): Promise<ReturnType<typeof JSON.parse>>;
        /**
         * Runs the callback while holding a named advisory lock. Calls without
         * By default calls use the caller connection. Calls with `dedicatedConnection`
         * use a spawned lock connection that is released after the callback finishes,
         * while the callback itself still runs against the caller/model connection.
         * Calls with a positive `holdTimeoutMs` use a dedicated lock connection so
         * timeout cleanup can release the lock even when callback database work is
         * stuck. Advisory locks are cooperative and session-scoped: they serialize
         * callers that opt into the same `name`, without touching row or table locks,
         * so unrelated traffic is free to proceed.
         *
         * The lock is acquired before the callback runs and released in a
         * `finally` block afterwards, so the callback's return value is
         * propagated and thrown errors still release the lock.
         * @template T
         * @param {string} name - Lock name.
         * @param {() => Promise<T>} callback - Callback to invoke while the lock is held.
         * @param {{timeoutMs?: number | null, holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - `timeoutMs` caps how long we wait to acquire the lock; `holdTimeoutMs` caps how long the callback may hold it before the lock is released and `AdvisoryLockHoldTimeoutError` is thrown; `dedicatedConnection` spawns a separate lock session without enabling a hold timeout.
         * @returns {Promise<T>} - Resolves with the callback's return value.
         * @throws {AdvisoryLockTimeoutError} - If `timeoutMs` elapses before the lock is granted.
         * @throws {AdvisoryLockHoldTimeoutError} - If `holdTimeoutMs` elapses while the callback holds the lock.
         */
        withAdvisoryLock<T>(name: string, callback: () => Promise<T>, args?: {
            timeoutMs?: number | null;
            holdTimeoutMs?: number | null;
            dedicatedConnection?: boolean;
        }): Promise<T>;
        /**
         * Runs the callback only if the named advisory lock can be acquired
         * immediately. If the lock is already held by any session, throws
         * `AdvisoryLockBusyError` without waiting.
         * Use this when contention is a signal that somebody else is already
         * doing the work and you want to bail out rather than queue up.
         * @template T
         * @param {string} name - Lock name.
         * @param {() => Promise<T>} callback - Callback to invoke while the lock is held.
         * @param {{holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - `holdTimeoutMs` caps how long the callback may hold the lock before it is released and `AdvisoryLockHoldTimeoutError` is thrown; `dedicatedConnection` spawns a separate lock session without enabling a hold timeout.
         * @returns {Promise<T>} - Resolves with the callback's return value.
         * @throws {AdvisoryLockBusyError} - If the lock is already held.
         * @throws {AdvisoryLockHoldTimeoutError} - If `holdTimeoutMs` elapses while the callback holds the lock.
         */
        withAdvisoryLockOrFail<T>(name: string, callback: () => Promise<T>, args?: {
            holdTimeoutMs?: number | null;
            dedicatedConnection?: boolean;
        }): Promise<T>;
        /**
         * Runs `callback`, rejecting with `AdvisoryLockHoldTimeoutError` if it has
         * not settled within `holdTimeoutMs`. The callback is not cancelled — this is
         * a safety net, not cancellation.
         * @template T
         * @param {string} name - Lock name (for the error message).
         * @param {() => Promise<T>} callback - Callback holding the lock.
         * @param {number | null} [holdTimeoutMs] - Max hold time; falsy disables the timeout.
         * @returns {Promise<T>} - Callback result after the lock-protected operation.
         */
        runWithAdvisoryLockHoldTimeout<T>(name: string, callback: () => Promise<T>, holdTimeoutMs?: number | null): Promise<T>;
        /**
         * Returns true if the named advisory lock is currently held by any
         * session. Primarily useful as a diagnostic; callers that want to act
         * on the result should prefer `withAdvisoryLockOrFail` to avoid a
         * TOCTOU window between the check and the action.
         * @param {string} name - Lock name.
         * @returns {Promise<boolean>} - Whether the advisory lock is currently held.
         */
        hasAdvisoryLock(name: string): Promise<boolean>;
        /**
         * Runs translates.
         * @param {...string} names - Names.
         * @returns {void} - No return value.
         */
        translates(...names: string[]): void;
        /**
         * Runs current translation scope.
         * @param {ModelClassQuery} query - Translation query.
         * @returns {ModelClassQuery} - Scoped query.
         */
        currentTranslationScope(query: ModelClassQuery): ModelClassQuery;
        /**
         * Runs get translation class.
         * @returns {typeof VelociousDatabaseRecord} - The translation class.
         */
        getTranslationClass(): typeof VelociousDatabaseRecord;
        readonly name: string;
        _translationClass: /*elided*/ any | undefined;
        /**
         * Runs get translations table name.
         * @returns {string} - The translations table name.
         */
        getTranslationsTableName(): string;
        /**
         * Runs has translations table.
         * @returns {Promise<boolean>} - Resolves with Whether it has translations table.
         */
        hasTranslationsTable(): Promise<boolean>;
        /**
         * Adds a validation to an attribute.
         * @param {string} attributeName The name of the attribute to validate.
         * @param {Record<string, boolean | Record<string, ReturnType<typeof JSON.parse>>>} validators The validators to add. Key is the validator name, value is the validator arguments.
         */
        validates(attributeName: string, validators: Record<string, boolean | Record<string, ReturnType<typeof JSON.parse>>>): Promise<void>;
        /**
         * Registers gap-less positional list callbacks for a column scoped by
         * another column. Inserts and moves shift surrounding positions so the
         * list stays compact (1,2,3,...). Destroys close the resulting gap.
         *
         * Callers must ensure a UNIQUE index on (scopeColumn, positionColumn)
         * exists in the database — use `Migration.addActsAsList()` for the
         * schema half.
         * @param {string} positionColumn - camelCase position attribute (e.g. "rowNumber").
         * @param {object} options - Options with a required scope attribute.
         * @param {string} options.scope - camelCase scope attribute (e.g. "boardColumnId").
         */
        actsAsList(positionColumn: string, options: {
            scope: string;
        }): void;
        /**
         * Runs new query.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {{driver?: import("../drivers/base.js").default | (() => import("../drivers/base.js").default), operation?: import("../operation.js").default}} [args] - Explicit query ownership.
         * @returns {ModelClassQuery<MC>} - The new query.
         */
        _newQuery<MC extends typeof VelociousDatabaseRecord>(this: MC, args?: {
            driver?: import("../drivers/base.js").default | (() => import("../drivers/base.js").default);
            operation?: import("../operation.js").default;
        }): ModelClassQuery<MC>;
        /**
         * Runs orderable column.
         * @returns {string} - The orderable column.
         */
        orderableColumn(): string;
        /**
         * Runs all.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @returns {ModelClassQuery<MC>} - The all.
         */
        all<MC extends typeof VelociousDatabaseRecord>(this: MC): ModelClassQuery<MC>;
        /**
         * Runs accessible for.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {string} action - Ability action to scope by.
         * @param {import("../../authorization/ability.js").default | undefined} [ability] - Ability instance.
         * @returns {ModelClassQuery<MC>} - Authorized query.
         */
        accessibleFor<MC extends typeof VelociousDatabaseRecord>(this: MC, action: string, ability?: import("../../authorization/ability.js").default | undefined): ModelClassQuery<MC>;
        /**
         * Runs accessible.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {import("../../authorization/ability.js").default | undefined} [ability] - Ability instance.
         * @returns {ModelClassQuery<MC>} - Authorized query.
         */
        accessible<MC extends typeof VelociousDatabaseRecord>(this: MC, ability?: import("../../authorization/ability.js").default | undefined): ModelClassQuery<MC>;
        /**
         * Runs accessible by.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {import("../../authorization/ability.js").default} ability - Ability instance.
         * @returns {ModelClassQuery<MC>} - Authorized query.
         */
        accessibleBy<MC extends typeof VelociousDatabaseRecord>(this: MC, ability: import("../../authorization/ability.js").default): ModelClassQuery<MC>;
        /**
         * Runs count.
         * @returns {Promise<number>} - Resolves with the count.
         */
        count(): Promise<number>;
        /**
         * Runs group.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {string} group - Group.
         * @returns {ModelClassQuery<MC>} - The group.
         */
        group<MC extends typeof VelociousDatabaseRecord>(this: MC, group: string): ModelClassQuery<MC>;
        destroyAll(): Promise<void>;
        /**
         * Runs pluck.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {...string|string[]} columns - Column names.
         * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Resolves with the pluck.
         */
        pluck<MC extends typeof VelociousDatabaseRecord>(this: MC, ...columns: (string | string[])[]): Promise<Array<ReturnType<typeof JSON.parse>>>;
        /**
         * Runs find.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {number|string} recordId - Record id.
         * @returns {Promise<InstanceType<MC>>} - Resolves with the find.
         */
        find<MC extends typeof VelociousDatabaseRecord>(this: MC, recordId: number | string): Promise<InstanceType<MC>>;
        /**
         * Runs find by.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
         * @returns {Promise<InstanceType<MC> | null>} - Resolves with the by.
         */
        findBy<MC extends typeof VelociousDatabaseRecord>(this: MC, conditions: {
            [key: string]: string | number;
        }): Promise<InstanceType<MC> | null>;
        /**
         * Runs find by or fail.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
         * @returns {Promise<InstanceType<MC>>} - Resolves with the by or fail.
         */
        findByOrFail<MC extends typeof VelociousDatabaseRecord>(this: MC, conditions: {
            [key: string]: string | number;
        }): Promise<InstanceType<MC>>;
        /**
         * Returns an immutable tenant-bound model scope. Eager helpers and explicit
         * databaseOperation/transaction callbacks execute from a captured physical
         * database configuration instead of ambient tenant state.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {object} tenant - Ordinary or null-prototype JSON-compatible tenant descriptor to scope the model to.
         * @returns {TenantModelScope<MC>} - Model scope bound to the captured tenant database.
         */
        usingTenant<MC extends typeof VelociousDatabaseRecord>(this: MC, tenant: object): TenantModelScope<MC>;
        /**
         * Runs find or create by.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
         * @param {() => void} [callback] - Callback function.
         * @returns {Promise<InstanceType<MC>>} - Resolves with the or create by.
         */
        findOrCreateBy<MC extends typeof VelociousDatabaseRecord>(this: MC, conditions: {
            [key: string]: string | number;
        }, callback?: () => void): Promise<InstanceType<MC>>;
        /**
         * Runs find or initialize by.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {Record<string, string | number>} conditions - Conditions.
         * @param {(arg: InstanceType<MC>) => void} [callback] - Callback function.
         * @returns {Promise<InstanceType<MC>>} - Resolves with the or initialize by.
         */
        findOrInitializeBy<MC extends typeof VelociousDatabaseRecord>(this: MC, conditions: Record<string, string | number>, callback?: (arg: InstanceType<MC>) => void): Promise<InstanceType<MC>>;
        /**
         * Runs first.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @returns {Promise<InstanceType<MC>>} - Resolves with the first.
         */
        first<MC extends typeof VelociousDatabaseRecord>(this: MC): Promise<InstanceType<MC>>;
        /**
         * Runs joins.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {string | import("../query/join-object.js").JoinObject} join - Join clause or join descriptor.
         * @returns {ModelClassQuery<MC>} - The joins.
         */
        joins<MC extends typeof VelociousDatabaseRecord>(this: MC, join: string | import("../query/join-object.js").JoinObject): ModelClassQuery<MC>;
        /**
         * Runs last.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @returns {Promise<InstanceType<MC>>} - Resolves with the last.
         */
        last<MC extends typeof VelociousDatabaseRecord>(this: MC): Promise<InstanceType<MC>>;
        /**
         * Runs limit.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {number} value - Value to use.
         * @returns {ModelClassQuery<MC>} - The limit.
         */
        limit<MC extends typeof VelociousDatabaseRecord>(this: MC, value: number): ModelClassQuery<MC>;
        /**
         * Runs order.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {import("../query/index.js").OrderArgumentType} order - Order.
         * @returns {ModelClassQuery<MC>} - The order.
         */
        order<MC extends typeof VelociousDatabaseRecord>(this: MC, order: import("../query/index.js").OrderArgumentType): ModelClassQuery<MC>;
        /**
         * Runs distinct.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {boolean} [value] - Value to use.
         * @returns {ModelClassQuery<MC>} - The distinct.
         */
        distinct<MC extends typeof VelociousDatabaseRecord>(this: MC, value?: boolean): ModelClassQuery<MC>;
        /**
         * Runs preload.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {import("../query/index.js").NestedPreloadRecord | string | Array<string | import("../query/index.js").NestedPreloadRecord>} preload - Preload.
         * @returns {ModelClassQuery<MC>} - The preload.
         */
        preload<MC extends typeof VelociousDatabaseRecord>(this: MC, preload: import("../query/index.js").NestedPreloadRecord | string | Array<string | import("../query/index.js").NestedPreloadRecord>): ModelClassQuery<MC>;
        /**
         * Runs select.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {import("../query/index.js").SelectArgumentType} select - Select.
         * @returns {ModelClassQuery<MC>} - The select.
         */
        select<MC extends typeof VelociousDatabaseRecord>(this: MC, select: import("../query/index.js").SelectArgumentType): ModelClassQuery<MC>;
        /**
         * Runs to array.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @returns {Promise<InstanceType<MC>[]>} - Resolves with the array.
         */
        toArray<MC extends typeof VelociousDatabaseRecord>(this: MC): Promise<InstanceType<MC>[]>;
        /**
         * Runs load.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @returns {Promise<InstanceType<MC>[]>} - Resolves with the array.
         */
        load<MC extends typeof VelociousDatabaseRecord>(this: MC): Promise<InstanceType<MC>[]>;
        /**
         * Runs where.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {import("../query/index.js").WhereArgumentType} where - Where.
         * @returns {ModelClassQuery<MC>} - The where.
         */
        where<MC extends typeof VelociousDatabaseRecord>(this: MC, where: import("../query/index.js").WhereArgumentType): ModelClassQuery<MC>;
        /**
         * Runs ransack.
         * @template {typeof VelociousDatabaseRecord} MC
         * @this {MC}
         * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Ransack-style params hash.
         * @returns {ModelClassQuery<MC>} - Query with Ransack filters applied.
         */
        ransack<MC extends typeof VelociousDatabaseRecord>(this: MC, params: Record<string, ReturnType<typeof JSON.parse>>): ModelClassQuery<MC>;
    } | undefined;
    _isNewRecord: boolean;
    _databaseIdentity: string | undefined;
    /** @type {Record<string, string> | undefined} */
    static _attributeNameToColumnName: Record<string, string> | undefined;
    /** @type {Record<string, string> | undefined} */
    static _columnNameToAttributeName: Record<string, string> | undefined;
    /** @type {Record<string, object> | undefined} */
    static _translations: Record<string, object> | undefined;
    /** @type {Record<string, import("./validators/base.js").default[]> | undefined} */
    static _validators: Record<string, import("./validators/base.js").default[]> | undefined;
    /** @type {Record<string, LifecycleCallbackType[]> | undefined} */
    static _lifecycleCallbacks: Record<string, LifecycleCallbackType[]> | undefined;
    /** @type {Record<string, typeof import("./validators/base.js").default> | undefined} */
    static _validatorTypes: Record<string, typeof import("./validators/base.js").default> | undefined;
    /** @type {Record<string, RecordAttachmentConfiguration> | undefined} */
    static _attachmentsMap: Record<string, RecordAttachmentConfiguration> | undefined;
    /** @type {Record<string, import("./relationships/base.js").default> | undefined} */
    static _relationships: Record<string, import("./relationships/base.js").default> | undefined;
    /** @type {Record<string, import("../query/query-data.js").QueryDataFn> | undefined} */
    static _queryDataRegistrations: Record<string, import("../query/query-data.js").QueryDataFn> | undefined;
    /** @type {Record<string, {allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean}> | undefined} */
    static _acceptedNestedAttributes: Record<string, {
        allowDestroy?: boolean;
        limit?: number;
        rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean;
    }> | undefined;
    /** @type {Record<string, string> | undefined} */
    static _attributeCasts: Record<string, string> | undefined;
    /** @type {Record<string, import("../drivers/base-column.js").default> | undefined} */
    static _columnsAsHash: Record<string, import("../drivers/base-column.js").default> | undefined;
    /** @type {Array<string> | undefined} */
    static _columnNames: Array<string> | undefined;
    /** @type {Record<string, string> | undefined} */
    static _columnTypeByName: Record<string, string> | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {string | undefined} */
    static modelName: string | undefined;
    /**
     * Opt-in client sync declaration consumed by `SyncClient.fromConfiguration(...)`.
     * Declare `static sync = true` (all defaults) or a declaration object like
     * `static sync = {track: ["create", "update"], syncType: "upsert"}` to have the
     * sync client auto-discover this model and derive its resource config from
     * column metadata.
     * @type {import("../../sync/sync-client-types.js").ModelSyncDeclaration | undefined} */
    static sync: import("../../sync/sync-client-types.js").ModelSyncDeclaration | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Promise<void> | null | undefined} */
    static _initializeRecordPromise: Promise<void> | null | undefined;
    /** @type {typeof VelociousDatabaseRecord | undefined} Canonical model class exposed only by an operation-bound metadata proxy. */
    static _recordMetadataModelClass: typeof VelociousDatabaseRecord | undefined;
    /** @type {((modelClass: typeof VelociousDatabaseRecord) => typeof VelociousDatabaseRecord) | undefined} Binds related generated model classes to the same operation metadata generation. */
    static _recordMetadataBinder: ((modelClass: typeof VelociousDatabaseRecord) => typeof VelociousDatabaseRecord) | undefined;
    /** @type {import("../operation.js").default | undefined} Operation exposed only by a constructing metadata proxy. */
    static _recordMetadataOperation: import("../operation.js").default | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean | undefined} */
    static _eagerLoadRecordMetadata: boolean | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, import("./auditing.js").AuditCallback[]> | undefined} */
    static _auditCallbacks: Record<string, import("./auditing.js").AuditCallback[]> | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean | undefined} */
    static _auditLifecycleCallbacksRegistered: boolean | undefined;
    /**
     * Returns the model name, preferring an explicit `static modelName` declaration
     * over the JavaScript class `.name` property. This allows minified builds to
     * preserve correct model names without relying on `keep_classnames`.
     * @returns {string} - The model name.
     */
    static getModelName(): string;
    static getAttributeNameToColumnNameMap(): Record<string, string>;
    /**
     * Resolves the database column name for a record attribute name.
     * @param {string} attributeName - Attribute name to resolve.
     * @returns {string} - Mapped column name, or the underscored attribute name when no mapping exists.
     */
    static getColumnNameForAttributeName(attributeName: string): string;
    /**
     * Resolves an incoming attribute or column name to the canonical attribute name this model exposes.
     * Accepts the canonical (deburred) attribute name, a raw umlaut/acronym column name, a pre-deburr
     * camelization, and camelCase casing variants (e.g. "vAFunktionID" vs "vAFunktionid"). Returns null
     * when nothing matches, so callers keep their own not-found handling.
     * @param {string} name - Attribute name or column name to resolve.
     * @returns {string | null} - Canonical attribute name, or null.
     */
    static resolveAttributeName(name: string): string | null;
    /**
     * Finds the member name on a target's prototype chain matching `memberName`, falling back to a
     * case-insensitive match. Resolves setters when a read-only attribute alias differs only in camelCase
     * casing from the generated accessor (e.g. a "vAFunktionID" alias whose setter is "setVAFunktionid").
     * @param {object} target - Instance or prototype to search.
     * @param {string} memberName - Member name to find.
     * @returns {string | null} - Matching member name, or null when absent.
     */
    static findMemberNameInsensitive(target: object, memberName: string): string | null;
    /**
     * Runs define scope.
     * @param {(...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} callback - Scope callback.
     * @returns {((...args: Array<ReturnType<typeof JSON.parse>>) => import("../query/model-class-query.js").default<typeof VelociousDatabaseRecord>) & {scope: (...args: Array<ReturnType<typeof JSON.parse>>) => import("../../utils/model-scope.js").ModelScopeDescriptor}} - Scope helper.
     */
    static defineScope(callback: (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>): ((...args: Array<ReturnType<typeof JSON.parse>>) => import("../query/model-class-query.js").default<typeof VelociousDatabaseRecord>) & {
        scope: (...args: Array<ReturnType<typeof JSON.parse>>) => import("../../utils/model-scope.js").ModelScopeDescriptor;
    };
    /**
     * Returns the application model class behind an operation-bound metadata view.
     * @returns {typeof VelociousDatabaseRecord} - Canonical model class.
     */
    static canonicalRecordMetadataModelClass(): typeof VelociousDatabaseRecord;
    /**
     * Binds a relationship target to this model class's metadata generation.
     * @param {typeof VelociousDatabaseRecord} modelClass - Relationship target.
     * @returns {typeof VelociousDatabaseRecord} - Generation-bound target, or the unchanged target for legacy queries.
     */
    static bindRecordMetadataModelClass(modelClass: typeof VelociousDatabaseRecord): typeof VelociousDatabaseRecord;
    static getColumnNameToAttributeNameMap(): Record<string, string>;
    static getTranslationsMap(): Record<string, object>;
    static getValidatorsMap(): Record<string, import("./validators/base.js").default[]>;
    /**
     * Runs get lifecycle callbacks map.
     * @returns {Record<string, LifecycleCallbackType[]>} - Lifecycle callbacks keyed by name.
     */
    static getLifecycleCallbacksMap(): Record<string, LifecycleCallbackType[]>;
    static getValidatorTypesMap(): Record<string, typeof import("./validators/base.js").default>;
    /**
     * Runs get attachments map.
     * @returns {Record<string, RecordAttachmentConfiguration>} - Attachment definitions keyed by name.
     */
    static getAttachmentsMap(): Record<string, RecordAttachmentConfiguration>;
    /**
     * Attributes.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    _attributes: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Changes.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    _changes: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Changes captured before a create audit is written.
     * @type {import("./auditing.js").AuditChanges | undefined} */
    _pendingCreateAuditChanges: import("./auditing.js").AuditChanges | undefined;
    /**
     * Changes captured before an update audit is written.
     * @type {import("./auditing.js").AuditChanges | undefined} */
    _pendingUpdateAuditChanges: import("./auditing.js").AuditChanges | undefined;
    /**
     * Attribute names explicitly assigned in the current update call.
     * @type {Set<string> | undefined}
     */
    _assignedAttributeNames: Set<string> | undefined;
    /**
     * Columns as hash.
     * @type {Record<string, import("../drivers/base-column.js").default>} */
    _columnsAsHash: Record<string, import("../drivers/base-column.js").default>;
    /**
     * Connection.
     * @type {import("../drivers/base.js").default | undefined} */
    __connection: import("../drivers/base.js").default | undefined;
    /**
     * Explicit operation owning this record's database work.
     * @type {import("../operation.js").default | undefined} */
    _databaseOperation: import("../operation.js").default | undefined;
    /**
     * Instance relationships.
     * @type {Record<string, import("./instance-relationships/base.js").default>} */
    _instanceRelationships: Record<string, import("./instance-relationships/base.js").default>;
    /**
     * Attachments.
     * @type {Record<string, RecordAttachmentHandle>} */
    _attachments: Record<string, RecordAttachmentHandle>;
    /**
     * Load cohort.
     * @type {Array<VelociousDatabaseRecord> | undefined} - Shared reference to sibling records loaded in the same batch. Used by auto-preload.
     */
    _loadCohort: Array<VelociousDatabaseRecord> | undefined;
    /**
     * Table name.
     * @type {string | undefined} */
    __tableName: string | undefined;
    /**
     * Validation errors.
     * @type {Record<string, ValidationErrorObjectType[]>} */
    _validationErrors: Record<string, ValidationErrorObjectType[]>;
    static validatorTypes(): Record<string, typeof import("./validators/base.js").default>;
    /**
     * Runs register validator type.
     * @param {string} name - Name.
     * @param {typeof import("./validators/base.js").default} validatorClass - Validator class.
     */
    static registerValidatorType(name: string, validatorClass: typeof import("./validators/base.js").default): void;
    /**
     * Runs register lifecycle callback.
     * @param {"afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation"} callbackName - Callback type.
     * @param {LifecycleCallbackType} callback - Callback function or instance method name.
     * @returns {void}
     */
    static registerLifecycleCallback(callbackName: "afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation", callback: LifecycleCallbackType): void;
    /**
     * Runs unregister lifecycle callback.
     * @param {"afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation"} callbackName - Callback type.
     * @param {LifecycleCallbackType} callback - Previously registered callback.
     * @returns {void}
     */
    static unregisterLifecycleCallback(callbackName: "afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation", callback: LifecycleCallbackType): void;
    /**
     * Runs before validation.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static beforeValidation<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
    /**
     * Runs before save.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static beforeSave<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
    /**
     * Runs before create.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static beforeCreate<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
    /**
     * Runs before update.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static beforeUpdate<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
    /**
     * Runs before destroy.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static beforeDestroy<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
    /**
     * Runs after save.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static afterSave<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
    /**
     * Runs after create.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static afterCreate<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
    /**
     * Runs after update.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static afterUpdate<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
    /**
     * Runs after destroy.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static afterDestroy<R>(this: ModelConstructor<R>, callback: LifecycleCallbackType<R>): void;
    /**
     * Enables automatic create/update/destroy auditing for this model.
     * @returns {void}
     */
    static audited(): void;
    /**
     * Declares an aasm-style state machine on this model: named states, events
     * (guarded transitions), and enter/exit + before/after transition hooks. See
     * `state-machine.js`. Generates `event()` / `eventAndSave()` / `canEvent()`
     * transition methods per declared event.
     * @param {import("./state-machine.js").StateMachineDefinition} definition - State machine definition.
     * @returns {void}
     */
    static stateMachine(definition: import("./state-machine.js").StateMachineDefinition): void;
    /**
     * Returns this model's state machine definition, or null when it declares none.
     * `Model.stateMachine(...)` overrides this on classes that declare a machine.
     * @returns {import("./state-machine.js").StateMachineDefinition | null} - The state machine definition, or null when none is declared.
     */
    static getStateMachineDefinition(): import("./state-machine.js").StateMachineDefinition | null;
    /**
     * Returns this model's state column, or null when it declares no state machine.
     * @returns {string | null} - The state column name, or null when no state machine is declared.
     */
    static getStateMachineColumn(): string | null;
    /**
     * Returns this model's declared state names (empty when it has no state machine).
     * @returns {string[]} - The declared state names, or an empty array when no state machine is declared.
     */
    static getStateMachineStateNames(): string[];
    /**
     * Maintains a counter column on a `belongsTo` parent as the sum of a per-record
     * magnitude, kept current by atomic increments diffed on every create/update/
     * destroy (and moved between parents when the foreign key changes). See
     * `counter-cache-magnitude.js`.
     * @param {import("./counter-cache-magnitude.js").MagnitudeCounterCacheDefinition} definition - Counter cache definition.
     * @returns {void}
     */
    static magnitudeCounterCache(definition: import("./counter-cache-magnitude.js").MagnitudeCounterCacheDefinition): void;
    /**
     * Registers a callback invoked after this model writes an audit row for the action.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {string} action - Audit action name.
     * @param {import("./auditing.js").AuditCallback} callback - Callback to run after audit creation.
     * @returns {() => void} Unsubscribe function.
     */
    static onAudit<MC extends typeof VelociousDatabaseRecord>(this: MC, action: string, callback: import("./auditing.js").AuditCallback): () => void;
    /**
     * Returns records that do not have an audit row for the given action.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {string} action - Audit action name.
     * @returns {ModelClassQuery<MC>} Query scoped to records without that audit action.
     */
    static withoutAudit<MC extends typeof VelociousDatabaseRecord>(this: MC, action: string): ModelClassQuery<MC>;
    /**
     * Runs get validator type.
     * @param {string} validatorName - Validator name.
     * @returns {typeof import("./validators/base.js").default} - The validator type.
     */
    static getValidatorType(validatorName: string): typeof import("./validators/base.js").default;
    /**
     * Runs relationship exists.
     * @param {string} relationshipName - Relationship name.
     * @returns {boolean} - Whether relationship exists.
     */
    static _relationshipExists(relationshipName: string): boolean;
    /**
     * RelationshipScopeCallback type.
     * @typedef {(query: import("../query/model-class-query.js").default<typeof VelociousDatabaseRecord>) => (import("../query/model-class-query.js").default<typeof VelociousDatabaseRecord> | void)} RelationshipScopeCallback
     */
    /**
     * RelationshipDataArgumentType type.
     * @typedef {object} RelationshipDataArgumentType
     * @property {boolean} [autoload] - Disable auto-batch-preload for this relationship by passing false. Default true.
     * @property {string} [className] - Model class name for the related record.
     * @property {string} [dependent] - Dependent action when parent is destroyed (e.g. "destroy").
     * @property {typeof VelociousDatabaseRecord} [klass] - Model class for the related record.
     * @property {RelationshipScopeCallback} [scope] - Optional scope callback for the relationship.
     * @property {string} [type] - Relationship type (e.g. "hasMany", "belongsTo").
     */
    /**
     * Runs define relationship.
     * @param {string} relationshipName - Relationship name.
     * @param {RelationshipDataArgumentType} data - Data payload.
     */
    static _defineRelationship(relationshipName: string, data: RelationshipDataArgumentType): void;
    /**
     * Runs normalize relationship args.
     * @param {RelationshipScopeCallback | object | undefined} scopeOrOptions - Scope callback or options.
     * @param {object | undefined} options - Options.
     * @returns {{scope: (RelationshipScopeCallback | undefined), relationshipOptions: object}} - Normalized arguments.
     */
    static _normalizeRelationshipArgs(scopeOrOptions: RelationshipScopeCallback | object | undefined, options: object | undefined): {
        scope: (RelationshipScopeCallback | undefined);
        relationshipOptions: object;
    };
    /**
     * Registers afterCreate, afterSave, and afterDestroy callbacks to sync
     * a counter cache column on the parent model. The column name follows
     * the convention `<childModelPluralCamelCase>Count`.
     * @param {string} relationshipName - The belongsTo relationship name.
     */
    static _registerCounterCacheCallbacks(relationshipName: string): void;
    /**
     * Runs get relationship by name.
     * @param {string} relationshipName - Relationship name.
     * @returns {import("./relationships/base.js").default} - The relationship by name.
     */
    static getRelationshipByName(relationshipName: string): import("./relationships/base.js").default;
    /**
     * Runs get relationships.
     * @returns {Array<import("./relationships/base.js").default>} - The relationships.
     */
    static getRelationships(): Array<import("./relationships/base.js").default>;
    /**
     * Runs get relationships map.
     * @returns {Record<string, import("./relationships/base.js").default>} - Relationship definitions keyed by name.
     */
    static getRelationshipsMap(): Record<string, import("./relationships/base.js").default>;
    /**
     * Runs get relationship names.
     * @returns {Array<string>} - The relationship names.
     */
    static getRelationshipNames(): Array<string>;
    /**
     * Register a consumer-defined queryData entry. The callback receives
     * a grouped query already joined down the relationship chain from the
     * root of `.queryData(...)` to this model, already filtered by the
     * root parent IDs, and with `parent_id` pre-selected — so the fn
     * only needs to add its own SELECT (and optionally joins/where). Any
     * aliases the fn selects are attached to each **root** record via
     * `record.queryData(aliasName)`. Multi-column selects are fine — one
     * alias maps to one queryData key.
     *
     * **Quote AS aliases on PostgreSQL.** PostgreSQL folds unquoted
     * identifiers (including SELECT aliases) to lowercase, so a
     * `... AS manualTasksCount` lands in the result row as
     * `manualtaskscount` while the lookup `record.queryData("manualTasksCount")`
     * never finds it. Use `driver.quoteColumn("manualTasksCount")` for the
     * alias to preserve the case on every supported driver:
     *   query.select(`COUNT(...) AS ${driver.quoteColumn("manualTasksCount")}`)
     * @param {string} name - Identifier used in the `.queryData(...)` spec.
     * @param {import("../query/query-data.js").QueryDataFn} fn - Callback that mutates the query.
     * @returns {void}
     */
    static queryData(name: string, fn: import("../query/query-data.js").QueryDataFn): void;
    /**
     * Runs get query data map.
     * @returns {Record<string, import("../query/query-data.js").QueryDataFn>} - queryData registrations keyed by name.
     */
    static getQueryDataMap(): Record<string, import("../query/query-data.js").QueryDataFn>;
    /**
     * Runs get query data by name.
     * @param {string} name - queryData name.
     * @returns {import("../query/query-data.js").QueryDataFn | null} - Registered fn or null when not found.
     */
    static getQueryDataByName(name: string): import("../query/query-data.js").QueryDataFn | null;
    /**
     * Runs get attachments.
     * @returns {Record<string, RecordAttachmentConfiguration>} - Attachment definitions.
     */
    static getAttachments(): Record<string, RecordAttachmentConfiguration>;
    /**
     * Returns attachment definitions through the model contract shared with
     * frontend model classes.
     * @returns {Record<string, RecordAttachmentConfiguration>} - Attachment definitions.
     */
    static attachmentDefinitions(): Record<string, RecordAttachmentConfiguration>;
    /**
     * Runs get attachment by name.
     * @param {string} attachmentName - Attachment name.
     * @returns {RecordAttachmentConfiguration} - Attachment definition.
     */
    static getAttachmentByName(attachmentName: string): RecordAttachmentConfiguration;
    /**
     * Runs get relationship by name.
     * @param {string} relationshipName - Relationship name.
     * @returns {import("./instance-relationships/base.js").default} - The relationship by name.
     */
    getRelationshipByName(relationshipName: string): import("./instance-relationships/base.js").default;
    /**
     * Preloads relationship(s) onto this already-loaded record. Accepts either a
     * query built via `Model.preload(...).select(...)` or a raw preload spec
     * (string / array / nested object). A relationship that is already preloaded
     * with all the required columns present is left untouched unless `force` is
     * set. Preloading onto the relationship cache lets later accessors reuse the
     * loaded data instead of issuing identical queries.
     * @param {import("../query/model-class-query.js").default | import("../query/index.js").NestedPreloadRecord | string | Array<string | import("../query/index.js").NestedPreloadRecord>} queryOrSpec - Preload source.
     * @param {{force?: boolean}} [options] - Options.
     * @returns {Promise<void>} - Resolves when preloading completes.
     */
    preload(queryOrSpec: import("../query/model-class-query.js").default | import("../query/index.js").NestedPreloadRecord | string | Array<string | import("../query/index.js").NestedPreloadRecord>, options?: {
        force?: boolean;
    }): Promise<void>;
    /**
     * Runs load relationship.
     * @param {string} relationshipName - Relationship name.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Loaded relationship value.
     */
    loadRelationship(relationshipName: string): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs relationship or load.
     * @param {string} relationshipName - Relationship name.
     * @param {{preloadTranslations?: boolean}} [options] - Load options.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Loaded relationship value.
     */
    relationshipOrLoad(relationshipName: string, options?: {
        preloadTranslations?: boolean;
    }): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Preloads translations on a loaded relationship target when explicitly requested.
     * @param {ReturnType<typeof JSON.parse>} loaded - Loaded relationship value.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Relationship value after translation preload.
     */
    _preloadLoadedRelationshipTranslations(loaded: ReturnType<typeof JSON.parse>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs get attachment by name.
     * @param {string} attachmentName - Attachment name.
     * @returns {RecordAttachmentHandle} - Attachment handle.
     */
    getAttachmentByName(attachmentName: string): RecordAttachmentHandle;
    /**
     * Adds a belongs-to-relationship to the model.
     * @param {string} relationshipName The name of the relationship.
     * @param {RelationshipScopeCallback | object} [scopeOrOptions] The scope callback or options for the relationship.
     * @param {object} [options] The options for the relationship.
     */
    static belongsTo(relationshipName: string, scopeOrOptions?: RelationshipScopeCallback | object, options?: object): void;
    /**
     * Runs connection.
     * @param {object} [args] - Options.
     * @param {boolean} [args.enforceTenantDatabaseScope] - Whether tenant-switched models must resolve a tenant database identifier.
     * @returns {import("../drivers/base.js").default} - The connection.
     */
    static connection({ enforceTenantDatabaseScope, ...restArgs }?: {
        enforceTenantDatabaseScope?: boolean;
    }): import("../drivers/base.js").default;
    /**
     * Runs create.
     * @template {Record<string, ReturnType<typeof JSON.parse>>} CreateAttributes
     * @template {VelociousDatabaseRecord<CreateAttributes>} Model
     * @this {{new (changes?: CreateAttributes): Model} & typeof VelociousDatabaseRecord}
     * @param {CreateAttributes} [attributes] - Attributes.
     * @returns {Promise<Model>} - Resolves with the create.
     */
    static create<CreateAttributes extends Record<string, ReturnType<typeof JSON.parse>>, Model extends VelociousDatabaseRecord<CreateAttributes>>(this: {
        new (changes?: CreateAttributes): Model;
    } & typeof VelociousDatabaseRecord, attributes?: CreateAttributes): Promise<Model>;
    /**
     * Runs get configuration.
     * @returns {import("../../configuration.js").default} - The configuration.
     */
    static _getConfiguration(): import("../../configuration.js").default;
    /**
     * Runs get configuration.
     * @returns {import("../../configuration.js").default} - The configuration.
     */
    _getConfiguration(): import("../../configuration.js").default;
    /**
     * Adds a has-many-relationship to the model class.
     * @param {string} relationshipName The name of the relationship (e.g. "posts")
     * @param {RelationshipScopeCallback | object} [scopeOrOptions] The scope callback or options for the relationship.
     * @param {object} [options] The options for the relationship (e.g. {className: "Post"})
     * @returns {void} - No return value.
     */
    static hasMany(relationshipName: string, scopeOrOptions?: RelationshipScopeCallback | object, options?: object): void;
    /**
     * Rails-style declaration that this model accepts nested-attribute writes
     * for a relationship when saved through a parent. Required — Velocious
     * will refuse nested writes for any relationship not listed here, even
     * if a frontend-model resource permits them.
     *
     * Options:
     *   - allowDestroy: whether `_destroy: true` entries are allowed. Default false.
     *   - limit: optional upper bound on the number of nested entries per request.
     *   - rejectIf: optional predicate `(attributes) => boolean` that silently skips entries.
     *
     * Usage:
     *   class Project extends Record {}
     *   Project.hasMany("tasks")
     *   Project.acceptsNestedAttributesFor("tasks", {allowDestroy: true})
     * @param {string} relationshipName - Relationship name on this model.
     * @param {{allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean}} [options] - Policy options.
     * @returns {void}
     */
    static acceptsNestedAttributesFor(relationshipName: string, options?: {
        allowDestroy?: boolean;
        limit?: number;
        rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean;
    }): void;
    /**
     * Runs accepted nested attributes for.
     * @param {string} relationshipName - Relationship name.
     * @returns {{allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean} | null} - Policy declared via `acceptsNestedAttributesFor`, or null when not accepted.
     */
    static acceptedNestedAttributesFor(relationshipName: string): {
        allowDestroy?: boolean;
        limit?: number;
        rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean;
    } | null;
    /**
     * Adds a has-one-relationship to the model class.
     * @param {string} relationshipName The name of the relationship (e.g. "post")
     * @param {RelationshipScopeCallback | object} [scopeOrOptions] The scope callback or options for the relationship.
     * @param {object} [options] The options for the relationship (e.g. {className: "Post"})
     * @returns {void} - No return value.
     */
    static hasOne(relationshipName: string, scopeOrOptions?: RelationshipScopeCallback | object, options?: object): void;
    /**
     * Runs define attachment.
     * @param {string} attachmentName - Attachment name.
     * @param {object} args - Attachment args.
     * @param {string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>} [args.driver] - Attachment driver name, class, or instance.
     * @param {AttachmentSyncConfiguration} [args.sync] - Client-safe synchronized asset policy.
     * @param {"hasOne" | "hasMany"} args.type - Attachment type.
     * @returns {void} - No return value.
     */
    static _defineAttachment(attachmentName: string, { driver, sync, type }: {
        driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>;
        sync?: AttachmentSyncConfiguration;
        type: "hasOne" | "hasMany";
    }): void;
    /**
     * Adds a single attachment helper to the model.
     * @param {string} attachmentName - Attachment name.
     * @param {{driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, sync?: AttachmentSyncConfiguration}} [args] - Attachment options.
     * @returns {void} - No return value.
     */
    static hasOneAttachment(attachmentName: string, args?: {
        driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>;
        sync?: AttachmentSyncConfiguration;
    }): void;
    /**
     * Adds a collection attachment helper to the model.
     * @param {string} attachmentName - Attachment name.
     * @param {{driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, sync?: AttachmentSyncConfiguration}} [args] - Attachment options.
     * @returns {void} - No return value.
     */
    static hasManyAttachments(attachmentName: string, args?: {
        driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>;
        sync?: AttachmentSyncConfiguration;
    }): void;
    /**
     * Runs human attribute name.
     * @param {string} attributeName - Attribute name.
     * @returns {string} - The human attribute name.
     */
    static humanAttributeName(attributeName: string): string;
    /**
     * Runs get database type.
     * @returns {string} - The database type.
     */
    static getDatabaseType(): string;
    /**
     * Runs set eager load record metadata.
     * @param {boolean} eagerLoadRecordMetadata - Whether require-context initialization should load table metadata for this model.
     * @returns {void} - No return value.
     */
    static setEagerLoadRecordMetadata(eagerLoadRecordMetadata: boolean): void;
    /**
     * Runs get eager load record metadata.
     * @returns {boolean} - Whether require-context initialization should load table metadata for this model.
     */
    static getEagerLoadRecordMetadata(): boolean;
    /**
     * Runs reset record metadata.
     * @returns {void} - No return value.
     */
    static resetRecordMetadata(): void;
    /**
     * Static fields that belong to one physical database/schema generation.
     * @returns {Set<string>} - Metadata property names.
     */
    static recordMetadataPropertyNames(): Set<string>;
    /**
     * Reads one operation-bound metadata field.
     * @param {string} metadataKey - Physical database and schema generation key.
     * @param {string} property - Static metadata property.
     * @returns {RecordMetadataValue} - Stored metadata value.
     */
    static recordMetadataValue(metadataKey: string, property: string): RecordMetadataValue;
    /**
     * Writes one operation-bound metadata field.
     * @param {string} metadataKey - Physical database and schema generation key.
     * @param {string} property - Static metadata property.
     * @param {RecordMetadataValue} value - Metadata value.
     * @returns {void}
     */
    static setRecordMetadataValue(metadataKey: string, property: string, value: RecordMetadataValue): void;
    /** Clears every tenant/generation metadata snapshot for this model. */
    static clearRecordMetadataValues(): void;
    /**
     * Clears snapshots whose key belongs to one physical database identity.
     * @param {string} databaseIdentity - Logical identifier plus pool reuse key.
     * @returns {void}
     */
    static clearRecordMetadataValuesForDatabaseIdentity(databaseIdentity: string): void;
    /**
     * Registers the model class with a configuration without loading table metadata.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @returns {void} - No return value.
     */
    static registerRecordClass({ configuration, ...restArgs }: {
        configuration: import("../../configuration.js").default;
    }): void;
    /**
     * Runs initialize record.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {import("../drivers/base.js").default} [args.connection] - Explicit metadata connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    static initializeRecord({ configuration, connection: explicitConnection, ...restArgs }: {
        configuration: import("../../configuration.js").default;
        connection?: import("../drivers/base.js").default;
    }): Promise<void>;
    /**
     * Initializes the model class the first time an async record API needs table
     * metadata. Concurrent callers share the same initialization promise, and a
     * failed initialization can be retried by a later call.
     * @param {{configuration?: import("../../configuration.js").default, connection?: import("../drivers/base.js").default}} [args] - Optional configuration and explicit metadata connection.
     * @returns {Promise<void>} - Resolves when the model class is initialized.
     */
    static ensureInitialized(args?: {
        configuration?: import("../../configuration.js").default;
        connection?: import("../drivers/base.js").default;
    }): Promise<void>;
    /**
     * Runs has attribute.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {boolean} - Whether attribute.
     */
    _hasAttribute(value: ReturnType<typeof JSON.parse>): boolean;
    /**
     * Runs is initialized.
     * @returns {boolean} - Whether initialized.
     */
    static isInitialized(): boolean;
    /**
     * Runs assert has been initialized.
     * @returns {void} - No return value.
     */
    static _assertHasBeenInitialized(): void;
    /**
     * Defines translation accessors and initializes the generated translation
     * class through the same metadata connection as the translated model.
     * @param {import("../drivers/base.js").default} connection - Metadata connection.
     * @returns {Promise<void>} - Resolves when translation metadata is ready.
     */
    static _defineTranslationMethods(connection: import("../drivers/base.js").default): Promise<void>;
    /**
     * Runs get configured database identifier.
     * @returns {string} - The configured non-tenant database identifier.
     */
    static getConfiguredDatabaseIdentifier(): string;
    /**
     * Runs get database identifier.
     * @param {object} [args] - Options.
     * @param {boolean} [args.enforceTenantDatabaseScope] - Whether tenant-switched models must resolve a tenant database identifier.
     * @param {object} [args.tenant] - Explicit tenant descriptor instead of the ambient tenant.
     * @returns {string} - The database identifier.
     */
    static getDatabaseIdentifier({ enforceTenantDatabaseScope, tenant, ...restArgs }?: {
        enforceTenantDatabaseScope?: boolean;
        tenant?: object;
    }): string;
    /**
     * Runs set database identifier.
     * @param {string} databaseIdentifier - Database identifier.
     * @returns {void} - No return value.
     */
    static setDatabaseIdentifier(databaseIdentifier: string): void;
    /**
     * Declares a tenant-aware database identifier resolver for this model class.
     * @param {string | ((args: {modelClass: typeof VelociousDatabaseRecord, tenant: Record<string, unknown> | null | undefined}) => string | undefined)} databaseIdentifierOrResolver - Static identifier or resolver.
     * @returns {void} - No return value.
     */
    static switchesTenantDatabase(databaseIdentifierOrResolver: string | ((args: {
        modelClass: typeof VelociousDatabaseRecord;
        tenant: Record<string, unknown> | null | undefined;
    }) => string | undefined)): void;
    /**
     * Runs has tenant database identifier resolver.
     * @returns {boolean} - Whether this model resolves its database from the current tenant.
     */
    static hasTenantDatabaseIdentifierResolver(): boolean;
    /**
     * Runs get tenant database identifier.
     * @param {ReturnType<typeof JSON.parse>} [tenant] - Tenant override.
     * @returns {string | undefined} - Tenant-scoped database identifier when configured.
     */
    static getTenantDatabaseIdentifier(tenant?: ReturnType<typeof JSON.parse>): string | undefined;
    /**
     * Runs get attribute.
     * @param {string} name - Name.
     * @returns {ReturnType<typeof JSON.parse>} - The attribute.
     */
    getAttribute(name: string): ReturnType<typeof JSON.parse>;
    /**
     * Runs get model class.
     * @abstract
     * @returns {typeof VelociousDatabaseRecord} - The model class.
     */
    getModelClass(): typeof VelociousDatabaseRecord;
    /**
     * Runs set attribute.
     * @param {string} name - Name.
     * @param {ReturnType<typeof JSON.parse>} newValue - New value.
     * @returns {void} - No return value.
     */
    setAttribute(name: string, newValue: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs set column attribute.
     * @param {string} name - Name.
     * @param {ReturnType<typeof JSON.parse>} newValue - New value.
     */
    _setColumnAttribute(name: string, newValue: ReturnType<typeof JSON.parse>): void;
    /**
     * Clears loaded belongs-to caches when callers assign the foreign key directly.
     * @param {string} columnName - Changed database column name.
     * @param {ReturnType<typeof JSON.parse>} normalizedValue - New normalized column value.
     * @returns {void} - No return value.
     */
    _clearBelongsToRelationshipForChangedForeignKey(columnName: string, normalizedValue: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs belongs to relationships for foreign key.
     * @param {string} columnName - Changed database column name.
     * @returns {Array<ReturnType<typeof JSON.parse>>} - Loaded relationship instances that use the changed foreign key.
     */
    _belongsToRelationshipsForForeignKey(columnName: string): Array<ReturnType<typeof JSON.parse>>;
    /**
     * Runs belongs to relationship uses foreign key.
     * @param {object} args - Relationship match arguments.
     * @param {string} args.columnName - Changed database column name.
     * @param {ReturnType<typeof JSON.parse>} args.relationship - Relationship instance.
     * @returns {boolean} - Whether the relationship is a belongs-to using the changed foreign key.
     */
    _belongsToRelationshipUsesForeignKey({ columnName, relationship }: {
        columnName: string;
        relationship: ReturnType<typeof JSON.parse>;
    }): boolean;
    /**
     * Runs belongs to relationship matches foreign key value.
     * @param {object} args - Relationship cache arguments.
     * @param {ReturnType<typeof JSON.parse>} args.normalizedValue - New normalized column value.
     * @param {ReturnType<typeof JSON.parse>} args.relationship - Relationship instance.
     * @returns {boolean} - Whether the loaded related record still matches the changed foreign key.
     */
    _belongsToRelationshipMatchesForeignKeyValue({ normalizedValue, relationship }: {
        normalizedValue: ReturnType<typeof JSON.parse>;
        relationship: ReturnType<typeof JSON.parse>;
    }): boolean;
    /**
     * Returns the foreign key value for a belongs-to relationship assignment.
     * @param {object} args - Relationship assignment arguments.
     * @param {VelociousDatabaseRecord | null | undefined} args.model - Assigned model.
     * @param {import("./instance-relationships/base.js").default} args.relationship - Belongs-to relationship instance.
     * @returns {string | number | null | undefined} - Foreign key value for the assignment.
     */
    _belongsToForeignKeyValue({ model, relationship }: {
        model: VelociousDatabaseRecord | null | undefined;
        relationship: import("./instance-relationships/base.js").default;
    }): string | number | null | undefined;
    /**
     * Runs clear loaded belongs to relationship.
     * @param {ReturnType<typeof JSON.parse>} relationship - Relationship instance.
     * @returns {void} - No return value.
     */
    _clearLoadedBelongsToRelationship(relationship: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs normalize date value.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The date value.
     */
    _normalizeDateValue(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
    /**
     * Runs normalize sqlite boolean value.
     * @param {object} args - Options object.
     * @param {string | undefined} args.columnType - Column type.
     * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    _normalizeSqliteBooleanValue({ columnType, value }: {
        columnType: string | undefined;
        value: ReturnType<typeof JSON.parse>;
    }): ReturnType<typeof JSON.parse>;
    /**
     * Normalizes a boolean value before storing. A declared `"boolean"` attribute cast stores
     * booleans as 1/0 only for integer-backed columns (e.g. an MSSQL `bit`). Columns whose
     * underlying type is already a native boolean (e.g. Postgres `boolean`) keep `true`/`false`
     * so the driver can emit the proper boolean literal; otherwise the sqlite-only normalizer applies.
     * @param {object} args - Options object.
     * @param {string} args.attributeName - Attribute name being written.
     * @param {string | undefined} args.columnType - Column type.
     * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    _normalizeBooleanValueForWrite({ attributeName, columnType, value }: {
        attributeName: string;
        columnType: string | undefined;
        value: ReturnType<typeof JSON.parse>;
    }): ReturnType<typeof JSON.parse>;
    /**
     * Whether a declared `"boolean"` attribute cast is backed by an integer column (e.g. an MSSQL
     * `bit`), so booleans must be stored as 1/0. A native boolean column (e.g. Postgres `boolean`)
     * returns false and keeps `true`/`false` for the driver.
     * @param {string} attributeName - Attribute name.
     * @returns {boolean} - Whether the declared boolean is stored as an integer.
     */
    static _declaredBooleanStoresAsInteger(attributeName: string): boolean;
    /**
     * Runs get columns.
     * @returns {import("../drivers/base-column.js").default[]} - The columns.
     */
    static getColumns(): import("../drivers/base-column.js").default[];
    /**
     * Runs get columns hash.
     * @returns {Record<string, import("../drivers/base-column.js").default>} - The columns hash.
     */
    static getColumnsHash(): Record<string, import("../drivers/base-column.js").default>;
    /**
     * Runs get column type by name.
     * @param {string} name - Name.
     * @returns {string | undefined} - The column type by name.
     */
    static getColumnTypeByName(name: string): string | undefined;
    /**
     * Runs is date like type.
     * @param {string} type - Type identifier.
     * @returns {boolean} - Whether date like type.
     */
    static _isDateLikeType(type: string): boolean;
    /**
     * Runs get column names.
     * @returns {Array<string>} - The column names.
     */
    static getColumnNames(): Array<string>;
    /**
     * Runs get table.
     * @returns {import("../drivers/base-table.js").default} - The table.
     */
    static _getTable(): import("../drivers/base-table.js").default;
    /**
     * Runs insert multiple.
     * @param {Array<string>} columns - Column names.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} rows - Rows to insert.
     * @param {object} [args] - Options object.
     * @param {boolean} [args.cast] - Whether to cast values based on column types.
     * @param {boolean} [args.retryIndividuallyOnFailure] - Retry rows individually if a batch insert fails.
     * @param {boolean} [args.returnResults] - Return succeeded/failed rows instead of throwing when retries fail.
     * @returns {Promise<void | {succeededRows: Array<Array<ReturnType<typeof JSON.parse>>>, failedRows: Array<Array<ReturnType<typeof JSON.parse>>>, errors: Array<{row: Array<ReturnType<typeof JSON.parse>>, error: ReturnType<typeof JSON.parse>}>}>} - Resolves when complete.
     */
    static insertMultiple(columns: Array<string>, rows: Array<Array<ReturnType<typeof JSON.parse>>>, args?: {
        cast?: boolean;
        retryIndividuallyOnFailure?: boolean;
        returnResults?: boolean;
    }): Promise<void | {
        succeededRows: Array<Array<ReturnType<typeof JSON.parse>>>;
        failedRows: Array<Array<ReturnType<typeof JSON.parse>>>;
        errors: Array<{
            row: Array<ReturnType<typeof JSON.parse>>;
            error: ReturnType<typeof JSON.parse>;
        }>;
    }>;
    /**
     * Runs normalize insert multiple rows.
     * @param {object} args - Options object.
     * @param {Array<string>} args.columns - Column names.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} args.rows - Rows to insert.
     * @returns {Array<Array<ReturnType<typeof JSON.parse>>>} - Normalized rows.
     */
    static _normalizeInsertMultipleRows({ columns, rows }: {
        columns: Array<string>;
        rows: Array<Array<ReturnType<typeof JSON.parse>>>;
    }): Array<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Runs safe serialize insert row.
     * @param {Array<ReturnType<typeof JSON.parse>>} row - Row to serialize.
     * @returns {string} - Safe row representation.
     */
    static _safeSerializeInsertRow(row: Array<ReturnType<typeof JSON.parse>>): string;
    /**
     * Runs normalize insert value for column.
     * @param {object} args - Options object.
     * @param {string} args.columnName - Column name.
     * @param {ReturnType<typeof JSON.parse>} args.value - Column value.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    static _normalizeInsertValueForColumn({ columnName, value }: {
        columnName: string;
        value: ReturnType<typeof JSON.parse>;
    }): ReturnType<typeof JSON.parse>;
    /**
     * Runs is string type.
     * @param {string | undefined} columnType - Column type.
     * @returns {boolean} - Whether string-like type.
     */
    static _isStringType(columnType: string | undefined): boolean;
    /**
     * Runs is numeric type.
     * @param {string} columnType - Column type.
     * @returns {boolean} - Whether numeric-like type.
     */
    static _isNumericType(columnType: string): boolean;
    /**
     * Runs normalize numeric value.
     * @param {object} args - Options object.
     * @param {string} args.columnType - Column type.
     * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    static _normalizeNumericValue({ columnType, value }: {
        columnType: string;
        value: ReturnType<typeof JSON.parse>;
    }): ReturnType<typeof JSON.parse>;
    /**
     * Runs normalize date value for insert.
     * @param {ReturnType<typeof JSON.parse>} value - Value to normalize.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    static _normalizeDateValueForInsert(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
    /**
     * Runs normalize date string for insert.
     * @param {string} value - Date string value.
     * @returns {string | Date} - Parsed date or original string.
     */
    static _normalizeDateStringForInsert(value: string): string | Date;
    /**
     * Runs time zone for date writes.
     * @returns {string | undefined} - Active timezone identifier.
     */
    static _timeZoneForDateWrite(): string | undefined;
    /**
     * Runs normalize sqlite boolean value for insert.
     * @param {object} args - Options object.
     * @param {string | undefined} args.columnType - Column type.
     * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    static _normalizeSqliteBooleanValueForInsert({ columnType, value }: {
        columnType: string | undefined;
        value: ReturnType<typeof JSON.parse>;
    }): ReturnType<typeof JSON.parse>;
    /**
     * Runs next primary key.
     * @returns {Promise<number>} - Resolves with the next primary key.
     */
    static nextPrimaryKey(): Promise<number>;
    /**
     * Runs set primary key.
     * @param {string} primaryKey - Primary key.
     * @returns {void} - No return value.
     */
    static setPrimaryKey(primaryKey: string): void;
    /**
     * Returns this class's own attribute-cast map, creating it on the class itself
     * (never inherited from a parent) so subclasses don't share the same object.
     * @returns {Record<string, string>} - Declared casts keyed by attribute name.
     */
    static getAttributeCastsMap(): Record<string, string>;
    /**
     * Declares a Rails-style per-attribute cast so a column whose introspected type
     * isn't what the app wants (e.g. an MSSQL `bit` mapped to `number`) can be
     * exposed as another type with real runtime conversion. Currently fully
     * implements the `"boolean"` cast (0/1 <-> false/true); other types only record
     * the label so the effective type and generated typings reflect them.
     * @param {string} attributeName - Attribute name (camelCase), e.g. `"sichtbarVVK"`.
     * @param {string} type - Declared type, e.g. `"boolean"`.
     * @returns {void} - No return value.
     */
    static attribute(attributeName: string, type: string): void;
    /**
     * Returns the declared cast type for an attribute, if any.
     * @param {string} attributeName - Attribute name (camelCase).
     * @returns {string | undefined} - Declared cast type, or undefined when none is declared.
     */
    static getAttributeCast(attributeName: string): string | undefined;
    /**
     * Runs primary key.
     * @returns {string} - The primary key.
     */
    static primaryKey(): string;
    /**
     * Whether the model has a single primary key column. `setPrimaryKey(null)` (e.g. composite-key
     * legacy tables) declares no single primary key; `primaryKey()` still falls back to "id" for the
     * default case, so callers that must distinguish "no primary key" use this instead.
     * @returns {boolean} - False only when the primary key was explicitly set to null.
     */
    static hasPrimaryKey(): boolean;
    /**
     * Runs save.
     * @returns {Promise<void>} - Resolves when complete.
     */
    save(): Promise<void>;
    _autoSaveBelongsToRelationships(): Promise<{
        savedCount: number;
    }>;
    _autoSaveHasManyAndHasOneRelationshipsToSave(): import("./instance-relationships/base.js").default<typeof VelociousDatabaseRecord, typeof VelociousDatabaseRecord>[];
    /**
     * Resolves a relationship foreign-key column to this model's public attribute name.
     * @param {import("./instance-relationships/base.js").default<typeof VelociousDatabaseRecord, typeof VelociousDatabaseRecord>} instanceRelationship - Relationship instance.
     * @returns {string} Attribute name accepted by setAttribute/assign.
     */
    _relationshipForeignKeyAttribute(instanceRelationship: import("./instance-relationships/base.js").default<typeof VelociousDatabaseRecord, typeof VelociousDatabaseRecord>): string;
    /**
     * Runs auto save has many and has one relationships.
     * @param {object} args - Options object.
     * @param {boolean} args.isNewRecord - Whether is new record.
     */
    _autoSaveHasManyAndHasOneRelationships({ isNewRecord }: {
        isNewRecord: boolean;
    }): Promise<void>;
    /**
     * Runs auto save attachments.
     * @returns {Promise<void>} - Resolves when pending attachments have been saved.
     */
    _autoSaveAttachments(): Promise<void>;
    /**
     * Runs table name.
     * @returns {string} - The table name.
     */
    static tableName(): string;
    /**
     * Runs set table name.
     * @param {string} tableName - Table name.
     * @returns {void} - No return value.
     */
    static setTableName(tableName: string): void;
    /**
     * Runs transaction.
     * @param {() => Promise<void>} callback - Callback function.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the transaction.
     */
    static transaction(callback: () => Promise<void>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs the callback while holding a named advisory lock. Calls without
     * By default calls use the caller connection. Calls with `dedicatedConnection`
     * use a spawned lock connection that is released after the callback finishes,
     * while the callback itself still runs against the caller/model connection.
     * Calls with a positive `holdTimeoutMs` use a dedicated lock connection so
     * timeout cleanup can release the lock even when callback database work is
     * stuck. Advisory locks are cooperative and session-scoped: they serialize
     * callers that opt into the same `name`, without touching row or table locks,
     * so unrelated traffic is free to proceed.
     *
     * The lock is acquired before the callback runs and released in a
     * `finally` block afterwards, so the callback's return value is
     * propagated and thrown errors still release the lock.
     * @template T
     * @param {string} name - Lock name.
     * @param {() => Promise<T>} callback - Callback to invoke while the lock is held.
     * @param {{timeoutMs?: number | null, holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - `timeoutMs` caps how long we wait to acquire the lock; `holdTimeoutMs` caps how long the callback may hold it before the lock is released and `AdvisoryLockHoldTimeoutError` is thrown; `dedicatedConnection` spawns a separate lock session without enabling a hold timeout.
     * @returns {Promise<T>} - Resolves with the callback's return value.
     * @throws {AdvisoryLockTimeoutError} - If `timeoutMs` elapses before the lock is granted.
     * @throws {AdvisoryLockHoldTimeoutError} - If `holdTimeoutMs` elapses while the callback holds the lock.
     */
    static withAdvisoryLock<T>(name: string, callback: () => Promise<T>, args?: {
        timeoutMs?: number | null;
        holdTimeoutMs?: number | null;
        dedicatedConnection?: boolean;
    }): Promise<T>;
    /**
     * Runs the callback only if the named advisory lock can be acquired
     * immediately. If the lock is already held by any session, throws
     * `AdvisoryLockBusyError` without waiting.
     * Use this when contention is a signal that somebody else is already
     * doing the work and you want to bail out rather than queue up.
     * @template T
     * @param {string} name - Lock name.
     * @param {() => Promise<T>} callback - Callback to invoke while the lock is held.
     * @param {{holdTimeoutMs?: number | null, dedicatedConnection?: boolean}} [args] - `holdTimeoutMs` caps how long the callback may hold the lock before it is released and `AdvisoryLockHoldTimeoutError` is thrown; `dedicatedConnection` spawns a separate lock session without enabling a hold timeout.
     * @returns {Promise<T>} - Resolves with the callback's return value.
     * @throws {AdvisoryLockBusyError} - If the lock is already held.
     * @throws {AdvisoryLockHoldTimeoutError} - If `holdTimeoutMs` elapses while the callback holds the lock.
     */
    static withAdvisoryLockOrFail<T>(name: string, callback: () => Promise<T>, args?: {
        holdTimeoutMs?: number | null;
        dedicatedConnection?: boolean;
    }): Promise<T>;
    /**
     * Runs `callback`, rejecting with `AdvisoryLockHoldTimeoutError` if it has
     * not settled within `holdTimeoutMs`. The callback is not cancelled — this is
     * a safety net, not cancellation.
     * @template T
     * @param {string} name - Lock name (for the error message).
     * @param {() => Promise<T>} callback - Callback holding the lock.
     * @param {number | null} [holdTimeoutMs] - Max hold time; falsy disables the timeout.
     * @returns {Promise<T>} - Callback result after the lock-protected operation.
     */
    static runWithAdvisoryLockHoldTimeout<T>(name: string, callback: () => Promise<T>, holdTimeoutMs?: number | null): Promise<T>;
    /**
     * Returns true if the named advisory lock is currently held by any
     * session. Primarily useful as a diagnostic; callers that want to act
     * on the result should prefer `withAdvisoryLockOrFail` to avoid a
     * TOCTOU window between the check and the action.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory lock is currently held.
     */
    static hasAdvisoryLock(name: string): Promise<boolean>;
    /**
     * Runs translates.
     * @param {...string} names - Names.
     * @returns {void} - No return value.
     */
    static translates(...names: string[]): void;
    /**
     * Runs current translation scope.
     * @param {ModelClassQuery} query - Translation query.
     * @returns {ModelClassQuery} - Scoped query.
     */
    static currentTranslationScope(query: ModelClassQuery): ModelClassQuery;
    /**
     * Runs get translation class.
     * @returns {typeof VelociousDatabaseRecord} - The translation class.
     */
    static getTranslationClass(): typeof VelociousDatabaseRecord;
    /**
     * Runs get translations table name.
     * @returns {string} - The translations table name.
     */
    static getTranslationsTableName(): string;
    /**
     * Runs has translations table.
     * @returns {Promise<boolean>} - Resolves with Whether it has translations table.
     */
    static hasTranslationsTable(): Promise<boolean>;
    /**
     * Adds a validation to an attribute.
     * @param {string} attributeName The name of the attribute to validate.
     * @param {Record<string, boolean | Record<string, ReturnType<typeof JSON.parse>>>} validators The validators to add. Key is the validator name, value is the validator arguments.
     */
    static validates(attributeName: string, validators: Record<string, boolean | Record<string, ReturnType<typeof JSON.parse>>>): Promise<void>;
    /**
     * Registers gap-less positional list callbacks for a column scoped by
     * another column. Inserts and moves shift surrounding positions so the
     * list stays compact (1,2,3,...). Destroys close the resulting gap.
     *
     * Callers must ensure a UNIQUE index on (scopeColumn, positionColumn)
     * exists in the database — use `Migration.addActsAsList()` for the
     * schema half.
     * @param {string} positionColumn - camelCase position attribute (e.g. "rowNumber").
     * @param {object} options - Options with a required scope attribute.
     * @param {string} options.scope - camelCase scope attribute (e.g. "boardColumnId").
     */
    static actsAsList(positionColumn: string, options: {
        scope: string;
    }): void;
    /**
     * Runs translations loaded.
     * @abstract
     * @returns {TranslationBase[]} - The translations loaded.
     */
    translationsLoaded(): TranslationBase[];
    /**
     * Runs get translated attribute.
     * @param {string} name - Name.
     * @param {string} locale - Locale.
     * @returns {string | undefined} - The translated attribute, if found.
     */
    _getTranslatedAttribute(name: string, locale: string): string | undefined;
    /**
     * Runs get translated attribute with fallback.
     * @param {string} name - Name.
     * @param {string} locale - Locale.
     * @returns {string | undefined} - The translated attribute with fallback, if found.
     */
    _getTranslatedAttributeWithFallback(name: string, locale: string): string | undefined;
    /**
     * Runs set translated attribute.
     * @param {string} name - Name.
     * @param {string} locale - Locale.
     * @param {ReturnType<typeof JSON.parse>} newValue - New value.
     * @returns {void} - No return value.
     */
    _setTranslatedAttribute(name: string, locale: string, newValue: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs new query.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {{driver?: import("../drivers/base.js").default | (() => import("../drivers/base.js").default), operation?: import("../operation.js").default}} [args] - Explicit query ownership.
     * @returns {ModelClassQuery<MC>} - The new query.
     */
    static _newQuery<MC extends typeof VelociousDatabaseRecord>(this: MC, args?: {
        driver?: import("../drivers/base.js").default | (() => import("../drivers/base.js").default);
        operation?: import("../operation.js").default;
    }): ModelClassQuery<MC>;
    /**
     * Runs orderable column.
     * @returns {string} - The orderable column.
     */
    static orderableColumn(): string;
    /**
     * Runs all.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @returns {ModelClassQuery<MC>} - The all.
     */
    static all<MC extends typeof VelociousDatabaseRecord>(this: MC): ModelClassQuery<MC>;
    /**
     * Runs accessible for.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {string} action - Ability action to scope by.
     * @param {import("../../authorization/ability.js").default | undefined} [ability] - Ability instance.
     * @returns {ModelClassQuery<MC>} - Authorized query.
     */
    static accessibleFor<MC extends typeof VelociousDatabaseRecord>(this: MC, action: string, ability?: import("../../authorization/ability.js").default | undefined): ModelClassQuery<MC>;
    /**
     * Runs accessible.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {import("../../authorization/ability.js").default | undefined} [ability] - Ability instance.
     * @returns {ModelClassQuery<MC>} - Authorized query.
     */
    static accessible<MC extends typeof VelociousDatabaseRecord>(this: MC, ability?: import("../../authorization/ability.js").default | undefined): ModelClassQuery<MC>;
    /**
     * Runs accessible by.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {import("../../authorization/ability.js").default} ability - Ability instance.
     * @returns {ModelClassQuery<MC>} - Authorized query.
     */
    static accessibleBy<MC extends typeof VelociousDatabaseRecord>(this: MC, ability: import("../../authorization/ability.js").default): ModelClassQuery<MC>;
    /**
     * Runs count.
     * @returns {Promise<number>} - Resolves with the count.
     */
    static count(): Promise<number>;
    /**
     * Runs group.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {string} group - Group.
     * @returns {ModelClassQuery<MC>} - The group.
     */
    static group<MC extends typeof VelociousDatabaseRecord>(this: MC, group: string): ModelClassQuery<MC>;
    static destroyAll(): Promise<void>;
    /**
     * Runs pluck.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {...string|string[]} columns - Column names.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Resolves with the pluck.
     */
    static pluck<MC extends typeof VelociousDatabaseRecord>(this: MC, ...columns: (string | string[])[]): Promise<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Runs find.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {number|string} recordId - Record id.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the find.
     */
    static find<MC extends typeof VelociousDatabaseRecord>(this: MC, recordId: number | string): Promise<InstanceType<MC>>;
    /**
     * Runs find by.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
     * @returns {Promise<InstanceType<MC> | null>} - Resolves with the by.
     */
    static findBy<MC extends typeof VelociousDatabaseRecord>(this: MC, conditions: {
        [key: string]: string | number;
    }): Promise<InstanceType<MC> | null>;
    /**
     * Runs find by or fail.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the by or fail.
     */
    static findByOrFail<MC extends typeof VelociousDatabaseRecord>(this: MC, conditions: {
        [key: string]: string | number;
    }): Promise<InstanceType<MC>>;
    /**
     * Returns an immutable tenant-bound model scope. Eager helpers and explicit
     * databaseOperation/transaction callbacks execute from a captured physical
     * database configuration instead of ambient tenant state.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {object} tenant - Ordinary or null-prototype JSON-compatible tenant descriptor to scope the model to.
     * @returns {TenantModelScope<MC>} - Model scope bound to the captured tenant database.
     */
    static usingTenant<MC extends typeof VelociousDatabaseRecord>(this: MC, tenant: object): TenantModelScope<MC>;
    /**
     * Runs find or create by.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
     * @param {() => void} [callback] - Callback function.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the or create by.
     */
    static findOrCreateBy<MC extends typeof VelociousDatabaseRecord>(this: MC, conditions: {
        [key: string]: string | number;
    }, callback?: () => void): Promise<InstanceType<MC>>;
    /**
     * Runs find or initialize by.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {Record<string, string | number>} conditions - Conditions.
     * @param {(arg: InstanceType<MC>) => void} [callback] - Callback function.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the or initialize by.
     */
    static findOrInitializeBy<MC extends typeof VelociousDatabaseRecord>(this: MC, conditions: Record<string, string | number>, callback?: (arg: InstanceType<MC>) => void): Promise<InstanceType<MC>>;
    /**
     * Runs first.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @returns {Promise<InstanceType<MC>>} - Resolves with the first.
     */
    static first<MC extends typeof VelociousDatabaseRecord>(this: MC): Promise<InstanceType<MC>>;
    /**
     * Runs joins.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {string | import("../query/join-object.js").JoinObject} join - Join clause or join descriptor.
     * @returns {ModelClassQuery<MC>} - The joins.
     */
    static joins<MC extends typeof VelociousDatabaseRecord>(this: MC, join: string | import("../query/join-object.js").JoinObject): ModelClassQuery<MC>;
    /**
     * Runs last.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @returns {Promise<InstanceType<MC>>} - Resolves with the last.
     */
    static last<MC extends typeof VelociousDatabaseRecord>(this: MC): Promise<InstanceType<MC>>;
    /**
     * Runs limit.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {number} value - Value to use.
     * @returns {ModelClassQuery<MC>} - The limit.
     */
    static limit<MC extends typeof VelociousDatabaseRecord>(this: MC, value: number): ModelClassQuery<MC>;
    /**
     * Runs order.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {import("../query/index.js").OrderArgumentType} order - Order.
     * @returns {ModelClassQuery<MC>} - The order.
     */
    static order<MC extends typeof VelociousDatabaseRecord>(this: MC, order: import("../query/index.js").OrderArgumentType): ModelClassQuery<MC>;
    /**
     * Runs distinct.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {boolean} [value] - Value to use.
     * @returns {ModelClassQuery<MC>} - The distinct.
     */
    static distinct<MC extends typeof VelociousDatabaseRecord>(this: MC, value?: boolean): ModelClassQuery<MC>;
    /**
     * Runs preload.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {import("../query/index.js").NestedPreloadRecord | string | Array<string | import("../query/index.js").NestedPreloadRecord>} preload - Preload.
     * @returns {ModelClassQuery<MC>} - The preload.
     */
    static preload<MC extends typeof VelociousDatabaseRecord>(this: MC, preload: import("../query/index.js").NestedPreloadRecord | string | Array<string | import("../query/index.js").NestedPreloadRecord>): ModelClassQuery<MC>;
    /**
     * Runs select.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {import("../query/index.js").SelectArgumentType} select - Select.
     * @returns {ModelClassQuery<MC>} - The select.
     */
    static select<MC extends typeof VelociousDatabaseRecord>(this: MC, select: import("../query/index.js").SelectArgumentType): ModelClassQuery<MC>;
    /**
     * Runs to array.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @returns {Promise<InstanceType<MC>[]>} - Resolves with the array.
     */
    static toArray<MC extends typeof VelociousDatabaseRecord>(this: MC): Promise<InstanceType<MC>[]>;
    /**
     * Runs load.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @returns {Promise<InstanceType<MC>[]>} - Resolves with the array.
     */
    static load<MC extends typeof VelociousDatabaseRecord>(this: MC): Promise<InstanceType<MC>[]>;
    /**
     * Runs where.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {import("../query/index.js").WhereArgumentType} where - Where.
     * @returns {ModelClassQuery<MC>} - The where.
     */
    static where<MC extends typeof VelociousDatabaseRecord>(this: MC, where: import("../query/index.js").WhereArgumentType): ModelClassQuery<MC>;
    /**
     * Runs ransack.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Ransack-style params hash.
     * @returns {ModelClassQuery<MC>} - Query with Ransack filters applied.
     */
    static ransack<MC extends typeof VelociousDatabaseRecord>(this: MC, params: Record<string, ReturnType<typeof JSON.parse>>): ModelClassQuery<MC>;
    /**
     * Runs constructor.
     * @param {WriteAttributes} changes - Changes.
     */
    constructor(changes?: WriteAttributes);
    /**
     * Binds future query, lifecycle, relationship, and persistence work to an operation.
     * @param {import("../operation.js").default} operation - Owning operation.
     * @returns {this} - Bound record.
     */
    bindDatabaseOperation(operation: import("../operation.js").default): this;
    /**
     * Captures and validates the physical database identity that owns this record.
     * @param {string} databaseIdentity - Opaque operation/connection identity.
     * @returns {this} This record.
     */
    captureDatabaseIdentity(databaseIdentity: string): this;
    /**
     * Returns the captured physical database identity.
     * @returns {string | undefined} Captured physical database identity.
     */
    databaseIdentity(): string | undefined;
    /**
     * Releases this record from a completed eager-helper operation while
     * preserving the legacy ambient follow-up behavior of `usingTenant` finders.
     * @param {import("../operation.js").default} operation - Releasing operation.
     * @returns {this} - Record.
     */
    releaseDatabaseOperation(operation: import("../operation.js").default): this;
    /**
     * Returns the explicit operation owning this record, if any.
     * @returns {import("../operation.js").default | undefined} - Owning operation.
     */
    databaseOperation(): import("../operation.js").default | undefined;
    /**
     * Binds a related record to the same operation as this record.
     * @template {VelociousDatabaseRecord} Model
     * @param {Model} record - Related record.
     * @returns {Model} - Related record.
     */
    bindRelatedRecord<Model extends VelociousDatabaseRecord>(record: Model): Model;
    /**
     * Builds a model query preserving this record's operation ownership.
     * @template {typeof VelociousDatabaseRecord} MC
     * @param {MC} ModelClass - Target model class.
     * @returns {ModelClassQuery<MC>} - Target query.
     */
    queryForModel<MC extends typeof VelociousDatabaseRecord>(ModelClass: MC): ModelClassQuery<MC>;
    /**
     * Initializes a relationship/preload target without dropping this record's
     * explicit operation connection.
     * @param {typeof VelociousDatabaseRecord} ModelClass - Target model class.
     * @param {import("../../configuration.js").default} configuration - Owning configuration.
     * @returns {Promise<void>} - Resolves when initialized.
     */
    ensureModelClassInitialized(ModelClass: typeof VelociousDatabaseRecord, configuration: import("../../configuration.js").default): Promise<void>;
    /**
     * Runs load existing record.
     * @param {object} attributes - Attributes.
     * @returns {void} - No return value.
     */
    loadExistingRecord(attributes: object): void;
    /**
     * Assigns the given attributes to the record.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} attributesToAssign - Attributes to assign.
     * @returns {void} - No return value.
     */
    assign(attributesToAssign: Record<string, ReturnType<typeof JSON.parse>>): void;
    /**
     * Returns a the current attributes of the record (original attributes from database plus changes)
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The attributes.
     */
    attributes(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Returns column-name keyed data (original attributes from database plus changes)
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The raw attributes.
     */
    rawAttributes(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs connection.
     * @returns {import("../drivers/base.js").default} - The connection.
     */
    _connection(): import("../drivers/base.js").default;
    /**
     * Resolves the identity of an already selected concrete connection.
     * @param {import("../drivers/base.js").default} connection - Concrete connection.
     * @returns {string} Physical database identity.
     */
    _databaseIdentityForConnection(connection: import("../drivers/base.js").default): string;
    /**
     * Returns the connection that owns this record's database work.
     * @returns {import("../drivers/base.js").default} - Connection.
     */
    connection(): import("../drivers/base.js").default;
    /**
     * Counts dependent records for a `dependent: "restrict"` relationship.
     * @param {RestrictInstanceRelationship} instanceRelationship - Relationship instance to count.
     * @returns {Promise<number>} - Dependent row count.
     */
    _dependentRestrictCount(instanceRelationship: RestrictInstanceRelationship): Promise<number>;
    /**
     * Counts tenant-scoped dependent records across all provider-listed tenants.
     * @param {RestrictInstanceRelationship} instanceRelationship - Relationship instance to count.
     * @param {typeof VelociousDatabaseRecord} TargetModelClass - Related model class.
     * @returns {Promise<number>} - Dependent row count.
     */
    _dependentRestrictTenantCount(instanceRelationship: RestrictInstanceRelationship, TargetModelClass: typeof VelociousDatabaseRecord): Promise<number>;
    /**
     * Counts tenant-scoped dependent records for one configured tenant provider.
     * @param {RestrictInstanceRelationship} instanceRelationship - Relationship instance to count.
     * @param {typeof VelociousDatabaseRecord} TargetModelClass - Related model class.
     * @param {string} identifier - Tenant database identifier.
     * @param {TenantDatabaseProviderType} provider - Tenant database provider.
     * @returns {Promise<number>} - Dependent row count.
     */
    _dependentRestrictProviderCount(instanceRelationship: RestrictInstanceRelationship, TargetModelClass: typeof VelociousDatabaseRecord, identifier: string, provider: TenantDatabaseProviderType): Promise<number>;
    /**
     * Lists restrict-check tenants for one configured tenant provider.
     * @param {RestrictInstanceRelationship} instanceRelationship - Relationship instance to count.
     * @param {typeof VelociousDatabaseRecord} TargetModelClass - Related model class.
     * @param {string} identifier - Tenant database identifier.
     * @param {TenantDatabaseProviderType} provider - Tenant database provider.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Listed tenant objects.
     */
    _dependentRestrictProviderTenants(instanceRelationship: RestrictInstanceRelationship, TargetModelClass: typeof VelociousDatabaseRecord, identifier: string, provider: TenantDatabaseProviderType): Promise<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Destroys the record in the database and all of its dependent records.
     * @returns {Promise<void>} - Resolves when complete.
     */
    destroy(): Promise<void>;
    /**
     * Emits a committed record-change event after the surrounding transaction
     * commits, so live queries re-run uniformly for local writes, pull applies, and
     * realtime applies (which all end as local saves/destroys). Registered through
     * the connection's afterCommit hook so a rolled-back save emits nothing, and
     * skipped entirely when nothing observes this model class so server-side saves
     * stay free of live-query overhead.
     * @param {import("../record-changes.js").RecordChangeOperation} operation - The committed operation.
     * @returns {Promise<void>}
     */
    _emitRecordChangeAfterCommit(operation: import("../record-changes.js").RecordChangeOperation): Promise<void>;
    /**
     * Stores an audit row for this record.
     * @param {import("./auditing.js").CreateAuditArgs} args - Audit row options.
     * @returns {Promise<number | string>} Created audit row id.
     */
    createAudit(args: import("./auditing.js").CreateAuditArgs): Promise<number | string>;
    /**
     * Captures create changes before persistence clears the change set.
     * @returns {void}
     */
    captureCreateAuditChanges(): void;
    /**
     * Writes the create audit row.
     * @returns {Promise<void>}
     */
    createCreateAudit(): Promise<void>;
    /**
     * Captures update changes before persistence clears the change set.
     * @returns {void}
     */
    captureUpdateAuditChanges(): void;
    /**
     * Writes the update audit row.
     * @returns {Promise<void>}
     */
    createUpdateAudit(): Promise<void>;
    /**
     * Writes the destroy audit row.
     * @returns {Promise<void>}
     */
    createDestroyAudit(): Promise<void>;
    /**
     * Runs run lifecycle callbacks.
     * @param {"afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation"} callbackName - Callback type.
     * @returns {Promise<void>}
     */
    _runLifecycleCallbacks(callbackName: "afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation"): Promise<void>;
    /**
     * Runs has changes.
     * @returns {boolean} - Whether changes.
     */
    _hasChanges(): boolean;
    /**
     * Returns true if the model has been changed since it was loaded from the database.
     * @returns {boolean} - Whether changed.
     */
    isChanged(): boolean;
    /**
     * Returns the changes that have been made to this record since it was loaded from the database.
     * @returns {Record<string, Array<ReturnType<typeof JSON.parse>>>} - The changes.
     */
    changes(): Record<string, Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Runs table name.
     * @returns {string} - The table name.
     */
    _tableName(): string;
    /**
     * Reads an attribute value from the record. Read dynamically by name, so the value can be any
     * column type and may be overridden by a user-defined getter on the model.
     * @template V
     * @param {string} attributeName The name of the attribute to read. This is the attribute name, not the column name.
     * @returns {V} The attribute value, typed by the caller's accessor contract.
     */
    readAttribute<V>(attributeName: string): V;
    /**
     * Read an association count attached by `.withCount(...)`. Counts are
     * stored on a separate map from the record's `_attributes` so a
     * virtual count like `tasksCount` cannot silently shadow a real
     * column of the same name. Returns the attached number, or 0 when
     * `.withCount(...)` wasn't requested for this attribute.
     * @param {string} attributeName - Attribute name, e.g. `"tasksCount"` or a custom `"activeMembersCount"` from `.withCount({activeMembersCount: {...}})`.
     * @returns {number} - Attached association count, or zero when absent.
     */
    readCount(attributeName: string): number;
    /**
     * Attach an association count to this record. Internal helper used by
     * the `withCount` runner; outside code should not call this directly.
     * @param {string} attributeName - Attribute name.
     * @param {number} value - Count value.
     * @returns {void}
     */
    _setAssociationCount(attributeName: string, value: number): void;
    /**
     * All attached association counts as a plain object. Used by the
     * frontend-model serializer to ship counts alongside the record
     * attributes on the wire.
     * @returns {Record<string, number>} - Association counts keyed by attribute name.
     */
    associationCounts(): Record<string, number>;
    /**
     * Read a value attached by `.queryData(...)`. Stored on a dedicated
     * map rather than on `_attributes`, so a virtual queryData key like
     * `transportSecondsSum` cannot silently shadow a real column of the
     * same name. Returns `null` when the key wasn't produced by any
     * registered fn for this record (e.g. no child rows matched the
     * aggregate).
     * @param {string} name - queryData attribute name (matches a SELECT alias from the registered fn).
     * @returns {ReturnType<typeof JSON.parse>} - Attached query-data value.
     */
    queryData(name: string): ReturnType<typeof JSON.parse>;
    /**
     * Attach a queryData value to this record. Internal helper used by
     * the `queryData` runner and by frontend-model hydration; outside
     * code should not call this directly.
     * @param {string} name - queryData attribute name.
     * @param {ReturnType<typeof JSON.parse>} value - Value to attach.
     * @returns {void}
     */
    _setQueryData(name: string, value: ReturnType<typeof JSON.parse>): void;
    /**
     * All attached queryData values as a plain object. Used by the
     * frontend-model serializer to ship queryData alongside the record
     * attributes on the wire.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Query-data values keyed by name.
     */
    queryDataValues(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Read a per-record ability result attached by `.abilities(...)`. The
     * backend evaluates each requested action against the current ability
     * for this record instance and ships the result alongside the
     * record's attributes. Returns `false` when the action wasn't
     * requested for this record — so UI code can safely branch on
     * `record.can("update")` without first checking whether the ability
     * was loaded.
     * @param {string} action - Ability action name, e.g. `"update"`.
     * @returns {boolean} - Whether the requested ability is allowed.
     */
    can(action: string): boolean;
    /**
     * Attach a per-record ability result to this record. Internal helper
     * used by the `abilities` runner and by frontend-model hydration;
     * outside code should not call this directly.
     * @param {string} action - Ability action name.
     * @param {boolean} value - Whether the current ability permits the action on this record.
     * @returns {void}
     */
    _setComputedAbility(action: string, value: boolean): void;
    /**
     * All attached per-record ability results as a plain object. Used
     * by the frontend-model serializer to ship results alongside the
     * record attributes on the wire.
     * @returns {Record<string, boolean>} - Ability results keyed by action.
     */
    computedAbilities(): Record<string, boolean>;
    /**
     * Reads a column value from the record.
     * @param {string} attributeName The name of the column to read. This is the column name, not the attribute name.
     * @returns {ReturnType<typeof JSON.parse>} - The column.
     */
    readColumn(attributeName: string): ReturnType<typeof JSON.parse>;
    /**
     * Resolves any declared per-attribute cast for a database column name.
     * @param {string} columnName - Database column name.
     * @returns {string | undefined} - Declared cast type, or undefined when none is declared.
     */
    _declaredAttributeCastForColumn(columnName: string): string | undefined;
    /**
     * Converts a stored value to a real boolean for a declared `"boolean"` cast.
     * Leaves null/undefined untouched; treats 1/true/"1" as true and 0/false/"0" as false.
     * @param {ReturnType<typeof JSON.parse>} value - Stored database value.
     * @returns {ReturnType<typeof JSON.parse>} - Converted boolean, or the original value when not recognized.
     */
    _castDeclaredBooleanForRead(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
    /**
     * Whether a column value is currently loaded on this record (either as a
     * persisted attribute or a pending change). Used to decide whether a preload
     * can be skipped because the required columns are already present.
     * @param {string} columnName - The column name to check.
     * @returns {boolean} - Whether the column is loaded.
     */
    hasLoadedColumn(columnName: string): boolean;
    /**
     * Runs normalize boolean value for read. A declared `"boolean"` attribute cast converts the
     * stored value (e.g. an MSSQL `bit` 0/1) to a real boolean; otherwise the existing
     * introspected-type normalization applies (no behaviour change for non-declared columns).
     * @param {object} args - Options object.
     * @param {string} args.columnName - Database column name being read.
     * @param {string | undefined} args.columnType - Column type.
     * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    _normalizeBooleanValueForRead({ columnName, columnType, value }: {
        columnName: string;
        columnType: string | undefined;
        value: ReturnType<typeof JSON.parse>;
    }): ReturnType<typeof JSON.parse>;
    /**
     * Runs normalize date value for read.
     * @param {ReturnType<typeof JSON.parse>} value - Value from database.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    _normalizeDateValueForRead(value: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
    _belongsToChanges(): Record<string, any>;
    /**
     * Runs create new record.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _createNewRecord(): Promise<void>;
    /**
     * Marks only relationships with in-memory loaded values as preloaded after create.
     * @returns {void} - No return value.
     */
    _markLoadedRelationshipsPreloadedAfterCreate(): void;
    /**
     * Applies the database insert response to this record.
     * @param {{connection: import("../drivers/base.js").default, data: Record<string, string | number | boolean | Date | null | undefined>, insertResult: Array<Record<string, string | number | boolean | Date | null | undefined>> | null | undefined, primaryKey: string}} options - Pinned insert connection, inserted data, connection result, and primary key column name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _applyInsertResult({ connection, data, insertResult, primaryKey }: {
        connection: import("../drivers/base.js").default;
        data: Record<string, string | number | boolean | Date | null | undefined>;
        insertResult: Array<Record<string, string | number | boolean | Date | null | undefined>> | null | undefined;
        primaryKey: string;
    }): Promise<void>;
    /**
     * Sets timestamp defaults for a new record insert.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Column-keyed data.
     * @returns {void} - No return value.
     */
    _setDefaultTimestampValues(data: Record<string, ReturnType<typeof JSON.parse>>): void;
    /**
     * Runs normalize date values for write.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Column-keyed data.
     * @returns {void} - No return value.
     */
    _normalizeDateValuesForWrite(data: Record<string, ReturnType<typeof JSON.parse>>): void;
    /**
     * Runs update record with changes.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _updateRecordWithChanges(): Promise<void>;
    /**
     * Runs id.
     * @returns {number|string} - The id.
     */
    id(): number | string;
    /**
     * Runs is persisted.
     * @returns {boolean} - Whether persisted.
     */
    isPersisted(): boolean;
    /**
     * Runs is new record.
     * @returns {boolean} - Whether new record.
     */
    isNewRecord(): boolean;
    /**
     * Runs set is new record.
     * @param {boolean} newIsNewRecord - New is new record.
     * @returns {void} - No return value.
     */
    setIsNewRecord(newIsNewRecord: boolean): void;
    /**
     * Runs reload with id.
     * @template {typeof VelociousDatabaseRecord} MC
     * @param {string | number} id - Record identifier.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _reloadWithId<MC extends typeof VelociousDatabaseRecord>(id: string | number): Promise<void>;
    /**
     * Runs reload.
     * @returns {Promise<void>} - Resolves when complete.
     */
    reload(): Promise<void>;
    _runValidations(): Promise<void>;
    /**
     * Runs full error messages.
     * @returns {string[]} - The full error messages.
     */
    fullErrorMessages(): string[];
    /**
     * Assigns the attributes to the record and saves it.
     * @param {WriteAttributes} attributesToAssign - The attributes to assign to the record.
     */
    update(attributesToAssign: WriteAttributes): Promise<void>;
}
export { AdvisoryLockBusyError, AdvisoryLockHoldTimeoutError, AdvisoryLockTimeoutError, TenantDatabaseScopeError, ValidationError };
export default VelociousDatabaseRecord;
//# sourceMappingURL=index.d.ts.map