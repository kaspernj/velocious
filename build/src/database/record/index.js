// @ts-check
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
import AdvisoryLockRunner, { AdvisoryLockBusyError, AdvisoryLockHoldTimeoutError, AdvisoryLockTimeoutError } from "../advisory-lock-runner.js";
import BelongsToInstanceRelationship from "./instance-relationships/belongs-to.js";
import BelongsToRelationship from "./relationships/belongs-to.js";
import Configuration from "../../configuration.js";
import Current from "../../current.js";
import FromTable from "../query/from-table.js";
import Handler from "../handler.js";
import HasManyInstanceRelationship from "./instance-relationships/has-many.js";
import HasManyRelationship from "./relationships/has-many.js";
import HasOneInstanceRelationship from "./instance-relationships/has-one.js";
import HasOneRelationship from "./relationships/has-one.js";
import RecordAttachmentHandle from "./attachments/handle.js";
import { recordAttachmentsStoreForModel, recordAttachmentsStoreForModelClass } from "./attachments/store.js";
import * as inflection from "inflection";
import deburrColumnName from "../../utils/deburr-column-name.js";
import ModelClassQuery from "../query/model-class-query.js";
import Preloader from "../query/preloader.js";
import { readPayloadAssociationCount, readPayloadComputedAbility, readPayloadQueryData, setPayloadAssociationCount, setPayloadComputedAbility, setPayloadQueryData } from "../../record-payload-values.js";
import recordChanges from "../record-changes.js";
import restArgsError from "../../utils/rest-args-error.js";
import singularizeModelName from "../../utils/singularize-model-name.js";
import { defineModelScope } from "../../utils/model-scope.js";
import { normalizeDateStringForWrite, normalizeDateValueForRead, normalizeDateValueForWrite } from "../datetime-storage.js";
import { formatValue } from "../../utils/format-value.js";
import { modelPrimaryKeyCacheKey, modelPrimaryKeyConditions, readModelPrimaryKeyValue, scalarModelPrimaryKey, scalarModelPrimaryKeyValue } from "../../utils/model-primary-key.js";
import { captureCreateAuditChanges, captureUpdateAuditChanges, createAudit, createCreateAudit, createDestroyAudit, createUpdateAudit, initializeAuditing, registerAuditCallback, registerAuditing, withoutAudit } from "./auditing.js";
import { registerMagnitudeCounterCache } from "./counter-cache-magnitude.js";
import { prepareCounterCacheParentUpdate, scheduleCounterCacheParentUpdate } from "./counter-cache-parent-updates.js";
import { stateMachine } from "./state-machine.js";
import ValidatorsFormat from "./validators/format.js";
import ValidatorsLength from "./validators/length.js";
import ValidatorsPresence from "./validators/presence.js";
import ValidatorsUniqueness from "./validators/uniqueness.js";
import registerActsAsListCallbacks from "./acts-as-list.js";
import TenantModelScope from "../../tenants/tenant-model-scope.js";
import UUID from "pure-uuid";
/**
 * Translation record shape used by translated attributes.
 * @typedef {VelociousDatabaseRecord & {locale: () => string}} TranslationBase
 */
/**
 * AttachmentDriverConstructor type.
 * @typedef {import("../../configuration-types.js").AttachmentDriverConstructor} AttachmentDriverConstructor
 */
/** @typedef {import("../../configuration-types.js").AttachmentSyncConfiguration} AttachmentSyncConfiguration */
/** @typedef {import("../../configuration-types.js").RecordAttachmentConfiguration} RecordAttachmentConfiguration */
/** Stored values that a declared `"boolean"` cast reads back as `true`. */
const declaredBooleanTruthyValues = new Set([1, true, "1"]);
/** Stored values that a declared `"boolean"` cast reads back as `false`. */
const declaredBooleanFalsyValues = new Set([0, false, "0"]);
/** Static record metadata fields isolated per physical database/schema generation. */
const recordMetadataPropertyNames = new Set([
    "_attributeNameToColumnName",
    "_columnNameToAttributeName",
    "_columnNames",
    "_columns",
    "_columnsAsHash",
    "_columnTypeByName",
    "_databaseType",
    "_initialized",
    "_initializeRecordPromise",
    "_table"
]);
/** @type {WeakMap<typeof import("./index.js").default, Map<string, Map<string, RecordMetadataValue>>>} */
const recordMetadataValuesByModel = new WeakMap();
/**
 * Returns the generation-keyed metadata store owned by one canonical model.
 * @param {typeof import("./index.js").default} modelClass - Canonical model class.
 * @returns {Map<string, Map<string, RecordMetadataValue>>} - Metadata store.
 */
function recordMetadataValuesFor(modelClass) {
    let values = recordMetadataValuesByModel.get(modelClass);
    if (!values) {
        values = new Map();
        recordMetadataValuesByModel.set(modelClass, values);
    }
    return values;
}
class ValidationError extends Error {
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} - Velocious metadata for frontend-model error reporting.
     */
    velocious;
    /**
     * Runs get model.
     * @returns {VelociousDatabaseRecord} - The model.
     */
    getModel() {
        if (!this._model)
            throw new Error("Model hasn't been set");
        return this._model;
    }
    /**
     * Runs set model.
     * @param {VelociousDatabaseRecord} model - Model instance.
     * @returns {void} - No return value.
     */
    setModel(model) {
        this._model = model;
    }
    /**
     * Runs get validation errors.
     * @returns {Record<string, ValidationErrorObjectType[]>} - The validation errors.
     */
    getValidationErrors() {
        if (!this._validationErrors)
            throw new Error("Validation errors hasn't been set");
        return this._validationErrors;
    }
    /**
     * Runs set validation errors.
     * @param {Record<string, ValidationErrorObjectType[]>} validationErrors - Validation errors to assign.
     */
    setValidationErrors(validationErrors) {
        this._validationErrors = validationErrors;
    }
}
/**
 * Runs apply built record inverse relationship.
 * @param {object} args - Options.
 * @param {VelociousDatabaseRecord} args.parent - Parent record being built from.
 * @param {{getRelationshipByName: VelociousDatabaseRecord["getRelationshipByName"]}} args.record - Newly built related record.
 * @param {string | undefined | null} args.inverseOf - Inverse relationship name.
 * @param {boolean} args.allowHasMany - Whether a has-many inverse should be appended.
 * @returns {void}
 */
function applyBuiltRecordInverseRelationship({ allowHasMany, inverseOf, parent, record }) {
    if (!inverseOf)
        return;
    const inverseInstanceRelationship = record.getRelationshipByName(inverseOf);
    inverseInstanceRelationship.setAutoSave(false);
    if (!allowHasMany || inverseInstanceRelationship.getType() == "hasOne") {
        inverseInstanceRelationship.setLoaded(parent);
        return;
    }
    if (inverseInstanceRelationship.getType() == "hasMany") {
        inverseInstanceRelationship.addToLoaded(parent);
        return;
    }
    throw new Error(`Unknown relationship type: ${inverseInstanceRelationship.getType()}`);
}
/**
 * Build a related record and wire its inverse relationship to the parent.
 * @param {VelociousDatabaseRecord} parent - Parent record building the relationship.
 * @param {string} relationshipName - Relationship name being built.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Attributes for the new related record.
 * @param {boolean} allowHasMany - Whether has-many inverse relationships should append the parent.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Built related record.
 */
function buildRelatedRecordWithInverse(parent, relationshipName, attributes, allowHasMany) {
    const instanceRelationship = parent.getRelationshipByName(relationshipName);
    const record = instanceRelationship.build(attributes);
    const inverseOf = instanceRelationship.getRelationship().getInverseOf();
    applyBuiltRecordInverseRelationship({
        allowHasMany,
        inverseOf,
        parent,
        record: /** @type {{getRelationshipByName: VelociousDatabaseRecord["getRelationshipByName"]}} */ (record)
    });
    return record;
}
class TenantDatabaseScopeError extends Error {
    /**
     * Runs constructor.
     * @param {string} message - Error message.
     * @param {{modelName: string}} args - Context for the failed tenant-scoped model.
     */
    constructor(message, { modelName }) {
        super(message);
        this.name = "TenantDatabaseScopeError";
        this.modelName = modelName;
    }
}
/**
 * Base database record.
 * @template {Record<string, ReturnType<typeof JSON.parse>>} [WriteAttributes=Record<string, ReturnType<typeof JSON.parse>>]
 */
class VelociousDatabaseRecord {
    /** @type {Record<string, string> | undefined} */
    static _attributeNameToColumnName = undefined;
    /** @type {Record<string, string> | undefined} */
    static _columnNameToAttributeName = undefined;
    /** @type {Record<string, object> | undefined} */
    static _translations = undefined;
    /** @type {Record<string, import("./validators/base.js").default[]> | undefined} */
    static _validators = undefined;
    /** @type {Record<string, LifecycleCallbackType[]> | undefined} */
    static _lifecycleCallbacks = undefined;
    /** @type {Record<string, typeof import("./validators/base.js").default> | undefined} */
    static _validatorTypes = undefined;
    /** @type {Record<string, RecordAttachmentConfiguration> | undefined} */
    static _attachmentsMap = undefined;
    /** @type {Record<string, import("./relationships/base.js").default> | undefined} */
    static _relationships = undefined;
    /** @type {Record<string, import("../query/query-data.js").QueryDataFn> | undefined} */
    static _queryDataRegistrations = undefined;
    /** @type {Record<string, {allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean}> | undefined} */
    static _acceptedNestedAttributes = undefined;
    /** @type {Record<string, string> | undefined} */
    static _attributeCasts = undefined;
    /** @type {Record<string, import("../drivers/base-column.js").default> | undefined} */
    static _columnsAsHash = undefined;
    /** @type {Array<string> | undefined} */
    static _columnNames = undefined;
    /** @type {Record<string, string> | undefined} */
    static _columnTypeByName = undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {string | undefined} */
    static modelName;
    /**
     * Opt-in client sync declaration consumed by `SyncClient.fromConfiguration(...)`.
     * Declare `static sync = true` (all defaults) or a declaration object like
     * `static sync = {track: ["create", "update"], syncType: "upsert"}` to have the
     * sync client auto-discover this model and derive its resource config from
     * column metadata.
     * @type {import("../../sync/sync-client-types.js").ModelSyncDeclaration | undefined} */
    static sync;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Promise<void> | null | undefined} */
    static _initializeRecordPromise;
    /** @type {typeof VelociousDatabaseRecord | undefined} Canonical model class exposed only by an operation-bound metadata proxy. */
    static _recordMetadataModelClass;
    /** @type {((modelClass: typeof VelociousDatabaseRecord) => typeof VelociousDatabaseRecord) | undefined} Binds related generated model classes to the same operation metadata generation. */
    static _recordMetadataBinder;
    /** @type {import("../operation.js").default | undefined} Operation exposed only by a constructing metadata proxy. */
    static _recordMetadataOperation;
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean | undefined} */
    static _eagerLoadRecordMetadata;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Record<string, import("./auditing.js").AuditCallback[]> | undefined} */
    static _auditCallbacks;
    /**
     * Narrows the runtime value to the documented type.
     * @type {boolean | undefined} */
    static _auditLifecycleCallbacksRegistered;
    /**
     * Returns the model name, preferring an explicit `static modelName` declaration
     * over the JavaScript class `.name` property. This allows minified builds to
     * preserve correct model names without relying on `keep_classnames`.
     * @returns {string} - The model name.
     */
    static getModelName() {
        if (typeof this.modelName === "string" && this.modelName.length > 0)
            return this.modelName;
        return this.name;
    }
    static getAttributeNameToColumnNameMap() {
        if (!this._attributeNameToColumnName) {
            /**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, string>} */
            this._attributeNameToColumnName = {};
        }
        return this._attributeNameToColumnName;
    }
    /**
     * Resolves the database column name for a record attribute name.
     * @param {string} attributeName - Attribute name to resolve.
     * @returns {string} - Mapped column name, or the underscored attribute name when no mapping exists.
     */
    static getColumnNameForAttributeName(attributeName) {
        const resolvedAttributeName = this.resolveAttributeName(attributeName);
        if (resolvedAttributeName)
            return this.getAttributeNameToColumnNameMap()[resolvedAttributeName];
        return inflection.underscore(inflection.camelize(deburrColumnName(attributeName), true));
    }
    /**
     * Resolves an incoming attribute or column name to the canonical attribute name this model exposes.
     * Accepts the canonical (deburred) attribute name, a raw umlaut/acronym column name, a pre-deburr
     * camelization, and camelCase casing variants (e.g. "vAFunktionID" vs "vAFunktionid"). Returns null
     * when nothing matches, so callers keep their own not-found handling.
     * @param {string} name - Attribute name or column name to resolve.
     * @returns {string | null} - Canonical attribute name, or null.
     */
    static resolveAttributeName(name) {
        const attributeNameToColumnNameMap = this.getAttributeNameToColumnNameMap();
        if (name in attributeNameToColumnNameMap)
            return name;
        const normalizedAttributeName = inflection.camelize(deburrColumnName(name), true);
        if (normalizedAttributeName in attributeNameToColumnNameMap)
            return normalizedAttributeName;
        const columnNameToAttributeNameMap = this.getColumnNameToAttributeNameMap();
        if (name in columnNameToAttributeNameMap)
            return columnNameToAttributeNameMap[name];
        // Final fallback: match camelCase casing variants against the model's generated accessors. These
        // exist on the prototype before runtime initialization (unlike the attribute map), so this also
        // resolves names looked up during create, before the map is built. inflection lower-cases trailing
        // acronyms ("ID" -> "id"), so "vAFunktionID"/"VA_FunktionID" still resolve to "vAFunktionid".
        const lowerNormalizedAttributeName = normalizedAttributeName.toLowerCase();
        let prototype = this.prototype;
        while (prototype && prototype !== Object.prototype) {
            for (const accessorName of Object.getOwnPropertyNames(prototype)) {
                if (accessorName.toLowerCase() === lowerNormalizedAttributeName)
                    return accessorName;
            }
            prototype = Object.getPrototypeOf(prototype);
        }
        return null;
    }
    /**
     * Finds the member name on a target's prototype chain matching `memberName`, falling back to a
     * case-insensitive match. Resolves setters when a read-only attribute alias differs only in camelCase
     * casing from the generated accessor (e.g. a "vAFunktionID" alias whose setter is "setVAFunktionid").
     * @param {object} target - Instance or prototype to search.
     * @param {string} memberName - Member name to find.
     * @returns {string | null} - Matching member name, or null when absent.
     */
    static findMemberNameInsensitive(target, memberName) {
        if (memberName in target)
            return memberName;
        const lowerMemberName = memberName.toLowerCase();
        let current = target;
        while (current && current !== Object.prototype) {
            for (const candidateName of Object.getOwnPropertyNames(current)) {
                if (candidateName.toLowerCase() === lowerMemberName)
                    return candidateName;
            }
            current = Object.getPrototypeOf(current);
        }
        return null;
    }
    /**
     * Runs define scope.
     * @param {(...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} callback - Scope callback.
     * @returns {((...args: Array<ReturnType<typeof JSON.parse>>) => import("../query/model-class-query.js").default<typeof VelociousDatabaseRecord>) & {scope: (...args: Array<ReturnType<typeof JSON.parse>>) => import("../../utils/model-scope.js").ModelScopeDescriptor}} - Scope helper.
     */
    static defineScope(callback) {
        return defineModelScope({
            callback,
            modelClass: this,
            startQuery: (modelClass = this) => {
                // This backend scope factory can only be invoked through a DatabaseRecord class.
                const BackendModelClass = /** @type {typeof VelociousDatabaseRecord} */ (modelClass);
                return BackendModelClass._newQuery();
            }
        });
    }
    /**
     * Returns the application model class behind an operation-bound metadata view.
     * @returns {typeof VelociousDatabaseRecord} - Canonical model class.
     */
    static canonicalRecordMetadataModelClass() {
        return this._recordMetadataModelClass || this;
    }
    /**
     * Binds a relationship target to this model class's metadata generation.
     * @param {typeof VelociousDatabaseRecord} modelClass - Relationship target.
     * @returns {typeof VelociousDatabaseRecord} - Generation-bound target, or the unchanged target for legacy queries.
     */
    static bindRecordMetadataModelClass(modelClass) {
        return this._recordMetadataBinder ? this._recordMetadataBinder(modelClass) : modelClass;
    }
    static getColumnNameToAttributeNameMap() {
        if (!this._columnNameToAttributeName) {
            /**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, string>} */
            this._columnNameToAttributeName = {};
        }
        return this._columnNameToAttributeName;
    }
    static getTranslationsMap() {
        if (!this._translations) {
            /**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, object>} */
            this._translations = {};
        }
        return this._translations;
    }
    static getValidatorsMap() {
        if (!this._validators) {
            /**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, import("./validators/base.js").default[]>} */
            this._validators = {};
        }
        return this._validators;
    }
    /**
     * Runs get lifecycle callbacks map.
     * @returns {Record<string, LifecycleCallbackType[]>} - Lifecycle callbacks keyed by name.
     */
    static getLifecycleCallbacksMap() {
        if (!this._lifecycleCallbacks) {
            /**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, LifecycleCallbackType[]>} */
            this._lifecycleCallbacks = {};
        }
        return this._lifecycleCallbacks;
    }
    static getValidatorTypesMap() {
        if (!this._validatorTypes) {
            /**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, typeof import("./validators/base.js").default>} */
            this._validatorTypes = {};
        }
        return this._validatorTypes;
    }
    /**
     * Runs get attachments map.
     * @returns {Record<string, RecordAttachmentConfiguration>} - Attachment definitions keyed by name.
     */
    static getAttachmentsMap() {
        if (!this._attachmentsMap) {
            /**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, RecordAttachmentConfiguration>} */
            this._attachmentsMap = {};
        }
        return this._attachmentsMap;
    }
    /**
     * Attributes.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    _attributes = {};
    /**
     * Unmapped result aliases explicitly selected by the query that hydrated this record.
     * @type {Set<string>} */
    _selectedAttributeAliases = new Set();
    /**
     * Changes.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    _changes = {};
    /**
     * Whether primary-key reads are pinned to the stored attributes.
     * @type {boolean} */
    _readsPersistedPrimaryKey = false;
    /**
     * Changes captured before a create audit is written.
     * @type {import("./auditing.js").AuditChanges | undefined} */
    _pendingCreateAuditChanges = undefined;
    /**
     * Changes captured before an update audit is written.
     * @type {import("./auditing.js").AuditChanges | undefined} */
    _pendingUpdateAuditChanges = undefined;
    /**
     * Attribute names explicitly assigned in the current update call.
     * @type {Set<string> | undefined}
     */
    _assignedAttributeNames = undefined;
    /**
     * Columns as hash.
     * @type {Record<string, import("../drivers/base-column.js").default>} */
    _columnsAsHash = {};
    /**
     * Connection.
     * @type {import("../drivers/base.js").default | undefined} */
    __connection = undefined;
    /**
     * Explicit operation owning this record's database work.
     * @type {import("../operation.js").default | undefined} */
    _databaseOperation = undefined;
    /**
     * Instance relationships.
     * @type {Record<string, import("./instance-relationships/base.js").default>} */
    _instanceRelationships = {};
    /**
     * Attachments.
     * @type {Record<string, RecordAttachmentHandle>} */
    _attachments = {};
    /**
     * Load cohort.
     * @type {Array<VelociousDatabaseRecord> | undefined} - Shared reference to sibling records loaded in the same batch. Used by auto-preload.
     */
    _loadCohort = undefined;
    /**
     * Table name.
     * @type {string | undefined} */
    __tableName = undefined;
    /**
     * Validation errors.
     * @type {Record<string, ValidationErrorObjectType[]>} */
    _validationErrors = {};
    static validatorTypes() {
        return this.getValidatorTypesMap();
    }
    /**
     * Runs register validator type.
     * @param {string} name - Name.
     * @param {typeof import("./validators/base.js").default} validatorClass - Validator class.
     */
    static registerValidatorType(name, validatorClass) {
        this.validatorTypes()[name] = validatorClass;
    }
    /**
     * Runs register lifecycle callback.
     * @param {"afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation"} callbackName - Callback type.
     * @param {LifecycleCallbackType} callback - Callback function or instance method name.
     * @returns {void}
     */
    static registerLifecycleCallback(callbackName, callback) {
        const callbacks = this.getLifecycleCallbacksMap();
        if (!callbacks[callbackName]) {
            callbacks[callbackName] = [];
        }
        callbacks[callbackName].push(callback);
    }
    /**
     * Runs unregister lifecycle callback.
     * @param {"afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation"} callbackName - Callback type.
     * @param {LifecycleCallbackType} callback - Previously registered callback.
     * @returns {void}
     */
    static unregisterLifecycleCallback(callbackName, callback) {
        const callbacks = this.getLifecycleCallbacksMap()[callbackName];
        if (!callbacks)
            return;
        const callbackIndex = callbacks.indexOf(callback);
        if (callbackIndex >= 0)
            callbacks.splice(callbackIndex, 1);
    }
    /**
     * Runs before validation.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static beforeValidation(callback) {
        VelociousDatabaseRecord.registerLifecycleCallback.call(this, "beforeValidation", /** @type {LifecycleCallbackType} */ (callback));
    }
    /**
     * Runs before save.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static beforeSave(callback) {
        VelociousDatabaseRecord.registerLifecycleCallback.call(this, "beforeSave", /** @type {LifecycleCallbackType} */ (callback));
    }
    /**
     * Runs before create.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static beforeCreate(callback) {
        VelociousDatabaseRecord.registerLifecycleCallback.call(this, "beforeCreate", /** @type {LifecycleCallbackType} */ (callback));
    }
    /**
     * Runs before update.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static beforeUpdate(callback) {
        VelociousDatabaseRecord.registerLifecycleCallback.call(this, "beforeUpdate", /** @type {LifecycleCallbackType} */ (callback));
    }
    /**
     * Runs before destroy.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static beforeDestroy(callback) {
        VelociousDatabaseRecord.registerLifecycleCallback.call(this, "beforeDestroy", /** @type {LifecycleCallbackType} */ (callback));
    }
    /**
     * Runs after save.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static afterSave(callback) {
        VelociousDatabaseRecord.registerLifecycleCallback.call(this, "afterSave", /** @type {LifecycleCallbackType} */ (callback));
    }
    /**
     * Runs after create.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static afterCreate(callback) {
        VelociousDatabaseRecord.registerLifecycleCallback.call(this, "afterCreate", /** @type {LifecycleCallbackType} */ (callback));
    }
    /**
     * Runs after update.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static afterUpdate(callback) {
        VelociousDatabaseRecord.registerLifecycleCallback.call(this, "afterUpdate", /** @type {LifecycleCallbackType} */ (callback));
    }
    /**
     * Runs after destroy.
     * @template R
     * @this {ModelConstructor<R>}
     * @param {LifecycleCallbackType<R>} callback - Callback function or instance method name.
     * @returns {void}
     */
    static afterDestroy(callback) {
        VelociousDatabaseRecord.registerLifecycleCallback.call(this, "afterDestroy", /** @type {LifecycleCallbackType} */ (callback));
    }
    /**
     * Enables automatic create/update/destroy auditing for this model.
     * @returns {void}
     */
    static audited() {
        registerAuditing(this);
    }
    /**
     * Declares an aasm-style state machine on this model: named states, events
     * (guarded transitions), and enter/exit + before/after transition hooks. See
     * `state-machine.js`. Generates `event()` / `eventAndSave()` / `canEvent()`
     * transition methods per declared event.
     * @param {import("./state-machine.js").StateMachineDefinition} definition - State machine definition.
     * @returns {void}
     */
    static stateMachine(definition) {
        stateMachine(this, definition);
    }
    /**
     * Returns this model's state machine definition, or null when it declares none.
     * `Model.stateMachine(...)` overrides this on classes that declare a machine.
     * @returns {import("./state-machine.js").StateMachineDefinition | null} - The state machine definition, or null when none is declared.
     */
    static getStateMachineDefinition() {
        return null;
    }
    /**
     * Returns this model's state column, or null when it declares no state machine.
     * @returns {string | null} - The state column name, or null when no state machine is declared.
     */
    static getStateMachineColumn() {
        return null;
    }
    /**
     * Returns this model's declared state names (empty when it has no state machine).
     * @returns {string[]} - The declared state names, or an empty array when no state machine is declared.
     */
    static getStateMachineStateNames() {
        return [];
    }
    /**
     * Maintains a counter column on a `belongsTo` parent as the sum of a per-record
     * magnitude, kept current by atomic increments diffed on every create/update/
     * destroy (and moved between parents when the foreign key changes). See
     * `counter-cache-magnitude.js`.
     * @param {import("./counter-cache-magnitude.js").MagnitudeCounterCacheDefinition} definition - Counter cache definition.
     * @returns {void}
     */
    static magnitudeCounterCache(definition) {
        registerMagnitudeCounterCache(this, definition);
    }
    /**
     * Registers a callback invoked after this model writes an audit row for the action.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {string} action - Audit action name.
     * @param {import("./auditing.js").AuditCallback} callback - Callback to run after audit creation.
     * @returns {() => void} Unsubscribe function.
     */
    static onAudit(action, callback) {
        return registerAuditCallback(this, action, callback);
    }
    /**
     * Returns records that do not have an audit row for the given action.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {string} action - Audit action name.
     * @returns {ModelClassQuery<MC>} Query scoped to records without that audit action.
     */
    static withoutAudit(action) {
        return withoutAudit(this, action);
    }
    /**
     * Runs get validator type.
     * @param {string} validatorName - Validator name.
     * @returns {typeof import("./validators/base.js").default} - The validator type.
     */
    static getValidatorType(validatorName) {
        if (!(validatorName in this.validatorTypes()))
            throw new Error(`Validator type ${validatorName} not found`);
        return this.validatorTypes()[validatorName];
    }
    /**
     * Runs relationship exists.
     * @param {string} relationshipName - Relationship name.
     * @returns {boolean} - Whether relationship exists.
     */
    static _relationshipExists(relationshipName) {
        if (relationshipName in this.getRelationshipsMap()) {
            return true;
        }
        return false;
    }
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
    static _defineRelationship(relationshipName, data) {
        if (!relationshipName)
            throw new Error(`Invalid relationship name given: ${relationshipName}`);
        if (this._relationshipExists(relationshipName))
            throw new Error(`Relationship ${relationshipName} already exists`);
        const actualData = Object.assign({
            modelClass: this,
            relationshipName,
            type: "hasMany"
        }, data);
        if (!actualData.className && !actualData.klass) {
            actualData.className = singularizeModelName(relationshipName);
        }
        let relationship;
        const prototype = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this.prototype));
        if (actualData.type == "belongsTo") {
            relationship = new BelongsToRelationship(actualData);
            prototype[relationshipName] = function () {
                const relationship = this.getRelationshipByName(relationshipName);
                return relationship.loaded();
            };
            prototype[`build${inflection.camelize(relationshipName)}`] = function (/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ attributes) {
                return buildRelatedRecordWithInverse(/** @type {VelociousDatabaseRecord} */ (this), relationshipName, attributes, true);
            };
            prototype[`load${inflection.camelize(relationshipName)}`] = async function () {
                return await this.loadRelationship(relationshipName);
            };
            prototype[`${relationshipName}OrLoad`] = async function () {
                return await this.relationshipOrLoad(relationshipName);
            };
            prototype[`set${inflection.camelize(relationshipName)}`] = function (/** @type {VelociousDatabaseRecord | null | undefined} */ model) {
                const relationship = this.getRelationshipByName(relationshipName);
                const foreignKeyValue = this._belongsToForeignKeyValue({ model, relationship });
                relationship.setLoaded(model || undefined);
                relationship.setPreloaded(true);
                relationship.setDirty(true);
                this._setColumnAttribute(relationship.getForeignKey(), foreignKeyValue);
            };
        }
        else if (actualData.type == "hasMany") {
            relationship = new HasManyRelationship(actualData);
            prototype[relationshipName] = function () {
                return /** @type {import("./instance-relationships/has-many.js").default<ReturnType<typeof JSON.parse>, ReturnType<typeof JSON.parse>>} */ (this.getRelationshipByName(relationshipName));
            };
            prototype[`${relationshipName}Loaded`] = function () {
                return this.getRelationshipByName(relationshipName).loaded();
            };
            prototype[`load${inflection.camelize(relationshipName)}`] = async function () {
                return await this.loadRelationship(relationshipName);
            };
            prototype[`${relationshipName}OrLoad`] = async function () {
                return await this.relationshipOrLoad(relationshipName);
            };
        }
        else if (actualData.type == "hasOne") {
            relationship = new HasOneRelationship(actualData);
            prototype[relationshipName] = function () {
                return this.getRelationshipByName(relationshipName).loaded();
            };
            prototype[`build${inflection.camelize(relationshipName)}`] = function (/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ attributes) {
                return buildRelatedRecordWithInverse(/** @type {VelociousDatabaseRecord} */ (this), relationshipName, attributes, false);
            };
            prototype[`load${inflection.camelize(relationshipName)}`] = async function () {
                return await this.loadRelationship(relationshipName);
            };
            prototype[`${relationshipName}OrLoad`] = async function () {
                return await this.relationshipOrLoad(relationshipName);
            };
        }
        else {
            throw new Error(`Unknown relationship type: ${actualData.type}`);
        }
        this.getRelationshipsMap()[relationshipName] = relationship;
    }
    /**
     * Runs normalize relationship args.
     * @param {RelationshipScopeCallback | object | undefined} scopeOrOptions - Scope callback or options.
     * @param {object | undefined} options - Options.
     * @returns {{scope: (RelationshipScopeCallback | undefined), relationshipOptions: object}} - Normalized arguments.
     */
    static _normalizeRelationshipArgs(scopeOrOptions, options) {
        if (typeof scopeOrOptions == "function") {
            return {
                scope: /** @type {RelationshipScopeCallback} */ (scopeOrOptions),
                relationshipOptions: options || {}
            };
        }
        return {
            scope: undefined,
            relationshipOptions: scopeOrOptions || {}
        };
    }
    /**
     * Registers afterCreate, afterSave, and afterDestroy callbacks to sync
     * a counter cache column on the parent model. The column name follows
     * the convention `<childModelPluralCamelCase>Count`.
     * @param {string} relationshipName - The belongsTo relationship name.
     */
    static _registerCounterCacheCallbacks(relationshipName) {
        const ChildModel = this;
        /**
         * Atomically recomputes the counter cache column on the parent via a
         * single UPDATE ... SET col = (SELECT COUNT(*)) so concurrent
         * creates/destroys cannot race into a stale count.
         * @param {number | string | null} parentId - Parent primary-key value.
         * @param {VelociousDatabaseRecord} record - Child record owning the connection.
         * @returns {Promise<void>} - Resolves when the counter cache has been synced.
         */
        async function syncCounter(parentId, record) {
            if (!parentId)
                return;
            const relationship = ChildModel.getRelationshipByName(relationshipName);
            const ParentModel = relationship.getTargetModelClass();
            if (!ParentModel)
                return;
            const primaryKey = relationship.getPrimaryKey();
            const fk = relationship.getForeignKey();
            const childModelName = ChildModel.getModelName();
            const counterColumn = inflection.underscore(`${inflection.pluralize(childModelName)}Count`);
            const parentTable = ParentModel.tableName();
            const childTable = ChildModel.tableName();
            const pkColumn = inflection.underscore(primaryKey);
            const parentQuery = record.queryForModel(ParentModel);
            const connection = parentQuery.driver;
            const quoted = connection.quote(parentId);
            const preparedParentUpdate = await prepareCounterCacheParentUpdate({
                parentId,
                parentModelClass: ParentModel,
                parentPrimaryKey: primaryKey,
                parentQuery
            });
            const sql = `UPDATE ${connection.quoteTable(parentTable)} SET ${connection.quoteColumn(counterColumn)} = (SELECT COUNT(*) FROM ${connection.quoteTable(childTable)} WHERE ${connection.quoteColumn(fk)} = ${quoted}) WHERE ${connection.quoteColumn(pkColumn)} = ${quoted}`;
            await connection.query(sql, { logName: `${ParentModel.name} Update` });
            await scheduleCounterCacheParentUpdate({
                preparedUpdate: preparedParentUpdate,
                sourceRecord: record
            });
        }
        /**
         * Runs read fk attribute.
         * @param {ReturnType<typeof JSON.parse>} record - Child record instance.
         * @returns {ReturnType<typeof JSON.parse>} - Current foreign-key attribute value.
         */
        function readFkAttribute(record) {
            const relationship = ChildModel.getRelationshipByName(relationshipName);
            const fkAttribute = inflection.camelize(relationship.getForeignKey().replace(/_id$/, "Id"), true);
            return record.readAttribute(fkAttribute);
        }
        ChildModel.afterCreate(async (record) => {
            await syncCounter(readFkAttribute(record), record);
        });
        ChildModel.afterDestroy(async (record) => {
            await syncCounter(readFkAttribute(record), record);
        });
        ChildModel.beforeSave(async (record) => {
            const model = /** @type {ReturnType<typeof JSON.parse>} */ (record);
            if (model.isNewRecord())
                return;
            const relationship = ChildModel.getRelationshipByName(relationshipName);
            const fkColumn = relationship.getForeignKey();
            // Detect FK change via direct attribute assignment or relationship setter.
            const directChange = fkColumn in model._changes;
            const belongsToChange = model._instanceRelationships?.[relationshipName]?.getDirty?.();
            if (directChange || belongsToChange) {
                model[`_counterCachePrev_${relationshipName}`] = model._attributes[fkColumn];
            }
        });
        ChildModel.afterSave(async (record) => {
            const model = /** @type {ReturnType<typeof JSON.parse>} */ (record);
            const prevKey = `_counterCachePrev_${relationshipName}`;
            const previousParentId = model[prevKey];
            if (previousParentId !== undefined) {
                delete model[prevKey];
                await syncCounter(previousParentId, record);
                await syncCounter(readFkAttribute(model), record);
            }
        });
    }
    /**
     * Runs get relationship by name.
     * @param {string} relationshipName - Relationship name.
     * @returns {import("./relationships/base.js").default} - The relationship by name.
     */
    static getRelationshipByName(relationshipName) {
        const relationship = this.getRelationshipsMap()[relationshipName];
        if (!relationship)
            throw new Error(`No relationship in ${this.name} called "${relationshipName}" in list: ${Object.keys(this.getRelationshipsMap()).join(", ")}`);
        return relationship;
    }
    /**
     * Runs get relationships.
     * @returns {Array<import("./relationships/base.js").default>} - The relationships.
     */
    static getRelationships() {
        return Object.values(this.getRelationshipsMap());
    }
    /**
     * Runs get relationships map.
     * @returns {Record<string, import("./relationships/base.js").default>} - Relationship definitions keyed by name.
     */
    static getRelationshipsMap() {
        if (!Object.hasOwn(this, "_relationships") || !this._relationships) {
            /**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, import("./relationships/base.js").default>} */
            this._relationships = {};
        }
        return /** @type {Record<string, import("./relationships/base.js").default>} */ (this._relationships);
    }
    /**
     * Runs get relationship names.
     * @returns {Array<string>} - The relationship names.
     */
    static getRelationshipNames() {
        return this.getRelationships().map((relationship) => relationship.getRelationshipName());
    }
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
    static queryData(name, fn) {
        if (!name || typeof name !== "string") {
            throw new Error(`Invalid queryData name: ${name}`);
        }
        if (typeof fn !== "function") {
            throw new Error(`queryData fn for ${this.name}.queryData(${JSON.stringify(name)}) must be a function`);
        }
        const map = this.getQueryDataMap();
        // Use Object.hasOwn so a name that happens to match an inherited
        // Object.prototype key (e.g. "toString", "constructor") isn't
        // falsely treated as already registered.
        if (Object.hasOwn(map, name)) {
            throw new Error(`queryData for ${this.name}.${name} is already registered`);
        }
        map[name] = fn;
    }
    /**
     * Runs get query data map.
     * @returns {Record<string, import("../query/query-data.js").QueryDataFn>} - queryData registrations keyed by name.
     */
    static getQueryDataMap() {
        if (!Object.hasOwn(this, "_queryDataRegistrations") || !this._queryDataRegistrations) {
            // Prototype-less map so bracket access can only ever surface
            // registrations actually made on this class — never inherited
            // Object.prototype members.
            /**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, import("../query/query-data.js").QueryDataFn>} */
            this._queryDataRegistrations = Object.create(null);
        }
        return /** @type {Record<string, import("../query/query-data.js").QueryDataFn>} */ (this._queryDataRegistrations);
    }
    /**
     * Runs get query data by name.
     * @param {string} name - queryData name.
     * @returns {import("../query/query-data.js").QueryDataFn | null} - Registered fn or null when not found.
     */
    static getQueryDataByName(name) {
        const map = this.getQueryDataMap();
        // Own-property lookup so a spec containing e.g. "toString" doesn't
        // resolve to an inherited Object.prototype member — matching the
        // Object.hasOwn guard used when registering.
        return Object.hasOwn(map, name) ? map[name] : null;
    }
    /**
     * Runs get attachments.
     * @returns {Record<string, RecordAttachmentConfiguration>} - Attachment definitions.
     */
    static getAttachments() {
        return this.getAttachmentsMap();
    }
    /**
     * Returns attachment definitions through the model contract shared with
     * frontend model classes.
     * @returns {Record<string, RecordAttachmentConfiguration>} - Attachment definitions.
     */
    static attachmentDefinitions() {
        return this.getAttachmentsMap();
    }
    /**
     * Runs get attachment by name.
     * @param {string} attachmentName - Attachment name.
     * @returns {RecordAttachmentConfiguration} - Attachment definition.
     */
    static getAttachmentByName(attachmentName) {
        const definition = this.getAttachmentsMap()[attachmentName];
        if (!definition)
            throw new Error(`No attachment in ${this.name} called "${attachmentName}" in list: ${Object.keys(this.getAttachmentsMap()).join(", ")}`);
        return definition;
    }
    /**
     * Runs get relationship by name.
     * @param {string} relationshipName - Relationship name.
     * @returns {import("./instance-relationships/base.js").default} - The relationship by name.
     */
    getRelationshipByName(relationshipName) {
        if (!(relationshipName in this._instanceRelationships)) {
            const modelClassRelationship = this.getModelClass()
                .getRelationshipByName(relationshipName)
                .resolveForRecord(this);
            const relationshipType = modelClassRelationship.getType();
            let instanceRelationship;
            if (relationshipType == "belongsTo") {
                instanceRelationship = new BelongsToInstanceRelationship({ model: this, relationship: modelClassRelationship });
            }
            else if (relationshipType == "hasMany") {
                instanceRelationship = new HasManyInstanceRelationship({ model: this, relationship: modelClassRelationship });
            }
            else if (relationshipType == "hasOne") {
                instanceRelationship = new HasOneInstanceRelationship({ model: this, relationship: modelClassRelationship });
            }
            else {
                throw new Error(`Unknown relationship type: ${relationshipType}`);
            }
            this._instanceRelationships[relationshipName] = instanceRelationship;
        }
        return this._instanceRelationships[relationshipName];
    }
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
    async preload(queryOrSpec, options = {}) {
        await Preloader.preload([this], queryOrSpec, options);
    }
    /**
     * Runs load relationship.
     * @param {string} relationshipName - Relationship name.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Loaded relationship value.
     */
    async loadRelationship(relationshipName) {
        const relationship = this.getRelationshipByName(relationshipName);
        await relationship.load();
        return relationship.loaded();
    }
    /**
     * Runs relationship or load.
     * @param {string} relationshipName - Relationship name.
     * @param {{preloadTranslations?: boolean}} [options] - Load options.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Loaded relationship value.
     */
    async relationshipOrLoad(relationshipName, options = {}) {
        const relationship = this.getRelationshipByName(relationshipName);
        let loaded = await relationship.autoloadOrLoad();
        if (options.preloadTranslations) {
            loaded = await this._preloadLoadedRelationshipTranslations(loaded);
        }
        return loaded;
    }
    /**
     * Preloads translations on a loaded relationship target when explicitly requested.
     * @param {ReturnType<typeof JSON.parse>} loaded - Loaded relationship value.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Relationship value after translation preload.
     */
    async _preloadLoadedRelationshipTranslations(loaded) {
        if (!loaded || !loaded.isPersisted() || !await loaded.getModelClass().hasTranslationsTable())
            return loaded;
        const translationsRelationship = loaded.getRelationshipByName("translations");
        if (translationsRelationship.getPreloaded())
            return loaded;
        await loaded.preload({ translations: {} });
        return loaded;
    }
    /**
     * Runs get attachment by name.
     * @param {string} attachmentName - Attachment name.
     * @returns {RecordAttachmentHandle} - Attachment handle.
     */
    getAttachmentByName(attachmentName) {
        if (!(attachmentName in this._attachments)) {
            const attachmentDefinition = this.getModelClass().getAttachmentByName(attachmentName);
            this._attachments[attachmentName] = new RecordAttachmentHandle({
                model: this,
                name: attachmentName,
                type: attachmentDefinition.type
            });
        }
        return this._attachments[attachmentName];
    }
    /**
     * Adds a belongs-to-relationship to the model.
     * @param {string} relationshipName The name of the relationship.
     * @param {RelationshipScopeCallback | object} [scopeOrOptions] The scope callback or options for the relationship.
     * @param {object} [options] The options for the relationship.
     */
    static belongsTo(relationshipName, scopeOrOptions, options) {
        const { scope, relationshipOptions } = this._normalizeRelationshipArgs(scopeOrOptions, options);
        this._defineRelationship(relationshipName, Object.assign({ type: "belongsTo", scope }, relationshipOptions));
        if ( /** @type {ReturnType<typeof JSON.parse>} */(relationshipOptions)?.counterCache) {
            this._registerCounterCacheCallbacks(relationshipName);
        }
    }
    /**
     * Runs connection.
     * @param {object} [args] - Options.
     * @param {boolean} [args.enforceTenantDatabaseScope] - Whether tenant-switched models must resolve a tenant database identifier.
     * @returns {import("../drivers/base.js").default} - The connection.
     */
    static connection({ enforceTenantDatabaseScope = true, ...restArgs } = {}) {
        restArgsError(restArgs);
        const databasePool = this._getConfiguration().getDatabasePool(this.getDatabaseIdentifier({ enforceTenantDatabaseScope }));
        const connection = databasePool.getCurrentConnection();
        if (!connection)
            throw new Error("No connection?");
        return connection;
    }
    /**
     * Runs create.
     * @template {Record<string, ReturnType<typeof JSON.parse>>} CreateAttributes
     * @template {VelociousDatabaseRecord<CreateAttributes>} Model
     * @this {{new (changes?: CreateAttributes): Model} & typeof VelociousDatabaseRecord}
     * @param {CreateAttributes} [attributes] - Attributes.
     * @returns {Promise<Model>} - Resolves with the create.
     */
    static async create(attributes) {
        await this.ensureInitialized();
        const record = /** @type {Model} */ (new this(attributes));
        await record.save();
        return record;
    }
    /**
     * Runs get configuration.
     * @returns {import("../../configuration.js").default} - The configuration.
     */
    static _getConfiguration() {
        if (!this._configuration) {
            this._configuration = Configuration.current();
            if (!this._configuration) {
                throw new Error("Configuration hasn't been set (model class probably hasn't been initialized)");
            }
        }
        return this._configuration;
    }
    /**
     * Runs get configuration.
     * @returns {import("../../configuration.js").default} - The configuration.
     */
    _getConfiguration() {
        return this.getModelClass()._getConfiguration();
    }
    /**
     * Adds a has-many-relationship to the model class.
     * @param {string} relationshipName The name of the relationship (e.g. "posts")
     * @param {RelationshipScopeCallback | object} [scopeOrOptions] The scope callback or options for the relationship.
     * @param {object} [options] The options for the relationship (e.g. {className: "Post"})
     * @returns {void} - No return value.
     */
    static hasMany(relationshipName, scopeOrOptions, options) {
        const { scope, relationshipOptions } = this._normalizeRelationshipArgs(scopeOrOptions, options);
        return this._defineRelationship(relationshipName, Object.assign({ type: "hasMany", scope }, relationshipOptions));
    }
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
    static acceptsNestedAttributesFor(relationshipName, options = {}) {
        if (!relationshipName || typeof relationshipName !== "string") {
            throw new Error(`Invalid relationshipName passed to acceptsNestedAttributesFor: ${relationshipName}`);
        }
        if (!Object.prototype.hasOwnProperty.call(this, "_acceptedNestedAttributes")) {
            /**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, {allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean}>} */
            this._acceptedNestedAttributes = {};
        }
        /** @type {Record<string, {allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean}>} */ (this._acceptedNestedAttributes)[relationshipName] = { ...options };
    }
    /**
     * Runs accepted nested attributes for.
     * @param {string} relationshipName - Relationship name.
     * @returns {{allowDestroy?: boolean, limit?: number, rejectIf?: (attributes: Record<string, ReturnType<typeof JSON.parse>>) => boolean} | null} - Policy declared via `acceptsNestedAttributesFor`, or null when not accepted.
     */
    static acceptedNestedAttributesFor(relationshipName) {
        return this._acceptedNestedAttributes?.[relationshipName] || null;
    }
    /**
     * Adds a has-one-relationship to the model class.
     * @param {string} relationshipName The name of the relationship (e.g. "post")
     * @param {RelationshipScopeCallback | object} [scopeOrOptions] The scope callback or options for the relationship.
     * @param {object} [options] The options for the relationship (e.g. {className: "Post"})
     * @returns {void} - No return value.
     */
    static hasOne(relationshipName, scopeOrOptions, options) {
        const { scope, relationshipOptions } = this._normalizeRelationshipArgs(scopeOrOptions, options);
        return this._defineRelationship(relationshipName, Object.assign({ type: "hasOne", scope }, relationshipOptions));
    }
    /**
     * Runs define attachment.
     * @param {string} attachmentName - Attachment name.
     * @param {object} args - Attachment args.
     * @param {string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>} [args.driver] - Attachment driver name, class, or instance.
     * @param {AttachmentSyncConfiguration} [args.sync] - Client-safe synchronized asset policy.
     * @param {"hasOne" | "hasMany"} args.type - Attachment type.
     * @returns {void} - No return value.
     */
    static _defineAttachment(attachmentName, { driver, sync, type }) {
        if (!attachmentName || typeof attachmentName !== "string")
            throw new Error(`Invalid attachment name: ${attachmentName}`);
        if (attachmentName in this.getAttachmentsMap())
            throw new Error(`Attachment ${attachmentName} already exists`);
        if (sync) {
            const { fetch, offlineRequirement, retention, ...restSync } = sync;
            restArgsError(restSync);
            if (fetch !== "eager" && fetch !== "on-demand") {
                throw new Error(`Attachment ${attachmentName} sync fetch must be eager or on-demand`);
            }
            if (offlineRequirement !== "optional" && offlineRequirement !== "required") {
                throw new Error(`Attachment ${attachmentName} offline requirement must be optional or required`);
            }
            if (retention !== "durable" && retention !== "evictable") {
                throw new Error(`Attachment ${attachmentName} sync retention must be durable or evictable`);
            }
            if (offlineRequirement === "required" && retention !== "durable") {
                throw new Error(`Attachment ${attachmentName} required offline assets must use durable retention`);
            }
        }
        this.getAttachmentsMap()[attachmentName] = { driver, sync, type };
        const prototype = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this.prototype));
        prototype[attachmentName] = function () {
            return this.getAttachmentByName(attachmentName);
        };
        prototype[`set${inflection.camelize(attachmentName)}`] = function (/** @type {ReturnType<typeof JSON.parse>} */ newValue) {
            this.getAttachmentByName(attachmentName).queueAttach(newValue);
            return newValue;
        };
    }
    /**
     * Adds a single attachment helper to the model.
     * @param {string} attachmentName - Attachment name.
     * @param {{driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, sync?: AttachmentSyncConfiguration}} [args] - Attachment options.
     * @returns {void} - No return value.
     */
    static hasOneAttachment(attachmentName, args = {}) {
        this._defineAttachment(attachmentName, { driver: args.driver, sync: args.sync, type: "hasOne" });
    }
    /**
     * Adds a collection attachment helper to the model.
     * @param {string} attachmentName - Attachment name.
     * @param {{driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, sync?: AttachmentSyncConfiguration}} [args] - Attachment options.
     * @returns {void} - No return value.
     */
    static hasManyAttachments(attachmentName, args = {}) {
        this._defineAttachment(attachmentName, { driver: args.driver, sync: args.sync, type: "hasMany" });
    }
    /**
     * Runs human attribute name.
     * @param {string} attributeName - Attribute name.
     * @returns {string} - The human attribute name.
     */
    static humanAttributeName(attributeName) {
        const modelNameKey = inflection.underscore(this.getModelName());
        return this._getConfiguration().getTranslator()(`velocious.database.record.attributes.${modelNameKey}.${attributeName}`, { defaultValue: inflection.camelize(attributeName) });
    }
    /**
     * Runs get database type.
     * @returns {string} - The database type.
     */
    static getDatabaseType() {
        if (!this._databaseType)
            throw new Error("Database type hasn't been set");
        return this._databaseType;
    }
    /**
     * Runs set eager load record metadata.
     * @param {boolean} eagerLoadRecordMetadata - Whether require-context initialization should load table metadata for this model.
     * @returns {void} - No return value.
     */
    static setEagerLoadRecordMetadata(eagerLoadRecordMetadata) {
        this._eagerLoadRecordMetadata = eagerLoadRecordMetadata;
    }
    /**
     * Runs get eager load record metadata.
     * @returns {boolean} - Whether require-context initialization should load table metadata for this model.
     */
    static getEagerLoadRecordMetadata() {
        if (this._eagerLoadRecordMetadata === undefined)
            return true;
        return this._eagerLoadRecordMetadata;
    }
    /**
     * Runs reset record metadata.
     * @returns {void} - No return value.
     */
    static resetRecordMetadata() {
        this._initialized = false;
        this._initializeRecordPromise = null;
        this._databaseType = undefined;
        this._table = undefined;
        this._columns = undefined;
        this._columnsAsHash = undefined;
        this._columnNames = undefined;
        this._columnTypeByName = undefined;
        this._attributeNameToColumnName = undefined;
        this._columnNameToAttributeName = undefined;
        if (!this._recordMetadataModelClass)
            this.clearRecordMetadataValues();
    }
    /**
     * Static fields that belong to one physical database/schema generation.
     * @returns {Set<string>} - Metadata property names.
     */
    static recordMetadataPropertyNames() {
        return recordMetadataPropertyNames;
    }
    /**
     * Reads one operation-bound metadata field.
     * @param {string} metadataKey - Physical database and schema generation key.
     * @param {string} property - Static metadata property.
     * @returns {RecordMetadataValue} - Stored metadata value.
     */
    static recordMetadataValue(metadataKey, property) {
        return recordMetadataValuesFor(this).get(metadataKey)?.get(property);
    }
    /**
     * Writes one operation-bound metadata field.
     * @param {string} metadataKey - Physical database and schema generation key.
     * @param {string} property - Static metadata property.
     * @param {RecordMetadataValue} value - Metadata value.
     * @returns {void}
     */
    static setRecordMetadataValue(metadataKey, property, value) {
        let values = recordMetadataValuesFor(this).get(metadataKey);
        if (!values) {
            values = new Map();
            recordMetadataValuesFor(this).set(metadataKey, values);
        }
        values.set(property, value);
    }
    /** Clears every tenant/generation metadata snapshot for this model. */
    static clearRecordMetadataValues() {
        recordMetadataValuesByModel.delete(this);
    }
    /**
     * Clears snapshots whose key belongs to one physical database identity.
     * @param {string} databaseIdentity - Logical identifier plus pool reuse key.
     * @returns {void}
     */
    static clearRecordMetadataValuesForDatabaseIdentity(databaseIdentity) {
        const values = recordMetadataValuesByModel.get(this);
        if (!values)
            return;
        const metadataPrefix = `${databaseIdentity.length}:${databaseIdentity}:`;
        for (const metadataKey of values.keys()) {
            if (metadataKey.startsWith(metadataPrefix))
                values.delete(metadataKey);
        }
        if (values.size === 0)
            recordMetadataValuesByModel.delete(this);
    }
    /**
     * Registers the model class with a configuration without loading table metadata.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @returns {void} - No return value.
     */
    static registerRecordClass({ configuration, ...restArgs }) {
        restArgsError(restArgs);
        if (!configuration)
            throw new Error(`No configuration given for ${this.name}`);
        this.resetRecordMetadata();
        const modelClass = this._recordMetadataModelClass || this;
        modelClass._configuration = configuration;
        configuration.registerModelClass(modelClass);
    }
    /**
     * Runs initialize record.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {import("../drivers/base.js").default} [args.connection] - Explicit metadata connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    static async initializeRecord({ configuration, connection: explicitConnection, ...restArgs }) {
        restArgsError(restArgs);
        if (!configuration)
            throw new Error(`No configuration given for ${this.name}`);
        this.registerRecordClass({ configuration });
        const connection = explicitConnection || this.connection({ enforceTenantDatabaseScope: false });
        this._databaseType = connection.getType();
        this._table = await connection.getTableByName(this.tableName());
        this._columns = await this._getTable().getColumns();
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<string, import("../drivers/base-column.js").default>} */
        this._columnsAsHash = {};
        const columnNameToAttributeName = this.getColumnNameToAttributeNameMap();
        const attributeNameToColumnName = this.getAttributeNameToColumnNameMap();
        const prototype = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this.prototype));
        for (const column of this._columns) {
            this._columnsAsHash[column.getName()] = column;
            const deburredColumnName = deburrColumnName(column.getName());
            const camelizedColumnName = inflection.camelize(deburredColumnName, true);
            const camelizedColumnNameBigFirst = inflection.camelize(deburredColumnName);
            attributeNameToColumnName[camelizedColumnName] = column.getName();
            columnNameToAttributeName[column.getName()] = camelizedColumnName;
            if (!(camelizedColumnName in prototype)) {
                prototype[camelizedColumnName] = function () {
                    return this.readAttribute(camelizedColumnName);
                };
            }
            if (!(`set${camelizedColumnNameBigFirst}` in prototype)) {
                prototype[`set${camelizedColumnNameBigFirst}`] = function (/** @type {ReturnType<typeof JSON.parse>} */ newValue) {
                    return this._setColumnAttribute(camelizedColumnName, newValue);
                };
            }
            if (!(`has${camelizedColumnNameBigFirst}` in prototype)) {
                prototype[`has${camelizedColumnNameBigFirst}`] = function () {
                    const dynamicThis = /** @type {Record<string, (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this));
                    const value = dynamicThis[camelizedColumnName]();
                    return this._hasAttribute(value);
                };
            }
        }
        await this._defineTranslationMethods(connection);
        await initializeAuditing(this);
        this._initialized = true;
    }
    /**
     * Initializes the model class the first time an async record API needs table
     * metadata. Concurrent callers share the same initialization promise, and a
     * failed initialization can be retried by a later call.
     * @param {{configuration?: import("../../configuration.js").default, connection?: import("../drivers/base.js").default}} [args] - Optional configuration and explicit metadata connection.
     * @returns {Promise<void>} - Resolves when the model class is initialized.
     */
    static async ensureInitialized(args = {}) {
        const { configuration, connection, ...restArgs } = args;
        restArgsError(restArgs);
        if (this._initialized)
            return;
        if (this._initializeRecordPromise) {
            await this._initializeRecordPromise;
            return;
        }
        const resolvedConfiguration = configuration || this._configuration || Configuration.current();
        const initializeRecordPromise = this.initializeRecord({ configuration: resolvedConfiguration, connection });
        this._initializeRecordPromise = initializeRecordPromise;
        try {
            await initializeRecordPromise;
        }
        finally {
            if (this._initializeRecordPromise === initializeRecordPromise) {
                this._initializeRecordPromise = null;
            }
        }
    }
    /**
     * Runs has attribute.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {boolean} - Whether attribute.
     */
    _hasAttribute(value) {
        if (typeof value == "string") {
            value = value.trim();
        }
        if (value) {
            return true;
        }
        return false;
    }
    /**
     * Runs is initialized.
     * @returns {boolean} - Whether initialized.
     */
    static isInitialized() {
        if (this._initialized)
            return true;
        return false;
    }
    /**
     * Runs assert has been initialized.
     * @returns {void} - No return value.
     */
    static _assertHasBeenInitialized() {
        if (this._initialized)
            return;
        throw new Error(`${this.name} used before initialization. Call ${this.name}.initializeRecord(...) or configuration.initialize().`);
    }
    /**
     * Defines translation accessors and initializes the generated translation
     * class through the same metadata connection as the translated model.
     * @param {import("../drivers/base.js").default} connection - Metadata connection.
     * @returns {Promise<void>} - Resolves when translation metadata is ready.
     */
    static async _defineTranslationMethods(connection) {
        if (this._translations && Object.keys(this._translations).length > 0) {
            const locales = this._getConfiguration().getLocales();
            if (!locales)
                throw new Error("Locales hasn't been set in the configuration");
            const TranslationClass = this.getTranslationClass();
            const BoundTranslationClass = this._recordMetadataBinder ? this._recordMetadataBinder(TranslationClass) : TranslationClass;
            await BoundTranslationClass.initializeRecord({
                configuration: this._getConfiguration(),
                connection
            });
            for (const name in this._translations) {
                const nameCamelized = inflection.camelize(name);
                const setterMethodName = `set${nameCamelized}`;
                const prototype = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this.prototype));
                prototype[name] = function getTranslatedAttribute() {
                    const locale = this._getConfiguration().getLocale();
                    return this._getTranslatedAttributeWithFallback(name, locale);
                };
                prototype[`has${nameCamelized}`] = function hasTranslatedAttribute() {
                    const dynamicThis = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this));
                    const candidate = dynamicThis[name];
                    if (typeof candidate == "function") {
                        const value = candidate.bind(this)();
                        return this._hasAttribute(value);
                    }
                    else {
                        throw new Error(`Expected candidate to be a function but it was: ${typeof candidate}`);
                    }
                };
                prototype[setterMethodName] = function setTranslatedAttribute(/** @type {ReturnType<typeof JSON.parse>} */ newValue) {
                    const locale = this._getConfiguration().getLocale();
                    return this._setTranslatedAttribute(name, locale, newValue);
                };
                for (const locale of locales) {
                    const localeCamelized = inflection.camelize(locale);
                    const getterMethodNameLocalized = `${name}${localeCamelized}`;
                    const setterMethodNameLocalized = `${setterMethodName}${localeCamelized}`;
                    const hasMethodNameLocalized = `has${inflection.camelize(name)}${localeCamelized}`;
                    prototype[getterMethodNameLocalized] = function getTranslatedAttributeWithLocale() {
                        return this._getTranslatedAttribute(name, locale);
                    };
                    prototype[setterMethodNameLocalized] = function setTranslatedAttributeWithLocale(/** @type {ReturnType<typeof JSON.parse>} */ newValue) {
                        return this._setTranslatedAttribute(name, locale, newValue);
                    };
                    prototype[hasMethodNameLocalized] = function hasTranslatedAttribute() {
                        const dynamicThis = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this));
                        const candidate = dynamicThis[getterMethodNameLocalized];
                        if (typeof candidate == "function") {
                            const value = candidate.bind(this)();
                            return this._hasAttribute(value);
                        }
                        else {
                            throw new Error(`Expected candidate to be a function but it was: ${typeof candidate}`);
                        }
                    };
                }
            }
        }
    }
    /**
     * Runs get configured database identifier.
     * @returns {string} - The configured non-tenant database identifier.
     */
    static getConfiguredDatabaseIdentifier() {
        return this._databaseIdentifier || "default";
    }
    /**
     * Runs get database identifier.
     * @param {object} [args] - Options.
     * @param {boolean} [args.enforceTenantDatabaseScope] - Whether tenant-switched models must resolve a tenant database identifier.
     * @param {object} [args.tenant] - Explicit tenant descriptor instead of the ambient tenant.
     * @returns {string} - The database identifier.
     */
    static getDatabaseIdentifier({ enforceTenantDatabaseScope = true, tenant = Current.tenant(), ...restArgs } = {}) {
        restArgsError(restArgs);
        const tenantDatabaseIdentifier = this.getTenantDatabaseIdentifier(tenant);
        if (tenantDatabaseIdentifier) {
            if (enforceTenantDatabaseScope &&
                this._getConfiguration().getEnforceTenantDatabaseScopes() &&
                !this._getConfiguration().isDatabaseIdentifierActive(tenantDatabaseIdentifier, tenant)) {
                throw new TenantDatabaseScopeError(`${this.getModelName()} resolved tenant database identifier ${JSON.stringify(tenantDatabaseIdentifier)} but that database identifier is not active for the current tenant. Wrap the model query in configuration.runWithTenant(...) or set enforceTenantDatabaseScopes: false to allow legacy fallback behavior.`, { modelName: this.getModelName() });
            }
            return tenantDatabaseIdentifier;
        }
        if (enforceTenantDatabaseScope && this._tenantDatabaseIdentifierResolver && this._getConfiguration().getEnforceTenantDatabaseScopes()) {
            throw new TenantDatabaseScopeError(`${this.getModelName()} is configured with switchesTenantDatabase(...) but no tenant database identifier resolved for the current tenant. Wrap the model query in configuration.runWithTenant(...) or set enforceTenantDatabaseScopes: false to allow legacy fallback behavior.`, { modelName: this.getModelName() });
        }
        return this.getConfiguredDatabaseIdentifier();
    }
    /**
     * Runs set database identifier.
     * @param {string} databaseIdentifier - Database identifier.
     * @returns {void} - No return value.
     */
    static setDatabaseIdentifier(databaseIdentifier) {
        this._databaseIdentifier = databaseIdentifier;
    }
    /**
     * Declares a tenant-aware database identifier resolver for this model class.
     * @param {string | ((args: {modelClass: typeof VelociousDatabaseRecord, tenant: Record<string, unknown> | null | undefined}) => string | undefined)} databaseIdentifierOrResolver - Static identifier or resolver.
     * @returns {void} - No return value.
     */
    static switchesTenantDatabase(databaseIdentifierOrResolver) {
        this._tenantDatabaseIdentifierResolver = databaseIdentifierOrResolver;
        if (this._translationClass) {
            const translatedModelClass = this;
            this._translationClass.switchesTenantDatabase(({ tenant }) => translatedModelClass.getTenantDatabaseIdentifier(tenant));
        }
    }
    /**
     * Runs has tenant database identifier resolver.
     * @returns {boolean} - Whether this model resolves its database from the current tenant.
     */
    static hasTenantDatabaseIdentifierResolver() {
        return Boolean(this._tenantDatabaseIdentifierResolver);
    }
    /**
     * Runs get tenant database identifier.
     * @param {ReturnType<typeof JSON.parse>} [tenant] - Tenant override.
     * @returns {string | undefined} - Tenant-scoped database identifier when configured.
     */
    static getTenantDatabaseIdentifier(tenant = Current.tenant()) {
        const tenantDatabaseIdentifierResolver = this._tenantDatabaseIdentifierResolver;
        if (!tenantDatabaseIdentifierResolver) {
            return;
        }
        if (typeof tenantDatabaseIdentifierResolver === "function") {
            return tenantDatabaseIdentifierResolver({
                modelClass: this,
                tenant
            });
        }
        return tenantDatabaseIdentifierResolver;
    }
    /**
     * Runs get attribute.
     * @param {string} name - Name.
     * @returns {ReturnType<typeof JSON.parse>} - The attribute.
     */
    getAttribute(name) {
        const columnName = inflection.underscore(name);
        if (!this.isNewRecord() && !(columnName in this._attributes)) {
            throw new Error(`${this.constructor.name}#${name} attribute hasn't been loaded yet in ${Object.keys(this._attributes).join(", ")}`);
        }
        return this._attributes[columnName];
    }
    /**
     * Runs get model class.
     * @abstract
     * @returns {typeof VelociousDatabaseRecord} - The model class.
     */
    getModelClass() {
        const modelClass = /** @type {typeof VelociousDatabaseRecord} */ (this.constructor);
        if (this._databaseOperation)
            return this._databaseOperation.modelClass(modelClass);
        return modelClass;
    }
    /**
     * Runs set attribute.
     * @param {string} name - Name.
     * @param {ReturnType<typeof JSON.parse>} newValue - New value.
     * @returns {void} - No return value.
     */
    setAttribute(name, newValue) {
        // Resolve raw column names ("VA_ÜbAttributID", "IP") and casing variants ("vAFunktionID") to the
        // canonical attribute the model base generates its setter from (setVAUebattributid, setIp, …).
        const canonicalName = this.getModelClass().resolveAttributeName(name) ?? name;
        const requestedSetterName = `set${inflection.camelize(canonicalName)}`;
        const setterName = this.getModelClass().findMemberNameInsensitive(this, requestedSetterName);
        const dynamicThis = /** @type {Record<string, (value: ReturnType<typeof JSON.parse>) => void>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this));
        this.getModelClass()._assertHasBeenInitialized();
        if (!this.getModelClass().isInitialized())
            throw new Error(`${this.constructor.name} model isn't initialized yet`);
        if (!setterName)
            throw new Error(`No such setter method: ${this.constructor.name}#${requestedSetterName}`);
        dynamicThis[setterName](newValue);
    }
    /**
     * Runs set column attribute.
     * @param {string} name - Name.
     * @param {ReturnType<typeof JSON.parse>} newValue - New value.
     */
    _setColumnAttribute(name, newValue) {
        this.getModelClass()._assertHasBeenInitialized();
        if (!this.getModelClass()._attributeNameToColumnName)
            throw new Error("No attribute-to-column mapping. Has record been initialized?");
        const resolvedName = this.getModelClass().resolveAttributeName(name);
        const columnName = resolvedName ? this.getModelClass().getAttributeNameToColumnNameMap()[resolvedName] : undefined;
        if (!columnName)
            throw new Error(`Couldn't figure out column name for attribute: ${name}`);
        let normalizedValue = newValue;
        const columnType = this.getModelClass().getColumnTypeByName(columnName);
        if (columnType && this.getModelClass()._isDateLikeType(columnType)) {
            normalizedValue = this._normalizeDateValue(newValue);
        }
        normalizedValue = this._normalizeBooleanValueForWrite({ attributeName: name, columnType, value: normalizedValue });
        if (this._attributes[columnName] != normalizedValue) {
            this._clearBelongsToRelationshipForChangedForeignKey(columnName, normalizedValue);
            this._changes[columnName] = normalizedValue;
        }
    }
    /**
     * Clears loaded belongs-to caches when callers assign the foreign key directly.
     * @param {string} columnName - Changed database column name.
     * @param {ReturnType<typeof JSON.parse>} normalizedValue - New normalized column value.
     * @returns {void} - No return value.
     */
    _clearBelongsToRelationshipForChangedForeignKey(columnName, normalizedValue) {
        for (const relationship of this._belongsToRelationshipsForForeignKey(columnName)) {
            if (this._belongsToRelationshipMatchesForeignKeyValue({ normalizedValue, relationship }))
                continue;
            this._clearLoadedBelongsToRelationship(relationship);
        }
    }
    /**
     * Runs belongs to relationships for foreign key.
     * @param {string} columnName - Changed database column name.
     * @returns {Array<ReturnType<typeof JSON.parse>>} - Loaded relationship instances that use the changed foreign key.
     */
    _belongsToRelationshipsForForeignKey(columnName) {
        if (!this._instanceRelationships)
            return [];
        return Object
            .values(this._instanceRelationships)
            .filter((relationship) => this._belongsToRelationshipUsesForeignKey({ columnName, relationship }));
    }
    /**
     * Runs belongs to relationship uses foreign key.
     * @param {object} args - Relationship match arguments.
     * @param {string} args.columnName - Changed database column name.
     * @param {ReturnType<typeof JSON.parse>} args.relationship - Relationship instance.
     * @returns {boolean} - Whether the relationship is a belongs-to using the changed foreign key.
     */
    _belongsToRelationshipUsesForeignKey({ columnName, relationship }) {
        if (relationship.getType() != "belongsTo")
            return false;
        const foreignKey = relationship.getForeignKey();
        const foreignKeyAttribute = this.getModelClass().getColumnNameToAttributeNameMap()[foreignKey];
        return foreignKey == columnName || foreignKeyAttribute == columnName;
    }
    /**
     * Runs belongs to relationship matches foreign key value.
     * @param {object} args - Relationship cache arguments.
     * @param {ReturnType<typeof JSON.parse>} args.normalizedValue - New normalized column value.
     * @param {ReturnType<typeof JSON.parse>} args.relationship - Relationship instance.
     * @returns {boolean} - Whether the loaded related record still matches the changed foreign key.
     */
    _belongsToRelationshipMatchesForeignKeyValue({ normalizedValue, relationship }) {
        const loaded = relationship.getLoadedOrUndefined();
        if (!loaded)
            return false;
        if (Array.isArray(loaded))
            return false;
        if (!relationship.getTargetModelClass())
            return false;
        return loaded.readColumn(relationship.getPrimaryKey()) == normalizedValue;
    }
    /**
     * Returns the foreign key value for a belongs-to relationship assignment.
     * @param {object} args - Relationship assignment arguments.
     * @param {VelociousDatabaseRecord | null | undefined} args.model - Assigned model.
     * @param {import("./instance-relationships/base.js").default} args.relationship - Belongs-to relationship instance.
     * @returns {string | number | null | undefined} - Foreign key value for the assignment.
     */
    _belongsToForeignKeyValue({ model, relationship }) {
        if (model == null)
            return null;
        if (!(model instanceof VelociousDatabaseRecord))
            throw new Error(`Unexpected model type: ${typeof model}`);
        return /** @type {string | number | null | undefined} */ (model.readColumn(relationship.getPrimaryKey()));
    }
    /**
     * Runs clear loaded belongs to relationship.
     * @param {ReturnType<typeof JSON.parse>} relationship - Relationship instance.
     * @returns {void} - No return value.
     */
    _clearLoadedBelongsToRelationship(relationship) {
        relationship.setLoaded(undefined);
        relationship.setPreloaded(false);
        relationship.setDirty(false);
    }
    /**
     * Runs normalize date value.
     * @param {ReturnType<typeof JSON.parse>} value - Value to use.
     * @returns {ReturnType<typeof JSON.parse>} - The date value.
     */
    _normalizeDateValue(value) {
        return normalizeDateValueForWrite(value, { timeZone: this.getModelClass()._timeZoneForDateWrite() });
    }
    /**
     * Runs normalize sqlite boolean value.
     * @param {object} args - Options object.
     * @param {string | undefined} args.columnType - Column type.
     * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    _normalizeSqliteBooleanValue({ columnType, value }) {
        if (this.getModelClass().getDatabaseType() != "sqlite")
            return value;
        if (!columnType)
            return value;
        if (columnType.toLowerCase() !== "boolean")
            return value;
        if (value === true)
            return 1;
        if (value === false)
            return 0;
        return value;
    }
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
    _normalizeBooleanValueForWrite({ attributeName, columnType, value }) {
        if (!this.getModelClass()._declaredBooleanStoresAsInteger(attributeName)) {
            return this._normalizeSqliteBooleanValue({ columnType, value });
        }
        if (value === true)
            return 1;
        if (value === false)
            return 0;
        return value;
    }
    /**
     * Whether a declared `"boolean"` attribute cast is backed by an integer column (e.g. an MSSQL
     * `bit`), so booleans must be stored as 1/0. A native boolean column (e.g. Postgres `boolean`)
     * returns false and keeps `true`/`false` for the driver.
     * @param {string} attributeName - Attribute name.
     * @returns {boolean} - Whether the declared boolean is stored as an integer.
     */
    static _declaredBooleanStoresAsInteger(attributeName) {
        if (this.getAttributeCast(attributeName) !== "boolean")
            return false;
        const columnName = this.getAttributeNameToColumnNameMap()[attributeName];
        const introspectedType = columnName ? this.getColumnsHash()[columnName]?.getType() : undefined;
        return typeof introspectedType === "string" && introspectedType.toLowerCase() !== "boolean";
    }
    /**
     * Runs get columns.
     * @returns {import("../drivers/base-column.js").default[]} - The columns.
     */
    static getColumns() {
        this._assertHasBeenInitialized();
        if (!this._columns)
            throw new Error(`${this.name} hasn't been initialized yet`);
        return this._columns;
    }
    /**
     * Runs get columns hash.
     * @returns {Record<string, import("../drivers/base-column.js").default>} - The columns hash.
     */
    static getColumnsHash() {
        if (!this._columnsAsHash) {
            /**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, import("../drivers/base-column.js").default>} */
            this._columnsAsHash = {};
            for (const column of this.getColumns()) {
                this._columnsAsHash[column.getName()] = column;
            }
        }
        return this._columnsAsHash;
    }
    /**
     * Runs get column type by name.
     * @param {string} name - Name.
     * @returns {string | undefined} - The column type by name.
     */
    static getColumnTypeByName(name) {
        if (!this._columnTypeByName) {
            /**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, string | undefined>} */
            this._columnTypeByName = {};
            for (const column of this.getColumns()) {
                this._columnTypeByName[column.getName()] = column.getType();
            }
        }
        const attributeName = this.getColumnNameToAttributeNameMap()[name];
        if (attributeName) {
            const cast = this.getAttributeCast(attributeName);
            if (cast)
                return cast;
        }
        return this._columnTypeByName[name];
    }
    /**
     * Runs is date like type.
     * @param {string} type - Type identifier.
     * @returns {boolean} - Whether date like type.
     */
    static _isDateLikeType(type) {
        const normalizedType = type.toLowerCase();
        return normalizedType == "date" ||
            normalizedType == "datetime" ||
            normalizedType == "timestamp" ||
            normalizedType == "timestamptz" ||
            normalizedType.startsWith("timestamp ");
    }
    /**
     * Runs get column names.
     * @returns {Array<string>} - The column names.
     */
    static getColumnNames() {
        if (!this._columnNames) {
            this._columnNames = this.getColumns().map((column) => column.getName());
        }
        return this._columnNames;
    }
    /**
     * Runs get table.
     * @returns {import("../drivers/base-table.js").default} - The table.
     */
    static _getTable() {
        if (!this._table)
            throw new Error(`${this.name} hasn't been initialized yet`);
        return this._table;
    }
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
    static async insertMultiple(columns, rows, args = {}) {
        const { cast = true, retryIndividuallyOnFailure = false, returnResults = false, ...restArgs } = args;
        restArgsError(restArgs);
        await this.ensureInitialized();
        const normalizedRows = cast
            ? this._normalizeInsertMultipleRows({ columns, rows })
            : rows;
        const tableName = this.tableName();
        if (!retryIndividuallyOnFailure) {
            await this.connection().insertMultiple(tableName, columns, normalizedRows);
            if (returnResults)
                return { succeededRows: normalizedRows.slice(), failedRows: [], errors: [] };
            return;
        }
        try {
            // Wrap the batch in a transaction/savepoint. On databases that abort the
            // whole transaction when a statement fails (PostgreSQL), a failed batch
            // would otherwise poison the surrounding transaction so that the
            // individual retries below all fail with "current transaction is aborted".
            // transaction() opens a savepoint when already inside a transaction and a
            // real transaction otherwise, so a failure rolls back only this attempt.
            await this.connection().transaction(async () => {
                await this.connection().insertMultiple(tableName, columns, normalizedRows);
            });
            if (returnResults)
                return { succeededRows: normalizedRows.slice(), failedRows: [], errors: [] };
            return;
        }
        catch {
            /**
             * Results.
             * @type {{succeededRows: Array<ReturnType<typeof JSON.parse>>[], failedRows: Array<ReturnType<typeof JSON.parse>>[], errors: Array<{row: Array<ReturnType<typeof JSON.parse>>, error: ReturnType<typeof JSON.parse>}>}} */
            const results = {
                succeededRows: [],
                failedRows: [],
                errors: []
            };
            for (const row of normalizedRows) {
                try {
                    // Each retry runs in its own savepoint so a failed row rolls back only
                    // that row and leaves the surrounding transaction usable for the rest.
                    await this.connection().transaction(async () => {
                        await this.connection().insertMultiple(tableName, columns, [row]);
                    });
                    results.succeededRows.push(row);
                }
                catch (rowError) {
                    results.failedRows.push(row);
                    results.errors.push({ row, error: rowError });
                }
            }
            if (results.failedRows.length > 0) {
                const combinedErrors = results.errors.map((entry, index) => {
                    const message = entry.error instanceof Error ? entry.error.message : String(entry.error);
                    return `[${index}] ${message}. Row: ${this._safeSerializeInsertRow(entry.row)}`;
                }).join(" | ");
                const combinedError = new Error(`insertMultiple failed for ${results.failedRows.length} rows. ${combinedErrors}`);
                if (returnResults)
                    return results;
                throw combinedError;
            }
            if (returnResults)
                return results;
            return;
        }
    }
    /**
     * Runs normalize insert multiple rows.
     * @param {object} args - Options object.
     * @param {Array<string>} args.columns - Column names.
     * @param {Array<Array<ReturnType<typeof JSON.parse>>>} args.rows - Rows to insert.
     * @returns {Array<Array<ReturnType<typeof JSON.parse>>>} - Normalized rows.
     */
    static _normalizeInsertMultipleRows({ columns, rows }) {
        return rows.map((row) => {
            if (!Array.isArray(row) || row.length !== columns.length) {
                const rowLength = Array.isArray(row) ? row.length : "non-array";
                throw new Error(`insertMultiple row length mismatch. Expected ${columns.length} values but got ${rowLength}. Row: ${JSON.stringify(row)}`);
            }
            const normalizedRow = [];
            for (let index = 0; index < columns.length; index++) {
                const columnName = columns[index];
                const value = row[index];
                normalizedRow[index] = this._normalizeInsertValueForColumn({ columnName, value });
            }
            return normalizedRow;
        });
    }
    /**
     * Runs safe serialize insert row.
     * @param {Array<ReturnType<typeof JSON.parse>>} row - Row to serialize.
     * @returns {string} - Safe row representation.
     */
    static _safeSerializeInsertRow(row) {
        return formatValue(row);
    }
    /**
     * Runs normalize insert value for column.
     * @param {object} args - Options object.
     * @param {string} args.columnName - Column name.
     * @param {ReturnType<typeof JSON.parse>} args.value - Column value.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    static _normalizeInsertValueForColumn({ columnName, value }) {
        const column = this.getColumnsHash()[columnName];
        if (!column)
            return value;
        const columnType = column.getType();
        const normalizedType = typeof columnType === "string" ? columnType.toLowerCase() : undefined;
        let normalizedValue = value;
        if (normalizedType && this._isDateLikeType(normalizedType)) {
            normalizedValue = this._normalizeDateValueForInsert(normalizedValue);
        }
        normalizedValue = this._normalizeSqliteBooleanValueForInsert({ columnType, value: normalizedValue });
        if (normalizedValue === "" && column.getNull() && !this._isStringType(normalizedType)) {
            normalizedValue = null;
        }
        if (normalizedType && this._isNumericType(normalizedType)) {
            normalizedValue = this._normalizeNumericValue({ columnType: normalizedType, value: normalizedValue });
        }
        return normalizedValue;
    }
    /**
     * Runs is string type.
     * @param {string | undefined} columnType - Column type.
     * @returns {boolean} - Whether string-like type.
     */
    static _isStringType(columnType) {
        if (!columnType)
            return false;
        const stringTypes = new Set(["char", "varchar", "nvarchar", "string", "enum", "json", "jsonb", "citext", "binary", "varbinary"]);
        return columnType.includes("uuid") ||
            columnType.includes("text") ||
            stringTypes.has(columnType);
    }
    /**
     * Runs is numeric type.
     * @param {string} columnType - Column type.
     * @returns {boolean} - Whether numeric-like type.
     */
    static _isNumericType(columnType) {
        return columnType.includes("int") ||
            columnType.includes("decimal") ||
            columnType.includes("numeric") ||
            columnType.includes("float") ||
            columnType.includes("double") ||
            columnType.includes("real");
    }
    /**
     * Runs normalize numeric value.
     * @param {object} args - Options object.
     * @param {string} args.columnType - Column type.
     * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    static _normalizeNumericValue({ columnType, value }) {
        if (value === "" || value === null || value === undefined)
            return value;
        if (typeof value !== "string")
            return value;
        if (columnType.includes("decimal") || columnType.includes("numeric")) {
            return value;
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed))
            return value;
        if (columnType.includes("int")) {
            if (!Number.isSafeInteger(parsed))
                return value;
            if (!/^-?\d+$/.test(value))
                return value;
        }
        return parsed;
    }
    /**
     * Runs normalize date value for insert.
     * @param {ReturnType<typeof JSON.parse>} value - Value to normalize.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    static _normalizeDateValueForInsert(value) {
        return normalizeDateValueForWrite(value, { timeZone: this._timeZoneForDateWrite() });
    }
    /**
     * Runs normalize date string for insert.
     * @param {string} value - Date string value.
     * @returns {string | Date} - Parsed date or original string.
     */
    static _normalizeDateStringForInsert(value) {
        return normalizeDateStringForWrite(value, { timeZone: this._timeZoneForDateWrite() });
    }
    /**
     * Runs time zone for date writes.
     * @returns {string | undefined} - Active timezone identifier.
     */
    static _timeZoneForDateWrite() {
        const configuration = this._getConfiguration();
        return configuration.getEnvironmentHandler().getTimeZone(configuration);
    }
    /**
     * Runs normalize sqlite boolean value for insert.
     * @param {object} args - Options object.
     * @param {string | undefined} args.columnType - Column type.
     * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    static _normalizeSqliteBooleanValueForInsert({ columnType, value }) {
        if (this.getDatabaseType() != "sqlite")
            return value;
        if (!columnType)
            return value;
        if (columnType.toLowerCase() !== "boolean")
            return value;
        if (value === true)
            return 1;
        if (value === false)
            return 0;
        return value;
    }
    /**
     * Runs next primary key.
     * @returns {Promise<number>} - Resolves with the next primary key.
     */
    static async nextPrimaryKey() {
        await this.ensureInitialized();
        const primaryKey = this.primaryKey();
        const tableName = this.tableName();
        const connection = this.connection();
        if (Array.isArray(primaryKey))
            throw new Error(`${this.name}.nextPrimaryKey() does not support composite primary keys.`);
        const newestRecord = await this.order(`${connection.quoteTable(tableName)}.${connection.quoteColumn(primaryKey)}`).last();
        if (newestRecord) {
            const id = newestRecord.id();
            if (typeof id == "number") {
                return id + 1;
            }
            else {
                throw new Error("ID from newest record wasn't a number");
            }
        }
        else {
            return 1;
        }
    }
    /**
     * Runs set primary key.
     * @param {string | string[] | null} primaryKey - Primary key.
     * @returns {void} - No return value.
     */
    static setPrimaryKey(primaryKey) {
        if (Array.isArray(primaryKey)) {
            if (primaryKey.length === 0)
                throw new TypeError("Composite primary keys require at least one column.");
            const seenColumns = new Set();
            for (const columnName of primaryKey) {
                if (seenColumns.has(columnName))
                    throw new TypeError(`Composite primary key has duplicate column: ${columnName}.`);
                seenColumns.add(columnName);
            }
            this._primaryKey = [...primaryKey];
            return;
        }
        this._primaryKey = primaryKey;
    }
    /**
     * Returns this class's own attribute-cast map, creating it on the class itself
     * (never inherited from a parent) so subclasses don't share the same object.
     * @returns {Record<string, string>} - Declared casts keyed by attribute name.
     */
    static getAttributeCastsMap() {
        if (!Object.prototype.hasOwnProperty.call(this, "_attributeCasts") || !this._attributeCasts) {
            /**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, string>} */
            this._attributeCasts = {};
        }
        return this._attributeCasts;
    }
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
    static attribute(attributeName, type) {
        this.getAttributeCastsMap()[attributeName] = type;
    }
    /**
     * Returns the declared cast type for an attribute, if any.
     * @param {string} attributeName - Attribute name (camelCase).
     * @returns {string | undefined} - Declared cast type, or undefined when none is declared.
     */
    static getAttributeCast(attributeName) {
        return this.getAttributeCastsMap()[attributeName];
    }
    /**
     * Runs primary key.
     * @returns {string | string[]} - The primary key.
     */
    static primaryKey() {
        if (this._primaryKey)
            return this._primaryKey;
        return "id";
    }
    /**
     * Whether the model has a single primary key column. `setPrimaryKey(null)` (e.g. composite-key
     * legacy tables) declares no single primary key; `primaryKey()` still falls back to "id" for the
     * default case, so callers that must distinguish "no primary key" use this instead.
     * @returns {boolean} - False only when the primary key was explicitly set to null.
     */
    static hasPrimaryKey() {
        return this._primaryKey !== null;
    }
    /**
     * Runs save.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async save() {
        const isNewRecord = this.isNewRecord();
        let result;
        const save = async () => {
            await this._runLifecycleCallbacks("beforeValidation");
            await this._runValidations();
            if (this._databaseOperation && this.isPersisted() && Object.keys(this.getModelClass().getAttachments()).length > 0) {
                const connection = this._connection();
                if (!connection.insideTransaction()) {
                    await this.getModelClass()._prepareAttachmentStoreSchema(connection);
                }
            }
            const saveInTransaction = async () => {
                /** @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */
                let persistedAttributesBeforeUpdate;
                /** @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */
                let changesBeforeUpdate;
                let updateReloaded = false;
                try {
                    await this._runLifecycleCallbacks("beforeSave");
                    // If any belongs-to-relationships was saved, then updated-at should still be set on this record.
                    const { savedCount } = await this._autoSaveBelongsToRelationships();
                    if (this.isPersisted()) {
                        persistedAttributesBeforeUpdate = { ...this._attributes };
                        await this._runLifecycleCallbacks("beforeUpdate");
                        changesBeforeUpdate = { ...this._changes };
                        // If any has-many-relationships will be saved, then updated-at should still be set on this record.
                        const autoSaveHasManyrelationships = this._autoSaveHasManyAndHasOneRelationshipsToSave();
                        if (this._hasChanges() || savedCount > 0 || autoSaveHasManyrelationships.length > 0) {
                            result = await this._updateRecordWithChanges();
                            updateReloaded = true;
                        }
                        await this._runLifecycleCallbacks("afterUpdate");
                    }
                    else {
                        await this._runLifecycleCallbacks("beforeCreate");
                        result = await this._createNewRecord();
                        await this._runLifecycleCallbacks("afterCreate");
                    }
                    await this._autoSaveHasManyAndHasOneRelationships({ isNewRecord });
                    await this._autoSaveAttachments();
                    await this._runLifecycleCallbacks("afterSave");
                    await this._emitRecordChangeAfterCommit(isNewRecord ? "create" : "update");
                }
                catch (error) {
                    if (updateReloaded && persistedAttributesBeforeUpdate && changesBeforeUpdate) {
                        this._attributes = persistedAttributesBeforeUpdate;
                        this._changes = changesBeforeUpdate;
                        this._assignedAttributeNames = undefined;
                    }
                    throw error;
                }
            };
            if (this._databaseOperation) {
                await this._databaseOperation.transaction(saveInTransaction);
            }
            else {
                await this.getModelClass().transaction(saveInTransaction);
            }
        };
        if (this._databaseOperation) {
            await save();
        }
        else {
            await this._getConfiguration().ensureConnections({ name: `${this.getModelClass().name} save` }, save);
        }
        this._assignedAttributeNames = undefined;
        return result;
    }
    async _autoSaveBelongsToRelationships() {
        let savedCount = 0;
        for (const relationshipName in this._instanceRelationships) {
            const instanceRelationship = this._instanceRelationships[relationshipName];
            if (instanceRelationship.getType() != "belongsTo") {
                continue;
            }
            if (instanceRelationship.getAutoSave() === false) {
                continue;
            }
            const model = instanceRelationship.getLoadedOrUndefined();
            if (model) {
                if (model instanceof VelociousDatabaseRecord) {
                    if (model.isChanged()) {
                        this.bindRelatedRecord(model);
                        await model.save();
                        const foreignKey = this._relationshipForeignKeyAttribute(instanceRelationship);
                        const foreignKeyValue = this._belongsToForeignKeyValue({ model, relationship: instanceRelationship });
                        this.setAttribute(foreignKey, foreignKeyValue);
                        instanceRelationship.setPreloaded(true);
                        instanceRelationship.setDirty(false);
                        savedCount++;
                    }
                }
                else {
                    throw new Error(`Expected a record but got: ${typeof model}`);
                }
            }
        }
        return { savedCount };
    }
    _autoSaveHasManyAndHasOneRelationshipsToSave() {
        const relationships = [];
        for (const relationshipName in this._instanceRelationships) {
            const instanceRelationship = this._instanceRelationships[relationshipName];
            if (instanceRelationship.getType() != "hasMany" && instanceRelationship.getType() != "hasOne") {
                continue;
            }
            if (instanceRelationship.getAutoSave() === false) {
                continue;
            }
            /**
             * Defines loaded.
             * @type {VelociousDatabaseRecord[]} */
            let loaded;
            const hasManyOrOneLoaded = instanceRelationship.getLoadedOrUndefined();
            if (hasManyOrOneLoaded) {
                if (Array.isArray(hasManyOrOneLoaded)) {
                    loaded = hasManyOrOneLoaded;
                }
                else if (hasManyOrOneLoaded instanceof VelociousDatabaseRecord) {
                    loaded = [hasManyOrOneLoaded];
                }
                else {
                    throw new Error(`Expected hasOneLoaded to be a record but it wasn't: ${typeof hasManyOrOneLoaded}`);
                }
            }
            else {
                continue;
            }
            let useRelationship = false;
            if (loaded) {
                for (const model of loaded) {
                    this.bindRelatedRecord(model);
                    const foreignKey = model._relationshipForeignKeyAttribute(instanceRelationship);
                    model.setAttribute(foreignKey, scalarModelPrimaryKeyValue(this.id(), `Has-many autosave for ${this.getModelClass().name}`));
                    if (model.isChanged()) {
                        useRelationship = true;
                        continue;
                    }
                }
            }
            if (useRelationship)
                relationships.push(instanceRelationship);
        }
        return relationships;
    }
    /**
     * Resolves a relationship foreign-key column to this model's public attribute name.
     * @param {import("./instance-relationships/base.js").default<typeof VelociousDatabaseRecord, typeof VelociousDatabaseRecord>} instanceRelationship - Relationship instance.
     * @returns {string} Attribute name accepted by setAttribute/assign.
     */
    _relationshipForeignKeyAttribute(instanceRelationship) {
        const foreignKey = instanceRelationship.getForeignKey();
        return this.getModelClass().getColumnNameToAttributeNameMap()[foreignKey] || foreignKey;
    }
    /**
     * Runs auto save has many and has one relationships.
     * @param {object} args - Options object.
     * @param {boolean} args.isNewRecord - Whether is new record.
     */
    async _autoSaveHasManyAndHasOneRelationships({ isNewRecord }) {
        for (const instanceRelationship of this._autoSaveHasManyAndHasOneRelationshipsToSave()) {
            let hasManyOrOneLoaded = instanceRelationship.getLoadedOrUndefined();
            /**
             * Defines loaded.
             * @type {VelociousDatabaseRecord[]} */
            let loaded;
            if (hasManyOrOneLoaded === undefined) {
                loaded = [];
            }
            else if (hasManyOrOneLoaded instanceof VelociousDatabaseRecord) {
                loaded = [hasManyOrOneLoaded];
            }
            else if (Array.isArray(hasManyOrOneLoaded)) {
                loaded = hasManyOrOneLoaded;
            }
            else {
                throw new Error(`Unexpected type for hasManyOrOneLoaded: ${typeof hasManyOrOneLoaded}`);
            }
            for (const model of loaded) {
                this.bindRelatedRecord(model);
                const foreignKey = model._relationshipForeignKeyAttribute(instanceRelationship);
                model.setAttribute(foreignKey, scalarModelPrimaryKeyValue(this.id(), `Has-many autosave for ${this.getModelClass().name}`));
                if (model.isChanged()) {
                    await model.save();
                }
            }
            if (isNewRecord) {
                instanceRelationship.setPreloaded(true);
            }
        }
    }
    /**
     * Runs auto save attachments.
     * @returns {Promise<void>} - Resolves when pending attachments have been saved.
     */
    async _autoSaveAttachments() {
        for (const attachmentName in this._attachments) {
            const attachment = this._attachments[attachmentName];
            if (!attachment.hasPendingAttachments())
                continue;
            await attachment.flushPendingAttachments();
        }
    }
    /**
     * Runs table name.
     * @returns {string} - The table name.
     */
    static tableName() {
        if (!this._tableName)
            this._tableName = inflection.underscore(inflection.pluralize(this.getModelName()));
        return this._tableName;
    }
    /**
     * Runs set table name.
     * @param {string} tableName - Table name.
     * @returns {void} - No return value.
     */
    static setTableName(tableName) {
        this._tableName = tableName;
    }
    /**
     * Runs transaction.
     * @param {() => Promise<void>} callback - Callback function.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the transaction.
     */
    static async transaction(callback) {
        await this.ensureInitialized();
        const connection = this.connection();
        if (!connection.insideTransaction()) {
            await this._prepareAttachmentStoreSchema(connection);
        }
        const useTransactions = connection.getArgs().record?.transactions;
        if (useTransactions !== false) {
            return await connection.transaction(callback);
        }
        else {
            return await callback();
        }
    }
    /**
     * Prepares this model's attachment store before opening a model transaction.
     * @param {import("../drivers/base.js").default} connection - Model connection.
     * @returns {Promise<void>} - Resolves when the attachment schema is current.
     */
    static async _prepareAttachmentStoreSchema(connection) {
        await recordAttachmentsStoreForModelClass(this, connection).prepareRecordIdentityMigration({ connection });
    }
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
    static async withAdvisoryLock(name, callback, args = {}) {
        await this.ensureInitialized();
        const runner = new AdvisoryLockRunner({
            configuration: this._getConfiguration(),
            connectionProvider: () => this.connection(),
            databaseIdentifier: this.getDatabaseIdentifier()
        });
        return await runner.withAdvisoryLock(name, callback, args);
    }
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
    static async withAdvisoryLockOrFail(name, callback, args = {}) {
        await this.ensureInitialized();
        const runner = new AdvisoryLockRunner({
            configuration: this._getConfiguration(),
            connectionProvider: () => this.connection(),
            databaseIdentifier: this.getDatabaseIdentifier()
        });
        return await runner.withAdvisoryLockOrFail(name, callback, args);
    }
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
    static async runWithAdvisoryLockHoldTimeout(name, callback, holdTimeoutMs) {
        return await AdvisoryLockRunner.runWithAdvisoryLockHoldTimeout(name, callback, holdTimeoutMs);
    }
    /**
     * Returns true if the named advisory lock is currently held by any
     * session. Primarily useful as a diagnostic; callers that want to act
     * on the result should prefer `withAdvisoryLockOrFail` to avoid a
     * TOCTOU window between the check and the action.
     * @param {string} name - Lock name.
     * @returns {Promise<boolean>} - Whether the advisory lock is currently held.
     */
    static async hasAdvisoryLock(name) {
        await this.ensureInitialized();
        return await this.connection().isAdvisoryLockHeld(name);
    }
    /**
     * Runs translates.
     * @param {...string} names - Names.
     * @returns {void} - No return value.
     */
    static translates(...names) {
        const translations = this.getTranslationsMap();
        for (const name of names) {
            if (name in translations)
                throw new Error(`Translation already exists: ${name}`);
            translations[name] = {};
            if (!this._relationshipExists("translations")) {
                this._defineRelationship("translations", { dependent: "destroy", klass: this.getTranslationClass(), type: "hasMany" });
            }
            if (!this._relationshipExists("currentTranslation")) {
                this._defineRelationship("currentTranslation", {
                    klass: this.getTranslationClass(),
                    scope: (query) => this.currentTranslationScope(query),
                    type: "hasOne"
                });
            }
        }
    }
    /**
     * Runs current translation scope.
     * @param {ModelClassQuery} query - Translation query.
     * @returns {ModelClassQuery} - Scoped query.
     */
    static currentTranslationScope(query) {
        const configuration = this._getConfiguration();
        const locale = configuration.getLocale();
        const fallbacks = configuration.getLocaleFallbacks();
        const locales = locale ? (fallbacks?.[locale] || [locale]) : [];
        if (locales.length === 0)
            return query.where("1=0");
        const driver = query.driver;
        const translationClass = this.getTranslationClass();
        const relationship = this.getRelationshipByName("currentTranslation");
        const tableName = translationClass.tableName();
        const scopeTableReference = `${tableName}_current_translation_scope`;
        const targetTableSql = driver.quoteTable(query.getTableReferenceForJoin());
        const scopeTableSql = driver.quoteTable(scopeTableReference);
        const scopeTableFromSql = `${driver.quoteTable(tableName)} AS ${scopeTableSql}`;
        const primaryKeyColumn = scalarModelPrimaryKey(translationClass.primaryKey(), `Current translation scope for ${translationClass.name}`);
        const foreignKeyColumn = relationship.getForeignKey();
        const targetPrimaryKeySql = `${targetTableSql}.${driver.quoteColumn(primaryKeyColumn)}`;
        const targetForeignKeySql = `${targetTableSql}.${driver.quoteColumn(foreignKeyColumn)}`;
        const scopePrimaryKeySql = `${scopeTableSql}.${driver.quoteColumn(primaryKeyColumn)}`;
        const scopeForeignKeySql = `${scopeTableSql}.${driver.quoteColumn(foreignKeyColumn)}`;
        const scopeLocaleSql = `${scopeTableSql}.${driver.quoteColumn("locale")}`;
        const localeListSql = locales.map((fallbackLocale) => driver.quote(fallbackLocale)).join(", ");
        const localeOrderSql = locales.map((fallbackLocale, index) => `WHEN ${scopeLocaleSql} = ${driver.quote(fallbackLocale)} THEN ${driver.quote(index)}`).join(" ");
        const fallbackOrderSql = `CASE ${localeOrderSql} ELSE ${driver.quote(locales.length)} END`;
        const selectedTranslationSql = driver.getType() == "mssql"
            ? `SELECT TOP 1 ${scopePrimaryKeySql} FROM ${scopeTableFromSql} WHERE ${scopeForeignKeySql} = ${targetForeignKeySql} AND ${scopeLocaleSql} IN (${localeListSql}) ORDER BY ${fallbackOrderSql}, ${scopePrimaryKeySql} ASC`
            : `SELECT ${scopePrimaryKeySql} FROM ${scopeTableFromSql} WHERE ${scopeForeignKeySql} = ${targetForeignKeySql} AND ${scopeLocaleSql} IN (${localeListSql}) ORDER BY ${fallbackOrderSql}, ${scopePrimaryKeySql} ASC LIMIT 1`;
        return query.where(`${targetPrimaryKeySql} = (${selectedTranslationSql})`);
    }
    /**
     * Runs get translation class.
     * @returns {typeof VelociousDatabaseRecord} - The translation class.
     */
    static getTranslationClass() {
        if (this._translationClass)
            return this._translationClass;
        if (this.tableName().endsWith("_translations"))
            throw new Error("Trying to define a translations class for a translation class");
        const className = `${this.getModelName()}Translation`;
        const TranslationClass = class Translation extends VelociousDatabaseRecord {
        };
        const belongsTo = singularizeModelName(inflection.camelize(this.tableName(), true));
        Object.defineProperty(TranslationClass, "name", { value: className });
        TranslationClass.setTableName(this.getTranslationsTableName());
        TranslationClass.belongsTo(belongsTo);
        if (this.hasTenantDatabaseIdentifierResolver()) {
            const translatedModelClass = this;
            TranslationClass.switchesTenantDatabase(({ tenant }) => translatedModelClass.getTenantDatabaseIdentifier(tenant));
        }
        this._translationClass = TranslationClass;
        return this._translationClass;
    }
    /**
     * Runs get translations table name.
     * @returns {string} - The translations table name.
     */
    static getTranslationsTableName() {
        const tableNameParts = this.tableName().split("_");
        tableNameParts[tableNameParts.length - 1] = inflection.singularize(tableNameParts[tableNameParts.length - 1]);
        return `${tableNameParts.join("_")}_translations`;
    }
    /**
     * Runs has translations table.
     * @returns {Promise<boolean>} - Resolves with Whether it has translations table.
     */
    static async hasTranslationsTable() {
        try {
            await this.connection().getTableByName(this.getTranslationsTableName());
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Adds a validation to an attribute.
     * @param {string} attributeName The name of the attribute to validate.
     * @param {Record<string, boolean | Record<string, ReturnType<typeof JSON.parse>>>} validators The validators to add. Key is the validator name, value is the validator arguments.
     */
    static async validates(attributeName, validators) {
        for (const validatorName in validators) {
            /**
             * Defines validatorArgs.
             * @type {Record<string, ReturnType<typeof JSON.parse>>} */
            let validatorArgs;
            /**
             * Use validator.
             * @type {boolean} */
            let useValidator = true;
            const validatorArgsCandidate = validators[validatorName];
            if (typeof validatorArgsCandidate == "boolean") {
                validatorArgs = {};
                useValidator;
                if (!validatorArgsCandidate) {
                    useValidator = false;
                }
            }
            else {
                validatorArgs = validatorArgsCandidate;
            }
            if (!useValidator) {
                continue;
            }
            const ValidatorClass = this.getValidatorType(validatorName);
            const validator = new ValidatorClass({ attributeName, args: validatorArgs });
            if (!this._validators)
                this._validators = {};
            if (!(attributeName in this._validators))
                this._validators[attributeName] = [];
            this._validators[attributeName].push(validator);
        }
    }
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
    static actsAsList(positionColumn, options) {
        const { scope } = options;
        registerActsAsListCallbacks(this, positionColumn, { scope });
    }
    /**
     * Runs translations loaded.
     * @abstract
     * @returns {TranslationBase[]} - The translations loaded.
     */
    translationsLoaded() {
        throw new Error("'translationsLoaded' not implemented");
    }
    /**
     * Runs get translated attribute.
     * @param {string} name - Name.
     * @param {string} locale - Locale.
     * @returns {string | undefined} - The translated attribute, if found.
     */
    _getTranslatedAttribute(name, locale) {
        const translation = this.translationsLoaded().find((translation) => translation.locale() == locale);
        if (translation) {
            /**
             * Dict.
             * @type {Record<string, ReturnType<typeof JSON.parse>>} */
            const dict = translation;
            const attributeMethod = /** @type {() => string | undefined} */ (dict[name]);
            if (typeof attributeMethod == "function") {
                return attributeMethod.bind(translation)();
            }
            else {
                throw new Error(`No such translated method: ${name} (${typeof attributeMethod})`);
            }
        }
        return undefined;
    }
    /**
     * Runs get translated attribute with fallback.
     * @param {string} name - Name.
     * @param {string} locale - Locale.
     * @returns {string | undefined} - The translated attribute with fallback, if found.
     */
    _getTranslatedAttributeWithFallback(name, locale) {
        let localesInOrder;
        const fallbacks = this._getConfiguration().getLocaleFallbacks();
        if (fallbacks && locale in fallbacks) {
            localesInOrder = fallbacks[locale];
        }
        else {
            localesInOrder = [locale];
        }
        for (const fallbackLocale of localesInOrder) {
            const result = this._getTranslatedAttribute(name, fallbackLocale);
            if (result && result.trim() != "") {
                return result;
            }
        }
        return undefined;
    }
    /**
     * Runs set translated attribute.
     * @param {string} name - Name.
     * @param {string} locale - Locale.
     * @param {ReturnType<typeof JSON.parse>} newValue - New value.
     * @returns {void} - No return value.
     */
    _setTranslatedAttribute(name, locale, newValue) {
        /**
         * Defines translation.
         * @type {VelociousDatabaseRecord | TranslationBase | undefined} */
        let translation;
        translation = this.translationsLoaded()?.find((translation) => translation.locale() == locale);
        if (!translation) {
            const instanceRelationship = this.getRelationshipByName("translations");
            translation = instanceRelationship.build({ locale });
        }
        /**
         * Assignments.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const assignments = {};
        assignments[name] = newValue;
        translation.assign(assignments);
    }
    /**
     * Runs new query.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {{driver?: import("../drivers/base.js").default | (() => import("../drivers/base.js").default), operation?: import("../operation.js").default}} [args] - Explicit query ownership.
     * @returns {ModelClassQuery<MC>} - The new query.
     */
    static _newQuery(args = {}) {
        const { driver: givenDriver, operation: givenOperation, ...restArgs } = args;
        restArgsError(restArgs);
        const operation = givenOperation || this._recordMetadataOperation;
        const driver = givenDriver || (operation ? operation.connection() : () => this.connection());
        this._assertHasBeenInitialized();
        const handler = new Handler();
        const query = new ModelClassQuery({
            driver,
            handler,
            modelClass: this,
            operation
        });
        return query.from(new FromTable(this.tableName()));
    }
    /**
     * Runs orderable column.
     * @returns {string} - The orderable column.
     */
    static orderableColumn() {
        // FIXME: Allow to change to 'created_at' if using UUID?
        const primaryKey = this.primaryKey();
        if (Array.isArray(primaryKey))
            return primaryKey[0];
        return primaryKey;
    }
    /**
     * Runs all.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @returns {ModelClassQuery<MC>} - The all.
     */
    static all() {
        return this._newQuery();
    }
    /**
     * Runs accessible for.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {string} action - Ability action to scope by.
     * @param {import("../../authorization/ability.js").default | undefined} [ability] - Ability instance.
     * @returns {ModelClassQuery<MC>} - Authorized query.
     */
    static accessibleFor(action, ability) {
        const query = this._newQuery();
        const currentAbility = ability || Current.ability();
        if (!currentAbility) {
            throw new Error(`No ability in context for ${this.name}. Pass an ability or configure ability resolver on the request`);
        }
        return /** @type {ModelClassQuery<MC>} */ (currentAbility.applyToQuery({
            action,
            modelClass: this,
            query
        }));
    }
    /**
     * Runs accessible.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {import("../../authorization/ability.js").default | undefined} [ability] - Ability instance.
     * @returns {ModelClassQuery<MC>} - Authorized query.
     */
    static accessible(ability) {
        return this.accessibleFor("read", ability);
    }
    /**
     * Runs accessible by.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {import("../../authorization/ability.js").default} ability - Ability instance.
     * @returns {ModelClassQuery<MC>} - Authorized query.
     */
    static accessibleBy(ability) {
        if (!ability) {
            throw new Error(`No ability passed to ${this.name}.accessibleBy(ability).`);
        }
        return this.accessible(ability);
    }
    /**
     * Runs count.
     * @returns {Promise<number>} - Resolves with the count.
     */
    static async count() {
        await this.ensureInitialized();
        return await this._newQuery().count();
    }
    /**
     * Runs group.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {string} group - Group.
     * @returns {ModelClassQuery<MC>} - The group.
     */
    static group(group) {
        return this._newQuery().group(group);
    }
    static async destroyAll() {
        await this.ensureInitialized();
        return await this._newQuery().destroyAll();
    }
    /**
     * Runs pluck.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {...string|string[]} columns - Column names.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Resolves with the pluck.
     */
    static async pluck(...columns) {
        await this.ensureInitialized();
        return await this._newQuery().pluck(...columns);
    }
    /**
     * Runs find.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {import("../../utils/model-primary-key.js").ModelPrimaryKeyValue} recordId - Record id.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the find.
     */
    static async find(recordId) {
        await this.ensureInitialized();
        return await this._newQuery().find(recordId);
    }
    /**
     * Runs find by.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
     * @returns {Promise<InstanceType<MC> | null>} - Resolves with the by.
     */
    static async findBy(conditions) {
        await this.ensureInitialized();
        return await this._newQuery().findBy(conditions);
    }
    /**
     * Runs find by or fail.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the by or fail.
     */
    static async findByOrFail(conditions) {
        await this.ensureInitialized();
        return await this._newQuery().findByOrFail(conditions);
    }
    /**
     * Returns an immutable tenant-bound model scope. Eager helpers and explicit
     * databaseOperation/transaction callbacks execute from a captured physical
     * database configuration instead of ambient tenant state.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {object} tenant - Ordinary or null-prototype JSON-compatible tenant descriptor to scope the model to.
     * @returns {TenantModelScope<MC>} - Model scope bound to the captured tenant database.
     */
    static usingTenant(tenant) {
        return new TenantModelScope({
            configuration: this._getConfiguration(),
            modelClass: this,
            tenant
        });
    }
    /**
     * Runs find or create by.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {{[key: string]: string | number}} conditions - Conditions hash keyed by attribute name.
     * @param {() => void} [callback] - Callback function.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the or create by.
     */
    static async findOrCreateBy(conditions, callback) {
        await this.ensureInitialized();
        return await this._newQuery().findOrCreateBy(conditions, callback);
    }
    /**
     * Runs find or initialize by.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {Record<string, string | number>} conditions - Conditions.
     * @param {(arg: InstanceType<MC>) => void} [callback] - Callback function.
     * @returns {Promise<InstanceType<MC>>} - Resolves with the or initialize by.
     */
    static async findOrInitializeBy(conditions, callback) {
        await this.ensureInitialized();
        return await this._newQuery().findOrInitializeBy(conditions, callback);
    }
    /**
     * Runs first.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @returns {Promise<InstanceType<MC>>} - Resolves with the first.
     */
    static async first() {
        await this.ensureInitialized();
        const result = await this._newQuery().first();
        if (!result)
            throw new Error(`${this.name}.first() returned no records`);
        return result;
    }
    /**
     * Runs joins.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {string | import("../query/join-object.js").JoinObject} join - Join clause or join descriptor.
     * @returns {ModelClassQuery<MC>} - The joins.
     */
    static joins(join) {
        return this._newQuery().joins(join);
    }
    /**
     * Runs last.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @returns {Promise<InstanceType<MC>>} - Resolves with the last.
     */
    static async last() {
        await this.ensureInitialized();
        const result = await this._newQuery().last();
        if (!result)
            throw new Error(`${this.name}.last() returned no records`);
        return result;
    }
    /**
     * Runs limit.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {number} value - Value to use.
     * @returns {ModelClassQuery<MC>} - The limit.
     */
    static limit(value) {
        return this._newQuery().limit(value);
    }
    /**
     * Runs order.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {import("../query/index.js").OrderArgumentType} order - Order.
     * @returns {ModelClassQuery<MC>} - The order.
     */
    static order(order) {
        return this._newQuery().order(order);
    }
    /**
     * Runs distinct.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {boolean} [value] - Value to use.
     * @returns {ModelClassQuery<MC>} - The distinct.
     */
    static distinct(value = true) {
        return this._newQuery().distinct(value);
    }
    /**
     * Runs preload.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {import("../query/index.js").NestedPreloadRecord | string | Array<string | import("../query/index.js").NestedPreloadRecord>} preload - Preload.
     * @returns {ModelClassQuery<MC>} - The preload.
     */
    static preload(preload) {
        const query = /** @type {ModelClassQuery<MC>} */ (this._newQuery().preload(preload));
        return query;
    }
    /**
     * Runs select.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {import("../query/index.js").SelectArgumentType} select - Select.
     * @returns {ModelClassQuery<MC>} - The select.
     */
    static select(select) {
        return this._newQuery().select(select);
    }
    /**
     * Runs to array.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @returns {Promise<InstanceType<MC>[]>} - Resolves with the array.
     */
    static async toArray() {
        await this.ensureInitialized();
        return await this._newQuery().toArray();
    }
    /**
     * Runs load.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @returns {Promise<InstanceType<MC>[]>} - Resolves with the array.
     */
    static async load() {
        await this.ensureInitialized();
        return await this._newQuery().load();
    }
    /**
     * Runs where.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {import("../query/index.js").WhereArgumentType} where - Where.
     * @returns {ModelClassQuery<MC>} - The where.
     */
    static where(where) {
        return this._newQuery().where(where);
    }
    /**
     * Runs ransack.
     * @template {typeof VelociousDatabaseRecord} MC
     * @this {MC}
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Ransack-style params hash.
     * @returns {ModelClassQuery<MC>} - Query with Ransack filters applied.
     */
    static ransack(params) {
        return this._newQuery().ransack(params);
    }
    /**
     * Runs constructor.
     * @param {WriteAttributes} changes - Changes.
     */
    constructor(changes = /** @type {WriteAttributes} */ ({})) {
        const ModelClass = /** @type {typeof VelociousDatabaseRecord} */ (new.target);
        this._databaseOperation = ModelClass._recordMetadataOperation;
        this.getModelClass()._assertHasBeenInitialized();
        this._attributes = {};
        this._changes = {};
        this._isNewRecord = true;
        for (const key in changes) {
            this.setAttribute(key, changes[key]);
        }
    }
    /**
     * Binds future query, lifecycle, relationship, and persistence work to an operation.
     * @param {import("../operation.js").default} operation - Owning operation.
     * @returns {this} - Bound record.
     */
    bindDatabaseOperation(operation) {
        if (this._databaseOperation && this._databaseOperation !== operation) {
            throw new Error("Record is already bound to another database operation");
        }
        this._databaseOperation = operation;
        return this;
    }
    /**
     * Captures and validates the physical database identity that owns this record.
     * @param {string} databaseIdentity - Opaque operation/connection identity.
     * @returns {this} This record.
     */
    captureDatabaseIdentity(databaseIdentity) {
        if (this._databaseIdentity && this._databaseIdentity !== databaseIdentity) {
            throw new Error("Record belongs to a different physical tenant database");
        }
        this._databaseIdentity = databaseIdentity;
        return this;
    }
    /**
     * Returns the captured physical database identity.
     * @returns {string | undefined} Captured physical database identity.
     */
    databaseIdentity() {
        return this._databaseIdentity;
    }
    /**
     * Releases this record from a completed eager-helper operation while
     * preserving the legacy ambient follow-up behavior of `usingTenant` finders.
     * @param {import("../operation.js").default} operation - Releasing operation.
     * @returns {this} - Record.
     */
    releaseDatabaseOperation(operation) {
        if (this._databaseOperation !== operation) {
            throw new Error("Record is not bound to the releasing database operation");
        }
        this._databaseOperation = undefined;
        return this;
    }
    /**
     * Returns the explicit operation owning this record, if any.
     * @returns {import("../operation.js").default | undefined} - Owning operation.
     */
    databaseOperation() {
        return this._databaseOperation;
    }
    /**
     * Binds a related record to the same operation as this record.
     * @template {VelociousDatabaseRecord} Model
     * @param {Model} record - Related record.
     * @returns {Model} - Related record.
     */
    bindRelatedRecord(record) {
        if (this._databaseOperation)
            this._databaseOperation.bindRecord(record);
        return record;
    }
    /**
     * Builds a model query preserving this record's operation ownership.
     * @template {typeof VelociousDatabaseRecord} MC
     * @param {MC} ModelClass - Target model class.
     * @returns {ModelClassQuery<MC>} - Target query.
     */
    queryForModel(ModelClass) {
        if (this._databaseOperation)
            return this._databaseOperation.forModel(ModelClass);
        return ModelClass._newQuery();
    }
    /**
     * Initializes a relationship/preload target without dropping this record's
     * explicit operation connection.
     * @param {typeof VelociousDatabaseRecord} ModelClass - Target model class.
     * @param {import("../../configuration.js").default} configuration - Owning configuration.
     * @returns {Promise<void>} - Resolves when initialized.
     */
    async ensureModelClassInitialized(ModelClass, configuration) {
        if (this._databaseOperation) {
            await this._databaseOperation.ensureModelInitialized(ModelClass);
            return;
        }
        await ModelClass.ensureInitialized({ configuration });
    }
    /**
     * Runs load existing record.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Column-keyed database values.
     * @param {Set<string>} [selectedAttributeAliases] - Explicit result aliases selected by the loading query.
     * @returns {void} - No return value.
     */
    loadExistingRecord(attributes, selectedAttributeAliases = new Set()) {
        this._attributes = attributes;
        this._selectedAttributeAliases = new Set(selectedAttributeAliases);
        this._isNewRecord = false;
    }
    /**
     * Assigns the given attributes to the record.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} attributesToAssign - Attributes to assign.
     * @returns {void} - No return value.
     */
    assign(attributesToAssign) {
        this._assignedAttributeNames ||= new Set();
        for (const attributeToAssign in attributesToAssign) {
            this._assignedAttributeNames.add(attributeToAssign);
            this.setAttribute(attributeToAssign, attributesToAssign[attributeToAssign]);
        }
    }
    /**
     * Returns a the current attributes of the record (original attributes from database plus changes)
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The attributes.
     */
    attributes() {
        const data = this.rawAttributes();
        const columnNameToAttributeName = this.getModelClass().getColumnNameToAttributeNameMap();
        /**
         * Attributes.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const attributes = {};
        for (const columnName in data) {
            if (Object.hasOwn(columnNameToAttributeName, columnName)) {
                const attributeName = columnNameToAttributeName[columnName];
                attributes[attributeName] = this.readAttribute(attributeName);
            }
            else if (this._selectedAttributeAliases.has(columnName)) {
                attributes[columnName] = data[columnName];
            }
        }
        return attributes;
    }
    /**
     * Returns column-name keyed data (original attributes from database plus changes)
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - The raw attributes.
     */
    rawAttributes() {
        return Object.assign({}, this._attributes, this._changes);
    }
    /**
     * Runs connection.
     * @returns {import("../drivers/base.js").default} - The connection.
     */
    _connection() {
        if (this._databaseOperation)
            return this._databaseOperation.connection();
        if (this.__connection)
            return this.__connection;
        const connection = this.getModelClass().connection();
        if (this._databaseIdentity)
            this.captureDatabaseIdentity(this._databaseIdentityForConnection(connection));
        return connection;
    }
    /**
     * Resolves the identity of an already selected concrete connection.
     * @param {import("../drivers/base.js").default} connection - Concrete connection.
     * @returns {string} Physical database identity.
     */
    _databaseIdentityForConnection(connection) {
        const modelClass = this.getModelClass();
        const databaseIdentifier = modelClass.getDatabaseIdentifier();
        const reuseKey = modelClass
            ._getConfiguration()
            .getDatabasePool(databaseIdentifier)
            .getConnectionConfigurationReuseKey(connection);
        return `${databaseIdentifier}:${reuseKey}`;
    }
    /**
     * Returns the connection that owns this record's database work.
     * @returns {import("../drivers/base.js").default} - Connection.
     */
    connection() {
        return this._connection();
    }
    /**
     * Counts dependent records for a `dependent: "restrict"` relationship.
     * @param {RestrictInstanceRelationship} instanceRelationship - Relationship instance to count.
     * @returns {Promise<number>} - Dependent row count.
     */
    async _dependentRestrictCount(instanceRelationship) {
        const TargetModelClass = instanceRelationship.getTargetModelClass();
        if (!TargetModelClass || !TargetModelClass.hasTenantDatabaseIdentifierResolver()) {
            return await instanceRelationship.query().count();
        }
        if (this.getModelClass().hasTenantDatabaseIdentifierResolver()) {
            return await instanceRelationship.query().count();
        }
        return await this._dependentRestrictTenantCount(instanceRelationship, TargetModelClass);
    }
    /**
     * Counts tenant-scoped dependent records across all provider-listed tenants.
     * @param {RestrictInstanceRelationship} instanceRelationship - Relationship instance to count.
     * @param {typeof VelociousDatabaseRecord} TargetModelClass - Related model class.
     * @returns {Promise<number>} - Dependent row count.
     */
    async _dependentRestrictTenantCount(instanceRelationship, TargetModelClass) {
        const configuration = this.getModelClass()._getConfiguration();
        const tenantDatabaseProviders = configuration.getTenantDatabaseProviders();
        const providerEntries = Object.entries(tenantDatabaseProviders);
        const targetIdentifier = TargetModelClass.getTenantDatabaseIdentifier(null);
        if (providerEntries.length == 0) {
            throw new Error(`Cannot check dependent ${instanceRelationship.getRelationship().getRelationshipName()} because ${TargetModelClass.getModelName()} switches tenant databases but no tenant database providers are configured`);
        }
        if (targetIdentifier) {
            const provider = tenantDatabaseProviders[targetIdentifier];
            if (!provider) {
                throw new Error(`Cannot check dependent ${instanceRelationship.getRelationship().getRelationshipName()} because ${TargetModelClass.getModelName()} switches tenant database ${targetIdentifier} but no tenant database provider is configured for ${targetIdentifier}`);
            }
            return await this._dependentRestrictProviderCount(instanceRelationship, TargetModelClass, targetIdentifier, provider);
        }
        let matchingProviderSeen = false;
        for (const [identifier, provider] of providerEntries) {
            const tenants = await this._dependentRestrictProviderTenants(instanceRelationship, TargetModelClass, identifier, provider);
            for (const tenant of tenants) {
                if (TargetModelClass.getTenantDatabaseIdentifier(tenant) != identifier) {
                    continue;
                }
                matchingProviderSeen = true;
                const count = await configuration.runWithTenant(tenant, async () => {
                    if (!configuration.isDatabaseIdentifierActive(identifier)) {
                        throw new Error(`Tenant database identifier ${identifier} is inactive while checking dependent ${instanceRelationship.getRelationship().getRelationshipName()}`);
                    }
                    return await configuration.ensureConnections({ databaseIdentifiers: [identifier], name: `Dependent restrict count: ${TargetModelClass.getModelName()}` }, async () => {
                        return await instanceRelationship.query().count();
                    });
                });
                if (count > 0)
                    return count;
            }
        }
        if (!matchingProviderSeen) {
            throw new Error(`Cannot check dependent ${instanceRelationship.getRelationship().getRelationshipName()} because no tenant database provider matched ${TargetModelClass.getModelName()}`);
        }
        return 0;
    }
    /**
     * Counts tenant-scoped dependent records for one configured tenant provider.
     * @param {RestrictInstanceRelationship} instanceRelationship - Relationship instance to count.
     * @param {typeof VelociousDatabaseRecord} TargetModelClass - Related model class.
     * @param {string} identifier - Tenant database identifier.
     * @param {TenantDatabaseProviderType} provider - Tenant database provider.
     * @returns {Promise<number>} - Dependent row count.
     */
    async _dependentRestrictProviderCount(instanceRelationship, TargetModelClass, identifier, provider) {
        const configuration = this.getModelClass()._getConfiguration();
        const tenants = await this._dependentRestrictProviderTenants(instanceRelationship, TargetModelClass, identifier, provider);
        for (const tenant of tenants) {
            const count = await configuration.runWithTenant(tenant, async () => {
                if (!configuration.isDatabaseIdentifierActive(identifier)) {
                    throw new Error(`Tenant database identifier ${identifier} is inactive while checking dependent ${instanceRelationship.getRelationship().getRelationshipName()}`);
                }
                return await configuration.ensureConnections({ databaseIdentifiers: [identifier], name: `Dependent restrict count: ${TargetModelClass.getModelName()}` }, async () => {
                    return await instanceRelationship.query().count();
                });
            });
            if (count > 0)
                return count;
        }
        return 0;
    }
    /**
     * Lists restrict-check tenants for one configured tenant provider.
     * @param {RestrictInstanceRelationship} instanceRelationship - Relationship instance to count.
     * @param {typeof VelociousDatabaseRecord} TargetModelClass - Related model class.
     * @param {string} identifier - Tenant database identifier.
     * @param {TenantDatabaseProviderType} provider - Tenant database provider.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Listed tenant objects.
     */
    async _dependentRestrictProviderTenants(instanceRelationship, TargetModelClass, identifier, provider) {
        const configuration = this.getModelClass()._getConfiguration();
        const listTenants = typeof provider.listRestrictTenants == "function"
            ? provider.listRestrictTenants
            : provider.listTenants;
        const listTenantsMethodName = typeof provider.listRestrictTenants == "function"
            ? "listRestrictTenants"
            : "listTenants";
        if (typeof listTenants != "function") {
            throw new Error(`Tenant database provider for ${identifier} must define listTenants or listRestrictTenants before dependent restrict can check ${instanceRelationship.getRelationship().getRelationshipName()}`);
        }
        const tenants = await configuration.ensureConnections({ name: `Dependent restrict tenants: ${TargetModelClass.getModelName()}` }, async () => {
            return await listTenants({
                configuration,
                identifier
            });
        });
        if (!Array.isArray(tenants)) {
            throw new Error(`Tenant database provider for ${identifier} must return an array from ${listTenantsMethodName}`);
        }
        return tenants;
    }
    /**
     * Runs a callback while primary-key reads resolve to the persisted identity.
     * @param {() => Promise<void>} callback - Callback that requires the stored identity.
     * @returns {Promise<void>} - Resolves when the callback completes.
     */
    async _withPersistedPrimaryKey(callback) {
        const previousReadsPersistedPrimaryKey = this._readsPersistedPrimaryKey;
        this._readsPersistedPrimaryKey = true;
        try {
            await callback();
        }
        finally {
            this._readsPersistedPrimaryKey = previousReadsPersistedPrimaryKey;
        }
    }
    /**
     * Destroys the record in the database and all of its dependent records.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async destroy() {
        await this._withPersistedPrimaryKey(async () => {
            await this._destroyPersistedRecord();
        });
    }
    /**
     * Runs the destroy lifecycle after the persisted identity has been restored.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _destroyPersistedRecord() {
        await this._runLifecycleCallbacks("beforeDestroy");
        for (const relationship of this.getModelClass().getRelationships()) {
            if (relationship.getDependent() == "restrict") {
                const instanceRelationship = /** @type {RestrictInstanceRelationship} */ (this.getRelationshipByName(relationship.getRelationshipName()));
                const count = await this._dependentRestrictCount(instanceRelationship);
                if (count > 0) {
                    throw new Error(`Cannot delete record because dependent ${relationship.getRelationshipName()} exist`);
                }
                continue;
            }
            if (relationship.getDependent() != "destroy") {
                continue;
            }
            const instanceRelationship = this.getRelationshipByName(relationship.getRelationshipName());
            /**
             * Defines models.
             * @type {VelociousDatabaseRecord[]} */
            let models;
            if (instanceRelationship.getType() == "belongsTo") {
                if (!instanceRelationship.isLoaded()) {
                    await instanceRelationship.load();
                }
                const model = instanceRelationship.loaded();
                if (model instanceof VelociousDatabaseRecord) {
                    models = [model];
                }
                else {
                    throw new Error(`Unexpected loaded type: ${typeof model}`);
                }
            }
            else if (instanceRelationship.getType() == "hasMany") {
                if (!instanceRelationship.isLoaded()) {
                    await instanceRelationship.load();
                }
                const loadedModels = instanceRelationship.loaded();
                if (Array.isArray(loadedModels)) {
                    models = loadedModels;
                }
                else {
                    throw new Error(`Unexpected loaded type: ${typeof loadedModels}`);
                }
            }
            else if (instanceRelationship.getType() == "hasOne") {
                if (!instanceRelationship.isLoaded()) {
                    await instanceRelationship.load();
                }
                const loadedModel = instanceRelationship.loaded();
                if (loadedModel instanceof VelociousDatabaseRecord) {
                    models = [loadedModel];
                }
                else if (loadedModel === undefined) {
                    models = [];
                }
                else {
                    throw new Error(`Unexpected loaded type: ${typeof loadedModel}`);
                }
            }
            else {
                throw new Error(`Unhandled relationship type: ${instanceRelationship.getType()}`);
            }
            for (const model of models) {
                if (model.isPersisted()) {
                    await model.destroy();
                }
            }
        }
        /**
         * Conditions.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const conditions = {};
        Object.assign(conditions, modelPrimaryKeyConditions(this.getModelClass().primaryKey(), this._persistedPrimaryKeyValue()));
        const sql = this._connection().deleteSql({
            conditions,
            tableName: this._tableName()
        });
        await this._connection().query(sql, { logName: `${this.getModelClass().name} Destroy` });
        await this._runLifecycleCallbacks("afterDestroy");
        await this._emitRecordChangeAfterCommit("destroy");
    }
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
    async _emitRecordChangeAfterCommit(operation) {
        const modelClass = this.getModelClass();
        if (!recordChanges.hasListeners(modelClass))
            return;
        const record = this;
        const databaseIdentity = this._databaseOperation
            ? this._databaseOperation.databaseIdentity()
            : this._databaseIdentityForConnection(this._connection());
        this.captureDatabaseIdentity(databaseIdentity);
        await this._connection().afterCommit(() => {
            recordChanges.emit({ databaseIdentity, modelClass, operation, record });
        });
    }
    /**
     * Stores an audit row for this record.
     * @param {import("./auditing.js").CreateAuditArgs} args - Audit row options.
     * @returns {Promise<number | string>} Created audit row id.
     */
    async createAudit(args) {
        return await createAudit(this, args);
    }
    /**
     * Captures create changes before persistence clears the change set.
     * @returns {void}
     */
    captureCreateAuditChanges() {
        captureCreateAuditChanges(this);
    }
    /**
     * Writes the create audit row.
     * @returns {Promise<void>}
     */
    async createCreateAudit() {
        await createCreateAudit(this);
    }
    /**
     * Captures update changes before persistence clears the change set.
     * @returns {void}
     */
    captureUpdateAuditChanges() {
        captureUpdateAuditChanges(this);
    }
    /**
     * Writes the update audit row.
     * @returns {Promise<void>}
     */
    async createUpdateAudit() {
        await createUpdateAudit(this);
    }
    /**
     * Writes the destroy audit row.
     * @returns {Promise<void>}
     */
    async createDestroyAudit() {
        await createDestroyAudit(this);
    }
    /**
     * Runs run lifecycle callbacks.
     * @param {"afterCreate" | "afterDestroy" | "afterSave" | "afterUpdate" | "beforeCreate" | "beforeDestroy" | "beforeSave" | "beforeUpdate" | "beforeValidation"} callbackName - Callback type.
     * @returns {Promise<void>}
     */
    async _runLifecycleCallbacks(callbackName) {
        const callbacks = this.getModelClass().getLifecycleCallbacksMap()[callbackName] || [];
        let callbackNameRegisteredAsString = false;
        for (const callback of callbacks) {
            if (typeof callback == "string") {
                if (callback == callbackName) {
                    callbackNameRegisteredAsString = true;
                }
                const dynamicThis = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this));
                const methodCallback = dynamicThis[callback];
                if (typeof methodCallback != "function") {
                    throw new Error(`Lifecycle callback "${callback}" is not a function on ${this.getModelClass().name}`);
                }
                await methodCallback.call(this);
            }
            else {
                await callback(this);
            }
        }
        const dynamicThis = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this));
        const instanceCallback = dynamicThis[callbackName];
        if (!callbackNameRegisteredAsString && typeof instanceCallback === "function") {
            await instanceCallback.call(this);
        }
    }
    /**
     * Runs has changes.
     * @returns {boolean} - Whether changes.
     */
    _hasChanges() { return Object.keys(this._changes).length > 0; }
    /**
     * Returns true if the model has been changed since it was loaded from the database.
     * @returns {boolean} - Whether changed.
     */
    isChanged() {
        if (this.isNewRecord() || this._hasChanges()) {
            return true;
        }
        // Check if a loaded sub-model of a relationship is changed and should be saved along with this model.
        if (this._instanceRelationships) {
            for (const instanceRelationshipName in this._instanceRelationships) {
                const instanceRelationship = this._instanceRelationships[instanceRelationshipName];
                let loaded = instanceRelationship._loaded;
                if (instanceRelationship.getAutoSave() === false) {
                    continue;
                }
                if (!loaded)
                    continue;
                if (!Array.isArray(loaded))
                    loaded = [loaded];
                for (const model of loaded) {
                    if (model.isChanged()) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    /**
     * Returns the changes that have been made to this record since it was loaded from the database.
     * @returns {Record<string, Array<ReturnType<typeof JSON.parse>>>} - The changes.
     */
    changes() {
        /**
         * Changes.
         * @type {Record<string, Array<ReturnType<typeof JSON.parse>>>} */
        const changes = {};
        for (const changeKey in this._changes) {
            const changeValue = this._changes[changeKey];
            changes[changeKey] = [this._attributes[changeKey], changeValue];
        }
        return changes;
    }
    /**
     * Runs table name.
     * @returns {string} - The table name.
     */
    _tableName() {
        if (this.__tableName)
            return this.__tableName;
        return this.getModelClass().tableName();
    }
    /**
     * Reads an attribute value from the record. Read dynamically by name, so the value can be any
     * column type and may be overridden by a user-defined getter on the model.
     * @template V
     * @param {string} attributeName The name of the attribute to read. This is the attribute name, not the column name.
     * @returns {V} The attribute value, typed by the caller's accessor contract.
     */
    readAttribute(attributeName) {
        this.getModelClass()._assertHasBeenInitialized();
        const map = this.getModelClass().getAttributeNameToColumnNameMap();
        const resolvedAttributeName = this.getModelClass().resolveAttributeName(attributeName);
        const columnName = resolvedAttributeName ? map[resolvedAttributeName] : undefined;
        if (!columnName)
            throw new Error(`Couldn't figure out column name for attribute: ${attributeName} from these mappings: ${Object.keys(map).join(", ")}`);
        return /** @type {V} */ (this.readColumn(columnName));
    }
    /**
     * Read an association count attached by `.withCount(...)`. Counts are
     * stored on a separate map from the record's `_attributes` so a
     * virtual count like `tasksCount` cannot silently shadow a real
     * column of the same name. Returns the attached number, or 0 when
     * `.withCount(...)` wasn't requested for this attribute.
     * @param {string} attributeName - Attribute name, e.g. `"tasksCount"` or a custom `"activeMembersCount"` from `.withCount({activeMembersCount: {...}})`.
     * @returns {number} - Attached association count, or zero when absent.
     */
    readCount(attributeName) {
        return readPayloadAssociationCount(/** @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this)), attributeName);
    }
    /**
     * Attach an association count to this record. Internal helper used by
     * the `withCount` runner; outside code should not call this directly.
     * @param {string} attributeName - Attribute name.
     * @param {number} value - Count value.
     * @returns {void}
     */
    _setAssociationCount(attributeName, value) {
        setPayloadAssociationCount(/** @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this)), attributeName, value);
    }
    /**
     * All attached association counts as a plain object. Used by the
     * frontend-model serializer to ship counts alongside the record
     * attributes on the wire.
     * @returns {Record<string, number>} - Association counts keyed by attribute name.
     */
    associationCounts() {
        /**
         * Result.
         * @type {Record<string, number>} */
        const result = {};
        const target = /** @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this));
        if (!target._associationCounts)
            return result;
        for (const [attributeName, value] of target._associationCounts) {
            result[attributeName] = value;
        }
        return result;
    }
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
    queryData(name) {
        return readPayloadQueryData(/** @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this)), name);
    }
    /**
     * Attach a queryData value to this record. Internal helper used by
     * the `queryData` runner and by frontend-model hydration; outside
     * code should not call this directly.
     * @param {string} name - queryData attribute name.
     * @param {ReturnType<typeof JSON.parse>} value - Value to attach.
     * @returns {void}
     */
    _setQueryData(name, value) {
        setPayloadQueryData(/** @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this)), name, value);
    }
    /**
     * All attached queryData values as a plain object. Used by the
     * frontend-model serializer to ship queryData alongside the record
     * attributes on the wire.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Query-data values keyed by name.
     */
    queryDataValues() {
        /**
         * Result.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const result = {};
        const target = /** @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this));
        if (!target._queryDataValues)
            return result;
        for (const [name, value] of target._queryDataValues) {
            result[name] = value;
        }
        return result;
    }
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
    can(action) {
        return readPayloadComputedAbility(/** @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this)), action);
    }
    /**
     * Attach a per-record ability result to this record. Internal helper
     * used by the `abilities` runner and by frontend-model hydration;
     * outside code should not call this directly.
     * @param {string} action - Ability action name.
     * @param {boolean} value - Whether the current ability permits the action on this record.
     * @returns {void}
     */
    _setComputedAbility(action, value) {
        setPayloadComputedAbility(/** @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this)), action, value);
    }
    /**
     * All attached per-record ability results as a plain object. Used
     * by the frontend-model serializer to ship results alongside the
     * record attributes on the wire.
     * @returns {Record<string, boolean>} - Ability results keyed by action.
     */
    computedAbilities() {
        /**
         * Result.
         * @type {Record<string, boolean>} */
        const result = {};
        const target = /** @type {import("../../record-payload-values.js").RecordPayloadValuesTarget} */ ( /** @type {ReturnType<typeof JSON.parse>} */(this));
        if (!target._computedAbilities)
            return result;
        for (const [action, value] of target._computedAbilities) {
            result[action] = value;
        }
        return result;
    }
    /**
     * Reads a column value from the record.
     * @param {string} attributeName The name of the column to read. This is the column name, not the attribute name.
     * @returns {ReturnType<typeof JSON.parse>} - The column.
     */
    readColumn(attributeName) {
        this.getModelClass()._assertHasBeenInitialized();
        const belongsToChanges = this._belongsToChanges();
        const primaryKey = this.getModelClass().primaryKey();
        const readsPersistedPrimaryKey = this._readsPersistedPrimaryKey && (Array.isArray(primaryKey) ? primaryKey.includes(attributeName) : primaryKey == attributeName);
        let result;
        if (readsPersistedPrimaryKey) {
            result = this._attributes[attributeName];
        }
        else if (attributeName in belongsToChanges) {
            result = belongsToChanges[attributeName];
        }
        else if (attributeName in this._changes) {
            result = this._changes[attributeName];
        }
        else if (attributeName in this._attributes) {
            result = this._attributes[attributeName];
        }
        else if (this.isPersisted()) {
            throw new Error(`No such attribute or not selected ${this.constructor.name}#${attributeName}`);
        }
        const columnType = this.getModelClass().getColumnTypeByName(attributeName);
        if (columnType && this.getModelClass()._isDateLikeType(columnType)) {
            result = this._normalizeDateValueForRead(result);
        }
        result = this._normalizeBooleanValueForRead({ columnName: attributeName, columnType, value: result });
        return result;
    }
    /**
     * Resolves any declared per-attribute cast for a database column name.
     * @param {string} columnName - Database column name.
     * @returns {string | undefined} - Declared cast type, or undefined when none is declared.
     */
    _declaredAttributeCastForColumn(columnName) {
        const attributeName = this.getModelClass().getColumnNameToAttributeNameMap()[columnName];
        if (!attributeName)
            return undefined;
        return this.getModelClass().getAttributeCast(attributeName);
    }
    /**
     * Converts a stored value to a real boolean for a declared `"boolean"` cast.
     * Leaves null/undefined untouched; treats 1/true/"1" as true and 0/false/"0" as false.
     * @param {ReturnType<typeof JSON.parse>} value - Stored database value.
     * @returns {ReturnType<typeof JSON.parse>} - Converted boolean, or the original value when not recognized.
     */
    _castDeclaredBooleanForRead(value) {
        if (value === null || value === undefined)
            return value;
        if (declaredBooleanTruthyValues.has(value))
            return true;
        if (declaredBooleanFalsyValues.has(value))
            return false;
        return value;
    }
    /**
     * Whether a column value is currently loaded on this record (either as a
     * persisted attribute or a pending change). Used to decide whether a preload
     * can be skipped because the required columns are already present.
     * @param {string} columnName - The column name to check.
     * @returns {boolean} - Whether the column is loaded.
     */
    hasLoadedColumn(columnName) {
        return columnName in this._changes || columnName in this._attributes;
    }
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
    _normalizeBooleanValueForRead({ columnName, columnType, value }) {
        if (this._declaredAttributeCastForColumn(columnName) === "boolean") {
            return this._castDeclaredBooleanForRead(value);
        }
        if (!columnType)
            return value;
        if (columnType.toLowerCase() !== "boolean")
            return value;
        if (value === 1)
            return true;
        if (value === 0)
            return false;
        return value;
    }
    /**
     * Runs normalize date value for read.
     * @param {ReturnType<typeof JSON.parse>} value - Value from database.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    _normalizeDateValueForRead(value) {
        return normalizeDateValueForRead(value, { databaseType: this.getModelClass().getDatabaseType() });
    }
    _belongsToChanges() {
        /**
         * Belongs to changes.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const belongsToChanges = {};
        if (this._instanceRelationships) {
            for (const relationshipName in this._instanceRelationships) {
                const relationship = this._instanceRelationships[relationshipName];
                if (relationship.getType() == "belongsTo" && relationship.getDirty()) {
                    const model = relationship.getLoadedOrUndefined();
                    if (model) {
                        if (Array.isArray(model))
                            throw new Error("Unexpected belongs-to model array");
                        belongsToChanges[relationship.getForeignKey()] = this._belongsToForeignKeyValue({ model, relationship });
                    }
                }
            }
        }
        return belongsToChanges;
    }
    /**
     * Runs create new record.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _createNewRecord() {
        // Resolve the connection once and pin the whole insert path to it: a pool
        // can resolve a different current connection across the awaits below, and
        // the identity-insert wrapper is only effective on the exact session that
        // ran SET IDENTITY_INSERT.
        const connection = this._connection();
        if (!connection["insertSql"]) {
            throw new Error(`No insertSql on ${connection.constructor.name}`);
        }
        const data = Object.assign({}, this._belongsToChanges(), this.rawAttributes());
        const primaryKey = this.getModelClass().primaryKey();
        const primaryKeyColumns = this.getModelClass().getColumns().filter((column) => {
            return Array.isArray(primaryKey) ? primaryKey.includes(column.getName()) : column.getName() == primaryKey;
        });
        const primaryKeyColumn = Array.isArray(primaryKey) ? undefined : primaryKeyColumns[0];
        const primaryKeyType = primaryKeyColumn?.getType()?.toLowerCase();
        const driverSupportsDefaultUUID = typeof connection.supportsDefaultPrimaryKeyUUID == "function" && connection.supportsDefaultPrimaryKeyUUID();
        const isUUIDPrimaryKey = primaryKeyType?.includes("uuid");
        const shouldAssignUUIDPrimaryKey = isUUIDPrimaryKey && !driverSupportsDefaultUUID;
        this._setDefaultTimestampValues(data);
        const columnNames = this.getModelClass().getColumnNames();
        const hasUserProvidedPrimaryKey = Array.isArray(primaryKey)
            ? primaryKey.every((columnName) => data[columnName] !== undefined && data[columnName] !== null && data[columnName] !== "")
            : data[primaryKey] !== undefined && data[primaryKey] !== null && data[primaryKey] !== "";
        const hasUserProvidedAutoIncrementPrimaryKey = primaryKeyColumns.some((column) => {
            const value = data[column.getName()];
            return column.getAutoIncrement() === true && value !== undefined && value !== null && value !== "";
        });
        if (shouldAssignUUIDPrimaryKey && !hasUserProvidedPrimaryKey) {
            if (Array.isArray(primaryKey))
                throw new Error("Composite UUID primary keys must be provided explicitly.");
            data[primaryKey] = new UUID(4).format();
        }
        this._normalizeDateValuesForWrite(data);
        const sql = connection.insertSql({
            returnLastInsertedColumnNames: columnNames,
            tableName: this._tableName(),
            data
        });
        const insertOptions = { logName: `${this.getModelClass().name} Create` };
        // Explicit primary-key inserts into auto-increment columns go through the
        // driver's explicit-primary-key insert (MSSQL wraps it in IDENTITY_INSERT);
        // everything else uses the plain query path.
        const insertResult = hasUserProvidedAutoIncrementPrimaryKey
            ? await connection.insertWithExplicitPrimaryKey({ options: insertOptions, sql, tableName: this._tableName() })
            : await connection.query(sql, insertOptions);
        await this._applyInsertResult({ connection, data, insertResult, primaryKey });
        this.setIsNewRecord(false);
        this._markLoadedRelationshipsPreloadedAfterCreate();
    }
    /**
     * Marks only relationships with in-memory loaded values as preloaded after create.
     * @returns {void} - No return value.
     */
    _markLoadedRelationshipsPreloadedAfterCreate() {
        for (const relationship of this.getModelClass().getRelationships()) {
            const instanceRelationship = this.getRelationshipByName(relationship.getRelationshipName());
            if (instanceRelationship.getType() == "hasMany" && instanceRelationship.getLoadedOrUndefined() === null) {
                instanceRelationship.setLoaded([]);
            }
            if (instanceRelationship.getLoadedOrUndefined() !== undefined) {
                instanceRelationship.setPreloaded(true);
            }
        }
    }
    /**
     * Applies the database insert response to this record.
     * @param {{connection: import("../drivers/base.js").default, data: Record<string, string | number | boolean | Date | null | undefined>, insertResult: Array<Record<string, string | number | boolean | Date | null | undefined>> | null | undefined, primaryKey: string | string[]}} options - Pinned insert connection, inserted data, connection result, and primary key column name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _applyInsertResult({ connection, data, insertResult, primaryKey }) {
        if (Array.isArray(primaryKey)) {
            const insertedRow = Array.isArray(insertResult) ? insertResult[0] : undefined;
            await this._reloadWithId(readModelPrimaryKeyValue(primaryKey, (columnName) => insertedRow?.[columnName] ?? data[columnName]));
            return;
        }
        if (Array.isArray(insertResult) && insertResult[0] && insertResult[0][primaryKey]) {
            this._attributes = insertResult[0];
            this._changes = {};
        }
        else {
            const primaryKeyValue = data[primaryKey];
            if (primaryKeyValue !== undefined && primaryKeyValue !== null && primaryKeyValue !== "") {
                if (typeof primaryKeyValue != "string" && typeof primaryKeyValue != "number") {
                    throw new Error(`Inserted primary key ${primaryKey} must be a string or number, got ${typeof primaryKeyValue}`);
                }
                await this._reloadWithId(primaryKeyValue);
                return;
            }
            const id = await connection.lastInsertID();
            await this._reloadWithId(id);
        }
    }
    /**
     * Sets timestamp defaults for a new record insert.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Column-keyed data.
     * @returns {void} - No return value.
     */
    _setDefaultTimestampValues(data) {
        const createdAtColumn = this.getModelClass().getColumns().find((column) => column.getName() == "created_at");
        const updatedAtColumn = this.getModelClass().getColumns().find((column) => column.getName() == "updated_at");
        const currentDate = new Date();
        if (createdAtColumn && (data.created_at === undefined || data.created_at === null || data.created_at === "")) {
            data.created_at = currentDate;
        }
        if (updatedAtColumn && (data.updated_at === undefined || data.updated_at === null || data.updated_at === "")) {
            data.updated_at = currentDate;
        }
    }
    /**
     * Runs normalize date values for write.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Column-keyed data.
     * @returns {void} - No return value.
     */
    _normalizeDateValuesForWrite(data) {
        for (const columnName in data) {
            const columnType = this.getModelClass().getColumnTypeByName(columnName);
            if (!columnType || !this.getModelClass()._isDateLikeType(columnType))
                continue;
            const value = data[columnName];
            data[columnName] = normalizeDateValueForWrite(value, { timeZone: this.getModelClass()._timeZoneForDateWrite() });
        }
    }
    /**
     * Runs update record with changes.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _updateRecordWithChanges() {
        const connection = this._connection();
        const primaryKey = this.getModelClass().primaryKey();
        const persistedPrimaryKeyValue = this._persistedPrimaryKeyValue();
        const nextPrimaryKeyValue = this.id();
        /**
         * Conditions.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const conditions = {};
        Object.assign(conditions, modelPrimaryKeyConditions(primaryKey, persistedPrimaryKeyValue));
        const changes = Object.assign({}, this._belongsToChanges(), this._changes);
        const updatedAtColumn = this.getModelClass().getColumns().find((column) => column.getName() == "updated_at");
        const currentDate = new Date();
        if (updatedAtColumn && (changes.updated_at === undefined || changes.updated_at === null || changes.updated_at === "")) {
            changes.updated_at = currentDate;
        }
        if (Object.keys(changes).length > 0) {
            this._normalizeDateValuesForWrite(changes);
            const sql = connection.updateSql({
                tableName: this._tableName(),
                data: changes,
                conditions
            });
            await connection.query(sql, { logName: `${this.getModelClass().name} Update` });
            await this._reloadWithId(nextPrimaryKeyValue);
            const reloadedPrimaryKeyValue = this.id();
            if (Object.keys(this.getModelClass().getAttachments()).length > 0
                && modelPrimaryKeyCacheKey(primaryKey, persistedPrimaryKeyValue) !== modelPrimaryKeyCacheKey(primaryKey, reloadedPrimaryKeyValue)) {
                await recordAttachmentsStoreForModel(this).migrateRecordIdentity({
                    connection,
                    model: this,
                    nextIdentity: reloadedPrimaryKeyValue,
                    previousIdentity: persistedPrimaryKeyValue
                });
            }
        }
    }
    /**
     * Runs id.
     * @returns {import("../../utils/model-primary-key.js").ModelPrimaryKeyValue} - The id.
     */
    id() {
        if (!this.getModelClass()._columnNameToAttributeName) {
            throw new Error(`Column names mapping hasn't been set on ${this.constructor.name}. Has the model been initialized?`);
        }
        const primaryKey = this.getModelClass().primaryKey();
        if (Array.isArray(primaryKey)) {
            return readModelPrimaryKeyValue(primaryKey, (columnName) => this.readColumn(columnName));
        }
        const attributeName = this.getModelClass().getColumnNameToAttributeNameMap()[primaryKey];
        if (attributeName === undefined) {
            throw new Error(`Primary key ${primaryKey} doesn't exist in columns: ${Object.keys(this.getModelClass().getColumnNameToAttributeNameMap()).join(", ")}`);
        }
        return /** @type {number | string} */ (this.readAttribute(attributeName));
    }
    /**
     * Returns the identity represented by the last persisted database attributes.
     * @returns {import("../../utils/model-primary-key.js").ModelPrimaryKeyValue} - Persisted identity.
     */
    _persistedPrimaryKeyValue() {
        const primaryKey = this.getModelClass().primaryKey();
        return readModelPrimaryKeyValue(primaryKey, (columnName) => this._attributes[columnName]);
    }
    /**
     * Runs is persisted.
     * @returns {boolean} - Whether persisted.
     */
    isPersisted() { return !this._isNewRecord; }
    /**
     * Runs is new record.
     * @returns {boolean} - Whether new record.
     */
    isNewRecord() { return this._isNewRecord; }
    /**
     * Runs set is new record.
     * @param {boolean} newIsNewRecord - New is new record.
     * @returns {void} - No return value.
     */
    setIsNewRecord(newIsNewRecord) {
        this._isNewRecord = newIsNewRecord;
    }
    /**
     * Runs reload with id.
     * @template {typeof VelociousDatabaseRecord} MC
     * @param {import("../../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Record identifier.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _reloadWithId(id) {
        const primaryKey = this.getModelClass().primaryKey();
        /**
         * Where object.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const whereObject = {};
        Object.assign(whereObject, modelPrimaryKeyConditions(primaryKey, id));
        const query = /** @type {import("../query/model-class-query.js").default<MC>} */ (this
            .queryForModel(this.getModelClass())
            .where(whereObject));
        const reloadedModel = await query.first();
        if (!reloadedModel)
            throw new Error(`${this.constructor.name}#${id} couldn't be reloaded - record didn't exist`);
        this.loadExistingRecord(reloadedModel.rawAttributes(), reloadedModel._selectedAttributeAliases);
        this._changes = {};
        this._assignedAttributeNames = undefined;
    }
    /**
     * Runs reload.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async reload() {
        const recordId = this._persistedPrimaryKeyValue();
        await this._reloadWithId(recordId);
    }
    async _runValidations() {
        /**
         * Narrows the runtime value to the documented type.
         * @type {Record<string, {type: string, message: string}>} */
        this._validationErrors = {};
        const validators = this.getModelClass()._validators;
        if (validators) {
            for (const attributeName in validators) {
                const attributeValidators = validators[attributeName];
                for (const validator of attributeValidators) {
                    await validator.validate({ model: this, attributeName });
                }
            }
        }
        if (Object.keys(this._validationErrors).length > 0) {
            const validationError = new ValidationError(this.fullErrorMessages().join(". "));
            validationError.setValidationErrors(this._validationErrors);
            validationError.setModel(this);
            validationError.velocious = { type: "validation_error" };
            throw validationError;
        }
    }
    /**
     * Runs full error messages.
     * @returns {string[]} - The full error messages.
     */
    fullErrorMessages() {
        /**
         * Validation error messages.
         * @type {string[]} */
        const validationErrorMessages = [];
        if (this._validationErrors) {
            for (const attributeName in this._validationErrors) {
                for (const validationError of this._validationErrors[attributeName]) {
                    const message = `${this.getModelClass().humanAttributeName(attributeName)} ${validationError.message}`;
                    validationErrorMessages.push(message);
                }
            }
        }
        return validationErrorMessages;
    }
    /**
     * Assigns the attributes to the record and saves it.
     * @param {WriteAttributes} attributesToAssign - The attributes to assign to the record.
     */
    async update(attributesToAssign) {
        if (attributesToAssign)
            this.assign(attributesToAssign);
        await this.save();
    }
}
VelociousDatabaseRecord.registerValidatorType("format", ValidatorsFormat);
VelociousDatabaseRecord.registerValidatorType("length", ValidatorsLength);
VelociousDatabaseRecord.registerValidatorType("presence", ValidatorsPresence);
VelociousDatabaseRecord.registerValidatorType("uniqueness", ValidatorsUniqueness);
export { AdvisoryLockBusyError, AdvisoryLockHoldTimeoutError, AdvisoryLockTimeoutError, TenantDatabaseScopeError, ValidationError };
export default VelociousDatabaseRecord;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7O0dBR0c7QUFFSDs7OztHQUlHO0FBRUg7Ozs7R0FJRztBQUVIOzs7R0FHRztBQUVILDhHQUE4RztBQUU5Rzs7O0dBR0c7QUFFSCxPQUFPLGtCQUFrQixFQUFFLEVBQUMscUJBQXFCLEVBQUUsNEJBQTRCLEVBQUUsd0JBQXdCLEVBQUMsTUFBTSw0QkFBNEIsQ0FBQTtBQUM1SSxPQUFPLDZCQUE2QixNQUFNLHdDQUF3QyxDQUFBO0FBQ2xGLE9BQU8scUJBQXFCLE1BQU0sK0JBQStCLENBQUE7QUFDakUsT0FBTyxhQUFhLE1BQU0sd0JBQXdCLENBQUE7QUFDbEQsT0FBTyxPQUFPLE1BQU0sa0JBQWtCLENBQUE7QUFDdEMsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFDOUMsT0FBTyxPQUFPLE1BQU0sZUFBZSxDQUFBO0FBQ25DLE9BQU8sMkJBQTJCLE1BQU0sc0NBQXNDLENBQUE7QUFDOUUsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUM3RCxPQUFPLDBCQUEwQixNQUFNLHFDQUFxQyxDQUFBO0FBQzVFLE9BQU8sa0JBQWtCLE1BQU0sNEJBQTRCLENBQUE7QUFDM0QsT0FBTyxzQkFBc0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM1RCxPQUFPLEVBQUMsOEJBQThCLEVBQUUsbUNBQW1DLEVBQUMsTUFBTSx3QkFBd0IsQ0FBQTtBQUMxRyxPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUN4QyxPQUFPLGdCQUFnQixNQUFNLG1DQUFtQyxDQUFBO0FBQ2hFLE9BQU8sZUFBZSxNQUFNLCtCQUErQixDQUFBO0FBQzNELE9BQU8sU0FBUyxNQUFNLHVCQUF1QixDQUFBO0FBQzdDLE9BQU8sRUFBQywyQkFBMkIsRUFBRSwwQkFBMEIsRUFBRSxv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QU8sRUFBRSxDQUFBO29CQUV0Ryx1QkFBdUIsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUE7Z0JBQ3ZDLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sdUJBQXVCLENBQUE7SUFDaEMsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxNQUFNLENBQUMsa0JBQWtCO1FBQzdCLElBQUksa0JBQWtCO1lBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBRXZELE1BQU0sSUFBSSxDQUFDLElBQUksRUFBRSxDQUFBO0lBQ25CLENBQUM7Q0FDRjtBQUVELHVCQUF1QixDQUFDLHFCQUFxQixDQUFDLFFBQVEsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFBO0FBQ3pFLHVCQUF1QixDQUFDLHFCQUFxQixDQUFDLFFBQVEsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFBO0FBQ3pFLHVCQUF1QixDQUFDLHFCQUFxQixDQUFDLFVBQVUsRUFBRSxrQkFBa0IsQ0FBQyxDQUFBO0FBQzdFLHVCQUF1QixDQUFDLHFCQUFxQixDQUFDLFlBQVksRUFBRSxvQkFBb0IsQ0FBQyxDQUFBO0FBRWpGLE9BQU8sRUFBQyxxQkFBcUIsRUFBRSw0QkFBNEIsRUFBRSx3QkFBd0IsRUFBRSx3QkFBd0IsRUFBRSxlQUFlLEVBQUMsQ0FBQTtBQUNqSSxlQUFlLHVCQUF1QixDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e3R5cGU6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nfX0gVmFsaWRhdGlvbkVycm9yT2JqZWN0VHlwZVxuICovXG5cbi8qKlxuICogTGlmZWN5Y2xlQ2FsbGJhY2tUeXBlIHR5cGUuXG4gKiBAdGVtcGxhdGUgW1Q9VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRdXG4gKiBAdHlwZWRlZiB7KChtb2RlbDogVCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD4pIHwgc3RyaW5nfSBMaWZlY3ljbGVDYWxsYmFja1R5cGVcbiAqL1xuXG4vKipcbiAqIE1vZGVsIGNsYXNzIGNvbnN0cnVjdG9yIHR5cGUgdXNlZCBmb3Igc3RhdGljIGB0aGlzYCB0eXBpbmcuXG4gKiBAdGVtcGxhdGUgVFxuICogQHR5cGVkZWYge3tuZXcgKGNoYW5nZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IFR9fSBNb2RlbENvbnN0cnVjdG9yXG4gKi9cblxuLyoqXG4gKiBSZXN0cmljdEluc3RhbmNlUmVsYXRpb25zaGlwIHR5cGUuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdCAmIHtxdWVyeTogKCkgPT4gTW9kZWxDbGFzc1F1ZXJ5PHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD59fSBSZXN0cmljdEluc3RhbmNlUmVsYXRpb25zaGlwXG4gKi9cblxuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlfSBUZW5hbnREYXRhYmFzZVByb3ZpZGVyVHlwZSAqL1xuXG4vKipcbiAqIFNjaGVtYSBtZXRhZGF0YSBjYWNoZWQgZm9yIG9uZSByZWNvcmQgY2xhc3MgYW5kIHBoeXNpY2FsIGRhdGFiYXNlIGdlbmVyYXRpb24uXG4gKiBAdHlwZWRlZiB7Ym9vbGVhbiB8IG51bGwgfCBzdHJpbmcgfCB1bmRlZmluZWQgfCBQcm9taXNlPHZvaWQ+IHwgc3RyaW5nW10gfCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHRbXSB8IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0IHwgUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD4gfCBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSBSZWNvcmRNZXRhZGF0YVZhbHVlXG4gKi9cblxuaW1wb3J0IEFkdmlzb3J5TG9ja1J1bm5lciwge0Fkdmlzb3J5TG9ja0J1c3lFcnJvciwgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvciwgQWR2aXNvcnlMb2NrVGltZW91dEVycm9yfSBmcm9tIFwiLi4vYWR2aXNvcnktbG9jay1ydW5uZXIuanNcIlxuaW1wb3J0IEJlbG9uZ3NUb0luc3RhbmNlUmVsYXRpb25zaGlwIGZyb20gXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvYmVsb25ncy10by5qc1wiXG5pbXBvcnQgQmVsb25nc1RvUmVsYXRpb25zaGlwIGZyb20gXCIuL3JlbGF0aW9uc2hpcHMvYmVsb25ncy10by5qc1wiXG5pbXBvcnQgQ29uZmlndXJhdGlvbiBmcm9tIFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiXG5pbXBvcnQgQ3VycmVudCBmcm9tIFwiLi4vLi4vY3VycmVudC5qc1wiXG5pbXBvcnQgRnJvbVRhYmxlIGZyb20gXCIuLi9xdWVyeS9mcm9tLXRhYmxlLmpzXCJcbmltcG9ydCBIYW5kbGVyIGZyb20gXCIuLi9oYW5kbGVyLmpzXCJcbmltcG9ydCBIYXNNYW55SW5zdGFuY2VSZWxhdGlvbnNoaXAgZnJvbSBcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9oYXMtbWFueS5qc1wiXG5pbXBvcnQgSGFzTWFueVJlbGF0aW9uc2hpcCBmcm9tIFwiLi9yZWxhdGlvbnNoaXBzL2hhcy1tYW55LmpzXCJcbmltcG9ydCBIYXNPbmVJbnN0YW5jZVJlbGF0aW9uc2hpcCBmcm9tIFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2hhcy1vbmUuanNcIlxuaW1wb3J0IEhhc09uZVJlbGF0aW9uc2hpcCBmcm9tIFwiLi9yZWxhdGlvbnNoaXBzL2hhcy1vbmUuanNcIlxuaW1wb3J0IFJlY29yZEF0dGFjaG1lbnRIYW5kbGUgZnJvbSBcIi4vYXR0YWNobWVudHMvaGFuZGxlLmpzXCJcbmltcG9ydCB7cmVjb3JkQXR0YWNobWVudHNTdG9yZUZvck1vZGVsLCByZWNvcmRBdHRhY2htZW50c1N0b3JlRm9yTW9kZWxDbGFzc30gZnJvbSBcIi4vYXR0YWNobWVudHMvc3RvcmUuanNcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgZGVidXJyQ29sdW1uTmFtZSBmcm9tIFwiLi4vLi4vdXRpbHMvZGVidXJyLWNvbHVtbi1uYW1lLmpzXCJcbmltcG9ydCBNb2RlbENsYXNzUXVlcnkgZnJvbSBcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCJcbmltcG9ydCBQcmVsb2FkZXIgZnJvbSBcIi4uL3F1ZXJ5L3ByZWxvYWRlci5qc1wiXG5pbXBvcnQge3JlYWRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCwgcmVhZFBheWxvYWRDb21wdXRlZEFiaWxpdHksIHJlYWRQYXlsb2FkUXVlcnlEYXRhLCBzZXRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCwgc2V0UGF5bG9hZENvbXB1dGVkQWJpbGl0eSwgc2V0UGF5bG9hZFF1ZXJ5RGF0YX0gZnJvbSBcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiXG5pbXBvcnQgcmVjb3JkQ2hhbmdlcyBmcm9tIFwiLi4vcmVjb3JkLWNoYW5nZXMuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uLy4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQgc2luZ3VsYXJpemVNb2RlbE5hbWUgZnJvbSBcIi4uLy4uL3V0aWxzL3Npbmd1bGFyaXplLW1vZGVsLW5hbWUuanNcIlxuaW1wb3J0IHtkZWZpbmVNb2RlbFNjb3BlfSBmcm9tIFwiLi4vLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIlxuaW1wb3J0IHsgbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlLCBub3JtYWxpemVEYXRlVmFsdWVGb3JSZWFkLCBub3JtYWxpemVEYXRlVmFsdWVGb3JXcml0ZSB9IGZyb20gXCIuLi9kYXRldGltZS1zdG9yYWdlLmpzXCJcbmltcG9ydCB7Zm9ybWF0VmFsdWV9IGZyb20gXCIuLi8uLi91dGlscy9mb3JtYXQtdmFsdWUuanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDYWNoZUtleSwgbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucywgcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlLCBzY2FsYXJNb2RlbFByaW1hcnlLZXksIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuaW1wb3J0IHtjYXB0dXJlQ3JlYXRlQXVkaXRDaGFuZ2VzLCBjYXB0dXJlVXBkYXRlQXVkaXRDaGFuZ2VzLCBjcmVhdGVBdWRpdCwgY3JlYXRlQ3JlYXRlQXVkaXQsIGNyZWF0ZURlc3Ryb3lBdWRpdCwgY3JlYXRlVXBkYXRlQXVkaXQsIGluaXRpYWxpemVBdWRpdGluZywgcmVnaXN0ZXJBdWRpdENhbGxiYWNrLCByZWdpc3RlckF1ZGl0aW5nLCB3aXRob3V0QXVkaXR9IGZyb20gXCIuL2F1ZGl0aW5nLmpzXCJcbmltcG9ydCB7cmVnaXN0ZXJNYWduaXR1ZGVDb3VudGVyQ2FjaGV9IGZyb20gXCIuL2NvdW50ZXItY2FjaGUtbWFnbml0dWRlLmpzXCJcbmltcG9ydCB7cHJlcGFyZUNvdW50ZXJDYWNoZVBhcmVudFVwZGF0ZSwgc2NoZWR1bGVDb3VudGVyQ2FjaGVQYXJlbnRVcGRhdGV9IGZyb20gXCIuL2NvdW50ZXItY2FjaGUtcGFyZW50LXVwZGF0ZXMuanNcIlxuaW1wb3J0IHtzdGF0ZU1hY2hpbmV9IGZyb20gXCIuL3N0YXRlLW1hY2hpbmUuanNcIlxuaW1wb3J0IFZhbGlkYXRvcnNGb3JtYXQgZnJvbSBcIi4vdmFsaWRhdG9ycy9mb3JtYXQuanNcIlxuaW1wb3J0IFZhbGlkYXRvcnNMZW5ndGggZnJvbSBcIi4vdmFsaWRhdG9ycy9sZW5ndGguanNcIlxuaW1wb3J0IFZhbGlkYXRvcnNQcmVzZW5jZSBmcm9tIFwiLi92YWxpZGF0b3JzL3ByZXNlbmNlLmpzXCJcbmltcG9ydCBWYWxpZGF0b3JzVW5pcXVlbmVzcyBmcm9tIFwiLi92YWxpZGF0b3JzL3VuaXF1ZW5lc3MuanNcIlxuaW1wb3J0IHJlZ2lzdGVyQWN0c0FzTGlzdENhbGxiYWNrcyBmcm9tIFwiLi9hY3RzLWFzLWxpc3QuanNcIlxuaW1wb3J0IFRlbmFudE1vZGVsU2NvcGUgZnJvbSBcIi4uLy4uL3RlbmFudHMvdGVuYW50LW1vZGVsLXNjb3BlLmpzXCJcbmltcG9ydCBVVUlEIGZyb20gXCJwdXJlLXV1aWRcIlxuXG4vKipcbiAqIFRyYW5zbGF0aW9uIHJlY29yZCBzaGFwZSB1c2VkIGJ5IHRyYW5zbGF0ZWQgYXR0cmlidXRlcy5cbiAqIEB0eXBlZGVmIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCAmIHtsb2NhbGU6ICgpID0+IHN0cmluZ319IFRyYW5zbGF0aW9uQmFzZVxuICovXG4vKipcbiAqIEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yfSBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3JcbiAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkF0dGFjaG1lbnRTeW5jQ29uZmlndXJhdGlvbn0gQXR0YWNobWVudFN5bmNDb25maWd1cmF0aW9uICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuUmVjb3JkQXR0YWNobWVudENvbmZpZ3VyYXRpb259IFJlY29yZEF0dGFjaG1lbnRDb25maWd1cmF0aW9uICovXG5cbi8qKiBTdG9yZWQgdmFsdWVzIHRoYXQgYSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGNhc3QgcmVhZHMgYmFjayBhcyBgdHJ1ZWAuICovXG5jb25zdCBkZWNsYXJlZEJvb2xlYW5UcnV0aHlWYWx1ZXMgPSBuZXcgU2V0KFsxLCB0cnVlLCBcIjFcIl0pXG5cbi8qKiBTdG9yZWQgdmFsdWVzIHRoYXQgYSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGNhc3QgcmVhZHMgYmFjayBhcyBgZmFsc2VgLiAqL1xuY29uc3QgZGVjbGFyZWRCb29sZWFuRmFsc3lWYWx1ZXMgPSBuZXcgU2V0KFswLCBmYWxzZSwgXCIwXCJdKVxuXG4vKiogU3RhdGljIHJlY29yZCBtZXRhZGF0YSBmaWVsZHMgaXNvbGF0ZWQgcGVyIHBoeXNpY2FsIGRhdGFiYXNlL3NjaGVtYSBnZW5lcmF0aW9uLiAqL1xuY29uc3QgcmVjb3JkTWV0YWRhdGFQcm9wZXJ0eU5hbWVzID0gbmV3IFNldChbXG4gIFwiX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVcIixcbiAgXCJfY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVwiLFxuICBcIl9jb2x1bW5OYW1lc1wiLFxuICBcIl9jb2x1bW5zXCIsXG4gIFwiX2NvbHVtbnNBc0hhc2hcIixcbiAgXCJfY29sdW1uVHlwZUJ5TmFtZVwiLFxuICBcIl9kYXRhYmFzZVR5cGVcIixcbiAgXCJfaW5pdGlhbGl6ZWRcIixcbiAgXCJfaW5pdGlhbGl6ZVJlY29yZFByb21pc2VcIixcbiAgXCJfdGFibGVcIlxuXSlcblxuLyoqIEB0eXBlIHtXZWFrTWFwPHR5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIFJlY29yZE1ldGFkYXRhVmFsdWU+Pj59ICovXG5jb25zdCByZWNvcmRNZXRhZGF0YVZhbHVlc0J5TW9kZWwgPSBuZXcgV2Vha01hcCgpXG5cbi8qKlxuICogUmV0dXJucyB0aGUgZ2VuZXJhdGlvbi1rZXllZCBtZXRhZGF0YSBzdG9yZSBvd25lZCBieSBvbmUgY2Fub25pY2FsIG1vZGVsLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gQ2Fub25pY2FsIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge01hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIFJlY29yZE1ldGFkYXRhVmFsdWU+Pn0gLSBNZXRhZGF0YSBzdG9yZS5cbiAqL1xuZnVuY3Rpb24gcmVjb3JkTWV0YWRhdGFWYWx1ZXNGb3IobW9kZWxDbGFzcykge1xuICBsZXQgdmFsdWVzID0gcmVjb3JkTWV0YWRhdGFWYWx1ZXNCeU1vZGVsLmdldChtb2RlbENsYXNzKVxuXG4gIGlmICghdmFsdWVzKSB7XG4gICAgdmFsdWVzID0gbmV3IE1hcCgpXG4gICAgcmVjb3JkTWV0YWRhdGFWYWx1ZXNCeU1vZGVsLnNldChtb2RlbENsYXNzLCB2YWx1ZXMpXG4gIH1cblxuICByZXR1cm4gdmFsdWVzXG59XG5cbmNsYXNzIFZhbGlkYXRpb25FcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gLSBWZWxvY2lvdXMgbWV0YWRhdGEgZm9yIGZyb250ZW5kLW1vZGVsIGVycm9yIHJlcG9ydGluZy5cbiAgICovXG4gIHZlbG9jaW91c1xuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbC5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAtIFRoZSBtb2RlbC5cbiAgICovXG4gIGdldE1vZGVsKCkge1xuICAgIGlmICghdGhpcy5fbW9kZWwpIHRocm93IG5ldyBFcnJvcihcIk1vZGVsIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX21vZGVsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbW9kZWwuXG4gICAqIEBwYXJhbSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldE1vZGVsKG1vZGVsKSB7XG4gICAgdGhpcy5fbW9kZWwgPSBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHZhbGlkYXRpb24gZXJyb3JzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgVmFsaWRhdGlvbkVycm9yT2JqZWN0VHlwZVtdPn0gLSBUaGUgdmFsaWRhdGlvbiBlcnJvcnMuXG4gICAqL1xuICBnZXRWYWxpZGF0aW9uRXJyb3JzKCkge1xuICAgIGlmICghdGhpcy5fdmFsaWRhdGlvbkVycm9ycykgdGhyb3cgbmV3IEVycm9yKFwiVmFsaWRhdGlvbiBlcnJvcnMgaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGlvbkVycm9yc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHZhbGlkYXRpb24gZXJyb3JzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFZhbGlkYXRpb25FcnJvck9iamVjdFR5cGVbXT59IHZhbGlkYXRpb25FcnJvcnMgLSBWYWxpZGF0aW9uIGVycm9ycyB0byBhc3NpZ24uXG4gICAqL1xuICBzZXRWYWxpZGF0aW9uRXJyb3JzKHZhbGlkYXRpb25FcnJvcnMpIHtcbiAgICB0aGlzLl92YWxpZGF0aW9uRXJyb3JzID0gdmFsaWRhdGlvbkVycm9yc1xuICB9XG59XG5cbi8qKlxuICogUnVucyBhcHBseSBidWlsdCByZWNvcmQgaW52ZXJzZSByZWxhdGlvbnNoaXAuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBhcmdzLnBhcmVudCAtIFBhcmVudCByZWNvcmQgYmVpbmcgYnVpbHQgZnJvbS5cbiAqIEBwYXJhbSB7e2dldFJlbGF0aW9uc2hpcEJ5TmFtZTogVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXCJnZXRSZWxhdGlvbnNoaXBCeU5hbWVcIl19fSBhcmdzLnJlY29yZCAtIE5ld2x5IGJ1aWx0IHJlbGF0ZWQgcmVjb3JkLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsfSBhcmdzLmludmVyc2VPZiAtIEludmVyc2UgcmVsYXRpb25zaGlwIG5hbWUuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuYWxsb3dIYXNNYW55IC0gV2hldGhlciBhIGhhcy1tYW55IGludmVyc2Ugc2hvdWxkIGJlIGFwcGVuZGVkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFwcGx5QnVpbHRSZWNvcmRJbnZlcnNlUmVsYXRpb25zaGlwKHthbGxvd0hhc01hbnksIGludmVyc2VPZiwgcGFyZW50LCByZWNvcmR9KSB7XG4gIGlmICghaW52ZXJzZU9mKSByZXR1cm5cblxuICBjb25zdCBpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAgPSByZWNvcmQuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKGludmVyc2VPZilcblxuICBpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0QXV0b1NhdmUoZmFsc2UpXG5cbiAgaWYgKCFhbGxvd0hhc01hbnkgfHwgaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc09uZVwiKSB7XG4gICAgaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLnNldExvYWRlZChwYXJlbnQpXG4gICAgcmV0dXJuXG4gIH1cblxuICBpZiAoaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc01hbnlcIikge1xuICAgIGludmVyc2VJbnN0YW5jZVJlbGF0aW9uc2hpcC5hZGRUb0xvYWRlZChwYXJlbnQpXG4gICAgcmV0dXJuXG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVsYXRpb25zaGlwIHR5cGU6ICR7aW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKX1gKVxufVxuXG4vKipcbiAqIEJ1aWxkIGEgcmVsYXRlZCByZWNvcmQgYW5kIHdpcmUgaXRzIGludmVyc2UgcmVsYXRpb25zaGlwIHRvIHRoZSBwYXJlbnQuXG4gKiBAcGFyYW0ge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBwYXJlbnQgLSBQYXJlbnQgcmVjb3JkIGJ1aWxkaW5nIHRoZSByZWxhdGlvbnNoaXAuXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lIGJlaW5nIGJ1aWx0LlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzIGZvciB0aGUgbmV3IHJlbGF0ZWQgcmVjb3JkLlxuICogQHBhcmFtIHtib29sZWFufSBhbGxvd0hhc01hbnkgLSBXaGV0aGVyIGhhcy1tYW55IGludmVyc2UgcmVsYXRpb25zaGlwcyBzaG91bGQgYXBwZW5kIHRoZSBwYXJlbnQuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEJ1aWx0IHJlbGF0ZWQgcmVjb3JkLlxuICovXG5mdW5jdGlvbiBidWlsZFJlbGF0ZWRSZWNvcmRXaXRoSW52ZXJzZShwYXJlbnQsIHJlbGF0aW9uc2hpcE5hbWUsIGF0dHJpYnV0ZXMsIGFsbG93SGFzTWFueSkge1xuICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHBhcmVudC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgY29uc3QgcmVjb3JkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuYnVpbGQoYXR0cmlidXRlcylcbiAgY29uc3QgaW52ZXJzZU9mID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0SW52ZXJzZU9mKClcblxuICBhcHBseUJ1aWx0UmVjb3JkSW52ZXJzZVJlbGF0aW9uc2hpcCh7XG4gICAgYWxsb3dIYXNNYW55LFxuICAgIGludmVyc2VPZixcbiAgICBwYXJlbnQsXG4gICAgcmVjb3JkOiAvKiogQHR5cGUge3tnZXRSZWxhdGlvbnNoaXBCeU5hbWU6IFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkW1wiZ2V0UmVsYXRpb25zaGlwQnlOYW1lXCJdfX0gKi8gKHJlY29yZClcbiAgfSlcblxuICByZXR1cm4gcmVjb3JkXG59XG5cbmNsYXNzIFRlbmFudERhdGFiYXNlU2NvcGVFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7bW9kZWxOYW1lOiBzdHJpbmd9fSBhcmdzIC0gQ29udGV4dCBmb3IgdGhlIGZhaWxlZCB0ZW5hbnQtc2NvcGVkIG1vZGVsLlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSwge21vZGVsTmFtZX0pIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9IFwiVGVuYW50RGF0YWJhc2VTY29wZUVycm9yXCJcbiAgICB0aGlzLm1vZGVsTmFtZSA9IG1vZGVsTmFtZVxuICB9XG59XG5cbi8qKlxuICogQmFzZSBkYXRhYmFzZSByZWNvcmQuXG4gKiBAdGVtcGxhdGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW1dyaXRlQXR0cmlidXRlcz1SZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5dXG4gKi9cbmNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBvYmplY3Q+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX3RyYW5zbGF0aW9ucyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vdmFsaWRhdG9ycy9iYXNlLmpzXCIpLmRlZmF1bHRbXT4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfdmFsaWRhdG9ycyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIExpZmVjeWNsZUNhbGxiYWNrVHlwZVtdPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9saWZlY3ljbGVDYWxsYmFja3MgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB0eXBlb2YgaW1wb3J0KFwiLi92YWxpZGF0b3JzL2Jhc2UuanNcIikuZGVmYXVsdD4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfdmFsaWRhdG9yVHlwZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZWNvcmRBdHRhY2htZW50Q29uZmlndXJhdGlvbj4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfYXR0YWNobWVudHNNYXAgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0PiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9yZWxhdGlvbnNoaXBzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vcXVlcnkvcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFGbj4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfcXVlcnlEYXRhUmVnaXN0cmF0aW9ucyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHthbGxvd0Rlc3Ryb3k/OiBib29sZWFuLCBsaW1pdD86IG51bWJlciwgcmVqZWN0SWY/OiAoYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBib29sZWFufT4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9hdHRyaWJ1dGVDYXN0cyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfY29sdW1uc0FzSGFzaCA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge0FycmF5PHN0cmluZz4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfY29sdW1uTmFtZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2NvbHVtblR5cGVCeU5hbWUgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgbW9kZWxOYW1lXG5cbiAgLyoqXG4gICAqIE9wdC1pbiBjbGllbnQgc3luYyBkZWNsYXJhdGlvbiBjb25zdW1lZCBieSBgU3luY0NsaWVudC5mcm9tQ29uZmlndXJhdGlvbiguLi4pYC5cbiAgICogRGVjbGFyZSBgc3RhdGljIHN5bmMgPSB0cnVlYCAoYWxsIGRlZmF1bHRzKSBvciBhIGRlY2xhcmF0aW9uIG9iamVjdCBsaWtlXG4gICAqIGBzdGF0aWMgc3luYyA9IHt0cmFjazogW1wiY3JlYXRlXCIsIFwidXBkYXRlXCJdLCBzeW5jVHlwZTogXCJ1cHNlcnRcIn1gIHRvIGhhdmUgdGhlXG4gICAqIHN5bmMgY2xpZW50IGF1dG8tZGlzY292ZXIgdGhpcyBtb2RlbCBhbmQgZGVyaXZlIGl0cyByZXNvdXJjZSBjb25maWcgZnJvbVxuICAgKiBjb2x1bW4gbWV0YWRhdGEuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9zeW5jL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLk1vZGVsU3luY0RlY2xhcmF0aW9uIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgc3luY1xuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbCB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9pbml0aWFsaXplUmVjb3JkUHJvbWlzZVxuXG4gIC8qKiBAdHlwZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHwgdW5kZWZpbmVkfSBDYW5vbmljYWwgbW9kZWwgY2xhc3MgZXhwb3NlZCBvbmx5IGJ5IGFuIG9wZXJhdGlvbi1ib3VuZCBtZXRhZGF0YSBwcm94eS4gKi9cbiAgc3RhdGljIF9yZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3NcblxuICAvKiogQHR5cGUgeygobW9kZWxDbGFzczogdHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSA9PiB0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQpIHwgdW5kZWZpbmVkfSBCaW5kcyByZWxhdGVkIGdlbmVyYXRlZCBtb2RlbCBjbGFzc2VzIHRvIHRoZSBzYW1lIG9wZXJhdGlvbiBtZXRhZGF0YSBnZW5lcmF0aW9uLiAqL1xuICBzdGF0aWMgX3JlY29yZE1ldGFkYXRhQmluZGVyXG5cbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gT3BlcmF0aW9uIGV4cG9zZWQgb25seSBieSBhIGNvbnN0cnVjdGluZyBtZXRhZGF0YSBwcm94eS4gKi9cbiAgc3RhdGljIF9yZWNvcmRNZXRhZGF0YU9wZXJhdGlvblxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtib29sZWFuIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2VhZ2VyTG9hZFJlY29yZE1ldGFkYXRhXG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vYXVkaXRpbmcuanNcIikuQXVkaXRDYWxsYmFja1tdPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9hdWRpdENhbGxiYWNrc1xuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtib29sZWFuIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2F1ZGl0TGlmZWN5Y2xlQ2FsbGJhY2tzUmVnaXN0ZXJlZFxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBtb2RlbCBuYW1lLCBwcmVmZXJyaW5nIGFuIGV4cGxpY2l0IGBzdGF0aWMgbW9kZWxOYW1lYCBkZWNsYXJhdGlvblxuICAgKiBvdmVyIHRoZSBKYXZhU2NyaXB0IGNsYXNzIGAubmFtZWAgcHJvcGVydHkuIFRoaXMgYWxsb3dzIG1pbmlmaWVkIGJ1aWxkcyB0b1xuICAgKiBwcmVzZXJ2ZSBjb3JyZWN0IG1vZGVsIG5hbWVzIHdpdGhvdXQgcmVseWluZyBvbiBga2VlcF9jbGFzc25hbWVzYC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgbW9kZWwgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRNb2RlbE5hbWUoKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLm1vZGVsTmFtZSA9PT0gXCJzdHJpbmdcIiAmJiB0aGlzLm1vZGVsTmFtZS5sZW5ndGggPiAwKSByZXR1cm4gdGhpcy5tb2RlbE5hbWVcblxuICAgIHJldHVybiB0aGlzLm5hbWVcbiAgfVxuXG4gIHN0YXRpYyBnZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKCkge1xuICAgIGlmICghdGhpcy5fYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZSkge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICAgIHRoaXMuX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGRhdGFiYXNlIGNvbHVtbiBuYW1lIGZvciBhIHJlY29yZCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZSB0byByZXNvbHZlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE1hcHBlZCBjb2x1bW4gbmFtZSwgb3IgdGhlIHVuZGVyc2NvcmVkIGF0dHJpYnV0ZSBuYW1lIHdoZW4gbm8gbWFwcGluZyBleGlzdHMuXG4gICAqL1xuICBzdGF0aWMgZ2V0Q29sdW1uTmFtZUZvckF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSkge1xuICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IHRoaXMucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSlcblxuICAgIGlmIChyZXNvbHZlZEF0dHJpYnV0ZU5hbWUpIHJldHVybiB0aGlzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVtyZXNvbHZlZEF0dHJpYnV0ZU5hbWVdXG5cbiAgICByZXR1cm4gaW5mbGVjdGlvbi51bmRlcnNjb3JlKGluZmxlY3Rpb24uY2FtZWxpemUoZGVidXJyQ29sdW1uTmFtZShhdHRyaWJ1dGVOYW1lKSwgdHJ1ZSkpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW4gaW5jb21pbmcgYXR0cmlidXRlIG9yIGNvbHVtbiBuYW1lIHRvIHRoZSBjYW5vbmljYWwgYXR0cmlidXRlIG5hbWUgdGhpcyBtb2RlbCBleHBvc2VzLlxuICAgKiBBY2NlcHRzIHRoZSBjYW5vbmljYWwgKGRlYnVycmVkKSBhdHRyaWJ1dGUgbmFtZSwgYSByYXcgdW1sYXV0L2Fjcm9ueW0gY29sdW1uIG5hbWUsIGEgcHJlLWRlYnVyclxuICAgKiBjYW1lbGl6YXRpb24sIGFuZCBjYW1lbENhc2UgY2FzaW5nIHZhcmlhbnRzIChlLmcuIFwidkFGdW5rdGlvbklEXCIgdnMgXCJ2QUZ1bmt0aW9uaWRcIikuIFJldHVybnMgbnVsbFxuICAgKiB3aGVuIG5vdGhpbmcgbWF0Y2hlcywgc28gY2FsbGVycyBrZWVwIHRoZWlyIG93biBub3QtZm91bmQgaGFuZGxpbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQXR0cmlidXRlIG5hbWUgb3IgY29sdW1uIG5hbWUgdG8gcmVzb2x2ZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gQ2Fub25pY2FsIGF0dHJpYnV0ZSBuYW1lLCBvciBudWxsLlxuICAgKi9cbiAgc3RhdGljIHJlc29sdmVBdHRyaWJ1dGVOYW1lKG5hbWUpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwID0gdGhpcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClcblxuICAgIGlmIChuYW1lIGluIGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXApIHJldHVybiBuYW1lXG5cbiAgICBjb25zdCBub3JtYWxpemVkQXR0cmlidXRlTmFtZSA9IGluZmxlY3Rpb24uY2FtZWxpemUoZGVidXJyQ29sdW1uTmFtZShuYW1lKSwgdHJ1ZSlcblxuICAgIGlmIChub3JtYWxpemVkQXR0cmlidXRlTmFtZSBpbiBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKSByZXR1cm4gbm9ybWFsaXplZEF0dHJpYnV0ZU5hbWVcblxuICAgIGNvbnN0IGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAgPSB0aGlzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVxuXG4gICAgaWYgKG5hbWUgaW4gY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCkgcmV0dXJuIGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXBbbmFtZV1cblxuICAgIC8vIEZpbmFsIGZhbGxiYWNrOiBtYXRjaCBjYW1lbENhc2UgY2FzaW5nIHZhcmlhbnRzIGFnYWluc3QgdGhlIG1vZGVsJ3MgZ2VuZXJhdGVkIGFjY2Vzc29ycy4gVGhlc2VcbiAgICAvLyBleGlzdCBvbiB0aGUgcHJvdG90eXBlIGJlZm9yZSBydW50aW1lIGluaXRpYWxpemF0aW9uICh1bmxpa2UgdGhlIGF0dHJpYnV0ZSBtYXApLCBzbyB0aGlzIGFsc29cbiAgICAvLyByZXNvbHZlcyBuYW1lcyBsb29rZWQgdXAgZHVyaW5nIGNyZWF0ZSwgYmVmb3JlIHRoZSBtYXAgaXMgYnVpbHQuIGluZmxlY3Rpb24gbG93ZXItY2FzZXMgdHJhaWxpbmdcbiAgICAvLyBhY3JvbnltcyAoXCJJRFwiIC0+IFwiaWRcIiksIHNvIFwidkFGdW5rdGlvbklEXCIvXCJWQV9GdW5rdGlvbklEXCIgc3RpbGwgcmVzb2x2ZSB0byBcInZBRnVua3Rpb25pZFwiLlxuICAgIGNvbnN0IGxvd2VyTm9ybWFsaXplZEF0dHJpYnV0ZU5hbWUgPSBub3JtYWxpemVkQXR0cmlidXRlTmFtZS50b0xvd2VyQ2FzZSgpXG4gICAgbGV0IHByb3RvdHlwZSA9IHRoaXMucHJvdG90eXBlXG5cbiAgICB3aGlsZSAocHJvdG90eXBlICYmIHByb3RvdHlwZSAhPT0gT2JqZWN0LnByb3RvdHlwZSkge1xuICAgICAgZm9yIChjb25zdCBhY2Nlc3Nvck5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMocHJvdG90eXBlKSkge1xuICAgICAgICBpZiAoYWNjZXNzb3JOYW1lLnRvTG93ZXJDYXNlKCkgPT09IGxvd2VyTm9ybWFsaXplZEF0dHJpYnV0ZU5hbWUpIHJldHVybiBhY2Nlc3Nvck5hbWVcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHByb3RvdHlwZSlcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBtZW1iZXIgbmFtZSBvbiBhIHRhcmdldCdzIHByb3RvdHlwZSBjaGFpbiBtYXRjaGluZyBgbWVtYmVyTmFtZWAsIGZhbGxpbmcgYmFjayB0byBhXG4gICAqIGNhc2UtaW5zZW5zaXRpdmUgbWF0Y2guIFJlc29sdmVzIHNldHRlcnMgd2hlbiBhIHJlYWQtb25seSBhdHRyaWJ1dGUgYWxpYXMgZGlmZmVycyBvbmx5IGluIGNhbWVsQ2FzZVxuICAgKiBjYXNpbmcgZnJvbSB0aGUgZ2VuZXJhdGVkIGFjY2Vzc29yIChlLmcuIGEgXCJ2QUZ1bmt0aW9uSURcIiBhbGlhcyB3aG9zZSBzZXR0ZXIgaXMgXCJzZXRWQUZ1bmt0aW9uaWRcIikuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSB0YXJnZXQgLSBJbnN0YW5jZSBvciBwcm90b3R5cGUgdG8gc2VhcmNoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVtYmVyTmFtZSAtIE1lbWJlciBuYW1lIHRvIGZpbmQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIE1hdGNoaW5nIG1lbWJlciBuYW1lLCBvciBudWxsIHdoZW4gYWJzZW50LlxuICAgKi9cbiAgc3RhdGljIGZpbmRNZW1iZXJOYW1lSW5zZW5zaXRpdmUodGFyZ2V0LCBtZW1iZXJOYW1lKSB7XG4gICAgaWYgKG1lbWJlck5hbWUgaW4gdGFyZ2V0KSByZXR1cm4gbWVtYmVyTmFtZVxuXG4gICAgY29uc3QgbG93ZXJNZW1iZXJOYW1lID0gbWVtYmVyTmFtZS50b0xvd2VyQ2FzZSgpXG4gICAgbGV0IGN1cnJlbnQgPSB0YXJnZXRcblxuICAgIHdoaWxlIChjdXJyZW50ICYmIGN1cnJlbnQgIT09IE9iamVjdC5wcm90b3R5cGUpIHtcbiAgICAgIGZvciAoY29uc3QgY2FuZGlkYXRlTmFtZSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhjdXJyZW50KSkge1xuICAgICAgICBpZiAoY2FuZGlkYXRlTmFtZS50b0xvd2VyQ2FzZSgpID09PSBsb3dlck1lbWJlck5hbWUpIHJldHVybiBjYW5kaWRhdGVOYW1lXG4gICAgICB9XG5cbiAgICAgIGN1cnJlbnQgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YoY3VycmVudClcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmaW5lIHNjb3BlLlxuICAgKiBAcGFyYW0geyguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjYWxsYmFjayAtIFNjb3BlIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7KCguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPikgJiB7c2NvcGU6ICguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCIpLk1vZGVsU2NvcGVEZXNjcmlwdG9yfX0gLSBTY29wZSBoZWxwZXIuXG4gICAqL1xuICBzdGF0aWMgZGVmaW5lU2NvcGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gZGVmaW5lTW9kZWxTY29wZSh7XG4gICAgICBjYWxsYmFjayxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICBzdGFydFF1ZXJ5OiAobW9kZWxDbGFzcyA9IHRoaXMpID0+IHtcbiAgICAgICAgLy8gVGhpcyBiYWNrZW5kIHNjb3BlIGZhY3RvcnkgY2FuIG9ubHkgYmUgaW52b2tlZCB0aHJvdWdoIGEgRGF0YWJhc2VSZWNvcmQgY2xhc3MuXG4gICAgICAgIGNvbnN0IEJhY2tlbmRNb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9ICovIChtb2RlbENsYXNzKVxuXG4gICAgICAgIHJldHVybiBCYWNrZW5kTW9kZWxDbGFzcy5fbmV3UXVlcnkoKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXBwbGljYXRpb24gbW9kZWwgY2xhc3MgYmVoaW5kIGFuIG9wZXJhdGlvbi1ib3VuZCBtZXRhZGF0YSB2aWV3LlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAtIENhbm9uaWNhbCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIHN0YXRpYyBjYW5vbmljYWxSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JlY29yZE1ldGFkYXRhTW9kZWxDbGFzcyB8fCB0aGlzXG4gIH1cblxuICAvKipcbiAgICogQmluZHMgYSByZWxhdGlvbnNoaXAgdGFyZ2V0IHRvIHRoaXMgbW9kZWwgY2xhc3MncyBtZXRhZGF0YSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gbW9kZWxDbGFzcyAtIFJlbGF0aW9uc2hpcCB0YXJnZXQuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IC0gR2VuZXJhdGlvbi1ib3VuZCB0YXJnZXQsIG9yIHRoZSB1bmNoYW5nZWQgdGFyZ2V0IGZvciBsZWdhY3kgcXVlcmllcy5cbiAgICovXG4gIHN0YXRpYyBiaW5kUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICByZXR1cm4gdGhpcy5fcmVjb3JkTWV0YWRhdGFCaW5kZXIgPyB0aGlzLl9yZWNvcmRNZXRhZGF0YUJpbmRlcihtb2RlbENsYXNzKSA6IG1vZGVsQ2xhc3NcbiAgfVxuXG4gIHN0YXRpYyBnZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKCkge1xuICAgIGlmICghdGhpcy5fY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSkge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICAgIHRoaXMuX2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9jb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lXG4gIH1cblxuICBzdGF0aWMgZ2V0VHJhbnNsYXRpb25zTWFwKCkge1xuICAgIGlmICghdGhpcy5fdHJhbnNsYXRpb25zKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBvYmplY3Q+fSAqL1xuICAgICAgdGhpcy5fdHJhbnNsYXRpb25zID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fdHJhbnNsYXRpb25zXG4gIH1cblxuICBzdGF0aWMgZ2V0VmFsaWRhdG9yc01hcCgpIHtcbiAgICBpZiAoIXRoaXMuX3ZhbGlkYXRvcnMpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vdmFsaWRhdG9ycy9iYXNlLmpzXCIpLmRlZmF1bHRbXT59ICovXG4gICAgICB0aGlzLl92YWxpZGF0b3JzID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdG9yc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxpZmVjeWNsZSBjYWxsYmFja3MgbWFwLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgTGlmZWN5Y2xlQ2FsbGJhY2tUeXBlW10+fSAtIExpZmVjeWNsZSBjYWxsYmFja3Mga2V5ZWQgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRMaWZlY3ljbGVDYWxsYmFja3NNYXAoKSB7XG4gICAgaWYgKCF0aGlzLl9saWZlY3ljbGVDYWxsYmFja3MpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIExpZmVjeWNsZUNhbGxiYWNrVHlwZVtdPn0gKi9cbiAgICAgIHRoaXMuX2xpZmVjeWNsZUNhbGxiYWNrcyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2xpZmVjeWNsZUNhbGxiYWNrc1xuICB9XG5cbiAgc3RhdGljIGdldFZhbGlkYXRvclR5cGVzTWFwKCkge1xuICAgIGlmICghdGhpcy5fdmFsaWRhdG9yVHlwZXMpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuL3ZhbGlkYXRvcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICAgIHRoaXMuX3ZhbGlkYXRvclR5cGVzID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdG9yVHlwZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50cyBtYXAuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZWNvcmRBdHRhY2htZW50Q29uZmlndXJhdGlvbj59IC0gQXR0YWNobWVudCBkZWZpbml0aW9ucyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dGFjaG1lbnRzTWFwKCkge1xuICAgIGlmICghdGhpcy5fYXR0YWNobWVudHNNYXApIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJlY29yZEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPn0gKi9cbiAgICAgIHRoaXMuX2F0dGFjaG1lbnRzTWFwID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0YWNobWVudHNNYXBcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRyaWJ1dGVzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBfYXR0cmlidXRlcyA9IHt9XG5cbiAgLyoqXG4gICAqIFVubWFwcGVkIHJlc3VsdCBhbGlhc2VzIGV4cGxpY2l0bHkgc2VsZWN0ZWQgYnkgdGhlIHF1ZXJ5IHRoYXQgaHlkcmF0ZWQgdGhpcyByZWNvcmQuXG4gICAqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgX3NlbGVjdGVkQXR0cmlidXRlQWxpYXNlcyA9IG5ldyBTZXQoKVxuXG4gIC8qKlxuICAgKiBDaGFuZ2VzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBfY2hhbmdlcyA9IHt9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgcHJpbWFyeS1rZXkgcmVhZHMgYXJlIHBpbm5lZCB0byB0aGUgc3RvcmVkIGF0dHJpYnV0ZXMuXG4gICAqIEB0eXBlIHtib29sZWFufSAqL1xuICBfcmVhZHNQZXJzaXN0ZWRQcmltYXJ5S2V5ID0gZmFsc2VcblxuICAvKipcbiAgICogQ2hhbmdlcyBjYXB0dXJlZCBiZWZvcmUgYSBjcmVhdGUgYXVkaXQgaXMgd3JpdHRlbi5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vYXVkaXRpbmcuanNcIikuQXVkaXRDaGFuZ2VzIHwgdW5kZWZpbmVkfSAqL1xuICBfcGVuZGluZ0NyZWF0ZUF1ZGl0Q2hhbmdlcyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBDaGFuZ2VzIGNhcHR1cmVkIGJlZm9yZSBhbiB1cGRhdGUgYXVkaXQgaXMgd3JpdHRlbi5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vYXVkaXRpbmcuanNcIikuQXVkaXRDaGFuZ2VzIHwgdW5kZWZpbmVkfSAqL1xuICBfcGVuZGluZ1VwZGF0ZUF1ZGl0Q2hhbmdlcyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBBdHRyaWJ1dGUgbmFtZXMgZXhwbGljaXRseSBhc3NpZ25lZCBpbiB0aGUgY3VycmVudCB1cGRhdGUgY2FsbC5cbiAgICogQHR5cGUge1NldDxzdHJpbmc+IHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgX2Fzc2lnbmVkQXR0cmlidXRlTmFtZXMgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogQ29sdW1ucyBhcyBoYXNoLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgX2NvbHVtbnNBc0hhc2ggPSB7fVxuXG4gIC8qKlxuICAgKiBDb25uZWN0aW9uLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gIF9fY29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBFeHBsaWNpdCBvcGVyYXRpb24gb3duaW5nIHRoaXMgcmVjb3JkJ3MgZGF0YWJhc2Ugd29yay5cbiAgICogQHR5cGUge2ltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICBfZGF0YWJhc2VPcGVyYXRpb24gPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogSW5zdGFuY2UgcmVsYXRpb25zaGlwcy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICBfaW5zdGFuY2VSZWxhdGlvbnNoaXBzID0ge31cbiAgLyoqXG4gICAqIEF0dGFjaG1lbnRzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkQXR0YWNobWVudEhhbmRsZT59ICovXG4gIF9hdHRhY2htZW50cyA9IHt9XG5cbiAgLyoqXG4gICAqIExvYWQgY29ob3J0LlxuICAgKiBAdHlwZSB7QXJyYXk8VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQ+IHwgdW5kZWZpbmVkfSAtIFNoYXJlZCByZWZlcmVuY2UgdG8gc2libGluZyByZWNvcmRzIGxvYWRlZCBpbiB0aGUgc2FtZSBiYXRjaC4gVXNlZCBieSBhdXRvLXByZWxvYWQuXG4gICAqL1xuICBfbG9hZENvaG9ydCA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBUYWJsZSBuYW1lLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBfX3RhYmxlTmFtZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBWYWxpZGF0aW9uIGVycm9ycy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFZhbGlkYXRpb25FcnJvck9iamVjdFR5cGVbXT59ICovXG4gIF92YWxpZGF0aW9uRXJyb3JzID0ge31cblxuICBzdGF0aWMgdmFsaWRhdG9yVHlwZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0VmFsaWRhdG9yVHlwZXNNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIgdmFsaWRhdG9yIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi92YWxpZGF0b3JzL2Jhc2UuanNcIikuZGVmYXVsdH0gdmFsaWRhdG9yQ2xhc3MgLSBWYWxpZGF0b3IgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgcmVnaXN0ZXJWYWxpZGF0b3JUeXBlKG5hbWUsIHZhbGlkYXRvckNsYXNzKSB7XG4gICAgdGhpcy52YWxpZGF0b3JUeXBlcygpW25hbWVdID0gdmFsaWRhdG9yQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIGxpZmVjeWNsZSBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtcImFmdGVyQ3JlYXRlXCIgfCBcImFmdGVyRGVzdHJveVwiIHwgXCJhZnRlclNhdmVcIiB8IFwiYWZ0ZXJVcGRhdGVcIiB8IFwiYmVmb3JlQ3JlYXRlXCIgfCBcImJlZm9yZURlc3Ryb3lcIiB8IFwiYmVmb3JlU2F2ZVwiIHwgXCJiZWZvcmVVcGRhdGVcIiB8IFwiYmVmb3JlVmFsaWRhdGlvblwifSBjYWxsYmFja05hbWUgLSBDYWxsYmFjayB0eXBlLlxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgcmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjayhjYWxsYmFja05hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY2FsbGJhY2tzID0gdGhpcy5nZXRMaWZlY3ljbGVDYWxsYmFja3NNYXAoKVxuXG4gICAgaWYgKCFjYWxsYmFja3NbY2FsbGJhY2tOYW1lXSkge1xuICAgICAgY2FsbGJhY2tzW2NhbGxiYWNrTmFtZV0gPSBbXVxuICAgIH1cblxuICAgIGNhbGxiYWNrc1tjYWxsYmFja05hbWVdLnB1c2goY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1bnJlZ2lzdGVyIGxpZmVjeWNsZSBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtcImFmdGVyQ3JlYXRlXCIgfCBcImFmdGVyRGVzdHJveVwiIHwgXCJhZnRlclNhdmVcIiB8IFwiYWZ0ZXJVcGRhdGVcIiB8IFwiYmVmb3JlQ3JlYXRlXCIgfCBcImJlZm9yZURlc3Ryb3lcIiB8IFwiYmVmb3JlU2F2ZVwiIHwgXCJiZWZvcmVVcGRhdGVcIiB8IFwiYmVmb3JlVmFsaWRhdGlvblwifSBjYWxsYmFja05hbWUgLSBDYWxsYmFjayB0eXBlLlxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBQcmV2aW91c2x5IHJlZ2lzdGVyZWQgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHVucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjayhjYWxsYmFja05hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY2FsbGJhY2tzID0gdGhpcy5nZXRMaWZlY3ljbGVDYWxsYmFja3NNYXAoKVtjYWxsYmFja05hbWVdXG5cbiAgICBpZiAoIWNhbGxiYWNrcykgcmV0dXJuXG5cbiAgICBjb25zdCBjYWxsYmFja0luZGV4ID0gY2FsbGJhY2tzLmluZGV4T2YoY2FsbGJhY2spXG5cbiAgICBpZiAoY2FsbGJhY2tJbmRleCA+PSAwKSBjYWxsYmFja3Muc3BsaWNlKGNhbGxiYWNrSW5kZXgsIDEpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgdmFsaWRhdGlvbi5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBiZWZvcmVWYWxpZGF0aW9uKGNhbGxiYWNrKSB7XG4gICAgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjay5jYWxsKHRoaXMsIFwiYmVmb3JlVmFsaWRhdGlvblwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBzYXZlLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGJlZm9yZVNhdmUoY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJiZWZvcmVTYXZlXCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGNyZWF0ZS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBiZWZvcmVDcmVhdGUoY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJiZWZvcmVDcmVhdGVcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgdXBkYXRlLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGJlZm9yZVVwZGF0ZShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImJlZm9yZVVwZGF0ZVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBkZXN0cm95LlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGJlZm9yZURlc3Ryb3koY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJiZWZvcmVEZXN0cm95XCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgc2F2ZS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhZnRlclNhdmUoY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJhZnRlclNhdmVcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBjcmVhdGUuXG4gICAqIEB0ZW1wbGF0ZSBSXG4gICAqIEB0aGlzIHtNb2RlbENvbnN0cnVjdG9yPFI+fVxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZTxSPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYWZ0ZXJDcmVhdGUoY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJhZnRlckNyZWF0ZVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIHVwZGF0ZS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhZnRlclVwZGF0ZShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImFmdGVyVXBkYXRlXCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgZGVzdHJveS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhZnRlckRlc3Ryb3koY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJhZnRlckRlc3Ryb3lcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogRW5hYmxlcyBhdXRvbWF0aWMgY3JlYXRlL3VwZGF0ZS9kZXN0cm95IGF1ZGl0aW5nIGZvciB0aGlzIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhdWRpdGVkKCkge1xuICAgIHJlZ2lzdGVyQXVkaXRpbmcodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhbiBhYXNtLXN0eWxlIHN0YXRlIG1hY2hpbmUgb24gdGhpcyBtb2RlbDogbmFtZWQgc3RhdGVzLCBldmVudHNcbiAgICogKGd1YXJkZWQgdHJhbnNpdGlvbnMpLCBhbmQgZW50ZXIvZXhpdCArIGJlZm9yZS9hZnRlciB0cmFuc2l0aW9uIGhvb2tzLiBTZWVcbiAgICogYHN0YXRlLW1hY2hpbmUuanNgLiBHZW5lcmF0ZXMgYGV2ZW50KClgIC8gYGV2ZW50QW5kU2F2ZSgpYCAvIGBjYW5FdmVudCgpYFxuICAgKiB0cmFuc2l0aW9uIG1ldGhvZHMgcGVyIGRlY2xhcmVkIGV2ZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3RhdGUtbWFjaGluZS5qc1wiKS5TdGF0ZU1hY2hpbmVEZWZpbml0aW9ufSBkZWZpbml0aW9uIC0gU3RhdGUgbWFjaGluZSBkZWZpbml0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBzdGF0ZU1hY2hpbmUoZGVmaW5pdGlvbikge1xuICAgIHN0YXRlTWFjaGluZSh0aGlzLCBkZWZpbml0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhpcyBtb2RlbCdzIHN0YXRlIG1hY2hpbmUgZGVmaW5pdGlvbiwgb3IgbnVsbCB3aGVuIGl0IGRlY2xhcmVzIG5vbmUuXG4gICAqIGBNb2RlbC5zdGF0ZU1hY2hpbmUoLi4uKWAgb3ZlcnJpZGVzIHRoaXMgb24gY2xhc3NlcyB0aGF0IGRlY2xhcmUgYSBtYWNoaW5lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zdGF0ZS1tYWNoaW5lLmpzXCIpLlN0YXRlTWFjaGluZURlZmluaXRpb24gfCBudWxsfSAtIFRoZSBzdGF0ZSBtYWNoaW5lIGRlZmluaXRpb24sIG9yIG51bGwgd2hlbiBub25lIGlzIGRlY2xhcmVkLlxuICAgKi9cbiAgc3RhdGljIGdldFN0YXRlTWFjaGluZURlZmluaXRpb24oKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoaXMgbW9kZWwncyBzdGF0ZSBjb2x1bW4sIG9yIG51bGwgd2hlbiBpdCBkZWNsYXJlcyBubyBzdGF0ZSBtYWNoaW5lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBUaGUgc3RhdGUgY29sdW1uIG5hbWUsIG9yIG51bGwgd2hlbiBubyBzdGF0ZSBtYWNoaW5lIGlzIGRlY2xhcmVkLlxuICAgKi9cbiAgc3RhdGljIGdldFN0YXRlTWFjaGluZUNvbHVtbigpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhpcyBtb2RlbCdzIGRlY2xhcmVkIHN0YXRlIG5hbWVzIChlbXB0eSB3aGVuIGl0IGhhcyBubyBzdGF0ZSBtYWNoaW5lKS5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFRoZSBkZWNsYXJlZCBzdGF0ZSBuYW1lcywgb3IgYW4gZW1wdHkgYXJyYXkgd2hlbiBubyBzdGF0ZSBtYWNoaW5lIGlzIGRlY2xhcmVkLlxuICAgKi9cbiAgc3RhdGljIGdldFN0YXRlTWFjaGluZVN0YXRlTmFtZXMoKSB7XG4gICAgcmV0dXJuIFtdXG4gIH1cblxuICAvKipcbiAgICogTWFpbnRhaW5zIGEgY291bnRlciBjb2x1bW4gb24gYSBgYmVsb25nc1RvYCBwYXJlbnQgYXMgdGhlIHN1bSBvZiBhIHBlci1yZWNvcmRcbiAgICogbWFnbml0dWRlLCBrZXB0IGN1cnJlbnQgYnkgYXRvbWljIGluY3JlbWVudHMgZGlmZmVkIG9uIGV2ZXJ5IGNyZWF0ZS91cGRhdGUvXG4gICAqIGRlc3Ryb3kgKGFuZCBtb3ZlZCBiZXR3ZWVuIHBhcmVudHMgd2hlbiB0aGUgZm9yZWlnbiBrZXkgY2hhbmdlcykuIFNlZVxuICAgKiBgY291bnRlci1jYWNoZS1tYWduaXR1ZGUuanNgLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY291bnRlci1jYWNoZS1tYWduaXR1ZGUuanNcIikuTWFnbml0dWRlQ291bnRlckNhY2hlRGVmaW5pdGlvbn0gZGVmaW5pdGlvbiAtIENvdW50ZXIgY2FjaGUgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgbWFnbml0dWRlQ291bnRlckNhY2hlKGRlZmluaXRpb24pIHtcbiAgICByZWdpc3Rlck1hZ25pdHVkZUNvdW50ZXJDYWNoZSh0aGlzLCBkZWZpbml0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGNhbGxiYWNrIGludm9rZWQgYWZ0ZXIgdGhpcyBtb2RlbCB3cml0ZXMgYW4gYXVkaXQgcm93IGZvciB0aGUgYWN0aW9uLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQXVkaXQgYWN0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hdWRpdGluZy5qc1wiKS5BdWRpdENhbGxiYWNrfSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1biBhZnRlciBhdWRpdCBjcmVhdGlvbi5cbiAgICogQHJldHVybnMgeygpID0+IHZvaWR9IFVuc3Vic2NyaWJlIGZ1bmN0aW9uLlxuICAgKi9cbiAgc3RhdGljIG9uQXVkaXQoYWN0aW9uLCBjYWxsYmFjaykge1xuICAgIHJldHVybiByZWdpc3RlckF1ZGl0Q2FsbGJhY2sodGhpcywgYWN0aW9uLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHJlY29yZHMgdGhhdCBkbyBub3QgaGF2ZSBhbiBhdWRpdCByb3cgZm9yIHRoZSBnaXZlbiBhY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24gbmFtZS5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IFF1ZXJ5IHNjb3BlZCB0byByZWNvcmRzIHdpdGhvdXQgdGhhdCBhdWRpdCBhY3Rpb24uXG4gICAqL1xuICBzdGF0aWMgd2l0aG91dEF1ZGl0KGFjdGlvbikge1xuICAgIHJldHVybiB3aXRob3V0QXVkaXQodGhpcywgYWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHZhbGlkYXRvciB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmFsaWRhdG9yTmFtZSAtIFZhbGlkYXRvciBuYW1lLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vdmFsaWRhdG9ycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIHZhbGlkYXRvciB0eXBlLlxuICAgKi9cbiAgc3RhdGljIGdldFZhbGlkYXRvclR5cGUodmFsaWRhdG9yTmFtZSkge1xuICAgIGlmICghKHZhbGlkYXRvck5hbWUgaW4gdGhpcy52YWxpZGF0b3JUeXBlcygpKSkgdGhyb3cgbmV3IEVycm9yKGBWYWxpZGF0b3IgdHlwZSAke3ZhbGlkYXRvck5hbWV9IG5vdCBmb3VuZGApXG5cbiAgICByZXR1cm4gdGhpcy52YWxpZGF0b3JUeXBlcygpW3ZhbGlkYXRvck5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgZXhpc3RzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlbGF0aW9uc2hpcCBleGlzdHMuXG4gICAqL1xuICBzdGF0aWMgX3JlbGF0aW9uc2hpcEV4aXN0cyhyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgaWYgKHJlbGF0aW9uc2hpcE5hbWUgaW4gdGhpcy5nZXRSZWxhdGlvbnNoaXBzTWFwKCkpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmVsYXRpb25zaGlwU2NvcGVDYWxsYmFjayB0eXBlLlxuICAgKiBAdHlwZWRlZiB7KHF1ZXJ5OiBpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD4pID0+IChpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD4gfCB2b2lkKX0gUmVsYXRpb25zaGlwU2NvcGVDYWxsYmFja1xuICAgKi9cbiAgLyoqXG4gICAqIFJlbGF0aW9uc2hpcERhdGFBcmd1bWVudFR5cGUgdHlwZS5cbiAgICogQHR5cGVkZWYge29iamVjdH0gUmVsYXRpb25zaGlwRGF0YUFyZ3VtZW50VHlwZVxuICAgKiBAcHJvcGVydHkge2Jvb2xlYW59IFthdXRvbG9hZF0gLSBEaXNhYmxlIGF1dG8tYmF0Y2gtcHJlbG9hZCBmb3IgdGhpcyByZWxhdGlvbnNoaXAgYnkgcGFzc2luZyBmYWxzZS4gRGVmYXVsdCB0cnVlLlxuICAgKiBAcHJvcGVydHkge3N0cmluZ30gW2NsYXNzTmFtZV0gLSBNb2RlbCBjbGFzcyBuYW1lIGZvciB0aGUgcmVsYXRlZCByZWNvcmQuXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGVwZW5kZW50XSAtIERlcGVuZGVudCBhY3Rpb24gd2hlbiBwYXJlbnQgaXMgZGVzdHJveWVkIChlLmcuIFwiZGVzdHJveVwiKS5cbiAgICogQHByb3BlcnR5IHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IFtrbGFzc10gLSBNb2RlbCBjbGFzcyBmb3IgdGhlIHJlbGF0ZWQgcmVjb3JkLlxuICAgKiBAcHJvcGVydHkge1JlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2t9IFtzY29wZV0gLSBPcHRpb25hbCBzY29wZSBjYWxsYmFjayBmb3IgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IFt0eXBlXSAtIFJlbGF0aW9uc2hpcCB0eXBlIChlLmcuIFwiaGFzTWFueVwiLCBcImJlbG9uZ3NUb1wiKS5cbiAgICovXG4gIC8qKlxuICAgKiBSdW5zIGRlZmluZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwRGF0YUFyZ3VtZW50VHlwZX0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBfZGVmaW5lUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUsIGRhdGEpIHtcbiAgICBpZiAoIXJlbGF0aW9uc2hpcE5hbWUpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWxhdGlvbnNoaXAgbmFtZSBnaXZlbjogJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgaWYgKHRoaXMuX3JlbGF0aW9uc2hpcEV4aXN0cyhyZWxhdGlvbnNoaXBOYW1lKSkgdGhyb3cgbmV3IEVycm9yKGBSZWxhdGlvbnNoaXAgJHtyZWxhdGlvbnNoaXBOYW1lfSBhbHJlYWR5IGV4aXN0c2ApXG5cbiAgICBjb25zdCBhY3R1YWxEYXRhID0gT2JqZWN0LmFzc2lnbihcbiAgICAgIHtcbiAgICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgdHlwZTogXCJoYXNNYW55XCJcbiAgICAgIH0sXG4gICAgICBkYXRhXG4gICAgKVxuXG4gICAgaWYgKCFhY3R1YWxEYXRhLmNsYXNzTmFtZSAmJiAhYWN0dWFsRGF0YS5rbGFzcykge1xuICAgICAgYWN0dWFsRGF0YS5jbGFzc05hbWUgPSBzaW5ndWxhcml6ZU1vZGVsTmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgIH1cblxuICAgIGxldCByZWxhdGlvbnNoaXBcbiAgICBjb25zdCBwcm90b3R5cGUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzLnByb3RvdHlwZSkpXG5cbiAgICBpZiAoYWN0dWFsRGF0YS50eXBlID09IFwiYmVsb25nc1RvXCIpIHtcbiAgICAgIHJlbGF0aW9uc2hpcCA9IG5ldyBCZWxvbmdzVG9SZWxhdGlvbnNoaXAoYWN0dWFsRGF0YSlcblxuICAgICAgcHJvdG90eXBlW3JlbGF0aW9uc2hpcE5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgICAgcmV0dXJuIHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYGJ1aWxkJHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcE5hbWUpfWBdID0gZnVuY3Rpb24oLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgcmV0dXJuIGJ1aWxkUmVsYXRlZFJlY29yZFdpdGhJbnZlcnNlKC8qKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9ICovICh0aGlzKSwgcmVsYXRpb25zaGlwTmFtZSwgYXR0cmlidXRlcywgdHJ1ZSlcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2Bsb2FkJHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcE5hbWUpfWBdID0gYXN5bmMgZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2Ake3JlbGF0aW9uc2hpcE5hbWV9T3JMb2FkYF0gPSBhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucmVsYXRpb25zaGlwT3JMb2FkKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcE5hbWUpfWBdID0gZnVuY3Rpb24oLyoqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCB8IG51bGwgfCB1bmRlZmluZWR9ICovIG1vZGVsKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICAgIGNvbnN0IGZvcmVpZ25LZXlWYWx1ZSA9IHRoaXMuX2JlbG9uZ3NUb0ZvcmVpZ25LZXlWYWx1ZSh7bW9kZWwsIHJlbGF0aW9uc2hpcH0pXG5cbiAgICAgICAgcmVsYXRpb25zaGlwLnNldExvYWRlZChtb2RlbCB8fCB1bmRlZmluZWQpXG4gICAgICAgIHJlbGF0aW9uc2hpcC5zZXRQcmVsb2FkZWQodHJ1ZSlcbiAgICAgICAgcmVsYXRpb25zaGlwLnNldERpcnR5KHRydWUpXG4gICAgICAgIHRoaXMuX3NldENvbHVtbkF0dHJpYnV0ZShyZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpLCBmb3JlaWduS2V5VmFsdWUpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChhY3R1YWxEYXRhLnR5cGUgPT0gXCJoYXNNYW55XCIpIHtcbiAgICAgIHJlbGF0aW9uc2hpcCA9IG5ldyBIYXNNYW55UmVsYXRpb25zaGlwKGFjdHVhbERhdGEpXG5cbiAgICAgIHByb3RvdHlwZVtyZWxhdGlvbnNoaXBOYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvaGFzLW1hbnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgJHtyZWxhdGlvbnNoaXBOYW1lfUxvYWRlZGBdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKS5sb2FkZWQoKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYGxvYWQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9YF0gPSBhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYCR7cmVsYXRpb25zaGlwTmFtZX1PckxvYWRgXSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZWxhdGlvbnNoaXBPckxvYWQocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGFjdHVhbERhdGEudHlwZSA9PSBcImhhc09uZVwiKSB7XG4gICAgICByZWxhdGlvbnNoaXAgPSBuZXcgSGFzT25lUmVsYXRpb25zaGlwKGFjdHVhbERhdGEpXG5cbiAgICAgIHByb3RvdHlwZVtyZWxhdGlvbnNoaXBOYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkubG9hZGVkKClcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2BidWlsZCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXBOYW1lKX1gXSA9IGZ1bmN0aW9uKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyBhdHRyaWJ1dGVzKSB7XG4gICAgICAgIHJldHVybiBidWlsZFJlbGF0ZWRSZWNvcmRXaXRoSW52ZXJzZSgvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAqLyAodGhpcyksIHJlbGF0aW9uc2hpcE5hbWUsIGF0dHJpYnV0ZXMsIGZhbHNlKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYGxvYWQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9YF0gPSBhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYCR7cmVsYXRpb25zaGlwTmFtZX1PckxvYWRgXSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZWxhdGlvbnNoaXBPckxvYWQocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHJlbGF0aW9uc2hpcCB0eXBlOiAke2FjdHVhbERhdGEudHlwZX1gKVxuICAgIH1cblxuICAgIHRoaXMuZ2V0UmVsYXRpb25zaGlwc01hcCgpW3JlbGF0aW9uc2hpcE5hbWVdID0gcmVsYXRpb25zaGlwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgcmVsYXRpb25zaGlwIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwU2NvcGVDYWxsYmFjayB8IG9iamVjdCB8IHVuZGVmaW5lZH0gc2NvcGVPck9wdGlvbnMgLSBTY29wZSBjYWxsYmFjayBvciBvcHRpb25zLlxuICAgKiBAcGFyYW0ge29iamVjdCB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt7c2NvcGU6IChSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrIHwgdW5kZWZpbmVkKSwgcmVsYXRpb25zaGlwT3B0aW9uczogb2JqZWN0fX0gLSBOb3JtYWxpemVkIGFyZ3VtZW50cy5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplUmVsYXRpb25zaGlwQXJncyhzY29wZU9yT3B0aW9ucywgb3B0aW9ucykge1xuICAgIGlmICh0eXBlb2Ygc2NvcGVPck9wdGlvbnMgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzY29wZTogLyoqIEB0eXBlIHtSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrfSAqLyAoc2NvcGVPck9wdGlvbnMpLFxuICAgICAgICByZWxhdGlvbnNoaXBPcHRpb25zOiBvcHRpb25zIHx8IHt9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNjb3BlOiB1bmRlZmluZWQsXG4gICAgICByZWxhdGlvbnNoaXBPcHRpb25zOiBzY29wZU9yT3B0aW9ucyB8fCB7fVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYWZ0ZXJDcmVhdGUsIGFmdGVyU2F2ZSwgYW5kIGFmdGVyRGVzdHJveSBjYWxsYmFja3MgdG8gc3luY1xuICAgKiBhIGNvdW50ZXIgY2FjaGUgY29sdW1uIG9uIHRoZSBwYXJlbnQgbW9kZWwuIFRoZSBjb2x1bW4gbmFtZSBmb2xsb3dzXG4gICAqIHRoZSBjb252ZW50aW9uIGA8Y2hpbGRNb2RlbFBsdXJhbENhbWVsQ2FzZT5Db3VudGAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gVGhlIGJlbG9uZ3NUbyByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBfcmVnaXN0ZXJDb3VudGVyQ2FjaGVDYWxsYmFja3MocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IENoaWxkTW9kZWwgPSB0aGlzXG5cbiAgICAvKipcbiAgICAgKiBBdG9taWNhbGx5IHJlY29tcHV0ZXMgdGhlIGNvdW50ZXIgY2FjaGUgY29sdW1uIG9uIHRoZSBwYXJlbnQgdmlhIGFcbiAgICAgKiBzaW5nbGUgVVBEQVRFIC4uLiBTRVQgY29sID0gKFNFTEVDVCBDT1VOVCgqKSkgc28gY29uY3VycmVudFxuICAgICAqIGNyZWF0ZXMvZGVzdHJveXMgY2Fubm90IHJhY2UgaW50byBhIHN0YWxlIGNvdW50LlxuICAgICAqIEBwYXJhbSB7bnVtYmVyIHwgc3RyaW5nIHwgbnVsbH0gcGFyZW50SWQgLSBQYXJlbnQgcHJpbWFyeS1rZXkgdmFsdWUuXG4gICAgICogQHBhcmFtIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gcmVjb3JkIC0gQ2hpbGQgcmVjb3JkIG93bmluZyB0aGUgY29ubmVjdGlvbi5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjb3VudGVyIGNhY2hlIGhhcyBiZWVuIHN5bmNlZC5cbiAgICAgKi9cbiAgICBhc3luYyBmdW5jdGlvbiBzeW5jQ291bnRlcihwYXJlbnRJZCwgcmVjb3JkKSB7XG4gICAgICBpZiAoIXBhcmVudElkKSByZXR1cm5cblxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gQ2hpbGRNb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIGNvbnN0IFBhcmVudE1vZGVsID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICBpZiAoIVBhcmVudE1vZGVsKSByZXR1cm5cblxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHJlbGF0aW9uc2hpcC5nZXRQcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IGZrID0gcmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKVxuICAgICAgY29uc3QgY2hpbGRNb2RlbE5hbWUgPSBDaGlsZE1vZGVsLmdldE1vZGVsTmFtZSgpXG4gICAgICBjb25zdCBjb3VudGVyQ29sdW1uID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKGAke2luZmxlY3Rpb24ucGx1cmFsaXplKGNoaWxkTW9kZWxOYW1lKX1Db3VudGApXG4gICAgICBjb25zdCBwYXJlbnRUYWJsZSA9IFBhcmVudE1vZGVsLnRhYmxlTmFtZSgpXG4gICAgICBjb25zdCBjaGlsZFRhYmxlID0gQ2hpbGRNb2RlbC50YWJsZU5hbWUoKVxuICAgICAgY29uc3QgcGtDb2x1bW4gPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUocHJpbWFyeUtleSlcbiAgICAgIGNvbnN0IHBhcmVudFF1ZXJ5ID0gcmVjb3JkLnF1ZXJ5Rm9yTW9kZWwoUGFyZW50TW9kZWwpXG4gICAgICBjb25zdCBjb25uZWN0aW9uID0gcGFyZW50UXVlcnkuZHJpdmVyXG4gICAgICBjb25zdCBxdW90ZWQgPSBjb25uZWN0aW9uLnF1b3RlKHBhcmVudElkKVxuICAgICAgY29uc3QgcHJlcGFyZWRQYXJlbnRVcGRhdGUgPSBhd2FpdCBwcmVwYXJlQ291bnRlckNhY2hlUGFyZW50VXBkYXRlKHtcbiAgICAgICAgcGFyZW50SWQsXG4gICAgICAgIHBhcmVudE1vZGVsQ2xhc3M6IFBhcmVudE1vZGVsLFxuICAgICAgICBwYXJlbnRQcmltYXJ5S2V5OiBwcmltYXJ5S2V5LFxuICAgICAgICBwYXJlbnRRdWVyeVxuICAgICAgfSlcblxuICAgICAgY29uc3Qgc3FsID0gYFVQREFURSAke2Nvbm5lY3Rpb24ucXVvdGVUYWJsZShwYXJlbnRUYWJsZSl9IFNFVCAke2Nvbm5lY3Rpb24ucXVvdGVDb2x1bW4oY291bnRlckNvbHVtbil9ID0gKFNFTEVDVCBDT1VOVCgqKSBGUk9NICR7Y29ubmVjdGlvbi5xdW90ZVRhYmxlKGNoaWxkVGFibGUpfSBXSEVSRSAke2Nvbm5lY3Rpb24ucXVvdGVDb2x1bW4oZmspfSA9ICR7cXVvdGVkfSkgV0hFUkUgJHtjb25uZWN0aW9uLnF1b3RlQ29sdW1uKHBrQ29sdW1uKX0gPSAke3F1b3RlZH1gXG5cbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucXVlcnkoc3FsLCB7bG9nTmFtZTogYCR7UGFyZW50TW9kZWwubmFtZX0gVXBkYXRlYH0pXG4gICAgICBhd2FpdCBzY2hlZHVsZUNvdW50ZXJDYWNoZVBhcmVudFVwZGF0ZSh7XG4gICAgICAgIHByZXBhcmVkVXBkYXRlOiBwcmVwYXJlZFBhcmVudFVwZGF0ZSxcbiAgICAgICAgc291cmNlUmVjb3JkOiByZWNvcmRcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUnVucyByZWFkIGZrIGF0dHJpYnV0ZS5cbiAgICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBDaGlsZCByZWNvcmQgaW5zdGFuY2UuXG4gICAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEN1cnJlbnQgZm9yZWlnbi1rZXkgYXR0cmlidXRlIHZhbHVlLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uIHJlYWRGa0F0dHJpYnV0ZShyZWNvcmQpIHtcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IENoaWxkTW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCBma0F0dHJpYnV0ZSA9IGluZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKS5yZXBsYWNlKC9faWQkLywgXCJJZFwiKSwgdHJ1ZSlcblxuICAgICAgcmV0dXJuIHJlY29yZC5yZWFkQXR0cmlidXRlKGZrQXR0cmlidXRlKVxuICAgIH1cblxuICAgIENoaWxkTW9kZWwuYWZ0ZXJDcmVhdGUoYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgYXdhaXQgc3luY0NvdW50ZXIocmVhZEZrQXR0cmlidXRlKHJlY29yZCksIHJlY29yZClcbiAgICB9KVxuXG4gICAgQ2hpbGRNb2RlbC5hZnRlckRlc3Ryb3koYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgYXdhaXQgc3luY0NvdW50ZXIocmVhZEZrQXR0cmlidXRlKHJlY29yZCksIHJlY29yZClcbiAgICB9KVxuXG4gICAgQ2hpbGRNb2RlbC5iZWZvcmVTYXZlKGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgIGNvbnN0IG1vZGVsID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlY29yZClcblxuICAgICAgaWYgKG1vZGVsLmlzTmV3UmVjb3JkKCkpIHJldHVyblxuXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBDaGlsZE1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgZmtDb2x1bW4gPSByZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG5cbiAgICAgIC8vIERldGVjdCBGSyBjaGFuZ2UgdmlhIGRpcmVjdCBhdHRyaWJ1dGUgYXNzaWdubWVudCBvciByZWxhdGlvbnNoaXAgc2V0dGVyLlxuICAgICAgY29uc3QgZGlyZWN0Q2hhbmdlID0gZmtDb2x1bW4gaW4gbW9kZWwuX2NoYW5nZXNcbiAgICAgIGNvbnN0IGJlbG9uZ3NUb0NoYW5nZSA9IG1vZGVsLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHM/LltyZWxhdGlvbnNoaXBOYW1lXT8uZ2V0RGlydHk/LigpXG5cbiAgICAgIGlmIChkaXJlY3RDaGFuZ2UgfHwgYmVsb25nc1RvQ2hhbmdlKSB7XG4gICAgICAgIG1vZGVsW2BfY291bnRlckNhY2hlUHJldl8ke3JlbGF0aW9uc2hpcE5hbWV9YF0gPSBtb2RlbC5fYXR0cmlidXRlc1tma0NvbHVtbl1cbiAgICAgIH1cbiAgICB9KVxuXG4gICAgQ2hpbGRNb2RlbC5hZnRlclNhdmUoYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgY29uc3QgbW9kZWwgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocmVjb3JkKVxuICAgICAgY29uc3QgcHJldktleSA9IGBfY291bnRlckNhY2hlUHJldl8ke3JlbGF0aW9uc2hpcE5hbWV9YFxuICAgICAgY29uc3QgcHJldmlvdXNQYXJlbnRJZCA9IG1vZGVsW3ByZXZLZXldXG5cbiAgICAgIGlmIChwcmV2aW91c1BhcmVudElkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgZGVsZXRlIG1vZGVsW3ByZXZLZXldXG4gICAgICAgIGF3YWl0IHN5bmNDb3VudGVyKHByZXZpb3VzUGFyZW50SWQsIHJlY29yZClcbiAgICAgICAgYXdhaXQgc3luY0NvdW50ZXIocmVhZEZrQXR0cmlidXRlKG1vZGVsKSwgcmVjb3JkKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSByZWxhdGlvbnNoaXAgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwc01hcCgpW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcCkgdGhyb3cgbmV3IEVycm9yKGBObyByZWxhdGlvbnNoaXAgaW4gJHt0aGlzLm5hbWV9IGNhbGxlZCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBpbiBsaXN0OiAke09iamVjdC5rZXlzKHRoaXMuZ2V0UmVsYXRpb25zaGlwc01hcCgpKS5qb2luKFwiLCBcIil9YClcblxuICAgIHJldHVybiByZWxhdGlvbnNoaXBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWxhdGlvbnNoaXBzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8aW1wb3J0KFwiLi9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gVGhlIHJlbGF0aW9uc2hpcHMuXG4gICAqL1xuICBzdGF0aWMgZ2V0UmVsYXRpb25zaGlwcygpIHtcbiAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyh0aGlzLmdldFJlbGF0aW9uc2hpcHNNYXAoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWxhdGlvbnNoaXBzIG1hcC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIFJlbGF0aW9uc2hpcCBkZWZpbml0aW9ucyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldFJlbGF0aW9uc2hpcHNNYXAoKSB7XG4gICAgaWYgKCFPYmplY3QuaGFzT3duKHRoaXMsIFwiX3JlbGF0aW9uc2hpcHNcIikgfHwgIXRoaXMuX3JlbGF0aW9uc2hpcHMpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgICAgdGhpcy5fcmVsYXRpb25zaGlwcyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovICh0aGlzLl9yZWxhdGlvbnNoaXBzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcCBuYW1lcy5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IC0gVGhlIHJlbGF0aW9uc2hpcCBuYW1lcy5cbiAgICovXG4gIHN0YXRpYyBnZXRSZWxhdGlvbnNoaXBOYW1lcygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRSZWxhdGlvbnNoaXBzKCkubWFwKChyZWxhdGlvbnNoaXApID0+IHJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCkpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXIgYSBjb25zdW1lci1kZWZpbmVkIHF1ZXJ5RGF0YSBlbnRyeS4gVGhlIGNhbGxiYWNrIHJlY2VpdmVzXG4gICAqIGEgZ3JvdXBlZCBxdWVyeSBhbHJlYWR5IGpvaW5lZCBkb3duIHRoZSByZWxhdGlvbnNoaXAgY2hhaW4gZnJvbSB0aGVcbiAgICogcm9vdCBvZiBgLnF1ZXJ5RGF0YSguLi4pYCB0byB0aGlzIG1vZGVsLCBhbHJlYWR5IGZpbHRlcmVkIGJ5IHRoZVxuICAgKiByb290IHBhcmVudCBJRHMsIGFuZCB3aXRoIGBwYXJlbnRfaWRgIHByZS1zZWxlY3RlZCDigJQgc28gdGhlIGZuXG4gICAqIG9ubHkgbmVlZHMgdG8gYWRkIGl0cyBvd24gU0VMRUNUIChhbmQgb3B0aW9uYWxseSBqb2lucy93aGVyZSkuIEFueVxuICAgKiBhbGlhc2VzIHRoZSBmbiBzZWxlY3RzIGFyZSBhdHRhY2hlZCB0byBlYWNoICoqcm9vdCoqIHJlY29yZCB2aWFcbiAgICogYHJlY29yZC5xdWVyeURhdGEoYWxpYXNOYW1lKWAuIE11bHRpLWNvbHVtbiBzZWxlY3RzIGFyZSBmaW5lIOKAlCBvbmVcbiAgICogYWxpYXMgbWFwcyB0byBvbmUgcXVlcnlEYXRhIGtleS5cbiAgICpcbiAgICogKipRdW90ZSBBUyBhbGlhc2VzIG9uIFBvc3RncmVTUUwuKiogUG9zdGdyZVNRTCBmb2xkcyB1bnF1b3RlZFxuICAgKiBpZGVudGlmaWVycyAoaW5jbHVkaW5nIFNFTEVDVCBhbGlhc2VzKSB0byBsb3dlcmNhc2UsIHNvIGFcbiAgICogYC4uLiBBUyBtYW51YWxUYXNrc0NvdW50YCBsYW5kcyBpbiB0aGUgcmVzdWx0IHJvdyBhc1xuICAgKiBgbWFudWFsdGFza3Njb3VudGAgd2hpbGUgdGhlIGxvb2t1cCBgcmVjb3JkLnF1ZXJ5RGF0YShcIm1hbnVhbFRhc2tzQ291bnRcIilgXG4gICAqIG5ldmVyIGZpbmRzIGl0LiBVc2UgYGRyaXZlci5xdW90ZUNvbHVtbihcIm1hbnVhbFRhc2tzQ291bnRcIilgIGZvciB0aGVcbiAgICogYWxpYXMgdG8gcHJlc2VydmUgdGhlIGNhc2Ugb24gZXZlcnkgc3VwcG9ydGVkIGRyaXZlcjpcbiAgICogICBxdWVyeS5zZWxlY3QoYENPVU5UKC4uLikgQVMgJHtkcml2ZXIucXVvdGVDb2x1bW4oXCJtYW51YWxUYXNrc0NvdW50XCIpfWApXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gSWRlbnRpZmllciB1c2VkIGluIHRoZSBgLnF1ZXJ5RGF0YSguLi4pYCBzcGVjLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRm59IGZuIC0gQ2FsbGJhY2sgdGhhdCBtdXRhdGVzIHRoZSBxdWVyeS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgcXVlcnlEYXRhKG5hbWUsIGZuKSB7XG4gICAgaWYgKCFuYW1lIHx8IHR5cGVvZiBuYW1lICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcXVlcnlEYXRhIG5hbWU6ICR7bmFtZX1gKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZm4gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBxdWVyeURhdGEgZm4gZm9yICR7dGhpcy5uYW1lfS5xdWVyeURhdGEoJHtKU09OLnN0cmluZ2lmeShuYW1lKX0pIG11c3QgYmUgYSBmdW5jdGlvbmApXG4gICAgfVxuXG4gICAgY29uc3QgbWFwID0gdGhpcy5nZXRRdWVyeURhdGFNYXAoKVxuXG4gICAgLy8gVXNlIE9iamVjdC5oYXNPd24gc28gYSBuYW1lIHRoYXQgaGFwcGVucyB0byBtYXRjaCBhbiBpbmhlcml0ZWRcbiAgICAvLyBPYmplY3QucHJvdG90eXBlIGtleSAoZS5nLiBcInRvU3RyaW5nXCIsIFwiY29uc3RydWN0b3JcIikgaXNuJ3RcbiAgICAvLyBmYWxzZWx5IHRyZWF0ZWQgYXMgYWxyZWFkeSByZWdpc3RlcmVkLlxuICAgIGlmIChPYmplY3QuaGFzT3duKG1hcCwgbmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgcXVlcnlEYXRhIGZvciAke3RoaXMubmFtZX0uJHtuYW1lfSBpcyBhbHJlYWR5IHJlZ2lzdGVyZWRgKVxuICAgIH1cblxuICAgIG1hcFtuYW1lXSA9IGZuXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcXVlcnkgZGF0YSBtYXAuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9xdWVyeS9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUZuPn0gLSBxdWVyeURhdGEgcmVnaXN0cmF0aW9ucyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldFF1ZXJ5RGF0YU1hcCgpIHtcbiAgICBpZiAoIU9iamVjdC5oYXNPd24odGhpcywgXCJfcXVlcnlEYXRhUmVnaXN0cmF0aW9uc1wiKSB8fCAhdGhpcy5fcXVlcnlEYXRhUmVnaXN0cmF0aW9ucykge1xuICAgICAgLy8gUHJvdG90eXBlLWxlc3MgbWFwIHNvIGJyYWNrZXQgYWNjZXNzIGNhbiBvbmx5IGV2ZXIgc3VyZmFjZVxuICAgICAgLy8gcmVnaXN0cmF0aW9ucyBhY3R1YWxseSBtYWRlIG9uIHRoaXMgY2xhc3Mg4oCUIG5ldmVyIGluaGVyaXRlZFxuICAgICAgLy8gT2JqZWN0LnByb3RvdHlwZSBtZW1iZXJzLlxuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vcXVlcnkvcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFGbj59ICovXG4gICAgICB0aGlzLl9xdWVyeURhdGFSZWdpc3RyYXRpb25zID0gT2JqZWN0LmNyZWF0ZShudWxsKVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3F1ZXJ5L3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRm4+fSAqLyAodGhpcy5fcXVlcnlEYXRhUmVnaXN0cmF0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBxdWVyeSBkYXRhIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gcXVlcnlEYXRhIG5hbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9xdWVyeS9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUZuIHwgbnVsbH0gLSBSZWdpc3RlcmVkIGZuIG9yIG51bGwgd2hlbiBub3QgZm91bmQuXG4gICAqL1xuICBzdGF0aWMgZ2V0UXVlcnlEYXRhQnlOYW1lKG5hbWUpIHtcbiAgICBjb25zdCBtYXAgPSB0aGlzLmdldFF1ZXJ5RGF0YU1hcCgpXG5cbiAgICAvLyBPd24tcHJvcGVydHkgbG9va3VwIHNvIGEgc3BlYyBjb250YWluaW5nIGUuZy4gXCJ0b1N0cmluZ1wiIGRvZXNuJ3RcbiAgICAvLyByZXNvbHZlIHRvIGFuIGluaGVyaXRlZCBPYmplY3QucHJvdG90eXBlIG1lbWJlciDigJQgbWF0Y2hpbmcgdGhlXG4gICAgLy8gT2JqZWN0Lmhhc093biBndWFyZCB1c2VkIHdoZW4gcmVnaXN0ZXJpbmcuXG4gICAgcmV0dXJuIE9iamVjdC5oYXNPd24obWFwLCBuYW1lKSA/IG1hcFtuYW1lXSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJlY29yZEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPn0gLSBBdHRhY2htZW50IGRlZmluaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dGFjaG1lbnRzKCkge1xuICAgIHJldHVybiB0aGlzLmdldEF0dGFjaG1lbnRzTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGF0dGFjaG1lbnQgZGVmaW5pdGlvbnMgdGhyb3VnaCB0aGUgbW9kZWwgY29udHJhY3Qgc2hhcmVkIHdpdGhcbiAgICogZnJvbnRlbmQgbW9kZWwgY2xhc3Nlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJlY29yZEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPn0gLSBBdHRhY2htZW50IGRlZmluaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIGF0dGFjaG1lbnREZWZpbml0aW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRBdHRhY2htZW50c01hcCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0YWNobWVudCBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtSZWNvcmRBdHRhY2htZW50Q29uZmlndXJhdGlvbn0gLSBBdHRhY2htZW50IGRlZmluaXRpb24uXG4gICAqL1xuICBzdGF0aWMgZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSkge1xuICAgIGNvbnN0IGRlZmluaXRpb24gPSB0aGlzLmdldEF0dGFjaG1lbnRzTWFwKClbYXR0YWNobWVudE5hbWVdXG5cbiAgICBpZiAoIWRlZmluaXRpb24pIHRocm93IG5ldyBFcnJvcihgTm8gYXR0YWNobWVudCBpbiAke3RoaXMubmFtZX0gY2FsbGVkIFwiJHthdHRhY2htZW50TmFtZX1cIiBpbiBsaXN0OiAke09iamVjdC5rZXlzKHRoaXMuZ2V0QXR0YWNobWVudHNNYXAoKSkuam9pbihcIiwgXCIpfWApXG5cbiAgICByZXR1cm4gZGVmaW5pdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcCBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgcmVsYXRpb25zaGlwIGJ5IG5hbWUuXG4gICAqL1xuICBnZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGlmICghKHJlbGF0aW9uc2hpcE5hbWUgaW4gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKSkge1xuICAgICAgY29uc3QgbW9kZWxDbGFzc1JlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG4gICAgICAgIC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgICAgLnJlc29sdmVGb3JSZWNvcmQodGhpcylcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcFR5cGUgPSBtb2RlbENsYXNzUmVsYXRpb25zaGlwLmdldFR5cGUoKVxuICAgICAgbGV0IGluc3RhbmNlUmVsYXRpb25zaGlwXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlID09IFwiYmVsb25nc1RvXCIpIHtcbiAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSBuZXcgQmVsb25nc1RvSW5zdGFuY2VSZWxhdGlvbnNoaXAoe21vZGVsOiB0aGlzLCByZWxhdGlvbnNoaXA6IG1vZGVsQ2xhc3NSZWxhdGlvbnNoaXB9KVxuICAgICAgfSBlbHNlIGlmIChyZWxhdGlvbnNoaXBUeXBlID09IFwiaGFzTWFueVwiKSB7XG4gICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwID0gbmV3IEhhc01hbnlJbnN0YW5jZVJlbGF0aW9uc2hpcCh7bW9kZWw6IHRoaXMsIHJlbGF0aW9uc2hpcDogbW9kZWxDbGFzc1JlbGF0aW9uc2hpcH0pXG4gICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uc2hpcFR5cGUgPT0gXCJoYXNPbmVcIikge1xuICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IG5ldyBIYXNPbmVJbnN0YW5jZVJlbGF0aW9uc2hpcCh7bW9kZWw6IHRoaXMsIHJlbGF0aW9uc2hpcDogbW9kZWxDbGFzc1JlbGF0aW9uc2hpcH0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVsYXRpb25zaGlwIHR5cGU6ICR7cmVsYXRpb25zaGlwVHlwZX1gKVxuICAgICAgfVxuXG4gICAgICB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV0gPSBpbnN0YW5jZVJlbGF0aW9uc2hpcFxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVsb2FkcyByZWxhdGlvbnNoaXAocykgb250byB0aGlzIGFscmVhZHktbG9hZGVkIHJlY29yZC4gQWNjZXB0cyBlaXRoZXIgYVxuICAgKiBxdWVyeSBidWlsdCB2aWEgYE1vZGVsLnByZWxvYWQoLi4uKS5zZWxlY3QoLi4uKWAgb3IgYSByYXcgcHJlbG9hZCBzcGVjXG4gICAqIChzdHJpbmcgLyBhcnJheSAvIG5lc3RlZCBvYmplY3QpLiBBIHJlbGF0aW9uc2hpcCB0aGF0IGlzIGFscmVhZHkgcHJlbG9hZGVkXG4gICAqIHdpdGggYWxsIHRoZSByZXF1aXJlZCBjb2x1bW5zIHByZXNlbnQgaXMgbGVmdCB1bnRvdWNoZWQgdW5sZXNzIGBmb3JjZWAgaXNcbiAgICogc2V0LiBQcmVsb2FkaW5nIG9udG8gdGhlIHJlbGF0aW9uc2hpcCBjYWNoZSBsZXRzIGxhdGVyIGFjY2Vzc29ycyByZXVzZSB0aGVcbiAgICogbG9hZGVkIGRhdGEgaW5zdGVhZCBvZiBpc3N1aW5nIGlkZW50aWNhbCBxdWVyaWVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHF1ZXJ5T3JTcGVjIC0gUHJlbG9hZCBzb3VyY2UuXG4gICAqIEBwYXJhbSB7e2ZvcmNlPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcHJlbG9hZGluZyBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBwcmVsb2FkKHF1ZXJ5T3JTcGVjLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCBQcmVsb2FkZXIucHJlbG9hZChbdGhpc10sIHF1ZXJ5T3JTcGVjLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgbG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGF3YWl0IHJlbGF0aW9uc2hpcC5sb2FkKClcblxuICAgIHJldHVybiByZWxhdGlvbnNoaXAubG9hZGVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBvciBsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge3twcmVsb2FkVHJhbnNsYXRpb25zPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIExvYWQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBhc3luYyByZWxhdGlvbnNoaXBPckxvYWQocmVsYXRpb25zaGlwTmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICBsZXQgbG9hZGVkID0gYXdhaXQgcmVsYXRpb25zaGlwLmF1dG9sb2FkT3JMb2FkKClcblxuICAgIGlmIChvcHRpb25zLnByZWxvYWRUcmFuc2xhdGlvbnMpIHtcbiAgICAgIGxvYWRlZCA9IGF3YWl0IHRoaXMuX3ByZWxvYWRMb2FkZWRSZWxhdGlvbnNoaXBUcmFuc2xhdGlvbnMobG9hZGVkKVxuICAgIH1cblxuICAgIHJldHVybiBsb2FkZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVsb2FkcyB0cmFuc2xhdGlvbnMgb24gYSBsb2FkZWQgcmVsYXRpb25zaGlwIHRhcmdldCB3aGVuIGV4cGxpY2l0bHkgcmVxdWVzdGVkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBsb2FkZWQgLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVsYXRpb25zaGlwIHZhbHVlIGFmdGVyIHRyYW5zbGF0aW9uIHByZWxvYWQuXG4gICAqL1xuICBhc3luYyBfcHJlbG9hZExvYWRlZFJlbGF0aW9uc2hpcFRyYW5zbGF0aW9ucyhsb2FkZWQpIHtcbiAgICBpZiAoIWxvYWRlZCB8fCAhbG9hZGVkLmlzUGVyc2lzdGVkKCkgfHwgIWF3YWl0IGxvYWRlZC5nZXRNb2RlbENsYXNzKCkuaGFzVHJhbnNsYXRpb25zVGFibGUoKSkgcmV0dXJuIGxvYWRlZFxuXG4gICAgY29uc3QgdHJhbnNsYXRpb25zUmVsYXRpb25zaGlwID0gbG9hZGVkLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShcInRyYW5zbGF0aW9uc1wiKVxuXG4gICAgaWYgKHRyYW5zbGF0aW9uc1JlbGF0aW9uc2hpcC5nZXRQcmVsb2FkZWQoKSkgcmV0dXJuIGxvYWRlZFxuXG4gICAgYXdhaXQgbG9hZGVkLnByZWxvYWQoe3RyYW5zbGF0aW9uczoge319KVxuXG4gICAgcmV0dXJuIGxvYWRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dGFjaG1lbnQgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkQXR0YWNobWVudEhhbmRsZX0gLSBBdHRhY2htZW50IGhhbmRsZS5cbiAgICovXG4gIGdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpIHtcbiAgICBpZiAoIShhdHRhY2htZW50TmFtZSBpbiB0aGlzLl9hdHRhY2htZW50cykpIHtcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSlcblxuICAgICAgdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdID0gbmV3IFJlY29yZEF0dGFjaG1lbnRIYW5kbGUoe1xuICAgICAgICBtb2RlbDogdGhpcyxcbiAgICAgICAgbmFtZTogYXR0YWNobWVudE5hbWUsXG4gICAgICAgIHR5cGU6IGF0dGFjaG1lbnREZWZpbml0aW9uLnR5cGVcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBiZWxvbmdzLXRvLXJlbGF0aW9uc2hpcCB0byB0aGUgbW9kZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIFRoZSBuYW1lIG9mIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwU2NvcGVDYWxsYmFjayB8IG9iamVjdH0gW3Njb3BlT3JPcHRpb25zXSBUaGUgc2NvcGUgY2FsbGJhY2sgb3Igb3B0aW9ucyBmb3IgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSBUaGUgb3B0aW9ucyBmb3IgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICovXG4gIHN0YXRpYyBiZWxvbmdzVG8ocmVsYXRpb25zaGlwTmFtZSwgc2NvcGVPck9wdGlvbnMsIG9wdGlvbnMpIHtcbiAgICBjb25zdCB7c2NvcGUsIHJlbGF0aW9uc2hpcE9wdGlvbnN9ID0gdGhpcy5fbm9ybWFsaXplUmVsYXRpb25zaGlwQXJncyhzY29wZU9yT3B0aW9ucywgb3B0aW9ucylcblxuICAgIHRoaXMuX2RlZmluZVJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lLCBPYmplY3QuYXNzaWduKHt0eXBlOiBcImJlbG9uZ3NUb1wiLCBzY29wZX0sIHJlbGF0aW9uc2hpcE9wdGlvbnMpKVxuXG4gICAgaWYgKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChyZWxhdGlvbnNoaXBPcHRpb25zKT8uY291bnRlckNhY2hlKSB7XG4gICAgICB0aGlzLl9yZWdpc3RlckNvdW50ZXJDYWNoZUNhbGxiYWNrcyhyZWxhdGlvbnNoaXBOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlXSAtIFdoZXRoZXIgdGVuYW50LXN3aXRjaGVkIG1vZGVscyBtdXN0IHJlc29sdmUgYSB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjb25uZWN0aW9uLlxuICAgKi9cbiAgc3RhdGljIGNvbm5lY3Rpb24oe2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlID0gdHJ1ZSwgLi4ucmVzdEFyZ3N9ID0ge30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgY29uc3QgZGF0YWJhc2VQb29sID0gdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldERhdGFiYXNlUG9vbCh0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcih7ZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGV9KSlcbiAgICBjb25zdCBjb25uZWN0aW9uID0gZGF0YWJhc2VQb29sLmdldEN1cnJlbnRDb25uZWN0aW9uKClcblxuICAgIGlmICghY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29ubmVjdGlvbj9cIilcblxuICAgIHJldHVybiBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUuXG4gICAqIEB0ZW1wbGF0ZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBDcmVhdGVBdHRyaWJ1dGVzXG4gICAqIEB0ZW1wbGF0ZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQ8Q3JlYXRlQXR0cmlidXRlcz59IE1vZGVsXG4gICAqIEB0aGlzIHt7bmV3IChjaGFuZ2VzPzogQ3JlYXRlQXR0cmlidXRlcyk6IE1vZGVsfSAmIHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH1cbiAgICogQHBhcmFtIHtDcmVhdGVBdHRyaWJ1dGVzfSBbYXR0cmlidXRlc10gLSBBdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxNb2RlbD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY3JlYXRlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNyZWF0ZShhdHRyaWJ1dGVzKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge01vZGVsfSAqLyAobmV3IHRoaXMoYXR0cmlidXRlcykpXG5cbiAgICBhd2FpdCByZWNvcmQuc2F2ZSgpXG5cbiAgICByZXR1cm4gcmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gLSBUaGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN0YXRpYyBfZ2V0Q29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMuX2NvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRoaXMuX2NvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKVxuXG4gICAgICBpZiAoIXRoaXMuX2NvbmZpZ3VyYXRpb24pIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbiBoYXNuJ3QgYmVlbiBzZXQgKG1vZGVsIGNsYXNzIHByb2JhYmx5IGhhc24ndCBiZWVuIGluaXRpYWxpemVkKVwiKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9jb25maWd1cmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gLSBUaGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9nZXRDb25maWd1cmF0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fZ2V0Q29uZmlndXJhdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogQWRkcyBhIGhhcy1tYW55LXJlbGF0aW9uc2hpcCB0byB0aGUgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIFRoZSBuYW1lIG9mIHRoZSByZWxhdGlvbnNoaXAgKGUuZy4gXCJwb3N0c1wiKVxuICAgKiBAcGFyYW0ge1JlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2sgfCBvYmplY3R9IFtzY29wZU9yT3B0aW9uc10gVGhlIHNjb3BlIGNhbGxiYWNrIG9yIG9wdGlvbnMgZm9yIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gVGhlIG9wdGlvbnMgZm9yIHRoZSByZWxhdGlvbnNoaXAgKGUuZy4ge2NsYXNzTmFtZTogXCJQb3N0XCJ9KVxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgaGFzTWFueShyZWxhdGlvbnNoaXBOYW1lLCBzY29wZU9yT3B0aW9ucywgb3B0aW9ucykge1xuICAgIGNvbnN0IHtzY29wZSwgcmVsYXRpb25zaGlwT3B0aW9uc30gPSB0aGlzLl9ub3JtYWxpemVSZWxhdGlvbnNoaXBBcmdzKHNjb3BlT3JPcHRpb25zLCBvcHRpb25zKVxuXG4gICAgcmV0dXJuIHRoaXMuX2RlZmluZVJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lLCBPYmplY3QuYXNzaWduKHt0eXBlOiBcImhhc01hbnlcIiwgc2NvcGV9LCByZWxhdGlvbnNoaXBPcHRpb25zKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSYWlscy1zdHlsZSBkZWNsYXJhdGlvbiB0aGF0IHRoaXMgbW9kZWwgYWNjZXB0cyBuZXN0ZWQtYXR0cmlidXRlIHdyaXRlc1xuICAgKiBmb3IgYSByZWxhdGlvbnNoaXAgd2hlbiBzYXZlZCB0aHJvdWdoIGEgcGFyZW50LiBSZXF1aXJlZCDigJQgVmVsb2Npb3VzXG4gICAqIHdpbGwgcmVmdXNlIG5lc3RlZCB3cml0ZXMgZm9yIGFueSByZWxhdGlvbnNoaXAgbm90IGxpc3RlZCBoZXJlLCBldmVuXG4gICAqIGlmIGEgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgcGVybWl0cyB0aGVtLlxuICAgKlxuICAgKiBPcHRpb25zOlxuICAgKiAgIC0gYWxsb3dEZXN0cm95OiB3aGV0aGVyIGBfZGVzdHJveTogdHJ1ZWAgZW50cmllcyBhcmUgYWxsb3dlZC4gRGVmYXVsdCBmYWxzZS5cbiAgICogICAtIGxpbWl0OiBvcHRpb25hbCB1cHBlciBib3VuZCBvbiB0aGUgbnVtYmVyIG9mIG5lc3RlZCBlbnRyaWVzIHBlciByZXF1ZXN0LlxuICAgKiAgIC0gcmVqZWN0SWY6IG9wdGlvbmFsIHByZWRpY2F0ZSBgKGF0dHJpYnV0ZXMpID0+IGJvb2xlYW5gIHRoYXQgc2lsZW50bHkgc2tpcHMgZW50cmllcy5cbiAgICpcbiAgICogVXNhZ2U6XG4gICAqICAgY2xhc3MgUHJvamVjdCBleHRlbmRzIFJlY29yZCB7fVxuICAgKiAgIFByb2plY3QuaGFzTWFueShcInRhc2tzXCIpXG4gICAqICAgUHJvamVjdC5hY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcihcInRhc2tzXCIsIHthbGxvd0Rlc3Ryb3k6IHRydWV9KVxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lIG9uIHRoaXMgbW9kZWwuXG4gICAqIEBwYXJhbSB7e2FsbG93RGVzdHJveT86IGJvb2xlYW4sIGxpbWl0PzogbnVtYmVyLCByZWplY3RJZj86IChhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGJvb2xlYW59fSBbb3B0aW9uc10gLSBQb2xpY3kgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3IocmVsYXRpb25zaGlwTmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgaWYgKCFyZWxhdGlvbnNoaXBOYW1lIHx8IHR5cGVvZiByZWxhdGlvbnNoaXBOYW1lICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcmVsYXRpb25zaGlwTmFtZSBwYXNzZWQgdG8gYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3I6ICR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsIFwiX2FjY2VwdGVkTmVzdGVkQXR0cmlidXRlc1wiKSkge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge2FsbG93RGVzdHJveT86IGJvb2xlYW4sIGxpbWl0PzogbnVtYmVyLCByZWplY3RJZj86IChhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGJvb2xlYW59Pn0gKi9cbiAgICAgIHRoaXMuX2FjY2VwdGVkTmVzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7YWxsb3dEZXN0cm95PzogYm9vbGVhbiwgbGltaXQ/OiBudW1iZXIsIHJlamVjdElmPzogKGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gYm9vbGVhbn0+fSAqLyAodGhpcy5fYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzKVtyZWxhdGlvbnNoaXBOYW1lXSA9IHsuLi5vcHRpb25zfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWNjZXB0ZWQgbmVzdGVkIGF0dHJpYnV0ZXMgZm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7e2FsbG93RGVzdHJveT86IGJvb2xlYW4sIGxpbWl0PzogbnVtYmVyLCByZWplY3RJZj86IChhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGJvb2xlYW59IHwgbnVsbH0gLSBQb2xpY3kgZGVjbGFyZWQgdmlhIGBhY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcmAsIG9yIG51bGwgd2hlbiBub3QgYWNjZXB0ZWQuXG4gICAqL1xuICBzdGF0aWMgYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzRm9yKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzPy5bcmVsYXRpb25zaGlwTmFtZV0gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBoYXMtb25lLXJlbGF0aW9uc2hpcCB0byB0aGUgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIFRoZSBuYW1lIG9mIHRoZSByZWxhdGlvbnNoaXAgKGUuZy4gXCJwb3N0XCIpXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwU2NvcGVDYWxsYmFjayB8IG9iamVjdH0gW3Njb3BlT3JPcHRpb25zXSBUaGUgc2NvcGUgY2FsbGJhY2sgb3Igb3B0aW9ucyBmb3IgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSBUaGUgb3B0aW9ucyBmb3IgdGhlIHJlbGF0aW9uc2hpcCAoZS5nLiB7Y2xhc3NOYW1lOiBcIlBvc3RcIn0pXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBoYXNPbmUocmVsYXRpb25zaGlwTmFtZSwgc2NvcGVPck9wdGlvbnMsIG9wdGlvbnMpIHtcbiAgICBjb25zdCB7c2NvcGUsIHJlbGF0aW9uc2hpcE9wdGlvbnN9ID0gdGhpcy5fbm9ybWFsaXplUmVsYXRpb25zaGlwQXJncyhzY29wZU9yT3B0aW9ucywgb3B0aW9ucylcblxuICAgIHJldHVybiB0aGlzLl9kZWZpbmVSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSwgT2JqZWN0LmFzc2lnbih7dHlwZTogXCJoYXNPbmVcIiwgc2NvcGV9LCByZWxhdGlvbnNoaXBPcHRpb25zKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmluZSBhdHRhY2htZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXR0YWNobWVudCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MuZHJpdmVyXSAtIEF0dGFjaG1lbnQgZHJpdmVyIG5hbWUsIGNsYXNzLCBvciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtBdHRhY2htZW50U3luY0NvbmZpZ3VyYXRpb259IFthcmdzLnN5bmNdIC0gQ2xpZW50LXNhZmUgc3luY2hyb25pemVkIGFzc2V0IHBvbGljeS5cbiAgICogQHBhcmFtIHtcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9IGFyZ3MudHlwZSAtIEF0dGFjaG1lbnQgdHlwZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIF9kZWZpbmVBdHRhY2htZW50KGF0dGFjaG1lbnROYW1lLCB7ZHJpdmVyLCBzeW5jLCB0eXBlfSkge1xuICAgIGlmICghYXR0YWNobWVudE5hbWUgfHwgdHlwZW9mIGF0dGFjaG1lbnROYW1lICE9PSBcInN0cmluZ1wiKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYXR0YWNobWVudCBuYW1lOiAke2F0dGFjaG1lbnROYW1lfWApXG4gICAgaWYgKGF0dGFjaG1lbnROYW1lIGluIHRoaXMuZ2V0QXR0YWNobWVudHNNYXAoKSkgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50ICR7YXR0YWNobWVudE5hbWV9IGFscmVhZHkgZXhpc3RzYClcblxuICAgIGlmIChzeW5jKSB7XG4gICAgICBjb25zdCB7ZmV0Y2gsIG9mZmxpbmVSZXF1aXJlbWVudCwgcmV0ZW50aW9uLCAuLi5yZXN0U3luY30gPSBzeW5jXG5cbiAgICAgIHJlc3RBcmdzRXJyb3IocmVzdFN5bmMpXG5cbiAgICAgIGlmIChmZXRjaCAhPT0gXCJlYWdlclwiICYmIGZldGNoICE9PSBcIm9uLWRlbWFuZFwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCAke2F0dGFjaG1lbnROYW1lfSBzeW5jIGZldGNoIG11c3QgYmUgZWFnZXIgb3Igb24tZGVtYW5kYClcbiAgICAgIH1cbiAgICAgIGlmIChvZmZsaW5lUmVxdWlyZW1lbnQgIT09IFwib3B0aW9uYWxcIiAmJiBvZmZsaW5lUmVxdWlyZW1lbnQgIT09IFwicmVxdWlyZWRcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgJHthdHRhY2htZW50TmFtZX0gb2ZmbGluZSByZXF1aXJlbWVudCBtdXN0IGJlIG9wdGlvbmFsIG9yIHJlcXVpcmVkYClcbiAgICAgIH1cbiAgICAgIGlmIChyZXRlbnRpb24gIT09IFwiZHVyYWJsZVwiICYmIHJldGVudGlvbiAhPT0gXCJldmljdGFibGVcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgJHthdHRhY2htZW50TmFtZX0gc3luYyByZXRlbnRpb24gbXVzdCBiZSBkdXJhYmxlIG9yIGV2aWN0YWJsZWApXG4gICAgICB9XG4gICAgICBpZiAob2ZmbGluZVJlcXVpcmVtZW50ID09PSBcInJlcXVpcmVkXCIgJiYgcmV0ZW50aW9uICE9PSBcImR1cmFibGVcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgJHthdHRhY2htZW50TmFtZX0gcmVxdWlyZWQgb2ZmbGluZSBhc3NldHMgbXVzdCB1c2UgZHVyYWJsZSByZXRlbnRpb25gKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuZ2V0QXR0YWNobWVudHNNYXAoKVthdHRhY2htZW50TmFtZV0gPSB7ZHJpdmVyLCBzeW5jLCB0eXBlfVxuXG4gICAgY29uc3QgcHJvdG90eXBlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcy5wcm90b3R5cGUpKVxuXG4gICAgcHJvdG90eXBlW2F0dGFjaG1lbnROYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHRoaXMuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSlcbiAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKGF0dGFjaG1lbnROYW1lKX1gXSA9IGZ1bmN0aW9uKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIG5ld1ZhbHVlKSB7XG4gICAgICB0aGlzLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpLnF1ZXVlQXR0YWNoKG5ld1ZhbHVlKVxuICAgICAgcmV0dXJuIG5ld1ZhbHVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBzaW5nbGUgYXR0YWNobWVudCBoZWxwZXIgdG8gdGhlIG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7e2RyaXZlcj86IHN0cmluZyB8IEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc3luYz86IEF0dGFjaG1lbnRTeW5jQ29uZmlndXJhdGlvbn19IFthcmdzXSAtIEF0dGFjaG1lbnQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGhhc09uZUF0dGFjaG1lbnQoYXR0YWNobWVudE5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIHRoaXMuX2RlZmluZUF0dGFjaG1lbnQoYXR0YWNobWVudE5hbWUsIHtkcml2ZXI6IGFyZ3MuZHJpdmVyLCBzeW5jOiBhcmdzLnN5bmMsIHR5cGU6IFwiaGFzT25lXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBjb2xsZWN0aW9uIGF0dGFjaG1lbnQgaGVscGVyIHRvIHRoZSBtb2RlbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3tkcml2ZXI/OiBzdHJpbmcgfCBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHN5bmM/OiBBdHRhY2htZW50U3luY0NvbmZpZ3VyYXRpb259fSBbYXJnc10gLSBBdHRhY2htZW50IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBoYXNNYW55QXR0YWNobWVudHMoYXR0YWNobWVudE5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIHRoaXMuX2RlZmluZUF0dGFjaG1lbnQoYXR0YWNobWVudE5hbWUsIHtkcml2ZXI6IGFyZ3MuZHJpdmVyLCBzeW5jOiBhcmdzLnN5bmMsIHR5cGU6IFwiaGFzTWFueVwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGh1bWFuIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBodW1hbiBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBodW1hbkF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSkge1xuICAgIGNvbnN0IG1vZGVsTmFtZUtleSA9IGluZmxlY3Rpb24udW5kZXJzY29yZSh0aGlzLmdldE1vZGVsTmFtZSgpKVxuXG4gICAgcmV0dXJuIHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRUcmFuc2xhdG9yKCkoYHZlbG9jaW91cy5kYXRhYmFzZS5yZWNvcmQuYXR0cmlidXRlcy4ke21vZGVsTmFtZUtleX0uJHthdHRyaWJ1dGVOYW1lfWAsIHtkZWZhdWx0VmFsdWU6IGluZmxlY3Rpb24uY2FtZWxpemUoYXR0cmlidXRlTmFtZSl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGRhdGFiYXNlIHR5cGUuXG4gICAqL1xuICBzdGF0aWMgZ2V0RGF0YWJhc2VUeXBlKCkge1xuICAgIGlmICghdGhpcy5fZGF0YWJhc2VUeXBlKSB0aHJvdyBuZXcgRXJyb3IoXCJEYXRhYmFzZSB0eXBlIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX2RhdGFiYXNlVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGVhZ2VyIGxvYWQgcmVjb3JkIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGVhZ2VyTG9hZFJlY29yZE1ldGFkYXRhIC0gV2hldGhlciByZXF1aXJlLWNvbnRleHQgaW5pdGlhbGl6YXRpb24gc2hvdWxkIGxvYWQgdGFibGUgbWV0YWRhdGEgZm9yIHRoaXMgbW9kZWwuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzZXRFYWdlckxvYWRSZWNvcmRNZXRhZGF0YShlYWdlckxvYWRSZWNvcmRNZXRhZGF0YSkge1xuICAgIHRoaXMuX2VhZ2VyTG9hZFJlY29yZE1ldGFkYXRhID0gZWFnZXJMb2FkUmVjb3JkTWV0YWRhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBlYWdlciBsb2FkIHJlY29yZCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZXF1aXJlLWNvbnRleHQgaW5pdGlhbGl6YXRpb24gc2hvdWxkIGxvYWQgdGFibGUgbWV0YWRhdGEgZm9yIHRoaXMgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgZ2V0RWFnZXJMb2FkUmVjb3JkTWV0YWRhdGEoKSB7XG4gICAgaWYgKHRoaXMuX2VhZ2VyTG9hZFJlY29yZE1ldGFkYXRhID09PSB1bmRlZmluZWQpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gdGhpcy5fZWFnZXJMb2FkUmVjb3JkTWV0YWRhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc2V0IHJlY29yZCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHJlc2V0UmVjb3JkTWV0YWRhdGEoKSB7XG4gICAgdGhpcy5faW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuX2RhdGFiYXNlVHlwZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3RhYmxlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fY29sdW1ucyA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2NvbHVtbnNBc0hhc2ggPSB1bmRlZmluZWRcbiAgICB0aGlzLl9jb2x1bW5OYW1lcyA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2NvbHVtblR5cGVCeU5hbWUgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9hdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSA9IHVuZGVmaW5lZFxuXG4gICAgaWYgKCF0aGlzLl9yZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MpIHRoaXMuY2xlYXJSZWNvcmRNZXRhZGF0YVZhbHVlcygpXG4gIH1cblxuICAvKipcbiAgICogU3RhdGljIGZpZWxkcyB0aGF0IGJlbG9uZyB0byBvbmUgcGh5c2ljYWwgZGF0YWJhc2Uvc2NoZW1hIGdlbmVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBNZXRhZGF0YSBwcm9wZXJ0eSBuYW1lcy5cbiAgICovXG4gIHN0YXRpYyByZWNvcmRNZXRhZGF0YVByb3BlcnR5TmFtZXMoKSB7XG4gICAgcmV0dXJuIHJlY29yZE1ldGFkYXRhUHJvcGVydHlOYW1lc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIG9uZSBvcGVyYXRpb24tYm91bmQgbWV0YWRhdGEgZmllbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRhZGF0YUtleSAtIFBoeXNpY2FsIGRhdGFiYXNlIGFuZCBzY2hlbWEgZ2VuZXJhdGlvbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwcm9wZXJ0eSAtIFN0YXRpYyBtZXRhZGF0YSBwcm9wZXJ0eS5cbiAgICogQHJldHVybnMge1JlY29yZE1ldGFkYXRhVmFsdWV9IC0gU3RvcmVkIG1ldGFkYXRhIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHJlY29yZE1ldGFkYXRhVmFsdWUobWV0YWRhdGFLZXksIHByb3BlcnR5KSB7XG4gICAgcmV0dXJuIHJlY29yZE1ldGFkYXRhVmFsdWVzRm9yKHRoaXMpLmdldChtZXRhZGF0YUtleSk/LmdldChwcm9wZXJ0eSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZXMgb25lIG9wZXJhdGlvbi1ib3VuZCBtZXRhZGF0YSBmaWVsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGFkYXRhS2V5IC0gUGh5c2ljYWwgZGF0YWJhc2UgYW5kIHNjaGVtYSBnZW5lcmF0aW9uIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3BlcnR5IC0gU3RhdGljIG1ldGFkYXRhIHByb3BlcnR5LlxuICAgKiBAcGFyYW0ge1JlY29yZE1ldGFkYXRhVmFsdWV9IHZhbHVlIC0gTWV0YWRhdGEgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHNldFJlY29yZE1ldGFkYXRhVmFsdWUobWV0YWRhdGFLZXksIHByb3BlcnR5LCB2YWx1ZSkge1xuICAgIGxldCB2YWx1ZXMgPSByZWNvcmRNZXRhZGF0YVZhbHVlc0Zvcih0aGlzKS5nZXQobWV0YWRhdGFLZXkpXG5cbiAgICBpZiAoIXZhbHVlcykge1xuICAgICAgdmFsdWVzID0gbmV3IE1hcCgpXG4gICAgICByZWNvcmRNZXRhZGF0YVZhbHVlc0Zvcih0aGlzKS5zZXQobWV0YWRhdGFLZXksIHZhbHVlcylcbiAgICB9XG5cbiAgICB2YWx1ZXMuc2V0KHByb3BlcnR5LCB2YWx1ZSlcbiAgfVxuXG4gIC8qKiBDbGVhcnMgZXZlcnkgdGVuYW50L2dlbmVyYXRpb24gbWV0YWRhdGEgc25hcHNob3QgZm9yIHRoaXMgbW9kZWwuICovXG4gIHN0YXRpYyBjbGVhclJlY29yZE1ldGFkYXRhVmFsdWVzKCkge1xuICAgIHJlY29yZE1ldGFkYXRhVmFsdWVzQnlNb2RlbC5kZWxldGUodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgc25hcHNob3RzIHdob3NlIGtleSBiZWxvbmdzIHRvIG9uZSBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpdHkgLSBMb2dpY2FsIGlkZW50aWZpZXIgcGx1cyBwb29sIHJldXNlIGtleS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgY2xlYXJSZWNvcmRNZXRhZGF0YVZhbHVlc0ZvckRhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSkge1xuICAgIGNvbnN0IHZhbHVlcyA9IHJlY29yZE1ldGFkYXRhVmFsdWVzQnlNb2RlbC5nZXQodGhpcylcblxuICAgIGlmICghdmFsdWVzKSByZXR1cm5cblxuICAgIGNvbnN0IG1ldGFkYXRhUHJlZml4ID0gYCR7ZGF0YWJhc2VJZGVudGl0eS5sZW5ndGh9OiR7ZGF0YWJhc2VJZGVudGl0eX06YFxuXG4gICAgZm9yIChjb25zdCBtZXRhZGF0YUtleSBvZiB2YWx1ZXMua2V5cygpKSB7XG4gICAgICBpZiAobWV0YWRhdGFLZXkuc3RhcnRzV2l0aChtZXRhZGF0YVByZWZpeCkpIHZhbHVlcy5kZWxldGUobWV0YWRhdGFLZXkpXG4gICAgfVxuXG4gICAgaWYgKHZhbHVlcy5zaXplID09PSAwKSByZWNvcmRNZXRhZGF0YVZhbHVlc0J5TW9kZWwuZGVsZXRlKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIHRoZSBtb2RlbCBjbGFzcyB3aXRoIGEgY29uZmlndXJhdGlvbiB3aXRob3V0IGxvYWRpbmcgdGFibGUgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgcmVnaXN0ZXJSZWNvcmRDbGFzcyh7Y29uZmlndXJhdGlvbiwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKGBObyBjb25maWd1cmF0aW9uIGdpdmVuIGZvciAke3RoaXMubmFtZX1gKVxuXG4gICAgdGhpcy5yZXNldFJlY29yZE1ldGFkYXRhKClcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5fcmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzIHx8IHRoaXNcblxuICAgIG1vZGVsQ2xhc3MuX2NvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgY29uZmlndXJhdGlvbi5yZWdpc3Rlck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUgcmVjb3JkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2FyZ3MuY29ubmVjdGlvbl0gLSBFeHBsaWNpdCBtZXRhZGF0YSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGluaXRpYWxpemVSZWNvcmQoe2NvbmZpZ3VyYXRpb24sIGNvbm5lY3Rpb246IGV4cGxpY2l0Q29ubmVjdGlvbiwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKGBObyBjb25maWd1cmF0aW9uIGdpdmVuIGZvciAke3RoaXMubmFtZX1gKVxuXG4gICAgdGhpcy5yZWdpc3RlclJlY29yZENsYXNzKHtjb25maWd1cmF0aW9ufSlcbiAgICBjb25zdCBjb25uZWN0aW9uID0gZXhwbGljaXRDb25uZWN0aW9uIHx8IHRoaXMuY29ubmVjdGlvbih7ZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGU6IGZhbHNlfSlcblxuICAgIHRoaXMuX2RhdGFiYXNlVHlwZSA9IGNvbm5lY3Rpb24uZ2V0VHlwZSgpXG5cbiAgICB0aGlzLl90YWJsZSA9IGF3YWl0IGNvbm5lY3Rpb24uZ2V0VGFibGVCeU5hbWUodGhpcy50YWJsZU5hbWUoKSlcbiAgICB0aGlzLl9jb2x1bW5zID0gYXdhaXQgdGhpcy5fZ2V0VGFibGUoKS5nZXRDb2x1bW5zKClcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICB0aGlzLl9jb2x1bW5zQXNIYXNoID0ge31cblxuICAgIGNvbnN0IGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSB0aGlzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUgPSB0aGlzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuICAgIGNvbnN0IHByb3RvdHlwZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMucHJvdG90eXBlKSlcblxuICAgIGZvciAoY29uc3QgY29sdW1uIG9mIHRoaXMuX2NvbHVtbnMpIHtcbiAgICAgIHRoaXMuX2NvbHVtbnNBc0hhc2hbY29sdW1uLmdldE5hbWUoKV0gPSBjb2x1bW5cblxuICAgICAgY29uc3QgZGVidXJyZWRDb2x1bW5OYW1lID0gZGVidXJyQ29sdW1uTmFtZShjb2x1bW4uZ2V0TmFtZSgpKVxuICAgICAgY29uc3QgY2FtZWxpemVkQ29sdW1uTmFtZSA9IGluZmxlY3Rpb24uY2FtZWxpemUoZGVidXJyZWRDb2x1bW5OYW1lLCB0cnVlKVxuICAgICAgY29uc3QgY2FtZWxpemVkQ29sdW1uTmFtZUJpZ0ZpcnN0ID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShkZWJ1cnJlZENvbHVtbk5hbWUpXG5cbiAgICAgIGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVbY2FtZWxpemVkQ29sdW1uTmFtZV0gPSBjb2x1bW4uZ2V0TmFtZSgpXG4gICAgICBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lW2NvbHVtbi5nZXROYW1lKCldID0gY2FtZWxpemVkQ29sdW1uTmFtZVxuXG4gICAgICBpZiAoIShjYW1lbGl6ZWRDb2x1bW5OYW1lIGluIHByb3RvdHlwZSkpIHtcbiAgICAgICAgcHJvdG90eXBlW2NhbWVsaXplZENvbHVtbk5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShjYW1lbGl6ZWRDb2x1bW5OYW1lKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICghKGBzZXQke2NhbWVsaXplZENvbHVtbk5hbWVCaWdGaXJzdH1gIGluIHByb3RvdHlwZSkpIHtcbiAgICAgICAgcHJvdG90eXBlW2BzZXQke2NhbWVsaXplZENvbHVtbk5hbWVCaWdGaXJzdH1gXSA9IGZ1bmN0aW9uKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIG5ld1ZhbHVlKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX3NldENvbHVtbkF0dHJpYnV0ZShjYW1lbGl6ZWRDb2x1bW5OYW1lLCBuZXdWYWx1ZSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoIShgaGFzJHtjYW1lbGl6ZWRDb2x1bW5OYW1lQmlnRmlyc3R9YCBpbiBwcm90b3R5cGUpKSB7XG4gICAgICAgIHByb3RvdHlwZVtgaGFzJHtjYW1lbGl6ZWRDb2x1bW5OYW1lQmlnRmlyc3R9YF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuICAgICAgICAgIGNvbnN0IHZhbHVlID0gZHluYW1pY1RoaXNbY2FtZWxpemVkQ29sdW1uTmFtZV0oKVxuXG4gICAgICAgICAgcmV0dXJuIHRoaXMuX2hhc0F0dHJpYnV0ZSh2YWx1ZSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2RlZmluZVRyYW5zbGF0aW9uTWV0aG9kcyhjb25uZWN0aW9uKVxuICAgIGF3YWl0IGluaXRpYWxpemVBdWRpdGluZyh0aGlzKVxuICAgIHRoaXMuX2luaXRpYWxpemVkID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemVzIHRoZSBtb2RlbCBjbGFzcyB0aGUgZmlyc3QgdGltZSBhbiBhc3luYyByZWNvcmQgQVBJIG5lZWRzIHRhYmxlXG4gICAqIG1ldGFkYXRhLiBDb25jdXJyZW50IGNhbGxlcnMgc2hhcmUgdGhlIHNhbWUgaW5pdGlhbGl6YXRpb24gcHJvbWlzZSwgYW5kIGFcbiAgICogZmFpbGVkIGluaXRpYWxpemF0aW9uIGNhbiBiZSByZXRyaWVkIGJ5IGEgbGF0ZXIgY2FsbC5cbiAgICogQHBhcmFtIHt7Y29uZmlndXJhdGlvbj86IGltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgY29ubmVjdGlvbj86IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fX0gW2FyZ3NdIC0gT3B0aW9uYWwgY29uZmlndXJhdGlvbiBhbmQgZXhwbGljaXQgbWV0YWRhdGEgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgbW9kZWwgY2xhc3MgaXMgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZW5zdXJlSW5pdGlhbGl6ZWQoYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge2NvbmZpZ3VyYXRpb24sIGNvbm5lY3Rpb24sIC4uLnJlc3RBcmdzfSA9IGFyZ3NcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZWQpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlKSB7XG4gICAgICBhd2FpdCB0aGlzLl9pbml0aWFsaXplUmVjb3JkUHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZWRDb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvbiB8fCB0aGlzLl9jb25maWd1cmF0aW9uIHx8IENvbmZpZ3VyYXRpb24uY3VycmVudCgpXG5cbiAgICBjb25zdCBpbml0aWFsaXplUmVjb3JkUHJvbWlzZSA9IHRoaXMuaW5pdGlhbGl6ZVJlY29yZCh7Y29uZmlndXJhdGlvbjogcmVzb2x2ZWRDb25maWd1cmF0aW9uLCBjb25uZWN0aW9ufSlcblxuICAgIHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlID0gaW5pdGlhbGl6ZVJlY29yZFByb21pc2VcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBpbml0aWFsaXplUmVjb3JkUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVJlY29yZFByb21pc2UgPT09IGluaXRpYWxpemVSZWNvcmRQcm9taXNlKSB7XG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlID0gbnVsbFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGF0dHJpYnV0ZS5cbiAgICovXG4gIF9oYXNBdHRyaWJ1dGUodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09IFwic3RyaW5nXCIpIHtcbiAgICAgIHZhbHVlID0gdmFsdWUudHJpbSgpXG4gICAgfVxuXG4gICAgaWYgKHZhbHVlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgaW5pdGlhbGl6ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBzdGF0aWMgaXNJbml0aWFsaXplZCgpIHtcbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZWQpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2VydCBoYXMgYmVlbiBpbml0aWFsaXplZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIF9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKSB7XG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVkKSByZXR1cm5cblxuICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9IHVzZWQgYmVmb3JlIGluaXRpYWxpemF0aW9uLiBDYWxsICR7dGhpcy5uYW1lfS5pbml0aWFsaXplUmVjb3JkKC4uLikgb3IgY29uZmlndXJhdGlvbi5pbml0aWFsaXplKCkuYClcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWZpbmVzIHRyYW5zbGF0aW9uIGFjY2Vzc29ycyBhbmQgaW5pdGlhbGl6ZXMgdGhlIGdlbmVyYXRlZCB0cmFuc2xhdGlvblxuICAgKiBjbGFzcyB0aHJvdWdoIHRoZSBzYW1lIG1ldGFkYXRhIGNvbm5lY3Rpb24gYXMgdGhlIHRyYW5zbGF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBNZXRhZGF0YSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRyYW5zbGF0aW9uIG1ldGFkYXRhIGlzIHJlYWR5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIF9kZWZpbmVUcmFuc2xhdGlvbk1ldGhvZHMoY29ubmVjdGlvbikge1xuICAgIGlmICh0aGlzLl90cmFuc2xhdGlvbnMgJiYgT2JqZWN0LmtleXModGhpcy5fdHJhbnNsYXRpb25zKS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBsb2NhbGVzID0gdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldExvY2FsZXMoKVxuXG4gICAgICBpZiAoIWxvY2FsZXMpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsZXMgaGFzbid0IGJlZW4gc2V0IGluIHRoZSBjb25maWd1cmF0aW9uXCIpXG5cbiAgICAgIGNvbnN0IFRyYW5zbGF0aW9uQ2xhc3MgPSB0aGlzLmdldFRyYW5zbGF0aW9uQ2xhc3MoKVxuICAgICAgY29uc3QgQm91bmRUcmFuc2xhdGlvbkNsYXNzID0gdGhpcy5fcmVjb3JkTWV0YWRhdGFCaW5kZXIgPyB0aGlzLl9yZWNvcmRNZXRhZGF0YUJpbmRlcihUcmFuc2xhdGlvbkNsYXNzKSA6IFRyYW5zbGF0aW9uQ2xhc3NcblxuICAgICAgYXdhaXQgQm91bmRUcmFuc2xhdGlvbkNsYXNzLmluaXRpYWxpemVSZWNvcmQoe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIGNvbm5lY3Rpb25cbiAgICAgIH0pXG5cbiAgICAgIGZvciAoY29uc3QgbmFtZSBpbiB0aGlzLl90cmFuc2xhdGlvbnMpIHtcbiAgICAgICAgY29uc3QgbmFtZUNhbWVsaXplZCA9IGluZmxlY3Rpb24uY2FtZWxpemUobmFtZSlcbiAgICAgICAgY29uc3Qgc2V0dGVyTWV0aG9kTmFtZSA9IGBzZXQke25hbWVDYW1lbGl6ZWR9YFxuICAgICAgICBjb25zdCBwcm90b3R5cGUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzLnByb3RvdHlwZSkpXG5cbiAgICAgICAgcHJvdG90eXBlW25hbWVdID0gZnVuY3Rpb24gZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZSgpIHtcbiAgICAgICAgICBjb25zdCBsb2NhbGUgPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0TG9jYWxlKClcblxuICAgICAgICAgIHJldHVybiB0aGlzLl9nZXRUcmFuc2xhdGVkQXR0cmlidXRlV2l0aEZhbGxiYWNrKG5hbWUsIGxvY2FsZSlcbiAgICAgICAgfVxuXG4gICAgICAgIHByb3RvdHlwZVtgaGFzJHtuYW1lQ2FtZWxpemVkfWBdID0gZnVuY3Rpb24gaGFzVHJhbnNsYXRlZEF0dHJpYnV0ZSgpIHtcbiAgICAgICAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGR5bmFtaWNUaGlzW25hbWVdXG5cbiAgICAgICAgICBpZiAodHlwZW9mIGNhbmRpZGF0ZSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gY2FuZGlkYXRlLmJpbmQodGhpcykoKVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5faGFzQXR0cmlidXRlKHZhbHVlKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGNhbmRpZGF0ZSB0byBiZSBhIGZ1bmN0aW9uIGJ1dCBpdCB3YXM6ICR7dHlwZW9mIGNhbmRpZGF0ZX1gKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHByb3RvdHlwZVtzZXR0ZXJNZXRob2ROYW1lXSA9IGZ1bmN0aW9uIHNldFRyYW5zbGF0ZWRBdHRyaWJ1dGUoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gbmV3VmFsdWUpIHtcbiAgICAgICAgICBjb25zdCBsb2NhbGUgPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0TG9jYWxlKClcblxuICAgICAgICAgIHJldHVybiB0aGlzLl9zZXRUcmFuc2xhdGVkQXR0cmlidXRlKG5hbWUsIGxvY2FsZSwgbmV3VmFsdWUpXG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IGxvY2FsZSBvZiBsb2NhbGVzKSB7XG4gICAgICAgICAgY29uc3QgbG9jYWxlQ2FtZWxpemVkID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShsb2NhbGUpXG4gICAgICAgICAgY29uc3QgZ2V0dGVyTWV0aG9kTmFtZUxvY2FsaXplZCA9IGAke25hbWV9JHtsb2NhbGVDYW1lbGl6ZWR9YFxuICAgICAgICAgIGNvbnN0IHNldHRlck1ldGhvZE5hbWVMb2NhbGl6ZWQgPSBgJHtzZXR0ZXJNZXRob2ROYW1lfSR7bG9jYWxlQ2FtZWxpemVkfWBcbiAgICAgICAgICBjb25zdCBoYXNNZXRob2ROYW1lTG9jYWxpemVkID0gYGhhcyR7aW5mbGVjdGlvbi5jYW1lbGl6ZShuYW1lKX0ke2xvY2FsZUNhbWVsaXplZH1gXG5cbiAgICAgICAgICBwcm90b3R5cGVbZ2V0dGVyTWV0aG9kTmFtZUxvY2FsaXplZF0gPSBmdW5jdGlvbiBnZXRUcmFuc2xhdGVkQXR0cmlidXRlV2l0aExvY2FsZSgpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9nZXRUcmFuc2xhdGVkQXR0cmlidXRlKG5hbWUsIGxvY2FsZSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwcm90b3R5cGVbc2V0dGVyTWV0aG9kTmFtZUxvY2FsaXplZF0gPSBmdW5jdGlvbiBzZXRUcmFuc2xhdGVkQXR0cmlidXRlV2l0aExvY2FsZSgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBuZXdWYWx1ZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGUobmFtZSwgbG9jYWxlLCBuZXdWYWx1ZSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwcm90b3R5cGVbaGFzTWV0aG9kTmFtZUxvY2FsaXplZF0gPSBmdW5jdGlvbiBoYXNUcmFuc2xhdGVkQXR0cmlidXRlKCkge1xuICAgICAgICAgICAgY29uc3QgZHluYW1pY1RoaXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcbiAgICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGR5bmFtaWNUaGlzW2dldHRlck1ldGhvZE5hbWVMb2NhbGl6ZWRdXG5cbiAgICAgICAgICAgIGlmICh0eXBlb2YgY2FuZGlkYXRlID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgICBjb25zdCB2YWx1ZSA9IGNhbmRpZGF0ZS5iaW5kKHRoaXMpKClcblxuICAgICAgICAgICAgICByZXR1cm4gdGhpcy5faGFzQXR0cmlidXRlKHZhbHVlKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBjYW5kaWRhdGUgdG8gYmUgYSBmdW5jdGlvbiBidXQgaXQgd2FzOiAke3R5cGVvZiBjYW5kaWRhdGV9YClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJlZCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBjb25maWd1cmVkIG5vbi10ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIHN0YXRpYyBnZXRDb25maWd1cmVkRGF0YWJhc2VJZGVudGlmaWVyKCkge1xuICAgIHJldHVybiB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIgfHwgXCJkZWZhdWx0XCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZV0gLSBXaGV0aGVyIHRlbmFudC1zd2l0Y2hlZCBtb2RlbHMgbXVzdCByZXNvbHZlIGEgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJncy50ZW5hbnRdIC0gRXhwbGljaXQgdGVuYW50IGRlc2NyaXB0b3IgaW5zdGVhZCBvZiB0aGUgYW1iaWVudCB0ZW5hbnQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBzdGF0aWMgZ2V0RGF0YWJhc2VJZGVudGlmaWVyKHtlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZSA9IHRydWUsIHRlbmFudCA9IEN1cnJlbnQudGVuYW50KCksIC4uLnJlc3RBcmdzfSA9IHt9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGNvbnN0IHRlbmFudERhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKHRlbmFudClcblxuICAgIGlmICh0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICAgIGlmIChcbiAgICAgICAgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGUgJiZcbiAgICAgICAgdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcygpICYmXG4gICAgICAgICF0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUodGVuYW50RGF0YWJhc2VJZGVudGlmaWVyLCB0ZW5hbnQpXG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgbmV3IFRlbmFudERhdGFiYXNlU2NvcGVFcnJvcihcbiAgICAgICAgICBgJHt0aGlzLmdldE1vZGVsTmFtZSgpfSByZXNvbHZlZCB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciAke0pTT04uc3RyaW5naWZ5KHRlbmFudERhdGFiYXNlSWRlbnRpZmllcil9IGJ1dCB0aGF0IGRhdGFiYXNlIGlkZW50aWZpZXIgaXMgbm90IGFjdGl2ZSBmb3IgdGhlIGN1cnJlbnQgdGVuYW50LiBXcmFwIHRoZSBtb2RlbCBxdWVyeSBpbiBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQoLi4uKSBvciBzZXQgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzOiBmYWxzZSB0byBhbGxvdyBsZWdhY3kgZmFsbGJhY2sgYmVoYXZpb3IuYCxcbiAgICAgICAgICB7bW9kZWxOYW1lOiB0aGlzLmdldE1vZGVsTmFtZSgpfVxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJcbiAgICB9XG5cbiAgICBpZiAoZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGUgJiYgdGhpcy5fdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIgJiYgdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcygpKSB7XG4gICAgICB0aHJvdyBuZXcgVGVuYW50RGF0YWJhc2VTY29wZUVycm9yKFxuICAgICAgICBgJHt0aGlzLmdldE1vZGVsTmFtZSgpfSBpcyBjb25maWd1cmVkIHdpdGggc3dpdGNoZXNUZW5hbnREYXRhYmFzZSguLi4pIGJ1dCBubyB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciByZXNvbHZlZCBmb3IgdGhlIGN1cnJlbnQgdGVuYW50LiBXcmFwIHRoZSBtb2RlbCBxdWVyeSBpbiBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQoLi4uKSBvciBzZXQgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzOiBmYWxzZSB0byBhbGxvdyBsZWdhY3kgZmFsbGJhY2sgYmVoYXZpb3IuYCxcbiAgICAgICAge21vZGVsTmFtZTogdGhpcy5nZXRNb2RlbE5hbWUoKX1cbiAgICAgIClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5nZXRDb25maWd1cmVkRGF0YWJhc2VJZGVudGlmaWVyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHNldERhdGFiYXNlSWRlbnRpZmllcihkYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhIHRlbmFudC1hd2FyZSBkYXRhYmFzZSBpZGVudGlmaWVyIHJlc29sdmVyIGZvciB0aGlzIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8ICgoYXJnczoge21vZGVsQ2xhc3M6IHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCwgdGVuYW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwgfCB1bmRlZmluZWR9KSA9PiBzdHJpbmcgfCB1bmRlZmluZWQpfSBkYXRhYmFzZUlkZW50aWZpZXJPclJlc29sdmVyIC0gU3RhdGljIGlkZW50aWZpZXIgb3IgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzd2l0Y2hlc1RlbmFudERhdGFiYXNlKGRhdGFiYXNlSWRlbnRpZmllck9yUmVzb2x2ZXIpIHtcbiAgICB0aGlzLl90ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlciA9IGRhdGFiYXNlSWRlbnRpZmllck9yUmVzb2x2ZXJcblxuICAgIGlmICh0aGlzLl90cmFuc2xhdGlvbkNsYXNzKSB7XG4gICAgICBjb25zdCB0cmFuc2xhdGVkTW9kZWxDbGFzcyA9IHRoaXNcblxuICAgICAgdGhpcy5fdHJhbnNsYXRpb25DbGFzcy5zd2l0Y2hlc1RlbmFudERhdGFiYXNlKCh7dGVuYW50fSkgPT4gdHJhbnNsYXRlZE1vZGVsQ2xhc3MuZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKHRlbmFudCkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgbW9kZWwgcmVzb2x2ZXMgaXRzIGRhdGFiYXNlIGZyb20gdGhlIGN1cnJlbnQgdGVuYW50LlxuICAgKi9cbiAgc3RhdGljIGhhc1RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKCkge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMuX3RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbdGVuYW50XSAtIFRlbmFudCBvdmVycmlkZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUZW5hbnQtc2NvcGVkIGRhdGFiYXNlIGlkZW50aWZpZXIgd2hlbiBjb25maWd1cmVkLlxuICAgKi9cbiAgc3RhdGljIGdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcih0ZW5hbnQgPSBDdXJyZW50LnRlbmFudCgpKSB7XG4gICAgY29uc3QgdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIgPSB0aGlzLl90ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlclxuXG4gICAgaWYgKCF0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlcikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlciA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoe1xuICAgICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgICB0ZW5hbnRcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBUaGUgYXR0cmlidXRlLlxuICAgKi9cbiAgZ2V0QXR0cmlidXRlKG5hbWUpIHtcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKG5hbWUpXG5cbiAgICBpZiAoIXRoaXMuaXNOZXdSZWNvcmQoKSAmJiAhKGNvbHVtbk5hbWUgaW4gdGhpcy5fYXR0cmlidXRlcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IyR7bmFtZX0gYXR0cmlidXRlIGhhc24ndCBiZWVuIGxvYWRlZCB5ZXQgaW4gJHtPYmplY3Qua2V5cyh0aGlzLl9hdHRyaWJ1dGVzKS5qb2luKFwiLCBcIil9YClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0cmlidXRlc1tjb2x1bW5OYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gLSBUaGUgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBnZXRNb2RlbENsYXNzKCkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG5cbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24pIHJldHVybiB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi5tb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgICByZXR1cm4gbW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBuZXdWYWx1ZSAtIE5ldyB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0QXR0cmlidXRlKG5hbWUsIG5ld1ZhbHVlKSB7XG4gICAgLy8gUmVzb2x2ZSByYXcgY29sdW1uIG5hbWVzIChcIlZBX8OcYkF0dHJpYnV0SURcIiwgXCJJUFwiKSBhbmQgY2FzaW5nIHZhcmlhbnRzIChcInZBRnVua3Rpb25JRFwiKSB0byB0aGVcbiAgICAvLyBjYW5vbmljYWwgYXR0cmlidXRlIHRoZSBtb2RlbCBiYXNlIGdlbmVyYXRlcyBpdHMgc2V0dGVyIGZyb20gKHNldFZBVWViYXR0cmlidXRpZCwgc2V0SXAsIOKApikuXG4gICAgY29uc3QgY2Fub25pY2FsTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnJlc29sdmVBdHRyaWJ1dGVOYW1lKG5hbWUpID8/IG5hbWVcbiAgICBjb25zdCByZXF1ZXN0ZWRTZXR0ZXJOYW1lID0gYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShjYW5vbmljYWxOYW1lKX1gXG4gICAgY29uc3Qgc2V0dGVyTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmZpbmRNZW1iZXJOYW1lSW5zZW5zaXRpdmUodGhpcywgcmVxdWVzdGVkU2V0dGVyTmFtZSlcbiAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKHZhbHVlOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZD59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG5cbiAgICB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fYXNzZXJ0SGFzQmVlbkluaXRpYWxpemVkKClcbiAgICBpZiAoIXRoaXMuZ2V0TW9kZWxDbGFzcygpLmlzSW5pdGlhbGl6ZWQoKSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gbW9kZWwgaXNuJ3QgaW5pdGlhbGl6ZWQgeWV0YClcbiAgICBpZiAoIXNldHRlck5hbWUpIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBzZXR0ZXIgbWV0aG9kOiAke3RoaXMuY29uc3RydWN0b3IubmFtZX0jJHtyZXF1ZXN0ZWRTZXR0ZXJOYW1lfWApXG5cbiAgICBkeW5hbWljVGhpc1tzZXR0ZXJOYW1lXShuZXdWYWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjb2x1bW4gYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG5ld1ZhbHVlIC0gTmV3IHZhbHVlLlxuICAgKi9cbiAgX3NldENvbHVtbkF0dHJpYnV0ZShuYW1lLCBuZXdWYWx1ZSkge1xuICAgIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIGlmICghdGhpcy5nZXRNb2RlbENsYXNzKCkuX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUpIHRocm93IG5ldyBFcnJvcihcIk5vIGF0dHJpYnV0ZS10by1jb2x1bW4gbWFwcGluZy4gSGFzIHJlY29yZCBiZWVuIGluaXRpYWxpemVkP1wiKVxuXG4gICAgY29uc3QgcmVzb2x2ZWROYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucmVzb2x2ZUF0dHJpYnV0ZU5hbWUobmFtZSlcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gcmVzb2x2ZWROYW1lID8gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpW3Jlc29sdmVkTmFtZV0gOiB1bmRlZmluZWRcblxuICAgIGlmICghY29sdW1uTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCBmaWd1cmUgb3V0IGNvbHVtbiBuYW1lIGZvciBhdHRyaWJ1dGU6ICR7bmFtZX1gKVxuXG4gICAgbGV0IG5vcm1hbGl6ZWRWYWx1ZSA9IG5ld1ZhbHVlXG4gICAgY29uc3QgY29sdW1uVHlwZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtblR5cGVCeU5hbWUoY29sdW1uTmFtZSlcblxuICAgIGlmIChjb2x1bW5UeXBlICYmIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9pc0RhdGVMaWtlVHlwZShjb2x1bW5UeXBlKSkge1xuICAgICAgbm9ybWFsaXplZFZhbHVlID0gdGhpcy5fbm9ybWFsaXplRGF0ZVZhbHVlKG5ld1ZhbHVlKVxuICAgIH1cblxuICAgIG5vcm1hbGl6ZWRWYWx1ZSA9IHRoaXMuX25vcm1hbGl6ZUJvb2xlYW5WYWx1ZUZvcldyaXRlKHthdHRyaWJ1dGVOYW1lOiBuYW1lLCBjb2x1bW5UeXBlLCB2YWx1ZTogbm9ybWFsaXplZFZhbHVlfSlcblxuICAgIGlmICh0aGlzLl9hdHRyaWJ1dGVzW2NvbHVtbk5hbWVdICE9IG5vcm1hbGl6ZWRWYWx1ZSkge1xuICAgICAgdGhpcy5fY2xlYXJCZWxvbmdzVG9SZWxhdGlvbnNoaXBGb3JDaGFuZ2VkRm9yZWlnbktleShjb2x1bW5OYW1lLCBub3JtYWxpemVkVmFsdWUpXG4gICAgICB0aGlzLl9jaGFuZ2VzW2NvbHVtbk5hbWVdID0gbm9ybWFsaXplZFZhbHVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBsb2FkZWQgYmVsb25ncy10byBjYWNoZXMgd2hlbiBjYWxsZXJzIGFzc2lnbiB0aGUgZm9yZWlnbiBrZXkgZGlyZWN0bHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ2hhbmdlZCBkYXRhYmFzZSBjb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbm9ybWFsaXplZFZhbHVlIC0gTmV3IG5vcm1hbGl6ZWQgY29sdW1uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfY2xlYXJCZWxvbmdzVG9SZWxhdGlvbnNoaXBGb3JDaGFuZ2VkRm9yZWlnbktleShjb2x1bW5OYW1lLCBub3JtYWxpemVkVmFsdWUpIHtcbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcCBvZiB0aGlzLl9iZWxvbmdzVG9SZWxhdGlvbnNoaXBzRm9yRm9yZWlnbktleShjb2x1bW5OYW1lKSkge1xuICAgICAgaWYgKHRoaXMuX2JlbG9uZ3NUb1JlbGF0aW9uc2hpcE1hdGNoZXNGb3JlaWduS2V5VmFsdWUoe25vcm1hbGl6ZWRWYWx1ZSwgcmVsYXRpb25zaGlwfSkpIGNvbnRpbnVlXG5cbiAgICAgIHRoaXMuX2NsZWFyTG9hZGVkQmVsb25nc1RvUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWxvbmdzIHRvIHJlbGF0aW9uc2hpcHMgZm9yIGZvcmVpZ24ga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENoYW5nZWQgZGF0YWJhc2UgY29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBpbnN0YW5jZXMgdGhhdCB1c2UgdGhlIGNoYW5nZWQgZm9yZWlnbiBrZXkuXG4gICAqL1xuICBfYmVsb25nc1RvUmVsYXRpb25zaGlwc0ZvckZvcmVpZ25LZXkoY29sdW1uTmFtZSkge1xuICAgIGlmICghdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKSByZXR1cm4gW11cblxuICAgIHJldHVybiBPYmplY3RcbiAgICAgIC52YWx1ZXModGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKVxuICAgICAgLmZpbHRlcigocmVsYXRpb25zaGlwKSA9PiB0aGlzLl9iZWxvbmdzVG9SZWxhdGlvbnNoaXBVc2VzRm9yZWlnbktleSh7Y29sdW1uTmFtZSwgcmVsYXRpb25zaGlwfSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWxvbmdzIHRvIHJlbGF0aW9uc2hpcCB1c2VzIGZvcmVpZ24ga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlbGF0aW9uc2hpcCBtYXRjaCBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbk5hbWUgLSBDaGFuZ2VkIGRhdGFiYXNlIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVsYXRpb25zaGlwIGlzIGEgYmVsb25ncy10byB1c2luZyB0aGUgY2hhbmdlZCBmb3JlaWduIGtleS5cbiAgICovXG4gIF9iZWxvbmdzVG9SZWxhdGlvbnNoaXBVc2VzRm9yZWlnbktleSh7Y29sdW1uTmFtZSwgcmVsYXRpb25zaGlwfSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0VHlwZSgpICE9IFwiYmVsb25nc1RvXCIpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgZm9yZWlnbktleSA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcbiAgICBjb25zdCBmb3JlaWduS2V5QXR0cmlidXRlID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW2ZvcmVpZ25LZXldXG5cbiAgICByZXR1cm4gZm9yZWlnbktleSA9PSBjb2x1bW5OYW1lIHx8IGZvcmVpZ25LZXlBdHRyaWJ1dGUgPT0gY29sdW1uTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVsb25ncyB0byByZWxhdGlvbnNoaXAgbWF0Y2hlcyBmb3JlaWduIGtleSB2YWx1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZWxhdGlvbnNoaXAgY2FjaGUgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLm5vcm1hbGl6ZWRWYWx1ZSAtIE5ldyBub3JtYWxpemVkIGNvbHVtbiB2YWx1ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5yZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGxvYWRlZCByZWxhdGVkIHJlY29yZCBzdGlsbCBtYXRjaGVzIHRoZSBjaGFuZ2VkIGZvcmVpZ24ga2V5LlxuICAgKi9cbiAgX2JlbG9uZ3NUb1JlbGF0aW9uc2hpcE1hdGNoZXNGb3JlaWduS2V5VmFsdWUoe25vcm1hbGl6ZWRWYWx1ZSwgcmVsYXRpb25zaGlwfSkge1xuICAgIGNvbnN0IGxvYWRlZCA9IHJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG5cbiAgICBpZiAoIWxvYWRlZCkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZGVkKSkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKCFyZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiBsb2FkZWQucmVhZENvbHVtbihyZWxhdGlvbnNoaXAuZ2V0UHJpbWFyeUtleSgpKSA9PSBub3JtYWxpemVkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBmb3JlaWduIGtleSB2YWx1ZSBmb3IgYSBiZWxvbmdzLXRvIHJlbGF0aW9uc2hpcCBhc3NpZ25tZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlbGF0aW9uc2hpcCBhc3NpZ25tZW50IGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MubW9kZWwgLSBBc3NpZ25lZCBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlbGF0aW9uc2hpcCAtIEJlbG9uZ3MtdG8gcmVsYXRpb25zaGlwIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gLSBGb3JlaWduIGtleSB2YWx1ZSBmb3IgdGhlIGFzc2lnbm1lbnQuXG4gICAqL1xuICBfYmVsb25nc1RvRm9yZWlnbktleVZhbHVlKHttb2RlbCwgcmVsYXRpb25zaGlwfSkge1xuICAgIGlmIChtb2RlbCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICAgIGlmICghKG1vZGVsIGluc3RhbmNlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQpKSB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgbW9kZWwgdHlwZTogJHt0eXBlb2YgbW9kZWx9YClcblxuICAgIHJldHVybiAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9ICovIChtb2RlbC5yZWFkQ29sdW1uKHJlbGF0aW9uc2hpcC5nZXRQcmltYXJ5S2V5KCkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgbG9hZGVkIGJlbG9uZ3MgdG8gcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9jbGVhckxvYWRlZEJlbG9uZ3NUb1JlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXApIHtcbiAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHVuZGVmaW5lZClcbiAgICByZWxhdGlvbnNoaXAuc2V0UHJlbG9hZGVkKGZhbHNlKVxuICAgIHJlbGF0aW9uc2hpcC5zZXREaXJ0eShmYWxzZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBkYXRlIHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBkYXRlIHZhbHVlLlxuICAgKi9cbiAgX25vcm1hbGl6ZURhdGVWYWx1ZSh2YWx1ZSkge1xuICAgIHJldHVybiBub3JtYWxpemVEYXRlVmFsdWVGb3JXcml0ZSh2YWx1ZSwge3RpbWVab25lOiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fdGltZVpvbmVGb3JEYXRlV3JpdGUoKX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgc3FsaXRlIGJvb2xlYW4gdmFsdWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBfbm9ybWFsaXplU3FsaXRlQm9vbGVhblZhbHVlKHtjb2x1bW5UeXBlLCB2YWx1ZX0pIHtcbiAgICBpZiAodGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0RGF0YWJhc2VUeXBlKCkgIT0gXCJzcWxpdGVcIikgcmV0dXJuIHZhbHVlXG4gICAgaWYgKCFjb2x1bW5UeXBlKSByZXR1cm4gdmFsdWVcbiAgICBpZiAoY29sdW1uVHlwZS50b0xvd2VyQ2FzZSgpICE9PSBcImJvb2xlYW5cIikgcmV0dXJuIHZhbHVlXG4gICAgaWYgKHZhbHVlID09PSB0cnVlKSByZXR1cm4gMVxuICAgIGlmICh2YWx1ZSA9PT0gZmFsc2UpIHJldHVybiAwXG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGEgYm9vbGVhbiB2YWx1ZSBiZWZvcmUgc3RvcmluZy4gQSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGF0dHJpYnV0ZSBjYXN0IHN0b3Jlc1xuICAgKiBib29sZWFucyBhcyAxLzAgb25seSBmb3IgaW50ZWdlci1iYWNrZWQgY29sdW1ucyAoZS5nLiBhbiBNU1NRTCBgYml0YCkuIENvbHVtbnMgd2hvc2VcbiAgICogdW5kZXJseWluZyB0eXBlIGlzIGFscmVhZHkgYSBuYXRpdmUgYm9vbGVhbiAoZS5nLiBQb3N0Z3JlcyBgYm9vbGVhbmApIGtlZXAgYHRydWVgL2BmYWxzZWBcbiAgICogc28gdGhlIGRyaXZlciBjYW4gZW1pdCB0aGUgcHJvcGVyIGJvb2xlYW4gbGl0ZXJhbDsgb3RoZXJ3aXNlIHRoZSBzcWxpdGUtb25seSBub3JtYWxpemVyIGFwcGxpZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZSBiZWluZyB3cml0dGVuLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gYXJncy5jb2x1bW5UeXBlIC0gQ29sdW1uIHR5cGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBWYWx1ZSB0byBub3JtYWxpemUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICAgKi9cbiAgX25vcm1hbGl6ZUJvb2xlYW5WYWx1ZUZvcldyaXRlKHthdHRyaWJ1dGVOYW1lLCBjb2x1bW5UeXBlLCB2YWx1ZX0pIHtcbiAgICBpZiAoIXRoaXMuZ2V0TW9kZWxDbGFzcygpLl9kZWNsYXJlZEJvb2xlYW5TdG9yZXNBc0ludGVnZXIoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHJldHVybiB0aGlzLl9ub3JtYWxpemVTcWxpdGVCb29sZWFuVmFsdWUoe2NvbHVtblR5cGUsIHZhbHVlfSlcbiAgICB9XG5cbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiAxXG4gICAgaWYgKHZhbHVlID09PSBmYWxzZSkgcmV0dXJuIDBcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGF0dHJpYnV0ZSBjYXN0IGlzIGJhY2tlZCBieSBhbiBpbnRlZ2VyIGNvbHVtbiAoZS5nLiBhbiBNU1NRTFxuICAgKiBgYml0YCksIHNvIGJvb2xlYW5zIG11c3QgYmUgc3RvcmVkIGFzIDEvMC4gQSBuYXRpdmUgYm9vbGVhbiBjb2x1bW4gKGUuZy4gUG9zdGdyZXMgYGJvb2xlYW5gKVxuICAgKiByZXR1cm5zIGZhbHNlIGFuZCBrZWVwcyBgdHJ1ZWAvYGZhbHNlYCBmb3IgdGhlIGRyaXZlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZGVjbGFyZWQgYm9vbGVhbiBpcyBzdG9yZWQgYXMgYW4gaW50ZWdlci5cbiAgICovXG4gIHN0YXRpYyBfZGVjbGFyZWRCb29sZWFuU3RvcmVzQXNJbnRlZ2VyKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAodGhpcy5nZXRBdHRyaWJ1dGVDYXN0KGF0dHJpYnV0ZU5hbWUpICE9PSBcImJvb2xlYW5cIikgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClbYXR0cmlidXRlTmFtZV1cbiAgICBjb25zdCBpbnRyb3NwZWN0ZWRUeXBlID0gY29sdW1uTmFtZSA/IHRoaXMuZ2V0Q29sdW1uc0hhc2goKVtjb2x1bW5OYW1lXT8uZ2V0VHlwZSgpIDogdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gdHlwZW9mIGludHJvc3BlY3RlZFR5cGUgPT09IFwic3RyaW5nXCIgJiYgaW50cm9zcGVjdGVkVHlwZS50b0xvd2VyQ2FzZSgpICE9PSBcImJvb2xlYW5cIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHRbXX0gLSBUaGUgY29sdW1ucy5cbiAgICovXG4gIHN0YXRpYyBnZXRDb2x1bW5zKCkge1xuICAgIHRoaXMuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgaWYgKCF0aGlzLl9jb2x1bW5zKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5uYW1lfSBoYXNuJ3QgYmVlbiBpbml0aWFsaXplZCB5ZXRgKVxuXG4gICAgcmV0dXJuIHRoaXMuX2NvbHVtbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb2x1bW5zIGhhc2guXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSAtIFRoZSBjb2x1bW5zIGhhc2guXG4gICAqL1xuICBzdGF0aWMgZ2V0Q29sdW1uc0hhc2goKSB7XG4gICAgaWYgKCF0aGlzLl9jb2x1bW5zQXNIYXNoKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgICAgdGhpcy5fY29sdW1uc0FzSGFzaCA9IHt9XG5cbiAgICAgIGZvciAoY29uc3QgY29sdW1uIG9mIHRoaXMuZ2V0Q29sdW1ucygpKSB7XG4gICAgICAgIHRoaXMuX2NvbHVtbnNBc0hhc2hbY29sdW1uLmdldE5hbWUoKV0gPSBjb2x1bW5cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fY29sdW1uc0FzSGFzaFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbHVtbiB0eXBlIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgY29sdW1uIHR5cGUgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRDb2x1bW5UeXBlQnlOYW1lKG5hbWUpIHtcbiAgICBpZiAoIXRoaXMuX2NvbHVtblR5cGVCeU5hbWUpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD59ICovXG4gICAgICB0aGlzLl9jb2x1bW5UeXBlQnlOYW1lID0ge31cblxuICAgICAgZm9yIChjb25zdCBjb2x1bW4gb2YgdGhpcy5nZXRDb2x1bW5zKCkpIHtcbiAgICAgICAgdGhpcy5fY29sdW1uVHlwZUJ5TmFtZVtjb2x1bW4uZ2V0TmFtZSgpXSA9IGNvbHVtbi5nZXRUeXBlKClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gdGhpcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbbmFtZV1cblxuICAgIGlmIChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgICBjb25zdCBjYXN0ID0gdGhpcy5nZXRBdHRyaWJ1dGVDYXN0KGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGlmIChjYXN0KSByZXR1cm4gY2FzdFxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9jb2x1bW5UeXBlQnlOYW1lW25hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBkYXRlIGxpa2UgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBUeXBlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZGF0ZSBsaWtlIHR5cGUuXG4gICAqL1xuICBzdGF0aWMgX2lzRGF0ZUxpa2VUeXBlKHR5cGUpIHtcbiAgICBjb25zdCBub3JtYWxpemVkVHlwZSA9IHR5cGUudG9Mb3dlckNhc2UoKVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRUeXBlID09IFwiZGF0ZVwiIHx8XG4gICAgICBub3JtYWxpemVkVHlwZSA9PSBcImRhdGV0aW1lXCIgfHxcbiAgICAgIG5vcm1hbGl6ZWRUeXBlID09IFwidGltZXN0YW1wXCIgfHxcbiAgICAgIG5vcm1hbGl6ZWRUeXBlID09IFwidGltZXN0YW1wdHpcIiB8fFxuICAgICAgbm9ybWFsaXplZFR5cGUuc3RhcnRzV2l0aChcInRpbWVzdGFtcCBcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb2x1bW4gbmFtZXMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSAtIFRoZSBjb2x1bW4gbmFtZXMuXG4gICAqL1xuICBzdGF0aWMgZ2V0Q29sdW1uTmFtZXMoKSB7XG4gICAgaWYgKCF0aGlzLl9jb2x1bW5OYW1lcykge1xuICAgICAgdGhpcy5fY29sdW1uTmFtZXMgPSB0aGlzLmdldENvbHVtbnMoKS5tYXAoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fY29sdW1uTmFtZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSB0YWJsZS5cbiAgICovXG4gIHN0YXRpYyBfZ2V0VGFibGUoKSB7XG4gICAgaWYgKCF0aGlzLl90YWJsZSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubmFtZX0gaGFzbid0IGJlZW4gaW5pdGlhbGl6ZWQgeWV0YClcblxuICAgIHJldHVybiB0aGlzLl90YWJsZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IG11bHRpcGxlLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEBwYXJhbSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gcm93cyAtIFJvd3MgdG8gaW5zZXJ0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuY2FzdF0gLSBXaGV0aGVyIHRvIGNhc3QgdmFsdWVzIGJhc2VkIG9uIGNvbHVtbiB0eXBlcy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5yZXRyeUluZGl2aWR1YWxseU9uRmFpbHVyZV0gLSBSZXRyeSByb3dzIGluZGl2aWR1YWxseSBpZiBhIGJhdGNoIGluc2VydCBmYWlscy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5yZXR1cm5SZXN1bHRzXSAtIFJldHVybiBzdWNjZWVkZWQvZmFpbGVkIHJvd3MgaW5zdGVhZCBvZiB0aHJvd2luZyB3aGVuIHJldHJpZXMgZmFpbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZCB8IHtzdWNjZWVkZWRSb3dzOiBBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+LCBmYWlsZWRSb3dzOiBBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+LCBlcnJvcnM6IEFycmF5PHtyb3c6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59Pn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGluc2VydE11bHRpcGxlKGNvbHVtbnMsIHJvd3MsIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtjYXN0ID0gdHJ1ZSwgcmV0cnlJbmRpdmlkdWFsbHlPbkZhaWx1cmUgPSBmYWxzZSwgcmV0dXJuUmVzdWx0cyA9IGZhbHNlLCAuLi5yZXN0QXJnc30gPSBhcmdzXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFJvd3MgPSBjYXN0XG4gICAgICA/IHRoaXMuX25vcm1hbGl6ZUluc2VydE11bHRpcGxlUm93cyh7Y29sdW1ucywgcm93c30pXG4gICAgICA6IHJvd3NcbiAgICBjb25zdCB0YWJsZU5hbWUgPSB0aGlzLnRhYmxlTmFtZSgpXG5cbiAgICBpZiAoIXJldHJ5SW5kaXZpZHVhbGx5T25GYWlsdXJlKSB7XG4gICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS5pbnNlcnRNdWx0aXBsZSh0YWJsZU5hbWUsIGNvbHVtbnMsIG5vcm1hbGl6ZWRSb3dzKVxuICAgICAgaWYgKHJldHVyblJlc3VsdHMpIHJldHVybiB7c3VjY2VlZGVkUm93czogbm9ybWFsaXplZFJvd3Muc2xpY2UoKSwgZmFpbGVkUm93czogW10sIGVycm9yczogW119XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLy8gV3JhcCB0aGUgYmF0Y2ggaW4gYSB0cmFuc2FjdGlvbi9zYXZlcG9pbnQuIE9uIGRhdGFiYXNlcyB0aGF0IGFib3J0IHRoZVxuICAgICAgLy8gd2hvbGUgdHJhbnNhY3Rpb24gd2hlbiBhIHN0YXRlbWVudCBmYWlscyAoUG9zdGdyZVNRTCksIGEgZmFpbGVkIGJhdGNoXG4gICAgICAvLyB3b3VsZCBvdGhlcndpc2UgcG9pc29uIHRoZSBzdXJyb3VuZGluZyB0cmFuc2FjdGlvbiBzbyB0aGF0IHRoZVxuICAgICAgLy8gaW5kaXZpZHVhbCByZXRyaWVzIGJlbG93IGFsbCBmYWlsIHdpdGggXCJjdXJyZW50IHRyYW5zYWN0aW9uIGlzIGFib3J0ZWRcIi5cbiAgICAgIC8vIHRyYW5zYWN0aW9uKCkgb3BlbnMgYSBzYXZlcG9pbnQgd2hlbiBhbHJlYWR5IGluc2lkZSBhIHRyYW5zYWN0aW9uIGFuZCBhXG4gICAgICAvLyByZWFsIHRyYW5zYWN0aW9uIG90aGVyd2lzZSwgc28gYSBmYWlsdXJlIHJvbGxzIGJhY2sgb25seSB0aGlzIGF0dGVtcHQuXG4gICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLmluc2VydE11bHRpcGxlKHRhYmxlTmFtZSwgY29sdW1ucywgbm9ybWFsaXplZFJvd3MpXG4gICAgICB9KVxuICAgICAgaWYgKHJldHVyblJlc3VsdHMpIHJldHVybiB7c3VjY2VlZGVkUm93czogbm9ybWFsaXplZFJvd3Muc2xpY2UoKSwgZmFpbGVkUm93czogW10sIGVycm9yczogW119XG4gICAgICByZXR1cm5cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qKlxuICAgICAgICogUmVzdWx0cy5cbiAgICAgICAqIEB0eXBlIHt7c3VjY2VlZGVkUm93czogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W10sIGZhaWxlZFJvd3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdLCBlcnJvcnM6IEFycmF5PHtyb3c6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59fSAqL1xuICAgICAgY29uc3QgcmVzdWx0cyA9IHtcbiAgICAgICAgc3VjY2VlZGVkUm93czogW10sXG4gICAgICAgIGZhaWxlZFJvd3M6IFtdLFxuICAgICAgICBlcnJvcnM6IFtdXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIG5vcm1hbGl6ZWRSb3dzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgLy8gRWFjaCByZXRyeSBydW5zIGluIGl0cyBvd24gc2F2ZXBvaW50IHNvIGEgZmFpbGVkIHJvdyByb2xscyBiYWNrIG9ubHlcbiAgICAgICAgICAvLyB0aGF0IHJvdyBhbmQgbGVhdmVzIHRoZSBzdXJyb3VuZGluZyB0cmFuc2FjdGlvbiB1c2FibGUgZm9yIHRoZSByZXN0LlxuICAgICAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLmluc2VydE11bHRpcGxlKHRhYmxlTmFtZSwgY29sdW1ucywgW3Jvd10pXG4gICAgICAgICAgfSlcbiAgICAgICAgICByZXN1bHRzLnN1Y2NlZWRlZFJvd3MucHVzaChyb3cpXG4gICAgICAgIH0gY2F0Y2ggKHJvd0Vycm9yKSB7XG4gICAgICAgICAgcmVzdWx0cy5mYWlsZWRSb3dzLnB1c2gocm93KVxuICAgICAgICAgIHJlc3VsdHMuZXJyb3JzLnB1c2goe3JvdywgZXJyb3I6IHJvd0Vycm9yfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAocmVzdWx0cy5mYWlsZWRSb3dzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgY29tYmluZWRFcnJvcnMgPSByZXN1bHRzLmVycm9ycy5tYXAoKGVudHJ5LCBpbmRleCkgPT4ge1xuICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlbnRyeS5lcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZW50cnkuZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlbnRyeS5lcnJvcilcbiAgICAgICAgICByZXR1cm4gYFske2luZGV4fV0gJHttZXNzYWdlfS4gUm93OiAke3RoaXMuX3NhZmVTZXJpYWxpemVJbnNlcnRSb3coZW50cnkucm93KX1gXG4gICAgICAgIH0pLmpvaW4oXCIgfCBcIilcbiAgICAgICAgY29uc3QgY29tYmluZWRFcnJvciA9IG5ldyBFcnJvcihgaW5zZXJ0TXVsdGlwbGUgZmFpbGVkIGZvciAke3Jlc3VsdHMuZmFpbGVkUm93cy5sZW5ndGh9IHJvd3MuICR7Y29tYmluZWRFcnJvcnN9YClcblxuICAgICAgICBpZiAocmV0dXJuUmVzdWx0cykgcmV0dXJuIHJlc3VsdHNcbiAgICAgICAgdGhyb3cgY29tYmluZWRFcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAocmV0dXJuUmVzdWx0cykgcmV0dXJuIHJlc3VsdHNcbiAgICAgIHJldHVyblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBpbnNlcnQgbXVsdGlwbGUgcm93cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBhcmdzLmNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEBwYXJhbSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gYXJncy5yb3dzIC0gUm93cyB0byBpbnNlcnQuXG4gICAqIEByZXR1cm5zIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIE5vcm1hbGl6ZWQgcm93cy5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplSW5zZXJ0TXVsdGlwbGVSb3dzKHtjb2x1bW5zLCByb3dzfSkge1xuICAgIHJldHVybiByb3dzLm1hcCgocm93KSA9PiB7XG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkocm93KSB8fCByb3cubGVuZ3RoICE9PSBjb2x1bW5zLmxlbmd0aCkge1xuICAgICAgICBjb25zdCByb3dMZW5ndGggPSBBcnJheS5pc0FycmF5KHJvdykgPyByb3cubGVuZ3RoIDogXCJub24tYXJyYXlcIlxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgaW5zZXJ0TXVsdGlwbGUgcm93IGxlbmd0aCBtaXNtYXRjaC4gRXhwZWN0ZWQgJHtjb2x1bW5zLmxlbmd0aH0gdmFsdWVzIGJ1dCBnb3QgJHtyb3dMZW5ndGh9LiBSb3c6ICR7SlNPTi5zdHJpbmdpZnkocm93KX1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBub3JtYWxpemVkUm93ID0gW11cblxuICAgICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGNvbHVtbnMubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBjb2x1bW5zW2luZGV4XVxuICAgICAgICBjb25zdCB2YWx1ZSA9IHJvd1tpbmRleF1cblxuICAgICAgICBub3JtYWxpemVkUm93W2luZGV4XSA9IHRoaXMuX25vcm1hbGl6ZUluc2VydFZhbHVlRm9yQ29sdW1uKHtjb2x1bW5OYW1lLCB2YWx1ZX0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBub3JtYWxpemVkUm93XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNhZmUgc2VyaWFsaXplIGluc2VydCByb3cuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByb3cgLSBSb3cgdG8gc2VyaWFsaXplLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNhZmUgcm93IHJlcHJlc2VudGF0aW9uLlxuICAgKi9cbiAgc3RhdGljIF9zYWZlU2VyaWFsaXplSW5zZXJ0Um93KHJvdykge1xuICAgIHJldHVybiBmb3JtYXRWYWx1ZShyb3cpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgaW5zZXJ0IHZhbHVlIGZvciBjb2x1bW4uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIENvbHVtbiB2YWx1ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgX25vcm1hbGl6ZUluc2VydFZhbHVlRm9yQ29sdW1uKHtjb2x1bW5OYW1lLCB2YWx1ZX0pIHtcbiAgICBjb25zdCBjb2x1bW4gPSB0aGlzLmdldENvbHVtbnNIYXNoKClbY29sdW1uTmFtZV1cblxuICAgIGlmICghY29sdW1uKSByZXR1cm4gdmFsdWVcblxuICAgIGNvbnN0IGNvbHVtblR5cGUgPSBjb2x1bW4uZ2V0VHlwZSgpXG4gICAgY29uc3Qgbm9ybWFsaXplZFR5cGUgPSB0eXBlb2YgY29sdW1uVHlwZSA9PT0gXCJzdHJpbmdcIiA/IGNvbHVtblR5cGUudG9Mb3dlckNhc2UoKSA6IHVuZGVmaW5lZFxuICAgIGxldCBub3JtYWxpemVkVmFsdWUgPSB2YWx1ZVxuXG4gICAgaWYgKG5vcm1hbGl6ZWRUeXBlICYmIHRoaXMuX2lzRGF0ZUxpa2VUeXBlKG5vcm1hbGl6ZWRUeXBlKSkge1xuICAgICAgbm9ybWFsaXplZFZhbHVlID0gdGhpcy5fbm9ybWFsaXplRGF0ZVZhbHVlRm9ySW5zZXJ0KG5vcm1hbGl6ZWRWYWx1ZSlcbiAgICB9XG5cbiAgICBub3JtYWxpemVkVmFsdWUgPSB0aGlzLl9ub3JtYWxpemVTcWxpdGVCb29sZWFuVmFsdWVGb3JJbnNlcnQoe2NvbHVtblR5cGUsIHZhbHVlOiBub3JtYWxpemVkVmFsdWV9KVxuXG4gICAgaWYgKG5vcm1hbGl6ZWRWYWx1ZSA9PT0gXCJcIiAmJiBjb2x1bW4uZ2V0TnVsbCgpICYmICF0aGlzLl9pc1N0cmluZ1R5cGUobm9ybWFsaXplZFR5cGUpKSB7XG4gICAgICBub3JtYWxpemVkVmFsdWUgPSBudWxsXG4gICAgfVxuXG4gICAgaWYgKG5vcm1hbGl6ZWRUeXBlICYmIHRoaXMuX2lzTnVtZXJpY1R5cGUobm9ybWFsaXplZFR5cGUpKSB7XG4gICAgICBub3JtYWxpemVkVmFsdWUgPSB0aGlzLl9ub3JtYWxpemVOdW1lcmljVmFsdWUoe2NvbHVtblR5cGU6IG5vcm1hbGl6ZWRUeXBlLCB2YWx1ZTogbm9ybWFsaXplZFZhbHVlfSlcbiAgICB9XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBzdHJpbmcgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzdHJpbmctbGlrZSB0eXBlLlxuICAgKi9cbiAgc3RhdGljIF9pc1N0cmluZ1R5cGUoY29sdW1uVHlwZSkge1xuICAgIGlmICghY29sdW1uVHlwZSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBzdHJpbmdUeXBlcyA9IG5ldyBTZXQoW1wiY2hhclwiLCBcInZhcmNoYXJcIiwgXCJudmFyY2hhclwiLCBcInN0cmluZ1wiLCBcImVudW1cIiwgXCJqc29uXCIsIFwianNvbmJcIiwgXCJjaXRleHRcIiwgXCJiaW5hcnlcIiwgXCJ2YXJiaW5hcnlcIl0pXG5cbiAgICByZXR1cm4gY29sdW1uVHlwZS5pbmNsdWRlcyhcInV1aWRcIikgfHxcbiAgICAgIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJ0ZXh0XCIpIHx8XG4gICAgICBzdHJpbmdUeXBlcy5oYXMoY29sdW1uVHlwZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIG51bWVyaWMgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBudW1lcmljLWxpa2UgdHlwZS5cbiAgICovXG4gIHN0YXRpYyBfaXNOdW1lcmljVHlwZShjb2x1bW5UeXBlKSB7XG4gICAgcmV0dXJuIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJpbnRcIikgfHxcbiAgICAgIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJkZWNpbWFsXCIpIHx8XG4gICAgICBjb2x1bW5UeXBlLmluY2x1ZGVzKFwibnVtZXJpY1wiKSB8fFxuICAgICAgY29sdW1uVHlwZS5pbmNsdWRlcyhcImZsb2F0XCIpIHx8XG4gICAgICBjb2x1bW5UeXBlLmluY2x1ZGVzKFwiZG91YmxlXCIpIHx8XG4gICAgICBjb2x1bW5UeXBlLmluY2x1ZGVzKFwicmVhbFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIG51bWVyaWMgdmFsdWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgX25vcm1hbGl6ZU51bWVyaWNWYWx1ZSh7Y29sdW1uVHlwZSwgdmFsdWV9KSB7XG4gICAgaWYgKHZhbHVlID09PSBcIlwiIHx8IHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB2YWx1ZVxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiB2YWx1ZVxuXG4gICAgaWYgKGNvbHVtblR5cGUuaW5jbHVkZXMoXCJkZWNpbWFsXCIpIHx8IGNvbHVtblR5cGUuaW5jbHVkZXMoXCJudW1lcmljXCIpKSB7XG4gICAgICByZXR1cm4gdmFsdWVcbiAgICB9XG5cbiAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShwYXJzZWQpKSByZXR1cm4gdmFsdWVcblxuICAgIGlmIChjb2x1bW5UeXBlLmluY2x1ZGVzKFwiaW50XCIpKSB7XG4gICAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKHBhcnNlZCkpIHJldHVybiB2YWx1ZVxuICAgICAgaWYgKCEvXi0/XFxkKyQvLnRlc3QodmFsdWUpKSByZXR1cm4gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gcGFyc2VkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZGF0ZSB2YWx1ZSBmb3IgaW5zZXJ0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgX25vcm1hbGl6ZURhdGVWYWx1ZUZvckluc2VydCh2YWx1ZSkge1xuICAgIHJldHVybiBub3JtYWxpemVEYXRlVmFsdWVGb3JXcml0ZSh2YWx1ZSwge3RpbWVab25lOiB0aGlzLl90aW1lWm9uZUZvckRhdGVXcml0ZSgpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBkYXRlIHN0cmluZyBmb3IgaW5zZXJ0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBEYXRlIHN0cmluZyB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IERhdGV9IC0gUGFyc2VkIGRhdGUgb3Igb3JpZ2luYWwgc3RyaW5nLlxuICAgKi9cbiAgc3RhdGljIF9ub3JtYWxpemVEYXRlU3RyaW5nRm9ySW5zZXJ0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZURhdGVTdHJpbmdGb3JXcml0ZSh2YWx1ZSwge3RpbWVab25lOiB0aGlzLl90aW1lWm9uZUZvckRhdGVXcml0ZSgpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRpbWUgem9uZSBmb3IgZGF0ZSB3cml0ZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQWN0aXZlIHRpbWV6b25lIGlkZW50aWZpZXIuXG4gICAqL1xuICBzdGF0aWMgX3RpbWVab25lRm9yRGF0ZVdyaXRlKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKClcblxuICAgIHJldHVybiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldFRpbWVab25lKGNvbmZpZ3VyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgc3FsaXRlIGJvb2xlYW4gdmFsdWUgZm9yIGluc2VydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGFyZ3MuY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplU3FsaXRlQm9vbGVhblZhbHVlRm9ySW5zZXJ0KHtjb2x1bW5UeXBlLCB2YWx1ZX0pIHtcbiAgICBpZiAodGhpcy5nZXREYXRhYmFzZVR5cGUoKSAhPSBcInNxbGl0ZVwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAoIWNvbHVtblR5cGUpIHJldHVybiB2YWx1ZVxuICAgIGlmIChjb2x1bW5UeXBlLnRvTG93ZXJDYXNlKCkgIT09IFwiYm9vbGVhblwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiAxXG4gICAgaWYgKHZhbHVlID09PSBmYWxzZSkgcmV0dXJuIDBcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV4dCBwcmltYXJ5IGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBuZXh0IHByaW1hcnkga2V5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIG5leHRQcmltYXJ5S2V5KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMucHJpbWFyeUtleSgpXG4gICAgY29uc3QgdGFibGVOYW1lID0gdGhpcy50YWJsZU5hbWUoKVxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb24oKVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9Lm5leHRQcmltYXJ5S2V5KCkgZG9lcyBub3Qgc3VwcG9ydCBjb21wb3NpdGUgcHJpbWFyeSBrZXlzLmApXG5cbiAgICBjb25zdCBuZXdlc3RSZWNvcmQgPSBhd2FpdCB0aGlzLm9yZGVyKGAke2Nvbm5lY3Rpb24ucXVvdGVUYWJsZSh0YWJsZU5hbWUpfS4ke2Nvbm5lY3Rpb24ucXVvdGVDb2x1bW4ocHJpbWFyeUtleSl9YCkubGFzdCgpXG5cbiAgICBpZiAobmV3ZXN0UmVjb3JkKSB7XG4gICAgICBjb25zdCBpZCA9IG5ld2VzdFJlY29yZC5pZCgpXG5cbiAgICAgIGlmICh0eXBlb2YgaWQgPT0gXCJudW1iZXJcIikge1xuICAgICAgICByZXR1cm4gaWQgKyAxXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJRCBmcm9tIG5ld2VzdCByZWNvcmQgd2Fzbid0IGEgbnVtYmVyXCIpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiAxXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHByaW1hcnkga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgbnVsbH0gcHJpbWFyeUtleSAtIFByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2V0UHJpbWFyeUtleShwcmltYXJ5S2V5KSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHtcbiAgICAgIGlmIChwcmltYXJ5S2V5Lmxlbmd0aCA9PT0gMCkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNvbXBvc2l0ZSBwcmltYXJ5IGtleXMgcmVxdWlyZSBhdCBsZWFzdCBvbmUgY29sdW1uLlwiKVxuXG4gICAgICBjb25zdCBzZWVuQ29sdW1ucyA9IG5ldyBTZXQoKVxuXG4gICAgICBmb3IgKGNvbnN0IGNvbHVtbk5hbWUgb2YgcHJpbWFyeUtleSkge1xuICAgICAgICBpZiAoc2VlbkNvbHVtbnMuaGFzKGNvbHVtbk5hbWUpKSB0aHJvdyBuZXcgVHlwZUVycm9yKGBDb21wb3NpdGUgcHJpbWFyeSBrZXkgaGFzIGR1cGxpY2F0ZSBjb2x1bW46ICR7Y29sdW1uTmFtZX0uYClcblxuICAgICAgICBzZWVuQ29sdW1ucy5hZGQoY29sdW1uTmFtZSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5fcHJpbWFyeUtleSA9IFsuLi5wcmltYXJ5S2V5XVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fcHJpbWFyeUtleSA9IHByaW1hcnlLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoaXMgY2xhc3MncyBvd24gYXR0cmlidXRlLWNhc3QgbWFwLCBjcmVhdGluZyBpdCBvbiB0aGUgY2xhc3MgaXRzZWxmXG4gICAqIChuZXZlciBpbmhlcml0ZWQgZnJvbSBhIHBhcmVudCkgc28gc3ViY2xhc3NlcyBkb24ndCBzaGFyZSB0aGUgc2FtZSBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIERlY2xhcmVkIGNhc3RzIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dHJpYnV0ZUNhc3RzTWFwKCkge1xuICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsIFwiX2F0dHJpYnV0ZUNhc3RzXCIpIHx8ICF0aGlzLl9hdHRyaWJ1dGVDYXN0cykge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICAgIHRoaXMuX2F0dHJpYnV0ZUNhc3RzID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0cmlidXRlQ2FzdHNcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhIFJhaWxzLXN0eWxlIHBlci1hdHRyaWJ1dGUgY2FzdCBzbyBhIGNvbHVtbiB3aG9zZSBpbnRyb3NwZWN0ZWQgdHlwZVxuICAgKiBpc24ndCB3aGF0IHRoZSBhcHAgd2FudHMgKGUuZy4gYW4gTVNTUUwgYGJpdGAgbWFwcGVkIHRvIGBudW1iZXJgKSBjYW4gYmVcbiAgICogZXhwb3NlZCBhcyBhbm90aGVyIHR5cGUgd2l0aCByZWFsIHJ1bnRpbWUgY29udmVyc2lvbi4gQ3VycmVudGx5IGZ1bGx5XG4gICAqIGltcGxlbWVudHMgdGhlIGBcImJvb2xlYW5cImAgY2FzdCAoMC8xIDwtPiBmYWxzZS90cnVlKTsgb3RoZXIgdHlwZXMgb25seSByZWNvcmRcbiAgICogdGhlIGxhYmVsIHNvIHRoZSBlZmZlY3RpdmUgdHlwZSBhbmQgZ2VuZXJhdGVkIHR5cGluZ3MgcmVmbGVjdCB0aGVtLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lIChjYW1lbENhc2UpLCBlLmcuIGBcInNpY2h0YmFyVlZLXCJgLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIERlY2xhcmVkIHR5cGUsIGUuZy4gYFwiYm9vbGVhblwiYC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lLCB0eXBlKSB7XG4gICAgdGhpcy5nZXRBdHRyaWJ1dGVDYXN0c01hcCgpW2F0dHJpYnV0ZU5hbWVdID0gdHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGRlY2xhcmVkIGNhc3QgdHlwZSBmb3IgYW4gYXR0cmlidXRlLCBpZiBhbnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUgKGNhbWVsQ2FzZSkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gRGVjbGFyZWQgY2FzdCB0eXBlLCBvciB1bmRlZmluZWQgd2hlbiBub25lIGlzIGRlY2xhcmVkLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dHJpYnV0ZUNhc3QoYXR0cmlidXRlTmFtZSkge1xuICAgIHJldHVybiB0aGlzLmdldEF0dHJpYnV0ZUNhc3RzTWFwKClbYXR0cmlidXRlTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgc3RyaW5nW119IC0gVGhlIHByaW1hcnkga2V5LlxuICAgKi9cbiAgc3RhdGljIHByaW1hcnlLZXkoKSB7XG4gICAgaWYgKHRoaXMuX3ByaW1hcnlLZXkpIHJldHVybiB0aGlzLl9wcmltYXJ5S2V5XG5cbiAgICByZXR1cm4gXCJpZFwiXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgbW9kZWwgaGFzIGEgc2luZ2xlIHByaW1hcnkga2V5IGNvbHVtbi4gYHNldFByaW1hcnlLZXkobnVsbClgIChlLmcuIGNvbXBvc2l0ZS1rZXlcbiAgICogbGVnYWN5IHRhYmxlcykgZGVjbGFyZXMgbm8gc2luZ2xlIHByaW1hcnkga2V5OyBgcHJpbWFyeUtleSgpYCBzdGlsbCBmYWxscyBiYWNrIHRvIFwiaWRcIiBmb3IgdGhlXG4gICAqIGRlZmF1bHQgY2FzZSwgc28gY2FsbGVycyB0aGF0IG11c3QgZGlzdGluZ3Vpc2ggXCJubyBwcmltYXJ5IGtleVwiIHVzZSB0aGlzIGluc3RlYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIEZhbHNlIG9ubHkgd2hlbiB0aGUgcHJpbWFyeSBrZXkgd2FzIGV4cGxpY2l0bHkgc2V0IHRvIG51bGwuXG4gICAqL1xuICBzdGF0aWMgaGFzUHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gdGhpcy5fcHJpbWFyeUtleSAhPT0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2F2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNhdmUoKSB7XG4gICAgY29uc3QgaXNOZXdSZWNvcmQgPSB0aGlzLmlzTmV3UmVjb3JkKClcbiAgICBsZXQgcmVzdWx0XG5cbiAgICBjb25zdCBzYXZlID0gYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYmVmb3JlVmFsaWRhdGlvblwiKVxuICAgICAgYXdhaXQgdGhpcy5fcnVuVmFsaWRhdGlvbnMoKVxuXG4gICAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24gJiYgdGhpcy5pc1BlcnNpc3RlZCgpICYmIE9iamVjdC5rZXlzKHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldEF0dGFjaG1lbnRzKCkpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuX2Nvbm5lY3Rpb24oKVxuXG4gICAgICAgIGlmICghY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5nZXRNb2RlbENsYXNzKCkuX3ByZXBhcmVBdHRhY2htZW50U3RvcmVTY2hlbWEoY29ubmVjdGlvbilcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBzYXZlSW5UcmFuc2FjdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9ICovXG4gICAgICAgIGxldCBwZXJzaXN0ZWRBdHRyaWJ1dGVzQmVmb3JlVXBkYXRlXG4gICAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqL1xuICAgICAgICBsZXQgY2hhbmdlc0JlZm9yZVVwZGF0ZVxuICAgICAgICBsZXQgdXBkYXRlUmVsb2FkZWQgPSBmYWxzZVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYmVmb3JlU2F2ZVwiKVxuXG4gICAgICAgICAgLy8gSWYgYW55IGJlbG9uZ3MtdG8tcmVsYXRpb25zaGlwcyB3YXMgc2F2ZWQsIHRoZW4gdXBkYXRlZC1hdCBzaG91bGQgc3RpbGwgYmUgc2V0IG9uIHRoaXMgcmVjb3JkLlxuICAgICAgICAgIGNvbnN0IHtzYXZlZENvdW50fSA9IGF3YWl0IHRoaXMuX2F1dG9TYXZlQmVsb25nc1RvUmVsYXRpb25zaGlwcygpXG5cbiAgICAgICAgICBpZiAodGhpcy5pc1BlcnNpc3RlZCgpKSB7XG4gICAgICAgICAgICBwZXJzaXN0ZWRBdHRyaWJ1dGVzQmVmb3JlVXBkYXRlID0gey4uLnRoaXMuX2F0dHJpYnV0ZXN9XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJiZWZvcmVVcGRhdGVcIilcbiAgICAgICAgICAgIGNoYW5nZXNCZWZvcmVVcGRhdGUgPSB7Li4udGhpcy5fY2hhbmdlc31cblxuICAgICAgICAgICAgLy8gSWYgYW55IGhhcy1tYW55LXJlbGF0aW9uc2hpcHMgd2lsbCBiZSBzYXZlZCwgdGhlbiB1cGRhdGVkLWF0IHNob3VsZCBzdGlsbCBiZSBzZXQgb24gdGhpcyByZWNvcmQuXG4gICAgICAgICAgICBjb25zdCBhdXRvU2F2ZUhhc01hbnlyZWxhdGlvbnNoaXBzID0gdGhpcy5fYXV0b1NhdmVIYXNNYW55QW5kSGFzT25lUmVsYXRpb25zaGlwc1RvU2F2ZSgpXG5cbiAgICAgICAgICAgIGlmICh0aGlzLl9oYXNDaGFuZ2VzKCkgfHwgc2F2ZWRDb3VudCA+IDAgfHwgYXV0b1NhdmVIYXNNYW55cmVsYXRpb25zaGlwcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuX3VwZGF0ZVJlY29yZFdpdGhDaGFuZ2VzKClcbiAgICAgICAgICAgICAgdXBkYXRlUmVsb2FkZWQgPSB0cnVlXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImFmdGVyVXBkYXRlXCIpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImJlZm9yZUNyZWF0ZVwiKVxuICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5fY3JlYXRlTmV3UmVjb3JkKClcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImFmdGVyQ3JlYXRlXCIpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgdGhpcy5fYXV0b1NhdmVIYXNNYW55QW5kSGFzT25lUmVsYXRpb25zaGlwcyh7aXNOZXdSZWNvcmR9KVxuICAgICAgICAgIGF3YWl0IHRoaXMuX2F1dG9TYXZlQXR0YWNobWVudHMoKVxuICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImFmdGVyU2F2ZVwiKVxuICAgICAgICAgIGF3YWl0IHRoaXMuX2VtaXRSZWNvcmRDaGFuZ2VBZnRlckNvbW1pdChpc05ld1JlY29yZCA/IFwiY3JlYXRlXCIgOiBcInVwZGF0ZVwiKVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGlmICh1cGRhdGVSZWxvYWRlZCAmJiBwZXJzaXN0ZWRBdHRyaWJ1dGVzQmVmb3JlVXBkYXRlICYmIGNoYW5nZXNCZWZvcmVVcGRhdGUpIHtcbiAgICAgICAgICAgIHRoaXMuX2F0dHJpYnV0ZXMgPSBwZXJzaXN0ZWRBdHRyaWJ1dGVzQmVmb3JlVXBkYXRlXG4gICAgICAgICAgICB0aGlzLl9jaGFuZ2VzID0gY2hhbmdlc0JlZm9yZVVwZGF0ZVxuICAgICAgICAgICAgdGhpcy5fYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyA9IHVuZGVmaW5lZFxuICAgICAgICAgIH1cblxuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLnRyYW5zYWN0aW9uKHNhdmVJblRyYW5zYWN0aW9uKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgdGhpcy5nZXRNb2RlbENsYXNzKCkudHJhbnNhY3Rpb24oc2F2ZUluVHJhbnNhY3Rpb24pXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSB7XG4gICAgICBhd2FpdCBzYXZlKClcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBzYXZlYH0sIHNhdmUpXG4gICAgfVxuXG4gICAgdGhpcy5fYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyA9IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgYXN5bmMgX2F1dG9TYXZlQmVsb25nc1RvUmVsYXRpb25zaGlwcygpIHtcbiAgICBsZXQgc2F2ZWRDb3VudCA9IDBcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT0gXCJiZWxvbmdzVG9cIikge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0QXV0b1NhdmUoKSA9PT0gZmFsc2UpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgbW9kZWwgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG5cbiAgICAgIGlmIChtb2RlbCkge1xuICAgICAgICBpZiAobW9kZWwgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkge1xuICAgICAgICAgIGlmIChtb2RlbC5pc0NoYW5nZWQoKSkge1xuICAgICAgICAgICAgdGhpcy5iaW5kUmVsYXRlZFJlY29yZChtb2RlbClcbiAgICAgICAgICAgIGF3YWl0IG1vZGVsLnNhdmUoKVxuXG4gICAgICAgICAgICBjb25zdCBmb3JlaWduS2V5ID0gdGhpcy5fcmVsYXRpb25zaGlwRm9yZWlnbktleUF0dHJpYnV0ZShpbnN0YW5jZVJlbGF0aW9uc2hpcClcbiAgICAgICAgICAgIGNvbnN0IGZvcmVpZ25LZXlWYWx1ZSA9IHRoaXMuX2JlbG9uZ3NUb0ZvcmVpZ25LZXlWYWx1ZSh7bW9kZWwsIHJlbGF0aW9uc2hpcDogaW5zdGFuY2VSZWxhdGlvbnNoaXB9KVxuXG4gICAgICAgICAgICB0aGlzLnNldEF0dHJpYnV0ZShmb3JlaWduS2V5LCBmb3JlaWduS2V5VmFsdWUpXG5cbiAgICAgICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwLnNldFByZWxvYWRlZCh0cnVlKVxuICAgICAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0RGlydHkoZmFsc2UpXG5cbiAgICAgICAgICAgIHNhdmVkQ291bnQrK1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGEgcmVjb3JkIGJ1dCBnb3Q6ICR7dHlwZW9mIG1vZGVsfWApXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge3NhdmVkQ291bnR9XG4gIH1cblxuICBfYXV0b1NhdmVIYXNNYW55QW5kSGFzT25lUmVsYXRpb25zaGlwc1RvU2F2ZSgpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBzID0gW11cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT0gXCJoYXNNYW55XCIgJiYgaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpICE9IFwiaGFzT25lXCIpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldEF1dG9TYXZlKCkgPT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8qKlxuICAgICAgICogRGVmaW5lcyBsb2FkZWQuXG4gICAgICAgKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXX0gKi9cbiAgICAgIGxldCBsb2FkZWRcblxuICAgICAgY29uc3QgaGFzTWFueU9yT25lTG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKVxuXG4gICAgICBpZiAoaGFzTWFueU9yT25lTG9hZGVkKSB7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGhhc01hbnlPck9uZUxvYWRlZCkpIHtcbiAgICAgICAgICBsb2FkZWQgPSBoYXNNYW55T3JPbmVMb2FkZWRcbiAgICAgICAgfSBlbHNlIGlmIChoYXNNYW55T3JPbmVMb2FkZWQgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkge1xuICAgICAgICAgIGxvYWRlZCA9IFtoYXNNYW55T3JPbmVMb2FkZWRdXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBoYXNPbmVMb2FkZWQgdG8gYmUgYSByZWNvcmQgYnV0IGl0IHdhc24ndDogJHt0eXBlb2YgaGFzTWFueU9yT25lTG9hZGVkfWApXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGxldCB1c2VSZWxhdGlvbnNoaXAgPSBmYWxzZVxuXG4gICAgICBpZiAobG9hZGVkKSB7XG4gICAgICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbG9hZGVkKSB7XG4gICAgICAgICAgdGhpcy5iaW5kUmVsYXRlZFJlY29yZChtb2RlbClcbiAgICAgICAgICBjb25zdCBmb3JlaWduS2V5ID0gbW9kZWwuX3JlbGF0aW9uc2hpcEZvcmVpZ25LZXlBdHRyaWJ1dGUoaW5zdGFuY2VSZWxhdGlvbnNoaXApXG5cbiAgICAgICAgICBtb2RlbC5zZXRBdHRyaWJ1dGUoZm9yZWlnbktleSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUodGhpcy5pZCgpLCBgSGFzLW1hbnkgYXV0b3NhdmUgZm9yICR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX1gKSlcblxuICAgICAgICAgIGlmIChtb2RlbC5pc0NoYW5nZWQoKSkge1xuICAgICAgICAgICAgdXNlUmVsYXRpb25zaGlwID0gdHJ1ZVxuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHVzZVJlbGF0aW9uc2hpcCkgcmVsYXRpb25zaGlwcy5wdXNoKGluc3RhbmNlUmVsYXRpb25zaGlwKVxuICAgIH1cblxuICAgIHJldHVybiByZWxhdGlvbnNoaXBzXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSByZWxhdGlvbnNoaXAgZm9yZWlnbi1rZXkgY29sdW1uIHRvIHRoaXMgbW9kZWwncyBwdWJsaWMgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdDx0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQsIHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD59IGluc3RhbmNlUmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBBdHRyaWJ1dGUgbmFtZSBhY2NlcHRlZCBieSBzZXRBdHRyaWJ1dGUvYXNzaWduLlxuICAgKi9cbiAgX3JlbGF0aW9uc2hpcEZvcmVpZ25LZXlBdHRyaWJ1dGUoaW5zdGFuY2VSZWxhdGlvbnNoaXApIHtcbiAgICBjb25zdCBmb3JlaWduS2V5ID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG5cbiAgICByZXR1cm4gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW2ZvcmVpZ25LZXldIHx8IGZvcmVpZ25LZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF1dG8gc2F2ZSBoYXMgbWFueSBhbmQgaGFzIG9uZSByZWxhdGlvbnNoaXBzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuaXNOZXdSZWNvcmQgLSBXaGV0aGVyIGlzIG5ldyByZWNvcmQuXG4gICAqL1xuICBhc3luYyBfYXV0b1NhdmVIYXNNYW55QW5kSGFzT25lUmVsYXRpb25zaGlwcyh7aXNOZXdSZWNvcmR9KSB7XG4gICAgZm9yIChjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCBvZiB0aGlzLl9hdXRvU2F2ZUhhc01hbnlBbmRIYXNPbmVSZWxhdGlvbnNoaXBzVG9TYXZlKCkpIHtcbiAgICAgIGxldCBoYXNNYW55T3JPbmVMb2FkZWQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG5cbiAgICAgIC8qKlxuICAgICAgICogRGVmaW5lcyBsb2FkZWQuXG4gICAgICAgKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXX0gKi9cbiAgICAgIGxldCBsb2FkZWRcblxuICAgICAgaWYgKGhhc01hbnlPck9uZUxvYWRlZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGxvYWRlZCA9IFtdXG4gICAgICB9IGVsc2UgaWYgKGhhc01hbnlPck9uZUxvYWRlZCBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSB7XG4gICAgICAgIGxvYWRlZCA9IFtoYXNNYW55T3JPbmVMb2FkZWRdXG4gICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoaGFzTWFueU9yT25lTG9hZGVkKSkge1xuICAgICAgICBsb2FkZWQgPSBoYXNNYW55T3JPbmVMb2FkZWRcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCB0eXBlIGZvciBoYXNNYW55T3JPbmVMb2FkZWQ6ICR7dHlwZW9mIGhhc01hbnlPck9uZUxvYWRlZH1gKVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIGxvYWRlZCkge1xuICAgICAgICB0aGlzLmJpbmRSZWxhdGVkUmVjb3JkKG1vZGVsKVxuICAgICAgICBjb25zdCBmb3JlaWduS2V5ID0gbW9kZWwuX3JlbGF0aW9uc2hpcEZvcmVpZ25LZXlBdHRyaWJ1dGUoaW5zdGFuY2VSZWxhdGlvbnNoaXApXG5cbiAgICAgICAgbW9kZWwuc2V0QXR0cmlidXRlKGZvcmVpZ25LZXksIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKHRoaXMuaWQoKSwgYEhhcy1tYW55IGF1dG9zYXZlIGZvciAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9YCkpXG5cbiAgICAgICAgaWYgKG1vZGVsLmlzQ2hhbmdlZCgpKSB7XG4gICAgICAgICAgYXdhaXQgbW9kZWwuc2F2ZSgpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGlzTmV3UmVjb3JkKSB7XG4gICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwLnNldFByZWxvYWRlZCh0cnVlKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF1dG8gc2F2ZSBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwZW5kaW5nIGF0dGFjaG1lbnRzIGhhdmUgYmVlbiBzYXZlZC5cbiAgICovXG4gIGFzeW5jIF9hdXRvU2F2ZUF0dGFjaG1lbnRzKCkge1xuICAgIGZvciAoY29uc3QgYXR0YWNobWVudE5hbWUgaW4gdGhpcy5fYXR0YWNobWVudHMpIHtcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnQgPSB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV1cblxuICAgICAgaWYgKCFhdHRhY2htZW50Lmhhc1BlbmRpbmdBdHRhY2htZW50cygpKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCBhdHRhY2htZW50LmZsdXNoUGVuZGluZ0F0dGFjaG1lbnRzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0YWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0YWJsZSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHRhYmxlTmFtZSgpIHtcbiAgICBpZiAoIXRoaXMuX3RhYmxlTmFtZSkgdGhpcy5fdGFibGVOYW1lID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKGluZmxlY3Rpb24ucGx1cmFsaXplKHRoaXMuZ2V0TW9kZWxOYW1lKCkpKVxuXG4gICAgcmV0dXJuIHRoaXMuX3RhYmxlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2V0VGFibGVOYW1lKHRhYmxlTmFtZSkge1xuICAgIHRoaXMuX3RhYmxlTmFtZSA9IHRhYmxlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRyYW5zYWN0aW9uLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHRyYW5zYWN0aW9uKGNhbGxiYWNrKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9uKClcblxuICAgIGlmICghY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSB7XG4gICAgICBhd2FpdCB0aGlzLl9wcmVwYXJlQXR0YWNobWVudFN0b3JlU2NoZW1hKGNvbm5lY3Rpb24pXG4gICAgfVxuXG4gICAgY29uc3QgdXNlVHJhbnNhY3Rpb25zID0gY29ubmVjdGlvbi5nZXRBcmdzKCkucmVjb3JkPy50cmFuc2FjdGlvbnNcblxuICAgIGlmICh1c2VUcmFuc2FjdGlvbnMgIT09IGZhbHNlKSB7XG4gICAgICByZXR1cm4gYXdhaXQgY29ubmVjdGlvbi50cmFuc2FjdGlvbihjYWxsYmFjaylcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHJlcGFyZXMgdGhpcyBtb2RlbCdzIGF0dGFjaG1lbnQgc3RvcmUgYmVmb3JlIG9wZW5pbmcgYSBtb2RlbCB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIE1vZGVsIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGF0dGFjaG1lbnQgc2NoZW1hIGlzIGN1cnJlbnQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgX3ByZXBhcmVBdHRhY2htZW50U3RvcmVTY2hlbWEoY29ubmVjdGlvbikge1xuICAgIGF3YWl0IHJlY29yZEF0dGFjaG1lbnRzU3RvcmVGb3JNb2RlbENsYXNzKHRoaXMsIGNvbm5lY3Rpb24pLnByZXBhcmVSZWNvcmRJZGVudGl0eU1pZ3JhdGlvbih7Y29ubmVjdGlvbn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgY2FsbGJhY2sgd2hpbGUgaG9sZGluZyBhIG5hbWVkIGFkdmlzb3J5IGxvY2suIENhbGxzIHdpdGhvdXRcbiAgICogQnkgZGVmYXVsdCBjYWxscyB1c2UgdGhlIGNhbGxlciBjb25uZWN0aW9uLiBDYWxscyB3aXRoIGBkZWRpY2F0ZWRDb25uZWN0aW9uYFxuICAgKiB1c2UgYSBzcGF3bmVkIGxvY2sgY29ubmVjdGlvbiB0aGF0IGlzIHJlbGVhc2VkIGFmdGVyIHRoZSBjYWxsYmFjayBmaW5pc2hlcyxcbiAgICogd2hpbGUgdGhlIGNhbGxiYWNrIGl0c2VsZiBzdGlsbCBydW5zIGFnYWluc3QgdGhlIGNhbGxlci9tb2RlbCBjb25uZWN0aW9uLlxuICAgKiBDYWxscyB3aXRoIGEgcG9zaXRpdmUgYGhvbGRUaW1lb3V0TXNgIHVzZSBhIGRlZGljYXRlZCBsb2NrIGNvbm5lY3Rpb24gc29cbiAgICogdGltZW91dCBjbGVhbnVwIGNhbiByZWxlYXNlIHRoZSBsb2NrIGV2ZW4gd2hlbiBjYWxsYmFjayBkYXRhYmFzZSB3b3JrIGlzXG4gICAqIHN0dWNrLiBBZHZpc29yeSBsb2NrcyBhcmUgY29vcGVyYXRpdmUgYW5kIHNlc3Npb24tc2NvcGVkOiB0aGV5IHNlcmlhbGl6ZVxuICAgKiBjYWxsZXJzIHRoYXQgb3B0IGludG8gdGhlIHNhbWUgYG5hbWVgLCB3aXRob3V0IHRvdWNoaW5nIHJvdyBvciB0YWJsZSBsb2NrcyxcbiAgICogc28gdW5yZWxhdGVkIHRyYWZmaWMgaXMgZnJlZSB0byBwcm9jZWVkLlxuICAgKlxuICAgKiBUaGUgbG9jayBpcyBhY3F1aXJlZCBiZWZvcmUgdGhlIGNhbGxiYWNrIHJ1bnMgYW5kIHJlbGVhc2VkIGluIGFcbiAgICogYGZpbmFsbHlgIGJsb2NrIGFmdGVyd2FyZHMsIHNvIHRoZSBjYWxsYmFjaydzIHJldHVybiB2YWx1ZSBpc1xuICAgKiBwcm9wYWdhdGVkIGFuZCB0aHJvd24gZXJyb3JzIHN0aWxsIHJlbGVhc2UgdGhlIGxvY2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gaW52b2tlIHdoaWxlIHRoZSBsb2NrIGlzIGhlbGQuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGwsIGhvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBkZWRpY2F0ZWRDb25uZWN0aW9uPzogYm9vbGVhbn19IFthcmdzXSAtIGB0aW1lb3V0TXNgIGNhcHMgaG93IGxvbmcgd2Ugd2FpdCB0byBhY3F1aXJlIHRoZSBsb2NrOyBgaG9sZFRpbWVvdXRNc2AgY2FwcyBob3cgbG9uZyB0aGUgY2FsbGJhY2sgbWF5IGhvbGQgaXQgYmVmb3JlIHRoZSBsb2NrIGlzIHJlbGVhc2VkIGFuZCBgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcmAgaXMgdGhyb3duOyBgZGVkaWNhdGVkQ29ubmVjdGlvbmAgc3Bhd25zIGEgc2VwYXJhdGUgbG9jayBzZXNzaW9uIHdpdGhvdXQgZW5hYmxpbmcgYSBob2xkIHRpbWVvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrJ3MgcmV0dXJuIHZhbHVlLlxuICAgKiBAdGhyb3dzIHtBZHZpc29yeUxvY2tUaW1lb3V0RXJyb3J9IC0gSWYgYHRpbWVvdXRNc2AgZWxhcHNlcyBiZWZvcmUgdGhlIGxvY2sgaXMgZ3JhbnRlZC5cbiAgICogQHRocm93cyB7QWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcn0gLSBJZiBgaG9sZFRpbWVvdXRNc2AgZWxhcHNlcyB3aGlsZSB0aGUgY2FsbGJhY2sgaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgd2l0aEFkdmlzb3J5TG9jayhuYW1lLCBjYWxsYmFjaywgYXJncyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCBydW5uZXIgPSBuZXcgQWR2aXNvcnlMb2NrUnVubmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgIGNvbm5lY3Rpb25Qcm92aWRlcjogKCkgPT4gdGhpcy5jb25uZWN0aW9uKCksXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICB9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1bm5lci53aXRoQWR2aXNvcnlMb2NrKG5hbWUsIGNhbGxiYWNrLCBhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIGNhbGxiYWNrIG9ubHkgaWYgdGhlIG5hbWVkIGFkdmlzb3J5IGxvY2sgY2FuIGJlIGFjcXVpcmVkXG4gICAqIGltbWVkaWF0ZWx5LiBJZiB0aGUgbG9jayBpcyBhbHJlYWR5IGhlbGQgYnkgYW55IHNlc3Npb24sIHRocm93c1xuICAgKiBgQWR2aXNvcnlMb2NrQnVzeUVycm9yYCB3aXRob3V0IHdhaXRpbmcuXG4gICAqIFVzZSB0aGlzIHdoZW4gY29udGVudGlvbiBpcyBhIHNpZ25hbCB0aGF0IHNvbWVib2R5IGVsc2UgaXMgYWxyZWFkeVxuICAgKiBkb2luZyB0aGUgd29yayBhbmQgeW91IHdhbnQgdG8gYmFpbCBvdXQgcmF0aGVyIHRoYW4gcXVldWUgdXAuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gaW52b2tlIHdoaWxlIHRoZSBsb2NrIGlzIGhlbGQuXG4gICAqIEBwYXJhbSB7e2hvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBkZWRpY2F0ZWRDb25uZWN0aW9uPzogYm9vbGVhbn19IFthcmdzXSAtIGBob2xkVGltZW91dE1zYCBjYXBzIGhvdyBsb25nIHRoZSBjYWxsYmFjayBtYXkgaG9sZCB0aGUgbG9jayBiZWZvcmUgaXQgaXMgcmVsZWFzZWQgYW5kIGBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yYCBpcyB0aHJvd247IGBkZWRpY2F0ZWRDb25uZWN0aW9uYCBzcGF3bnMgYSBzZXBhcmF0ZSBsb2NrIHNlc3Npb24gd2l0aG91dCBlbmFibGluZyBhIGhvbGQgdGltZW91dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sncyByZXR1cm4gdmFsdWUuXG4gICAqIEB0aHJvd3Mge0Fkdmlzb3J5TG9ja0J1c3lFcnJvcn0gLSBJZiB0aGUgbG9jayBpcyBhbHJlYWR5IGhlbGQuXG4gICAqIEB0aHJvd3Mge0Fkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3J9IC0gSWYgYGhvbGRUaW1lb3V0TXNgIGVsYXBzZXMgd2hpbGUgdGhlIGNhbGxiYWNrIGhvbGRzIHRoZSBsb2NrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHdpdGhBZHZpc29yeUxvY2tPckZhaWwobmFtZSwgY2FsbGJhY2ssIGFyZ3MgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcnVubmVyID0gbmV3IEFkdmlzb3J5TG9ja1J1bm5lcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICBjb25uZWN0aW9uUHJvdmlkZXI6ICgpID0+IHRoaXMuY29ubmVjdGlvbigpLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgfSlcblxuICAgIHJldHVybiBhd2FpdCBydW5uZXIud2l0aEFkdmlzb3J5TG9ja09yRmFpbChuYW1lLCBjYWxsYmFjaywgYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGBjYWxsYmFja2AsIHJlamVjdGluZyB3aXRoIGBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yYCBpZiBpdCBoYXNcbiAgICogbm90IHNldHRsZWQgd2l0aGluIGBob2xkVGltZW91dE1zYC4gVGhlIGNhbGxiYWNrIGlzIG5vdCBjYW5jZWxsZWQg4oCUIHRoaXMgaXNcbiAgICogYSBzYWZldHkgbmV0LCBub3QgY2FuY2VsbGF0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZSAoZm9yIHRoZSBlcnJvciBtZXNzYWdlKS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGhvbGRpbmcgdGhlIGxvY2suXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2hvbGRUaW1lb3V0TXNdIC0gTWF4IGhvbGQgdGltZTsgZmFsc3kgZGlzYWJsZXMgdGhlIHRpbWVvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdCBhZnRlciB0aGUgbG9jay1wcm90ZWN0ZWQgb3BlcmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJ1bldpdGhBZHZpc29yeUxvY2tIb2xkVGltZW91dChuYW1lLCBjYWxsYmFjaywgaG9sZFRpbWVvdXRNcykge1xuICAgIHJldHVybiBhd2FpdCBBZHZpc29yeUxvY2tSdW5uZXIucnVuV2l0aEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0KG5hbWUsIGNhbGxiYWNrLCBob2xkVGltZW91dE1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdHJ1ZSBpZiB0aGUgbmFtZWQgYWR2aXNvcnkgbG9jayBpcyBjdXJyZW50bHkgaGVsZCBieSBhbnlcbiAgICogc2Vzc2lvbi4gUHJpbWFyaWx5IHVzZWZ1bCBhcyBhIGRpYWdub3N0aWM7IGNhbGxlcnMgdGhhdCB3YW50IHRvIGFjdFxuICAgKiBvbiB0aGUgcmVzdWx0IHNob3VsZCBwcmVmZXIgYHdpdGhBZHZpc29yeUxvY2tPckZhaWxgIHRvIGF2b2lkIGFcbiAgICogVE9DVE9VIHdpbmRvdyBiZXR3ZWVuIHRoZSBjaGVjayBhbmQgdGhlIGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGFkdmlzb3J5IGxvY2sgaXMgY3VycmVudGx5IGhlbGQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgaGFzQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS5pc0Fkdmlzb3J5TG9ja0hlbGQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyYW5zbGF0ZXMuXG4gICAqIEBwYXJhbSB7Li4uc3RyaW5nfSBuYW1lcyAtIE5hbWVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgdHJhbnNsYXRlcyguLi5uYW1lcykge1xuICAgIGNvbnN0IHRyYW5zbGF0aW9ucyA9IHRoaXMuZ2V0VHJhbnNsYXRpb25zTWFwKClcblxuICAgIGZvciAoY29uc3QgbmFtZSBvZiBuYW1lcykge1xuICAgICAgaWYgKG5hbWUgaW4gdHJhbnNsYXRpb25zKSB0aHJvdyBuZXcgRXJyb3IoYFRyYW5zbGF0aW9uIGFscmVhZHkgZXhpc3RzOiAke25hbWV9YClcblxuICAgICAgdHJhbnNsYXRpb25zW25hbWVdID0ge31cblxuICAgICAgaWYgKCF0aGlzLl9yZWxhdGlvbnNoaXBFeGlzdHMoXCJ0cmFuc2xhdGlvbnNcIikpIHtcbiAgICAgICAgdGhpcy5fZGVmaW5lUmVsYXRpb25zaGlwKFwidHJhbnNsYXRpb25zXCIsIHtkZXBlbmRlbnQ6IFwiZGVzdHJveVwiLCBrbGFzczogdGhpcy5nZXRUcmFuc2xhdGlvbkNsYXNzKCksIHR5cGU6IFwiaGFzTWFueVwifSlcbiAgICAgIH1cblxuICAgICAgaWYgKCF0aGlzLl9yZWxhdGlvbnNoaXBFeGlzdHMoXCJjdXJyZW50VHJhbnNsYXRpb25cIikpIHtcbiAgICAgICAgdGhpcy5fZGVmaW5lUmVsYXRpb25zaGlwKFwiY3VycmVudFRyYW5zbGF0aW9uXCIsIHtcbiAgICAgICAgICBrbGFzczogdGhpcy5nZXRUcmFuc2xhdGlvbkNsYXNzKCksXG4gICAgICAgICAgc2NvcGU6IChxdWVyeSkgPT4gdGhpcy5jdXJyZW50VHJhbnNsYXRpb25TY29wZShxdWVyeSksXG4gICAgICAgICAgdHlwZTogXCJoYXNPbmVcIlxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgdHJhbnNsYXRpb24gc2NvcGUuXG4gICAqIEBwYXJhbSB7TW9kZWxDbGFzc1F1ZXJ5fSBxdWVyeSAtIFRyYW5zbGF0aW9uIHF1ZXJ5LlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5fSAtIFNjb3BlZCBxdWVyeS5cbiAgICovXG4gIHN0YXRpYyBjdXJyZW50VHJhbnNsYXRpb25TY29wZShxdWVyeSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBsb2NhbGUgPSBjb25maWd1cmF0aW9uLmdldExvY2FsZSgpXG4gICAgY29uc3QgZmFsbGJhY2tzID0gY29uZmlndXJhdGlvbi5nZXRMb2NhbGVGYWxsYmFja3MoKVxuICAgIGNvbnN0IGxvY2FsZXMgPSBsb2NhbGUgPyAoZmFsbGJhY2tzPy5bbG9jYWxlXSB8fCBbbG9jYWxlXSkgOiBbXVxuXG4gICAgaWYgKGxvY2FsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gcXVlcnkud2hlcmUoXCIxPTBcIilcblxuICAgIGNvbnN0IGRyaXZlciA9IHF1ZXJ5LmRyaXZlclxuICAgIGNvbnN0IHRyYW5zbGF0aW9uQ2xhc3MgPSB0aGlzLmdldFRyYW5zbGF0aW9uQ2xhc3MoKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKFwiY3VycmVudFRyYW5zbGF0aW9uXCIpXG4gICAgY29uc3QgdGFibGVOYW1lID0gdHJhbnNsYXRpb25DbGFzcy50YWJsZU5hbWUoKVxuICAgIGNvbnN0IHNjb3BlVGFibGVSZWZlcmVuY2UgPSBgJHt0YWJsZU5hbWV9X2N1cnJlbnRfdHJhbnNsYXRpb25fc2NvcGVgXG4gICAgY29uc3QgdGFyZ2V0VGFibGVTcWwgPSBkcml2ZXIucXVvdGVUYWJsZShxdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oKSlcbiAgICBjb25zdCBzY29wZVRhYmxlU3FsID0gZHJpdmVyLnF1b3RlVGFibGUoc2NvcGVUYWJsZVJlZmVyZW5jZSlcbiAgICBjb25zdCBzY29wZVRhYmxlRnJvbVNxbCA9IGAke2RyaXZlci5xdW90ZVRhYmxlKHRhYmxlTmFtZSl9IEFTICR7c2NvcGVUYWJsZVNxbH1gXG4gICAgY29uc3QgcHJpbWFyeUtleUNvbHVtbiA9IHNjYWxhck1vZGVsUHJpbWFyeUtleSh0cmFuc2xhdGlvbkNsYXNzLnByaW1hcnlLZXkoKSwgYEN1cnJlbnQgdHJhbnNsYXRpb24gc2NvcGUgZm9yICR7dHJhbnNsYXRpb25DbGFzcy5uYW1lfWApXG4gICAgY29uc3QgZm9yZWlnbktleUNvbHVtbiA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcbiAgICBjb25zdCB0YXJnZXRQcmltYXJ5S2V5U3FsID0gYCR7dGFyZ2V0VGFibGVTcWx9LiR7ZHJpdmVyLnF1b3RlQ29sdW1uKHByaW1hcnlLZXlDb2x1bW4pfWBcbiAgICBjb25zdCB0YXJnZXRGb3JlaWduS2V5U3FsID0gYCR7dGFyZ2V0VGFibGVTcWx9LiR7ZHJpdmVyLnF1b3RlQ29sdW1uKGZvcmVpZ25LZXlDb2x1bW4pfWBcbiAgICBjb25zdCBzY29wZVByaW1hcnlLZXlTcWwgPSBgJHtzY29wZVRhYmxlU3FsfS4ke2RyaXZlci5xdW90ZUNvbHVtbihwcmltYXJ5S2V5Q29sdW1uKX1gXG4gICAgY29uc3Qgc2NvcGVGb3JlaWduS2V5U3FsID0gYCR7c2NvcGVUYWJsZVNxbH0uJHtkcml2ZXIucXVvdGVDb2x1bW4oZm9yZWlnbktleUNvbHVtbil9YFxuICAgIGNvbnN0IHNjb3BlTG9jYWxlU3FsID0gYCR7c2NvcGVUYWJsZVNxbH0uJHtkcml2ZXIucXVvdGVDb2x1bW4oXCJsb2NhbGVcIil9YFxuICAgIGNvbnN0IGxvY2FsZUxpc3RTcWwgPSBsb2NhbGVzLm1hcCgoZmFsbGJhY2tMb2NhbGUpID0+IGRyaXZlci5xdW90ZShmYWxsYmFja0xvY2FsZSkpLmpvaW4oXCIsIFwiKVxuICAgIGNvbnN0IGxvY2FsZU9yZGVyU3FsID0gbG9jYWxlcy5tYXAoKGZhbGxiYWNrTG9jYWxlLCBpbmRleCkgPT4gYFdIRU4gJHtzY29wZUxvY2FsZVNxbH0gPSAke2RyaXZlci5xdW90ZShmYWxsYmFja0xvY2FsZSl9IFRIRU4gJHtkcml2ZXIucXVvdGUoaW5kZXgpfWApLmpvaW4oXCIgXCIpXG4gICAgY29uc3QgZmFsbGJhY2tPcmRlclNxbCA9IGBDQVNFICR7bG9jYWxlT3JkZXJTcWx9IEVMU0UgJHtkcml2ZXIucXVvdGUobG9jYWxlcy5sZW5ndGgpfSBFTkRgXG4gICAgY29uc3Qgc2VsZWN0ZWRUcmFuc2xhdGlvblNxbCA9IGRyaXZlci5nZXRUeXBlKCkgPT0gXCJtc3NxbFwiXG4gICAgICA/IGBTRUxFQ1QgVE9QIDEgJHtzY29wZVByaW1hcnlLZXlTcWx9IEZST00gJHtzY29wZVRhYmxlRnJvbVNxbH0gV0hFUkUgJHtzY29wZUZvcmVpZ25LZXlTcWx9ID0gJHt0YXJnZXRGb3JlaWduS2V5U3FsfSBBTkQgJHtzY29wZUxvY2FsZVNxbH0gSU4gKCR7bG9jYWxlTGlzdFNxbH0pIE9SREVSIEJZICR7ZmFsbGJhY2tPcmRlclNxbH0sICR7c2NvcGVQcmltYXJ5S2V5U3FsfSBBU0NgXG4gICAgICA6IGBTRUxFQ1QgJHtzY29wZVByaW1hcnlLZXlTcWx9IEZST00gJHtzY29wZVRhYmxlRnJvbVNxbH0gV0hFUkUgJHtzY29wZUZvcmVpZ25LZXlTcWx9ID0gJHt0YXJnZXRGb3JlaWduS2V5U3FsfSBBTkQgJHtzY29wZUxvY2FsZVNxbH0gSU4gKCR7bG9jYWxlTGlzdFNxbH0pIE9SREVSIEJZICR7ZmFsbGJhY2tPcmRlclNxbH0sICR7c2NvcGVQcmltYXJ5S2V5U3FsfSBBU0MgTElNSVQgMWBcblxuICAgIHJldHVybiBxdWVyeS53aGVyZShgJHt0YXJnZXRQcmltYXJ5S2V5U3FsfSA9ICgke3NlbGVjdGVkVHJhbnNsYXRpb25TcWx9KWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHJhbnNsYXRpb24gY2xhc3MuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IC0gVGhlIHRyYW5zbGF0aW9uIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIGdldFRyYW5zbGF0aW9uQ2xhc3MoKSB7XG4gICAgaWYgKHRoaXMuX3RyYW5zbGF0aW9uQ2xhc3MpIHJldHVybiB0aGlzLl90cmFuc2xhdGlvbkNsYXNzXG4gICAgaWYgKHRoaXMudGFibGVOYW1lKCkuZW5kc1dpdGgoXCJfdHJhbnNsYXRpb25zXCIpKSB0aHJvdyBuZXcgRXJyb3IoXCJUcnlpbmcgdG8gZGVmaW5lIGEgdHJhbnNsYXRpb25zIGNsYXNzIGZvciBhIHRyYW5zbGF0aW9uIGNsYXNzXCIpXG5cbiAgICBjb25zdCBjbGFzc05hbWUgPSBgJHt0aGlzLmdldE1vZGVsTmFtZSgpfVRyYW5zbGF0aW9uYFxuICAgIGNvbnN0IFRyYW5zbGF0aW9uQ2xhc3MgPSBjbGFzcyBUcmFuc2xhdGlvbiBleHRlbmRzIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHt9XG4gICAgY29uc3QgYmVsb25nc1RvID0gc2luZ3VsYXJpemVNb2RlbE5hbWUoaW5mbGVjdGlvbi5jYW1lbGl6ZSh0aGlzLnRhYmxlTmFtZSgpLCB0cnVlKSlcblxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShUcmFuc2xhdGlvbkNsYXNzLCBcIm5hbWVcIiwge3ZhbHVlOiBjbGFzc05hbWV9KVxuICAgIFRyYW5zbGF0aW9uQ2xhc3Muc2V0VGFibGVOYW1lKHRoaXMuZ2V0VHJhbnNsYXRpb25zVGFibGVOYW1lKCkpXG4gICAgVHJhbnNsYXRpb25DbGFzcy5iZWxvbmdzVG8oYmVsb25nc1RvKVxuXG4gICAgaWYgKHRoaXMuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSkge1xuICAgICAgY29uc3QgdHJhbnNsYXRlZE1vZGVsQ2xhc3MgPSB0aGlzXG5cbiAgICAgIFRyYW5zbGF0aW9uQ2xhc3Muc3dpdGNoZXNUZW5hbnREYXRhYmFzZSgoe3RlbmFudH0pID0+IHRyYW5zbGF0ZWRNb2RlbENsYXNzLmdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcih0ZW5hbnQpKVxuICAgIH1cblxuICAgIHRoaXMuX3RyYW5zbGF0aW9uQ2xhc3MgPSBUcmFuc2xhdGlvbkNsYXNzXG5cbiAgICByZXR1cm4gdGhpcy5fdHJhbnNsYXRpb25DbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0aW9ucyB0YWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0cmFuc2xhdGlvbnMgdGFibGUgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRUcmFuc2xhdGlvbnNUYWJsZU5hbWUoKSB7XG4gICAgY29uc3QgdGFibGVOYW1lUGFydHMgPSB0aGlzLnRhYmxlTmFtZSgpLnNwbGl0KFwiX1wiKVxuXG4gICAgdGFibGVOYW1lUGFydHNbdGFibGVOYW1lUGFydHMubGVuZ3RoIC0gMV0gPSBpbmZsZWN0aW9uLnNpbmd1bGFyaXplKHRhYmxlTmFtZVBhcnRzW3RhYmxlTmFtZVBhcnRzLmxlbmd0aCAtIDFdKVxuXG4gICAgcmV0dXJuIGAke3RhYmxlTmFtZVBhcnRzLmpvaW4oXCJfXCIpfV90cmFuc2xhdGlvbnNgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgdHJhbnNsYXRpb25zIHRhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBSZXNvbHZlcyB3aXRoIFdoZXRoZXIgaXQgaGFzIHRyYW5zbGF0aW9ucyB0YWJsZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBoYXNUcmFuc2xhdGlvbnNUYWJsZSgpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkuZ2V0VGFibGVCeU5hbWUodGhpcy5nZXRUcmFuc2xhdGlvbnNUYWJsZU5hbWUoKSlcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgdmFsaWRhdGlvbiB0byBhbiBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIFRoZSBuYW1lIG9mIHRoZSBhdHRyaWJ1dGUgdG8gdmFsaWRhdGUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHZhbGlkYXRvcnMgVGhlIHZhbGlkYXRvcnMgdG8gYWRkLiBLZXkgaXMgdGhlIHZhbGlkYXRvciBuYW1lLCB2YWx1ZSBpcyB0aGUgdmFsaWRhdG9yIGFyZ3VtZW50cy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB2YWxpZGF0ZXMoYXR0cmlidXRlTmFtZSwgdmFsaWRhdG9ycykge1xuICAgIGZvciAoY29uc3QgdmFsaWRhdG9yTmFtZSBpbiB2YWxpZGF0b3JzKSB7XG4gICAgICAvKipcbiAgICAgICAqIERlZmluZXMgdmFsaWRhdG9yQXJncy5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBsZXQgdmFsaWRhdG9yQXJnc1xuXG4gICAgICAvKipcbiAgICAgICAqIFVzZSB2YWxpZGF0b3IuXG4gICAgICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICAgIGxldCB1c2VWYWxpZGF0b3IgPSB0cnVlXG5cbiAgICAgIGNvbnN0IHZhbGlkYXRvckFyZ3NDYW5kaWRhdGUgPSB2YWxpZGF0b3JzW3ZhbGlkYXRvck5hbWVdXG5cbiAgICAgIGlmICh0eXBlb2YgdmFsaWRhdG9yQXJnc0NhbmRpZGF0ZSA9PSBcImJvb2xlYW5cIikge1xuICAgICAgICB2YWxpZGF0b3JBcmdzID0ge31cbiAgICAgICAgdXNlVmFsaWRhdG9yXG5cbiAgICAgICAgaWYgKCF2YWxpZGF0b3JBcmdzQ2FuZGlkYXRlKSB7XG4gICAgICAgICAgdXNlVmFsaWRhdG9yID0gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFsaWRhdG9yQXJncyA9IHZhbGlkYXRvckFyZ3NDYW5kaWRhdGVcbiAgICAgIH1cblxuICAgICAgaWYgKCF1c2VWYWxpZGF0b3IpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgVmFsaWRhdG9yQ2xhc3MgPSB0aGlzLmdldFZhbGlkYXRvclR5cGUodmFsaWRhdG9yTmFtZSlcbiAgICAgIGNvbnN0IHZhbGlkYXRvciA9IG5ldyBWYWxpZGF0b3JDbGFzcyh7YXR0cmlidXRlTmFtZSwgYXJnczogdmFsaWRhdG9yQXJnc30pXG5cbiAgICAgIGlmICghdGhpcy5fdmFsaWRhdG9ycykgdGhpcy5fdmFsaWRhdG9ycyA9IHt9XG4gICAgICBpZiAoIShhdHRyaWJ1dGVOYW1lIGluIHRoaXMuX3ZhbGlkYXRvcnMpKSB0aGlzLl92YWxpZGF0b3JzW2F0dHJpYnV0ZU5hbWVdID0gW11cblxuICAgICAgdGhpcy5fdmFsaWRhdG9yc1thdHRyaWJ1dGVOYW1lXS5wdXNoKHZhbGlkYXRvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGdhcC1sZXNzIHBvc2l0aW9uYWwgbGlzdCBjYWxsYmFja3MgZm9yIGEgY29sdW1uIHNjb3BlZCBieVxuICAgKiBhbm90aGVyIGNvbHVtbi4gSW5zZXJ0cyBhbmQgbW92ZXMgc2hpZnQgc3Vycm91bmRpbmcgcG9zaXRpb25zIHNvIHRoZVxuICAgKiBsaXN0IHN0YXlzIGNvbXBhY3QgKDEsMiwzLC4uLikuIERlc3Ryb3lzIGNsb3NlIHRoZSByZXN1bHRpbmcgZ2FwLlxuICAgKlxuICAgKiBDYWxsZXJzIG11c3QgZW5zdXJlIGEgVU5JUVVFIGluZGV4IG9uIChzY29wZUNvbHVtbiwgcG9zaXRpb25Db2x1bW4pXG4gICAqIGV4aXN0cyBpbiB0aGUgZGF0YWJhc2Ug4oCUIHVzZSBgTWlncmF0aW9uLmFkZEFjdHNBc0xpc3QoKWAgZm9yIHRoZVxuICAgKiBzY2hlbWEgaGFsZi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHBvc2l0aW9uQ29sdW1uIC0gY2FtZWxDYXNlIHBvc2l0aW9uIGF0dHJpYnV0ZSAoZS5nLiBcInJvd051bWJlclwiKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnMgLSBPcHRpb25zIHdpdGggYSByZXF1aXJlZCBzY29wZSBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcHRpb25zLnNjb3BlIC0gY2FtZWxDYXNlIHNjb3BlIGF0dHJpYnV0ZSAoZS5nLiBcImJvYXJkQ29sdW1uSWRcIikuXG4gICAqL1xuICBzdGF0aWMgYWN0c0FzTGlzdChwb3NpdGlvbkNvbHVtbiwgb3B0aW9ucykge1xuICAgIGNvbnN0IHtzY29wZX0gPSBvcHRpb25zXG5cbiAgICByZWdpc3RlckFjdHNBc0xpc3RDYWxsYmFja3ModGhpcywgcG9zaXRpb25Db2x1bW4sIHtzY29wZX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cmFuc2xhdGlvbnMgbG9hZGVkLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1RyYW5zbGF0aW9uQmFzZVtdfSAtIFRoZSB0cmFuc2xhdGlvbnMgbG9hZGVkLlxuICAgKi9cbiAgdHJhbnNsYXRpb25zTG9hZGVkKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIid0cmFuc2xhdGlvbnNMb2FkZWQnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0ZWQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsb2NhbGUgLSBMb2NhbGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIHRyYW5zbGF0ZWQgYXR0cmlidXRlLCBpZiBmb3VuZC5cbiAgICovXG4gIF9nZXRUcmFuc2xhdGVkQXR0cmlidXRlKG5hbWUsIGxvY2FsZSkge1xuICAgIGNvbnN0IHRyYW5zbGF0aW9uID0gdGhpcy50cmFuc2xhdGlvbnNMb2FkZWQoKS5maW5kKCh0cmFuc2xhdGlvbikgPT4gdHJhbnNsYXRpb24ubG9jYWxlKCkgPT0gbG9jYWxlKVxuXG4gICAgaWYgKHRyYW5zbGF0aW9uKSB7XG4gICAgICAvKipcbiAgICAgICAqIERpY3QuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3QgZGljdCA9IHRyYW5zbGF0aW9uXG5cbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU1ldGhvZCA9IC8qKiBAdHlwZSB7KCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkfSAqLyAoZGljdFtuYW1lXSlcblxuICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVNZXRob2QgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGVNZXRob2QuYmluZCh0cmFuc2xhdGlvbikoKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIHRyYW5zbGF0ZWQgbWV0aG9kOiAke25hbWV9ICgke3R5cGVvZiBhdHRyaWJ1dGVNZXRob2R9KWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0ZWQgYXR0cmlidXRlIHdpdGggZmFsbGJhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2FsZSAtIExvY2FsZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgdHJhbnNsYXRlZCBhdHRyaWJ1dGUgd2l0aCBmYWxsYmFjaywgaWYgZm91bmQuXG4gICAqL1xuICBfZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZVdpdGhGYWxsYmFjayhuYW1lLCBsb2NhbGUpIHtcbiAgICBsZXQgbG9jYWxlc0luT3JkZXJcbiAgICBjb25zdCBmYWxsYmFja3MgPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0TG9jYWxlRmFsbGJhY2tzKClcblxuICAgIGlmIChmYWxsYmFja3MgJiYgbG9jYWxlIGluIGZhbGxiYWNrcykge1xuICAgICAgbG9jYWxlc0luT3JkZXIgPSBmYWxsYmFja3NbbG9jYWxlXVxuICAgIH0gZWxzZSB7XG4gICAgICBsb2NhbGVzSW5PcmRlciA9IFtsb2NhbGVdXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBmYWxsYmFja0xvY2FsZSBvZiBsb2NhbGVzSW5PcmRlcikge1xuICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5fZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZShuYW1lLCBmYWxsYmFja0xvY2FsZSlcblxuICAgICAgaWYgKHJlc3VsdCAmJiByZXN1bHQudHJpbSgpICE9IFwiXCIpIHtcbiAgICAgICAgcmV0dXJuIHJlc3VsdFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0cmFuc2xhdGVkIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbG9jYWxlIC0gTG9jYWxlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBuZXdWYWx1ZSAtIE5ldyB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGUobmFtZSwgbG9jYWxlLCBuZXdWYWx1ZSkge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgdHJhbnNsYXRpb24uXG4gICAgICogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHwgVHJhbnNsYXRpb25CYXNlIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCB0cmFuc2xhdGlvblxuXG4gICAgdHJhbnNsYXRpb24gPSB0aGlzLnRyYW5zbGF0aW9uc0xvYWRlZCgpPy5maW5kKCh0cmFuc2xhdGlvbikgPT4gdHJhbnNsYXRpb24ubG9jYWxlKCkgPT0gbG9jYWxlKVxuXG4gICAgaWYgKCF0cmFuc2xhdGlvbikge1xuICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShcInRyYW5zbGF0aW9uc1wiKVxuXG4gICAgICB0cmFuc2xhdGlvbiA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmJ1aWxkKHtsb2NhbGV9KVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEFzc2lnbm1lbnRzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYXNzaWdubWVudHMgPSB7fVxuXG4gICAgYXNzaWdubWVudHNbbmFtZV0gPSBuZXdWYWx1ZVxuXG4gICAgdHJhbnNsYXRpb24uYXNzaWduKGFzc2lnbm1lbnRzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV3IHF1ZXJ5LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3tkcml2ZXI/OiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8ICgoKSA9PiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCksIG9wZXJhdGlvbj86IGltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0fX0gW2FyZ3NdIC0gRXhwbGljaXQgcXVlcnkgb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgbmV3IHF1ZXJ5LlxuICAgKi9cbiAgc3RhdGljIF9uZXdRdWVyeShhcmdzID0ge30pIHtcbiAgICBjb25zdCB7ZHJpdmVyOiBnaXZlbkRyaXZlciwgb3BlcmF0aW9uOiBnaXZlbk9wZXJhdGlvbiwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgY29uc3Qgb3BlcmF0aW9uID0gZ2l2ZW5PcGVyYXRpb24gfHwgdGhpcy5fcmVjb3JkTWV0YWRhdGFPcGVyYXRpb25cbiAgICBjb25zdCBkcml2ZXIgPSBnaXZlbkRyaXZlciB8fCAob3BlcmF0aW9uID8gb3BlcmF0aW9uLmNvbm5lY3Rpb24oKSA6ICgpID0+IHRoaXMuY29ubmVjdGlvbigpKVxuICAgIHRoaXMuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgY29uc3QgaGFuZGxlciA9IG5ldyBIYW5kbGVyKClcbiAgICBjb25zdCBxdWVyeSA9IG5ldyBNb2RlbENsYXNzUXVlcnkoe1xuICAgICAgZHJpdmVyLFxuICAgICAgaGFuZGxlcixcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICBvcGVyYXRpb25cbiAgICB9KVxuXG4gICAgcmV0dXJuIHF1ZXJ5LmZyb20obmV3IEZyb21UYWJsZSh0aGlzLnRhYmxlTmFtZSgpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9yZGVyYWJsZSBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIG9yZGVyYWJsZSBjb2x1bW4uXG4gICAqL1xuICBzdGF0aWMgb3JkZXJhYmxlQ29sdW1uKCkge1xuICAgIC8vIEZJWE1FOiBBbGxvdyB0byBjaGFuZ2UgdG8gJ2NyZWF0ZWRfYXQnIGlmIHVzaW5nIFVVSUQ/XG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5wcmltYXJ5S2V5KClcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpKSByZXR1cm4gcHJpbWFyeUtleVswXVxuXG4gICAgcmV0dXJuIHByaW1hcnlLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFsbC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIGFsbC5cbiAgICovXG4gIHN0YXRpYyBhbGwoKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjY2Vzc2libGUgZm9yLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24gdG8gc2NvcGUgYnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IFthYmlsaXR5XSAtIEFiaWxpdHkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIEF1dGhvcml6ZWQgcXVlcnkuXG4gICAqL1xuICBzdGF0aWMgYWNjZXNzaWJsZUZvcihhY3Rpb24sIGFiaWxpdHkpIHtcbiAgICBjb25zdCBxdWVyeSA9IHRoaXMuX25ld1F1ZXJ5KClcbiAgICBjb25zdCBjdXJyZW50QWJpbGl0eSA9IGFiaWxpdHkgfHwgQ3VycmVudC5hYmlsaXR5KClcblxuICAgIGlmICghY3VycmVudEFiaWxpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gYWJpbGl0eSBpbiBjb250ZXh0IGZvciAke3RoaXMubmFtZX0uIFBhc3MgYW4gYWJpbGl0eSBvciBjb25maWd1cmUgYWJpbGl0eSByZXNvbHZlciBvbiB0aGUgcmVxdWVzdGApXG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gKi8gKGN1cnJlbnRBYmlsaXR5LmFwcGx5VG9RdWVyeSh7XG4gICAgICBhY3Rpb24sXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgcXVlcnlcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjY2Vzc2libGUuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IFthYmlsaXR5XSAtIEFiaWxpdHkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIEF1dGhvcml6ZWQgcXVlcnkuXG4gICAqL1xuICBzdGF0aWMgYWNjZXNzaWJsZShhYmlsaXR5KSB7XG4gICAgcmV0dXJuIHRoaXMuYWNjZXNzaWJsZUZvcihcInJlYWRcIiwgYWJpbGl0eSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjY2Vzc2libGUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHR9IGFiaWxpdHkgLSBBYmlsaXR5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBBdXRob3JpemVkIHF1ZXJ5LlxuICAgKi9cbiAgc3RhdGljIGFjY2Vzc2libGVCeShhYmlsaXR5KSB7XG4gICAgaWYgKCFhYmlsaXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGFiaWxpdHkgcGFzc2VkIHRvICR7dGhpcy5uYW1lfS5hY2Nlc3NpYmxlQnkoYWJpbGl0eSkuYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5hY2Nlc3NpYmxlKGFiaWxpdHkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb3VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb3VudC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjb3VudCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmNvdW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdyb3VwLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gZ3JvdXAgLSBHcm91cC5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIGdyb3VwLlxuICAgKi9cbiAgc3RhdGljIGdyb3VwKGdyb3VwKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KCkuZ3JvdXAoZ3JvdXApXG4gIH1cblxuICBzdGF0aWMgYXN5bmMgZGVzdHJveUFsbCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmRlc3Ryb3lBbGwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGx1Y2suXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7Li4uc3RyaW5nfHN0cmluZ1tdfSBjb2x1bW5zIC0gQ29sdW1uIG5hbWVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHBsdWNrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHBsdWNrKC4uLmNvbHVtbnMpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLnBsdWNrKC4uLmNvbHVtbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSByZWNvcmRJZCAtIFJlY29yZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZmluZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kKHJlY29yZElkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5maW5kKHJlY29yZElkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHt7W2tleTogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyfX0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMgaGFzaCBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPiB8IG51bGw+fSAtIFJlc29sdmVzIHdpdGggdGhlIGJ5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRCeShjb25kaXRpb25zKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5maW5kQnkoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgb3IgZmFpbC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHt7W2tleTogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyfX0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMgaGFzaCBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYnkgb3IgZmFpbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kQnlPckZhaWwoY29uZGl0aW9ucykge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkuZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhbiBpbW11dGFibGUgdGVuYW50LWJvdW5kIG1vZGVsIHNjb3BlLiBFYWdlciBoZWxwZXJzIGFuZCBleHBsaWNpdFxuICAgKiBkYXRhYmFzZU9wZXJhdGlvbi90cmFuc2FjdGlvbiBjYWxsYmFja3MgZXhlY3V0ZSBmcm9tIGEgY2FwdHVyZWQgcGh5c2ljYWxcbiAgICogZGF0YWJhc2UgY29uZmlndXJhdGlvbiBpbnN0ZWFkIG9mIGFtYmllbnQgdGVuYW50IHN0YXRlLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge29iamVjdH0gdGVuYW50IC0gT3JkaW5hcnkgb3IgbnVsbC1wcm90b3R5cGUgSlNPTi1jb21wYXRpYmxlIHRlbmFudCBkZXNjcmlwdG9yIHRvIHNjb3BlIHRoZSBtb2RlbCB0by5cbiAgICogQHJldHVybnMge1RlbmFudE1vZGVsU2NvcGU8TUM+fSAtIE1vZGVsIHNjb3BlIGJvdW5kIHRvIHRoZSBjYXB0dXJlZCB0ZW5hbnQgZGF0YWJhc2UuXG4gICAqL1xuICBzdGF0aWMgdXNpbmdUZW5hbnQodGVuYW50KSB7XG4gICAgcmV0dXJuIG5ldyBUZW5hbnRNb2RlbFNjb3BlKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICB0ZW5hbnRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBjcmVhdGUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7e1trZXk6IHN0cmluZ106IHN0cmluZyB8IG51bWJlcn19IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIGhhc2gga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBvciBjcmVhdGUgYnkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZE9yQ3JlYXRlQnkoY29uZGl0aW9ucywgY2FsbGJhY2spIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmZpbmRPckNyZWF0ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBpbml0aWFsaXplIGJ5LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zLlxuICAgKiBAcGFyYW0geyhhcmc6IEluc3RhbmNlVHlwZTxNQz4pID0+IHZvaWR9IFtjYWxsYmFja10gLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgb3IgaW5pdGlhbGl6ZSBieS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucywgY2FsbGJhY2spIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmZpbmRPckluaXRpYWxpemVCeShjb25kaXRpb25zLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpcnN0LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBmaXJzdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaXJzdCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkuZmlyc3QoKVxuXG4gICAgaWYgKCFyZXN1bHQpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9LmZpcnN0KCkgcmV0dXJuZWQgbm8gcmVjb3Jkc2ApXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBqb2lucy5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBpbXBvcnQoXCIuLi9xdWVyeS9qb2luLW9iamVjdC5qc1wiKS5Kb2luT2JqZWN0fSBqb2luIC0gSm9pbiBjbGF1c2Ugb3Igam9pbiBkZXNjcmlwdG9yLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgam9pbnMuXG4gICAqL1xuICBzdGF0aWMgam9pbnMoam9pbikge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLmpvaW5zKGpvaW4pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsYXN0LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBsYXN0LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGxhc3QoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmxhc3QoKVxuXG4gICAgaWYgKCFyZXN1bHQpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9Lmxhc3QoKSByZXR1cm5lZCBubyByZWNvcmRzYClcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxpbWl0LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBsaW1pdC5cbiAgICovXG4gIHN0YXRpYyBsaW1pdCh2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLmxpbWl0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3JkZXIuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuT3JkZXJBcmd1bWVudFR5cGV9IG9yZGVyIC0gT3JkZXIuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBvcmRlci5cbiAgICovXG4gIHN0YXRpYyBvcmRlcihvcmRlcikge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLm9yZGVyKG9yZGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzdGluY3QuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW3ZhbHVlXSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIGRpc3RpbmN0LlxuICAgKi9cbiAgc3RhdGljIGRpc3RpbmN0KHZhbHVlID0gdHJ1ZSkge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLmRpc3RpbmN0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlbG9hZC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHByZWxvYWQgLSBQcmVsb2FkLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgcHJlbG9hZC5cbiAgICovXG4gIHN0YXRpYyBwcmVsb2FkKHByZWxvYWQpIHtcbiAgICBjb25zdCBxdWVyeSA9IC8qKiBAdHlwZSB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gKi8gKHRoaXMuX25ld1F1ZXJ5KCkucHJlbG9hZChwcmVsb2FkKSlcblxuICAgIHJldHVybiBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VsZWN0LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLlNlbGVjdEFyZ3VtZW50VHlwZX0gc2VsZWN0IC0gU2VsZWN0LlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgc2VsZWN0LlxuICAgKi9cbiAgc3RhdGljIHNlbGVjdChzZWxlY3QpIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS5zZWxlY3Qoc2VsZWN0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYXJyYXkuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz5bXT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYXJyYXkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgdG9BcnJheSgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLnRvQXJyYXkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPltdPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBhcnJheS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsb2FkKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkubG9hZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGVyZS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5XaGVyZUFyZ3VtZW50VHlwZX0gd2hlcmUgLSBXaGVyZS5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIHdoZXJlLlxuICAgKi9cbiAgc3RhdGljIHdoZXJlKHdoZXJlKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KCkud2hlcmUod2hlcmUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByYW5zYWNrLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmFuc2Fjay1zdHlsZSBwYXJhbXMgaGFzaC5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gUXVlcnkgd2l0aCBSYW5zYWNrIGZpbHRlcnMgYXBwbGllZC5cbiAgICovXG4gIHN0YXRpYyByYW5zYWNrKHBhcmFtcykge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLnJhbnNhY2socGFyYW1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7V3JpdGVBdHRyaWJ1dGVzfSBjaGFuZ2VzIC0gQ2hhbmdlcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGNoYW5nZXMgPSAvKiogQHR5cGUge1dyaXRlQXR0cmlidXRlc30gKi8gKHt9KSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gKi8gKG5ldy50YXJnZXQpXG5cbiAgICB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbiA9IE1vZGVsQ2xhc3MuX3JlY29yZE1ldGFkYXRhT3BlcmF0aW9uXG4gICAgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgdGhpcy5fYXR0cmlidXRlcyA9IHt9XG4gICAgdGhpcy5fY2hhbmdlcyA9IHt9XG4gICAgdGhpcy5faXNOZXdSZWNvcmQgPSB0cnVlXG5cbiAgICBmb3IgKGNvbnN0IGtleSBpbiBjaGFuZ2VzKSB7XG4gICAgICB0aGlzLnNldEF0dHJpYnV0ZShrZXksIGNoYW5nZXNba2V5XSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQmluZHMgZnV0dXJlIHF1ZXJ5LCBsaWZlY3ljbGUsIHJlbGF0aW9uc2hpcCwgYW5kIHBlcnNpc3RlbmNlIHdvcmsgdG8gYW4gb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBvcGVyYXRpb24gLSBPd25pbmcgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBCb3VuZCByZWNvcmQuXG4gICAqL1xuICBiaW5kRGF0YWJhc2VPcGVyYXRpb24ob3BlcmF0aW9uKSB7XG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uICYmIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uICE9PSBvcGVyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlY29yZCBpcyBhbHJlYWR5IGJvdW5kIHRvIGFub3RoZXIgZGF0YWJhc2Ugb3BlcmF0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24gPSBvcGVyYXRpb25cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgYW5kIHZhbGlkYXRlcyB0aGUgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkgdGhhdCBvd25zIHRoaXMgcmVjb3JkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGl0eSAtIE9wYXF1ZSBvcGVyYXRpb24vY29ubmVjdGlvbiBpZGVudGl0eS5cbiAgICogQHJldHVybnMge3RoaXN9IFRoaXMgcmVjb3JkLlxuICAgKi9cbiAgY2FwdHVyZURhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSkge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZUlkZW50aXR5ICYmIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgIT09IGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlY29yZCBiZWxvbmdzIHRvIGEgZGlmZmVyZW50IHBoeXNpY2FsIHRlbmFudCBkYXRhYmFzZVwiKVxuICAgIH1cblxuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgPSBkYXRhYmFzZUlkZW50aXR5XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNhcHR1cmVkIHBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSBDYXB0dXJlZCBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAgICovXG4gIGRhdGFiYXNlSWRlbnRpdHkoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyB0aGlzIHJlY29yZCBmcm9tIGEgY29tcGxldGVkIGVhZ2VyLWhlbHBlciBvcGVyYXRpb24gd2hpbGVcbiAgICogcHJlc2VydmluZyB0aGUgbGVnYWN5IGFtYmllbnQgZm9sbG93LXVwIGJlaGF2aW9yIG9mIGB1c2luZ1RlbmFudGAgZmluZGVycy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdH0gb3BlcmF0aW9uIC0gUmVsZWFzaW5nIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUmVjb3JkLlxuICAgKi9cbiAgcmVsZWFzZURhdGFiYXNlT3BlcmF0aW9uKG9wZXJhdGlvbikge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbiAhPT0gb3BlcmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWNvcmQgaXMgbm90IGJvdW5kIHRvIHRoZSByZWxlYXNpbmcgZGF0YWJhc2Ugb3BlcmF0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24gPSB1bmRlZmluZWRcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZXhwbGljaXQgb3BlcmF0aW9uIG93bmluZyB0aGlzIHJlY29yZCwgaWYgYW55LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gT3duaW5nIG9wZXJhdGlvbi5cbiAgICovXG4gIGRhdGFiYXNlT3BlcmF0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEJpbmRzIGEgcmVsYXRlZCByZWNvcmQgdG8gdGhlIHNhbWUgb3BlcmF0aW9uIGFzIHRoaXMgcmVjb3JkLlxuICAgKiBAdGVtcGxhdGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNb2RlbFxuICAgKiBAcGFyYW0ge01vZGVsfSByZWNvcmQgLSBSZWxhdGVkIHJlY29yZC5cbiAgICogQHJldHVybnMge01vZGVsfSAtIFJlbGF0ZWQgcmVjb3JkLlxuICAgKi9cbiAgYmluZFJlbGF0ZWRSZWNvcmQocmVjb3JkKSB7XG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi5iaW5kUmVjb3JkKHJlY29yZClcblxuICAgIHJldHVybiByZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBtb2RlbCBxdWVyeSBwcmVzZXJ2aW5nIHRoaXMgcmVjb3JkJ3Mgb3BlcmF0aW9uIG93bmVyc2hpcC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEBwYXJhbSB7TUN9IE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRhcmdldCBxdWVyeS5cbiAgICovXG4gIHF1ZXJ5Rm9yTW9kZWwoTW9kZWxDbGFzcykge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbikgcmV0dXJuIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLmZvck1vZGVsKE1vZGVsQ2xhc3MpXG5cbiAgICByZXR1cm4gTW9kZWxDbGFzcy5fbmV3UXVlcnkoKVxuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemVzIGEgcmVsYXRpb25zaGlwL3ByZWxvYWQgdGFyZ2V0IHdpdGhvdXQgZHJvcHBpbmcgdGhpcyByZWNvcmQnc1xuICAgKiBleHBsaWNpdCBvcGVyYXRpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gT3duaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVNb2RlbENsYXNzSW5pdGlhbGl6ZWQoTW9kZWxDbGFzcywgY29uZmlndXJhdGlvbikge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbikge1xuICAgICAgYXdhaXQgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24uZW5zdXJlTW9kZWxJbml0aWFsaXplZChNb2RlbENsYXNzKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgTW9kZWxDbGFzcy5lbnN1cmVJbml0aWFsaXplZCh7Y29uZmlndXJhdGlvbn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkIGV4aXN0aW5nIHJlY29yZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBDb2x1bW4ta2V5ZWQgZGF0YWJhc2UgdmFsdWVzLlxuICAgKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBbc2VsZWN0ZWRBdHRyaWJ1dGVBbGlhc2VzXSAtIEV4cGxpY2l0IHJlc3VsdCBhbGlhc2VzIHNlbGVjdGVkIGJ5IHRoZSBsb2FkaW5nIHF1ZXJ5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBsb2FkRXhpc3RpbmdSZWNvcmQoYXR0cmlidXRlcywgc2VsZWN0ZWRBdHRyaWJ1dGVBbGlhc2VzID0gbmV3IFNldCgpKSB7XG4gICAgdGhpcy5fYXR0cmlidXRlcyA9IGF0dHJpYnV0ZXNcbiAgICB0aGlzLl9zZWxlY3RlZEF0dHJpYnV0ZUFsaWFzZXMgPSBuZXcgU2V0KHNlbGVjdGVkQXR0cmlidXRlQWxpYXNlcylcbiAgICB0aGlzLl9pc05ld1JlY29yZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyB0aGUgZ2l2ZW4gYXR0cmlidXRlcyB0byB0aGUgcmVjb3JkLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlc1RvQXNzaWduIC0gQXR0cmlidXRlcyB0byBhc3NpZ24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFzc2lnbihhdHRyaWJ1dGVzVG9Bc3NpZ24pIHtcbiAgICB0aGlzLl9hc3NpZ25lZEF0dHJpYnV0ZU5hbWVzIHx8PSBuZXcgU2V0KClcbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZVRvQXNzaWduIGluIGF0dHJpYnV0ZXNUb0Fzc2lnbikge1xuICAgICAgdGhpcy5fYXNzaWduZWRBdHRyaWJ1dGVOYW1lcy5hZGQoYXR0cmlidXRlVG9Bc3NpZ24pXG4gICAgICB0aGlzLnNldEF0dHJpYnV0ZShhdHRyaWJ1dGVUb0Fzc2lnbiwgYXR0cmlidXRlc1RvQXNzaWduW2F0dHJpYnV0ZVRvQXNzaWduXSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIHRoZSBjdXJyZW50IGF0dHJpYnV0ZXMgb2YgdGhlIHJlY29yZCAob3JpZ2luYWwgYXR0cmlidXRlcyBmcm9tIGRhdGFiYXNlIHBsdXMgY2hhbmdlcylcbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBUaGUgYXR0cmlidXRlcy5cbiAgICovXG4gIGF0dHJpYnV0ZXMoKSB7XG4gICAgY29uc3QgZGF0YSA9IHRoaXMucmF3QXR0cmlidXRlcygpXG4gICAgY29uc3QgY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVxuICAgIC8qKlxuICAgICAqIEF0dHJpYnV0ZXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0ge31cblxuICAgIGZvciAoY29uc3QgY29sdW1uTmFtZSBpbiBkYXRhKSB7XG4gICAgICBpZiAoT2JqZWN0Lmhhc093bihjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lLCBjb2x1bW5OYW1lKSkge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVtjb2x1bW5OYW1lXVxuXG4gICAgICAgIGF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB0aGlzLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5fc2VsZWN0ZWRBdHRyaWJ1dGVBbGlhc2VzLmhhcyhjb2x1bW5OYW1lKSkge1xuICAgICAgICBhdHRyaWJ1dGVzW2NvbHVtbk5hbWVdID0gZGF0YVtjb2x1bW5OYW1lXVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBjb2x1bW4tbmFtZSBrZXllZCBkYXRhIChvcmlnaW5hbCBhdHRyaWJ1dGVzIGZyb20gZGF0YWJhc2UgcGx1cyBjaGFuZ2VzKVxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFRoZSByYXcgYXR0cmlidXRlcy5cbiAgICovXG4gIHJhd0F0dHJpYnV0ZXMoKSB7XG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24oe30sIHRoaXMuX2F0dHJpYnV0ZXMsIHRoaXMuX2NoYW5nZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbm5lY3Rpb24uXG4gICAqL1xuICBfY29ubmVjdGlvbigpIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24pIHJldHVybiB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi5jb25uZWN0aW9uKClcbiAgICBpZiAodGhpcy5fX2Nvbm5lY3Rpb24pIHJldHVybiB0aGlzLl9fY29ubmVjdGlvblxuXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmNvbm5lY3Rpb24oKVxuXG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkpIHRoaXMuY2FwdHVyZURhdGFiYXNlSWRlbnRpdHkodGhpcy5fZGF0YWJhc2VJZGVudGl0eUZvckNvbm5lY3Rpb24oY29ubmVjdGlvbikpXG5cbiAgICByZXR1cm4gY29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBpZGVudGl0eSBvZiBhbiBhbHJlYWR5IHNlbGVjdGVkIGNvbmNyZXRlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25jcmV0ZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBQaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAgICovXG4gIF9kYXRhYmFzZUlkZW50aXR5Rm9yQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gbW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIGNvbnN0IHJldXNlS2V5ID0gbW9kZWxDbGFzc1xuICAgICAgLl9nZXRDb25maWd1cmF0aW9uKClcbiAgICAgIC5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgICAgLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoY29ubmVjdGlvbilcblxuICAgIHJldHVybiBgJHtkYXRhYmFzZUlkZW50aWZpZXJ9OiR7cmV1c2VLZXl9YFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNvbm5lY3Rpb24gdGhhdCBvd25zIHRoaXMgcmVjb3JkJ3MgZGF0YWJhc2Ugd29yay5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIENvbm5lY3Rpb24uXG4gICAqL1xuICBjb25uZWN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9jb25uZWN0aW9uKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgZGVwZW5kZW50IHJlY29yZHMgZm9yIGEgYGRlcGVuZGVudDogXCJyZXN0cmljdFwiYCByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7UmVzdHJpY3RJbnN0YW5jZVJlbGF0aW9uc2hpcH0gaW5zdGFuY2VSZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UgdG8gY291bnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gRGVwZW5kZW50IHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIF9kZXBlbmRlbnRSZXN0cmljdENvdW50KGluc3RhbmNlUmVsYXRpb25zaGlwKSB7XG4gICAgY29uc3QgVGFyZ2V0TW9kZWxDbGFzcyA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgaWYgKCFUYXJnZXRNb2RlbENsYXNzIHx8ICFUYXJnZXRNb2RlbENsYXNzLmhhc1RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKCkpIHtcbiAgICAgIHJldHVybiBhd2FpdCBpbnN0YW5jZVJlbGF0aW9uc2hpcC5xdWVyeSgpLmNvdW50KClcbiAgICB9XG5cbiAgICBpZiAodGhpcy5nZXRNb2RlbENsYXNzKCkuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSkge1xuICAgICAgcmV0dXJuIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLnF1ZXJ5KCkuY291bnQoKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9kZXBlbmRlbnRSZXN0cmljdFRlbmFudENvdW50KGluc3RhbmNlUmVsYXRpb25zaGlwLCBUYXJnZXRNb2RlbENsYXNzKVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyB0ZW5hbnQtc2NvcGVkIGRlcGVuZGVudCByZWNvcmRzIGFjcm9zcyBhbGwgcHJvdmlkZXItbGlzdGVkIHRlbmFudHMuXG4gICAqIEBwYXJhbSB7UmVzdHJpY3RJbnN0YW5jZVJlbGF0aW9uc2hpcH0gaW5zdGFuY2VSZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UgdG8gY291bnQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBUYXJnZXRNb2RlbENsYXNzIC0gUmVsYXRlZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBEZXBlbmRlbnQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX2RlcGVuZGVudFJlc3RyaWN0VGVuYW50Q291bnQoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuX2dldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHRlbmFudERhdGFiYXNlUHJvdmlkZXJzID0gY29uZmlndXJhdGlvbi5nZXRUZW5hbnREYXRhYmFzZVByb3ZpZGVycygpXG4gICAgY29uc3QgcHJvdmlkZXJFbnRyaWVzID0gT2JqZWN0LmVudHJpZXModGVuYW50RGF0YWJhc2VQcm92aWRlcnMpXG4gICAgY29uc3QgdGFyZ2V0SWRlbnRpZmllciA9IFRhcmdldE1vZGVsQ2xhc3MuZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKG51bGwpXG5cbiAgICBpZiAocHJvdmlkZXJFbnRyaWVzLmxlbmd0aCA9PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBjaGVjayBkZXBlbmRlbnQgJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9IGJlY2F1c2UgJHtUYXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfSBzd2l0Y2hlcyB0ZW5hbnQgZGF0YWJhc2VzIGJ1dCBubyB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXJzIGFyZSBjb25maWd1cmVkYClcbiAgICB9XG5cbiAgICBpZiAodGFyZ2V0SWRlbnRpZmllcikge1xuICAgICAgY29uc3QgcHJvdmlkZXIgPSB0ZW5hbnREYXRhYmFzZVByb3ZpZGVyc1t0YXJnZXRJZGVudGlmaWVyXVxuXG4gICAgICBpZiAoIXByb3ZpZGVyKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGNoZWNrIGRlcGVuZGVudCAke2luc3RhbmNlUmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcCgpLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gYmVjYXVzZSAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9IHN3aXRjaGVzIHRlbmFudCBkYXRhYmFzZSAke3RhcmdldElkZW50aWZpZXJ9IGJ1dCBubyB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgaXMgY29uZmlndXJlZCBmb3IgJHt0YXJnZXRJZGVudGlmaWVyfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9kZXBlbmRlbnRSZXN0cmljdFByb3ZpZGVyQ291bnQoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MsIHRhcmdldElkZW50aWZpZXIsIHByb3ZpZGVyKVxuICAgIH1cblxuICAgIGxldCBtYXRjaGluZ1Byb3ZpZGVyU2VlbiA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IFtpZGVudGlmaWVyLCBwcm92aWRlcl0gb2YgcHJvdmlkZXJFbnRyaWVzKSB7XG4gICAgICBjb25zdCB0ZW5hbnRzID0gYXdhaXQgdGhpcy5fZGVwZW5kZW50UmVzdHJpY3RQcm92aWRlclRlbmFudHMoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MsIGlkZW50aWZpZXIsIHByb3ZpZGVyKVxuXG4gICAgICBmb3IgKGNvbnN0IHRlbmFudCBvZiB0ZW5hbnRzKSB7XG4gICAgICAgIGlmIChUYXJnZXRNb2RlbENsYXNzLmdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcih0ZW5hbnQpICE9IGlkZW50aWZpZXIpIHtcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgbWF0Y2hpbmdQcm92aWRlclNlZW4gPSB0cnVlXG5cbiAgICAgICAgY29uc3QgY291bnQgPSBhd2FpdCBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQodGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgaWYgKCFjb25maWd1cmF0aW9uLmlzRGF0YWJhc2VJZGVudGlmaWVyQWN0aXZlKGlkZW50aWZpZXIpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyICR7aWRlbnRpZmllcn0gaXMgaW5hY3RpdmUgd2hpbGUgY2hlY2tpbmcgZGVwZW5kZW50ICR7aW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfWApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe2RhdGFiYXNlSWRlbnRpZmllcnM6IFtpZGVudGlmaWVyXSwgbmFtZTogYERlcGVuZGVudCByZXN0cmljdCBjb3VudDogJHtUYXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWB9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgaW5zdGFuY2VSZWxhdGlvbnNoaXAucXVlcnkoKS5jb3VudCgpXG4gICAgICAgICAgfSlcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoY291bnQgPiAwKSByZXR1cm4gY291bnRcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIW1hdGNoaW5nUHJvdmlkZXJTZWVuKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBjaGVjayBkZXBlbmRlbnQgJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9IGJlY2F1c2Ugbm8gdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyIG1hdGNoZWQgJHtUYXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIDBcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgdGVuYW50LXNjb3BlZCBkZXBlbmRlbnQgcmVjb3JkcyBmb3Igb25lIGNvbmZpZ3VyZWQgdGVuYW50IHByb3ZpZGVyLlxuICAgKiBAcGFyYW0ge1Jlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXB9IGluc3RhbmNlUmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlIHRvIGNvdW50LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gVGFyZ2V0TW9kZWxDbGFzcyAtIFJlbGF0ZWQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gVGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7VGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGV9IHByb3ZpZGVyIC0gVGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIERlcGVuZGVudCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfZGVwZW5kZW50UmVzdHJpY3RQcm92aWRlckNvdW50KGluc3RhbmNlUmVsYXRpb25zaGlwLCBUYXJnZXRNb2RlbENsYXNzLCBpZGVudGlmaWVyLCBwcm92aWRlcikge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgdGVuYW50cyA9IGF3YWl0IHRoaXMuX2RlcGVuZGVudFJlc3RyaWN0UHJvdmlkZXJUZW5hbnRzKGluc3RhbmNlUmVsYXRpb25zaGlwLCBUYXJnZXRNb2RlbENsYXNzLCBpZGVudGlmaWVyLCBwcm92aWRlcilcblxuICAgIGZvciAoY29uc3QgdGVuYW50IG9mIHRlbmFudHMpIHtcbiAgICAgIGNvbnN0IGNvdW50ID0gYXdhaXQgY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAoIWNvbmZpZ3VyYXRpb24uaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUoaWRlbnRpZmllcikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyICR7aWRlbnRpZmllcn0gaXMgaW5hY3RpdmUgd2hpbGUgY2hlY2tpbmcgZGVwZW5kZW50ICR7aW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfWApXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW2lkZW50aWZpZXJdLCBuYW1lOiBgRGVwZW5kZW50IHJlc3RyaWN0IGNvdW50OiAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgaW5zdGFuY2VSZWxhdGlvbnNoaXAucXVlcnkoKS5jb3VudCgpXG4gICAgICAgIH0pXG4gICAgICB9KVxuXG4gICAgICBpZiAoY291bnQgPiAwKSByZXR1cm4gY291bnRcbiAgICB9XG5cbiAgICByZXR1cm4gMFxuICB9XG5cbiAgLyoqXG4gICAqIExpc3RzIHJlc3RyaWN0LWNoZWNrIHRlbmFudHMgZm9yIG9uZSBjb25maWd1cmVkIHRlbmFudCBwcm92aWRlci5cbiAgICogQHBhcmFtIHtSZXN0cmljdEluc3RhbmNlUmVsYXRpb25zaGlwfSBpbnN0YW5jZVJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZSB0byBjb3VudC5cbiAgICogQHBhcmFtIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IFRhcmdldE1vZGVsQ2xhc3MgLSBSZWxhdGVkIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1RlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlfSBwcm92aWRlciAtIFRlbmFudCBkYXRhYmFzZSBwcm92aWRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBMaXN0ZWQgdGVuYW50IG9iamVjdHMuXG4gICAqL1xuICBhc3luYyBfZGVwZW5kZW50UmVzdHJpY3RQcm92aWRlclRlbmFudHMoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MsIGlkZW50aWZpZXIsIHByb3ZpZGVyKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBsaXN0VGVuYW50cyA9IHR5cGVvZiBwcm92aWRlci5saXN0UmVzdHJpY3RUZW5hbnRzID09IFwiZnVuY3Rpb25cIlxuICAgICAgPyBwcm92aWRlci5saXN0UmVzdHJpY3RUZW5hbnRzXG4gICAgICA6IHByb3ZpZGVyLmxpc3RUZW5hbnRzXG4gICAgY29uc3QgbGlzdFRlbmFudHNNZXRob2ROYW1lID0gdHlwZW9mIHByb3ZpZGVyLmxpc3RSZXN0cmljdFRlbmFudHMgPT0gXCJmdW5jdGlvblwiXG4gICAgICA/IFwibGlzdFJlc3RyaWN0VGVuYW50c1wiXG4gICAgICA6IFwibGlzdFRlbmFudHNcIlxuXG4gICAgaWYgKHR5cGVvZiBsaXN0VGVuYW50cyAhPSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyIGZvciAke2lkZW50aWZpZXJ9IG11c3QgZGVmaW5lIGxpc3RUZW5hbnRzIG9yIGxpc3RSZXN0cmljdFRlbmFudHMgYmVmb3JlIGRlcGVuZGVudCByZXN0cmljdCBjYW4gY2hlY2sgJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9YClcbiAgICB9XG5cbiAgICBjb25zdCB0ZW5hbnRzID0gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogYERlcGVuZGVudCByZXN0cmljdCB0ZW5hbnRzOiAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YH0sIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBsaXN0VGVuYW50cyh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGlkZW50aWZpZXJcbiAgICAgIH0pXG4gICAgfSlcblxuICAgIGlmICghQXJyYXkuaXNBcnJheSh0ZW5hbnRzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgZm9yICR7aWRlbnRpZmllcn0gbXVzdCByZXR1cm4gYW4gYXJyYXkgZnJvbSAke2xpc3RUZW5hbnRzTWV0aG9kTmFtZX1gKVxuICAgIH1cblxuICAgIHJldHVybiB0ZW5hbnRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIHdoaWxlIHByaW1hcnkta2V5IHJlYWRzIHJlc29sdmUgdG8gdGhlIHBlcnNpc3RlZCBpZGVudGl0eS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRoYXQgcmVxdWlyZXMgdGhlIHN0b3JlZCBpZGVudGl0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY2FsbGJhY2sgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgX3dpdGhQZXJzaXN0ZWRQcmltYXJ5S2V5KGNhbGxiYWNrKSB7XG4gICAgY29uc3QgcHJldmlvdXNSZWFkc1BlcnNpc3RlZFByaW1hcnlLZXkgPSB0aGlzLl9yZWFkc1BlcnNpc3RlZFByaW1hcnlLZXlcblxuICAgIHRoaXMuX3JlYWRzUGVyc2lzdGVkUHJpbWFyeUtleSA9IHRydWVcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX3JlYWRzUGVyc2lzdGVkUHJpbWFyeUtleSA9IHByZXZpb3VzUmVhZHNQZXJzaXN0ZWRQcmltYXJ5S2V5XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERlc3Ryb3lzIHRoZSByZWNvcmQgaW4gdGhlIGRhdGFiYXNlIGFuZCBhbGwgb2YgaXRzIGRlcGVuZGVudCByZWNvcmRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZGVzdHJveSgpIHtcbiAgICBhd2FpdCB0aGlzLl93aXRoUGVyc2lzdGVkUHJpbWFyeUtleShhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9kZXN0cm95UGVyc2lzdGVkUmVjb3JkKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIGRlc3Ryb3kgbGlmZWN5Y2xlIGFmdGVyIHRoZSBwZXJzaXN0ZWQgaWRlbnRpdHkgaGFzIGJlZW4gcmVzdG9yZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfZGVzdHJveVBlcnNpc3RlZFJlY29yZCgpIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJiZWZvcmVEZXN0cm95XCIpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcCBvZiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRSZWxhdGlvbnNoaXBzKCkpIHtcbiAgICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0RGVwZW5kZW50KCkgPT0gXCJyZXN0cmljdFwiKSB7XG4gICAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gLyoqIEB0eXBlIHtSZXN0cmljdEluc3RhbmNlUmVsYXRpb25zaGlwfSAqLyAodGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKSkpXG4gICAgICAgIGNvbnN0IGNvdW50ID0gYXdhaXQgdGhpcy5fZGVwZW5kZW50UmVzdHJpY3RDb3VudChpbnN0YW5jZVJlbGF0aW9uc2hpcClcblxuICAgICAgICBpZiAoY291bnQgPiAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgZGVsZXRlIHJlY29yZCBiZWNhdXNlIGRlcGVuZGVudCAke3JlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9IGV4aXN0YClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0RGVwZW5kZW50KCkgIT0gXCJkZXN0cm95XCIpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpKVxuXG4gICAgICAvKipcbiAgICAgICAqIERlZmluZXMgbW9kZWxzLlxuICAgICAgICogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkW119ICovXG4gICAgICBsZXQgbW9kZWxzXG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJiZWxvbmdzVG9cIikge1xuICAgICAgICBpZiAoIWluc3RhbmNlUmVsYXRpb25zaGlwLmlzTG9hZGVkKCkpIHtcbiAgICAgICAgICBhd2FpdCBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkKClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG1vZGVsID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgICBpZiAobW9kZWwgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkge1xuICAgICAgICAgIG1vZGVscyA9IFttb2RlbF1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgbG9hZGVkIHR5cGU6ICR7dHlwZW9mIG1vZGVsfWApXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09IFwiaGFzTWFueVwiKSB7XG4gICAgICAgIGlmICghaW5zdGFuY2VSZWxhdGlvbnNoaXAuaXNMb2FkZWQoKSkge1xuICAgICAgICAgIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWQoKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbG9hZGVkTW9kZWxzID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShsb2FkZWRNb2RlbHMpKSB7XG4gICAgICAgICAgbW9kZWxzID0gbG9hZGVkTW9kZWxzXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIGxvYWRlZCB0eXBlOiAke3R5cGVvZiBsb2FkZWRNb2RlbHN9YClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJoYXNPbmVcIikge1xuICAgICAgICBpZiAoIWluc3RhbmNlUmVsYXRpb25zaGlwLmlzTG9hZGVkKCkpIHtcbiAgICAgICAgICBhd2FpdCBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkKClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGxvYWRlZE1vZGVsID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgICBpZiAobG9hZGVkTW9kZWwgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkge1xuICAgICAgICAgIG1vZGVscyA9IFtsb2FkZWRNb2RlbF1cbiAgICAgICAgfSBlbHNlIGlmIChsb2FkZWRNb2RlbCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgbW9kZWxzID0gW11cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgbG9hZGVkIHR5cGU6ICR7dHlwZW9mIGxvYWRlZE1vZGVsfWApXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5oYW5kbGVkIHJlbGF0aW9uc2hpcCB0eXBlOiAke2luc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKX1gKVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVscykge1xuICAgICAgICBpZiAobW9kZWwuaXNQZXJzaXN0ZWQoKSkge1xuICAgICAgICAgIGF3YWl0IG1vZGVsLmRlc3Ryb3koKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29uZGl0aW9ucy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGNvbmRpdGlvbnMgPSB7fVxuXG4gICAgT2JqZWN0LmFzc2lnbihjb25kaXRpb25zLCBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHRoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKSwgdGhpcy5fcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKCkpKVxuXG4gICAgY29uc3Qgc3FsID0gdGhpcy5fY29ubmVjdGlvbigpLmRlbGV0ZVNxbCh7XG4gICAgICBjb25kaXRpb25zLFxuICAgICAgdGFibGVOYW1lOiB0aGlzLl90YWJsZU5hbWUoKVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLl9jb25uZWN0aW9uKCkucXVlcnkoc3FsLCB7bG9nTmFtZTogYCR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX0gRGVzdHJveWB9KVxuICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImFmdGVyRGVzdHJveVwiKVxuICAgIGF3YWl0IHRoaXMuX2VtaXRSZWNvcmRDaGFuZ2VBZnRlckNvbW1pdChcImRlc3Ryb3lcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBhIGNvbW1pdHRlZCByZWNvcmQtY2hhbmdlIGV2ZW50IGFmdGVyIHRoZSBzdXJyb3VuZGluZyB0cmFuc2FjdGlvblxuICAgKiBjb21taXRzLCBzbyBsaXZlIHF1ZXJpZXMgcmUtcnVuIHVuaWZvcm1seSBmb3IgbG9jYWwgd3JpdGVzLCBwdWxsIGFwcGxpZXMsIGFuZFxuICAgKiByZWFsdGltZSBhcHBsaWVzICh3aGljaCBhbGwgZW5kIGFzIGxvY2FsIHNhdmVzL2Rlc3Ryb3lzKS4gUmVnaXN0ZXJlZCB0aHJvdWdoXG4gICAqIHRoZSBjb25uZWN0aW9uJ3MgYWZ0ZXJDb21taXQgaG9vayBzbyBhIHJvbGxlZC1iYWNrIHNhdmUgZW1pdHMgbm90aGluZywgYW5kXG4gICAqIHNraXBwZWQgZW50aXJlbHkgd2hlbiBub3RoaW5nIG9ic2VydmVzIHRoaXMgbW9kZWwgY2xhc3Mgc28gc2VydmVyLXNpZGUgc2F2ZXNcbiAgICogc3RheSBmcmVlIG9mIGxpdmUtcXVlcnkgb3ZlcmhlYWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcmVjb3JkLWNoYW5nZXMuanNcIikuUmVjb3JkQ2hhbmdlT3BlcmF0aW9ufSBvcGVyYXRpb24gLSBUaGUgY29tbWl0dGVkIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfZW1pdFJlY29yZENoYW5nZUFmdGVyQ29tbWl0KG9wZXJhdGlvbikge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgaWYgKCFyZWNvcmRDaGFuZ2VzLmhhc0xpc3RlbmVycyhtb2RlbENsYXNzKSkgcmV0dXJuXG5cbiAgICBjb25zdCByZWNvcmQgPSB0aGlzXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGl0eSA9IHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uXG4gICAgICA/IHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLmRhdGFiYXNlSWRlbnRpdHkoKVxuICAgICAgOiB0aGlzLl9kYXRhYmFzZUlkZW50aXR5Rm9yQ29ubmVjdGlvbih0aGlzLl9jb25uZWN0aW9uKCkpXG5cbiAgICB0aGlzLmNhcHR1cmVEYXRhYmFzZUlkZW50aXR5KGRhdGFiYXNlSWRlbnRpdHkpXG5cbiAgICBhd2FpdCB0aGlzLl9jb25uZWN0aW9uKCkuYWZ0ZXJDb21taXQoKCkgPT4ge1xuICAgICAgcmVjb3JkQ2hhbmdlcy5lbWl0KHtkYXRhYmFzZUlkZW50aXR5LCBtb2RlbENsYXNzLCBvcGVyYXRpb24sIHJlY29yZH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdG9yZXMgYW4gYXVkaXQgcm93IGZvciB0aGlzIHJlY29yZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2F1ZGl0aW5nLmpzXCIpLkNyZWF0ZUF1ZGl0QXJnc30gYXJncyAtIEF1ZGl0IHJvdyBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXIgfCBzdHJpbmc+fSBDcmVhdGVkIGF1ZGl0IHJvdyBpZC5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZUF1ZGl0KGFyZ3MpIHtcbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlQXVkaXQodGhpcywgYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBjcmVhdGUgY2hhbmdlcyBiZWZvcmUgcGVyc2lzdGVuY2UgY2xlYXJzIHRoZSBjaGFuZ2Ugc2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNhcHR1cmVDcmVhdGVBdWRpdENoYW5nZXMoKSB7XG4gICAgY2FwdHVyZUNyZWF0ZUF1ZGl0Q2hhbmdlcyh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFdyaXRlcyB0aGUgY3JlYXRlIGF1ZGl0IHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBjcmVhdGVDcmVhdGVBdWRpdCgpIHtcbiAgICBhd2FpdCBjcmVhdGVDcmVhdGVBdWRpdCh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIHVwZGF0ZSBjaGFuZ2VzIGJlZm9yZSBwZXJzaXN0ZW5jZSBjbGVhcnMgdGhlIGNoYW5nZSBzZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY2FwdHVyZVVwZGF0ZUF1ZGl0Q2hhbmdlcygpIHtcbiAgICBjYXB0dXJlVXBkYXRlQXVkaXRDaGFuZ2VzKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogV3JpdGVzIHRoZSB1cGRhdGUgYXVkaXQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVVwZGF0ZUF1ZGl0KCkge1xuICAgIGF3YWl0IGNyZWF0ZVVwZGF0ZUF1ZGl0KHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogV3JpdGVzIHRoZSBkZXN0cm95IGF1ZGl0IHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBjcmVhdGVEZXN0cm95QXVkaXQoKSB7XG4gICAgYXdhaXQgY3JlYXRlRGVzdHJveUF1ZGl0KHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gbGlmZWN5Y2xlIGNhbGxiYWNrcy5cbiAgICogQHBhcmFtIHtcImFmdGVyQ3JlYXRlXCIgfCBcImFmdGVyRGVzdHJveVwiIHwgXCJhZnRlclNhdmVcIiB8IFwiYWZ0ZXJVcGRhdGVcIiB8IFwiYmVmb3JlQ3JlYXRlXCIgfCBcImJlZm9yZURlc3Ryb3lcIiB8IFwiYmVmb3JlU2F2ZVwiIHwgXCJiZWZvcmVVcGRhdGVcIiB8IFwiYmVmb3JlVmFsaWRhdGlvblwifSBjYWxsYmFja05hbWUgLSBDYWxsYmFjayB0eXBlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9ydW5MaWZlY3ljbGVDYWxsYmFja3MoY2FsbGJhY2tOYW1lKSB7XG4gICAgY29uc3QgY2FsbGJhY2tzID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0TGlmZWN5Y2xlQ2FsbGJhY2tzTWFwKClbY2FsbGJhY2tOYW1lXSB8fCBbXVxuICAgIGxldCBjYWxsYmFja05hbWVSZWdpc3RlcmVkQXNTdHJpbmcgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBjYWxsYmFjayBvZiBjYWxsYmFja3MpIHtcbiAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgPT0gXCJzdHJpbmdcIikge1xuICAgICAgICBpZiAoY2FsbGJhY2sgPT0gY2FsbGJhY2tOYW1lKSB7XG4gICAgICAgICAgY2FsbGJhY2tOYW1lUmVnaXN0ZXJlZEFzU3RyaW5nID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGR5bmFtaWNUaGlzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG4gICAgICAgIGNvbnN0IG1ldGhvZENhbGxiYWNrID0gZHluYW1pY1RoaXNbY2FsbGJhY2tdXG5cbiAgICAgICAgaWYgKHR5cGVvZiBtZXRob2RDYWxsYmFjayAhPSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYExpZmVjeWNsZSBjYWxsYmFjayBcIiR7Y2FsbGJhY2t9XCIgaXMgbm90IGEgZnVuY3Rpb24gb24gJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfWApXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBtZXRob2RDYWxsYmFjay5jYWxsKHRoaXMpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCBjYWxsYmFjayh0aGlzKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGR5bmFtaWNUaGlzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG4gICAgY29uc3QgaW5zdGFuY2VDYWxsYmFjayA9IGR5bmFtaWNUaGlzW2NhbGxiYWNrTmFtZV1cblxuICAgIGlmICghY2FsbGJhY2tOYW1lUmVnaXN0ZXJlZEFzU3RyaW5nICYmIHR5cGVvZiBpbnN0YW5jZUNhbGxiYWNrID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGF3YWl0IGluc3RhbmNlQ2FsbGJhY2suY2FsbCh0aGlzKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBjaGFuZ2VzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGNoYW5nZXMuXG4gICAqL1xuICBfaGFzQ2hhbmdlcygpIHsgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMuX2NoYW5nZXMpLmxlbmd0aCA+IDAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRydWUgaWYgdGhlIG1vZGVsIGhhcyBiZWVuIGNoYW5nZWQgc2luY2UgaXQgd2FzIGxvYWRlZCBmcm9tIHRoZSBkYXRhYmFzZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBjaGFuZ2VkLlxuICAgKi9cbiAgaXNDaGFuZ2VkKCkge1xuICAgIGlmICh0aGlzLmlzTmV3UmVjb3JkKCkgfHwgdGhpcy5faGFzQ2hhbmdlcygpKXtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgaWYgYSBsb2FkZWQgc3ViLW1vZGVsIG9mIGEgcmVsYXRpb25zaGlwIGlzIGNoYW5nZWQgYW5kIHNob3VsZCBiZSBzYXZlZCBhbG9uZyB3aXRoIHRoaXMgbW9kZWwuXG4gICAgaWYgKHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcykge1xuICAgICAgZm9yIChjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcE5hbWUgaW4gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW2luc3RhbmNlUmVsYXRpb25zaGlwTmFtZV1cbiAgICAgICAgbGV0IGxvYWRlZCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLl9sb2FkZWRcblxuICAgICAgICBpZiAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0QXV0b1NhdmUoKSA9PT0gZmFsc2UpIHtcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFsb2FkZWQpIGNvbnRpbnVlXG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShsb2FkZWQpKSBsb2FkZWQgPSBbbG9hZGVkXVxuXG4gICAgICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbG9hZGVkKSB7XG4gICAgICAgICAgaWYgKG1vZGVsLmlzQ2hhbmdlZCgpKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNoYW5nZXMgdGhhdCBoYXZlIGJlZW4gbWFkZSB0byB0aGlzIHJlY29yZCBzaW5jZSBpdCB3YXMgbG9hZGVkIGZyb20gdGhlIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBUaGUgY2hhbmdlcy5cbiAgICovXG4gIGNoYW5nZXMoKSB7XG4gICAgLyoqXG4gICAgICogQ2hhbmdlcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCBjaGFuZ2VzID0ge31cblxuICAgIGZvciAoY29uc3QgY2hhbmdlS2V5IGluIHRoaXMuX2NoYW5nZXMpIHtcbiAgICAgIGNvbnN0IGNoYW5nZVZhbHVlID0gdGhpcy5fY2hhbmdlc1tjaGFuZ2VLZXldXG5cbiAgICAgIGNoYW5nZXNbY2hhbmdlS2V5XSA9IFt0aGlzLl9hdHRyaWJ1dGVzW2NoYW5nZUtleV0sIGNoYW5nZVZhbHVlXVxuICAgIH1cblxuICAgIHJldHVybiBjaGFuZ2VzXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0YWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0YWJsZSBuYW1lLlxuICAgKi9cbiAgX3RhYmxlTmFtZSgpIHtcbiAgICBpZiAodGhpcy5fX3RhYmxlTmFtZSkgcmV0dXJuIHRoaXMuX190YWJsZU5hbWVcblxuICAgIHJldHVybiB0aGlzLmdldE1vZGVsQ2xhc3MoKS50YWJsZU5hbWUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGFuIGF0dHJpYnV0ZSB2YWx1ZSBmcm9tIHRoZSByZWNvcmQuIFJlYWQgZHluYW1pY2FsbHkgYnkgbmFtZSwgc28gdGhlIHZhbHVlIGNhbiBiZSBhbnlcbiAgICogY29sdW1uIHR5cGUgYW5kIG1heSBiZSBvdmVycmlkZGVuIGJ5IGEgdXNlci1kZWZpbmVkIGdldHRlciBvbiB0aGUgbW9kZWwuXG4gICAqIEB0ZW1wbGF0ZSBWXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIFRoZSBuYW1lIG9mIHRoZSBhdHRyaWJ1dGUgdG8gcmVhZC4gVGhpcyBpcyB0aGUgYXR0cmlidXRlIG5hbWUsIG5vdCB0aGUgY29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtWfSBUaGUgYXR0cmlidXRlIHZhbHVlLCB0eXBlZCBieSB0aGUgY2FsbGVyJ3MgYWNjZXNzb3IgY29udHJhY3QuXG4gICAqL1xuICByZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fYXNzZXJ0SGFzQmVlbkluaXRpYWxpemVkKClcbiAgICBjb25zdCBtYXAgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClcbiAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5yZXNvbHZlQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKVxuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPyBtYXBbcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lXSA6IHVuZGVmaW5lZFxuXG4gICAgaWYgKCFjb2x1bW5OYW1lKSB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IGZpZ3VyZSBvdXQgY29sdW1uIG5hbWUgZm9yIGF0dHJpYnV0ZTogJHthdHRyaWJ1dGVOYW1lfSBmcm9tIHRoZXNlIG1hcHBpbmdzOiAke09iamVjdC5rZXlzKG1hcCkuam9pbihcIiwgXCIpfWApXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtWfSAqLyAodGhpcy5yZWFkQ29sdW1uKGNvbHVtbk5hbWUpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgYW4gYXNzb2NpYXRpb24gY291bnQgYXR0YWNoZWQgYnkgYC53aXRoQ291bnQoLi4uKWAuIENvdW50cyBhcmVcbiAgICogc3RvcmVkIG9uIGEgc2VwYXJhdGUgbWFwIGZyb20gdGhlIHJlY29yZCdzIGBfYXR0cmlidXRlc2Agc28gYVxuICAgKiB2aXJ0dWFsIGNvdW50IGxpa2UgYHRhc2tzQ291bnRgIGNhbm5vdCBzaWxlbnRseSBzaGFkb3cgYSByZWFsXG4gICAqIGNvbHVtbiBvZiB0aGUgc2FtZSBuYW1lLiBSZXR1cm5zIHRoZSBhdHRhY2hlZCBudW1iZXIsIG9yIDAgd2hlblxuICAgKiBgLndpdGhDb3VudCguLi4pYCB3YXNuJ3QgcmVxdWVzdGVkIGZvciB0aGlzIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZSwgZS5nLiBgXCJ0YXNrc0NvdW50XCJgIG9yIGEgY3VzdG9tIGBcImFjdGl2ZU1lbWJlcnNDb3VudFwiYCBmcm9tIGAud2l0aENvdW50KHthY3RpdmVNZW1iZXJzQ291bnQ6IHsuLi59fSlgLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEF0dGFjaGVkIGFzc29jaWF0aW9uIGNvdW50LCBvciB6ZXJvIHdoZW4gYWJzZW50LlxuICAgKi9cbiAgcmVhZENvdW50KGF0dHJpYnV0ZU5hbWUpIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRBc3NvY2lhdGlvbkNvdW50KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhdHRyaWJ1dGVOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0dGFjaCBhbiBhc3NvY2lhdGlvbiBjb3VudCB0byB0aGlzIHJlY29yZC4gSW50ZXJuYWwgaGVscGVyIHVzZWQgYnlcbiAgICogdGhlIGB3aXRoQ291bnRgIHJ1bm5lcjsgb3V0c2lkZSBjb2RlIHNob3VsZCBub3QgY2FsbCB0aGlzIGRpcmVjdGx5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBDb3VudCB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0QXNzb2NpYXRpb25Db3VudChhdHRyaWJ1dGVOYW1lLCB2YWx1ZSkge1xuICAgIHNldFBheWxvYWRBc3NvY2lhdGlvbkNvdW50KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhdHRyaWJ1dGVOYW1lLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBbGwgYXR0YWNoZWQgYXNzb2NpYXRpb24gY291bnRzIGFzIGEgcGxhaW4gb2JqZWN0LiBVc2VkIGJ5IHRoZVxuICAgKiBmcm9udGVuZC1tb2RlbCBzZXJpYWxpemVyIHRvIHNoaXAgY291bnRzIGFsb25nc2lkZSB0aGUgcmVjb3JkXG4gICAqIGF0dHJpYnV0ZXMgb24gdGhlIHdpcmUuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAtIEFzc29jaWF0aW9uIGNvdW50cyBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIGFzc29jaWF0aW9uQ291bnRzKCkge1xuICAgIC8qKlxuICAgICAqIFJlc3VsdC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCByZXN1bHQgPSB7fVxuXG4gICAgY29uc3QgdGFyZ2V0ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcblxuICAgIGlmICghdGFyZ2V0Ll9hc3NvY2lhdGlvbkNvdW50cykgcmV0dXJuIHJlc3VsdFxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIHRhcmdldC5fYXNzb2NpYXRpb25Db3VudHMpIHtcbiAgICAgIHJlc3VsdFthdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgYSB2YWx1ZSBhdHRhY2hlZCBieSBgLnF1ZXJ5RGF0YSguLi4pYC4gU3RvcmVkIG9uIGEgZGVkaWNhdGVkXG4gICAqIG1hcCByYXRoZXIgdGhhbiBvbiBgX2F0dHJpYnV0ZXNgLCBzbyBhIHZpcnR1YWwgcXVlcnlEYXRhIGtleSBsaWtlXG4gICAqIGB0cmFuc3BvcnRTZWNvbmRzU3VtYCBjYW5ub3Qgc2lsZW50bHkgc2hhZG93IGEgcmVhbCBjb2x1bW4gb2YgdGhlXG4gICAqIHNhbWUgbmFtZS4gUmV0dXJucyBgbnVsbGAgd2hlbiB0aGUga2V5IHdhc24ndCBwcm9kdWNlZCBieSBhbnlcbiAgICogcmVnaXN0ZXJlZCBmbiBmb3IgdGhpcyByZWNvcmQgKGUuZy4gbm8gY2hpbGQgcm93cyBtYXRjaGVkIHRoZVxuICAgKiBhZ2dyZWdhdGUpLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIHF1ZXJ5RGF0YSBhdHRyaWJ1dGUgbmFtZSAobWF0Y2hlcyBhIFNFTEVDVCBhbGlhcyBmcm9tIHRoZSByZWdpc3RlcmVkIGZuKS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEF0dGFjaGVkIHF1ZXJ5LWRhdGEgdmFsdWUuXG4gICAqL1xuICBxdWVyeURhdGEobmFtZSkge1xuICAgIHJldHVybiByZWFkUGF5bG9hZFF1ZXJ5RGF0YSgvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgbmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRhY2ggYSBxdWVyeURhdGEgdmFsdWUgdG8gdGhpcyByZWNvcmQuIEludGVybmFsIGhlbHBlciB1c2VkIGJ5XG4gICAqIHRoZSBgcXVlcnlEYXRhYCBydW5uZXIgYW5kIGJ5IGZyb250ZW5kLW1vZGVsIGh5ZHJhdGlvbjsgb3V0c2lkZVxuICAgKiBjb2RlIHNob3VsZCBub3QgY2FsbCB0aGlzIGRpcmVjdGx5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIHF1ZXJ5RGF0YSBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byBhdHRhY2guXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldFF1ZXJ5RGF0YShuYW1lLCB2YWx1ZSkge1xuICAgIHNldFBheWxvYWRRdWVyeURhdGEoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIG5hbWUsIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIEFsbCBhdHRhY2hlZCBxdWVyeURhdGEgdmFsdWVzIGFzIGEgcGxhaW4gb2JqZWN0LiBVc2VkIGJ5IHRoZVxuICAgKiBmcm9udGVuZC1tb2RlbCBzZXJpYWxpemVyIHRvIHNoaXAgcXVlcnlEYXRhIGFsb25nc2lkZSB0aGUgcmVjb3JkXG4gICAqIGF0dHJpYnV0ZXMgb24gdGhlIHdpcmUuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUXVlcnktZGF0YSB2YWx1ZXMga2V5ZWQgYnkgbmFtZS5cbiAgICovXG4gIHF1ZXJ5RGF0YVZhbHVlcygpIHtcbiAgICAvKipcbiAgICAgKiBSZXN1bHQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCByZXN1bHQgPSB7fVxuXG4gICAgY29uc3QgdGFyZ2V0ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcblxuICAgIGlmICghdGFyZ2V0Ll9xdWVyeURhdGFWYWx1ZXMpIHJldHVybiByZXN1bHRcblxuICAgIGZvciAoY29uc3QgW25hbWUsIHZhbHVlXSBvZiB0YXJnZXQuX3F1ZXJ5RGF0YVZhbHVlcykge1xuICAgICAgcmVzdWx0W25hbWVdID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhIHBlci1yZWNvcmQgYWJpbGl0eSByZXN1bHQgYXR0YWNoZWQgYnkgYC5hYmlsaXRpZXMoLi4uKWAuIFRoZVxuICAgKiBiYWNrZW5kIGV2YWx1YXRlcyBlYWNoIHJlcXVlc3RlZCBhY3Rpb24gYWdhaW5zdCB0aGUgY3VycmVudCBhYmlsaXR5XG4gICAqIGZvciB0aGlzIHJlY29yZCBpbnN0YW5jZSBhbmQgc2hpcHMgdGhlIHJlc3VsdCBhbG9uZ3NpZGUgdGhlXG4gICAqIHJlY29yZCdzIGF0dHJpYnV0ZXMuIFJldHVybnMgYGZhbHNlYCB3aGVuIHRoZSBhY3Rpb24gd2Fzbid0XG4gICAqIHJlcXVlc3RlZCBmb3IgdGhpcyByZWNvcmQg4oCUIHNvIFVJIGNvZGUgY2FuIHNhZmVseSBicmFuY2ggb25cbiAgICogYHJlY29yZC5jYW4oXCJ1cGRhdGVcIilgIHdpdGhvdXQgZmlyc3QgY2hlY2tpbmcgd2hldGhlciB0aGUgYWJpbGl0eVxuICAgKiB3YXMgbG9hZGVkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24gbmFtZSwgZS5nLiBgXCJ1cGRhdGVcImAuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlcXVlc3RlZCBhYmlsaXR5IGlzIGFsbG93ZWQuXG4gICAqL1xuICBjYW4oYWN0aW9uKSB7XG4gICAgcmV0dXJuIHJlYWRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogQXR0YWNoIGEgcGVyLXJlY29yZCBhYmlsaXR5IHJlc3VsdCB0byB0aGlzIHJlY29yZC4gSW50ZXJuYWwgaGVscGVyXG4gICAqIHVzZWQgYnkgdGhlIGBhYmlsaXRpZXNgIHJ1bm5lciBhbmQgYnkgZnJvbnRlbmQtbW9kZWwgaHlkcmF0aW9uO1xuICAgKiBvdXRzaWRlIGNvZGUgc2hvdWxkIG5vdCBjYWxsIHRoaXMgZGlyZWN0bHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbiBuYW1lLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IHZhbHVlIC0gV2hldGhlciB0aGUgY3VycmVudCBhYmlsaXR5IHBlcm1pdHMgdGhlIGFjdGlvbiBvbiB0aGlzIHJlY29yZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0Q29tcHV0ZWRBYmlsaXR5KGFjdGlvbiwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBhY3Rpb24sIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIEFsbCBhdHRhY2hlZCBwZXItcmVjb3JkIGFiaWxpdHkgcmVzdWx0cyBhcyBhIHBsYWluIG9iamVjdC4gVXNlZFxuICAgKiBieSB0aGUgZnJvbnRlbmQtbW9kZWwgc2VyaWFsaXplciB0byBzaGlwIHJlc3VsdHMgYWxvbmdzaWRlIHRoZVxuICAgKiByZWNvcmQgYXR0cmlidXRlcyBvbiB0aGUgd2lyZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGJvb2xlYW4+fSAtIEFiaWxpdHkgcmVzdWx0cyBrZXllZCBieSBhY3Rpb24uXG4gICAqL1xuICBjb21wdXRlZEFiaWxpdGllcygpIHtcbiAgICAvKipcbiAgICAgKiBSZXN1bHQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGJvb2xlYW4+fSAqL1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgICBjb25zdCB0YXJnZXQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuXG4gICAgaWYgKCF0YXJnZXQuX2NvbXB1dGVkQWJpbGl0aWVzKSByZXR1cm4gcmVzdWx0XG5cbiAgICBmb3IgKGNvbnN0IFthY3Rpb24sIHZhbHVlXSBvZiB0YXJnZXQuX2NvbXB1dGVkQWJpbGl0aWVzKSB7XG4gICAgICByZXN1bHRbYWN0aW9uXSA9IHZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGEgY29sdW1uIHZhbHVlIGZyb20gdGhlIHJlY29yZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgVGhlIG5hbWUgb2YgdGhlIGNvbHVtbiB0byByZWFkLiBUaGlzIGlzIHRoZSBjb2x1bW4gbmFtZSwgbm90IHRoZSBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBjb2x1bW4uXG4gICAqL1xuICByZWFkQ29sdW1uKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fYXNzZXJ0SGFzQmVlbkluaXRpYWxpemVkKClcbiAgICBjb25zdCBiZWxvbmdzVG9DaGFuZ2VzID0gdGhpcy5fYmVsb25nc1RvQ2hhbmdlcygpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IHJlYWRzUGVyc2lzdGVkUHJpbWFyeUtleSA9IHRoaXMuX3JlYWRzUGVyc2lzdGVkUHJpbWFyeUtleSAmJiAoXG4gICAgICBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpID8gcHJpbWFyeUtleS5pbmNsdWRlcyhhdHRyaWJ1dGVOYW1lKSA6IHByaW1hcnlLZXkgPT0gYXR0cmlidXRlTmFtZVxuICAgIClcbiAgICBsZXQgcmVzdWx0XG5cbiAgICBpZiAocmVhZHNQZXJzaXN0ZWRQcmltYXJ5S2V5KSB7XG4gICAgICByZXN1bHQgPSB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gICAgfSBlbHNlIGlmIChhdHRyaWJ1dGVOYW1lIGluIGJlbG9uZ3NUb0NoYW5nZXMpIHtcbiAgICAgIHJlc3VsdCA9IGJlbG9uZ3NUb0NoYW5nZXNbYXR0cmlidXRlTmFtZV1cbiAgICB9IGVsc2UgaWYgKGF0dHJpYnV0ZU5hbWUgaW4gdGhpcy5fY2hhbmdlcykge1xuICAgICAgcmVzdWx0ID0gdGhpcy5fY2hhbmdlc1thdHRyaWJ1dGVOYW1lXVxuICAgIH0gZWxzZSBpZiAoYXR0cmlidXRlTmFtZSBpbiB0aGlzLl9hdHRyaWJ1dGVzKSB7XG4gICAgICByZXN1bHQgPSB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gICAgfSBlbHNlIGlmICh0aGlzLmlzUGVyc2lzdGVkKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBhdHRyaWJ1dGUgb3Igbm90IHNlbGVjdGVkICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSMke2F0dHJpYnV0ZU5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBjb2x1bW5UeXBlID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uVHlwZUJ5TmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgaWYgKGNvbHVtblR5cGUgJiYgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2lzRGF0ZUxpa2VUeXBlKGNvbHVtblR5cGUpKSB7XG4gICAgICByZXN1bHQgPSB0aGlzLl9ub3JtYWxpemVEYXRlVmFsdWVGb3JSZWFkKHJlc3VsdClcbiAgICB9XG5cbiAgICByZXN1bHQgPSB0aGlzLl9ub3JtYWxpemVCb29sZWFuVmFsdWVGb3JSZWFkKHtjb2x1bW5OYW1lOiBhdHRyaWJ1dGVOYW1lLCBjb2x1bW5UeXBlLCB2YWx1ZTogcmVzdWx0fSlcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbnkgZGVjbGFyZWQgcGVyLWF0dHJpYnV0ZSBjYXN0IGZvciBhIGRhdGFiYXNlIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIERhdGFiYXNlIGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIERlY2xhcmVkIGNhc3QgdHlwZSwgb3IgdW5kZWZpbmVkIHdoZW4gbm9uZSBpcyBkZWNsYXJlZC5cbiAgICovXG4gIF9kZWNsYXJlZEF0dHJpYnV0ZUNhc3RGb3JDb2x1bW4oY29sdW1uTmFtZSkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbY29sdW1uTmFtZV1cblxuICAgIGlmICghYXR0cmlidXRlTmFtZSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldEF0dHJpYnV0ZUNhc3QoYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIHN0b3JlZCB2YWx1ZSB0byBhIHJlYWwgYm9vbGVhbiBmb3IgYSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGNhc3QuXG4gICAqIExlYXZlcyBudWxsL3VuZGVmaW5lZCB1bnRvdWNoZWQ7IHRyZWF0cyAxL3RydWUvXCIxXCIgYXMgdHJ1ZSBhbmQgMC9mYWxzZS9cIjBcIiBhcyBmYWxzZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTdG9yZWQgZGF0YWJhc2UgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBDb252ZXJ0ZWQgYm9vbGVhbiwgb3IgdGhlIG9yaWdpbmFsIHZhbHVlIHdoZW4gbm90IHJlY29nbml6ZWQuXG4gICAqL1xuICBfY2FzdERlY2xhcmVkQm9vbGVhbkZvclJlYWQodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHZhbHVlXG4gICAgaWYgKGRlY2xhcmVkQm9vbGVhblRydXRoeVZhbHVlcy5oYXModmFsdWUpKSByZXR1cm4gdHJ1ZVxuICAgIGlmIChkZWNsYXJlZEJvb2xlYW5GYWxzeVZhbHVlcy5oYXModmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBjb2x1bW4gdmFsdWUgaXMgY3VycmVudGx5IGxvYWRlZCBvbiB0aGlzIHJlY29yZCAoZWl0aGVyIGFzIGFcbiAgICogcGVyc2lzdGVkIGF0dHJpYnV0ZSBvciBhIHBlbmRpbmcgY2hhbmdlKS4gVXNlZCB0byBkZWNpZGUgd2hldGhlciBhIHByZWxvYWRcbiAgICogY2FuIGJlIHNraXBwZWQgYmVjYXVzZSB0aGUgcmVxdWlyZWQgY29sdW1ucyBhcmUgYWxyZWFkeSBwcmVzZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIFRoZSBjb2x1bW4gbmFtZSB0byBjaGVjay5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY29sdW1uIGlzIGxvYWRlZC5cbiAgICovXG4gIGhhc0xvYWRlZENvbHVtbihjb2x1bW5OYW1lKSB7XG4gICAgcmV0dXJuIGNvbHVtbk5hbWUgaW4gdGhpcy5fY2hhbmdlcyB8fCBjb2x1bW5OYW1lIGluIHRoaXMuX2F0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBib29sZWFuIHZhbHVlIGZvciByZWFkLiBBIGRlY2xhcmVkIGBcImJvb2xlYW5cImAgYXR0cmlidXRlIGNhc3QgY29udmVydHMgdGhlXG4gICAqIHN0b3JlZCB2YWx1ZSAoZS5nLiBhbiBNU1NRTCBgYml0YCAwLzEpIHRvIGEgcmVhbCBib29sZWFuOyBvdGhlcndpc2UgdGhlIGV4aXN0aW5nXG4gICAqIGludHJvc3BlY3RlZC10eXBlIG5vcm1hbGl6YXRpb24gYXBwbGllcyAobm8gYmVoYXZpb3VyIGNoYW5nZSBmb3Igbm9uLWRlY2xhcmVkIGNvbHVtbnMpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5OYW1lIC0gRGF0YWJhc2UgY29sdW1uIG5hbWUgYmVpbmcgcmVhZC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGFyZ3MuY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIF9ub3JtYWxpemVCb29sZWFuVmFsdWVGb3JSZWFkKHtjb2x1bW5OYW1lLCBjb2x1bW5UeXBlLCB2YWx1ZX0pIHtcbiAgICBpZiAodGhpcy5fZGVjbGFyZWRBdHRyaWJ1dGVDYXN0Rm9yQ29sdW1uKGNvbHVtbk5hbWUpID09PSBcImJvb2xlYW5cIikge1xuICAgICAgcmV0dXJuIHRoaXMuX2Nhc3REZWNsYXJlZEJvb2xlYW5Gb3JSZWFkKHZhbHVlKVxuICAgIH1cblxuICAgIGlmICghY29sdW1uVHlwZSkgcmV0dXJuIHZhbHVlXG4gICAgaWYgKGNvbHVtblR5cGUudG9Mb3dlckNhc2UoKSAhPT0gXCJib29sZWFuXCIpIHJldHVybiB2YWx1ZVxuICAgIGlmICh2YWx1ZSA9PT0gMSkgcmV0dXJuIHRydWVcbiAgICBpZiAodmFsdWUgPT09IDApIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZGF0ZSB2YWx1ZSBmb3IgcmVhZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSBmcm9tIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIF9ub3JtYWxpemVEYXRlVmFsdWVGb3JSZWFkKHZhbHVlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZURhdGVWYWx1ZUZvclJlYWQodmFsdWUsIHtkYXRhYmFzZVR5cGU6IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldERhdGFiYXNlVHlwZSgpfSlcbiAgfVxuXG4gIF9iZWxvbmdzVG9DaGFuZ2VzKCkge1xuICAgIC8qKlxuICAgICAqIEJlbG9uZ3MgdG8gY2hhbmdlcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGJlbG9uZ3NUb0NoYW5nZXMgPSB7fVxuXG4gICAgaWYgKHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcykge1xuICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIGluIHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcykge1xuICAgICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgICBpZiAocmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImJlbG9uZ3NUb1wiICYmIHJlbGF0aW9uc2hpcC5nZXREaXJ0eSgpKSB7XG4gICAgICAgICAgY29uc3QgbW9kZWwgPSByZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKVxuXG4gICAgICAgICAgaWYgKG1vZGVsKSB7XG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShtb2RlbCkpIHRocm93IG5ldyBFcnJvcihcIlVuZXhwZWN0ZWQgYmVsb25ncy10byBtb2RlbCBhcnJheVwiKVxuXG4gICAgICAgICAgICBiZWxvbmdzVG9DaGFuZ2VzW3JlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KCldID0gdGhpcy5fYmVsb25nc1RvRm9yZWlnbktleVZhbHVlKHttb2RlbCwgcmVsYXRpb25zaGlwfSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gYmVsb25nc1RvQ2hhbmdlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIG5ldyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfY3JlYXRlTmV3UmVjb3JkKCkge1xuICAgIC8vIFJlc29sdmUgdGhlIGNvbm5lY3Rpb24gb25jZSBhbmQgcGluIHRoZSB3aG9sZSBpbnNlcnQgcGF0aCB0byBpdDogYSBwb29sXG4gICAgLy8gY2FuIHJlc29sdmUgYSBkaWZmZXJlbnQgY3VycmVudCBjb25uZWN0aW9uIGFjcm9zcyB0aGUgYXdhaXRzIGJlbG93LCBhbmRcbiAgICAvLyB0aGUgaWRlbnRpdHktaW5zZXJ0IHdyYXBwZXIgaXMgb25seSBlZmZlY3RpdmUgb24gdGhlIGV4YWN0IHNlc3Npb24gdGhhdFxuICAgIC8vIHJhbiBTRVQgSURFTlRJVFlfSU5TRVJULlxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLl9jb25uZWN0aW9uKClcblxuICAgIGlmICghY29ubmVjdGlvbltcImluc2VydFNxbFwiXSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBpbnNlcnRTcWwgb24gJHtjb25uZWN0aW9uLmNvbnN0cnVjdG9yLm5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fYmVsb25nc1RvQ2hhbmdlcygpLCB0aGlzLnJhd0F0dHJpYnV0ZXMoKSlcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcHJpbWFyeUtleUNvbHVtbnMgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5zKCkuZmlsdGVyKChjb2x1bW4pID0+IHtcbiAgICAgIHJldHVybiBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpID8gcHJpbWFyeUtleS5pbmNsdWRlcyhjb2x1bW4uZ2V0TmFtZSgpKSA6IGNvbHVtbi5nZXROYW1lKCkgPT0gcHJpbWFyeUtleVxuICAgIH0pXG4gICAgY29uc3QgcHJpbWFyeUtleUNvbHVtbiA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyB1bmRlZmluZWQgOiBwcmltYXJ5S2V5Q29sdW1uc1swXVxuICAgIGNvbnN0IHByaW1hcnlLZXlUeXBlID0gcHJpbWFyeUtleUNvbHVtbj8uZ2V0VHlwZSgpPy50b0xvd2VyQ2FzZSgpXG4gICAgY29uc3QgZHJpdmVyU3VwcG9ydHNEZWZhdWx0VVVJRCA9IHR5cGVvZiBjb25uZWN0aW9uLnN1cHBvcnRzRGVmYXVsdFByaW1hcnlLZXlVVUlEID09IFwiZnVuY3Rpb25cIiAmJiBjb25uZWN0aW9uLnN1cHBvcnRzRGVmYXVsdFByaW1hcnlLZXlVVUlEKClcbiAgICBjb25zdCBpc1VVSURQcmltYXJ5S2V5ID0gcHJpbWFyeUtleVR5cGU/LmluY2x1ZGVzKFwidXVpZFwiKVxuICAgIGNvbnN0IHNob3VsZEFzc2lnblVVSURQcmltYXJ5S2V5ID0gaXNVVUlEUHJpbWFyeUtleSAmJiAhZHJpdmVyU3VwcG9ydHNEZWZhdWx0VVVJRFxuICAgIHRoaXMuX3NldERlZmF1bHRUaW1lc3RhbXBWYWx1ZXMoZGF0YSlcblxuICAgIGNvbnN0IGNvbHVtbk5hbWVzID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZXMoKVxuICAgIGNvbnN0IGhhc1VzZXJQcm92aWRlZFByaW1hcnlLZXkgPSBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpXG4gICAgICA/IHByaW1hcnlLZXkuZXZlcnkoKGNvbHVtbk5hbWUpID0+IGRhdGFbY29sdW1uTmFtZV0gIT09IHVuZGVmaW5lZCAmJiBkYXRhW2NvbHVtbk5hbWVdICE9PSBudWxsICYmIGRhdGFbY29sdW1uTmFtZV0gIT09IFwiXCIpXG4gICAgICA6IGRhdGFbcHJpbWFyeUtleV0gIT09IHVuZGVmaW5lZCAmJiBkYXRhW3ByaW1hcnlLZXldICE9PSBudWxsICYmIGRhdGFbcHJpbWFyeUtleV0gIT09IFwiXCJcbiAgICBjb25zdCBoYXNVc2VyUHJvdmlkZWRBdXRvSW5jcmVtZW50UHJpbWFyeUtleSA9IHByaW1hcnlLZXlDb2x1bW5zLnNvbWUoKGNvbHVtbikgPT4ge1xuICAgICAgY29uc3QgdmFsdWUgPSBkYXRhW2NvbHVtbi5nZXROYW1lKCldXG5cbiAgICAgIHJldHVybiBjb2x1bW4uZ2V0QXV0b0luY3JlbWVudCgpID09PSB0cnVlICYmIHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwgJiYgdmFsdWUgIT09IFwiXCJcbiAgICB9KVxuXG4gICAgaWYgKHNob3VsZEFzc2lnblVVSURQcmltYXJ5S2V5ICYmICFoYXNVc2VyUHJvdmlkZWRQcmltYXJ5S2V5KSB7XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkgdGhyb3cgbmV3IEVycm9yKFwiQ29tcG9zaXRlIFVVSUQgcHJpbWFyeSBrZXlzIG11c3QgYmUgcHJvdmlkZWQgZXhwbGljaXRseS5cIilcblxuICAgICAgZGF0YVtwcmltYXJ5S2V5XSA9IG5ldyBVVUlEKDQpLmZvcm1hdCgpXG4gICAgfVxuXG4gICAgdGhpcy5fbm9ybWFsaXplRGF0ZVZhbHVlc0ZvcldyaXRlKGRhdGEpXG5cbiAgICBjb25zdCBzcWwgPSBjb25uZWN0aW9uLmluc2VydFNxbCh7XG4gICAgICByZXR1cm5MYXN0SW5zZXJ0ZWRDb2x1bW5OYW1lczogY29sdW1uTmFtZXMsXG4gICAgICB0YWJsZU5hbWU6IHRoaXMuX3RhYmxlTmFtZSgpLFxuICAgICAgZGF0YVxuICAgIH0pXG4gICAgY29uc3QgaW5zZXJ0T3B0aW9ucyA9IHtsb2dOYW1lOiBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBDcmVhdGVgfVxuICAgIC8vIEV4cGxpY2l0IHByaW1hcnkta2V5IGluc2VydHMgaW50byBhdXRvLWluY3JlbWVudCBjb2x1bW5zIGdvIHRocm91Z2ggdGhlXG4gICAgLy8gZHJpdmVyJ3MgZXhwbGljaXQtcHJpbWFyeS1rZXkgaW5zZXJ0IChNU1NRTCB3cmFwcyBpdCBpbiBJREVOVElUWV9JTlNFUlQpO1xuICAgIC8vIGV2ZXJ5dGhpbmcgZWxzZSB1c2VzIHRoZSBwbGFpbiBxdWVyeSBwYXRoLlxuICAgIGNvbnN0IGluc2VydFJlc3VsdCA9IGhhc1VzZXJQcm92aWRlZEF1dG9JbmNyZW1lbnRQcmltYXJ5S2V5XG4gICAgICA/IGF3YWl0IGNvbm5lY3Rpb24uaW5zZXJ0V2l0aEV4cGxpY2l0UHJpbWFyeUtleSh7b3B0aW9uczogaW5zZXJ0T3B0aW9ucywgc3FsLCB0YWJsZU5hbWU6IHRoaXMuX3RhYmxlTmFtZSgpfSlcbiAgICAgIDogYXdhaXQgY29ubmVjdGlvbi5xdWVyeShzcWwsIGluc2VydE9wdGlvbnMpXG5cbiAgICBhd2FpdCB0aGlzLl9hcHBseUluc2VydFJlc3VsdCh7Y29ubmVjdGlvbiwgZGF0YSwgaW5zZXJ0UmVzdWx0LCBwcmltYXJ5S2V5fSlcbiAgICB0aGlzLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuXG4gICAgdGhpcy5fbWFya0xvYWRlZFJlbGF0aW9uc2hpcHNQcmVsb2FkZWRBZnRlckNyZWF0ZSgpXG4gIH1cblxuICAvKipcbiAgICogTWFya3Mgb25seSByZWxhdGlvbnNoaXBzIHdpdGggaW4tbWVtb3J5IGxvYWRlZCB2YWx1ZXMgYXMgcHJlbG9hZGVkIGFmdGVyIGNyZWF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX21hcmtMb2FkZWRSZWxhdGlvbnNoaXBzUHJlbG9hZGVkQWZ0ZXJDcmVhdGUoKSB7XG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXAgb2YgdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0UmVsYXRpb25zaGlwcygpKSB7XG4gICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCkpXG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJoYXNNYW55XCIgJiYgaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKSA9PT0gbnVsbCkge1xuICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcC5zZXRMb2FkZWQoW10pXG4gICAgICB9XG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0UHJlbG9hZGVkKHRydWUpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgdGhlIGRhdGFiYXNlIGluc2VydCByZXNwb25zZSB0byB0aGlzIHJlY29yZC5cbiAgICogQHBhcmFtIHt7Y29ubmVjdGlvbjogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIGRhdGE6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBEYXRlIHwgbnVsbCB8IHVuZGVmaW5lZD4sIGluc2VydFJlc3VsdDogQXJyYXk8UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IERhdGUgfCBudWxsIHwgdW5kZWZpbmVkPj4gfCBudWxsIHwgdW5kZWZpbmVkLCBwcmltYXJ5S2V5OiBzdHJpbmcgfCBzdHJpbmdbXX19IG9wdGlvbnMgLSBQaW5uZWQgaW5zZXJ0IGNvbm5lY3Rpb24sIGluc2VydGVkIGRhdGEsIGNvbm5lY3Rpb24gcmVzdWx0LCBhbmQgcHJpbWFyeSBrZXkgY29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfYXBwbHlJbnNlcnRSZXN1bHQoe2Nvbm5lY3Rpb24sIGRhdGEsIGluc2VydFJlc3VsdCwgcHJpbWFyeUtleX0pIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkge1xuICAgICAgY29uc3QgaW5zZXJ0ZWRSb3cgPSBBcnJheS5pc0FycmF5KGluc2VydFJlc3VsdCkgPyBpbnNlcnRSZXN1bHRbMF0gOiB1bmRlZmluZWRcblxuICAgICAgYXdhaXQgdGhpcy5fcmVsb2FkV2l0aElkKHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoY29sdW1uTmFtZSkgPT4gaW5zZXJ0ZWRSb3c/Lltjb2x1bW5OYW1lXSA/PyBkYXRhW2NvbHVtbk5hbWVdKSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KGluc2VydFJlc3VsdCkgJiYgaW5zZXJ0UmVzdWx0WzBdICYmIGluc2VydFJlc3VsdFswXVtwcmltYXJ5S2V5XSkge1xuICAgICAgdGhpcy5fYXR0cmlidXRlcyA9IGluc2VydFJlc3VsdFswXVxuICAgICAgdGhpcy5fY2hhbmdlcyA9IHt9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHByaW1hcnlLZXlWYWx1ZSA9IGRhdGFbcHJpbWFyeUtleV1cblxuICAgICAgaWYgKHByaW1hcnlLZXlWYWx1ZSAhPT0gdW5kZWZpbmVkICYmIHByaW1hcnlLZXlWYWx1ZSAhPT0gbnVsbCAmJiBwcmltYXJ5S2V5VmFsdWUgIT09IFwiXCIpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBwcmltYXJ5S2V5VmFsdWUgIT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgcHJpbWFyeUtleVZhbHVlICE9IFwibnVtYmVyXCIpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEluc2VydGVkIHByaW1hcnkga2V5ICR7cHJpbWFyeUtleX0gbXVzdCBiZSBhIHN0cmluZyBvciBudW1iZXIsIGdvdCAke3R5cGVvZiBwcmltYXJ5S2V5VmFsdWV9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMuX3JlbG9hZFdpdGhJZChwcmltYXJ5S2V5VmFsdWUpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBjb25zdCBpZCA9IGF3YWl0IGNvbm5lY3Rpb24ubGFzdEluc2VydElEKClcblxuICAgICAgYXdhaXQgdGhpcy5fcmVsb2FkV2l0aElkKGlkKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRpbWVzdGFtcCBkZWZhdWx0cyBmb3IgYSBuZXcgcmVjb3JkIGluc2VydC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGRhdGEgLSBDb2x1bW4ta2V5ZWQgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3NldERlZmF1bHRUaW1lc3RhbXBWYWx1ZXMoZGF0YSkge1xuICAgIGNvbnN0IGNyZWF0ZWRBdENvbHVtbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbnMoKS5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT0gXCJjcmVhdGVkX2F0XCIpXG4gICAgY29uc3QgdXBkYXRlZEF0Q29sdW1uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1ucygpLmZpbmQoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSA9PSBcInVwZGF0ZWRfYXRcIilcbiAgICBjb25zdCBjdXJyZW50RGF0ZSA9IG5ldyBEYXRlKClcblxuICAgIGlmIChjcmVhdGVkQXRDb2x1bW4gJiYgKGRhdGEuY3JlYXRlZF9hdCA9PT0gdW5kZWZpbmVkIHx8IGRhdGEuY3JlYXRlZF9hdCA9PT0gbnVsbCB8fCBkYXRhLmNyZWF0ZWRfYXQgPT09IFwiXCIpKSB7XG4gICAgICBkYXRhLmNyZWF0ZWRfYXQgPSBjdXJyZW50RGF0ZVxuICAgIH1cbiAgICBpZiAodXBkYXRlZEF0Q29sdW1uICYmIChkYXRhLnVwZGF0ZWRfYXQgPT09IHVuZGVmaW5lZCB8fCBkYXRhLnVwZGF0ZWRfYXQgPT09IG51bGwgfHwgZGF0YS51cGRhdGVkX2F0ID09PSBcIlwiKSkge1xuICAgICAgZGF0YS51cGRhdGVkX2F0ID0gY3VycmVudERhdGVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZGF0ZSB2YWx1ZXMgZm9yIHdyaXRlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gZGF0YSAtIENvbHVtbi1rZXllZCBkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfbm9ybWFsaXplRGF0ZVZhbHVlc0ZvcldyaXRlKGRhdGEpIHtcbiAgICBmb3IgKGNvbnN0IGNvbHVtbk5hbWUgaW4gZGF0YSkge1xuICAgICAgY29uc3QgY29sdW1uVHlwZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtblR5cGVCeU5hbWUoY29sdW1uTmFtZSlcblxuICAgICAgaWYgKCFjb2x1bW5UeXBlIHx8ICF0aGlzLmdldE1vZGVsQ2xhc3MoKS5faXNEYXRlTGlrZVR5cGUoY29sdW1uVHlwZSkpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHZhbHVlID0gZGF0YVtjb2x1bW5OYW1lXVxuXG4gICAgICBkYXRhW2NvbHVtbk5hbWVdID0gbm9ybWFsaXplRGF0ZVZhbHVlRm9yV3JpdGUodmFsdWUsIHt0aW1lWm9uZTogdGhpcy5nZXRNb2RlbENsYXNzKCkuX3RpbWVab25lRm9yRGF0ZVdyaXRlKCl9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZSByZWNvcmQgd2l0aCBjaGFuZ2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3VwZGF0ZVJlY29yZFdpdGhDaGFuZ2VzKCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLl9jb25uZWN0aW9uKClcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlID0gdGhpcy5fcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKClcbiAgICBjb25zdCBuZXh0UHJpbWFyeUtleVZhbHVlID0gdGhpcy5pZCgpXG4gICAgLyoqXG4gICAgICogQ29uZGl0aW9ucy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGNvbmRpdGlvbnMgPSB7fVxuXG4gICAgT2JqZWN0LmFzc2lnbihjb25kaXRpb25zLCBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIHBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSkpXG5cbiAgICBjb25zdCBjaGFuZ2VzID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fYmVsb25nc1RvQ2hhbmdlcygpLCB0aGlzLl9jaGFuZ2VzKVxuICAgIGNvbnN0IHVwZGF0ZWRBdENvbHVtbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbnMoKS5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT0gXCJ1cGRhdGVkX2F0XCIpXG4gICAgY29uc3QgY3VycmVudERhdGUgPSBuZXcgRGF0ZSgpXG5cbiAgICBpZiAodXBkYXRlZEF0Q29sdW1uICYmIChjaGFuZ2VzLnVwZGF0ZWRfYXQgPT09IHVuZGVmaW5lZCB8fCBjaGFuZ2VzLnVwZGF0ZWRfYXQgPT09IG51bGwgfHwgY2hhbmdlcy51cGRhdGVkX2F0ID09PSBcIlwiKSkge1xuICAgICAgY2hhbmdlcy51cGRhdGVkX2F0ID0gY3VycmVudERhdGVcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoY2hhbmdlcykubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5fbm9ybWFsaXplRGF0ZVZhbHVlc0ZvcldyaXRlKGNoYW5nZXMpXG4gICAgICBjb25zdCBzcWwgPSBjb25uZWN0aW9uLnVwZGF0ZVNxbCh7XG4gICAgICAgIHRhYmxlTmFtZTogdGhpcy5fdGFibGVOYW1lKCksXG4gICAgICAgIGRhdGE6IGNoYW5nZXMsXG4gICAgICAgIGNvbmRpdGlvbnNcbiAgICAgIH0pXG4gICAgICBhd2FpdCBjb25uZWN0aW9uLnF1ZXJ5KHNxbCwge2xvZ05hbWU6IGAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9IFVwZGF0ZWB9KVxuICAgICAgYXdhaXQgdGhpcy5fcmVsb2FkV2l0aElkKG5leHRQcmltYXJ5S2V5VmFsdWUpXG4gICAgICBjb25zdCByZWxvYWRlZFByaW1hcnlLZXlWYWx1ZSA9IHRoaXMuaWQoKVxuXG4gICAgICBpZiAoXG4gICAgICAgIE9iamVjdC5rZXlzKHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldEF0dGFjaG1lbnRzKCkpLmxlbmd0aCA+IDBcbiAgICAgICAgJiYgbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKSAhPT0gbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgcmVsb2FkZWRQcmltYXJ5S2V5VmFsdWUpXG4gICAgICApIHtcbiAgICAgICAgYXdhaXQgcmVjb3JkQXR0YWNobWVudHNTdG9yZUZvck1vZGVsKHRoaXMpLm1pZ3JhdGVSZWNvcmRJZGVudGl0eSh7XG4gICAgICAgICAgY29ubmVjdGlvbixcbiAgICAgICAgICBtb2RlbDogdGhpcyxcbiAgICAgICAgICBuZXh0SWRlbnRpdHk6IHJlbG9hZGVkUHJpbWFyeUtleVZhbHVlLFxuICAgICAgICAgIHByZXZpb3VzSWRlbnRpdHk6IHBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZVxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IC0gVGhlIGlkLlxuICAgKi9cbiAgaWQoKSB7XG4gICAgaWYgKCF0aGlzLmdldE1vZGVsQ2xhc3MoKS5fY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb2x1bW4gbmFtZXMgbWFwcGluZyBoYXNuJ3QgYmVlbiBzZXQgb24gJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9LiBIYXMgdGhlIG1vZGVsIGJlZW4gaW5pdGlhbGl6ZWQ/YClcbiAgICB9XG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkge1xuICAgICAgcmV0dXJuIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoY29sdW1uTmFtZSkgPT4gdGhpcy5yZWFkQ29sdW1uKGNvbHVtbk5hbWUpKVxuICAgIH1cblxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbcHJpbWFyeUtleV1cblxuICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUHJpbWFyeSBrZXkgJHtwcmltYXJ5S2V5fSBkb2Vzbid0IGV4aXN0IGluIGNvbHVtbnM6ICR7T2JqZWN0LmtleXModGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpKS5qb2luKFwiLCBcIil9YClcbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtudW1iZXIgfCBzdHJpbmd9ICovICh0aGlzLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgaWRlbnRpdHkgcmVwcmVzZW50ZWQgYnkgdGhlIGxhc3QgcGVyc2lzdGVkIGRhdGFiYXNlIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gLSBQZXJzaXN0ZWQgaWRlbnRpdHkuXG4gICAqL1xuICBfcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKCkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KClcblxuICAgIHJldHVybiByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGNvbHVtbk5hbWUpID0+IHRoaXMuX2F0dHJpYnV0ZXNbY29sdW1uTmFtZV0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBwZXJzaXN0ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcGVyc2lzdGVkLlxuICAgKi9cbiAgaXNQZXJzaXN0ZWQoKSB7IHJldHVybiAhdGhpcy5faXNOZXdSZWNvcmQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIG5ldyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgbmV3IHJlY29yZC5cbiAgICovXG4gIGlzTmV3UmVjb3JkKCkgeyByZXR1cm4gdGhpcy5faXNOZXdSZWNvcmQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBpcyBuZXcgcmVjb3JkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld0lzTmV3UmVjb3JkIC0gTmV3IGlzIG5ldyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldElzTmV3UmVjb3JkKG5ld0lzTmV3UmVjb3JkKSB7XG4gICAgdGhpcy5faXNOZXdSZWNvcmQgPSBuZXdJc05ld1JlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsb2FkIHdpdGggaWQuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIFJlY29yZCBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3JlbG9hZFdpdGhJZChpZCkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KClcblxuICAgIC8qKlxuICAgICAqIFdoZXJlIG9iamVjdC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHdoZXJlT2JqZWN0ID0ge31cblxuICAgIE9iamVjdC5hc3NpZ24od2hlcmVPYmplY3QsIG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMocHJpbWFyeUtleSwgaWQpKVxuXG4gICAgY29uc3QgcXVlcnkgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8TUM+fSAqLyAoXG4gICAgICB0aGlzXG4gICAgICAgIC5xdWVyeUZvck1vZGVsKHRoaXMuZ2V0TW9kZWxDbGFzcygpKVxuICAgICAgICAud2hlcmUod2hlcmVPYmplY3QpXG4gICAgKVxuICAgIGNvbnN0IHJlbG9hZGVkTW9kZWwgPSBhd2FpdCBxdWVyeS5maXJzdCgpXG5cbiAgICBpZiAoIXJlbG9hZGVkTW9kZWwpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IyR7aWR9IGNvdWxkbid0IGJlIHJlbG9hZGVkIC0gcmVjb3JkIGRpZG4ndCBleGlzdGApXG5cbiAgICB0aGlzLmxvYWRFeGlzdGluZ1JlY29yZChyZWxvYWRlZE1vZGVsLnJhd0F0dHJpYnV0ZXMoKSwgcmVsb2FkZWRNb2RlbC5fc2VsZWN0ZWRBdHRyaWJ1dGVBbGlhc2VzKVxuICAgIHRoaXMuX2NoYW5nZXMgPSB7fVxuICAgIHRoaXMuX2Fzc2lnbmVkQXR0cmlidXRlTmFtZXMgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlbG9hZCgpIHtcbiAgICBjb25zdCByZWNvcmRJZCA9IHRoaXMuX3BlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgYXdhaXQgdGhpcy5fcmVsb2FkV2l0aElkKHJlY29yZElkKVxuICB9XG5cbiAgYXN5bmMgX3J1blZhbGlkYXRpb25zKCkge1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge3R5cGU6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nfT59ICovXG4gICAgdGhpcy5fdmFsaWRhdGlvbkVycm9ycyA9IHt9XG5cbiAgICBjb25zdCB2YWxpZGF0b3JzID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuX3ZhbGlkYXRvcnNcblxuICAgIGlmICh2YWxpZGF0b3JzKSB7XG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgaW4gdmFsaWRhdG9ycykge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVWYWxpZGF0b3JzID0gdmFsaWRhdG9yc1thdHRyaWJ1dGVOYW1lXVxuXG4gICAgICAgIGZvciAoY29uc3QgdmFsaWRhdG9yIG9mIGF0dHJpYnV0ZVZhbGlkYXRvcnMpIHtcbiAgICAgICAgICBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGUoe21vZGVsOiB0aGlzLCBhdHRyaWJ1dGVOYW1lfSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyh0aGlzLl92YWxpZGF0aW9uRXJyb3JzKS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCB2YWxpZGF0aW9uRXJyb3IgPSBuZXcgVmFsaWRhdGlvbkVycm9yKHRoaXMuZnVsbEVycm9yTWVzc2FnZXMoKS5qb2luKFwiLiBcIikpXG5cbiAgICAgIHZhbGlkYXRpb25FcnJvci5zZXRWYWxpZGF0aW9uRXJyb3JzKHRoaXMuX3ZhbGlkYXRpb25FcnJvcnMpXG4gICAgICB2YWxpZGF0aW9uRXJyb3Iuc2V0TW9kZWwodGhpcylcbiAgICAgIHZhbGlkYXRpb25FcnJvci52ZWxvY2lvdXMgPSB7dHlwZTogXCJ2YWxpZGF0aW9uX2Vycm9yXCJ9XG5cbiAgICAgIHRocm93IHZhbGlkYXRpb25FcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZ1bGwgZXJyb3IgbWVzc2FnZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBUaGUgZnVsbCBlcnJvciBtZXNzYWdlcy5cbiAgICovXG4gIGZ1bGxFcnJvck1lc3NhZ2VzKCkge1xuICAgIC8qKlxuICAgICAqIFZhbGlkYXRpb24gZXJyb3IgbWVzc2FnZXMuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvck1lc3NhZ2VzID0gW11cblxuICAgIGlmICh0aGlzLl92YWxpZGF0aW9uRXJyb3JzKSB7XG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgaW4gdGhpcy5fdmFsaWRhdGlvbkVycm9ycykge1xuICAgICAgICBmb3IgKGNvbnN0IHZhbGlkYXRpb25FcnJvciBvZiB0aGlzLl92YWxpZGF0aW9uRXJyb3JzW2F0dHJpYnV0ZU5hbWVdKSB7XG4gICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLmh1bWFuQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKX0gJHt2YWxpZGF0aW9uRXJyb3IubWVzc2FnZX1gXG5cbiAgICAgICAgICB2YWxpZGF0aW9uRXJyb3JNZXNzYWdlcy5wdXNoKG1lc3NhZ2UpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdmFsaWRhdGlvbkVycm9yTWVzc2FnZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIHRoZSBhdHRyaWJ1dGVzIHRvIHRoZSByZWNvcmQgYW5kIHNhdmVzIGl0LlxuICAgKiBAcGFyYW0ge1dyaXRlQXR0cmlidXRlc30gYXR0cmlidXRlc1RvQXNzaWduIC0gVGhlIGF0dHJpYnV0ZXMgdG8gYXNzaWduIHRvIHRoZSByZWNvcmQuXG4gICAqL1xuICBhc3luYyB1cGRhdGUoYXR0cmlidXRlc1RvQXNzaWduKSB7XG4gICAgaWYgKGF0dHJpYnV0ZXNUb0Fzc2lnbikgdGhpcy5hc3NpZ24oYXR0cmlidXRlc1RvQXNzaWduKVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlKClcbiAgfVxufVxuXG5WZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlclZhbGlkYXRvclR5cGUoXCJmb3JtYXRcIiwgVmFsaWRhdG9yc0Zvcm1hdClcblZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyVmFsaWRhdG9yVHlwZShcImxlbmd0aFwiLCBWYWxpZGF0b3JzTGVuZ3RoKVxuVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJWYWxpZGF0b3JUeXBlKFwicHJlc2VuY2VcIiwgVmFsaWRhdG9yc1ByZXNlbmNlKVxuVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJWYWxpZGF0b3JUeXBlKFwidW5pcXVlbmVzc1wiLCBWYWxpZGF0b3JzVW5pcXVlbmVzcylcblxuZXhwb3J0IHtBZHZpc29yeUxvY2tCdXN5RXJyb3IsIEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3IsIEFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvciwgVGVuYW50RGF0YWJhc2VTY29wZUVycm9yLCBWYWxpZGF0aW9uRXJyb3J9XG5leHBvcnQgZGVmYXVsdCBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZFxuIl19