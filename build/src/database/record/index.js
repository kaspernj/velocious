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
            const connection = record
                .queryForModel(ParentModel)
                .driver;
            const quoted = connection.quote(parentId);
            const sql = `UPDATE ${connection.quoteTable(parentTable)} SET ${connection.quoteColumn(counterColumn)} = (SELECT COUNT(*) FROM ${connection.quoteTable(childTable)} WHERE ${connection.quoteColumn(fk)} = ${quoted}) WHERE ${connection.quoteColumn(pkColumn)} = ${quoted}`;
            await connection.query(sql, { logName: `${ParentModel.name} Update` });
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
     * @param {object} attributes - Attributes.
     * @returns {void} - No return value.
     */
    loadExistingRecord(attributes) {
        this._attributes = attributes;
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
            const attributeName = columnNameToAttributeName[columnName] || columnName;
            attributes[attributeName] = this.readAttribute(attributeName);
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
        this._attributes = reloadedModel.rawAttributes();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7O0dBR0c7QUFFSDs7OztHQUlHO0FBRUg7Ozs7R0FJRztBQUVIOzs7R0FHRztBQUVILDhHQUE4RztBQUU5Rzs7O0dBR0c7QUFFSCxPQUFPLGtCQUFrQixFQUFFLEVBQUMscUJBQXFCLEVBQUUsNEJBQTRCLEVBQUUsd0JBQXdCLEVBQUMsTUFBTSw0QkFBNEIsQ0FBQTtBQUM1SSxPQUFPLDZCQUE2QixNQUFNLHdDQUF3QyxDQUFBO0FBQ2xGLE9BQU8scUJBQXFCLE1BQU0sK0JBQStCLENBQUE7QUFDakUsT0FBTyxhQUFhLE1BQU0sd0JBQXdCLENBQUE7QUFDbEQsT0FBTyxPQUFPLE1BQU0sa0JBQWtCLENBQUE7QUFDdEMsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFDOUMsT0FBTyxPQUFPLE1BQU0sZUFBZSxDQUFBO0FBQ25DLE9BQU8sMkJBQTJCLE1BQU0sc0NBQXNDLENBQUE7QUFDOUUsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUM3RCxPQUFPLDBCQUEwQixNQUFNLHFDQUFxQyxDQUFBO0FBQzVFLE9BQU8sa0JBQWtCLE1BQU0sNEJBQTRCLENBQUE7QUFDM0QsT0FBTyxzQkFBc0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM1RCxPQUFPLEVBQUMsOEJBQThCLEVBQUUsbUNBQW1DLEVBQUMsTUFBTSx3QkFBd0IsQ0FBQTtBQUMxRyxPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUN4QyxPQUFPLGdCQUFnQixNQUFNLG1DQUFtQyxDQUFBO0FBQ2hFLE9BQU8sZUFBZSxNQUFNLCtCQUErQixDQUFBO0FBQzNELE9BQU8sU0FBUyxNQUFNLHVCQUF1QixDQUFBO0FBQzdDLE9BQU8sRUFBQywyQkFBMkIsRUFBRSwwQkFBMEIsRUFBRSxv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dHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7dHlwZTogc3RyaW5nLCBtZXNzYWdlOiBzdHJpbmd9fSBWYWxpZGF0aW9uRXJyb3JPYmplY3RUeXBlXG4gKi9cblxuLyoqXG4gKiBMaWZlY3ljbGVDYWxsYmFja1R5cGUgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBbVD1WZWxvY2lvdXNEYXRhYmFzZVJlY29yZF1cbiAqIEB0eXBlZGVmIHsoKG1vZGVsOiBUKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPikgfCBzdHJpbmd9IExpZmVjeWNsZUNhbGxiYWNrVHlwZVxuICovXG5cbi8qKlxuICogTW9kZWwgY2xhc3MgY29uc3RydWN0b3IgdHlwZSB1c2VkIGZvciBzdGF0aWMgYHRoaXNgIHR5cGluZy5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAdHlwZWRlZiB7e25ldyAoY2hhbmdlcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogVH19IE1vZGVsQ29uc3RydWN0b3JcbiAqL1xuXG4vKipcbiAqIFJlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXAgdHlwZS5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0ICYge3F1ZXJ5OiAoKSA9PiBNb2RlbENsYXNzUXVlcnk8dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPn19IFJlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXBcbiAqL1xuXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGV9IFRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlICovXG5cbi8qKlxuICogU2NoZW1hIG1ldGFkYXRhIGNhY2hlZCBmb3Igb25lIHJlY29yZCBjbGFzcyBhbmQgcGh5c2ljYWwgZGF0YWJhc2UgZ2VuZXJhdGlvbi5cbiAqIEB0eXBlZGVmIHtib29sZWFuIHwgbnVsbCB8IHN0cmluZyB8IHVuZGVmaW5lZCB8IFByb21pc2U8dm9pZD4gfCBzdHJpbmdbXSB8IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdFtdIHwgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQgfCBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPiB8IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD59IFJlY29yZE1ldGFkYXRhVmFsdWVcbiAqL1xuXG5pbXBvcnQgQWR2aXNvcnlMb2NrUnVubmVyLCB7QWR2aXNvcnlMb2NrQnVzeUVycm9yLCBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yLCBBZHZpc29yeUxvY2tUaW1lb3V0RXJyb3J9IGZyb20gXCIuLi9hZHZpc29yeS1sb2NrLXJ1bm5lci5qc1wiXG5pbXBvcnQgQmVsb25nc1RvSW5zdGFuY2VSZWxhdGlvbnNoaXAgZnJvbSBcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iZWxvbmdzLXRvLmpzXCJcbmltcG9ydCBCZWxvbmdzVG9SZWxhdGlvbnNoaXAgZnJvbSBcIi4vcmVsYXRpb25zaGlwcy9iZWxvbmdzLXRvLmpzXCJcbmltcG9ydCBDb25maWd1cmF0aW9uIGZyb20gXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCJcbmltcG9ydCBDdXJyZW50IGZyb20gXCIuLi8uLi9jdXJyZW50LmpzXCJcbmltcG9ydCBGcm9tVGFibGUgZnJvbSBcIi4uL3F1ZXJ5L2Zyb20tdGFibGUuanNcIlxuaW1wb3J0IEhhbmRsZXIgZnJvbSBcIi4uL2hhbmRsZXIuanNcIlxuaW1wb3J0IEhhc01hbnlJbnN0YW5jZVJlbGF0aW9uc2hpcCBmcm9tIFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2hhcy1tYW55LmpzXCJcbmltcG9ydCBIYXNNYW55UmVsYXRpb25zaGlwIGZyb20gXCIuL3JlbGF0aW9uc2hpcHMvaGFzLW1hbnkuanNcIlxuaW1wb3J0IEhhc09uZUluc3RhbmNlUmVsYXRpb25zaGlwIGZyb20gXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvaGFzLW9uZS5qc1wiXG5pbXBvcnQgSGFzT25lUmVsYXRpb25zaGlwIGZyb20gXCIuL3JlbGF0aW9uc2hpcHMvaGFzLW9uZS5qc1wiXG5pbXBvcnQgUmVjb3JkQXR0YWNobWVudEhhbmRsZSBmcm9tIFwiLi9hdHRhY2htZW50cy9oYW5kbGUuanNcIlxuaW1wb3J0IHtyZWNvcmRBdHRhY2htZW50c1N0b3JlRm9yTW9kZWwsIHJlY29yZEF0dGFjaG1lbnRzU3RvcmVGb3JNb2RlbENsYXNzfSBmcm9tIFwiLi9hdHRhY2htZW50cy9zdG9yZS5qc1wiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCBkZWJ1cnJDb2x1bW5OYW1lIGZyb20gXCIuLi8uLi91dGlscy9kZWJ1cnItY29sdW1uLW5hbWUuanNcIlxuaW1wb3J0IE1vZGVsQ2xhc3NRdWVyeSBmcm9tIFwiLi4vcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIlxuaW1wb3J0IFByZWxvYWRlciBmcm9tIFwiLi4vcXVlcnkvcHJlbG9hZGVyLmpzXCJcbmltcG9ydCB7cmVhZFBheWxvYWRBc3NvY2lhdGlvbkNvdW50LCByZWFkUGF5bG9hZENvbXB1dGVkQWJpbGl0eSwgcmVhZFBheWxvYWRRdWVyeURhdGEsIHNldFBheWxvYWRBc3NvY2lhdGlvbkNvdW50LCBzZXRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5LCBzZXRQYXlsb2FkUXVlcnlEYXRhfSBmcm9tIFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCJcbmltcG9ydCByZWNvcmRDaGFuZ2VzIGZyb20gXCIuLi9yZWNvcmQtY2hhbmdlcy5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCBzaW5ndWxhcml6ZU1vZGVsTmFtZSBmcm9tIFwiLi4vLi4vdXRpbHMvc2luZ3VsYXJpemUtbW9kZWwtbmFtZS5qc1wiXG5pbXBvcnQge2RlZmluZU1vZGVsU2NvcGV9IGZyb20gXCIuLi8uLi91dGlscy9tb2RlbC1zY29wZS5qc1wiXG5pbXBvcnQgeyBub3JtYWxpemVEYXRlU3RyaW5nRm9yV3JpdGUsIG5vcm1hbGl6ZURhdGVWYWx1ZUZvclJlYWQsIG5vcm1hbGl6ZURhdGVWYWx1ZUZvcldyaXRlIH0gZnJvbSBcIi4uL2RhdGV0aW1lLXN0b3JhZ2UuanNcIlxuaW1wb3J0IHtmb3JtYXRWYWx1ZX0gZnJvbSBcIi4uLy4uL3V0aWxzL2Zvcm1hdC12YWx1ZS5qc1wiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNhY2hlS2V5LCBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zLCByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUsIHNjYWxhck1vZGVsUHJpbWFyeUtleSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGZyb20gXCIuLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQge2NhcHR1cmVDcmVhdGVBdWRpdENoYW5nZXMsIGNhcHR1cmVVcGRhdGVBdWRpdENoYW5nZXMsIGNyZWF0ZUF1ZGl0LCBjcmVhdGVDcmVhdGVBdWRpdCwgY3JlYXRlRGVzdHJveUF1ZGl0LCBjcmVhdGVVcGRhdGVBdWRpdCwgaW5pdGlhbGl6ZUF1ZGl0aW5nLCByZWdpc3RlckF1ZGl0Q2FsbGJhY2ssIHJlZ2lzdGVyQXVkaXRpbmcsIHdpdGhvdXRBdWRpdH0gZnJvbSBcIi4vYXVkaXRpbmcuanNcIlxuaW1wb3J0IHtyZWdpc3Rlck1hZ25pdHVkZUNvdW50ZXJDYWNoZX0gZnJvbSBcIi4vY291bnRlci1jYWNoZS1tYWduaXR1ZGUuanNcIlxuaW1wb3J0IHtzdGF0ZU1hY2hpbmV9IGZyb20gXCIuL3N0YXRlLW1hY2hpbmUuanNcIlxuaW1wb3J0IFZhbGlkYXRvcnNGb3JtYXQgZnJvbSBcIi4vdmFsaWRhdG9ycy9mb3JtYXQuanNcIlxuaW1wb3J0IFZhbGlkYXRvcnNMZW5ndGggZnJvbSBcIi4vdmFsaWRhdG9ycy9sZW5ndGguanNcIlxuaW1wb3J0IFZhbGlkYXRvcnNQcmVzZW5jZSBmcm9tIFwiLi92YWxpZGF0b3JzL3ByZXNlbmNlLmpzXCJcbmltcG9ydCBWYWxpZGF0b3JzVW5pcXVlbmVzcyBmcm9tIFwiLi92YWxpZGF0b3JzL3VuaXF1ZW5lc3MuanNcIlxuaW1wb3J0IHJlZ2lzdGVyQWN0c0FzTGlzdENhbGxiYWNrcyBmcm9tIFwiLi9hY3RzLWFzLWxpc3QuanNcIlxuaW1wb3J0IFRlbmFudE1vZGVsU2NvcGUgZnJvbSBcIi4uLy4uL3RlbmFudHMvdGVuYW50LW1vZGVsLXNjb3BlLmpzXCJcbmltcG9ydCBVVUlEIGZyb20gXCJwdXJlLXV1aWRcIlxuXG4vKipcbiAqIFRyYW5zbGF0aW9uIHJlY29yZCBzaGFwZSB1c2VkIGJ5IHRyYW5zbGF0ZWQgYXR0cmlidXRlcy5cbiAqIEB0eXBlZGVmIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCAmIHtsb2NhbGU6ICgpID0+IHN0cmluZ319IFRyYW5zbGF0aW9uQmFzZVxuICovXG4vKipcbiAqIEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yfSBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3JcbiAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkF0dGFjaG1lbnRTeW5jQ29uZmlndXJhdGlvbn0gQXR0YWNobWVudFN5bmNDb25maWd1cmF0aW9uICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuUmVjb3JkQXR0YWNobWVudENvbmZpZ3VyYXRpb259IFJlY29yZEF0dGFjaG1lbnRDb25maWd1cmF0aW9uICovXG5cbi8qKiBTdG9yZWQgdmFsdWVzIHRoYXQgYSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGNhc3QgcmVhZHMgYmFjayBhcyBgdHJ1ZWAuICovXG5jb25zdCBkZWNsYXJlZEJvb2xlYW5UcnV0aHlWYWx1ZXMgPSBuZXcgU2V0KFsxLCB0cnVlLCBcIjFcIl0pXG5cbi8qKiBTdG9yZWQgdmFsdWVzIHRoYXQgYSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGNhc3QgcmVhZHMgYmFjayBhcyBgZmFsc2VgLiAqL1xuY29uc3QgZGVjbGFyZWRCb29sZWFuRmFsc3lWYWx1ZXMgPSBuZXcgU2V0KFswLCBmYWxzZSwgXCIwXCJdKVxuXG4vKiogU3RhdGljIHJlY29yZCBtZXRhZGF0YSBmaWVsZHMgaXNvbGF0ZWQgcGVyIHBoeXNpY2FsIGRhdGFiYXNlL3NjaGVtYSBnZW5lcmF0aW9uLiAqL1xuY29uc3QgcmVjb3JkTWV0YWRhdGFQcm9wZXJ0eU5hbWVzID0gbmV3IFNldChbXG4gIFwiX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVcIixcbiAgXCJfY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVwiLFxuICBcIl9jb2x1bW5OYW1lc1wiLFxuICBcIl9jb2x1bW5zXCIsXG4gIFwiX2NvbHVtbnNBc0hhc2hcIixcbiAgXCJfY29sdW1uVHlwZUJ5TmFtZVwiLFxuICBcIl9kYXRhYmFzZVR5cGVcIixcbiAgXCJfaW5pdGlhbGl6ZWRcIixcbiAgXCJfaW5pdGlhbGl6ZVJlY29yZFByb21pc2VcIixcbiAgXCJfdGFibGVcIlxuXSlcblxuLyoqIEB0eXBlIHtXZWFrTWFwPHR5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIFJlY29yZE1ldGFkYXRhVmFsdWU+Pj59ICovXG5jb25zdCByZWNvcmRNZXRhZGF0YVZhbHVlc0J5TW9kZWwgPSBuZXcgV2Vha01hcCgpXG5cbi8qKlxuICogUmV0dXJucyB0aGUgZ2VuZXJhdGlvbi1rZXllZCBtZXRhZGF0YSBzdG9yZSBvd25lZCBieSBvbmUgY2Fub25pY2FsIG1vZGVsLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gQ2Fub25pY2FsIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge01hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIFJlY29yZE1ldGFkYXRhVmFsdWU+Pn0gLSBNZXRhZGF0YSBzdG9yZS5cbiAqL1xuZnVuY3Rpb24gcmVjb3JkTWV0YWRhdGFWYWx1ZXNGb3IobW9kZWxDbGFzcykge1xuICBsZXQgdmFsdWVzID0gcmVjb3JkTWV0YWRhdGFWYWx1ZXNCeU1vZGVsLmdldChtb2RlbENsYXNzKVxuXG4gIGlmICghdmFsdWVzKSB7XG4gICAgdmFsdWVzID0gbmV3IE1hcCgpXG4gICAgcmVjb3JkTWV0YWRhdGFWYWx1ZXNCeU1vZGVsLnNldChtb2RlbENsYXNzLCB2YWx1ZXMpXG4gIH1cblxuICByZXR1cm4gdmFsdWVzXG59XG5cbmNsYXNzIFZhbGlkYXRpb25FcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gLSBWZWxvY2lvdXMgbWV0YWRhdGEgZm9yIGZyb250ZW5kLW1vZGVsIGVycm9yIHJlcG9ydGluZy5cbiAgICovXG4gIHZlbG9jaW91c1xuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbC5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAtIFRoZSBtb2RlbC5cbiAgICovXG4gIGdldE1vZGVsKCkge1xuICAgIGlmICghdGhpcy5fbW9kZWwpIHRocm93IG5ldyBFcnJvcihcIk1vZGVsIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX21vZGVsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbW9kZWwuXG4gICAqIEBwYXJhbSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldE1vZGVsKG1vZGVsKSB7XG4gICAgdGhpcy5fbW9kZWwgPSBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHZhbGlkYXRpb24gZXJyb3JzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgVmFsaWRhdGlvbkVycm9yT2JqZWN0VHlwZVtdPn0gLSBUaGUgdmFsaWRhdGlvbiBlcnJvcnMuXG4gICAqL1xuICBnZXRWYWxpZGF0aW9uRXJyb3JzKCkge1xuICAgIGlmICghdGhpcy5fdmFsaWRhdGlvbkVycm9ycykgdGhyb3cgbmV3IEVycm9yKFwiVmFsaWRhdGlvbiBlcnJvcnMgaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGlvbkVycm9yc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHZhbGlkYXRpb24gZXJyb3JzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFZhbGlkYXRpb25FcnJvck9iamVjdFR5cGVbXT59IHZhbGlkYXRpb25FcnJvcnMgLSBWYWxpZGF0aW9uIGVycm9ycyB0byBhc3NpZ24uXG4gICAqL1xuICBzZXRWYWxpZGF0aW9uRXJyb3JzKHZhbGlkYXRpb25FcnJvcnMpIHtcbiAgICB0aGlzLl92YWxpZGF0aW9uRXJyb3JzID0gdmFsaWRhdGlvbkVycm9yc1xuICB9XG59XG5cbi8qKlxuICogUnVucyBhcHBseSBidWlsdCByZWNvcmQgaW52ZXJzZSByZWxhdGlvbnNoaXAuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBhcmdzLnBhcmVudCAtIFBhcmVudCByZWNvcmQgYmVpbmcgYnVpbHQgZnJvbS5cbiAqIEBwYXJhbSB7e2dldFJlbGF0aW9uc2hpcEJ5TmFtZTogVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXCJnZXRSZWxhdGlvbnNoaXBCeU5hbWVcIl19fSBhcmdzLnJlY29yZCAtIE5ld2x5IGJ1aWx0IHJlbGF0ZWQgcmVjb3JkLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsfSBhcmdzLmludmVyc2VPZiAtIEludmVyc2UgcmVsYXRpb25zaGlwIG5hbWUuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuYWxsb3dIYXNNYW55IC0gV2hldGhlciBhIGhhcy1tYW55IGludmVyc2Ugc2hvdWxkIGJlIGFwcGVuZGVkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFwcGx5QnVpbHRSZWNvcmRJbnZlcnNlUmVsYXRpb25zaGlwKHthbGxvd0hhc01hbnksIGludmVyc2VPZiwgcGFyZW50LCByZWNvcmR9KSB7XG4gIGlmICghaW52ZXJzZU9mKSByZXR1cm5cblxuICBjb25zdCBpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAgPSByZWNvcmQuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKGludmVyc2VPZilcblxuICBpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0QXV0b1NhdmUoZmFsc2UpXG5cbiAgaWYgKCFhbGxvd0hhc01hbnkgfHwgaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc09uZVwiKSB7XG4gICAgaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLnNldExvYWRlZChwYXJlbnQpXG4gICAgcmV0dXJuXG4gIH1cblxuICBpZiAoaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc01hbnlcIikge1xuICAgIGludmVyc2VJbnN0YW5jZVJlbGF0aW9uc2hpcC5hZGRUb0xvYWRlZChwYXJlbnQpXG4gICAgcmV0dXJuXG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVsYXRpb25zaGlwIHR5cGU6ICR7aW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKX1gKVxufVxuXG4vKipcbiAqIEJ1aWxkIGEgcmVsYXRlZCByZWNvcmQgYW5kIHdpcmUgaXRzIGludmVyc2UgcmVsYXRpb25zaGlwIHRvIHRoZSBwYXJlbnQuXG4gKiBAcGFyYW0ge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBwYXJlbnQgLSBQYXJlbnQgcmVjb3JkIGJ1aWxkaW5nIHRoZSByZWxhdGlvbnNoaXAuXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lIGJlaW5nIGJ1aWx0LlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzIGZvciB0aGUgbmV3IHJlbGF0ZWQgcmVjb3JkLlxuICogQHBhcmFtIHtib29sZWFufSBhbGxvd0hhc01hbnkgLSBXaGV0aGVyIGhhcy1tYW55IGludmVyc2UgcmVsYXRpb25zaGlwcyBzaG91bGQgYXBwZW5kIHRoZSBwYXJlbnQuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEJ1aWx0IHJlbGF0ZWQgcmVjb3JkLlxuICovXG5mdW5jdGlvbiBidWlsZFJlbGF0ZWRSZWNvcmRXaXRoSW52ZXJzZShwYXJlbnQsIHJlbGF0aW9uc2hpcE5hbWUsIGF0dHJpYnV0ZXMsIGFsbG93SGFzTWFueSkge1xuICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHBhcmVudC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgY29uc3QgcmVjb3JkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuYnVpbGQoYXR0cmlidXRlcylcbiAgY29uc3QgaW52ZXJzZU9mID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0SW52ZXJzZU9mKClcblxuICBhcHBseUJ1aWx0UmVjb3JkSW52ZXJzZVJlbGF0aW9uc2hpcCh7XG4gICAgYWxsb3dIYXNNYW55LFxuICAgIGludmVyc2VPZixcbiAgICBwYXJlbnQsXG4gICAgcmVjb3JkOiAvKiogQHR5cGUge3tnZXRSZWxhdGlvbnNoaXBCeU5hbWU6IFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkW1wiZ2V0UmVsYXRpb25zaGlwQnlOYW1lXCJdfX0gKi8gKHJlY29yZClcbiAgfSlcblxuICByZXR1cm4gcmVjb3JkXG59XG5cbmNsYXNzIFRlbmFudERhdGFiYXNlU2NvcGVFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7bW9kZWxOYW1lOiBzdHJpbmd9fSBhcmdzIC0gQ29udGV4dCBmb3IgdGhlIGZhaWxlZCB0ZW5hbnQtc2NvcGVkIG1vZGVsLlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSwge21vZGVsTmFtZX0pIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9IFwiVGVuYW50RGF0YWJhc2VTY29wZUVycm9yXCJcbiAgICB0aGlzLm1vZGVsTmFtZSA9IG1vZGVsTmFtZVxuICB9XG59XG5cbi8qKlxuICogQmFzZSBkYXRhYmFzZSByZWNvcmQuXG4gKiBAdGVtcGxhdGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW1dyaXRlQXR0cmlidXRlcz1SZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5dXG4gKi9cbmNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBvYmplY3Q+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX3RyYW5zbGF0aW9ucyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vdmFsaWRhdG9ycy9iYXNlLmpzXCIpLmRlZmF1bHRbXT4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfdmFsaWRhdG9ycyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIExpZmVjeWNsZUNhbGxiYWNrVHlwZVtdPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9saWZlY3ljbGVDYWxsYmFja3MgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB0eXBlb2YgaW1wb3J0KFwiLi92YWxpZGF0b3JzL2Jhc2UuanNcIikuZGVmYXVsdD4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfdmFsaWRhdG9yVHlwZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZWNvcmRBdHRhY2htZW50Q29uZmlndXJhdGlvbj4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfYXR0YWNobWVudHNNYXAgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0PiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9yZWxhdGlvbnNoaXBzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vcXVlcnkvcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFGbj4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfcXVlcnlEYXRhUmVnaXN0cmF0aW9ucyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHthbGxvd0Rlc3Ryb3k/OiBib29sZWFuLCBsaW1pdD86IG51bWJlciwgcmVqZWN0SWY/OiAoYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBib29sZWFufT4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9hdHRyaWJ1dGVDYXN0cyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfY29sdW1uc0FzSGFzaCA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge0FycmF5PHN0cmluZz4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfY29sdW1uTmFtZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2NvbHVtblR5cGVCeU5hbWUgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgbW9kZWxOYW1lXG5cbiAgLyoqXG4gICAqIE9wdC1pbiBjbGllbnQgc3luYyBkZWNsYXJhdGlvbiBjb25zdW1lZCBieSBgU3luY0NsaWVudC5mcm9tQ29uZmlndXJhdGlvbiguLi4pYC5cbiAgICogRGVjbGFyZSBgc3RhdGljIHN5bmMgPSB0cnVlYCAoYWxsIGRlZmF1bHRzKSBvciBhIGRlY2xhcmF0aW9uIG9iamVjdCBsaWtlXG4gICAqIGBzdGF0aWMgc3luYyA9IHt0cmFjazogW1wiY3JlYXRlXCIsIFwidXBkYXRlXCJdLCBzeW5jVHlwZTogXCJ1cHNlcnRcIn1gIHRvIGhhdmUgdGhlXG4gICAqIHN5bmMgY2xpZW50IGF1dG8tZGlzY292ZXIgdGhpcyBtb2RlbCBhbmQgZGVyaXZlIGl0cyByZXNvdXJjZSBjb25maWcgZnJvbVxuICAgKiBjb2x1bW4gbWV0YWRhdGEuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9zeW5jL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLk1vZGVsU3luY0RlY2xhcmF0aW9uIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgc3luY1xuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbCB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9pbml0aWFsaXplUmVjb3JkUHJvbWlzZVxuXG4gIC8qKiBAdHlwZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHwgdW5kZWZpbmVkfSBDYW5vbmljYWwgbW9kZWwgY2xhc3MgZXhwb3NlZCBvbmx5IGJ5IGFuIG9wZXJhdGlvbi1ib3VuZCBtZXRhZGF0YSBwcm94eS4gKi9cbiAgc3RhdGljIF9yZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3NcblxuICAvKiogQHR5cGUgeygobW9kZWxDbGFzczogdHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSA9PiB0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQpIHwgdW5kZWZpbmVkfSBCaW5kcyByZWxhdGVkIGdlbmVyYXRlZCBtb2RlbCBjbGFzc2VzIHRvIHRoZSBzYW1lIG9wZXJhdGlvbiBtZXRhZGF0YSBnZW5lcmF0aW9uLiAqL1xuICBzdGF0aWMgX3JlY29yZE1ldGFkYXRhQmluZGVyXG5cbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gT3BlcmF0aW9uIGV4cG9zZWQgb25seSBieSBhIGNvbnN0cnVjdGluZyBtZXRhZGF0YSBwcm94eS4gKi9cbiAgc3RhdGljIF9yZWNvcmRNZXRhZGF0YU9wZXJhdGlvblxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtib29sZWFuIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2VhZ2VyTG9hZFJlY29yZE1ldGFkYXRhXG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vYXVkaXRpbmcuanNcIikuQXVkaXRDYWxsYmFja1tdPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9hdWRpdENhbGxiYWNrc1xuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtib29sZWFuIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2F1ZGl0TGlmZWN5Y2xlQ2FsbGJhY2tzUmVnaXN0ZXJlZFxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBtb2RlbCBuYW1lLCBwcmVmZXJyaW5nIGFuIGV4cGxpY2l0IGBzdGF0aWMgbW9kZWxOYW1lYCBkZWNsYXJhdGlvblxuICAgKiBvdmVyIHRoZSBKYXZhU2NyaXB0IGNsYXNzIGAubmFtZWAgcHJvcGVydHkuIFRoaXMgYWxsb3dzIG1pbmlmaWVkIGJ1aWxkcyB0b1xuICAgKiBwcmVzZXJ2ZSBjb3JyZWN0IG1vZGVsIG5hbWVzIHdpdGhvdXQgcmVseWluZyBvbiBga2VlcF9jbGFzc25hbWVzYC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgbW9kZWwgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRNb2RlbE5hbWUoKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLm1vZGVsTmFtZSA9PT0gXCJzdHJpbmdcIiAmJiB0aGlzLm1vZGVsTmFtZS5sZW5ndGggPiAwKSByZXR1cm4gdGhpcy5tb2RlbE5hbWVcblxuICAgIHJldHVybiB0aGlzLm5hbWVcbiAgfVxuXG4gIHN0YXRpYyBnZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKCkge1xuICAgIGlmICghdGhpcy5fYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZSkge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICAgIHRoaXMuX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGRhdGFiYXNlIGNvbHVtbiBuYW1lIGZvciBhIHJlY29yZCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZSB0byByZXNvbHZlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE1hcHBlZCBjb2x1bW4gbmFtZSwgb3IgdGhlIHVuZGVyc2NvcmVkIGF0dHJpYnV0ZSBuYW1lIHdoZW4gbm8gbWFwcGluZyBleGlzdHMuXG4gICAqL1xuICBzdGF0aWMgZ2V0Q29sdW1uTmFtZUZvckF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSkge1xuICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IHRoaXMucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSlcblxuICAgIGlmIChyZXNvbHZlZEF0dHJpYnV0ZU5hbWUpIHJldHVybiB0aGlzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVtyZXNvbHZlZEF0dHJpYnV0ZU5hbWVdXG5cbiAgICByZXR1cm4gaW5mbGVjdGlvbi51bmRlcnNjb3JlKGluZmxlY3Rpb24uY2FtZWxpemUoZGVidXJyQ29sdW1uTmFtZShhdHRyaWJ1dGVOYW1lKSwgdHJ1ZSkpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW4gaW5jb21pbmcgYXR0cmlidXRlIG9yIGNvbHVtbiBuYW1lIHRvIHRoZSBjYW5vbmljYWwgYXR0cmlidXRlIG5hbWUgdGhpcyBtb2RlbCBleHBvc2VzLlxuICAgKiBBY2NlcHRzIHRoZSBjYW5vbmljYWwgKGRlYnVycmVkKSBhdHRyaWJ1dGUgbmFtZSwgYSByYXcgdW1sYXV0L2Fjcm9ueW0gY29sdW1uIG5hbWUsIGEgcHJlLWRlYnVyclxuICAgKiBjYW1lbGl6YXRpb24sIGFuZCBjYW1lbENhc2UgY2FzaW5nIHZhcmlhbnRzIChlLmcuIFwidkFGdW5rdGlvbklEXCIgdnMgXCJ2QUZ1bmt0aW9uaWRcIikuIFJldHVybnMgbnVsbFxuICAgKiB3aGVuIG5vdGhpbmcgbWF0Y2hlcywgc28gY2FsbGVycyBrZWVwIHRoZWlyIG93biBub3QtZm91bmQgaGFuZGxpbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQXR0cmlidXRlIG5hbWUgb3IgY29sdW1uIG5hbWUgdG8gcmVzb2x2ZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gQ2Fub25pY2FsIGF0dHJpYnV0ZSBuYW1lLCBvciBudWxsLlxuICAgKi9cbiAgc3RhdGljIHJlc29sdmVBdHRyaWJ1dGVOYW1lKG5hbWUpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwID0gdGhpcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClcblxuICAgIGlmIChuYW1lIGluIGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXApIHJldHVybiBuYW1lXG5cbiAgICBjb25zdCBub3JtYWxpemVkQXR0cmlidXRlTmFtZSA9IGluZmxlY3Rpb24uY2FtZWxpemUoZGVidXJyQ29sdW1uTmFtZShuYW1lKSwgdHJ1ZSlcblxuICAgIGlmIChub3JtYWxpemVkQXR0cmlidXRlTmFtZSBpbiBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKSByZXR1cm4gbm9ybWFsaXplZEF0dHJpYnV0ZU5hbWVcblxuICAgIGNvbnN0IGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAgPSB0aGlzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVxuXG4gICAgaWYgKG5hbWUgaW4gY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCkgcmV0dXJuIGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXBbbmFtZV1cblxuICAgIC8vIEZpbmFsIGZhbGxiYWNrOiBtYXRjaCBjYW1lbENhc2UgY2FzaW5nIHZhcmlhbnRzIGFnYWluc3QgdGhlIG1vZGVsJ3MgZ2VuZXJhdGVkIGFjY2Vzc29ycy4gVGhlc2VcbiAgICAvLyBleGlzdCBvbiB0aGUgcHJvdG90eXBlIGJlZm9yZSBydW50aW1lIGluaXRpYWxpemF0aW9uICh1bmxpa2UgdGhlIGF0dHJpYnV0ZSBtYXApLCBzbyB0aGlzIGFsc29cbiAgICAvLyByZXNvbHZlcyBuYW1lcyBsb29rZWQgdXAgZHVyaW5nIGNyZWF0ZSwgYmVmb3JlIHRoZSBtYXAgaXMgYnVpbHQuIGluZmxlY3Rpb24gbG93ZXItY2FzZXMgdHJhaWxpbmdcbiAgICAvLyBhY3JvbnltcyAoXCJJRFwiIC0+IFwiaWRcIiksIHNvIFwidkFGdW5rdGlvbklEXCIvXCJWQV9GdW5rdGlvbklEXCIgc3RpbGwgcmVzb2x2ZSB0byBcInZBRnVua3Rpb25pZFwiLlxuICAgIGNvbnN0IGxvd2VyTm9ybWFsaXplZEF0dHJpYnV0ZU5hbWUgPSBub3JtYWxpemVkQXR0cmlidXRlTmFtZS50b0xvd2VyQ2FzZSgpXG4gICAgbGV0IHByb3RvdHlwZSA9IHRoaXMucHJvdG90eXBlXG5cbiAgICB3aGlsZSAocHJvdG90eXBlICYmIHByb3RvdHlwZSAhPT0gT2JqZWN0LnByb3RvdHlwZSkge1xuICAgICAgZm9yIChjb25zdCBhY2Nlc3Nvck5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMocHJvdG90eXBlKSkge1xuICAgICAgICBpZiAoYWNjZXNzb3JOYW1lLnRvTG93ZXJDYXNlKCkgPT09IGxvd2VyTm9ybWFsaXplZEF0dHJpYnV0ZU5hbWUpIHJldHVybiBhY2Nlc3Nvck5hbWVcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHByb3RvdHlwZSlcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBtZW1iZXIgbmFtZSBvbiBhIHRhcmdldCdzIHByb3RvdHlwZSBjaGFpbiBtYXRjaGluZyBgbWVtYmVyTmFtZWAsIGZhbGxpbmcgYmFjayB0byBhXG4gICAqIGNhc2UtaW5zZW5zaXRpdmUgbWF0Y2guIFJlc29sdmVzIHNldHRlcnMgd2hlbiBhIHJlYWQtb25seSBhdHRyaWJ1dGUgYWxpYXMgZGlmZmVycyBvbmx5IGluIGNhbWVsQ2FzZVxuICAgKiBjYXNpbmcgZnJvbSB0aGUgZ2VuZXJhdGVkIGFjY2Vzc29yIChlLmcuIGEgXCJ2QUZ1bmt0aW9uSURcIiBhbGlhcyB3aG9zZSBzZXR0ZXIgaXMgXCJzZXRWQUZ1bmt0aW9uaWRcIikuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSB0YXJnZXQgLSBJbnN0YW5jZSBvciBwcm90b3R5cGUgdG8gc2VhcmNoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVtYmVyTmFtZSAtIE1lbWJlciBuYW1lIHRvIGZpbmQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIE1hdGNoaW5nIG1lbWJlciBuYW1lLCBvciBudWxsIHdoZW4gYWJzZW50LlxuICAgKi9cbiAgc3RhdGljIGZpbmRNZW1iZXJOYW1lSW5zZW5zaXRpdmUodGFyZ2V0LCBtZW1iZXJOYW1lKSB7XG4gICAgaWYgKG1lbWJlck5hbWUgaW4gdGFyZ2V0KSByZXR1cm4gbWVtYmVyTmFtZVxuXG4gICAgY29uc3QgbG93ZXJNZW1iZXJOYW1lID0gbWVtYmVyTmFtZS50b0xvd2VyQ2FzZSgpXG4gICAgbGV0IGN1cnJlbnQgPSB0YXJnZXRcblxuICAgIHdoaWxlIChjdXJyZW50ICYmIGN1cnJlbnQgIT09IE9iamVjdC5wcm90b3R5cGUpIHtcbiAgICAgIGZvciAoY29uc3QgY2FuZGlkYXRlTmFtZSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhjdXJyZW50KSkge1xuICAgICAgICBpZiAoY2FuZGlkYXRlTmFtZS50b0xvd2VyQ2FzZSgpID09PSBsb3dlck1lbWJlck5hbWUpIHJldHVybiBjYW5kaWRhdGVOYW1lXG4gICAgICB9XG5cbiAgICAgIGN1cnJlbnQgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YoY3VycmVudClcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmaW5lIHNjb3BlLlxuICAgKiBAcGFyYW0geyguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjYWxsYmFjayAtIFNjb3BlIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7KCguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPikgJiB7c2NvcGU6ICguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCIpLk1vZGVsU2NvcGVEZXNjcmlwdG9yfX0gLSBTY29wZSBoZWxwZXIuXG4gICAqL1xuICBzdGF0aWMgZGVmaW5lU2NvcGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gZGVmaW5lTW9kZWxTY29wZSh7XG4gICAgICBjYWxsYmFjayxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICBzdGFydFF1ZXJ5OiAobW9kZWxDbGFzcyA9IHRoaXMpID0+IHtcbiAgICAgICAgLy8gVGhpcyBiYWNrZW5kIHNjb3BlIGZhY3RvcnkgY2FuIG9ubHkgYmUgaW52b2tlZCB0aHJvdWdoIGEgRGF0YWJhc2VSZWNvcmQgY2xhc3MuXG4gICAgICAgIGNvbnN0IEJhY2tlbmRNb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9ICovIChtb2RlbENsYXNzKVxuXG4gICAgICAgIHJldHVybiBCYWNrZW5kTW9kZWxDbGFzcy5fbmV3UXVlcnkoKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXBwbGljYXRpb24gbW9kZWwgY2xhc3MgYmVoaW5kIGFuIG9wZXJhdGlvbi1ib3VuZCBtZXRhZGF0YSB2aWV3LlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAtIENhbm9uaWNhbCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIHN0YXRpYyBjYW5vbmljYWxSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JlY29yZE1ldGFkYXRhTW9kZWxDbGFzcyB8fCB0aGlzXG4gIH1cblxuICAvKipcbiAgICogQmluZHMgYSByZWxhdGlvbnNoaXAgdGFyZ2V0IHRvIHRoaXMgbW9kZWwgY2xhc3MncyBtZXRhZGF0YSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gbW9kZWxDbGFzcyAtIFJlbGF0aW9uc2hpcCB0YXJnZXQuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IC0gR2VuZXJhdGlvbi1ib3VuZCB0YXJnZXQsIG9yIHRoZSB1bmNoYW5nZWQgdGFyZ2V0IGZvciBsZWdhY3kgcXVlcmllcy5cbiAgICovXG4gIHN0YXRpYyBiaW5kUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICByZXR1cm4gdGhpcy5fcmVjb3JkTWV0YWRhdGFCaW5kZXIgPyB0aGlzLl9yZWNvcmRNZXRhZGF0YUJpbmRlcihtb2RlbENsYXNzKSA6IG1vZGVsQ2xhc3NcbiAgfVxuXG4gIHN0YXRpYyBnZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKCkge1xuICAgIGlmICghdGhpcy5fY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSkge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICAgIHRoaXMuX2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9jb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lXG4gIH1cblxuICBzdGF0aWMgZ2V0VHJhbnNsYXRpb25zTWFwKCkge1xuICAgIGlmICghdGhpcy5fdHJhbnNsYXRpb25zKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBvYmplY3Q+fSAqL1xuICAgICAgdGhpcy5fdHJhbnNsYXRpb25zID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fdHJhbnNsYXRpb25zXG4gIH1cblxuICBzdGF0aWMgZ2V0VmFsaWRhdG9yc01hcCgpIHtcbiAgICBpZiAoIXRoaXMuX3ZhbGlkYXRvcnMpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vdmFsaWRhdG9ycy9iYXNlLmpzXCIpLmRlZmF1bHRbXT59ICovXG4gICAgICB0aGlzLl92YWxpZGF0b3JzID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdG9yc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxpZmVjeWNsZSBjYWxsYmFja3MgbWFwLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgTGlmZWN5Y2xlQ2FsbGJhY2tUeXBlW10+fSAtIExpZmVjeWNsZSBjYWxsYmFja3Mga2V5ZWQgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRMaWZlY3ljbGVDYWxsYmFja3NNYXAoKSB7XG4gICAgaWYgKCF0aGlzLl9saWZlY3ljbGVDYWxsYmFja3MpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIExpZmVjeWNsZUNhbGxiYWNrVHlwZVtdPn0gKi9cbiAgICAgIHRoaXMuX2xpZmVjeWNsZUNhbGxiYWNrcyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2xpZmVjeWNsZUNhbGxiYWNrc1xuICB9XG5cbiAgc3RhdGljIGdldFZhbGlkYXRvclR5cGVzTWFwKCkge1xuICAgIGlmICghdGhpcy5fdmFsaWRhdG9yVHlwZXMpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuL3ZhbGlkYXRvcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICAgIHRoaXMuX3ZhbGlkYXRvclR5cGVzID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdG9yVHlwZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50cyBtYXAuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZWNvcmRBdHRhY2htZW50Q29uZmlndXJhdGlvbj59IC0gQXR0YWNobWVudCBkZWZpbml0aW9ucyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dGFjaG1lbnRzTWFwKCkge1xuICAgIGlmICghdGhpcy5fYXR0YWNobWVudHNNYXApIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJlY29yZEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPn0gKi9cbiAgICAgIHRoaXMuX2F0dGFjaG1lbnRzTWFwID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0YWNobWVudHNNYXBcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRyaWJ1dGVzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBfYXR0cmlidXRlcyA9IHt9XG5cbiAgLyoqXG4gICAqIENoYW5nZXMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIF9jaGFuZ2VzID0ge31cblxuICAvKipcbiAgICogV2hldGhlciBwcmltYXJ5LWtleSByZWFkcyBhcmUgcGlubmVkIHRvIHRoZSBzdG9yZWQgYXR0cmlidXRlcy5cbiAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gIF9yZWFkc1BlcnNpc3RlZFByaW1hcnlLZXkgPSBmYWxzZVxuXG4gIC8qKlxuICAgKiBDaGFuZ2VzIGNhcHR1cmVkIGJlZm9yZSBhIGNyZWF0ZSBhdWRpdCBpcyB3cml0dGVuLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9hdWRpdGluZy5qc1wiKS5BdWRpdENoYW5nZXMgfCB1bmRlZmluZWR9ICovXG4gIF9wZW5kaW5nQ3JlYXRlQXVkaXRDaGFuZ2VzID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIENoYW5nZXMgY2FwdHVyZWQgYmVmb3JlIGFuIHVwZGF0ZSBhdWRpdCBpcyB3cml0dGVuLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9hdWRpdGluZy5qc1wiKS5BdWRpdENoYW5nZXMgfCB1bmRlZmluZWR9ICovXG4gIF9wZW5kaW5nVXBkYXRlQXVkaXRDaGFuZ2VzID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIEF0dHJpYnV0ZSBuYW1lcyBleHBsaWNpdGx5IGFzc2lnbmVkIGluIHRoZSBjdXJyZW50IHVwZGF0ZSBjYWxsLlxuICAgKiBAdHlwZSB7U2V0PHN0cmluZz4gfCB1bmRlZmluZWR9XG4gICAqL1xuICBfYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBDb2x1bW5zIGFzIGhhc2guXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICBfY29sdW1uc0FzSGFzaCA9IHt9XG5cbiAgLyoqXG4gICAqIENvbm5lY3Rpb24uXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgX19jb25uZWN0aW9uID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIEV4cGxpY2l0IG9wZXJhdGlvbiBvd25pbmcgdGhpcyByZWNvcmQncyBkYXRhYmFzZSB3b3JrLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gIF9kYXRhYmFzZU9wZXJhdGlvbiA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBJbnN0YW5jZSByZWxhdGlvbnNoaXBzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gIF9pbnN0YW5jZVJlbGF0aW9uc2hpcHMgPSB7fVxuICAvKipcbiAgICogQXR0YWNobWVudHMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZWNvcmRBdHRhY2htZW50SGFuZGxlPn0gKi9cbiAgX2F0dGFjaG1lbnRzID0ge31cblxuICAvKipcbiAgICogTG9hZCBjb2hvcnQuXG4gICAqIEB0eXBlIHtBcnJheTxWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD4gfCB1bmRlZmluZWR9IC0gU2hhcmVkIHJlZmVyZW5jZSB0byBzaWJsaW5nIHJlY29yZHMgbG9hZGVkIGluIHRoZSBzYW1lIGJhdGNoLiBVc2VkIGJ5IGF1dG8tcHJlbG9hZC5cbiAgICovXG4gIF9sb2FkQ29ob3J0ID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFRhYmxlIG5hbWUuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIF9fdGFibGVOYW1lID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFZhbGlkYXRpb24gZXJyb3JzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgVmFsaWRhdGlvbkVycm9yT2JqZWN0VHlwZVtdPn0gKi9cbiAgX3ZhbGlkYXRpb25FcnJvcnMgPSB7fVxuXG4gIHN0YXRpYyB2YWxpZGF0b3JUeXBlcygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRWYWxpZGF0b3JUeXBlc01hcCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlciB2YWxpZGF0b3IgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL3ZhbGlkYXRvcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSB2YWxpZGF0b3JDbGFzcyAtIFZhbGlkYXRvciBjbGFzcy5cbiAgICovXG4gIHN0YXRpYyByZWdpc3RlclZhbGlkYXRvclR5cGUobmFtZSwgdmFsaWRhdG9yQ2xhc3MpIHtcbiAgICB0aGlzLnZhbGlkYXRvclR5cGVzKClbbmFtZV0gPSB2YWxpZGF0b3JDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIgbGlmZWN5Y2xlIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge1wiYWZ0ZXJDcmVhdGVcIiB8IFwiYWZ0ZXJEZXN0cm95XCIgfCBcImFmdGVyU2F2ZVwiIHwgXCJhZnRlclVwZGF0ZVwiIHwgXCJiZWZvcmVDcmVhdGVcIiB8IFwiYmVmb3JlRGVzdHJveVwiIHwgXCJiZWZvcmVTYXZlXCIgfCBcImJlZm9yZVVwZGF0ZVwiIHwgXCJiZWZvcmVWYWxpZGF0aW9uXCJ9IGNhbGxiYWNrTmFtZSAtIENhbGxiYWNrIHR5cGUuXG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyByZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrKGNhbGxiYWNrTmFtZSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBjYWxsYmFja3MgPSB0aGlzLmdldExpZmVjeWNsZUNhbGxiYWNrc01hcCgpXG5cbiAgICBpZiAoIWNhbGxiYWNrc1tjYWxsYmFja05hbWVdKSB7XG4gICAgICBjYWxsYmFja3NbY2FsbGJhY2tOYW1lXSA9IFtdXG4gICAgfVxuXG4gICAgY2FsbGJhY2tzW2NhbGxiYWNrTmFtZV0ucHVzaChjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVucmVnaXN0ZXIgbGlmZWN5Y2xlIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge1wiYWZ0ZXJDcmVhdGVcIiB8IFwiYWZ0ZXJEZXN0cm95XCIgfCBcImFmdGVyU2F2ZVwiIHwgXCJhZnRlclVwZGF0ZVwiIHwgXCJiZWZvcmVDcmVhdGVcIiB8IFwiYmVmb3JlRGVzdHJveVwiIHwgXCJiZWZvcmVTYXZlXCIgfCBcImJlZm9yZVVwZGF0ZVwiIHwgXCJiZWZvcmVWYWxpZGF0aW9uXCJ9IGNhbGxiYWNrTmFtZSAtIENhbGxiYWNrIHR5cGUuXG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSBjYWxsYmFjayAtIFByZXZpb3VzbHkgcmVnaXN0ZXJlZCBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgdW5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrKGNhbGxiYWNrTmFtZSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBjYWxsYmFja3MgPSB0aGlzLmdldExpZmVjeWNsZUNhbGxiYWNrc01hcCgpW2NhbGxiYWNrTmFtZV1cblxuICAgIGlmICghY2FsbGJhY2tzKSByZXR1cm5cblxuICAgIGNvbnN0IGNhbGxiYWNrSW5kZXggPSBjYWxsYmFja3MuaW5kZXhPZihjYWxsYmFjaylcblxuICAgIGlmIChjYWxsYmFja0luZGV4ID49IDApIGNhbGxiYWNrcy5zcGxpY2UoY2FsbGJhY2tJbmRleCwgMSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSB2YWxpZGF0aW9uLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGJlZm9yZVZhbGlkYXRpb24oY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJiZWZvcmVWYWxpZGF0aW9uXCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIHNhdmUuXG4gICAqIEB0ZW1wbGF0ZSBSXG4gICAqIEB0aGlzIHtNb2RlbENvbnN0cnVjdG9yPFI+fVxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZTxSPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYmVmb3JlU2F2ZShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImJlZm9yZVNhdmVcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgY3JlYXRlLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGJlZm9yZUNyZWF0ZShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImJlZm9yZUNyZWF0ZVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSB1cGRhdGUuXG4gICAqIEB0ZW1wbGF0ZSBSXG4gICAqIEB0aGlzIHtNb2RlbENvbnN0cnVjdG9yPFI+fVxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZTxSPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYmVmb3JlVXBkYXRlKGNhbGxiYWNrKSB7XG4gICAgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjay5jYWxsKHRoaXMsIFwiYmVmb3JlVXBkYXRlXCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGRlc3Ryb3kuXG4gICAqIEB0ZW1wbGF0ZSBSXG4gICAqIEB0aGlzIHtNb2RlbENvbnN0cnVjdG9yPFI+fVxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZTxSPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYmVmb3JlRGVzdHJveShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImJlZm9yZURlc3Ryb3lcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBzYXZlLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFmdGVyU2F2ZShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImFmdGVyU2F2ZVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGNyZWF0ZS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhZnRlckNyZWF0ZShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImFmdGVyQ3JlYXRlXCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgdXBkYXRlLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFmdGVyVXBkYXRlKGNhbGxiYWNrKSB7XG4gICAgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjay5jYWxsKHRoaXMsIFwiYWZ0ZXJVcGRhdGVcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBkZXN0cm95LlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFmdGVyRGVzdHJveShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImFmdGVyRGVzdHJveVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbmFibGVzIGF1dG9tYXRpYyBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3kgYXVkaXRpbmcgZm9yIHRoaXMgbW9kZWwuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGF1ZGl0ZWQoKSB7XG4gICAgcmVnaXN0ZXJBdWRpdGluZyh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIERlY2xhcmVzIGFuIGFhc20tc3R5bGUgc3RhdGUgbWFjaGluZSBvbiB0aGlzIG1vZGVsOiBuYW1lZCBzdGF0ZXMsIGV2ZW50c1xuICAgKiAoZ3VhcmRlZCB0cmFuc2l0aW9ucyksIGFuZCBlbnRlci9leGl0ICsgYmVmb3JlL2FmdGVyIHRyYW5zaXRpb24gaG9va3MuIFNlZVxuICAgKiBgc3RhdGUtbWFjaGluZS5qc2AuIEdlbmVyYXRlcyBgZXZlbnQoKWAgLyBgZXZlbnRBbmRTYXZlKClgIC8gYGNhbkV2ZW50KClgXG4gICAqIHRyYW5zaXRpb24gbWV0aG9kcyBwZXIgZGVjbGFyZWQgZXZlbnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zdGF0ZS1tYWNoaW5lLmpzXCIpLlN0YXRlTWFjaGluZURlZmluaXRpb259IGRlZmluaXRpb24gLSBTdGF0ZSBtYWNoaW5lIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHN0YXRlTWFjaGluZShkZWZpbml0aW9uKSB7XG4gICAgc3RhdGVNYWNoaW5lKHRoaXMsIGRlZmluaXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGlzIG1vZGVsJ3Mgc3RhdGUgbWFjaGluZSBkZWZpbml0aW9uLCBvciBudWxsIHdoZW4gaXQgZGVjbGFyZXMgbm9uZS5cbiAgICogYE1vZGVsLnN0YXRlTWFjaGluZSguLi4pYCBvdmVycmlkZXMgdGhpcyBvbiBjbGFzc2VzIHRoYXQgZGVjbGFyZSBhIG1hY2hpbmUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N0YXRlLW1hY2hpbmUuanNcIikuU3RhdGVNYWNoaW5lRGVmaW5pdGlvbiB8IG51bGx9IC0gVGhlIHN0YXRlIG1hY2hpbmUgZGVmaW5pdGlvbiwgb3IgbnVsbCB3aGVuIG5vbmUgaXMgZGVjbGFyZWQuXG4gICAqL1xuICBzdGF0aWMgZ2V0U3RhdGVNYWNoaW5lRGVmaW5pdGlvbigpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhpcyBtb2RlbCdzIHN0YXRlIGNvbHVtbiwgb3IgbnVsbCB3aGVuIGl0IGRlY2xhcmVzIG5vIHN0YXRlIG1hY2hpbmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFRoZSBzdGF0ZSBjb2x1bW4gbmFtZSwgb3IgbnVsbCB3aGVuIG5vIHN0YXRlIG1hY2hpbmUgaXMgZGVjbGFyZWQuXG4gICAqL1xuICBzdGF0aWMgZ2V0U3RhdGVNYWNoaW5lQ29sdW1uKCkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGlzIG1vZGVsJ3MgZGVjbGFyZWQgc3RhdGUgbmFtZXMgKGVtcHR5IHdoZW4gaXQgaGFzIG5vIHN0YXRlIG1hY2hpbmUpLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gVGhlIGRlY2xhcmVkIHN0YXRlIG5hbWVzLCBvciBhbiBlbXB0eSBhcnJheSB3aGVuIG5vIHN0YXRlIG1hY2hpbmUgaXMgZGVjbGFyZWQuXG4gICAqL1xuICBzdGF0aWMgZ2V0U3RhdGVNYWNoaW5lU3RhdGVOYW1lcygpIHtcbiAgICByZXR1cm4gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBNYWludGFpbnMgYSBjb3VudGVyIGNvbHVtbiBvbiBhIGBiZWxvbmdzVG9gIHBhcmVudCBhcyB0aGUgc3VtIG9mIGEgcGVyLXJlY29yZFxuICAgKiBtYWduaXR1ZGUsIGtlcHQgY3VycmVudCBieSBhdG9taWMgaW5jcmVtZW50cyBkaWZmZWQgb24gZXZlcnkgY3JlYXRlL3VwZGF0ZS9cbiAgICogZGVzdHJveSAoYW5kIG1vdmVkIGJldHdlZW4gcGFyZW50cyB3aGVuIHRoZSBmb3JlaWduIGtleSBjaGFuZ2VzKS4gU2VlXG4gICAqIGBjb3VudGVyLWNhY2hlLW1hZ25pdHVkZS5qc2AuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb3VudGVyLWNhY2hlLW1hZ25pdHVkZS5qc1wiKS5NYWduaXR1ZGVDb3VudGVyQ2FjaGVEZWZpbml0aW9ufSBkZWZpbml0aW9uIC0gQ291bnRlciBjYWNoZSBkZWZpbml0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBtYWduaXR1ZGVDb3VudGVyQ2FjaGUoZGVmaW5pdGlvbikge1xuICAgIHJlZ2lzdGVyTWFnbml0dWRlQ291bnRlckNhY2hlKHRoaXMsIGRlZmluaXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgY2FsbGJhY2sgaW52b2tlZCBhZnRlciB0aGlzIG1vZGVsIHdyaXRlcyBhbiBhdWRpdCByb3cgZm9yIHRoZSBhY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24gbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2F1ZGl0aW5nLmpzXCIpLkF1ZGl0Q2FsbGJhY2t9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuIGFmdGVyIGF1ZGl0IGNyZWF0aW9uLlxuICAgKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gVW5zdWJzY3JpYmUgZnVuY3Rpb24uXG4gICAqL1xuICBzdGF0aWMgb25BdWRpdChhY3Rpb24sIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHJlZ2lzdGVyQXVkaXRDYWxsYmFjayh0aGlzLCBhY3Rpb24sIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgcmVjb3JkcyB0aGF0IGRvIG5vdCBoYXZlIGFuIGF1ZGl0IHJvdyBmb3IgdGhlIGdpdmVuIGFjdGlvbi5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEF1ZGl0IGFjdGlvbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gUXVlcnkgc2NvcGVkIHRvIHJlY29yZHMgd2l0aG91dCB0aGF0IGF1ZGl0IGFjdGlvbi5cbiAgICovXG4gIHN0YXRpYyB3aXRob3V0QXVkaXQoYWN0aW9uKSB7XG4gICAgcmV0dXJuIHdpdGhvdXRBdWRpdCh0aGlzLCBhY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdmFsaWRhdG9yIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2YWxpZGF0b3JOYW1lIC0gVmFsaWRhdG9yIG5hbWUuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi92YWxpZGF0b3JzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgdmFsaWRhdG9yIHR5cGUuXG4gICAqL1xuICBzdGF0aWMgZ2V0VmFsaWRhdG9yVHlwZSh2YWxpZGF0b3JOYW1lKSB7XG4gICAgaWYgKCEodmFsaWRhdG9yTmFtZSBpbiB0aGlzLnZhbGlkYXRvclR5cGVzKCkpKSB0aHJvdyBuZXcgRXJyb3IoYFZhbGlkYXRvciB0eXBlICR7dmFsaWRhdG9yTmFtZX0gbm90IGZvdW5kYClcblxuICAgIHJldHVybiB0aGlzLnZhbGlkYXRvclR5cGVzKClbdmFsaWRhdG9yTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBleGlzdHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcmVsYXRpb25zaGlwIGV4aXN0cy5cbiAgICovXG4gIHN0YXRpYyBfcmVsYXRpb25zaGlwRXhpc3RzKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBpZiAocmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLmdldFJlbGF0aW9uc2hpcHNNYXAoKSkge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrIHR5cGUuXG4gICAqIEB0eXBlZGVmIHsocXVlcnk6IGltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPikgPT4gKGltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPiB8IHZvaWQpfSBSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrXG4gICAqL1xuICAvKipcbiAgICogUmVsYXRpb25zaGlwRGF0YUFyZ3VtZW50VHlwZSB0eXBlLlxuICAgKiBAdHlwZWRlZiB7b2JqZWN0fSBSZWxhdGlvbnNoaXBEYXRhQXJndW1lbnRUeXBlXG4gICAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2F1dG9sb2FkXSAtIERpc2FibGUgYXV0by1iYXRjaC1wcmVsb2FkIGZvciB0aGlzIHJlbGF0aW9uc2hpcCBieSBwYXNzaW5nIGZhbHNlLiBEZWZhdWx0IHRydWUuXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY2xhc3NOYW1lXSAtIE1vZGVsIGNsYXNzIG5hbWUgZm9yIHRoZSByZWxhdGVkIHJlY29yZC5cbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IFtkZXBlbmRlbnRdIC0gRGVwZW5kZW50IGFjdGlvbiB3aGVuIHBhcmVudCBpcyBkZXN0cm95ZWQgKGUuZy4gXCJkZXN0cm95XCIpLlxuICAgKiBAcHJvcGVydHkge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gW2tsYXNzXSAtIE1vZGVsIGNsYXNzIGZvciB0aGUgcmVsYXRlZCByZWNvcmQuXG4gICAqIEBwcm9wZXJ0eSB7UmVsYXRpb25zaGlwU2NvcGVDYWxsYmFja30gW3Njb3BlXSAtIE9wdGlvbmFsIHNjb3BlIGNhbGxiYWNrIGZvciB0aGUgcmVsYXRpb25zaGlwLlxuICAgKiBAcHJvcGVydHkge3N0cmluZ30gW3R5cGVdIC0gUmVsYXRpb25zaGlwIHR5cGUgKGUuZy4gXCJoYXNNYW55XCIsIFwiYmVsb25nc1RvXCIpLlxuICAgKi9cbiAgLyoqXG4gICAqIFJ1bnMgZGVmaW5lIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtSZWxhdGlvbnNoaXBEYXRhQXJndW1lbnRUeXBlfSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKi9cbiAgc3RhdGljIF9kZWZpbmVSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSwgZGF0YSkge1xuICAgIGlmICghcmVsYXRpb25zaGlwTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHJlbGF0aW9uc2hpcCBuYW1lIGdpdmVuOiAke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICBpZiAodGhpcy5fcmVsYXRpb25zaGlwRXhpc3RzKHJlbGF0aW9uc2hpcE5hbWUpKSB0aHJvdyBuZXcgRXJyb3IoYFJlbGF0aW9uc2hpcCAke3JlbGF0aW9uc2hpcE5hbWV9IGFscmVhZHkgZXhpc3RzYClcblxuICAgIGNvbnN0IGFjdHVhbERhdGEgPSBPYmplY3QuYXNzaWduKFxuICAgICAge1xuICAgICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICB0eXBlOiBcImhhc01hbnlcIlxuICAgICAgfSxcbiAgICAgIGRhdGFcbiAgICApXG5cbiAgICBpZiAoIWFjdHVhbERhdGEuY2xhc3NOYW1lICYmICFhY3R1YWxEYXRhLmtsYXNzKSB7XG4gICAgICBhY3R1YWxEYXRhLmNsYXNzTmFtZSA9IHNpbmd1bGFyaXplTW9kZWxOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgfVxuXG4gICAgbGV0IHJlbGF0aW9uc2hpcFxuICAgIGNvbnN0IHByb3RvdHlwZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMucHJvdG90eXBlKSlcblxuICAgIGlmIChhY3R1YWxEYXRhLnR5cGUgPT0gXCJiZWxvbmdzVG9cIikge1xuICAgICAgcmVsYXRpb25zaGlwID0gbmV3IEJlbG9uZ3NUb1JlbGF0aW9uc2hpcChhY3R1YWxEYXRhKVxuXG4gICAgICBwcm90b3R5cGVbcmVsYXRpb25zaGlwTmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgICAgICByZXR1cm4gcmVsYXRpb25zaGlwLmxvYWRlZCgpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgYnVpbGQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9YF0gPSBmdW5jdGlvbigvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gYXR0cmlidXRlcykge1xuICAgICAgICByZXR1cm4gYnVpbGRSZWxhdGVkUmVjb3JkV2l0aEludmVyc2UoLyoqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gKi8gKHRoaXMpLCByZWxhdGlvbnNoaXBOYW1lLCBhdHRyaWJ1dGVzLCB0cnVlKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYGxvYWQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9YF0gPSBhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYCR7cmVsYXRpb25zaGlwTmFtZX1PckxvYWRgXSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZWxhdGlvbnNoaXBPckxvYWQocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2BzZXQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9YF0gPSBmdW5jdGlvbigvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHwgbnVsbCB8IHVuZGVmaW5lZH0gKi8gbW9kZWwpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgICAgY29uc3QgZm9yZWlnbktleVZhbHVlID0gdGhpcy5fYmVsb25nc1RvRm9yZWlnbktleVZhbHVlKHttb2RlbCwgcmVsYXRpb25zaGlwfSlcblxuICAgICAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKG1vZGVsIHx8IHVuZGVmaW5lZClcbiAgICAgICAgcmVsYXRpb25zaGlwLnNldFByZWxvYWRlZCh0cnVlKVxuICAgICAgICByZWxhdGlvbnNoaXAuc2V0RGlydHkodHJ1ZSlcbiAgICAgICAgdGhpcy5fc2V0Q29sdW1uQXR0cmlidXRlKHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KCksIGZvcmVpZ25LZXlWYWx1ZSlcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGFjdHVhbERhdGEudHlwZSA9PSBcImhhc01hbnlcIikge1xuICAgICAgcmVsYXRpb25zaGlwID0gbmV3IEhhc01hbnlSZWxhdGlvbnNoaXAoYWN0dWFsRGF0YSlcblxuICAgICAgcHJvdG90eXBlW3JlbGF0aW9uc2hpcE5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9oYXMtbWFueS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKSlcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2Ake3JlbGF0aW9uc2hpcE5hbWV9TG9hZGVkYF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpLmxvYWRlZCgpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgbG9hZCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXBOYW1lKX1gXSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgJHtyZWxhdGlvbnNoaXBOYW1lfU9yTG9hZGBdID0gYXN5bmMgZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJlbGF0aW9uc2hpcE9yTG9hZChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYWN0dWFsRGF0YS50eXBlID09IFwiaGFzT25lXCIpIHtcbiAgICAgIHJlbGF0aW9uc2hpcCA9IG5ldyBIYXNPbmVSZWxhdGlvbnNoaXAoYWN0dWFsRGF0YSlcblxuICAgICAgcHJvdG90eXBlW3JlbGF0aW9uc2hpcE5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKS5sb2FkZWQoKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYGJ1aWxkJHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcE5hbWUpfWBdID0gZnVuY3Rpb24oLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgcmV0dXJuIGJ1aWxkUmVsYXRlZFJlY29yZFdpdGhJbnZlcnNlKC8qKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9ICovICh0aGlzKSwgcmVsYXRpb25zaGlwTmFtZSwgYXR0cmlidXRlcywgZmFsc2UpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgbG9hZCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXBOYW1lKX1gXSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgJHtyZWxhdGlvbnNoaXBOYW1lfU9yTG9hZGBdID0gYXN5bmMgZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJlbGF0aW9uc2hpcE9yTG9hZChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVsYXRpb25zaGlwIHR5cGU6ICR7YWN0dWFsRGF0YS50eXBlfWApXG4gICAgfVxuXG4gICAgdGhpcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClbcmVsYXRpb25zaGlwTmFtZV0gPSByZWxhdGlvbnNoaXBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSByZWxhdGlvbnNoaXAgYXJncy5cbiAgICogQHBhcmFtIHtSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrIHwgb2JqZWN0IHwgdW5kZWZpbmVkfSBzY29wZU9yT3B0aW9ucyAtIFNjb3BlIGNhbGxiYWNrIG9yIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0IHwgdW5kZWZpbmVkfSBvcHRpb25zIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge3tzY29wZTogKFJlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2sgfCB1bmRlZmluZWQpLCByZWxhdGlvbnNoaXBPcHRpb25zOiBvYmplY3R9fSAtIE5vcm1hbGl6ZWQgYXJndW1lbnRzLlxuICAgKi9cbiAgc3RhdGljIF9ub3JtYWxpemVSZWxhdGlvbnNoaXBBcmdzKHNjb3BlT3JPcHRpb25zLCBvcHRpb25zKSB7XG4gICAgaWYgKHR5cGVvZiBzY29wZU9yT3B0aW9ucyA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHNjb3BlOiAvKiogQHR5cGUge1JlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2t9ICovIChzY29wZU9yT3B0aW9ucyksXG4gICAgICAgIHJlbGF0aW9uc2hpcE9wdGlvbnM6IG9wdGlvbnMgfHwge31cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgc2NvcGU6IHVuZGVmaW5lZCxcbiAgICAgIHJlbGF0aW9uc2hpcE9wdGlvbnM6IHNjb3BlT3JPcHRpb25zIHx8IHt9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhZnRlckNyZWF0ZSwgYWZ0ZXJTYXZlLCBhbmQgYWZ0ZXJEZXN0cm95IGNhbGxiYWNrcyB0byBzeW5jXG4gICAqIGEgY291bnRlciBjYWNoZSBjb2x1bW4gb24gdGhlIHBhcmVudCBtb2RlbC4gVGhlIGNvbHVtbiBuYW1lIGZvbGxvd3NcbiAgICogdGhlIGNvbnZlbnRpb24gYDxjaGlsZE1vZGVsUGx1cmFsQ2FtZWxDYXNlPkNvdW50YC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBUaGUgYmVsb25nc1RvIHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIF9yZWdpc3RlckNvdW50ZXJDYWNoZUNhbGxiYWNrcyhyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgQ2hpbGRNb2RlbCA9IHRoaXNcblxuICAgIC8qKlxuICAgICAqIEF0b21pY2FsbHkgcmVjb21wdXRlcyB0aGUgY291bnRlciBjYWNoZSBjb2x1bW4gb24gdGhlIHBhcmVudCB2aWEgYVxuICAgICAqIHNpbmdsZSBVUERBVEUgLi4uIFNFVCBjb2wgPSAoU0VMRUNUIENPVU5UKCopKSBzbyBjb25jdXJyZW50XG4gICAgICogY3JlYXRlcy9kZXN0cm95cyBjYW5ub3QgcmFjZSBpbnRvIGEgc3RhbGUgY291bnQuXG4gICAgICogQHBhcmFtIHtudW1iZXIgfCBzdHJpbmcgfCBudWxsfSBwYXJlbnRJZCAtIFBhcmVudCBwcmltYXJ5LWtleSB2YWx1ZS5cbiAgICAgKiBAcGFyYW0ge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSByZWNvcmQgLSBDaGlsZCByZWNvcmQgb3duaW5nIHRoZSBjb25uZWN0aW9uLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNvdW50ZXIgY2FjaGUgaGFzIGJlZW4gc3luY2VkLlxuICAgICAqL1xuICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNDb3VudGVyKHBhcmVudElkLCByZWNvcmQpIHtcbiAgICAgIGlmICghcGFyZW50SWQpIHJldHVyblxuXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBDaGlsZE1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgUGFyZW50TW9kZWwgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgIGlmICghUGFyZW50TW9kZWwpIHJldHVyblxuXG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gcmVsYXRpb25zaGlwLmdldFByaW1hcnlLZXkoKVxuICAgICAgY29uc3QgZmsgPSByZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG4gICAgICBjb25zdCBjaGlsZE1vZGVsTmFtZSA9IENoaWxkTW9kZWwuZ2V0TW9kZWxOYW1lKClcbiAgICAgIGNvbnN0IGNvdW50ZXJDb2x1bW4gPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUoYCR7aW5mbGVjdGlvbi5wbHVyYWxpemUoY2hpbGRNb2RlbE5hbWUpfUNvdW50YClcbiAgICAgIGNvbnN0IHBhcmVudFRhYmxlID0gUGFyZW50TW9kZWwudGFibGVOYW1lKClcbiAgICAgIGNvbnN0IGNoaWxkVGFibGUgPSBDaGlsZE1vZGVsLnRhYmxlTmFtZSgpXG4gICAgICBjb25zdCBwa0NvbHVtbiA9IGluZmxlY3Rpb24udW5kZXJzY29yZShwcmltYXJ5S2V5KVxuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHJlY29yZFxuICAgICAgICAucXVlcnlGb3JNb2RlbChQYXJlbnRNb2RlbClcbiAgICAgICAgLmRyaXZlclxuICAgICAgY29uc3QgcXVvdGVkID0gY29ubmVjdGlvbi5xdW90ZShwYXJlbnRJZClcblxuICAgICAgY29uc3Qgc3FsID0gYFVQREFURSAke2Nvbm5lY3Rpb24ucXVvdGVUYWJsZShwYXJlbnRUYWJsZSl9IFNFVCAke2Nvbm5lY3Rpb24ucXVvdGVDb2x1bW4oY291bnRlckNvbHVtbil9ID0gKFNFTEVDVCBDT1VOVCgqKSBGUk9NICR7Y29ubmVjdGlvbi5xdW90ZVRhYmxlKGNoaWxkVGFibGUpfSBXSEVSRSAke2Nvbm5lY3Rpb24ucXVvdGVDb2x1bW4oZmspfSA9ICR7cXVvdGVkfSkgV0hFUkUgJHtjb25uZWN0aW9uLnF1b3RlQ29sdW1uKHBrQ29sdW1uKX0gPSAke3F1b3RlZH1gXG5cbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucXVlcnkoc3FsLCB7bG9nTmFtZTogYCR7UGFyZW50TW9kZWwubmFtZX0gVXBkYXRlYH0pXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUnVucyByZWFkIGZrIGF0dHJpYnV0ZS5cbiAgICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBDaGlsZCByZWNvcmQgaW5zdGFuY2UuXG4gICAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEN1cnJlbnQgZm9yZWlnbi1rZXkgYXR0cmlidXRlIHZhbHVlLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uIHJlYWRGa0F0dHJpYnV0ZShyZWNvcmQpIHtcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IENoaWxkTW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCBma0F0dHJpYnV0ZSA9IGluZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKS5yZXBsYWNlKC9faWQkLywgXCJJZFwiKSwgdHJ1ZSlcblxuICAgICAgcmV0dXJuIHJlY29yZC5yZWFkQXR0cmlidXRlKGZrQXR0cmlidXRlKVxuICAgIH1cblxuICAgIENoaWxkTW9kZWwuYWZ0ZXJDcmVhdGUoYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgYXdhaXQgc3luY0NvdW50ZXIocmVhZEZrQXR0cmlidXRlKHJlY29yZCksIHJlY29yZClcbiAgICB9KVxuXG4gICAgQ2hpbGRNb2RlbC5hZnRlckRlc3Ryb3koYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgYXdhaXQgc3luY0NvdW50ZXIocmVhZEZrQXR0cmlidXRlKHJlY29yZCksIHJlY29yZClcbiAgICB9KVxuXG4gICAgQ2hpbGRNb2RlbC5iZWZvcmVTYXZlKGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgIGNvbnN0IG1vZGVsID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlY29yZClcblxuICAgICAgaWYgKG1vZGVsLmlzTmV3UmVjb3JkKCkpIHJldHVyblxuXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBDaGlsZE1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgZmtDb2x1bW4gPSByZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG5cbiAgICAgIC8vIERldGVjdCBGSyBjaGFuZ2UgdmlhIGRpcmVjdCBhdHRyaWJ1dGUgYXNzaWdubWVudCBvciByZWxhdGlvbnNoaXAgc2V0dGVyLlxuICAgICAgY29uc3QgZGlyZWN0Q2hhbmdlID0gZmtDb2x1bW4gaW4gbW9kZWwuX2NoYW5nZXNcbiAgICAgIGNvbnN0IGJlbG9uZ3NUb0NoYW5nZSA9IG1vZGVsLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHM/LltyZWxhdGlvbnNoaXBOYW1lXT8uZ2V0RGlydHk/LigpXG5cbiAgICAgIGlmIChkaXJlY3RDaGFuZ2UgfHwgYmVsb25nc1RvQ2hhbmdlKSB7XG4gICAgICAgIG1vZGVsW2BfY291bnRlckNhY2hlUHJldl8ke3JlbGF0aW9uc2hpcE5hbWV9YF0gPSBtb2RlbC5fYXR0cmlidXRlc1tma0NvbHVtbl1cbiAgICAgIH1cbiAgICB9KVxuXG4gICAgQ2hpbGRNb2RlbC5hZnRlclNhdmUoYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgY29uc3QgbW9kZWwgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocmVjb3JkKVxuICAgICAgY29uc3QgcHJldktleSA9IGBfY291bnRlckNhY2hlUHJldl8ke3JlbGF0aW9uc2hpcE5hbWV9YFxuICAgICAgY29uc3QgcHJldmlvdXNQYXJlbnRJZCA9IG1vZGVsW3ByZXZLZXldXG5cbiAgICAgIGlmIChwcmV2aW91c1BhcmVudElkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgZGVsZXRlIG1vZGVsW3ByZXZLZXldXG4gICAgICAgIGF3YWl0IHN5bmNDb3VudGVyKHByZXZpb3VzUGFyZW50SWQsIHJlY29yZClcbiAgICAgICAgYXdhaXQgc3luY0NvdW50ZXIocmVhZEZrQXR0cmlidXRlKG1vZGVsKSwgcmVjb3JkKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSByZWxhdGlvbnNoaXAgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwc01hcCgpW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcCkgdGhyb3cgbmV3IEVycm9yKGBObyByZWxhdGlvbnNoaXAgaW4gJHt0aGlzLm5hbWV9IGNhbGxlZCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBpbiBsaXN0OiAke09iamVjdC5rZXlzKHRoaXMuZ2V0UmVsYXRpb25zaGlwc01hcCgpKS5qb2luKFwiLCBcIil9YClcblxuICAgIHJldHVybiByZWxhdGlvbnNoaXBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWxhdGlvbnNoaXBzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8aW1wb3J0KFwiLi9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gVGhlIHJlbGF0aW9uc2hpcHMuXG4gICAqL1xuICBzdGF0aWMgZ2V0UmVsYXRpb25zaGlwcygpIHtcbiAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyh0aGlzLmdldFJlbGF0aW9uc2hpcHNNYXAoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWxhdGlvbnNoaXBzIG1hcC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIFJlbGF0aW9uc2hpcCBkZWZpbml0aW9ucyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldFJlbGF0aW9uc2hpcHNNYXAoKSB7XG4gICAgaWYgKCFPYmplY3QuaGFzT3duKHRoaXMsIFwiX3JlbGF0aW9uc2hpcHNcIikgfHwgIXRoaXMuX3JlbGF0aW9uc2hpcHMpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgICAgdGhpcy5fcmVsYXRpb25zaGlwcyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovICh0aGlzLl9yZWxhdGlvbnNoaXBzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcCBuYW1lcy5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IC0gVGhlIHJlbGF0aW9uc2hpcCBuYW1lcy5cbiAgICovXG4gIHN0YXRpYyBnZXRSZWxhdGlvbnNoaXBOYW1lcygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRSZWxhdGlvbnNoaXBzKCkubWFwKChyZWxhdGlvbnNoaXApID0+IHJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCkpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXIgYSBjb25zdW1lci1kZWZpbmVkIHF1ZXJ5RGF0YSBlbnRyeS4gVGhlIGNhbGxiYWNrIHJlY2VpdmVzXG4gICAqIGEgZ3JvdXBlZCBxdWVyeSBhbHJlYWR5IGpvaW5lZCBkb3duIHRoZSByZWxhdGlvbnNoaXAgY2hhaW4gZnJvbSB0aGVcbiAgICogcm9vdCBvZiBgLnF1ZXJ5RGF0YSguLi4pYCB0byB0aGlzIG1vZGVsLCBhbHJlYWR5IGZpbHRlcmVkIGJ5IHRoZVxuICAgKiByb290IHBhcmVudCBJRHMsIGFuZCB3aXRoIGBwYXJlbnRfaWRgIHByZS1zZWxlY3RlZCDigJQgc28gdGhlIGZuXG4gICAqIG9ubHkgbmVlZHMgdG8gYWRkIGl0cyBvd24gU0VMRUNUIChhbmQgb3B0aW9uYWxseSBqb2lucy93aGVyZSkuIEFueVxuICAgKiBhbGlhc2VzIHRoZSBmbiBzZWxlY3RzIGFyZSBhdHRhY2hlZCB0byBlYWNoICoqcm9vdCoqIHJlY29yZCB2aWFcbiAgICogYHJlY29yZC5xdWVyeURhdGEoYWxpYXNOYW1lKWAuIE11bHRpLWNvbHVtbiBzZWxlY3RzIGFyZSBmaW5lIOKAlCBvbmVcbiAgICogYWxpYXMgbWFwcyB0byBvbmUgcXVlcnlEYXRhIGtleS5cbiAgICpcbiAgICogKipRdW90ZSBBUyBhbGlhc2VzIG9uIFBvc3RncmVTUUwuKiogUG9zdGdyZVNRTCBmb2xkcyB1bnF1b3RlZFxuICAgKiBpZGVudGlmaWVycyAoaW5jbHVkaW5nIFNFTEVDVCBhbGlhc2VzKSB0byBsb3dlcmNhc2UsIHNvIGFcbiAgICogYC4uLiBBUyBtYW51YWxUYXNrc0NvdW50YCBsYW5kcyBpbiB0aGUgcmVzdWx0IHJvdyBhc1xuICAgKiBgbWFudWFsdGFza3Njb3VudGAgd2hpbGUgdGhlIGxvb2t1cCBgcmVjb3JkLnF1ZXJ5RGF0YShcIm1hbnVhbFRhc2tzQ291bnRcIilgXG4gICAqIG5ldmVyIGZpbmRzIGl0LiBVc2UgYGRyaXZlci5xdW90ZUNvbHVtbihcIm1hbnVhbFRhc2tzQ291bnRcIilgIGZvciB0aGVcbiAgICogYWxpYXMgdG8gcHJlc2VydmUgdGhlIGNhc2Ugb24gZXZlcnkgc3VwcG9ydGVkIGRyaXZlcjpcbiAgICogICBxdWVyeS5zZWxlY3QoYENPVU5UKC4uLikgQVMgJHtkcml2ZXIucXVvdGVDb2x1bW4oXCJtYW51YWxUYXNrc0NvdW50XCIpfWApXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gSWRlbnRpZmllciB1c2VkIGluIHRoZSBgLnF1ZXJ5RGF0YSguLi4pYCBzcGVjLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRm59IGZuIC0gQ2FsbGJhY2sgdGhhdCBtdXRhdGVzIHRoZSBxdWVyeS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgcXVlcnlEYXRhKG5hbWUsIGZuKSB7XG4gICAgaWYgKCFuYW1lIHx8IHR5cGVvZiBuYW1lICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcXVlcnlEYXRhIG5hbWU6ICR7bmFtZX1gKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZm4gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBxdWVyeURhdGEgZm4gZm9yICR7dGhpcy5uYW1lfS5xdWVyeURhdGEoJHtKU09OLnN0cmluZ2lmeShuYW1lKX0pIG11c3QgYmUgYSBmdW5jdGlvbmApXG4gICAgfVxuXG4gICAgY29uc3QgbWFwID0gdGhpcy5nZXRRdWVyeURhdGFNYXAoKVxuXG4gICAgLy8gVXNlIE9iamVjdC5oYXNPd24gc28gYSBuYW1lIHRoYXQgaGFwcGVucyB0byBtYXRjaCBhbiBpbmhlcml0ZWRcbiAgICAvLyBPYmplY3QucHJvdG90eXBlIGtleSAoZS5nLiBcInRvU3RyaW5nXCIsIFwiY29uc3RydWN0b3JcIikgaXNuJ3RcbiAgICAvLyBmYWxzZWx5IHRyZWF0ZWQgYXMgYWxyZWFkeSByZWdpc3RlcmVkLlxuICAgIGlmIChPYmplY3QuaGFzT3duKG1hcCwgbmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgcXVlcnlEYXRhIGZvciAke3RoaXMubmFtZX0uJHtuYW1lfSBpcyBhbHJlYWR5IHJlZ2lzdGVyZWRgKVxuICAgIH1cblxuICAgIG1hcFtuYW1lXSA9IGZuXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcXVlcnkgZGF0YSBtYXAuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9xdWVyeS9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUZuPn0gLSBxdWVyeURhdGEgcmVnaXN0cmF0aW9ucyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldFF1ZXJ5RGF0YU1hcCgpIHtcbiAgICBpZiAoIU9iamVjdC5oYXNPd24odGhpcywgXCJfcXVlcnlEYXRhUmVnaXN0cmF0aW9uc1wiKSB8fCAhdGhpcy5fcXVlcnlEYXRhUmVnaXN0cmF0aW9ucykge1xuICAgICAgLy8gUHJvdG90eXBlLWxlc3MgbWFwIHNvIGJyYWNrZXQgYWNjZXNzIGNhbiBvbmx5IGV2ZXIgc3VyZmFjZVxuICAgICAgLy8gcmVnaXN0cmF0aW9ucyBhY3R1YWxseSBtYWRlIG9uIHRoaXMgY2xhc3Mg4oCUIG5ldmVyIGluaGVyaXRlZFxuICAgICAgLy8gT2JqZWN0LnByb3RvdHlwZSBtZW1iZXJzLlxuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vcXVlcnkvcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFGbj59ICovXG4gICAgICB0aGlzLl9xdWVyeURhdGFSZWdpc3RyYXRpb25zID0gT2JqZWN0LmNyZWF0ZShudWxsKVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3F1ZXJ5L3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRm4+fSAqLyAodGhpcy5fcXVlcnlEYXRhUmVnaXN0cmF0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBxdWVyeSBkYXRhIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gcXVlcnlEYXRhIG5hbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9xdWVyeS9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUZuIHwgbnVsbH0gLSBSZWdpc3RlcmVkIGZuIG9yIG51bGwgd2hlbiBub3QgZm91bmQuXG4gICAqL1xuICBzdGF0aWMgZ2V0UXVlcnlEYXRhQnlOYW1lKG5hbWUpIHtcbiAgICBjb25zdCBtYXAgPSB0aGlzLmdldFF1ZXJ5RGF0YU1hcCgpXG5cbiAgICAvLyBPd24tcHJvcGVydHkgbG9va3VwIHNvIGEgc3BlYyBjb250YWluaW5nIGUuZy4gXCJ0b1N0cmluZ1wiIGRvZXNuJ3RcbiAgICAvLyByZXNvbHZlIHRvIGFuIGluaGVyaXRlZCBPYmplY3QucHJvdG90eXBlIG1lbWJlciDigJQgbWF0Y2hpbmcgdGhlXG4gICAgLy8gT2JqZWN0Lmhhc093biBndWFyZCB1c2VkIHdoZW4gcmVnaXN0ZXJpbmcuXG4gICAgcmV0dXJuIE9iamVjdC5oYXNPd24obWFwLCBuYW1lKSA/IG1hcFtuYW1lXSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJlY29yZEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPn0gLSBBdHRhY2htZW50IGRlZmluaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dGFjaG1lbnRzKCkge1xuICAgIHJldHVybiB0aGlzLmdldEF0dGFjaG1lbnRzTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGF0dGFjaG1lbnQgZGVmaW5pdGlvbnMgdGhyb3VnaCB0aGUgbW9kZWwgY29udHJhY3Qgc2hhcmVkIHdpdGhcbiAgICogZnJvbnRlbmQgbW9kZWwgY2xhc3Nlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJlY29yZEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPn0gLSBBdHRhY2htZW50IGRlZmluaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIGF0dGFjaG1lbnREZWZpbml0aW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRBdHRhY2htZW50c01hcCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0YWNobWVudCBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtSZWNvcmRBdHRhY2htZW50Q29uZmlndXJhdGlvbn0gLSBBdHRhY2htZW50IGRlZmluaXRpb24uXG4gICAqL1xuICBzdGF0aWMgZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSkge1xuICAgIGNvbnN0IGRlZmluaXRpb24gPSB0aGlzLmdldEF0dGFjaG1lbnRzTWFwKClbYXR0YWNobWVudE5hbWVdXG5cbiAgICBpZiAoIWRlZmluaXRpb24pIHRocm93IG5ldyBFcnJvcihgTm8gYXR0YWNobWVudCBpbiAke3RoaXMubmFtZX0gY2FsbGVkIFwiJHthdHRhY2htZW50TmFtZX1cIiBpbiBsaXN0OiAke09iamVjdC5rZXlzKHRoaXMuZ2V0QXR0YWNobWVudHNNYXAoKSkuam9pbihcIiwgXCIpfWApXG5cbiAgICByZXR1cm4gZGVmaW5pdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcCBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgcmVsYXRpb25zaGlwIGJ5IG5hbWUuXG4gICAqL1xuICBnZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGlmICghKHJlbGF0aW9uc2hpcE5hbWUgaW4gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKSkge1xuICAgICAgY29uc3QgbW9kZWxDbGFzc1JlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG4gICAgICAgIC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgICAgLnJlc29sdmVGb3JSZWNvcmQodGhpcylcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcFR5cGUgPSBtb2RlbENsYXNzUmVsYXRpb25zaGlwLmdldFR5cGUoKVxuICAgICAgbGV0IGluc3RhbmNlUmVsYXRpb25zaGlwXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlID09IFwiYmVsb25nc1RvXCIpIHtcbiAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSBuZXcgQmVsb25nc1RvSW5zdGFuY2VSZWxhdGlvbnNoaXAoe21vZGVsOiB0aGlzLCByZWxhdGlvbnNoaXA6IG1vZGVsQ2xhc3NSZWxhdGlvbnNoaXB9KVxuICAgICAgfSBlbHNlIGlmIChyZWxhdGlvbnNoaXBUeXBlID09IFwiaGFzTWFueVwiKSB7XG4gICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwID0gbmV3IEhhc01hbnlJbnN0YW5jZVJlbGF0aW9uc2hpcCh7bW9kZWw6IHRoaXMsIHJlbGF0aW9uc2hpcDogbW9kZWxDbGFzc1JlbGF0aW9uc2hpcH0pXG4gICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uc2hpcFR5cGUgPT0gXCJoYXNPbmVcIikge1xuICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IG5ldyBIYXNPbmVJbnN0YW5jZVJlbGF0aW9uc2hpcCh7bW9kZWw6IHRoaXMsIHJlbGF0aW9uc2hpcDogbW9kZWxDbGFzc1JlbGF0aW9uc2hpcH0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVsYXRpb25zaGlwIHR5cGU6ICR7cmVsYXRpb25zaGlwVHlwZX1gKVxuICAgICAgfVxuXG4gICAgICB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV0gPSBpbnN0YW5jZVJlbGF0aW9uc2hpcFxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVsb2FkcyByZWxhdGlvbnNoaXAocykgb250byB0aGlzIGFscmVhZHktbG9hZGVkIHJlY29yZC4gQWNjZXB0cyBlaXRoZXIgYVxuICAgKiBxdWVyeSBidWlsdCB2aWEgYE1vZGVsLnByZWxvYWQoLi4uKS5zZWxlY3QoLi4uKWAgb3IgYSByYXcgcHJlbG9hZCBzcGVjXG4gICAqIChzdHJpbmcgLyBhcnJheSAvIG5lc3RlZCBvYmplY3QpLiBBIHJlbGF0aW9uc2hpcCB0aGF0IGlzIGFscmVhZHkgcHJlbG9hZGVkXG4gICAqIHdpdGggYWxsIHRoZSByZXF1aXJlZCBjb2x1bW5zIHByZXNlbnQgaXMgbGVmdCB1bnRvdWNoZWQgdW5sZXNzIGBmb3JjZWAgaXNcbiAgICogc2V0LiBQcmVsb2FkaW5nIG9udG8gdGhlIHJlbGF0aW9uc2hpcCBjYWNoZSBsZXRzIGxhdGVyIGFjY2Vzc29ycyByZXVzZSB0aGVcbiAgICogbG9hZGVkIGRhdGEgaW5zdGVhZCBvZiBpc3N1aW5nIGlkZW50aWNhbCBxdWVyaWVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHF1ZXJ5T3JTcGVjIC0gUHJlbG9hZCBzb3VyY2UuXG4gICAqIEBwYXJhbSB7e2ZvcmNlPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcHJlbG9hZGluZyBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBwcmVsb2FkKHF1ZXJ5T3JTcGVjLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCBQcmVsb2FkZXIucHJlbG9hZChbdGhpc10sIHF1ZXJ5T3JTcGVjLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgbG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGF3YWl0IHJlbGF0aW9uc2hpcC5sb2FkKClcblxuICAgIHJldHVybiByZWxhdGlvbnNoaXAubG9hZGVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBvciBsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge3twcmVsb2FkVHJhbnNsYXRpb25zPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIExvYWQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBhc3luYyByZWxhdGlvbnNoaXBPckxvYWQocmVsYXRpb25zaGlwTmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICBsZXQgbG9hZGVkID0gYXdhaXQgcmVsYXRpb25zaGlwLmF1dG9sb2FkT3JMb2FkKClcblxuICAgIGlmIChvcHRpb25zLnByZWxvYWRUcmFuc2xhdGlvbnMpIHtcbiAgICAgIGxvYWRlZCA9IGF3YWl0IHRoaXMuX3ByZWxvYWRMb2FkZWRSZWxhdGlvbnNoaXBUcmFuc2xhdGlvbnMobG9hZGVkKVxuICAgIH1cblxuICAgIHJldHVybiBsb2FkZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVsb2FkcyB0cmFuc2xhdGlvbnMgb24gYSBsb2FkZWQgcmVsYXRpb25zaGlwIHRhcmdldCB3aGVuIGV4cGxpY2l0bHkgcmVxdWVzdGVkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBsb2FkZWQgLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVsYXRpb25zaGlwIHZhbHVlIGFmdGVyIHRyYW5zbGF0aW9uIHByZWxvYWQuXG4gICAqL1xuICBhc3luYyBfcHJlbG9hZExvYWRlZFJlbGF0aW9uc2hpcFRyYW5zbGF0aW9ucyhsb2FkZWQpIHtcbiAgICBpZiAoIWxvYWRlZCB8fCAhbG9hZGVkLmlzUGVyc2lzdGVkKCkgfHwgIWF3YWl0IGxvYWRlZC5nZXRNb2RlbENsYXNzKCkuaGFzVHJhbnNsYXRpb25zVGFibGUoKSkgcmV0dXJuIGxvYWRlZFxuXG4gICAgY29uc3QgdHJhbnNsYXRpb25zUmVsYXRpb25zaGlwID0gbG9hZGVkLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShcInRyYW5zbGF0aW9uc1wiKVxuXG4gICAgaWYgKHRyYW5zbGF0aW9uc1JlbGF0aW9uc2hpcC5nZXRQcmVsb2FkZWQoKSkgcmV0dXJuIGxvYWRlZFxuXG4gICAgYXdhaXQgbG9hZGVkLnByZWxvYWQoe3RyYW5zbGF0aW9uczoge319KVxuXG4gICAgcmV0dXJuIGxvYWRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dGFjaG1lbnQgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkQXR0YWNobWVudEhhbmRsZX0gLSBBdHRhY2htZW50IGhhbmRsZS5cbiAgICovXG4gIGdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpIHtcbiAgICBpZiAoIShhdHRhY2htZW50TmFtZSBpbiB0aGlzLl9hdHRhY2htZW50cykpIHtcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSlcblxuICAgICAgdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdID0gbmV3IFJlY29yZEF0dGFjaG1lbnRIYW5kbGUoe1xuICAgICAgICBtb2RlbDogdGhpcyxcbiAgICAgICAgbmFtZTogYXR0YWNobWVudE5hbWUsXG4gICAgICAgIHR5cGU6IGF0dGFjaG1lbnREZWZpbml0aW9uLnR5cGVcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBiZWxvbmdzLXRvLXJlbGF0aW9uc2hpcCB0byB0aGUgbW9kZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIFRoZSBuYW1lIG9mIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwU2NvcGVDYWxsYmFjayB8IG9iamVjdH0gW3Njb3BlT3JPcHRpb25zXSBUaGUgc2NvcGUgY2FsbGJhY2sgb3Igb3B0aW9ucyBmb3IgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSBUaGUgb3B0aW9ucyBmb3IgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICovXG4gIHN0YXRpYyBiZWxvbmdzVG8ocmVsYXRpb25zaGlwTmFtZSwgc2NvcGVPck9wdGlvbnMsIG9wdGlvbnMpIHtcbiAgICBjb25zdCB7c2NvcGUsIHJlbGF0aW9uc2hpcE9wdGlvbnN9ID0gdGhpcy5fbm9ybWFsaXplUmVsYXRpb25zaGlwQXJncyhzY29wZU9yT3B0aW9ucywgb3B0aW9ucylcblxuICAgIHRoaXMuX2RlZmluZVJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lLCBPYmplY3QuYXNzaWduKHt0eXBlOiBcImJlbG9uZ3NUb1wiLCBzY29wZX0sIHJlbGF0aW9uc2hpcE9wdGlvbnMpKVxuXG4gICAgaWYgKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChyZWxhdGlvbnNoaXBPcHRpb25zKT8uY291bnRlckNhY2hlKSB7XG4gICAgICB0aGlzLl9yZWdpc3RlckNvdW50ZXJDYWNoZUNhbGxiYWNrcyhyZWxhdGlvbnNoaXBOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlXSAtIFdoZXRoZXIgdGVuYW50LXN3aXRjaGVkIG1vZGVscyBtdXN0IHJlc29sdmUgYSB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjb25uZWN0aW9uLlxuICAgKi9cbiAgc3RhdGljIGNvbm5lY3Rpb24oe2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlID0gdHJ1ZSwgLi4ucmVzdEFyZ3N9ID0ge30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgY29uc3QgZGF0YWJhc2VQb29sID0gdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldERhdGFiYXNlUG9vbCh0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcih7ZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGV9KSlcbiAgICBjb25zdCBjb25uZWN0aW9uID0gZGF0YWJhc2VQb29sLmdldEN1cnJlbnRDb25uZWN0aW9uKClcblxuICAgIGlmICghY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29ubmVjdGlvbj9cIilcblxuICAgIHJldHVybiBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUuXG4gICAqIEB0ZW1wbGF0ZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBDcmVhdGVBdHRyaWJ1dGVzXG4gICAqIEB0ZW1wbGF0ZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQ8Q3JlYXRlQXR0cmlidXRlcz59IE1vZGVsXG4gICAqIEB0aGlzIHt7bmV3IChjaGFuZ2VzPzogQ3JlYXRlQXR0cmlidXRlcyk6IE1vZGVsfSAmIHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH1cbiAgICogQHBhcmFtIHtDcmVhdGVBdHRyaWJ1dGVzfSBbYXR0cmlidXRlc10gLSBBdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxNb2RlbD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY3JlYXRlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNyZWF0ZShhdHRyaWJ1dGVzKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge01vZGVsfSAqLyAobmV3IHRoaXMoYXR0cmlidXRlcykpXG5cbiAgICBhd2FpdCByZWNvcmQuc2F2ZSgpXG5cbiAgICByZXR1cm4gcmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gLSBUaGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN0YXRpYyBfZ2V0Q29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMuX2NvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRoaXMuX2NvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKVxuXG4gICAgICBpZiAoIXRoaXMuX2NvbmZpZ3VyYXRpb24pIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbiBoYXNuJ3QgYmVlbiBzZXQgKG1vZGVsIGNsYXNzIHByb2JhYmx5IGhhc24ndCBiZWVuIGluaXRpYWxpemVkKVwiKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9jb25maWd1cmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gLSBUaGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9nZXRDb25maWd1cmF0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fZ2V0Q29uZmlndXJhdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogQWRkcyBhIGhhcy1tYW55LXJlbGF0aW9uc2hpcCB0byB0aGUgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIFRoZSBuYW1lIG9mIHRoZSByZWxhdGlvbnNoaXAgKGUuZy4gXCJwb3N0c1wiKVxuICAgKiBAcGFyYW0ge1JlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2sgfCBvYmplY3R9IFtzY29wZU9yT3B0aW9uc10gVGhlIHNjb3BlIGNhbGxiYWNrIG9yIG9wdGlvbnMgZm9yIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gVGhlIG9wdGlvbnMgZm9yIHRoZSByZWxhdGlvbnNoaXAgKGUuZy4ge2NsYXNzTmFtZTogXCJQb3N0XCJ9KVxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgaGFzTWFueShyZWxhdGlvbnNoaXBOYW1lLCBzY29wZU9yT3B0aW9ucywgb3B0aW9ucykge1xuICAgIGNvbnN0IHtzY29wZSwgcmVsYXRpb25zaGlwT3B0aW9uc30gPSB0aGlzLl9ub3JtYWxpemVSZWxhdGlvbnNoaXBBcmdzKHNjb3BlT3JPcHRpb25zLCBvcHRpb25zKVxuXG4gICAgcmV0dXJuIHRoaXMuX2RlZmluZVJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lLCBPYmplY3QuYXNzaWduKHt0eXBlOiBcImhhc01hbnlcIiwgc2NvcGV9LCByZWxhdGlvbnNoaXBPcHRpb25zKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSYWlscy1zdHlsZSBkZWNsYXJhdGlvbiB0aGF0IHRoaXMgbW9kZWwgYWNjZXB0cyBuZXN0ZWQtYXR0cmlidXRlIHdyaXRlc1xuICAgKiBmb3IgYSByZWxhdGlvbnNoaXAgd2hlbiBzYXZlZCB0aHJvdWdoIGEgcGFyZW50LiBSZXF1aXJlZCDigJQgVmVsb2Npb3VzXG4gICAqIHdpbGwgcmVmdXNlIG5lc3RlZCB3cml0ZXMgZm9yIGFueSByZWxhdGlvbnNoaXAgbm90IGxpc3RlZCBoZXJlLCBldmVuXG4gICAqIGlmIGEgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgcGVybWl0cyB0aGVtLlxuICAgKlxuICAgKiBPcHRpb25zOlxuICAgKiAgIC0gYWxsb3dEZXN0cm95OiB3aGV0aGVyIGBfZGVzdHJveTogdHJ1ZWAgZW50cmllcyBhcmUgYWxsb3dlZC4gRGVmYXVsdCBmYWxzZS5cbiAgICogICAtIGxpbWl0OiBvcHRpb25hbCB1cHBlciBib3VuZCBvbiB0aGUgbnVtYmVyIG9mIG5lc3RlZCBlbnRyaWVzIHBlciByZXF1ZXN0LlxuICAgKiAgIC0gcmVqZWN0SWY6IG9wdGlvbmFsIHByZWRpY2F0ZSBgKGF0dHJpYnV0ZXMpID0+IGJvb2xlYW5gIHRoYXQgc2lsZW50bHkgc2tpcHMgZW50cmllcy5cbiAgICpcbiAgICogVXNhZ2U6XG4gICAqICAgY2xhc3MgUHJvamVjdCBleHRlbmRzIFJlY29yZCB7fVxuICAgKiAgIFByb2plY3QuaGFzTWFueShcInRhc2tzXCIpXG4gICAqICAgUHJvamVjdC5hY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcihcInRhc2tzXCIsIHthbGxvd0Rlc3Ryb3k6IHRydWV9KVxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lIG9uIHRoaXMgbW9kZWwuXG4gICAqIEBwYXJhbSB7e2FsbG93RGVzdHJveT86IGJvb2xlYW4sIGxpbWl0PzogbnVtYmVyLCByZWplY3RJZj86IChhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGJvb2xlYW59fSBbb3B0aW9uc10gLSBQb2xpY3kgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3IocmVsYXRpb25zaGlwTmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgaWYgKCFyZWxhdGlvbnNoaXBOYW1lIHx8IHR5cGVvZiByZWxhdGlvbnNoaXBOYW1lICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcmVsYXRpb25zaGlwTmFtZSBwYXNzZWQgdG8gYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3I6ICR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsIFwiX2FjY2VwdGVkTmVzdGVkQXR0cmlidXRlc1wiKSkge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge2FsbG93RGVzdHJveT86IGJvb2xlYW4sIGxpbWl0PzogbnVtYmVyLCByZWplY3RJZj86IChhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGJvb2xlYW59Pn0gKi9cbiAgICAgIHRoaXMuX2FjY2VwdGVkTmVzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7YWxsb3dEZXN0cm95PzogYm9vbGVhbiwgbGltaXQ/OiBudW1iZXIsIHJlamVjdElmPzogKGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gYm9vbGVhbn0+fSAqLyAodGhpcy5fYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzKVtyZWxhdGlvbnNoaXBOYW1lXSA9IHsuLi5vcHRpb25zfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWNjZXB0ZWQgbmVzdGVkIGF0dHJpYnV0ZXMgZm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7e2FsbG93RGVzdHJveT86IGJvb2xlYW4sIGxpbWl0PzogbnVtYmVyLCByZWplY3RJZj86IChhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGJvb2xlYW59IHwgbnVsbH0gLSBQb2xpY3kgZGVjbGFyZWQgdmlhIGBhY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcmAsIG9yIG51bGwgd2hlbiBub3QgYWNjZXB0ZWQuXG4gICAqL1xuICBzdGF0aWMgYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzRm9yKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzPy5bcmVsYXRpb25zaGlwTmFtZV0gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBoYXMtb25lLXJlbGF0aW9uc2hpcCB0byB0aGUgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIFRoZSBuYW1lIG9mIHRoZSByZWxhdGlvbnNoaXAgKGUuZy4gXCJwb3N0XCIpXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwU2NvcGVDYWxsYmFjayB8IG9iamVjdH0gW3Njb3BlT3JPcHRpb25zXSBUaGUgc2NvcGUgY2FsbGJhY2sgb3Igb3B0aW9ucyBmb3IgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSBUaGUgb3B0aW9ucyBmb3IgdGhlIHJlbGF0aW9uc2hpcCAoZS5nLiB7Y2xhc3NOYW1lOiBcIlBvc3RcIn0pXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBoYXNPbmUocmVsYXRpb25zaGlwTmFtZSwgc2NvcGVPck9wdGlvbnMsIG9wdGlvbnMpIHtcbiAgICBjb25zdCB7c2NvcGUsIHJlbGF0aW9uc2hpcE9wdGlvbnN9ID0gdGhpcy5fbm9ybWFsaXplUmVsYXRpb25zaGlwQXJncyhzY29wZU9yT3B0aW9ucywgb3B0aW9ucylcblxuICAgIHJldHVybiB0aGlzLl9kZWZpbmVSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSwgT2JqZWN0LmFzc2lnbih7dHlwZTogXCJoYXNPbmVcIiwgc2NvcGV9LCByZWxhdGlvbnNoaXBPcHRpb25zKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmluZSBhdHRhY2htZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXR0YWNobWVudCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MuZHJpdmVyXSAtIEF0dGFjaG1lbnQgZHJpdmVyIG5hbWUsIGNsYXNzLCBvciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtBdHRhY2htZW50U3luY0NvbmZpZ3VyYXRpb259IFthcmdzLnN5bmNdIC0gQ2xpZW50LXNhZmUgc3luY2hyb25pemVkIGFzc2V0IHBvbGljeS5cbiAgICogQHBhcmFtIHtcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9IGFyZ3MudHlwZSAtIEF0dGFjaG1lbnQgdHlwZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIF9kZWZpbmVBdHRhY2htZW50KGF0dGFjaG1lbnROYW1lLCB7ZHJpdmVyLCBzeW5jLCB0eXBlfSkge1xuICAgIGlmICghYXR0YWNobWVudE5hbWUgfHwgdHlwZW9mIGF0dGFjaG1lbnROYW1lICE9PSBcInN0cmluZ1wiKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYXR0YWNobWVudCBuYW1lOiAke2F0dGFjaG1lbnROYW1lfWApXG4gICAgaWYgKGF0dGFjaG1lbnROYW1lIGluIHRoaXMuZ2V0QXR0YWNobWVudHNNYXAoKSkgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50ICR7YXR0YWNobWVudE5hbWV9IGFscmVhZHkgZXhpc3RzYClcblxuICAgIGlmIChzeW5jKSB7XG4gICAgICBjb25zdCB7ZmV0Y2gsIG9mZmxpbmVSZXF1aXJlbWVudCwgcmV0ZW50aW9uLCAuLi5yZXN0U3luY30gPSBzeW5jXG5cbiAgICAgIHJlc3RBcmdzRXJyb3IocmVzdFN5bmMpXG5cbiAgICAgIGlmIChmZXRjaCAhPT0gXCJlYWdlclwiICYmIGZldGNoICE9PSBcIm9uLWRlbWFuZFwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCAke2F0dGFjaG1lbnROYW1lfSBzeW5jIGZldGNoIG11c3QgYmUgZWFnZXIgb3Igb24tZGVtYW5kYClcbiAgICAgIH1cbiAgICAgIGlmIChvZmZsaW5lUmVxdWlyZW1lbnQgIT09IFwib3B0aW9uYWxcIiAmJiBvZmZsaW5lUmVxdWlyZW1lbnQgIT09IFwicmVxdWlyZWRcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgJHthdHRhY2htZW50TmFtZX0gb2ZmbGluZSByZXF1aXJlbWVudCBtdXN0IGJlIG9wdGlvbmFsIG9yIHJlcXVpcmVkYClcbiAgICAgIH1cbiAgICAgIGlmIChyZXRlbnRpb24gIT09IFwiZHVyYWJsZVwiICYmIHJldGVudGlvbiAhPT0gXCJldmljdGFibGVcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgJHthdHRhY2htZW50TmFtZX0gc3luYyByZXRlbnRpb24gbXVzdCBiZSBkdXJhYmxlIG9yIGV2aWN0YWJsZWApXG4gICAgICB9XG4gICAgICBpZiAob2ZmbGluZVJlcXVpcmVtZW50ID09PSBcInJlcXVpcmVkXCIgJiYgcmV0ZW50aW9uICE9PSBcImR1cmFibGVcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgJHthdHRhY2htZW50TmFtZX0gcmVxdWlyZWQgb2ZmbGluZSBhc3NldHMgbXVzdCB1c2UgZHVyYWJsZSByZXRlbnRpb25gKVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuZ2V0QXR0YWNobWVudHNNYXAoKVthdHRhY2htZW50TmFtZV0gPSB7ZHJpdmVyLCBzeW5jLCB0eXBlfVxuXG4gICAgY29uc3QgcHJvdG90eXBlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcy5wcm90b3R5cGUpKVxuXG4gICAgcHJvdG90eXBlW2F0dGFjaG1lbnROYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHRoaXMuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSlcbiAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKGF0dGFjaG1lbnROYW1lKX1gXSA9IGZ1bmN0aW9uKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIG5ld1ZhbHVlKSB7XG4gICAgICB0aGlzLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpLnF1ZXVlQXR0YWNoKG5ld1ZhbHVlKVxuICAgICAgcmV0dXJuIG5ld1ZhbHVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBzaW5nbGUgYXR0YWNobWVudCBoZWxwZXIgdG8gdGhlIG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7e2RyaXZlcj86IHN0cmluZyB8IEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc3luYz86IEF0dGFjaG1lbnRTeW5jQ29uZmlndXJhdGlvbn19IFthcmdzXSAtIEF0dGFjaG1lbnQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGhhc09uZUF0dGFjaG1lbnQoYXR0YWNobWVudE5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIHRoaXMuX2RlZmluZUF0dGFjaG1lbnQoYXR0YWNobWVudE5hbWUsIHtkcml2ZXI6IGFyZ3MuZHJpdmVyLCBzeW5jOiBhcmdzLnN5bmMsIHR5cGU6IFwiaGFzT25lXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBjb2xsZWN0aW9uIGF0dGFjaG1lbnQgaGVscGVyIHRvIHRoZSBtb2RlbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3tkcml2ZXI/OiBzdHJpbmcgfCBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHN5bmM/OiBBdHRhY2htZW50U3luY0NvbmZpZ3VyYXRpb259fSBbYXJnc10gLSBBdHRhY2htZW50IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBoYXNNYW55QXR0YWNobWVudHMoYXR0YWNobWVudE5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIHRoaXMuX2RlZmluZUF0dGFjaG1lbnQoYXR0YWNobWVudE5hbWUsIHtkcml2ZXI6IGFyZ3MuZHJpdmVyLCBzeW5jOiBhcmdzLnN5bmMsIHR5cGU6IFwiaGFzTWFueVwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGh1bWFuIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBodW1hbiBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBodW1hbkF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSkge1xuICAgIGNvbnN0IG1vZGVsTmFtZUtleSA9IGluZmxlY3Rpb24udW5kZXJzY29yZSh0aGlzLmdldE1vZGVsTmFtZSgpKVxuXG4gICAgcmV0dXJuIHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRUcmFuc2xhdG9yKCkoYHZlbG9jaW91cy5kYXRhYmFzZS5yZWNvcmQuYXR0cmlidXRlcy4ke21vZGVsTmFtZUtleX0uJHthdHRyaWJ1dGVOYW1lfWAsIHtkZWZhdWx0VmFsdWU6IGluZmxlY3Rpb24uY2FtZWxpemUoYXR0cmlidXRlTmFtZSl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGRhdGFiYXNlIHR5cGUuXG4gICAqL1xuICBzdGF0aWMgZ2V0RGF0YWJhc2VUeXBlKCkge1xuICAgIGlmICghdGhpcy5fZGF0YWJhc2VUeXBlKSB0aHJvdyBuZXcgRXJyb3IoXCJEYXRhYmFzZSB0eXBlIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX2RhdGFiYXNlVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGVhZ2VyIGxvYWQgcmVjb3JkIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGVhZ2VyTG9hZFJlY29yZE1ldGFkYXRhIC0gV2hldGhlciByZXF1aXJlLWNvbnRleHQgaW5pdGlhbGl6YXRpb24gc2hvdWxkIGxvYWQgdGFibGUgbWV0YWRhdGEgZm9yIHRoaXMgbW9kZWwuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzZXRFYWdlckxvYWRSZWNvcmRNZXRhZGF0YShlYWdlckxvYWRSZWNvcmRNZXRhZGF0YSkge1xuICAgIHRoaXMuX2VhZ2VyTG9hZFJlY29yZE1ldGFkYXRhID0gZWFnZXJMb2FkUmVjb3JkTWV0YWRhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBlYWdlciBsb2FkIHJlY29yZCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZXF1aXJlLWNvbnRleHQgaW5pdGlhbGl6YXRpb24gc2hvdWxkIGxvYWQgdGFibGUgbWV0YWRhdGEgZm9yIHRoaXMgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgZ2V0RWFnZXJMb2FkUmVjb3JkTWV0YWRhdGEoKSB7XG4gICAgaWYgKHRoaXMuX2VhZ2VyTG9hZFJlY29yZE1ldGFkYXRhID09PSB1bmRlZmluZWQpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gdGhpcy5fZWFnZXJMb2FkUmVjb3JkTWV0YWRhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc2V0IHJlY29yZCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHJlc2V0UmVjb3JkTWV0YWRhdGEoKSB7XG4gICAgdGhpcy5faW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuX2RhdGFiYXNlVHlwZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3RhYmxlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fY29sdW1ucyA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2NvbHVtbnNBc0hhc2ggPSB1bmRlZmluZWRcbiAgICB0aGlzLl9jb2x1bW5OYW1lcyA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2NvbHVtblR5cGVCeU5hbWUgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9hdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSA9IHVuZGVmaW5lZFxuXG4gICAgaWYgKCF0aGlzLl9yZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MpIHRoaXMuY2xlYXJSZWNvcmRNZXRhZGF0YVZhbHVlcygpXG4gIH1cblxuICAvKipcbiAgICogU3RhdGljIGZpZWxkcyB0aGF0IGJlbG9uZyB0byBvbmUgcGh5c2ljYWwgZGF0YWJhc2Uvc2NoZW1hIGdlbmVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBNZXRhZGF0YSBwcm9wZXJ0eSBuYW1lcy5cbiAgICovXG4gIHN0YXRpYyByZWNvcmRNZXRhZGF0YVByb3BlcnR5TmFtZXMoKSB7XG4gICAgcmV0dXJuIHJlY29yZE1ldGFkYXRhUHJvcGVydHlOYW1lc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIG9uZSBvcGVyYXRpb24tYm91bmQgbWV0YWRhdGEgZmllbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRhZGF0YUtleSAtIFBoeXNpY2FsIGRhdGFiYXNlIGFuZCBzY2hlbWEgZ2VuZXJhdGlvbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwcm9wZXJ0eSAtIFN0YXRpYyBtZXRhZGF0YSBwcm9wZXJ0eS5cbiAgICogQHJldHVybnMge1JlY29yZE1ldGFkYXRhVmFsdWV9IC0gU3RvcmVkIG1ldGFkYXRhIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHJlY29yZE1ldGFkYXRhVmFsdWUobWV0YWRhdGFLZXksIHByb3BlcnR5KSB7XG4gICAgcmV0dXJuIHJlY29yZE1ldGFkYXRhVmFsdWVzRm9yKHRoaXMpLmdldChtZXRhZGF0YUtleSk/LmdldChwcm9wZXJ0eSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZXMgb25lIG9wZXJhdGlvbi1ib3VuZCBtZXRhZGF0YSBmaWVsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGFkYXRhS2V5IC0gUGh5c2ljYWwgZGF0YWJhc2UgYW5kIHNjaGVtYSBnZW5lcmF0aW9uIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3BlcnR5IC0gU3RhdGljIG1ldGFkYXRhIHByb3BlcnR5LlxuICAgKiBAcGFyYW0ge1JlY29yZE1ldGFkYXRhVmFsdWV9IHZhbHVlIC0gTWV0YWRhdGEgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHNldFJlY29yZE1ldGFkYXRhVmFsdWUobWV0YWRhdGFLZXksIHByb3BlcnR5LCB2YWx1ZSkge1xuICAgIGxldCB2YWx1ZXMgPSByZWNvcmRNZXRhZGF0YVZhbHVlc0Zvcih0aGlzKS5nZXQobWV0YWRhdGFLZXkpXG5cbiAgICBpZiAoIXZhbHVlcykge1xuICAgICAgdmFsdWVzID0gbmV3IE1hcCgpXG4gICAgICByZWNvcmRNZXRhZGF0YVZhbHVlc0Zvcih0aGlzKS5zZXQobWV0YWRhdGFLZXksIHZhbHVlcylcbiAgICB9XG5cbiAgICB2YWx1ZXMuc2V0KHByb3BlcnR5LCB2YWx1ZSlcbiAgfVxuXG4gIC8qKiBDbGVhcnMgZXZlcnkgdGVuYW50L2dlbmVyYXRpb24gbWV0YWRhdGEgc25hcHNob3QgZm9yIHRoaXMgbW9kZWwuICovXG4gIHN0YXRpYyBjbGVhclJlY29yZE1ldGFkYXRhVmFsdWVzKCkge1xuICAgIHJlY29yZE1ldGFkYXRhVmFsdWVzQnlNb2RlbC5kZWxldGUodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgc25hcHNob3RzIHdob3NlIGtleSBiZWxvbmdzIHRvIG9uZSBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpdHkgLSBMb2dpY2FsIGlkZW50aWZpZXIgcGx1cyBwb29sIHJldXNlIGtleS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgY2xlYXJSZWNvcmRNZXRhZGF0YVZhbHVlc0ZvckRhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSkge1xuICAgIGNvbnN0IHZhbHVlcyA9IHJlY29yZE1ldGFkYXRhVmFsdWVzQnlNb2RlbC5nZXQodGhpcylcblxuICAgIGlmICghdmFsdWVzKSByZXR1cm5cblxuICAgIGNvbnN0IG1ldGFkYXRhUHJlZml4ID0gYCR7ZGF0YWJhc2VJZGVudGl0eS5sZW5ndGh9OiR7ZGF0YWJhc2VJZGVudGl0eX06YFxuXG4gICAgZm9yIChjb25zdCBtZXRhZGF0YUtleSBvZiB2YWx1ZXMua2V5cygpKSB7XG4gICAgICBpZiAobWV0YWRhdGFLZXkuc3RhcnRzV2l0aChtZXRhZGF0YVByZWZpeCkpIHZhbHVlcy5kZWxldGUobWV0YWRhdGFLZXkpXG4gICAgfVxuXG4gICAgaWYgKHZhbHVlcy5zaXplID09PSAwKSByZWNvcmRNZXRhZGF0YVZhbHVlc0J5TW9kZWwuZGVsZXRlKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIHRoZSBtb2RlbCBjbGFzcyB3aXRoIGEgY29uZmlndXJhdGlvbiB3aXRob3V0IGxvYWRpbmcgdGFibGUgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgcmVnaXN0ZXJSZWNvcmRDbGFzcyh7Y29uZmlndXJhdGlvbiwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKGBObyBjb25maWd1cmF0aW9uIGdpdmVuIGZvciAke3RoaXMubmFtZX1gKVxuXG4gICAgdGhpcy5yZXNldFJlY29yZE1ldGFkYXRhKClcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5fcmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzIHx8IHRoaXNcblxuICAgIG1vZGVsQ2xhc3MuX2NvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgY29uZmlndXJhdGlvbi5yZWdpc3Rlck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUgcmVjb3JkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2FyZ3MuY29ubmVjdGlvbl0gLSBFeHBsaWNpdCBtZXRhZGF0YSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGluaXRpYWxpemVSZWNvcmQoe2NvbmZpZ3VyYXRpb24sIGNvbm5lY3Rpb246IGV4cGxpY2l0Q29ubmVjdGlvbiwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKGBObyBjb25maWd1cmF0aW9uIGdpdmVuIGZvciAke3RoaXMubmFtZX1gKVxuXG4gICAgdGhpcy5yZWdpc3RlclJlY29yZENsYXNzKHtjb25maWd1cmF0aW9ufSlcbiAgICBjb25zdCBjb25uZWN0aW9uID0gZXhwbGljaXRDb25uZWN0aW9uIHx8IHRoaXMuY29ubmVjdGlvbih7ZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGU6IGZhbHNlfSlcblxuICAgIHRoaXMuX2RhdGFiYXNlVHlwZSA9IGNvbm5lY3Rpb24uZ2V0VHlwZSgpXG5cbiAgICB0aGlzLl90YWJsZSA9IGF3YWl0IGNvbm5lY3Rpb24uZ2V0VGFibGVCeU5hbWUodGhpcy50YWJsZU5hbWUoKSlcbiAgICB0aGlzLl9jb2x1bW5zID0gYXdhaXQgdGhpcy5fZ2V0VGFibGUoKS5nZXRDb2x1bW5zKClcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICB0aGlzLl9jb2x1bW5zQXNIYXNoID0ge31cblxuICAgIGNvbnN0IGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSB0aGlzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUgPSB0aGlzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuICAgIGNvbnN0IHByb3RvdHlwZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMucHJvdG90eXBlKSlcblxuICAgIGZvciAoY29uc3QgY29sdW1uIG9mIHRoaXMuX2NvbHVtbnMpIHtcbiAgICAgIHRoaXMuX2NvbHVtbnNBc0hhc2hbY29sdW1uLmdldE5hbWUoKV0gPSBjb2x1bW5cblxuICAgICAgY29uc3QgZGVidXJyZWRDb2x1bW5OYW1lID0gZGVidXJyQ29sdW1uTmFtZShjb2x1bW4uZ2V0TmFtZSgpKVxuICAgICAgY29uc3QgY2FtZWxpemVkQ29sdW1uTmFtZSA9IGluZmxlY3Rpb24uY2FtZWxpemUoZGVidXJyZWRDb2x1bW5OYW1lLCB0cnVlKVxuICAgICAgY29uc3QgY2FtZWxpemVkQ29sdW1uTmFtZUJpZ0ZpcnN0ID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShkZWJ1cnJlZENvbHVtbk5hbWUpXG5cbiAgICAgIGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVbY2FtZWxpemVkQ29sdW1uTmFtZV0gPSBjb2x1bW4uZ2V0TmFtZSgpXG4gICAgICBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lW2NvbHVtbi5nZXROYW1lKCldID0gY2FtZWxpemVkQ29sdW1uTmFtZVxuXG4gICAgICBpZiAoIShjYW1lbGl6ZWRDb2x1bW5OYW1lIGluIHByb3RvdHlwZSkpIHtcbiAgICAgICAgcHJvdG90eXBlW2NhbWVsaXplZENvbHVtbk5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShjYW1lbGl6ZWRDb2x1bW5OYW1lKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICghKGBzZXQke2NhbWVsaXplZENvbHVtbk5hbWVCaWdGaXJzdH1gIGluIHByb3RvdHlwZSkpIHtcbiAgICAgICAgcHJvdG90eXBlW2BzZXQke2NhbWVsaXplZENvbHVtbk5hbWVCaWdGaXJzdH1gXSA9IGZ1bmN0aW9uKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIG5ld1ZhbHVlKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX3NldENvbHVtbkF0dHJpYnV0ZShjYW1lbGl6ZWRDb2x1bW5OYW1lLCBuZXdWYWx1ZSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoIShgaGFzJHtjYW1lbGl6ZWRDb2x1bW5OYW1lQmlnRmlyc3R9YCBpbiBwcm90b3R5cGUpKSB7XG4gICAgICAgIHByb3RvdHlwZVtgaGFzJHtjYW1lbGl6ZWRDb2x1bW5OYW1lQmlnRmlyc3R9YF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuICAgICAgICAgIGNvbnN0IHZhbHVlID0gZHluYW1pY1RoaXNbY2FtZWxpemVkQ29sdW1uTmFtZV0oKVxuXG4gICAgICAgICAgcmV0dXJuIHRoaXMuX2hhc0F0dHJpYnV0ZSh2YWx1ZSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2RlZmluZVRyYW5zbGF0aW9uTWV0aG9kcyhjb25uZWN0aW9uKVxuICAgIGF3YWl0IGluaXRpYWxpemVBdWRpdGluZyh0aGlzKVxuICAgIHRoaXMuX2luaXRpYWxpemVkID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemVzIHRoZSBtb2RlbCBjbGFzcyB0aGUgZmlyc3QgdGltZSBhbiBhc3luYyByZWNvcmQgQVBJIG5lZWRzIHRhYmxlXG4gICAqIG1ldGFkYXRhLiBDb25jdXJyZW50IGNhbGxlcnMgc2hhcmUgdGhlIHNhbWUgaW5pdGlhbGl6YXRpb24gcHJvbWlzZSwgYW5kIGFcbiAgICogZmFpbGVkIGluaXRpYWxpemF0aW9uIGNhbiBiZSByZXRyaWVkIGJ5IGEgbGF0ZXIgY2FsbC5cbiAgICogQHBhcmFtIHt7Y29uZmlndXJhdGlvbj86IGltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgY29ubmVjdGlvbj86IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fX0gW2FyZ3NdIC0gT3B0aW9uYWwgY29uZmlndXJhdGlvbiBhbmQgZXhwbGljaXQgbWV0YWRhdGEgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgbW9kZWwgY2xhc3MgaXMgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZW5zdXJlSW5pdGlhbGl6ZWQoYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge2NvbmZpZ3VyYXRpb24sIGNvbm5lY3Rpb24sIC4uLnJlc3RBcmdzfSA9IGFyZ3NcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZWQpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlKSB7XG4gICAgICBhd2FpdCB0aGlzLl9pbml0aWFsaXplUmVjb3JkUHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZWRDb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvbiB8fCB0aGlzLl9jb25maWd1cmF0aW9uIHx8IENvbmZpZ3VyYXRpb24uY3VycmVudCgpXG5cbiAgICBjb25zdCBpbml0aWFsaXplUmVjb3JkUHJvbWlzZSA9IHRoaXMuaW5pdGlhbGl6ZVJlY29yZCh7Y29uZmlndXJhdGlvbjogcmVzb2x2ZWRDb25maWd1cmF0aW9uLCBjb25uZWN0aW9ufSlcblxuICAgIHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlID0gaW5pdGlhbGl6ZVJlY29yZFByb21pc2VcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBpbml0aWFsaXplUmVjb3JkUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVJlY29yZFByb21pc2UgPT09IGluaXRpYWxpemVSZWNvcmRQcm9taXNlKSB7XG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlID0gbnVsbFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGF0dHJpYnV0ZS5cbiAgICovXG4gIF9oYXNBdHRyaWJ1dGUodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09IFwic3RyaW5nXCIpIHtcbiAgICAgIHZhbHVlID0gdmFsdWUudHJpbSgpXG4gICAgfVxuXG4gICAgaWYgKHZhbHVlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgaW5pdGlhbGl6ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBzdGF0aWMgaXNJbml0aWFsaXplZCgpIHtcbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZWQpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2VydCBoYXMgYmVlbiBpbml0aWFsaXplZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIF9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKSB7XG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVkKSByZXR1cm5cblxuICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9IHVzZWQgYmVmb3JlIGluaXRpYWxpemF0aW9uLiBDYWxsICR7dGhpcy5uYW1lfS5pbml0aWFsaXplUmVjb3JkKC4uLikgb3IgY29uZmlndXJhdGlvbi5pbml0aWFsaXplKCkuYClcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWZpbmVzIHRyYW5zbGF0aW9uIGFjY2Vzc29ycyBhbmQgaW5pdGlhbGl6ZXMgdGhlIGdlbmVyYXRlZCB0cmFuc2xhdGlvblxuICAgKiBjbGFzcyB0aHJvdWdoIHRoZSBzYW1lIG1ldGFkYXRhIGNvbm5lY3Rpb24gYXMgdGhlIHRyYW5zbGF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBNZXRhZGF0YSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRyYW5zbGF0aW9uIG1ldGFkYXRhIGlzIHJlYWR5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIF9kZWZpbmVUcmFuc2xhdGlvbk1ldGhvZHMoY29ubmVjdGlvbikge1xuICAgIGlmICh0aGlzLl90cmFuc2xhdGlvbnMgJiYgT2JqZWN0LmtleXModGhpcy5fdHJhbnNsYXRpb25zKS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBsb2NhbGVzID0gdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldExvY2FsZXMoKVxuXG4gICAgICBpZiAoIWxvY2FsZXMpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsZXMgaGFzbid0IGJlZW4gc2V0IGluIHRoZSBjb25maWd1cmF0aW9uXCIpXG5cbiAgICAgIGNvbnN0IFRyYW5zbGF0aW9uQ2xhc3MgPSB0aGlzLmdldFRyYW5zbGF0aW9uQ2xhc3MoKVxuICAgICAgY29uc3QgQm91bmRUcmFuc2xhdGlvbkNsYXNzID0gdGhpcy5fcmVjb3JkTWV0YWRhdGFCaW5kZXIgPyB0aGlzLl9yZWNvcmRNZXRhZGF0YUJpbmRlcihUcmFuc2xhdGlvbkNsYXNzKSA6IFRyYW5zbGF0aW9uQ2xhc3NcblxuICAgICAgYXdhaXQgQm91bmRUcmFuc2xhdGlvbkNsYXNzLmluaXRpYWxpemVSZWNvcmQoe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIGNvbm5lY3Rpb25cbiAgICAgIH0pXG5cbiAgICAgIGZvciAoY29uc3QgbmFtZSBpbiB0aGlzLl90cmFuc2xhdGlvbnMpIHtcbiAgICAgICAgY29uc3QgbmFtZUNhbWVsaXplZCA9IGluZmxlY3Rpb24uY2FtZWxpemUobmFtZSlcbiAgICAgICAgY29uc3Qgc2V0dGVyTWV0aG9kTmFtZSA9IGBzZXQke25hbWVDYW1lbGl6ZWR9YFxuICAgICAgICBjb25zdCBwcm90b3R5cGUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzLnByb3RvdHlwZSkpXG5cbiAgICAgICAgcHJvdG90eXBlW25hbWVdID0gZnVuY3Rpb24gZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZSgpIHtcbiAgICAgICAgICBjb25zdCBsb2NhbGUgPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0TG9jYWxlKClcblxuICAgICAgICAgIHJldHVybiB0aGlzLl9nZXRUcmFuc2xhdGVkQXR0cmlidXRlV2l0aEZhbGxiYWNrKG5hbWUsIGxvY2FsZSlcbiAgICAgICAgfVxuXG4gICAgICAgIHByb3RvdHlwZVtgaGFzJHtuYW1lQ2FtZWxpemVkfWBdID0gZnVuY3Rpb24gaGFzVHJhbnNsYXRlZEF0dHJpYnV0ZSgpIHtcbiAgICAgICAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGR5bmFtaWNUaGlzW25hbWVdXG5cbiAgICAgICAgICBpZiAodHlwZW9mIGNhbmRpZGF0ZSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gY2FuZGlkYXRlLmJpbmQodGhpcykoKVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5faGFzQXR0cmlidXRlKHZhbHVlKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGNhbmRpZGF0ZSB0byBiZSBhIGZ1bmN0aW9uIGJ1dCBpdCB3YXM6ICR7dHlwZW9mIGNhbmRpZGF0ZX1gKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHByb3RvdHlwZVtzZXR0ZXJNZXRob2ROYW1lXSA9IGZ1bmN0aW9uIHNldFRyYW5zbGF0ZWRBdHRyaWJ1dGUoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gbmV3VmFsdWUpIHtcbiAgICAgICAgICBjb25zdCBsb2NhbGUgPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0TG9jYWxlKClcblxuICAgICAgICAgIHJldHVybiB0aGlzLl9zZXRUcmFuc2xhdGVkQXR0cmlidXRlKG5hbWUsIGxvY2FsZSwgbmV3VmFsdWUpXG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IGxvY2FsZSBvZiBsb2NhbGVzKSB7XG4gICAgICAgICAgY29uc3QgbG9jYWxlQ2FtZWxpemVkID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShsb2NhbGUpXG4gICAgICAgICAgY29uc3QgZ2V0dGVyTWV0aG9kTmFtZUxvY2FsaXplZCA9IGAke25hbWV9JHtsb2NhbGVDYW1lbGl6ZWR9YFxuICAgICAgICAgIGNvbnN0IHNldHRlck1ldGhvZE5hbWVMb2NhbGl6ZWQgPSBgJHtzZXR0ZXJNZXRob2ROYW1lfSR7bG9jYWxlQ2FtZWxpemVkfWBcbiAgICAgICAgICBjb25zdCBoYXNNZXRob2ROYW1lTG9jYWxpemVkID0gYGhhcyR7aW5mbGVjdGlvbi5jYW1lbGl6ZShuYW1lKX0ke2xvY2FsZUNhbWVsaXplZH1gXG5cbiAgICAgICAgICBwcm90b3R5cGVbZ2V0dGVyTWV0aG9kTmFtZUxvY2FsaXplZF0gPSBmdW5jdGlvbiBnZXRUcmFuc2xhdGVkQXR0cmlidXRlV2l0aExvY2FsZSgpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9nZXRUcmFuc2xhdGVkQXR0cmlidXRlKG5hbWUsIGxvY2FsZSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwcm90b3R5cGVbc2V0dGVyTWV0aG9kTmFtZUxvY2FsaXplZF0gPSBmdW5jdGlvbiBzZXRUcmFuc2xhdGVkQXR0cmlidXRlV2l0aExvY2FsZSgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBuZXdWYWx1ZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGUobmFtZSwgbG9jYWxlLCBuZXdWYWx1ZSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwcm90b3R5cGVbaGFzTWV0aG9kTmFtZUxvY2FsaXplZF0gPSBmdW5jdGlvbiBoYXNUcmFuc2xhdGVkQXR0cmlidXRlKCkge1xuICAgICAgICAgICAgY29uc3QgZHluYW1pY1RoaXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcbiAgICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGR5bmFtaWNUaGlzW2dldHRlck1ldGhvZE5hbWVMb2NhbGl6ZWRdXG5cbiAgICAgICAgICAgIGlmICh0eXBlb2YgY2FuZGlkYXRlID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgICBjb25zdCB2YWx1ZSA9IGNhbmRpZGF0ZS5iaW5kKHRoaXMpKClcblxuICAgICAgICAgICAgICByZXR1cm4gdGhpcy5faGFzQXR0cmlidXRlKHZhbHVlKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBjYW5kaWRhdGUgdG8gYmUgYSBmdW5jdGlvbiBidXQgaXQgd2FzOiAke3R5cGVvZiBjYW5kaWRhdGV9YClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJlZCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBjb25maWd1cmVkIG5vbi10ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIHN0YXRpYyBnZXRDb25maWd1cmVkRGF0YWJhc2VJZGVudGlmaWVyKCkge1xuICAgIHJldHVybiB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIgfHwgXCJkZWZhdWx0XCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZV0gLSBXaGV0aGVyIHRlbmFudC1zd2l0Y2hlZCBtb2RlbHMgbXVzdCByZXNvbHZlIGEgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJncy50ZW5hbnRdIC0gRXhwbGljaXQgdGVuYW50IGRlc2NyaXB0b3IgaW5zdGVhZCBvZiB0aGUgYW1iaWVudCB0ZW5hbnQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBzdGF0aWMgZ2V0RGF0YWJhc2VJZGVudGlmaWVyKHtlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZSA9IHRydWUsIHRlbmFudCA9IEN1cnJlbnQudGVuYW50KCksIC4uLnJlc3RBcmdzfSA9IHt9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGNvbnN0IHRlbmFudERhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKHRlbmFudClcblxuICAgIGlmICh0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICAgIGlmIChcbiAgICAgICAgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGUgJiZcbiAgICAgICAgdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcygpICYmXG4gICAgICAgICF0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUodGVuYW50RGF0YWJhc2VJZGVudGlmaWVyLCB0ZW5hbnQpXG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgbmV3IFRlbmFudERhdGFiYXNlU2NvcGVFcnJvcihcbiAgICAgICAgICBgJHt0aGlzLmdldE1vZGVsTmFtZSgpfSByZXNvbHZlZCB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciAke0pTT04uc3RyaW5naWZ5KHRlbmFudERhdGFiYXNlSWRlbnRpZmllcil9IGJ1dCB0aGF0IGRhdGFiYXNlIGlkZW50aWZpZXIgaXMgbm90IGFjdGl2ZSBmb3IgdGhlIGN1cnJlbnQgdGVuYW50LiBXcmFwIHRoZSBtb2RlbCBxdWVyeSBpbiBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQoLi4uKSBvciBzZXQgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzOiBmYWxzZSB0byBhbGxvdyBsZWdhY3kgZmFsbGJhY2sgYmVoYXZpb3IuYCxcbiAgICAgICAgICB7bW9kZWxOYW1lOiB0aGlzLmdldE1vZGVsTmFtZSgpfVxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJcbiAgICB9XG5cbiAgICBpZiAoZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGUgJiYgdGhpcy5fdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIgJiYgdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcygpKSB7XG4gICAgICB0aHJvdyBuZXcgVGVuYW50RGF0YWJhc2VTY29wZUVycm9yKFxuICAgICAgICBgJHt0aGlzLmdldE1vZGVsTmFtZSgpfSBpcyBjb25maWd1cmVkIHdpdGggc3dpdGNoZXNUZW5hbnREYXRhYmFzZSguLi4pIGJ1dCBubyB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciByZXNvbHZlZCBmb3IgdGhlIGN1cnJlbnQgdGVuYW50LiBXcmFwIHRoZSBtb2RlbCBxdWVyeSBpbiBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQoLi4uKSBvciBzZXQgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzOiBmYWxzZSB0byBhbGxvdyBsZWdhY3kgZmFsbGJhY2sgYmVoYXZpb3IuYCxcbiAgICAgICAge21vZGVsTmFtZTogdGhpcy5nZXRNb2RlbE5hbWUoKX1cbiAgICAgIClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5nZXRDb25maWd1cmVkRGF0YWJhc2VJZGVudGlmaWVyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHNldERhdGFiYXNlSWRlbnRpZmllcihkYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhIHRlbmFudC1hd2FyZSBkYXRhYmFzZSBpZGVudGlmaWVyIHJlc29sdmVyIGZvciB0aGlzIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8ICgoYXJnczoge21vZGVsQ2xhc3M6IHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCwgdGVuYW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwgfCB1bmRlZmluZWR9KSA9PiBzdHJpbmcgfCB1bmRlZmluZWQpfSBkYXRhYmFzZUlkZW50aWZpZXJPclJlc29sdmVyIC0gU3RhdGljIGlkZW50aWZpZXIgb3IgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzd2l0Y2hlc1RlbmFudERhdGFiYXNlKGRhdGFiYXNlSWRlbnRpZmllck9yUmVzb2x2ZXIpIHtcbiAgICB0aGlzLl90ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlciA9IGRhdGFiYXNlSWRlbnRpZmllck9yUmVzb2x2ZXJcblxuICAgIGlmICh0aGlzLl90cmFuc2xhdGlvbkNsYXNzKSB7XG4gICAgICBjb25zdCB0cmFuc2xhdGVkTW9kZWxDbGFzcyA9IHRoaXNcblxuICAgICAgdGhpcy5fdHJhbnNsYXRpb25DbGFzcy5zd2l0Y2hlc1RlbmFudERhdGFiYXNlKCh7dGVuYW50fSkgPT4gdHJhbnNsYXRlZE1vZGVsQ2xhc3MuZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKHRlbmFudCkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgbW9kZWwgcmVzb2x2ZXMgaXRzIGRhdGFiYXNlIGZyb20gdGhlIGN1cnJlbnQgdGVuYW50LlxuICAgKi9cbiAgc3RhdGljIGhhc1RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKCkge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMuX3RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbdGVuYW50XSAtIFRlbmFudCBvdmVycmlkZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUZW5hbnQtc2NvcGVkIGRhdGFiYXNlIGlkZW50aWZpZXIgd2hlbiBjb25maWd1cmVkLlxuICAgKi9cbiAgc3RhdGljIGdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcih0ZW5hbnQgPSBDdXJyZW50LnRlbmFudCgpKSB7XG4gICAgY29uc3QgdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIgPSB0aGlzLl90ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlclxuXG4gICAgaWYgKCF0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlcikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlciA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoe1xuICAgICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgICB0ZW5hbnRcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBUaGUgYXR0cmlidXRlLlxuICAgKi9cbiAgZ2V0QXR0cmlidXRlKG5hbWUpIHtcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKG5hbWUpXG5cbiAgICBpZiAoIXRoaXMuaXNOZXdSZWNvcmQoKSAmJiAhKGNvbHVtbk5hbWUgaW4gdGhpcy5fYXR0cmlidXRlcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IyR7bmFtZX0gYXR0cmlidXRlIGhhc24ndCBiZWVuIGxvYWRlZCB5ZXQgaW4gJHtPYmplY3Qua2V5cyh0aGlzLl9hdHRyaWJ1dGVzKS5qb2luKFwiLCBcIil9YClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0cmlidXRlc1tjb2x1bW5OYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gLSBUaGUgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBnZXRNb2RlbENsYXNzKCkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG5cbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24pIHJldHVybiB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi5tb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgICByZXR1cm4gbW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBuZXdWYWx1ZSAtIE5ldyB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0QXR0cmlidXRlKG5hbWUsIG5ld1ZhbHVlKSB7XG4gICAgLy8gUmVzb2x2ZSByYXcgY29sdW1uIG5hbWVzIChcIlZBX8OcYkF0dHJpYnV0SURcIiwgXCJJUFwiKSBhbmQgY2FzaW5nIHZhcmlhbnRzIChcInZBRnVua3Rpb25JRFwiKSB0byB0aGVcbiAgICAvLyBjYW5vbmljYWwgYXR0cmlidXRlIHRoZSBtb2RlbCBiYXNlIGdlbmVyYXRlcyBpdHMgc2V0dGVyIGZyb20gKHNldFZBVWViYXR0cmlidXRpZCwgc2V0SXAsIOKApikuXG4gICAgY29uc3QgY2Fub25pY2FsTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnJlc29sdmVBdHRyaWJ1dGVOYW1lKG5hbWUpID8/IG5hbWVcbiAgICBjb25zdCByZXF1ZXN0ZWRTZXR0ZXJOYW1lID0gYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShjYW5vbmljYWxOYW1lKX1gXG4gICAgY29uc3Qgc2V0dGVyTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmZpbmRNZW1iZXJOYW1lSW5zZW5zaXRpdmUodGhpcywgcmVxdWVzdGVkU2V0dGVyTmFtZSlcbiAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKHZhbHVlOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZD59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG5cbiAgICB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fYXNzZXJ0SGFzQmVlbkluaXRpYWxpemVkKClcbiAgICBpZiAoIXRoaXMuZ2V0TW9kZWxDbGFzcygpLmlzSW5pdGlhbGl6ZWQoKSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gbW9kZWwgaXNuJ3QgaW5pdGlhbGl6ZWQgeWV0YClcbiAgICBpZiAoIXNldHRlck5hbWUpIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBzZXR0ZXIgbWV0aG9kOiAke3RoaXMuY29uc3RydWN0b3IubmFtZX0jJHtyZXF1ZXN0ZWRTZXR0ZXJOYW1lfWApXG5cbiAgICBkeW5hbWljVGhpc1tzZXR0ZXJOYW1lXShuZXdWYWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjb2x1bW4gYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG5ld1ZhbHVlIC0gTmV3IHZhbHVlLlxuICAgKi9cbiAgX3NldENvbHVtbkF0dHJpYnV0ZShuYW1lLCBuZXdWYWx1ZSkge1xuICAgIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIGlmICghdGhpcy5nZXRNb2RlbENsYXNzKCkuX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUpIHRocm93IG5ldyBFcnJvcihcIk5vIGF0dHJpYnV0ZS10by1jb2x1bW4gbWFwcGluZy4gSGFzIHJlY29yZCBiZWVuIGluaXRpYWxpemVkP1wiKVxuXG4gICAgY29uc3QgcmVzb2x2ZWROYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucmVzb2x2ZUF0dHJpYnV0ZU5hbWUobmFtZSlcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gcmVzb2x2ZWROYW1lID8gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpW3Jlc29sdmVkTmFtZV0gOiB1bmRlZmluZWRcblxuICAgIGlmICghY29sdW1uTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCBmaWd1cmUgb3V0IGNvbHVtbiBuYW1lIGZvciBhdHRyaWJ1dGU6ICR7bmFtZX1gKVxuXG4gICAgbGV0IG5vcm1hbGl6ZWRWYWx1ZSA9IG5ld1ZhbHVlXG4gICAgY29uc3QgY29sdW1uVHlwZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtblR5cGVCeU5hbWUoY29sdW1uTmFtZSlcblxuICAgIGlmIChjb2x1bW5UeXBlICYmIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9pc0RhdGVMaWtlVHlwZShjb2x1bW5UeXBlKSkge1xuICAgICAgbm9ybWFsaXplZFZhbHVlID0gdGhpcy5fbm9ybWFsaXplRGF0ZVZhbHVlKG5ld1ZhbHVlKVxuICAgIH1cblxuICAgIG5vcm1hbGl6ZWRWYWx1ZSA9IHRoaXMuX25vcm1hbGl6ZUJvb2xlYW5WYWx1ZUZvcldyaXRlKHthdHRyaWJ1dGVOYW1lOiBuYW1lLCBjb2x1bW5UeXBlLCB2YWx1ZTogbm9ybWFsaXplZFZhbHVlfSlcblxuICAgIGlmICh0aGlzLl9hdHRyaWJ1dGVzW2NvbHVtbk5hbWVdICE9IG5vcm1hbGl6ZWRWYWx1ZSkge1xuICAgICAgdGhpcy5fY2xlYXJCZWxvbmdzVG9SZWxhdGlvbnNoaXBGb3JDaGFuZ2VkRm9yZWlnbktleShjb2x1bW5OYW1lLCBub3JtYWxpemVkVmFsdWUpXG4gICAgICB0aGlzLl9jaGFuZ2VzW2NvbHVtbk5hbWVdID0gbm9ybWFsaXplZFZhbHVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBsb2FkZWQgYmVsb25ncy10byBjYWNoZXMgd2hlbiBjYWxsZXJzIGFzc2lnbiB0aGUgZm9yZWlnbiBrZXkgZGlyZWN0bHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ2hhbmdlZCBkYXRhYmFzZSBjb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbm9ybWFsaXplZFZhbHVlIC0gTmV3IG5vcm1hbGl6ZWQgY29sdW1uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfY2xlYXJCZWxvbmdzVG9SZWxhdGlvbnNoaXBGb3JDaGFuZ2VkRm9yZWlnbktleShjb2x1bW5OYW1lLCBub3JtYWxpemVkVmFsdWUpIHtcbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcCBvZiB0aGlzLl9iZWxvbmdzVG9SZWxhdGlvbnNoaXBzRm9yRm9yZWlnbktleShjb2x1bW5OYW1lKSkge1xuICAgICAgaWYgKHRoaXMuX2JlbG9uZ3NUb1JlbGF0aW9uc2hpcE1hdGNoZXNGb3JlaWduS2V5VmFsdWUoe25vcm1hbGl6ZWRWYWx1ZSwgcmVsYXRpb25zaGlwfSkpIGNvbnRpbnVlXG5cbiAgICAgIHRoaXMuX2NsZWFyTG9hZGVkQmVsb25nc1RvUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWxvbmdzIHRvIHJlbGF0aW9uc2hpcHMgZm9yIGZvcmVpZ24ga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENoYW5nZWQgZGF0YWJhc2UgY29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBpbnN0YW5jZXMgdGhhdCB1c2UgdGhlIGNoYW5nZWQgZm9yZWlnbiBrZXkuXG4gICAqL1xuICBfYmVsb25nc1RvUmVsYXRpb25zaGlwc0ZvckZvcmVpZ25LZXkoY29sdW1uTmFtZSkge1xuICAgIGlmICghdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKSByZXR1cm4gW11cblxuICAgIHJldHVybiBPYmplY3RcbiAgICAgIC52YWx1ZXModGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKVxuICAgICAgLmZpbHRlcigocmVsYXRpb25zaGlwKSA9PiB0aGlzLl9iZWxvbmdzVG9SZWxhdGlvbnNoaXBVc2VzRm9yZWlnbktleSh7Y29sdW1uTmFtZSwgcmVsYXRpb25zaGlwfSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWxvbmdzIHRvIHJlbGF0aW9uc2hpcCB1c2VzIGZvcmVpZ24ga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlbGF0aW9uc2hpcCBtYXRjaCBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbk5hbWUgLSBDaGFuZ2VkIGRhdGFiYXNlIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVsYXRpb25zaGlwIGlzIGEgYmVsb25ncy10byB1c2luZyB0aGUgY2hhbmdlZCBmb3JlaWduIGtleS5cbiAgICovXG4gIF9iZWxvbmdzVG9SZWxhdGlvbnNoaXBVc2VzRm9yZWlnbktleSh7Y29sdW1uTmFtZSwgcmVsYXRpb25zaGlwfSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0VHlwZSgpICE9IFwiYmVsb25nc1RvXCIpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgZm9yZWlnbktleSA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcbiAgICBjb25zdCBmb3JlaWduS2V5QXR0cmlidXRlID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW2ZvcmVpZ25LZXldXG5cbiAgICByZXR1cm4gZm9yZWlnbktleSA9PSBjb2x1bW5OYW1lIHx8IGZvcmVpZ25LZXlBdHRyaWJ1dGUgPT0gY29sdW1uTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVsb25ncyB0byByZWxhdGlvbnNoaXAgbWF0Y2hlcyBmb3JlaWduIGtleSB2YWx1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZWxhdGlvbnNoaXAgY2FjaGUgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLm5vcm1hbGl6ZWRWYWx1ZSAtIE5ldyBub3JtYWxpemVkIGNvbHVtbiB2YWx1ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5yZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGxvYWRlZCByZWxhdGVkIHJlY29yZCBzdGlsbCBtYXRjaGVzIHRoZSBjaGFuZ2VkIGZvcmVpZ24ga2V5LlxuICAgKi9cbiAgX2JlbG9uZ3NUb1JlbGF0aW9uc2hpcE1hdGNoZXNGb3JlaWduS2V5VmFsdWUoe25vcm1hbGl6ZWRWYWx1ZSwgcmVsYXRpb25zaGlwfSkge1xuICAgIGNvbnN0IGxvYWRlZCA9IHJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG5cbiAgICBpZiAoIWxvYWRlZCkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZGVkKSkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKCFyZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiBsb2FkZWQucmVhZENvbHVtbihyZWxhdGlvbnNoaXAuZ2V0UHJpbWFyeUtleSgpKSA9PSBub3JtYWxpemVkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBmb3JlaWduIGtleSB2YWx1ZSBmb3IgYSBiZWxvbmdzLXRvIHJlbGF0aW9uc2hpcCBhc3NpZ25tZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlbGF0aW9uc2hpcCBhc3NpZ25tZW50IGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MubW9kZWwgLSBBc3NpZ25lZCBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlbGF0aW9uc2hpcCAtIEJlbG9uZ3MtdG8gcmVsYXRpb25zaGlwIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gLSBGb3JlaWduIGtleSB2YWx1ZSBmb3IgdGhlIGFzc2lnbm1lbnQuXG4gICAqL1xuICBfYmVsb25nc1RvRm9yZWlnbktleVZhbHVlKHttb2RlbCwgcmVsYXRpb25zaGlwfSkge1xuICAgIGlmIChtb2RlbCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICAgIGlmICghKG1vZGVsIGluc3RhbmNlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQpKSB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgbW9kZWwgdHlwZTogJHt0eXBlb2YgbW9kZWx9YClcblxuICAgIHJldHVybiAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9ICovIChtb2RlbC5yZWFkQ29sdW1uKHJlbGF0aW9uc2hpcC5nZXRQcmltYXJ5S2V5KCkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgbG9hZGVkIGJlbG9uZ3MgdG8gcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9jbGVhckxvYWRlZEJlbG9uZ3NUb1JlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXApIHtcbiAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHVuZGVmaW5lZClcbiAgICByZWxhdGlvbnNoaXAuc2V0UHJlbG9hZGVkKGZhbHNlKVxuICAgIHJlbGF0aW9uc2hpcC5zZXREaXJ0eShmYWxzZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBkYXRlIHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBkYXRlIHZhbHVlLlxuICAgKi9cbiAgX25vcm1hbGl6ZURhdGVWYWx1ZSh2YWx1ZSkge1xuICAgIHJldHVybiBub3JtYWxpemVEYXRlVmFsdWVGb3JXcml0ZSh2YWx1ZSwge3RpbWVab25lOiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fdGltZVpvbmVGb3JEYXRlV3JpdGUoKX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgc3FsaXRlIGJvb2xlYW4gdmFsdWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBfbm9ybWFsaXplU3FsaXRlQm9vbGVhblZhbHVlKHtjb2x1bW5UeXBlLCB2YWx1ZX0pIHtcbiAgICBpZiAodGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0RGF0YWJhc2VUeXBlKCkgIT0gXCJzcWxpdGVcIikgcmV0dXJuIHZhbHVlXG4gICAgaWYgKCFjb2x1bW5UeXBlKSByZXR1cm4gdmFsdWVcbiAgICBpZiAoY29sdW1uVHlwZS50b0xvd2VyQ2FzZSgpICE9PSBcImJvb2xlYW5cIikgcmV0dXJuIHZhbHVlXG4gICAgaWYgKHZhbHVlID09PSB0cnVlKSByZXR1cm4gMVxuICAgIGlmICh2YWx1ZSA9PT0gZmFsc2UpIHJldHVybiAwXG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGEgYm9vbGVhbiB2YWx1ZSBiZWZvcmUgc3RvcmluZy4gQSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGF0dHJpYnV0ZSBjYXN0IHN0b3Jlc1xuICAgKiBib29sZWFucyBhcyAxLzAgb25seSBmb3IgaW50ZWdlci1iYWNrZWQgY29sdW1ucyAoZS5nLiBhbiBNU1NRTCBgYml0YCkuIENvbHVtbnMgd2hvc2VcbiAgICogdW5kZXJseWluZyB0eXBlIGlzIGFscmVhZHkgYSBuYXRpdmUgYm9vbGVhbiAoZS5nLiBQb3N0Z3JlcyBgYm9vbGVhbmApIGtlZXAgYHRydWVgL2BmYWxzZWBcbiAgICogc28gdGhlIGRyaXZlciBjYW4gZW1pdCB0aGUgcHJvcGVyIGJvb2xlYW4gbGl0ZXJhbDsgb3RoZXJ3aXNlIHRoZSBzcWxpdGUtb25seSBub3JtYWxpemVyIGFwcGxpZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZSBiZWluZyB3cml0dGVuLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gYXJncy5jb2x1bW5UeXBlIC0gQ29sdW1uIHR5cGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBWYWx1ZSB0byBub3JtYWxpemUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICAgKi9cbiAgX25vcm1hbGl6ZUJvb2xlYW5WYWx1ZUZvcldyaXRlKHthdHRyaWJ1dGVOYW1lLCBjb2x1bW5UeXBlLCB2YWx1ZX0pIHtcbiAgICBpZiAoIXRoaXMuZ2V0TW9kZWxDbGFzcygpLl9kZWNsYXJlZEJvb2xlYW5TdG9yZXNBc0ludGVnZXIoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHJldHVybiB0aGlzLl9ub3JtYWxpemVTcWxpdGVCb29sZWFuVmFsdWUoe2NvbHVtblR5cGUsIHZhbHVlfSlcbiAgICB9XG5cbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiAxXG4gICAgaWYgKHZhbHVlID09PSBmYWxzZSkgcmV0dXJuIDBcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGF0dHJpYnV0ZSBjYXN0IGlzIGJhY2tlZCBieSBhbiBpbnRlZ2VyIGNvbHVtbiAoZS5nLiBhbiBNU1NRTFxuICAgKiBgYml0YCksIHNvIGJvb2xlYW5zIG11c3QgYmUgc3RvcmVkIGFzIDEvMC4gQSBuYXRpdmUgYm9vbGVhbiBjb2x1bW4gKGUuZy4gUG9zdGdyZXMgYGJvb2xlYW5gKVxuICAgKiByZXR1cm5zIGZhbHNlIGFuZCBrZWVwcyBgdHJ1ZWAvYGZhbHNlYCBmb3IgdGhlIGRyaXZlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZGVjbGFyZWQgYm9vbGVhbiBpcyBzdG9yZWQgYXMgYW4gaW50ZWdlci5cbiAgICovXG4gIHN0YXRpYyBfZGVjbGFyZWRCb29sZWFuU3RvcmVzQXNJbnRlZ2VyKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAodGhpcy5nZXRBdHRyaWJ1dGVDYXN0KGF0dHJpYnV0ZU5hbWUpICE9PSBcImJvb2xlYW5cIikgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClbYXR0cmlidXRlTmFtZV1cbiAgICBjb25zdCBpbnRyb3NwZWN0ZWRUeXBlID0gY29sdW1uTmFtZSA/IHRoaXMuZ2V0Q29sdW1uc0hhc2goKVtjb2x1bW5OYW1lXT8uZ2V0VHlwZSgpIDogdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gdHlwZW9mIGludHJvc3BlY3RlZFR5cGUgPT09IFwic3RyaW5nXCIgJiYgaW50cm9zcGVjdGVkVHlwZS50b0xvd2VyQ2FzZSgpICE9PSBcImJvb2xlYW5cIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHRbXX0gLSBUaGUgY29sdW1ucy5cbiAgICovXG4gIHN0YXRpYyBnZXRDb2x1bW5zKCkge1xuICAgIHRoaXMuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgaWYgKCF0aGlzLl9jb2x1bW5zKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5uYW1lfSBoYXNuJ3QgYmVlbiBpbml0aWFsaXplZCB5ZXRgKVxuXG4gICAgcmV0dXJuIHRoaXMuX2NvbHVtbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb2x1bW5zIGhhc2guXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSAtIFRoZSBjb2x1bW5zIGhhc2guXG4gICAqL1xuICBzdGF0aWMgZ2V0Q29sdW1uc0hhc2goKSB7XG4gICAgaWYgKCF0aGlzLl9jb2x1bW5zQXNIYXNoKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgICAgdGhpcy5fY29sdW1uc0FzSGFzaCA9IHt9XG5cbiAgICAgIGZvciAoY29uc3QgY29sdW1uIG9mIHRoaXMuZ2V0Q29sdW1ucygpKSB7XG4gICAgICAgIHRoaXMuX2NvbHVtbnNBc0hhc2hbY29sdW1uLmdldE5hbWUoKV0gPSBjb2x1bW5cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fY29sdW1uc0FzSGFzaFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbHVtbiB0eXBlIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgY29sdW1uIHR5cGUgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRDb2x1bW5UeXBlQnlOYW1lKG5hbWUpIHtcbiAgICBpZiAoIXRoaXMuX2NvbHVtblR5cGVCeU5hbWUpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD59ICovXG4gICAgICB0aGlzLl9jb2x1bW5UeXBlQnlOYW1lID0ge31cblxuICAgICAgZm9yIChjb25zdCBjb2x1bW4gb2YgdGhpcy5nZXRDb2x1bW5zKCkpIHtcbiAgICAgICAgdGhpcy5fY29sdW1uVHlwZUJ5TmFtZVtjb2x1bW4uZ2V0TmFtZSgpXSA9IGNvbHVtbi5nZXRUeXBlKClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gdGhpcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbbmFtZV1cblxuICAgIGlmIChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgICBjb25zdCBjYXN0ID0gdGhpcy5nZXRBdHRyaWJ1dGVDYXN0KGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGlmIChjYXN0KSByZXR1cm4gY2FzdFxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9jb2x1bW5UeXBlQnlOYW1lW25hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBkYXRlIGxpa2UgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBUeXBlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZGF0ZSBsaWtlIHR5cGUuXG4gICAqL1xuICBzdGF0aWMgX2lzRGF0ZUxpa2VUeXBlKHR5cGUpIHtcbiAgICBjb25zdCBub3JtYWxpemVkVHlwZSA9IHR5cGUudG9Mb3dlckNhc2UoKVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRUeXBlID09IFwiZGF0ZVwiIHx8XG4gICAgICBub3JtYWxpemVkVHlwZSA9PSBcImRhdGV0aW1lXCIgfHxcbiAgICAgIG5vcm1hbGl6ZWRUeXBlID09IFwidGltZXN0YW1wXCIgfHxcbiAgICAgIG5vcm1hbGl6ZWRUeXBlID09IFwidGltZXN0YW1wdHpcIiB8fFxuICAgICAgbm9ybWFsaXplZFR5cGUuc3RhcnRzV2l0aChcInRpbWVzdGFtcCBcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb2x1bW4gbmFtZXMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSAtIFRoZSBjb2x1bW4gbmFtZXMuXG4gICAqL1xuICBzdGF0aWMgZ2V0Q29sdW1uTmFtZXMoKSB7XG4gICAgaWYgKCF0aGlzLl9jb2x1bW5OYW1lcykge1xuICAgICAgdGhpcy5fY29sdW1uTmFtZXMgPSB0aGlzLmdldENvbHVtbnMoKS5tYXAoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fY29sdW1uTmFtZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSB0YWJsZS5cbiAgICovXG4gIHN0YXRpYyBfZ2V0VGFibGUoKSB7XG4gICAgaWYgKCF0aGlzLl90YWJsZSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubmFtZX0gaGFzbid0IGJlZW4gaW5pdGlhbGl6ZWQgeWV0YClcblxuICAgIHJldHVybiB0aGlzLl90YWJsZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IG11bHRpcGxlLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEBwYXJhbSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gcm93cyAtIFJvd3MgdG8gaW5zZXJ0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuY2FzdF0gLSBXaGV0aGVyIHRvIGNhc3QgdmFsdWVzIGJhc2VkIG9uIGNvbHVtbiB0eXBlcy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5yZXRyeUluZGl2aWR1YWxseU9uRmFpbHVyZV0gLSBSZXRyeSByb3dzIGluZGl2aWR1YWxseSBpZiBhIGJhdGNoIGluc2VydCBmYWlscy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5yZXR1cm5SZXN1bHRzXSAtIFJldHVybiBzdWNjZWVkZWQvZmFpbGVkIHJvd3MgaW5zdGVhZCBvZiB0aHJvd2luZyB3aGVuIHJldHJpZXMgZmFpbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZCB8IHtzdWNjZWVkZWRSb3dzOiBBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+LCBmYWlsZWRSb3dzOiBBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+LCBlcnJvcnM6IEFycmF5PHtyb3c6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59Pn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGluc2VydE11bHRpcGxlKGNvbHVtbnMsIHJvd3MsIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtjYXN0ID0gdHJ1ZSwgcmV0cnlJbmRpdmlkdWFsbHlPbkZhaWx1cmUgPSBmYWxzZSwgcmV0dXJuUmVzdWx0cyA9IGZhbHNlLCAuLi5yZXN0QXJnc30gPSBhcmdzXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFJvd3MgPSBjYXN0XG4gICAgICA/IHRoaXMuX25vcm1hbGl6ZUluc2VydE11bHRpcGxlUm93cyh7Y29sdW1ucywgcm93c30pXG4gICAgICA6IHJvd3NcbiAgICBjb25zdCB0YWJsZU5hbWUgPSB0aGlzLnRhYmxlTmFtZSgpXG5cbiAgICBpZiAoIXJldHJ5SW5kaXZpZHVhbGx5T25GYWlsdXJlKSB7XG4gICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS5pbnNlcnRNdWx0aXBsZSh0YWJsZU5hbWUsIGNvbHVtbnMsIG5vcm1hbGl6ZWRSb3dzKVxuICAgICAgaWYgKHJldHVyblJlc3VsdHMpIHJldHVybiB7c3VjY2VlZGVkUm93czogbm9ybWFsaXplZFJvd3Muc2xpY2UoKSwgZmFpbGVkUm93czogW10sIGVycm9yczogW119XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLy8gV3JhcCB0aGUgYmF0Y2ggaW4gYSB0cmFuc2FjdGlvbi9zYXZlcG9pbnQuIE9uIGRhdGFiYXNlcyB0aGF0IGFib3J0IHRoZVxuICAgICAgLy8gd2hvbGUgdHJhbnNhY3Rpb24gd2hlbiBhIHN0YXRlbWVudCBmYWlscyAoUG9zdGdyZVNRTCksIGEgZmFpbGVkIGJhdGNoXG4gICAgICAvLyB3b3VsZCBvdGhlcndpc2UgcG9pc29uIHRoZSBzdXJyb3VuZGluZyB0cmFuc2FjdGlvbiBzbyB0aGF0IHRoZVxuICAgICAgLy8gaW5kaXZpZHVhbCByZXRyaWVzIGJlbG93IGFsbCBmYWlsIHdpdGggXCJjdXJyZW50IHRyYW5zYWN0aW9uIGlzIGFib3J0ZWRcIi5cbiAgICAgIC8vIHRyYW5zYWN0aW9uKCkgb3BlbnMgYSBzYXZlcG9pbnQgd2hlbiBhbHJlYWR5IGluc2lkZSBhIHRyYW5zYWN0aW9uIGFuZCBhXG4gICAgICAvLyByZWFsIHRyYW5zYWN0aW9uIG90aGVyd2lzZSwgc28gYSBmYWlsdXJlIHJvbGxzIGJhY2sgb25seSB0aGlzIGF0dGVtcHQuXG4gICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLmluc2VydE11bHRpcGxlKHRhYmxlTmFtZSwgY29sdW1ucywgbm9ybWFsaXplZFJvd3MpXG4gICAgICB9KVxuICAgICAgaWYgKHJldHVyblJlc3VsdHMpIHJldHVybiB7c3VjY2VlZGVkUm93czogbm9ybWFsaXplZFJvd3Muc2xpY2UoKSwgZmFpbGVkUm93czogW10sIGVycm9yczogW119XG4gICAgICByZXR1cm5cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qKlxuICAgICAgICogUmVzdWx0cy5cbiAgICAgICAqIEB0eXBlIHt7c3VjY2VlZGVkUm93czogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W10sIGZhaWxlZFJvd3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdLCBlcnJvcnM6IEFycmF5PHtyb3c6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59fSAqL1xuICAgICAgY29uc3QgcmVzdWx0cyA9IHtcbiAgICAgICAgc3VjY2VlZGVkUm93czogW10sXG4gICAgICAgIGZhaWxlZFJvd3M6IFtdLFxuICAgICAgICBlcnJvcnM6IFtdXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIG5vcm1hbGl6ZWRSb3dzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgLy8gRWFjaCByZXRyeSBydW5zIGluIGl0cyBvd24gc2F2ZXBvaW50IHNvIGEgZmFpbGVkIHJvdyByb2xscyBiYWNrIG9ubHlcbiAgICAgICAgICAvLyB0aGF0IHJvdyBhbmQgbGVhdmVzIHRoZSBzdXJyb3VuZGluZyB0cmFuc2FjdGlvbiB1c2FibGUgZm9yIHRoZSByZXN0LlxuICAgICAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLmluc2VydE11bHRpcGxlKHRhYmxlTmFtZSwgY29sdW1ucywgW3Jvd10pXG4gICAgICAgICAgfSlcbiAgICAgICAgICByZXN1bHRzLnN1Y2NlZWRlZFJvd3MucHVzaChyb3cpXG4gICAgICAgIH0gY2F0Y2ggKHJvd0Vycm9yKSB7XG4gICAgICAgICAgcmVzdWx0cy5mYWlsZWRSb3dzLnB1c2gocm93KVxuICAgICAgICAgIHJlc3VsdHMuZXJyb3JzLnB1c2goe3JvdywgZXJyb3I6IHJvd0Vycm9yfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAocmVzdWx0cy5mYWlsZWRSb3dzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgY29tYmluZWRFcnJvcnMgPSByZXN1bHRzLmVycm9ycy5tYXAoKGVudHJ5LCBpbmRleCkgPT4ge1xuICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlbnRyeS5lcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZW50cnkuZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlbnRyeS5lcnJvcilcbiAgICAgICAgICByZXR1cm4gYFske2luZGV4fV0gJHttZXNzYWdlfS4gUm93OiAke3RoaXMuX3NhZmVTZXJpYWxpemVJbnNlcnRSb3coZW50cnkucm93KX1gXG4gICAgICAgIH0pLmpvaW4oXCIgfCBcIilcbiAgICAgICAgY29uc3QgY29tYmluZWRFcnJvciA9IG5ldyBFcnJvcihgaW5zZXJ0TXVsdGlwbGUgZmFpbGVkIGZvciAke3Jlc3VsdHMuZmFpbGVkUm93cy5sZW5ndGh9IHJvd3MuICR7Y29tYmluZWRFcnJvcnN9YClcblxuICAgICAgICBpZiAocmV0dXJuUmVzdWx0cykgcmV0dXJuIHJlc3VsdHNcbiAgICAgICAgdGhyb3cgY29tYmluZWRFcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAocmV0dXJuUmVzdWx0cykgcmV0dXJuIHJlc3VsdHNcbiAgICAgIHJldHVyblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBpbnNlcnQgbXVsdGlwbGUgcm93cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBhcmdzLmNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEBwYXJhbSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gYXJncy5yb3dzIC0gUm93cyB0byBpbnNlcnQuXG4gICAqIEByZXR1cm5zIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIE5vcm1hbGl6ZWQgcm93cy5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplSW5zZXJ0TXVsdGlwbGVSb3dzKHtjb2x1bW5zLCByb3dzfSkge1xuICAgIHJldHVybiByb3dzLm1hcCgocm93KSA9PiB7XG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkocm93KSB8fCByb3cubGVuZ3RoICE9PSBjb2x1bW5zLmxlbmd0aCkge1xuICAgICAgICBjb25zdCByb3dMZW5ndGggPSBBcnJheS5pc0FycmF5KHJvdykgPyByb3cubGVuZ3RoIDogXCJub24tYXJyYXlcIlxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgaW5zZXJ0TXVsdGlwbGUgcm93IGxlbmd0aCBtaXNtYXRjaC4gRXhwZWN0ZWQgJHtjb2x1bW5zLmxlbmd0aH0gdmFsdWVzIGJ1dCBnb3QgJHtyb3dMZW5ndGh9LiBSb3c6ICR7SlNPTi5zdHJpbmdpZnkocm93KX1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBub3JtYWxpemVkUm93ID0gW11cblxuICAgICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGNvbHVtbnMubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBjb2x1bW5zW2luZGV4XVxuICAgICAgICBjb25zdCB2YWx1ZSA9IHJvd1tpbmRleF1cblxuICAgICAgICBub3JtYWxpemVkUm93W2luZGV4XSA9IHRoaXMuX25vcm1hbGl6ZUluc2VydFZhbHVlRm9yQ29sdW1uKHtjb2x1bW5OYW1lLCB2YWx1ZX0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBub3JtYWxpemVkUm93XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNhZmUgc2VyaWFsaXplIGluc2VydCByb3cuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByb3cgLSBSb3cgdG8gc2VyaWFsaXplLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNhZmUgcm93IHJlcHJlc2VudGF0aW9uLlxuICAgKi9cbiAgc3RhdGljIF9zYWZlU2VyaWFsaXplSW5zZXJ0Um93KHJvdykge1xuICAgIHJldHVybiBmb3JtYXRWYWx1ZShyb3cpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgaW5zZXJ0IHZhbHVlIGZvciBjb2x1bW4uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIENvbHVtbiB2YWx1ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgX25vcm1hbGl6ZUluc2VydFZhbHVlRm9yQ29sdW1uKHtjb2x1bW5OYW1lLCB2YWx1ZX0pIHtcbiAgICBjb25zdCBjb2x1bW4gPSB0aGlzLmdldENvbHVtbnNIYXNoKClbY29sdW1uTmFtZV1cblxuICAgIGlmICghY29sdW1uKSByZXR1cm4gdmFsdWVcblxuICAgIGNvbnN0IGNvbHVtblR5cGUgPSBjb2x1bW4uZ2V0VHlwZSgpXG4gICAgY29uc3Qgbm9ybWFsaXplZFR5cGUgPSB0eXBlb2YgY29sdW1uVHlwZSA9PT0gXCJzdHJpbmdcIiA/IGNvbHVtblR5cGUudG9Mb3dlckNhc2UoKSA6IHVuZGVmaW5lZFxuICAgIGxldCBub3JtYWxpemVkVmFsdWUgPSB2YWx1ZVxuXG4gICAgaWYgKG5vcm1hbGl6ZWRUeXBlICYmIHRoaXMuX2lzRGF0ZUxpa2VUeXBlKG5vcm1hbGl6ZWRUeXBlKSkge1xuICAgICAgbm9ybWFsaXplZFZhbHVlID0gdGhpcy5fbm9ybWFsaXplRGF0ZVZhbHVlRm9ySW5zZXJ0KG5vcm1hbGl6ZWRWYWx1ZSlcbiAgICB9XG5cbiAgICBub3JtYWxpemVkVmFsdWUgPSB0aGlzLl9ub3JtYWxpemVTcWxpdGVCb29sZWFuVmFsdWVGb3JJbnNlcnQoe2NvbHVtblR5cGUsIHZhbHVlOiBub3JtYWxpemVkVmFsdWV9KVxuXG4gICAgaWYgKG5vcm1hbGl6ZWRWYWx1ZSA9PT0gXCJcIiAmJiBjb2x1bW4uZ2V0TnVsbCgpICYmICF0aGlzLl9pc1N0cmluZ1R5cGUobm9ybWFsaXplZFR5cGUpKSB7XG4gICAgICBub3JtYWxpemVkVmFsdWUgPSBudWxsXG4gICAgfVxuXG4gICAgaWYgKG5vcm1hbGl6ZWRUeXBlICYmIHRoaXMuX2lzTnVtZXJpY1R5cGUobm9ybWFsaXplZFR5cGUpKSB7XG4gICAgICBub3JtYWxpemVkVmFsdWUgPSB0aGlzLl9ub3JtYWxpemVOdW1lcmljVmFsdWUoe2NvbHVtblR5cGU6IG5vcm1hbGl6ZWRUeXBlLCB2YWx1ZTogbm9ybWFsaXplZFZhbHVlfSlcbiAgICB9XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBzdHJpbmcgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzdHJpbmctbGlrZSB0eXBlLlxuICAgKi9cbiAgc3RhdGljIF9pc1N0cmluZ1R5cGUoY29sdW1uVHlwZSkge1xuICAgIGlmICghY29sdW1uVHlwZSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBzdHJpbmdUeXBlcyA9IG5ldyBTZXQoW1wiY2hhclwiLCBcInZhcmNoYXJcIiwgXCJudmFyY2hhclwiLCBcInN0cmluZ1wiLCBcImVudW1cIiwgXCJqc29uXCIsIFwianNvbmJcIiwgXCJjaXRleHRcIiwgXCJiaW5hcnlcIiwgXCJ2YXJiaW5hcnlcIl0pXG5cbiAgICByZXR1cm4gY29sdW1uVHlwZS5pbmNsdWRlcyhcInV1aWRcIikgfHxcbiAgICAgIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJ0ZXh0XCIpIHx8XG4gICAgICBzdHJpbmdUeXBlcy5oYXMoY29sdW1uVHlwZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIG51bWVyaWMgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBudW1lcmljLWxpa2UgdHlwZS5cbiAgICovXG4gIHN0YXRpYyBfaXNOdW1lcmljVHlwZShjb2x1bW5UeXBlKSB7XG4gICAgcmV0dXJuIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJpbnRcIikgfHxcbiAgICAgIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJkZWNpbWFsXCIpIHx8XG4gICAgICBjb2x1bW5UeXBlLmluY2x1ZGVzKFwibnVtZXJpY1wiKSB8fFxuICAgICAgY29sdW1uVHlwZS5pbmNsdWRlcyhcImZsb2F0XCIpIHx8XG4gICAgICBjb2x1bW5UeXBlLmluY2x1ZGVzKFwiZG91YmxlXCIpIHx8XG4gICAgICBjb2x1bW5UeXBlLmluY2x1ZGVzKFwicmVhbFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIG51bWVyaWMgdmFsdWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgX25vcm1hbGl6ZU51bWVyaWNWYWx1ZSh7Y29sdW1uVHlwZSwgdmFsdWV9KSB7XG4gICAgaWYgKHZhbHVlID09PSBcIlwiIHx8IHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB2YWx1ZVxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiB2YWx1ZVxuXG4gICAgaWYgKGNvbHVtblR5cGUuaW5jbHVkZXMoXCJkZWNpbWFsXCIpIHx8IGNvbHVtblR5cGUuaW5jbHVkZXMoXCJudW1lcmljXCIpKSB7XG4gICAgICByZXR1cm4gdmFsdWVcbiAgICB9XG5cbiAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShwYXJzZWQpKSByZXR1cm4gdmFsdWVcblxuICAgIGlmIChjb2x1bW5UeXBlLmluY2x1ZGVzKFwiaW50XCIpKSB7XG4gICAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKHBhcnNlZCkpIHJldHVybiB2YWx1ZVxuICAgICAgaWYgKCEvXi0/XFxkKyQvLnRlc3QodmFsdWUpKSByZXR1cm4gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gcGFyc2VkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZGF0ZSB2YWx1ZSBmb3IgaW5zZXJ0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgX25vcm1hbGl6ZURhdGVWYWx1ZUZvckluc2VydCh2YWx1ZSkge1xuICAgIHJldHVybiBub3JtYWxpemVEYXRlVmFsdWVGb3JXcml0ZSh2YWx1ZSwge3RpbWVab25lOiB0aGlzLl90aW1lWm9uZUZvckRhdGVXcml0ZSgpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBkYXRlIHN0cmluZyBmb3IgaW5zZXJ0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBEYXRlIHN0cmluZyB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IERhdGV9IC0gUGFyc2VkIGRhdGUgb3Igb3JpZ2luYWwgc3RyaW5nLlxuICAgKi9cbiAgc3RhdGljIF9ub3JtYWxpemVEYXRlU3RyaW5nRm9ySW5zZXJ0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZURhdGVTdHJpbmdGb3JXcml0ZSh2YWx1ZSwge3RpbWVab25lOiB0aGlzLl90aW1lWm9uZUZvckRhdGVXcml0ZSgpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRpbWUgem9uZSBmb3IgZGF0ZSB3cml0ZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQWN0aXZlIHRpbWV6b25lIGlkZW50aWZpZXIuXG4gICAqL1xuICBzdGF0aWMgX3RpbWVab25lRm9yRGF0ZVdyaXRlKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKClcblxuICAgIHJldHVybiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldFRpbWVab25lKGNvbmZpZ3VyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgc3FsaXRlIGJvb2xlYW4gdmFsdWUgZm9yIGluc2VydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGFyZ3MuY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplU3FsaXRlQm9vbGVhblZhbHVlRm9ySW5zZXJ0KHtjb2x1bW5UeXBlLCB2YWx1ZX0pIHtcbiAgICBpZiAodGhpcy5nZXREYXRhYmFzZVR5cGUoKSAhPSBcInNxbGl0ZVwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAoIWNvbHVtblR5cGUpIHJldHVybiB2YWx1ZVxuICAgIGlmIChjb2x1bW5UeXBlLnRvTG93ZXJDYXNlKCkgIT09IFwiYm9vbGVhblwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiAxXG4gICAgaWYgKHZhbHVlID09PSBmYWxzZSkgcmV0dXJuIDBcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV4dCBwcmltYXJ5IGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBuZXh0IHByaW1hcnkga2V5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIG5leHRQcmltYXJ5S2V5KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMucHJpbWFyeUtleSgpXG4gICAgY29uc3QgdGFibGVOYW1lID0gdGhpcy50YWJsZU5hbWUoKVxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb24oKVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9Lm5leHRQcmltYXJ5S2V5KCkgZG9lcyBub3Qgc3VwcG9ydCBjb21wb3NpdGUgcHJpbWFyeSBrZXlzLmApXG5cbiAgICBjb25zdCBuZXdlc3RSZWNvcmQgPSBhd2FpdCB0aGlzLm9yZGVyKGAke2Nvbm5lY3Rpb24ucXVvdGVUYWJsZSh0YWJsZU5hbWUpfS4ke2Nvbm5lY3Rpb24ucXVvdGVDb2x1bW4ocHJpbWFyeUtleSl9YCkubGFzdCgpXG5cbiAgICBpZiAobmV3ZXN0UmVjb3JkKSB7XG4gICAgICBjb25zdCBpZCA9IG5ld2VzdFJlY29yZC5pZCgpXG5cbiAgICAgIGlmICh0eXBlb2YgaWQgPT0gXCJudW1iZXJcIikge1xuICAgICAgICByZXR1cm4gaWQgKyAxXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJRCBmcm9tIG5ld2VzdCByZWNvcmQgd2Fzbid0IGEgbnVtYmVyXCIpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiAxXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHByaW1hcnkga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgbnVsbH0gcHJpbWFyeUtleSAtIFByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2V0UHJpbWFyeUtleShwcmltYXJ5S2V5KSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHtcbiAgICAgIGlmIChwcmltYXJ5S2V5Lmxlbmd0aCA9PT0gMCkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNvbXBvc2l0ZSBwcmltYXJ5IGtleXMgcmVxdWlyZSBhdCBsZWFzdCBvbmUgY29sdW1uLlwiKVxuXG4gICAgICBjb25zdCBzZWVuQ29sdW1ucyA9IG5ldyBTZXQoKVxuXG4gICAgICBmb3IgKGNvbnN0IGNvbHVtbk5hbWUgb2YgcHJpbWFyeUtleSkge1xuICAgICAgICBpZiAoc2VlbkNvbHVtbnMuaGFzKGNvbHVtbk5hbWUpKSB0aHJvdyBuZXcgVHlwZUVycm9yKGBDb21wb3NpdGUgcHJpbWFyeSBrZXkgaGFzIGR1cGxpY2F0ZSBjb2x1bW46ICR7Y29sdW1uTmFtZX0uYClcblxuICAgICAgICBzZWVuQ29sdW1ucy5hZGQoY29sdW1uTmFtZSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5fcHJpbWFyeUtleSA9IFsuLi5wcmltYXJ5S2V5XVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fcHJpbWFyeUtleSA9IHByaW1hcnlLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoaXMgY2xhc3MncyBvd24gYXR0cmlidXRlLWNhc3QgbWFwLCBjcmVhdGluZyBpdCBvbiB0aGUgY2xhc3MgaXRzZWxmXG4gICAqIChuZXZlciBpbmhlcml0ZWQgZnJvbSBhIHBhcmVudCkgc28gc3ViY2xhc3NlcyBkb24ndCBzaGFyZSB0aGUgc2FtZSBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIERlY2xhcmVkIGNhc3RzIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dHJpYnV0ZUNhc3RzTWFwKCkge1xuICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsIFwiX2F0dHJpYnV0ZUNhc3RzXCIpIHx8ICF0aGlzLl9hdHRyaWJ1dGVDYXN0cykge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICAgIHRoaXMuX2F0dHJpYnV0ZUNhc3RzID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0cmlidXRlQ2FzdHNcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhIFJhaWxzLXN0eWxlIHBlci1hdHRyaWJ1dGUgY2FzdCBzbyBhIGNvbHVtbiB3aG9zZSBpbnRyb3NwZWN0ZWQgdHlwZVxuICAgKiBpc24ndCB3aGF0IHRoZSBhcHAgd2FudHMgKGUuZy4gYW4gTVNTUUwgYGJpdGAgbWFwcGVkIHRvIGBudW1iZXJgKSBjYW4gYmVcbiAgICogZXhwb3NlZCBhcyBhbm90aGVyIHR5cGUgd2l0aCByZWFsIHJ1bnRpbWUgY29udmVyc2lvbi4gQ3VycmVudGx5IGZ1bGx5XG4gICAqIGltcGxlbWVudHMgdGhlIGBcImJvb2xlYW5cImAgY2FzdCAoMC8xIDwtPiBmYWxzZS90cnVlKTsgb3RoZXIgdHlwZXMgb25seSByZWNvcmRcbiAgICogdGhlIGxhYmVsIHNvIHRoZSBlZmZlY3RpdmUgdHlwZSBhbmQgZ2VuZXJhdGVkIHR5cGluZ3MgcmVmbGVjdCB0aGVtLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lIChjYW1lbENhc2UpLCBlLmcuIGBcInNpY2h0YmFyVlZLXCJgLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIERlY2xhcmVkIHR5cGUsIGUuZy4gYFwiYm9vbGVhblwiYC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lLCB0eXBlKSB7XG4gICAgdGhpcy5nZXRBdHRyaWJ1dGVDYXN0c01hcCgpW2F0dHJpYnV0ZU5hbWVdID0gdHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGRlY2xhcmVkIGNhc3QgdHlwZSBmb3IgYW4gYXR0cmlidXRlLCBpZiBhbnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUgKGNhbWVsQ2FzZSkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gRGVjbGFyZWQgY2FzdCB0eXBlLCBvciB1bmRlZmluZWQgd2hlbiBub25lIGlzIGRlY2xhcmVkLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dHJpYnV0ZUNhc3QoYXR0cmlidXRlTmFtZSkge1xuICAgIHJldHVybiB0aGlzLmdldEF0dHJpYnV0ZUNhc3RzTWFwKClbYXR0cmlidXRlTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgc3RyaW5nW119IC0gVGhlIHByaW1hcnkga2V5LlxuICAgKi9cbiAgc3RhdGljIHByaW1hcnlLZXkoKSB7XG4gICAgaWYgKHRoaXMuX3ByaW1hcnlLZXkpIHJldHVybiB0aGlzLl9wcmltYXJ5S2V5XG5cbiAgICByZXR1cm4gXCJpZFwiXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgbW9kZWwgaGFzIGEgc2luZ2xlIHByaW1hcnkga2V5IGNvbHVtbi4gYHNldFByaW1hcnlLZXkobnVsbClgIChlLmcuIGNvbXBvc2l0ZS1rZXlcbiAgICogbGVnYWN5IHRhYmxlcykgZGVjbGFyZXMgbm8gc2luZ2xlIHByaW1hcnkga2V5OyBgcHJpbWFyeUtleSgpYCBzdGlsbCBmYWxscyBiYWNrIHRvIFwiaWRcIiBmb3IgdGhlXG4gICAqIGRlZmF1bHQgY2FzZSwgc28gY2FsbGVycyB0aGF0IG11c3QgZGlzdGluZ3Vpc2ggXCJubyBwcmltYXJ5IGtleVwiIHVzZSB0aGlzIGluc3RlYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIEZhbHNlIG9ubHkgd2hlbiB0aGUgcHJpbWFyeSBrZXkgd2FzIGV4cGxpY2l0bHkgc2V0IHRvIG51bGwuXG4gICAqL1xuICBzdGF0aWMgaGFzUHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gdGhpcy5fcHJpbWFyeUtleSAhPT0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2F2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNhdmUoKSB7XG4gICAgY29uc3QgaXNOZXdSZWNvcmQgPSB0aGlzLmlzTmV3UmVjb3JkKClcbiAgICBsZXQgcmVzdWx0XG5cbiAgICBjb25zdCBzYXZlID0gYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYmVmb3JlVmFsaWRhdGlvblwiKVxuICAgICAgYXdhaXQgdGhpcy5fcnVuVmFsaWRhdGlvbnMoKVxuXG4gICAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24gJiYgdGhpcy5pc1BlcnNpc3RlZCgpICYmIE9iamVjdC5rZXlzKHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldEF0dGFjaG1lbnRzKCkpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuX2Nvbm5lY3Rpb24oKVxuXG4gICAgICAgIGlmICghY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5nZXRNb2RlbENsYXNzKCkuX3ByZXBhcmVBdHRhY2htZW50U3RvcmVTY2hlbWEoY29ubmVjdGlvbilcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBzYXZlSW5UcmFuc2FjdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9ICovXG4gICAgICAgIGxldCBwZXJzaXN0ZWRBdHRyaWJ1dGVzQmVmb3JlVXBkYXRlXG4gICAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqL1xuICAgICAgICBsZXQgY2hhbmdlc0JlZm9yZVVwZGF0ZVxuICAgICAgICBsZXQgdXBkYXRlUmVsb2FkZWQgPSBmYWxzZVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYmVmb3JlU2F2ZVwiKVxuXG4gICAgICAgICAgLy8gSWYgYW55IGJlbG9uZ3MtdG8tcmVsYXRpb25zaGlwcyB3YXMgc2F2ZWQsIHRoZW4gdXBkYXRlZC1hdCBzaG91bGQgc3RpbGwgYmUgc2V0IG9uIHRoaXMgcmVjb3JkLlxuICAgICAgICAgIGNvbnN0IHtzYXZlZENvdW50fSA9IGF3YWl0IHRoaXMuX2F1dG9TYXZlQmVsb25nc1RvUmVsYXRpb25zaGlwcygpXG5cbiAgICAgICAgICBpZiAodGhpcy5pc1BlcnNpc3RlZCgpKSB7XG4gICAgICAgICAgICBwZXJzaXN0ZWRBdHRyaWJ1dGVzQmVmb3JlVXBkYXRlID0gey4uLnRoaXMuX2F0dHJpYnV0ZXN9XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJiZWZvcmVVcGRhdGVcIilcbiAgICAgICAgICAgIGNoYW5nZXNCZWZvcmVVcGRhdGUgPSB7Li4udGhpcy5fY2hhbmdlc31cblxuICAgICAgICAgICAgLy8gSWYgYW55IGhhcy1tYW55LXJlbGF0aW9uc2hpcHMgd2lsbCBiZSBzYXZlZCwgdGhlbiB1cGRhdGVkLWF0IHNob3VsZCBzdGlsbCBiZSBzZXQgb24gdGhpcyByZWNvcmQuXG4gICAgICAgICAgICBjb25zdCBhdXRvU2F2ZUhhc01hbnlyZWxhdGlvbnNoaXBzID0gdGhpcy5fYXV0b1NhdmVIYXNNYW55QW5kSGFzT25lUmVsYXRpb25zaGlwc1RvU2F2ZSgpXG5cbiAgICAgICAgICAgIGlmICh0aGlzLl9oYXNDaGFuZ2VzKCkgfHwgc2F2ZWRDb3VudCA+IDAgfHwgYXV0b1NhdmVIYXNNYW55cmVsYXRpb25zaGlwcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuX3VwZGF0ZVJlY29yZFdpdGhDaGFuZ2VzKClcbiAgICAgICAgICAgICAgdXBkYXRlUmVsb2FkZWQgPSB0cnVlXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImFmdGVyVXBkYXRlXCIpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImJlZm9yZUNyZWF0ZVwiKVxuICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5fY3JlYXRlTmV3UmVjb3JkKClcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImFmdGVyQ3JlYXRlXCIpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgdGhpcy5fYXV0b1NhdmVIYXNNYW55QW5kSGFzT25lUmVsYXRpb25zaGlwcyh7aXNOZXdSZWNvcmR9KVxuICAgICAgICAgIGF3YWl0IHRoaXMuX2F1dG9TYXZlQXR0YWNobWVudHMoKVxuICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImFmdGVyU2F2ZVwiKVxuICAgICAgICAgIGF3YWl0IHRoaXMuX2VtaXRSZWNvcmRDaGFuZ2VBZnRlckNvbW1pdChpc05ld1JlY29yZCA/IFwiY3JlYXRlXCIgOiBcInVwZGF0ZVwiKVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGlmICh1cGRhdGVSZWxvYWRlZCAmJiBwZXJzaXN0ZWRBdHRyaWJ1dGVzQmVmb3JlVXBkYXRlICYmIGNoYW5nZXNCZWZvcmVVcGRhdGUpIHtcbiAgICAgICAgICAgIHRoaXMuX2F0dHJpYnV0ZXMgPSBwZXJzaXN0ZWRBdHRyaWJ1dGVzQmVmb3JlVXBkYXRlXG4gICAgICAgICAgICB0aGlzLl9jaGFuZ2VzID0gY2hhbmdlc0JlZm9yZVVwZGF0ZVxuICAgICAgICAgICAgdGhpcy5fYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyA9IHVuZGVmaW5lZFxuICAgICAgICAgIH1cblxuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLnRyYW5zYWN0aW9uKHNhdmVJblRyYW5zYWN0aW9uKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgdGhpcy5nZXRNb2RlbENsYXNzKCkudHJhbnNhY3Rpb24oc2F2ZUluVHJhbnNhY3Rpb24pXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSB7XG4gICAgICBhd2FpdCBzYXZlKClcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBzYXZlYH0sIHNhdmUpXG4gICAgfVxuXG4gICAgdGhpcy5fYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyA9IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgYXN5bmMgX2F1dG9TYXZlQmVsb25nc1RvUmVsYXRpb25zaGlwcygpIHtcbiAgICBsZXQgc2F2ZWRDb3VudCA9IDBcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT0gXCJiZWxvbmdzVG9cIikge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0QXV0b1NhdmUoKSA9PT0gZmFsc2UpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgbW9kZWwgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG5cbiAgICAgIGlmIChtb2RlbCkge1xuICAgICAgICBpZiAobW9kZWwgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkge1xuICAgICAgICAgIGlmIChtb2RlbC5pc0NoYW5nZWQoKSkge1xuICAgICAgICAgICAgdGhpcy5iaW5kUmVsYXRlZFJlY29yZChtb2RlbClcbiAgICAgICAgICAgIGF3YWl0IG1vZGVsLnNhdmUoKVxuXG4gICAgICAgICAgICBjb25zdCBmb3JlaWduS2V5ID0gdGhpcy5fcmVsYXRpb25zaGlwRm9yZWlnbktleUF0dHJpYnV0ZShpbnN0YW5jZVJlbGF0aW9uc2hpcClcbiAgICAgICAgICAgIGNvbnN0IGZvcmVpZ25LZXlWYWx1ZSA9IHRoaXMuX2JlbG9uZ3NUb0ZvcmVpZ25LZXlWYWx1ZSh7bW9kZWwsIHJlbGF0aW9uc2hpcDogaW5zdGFuY2VSZWxhdGlvbnNoaXB9KVxuXG4gICAgICAgICAgICB0aGlzLnNldEF0dHJpYnV0ZShmb3JlaWduS2V5LCBmb3JlaWduS2V5VmFsdWUpXG5cbiAgICAgICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwLnNldFByZWxvYWRlZCh0cnVlKVxuICAgICAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0RGlydHkoZmFsc2UpXG5cbiAgICAgICAgICAgIHNhdmVkQ291bnQrK1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGEgcmVjb3JkIGJ1dCBnb3Q6ICR7dHlwZW9mIG1vZGVsfWApXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge3NhdmVkQ291bnR9XG4gIH1cblxuICBfYXV0b1NhdmVIYXNNYW55QW5kSGFzT25lUmVsYXRpb25zaGlwc1RvU2F2ZSgpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBzID0gW11cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT0gXCJoYXNNYW55XCIgJiYgaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpICE9IFwiaGFzT25lXCIpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldEF1dG9TYXZlKCkgPT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8qKlxuICAgICAgICogRGVmaW5lcyBsb2FkZWQuXG4gICAgICAgKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXX0gKi9cbiAgICAgIGxldCBsb2FkZWRcblxuICAgICAgY29uc3QgaGFzTWFueU9yT25lTG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKVxuXG4gICAgICBpZiAoaGFzTWFueU9yT25lTG9hZGVkKSB7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGhhc01hbnlPck9uZUxvYWRlZCkpIHtcbiAgICAgICAgICBsb2FkZWQgPSBoYXNNYW55T3JPbmVMb2FkZWRcbiAgICAgICAgfSBlbHNlIGlmIChoYXNNYW55T3JPbmVMb2FkZWQgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkge1xuICAgICAgICAgIGxvYWRlZCA9IFtoYXNNYW55T3JPbmVMb2FkZWRdXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBoYXNPbmVMb2FkZWQgdG8gYmUgYSByZWNvcmQgYnV0IGl0IHdhc24ndDogJHt0eXBlb2YgaGFzTWFueU9yT25lTG9hZGVkfWApXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGxldCB1c2VSZWxhdGlvbnNoaXAgPSBmYWxzZVxuXG4gICAgICBpZiAobG9hZGVkKSB7XG4gICAgICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbG9hZGVkKSB7XG4gICAgICAgICAgdGhpcy5iaW5kUmVsYXRlZFJlY29yZChtb2RlbClcbiAgICAgICAgICBjb25zdCBmb3JlaWduS2V5ID0gbW9kZWwuX3JlbGF0aW9uc2hpcEZvcmVpZ25LZXlBdHRyaWJ1dGUoaW5zdGFuY2VSZWxhdGlvbnNoaXApXG5cbiAgICAgICAgICBtb2RlbC5zZXRBdHRyaWJ1dGUoZm9yZWlnbktleSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUodGhpcy5pZCgpLCBgSGFzLW1hbnkgYXV0b3NhdmUgZm9yICR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX1gKSlcblxuICAgICAgICAgIGlmIChtb2RlbC5pc0NoYW5nZWQoKSkge1xuICAgICAgICAgICAgdXNlUmVsYXRpb25zaGlwID0gdHJ1ZVxuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHVzZVJlbGF0aW9uc2hpcCkgcmVsYXRpb25zaGlwcy5wdXNoKGluc3RhbmNlUmVsYXRpb25zaGlwKVxuICAgIH1cblxuICAgIHJldHVybiByZWxhdGlvbnNoaXBzXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSByZWxhdGlvbnNoaXAgZm9yZWlnbi1rZXkgY29sdW1uIHRvIHRoaXMgbW9kZWwncyBwdWJsaWMgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdDx0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQsIHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD59IGluc3RhbmNlUmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBBdHRyaWJ1dGUgbmFtZSBhY2NlcHRlZCBieSBzZXRBdHRyaWJ1dGUvYXNzaWduLlxuICAgKi9cbiAgX3JlbGF0aW9uc2hpcEZvcmVpZ25LZXlBdHRyaWJ1dGUoaW5zdGFuY2VSZWxhdGlvbnNoaXApIHtcbiAgICBjb25zdCBmb3JlaWduS2V5ID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG5cbiAgICByZXR1cm4gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW2ZvcmVpZ25LZXldIHx8IGZvcmVpZ25LZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF1dG8gc2F2ZSBoYXMgbWFueSBhbmQgaGFzIG9uZSByZWxhdGlvbnNoaXBzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuaXNOZXdSZWNvcmQgLSBXaGV0aGVyIGlzIG5ldyByZWNvcmQuXG4gICAqL1xuICBhc3luYyBfYXV0b1NhdmVIYXNNYW55QW5kSGFzT25lUmVsYXRpb25zaGlwcyh7aXNOZXdSZWNvcmR9KSB7XG4gICAgZm9yIChjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCBvZiB0aGlzLl9hdXRvU2F2ZUhhc01hbnlBbmRIYXNPbmVSZWxhdGlvbnNoaXBzVG9TYXZlKCkpIHtcbiAgICAgIGxldCBoYXNNYW55T3JPbmVMb2FkZWQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG5cbiAgICAgIC8qKlxuICAgICAgICogRGVmaW5lcyBsb2FkZWQuXG4gICAgICAgKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXX0gKi9cbiAgICAgIGxldCBsb2FkZWRcblxuICAgICAgaWYgKGhhc01hbnlPck9uZUxvYWRlZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGxvYWRlZCA9IFtdXG4gICAgICB9IGVsc2UgaWYgKGhhc01hbnlPck9uZUxvYWRlZCBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSB7XG4gICAgICAgIGxvYWRlZCA9IFtoYXNNYW55T3JPbmVMb2FkZWRdXG4gICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoaGFzTWFueU9yT25lTG9hZGVkKSkge1xuICAgICAgICBsb2FkZWQgPSBoYXNNYW55T3JPbmVMb2FkZWRcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCB0eXBlIGZvciBoYXNNYW55T3JPbmVMb2FkZWQ6ICR7dHlwZW9mIGhhc01hbnlPck9uZUxvYWRlZH1gKVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIGxvYWRlZCkge1xuICAgICAgICB0aGlzLmJpbmRSZWxhdGVkUmVjb3JkKG1vZGVsKVxuICAgICAgICBjb25zdCBmb3JlaWduS2V5ID0gbW9kZWwuX3JlbGF0aW9uc2hpcEZvcmVpZ25LZXlBdHRyaWJ1dGUoaW5zdGFuY2VSZWxhdGlvbnNoaXApXG5cbiAgICAgICAgbW9kZWwuc2V0QXR0cmlidXRlKGZvcmVpZ25LZXksIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKHRoaXMuaWQoKSwgYEhhcy1tYW55IGF1dG9zYXZlIGZvciAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9YCkpXG5cbiAgICAgICAgaWYgKG1vZGVsLmlzQ2hhbmdlZCgpKSB7XG4gICAgICAgICAgYXdhaXQgbW9kZWwuc2F2ZSgpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGlzTmV3UmVjb3JkKSB7XG4gICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwLnNldFByZWxvYWRlZCh0cnVlKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF1dG8gc2F2ZSBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwZW5kaW5nIGF0dGFjaG1lbnRzIGhhdmUgYmVlbiBzYXZlZC5cbiAgICovXG4gIGFzeW5jIF9hdXRvU2F2ZUF0dGFjaG1lbnRzKCkge1xuICAgIGZvciAoY29uc3QgYXR0YWNobWVudE5hbWUgaW4gdGhpcy5fYXR0YWNobWVudHMpIHtcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnQgPSB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV1cblxuICAgICAgaWYgKCFhdHRhY2htZW50Lmhhc1BlbmRpbmdBdHRhY2htZW50cygpKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCBhdHRhY2htZW50LmZsdXNoUGVuZGluZ0F0dGFjaG1lbnRzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0YWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0YWJsZSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHRhYmxlTmFtZSgpIHtcbiAgICBpZiAoIXRoaXMuX3RhYmxlTmFtZSkgdGhpcy5fdGFibGVOYW1lID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKGluZmxlY3Rpb24ucGx1cmFsaXplKHRoaXMuZ2V0TW9kZWxOYW1lKCkpKVxuXG4gICAgcmV0dXJuIHRoaXMuX3RhYmxlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2V0VGFibGVOYW1lKHRhYmxlTmFtZSkge1xuICAgIHRoaXMuX3RhYmxlTmFtZSA9IHRhYmxlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRyYW5zYWN0aW9uLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHRyYW5zYWN0aW9uKGNhbGxiYWNrKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9uKClcblxuICAgIGlmICghY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSB7XG4gICAgICBhd2FpdCB0aGlzLl9wcmVwYXJlQXR0YWNobWVudFN0b3JlU2NoZW1hKGNvbm5lY3Rpb24pXG4gICAgfVxuXG4gICAgY29uc3QgdXNlVHJhbnNhY3Rpb25zID0gY29ubmVjdGlvbi5nZXRBcmdzKCkucmVjb3JkPy50cmFuc2FjdGlvbnNcblxuICAgIGlmICh1c2VUcmFuc2FjdGlvbnMgIT09IGZhbHNlKSB7XG4gICAgICByZXR1cm4gYXdhaXQgY29ubmVjdGlvbi50cmFuc2FjdGlvbihjYWxsYmFjaylcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHJlcGFyZXMgdGhpcyBtb2RlbCdzIGF0dGFjaG1lbnQgc3RvcmUgYmVmb3JlIG9wZW5pbmcgYSBtb2RlbCB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIE1vZGVsIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGF0dGFjaG1lbnQgc2NoZW1hIGlzIGN1cnJlbnQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgX3ByZXBhcmVBdHRhY2htZW50U3RvcmVTY2hlbWEoY29ubmVjdGlvbikge1xuICAgIGF3YWl0IHJlY29yZEF0dGFjaG1lbnRzU3RvcmVGb3JNb2RlbENsYXNzKHRoaXMsIGNvbm5lY3Rpb24pLnByZXBhcmVSZWNvcmRJZGVudGl0eU1pZ3JhdGlvbih7Y29ubmVjdGlvbn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgY2FsbGJhY2sgd2hpbGUgaG9sZGluZyBhIG5hbWVkIGFkdmlzb3J5IGxvY2suIENhbGxzIHdpdGhvdXRcbiAgICogQnkgZGVmYXVsdCBjYWxscyB1c2UgdGhlIGNhbGxlciBjb25uZWN0aW9uLiBDYWxscyB3aXRoIGBkZWRpY2F0ZWRDb25uZWN0aW9uYFxuICAgKiB1c2UgYSBzcGF3bmVkIGxvY2sgY29ubmVjdGlvbiB0aGF0IGlzIHJlbGVhc2VkIGFmdGVyIHRoZSBjYWxsYmFjayBmaW5pc2hlcyxcbiAgICogd2hpbGUgdGhlIGNhbGxiYWNrIGl0c2VsZiBzdGlsbCBydW5zIGFnYWluc3QgdGhlIGNhbGxlci9tb2RlbCBjb25uZWN0aW9uLlxuICAgKiBDYWxscyB3aXRoIGEgcG9zaXRpdmUgYGhvbGRUaW1lb3V0TXNgIHVzZSBhIGRlZGljYXRlZCBsb2NrIGNvbm5lY3Rpb24gc29cbiAgICogdGltZW91dCBjbGVhbnVwIGNhbiByZWxlYXNlIHRoZSBsb2NrIGV2ZW4gd2hlbiBjYWxsYmFjayBkYXRhYmFzZSB3b3JrIGlzXG4gICAqIHN0dWNrLiBBZHZpc29yeSBsb2NrcyBhcmUgY29vcGVyYXRpdmUgYW5kIHNlc3Npb24tc2NvcGVkOiB0aGV5IHNlcmlhbGl6ZVxuICAgKiBjYWxsZXJzIHRoYXQgb3B0IGludG8gdGhlIHNhbWUgYG5hbWVgLCB3aXRob3V0IHRvdWNoaW5nIHJvdyBvciB0YWJsZSBsb2NrcyxcbiAgICogc28gdW5yZWxhdGVkIHRyYWZmaWMgaXMgZnJlZSB0byBwcm9jZWVkLlxuICAgKlxuICAgKiBUaGUgbG9jayBpcyBhY3F1aXJlZCBiZWZvcmUgdGhlIGNhbGxiYWNrIHJ1bnMgYW5kIHJlbGVhc2VkIGluIGFcbiAgICogYGZpbmFsbHlgIGJsb2NrIGFmdGVyd2FyZHMsIHNvIHRoZSBjYWxsYmFjaydzIHJldHVybiB2YWx1ZSBpc1xuICAgKiBwcm9wYWdhdGVkIGFuZCB0aHJvd24gZXJyb3JzIHN0aWxsIHJlbGVhc2UgdGhlIGxvY2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gaW52b2tlIHdoaWxlIHRoZSBsb2NrIGlzIGhlbGQuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGwsIGhvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBkZWRpY2F0ZWRDb25uZWN0aW9uPzogYm9vbGVhbn19IFthcmdzXSAtIGB0aW1lb3V0TXNgIGNhcHMgaG93IGxvbmcgd2Ugd2FpdCB0byBhY3F1aXJlIHRoZSBsb2NrOyBgaG9sZFRpbWVvdXRNc2AgY2FwcyBob3cgbG9uZyB0aGUgY2FsbGJhY2sgbWF5IGhvbGQgaXQgYmVmb3JlIHRoZSBsb2NrIGlzIHJlbGVhc2VkIGFuZCBgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcmAgaXMgdGhyb3duOyBgZGVkaWNhdGVkQ29ubmVjdGlvbmAgc3Bhd25zIGEgc2VwYXJhdGUgbG9jayBzZXNzaW9uIHdpdGhvdXQgZW5hYmxpbmcgYSBob2xkIHRpbWVvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrJ3MgcmV0dXJuIHZhbHVlLlxuICAgKiBAdGhyb3dzIHtBZHZpc29yeUxvY2tUaW1lb3V0RXJyb3J9IC0gSWYgYHRpbWVvdXRNc2AgZWxhcHNlcyBiZWZvcmUgdGhlIGxvY2sgaXMgZ3JhbnRlZC5cbiAgICogQHRocm93cyB7QWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcn0gLSBJZiBgaG9sZFRpbWVvdXRNc2AgZWxhcHNlcyB3aGlsZSB0aGUgY2FsbGJhY2sgaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgd2l0aEFkdmlzb3J5TG9jayhuYW1lLCBjYWxsYmFjaywgYXJncyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCBydW5uZXIgPSBuZXcgQWR2aXNvcnlMb2NrUnVubmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgIGNvbm5lY3Rpb25Qcm92aWRlcjogKCkgPT4gdGhpcy5jb25uZWN0aW9uKCksXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICB9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1bm5lci53aXRoQWR2aXNvcnlMb2NrKG5hbWUsIGNhbGxiYWNrLCBhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIGNhbGxiYWNrIG9ubHkgaWYgdGhlIG5hbWVkIGFkdmlzb3J5IGxvY2sgY2FuIGJlIGFjcXVpcmVkXG4gICAqIGltbWVkaWF0ZWx5LiBJZiB0aGUgbG9jayBpcyBhbHJlYWR5IGhlbGQgYnkgYW55IHNlc3Npb24sIHRocm93c1xuICAgKiBgQWR2aXNvcnlMb2NrQnVzeUVycm9yYCB3aXRob3V0IHdhaXRpbmcuXG4gICAqIFVzZSB0aGlzIHdoZW4gY29udGVudGlvbiBpcyBhIHNpZ25hbCB0aGF0IHNvbWVib2R5IGVsc2UgaXMgYWxyZWFkeVxuICAgKiBkb2luZyB0aGUgd29yayBhbmQgeW91IHdhbnQgdG8gYmFpbCBvdXQgcmF0aGVyIHRoYW4gcXVldWUgdXAuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gaW52b2tlIHdoaWxlIHRoZSBsb2NrIGlzIGhlbGQuXG4gICAqIEBwYXJhbSB7e2hvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBkZWRpY2F0ZWRDb25uZWN0aW9uPzogYm9vbGVhbn19IFthcmdzXSAtIGBob2xkVGltZW91dE1zYCBjYXBzIGhvdyBsb25nIHRoZSBjYWxsYmFjayBtYXkgaG9sZCB0aGUgbG9jayBiZWZvcmUgaXQgaXMgcmVsZWFzZWQgYW5kIGBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yYCBpcyB0aHJvd247IGBkZWRpY2F0ZWRDb25uZWN0aW9uYCBzcGF3bnMgYSBzZXBhcmF0ZSBsb2NrIHNlc3Npb24gd2l0aG91dCBlbmFibGluZyBhIGhvbGQgdGltZW91dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sncyByZXR1cm4gdmFsdWUuXG4gICAqIEB0aHJvd3Mge0Fkdmlzb3J5TG9ja0J1c3lFcnJvcn0gLSBJZiB0aGUgbG9jayBpcyBhbHJlYWR5IGhlbGQuXG4gICAqIEB0aHJvd3Mge0Fkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3J9IC0gSWYgYGhvbGRUaW1lb3V0TXNgIGVsYXBzZXMgd2hpbGUgdGhlIGNhbGxiYWNrIGhvbGRzIHRoZSBsb2NrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHdpdGhBZHZpc29yeUxvY2tPckZhaWwobmFtZSwgY2FsbGJhY2ssIGFyZ3MgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcnVubmVyID0gbmV3IEFkdmlzb3J5TG9ja1J1bm5lcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICBjb25uZWN0aW9uUHJvdmlkZXI6ICgpID0+IHRoaXMuY29ubmVjdGlvbigpLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgfSlcblxuICAgIHJldHVybiBhd2FpdCBydW5uZXIud2l0aEFkdmlzb3J5TG9ja09yRmFpbChuYW1lLCBjYWxsYmFjaywgYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGBjYWxsYmFja2AsIHJlamVjdGluZyB3aXRoIGBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yYCBpZiBpdCBoYXNcbiAgICogbm90IHNldHRsZWQgd2l0aGluIGBob2xkVGltZW91dE1zYC4gVGhlIGNhbGxiYWNrIGlzIG5vdCBjYW5jZWxsZWQg4oCUIHRoaXMgaXNcbiAgICogYSBzYWZldHkgbmV0LCBub3QgY2FuY2VsbGF0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZSAoZm9yIHRoZSBlcnJvciBtZXNzYWdlKS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGhvbGRpbmcgdGhlIGxvY2suXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2hvbGRUaW1lb3V0TXNdIC0gTWF4IGhvbGQgdGltZTsgZmFsc3kgZGlzYWJsZXMgdGhlIHRpbWVvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdCBhZnRlciB0aGUgbG9jay1wcm90ZWN0ZWQgb3BlcmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJ1bldpdGhBZHZpc29yeUxvY2tIb2xkVGltZW91dChuYW1lLCBjYWxsYmFjaywgaG9sZFRpbWVvdXRNcykge1xuICAgIHJldHVybiBhd2FpdCBBZHZpc29yeUxvY2tSdW5uZXIucnVuV2l0aEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0KG5hbWUsIGNhbGxiYWNrLCBob2xkVGltZW91dE1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdHJ1ZSBpZiB0aGUgbmFtZWQgYWR2aXNvcnkgbG9jayBpcyBjdXJyZW50bHkgaGVsZCBieSBhbnlcbiAgICogc2Vzc2lvbi4gUHJpbWFyaWx5IHVzZWZ1bCBhcyBhIGRpYWdub3N0aWM7IGNhbGxlcnMgdGhhdCB3YW50IHRvIGFjdFxuICAgKiBvbiB0aGUgcmVzdWx0IHNob3VsZCBwcmVmZXIgYHdpdGhBZHZpc29yeUxvY2tPckZhaWxgIHRvIGF2b2lkIGFcbiAgICogVE9DVE9VIHdpbmRvdyBiZXR3ZWVuIHRoZSBjaGVjayBhbmQgdGhlIGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGFkdmlzb3J5IGxvY2sgaXMgY3VycmVudGx5IGhlbGQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgaGFzQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS5pc0Fkdmlzb3J5TG9ja0hlbGQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyYW5zbGF0ZXMuXG4gICAqIEBwYXJhbSB7Li4uc3RyaW5nfSBuYW1lcyAtIE5hbWVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgdHJhbnNsYXRlcyguLi5uYW1lcykge1xuICAgIGNvbnN0IHRyYW5zbGF0aW9ucyA9IHRoaXMuZ2V0VHJhbnNsYXRpb25zTWFwKClcblxuICAgIGZvciAoY29uc3QgbmFtZSBvZiBuYW1lcykge1xuICAgICAgaWYgKG5hbWUgaW4gdHJhbnNsYXRpb25zKSB0aHJvdyBuZXcgRXJyb3IoYFRyYW5zbGF0aW9uIGFscmVhZHkgZXhpc3RzOiAke25hbWV9YClcblxuICAgICAgdHJhbnNsYXRpb25zW25hbWVdID0ge31cblxuICAgICAgaWYgKCF0aGlzLl9yZWxhdGlvbnNoaXBFeGlzdHMoXCJ0cmFuc2xhdGlvbnNcIikpIHtcbiAgICAgICAgdGhpcy5fZGVmaW5lUmVsYXRpb25zaGlwKFwidHJhbnNsYXRpb25zXCIsIHtkZXBlbmRlbnQ6IFwiZGVzdHJveVwiLCBrbGFzczogdGhpcy5nZXRUcmFuc2xhdGlvbkNsYXNzKCksIHR5cGU6IFwiaGFzTWFueVwifSlcbiAgICAgIH1cblxuICAgICAgaWYgKCF0aGlzLl9yZWxhdGlvbnNoaXBFeGlzdHMoXCJjdXJyZW50VHJhbnNsYXRpb25cIikpIHtcbiAgICAgICAgdGhpcy5fZGVmaW5lUmVsYXRpb25zaGlwKFwiY3VycmVudFRyYW5zbGF0aW9uXCIsIHtcbiAgICAgICAgICBrbGFzczogdGhpcy5nZXRUcmFuc2xhdGlvbkNsYXNzKCksXG4gICAgICAgICAgc2NvcGU6IChxdWVyeSkgPT4gdGhpcy5jdXJyZW50VHJhbnNsYXRpb25TY29wZShxdWVyeSksXG4gICAgICAgICAgdHlwZTogXCJoYXNPbmVcIlxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgdHJhbnNsYXRpb24gc2NvcGUuXG4gICAqIEBwYXJhbSB7TW9kZWxDbGFzc1F1ZXJ5fSBxdWVyeSAtIFRyYW5zbGF0aW9uIHF1ZXJ5LlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5fSAtIFNjb3BlZCBxdWVyeS5cbiAgICovXG4gIHN0YXRpYyBjdXJyZW50VHJhbnNsYXRpb25TY29wZShxdWVyeSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBsb2NhbGUgPSBjb25maWd1cmF0aW9uLmdldExvY2FsZSgpXG4gICAgY29uc3QgZmFsbGJhY2tzID0gY29uZmlndXJhdGlvbi5nZXRMb2NhbGVGYWxsYmFja3MoKVxuICAgIGNvbnN0IGxvY2FsZXMgPSBsb2NhbGUgPyAoZmFsbGJhY2tzPy5bbG9jYWxlXSB8fCBbbG9jYWxlXSkgOiBbXVxuXG4gICAgaWYgKGxvY2FsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gcXVlcnkud2hlcmUoXCIxPTBcIilcblxuICAgIGNvbnN0IGRyaXZlciA9IHF1ZXJ5LmRyaXZlclxuICAgIGNvbnN0IHRyYW5zbGF0aW9uQ2xhc3MgPSB0aGlzLmdldFRyYW5zbGF0aW9uQ2xhc3MoKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKFwiY3VycmVudFRyYW5zbGF0aW9uXCIpXG4gICAgY29uc3QgdGFibGVOYW1lID0gdHJhbnNsYXRpb25DbGFzcy50YWJsZU5hbWUoKVxuICAgIGNvbnN0IHNjb3BlVGFibGVSZWZlcmVuY2UgPSBgJHt0YWJsZU5hbWV9X2N1cnJlbnRfdHJhbnNsYXRpb25fc2NvcGVgXG4gICAgY29uc3QgdGFyZ2V0VGFibGVTcWwgPSBkcml2ZXIucXVvdGVUYWJsZShxdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oKSlcbiAgICBjb25zdCBzY29wZVRhYmxlU3FsID0gZHJpdmVyLnF1b3RlVGFibGUoc2NvcGVUYWJsZVJlZmVyZW5jZSlcbiAgICBjb25zdCBzY29wZVRhYmxlRnJvbVNxbCA9IGAke2RyaXZlci5xdW90ZVRhYmxlKHRhYmxlTmFtZSl9IEFTICR7c2NvcGVUYWJsZVNxbH1gXG4gICAgY29uc3QgcHJpbWFyeUtleUNvbHVtbiA9IHNjYWxhck1vZGVsUHJpbWFyeUtleSh0cmFuc2xhdGlvbkNsYXNzLnByaW1hcnlLZXkoKSwgYEN1cnJlbnQgdHJhbnNsYXRpb24gc2NvcGUgZm9yICR7dHJhbnNsYXRpb25DbGFzcy5uYW1lfWApXG4gICAgY29uc3QgZm9yZWlnbktleUNvbHVtbiA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcbiAgICBjb25zdCB0YXJnZXRQcmltYXJ5S2V5U3FsID0gYCR7dGFyZ2V0VGFibGVTcWx9LiR7ZHJpdmVyLnF1b3RlQ29sdW1uKHByaW1hcnlLZXlDb2x1bW4pfWBcbiAgICBjb25zdCB0YXJnZXRGb3JlaWduS2V5U3FsID0gYCR7dGFyZ2V0VGFibGVTcWx9LiR7ZHJpdmVyLnF1b3RlQ29sdW1uKGZvcmVpZ25LZXlDb2x1bW4pfWBcbiAgICBjb25zdCBzY29wZVByaW1hcnlLZXlTcWwgPSBgJHtzY29wZVRhYmxlU3FsfS4ke2RyaXZlci5xdW90ZUNvbHVtbihwcmltYXJ5S2V5Q29sdW1uKX1gXG4gICAgY29uc3Qgc2NvcGVGb3JlaWduS2V5U3FsID0gYCR7c2NvcGVUYWJsZVNxbH0uJHtkcml2ZXIucXVvdGVDb2x1bW4oZm9yZWlnbktleUNvbHVtbil9YFxuICAgIGNvbnN0IHNjb3BlTG9jYWxlU3FsID0gYCR7c2NvcGVUYWJsZVNxbH0uJHtkcml2ZXIucXVvdGVDb2x1bW4oXCJsb2NhbGVcIil9YFxuICAgIGNvbnN0IGxvY2FsZUxpc3RTcWwgPSBsb2NhbGVzLm1hcCgoZmFsbGJhY2tMb2NhbGUpID0+IGRyaXZlci5xdW90ZShmYWxsYmFja0xvY2FsZSkpLmpvaW4oXCIsIFwiKVxuICAgIGNvbnN0IGxvY2FsZU9yZGVyU3FsID0gbG9jYWxlcy5tYXAoKGZhbGxiYWNrTG9jYWxlLCBpbmRleCkgPT4gYFdIRU4gJHtzY29wZUxvY2FsZVNxbH0gPSAke2RyaXZlci5xdW90ZShmYWxsYmFja0xvY2FsZSl9IFRIRU4gJHtkcml2ZXIucXVvdGUoaW5kZXgpfWApLmpvaW4oXCIgXCIpXG4gICAgY29uc3QgZmFsbGJhY2tPcmRlclNxbCA9IGBDQVNFICR7bG9jYWxlT3JkZXJTcWx9IEVMU0UgJHtkcml2ZXIucXVvdGUobG9jYWxlcy5sZW5ndGgpfSBFTkRgXG4gICAgY29uc3Qgc2VsZWN0ZWRUcmFuc2xhdGlvblNxbCA9IGRyaXZlci5nZXRUeXBlKCkgPT0gXCJtc3NxbFwiXG4gICAgICA/IGBTRUxFQ1QgVE9QIDEgJHtzY29wZVByaW1hcnlLZXlTcWx9IEZST00gJHtzY29wZVRhYmxlRnJvbVNxbH0gV0hFUkUgJHtzY29wZUZvcmVpZ25LZXlTcWx9ID0gJHt0YXJnZXRGb3JlaWduS2V5U3FsfSBBTkQgJHtzY29wZUxvY2FsZVNxbH0gSU4gKCR7bG9jYWxlTGlzdFNxbH0pIE9SREVSIEJZICR7ZmFsbGJhY2tPcmRlclNxbH0sICR7c2NvcGVQcmltYXJ5S2V5U3FsfSBBU0NgXG4gICAgICA6IGBTRUxFQ1QgJHtzY29wZVByaW1hcnlLZXlTcWx9IEZST00gJHtzY29wZVRhYmxlRnJvbVNxbH0gV0hFUkUgJHtzY29wZUZvcmVpZ25LZXlTcWx9ID0gJHt0YXJnZXRGb3JlaWduS2V5U3FsfSBBTkQgJHtzY29wZUxvY2FsZVNxbH0gSU4gKCR7bG9jYWxlTGlzdFNxbH0pIE9SREVSIEJZICR7ZmFsbGJhY2tPcmRlclNxbH0sICR7c2NvcGVQcmltYXJ5S2V5U3FsfSBBU0MgTElNSVQgMWBcblxuICAgIHJldHVybiBxdWVyeS53aGVyZShgJHt0YXJnZXRQcmltYXJ5S2V5U3FsfSA9ICgke3NlbGVjdGVkVHJhbnNsYXRpb25TcWx9KWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHJhbnNsYXRpb24gY2xhc3MuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IC0gVGhlIHRyYW5zbGF0aW9uIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIGdldFRyYW5zbGF0aW9uQ2xhc3MoKSB7XG4gICAgaWYgKHRoaXMuX3RyYW5zbGF0aW9uQ2xhc3MpIHJldHVybiB0aGlzLl90cmFuc2xhdGlvbkNsYXNzXG4gICAgaWYgKHRoaXMudGFibGVOYW1lKCkuZW5kc1dpdGgoXCJfdHJhbnNsYXRpb25zXCIpKSB0aHJvdyBuZXcgRXJyb3IoXCJUcnlpbmcgdG8gZGVmaW5lIGEgdHJhbnNsYXRpb25zIGNsYXNzIGZvciBhIHRyYW5zbGF0aW9uIGNsYXNzXCIpXG5cbiAgICBjb25zdCBjbGFzc05hbWUgPSBgJHt0aGlzLmdldE1vZGVsTmFtZSgpfVRyYW5zbGF0aW9uYFxuICAgIGNvbnN0IFRyYW5zbGF0aW9uQ2xhc3MgPSBjbGFzcyBUcmFuc2xhdGlvbiBleHRlbmRzIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHt9XG4gICAgY29uc3QgYmVsb25nc1RvID0gc2luZ3VsYXJpemVNb2RlbE5hbWUoaW5mbGVjdGlvbi5jYW1lbGl6ZSh0aGlzLnRhYmxlTmFtZSgpLCB0cnVlKSlcblxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShUcmFuc2xhdGlvbkNsYXNzLCBcIm5hbWVcIiwge3ZhbHVlOiBjbGFzc05hbWV9KVxuICAgIFRyYW5zbGF0aW9uQ2xhc3Muc2V0VGFibGVOYW1lKHRoaXMuZ2V0VHJhbnNsYXRpb25zVGFibGVOYW1lKCkpXG4gICAgVHJhbnNsYXRpb25DbGFzcy5iZWxvbmdzVG8oYmVsb25nc1RvKVxuXG4gICAgaWYgKHRoaXMuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSkge1xuICAgICAgY29uc3QgdHJhbnNsYXRlZE1vZGVsQ2xhc3MgPSB0aGlzXG5cbiAgICAgIFRyYW5zbGF0aW9uQ2xhc3Muc3dpdGNoZXNUZW5hbnREYXRhYmFzZSgoe3RlbmFudH0pID0+IHRyYW5zbGF0ZWRNb2RlbENsYXNzLmdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcih0ZW5hbnQpKVxuICAgIH1cblxuICAgIHRoaXMuX3RyYW5zbGF0aW9uQ2xhc3MgPSBUcmFuc2xhdGlvbkNsYXNzXG5cbiAgICByZXR1cm4gdGhpcy5fdHJhbnNsYXRpb25DbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0aW9ucyB0YWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0cmFuc2xhdGlvbnMgdGFibGUgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRUcmFuc2xhdGlvbnNUYWJsZU5hbWUoKSB7XG4gICAgY29uc3QgdGFibGVOYW1lUGFydHMgPSB0aGlzLnRhYmxlTmFtZSgpLnNwbGl0KFwiX1wiKVxuXG4gICAgdGFibGVOYW1lUGFydHNbdGFibGVOYW1lUGFydHMubGVuZ3RoIC0gMV0gPSBpbmZsZWN0aW9uLnNpbmd1bGFyaXplKHRhYmxlTmFtZVBhcnRzW3RhYmxlTmFtZVBhcnRzLmxlbmd0aCAtIDFdKVxuXG4gICAgcmV0dXJuIGAke3RhYmxlTmFtZVBhcnRzLmpvaW4oXCJfXCIpfV90cmFuc2xhdGlvbnNgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgdHJhbnNsYXRpb25zIHRhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBSZXNvbHZlcyB3aXRoIFdoZXRoZXIgaXQgaGFzIHRyYW5zbGF0aW9ucyB0YWJsZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBoYXNUcmFuc2xhdGlvbnNUYWJsZSgpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkuZ2V0VGFibGVCeU5hbWUodGhpcy5nZXRUcmFuc2xhdGlvbnNUYWJsZU5hbWUoKSlcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgdmFsaWRhdGlvbiB0byBhbiBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIFRoZSBuYW1lIG9mIHRoZSBhdHRyaWJ1dGUgdG8gdmFsaWRhdGUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHZhbGlkYXRvcnMgVGhlIHZhbGlkYXRvcnMgdG8gYWRkLiBLZXkgaXMgdGhlIHZhbGlkYXRvciBuYW1lLCB2YWx1ZSBpcyB0aGUgdmFsaWRhdG9yIGFyZ3VtZW50cy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB2YWxpZGF0ZXMoYXR0cmlidXRlTmFtZSwgdmFsaWRhdG9ycykge1xuICAgIGZvciAoY29uc3QgdmFsaWRhdG9yTmFtZSBpbiB2YWxpZGF0b3JzKSB7XG4gICAgICAvKipcbiAgICAgICAqIERlZmluZXMgdmFsaWRhdG9yQXJncy5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBsZXQgdmFsaWRhdG9yQXJnc1xuXG4gICAgICAvKipcbiAgICAgICAqIFVzZSB2YWxpZGF0b3IuXG4gICAgICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICAgIGxldCB1c2VWYWxpZGF0b3IgPSB0cnVlXG5cbiAgICAgIGNvbnN0IHZhbGlkYXRvckFyZ3NDYW5kaWRhdGUgPSB2YWxpZGF0b3JzW3ZhbGlkYXRvck5hbWVdXG5cbiAgICAgIGlmICh0eXBlb2YgdmFsaWRhdG9yQXJnc0NhbmRpZGF0ZSA9PSBcImJvb2xlYW5cIikge1xuICAgICAgICB2YWxpZGF0b3JBcmdzID0ge31cbiAgICAgICAgdXNlVmFsaWRhdG9yXG5cbiAgICAgICAgaWYgKCF2YWxpZGF0b3JBcmdzQ2FuZGlkYXRlKSB7XG4gICAgICAgICAgdXNlVmFsaWRhdG9yID0gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFsaWRhdG9yQXJncyA9IHZhbGlkYXRvckFyZ3NDYW5kaWRhdGVcbiAgICAgIH1cblxuICAgICAgaWYgKCF1c2VWYWxpZGF0b3IpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgVmFsaWRhdG9yQ2xhc3MgPSB0aGlzLmdldFZhbGlkYXRvclR5cGUodmFsaWRhdG9yTmFtZSlcbiAgICAgIGNvbnN0IHZhbGlkYXRvciA9IG5ldyBWYWxpZGF0b3JDbGFzcyh7YXR0cmlidXRlTmFtZSwgYXJnczogdmFsaWRhdG9yQXJnc30pXG5cbiAgICAgIGlmICghdGhpcy5fdmFsaWRhdG9ycykgdGhpcy5fdmFsaWRhdG9ycyA9IHt9XG4gICAgICBpZiAoIShhdHRyaWJ1dGVOYW1lIGluIHRoaXMuX3ZhbGlkYXRvcnMpKSB0aGlzLl92YWxpZGF0b3JzW2F0dHJpYnV0ZU5hbWVdID0gW11cblxuICAgICAgdGhpcy5fdmFsaWRhdG9yc1thdHRyaWJ1dGVOYW1lXS5wdXNoKHZhbGlkYXRvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGdhcC1sZXNzIHBvc2l0aW9uYWwgbGlzdCBjYWxsYmFja3MgZm9yIGEgY29sdW1uIHNjb3BlZCBieVxuICAgKiBhbm90aGVyIGNvbHVtbi4gSW5zZXJ0cyBhbmQgbW92ZXMgc2hpZnQgc3Vycm91bmRpbmcgcG9zaXRpb25zIHNvIHRoZVxuICAgKiBsaXN0IHN0YXlzIGNvbXBhY3QgKDEsMiwzLC4uLikuIERlc3Ryb3lzIGNsb3NlIHRoZSByZXN1bHRpbmcgZ2FwLlxuICAgKlxuICAgKiBDYWxsZXJzIG11c3QgZW5zdXJlIGEgVU5JUVVFIGluZGV4IG9uIChzY29wZUNvbHVtbiwgcG9zaXRpb25Db2x1bW4pXG4gICAqIGV4aXN0cyBpbiB0aGUgZGF0YWJhc2Ug4oCUIHVzZSBgTWlncmF0aW9uLmFkZEFjdHNBc0xpc3QoKWAgZm9yIHRoZVxuICAgKiBzY2hlbWEgaGFsZi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHBvc2l0aW9uQ29sdW1uIC0gY2FtZWxDYXNlIHBvc2l0aW9uIGF0dHJpYnV0ZSAoZS5nLiBcInJvd051bWJlclwiKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnMgLSBPcHRpb25zIHdpdGggYSByZXF1aXJlZCBzY29wZSBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcHRpb25zLnNjb3BlIC0gY2FtZWxDYXNlIHNjb3BlIGF0dHJpYnV0ZSAoZS5nLiBcImJvYXJkQ29sdW1uSWRcIikuXG4gICAqL1xuICBzdGF0aWMgYWN0c0FzTGlzdChwb3NpdGlvbkNvbHVtbiwgb3B0aW9ucykge1xuICAgIGNvbnN0IHtzY29wZX0gPSBvcHRpb25zXG5cbiAgICByZWdpc3RlckFjdHNBc0xpc3RDYWxsYmFja3ModGhpcywgcG9zaXRpb25Db2x1bW4sIHtzY29wZX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cmFuc2xhdGlvbnMgbG9hZGVkLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1RyYW5zbGF0aW9uQmFzZVtdfSAtIFRoZSB0cmFuc2xhdGlvbnMgbG9hZGVkLlxuICAgKi9cbiAgdHJhbnNsYXRpb25zTG9hZGVkKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIid0cmFuc2xhdGlvbnNMb2FkZWQnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0ZWQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsb2NhbGUgLSBMb2NhbGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIHRyYW5zbGF0ZWQgYXR0cmlidXRlLCBpZiBmb3VuZC5cbiAgICovXG4gIF9nZXRUcmFuc2xhdGVkQXR0cmlidXRlKG5hbWUsIGxvY2FsZSkge1xuICAgIGNvbnN0IHRyYW5zbGF0aW9uID0gdGhpcy50cmFuc2xhdGlvbnNMb2FkZWQoKS5maW5kKCh0cmFuc2xhdGlvbikgPT4gdHJhbnNsYXRpb24ubG9jYWxlKCkgPT0gbG9jYWxlKVxuXG4gICAgaWYgKHRyYW5zbGF0aW9uKSB7XG4gICAgICAvKipcbiAgICAgICAqIERpY3QuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3QgZGljdCA9IHRyYW5zbGF0aW9uXG5cbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU1ldGhvZCA9IC8qKiBAdHlwZSB7KCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkfSAqLyAoZGljdFtuYW1lXSlcblxuICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVNZXRob2QgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGVNZXRob2QuYmluZCh0cmFuc2xhdGlvbikoKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIHRyYW5zbGF0ZWQgbWV0aG9kOiAke25hbWV9ICgke3R5cGVvZiBhdHRyaWJ1dGVNZXRob2R9KWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0ZWQgYXR0cmlidXRlIHdpdGggZmFsbGJhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2FsZSAtIExvY2FsZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgdHJhbnNsYXRlZCBhdHRyaWJ1dGUgd2l0aCBmYWxsYmFjaywgaWYgZm91bmQuXG4gICAqL1xuICBfZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZVdpdGhGYWxsYmFjayhuYW1lLCBsb2NhbGUpIHtcbiAgICBsZXQgbG9jYWxlc0luT3JkZXJcbiAgICBjb25zdCBmYWxsYmFja3MgPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0TG9jYWxlRmFsbGJhY2tzKClcblxuICAgIGlmIChmYWxsYmFja3MgJiYgbG9jYWxlIGluIGZhbGxiYWNrcykge1xuICAgICAgbG9jYWxlc0luT3JkZXIgPSBmYWxsYmFja3NbbG9jYWxlXVxuICAgIH0gZWxzZSB7XG4gICAgICBsb2NhbGVzSW5PcmRlciA9IFtsb2NhbGVdXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBmYWxsYmFja0xvY2FsZSBvZiBsb2NhbGVzSW5PcmRlcikge1xuICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5fZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZShuYW1lLCBmYWxsYmFja0xvY2FsZSlcblxuICAgICAgaWYgKHJlc3VsdCAmJiByZXN1bHQudHJpbSgpICE9IFwiXCIpIHtcbiAgICAgICAgcmV0dXJuIHJlc3VsdFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0cmFuc2xhdGVkIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbG9jYWxlIC0gTG9jYWxlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBuZXdWYWx1ZSAtIE5ldyB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGUobmFtZSwgbG9jYWxlLCBuZXdWYWx1ZSkge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgdHJhbnNsYXRpb24uXG4gICAgICogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHwgVHJhbnNsYXRpb25CYXNlIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCB0cmFuc2xhdGlvblxuXG4gICAgdHJhbnNsYXRpb24gPSB0aGlzLnRyYW5zbGF0aW9uc0xvYWRlZCgpPy5maW5kKCh0cmFuc2xhdGlvbikgPT4gdHJhbnNsYXRpb24ubG9jYWxlKCkgPT0gbG9jYWxlKVxuXG4gICAgaWYgKCF0cmFuc2xhdGlvbikge1xuICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShcInRyYW5zbGF0aW9uc1wiKVxuXG4gICAgICB0cmFuc2xhdGlvbiA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmJ1aWxkKHtsb2NhbGV9KVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEFzc2lnbm1lbnRzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYXNzaWdubWVudHMgPSB7fVxuXG4gICAgYXNzaWdubWVudHNbbmFtZV0gPSBuZXdWYWx1ZVxuXG4gICAgdHJhbnNsYXRpb24uYXNzaWduKGFzc2lnbm1lbnRzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV3IHF1ZXJ5LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3tkcml2ZXI/OiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8ICgoKSA9PiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCksIG9wZXJhdGlvbj86IGltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0fX0gW2FyZ3NdIC0gRXhwbGljaXQgcXVlcnkgb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgbmV3IHF1ZXJ5LlxuICAgKi9cbiAgc3RhdGljIF9uZXdRdWVyeShhcmdzID0ge30pIHtcbiAgICBjb25zdCB7ZHJpdmVyOiBnaXZlbkRyaXZlciwgb3BlcmF0aW9uOiBnaXZlbk9wZXJhdGlvbiwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgY29uc3Qgb3BlcmF0aW9uID0gZ2l2ZW5PcGVyYXRpb24gfHwgdGhpcy5fcmVjb3JkTWV0YWRhdGFPcGVyYXRpb25cbiAgICBjb25zdCBkcml2ZXIgPSBnaXZlbkRyaXZlciB8fCAob3BlcmF0aW9uID8gb3BlcmF0aW9uLmNvbm5lY3Rpb24oKSA6ICgpID0+IHRoaXMuY29ubmVjdGlvbigpKVxuICAgIHRoaXMuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgY29uc3QgaGFuZGxlciA9IG5ldyBIYW5kbGVyKClcbiAgICBjb25zdCBxdWVyeSA9IG5ldyBNb2RlbENsYXNzUXVlcnkoe1xuICAgICAgZHJpdmVyLFxuICAgICAgaGFuZGxlcixcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICBvcGVyYXRpb25cbiAgICB9KVxuXG4gICAgcmV0dXJuIHF1ZXJ5LmZyb20obmV3IEZyb21UYWJsZSh0aGlzLnRhYmxlTmFtZSgpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9yZGVyYWJsZSBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIG9yZGVyYWJsZSBjb2x1bW4uXG4gICAqL1xuICBzdGF0aWMgb3JkZXJhYmxlQ29sdW1uKCkge1xuICAgIC8vIEZJWE1FOiBBbGxvdyB0byBjaGFuZ2UgdG8gJ2NyZWF0ZWRfYXQnIGlmIHVzaW5nIFVVSUQ/XG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5wcmltYXJ5S2V5KClcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpKSByZXR1cm4gcHJpbWFyeUtleVswXVxuXG4gICAgcmV0dXJuIHByaW1hcnlLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFsbC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIGFsbC5cbiAgICovXG4gIHN0YXRpYyBhbGwoKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjY2Vzc2libGUgZm9yLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24gdG8gc2NvcGUgYnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IFthYmlsaXR5XSAtIEFiaWxpdHkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIEF1dGhvcml6ZWQgcXVlcnkuXG4gICAqL1xuICBzdGF0aWMgYWNjZXNzaWJsZUZvcihhY3Rpb24sIGFiaWxpdHkpIHtcbiAgICBjb25zdCBxdWVyeSA9IHRoaXMuX25ld1F1ZXJ5KClcbiAgICBjb25zdCBjdXJyZW50QWJpbGl0eSA9IGFiaWxpdHkgfHwgQ3VycmVudC5hYmlsaXR5KClcblxuICAgIGlmICghY3VycmVudEFiaWxpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gYWJpbGl0eSBpbiBjb250ZXh0IGZvciAke3RoaXMubmFtZX0uIFBhc3MgYW4gYWJpbGl0eSBvciBjb25maWd1cmUgYWJpbGl0eSByZXNvbHZlciBvbiB0aGUgcmVxdWVzdGApXG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gKi8gKGN1cnJlbnRBYmlsaXR5LmFwcGx5VG9RdWVyeSh7XG4gICAgICBhY3Rpb24sXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgcXVlcnlcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjY2Vzc2libGUuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IFthYmlsaXR5XSAtIEFiaWxpdHkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIEF1dGhvcml6ZWQgcXVlcnkuXG4gICAqL1xuICBzdGF0aWMgYWNjZXNzaWJsZShhYmlsaXR5KSB7XG4gICAgcmV0dXJuIHRoaXMuYWNjZXNzaWJsZUZvcihcInJlYWRcIiwgYWJpbGl0eSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjY2Vzc2libGUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHR9IGFiaWxpdHkgLSBBYmlsaXR5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBBdXRob3JpemVkIHF1ZXJ5LlxuICAgKi9cbiAgc3RhdGljIGFjY2Vzc2libGVCeShhYmlsaXR5KSB7XG4gICAgaWYgKCFhYmlsaXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGFiaWxpdHkgcGFzc2VkIHRvICR7dGhpcy5uYW1lfS5hY2Nlc3NpYmxlQnkoYWJpbGl0eSkuYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5hY2Nlc3NpYmxlKGFiaWxpdHkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb3VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb3VudC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjb3VudCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmNvdW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdyb3VwLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gZ3JvdXAgLSBHcm91cC5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIGdyb3VwLlxuICAgKi9cbiAgc3RhdGljIGdyb3VwKGdyb3VwKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KCkuZ3JvdXAoZ3JvdXApXG4gIH1cblxuICBzdGF0aWMgYXN5bmMgZGVzdHJveUFsbCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmRlc3Ryb3lBbGwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGx1Y2suXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7Li4uc3RyaW5nfHN0cmluZ1tdfSBjb2x1bW5zIC0gQ29sdW1uIG5hbWVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHBsdWNrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHBsdWNrKC4uLmNvbHVtbnMpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLnBsdWNrKC4uLmNvbHVtbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSByZWNvcmRJZCAtIFJlY29yZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZmluZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kKHJlY29yZElkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5maW5kKHJlY29yZElkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHt7W2tleTogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyfX0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMgaGFzaCBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPiB8IG51bGw+fSAtIFJlc29sdmVzIHdpdGggdGhlIGJ5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRCeShjb25kaXRpb25zKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5maW5kQnkoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgb3IgZmFpbC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHt7W2tleTogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyfX0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMgaGFzaCBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYnkgb3IgZmFpbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kQnlPckZhaWwoY29uZGl0aW9ucykge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkuZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhbiBpbW11dGFibGUgdGVuYW50LWJvdW5kIG1vZGVsIHNjb3BlLiBFYWdlciBoZWxwZXJzIGFuZCBleHBsaWNpdFxuICAgKiBkYXRhYmFzZU9wZXJhdGlvbi90cmFuc2FjdGlvbiBjYWxsYmFja3MgZXhlY3V0ZSBmcm9tIGEgY2FwdHVyZWQgcGh5c2ljYWxcbiAgICogZGF0YWJhc2UgY29uZmlndXJhdGlvbiBpbnN0ZWFkIG9mIGFtYmllbnQgdGVuYW50IHN0YXRlLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge29iamVjdH0gdGVuYW50IC0gT3JkaW5hcnkgb3IgbnVsbC1wcm90b3R5cGUgSlNPTi1jb21wYXRpYmxlIHRlbmFudCBkZXNjcmlwdG9yIHRvIHNjb3BlIHRoZSBtb2RlbCB0by5cbiAgICogQHJldHVybnMge1RlbmFudE1vZGVsU2NvcGU8TUM+fSAtIE1vZGVsIHNjb3BlIGJvdW5kIHRvIHRoZSBjYXB0dXJlZCB0ZW5hbnQgZGF0YWJhc2UuXG4gICAqL1xuICBzdGF0aWMgdXNpbmdUZW5hbnQodGVuYW50KSB7XG4gICAgcmV0dXJuIG5ldyBUZW5hbnRNb2RlbFNjb3BlKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICB0ZW5hbnRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBjcmVhdGUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7e1trZXk6IHN0cmluZ106IHN0cmluZyB8IG51bWJlcn19IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIGhhc2gga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBvciBjcmVhdGUgYnkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZE9yQ3JlYXRlQnkoY29uZGl0aW9ucywgY2FsbGJhY2spIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmZpbmRPckNyZWF0ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBpbml0aWFsaXplIGJ5LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zLlxuICAgKiBAcGFyYW0geyhhcmc6IEluc3RhbmNlVHlwZTxNQz4pID0+IHZvaWR9IFtjYWxsYmFja10gLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgb3IgaW5pdGlhbGl6ZSBieS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucywgY2FsbGJhY2spIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmZpbmRPckluaXRpYWxpemVCeShjb25kaXRpb25zLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpcnN0LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBmaXJzdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaXJzdCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkuZmlyc3QoKVxuXG4gICAgaWYgKCFyZXN1bHQpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9LmZpcnN0KCkgcmV0dXJuZWQgbm8gcmVjb3Jkc2ApXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBqb2lucy5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBpbXBvcnQoXCIuLi9xdWVyeS9qb2luLW9iamVjdC5qc1wiKS5Kb2luT2JqZWN0fSBqb2luIC0gSm9pbiBjbGF1c2Ugb3Igam9pbiBkZXNjcmlwdG9yLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgam9pbnMuXG4gICAqL1xuICBzdGF0aWMgam9pbnMoam9pbikge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLmpvaW5zKGpvaW4pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsYXN0LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBsYXN0LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGxhc3QoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmxhc3QoKVxuXG4gICAgaWYgKCFyZXN1bHQpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9Lmxhc3QoKSByZXR1cm5lZCBubyByZWNvcmRzYClcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxpbWl0LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBsaW1pdC5cbiAgICovXG4gIHN0YXRpYyBsaW1pdCh2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLmxpbWl0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3JkZXIuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuT3JkZXJBcmd1bWVudFR5cGV9IG9yZGVyIC0gT3JkZXIuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBvcmRlci5cbiAgICovXG4gIHN0YXRpYyBvcmRlcihvcmRlcikge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLm9yZGVyKG9yZGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzdGluY3QuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW3ZhbHVlXSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIGRpc3RpbmN0LlxuICAgKi9cbiAgc3RhdGljIGRpc3RpbmN0KHZhbHVlID0gdHJ1ZSkge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLmRpc3RpbmN0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlbG9hZC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHByZWxvYWQgLSBQcmVsb2FkLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgcHJlbG9hZC5cbiAgICovXG4gIHN0YXRpYyBwcmVsb2FkKHByZWxvYWQpIHtcbiAgICBjb25zdCBxdWVyeSA9IC8qKiBAdHlwZSB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gKi8gKHRoaXMuX25ld1F1ZXJ5KCkucHJlbG9hZChwcmVsb2FkKSlcblxuICAgIHJldHVybiBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VsZWN0LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLlNlbGVjdEFyZ3VtZW50VHlwZX0gc2VsZWN0IC0gU2VsZWN0LlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgc2VsZWN0LlxuICAgKi9cbiAgc3RhdGljIHNlbGVjdChzZWxlY3QpIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS5zZWxlY3Qoc2VsZWN0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYXJyYXkuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz5bXT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYXJyYXkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgdG9BcnJheSgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLnRvQXJyYXkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPltdPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBhcnJheS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsb2FkKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkubG9hZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGVyZS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5XaGVyZUFyZ3VtZW50VHlwZX0gd2hlcmUgLSBXaGVyZS5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIHdoZXJlLlxuICAgKi9cbiAgc3RhdGljIHdoZXJlKHdoZXJlKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KCkud2hlcmUod2hlcmUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByYW5zYWNrLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmFuc2Fjay1zdHlsZSBwYXJhbXMgaGFzaC5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gUXVlcnkgd2l0aCBSYW5zYWNrIGZpbHRlcnMgYXBwbGllZC5cbiAgICovXG4gIHN0YXRpYyByYW5zYWNrKHBhcmFtcykge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLnJhbnNhY2socGFyYW1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7V3JpdGVBdHRyaWJ1dGVzfSBjaGFuZ2VzIC0gQ2hhbmdlcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGNoYW5nZXMgPSAvKiogQHR5cGUge1dyaXRlQXR0cmlidXRlc30gKi8gKHt9KSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gKi8gKG5ldy50YXJnZXQpXG5cbiAgICB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbiA9IE1vZGVsQ2xhc3MuX3JlY29yZE1ldGFkYXRhT3BlcmF0aW9uXG4gICAgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgdGhpcy5fYXR0cmlidXRlcyA9IHt9XG4gICAgdGhpcy5fY2hhbmdlcyA9IHt9XG4gICAgdGhpcy5faXNOZXdSZWNvcmQgPSB0cnVlXG5cbiAgICBmb3IgKGNvbnN0IGtleSBpbiBjaGFuZ2VzKSB7XG4gICAgICB0aGlzLnNldEF0dHJpYnV0ZShrZXksIGNoYW5nZXNba2V5XSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQmluZHMgZnV0dXJlIHF1ZXJ5LCBsaWZlY3ljbGUsIHJlbGF0aW9uc2hpcCwgYW5kIHBlcnNpc3RlbmNlIHdvcmsgdG8gYW4gb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBvcGVyYXRpb24gLSBPd25pbmcgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBCb3VuZCByZWNvcmQuXG4gICAqL1xuICBiaW5kRGF0YWJhc2VPcGVyYXRpb24ob3BlcmF0aW9uKSB7XG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uICYmIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uICE9PSBvcGVyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlY29yZCBpcyBhbHJlYWR5IGJvdW5kIHRvIGFub3RoZXIgZGF0YWJhc2Ugb3BlcmF0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24gPSBvcGVyYXRpb25cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgYW5kIHZhbGlkYXRlcyB0aGUgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkgdGhhdCBvd25zIHRoaXMgcmVjb3JkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGl0eSAtIE9wYXF1ZSBvcGVyYXRpb24vY29ubmVjdGlvbiBpZGVudGl0eS5cbiAgICogQHJldHVybnMge3RoaXN9IFRoaXMgcmVjb3JkLlxuICAgKi9cbiAgY2FwdHVyZURhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSkge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZUlkZW50aXR5ICYmIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgIT09IGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlY29yZCBiZWxvbmdzIHRvIGEgZGlmZmVyZW50IHBoeXNpY2FsIHRlbmFudCBkYXRhYmFzZVwiKVxuICAgIH1cblxuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgPSBkYXRhYmFzZUlkZW50aXR5XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNhcHR1cmVkIHBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSBDYXB0dXJlZCBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAgICovXG4gIGRhdGFiYXNlSWRlbnRpdHkoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyB0aGlzIHJlY29yZCBmcm9tIGEgY29tcGxldGVkIGVhZ2VyLWhlbHBlciBvcGVyYXRpb24gd2hpbGVcbiAgICogcHJlc2VydmluZyB0aGUgbGVnYWN5IGFtYmllbnQgZm9sbG93LXVwIGJlaGF2aW9yIG9mIGB1c2luZ1RlbmFudGAgZmluZGVycy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdH0gb3BlcmF0aW9uIC0gUmVsZWFzaW5nIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUmVjb3JkLlxuICAgKi9cbiAgcmVsZWFzZURhdGFiYXNlT3BlcmF0aW9uKG9wZXJhdGlvbikge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbiAhPT0gb3BlcmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWNvcmQgaXMgbm90IGJvdW5kIHRvIHRoZSByZWxlYXNpbmcgZGF0YWJhc2Ugb3BlcmF0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24gPSB1bmRlZmluZWRcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZXhwbGljaXQgb3BlcmF0aW9uIG93bmluZyB0aGlzIHJlY29yZCwgaWYgYW55LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gT3duaW5nIG9wZXJhdGlvbi5cbiAgICovXG4gIGRhdGFiYXNlT3BlcmF0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEJpbmRzIGEgcmVsYXRlZCByZWNvcmQgdG8gdGhlIHNhbWUgb3BlcmF0aW9uIGFzIHRoaXMgcmVjb3JkLlxuICAgKiBAdGVtcGxhdGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNb2RlbFxuICAgKiBAcGFyYW0ge01vZGVsfSByZWNvcmQgLSBSZWxhdGVkIHJlY29yZC5cbiAgICogQHJldHVybnMge01vZGVsfSAtIFJlbGF0ZWQgcmVjb3JkLlxuICAgKi9cbiAgYmluZFJlbGF0ZWRSZWNvcmQocmVjb3JkKSB7XG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi5iaW5kUmVjb3JkKHJlY29yZClcblxuICAgIHJldHVybiByZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBtb2RlbCBxdWVyeSBwcmVzZXJ2aW5nIHRoaXMgcmVjb3JkJ3Mgb3BlcmF0aW9uIG93bmVyc2hpcC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEBwYXJhbSB7TUN9IE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRhcmdldCBxdWVyeS5cbiAgICovXG4gIHF1ZXJ5Rm9yTW9kZWwoTW9kZWxDbGFzcykge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbikgcmV0dXJuIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLmZvck1vZGVsKE1vZGVsQ2xhc3MpXG5cbiAgICByZXR1cm4gTW9kZWxDbGFzcy5fbmV3UXVlcnkoKVxuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemVzIGEgcmVsYXRpb25zaGlwL3ByZWxvYWQgdGFyZ2V0IHdpdGhvdXQgZHJvcHBpbmcgdGhpcyByZWNvcmQnc1xuICAgKiBleHBsaWNpdCBvcGVyYXRpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gT3duaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVNb2RlbENsYXNzSW5pdGlhbGl6ZWQoTW9kZWxDbGFzcywgY29uZmlndXJhdGlvbikge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbikge1xuICAgICAgYXdhaXQgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24uZW5zdXJlTW9kZWxJbml0aWFsaXplZChNb2RlbENsYXNzKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgTW9kZWxDbGFzcy5lbnN1cmVJbml0aWFsaXplZCh7Y29uZmlndXJhdGlvbn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkIGV4aXN0aW5nIHJlY29yZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBsb2FkRXhpc3RpbmdSZWNvcmQoYXR0cmlidXRlcykge1xuICAgIHRoaXMuX2F0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzXG4gICAgdGhpcy5faXNOZXdSZWNvcmQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgdGhlIGdpdmVuIGF0dHJpYnV0ZXMgdG8gdGhlIHJlY29yZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXNUb0Fzc2lnbiAtIEF0dHJpYnV0ZXMgdG8gYXNzaWduLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhc3NpZ24oYXR0cmlidXRlc1RvQXNzaWduKSB7XG4gICAgdGhpcy5fYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyB8fD0gbmV3IFNldCgpXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVUb0Fzc2lnbiBpbiBhdHRyaWJ1dGVzVG9Bc3NpZ24pIHtcbiAgICAgIHRoaXMuX2Fzc2lnbmVkQXR0cmlidXRlTmFtZXMuYWRkKGF0dHJpYnV0ZVRvQXNzaWduKVxuICAgICAgdGhpcy5zZXRBdHRyaWJ1dGUoYXR0cmlidXRlVG9Bc3NpZ24sIGF0dHJpYnV0ZXNUb0Fzc2lnblthdHRyaWJ1dGVUb0Fzc2lnbl0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSB0aGUgY3VycmVudCBhdHRyaWJ1dGVzIG9mIHRoZSByZWNvcmQgKG9yaWdpbmFsIGF0dHJpYnV0ZXMgZnJvbSBkYXRhYmFzZSBwbHVzIGNoYW5nZXMpXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBhdHRyaWJ1dGVzKCkge1xuICAgIGNvbnN0IGRhdGEgPSB0aGlzLnJhd0F0dHJpYnV0ZXMoKVxuICAgIGNvbnN0IGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcbiAgICAvKipcbiAgICAgKiBBdHRyaWJ1dGVzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGNvbHVtbk5hbWUgaW4gZGF0YSkge1xuICAgICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVbY29sdW1uTmFtZV0gfHwgY29sdW1uTmFtZVxuXG4gICAgICBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdGhpcy5yZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGNvbHVtbi1uYW1lIGtleWVkIGRhdGEgKG9yaWdpbmFsIGF0dHJpYnV0ZXMgZnJvbSBkYXRhYmFzZSBwbHVzIGNoYW5nZXMpXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIHJhdyBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgcmF3QXR0cmlidXRlcygpIHtcbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fYXR0cmlidXRlcywgdGhpcy5fY2hhbmdlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgY29ubmVjdGlvbi5cbiAgICovXG4gIF9jb25uZWN0aW9uKCkge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbikgcmV0dXJuIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLmNvbm5lY3Rpb24oKVxuICAgIGlmICh0aGlzLl9fY29ubmVjdGlvbikgcmV0dXJuIHRoaXMuX19jb25uZWN0aW9uXG5cbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuY29ubmVjdGlvbigpXG5cbiAgICBpZiAodGhpcy5fZGF0YWJhc2VJZGVudGl0eSkgdGhpcy5jYXB0dXJlRGF0YWJhc2VJZGVudGl0eSh0aGlzLl9kYXRhYmFzZUlkZW50aXR5Rm9yQ29ubmVjdGlvbihjb25uZWN0aW9uKSlcblxuICAgIHJldHVybiBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGlkZW50aXR5IG9mIGFuIGFscmVhZHkgc2VsZWN0ZWQgY29uY3JldGUgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIENvbmNyZXRlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5LlxuICAgKi9cbiAgX2RhdGFiYXNlSWRlbnRpdHlGb3JDb25uZWN0aW9uKGNvbm5lY3Rpb24pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgY29uc3QgcmV1c2VLZXkgPSBtb2RlbENsYXNzXG4gICAgICAuX2dldENvbmZpZ3VyYXRpb24oKVxuICAgICAgLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgICAuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleShjb25uZWN0aW9uKVxuXG4gICAgcmV0dXJuIGAke2RhdGFiYXNlSWRlbnRpZmllcn06JHtyZXVzZUtleX1gXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY29ubmVjdGlvbiB0aGF0IG93bnMgdGhpcyByZWNvcmQncyBkYXRhYmFzZSB3b3JrLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gQ29ubmVjdGlvbi5cbiAgICovXG4gIGNvbm5lY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Nvbm5lY3Rpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBkZXBlbmRlbnQgcmVjb3JkcyBmb3IgYSBgZGVwZW5kZW50OiBcInJlc3RyaWN0XCJgIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtSZXN0cmljdEluc3RhbmNlUmVsYXRpb25zaGlwfSBpbnN0YW5jZVJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZSB0byBjb3VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBEZXBlbmRlbnQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX2RlcGVuZGVudFJlc3RyaWN0Q291bnQoaW5zdGFuY2VSZWxhdGlvbnNoaXApIHtcbiAgICBjb25zdCBUYXJnZXRNb2RlbENsYXNzID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIVRhcmdldE1vZGVsQ2xhc3MgfHwgIVRhcmdldE1vZGVsQ2xhc3MuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSkge1xuICAgICAgcmV0dXJuIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLnF1ZXJ5KCkuY291bnQoKVxuICAgIH1cblxuICAgIGlmICh0aGlzLmdldE1vZGVsQ2xhc3MoKS5oYXNUZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlcigpKSB7XG4gICAgICByZXR1cm4gYXdhaXQgaW5zdGFuY2VSZWxhdGlvbnNoaXAucXVlcnkoKS5jb3VudCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2RlcGVuZGVudFJlc3RyaWN0VGVuYW50Q291bnQoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MpXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIHRlbmFudC1zY29wZWQgZGVwZW5kZW50IHJlY29yZHMgYWNyb3NzIGFsbCBwcm92aWRlci1saXN0ZWQgdGVuYW50cy5cbiAgICogQHBhcmFtIHtSZXN0cmljdEluc3RhbmNlUmVsYXRpb25zaGlwfSBpbnN0YW5jZVJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZSB0byBjb3VudC5cbiAgICogQHBhcmFtIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IFRhcmdldE1vZGVsQ2xhc3MgLSBSZWxhdGVkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIERlcGVuZGVudCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfZGVwZW5kZW50UmVzdHJpY3RUZW5hbnRDb3VudChpbnN0YW5jZVJlbGF0aW9uc2hpcCwgVGFyZ2V0TW9kZWxDbGFzcykge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgdGVuYW50RGF0YWJhc2VQcm92aWRlcnMgPSBjb25maWd1cmF0aW9uLmdldFRlbmFudERhdGFiYXNlUHJvdmlkZXJzKClcbiAgICBjb25zdCBwcm92aWRlckVudHJpZXMgPSBPYmplY3QuZW50cmllcyh0ZW5hbnREYXRhYmFzZVByb3ZpZGVycylcbiAgICBjb25zdCB0YXJnZXRJZGVudGlmaWVyID0gVGFyZ2V0TW9kZWxDbGFzcy5nZXRUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIobnVsbClcblxuICAgIGlmIChwcm92aWRlckVudHJpZXMubGVuZ3RoID09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGNoZWNrIGRlcGVuZGVudCAke2luc3RhbmNlUmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcCgpLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gYmVjYXVzZSAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9IHN3aXRjaGVzIHRlbmFudCBkYXRhYmFzZXMgYnV0IG5vIHRlbmFudCBkYXRhYmFzZSBwcm92aWRlcnMgYXJlIGNvbmZpZ3VyZWRgKVxuICAgIH1cblxuICAgIGlmICh0YXJnZXRJZGVudGlmaWVyKSB7XG4gICAgICBjb25zdCBwcm92aWRlciA9IHRlbmFudERhdGFiYXNlUHJvdmlkZXJzW3RhcmdldElkZW50aWZpZXJdXG5cbiAgICAgIGlmICghcHJvdmlkZXIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgY2hlY2sgZGVwZW5kZW50ICR7aW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfSBiZWNhdXNlICR7VGFyZ2V0TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gc3dpdGNoZXMgdGVuYW50IGRhdGFiYXNlICR7dGFyZ2V0SWRlbnRpZmllcn0gYnV0IG5vIHRlbmFudCBkYXRhYmFzZSBwcm92aWRlciBpcyBjb25maWd1cmVkIGZvciAke3RhcmdldElkZW50aWZpZXJ9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2RlcGVuZGVudFJlc3RyaWN0UHJvdmlkZXJDb3VudChpbnN0YW5jZVJlbGF0aW9uc2hpcCwgVGFyZ2V0TW9kZWxDbGFzcywgdGFyZ2V0SWRlbnRpZmllciwgcHJvdmlkZXIpXG4gICAgfVxuXG4gICAgbGV0IG1hdGNoaW5nUHJvdmlkZXJTZWVuID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgW2lkZW50aWZpZXIsIHByb3ZpZGVyXSBvZiBwcm92aWRlckVudHJpZXMpIHtcbiAgICAgIGNvbnN0IHRlbmFudHMgPSBhd2FpdCB0aGlzLl9kZXBlbmRlbnRSZXN0cmljdFByb3ZpZGVyVGVuYW50cyhpbnN0YW5jZVJlbGF0aW9uc2hpcCwgVGFyZ2V0TW9kZWxDbGFzcywgaWRlbnRpZmllciwgcHJvdmlkZXIpXG5cbiAgICAgIGZvciAoY29uc3QgdGVuYW50IG9mIHRlbmFudHMpIHtcbiAgICAgICAgaWYgKFRhcmdldE1vZGVsQ2xhc3MuZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKHRlbmFudCkgIT0gaWRlbnRpZmllcikge1xuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBtYXRjaGluZ1Byb3ZpZGVyU2VlbiA9IHRydWVcblxuICAgICAgICBjb25zdCBjb3VudCA9IGF3YWl0IGNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBpZiAoIWNvbmZpZ3VyYXRpb24uaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUoaWRlbnRpZmllcikpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIgJHtpZGVudGlmaWVyfSBpcyBpbmFjdGl2ZSB3aGlsZSBjaGVja2luZyBkZXBlbmRlbnQgJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9YClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW2lkZW50aWZpZXJdLCBuYW1lOiBgRGVwZW5kZW50IHJlc3RyaWN0IGNvdW50OiAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBpbnN0YW5jZVJlbGF0aW9uc2hpcC5xdWVyeSgpLmNvdW50KClcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChjb3VudCA+IDApIHJldHVybiBjb3VudFxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghbWF0Y2hpbmdQcm92aWRlclNlZW4pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGNoZWNrIGRlcGVuZGVudCAke2luc3RhbmNlUmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcCgpLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gYmVjYXVzZSBubyB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgbWF0Y2hlZCAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gMFxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyB0ZW5hbnQtc2NvcGVkIGRlcGVuZGVudCByZWNvcmRzIGZvciBvbmUgY29uZmlndXJlZCB0ZW5hbnQgcHJvdmlkZXIuXG4gICAqIEBwYXJhbSB7UmVzdHJpY3RJbnN0YW5jZVJlbGF0aW9uc2hpcH0gaW5zdGFuY2VSZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UgdG8gY291bnQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBUYXJnZXRNb2RlbENsYXNzIC0gUmVsYXRlZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBUZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtUZW5hbnREYXRhYmFzZVByb3ZpZGVyVHlwZX0gcHJvdmlkZXIgLSBUZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gRGVwZW5kZW50IHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIF9kZXBlbmRlbnRSZXN0cmljdFByb3ZpZGVyQ291bnQoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MsIGlkZW50aWZpZXIsIHByb3ZpZGVyKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCB0ZW5hbnRzID0gYXdhaXQgdGhpcy5fZGVwZW5kZW50UmVzdHJpY3RQcm92aWRlclRlbmFudHMoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MsIGlkZW50aWZpZXIsIHByb3ZpZGVyKVxuXG4gICAgZm9yIChjb25zdCB0ZW5hbnQgb2YgdGVuYW50cykge1xuICAgICAgY29uc3QgY291bnQgPSBhd2FpdCBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQodGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmICghY29uZmlndXJhdGlvbi5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZShpZGVudGlmaWVyKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIgJHtpZGVudGlmaWVyfSBpcyBpbmFjdGl2ZSB3aGlsZSBjaGVja2luZyBkZXBlbmRlbnQgJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9YClcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBbaWRlbnRpZmllcl0sIG5hbWU6IGBEZXBlbmRlbnQgcmVzdHJpY3QgY291bnQ6ICR7VGFyZ2V0TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBpbnN0YW5jZVJlbGF0aW9uc2hpcC5xdWVyeSgpLmNvdW50KClcbiAgICAgICAgfSlcbiAgICAgIH0pXG5cbiAgICAgIGlmIChjb3VudCA+IDApIHJldHVybiBjb3VudFxuICAgIH1cblxuICAgIHJldHVybiAwXG4gIH1cblxuICAvKipcbiAgICogTGlzdHMgcmVzdHJpY3QtY2hlY2sgdGVuYW50cyBmb3Igb25lIGNvbmZpZ3VyZWQgdGVuYW50IHByb3ZpZGVyLlxuICAgKiBAcGFyYW0ge1Jlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXB9IGluc3RhbmNlUmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlIHRvIGNvdW50LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gVGFyZ2V0TW9kZWxDbGFzcyAtIFJlbGF0ZWQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gVGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7VGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGV9IHByb3ZpZGVyIC0gVGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIExpc3RlZCB0ZW5hbnQgb2JqZWN0cy5cbiAgICovXG4gIGFzeW5jIF9kZXBlbmRlbnRSZXN0cmljdFByb3ZpZGVyVGVuYW50cyhpbnN0YW5jZVJlbGF0aW9uc2hpcCwgVGFyZ2V0TW9kZWxDbGFzcywgaWRlbnRpZmllciwgcHJvdmlkZXIpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuX2dldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGxpc3RUZW5hbnRzID0gdHlwZW9mIHByb3ZpZGVyLmxpc3RSZXN0cmljdFRlbmFudHMgPT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHByb3ZpZGVyLmxpc3RSZXN0cmljdFRlbmFudHNcbiAgICAgIDogcHJvdmlkZXIubGlzdFRlbmFudHNcbiAgICBjb25zdCBsaXN0VGVuYW50c01ldGhvZE5hbWUgPSB0eXBlb2YgcHJvdmlkZXIubGlzdFJlc3RyaWN0VGVuYW50cyA9PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gXCJsaXN0UmVzdHJpY3RUZW5hbnRzXCJcbiAgICAgIDogXCJsaXN0VGVuYW50c1wiXG5cbiAgICBpZiAodHlwZW9mIGxpc3RUZW5hbnRzICE9IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgZm9yICR7aWRlbnRpZmllcn0gbXVzdCBkZWZpbmUgbGlzdFRlbmFudHMgb3IgbGlzdFJlc3RyaWN0VGVuYW50cyBiZWZvcmUgZGVwZW5kZW50IHJlc3RyaWN0IGNhbiBjaGVjayAke2luc3RhbmNlUmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcCgpLmdldFJlbGF0aW9uc2hpcE5hbWUoKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHRlbmFudHMgPSBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBgRGVwZW5kZW50IHJlc3RyaWN0IHRlbmFudHM6ICR7VGFyZ2V0TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGxpc3RUZW5hbnRzKHtcbiAgICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgICAgaWRlbnRpZmllclxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHRlbmFudHMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCBkYXRhYmFzZSBwcm92aWRlciBmb3IgJHtpZGVudGlmaWVyfSBtdXN0IHJldHVybiBhbiBhcnJheSBmcm9tICR7bGlzdFRlbmFudHNNZXRob2ROYW1lfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRlbmFudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgd2hpbGUgcHJpbWFyeS1rZXkgcmVhZHMgcmVzb2x2ZSB0byB0aGUgcGVyc2lzdGVkIGlkZW50aXR5LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdGhhdCByZXF1aXJlcyB0aGUgc3RvcmVkIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjYWxsYmFjayBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBfd2l0aFBlcnNpc3RlZFByaW1hcnlLZXkoY2FsbGJhY2spIHtcbiAgICBjb25zdCBwcmV2aW91c1JlYWRzUGVyc2lzdGVkUHJpbWFyeUtleSA9IHRoaXMuX3JlYWRzUGVyc2lzdGVkUHJpbWFyeUtleVxuXG4gICAgdGhpcy5fcmVhZHNQZXJzaXN0ZWRQcmltYXJ5S2V5ID0gdHJ1ZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fcmVhZHNQZXJzaXN0ZWRQcmltYXJ5S2V5ID0gcHJldmlvdXNSZWFkc1BlcnNpc3RlZFByaW1hcnlLZXlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVzdHJveXMgdGhlIHJlY29yZCBpbiB0aGUgZGF0YWJhc2UgYW5kIGFsbCBvZiBpdHMgZGVwZW5kZW50IHJlY29yZHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBkZXN0cm95KCkge1xuICAgIGF3YWl0IHRoaXMuX3dpdGhQZXJzaXN0ZWRQcmltYXJ5S2V5KGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Rlc3Ryb3lQZXJzaXN0ZWRSZWNvcmQoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgZGVzdHJveSBsaWZlY3ljbGUgYWZ0ZXIgdGhlIHBlcnNpc3RlZCBpZGVudGl0eSBoYXMgYmVlbiByZXN0b3JlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9kZXN0cm95UGVyc2lzdGVkUmVjb3JkKCkge1xuICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImJlZm9yZURlc3Ryb3lcIilcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwIG9mIHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldFJlbGF0aW9uc2hpcHMoKSkge1xuICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXREZXBlbmRlbnQoKSA9PSBcInJlc3RyaWN0XCIpIHtcbiAgICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSAvKiogQHR5cGUge1Jlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXB9ICovICh0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpKSlcbiAgICAgICAgY29uc3QgY291bnQgPSBhd2FpdCB0aGlzLl9kZXBlbmRlbnRSZXN0cmljdENvdW50KGluc3RhbmNlUmVsYXRpb25zaGlwKVxuXG4gICAgICAgIGlmIChjb3VudCA+IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBkZWxldGUgcmVjb3JkIGJlY2F1c2UgZGVwZW5kZW50ICR7cmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gZXhpc3RgKVxuICAgICAgICB9XG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXREZXBlbmRlbnQoKSAhPSBcImRlc3Ryb3lcIikge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCkpXG5cbiAgICAgIC8qKlxuICAgICAgICogRGVmaW5lcyBtb2RlbHMuXG4gICAgICAgKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXX0gKi9cbiAgICAgIGxldCBtb2RlbHNcblxuICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImJlbG9uZ3NUb1wiKSB7XG4gICAgICAgIGlmICghaW5zdGFuY2VSZWxhdGlvbnNoaXAuaXNMb2FkZWQoKSkge1xuICAgICAgICAgIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWQoKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbW9kZWwgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChtb2RlbCBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSB7XG4gICAgICAgICAgbW9kZWxzID0gW21vZGVsXVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBsb2FkZWQgdHlwZTogJHt0eXBlb2YgbW9kZWx9YClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJoYXNNYW55XCIpIHtcbiAgICAgICAgaWYgKCFpbnN0YW5jZVJlbGF0aW9uc2hpcC5pc0xvYWRlZCgpKSB7XG4gICAgICAgICAgYXdhaXQgaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZCgpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsb2FkZWRNb2RlbHMgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGxvYWRlZE1vZGVscykpIHtcbiAgICAgICAgICBtb2RlbHMgPSBsb2FkZWRNb2RlbHNcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgbG9hZGVkIHR5cGU6ICR7dHlwZW9mIGxvYWRlZE1vZGVsc31gKVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc09uZVwiKSB7XG4gICAgICAgIGlmICghaW5zdGFuY2VSZWxhdGlvbnNoaXAuaXNMb2FkZWQoKSkge1xuICAgICAgICAgIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWQoKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbG9hZGVkTW9kZWwgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChsb2FkZWRNb2RlbCBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSB7XG4gICAgICAgICAgbW9kZWxzID0gW2xvYWRlZE1vZGVsXVxuICAgICAgICB9IGVsc2UgaWYgKGxvYWRlZE1vZGVsID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBtb2RlbHMgPSBbXVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBsb2FkZWQgdHlwZTogJHt0eXBlb2YgbG9hZGVkTW9kZWx9YClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmhhbmRsZWQgcmVsYXRpb25zaGlwIHR5cGU6ICR7aW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpfWApXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbW9kZWxzKSB7XG4gICAgICAgIGlmIChtb2RlbC5pc1BlcnNpc3RlZCgpKSB7XG4gICAgICAgICAgYXdhaXQgbW9kZWwuZGVzdHJveSgpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb25kaXRpb25zLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgY29uZGl0aW9ucyA9IHt9XG5cbiAgICBPYmplY3QuYXNzaWduKGNvbmRpdGlvbnMsIG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnModGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpLCB0aGlzLl9wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSkpXG5cbiAgICBjb25zdCBzcWwgPSB0aGlzLl9jb25uZWN0aW9uKCkuZGVsZXRlU3FsKHtcbiAgICAgIGNvbmRpdGlvbnMsXG4gICAgICB0YWJsZU5hbWU6IHRoaXMuX3RhYmxlTmFtZSgpXG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMuX2Nvbm5lY3Rpb24oKS5xdWVyeShzcWwsIHtsb2dOYW1lOiBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBEZXN0cm95YH0pXG4gICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYWZ0ZXJEZXN0cm95XCIpXG4gICAgYXdhaXQgdGhpcy5fZW1pdFJlY29yZENoYW5nZUFmdGVyQ29tbWl0KFwiZGVzdHJveVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIEVtaXRzIGEgY29tbWl0dGVkIHJlY29yZC1jaGFuZ2UgZXZlbnQgYWZ0ZXIgdGhlIHN1cnJvdW5kaW5nIHRyYW5zYWN0aW9uXG4gICAqIGNvbW1pdHMsIHNvIGxpdmUgcXVlcmllcyByZS1ydW4gdW5pZm9ybWx5IGZvciBsb2NhbCB3cml0ZXMsIHB1bGwgYXBwbGllcywgYW5kXG4gICAqIHJlYWx0aW1lIGFwcGxpZXMgKHdoaWNoIGFsbCBlbmQgYXMgbG9jYWwgc2F2ZXMvZGVzdHJveXMpLiBSZWdpc3RlcmVkIHRocm91Z2hcbiAgICogdGhlIGNvbm5lY3Rpb24ncyBhZnRlckNvbW1pdCBob29rIHNvIGEgcm9sbGVkLWJhY2sgc2F2ZSBlbWl0cyBub3RoaW5nLCBhbmRcbiAgICogc2tpcHBlZCBlbnRpcmVseSB3aGVuIG5vdGhpbmcgb2JzZXJ2ZXMgdGhpcyBtb2RlbCBjbGFzcyBzbyBzZXJ2ZXItc2lkZSBzYXZlc1xuICAgKiBzdGF5IGZyZWUgb2YgbGl2ZS1xdWVyeSBvdmVyaGVhZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZWNvcmQtY2hhbmdlcy5qc1wiKS5SZWNvcmRDaGFuZ2VPcGVyYXRpb259IG9wZXJhdGlvbiAtIFRoZSBjb21taXR0ZWQgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9lbWl0UmVjb3JkQ2hhbmdlQWZ0ZXJDb21taXQob3BlcmF0aW9uKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIXJlY29yZENoYW5nZXMuaGFzTGlzdGVuZXJzKG1vZGVsQ2xhc3MpKSByZXR1cm5cblxuICAgIGNvbnN0IHJlY29yZCA9IHRoaXNcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aXR5ID0gdGhpcy5fZGF0YWJhc2VPcGVyYXRpb25cbiAgICAgID8gdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24uZGF0YWJhc2VJZGVudGl0eSgpXG4gICAgICA6IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHlGb3JDb25uZWN0aW9uKHRoaXMuX2Nvbm5lY3Rpb24oKSlcblxuICAgIHRoaXMuY2FwdHVyZURhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSlcblxuICAgIGF3YWl0IHRoaXMuX2Nvbm5lY3Rpb24oKS5hZnRlckNvbW1pdCgoKSA9PiB7XG4gICAgICByZWNvcmRDaGFuZ2VzLmVtaXQoe2RhdGFiYXNlSWRlbnRpdHksIG1vZGVsQ2xhc3MsIG9wZXJhdGlvbiwgcmVjb3JkfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3JlcyBhbiBhdWRpdCByb3cgZm9yIHRoaXMgcmVjb3JkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYXVkaXRpbmcuanNcIikuQ3JlYXRlQXVkaXRBcmdzfSBhcmdzIC0gQXVkaXQgcm93IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IHN0cmluZz59IENyZWF0ZWQgYXVkaXQgcm93IGlkLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlQXVkaXQoYXJncykge1xuICAgIHJldHVybiBhd2FpdCBjcmVhdGVBdWRpdCh0aGlzLCBhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGNyZWF0ZSBjaGFuZ2VzIGJlZm9yZSBwZXJzaXN0ZW5jZSBjbGVhcnMgdGhlIGNoYW5nZSBzZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY2FwdHVyZUNyZWF0ZUF1ZGl0Q2hhbmdlcygpIHtcbiAgICBjYXB0dXJlQ3JlYXRlQXVkaXRDaGFuZ2VzKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogV3JpdGVzIHRoZSBjcmVhdGUgYXVkaXQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGNyZWF0ZUNyZWF0ZUF1ZGl0KCkge1xuICAgIGF3YWl0IGNyZWF0ZUNyZWF0ZUF1ZGl0KHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgdXBkYXRlIGNoYW5nZXMgYmVmb3JlIHBlcnNpc3RlbmNlIGNsZWFycyB0aGUgY2hhbmdlIHNldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjYXB0dXJlVXBkYXRlQXVkaXRDaGFuZ2VzKCkge1xuICAgIGNhcHR1cmVVcGRhdGVBdWRpdENoYW5nZXModGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZXMgdGhlIHVwZGF0ZSBhdWRpdCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgY3JlYXRlVXBkYXRlQXVkaXQoKSB7XG4gICAgYXdhaXQgY3JlYXRlVXBkYXRlQXVkaXQodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZXMgdGhlIGRlc3Ryb3kgYXVkaXQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGNyZWF0ZURlc3Ryb3lBdWRpdCgpIHtcbiAgICBhd2FpdCBjcmVhdGVEZXN0cm95QXVkaXQodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBsaWZlY3ljbGUgY2FsbGJhY2tzLlxuICAgKiBAcGFyYW0ge1wiYWZ0ZXJDcmVhdGVcIiB8IFwiYWZ0ZXJEZXN0cm95XCIgfCBcImFmdGVyU2F2ZVwiIHwgXCJhZnRlclVwZGF0ZVwiIHwgXCJiZWZvcmVDcmVhdGVcIiB8IFwiYmVmb3JlRGVzdHJveVwiIHwgXCJiZWZvcmVTYXZlXCIgfCBcImJlZm9yZVVwZGF0ZVwiIHwgXCJiZWZvcmVWYWxpZGF0aW9uXCJ9IGNhbGxiYWNrTmFtZSAtIENhbGxiYWNrIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhjYWxsYmFja05hbWUpIHtcbiAgICBjb25zdCBjYWxsYmFja3MgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRMaWZlY3ljbGVDYWxsYmFja3NNYXAoKVtjYWxsYmFja05hbWVdIHx8IFtdXG4gICAgbGV0IGNhbGxiYWNrTmFtZVJlZ2lzdGVyZWRBc1N0cmluZyA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIGNhbGxiYWNrcykge1xuICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGlmIChjYWxsYmFjayA9PSBjYWxsYmFja05hbWUpIHtcbiAgICAgICAgICBjYWxsYmFja05hbWVSZWdpc3RlcmVkQXNTdHJpbmcgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZHluYW1pY1RoaXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcbiAgICAgICAgY29uc3QgbWV0aG9kQ2FsbGJhY2sgPSBkeW5hbWljVGhpc1tjYWxsYmFja11cblxuICAgICAgICBpZiAodHlwZW9mIG1ldGhvZENhbGxiYWNrICE9IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTGlmZWN5Y2xlIGNhbGxiYWNrIFwiJHtjYWxsYmFja31cIiBpcyBub3QgYSBmdW5jdGlvbiBvbiAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IG1ldGhvZENhbGxiYWNrLmNhbGwodGhpcylcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IGNhbGxiYWNrKHRoaXMpXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgZHluYW1pY1RoaXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcbiAgICBjb25zdCBpbnN0YW5jZUNhbGxiYWNrID0gZHluYW1pY1RoaXNbY2FsbGJhY2tOYW1lXVxuXG4gICAgaWYgKCFjYWxsYmFja05hbWVSZWdpc3RlcmVkQXNTdHJpbmcgJiYgdHlwZW9mIGluc3RhbmNlQ2FsbGJhY2sgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgYXdhaXQgaW5zdGFuY2VDYWxsYmFjay5jYWxsKHRoaXMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIGNoYW5nZXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgY2hhbmdlcy5cbiAgICovXG4gIF9oYXNDaGFuZ2VzKCkgeyByZXR1cm4gT2JqZWN0LmtleXModGhpcy5fY2hhbmdlcykubGVuZ3RoID4gMCB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdHJ1ZSBpZiB0aGUgbW9kZWwgaGFzIGJlZW4gY2hhbmdlZCBzaW5jZSBpdCB3YXMgbG9hZGVkIGZyb20gdGhlIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGNoYW5nZWQuXG4gICAqL1xuICBpc0NoYW5nZWQoKSB7XG4gICAgaWYgKHRoaXMuaXNOZXdSZWNvcmQoKSB8fCB0aGlzLl9oYXNDaGFuZ2VzKCkpe1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICAvLyBDaGVjayBpZiBhIGxvYWRlZCBzdWItbW9kZWwgb2YgYSByZWxhdGlvbnNoaXAgaXMgY2hhbmdlZCBhbmQgc2hvdWxkIGJlIHNhdmVkIGFsb25nIHdpdGggdGhpcyBtb2RlbC5cbiAgICBpZiAodGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKSB7XG4gICAgICBmb3IgKGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbaW5zdGFuY2VSZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgICBsZXQgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuX2xvYWRlZFxuXG4gICAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRBdXRvU2F2ZSgpID09PSBmYWxzZSkge1xuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWxvYWRlZCkgY29udGludWVcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGxvYWRlZCkpIGxvYWRlZCA9IFtsb2FkZWRdXG5cbiAgICAgICAgZm9yIChjb25zdCBtb2RlbCBvZiBsb2FkZWQpIHtcbiAgICAgICAgICBpZiAobW9kZWwuaXNDaGFuZ2VkKCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY2hhbmdlcyB0aGF0IGhhdmUgYmVlbiBtYWRlIHRvIHRoaXMgcmVjb3JkIHNpbmNlIGl0IHdhcyBsb2FkZWQgZnJvbSB0aGUgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFRoZSBjaGFuZ2VzLlxuICAgKi9cbiAgY2hhbmdlcygpIHtcbiAgICAvKipcbiAgICAgKiBDaGFuZ2VzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IGNoYW5nZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBjaGFuZ2VLZXkgaW4gdGhpcy5fY2hhbmdlcykge1xuICAgICAgY29uc3QgY2hhbmdlVmFsdWUgPSB0aGlzLl9jaGFuZ2VzW2NoYW5nZUtleV1cblxuICAgICAgY2hhbmdlc1tjaGFuZ2VLZXldID0gW3RoaXMuX2F0dHJpYnV0ZXNbY2hhbmdlS2V5XSwgY2hhbmdlVmFsdWVdXG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYW5nZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHRhYmxlIG5hbWUuXG4gICAqL1xuICBfdGFibGVOYW1lKCkge1xuICAgIGlmICh0aGlzLl9fdGFibGVOYW1lKSByZXR1cm4gdGhpcy5fX3RhYmxlTmFtZVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0TW9kZWxDbGFzcygpLnRhYmxlTmFtZSgpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYW4gYXR0cmlidXRlIHZhbHVlIGZyb20gdGhlIHJlY29yZC4gUmVhZCBkeW5hbWljYWxseSBieSBuYW1lLCBzbyB0aGUgdmFsdWUgY2FuIGJlIGFueVxuICAgKiBjb2x1bW4gdHlwZSBhbmQgbWF5IGJlIG92ZXJyaWRkZW4gYnkgYSB1c2VyLWRlZmluZWQgZ2V0dGVyIG9uIHRoZSBtb2RlbC5cbiAgICogQHRlbXBsYXRlIFZcbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgVGhlIG5hbWUgb2YgdGhlIGF0dHJpYnV0ZSB0byByZWFkLiBUaGlzIGlzIHRoZSBhdHRyaWJ1dGUgbmFtZSwgbm90IHRoZSBjb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge1Z9IFRoZSBhdHRyaWJ1dGUgdmFsdWUsIHR5cGVkIGJ5IHRoZSBjYWxsZXIncyBhY2Nlc3NvciBjb250cmFjdC5cbiAgICovXG4gIHJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkge1xuICAgIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIGNvbnN0IG1hcCA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpXG4gICAgY29uc3QgY29sdW1uTmFtZSA9IHJlc29sdmVkQXR0cmlidXRlTmFtZSA/IG1hcFtyZXNvbHZlZEF0dHJpYnV0ZU5hbWVdIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoIWNvbHVtbk5hbWUpIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgZmlndXJlIG91dCBjb2x1bW4gbmFtZSBmb3IgYXR0cmlidXRlOiAke2F0dHJpYnV0ZU5hbWV9IGZyb20gdGhlc2UgbWFwcGluZ3M6ICR7T2JqZWN0LmtleXMobWFwKS5qb2luKFwiLCBcIil9YClcblxuICAgIHJldHVybiAvKiogQHR5cGUge1Z9ICovICh0aGlzLnJlYWRDb2x1bW4oY29sdW1uTmFtZSkpXG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhbiBhc3NvY2lhdGlvbiBjb3VudCBhdHRhY2hlZCBieSBgLndpdGhDb3VudCguLi4pYC4gQ291bnRzIGFyZVxuICAgKiBzdG9yZWQgb24gYSBzZXBhcmF0ZSBtYXAgZnJvbSB0aGUgcmVjb3JkJ3MgYF9hdHRyaWJ1dGVzYCBzbyBhXG4gICAqIHZpcnR1YWwgY291bnQgbGlrZSBgdGFza3NDb3VudGAgY2Fubm90IHNpbGVudGx5IHNoYWRvdyBhIHJlYWxcbiAgICogY29sdW1uIG9mIHRoZSBzYW1lIG5hbWUuIFJldHVybnMgdGhlIGF0dGFjaGVkIG51bWJlciwgb3IgMCB3aGVuXG4gICAqIGAud2l0aENvdW50KC4uLilgIHdhc24ndCByZXF1ZXN0ZWQgZm9yIHRoaXMgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLCBlLmcuIGBcInRhc2tzQ291bnRcImAgb3IgYSBjdXN0b20gYFwiYWN0aXZlTWVtYmVyc0NvdW50XCJgIGZyb20gYC53aXRoQ291bnQoe2FjdGl2ZU1lbWJlcnNDb3VudDogey4uLn19KWAuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQXR0YWNoZWQgYXNzb2NpYXRpb24gY291bnQsIG9yIHplcm8gd2hlbiBhYnNlbnQuXG4gICAqL1xuICByZWFkQ291bnQoYXR0cmlidXRlTmFtZSkge1xuICAgIHJldHVybiByZWFkUGF5bG9hZEFzc29jaWF0aW9uQ291bnQoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogQXR0YWNoIGFuIGFzc29jaWF0aW9uIGNvdW50IHRvIHRoaXMgcmVjb3JkLiBJbnRlcm5hbCBoZWxwZXIgdXNlZCBieVxuICAgKiB0aGUgYHdpdGhDb3VudGAgcnVubmVyOyBvdXRzaWRlIGNvZGUgc2hvdWxkIG5vdCBjYWxsIHRoaXMgZGlyZWN0bHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIENvdW50IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRBc3NvY2lhdGlvbkNvdW50KGF0dHJpYnV0ZU5hbWUsIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZEFzc29jaWF0aW9uQ291bnQoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGF0dHJpYnV0ZU5hbWUsIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIEFsbCBhdHRhY2hlZCBhc3NvY2lhdGlvbiBjb3VudHMgYXMgYSBwbGFpbiBvYmplY3QuIFVzZWQgYnkgdGhlXG4gICAqIGZyb250ZW5kLW1vZGVsIHNlcmlhbGl6ZXIgdG8gc2hpcCBjb3VudHMgYWxvbmdzaWRlIHRoZSByZWNvcmRcbiAgICogYXR0cmlidXRlcyBvbiB0aGUgd2lyZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59IC0gQXNzb2NpYXRpb24gY291bnRzIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgYXNzb2NpYXRpb25Db3VudHMoKSB7XG4gICAgLyoqXG4gICAgICogUmVzdWx0LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgICBjb25zdCB0YXJnZXQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuXG4gICAgaWYgKCF0YXJnZXQuX2Fzc29jaWF0aW9uQ291bnRzKSByZXR1cm4gcmVzdWx0XG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgdGFyZ2V0Ll9hc3NvY2lhdGlvbkNvdW50cykge1xuICAgICAgcmVzdWx0W2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhIHZhbHVlIGF0dGFjaGVkIGJ5IGAucXVlcnlEYXRhKC4uLilgLiBTdG9yZWQgb24gYSBkZWRpY2F0ZWRcbiAgICogbWFwIHJhdGhlciB0aGFuIG9uIGBfYXR0cmlidXRlc2AsIHNvIGEgdmlydHVhbCBxdWVyeURhdGEga2V5IGxpa2VcbiAgICogYHRyYW5zcG9ydFNlY29uZHNTdW1gIGNhbm5vdCBzaWxlbnRseSBzaGFkb3cgYSByZWFsIGNvbHVtbiBvZiB0aGVcbiAgICogc2FtZSBuYW1lLiBSZXR1cm5zIGBudWxsYCB3aGVuIHRoZSBrZXkgd2Fzbid0IHByb2R1Y2VkIGJ5IGFueVxuICAgKiByZWdpc3RlcmVkIGZuIGZvciB0aGlzIHJlY29yZCAoZS5nLiBubyBjaGlsZCByb3dzIG1hdGNoZWQgdGhlXG4gICAqIGFnZ3JlZ2F0ZSkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gcXVlcnlEYXRhIGF0dHJpYnV0ZSBuYW1lIChtYXRjaGVzIGEgU0VMRUNUIGFsaWFzIGZyb20gdGhlIHJlZ2lzdGVyZWQgZm4pLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQXR0YWNoZWQgcXVlcnktZGF0YSB2YWx1ZS5cbiAgICovXG4gIHF1ZXJ5RGF0YShuYW1lKSB7XG4gICAgcmV0dXJuIHJlYWRQYXlsb2FkUXVlcnlEYXRhKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0dGFjaCBhIHF1ZXJ5RGF0YSB2YWx1ZSB0byB0aGlzIHJlY29yZC4gSW50ZXJuYWwgaGVscGVyIHVzZWQgYnlcbiAgICogdGhlIGBxdWVyeURhdGFgIHJ1bm5lciBhbmQgYnkgZnJvbnRlbmQtbW9kZWwgaHlkcmF0aW9uOyBvdXRzaWRlXG4gICAqIGNvZGUgc2hvdWxkIG5vdCBjYWxsIHRoaXMgZGlyZWN0bHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gcXVlcnlEYXRhIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIGF0dGFjaC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0UXVlcnlEYXRhKG5hbWUsIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZFF1ZXJ5RGF0YSgvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgbmFtZSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogQWxsIGF0dGFjaGVkIHF1ZXJ5RGF0YSB2YWx1ZXMgYXMgYSBwbGFpbiBvYmplY3QuIFVzZWQgYnkgdGhlXG4gICAqIGZyb250ZW5kLW1vZGVsIHNlcmlhbGl6ZXIgdG8gc2hpcCBxdWVyeURhdGEgYWxvbmdzaWRlIHRoZSByZWNvcmRcbiAgICogYXR0cmlidXRlcyBvbiB0aGUgd2lyZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBRdWVyeS1kYXRhIHZhbHVlcyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgcXVlcnlEYXRhVmFsdWVzKCkge1xuICAgIC8qKlxuICAgICAqIFJlc3VsdC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgICBjb25zdCB0YXJnZXQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuXG4gICAgaWYgKCF0YXJnZXQuX3F1ZXJ5RGF0YVZhbHVlcykgcmV0dXJuIHJlc3VsdFxuXG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIHRhcmdldC5fcXVlcnlEYXRhVmFsdWVzKSB7XG4gICAgICByZXN1bHRbbmFtZV0gPSB2YWx1ZVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGEgcGVyLXJlY29yZCBhYmlsaXR5IHJlc3VsdCBhdHRhY2hlZCBieSBgLmFiaWxpdGllcyguLi4pYC4gVGhlXG4gICAqIGJhY2tlbmQgZXZhbHVhdGVzIGVhY2ggcmVxdWVzdGVkIGFjdGlvbiBhZ2FpbnN0IHRoZSBjdXJyZW50IGFiaWxpdHlcbiAgICogZm9yIHRoaXMgcmVjb3JkIGluc3RhbmNlIGFuZCBzaGlwcyB0aGUgcmVzdWx0IGFsb25nc2lkZSB0aGVcbiAgICogcmVjb3JkJ3MgYXR0cmlidXRlcy4gUmV0dXJucyBgZmFsc2VgIHdoZW4gdGhlIGFjdGlvbiB3YXNuJ3RcbiAgICogcmVxdWVzdGVkIGZvciB0aGlzIHJlY29yZCDigJQgc28gVUkgY29kZSBjYW4gc2FmZWx5IGJyYW5jaCBvblxuICAgKiBgcmVjb3JkLmNhbihcInVwZGF0ZVwiKWAgd2l0aG91dCBmaXJzdCBjaGVja2luZyB3aGV0aGVyIHRoZSBhYmlsaXR5XG4gICAqIHdhcyBsb2FkZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbiBuYW1lLCBlLmcuIGBcInVwZGF0ZVwiYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVxdWVzdGVkIGFiaWxpdHkgaXMgYWxsb3dlZC5cbiAgICovXG4gIGNhbihhY3Rpb24pIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRDb21wdXRlZEFiaWxpdHkoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGFjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRhY2ggYSBwZXItcmVjb3JkIGFiaWxpdHkgcmVzdWx0IHRvIHRoaXMgcmVjb3JkLiBJbnRlcm5hbCBoZWxwZXJcbiAgICogdXNlZCBieSB0aGUgYGFiaWxpdGllc2AgcnVubmVyIGFuZCBieSBmcm9udGVuZC1tb2RlbCBoeWRyYXRpb247XG4gICAqIG91dHNpZGUgY29kZSBzaG91bGQgbm90IGNhbGwgdGhpcyBkaXJlY3RseS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEFiaWxpdHkgYWN0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gdmFsdWUgLSBXaGV0aGVyIHRoZSBjdXJyZW50IGFiaWxpdHkgcGVybWl0cyB0aGUgYWN0aW9uIG9uIHRoaXMgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRDb21wdXRlZEFiaWxpdHkoYWN0aW9uLCB2YWx1ZSkge1xuICAgIHNldFBheWxvYWRDb21wdXRlZEFiaWxpdHkoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGFjdGlvbiwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogQWxsIGF0dGFjaGVkIHBlci1yZWNvcmQgYWJpbGl0eSByZXN1bHRzIGFzIGEgcGxhaW4gb2JqZWN0LiBVc2VkXG4gICAqIGJ5IHRoZSBmcm9udGVuZC1tb2RlbCBzZXJpYWxpemVyIHRvIHNoaXAgcmVzdWx0cyBhbG9uZ3NpZGUgdGhlXG4gICAqIHJlY29yZCBhdHRyaWJ1dGVzIG9uIHRoZSB3aXJlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgYm9vbGVhbj59IC0gQWJpbGl0eSByZXN1bHRzIGtleWVkIGJ5IGFjdGlvbi5cbiAgICovXG4gIGNvbXB1dGVkQWJpbGl0aWVzKCkge1xuICAgIC8qKlxuICAgICAqIFJlc3VsdC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbj59ICovXG4gICAgY29uc3QgcmVzdWx0ID0ge31cblxuICAgIGNvbnN0IHRhcmdldCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG5cbiAgICBpZiAoIXRhcmdldC5fY29tcHV0ZWRBYmlsaXRpZXMpIHJldHVybiByZXN1bHRcblxuICAgIGZvciAoY29uc3QgW2FjdGlvbiwgdmFsdWVdIG9mIHRhcmdldC5fY29tcHV0ZWRBYmlsaXRpZXMpIHtcbiAgICAgIHJlc3VsdFthY3Rpb25dID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYSBjb2x1bW4gdmFsdWUgZnJvbSB0aGUgcmVjb3JkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSBUaGUgbmFtZSBvZiB0aGUgY29sdW1uIHRvIHJlYWQuIFRoaXMgaXMgdGhlIGNvbHVtbiBuYW1lLCBub3QgdGhlIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGNvbHVtbi5cbiAgICovXG4gIHJlYWRDb2x1bW4oYXR0cmlidXRlTmFtZSkge1xuICAgIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIGNvbnN0IGJlbG9uZ3NUb0NoYW5nZXMgPSB0aGlzLl9iZWxvbmdzVG9DaGFuZ2VzKClcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcmVhZHNQZXJzaXN0ZWRQcmltYXJ5S2V5ID0gdGhpcy5fcmVhZHNQZXJzaXN0ZWRQcmltYXJ5S2V5ICYmIChcbiAgICAgIEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyBwcmltYXJ5S2V5LmluY2x1ZGVzKGF0dHJpYnV0ZU5hbWUpIDogcHJpbWFyeUtleSA9PSBhdHRyaWJ1dGVOYW1lXG4gICAgKVxuICAgIGxldCByZXN1bHRcblxuICAgIGlmIChyZWFkc1BlcnNpc3RlZFByaW1hcnlLZXkpIHtcbiAgICAgIHJlc3VsdCA9IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cbiAgICB9IGVsc2UgaWYgKGF0dHJpYnV0ZU5hbWUgaW4gYmVsb25nc1RvQ2hhbmdlcykge1xuICAgICAgcmVzdWx0ID0gYmVsb25nc1RvQ2hhbmdlc1thdHRyaWJ1dGVOYW1lXVxuICAgIH0gZWxzZSBpZiAoYXR0cmlidXRlTmFtZSBpbiB0aGlzLl9jaGFuZ2VzKSB7XG4gICAgICByZXN1bHQgPSB0aGlzLl9jaGFuZ2VzW2F0dHJpYnV0ZU5hbWVdXG4gICAgfSBlbHNlIGlmIChhdHRyaWJ1dGVOYW1lIGluIHRoaXMuX2F0dHJpYnV0ZXMpIHtcbiAgICAgIHJlc3VsdCA9IHRoaXMuX2F0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cbiAgICB9IGVsc2UgaWYgKHRoaXMuaXNQZXJzaXN0ZWQoKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIGF0dHJpYnV0ZSBvciBub3Qgc2VsZWN0ZWQgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IyR7YXR0cmlidXRlTmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbHVtblR5cGUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5UeXBlQnlOYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICBpZiAoY29sdW1uVHlwZSAmJiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5faXNEYXRlTGlrZVR5cGUoY29sdW1uVHlwZSkpIHtcbiAgICAgIHJlc3VsdCA9IHRoaXMuX25vcm1hbGl6ZURhdGVWYWx1ZUZvclJlYWQocmVzdWx0KVxuICAgIH1cblxuICAgIHJlc3VsdCA9IHRoaXMuX25vcm1hbGl6ZUJvb2xlYW5WYWx1ZUZvclJlYWQoe2NvbHVtbk5hbWU6IGF0dHJpYnV0ZU5hbWUsIGNvbHVtblR5cGUsIHZhbHVlOiByZXN1bHR9KVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFueSBkZWNsYXJlZCBwZXItYXR0cmlidXRlIGNhc3QgZm9yIGEgZGF0YWJhc2UgY29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gRGF0YWJhc2UgY29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gRGVjbGFyZWQgY2FzdCB0eXBlLCBvciB1bmRlZmluZWQgd2hlbiBub25lIGlzIGRlY2xhcmVkLlxuICAgKi9cbiAgX2RlY2xhcmVkQXR0cmlidXRlQ2FzdEZvckNvbHVtbihjb2x1bW5OYW1lKSB7XG4gICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVtjb2x1bW5OYW1lXVxuXG4gICAgaWYgKCFhdHRyaWJ1dGVOYW1lKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0cmlidXRlQ2FzdChhdHRyaWJ1dGVOYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgc3RvcmVkIHZhbHVlIHRvIGEgcmVhbCBib29sZWFuIGZvciBhIGRlY2xhcmVkIGBcImJvb2xlYW5cImAgY2FzdC5cbiAgICogTGVhdmVzIG51bGwvdW5kZWZpbmVkIHVudG91Y2hlZDsgdHJlYXRzIDEvdHJ1ZS9cIjFcIiBhcyB0cnVlIGFuZCAwL2ZhbHNlL1wiMFwiIGFzIGZhbHNlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFN0b3JlZCBkYXRhYmFzZSB2YWx1ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIENvbnZlcnRlZCBib29sZWFuLCBvciB0aGUgb3JpZ2luYWwgdmFsdWUgd2hlbiBub3QgcmVjb2duaXplZC5cbiAgICovXG4gIF9jYXN0RGVjbGFyZWRCb29sZWFuRm9yUmVhZCh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdmFsdWVcbiAgICBpZiAoZGVjbGFyZWRCb29sZWFuVHJ1dGh5VmFsdWVzLmhhcyh2YWx1ZSkpIHJldHVybiB0cnVlXG4gICAgaWYgKGRlY2xhcmVkQm9vbGVhbkZhbHN5VmFsdWVzLmhhcyh2YWx1ZSkpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIGNvbHVtbiB2YWx1ZSBpcyBjdXJyZW50bHkgbG9hZGVkIG9uIHRoaXMgcmVjb3JkIChlaXRoZXIgYXMgYVxuICAgKiBwZXJzaXN0ZWQgYXR0cmlidXRlIG9yIGEgcGVuZGluZyBjaGFuZ2UpLiBVc2VkIHRvIGRlY2lkZSB3aGV0aGVyIGEgcHJlbG9hZFxuICAgKiBjYW4gYmUgc2tpcHBlZCBiZWNhdXNlIHRoZSByZXF1aXJlZCBjb2x1bW5zIGFyZSBhbHJlYWR5IHByZXNlbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gVGhlIGNvbHVtbiBuYW1lIHRvIGNoZWNrLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBjb2x1bW4gaXMgbG9hZGVkLlxuICAgKi9cbiAgaGFzTG9hZGVkQ29sdW1uKGNvbHVtbk5hbWUpIHtcbiAgICByZXR1cm4gY29sdW1uTmFtZSBpbiB0aGlzLl9jaGFuZ2VzIHx8IGNvbHVtbk5hbWUgaW4gdGhpcy5fYXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGJvb2xlYW4gdmFsdWUgZm9yIHJlYWQuIEEgZGVjbGFyZWQgYFwiYm9vbGVhblwiYCBhdHRyaWJ1dGUgY2FzdCBjb252ZXJ0cyB0aGVcbiAgICogc3RvcmVkIHZhbHVlIChlLmcuIGFuIE1TU1FMIGBiaXRgIDAvMSkgdG8gYSByZWFsIGJvb2xlYW47IG90aGVyd2lzZSB0aGUgZXhpc3RpbmdcbiAgICogaW50cm9zcGVjdGVkLXR5cGUgbm9ybWFsaXphdGlvbiBhcHBsaWVzIChubyBiZWhhdmlvdXIgY2hhbmdlIGZvciBub24tZGVjbGFyZWQgY29sdW1ucykuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbk5hbWUgLSBEYXRhYmFzZSBjb2x1bW4gbmFtZSBiZWluZyByZWFkLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gYXJncy5jb2x1bW5UeXBlIC0gQ29sdW1uIHR5cGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBWYWx1ZSB0byBub3JtYWxpemUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICAgKi9cbiAgX25vcm1hbGl6ZUJvb2xlYW5WYWx1ZUZvclJlYWQoe2NvbHVtbk5hbWUsIGNvbHVtblR5cGUsIHZhbHVlfSkge1xuICAgIGlmICh0aGlzLl9kZWNsYXJlZEF0dHJpYnV0ZUNhc3RGb3JDb2x1bW4oY29sdW1uTmFtZSkgPT09IFwiYm9vbGVhblwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5fY2FzdERlY2xhcmVkQm9vbGVhbkZvclJlYWQodmFsdWUpXG4gICAgfVxuXG4gICAgaWYgKCFjb2x1bW5UeXBlKSByZXR1cm4gdmFsdWVcbiAgICBpZiAoY29sdW1uVHlwZS50b0xvd2VyQ2FzZSgpICE9PSBcImJvb2xlYW5cIikgcmV0dXJuIHZhbHVlXG4gICAgaWYgKHZhbHVlID09PSAxKSByZXR1cm4gdHJ1ZVxuICAgIGlmICh2YWx1ZSA9PT0gMCkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBkYXRlIHZhbHVlIGZvciByZWFkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIGZyb20gZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICAgKi9cbiAgX25vcm1hbGl6ZURhdGVWYWx1ZUZvclJlYWQodmFsdWUpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRGF0ZVZhbHVlRm9yUmVhZCh2YWx1ZSwge2RhdGFiYXNlVHlwZTogdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0RGF0YWJhc2VUeXBlKCl9KVxuICB9XG5cbiAgX2JlbG9uZ3NUb0NoYW5nZXMoKSB7XG4gICAgLyoqXG4gICAgICogQmVsb25ncyB0byBjaGFuZ2VzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYmVsb25nc1RvQ2hhbmdlcyA9IHt9XG5cbiAgICBpZiAodGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKSB7XG4gICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgaW4gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09IFwiYmVsb25nc1RvXCIgJiYgcmVsYXRpb25zaGlwLmdldERpcnR5KCkpIHtcbiAgICAgICAgICBjb25zdCBtb2RlbCA9IHJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG5cbiAgICAgICAgICBpZiAobW9kZWwpIHtcbiAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KG1vZGVsKSkgdGhyb3cgbmV3IEVycm9yKFwiVW5leHBlY3RlZCBiZWxvbmdzLXRvIG1vZGVsIGFycmF5XCIpXG5cbiAgICAgICAgICAgIGJlbG9uZ3NUb0NoYW5nZXNbcmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKV0gPSB0aGlzLl9iZWxvbmdzVG9Gb3JlaWduS2V5VmFsdWUoe21vZGVsLCByZWxhdGlvbnNoaXB9KVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBiZWxvbmdzVG9DaGFuZ2VzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgbmV3IHJlY29yZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9jcmVhdGVOZXdSZWNvcmQoKSB7XG4gICAgLy8gUmVzb2x2ZSB0aGUgY29ubmVjdGlvbiBvbmNlIGFuZCBwaW4gdGhlIHdob2xlIGluc2VydCBwYXRoIHRvIGl0OiBhIHBvb2xcbiAgICAvLyBjYW4gcmVzb2x2ZSBhIGRpZmZlcmVudCBjdXJyZW50IGNvbm5lY3Rpb24gYWNyb3NzIHRoZSBhd2FpdHMgYmVsb3csIGFuZFxuICAgIC8vIHRoZSBpZGVudGl0eS1pbnNlcnQgd3JhcHBlciBpcyBvbmx5IGVmZmVjdGl2ZSBvbiB0aGUgZXhhY3Qgc2Vzc2lvbiB0aGF0XG4gICAgLy8gcmFuIFNFVCBJREVOVElUWV9JTlNFUlQuXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuX2Nvbm5lY3Rpb24oKVxuXG4gICAgaWYgKCFjb25uZWN0aW9uW1wiaW5zZXJ0U3FsXCJdKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGluc2VydFNxbCBvbiAke2Nvbm5lY3Rpb24uY29uc3RydWN0b3IubmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IGRhdGEgPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLl9iZWxvbmdzVG9DaGFuZ2VzKCksIHRoaXMucmF3QXR0cmlidXRlcygpKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBwcmltYXJ5S2V5Q29sdW1ucyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbnMoKS5maWx0ZXIoKGNvbHVtbikgPT4ge1xuICAgICAgcmV0dXJuIEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyBwcmltYXJ5S2V5LmluY2x1ZGVzKGNvbHVtbi5nZXROYW1lKCkpIDogY29sdW1uLmdldE5hbWUoKSA9PSBwcmltYXJ5S2V5XG4gICAgfSlcbiAgICBjb25zdCBwcmltYXJ5S2V5Q29sdW1uID0gQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSA/IHVuZGVmaW5lZCA6IHByaW1hcnlLZXlDb2x1bW5zWzBdXG4gICAgY29uc3QgcHJpbWFyeUtleVR5cGUgPSBwcmltYXJ5S2V5Q29sdW1uPy5nZXRUeXBlKCk/LnRvTG93ZXJDYXNlKClcbiAgICBjb25zdCBkcml2ZXJTdXBwb3J0c0RlZmF1bHRVVUlEID0gdHlwZW9mIGNvbm5lY3Rpb24uc3VwcG9ydHNEZWZhdWx0UHJpbWFyeUtleVVVSUQgPT0gXCJmdW5jdGlvblwiICYmIGNvbm5lY3Rpb24uc3VwcG9ydHNEZWZhdWx0UHJpbWFyeUtleVVVSUQoKVxuICAgIGNvbnN0IGlzVVVJRFByaW1hcnlLZXkgPSBwcmltYXJ5S2V5VHlwZT8uaW5jbHVkZXMoXCJ1dWlkXCIpXG4gICAgY29uc3Qgc2hvdWxkQXNzaWduVVVJRFByaW1hcnlLZXkgPSBpc1VVSURQcmltYXJ5S2V5ICYmICFkcml2ZXJTdXBwb3J0c0RlZmF1bHRVVUlEXG4gICAgdGhpcy5fc2V0RGVmYXVsdFRpbWVzdGFtcFZhbHVlcyhkYXRhKVxuXG4gICAgY29uc3QgY29sdW1uTmFtZXMgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lcygpXG4gICAgY29uc3QgaGFzVXNlclByb3ZpZGVkUHJpbWFyeUtleSA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSlcbiAgICAgID8gcHJpbWFyeUtleS5ldmVyeSgoY29sdW1uTmFtZSkgPT4gZGF0YVtjb2x1bW5OYW1lXSAhPT0gdW5kZWZpbmVkICYmIGRhdGFbY29sdW1uTmFtZV0gIT09IG51bGwgJiYgZGF0YVtjb2x1bW5OYW1lXSAhPT0gXCJcIilcbiAgICAgIDogZGF0YVtwcmltYXJ5S2V5XSAhPT0gdW5kZWZpbmVkICYmIGRhdGFbcHJpbWFyeUtleV0gIT09IG51bGwgJiYgZGF0YVtwcmltYXJ5S2V5XSAhPT0gXCJcIlxuICAgIGNvbnN0IGhhc1VzZXJQcm92aWRlZEF1dG9JbmNyZW1lbnRQcmltYXJ5S2V5ID0gcHJpbWFyeUtleUNvbHVtbnMuc29tZSgoY29sdW1uKSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGRhdGFbY29sdW1uLmdldE5hbWUoKV1cblxuICAgICAgcmV0dXJuIGNvbHVtbi5nZXRBdXRvSW5jcmVtZW50KCkgPT09IHRydWUgJiYgdmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZSAhPT0gXCJcIlxuICAgIH0pXG5cbiAgICBpZiAoc2hvdWxkQXNzaWduVVVJRFByaW1hcnlLZXkgJiYgIWhhc1VzZXJQcm92aWRlZFByaW1hcnlLZXkpIHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpKSB0aHJvdyBuZXcgRXJyb3IoXCJDb21wb3NpdGUgVVVJRCBwcmltYXJ5IGtleXMgbXVzdCBiZSBwcm92aWRlZCBleHBsaWNpdGx5LlwiKVxuXG4gICAgICBkYXRhW3ByaW1hcnlLZXldID0gbmV3IFVVSUQoNCkuZm9ybWF0KClcbiAgICB9XG5cbiAgICB0aGlzLl9ub3JtYWxpemVEYXRlVmFsdWVzRm9yV3JpdGUoZGF0YSlcblxuICAgIGNvbnN0IHNxbCA9IGNvbm5lY3Rpb24uaW5zZXJ0U3FsKHtcbiAgICAgIHJldHVybkxhc3RJbnNlcnRlZENvbHVtbk5hbWVzOiBjb2x1bW5OYW1lcyxcbiAgICAgIHRhYmxlTmFtZTogdGhpcy5fdGFibGVOYW1lKCksXG4gICAgICBkYXRhXG4gICAgfSlcbiAgICBjb25zdCBpbnNlcnRPcHRpb25zID0ge2xvZ05hbWU6IGAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9IENyZWF0ZWB9XG4gICAgLy8gRXhwbGljaXQgcHJpbWFyeS1rZXkgaW5zZXJ0cyBpbnRvIGF1dG8taW5jcmVtZW50IGNvbHVtbnMgZ28gdGhyb3VnaCB0aGVcbiAgICAvLyBkcml2ZXIncyBleHBsaWNpdC1wcmltYXJ5LWtleSBpbnNlcnQgKE1TU1FMIHdyYXBzIGl0IGluIElERU5USVRZX0lOU0VSVCk7XG4gICAgLy8gZXZlcnl0aGluZyBlbHNlIHVzZXMgdGhlIHBsYWluIHF1ZXJ5IHBhdGguXG4gICAgY29uc3QgaW5zZXJ0UmVzdWx0ID0gaGFzVXNlclByb3ZpZGVkQXV0b0luY3JlbWVudFByaW1hcnlLZXlcbiAgICAgID8gYXdhaXQgY29ubmVjdGlvbi5pbnNlcnRXaXRoRXhwbGljaXRQcmltYXJ5S2V5KHtvcHRpb25zOiBpbnNlcnRPcHRpb25zLCBzcWwsIHRhYmxlTmFtZTogdGhpcy5fdGFibGVOYW1lKCl9KVxuICAgICAgOiBhd2FpdCBjb25uZWN0aW9uLnF1ZXJ5KHNxbCwgaW5zZXJ0T3B0aW9ucylcblxuICAgIGF3YWl0IHRoaXMuX2FwcGx5SW5zZXJ0UmVzdWx0KHtjb25uZWN0aW9uLCBkYXRhLCBpbnNlcnRSZXN1bHQsIHByaW1hcnlLZXl9KVxuICAgIHRoaXMuc2V0SXNOZXdSZWNvcmQoZmFsc2UpXG5cbiAgICB0aGlzLl9tYXJrTG9hZGVkUmVsYXRpb25zaGlwc1ByZWxvYWRlZEFmdGVyQ3JlYXRlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyBvbmx5IHJlbGF0aW9uc2hpcHMgd2l0aCBpbi1tZW1vcnkgbG9hZGVkIHZhbHVlcyBhcyBwcmVsb2FkZWQgYWZ0ZXIgY3JlYXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfbWFya0xvYWRlZFJlbGF0aW9uc2hpcHNQcmVsb2FkZWRBZnRlckNyZWF0ZSgpIHtcbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcCBvZiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRSZWxhdGlvbnNoaXBzKCkpIHtcbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKSlcblxuICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc01hbnlcIiAmJiBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpID09PSBudWxsKSB7XG4gICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwLnNldExvYWRlZChbXSlcbiAgICAgIH1cblxuICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKCkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcC5zZXRQcmVsb2FkZWQodHJ1ZSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyB0aGUgZGF0YWJhc2UgaW5zZXJ0IHJlc3BvbnNlIHRvIHRoaXMgcmVjb3JkLlxuICAgKiBAcGFyYW0ge3tjb25uZWN0aW9uOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgZGF0YTogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IERhdGUgfCBudWxsIHwgdW5kZWZpbmVkPiwgaW5zZXJ0UmVzdWx0OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgRGF0ZSB8IG51bGwgfCB1bmRlZmluZWQ+PiB8IG51bGwgfCB1bmRlZmluZWQsIHByaW1hcnlLZXk6IHN0cmluZyB8IHN0cmluZ1tdfX0gb3B0aW9ucyAtIFBpbm5lZCBpbnNlcnQgY29ubmVjdGlvbiwgaW5zZXJ0ZWQgZGF0YSwgY29ubmVjdGlvbiByZXN1bHQsIGFuZCBwcmltYXJ5IGtleSBjb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9hcHBseUluc2VydFJlc3VsdCh7Y29ubmVjdGlvbiwgZGF0YSwgaW5zZXJ0UmVzdWx0LCBwcmltYXJ5S2V5fSkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpKSB7XG4gICAgICBjb25zdCBpbnNlcnRlZFJvdyA9IEFycmF5LmlzQXJyYXkoaW5zZXJ0UmVzdWx0KSA/IGluc2VydFJlc3VsdFswXSA6IHVuZGVmaW5lZFxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWxvYWRXaXRoSWQocmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKHByaW1hcnlLZXksIChjb2x1bW5OYW1lKSA9PiBpbnNlcnRlZFJvdz8uW2NvbHVtbk5hbWVdID8/IGRhdGFbY29sdW1uTmFtZV0pKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoaW5zZXJ0UmVzdWx0KSAmJiBpbnNlcnRSZXN1bHRbMF0gJiYgaW5zZXJ0UmVzdWx0WzBdW3ByaW1hcnlLZXldKSB7XG4gICAgICB0aGlzLl9hdHRyaWJ1dGVzID0gaW5zZXJ0UmVzdWx0WzBdXG4gICAgICB0aGlzLl9jaGFuZ2VzID0ge31cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcHJpbWFyeUtleVZhbHVlID0gZGF0YVtwcmltYXJ5S2V5XVxuXG4gICAgICBpZiAocHJpbWFyeUtleVZhbHVlICE9PSB1bmRlZmluZWQgJiYgcHJpbWFyeUtleVZhbHVlICE9PSBudWxsICYmIHByaW1hcnlLZXlWYWx1ZSAhPT0gXCJcIikge1xuICAgICAgICBpZiAodHlwZW9mIHByaW1hcnlLZXlWYWx1ZSAhPSBcInN0cmluZ1wiICYmIHR5cGVvZiBwcmltYXJ5S2V5VmFsdWUgIT0gXCJudW1iZXJcIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW5zZXJ0ZWQgcHJpbWFyeSBrZXkgJHtwcmltYXJ5S2V5fSBtdXN0IGJlIGEgc3RyaW5nIG9yIG51bWJlciwgZ290ICR7dHlwZW9mIHByaW1hcnlLZXlWYWx1ZX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsb2FkV2l0aElkKHByaW1hcnlLZXlWYWx1ZSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGlkID0gYXdhaXQgY29ubmVjdGlvbi5sYXN0SW5zZXJ0SUQoKVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWxvYWRXaXRoSWQoaWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGltZXN0YW1wIGRlZmF1bHRzIGZvciBhIG5ldyByZWNvcmQgaW5zZXJ0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gZGF0YSAtIENvbHVtbi1rZXllZCBkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfc2V0RGVmYXVsdFRpbWVzdGFtcFZhbHVlcyhkYXRhKSB7XG4gICAgY29uc3QgY3JlYXRlZEF0Q29sdW1uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1ucygpLmZpbmQoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSA9PSBcImNyZWF0ZWRfYXRcIilcbiAgICBjb25zdCB1cGRhdGVkQXRDb2x1bW4gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5zKCkuZmluZCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09IFwidXBkYXRlZF9hdFwiKVxuICAgIGNvbnN0IGN1cnJlbnREYXRlID0gbmV3IERhdGUoKVxuXG4gICAgaWYgKGNyZWF0ZWRBdENvbHVtbiAmJiAoZGF0YS5jcmVhdGVkX2F0ID09PSB1bmRlZmluZWQgfHwgZGF0YS5jcmVhdGVkX2F0ID09PSBudWxsIHx8IGRhdGEuY3JlYXRlZF9hdCA9PT0gXCJcIikpIHtcbiAgICAgIGRhdGEuY3JlYXRlZF9hdCA9IGN1cnJlbnREYXRlXG4gICAgfVxuICAgIGlmICh1cGRhdGVkQXRDb2x1bW4gJiYgKGRhdGEudXBkYXRlZF9hdCA9PT0gdW5kZWZpbmVkIHx8IGRhdGEudXBkYXRlZF9hdCA9PT0gbnVsbCB8fCBkYXRhLnVwZGF0ZWRfYXQgPT09IFwiXCIpKSB7XG4gICAgICBkYXRhLnVwZGF0ZWRfYXQgPSBjdXJyZW50RGF0ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBkYXRlIHZhbHVlcyBmb3Igd3JpdGUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBkYXRhIC0gQ29sdW1uLWtleWVkIGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9ub3JtYWxpemVEYXRlVmFsdWVzRm9yV3JpdGUoZGF0YSkge1xuICAgIGZvciAoY29uc3QgY29sdW1uTmFtZSBpbiBkYXRhKSB7XG4gICAgICBjb25zdCBjb2x1bW5UeXBlID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uVHlwZUJ5TmFtZShjb2x1bW5OYW1lKVxuXG4gICAgICBpZiAoIWNvbHVtblR5cGUgfHwgIXRoaXMuZ2V0TW9kZWxDbGFzcygpLl9pc0RhdGVMaWtlVHlwZShjb2x1bW5UeXBlKSkgY29udGludWVcblxuICAgICAgY29uc3QgdmFsdWUgPSBkYXRhW2NvbHVtbk5hbWVdXG5cbiAgICAgIGRhdGFbY29sdW1uTmFtZV0gPSBub3JtYWxpemVEYXRlVmFsdWVGb3JXcml0ZSh2YWx1ZSwge3RpbWVab25lOiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fdGltZVpvbmVGb3JEYXRlV3JpdGUoKX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlIHJlY29yZCB3aXRoIGNoYW5nZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfdXBkYXRlUmVjb3JkV2l0aENoYW5nZXMoKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuX2Nvbm5lY3Rpb24oKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBwZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUgPSB0aGlzLl9wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKVxuICAgIGNvbnN0IG5leHRQcmltYXJ5S2V5VmFsdWUgPSB0aGlzLmlkKClcbiAgICAvKipcbiAgICAgKiBDb25kaXRpb25zLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgY29uZGl0aW9ucyA9IHt9XG5cbiAgICBPYmplY3QuYXNzaWduKGNvbmRpdGlvbnMsIG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMocHJpbWFyeUtleSwgcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKSlcblxuICAgIGNvbnN0IGNoYW5nZXMgPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLl9iZWxvbmdzVG9DaGFuZ2VzKCksIHRoaXMuX2NoYW5nZXMpXG4gICAgY29uc3QgdXBkYXRlZEF0Q29sdW1uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1ucygpLmZpbmQoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSA9PSBcInVwZGF0ZWRfYXRcIilcbiAgICBjb25zdCBjdXJyZW50RGF0ZSA9IG5ldyBEYXRlKClcblxuICAgIGlmICh1cGRhdGVkQXRDb2x1bW4gJiYgKGNoYW5nZXMudXBkYXRlZF9hdCA9PT0gdW5kZWZpbmVkIHx8IGNoYW5nZXMudXBkYXRlZF9hdCA9PT0gbnVsbCB8fCBjaGFuZ2VzLnVwZGF0ZWRfYXQgPT09IFwiXCIpKSB7XG4gICAgICBjaGFuZ2VzLnVwZGF0ZWRfYXQgPSBjdXJyZW50RGF0ZVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhjaGFuZ2VzKS5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLl9ub3JtYWxpemVEYXRlVmFsdWVzRm9yV3JpdGUoY2hhbmdlcylcbiAgICAgIGNvbnN0IHNxbCA9IGNvbm5lY3Rpb24udXBkYXRlU3FsKHtcbiAgICAgICAgdGFibGVOYW1lOiB0aGlzLl90YWJsZU5hbWUoKSxcbiAgICAgICAgZGF0YTogY2hhbmdlcyxcbiAgICAgICAgY29uZGl0aW9uc1xuICAgICAgfSlcbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucXVlcnkoc3FsLCB7bG9nTmFtZTogYCR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX0gVXBkYXRlYH0pXG4gICAgICBhd2FpdCB0aGlzLl9yZWxvYWRXaXRoSWQobmV4dFByaW1hcnlLZXlWYWx1ZSlcbiAgICAgIGNvbnN0IHJlbG9hZGVkUHJpbWFyeUtleVZhbHVlID0gdGhpcy5pZCgpXG5cbiAgICAgIGlmIChcbiAgICAgICAgT2JqZWN0LmtleXModGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0YWNobWVudHMoKSkubGVuZ3RoID4gMFxuICAgICAgICAmJiBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBwZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUpICE9PSBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCByZWxvYWRlZFByaW1hcnlLZXlWYWx1ZSlcbiAgICAgICkge1xuICAgICAgICBhd2FpdCByZWNvcmRBdHRhY2htZW50c1N0b3JlRm9yTW9kZWwodGhpcykubWlncmF0ZVJlY29yZElkZW50aXR5KHtcbiAgICAgICAgICBjb25uZWN0aW9uLFxuICAgICAgICAgIG1vZGVsOiB0aGlzLFxuICAgICAgICAgIG5leHRJZGVudGl0eTogcmVsb2FkZWRQcmltYXJ5S2V5VmFsdWUsXG4gICAgICAgICAgcHJldmlvdXNJZGVudGl0eTogcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaWQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gLSBUaGUgaWQuXG4gICAqL1xuICBpZCgpIHtcbiAgICBpZiAoIXRoaXMuZ2V0TW9kZWxDbGFzcygpLl9jb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbHVtbiBuYW1lcyBtYXBwaW5nIGhhc24ndCBiZWVuIHNldCBvbiAke3RoaXMuY29uc3RydWN0b3IubmFtZX0uIEhhcyB0aGUgbW9kZWwgYmVlbiBpbml0aWFsaXplZD9gKVxuICAgIH1cblxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KClcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpKSB7XG4gICAgICByZXR1cm4gcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKHByaW1hcnlLZXksIChjb2x1bW5OYW1lKSA9PiB0aGlzLnJlYWRDb2x1bW4oY29sdW1uTmFtZSkpXG4gICAgfVxuXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVtwcmltYXJ5S2V5XVxuXG4gICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBQcmltYXJ5IGtleSAke3ByaW1hcnlLZXl9IGRvZXNuJ3QgZXhpc3QgaW4gY29sdW1uczogJHtPYmplY3Qua2V5cyh0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKCkpLmpvaW4oXCIsIFwiKX1gKVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge251bWJlciB8IHN0cmluZ30gKi8gKHRoaXMucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBpZGVudGl0eSByZXByZXNlbnRlZCBieSB0aGUgbGFzdCBwZXJzaXN0ZWQgZGF0YWJhc2UgYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSAtIFBlcnNpc3RlZCBpZGVudGl0eS5cbiAgICovXG4gIF9wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSB7XG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKVxuXG4gICAgcmV0dXJuIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoY29sdW1uTmFtZSkgPT4gdGhpcy5fYXR0cmlidXRlc1tjb2x1bW5OYW1lXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIHBlcnNpc3RlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBwZXJzaXN0ZWQuXG4gICAqL1xuICBpc1BlcnNpc3RlZCgpIHsgcmV0dXJuICF0aGlzLl9pc05ld1JlY29yZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgbmV3IHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBuZXcgcmVjb3JkLlxuICAgKi9cbiAgaXNOZXdSZWNvcmQoKSB7IHJldHVybiB0aGlzLl9pc05ld1JlY29yZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGlzIG5ldyByZWNvcmQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbmV3SXNOZXdSZWNvcmQgLSBOZXcgaXMgbmV3IHJlY29yZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0SXNOZXdSZWNvcmQobmV3SXNOZXdSZWNvcmQpIHtcbiAgICB0aGlzLl9pc05ld1JlY29yZCA9IG5ld0lzTmV3UmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxvYWQgd2l0aCBpZC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gUmVjb3JkIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcmVsb2FkV2l0aElkKGlkKSB7XG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKVxuXG4gICAgLyoqXG4gICAgICogV2hlcmUgb2JqZWN0LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3Qgd2hlcmVPYmplY3QgPSB7fVxuXG4gICAgT2JqZWN0LmFzc2lnbih3aGVyZU9iamVjdCwgbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhwcmltYXJ5S2V5LCBpZCkpXG5cbiAgICBjb25zdCBxdWVyeSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxNQz59ICovIChcbiAgICAgIHRoaXNcbiAgICAgICAgLnF1ZXJ5Rm9yTW9kZWwodGhpcy5nZXRNb2RlbENsYXNzKCkpXG4gICAgICAgIC53aGVyZSh3aGVyZU9iamVjdClcbiAgICApXG4gICAgY29uc3QgcmVsb2FkZWRNb2RlbCA9IGF3YWl0IHF1ZXJ5LmZpcnN0KClcblxuICAgIGlmICghcmVsb2FkZWRNb2RlbCkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0jJHtpZH0gY291bGRuJ3QgYmUgcmVsb2FkZWQgLSByZWNvcmQgZGlkbid0IGV4aXN0YClcblxuICAgIHRoaXMuX2F0dHJpYnV0ZXMgPSByZWxvYWRlZE1vZGVsLnJhd0F0dHJpYnV0ZXMoKVxuICAgIHRoaXMuX2NoYW5nZXMgPSB7fVxuICAgIHRoaXMuX2Fzc2lnbmVkQXR0cmlidXRlTmFtZXMgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlbG9hZCgpIHtcbiAgICBjb25zdCByZWNvcmRJZCA9IHRoaXMuX3BlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgYXdhaXQgdGhpcy5fcmVsb2FkV2l0aElkKHJlY29yZElkKVxuICB9XG5cbiAgYXN5bmMgX3J1blZhbGlkYXRpb25zKCkge1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge3R5cGU6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nfT59ICovXG4gICAgdGhpcy5fdmFsaWRhdGlvbkVycm9ycyA9IHt9XG5cbiAgICBjb25zdCB2YWxpZGF0b3JzID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuX3ZhbGlkYXRvcnNcblxuICAgIGlmICh2YWxpZGF0b3JzKSB7XG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgaW4gdmFsaWRhdG9ycykge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVWYWxpZGF0b3JzID0gdmFsaWRhdG9yc1thdHRyaWJ1dGVOYW1lXVxuXG4gICAgICAgIGZvciAoY29uc3QgdmFsaWRhdG9yIG9mIGF0dHJpYnV0ZVZhbGlkYXRvcnMpIHtcbiAgICAgICAgICBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGUoe21vZGVsOiB0aGlzLCBhdHRyaWJ1dGVOYW1lfSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyh0aGlzLl92YWxpZGF0aW9uRXJyb3JzKS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCB2YWxpZGF0aW9uRXJyb3IgPSBuZXcgVmFsaWRhdGlvbkVycm9yKHRoaXMuZnVsbEVycm9yTWVzc2FnZXMoKS5qb2luKFwiLiBcIikpXG5cbiAgICAgIHZhbGlkYXRpb25FcnJvci5zZXRWYWxpZGF0aW9uRXJyb3JzKHRoaXMuX3ZhbGlkYXRpb25FcnJvcnMpXG4gICAgICB2YWxpZGF0aW9uRXJyb3Iuc2V0TW9kZWwodGhpcylcbiAgICAgIHZhbGlkYXRpb25FcnJvci52ZWxvY2lvdXMgPSB7dHlwZTogXCJ2YWxpZGF0aW9uX2Vycm9yXCJ9XG5cbiAgICAgIHRocm93IHZhbGlkYXRpb25FcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZ1bGwgZXJyb3IgbWVzc2FnZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBUaGUgZnVsbCBlcnJvciBtZXNzYWdlcy5cbiAgICovXG4gIGZ1bGxFcnJvck1lc3NhZ2VzKCkge1xuICAgIC8qKlxuICAgICAqIFZhbGlkYXRpb24gZXJyb3IgbWVzc2FnZXMuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvck1lc3NhZ2VzID0gW11cblxuICAgIGlmICh0aGlzLl92YWxpZGF0aW9uRXJyb3JzKSB7XG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgaW4gdGhpcy5fdmFsaWRhdGlvbkVycm9ycykge1xuICAgICAgICBmb3IgKGNvbnN0IHZhbGlkYXRpb25FcnJvciBvZiB0aGlzLl92YWxpZGF0aW9uRXJyb3JzW2F0dHJpYnV0ZU5hbWVdKSB7XG4gICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLmh1bWFuQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKX0gJHt2YWxpZGF0aW9uRXJyb3IubWVzc2FnZX1gXG5cbiAgICAgICAgICB2YWxpZGF0aW9uRXJyb3JNZXNzYWdlcy5wdXNoKG1lc3NhZ2UpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdmFsaWRhdGlvbkVycm9yTWVzc2FnZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIHRoZSBhdHRyaWJ1dGVzIHRvIHRoZSByZWNvcmQgYW5kIHNhdmVzIGl0LlxuICAgKiBAcGFyYW0ge1dyaXRlQXR0cmlidXRlc30gYXR0cmlidXRlc1RvQXNzaWduIC0gVGhlIGF0dHJpYnV0ZXMgdG8gYXNzaWduIHRvIHRoZSByZWNvcmQuXG4gICAqL1xuICBhc3luYyB1cGRhdGUoYXR0cmlidXRlc1RvQXNzaWduKSB7XG4gICAgaWYgKGF0dHJpYnV0ZXNUb0Fzc2lnbikgdGhpcy5hc3NpZ24oYXR0cmlidXRlc1RvQXNzaWduKVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlKClcbiAgfVxufVxuXG5WZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlclZhbGlkYXRvclR5cGUoXCJmb3JtYXRcIiwgVmFsaWRhdG9yc0Zvcm1hdClcblZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyVmFsaWRhdG9yVHlwZShcImxlbmd0aFwiLCBWYWxpZGF0b3JzTGVuZ3RoKVxuVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJWYWxpZGF0b3JUeXBlKFwicHJlc2VuY2VcIiwgVmFsaWRhdG9yc1ByZXNlbmNlKVxuVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJWYWxpZGF0b3JUeXBlKFwidW5pcXVlbmVzc1wiLCBWYWxpZGF0b3JzVW5pcXVlbmVzcylcblxuZXhwb3J0IHtBZHZpc29yeUxvY2tCdXN5RXJyb3IsIEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3IsIEFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvciwgVGVuYW50RGF0YWJhc2VTY29wZUVycm9yLCBWYWxpZGF0aW9uRXJyb3J9XG5leHBvcnQgZGVmYXVsdCBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZFxuIl19