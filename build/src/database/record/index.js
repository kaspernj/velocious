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
import { recordAttachmentsStoreForModel } from "./attachments/store.js";
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
            const saveInTransaction = async () => {
                /** @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */
                let persistedAttributesBeforeUpdate;
                let updateReloaded = false;
                try {
                    await this._runLifecycleCallbacks("beforeSave");
                    // If any belongs-to-relationships was saved, then updated-at should still be set on this record.
                    const { savedCount } = await this._autoSaveBelongsToRelationships();
                    if (this.isPersisted()) {
                        persistedAttributesBeforeUpdate = { ...this._attributes };
                        await this._runLifecycleCallbacks("beforeUpdate");
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
                    if (updateReloaded && persistedAttributesBeforeUpdate) {
                        this._attributes = persistedAttributesBeforeUpdate;
                        this._changes = {};
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
        const useTransactions = this.connection().getArgs().record?.transactions;
        if (useTransactions !== false) {
            return await this.connection().transaction(callback);
        }
        else {
            return await callback();
        }
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
     * Destroys the record in the database and all of its dependent records.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async destroy() {
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
        let result;
        if (attributeName in belongsToChanges) {
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
            if (Object.keys(this.getModelClass().getAttachments()).length > 0
                && modelPrimaryKeyCacheKey(primaryKey, persistedPrimaryKeyValue) !== modelPrimaryKeyCacheKey(primaryKey, nextPrimaryKeyValue)) {
                await recordAttachmentsStoreForModel(this).migrateRecordIdentity({
                    connection,
                    model: this,
                    nextIdentity: nextPrimaryKeyValue,
                    previousIdentity: persistedPrimaryKeyValue
                });
            }
            await this._reloadWithId(nextPrimaryKeyValue);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7O0dBR0c7QUFFSDs7OztHQUlHO0FBRUg7Ozs7R0FJRztBQUVIOzs7R0FHRztBQUVILDhHQUE4RztBQUU5Rzs7O0dBR0c7QUFFSCxPQUFPLGtCQUFrQixFQUFFLEVBQUMscUJBQXFCLEVBQUUsNEJBQTRCLEVBQUUsd0JBQXdCLEVBQUMsTUFBTSw0QkFBNEIsQ0FBQTtBQUM1SSxPQUFPLDZCQUE2QixNQUFNLHdDQUF3QyxDQUFBO0FBQ2xGLE9BQU8scUJBQXFCLE1BQU0sK0JBQStCLENBQUE7QUFDakUsT0FBTyxhQUFhLE1BQU0sd0JBQXdCLENBQUE7QUFDbEQsT0FBTyxPQUFPLE1BQU0sa0JBQWtCLENBQUE7QUFDdEMsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFDOUMsT0FBTyxPQUFPLE1BQU0sZUFBZSxDQUFBO0FBQ25DLE9BQU8sMkJBQTJCLE1BQU0sc0NBQXNDLENBQUE7QUFDOUUsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUM3RCxPQUFPLDBCQUEwQixNQUFNLHFDQUFxQyxDQUFBO0FBQzVFLE9BQU8sa0JBQWtCLE1BQU0sNEJBQTRCLENBQUE7QUFDM0QsT0FBTyxzQkFBc0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM1RCxPQUFPLEVBQUMsOEJBQThCLEVBQUMsTUFBTSx3QkFBd0IsQ0FBQTtBQUNyRSxPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUN4QyxPQUFPLGdCQUFnQixNQUFNLG1DQUFtQyxDQUFBO0FBQ2hFLE9BQU8sZUFBZSxNQUFNLCtCQUErQixDQUFBO0FBQzNELE9BQU8sU0FBUyxNQUFNLHVCQUF1QixDQUFBO0FBQzdDLE9BQU8sRUFBQywyQkFBMkIsRUFBRSwwQkFBMEIsRUFBRSxvQkFBb0IsRUFBRSww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QUN6RSx1QkFBdUIsQ0FBQyxxQkFBcUIsQ0FBQyxVQUFVLEVBQUUsa0JBQWtCLENBQUMsQ0FBQTtBQUM3RSx1QkFBdUIsQ0FBQyxxQkFBcUIsQ0FBQyxZQUFZLEVBQUUsb0JBQW9CLENBQUMsQ0FBQTtBQUVqRixPQUFPLEVBQUMscUJBQXFCLEVBQUUsNEJBQTRCLEVBQUUsd0JBQXdCLEVBQUUsd0JBQXdCLEVBQUUsZUFBZSxFQUFDLENBQUE7QUFDakksZUFBZSx1QkFBdUIsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3t0eXBlOiBzdHJpbmcsIG1lc3NhZ2U6IHN0cmluZ319IFZhbGlkYXRpb25FcnJvck9iamVjdFR5cGVcbiAqL1xuXG4vKipcbiAqIExpZmVjeWNsZUNhbGxiYWNrVHlwZSB0eXBlLlxuICogQHRlbXBsYXRlIFtUPVZlbG9jaW91c0RhdGFiYXNlUmVjb3JkXVxuICogQHR5cGVkZWYgeygobW9kZWw6IFQpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+KSB8IHN0cmluZ30gTGlmZWN5Y2xlQ2FsbGJhY2tUeXBlXG4gKi9cblxuLyoqXG4gKiBNb2RlbCBjbGFzcyBjb25zdHJ1Y3RvciB0eXBlIHVzZWQgZm9yIHN0YXRpYyBgdGhpc2AgdHlwaW5nLlxuICogQHRlbXBsYXRlIFRcbiAqIEB0eXBlZGVmIHt7bmV3IChjaGFuZ2VzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBUfX0gTW9kZWxDb25zdHJ1Y3RvclxuICovXG5cbi8qKlxuICogUmVzdHJpY3RJbnN0YW5jZVJlbGF0aW9uc2hpcCB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7cXVlcnk6ICgpID0+IE1vZGVsQ2xhc3NRdWVyeTx0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQ+fX0gUmVzdHJpY3RJbnN0YW5jZVJlbGF0aW9uc2hpcFxuICovXG5cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVByb3ZpZGVyVHlwZX0gVGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGUgKi9cblxuLyoqXG4gKiBTY2hlbWEgbWV0YWRhdGEgY2FjaGVkIGZvciBvbmUgcmVjb3JkIGNsYXNzIGFuZCBwaHlzaWNhbCBkYXRhYmFzZSBnZW5lcmF0aW9uLlxuICogQHR5cGVkZWYge2Jvb2xlYW4gfCBudWxsIHwgc3RyaW5nIHwgdW5kZWZpbmVkIHwgUHJvbWlzZTx2b2lkPiB8IHN0cmluZ1tdIHwgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0W10gfCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdCB8IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+IHwgUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gUmVjb3JkTWV0YWRhdGFWYWx1ZVxuICovXG5cbmltcG9ydCBBZHZpc29yeUxvY2tSdW5uZXIsIHtBZHZpc29yeUxvY2tCdXN5RXJyb3IsIEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3IsIEFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvcn0gZnJvbSBcIi4uL2Fkdmlzb3J5LWxvY2stcnVubmVyLmpzXCJcbmltcG9ydCBCZWxvbmdzVG9JbnN0YW5jZVJlbGF0aW9uc2hpcCBmcm9tIFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2JlbG9uZ3MtdG8uanNcIlxuaW1wb3J0IEJlbG9uZ3NUb1JlbGF0aW9uc2hpcCBmcm9tIFwiLi9yZWxhdGlvbnNoaXBzL2JlbG9uZ3MtdG8uanNcIlxuaW1wb3J0IENvbmZpZ3VyYXRpb24gZnJvbSBcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIlxuaW1wb3J0IEN1cnJlbnQgZnJvbSBcIi4uLy4uL2N1cnJlbnQuanNcIlxuaW1wb3J0IEZyb21UYWJsZSBmcm9tIFwiLi4vcXVlcnkvZnJvbS10YWJsZS5qc1wiXG5pbXBvcnQgSGFuZGxlciBmcm9tIFwiLi4vaGFuZGxlci5qc1wiXG5pbXBvcnQgSGFzTWFueUluc3RhbmNlUmVsYXRpb25zaGlwIGZyb20gXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvaGFzLW1hbnkuanNcIlxuaW1wb3J0IEhhc01hbnlSZWxhdGlvbnNoaXAgZnJvbSBcIi4vcmVsYXRpb25zaGlwcy9oYXMtbWFueS5qc1wiXG5pbXBvcnQgSGFzT25lSW5zdGFuY2VSZWxhdGlvbnNoaXAgZnJvbSBcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9oYXMtb25lLmpzXCJcbmltcG9ydCBIYXNPbmVSZWxhdGlvbnNoaXAgZnJvbSBcIi4vcmVsYXRpb25zaGlwcy9oYXMtb25lLmpzXCJcbmltcG9ydCBSZWNvcmRBdHRhY2htZW50SGFuZGxlIGZyb20gXCIuL2F0dGFjaG1lbnRzL2hhbmRsZS5qc1wiXG5pbXBvcnQge3JlY29yZEF0dGFjaG1lbnRzU3RvcmVGb3JNb2RlbH0gZnJvbSBcIi4vYXR0YWNobWVudHMvc3RvcmUuanNcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgZGVidXJyQ29sdW1uTmFtZSBmcm9tIFwiLi4vLi4vdXRpbHMvZGVidXJyLWNvbHVtbi1uYW1lLmpzXCJcbmltcG9ydCBNb2RlbENsYXNzUXVlcnkgZnJvbSBcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCJcbmltcG9ydCBQcmVsb2FkZXIgZnJvbSBcIi4uL3F1ZXJ5L3ByZWxvYWRlci5qc1wiXG5pbXBvcnQge3JlYWRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCwgcmVhZFBheWxvYWRDb21wdXRlZEFiaWxpdHksIHJlYWRQYXlsb2FkUXVlcnlEYXRhLCBzZXRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCwgc2V0UGF5bG9hZENvbXB1dGVkQWJpbGl0eSwgc2V0UGF5bG9hZFF1ZXJ5RGF0YX0gZnJvbSBcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiXG5pbXBvcnQgcmVjb3JkQ2hhbmdlcyBmcm9tIFwiLi4vcmVjb3JkLWNoYW5nZXMuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uLy4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQgc2luZ3VsYXJpemVNb2RlbE5hbWUgZnJvbSBcIi4uLy4uL3V0aWxzL3Npbmd1bGFyaXplLW1vZGVsLW5hbWUuanNcIlxuaW1wb3J0IHtkZWZpbmVNb2RlbFNjb3BlfSBmcm9tIFwiLi4vLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIlxuaW1wb3J0IHsgbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlLCBub3JtYWxpemVEYXRlVmFsdWVGb3JSZWFkLCBub3JtYWxpemVEYXRlVmFsdWVGb3JXcml0ZSB9IGZyb20gXCIuLi9kYXRldGltZS1zdG9yYWdlLmpzXCJcbmltcG9ydCB7Zm9ybWF0VmFsdWV9IGZyb20gXCIuLi8uLi91dGlscy9mb3JtYXQtdmFsdWUuanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDYWNoZUtleSwgbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucywgcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlLCBzY2FsYXJNb2RlbFByaW1hcnlLZXksIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuaW1wb3J0IHtjYXB0dXJlQ3JlYXRlQXVkaXRDaGFuZ2VzLCBjYXB0dXJlVXBkYXRlQXVkaXRDaGFuZ2VzLCBjcmVhdGVBdWRpdCwgY3JlYXRlQ3JlYXRlQXVkaXQsIGNyZWF0ZURlc3Ryb3lBdWRpdCwgY3JlYXRlVXBkYXRlQXVkaXQsIGluaXRpYWxpemVBdWRpdGluZywgcmVnaXN0ZXJBdWRpdENhbGxiYWNrLCByZWdpc3RlckF1ZGl0aW5nLCB3aXRob3V0QXVkaXR9IGZyb20gXCIuL2F1ZGl0aW5nLmpzXCJcbmltcG9ydCB7cmVnaXN0ZXJNYWduaXR1ZGVDb3VudGVyQ2FjaGV9IGZyb20gXCIuL2NvdW50ZXItY2FjaGUtbWFnbml0dWRlLmpzXCJcbmltcG9ydCB7c3RhdGVNYWNoaW5lfSBmcm9tIFwiLi9zdGF0ZS1tYWNoaW5lLmpzXCJcbmltcG9ydCBWYWxpZGF0b3JzRm9ybWF0IGZyb20gXCIuL3ZhbGlkYXRvcnMvZm9ybWF0LmpzXCJcbmltcG9ydCBWYWxpZGF0b3JzTGVuZ3RoIGZyb20gXCIuL3ZhbGlkYXRvcnMvbGVuZ3RoLmpzXCJcbmltcG9ydCBWYWxpZGF0b3JzUHJlc2VuY2UgZnJvbSBcIi4vdmFsaWRhdG9ycy9wcmVzZW5jZS5qc1wiXG5pbXBvcnQgVmFsaWRhdG9yc1VuaXF1ZW5lc3MgZnJvbSBcIi4vdmFsaWRhdG9ycy91bmlxdWVuZXNzLmpzXCJcbmltcG9ydCByZWdpc3RlckFjdHNBc0xpc3RDYWxsYmFja3MgZnJvbSBcIi4vYWN0cy1hcy1saXN0LmpzXCJcbmltcG9ydCBUZW5hbnRNb2RlbFNjb3BlIGZyb20gXCIuLi8uLi90ZW5hbnRzL3RlbmFudC1tb2RlbC1zY29wZS5qc1wiXG5pbXBvcnQgVVVJRCBmcm9tIFwicHVyZS11dWlkXCJcblxuLyoqXG4gKiBUcmFuc2xhdGlvbiByZWNvcmQgc2hhcGUgdXNlZCBieSB0cmFuc2xhdGVkIGF0dHJpYnV0ZXMuXG4gKiBAdHlwZWRlZiB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQgJiB7bG9jYWxlOiAoKSA9PiBzdHJpbmd9fSBUcmFuc2xhdGlvbkJhc2VcbiAqL1xuLyoqXG4gKiBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgdHlwZS5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3Rvcn0gQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yXG4gKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BdHRhY2htZW50U3luY0NvbmZpZ3VyYXRpb259IEF0dGFjaG1lbnRTeW5jQ29uZmlndXJhdGlvbiAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlJlY29yZEF0dGFjaG1lbnRDb25maWd1cmF0aW9ufSBSZWNvcmRBdHRhY2htZW50Q29uZmlndXJhdGlvbiAqL1xuXG4vKiogU3RvcmVkIHZhbHVlcyB0aGF0IGEgZGVjbGFyZWQgYFwiYm9vbGVhblwiYCBjYXN0IHJlYWRzIGJhY2sgYXMgYHRydWVgLiAqL1xuY29uc3QgZGVjbGFyZWRCb29sZWFuVHJ1dGh5VmFsdWVzID0gbmV3IFNldChbMSwgdHJ1ZSwgXCIxXCJdKVxuXG4vKiogU3RvcmVkIHZhbHVlcyB0aGF0IGEgZGVjbGFyZWQgYFwiYm9vbGVhblwiYCBjYXN0IHJlYWRzIGJhY2sgYXMgYGZhbHNlYC4gKi9cbmNvbnN0IGRlY2xhcmVkQm9vbGVhbkZhbHN5VmFsdWVzID0gbmV3IFNldChbMCwgZmFsc2UsIFwiMFwiXSlcblxuLyoqIFN0YXRpYyByZWNvcmQgbWV0YWRhdGEgZmllbGRzIGlzb2xhdGVkIHBlciBwaHlzaWNhbCBkYXRhYmFzZS9zY2hlbWEgZ2VuZXJhdGlvbi4gKi9cbmNvbnN0IHJlY29yZE1ldGFkYXRhUHJvcGVydHlOYW1lcyA9IG5ldyBTZXQoW1xuICBcIl9hdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lXCIsXG4gIFwiX2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVcIixcbiAgXCJfY29sdW1uTmFtZXNcIixcbiAgXCJfY29sdW1uc1wiLFxuICBcIl9jb2x1bW5zQXNIYXNoXCIsXG4gIFwiX2NvbHVtblR5cGVCeU5hbWVcIixcbiAgXCJfZGF0YWJhc2VUeXBlXCIsXG4gIFwiX2luaXRpYWxpemVkXCIsXG4gIFwiX2luaXRpYWxpemVSZWNvcmRQcm9taXNlXCIsXG4gIFwiX3RhYmxlXCJcbl0pXG5cbi8qKiBAdHlwZSB7V2Vha01hcDx0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0LCBNYXA8c3RyaW5nLCBNYXA8c3RyaW5nLCBSZWNvcmRNZXRhZGF0YVZhbHVlPj4+fSAqL1xuY29uc3QgcmVjb3JkTWV0YWRhdGFWYWx1ZXNCeU1vZGVsID0gbmV3IFdlYWtNYXAoKVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGdlbmVyYXRpb24ta2V5ZWQgbWV0YWRhdGEgc3RvcmUgb3duZWQgYnkgb25lIGNhbm9uaWNhbCBtb2RlbC5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIENhbm9uaWNhbCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtNYXA8c3RyaW5nLCBNYXA8c3RyaW5nLCBSZWNvcmRNZXRhZGF0YVZhbHVlPj59IC0gTWV0YWRhdGEgc3RvcmUuXG4gKi9cbmZ1bmN0aW9uIHJlY29yZE1ldGFkYXRhVmFsdWVzRm9yKG1vZGVsQ2xhc3MpIHtcbiAgbGV0IHZhbHVlcyA9IHJlY29yZE1ldGFkYXRhVmFsdWVzQnlNb2RlbC5nZXQobW9kZWxDbGFzcylcblxuICBpZiAoIXZhbHVlcykge1xuICAgIHZhbHVlcyA9IG5ldyBNYXAoKVxuICAgIHJlY29yZE1ldGFkYXRhVmFsdWVzQnlNb2RlbC5zZXQobW9kZWxDbGFzcywgdmFsdWVzKVxuICB9XG5cbiAgcmV0dXJuIHZhbHVlc1xufVxuXG5jbGFzcyBWYWxpZGF0aW9uRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9IC0gVmVsb2Npb3VzIG1ldGFkYXRhIGZvciBmcm9udGVuZC1tb2RlbCBlcnJvciByZXBvcnRpbmcuXG4gICAqL1xuICB2ZWxvY2lvdXNcblxuICAvKipcbiAgICogUnVucyBnZXQgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gLSBUaGUgbW9kZWwuXG4gICAqL1xuICBnZXRNb2RlbCgpIHtcbiAgICBpZiAoIXRoaXMuX21vZGVsKSB0aHJvdyBuZXcgRXJyb3IoXCJNb2RlbCBoYXNuJ3QgYmVlbiBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLl9tb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IG1vZGVsLlxuICAgKiBAcGFyYW0ge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRNb2RlbChtb2RlbCkge1xuICAgIHRoaXMuX21vZGVsID0gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB2YWxpZGF0aW9uIGVycm9ycy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFZhbGlkYXRpb25FcnJvck9iamVjdFR5cGVbXT59IC0gVGhlIHZhbGlkYXRpb24gZXJyb3JzLlxuICAgKi9cbiAgZ2V0VmFsaWRhdGlvbkVycm9ycygpIHtcbiAgICBpZiAoIXRoaXMuX3ZhbGlkYXRpb25FcnJvcnMpIHRocm93IG5ldyBFcnJvcihcIlZhbGlkYXRpb24gZXJyb3JzIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRpb25FcnJvcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB2YWxpZGF0aW9uIGVycm9ycy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBWYWxpZGF0aW9uRXJyb3JPYmplY3RUeXBlW10+fSB2YWxpZGF0aW9uRXJyb3JzIC0gVmFsaWRhdGlvbiBlcnJvcnMgdG8gYXNzaWduLlxuICAgKi9cbiAgc2V0VmFsaWRhdGlvbkVycm9ycyh2YWxpZGF0aW9uRXJyb3JzKSB7XG4gICAgdGhpcy5fdmFsaWRhdGlvbkVycm9ycyA9IHZhbGlkYXRpb25FcnJvcnNcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgYXBwbHkgYnVpbHQgcmVjb3JkIGludmVyc2UgcmVsYXRpb25zaGlwLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICogQHBhcmFtIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gYXJncy5wYXJlbnQgLSBQYXJlbnQgcmVjb3JkIGJlaW5nIGJ1aWx0IGZyb20uXG4gKiBAcGFyYW0ge3tnZXRSZWxhdGlvbnNoaXBCeU5hbWU6IFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkW1wiZ2V0UmVsYXRpb25zaGlwQnlOYW1lXCJdfX0gYXJncy5yZWNvcmQgLSBOZXdseSBidWlsdCByZWxhdGVkIHJlY29yZC5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbH0gYXJncy5pbnZlcnNlT2YgLSBJbnZlcnNlIHJlbGF0aW9uc2hpcCBuYW1lLlxuICogQHBhcmFtIHtib29sZWFufSBhcmdzLmFsbG93SGFzTWFueSAtIFdoZXRoZXIgYSBoYXMtbWFueSBpbnZlcnNlIHNob3VsZCBiZSBhcHBlbmRlZC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhcHBseUJ1aWx0UmVjb3JkSW52ZXJzZVJlbGF0aW9uc2hpcCh7YWxsb3dIYXNNYW55LCBpbnZlcnNlT2YsIHBhcmVudCwgcmVjb3JkfSkge1xuICBpZiAoIWludmVyc2VPZikgcmV0dXJuXG5cbiAgY29uc3QgaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwID0gcmVjb3JkLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShpbnZlcnNlT2YpXG5cbiAgaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLnNldEF1dG9TYXZlKGZhbHNlKVxuXG4gIGlmICghYWxsb3dIYXNNYW55IHx8IGludmVyc2VJbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJoYXNPbmVcIikge1xuICAgIGludmVyc2VJbnN0YW5jZVJlbGF0aW9uc2hpcC5zZXRMb2FkZWQocGFyZW50KVxuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKGludmVyc2VJbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJoYXNNYW55XCIpIHtcbiAgICBpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAuYWRkVG9Mb2FkZWQocGFyZW50KVxuICAgIHJldHVyblxuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHJlbGF0aW9uc2hpcCB0eXBlOiAke2ludmVyc2VJbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCl9YClcbn1cblxuLyoqXG4gKiBCdWlsZCBhIHJlbGF0ZWQgcmVjb3JkIGFuZCB3aXJlIGl0cyBpbnZlcnNlIHJlbGF0aW9uc2hpcCB0byB0aGUgcGFyZW50LlxuICogQHBhcmFtIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gcGFyZW50IC0gUGFyZW50IHJlY29yZCBidWlsZGluZyB0aGUgcmVsYXRpb25zaGlwLlxuICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZSBiZWluZyBidWlsdC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzIC0gQXR0cmlidXRlcyBmb3IgdGhlIG5ldyByZWxhdGVkIHJlY29yZC5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gYWxsb3dIYXNNYW55IC0gV2hldGhlciBoYXMtbWFueSBpbnZlcnNlIHJlbGF0aW9uc2hpcHMgc2hvdWxkIGFwcGVuZCB0aGUgcGFyZW50LlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBCdWlsdCByZWxhdGVkIHJlY29yZC5cbiAqL1xuZnVuY3Rpb24gYnVpbGRSZWxhdGVkUmVjb3JkV2l0aEludmVyc2UocGFyZW50LCByZWxhdGlvbnNoaXBOYW1lLCBhdHRyaWJ1dGVzLCBhbGxvd0hhc01hbnkpIHtcbiAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSBwYXJlbnQuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gIGNvbnN0IHJlY29yZCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmJ1aWxkKGF0dHJpYnV0ZXMpXG4gIGNvbnN0IGludmVyc2VPZiA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcCgpLmdldEludmVyc2VPZigpXG5cbiAgYXBwbHlCdWlsdFJlY29yZEludmVyc2VSZWxhdGlvbnNoaXAoe1xuICAgIGFsbG93SGFzTWFueSxcbiAgICBpbnZlcnNlT2YsXG4gICAgcGFyZW50LFxuICAgIHJlY29yZDogLyoqIEB0eXBlIHt7Z2V0UmVsYXRpb25zaGlwQnlOYW1lOiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZFtcImdldFJlbGF0aW9uc2hpcEJ5TmFtZVwiXX19ICovIChyZWNvcmQpXG4gIH0pXG5cbiAgcmV0dXJuIHJlY29yZFxufVxuXG5jbGFzcyBUZW5hbnREYXRhYmFzZVNjb3BlRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIEVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7e21vZGVsTmFtZTogc3RyaW5nfX0gYXJncyAtIENvbnRleHQgZm9yIHRoZSBmYWlsZWQgdGVuYW50LXNjb3BlZCBtb2RlbC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2UsIHttb2RlbE5hbWV9KSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSBcIlRlbmFudERhdGFiYXNlU2NvcGVFcnJvclwiXG4gICAgdGhpcy5tb2RlbE5hbWUgPSBtb2RlbE5hbWVcbiAgfVxufVxuXG4vKipcbiAqIEJhc2UgZGF0YWJhc2UgcmVjb3JkLlxuICogQHRlbXBsYXRlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtXcml0ZUF0dHJpYnV0ZXM9UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+XVxuICovXG5jbGFzcyBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCB7XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9hdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9jb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgb2JqZWN0PiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF90cmFuc2xhdGlvbnMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3ZhbGlkYXRvcnMvYmFzZS5qc1wiKS5kZWZhdWx0W10+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX3ZhbGlkYXRvcnMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBMaWZlY3ljbGVDYWxsYmFja1R5cGVbXT4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfbGlmZWN5Y2xlQ2FsbGJhY2tzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vdmFsaWRhdG9ycy9iYXNlLmpzXCIpLmRlZmF1bHQ+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX3ZhbGlkYXRvclR5cGVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkQXR0YWNobWVudENvbmZpZ3VyYXRpb24+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2F0dGFjaG1lbnRzTWFwID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdD4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfcmVsYXRpb25zaGlwcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3F1ZXJ5L3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRm4+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX3F1ZXJ5RGF0YVJlZ2lzdHJhdGlvbnMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7YWxsb3dEZXN0cm95PzogYm9vbGVhbiwgbGltaXQ/OiBudW1iZXIsIHJlamVjdElmPzogKGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gYm9vbGVhbn0+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2FjY2VwdGVkTmVzdGVkQXR0cmlidXRlcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfYXR0cmlidXRlQ2FzdHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHQ+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2NvbHVtbnNBc0hhc2ggPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtBcnJheTxzdHJpbmc+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2NvbHVtbk5hbWVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9jb2x1bW5UeXBlQnlOYW1lID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIG1vZGVsTmFtZVxuXG4gIC8qKlxuICAgKiBPcHQtaW4gY2xpZW50IHN5bmMgZGVjbGFyYXRpb24gY29uc3VtZWQgYnkgYFN5bmNDbGllbnQuZnJvbUNvbmZpZ3VyYXRpb24oLi4uKWAuXG4gICAqIERlY2xhcmUgYHN0YXRpYyBzeW5jID0gdHJ1ZWAgKGFsbCBkZWZhdWx0cykgb3IgYSBkZWNsYXJhdGlvbiBvYmplY3QgbGlrZVxuICAgKiBgc3RhdGljIHN5bmMgPSB7dHJhY2s6IFtcImNyZWF0ZVwiLCBcInVwZGF0ZVwiXSwgc3luY1R5cGU6IFwidXBzZXJ0XCJ9YCB0byBoYXZlIHRoZVxuICAgKiBzeW5jIGNsaWVudCBhdXRvLWRpc2NvdmVyIHRoaXMgbW9kZWwgYW5kIGRlcml2ZSBpdHMgcmVzb3VyY2UgY29uZmlnIGZyb21cbiAgICogY29sdW1uIG1ldGFkYXRhLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vc3luYy9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5Nb2RlbFN5bmNEZWNsYXJhdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHN5bmNcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGwgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfaW5pdGlhbGl6ZVJlY29yZFByb21pc2VcblxuICAvKiogQHR5cGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCB8IHVuZGVmaW5lZH0gQ2Fub25pY2FsIG1vZGVsIGNsYXNzIGV4cG9zZWQgb25seSBieSBhbiBvcGVyYXRpb24tYm91bmQgbWV0YWRhdGEgcHJveHkuICovXG4gIHN0YXRpYyBfcmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzXG5cbiAgLyoqIEB0eXBlIHsoKG1vZGVsQ2xhc3M6IHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkgPT4gdHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSB8IHVuZGVmaW5lZH0gQmluZHMgcmVsYXRlZCBnZW5lcmF0ZWQgbW9kZWwgY2xhc3NlcyB0byB0aGUgc2FtZSBvcGVyYXRpb24gbWV0YWRhdGEgZ2VuZXJhdGlvbi4gKi9cbiAgc3RhdGljIF9yZWNvcmRNZXRhZGF0YUJpbmRlclxuXG4gIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IE9wZXJhdGlvbiBleHBvc2VkIG9ubHkgYnkgYSBjb25zdHJ1Y3RpbmcgbWV0YWRhdGEgcHJveHkuICovXG4gIHN0YXRpYyBfcmVjb3JkTWV0YWRhdGFPcGVyYXRpb25cblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7Ym9vbGVhbiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9lYWdlckxvYWRSZWNvcmRNZXRhZGF0YVxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2F1ZGl0aW5nLmpzXCIpLkF1ZGl0Q2FsbGJhY2tbXT4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfYXVkaXRDYWxsYmFja3NcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7Ym9vbGVhbiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9hdWRpdExpZmVjeWNsZUNhbGxiYWNrc1JlZ2lzdGVyZWRcblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbW9kZWwgbmFtZSwgcHJlZmVycmluZyBhbiBleHBsaWNpdCBgc3RhdGljIG1vZGVsTmFtZWAgZGVjbGFyYXRpb25cbiAgICogb3ZlciB0aGUgSmF2YVNjcmlwdCBjbGFzcyBgLm5hbWVgIHByb3BlcnR5LiBUaGlzIGFsbG93cyBtaW5pZmllZCBidWlsZHMgdG9cbiAgICogcHJlc2VydmUgY29ycmVjdCBtb2RlbCBuYW1lcyB3aXRob3V0IHJlbHlpbmcgb24gYGtlZXBfY2xhc3NuYW1lc2AuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIG1vZGVsIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0TW9kZWxOYW1lKCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5tb2RlbE5hbWUgPT09IFwic3RyaW5nXCIgJiYgdGhpcy5tb2RlbE5hbWUubGVuZ3RoID4gMCkgcmV0dXJuIHRoaXMubW9kZWxOYW1lXG5cbiAgICByZXR1cm4gdGhpcy5uYW1lXG4gIH1cblxuICBzdGF0aWMgZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpIHtcbiAgICBpZiAoIXRoaXMuX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gICAgICB0aGlzLl9hdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBkYXRhYmFzZSBjb2x1bW4gbmFtZSBmb3IgYSByZWNvcmQgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUgdG8gcmVzb2x2ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBNYXBwZWQgY29sdW1uIG5hbWUsIG9yIHRoZSB1bmRlcnNjb3JlZCBhdHRyaWJ1dGUgbmFtZSB3aGVuIG5vIG1hcHBpbmcgZXhpc3RzLlxuICAgKi9cbiAgc3RhdGljIGdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSB0aGlzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICBpZiAocmVzb2x2ZWRBdHRyaWJ1dGVOYW1lKSByZXR1cm4gdGhpcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClbcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lXVxuXG4gICAgcmV0dXJuIGluZmxlY3Rpb24udW5kZXJzY29yZShpbmZsZWN0aW9uLmNhbWVsaXplKGRlYnVyckNvbHVtbk5hbWUoYXR0cmlidXRlTmFtZSksIHRydWUpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuIGluY29taW5nIGF0dHJpYnV0ZSBvciBjb2x1bW4gbmFtZSB0byB0aGUgY2Fub25pY2FsIGF0dHJpYnV0ZSBuYW1lIHRoaXMgbW9kZWwgZXhwb3Nlcy5cbiAgICogQWNjZXB0cyB0aGUgY2Fub25pY2FsIChkZWJ1cnJlZCkgYXR0cmlidXRlIG5hbWUsIGEgcmF3IHVtbGF1dC9hY3JvbnltIGNvbHVtbiBuYW1lLCBhIHByZS1kZWJ1cnJcbiAgICogY2FtZWxpemF0aW9uLCBhbmQgY2FtZWxDYXNlIGNhc2luZyB2YXJpYW50cyAoZS5nLiBcInZBRnVua3Rpb25JRFwiIHZzIFwidkFGdW5rdGlvbmlkXCIpLiBSZXR1cm5zIG51bGxcbiAgICogd2hlbiBub3RoaW5nIG1hdGNoZXMsIHNvIGNhbGxlcnMga2VlcCB0aGVpciBvd24gbm90LWZvdW5kIGhhbmRsaW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEF0dHJpYnV0ZSBuYW1lIG9yIGNvbHVtbiBuYW1lIHRvIHJlc29sdmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIENhbm9uaWNhbCBhdHRyaWJ1dGUgbmFtZSwgb3IgbnVsbC5cbiAgICovXG4gIHN0YXRpYyByZXNvbHZlQXR0cmlidXRlTmFtZShuYW1lKSB7XG4gICAgY29uc3QgYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCA9IHRoaXMuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG5cbiAgICBpZiAobmFtZSBpbiBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKSByZXR1cm4gbmFtZVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZEF0dHJpYnV0ZU5hbWUgPSBpbmZsZWN0aW9uLmNhbWVsaXplKGRlYnVyckNvbHVtbk5hbWUobmFtZSksIHRydWUpXG5cbiAgICBpZiAobm9ybWFsaXplZEF0dHJpYnV0ZU5hbWUgaW4gYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCkgcmV0dXJuIG5vcm1hbGl6ZWRBdHRyaWJ1dGVOYW1lXG5cbiAgICBjb25zdCBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwID0gdGhpcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcblxuICAgIGlmIChuYW1lIGluIGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXApIHJldHVybiBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwW25hbWVdXG5cbiAgICAvLyBGaW5hbCBmYWxsYmFjazogbWF0Y2ggY2FtZWxDYXNlIGNhc2luZyB2YXJpYW50cyBhZ2FpbnN0IHRoZSBtb2RlbCdzIGdlbmVyYXRlZCBhY2Nlc3NvcnMuIFRoZXNlXG4gICAgLy8gZXhpc3Qgb24gdGhlIHByb3RvdHlwZSBiZWZvcmUgcnVudGltZSBpbml0aWFsaXphdGlvbiAodW5saWtlIHRoZSBhdHRyaWJ1dGUgbWFwKSwgc28gdGhpcyBhbHNvXG4gICAgLy8gcmVzb2x2ZXMgbmFtZXMgbG9va2VkIHVwIGR1cmluZyBjcmVhdGUsIGJlZm9yZSB0aGUgbWFwIGlzIGJ1aWx0LiBpbmZsZWN0aW9uIGxvd2VyLWNhc2VzIHRyYWlsaW5nXG4gICAgLy8gYWNyb255bXMgKFwiSURcIiAtPiBcImlkXCIpLCBzbyBcInZBRnVua3Rpb25JRFwiL1wiVkFfRnVua3Rpb25JRFwiIHN0aWxsIHJlc29sdmUgdG8gXCJ2QUZ1bmt0aW9uaWRcIi5cbiAgICBjb25zdCBsb3dlck5vcm1hbGl6ZWRBdHRyaWJ1dGVOYW1lID0gbm9ybWFsaXplZEF0dHJpYnV0ZU5hbWUudG9Mb3dlckNhc2UoKVxuICAgIGxldCBwcm90b3R5cGUgPSB0aGlzLnByb3RvdHlwZVxuXG4gICAgd2hpbGUgKHByb3RvdHlwZSAmJiBwcm90b3R5cGUgIT09IE9iamVjdC5wcm90b3R5cGUpIHtcbiAgICAgIGZvciAoY29uc3QgYWNjZXNzb3JOYW1lIG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHByb3RvdHlwZSkpIHtcbiAgICAgICAgaWYgKGFjY2Vzc29yTmFtZS50b0xvd2VyQ2FzZSgpID09PSBsb3dlck5vcm1hbGl6ZWRBdHRyaWJ1dGVOYW1lKSByZXR1cm4gYWNjZXNzb3JOYW1lXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihwcm90b3R5cGUpXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgbWVtYmVyIG5hbWUgb24gYSB0YXJnZXQncyBwcm90b3R5cGUgY2hhaW4gbWF0Y2hpbmcgYG1lbWJlck5hbWVgLCBmYWxsaW5nIGJhY2sgdG8gYVxuICAgKiBjYXNlLWluc2Vuc2l0aXZlIG1hdGNoLiBSZXNvbHZlcyBzZXR0ZXJzIHdoZW4gYSByZWFkLW9ubHkgYXR0cmlidXRlIGFsaWFzIGRpZmZlcnMgb25seSBpbiBjYW1lbENhc2VcbiAgICogY2FzaW5nIGZyb20gdGhlIGdlbmVyYXRlZCBhY2Nlc3NvciAoZS5nLiBhIFwidkFGdW5rdGlvbklEXCIgYWxpYXMgd2hvc2Ugc2V0dGVyIGlzIFwic2V0VkFGdW5rdGlvbmlkXCIpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gdGFyZ2V0IC0gSW5zdGFuY2Ugb3IgcHJvdG90eXBlIHRvIHNlYXJjaC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lbWJlck5hbWUgLSBNZW1iZXIgbmFtZSB0byBmaW5kLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBNYXRjaGluZyBtZW1iZXIgbmFtZSwgb3IgbnVsbCB3aGVuIGFic2VudC5cbiAgICovXG4gIHN0YXRpYyBmaW5kTWVtYmVyTmFtZUluc2Vuc2l0aXZlKHRhcmdldCwgbWVtYmVyTmFtZSkge1xuICAgIGlmIChtZW1iZXJOYW1lIGluIHRhcmdldCkgcmV0dXJuIG1lbWJlck5hbWVcblxuICAgIGNvbnN0IGxvd2VyTWVtYmVyTmFtZSA9IG1lbWJlck5hbWUudG9Mb3dlckNhc2UoKVxuICAgIGxldCBjdXJyZW50ID0gdGFyZ2V0XG5cbiAgICB3aGlsZSAoY3VycmVudCAmJiBjdXJyZW50ICE9PSBPYmplY3QucHJvdG90eXBlKSB7XG4gICAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZU5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoY3VycmVudCkpIHtcbiAgICAgICAgaWYgKGNhbmRpZGF0ZU5hbWUudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXJNZW1iZXJOYW1lKSByZXR1cm4gY2FuZGlkYXRlTmFtZVxuICAgICAgfVxuXG4gICAgICBjdXJyZW50ID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGN1cnJlbnQpXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmluZSBzY29wZS5cbiAgICogQHBhcmFtIHsoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gY2FsbGJhY2sgLSBTY29wZSBjYWxsYmFjay5cbiAgICogQHJldHVybnMgeygoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD4pICYge3Njb3BlOiAoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1zY29wZS5qc1wiKS5Nb2RlbFNjb3BlRGVzY3JpcHRvcn19IC0gU2NvcGUgaGVscGVyLlxuICAgKi9cbiAgc3RhdGljIGRlZmluZVNjb3BlKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGRlZmluZU1vZGVsU2NvcGUoe1xuICAgICAgY2FsbGJhY2ssXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgc3RhcnRRdWVyeTogKG1vZGVsQ2xhc3MgPSB0aGlzKSA9PiB7XG4gICAgICAgIC8vIFRoaXMgYmFja2VuZCBzY29wZSBmYWN0b3J5IGNhbiBvbmx5IGJlIGludm9rZWQgdGhyb3VnaCBhIERhdGFiYXNlUmVjb3JkIGNsYXNzLlxuICAgICAgICBjb25zdCBCYWNrZW5kTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAqLyAobW9kZWxDbGFzcylcblxuICAgICAgICByZXR1cm4gQmFja2VuZE1vZGVsQ2xhc3MuX25ld1F1ZXJ5KClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGFwcGxpY2F0aW9uIG1vZGVsIGNsYXNzIGJlaGluZCBhbiBvcGVyYXRpb24tYm91bmQgbWV0YWRhdGEgdmlldy5cbiAgICogQHJldHVybnMge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gLSBDYW5vbmljYWwgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgY2Fub25pY2FsUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKCkge1xuICAgIHJldHVybiB0aGlzLl9yZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MgfHwgdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIEJpbmRzIGEgcmVsYXRpb25zaGlwIHRhcmdldCB0byB0aGlzIG1vZGVsIGNsYXNzJ3MgbWV0YWRhdGEgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IG1vZGVsQ2xhc3MgLSBSZWxhdGlvbnNoaXAgdGFyZ2V0LlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAtIEdlbmVyYXRpb24tYm91bmQgdGFyZ2V0LCBvciB0aGUgdW5jaGFuZ2VkIHRhcmdldCBmb3IgbGVnYWN5IHF1ZXJpZXMuXG4gICAqL1xuICBzdGF0aWMgYmluZFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JlY29yZE1ldGFkYXRhQmluZGVyID8gdGhpcy5fcmVjb3JkTWV0YWRhdGFCaW5kZXIobW9kZWxDbGFzcykgOiBtb2RlbENsYXNzXG4gIH1cblxuICBzdGF0aWMgZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpIHtcbiAgICBpZiAoIXRoaXMuX2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gICAgICB0aGlzLl9jb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVxuICB9XG5cbiAgc3RhdGljIGdldFRyYW5zbGF0aW9uc01hcCgpIHtcbiAgICBpZiAoIXRoaXMuX3RyYW5zbGF0aW9ucykge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgb2JqZWN0Pn0gKi9cbiAgICAgIHRoaXMuX3RyYW5zbGF0aW9ucyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3RyYW5zbGF0aW9uc1xuICB9XG5cbiAgc3RhdGljIGdldFZhbGlkYXRvcnNNYXAoKSB7XG4gICAgaWYgKCF0aGlzLl92YWxpZGF0b3JzKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3ZhbGlkYXRvcnMvYmFzZS5qc1wiKS5kZWZhdWx0W10+fSAqL1xuICAgICAgdGhpcy5fdmFsaWRhdG9ycyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRvcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsaWZlY3ljbGUgY2FsbGJhY2tzIG1hcC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIExpZmVjeWNsZUNhbGxiYWNrVHlwZVtdPn0gLSBMaWZlY3ljbGUgY2FsbGJhY2tzIGtleWVkIGJ5IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0TGlmZWN5Y2xlQ2FsbGJhY2tzTWFwKCkge1xuICAgIGlmICghdGhpcy5fbGlmZWN5Y2xlQ2FsbGJhY2tzKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBMaWZlY3ljbGVDYWxsYmFja1R5cGVbXT59ICovXG4gICAgICB0aGlzLl9saWZlY3ljbGVDYWxsYmFja3MgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9saWZlY3ljbGVDYWxsYmFja3NcbiAgfVxuXG4gIHN0YXRpYyBnZXRWYWxpZGF0b3JUeXBlc01hcCgpIHtcbiAgICBpZiAoIXRoaXMuX3ZhbGlkYXRvclR5cGVzKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB0eXBlb2YgaW1wb3J0KFwiLi92YWxpZGF0b3JzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gICAgICB0aGlzLl92YWxpZGF0b3JUeXBlcyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRvclR5cGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0YWNobWVudHMgbWFwLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmVjb3JkQXR0YWNobWVudENvbmZpZ3VyYXRpb24+fSAtIEF0dGFjaG1lbnQgZGVmaW5pdGlvbnMga2V5ZWQgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRBdHRhY2htZW50c01hcCgpIHtcbiAgICBpZiAoIXRoaXMuX2F0dGFjaG1lbnRzTWFwKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZWNvcmRBdHRhY2htZW50Q29uZmlndXJhdGlvbj59ICovXG4gICAgICB0aGlzLl9hdHRhY2htZW50c01hcCA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2F0dGFjaG1lbnRzTWFwXG4gIH1cblxuICAvKipcbiAgICogQXR0cmlidXRlcy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgX2F0dHJpYnV0ZXMgPSB7fVxuXG4gIC8qKlxuICAgKiBDaGFuZ2VzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBfY2hhbmdlcyA9IHt9XG5cbiAgLyoqXG4gICAqIENoYW5nZXMgY2FwdHVyZWQgYmVmb3JlIGEgY3JlYXRlIGF1ZGl0IGlzIHdyaXR0ZW4uXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL2F1ZGl0aW5nLmpzXCIpLkF1ZGl0Q2hhbmdlcyB8IHVuZGVmaW5lZH0gKi9cbiAgX3BlbmRpbmdDcmVhdGVBdWRpdENoYW5nZXMgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogQ2hhbmdlcyBjYXB0dXJlZCBiZWZvcmUgYW4gdXBkYXRlIGF1ZGl0IGlzIHdyaXR0ZW4uXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL2F1ZGl0aW5nLmpzXCIpLkF1ZGl0Q2hhbmdlcyB8IHVuZGVmaW5lZH0gKi9cbiAgX3BlbmRpbmdVcGRhdGVBdWRpdENoYW5nZXMgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogQXR0cmlidXRlIG5hbWVzIGV4cGxpY2l0bHkgYXNzaWduZWQgaW4gdGhlIGN1cnJlbnQgdXBkYXRlIGNhbGwuXG4gICAqIEB0eXBlIHtTZXQ8c3RyaW5nPiB8IHVuZGVmaW5lZH1cbiAgICovXG4gIF9hc3NpZ25lZEF0dHJpYnV0ZU5hbWVzID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIENvbHVtbnMgYXMgaGFzaC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD59ICovXG4gIF9jb2x1bW5zQXNIYXNoID0ge31cblxuICAvKipcbiAgICogQ29ubmVjdGlvbi5cbiAgICogQHR5cGUge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICBfX2Nvbm5lY3Rpb24gPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogRXhwbGljaXQgb3BlcmF0aW9uIG93bmluZyB0aGlzIHJlY29yZCdzIGRhdGFiYXNlIHdvcmsuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgX2RhdGFiYXNlT3BlcmF0aW9uID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIEluc3RhbmNlIHJlbGF0aW9uc2hpcHMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgX2luc3RhbmNlUmVsYXRpb25zaGlwcyA9IHt9XG4gIC8qKlxuICAgKiBBdHRhY2htZW50cy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJlY29yZEF0dGFjaG1lbnRIYW5kbGU+fSAqL1xuICBfYXR0YWNobWVudHMgPSB7fVxuXG4gIC8qKlxuICAgKiBMb2FkIGNvaG9ydC5cbiAgICogQHR5cGUge0FycmF5PFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPiB8IHVuZGVmaW5lZH0gLSBTaGFyZWQgcmVmZXJlbmNlIHRvIHNpYmxpbmcgcmVjb3JkcyBsb2FkZWQgaW4gdGhlIHNhbWUgYmF0Y2guIFVzZWQgYnkgYXV0by1wcmVsb2FkLlxuICAgKi9cbiAgX2xvYWRDb2hvcnQgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogVGFibGUgbmFtZS5cbiAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgX190YWJsZU5hbWUgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogVmFsaWRhdGlvbiBlcnJvcnMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBWYWxpZGF0aW9uRXJyb3JPYmplY3RUeXBlW10+fSAqL1xuICBfdmFsaWRhdGlvbkVycm9ycyA9IHt9XG5cbiAgc3RhdGljIHZhbGlkYXRvclR5cGVzKCkge1xuICAgIHJldHVybiB0aGlzLmdldFZhbGlkYXRvclR5cGVzTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIHZhbGlkYXRvciB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vdmFsaWRhdG9ycy9iYXNlLmpzXCIpLmRlZmF1bHR9IHZhbGlkYXRvckNsYXNzIC0gVmFsaWRhdG9yIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyVmFsaWRhdG9yVHlwZShuYW1lLCB2YWxpZGF0b3JDbGFzcykge1xuICAgIHRoaXMudmFsaWRhdG9yVHlwZXMoKVtuYW1lXSA9IHZhbGlkYXRvckNsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlciBsaWZlY3ljbGUgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7XCJhZnRlckNyZWF0ZVwiIHwgXCJhZnRlckRlc3Ryb3lcIiB8IFwiYWZ0ZXJTYXZlXCIgfCBcImFmdGVyVXBkYXRlXCIgfCBcImJlZm9yZUNyZWF0ZVwiIHwgXCJiZWZvcmVEZXN0cm95XCIgfCBcImJlZm9yZVNhdmVcIiB8IFwiYmVmb3JlVXBkYXRlXCIgfCBcImJlZm9yZVZhbGlkYXRpb25cIn0gY2FsbGJhY2tOYW1lIC0gQ2FsbGJhY2sgdHlwZS5cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2soY2FsbGJhY2tOYW1lLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IGNhbGxiYWNrcyA9IHRoaXMuZ2V0TGlmZWN5Y2xlQ2FsbGJhY2tzTWFwKClcblxuICAgIGlmICghY2FsbGJhY2tzW2NhbGxiYWNrTmFtZV0pIHtcbiAgICAgIGNhbGxiYWNrc1tjYWxsYmFja05hbWVdID0gW11cbiAgICB9XG5cbiAgICBjYWxsYmFja3NbY2FsbGJhY2tOYW1lXS5wdXNoKGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdW5yZWdpc3RlciBsaWZlY3ljbGUgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7XCJhZnRlckNyZWF0ZVwiIHwgXCJhZnRlckRlc3Ryb3lcIiB8IFwiYWZ0ZXJTYXZlXCIgfCBcImFmdGVyVXBkYXRlXCIgfCBcImJlZm9yZUNyZWF0ZVwiIHwgXCJiZWZvcmVEZXN0cm95XCIgfCBcImJlZm9yZVNhdmVcIiB8IFwiYmVmb3JlVXBkYXRlXCIgfCBcImJlZm9yZVZhbGlkYXRpb25cIn0gY2FsbGJhY2tOYW1lIC0gQ2FsbGJhY2sgdHlwZS5cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gUHJldmlvdXNseSByZWdpc3RlcmVkIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyB1bnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2soY2FsbGJhY2tOYW1lLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IGNhbGxiYWNrcyA9IHRoaXMuZ2V0TGlmZWN5Y2xlQ2FsbGJhY2tzTWFwKClbY2FsbGJhY2tOYW1lXVxuXG4gICAgaWYgKCFjYWxsYmFja3MpIHJldHVyblxuXG4gICAgY29uc3QgY2FsbGJhY2tJbmRleCA9IGNhbGxiYWNrcy5pbmRleE9mKGNhbGxiYWNrKVxuXG4gICAgaWYgKGNhbGxiYWNrSW5kZXggPj0gMCkgY2FsbGJhY2tzLnNwbGljZShjYWxsYmFja0luZGV4LCAxKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIHZhbGlkYXRpb24uXG4gICAqIEB0ZW1wbGF0ZSBSXG4gICAqIEB0aGlzIHtNb2RlbENvbnN0cnVjdG9yPFI+fVxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZTxSPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYmVmb3JlVmFsaWRhdGlvbihjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImJlZm9yZVZhbGlkYXRpb25cIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgc2F2ZS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBiZWZvcmVTYXZlKGNhbGxiYWNrKSB7XG4gICAgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjay5jYWxsKHRoaXMsIFwiYmVmb3JlU2F2ZVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBjcmVhdGUuXG4gICAqIEB0ZW1wbGF0ZSBSXG4gICAqIEB0aGlzIHtNb2RlbENvbnN0cnVjdG9yPFI+fVxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZTxSPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYmVmb3JlQ3JlYXRlKGNhbGxiYWNrKSB7XG4gICAgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjay5jYWxsKHRoaXMsIFwiYmVmb3JlQ3JlYXRlXCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIHVwZGF0ZS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBiZWZvcmVVcGRhdGUoY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJiZWZvcmVVcGRhdGVcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgZGVzdHJveS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBiZWZvcmVEZXN0cm95KGNhbGxiYWNrKSB7XG4gICAgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjay5jYWxsKHRoaXMsIFwiYmVmb3JlRGVzdHJveVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIHNhdmUuXG4gICAqIEB0ZW1wbGF0ZSBSXG4gICAqIEB0aGlzIHtNb2RlbENvbnN0cnVjdG9yPFI+fVxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZTxSPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYWZ0ZXJTYXZlKGNhbGxiYWNrKSB7XG4gICAgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjay5jYWxsKHRoaXMsIFwiYWZ0ZXJTYXZlXCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgY3JlYXRlLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFmdGVyQ3JlYXRlKGNhbGxiYWNrKSB7XG4gICAgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjay5jYWxsKHRoaXMsIFwiYWZ0ZXJDcmVhdGVcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciB1cGRhdGUuXG4gICAqIEB0ZW1wbGF0ZSBSXG4gICAqIEB0aGlzIHtNb2RlbENvbnN0cnVjdG9yPFI+fVxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZTxSPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYWZ0ZXJVcGRhdGUoY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJhZnRlclVwZGF0ZVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGRlc3Ryb3kuXG4gICAqIEB0ZW1wbGF0ZSBSXG4gICAqIEB0aGlzIHtNb2RlbENvbnN0cnVjdG9yPFI+fVxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZTxSPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYWZ0ZXJEZXN0cm95KGNhbGxiYWNrKSB7XG4gICAgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjay5jYWxsKHRoaXMsIFwiYWZ0ZXJEZXN0cm95XCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIEVuYWJsZXMgYXV0b21hdGljIGNyZWF0ZS91cGRhdGUvZGVzdHJveSBhdWRpdGluZyBmb3IgdGhpcyBtb2RlbC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYXVkaXRlZCgpIHtcbiAgICByZWdpc3RlckF1ZGl0aW5nKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyZXMgYW4gYWFzbS1zdHlsZSBzdGF0ZSBtYWNoaW5lIG9uIHRoaXMgbW9kZWw6IG5hbWVkIHN0YXRlcywgZXZlbnRzXG4gICAqIChndWFyZGVkIHRyYW5zaXRpb25zKSwgYW5kIGVudGVyL2V4aXQgKyBiZWZvcmUvYWZ0ZXIgdHJhbnNpdGlvbiBob29rcy4gU2VlXG4gICAqIGBzdGF0ZS1tYWNoaW5lLmpzYC4gR2VuZXJhdGVzIGBldmVudCgpYCAvIGBldmVudEFuZFNhdmUoKWAgLyBgY2FuRXZlbnQoKWBcbiAgICogdHJhbnNpdGlvbiBtZXRob2RzIHBlciBkZWNsYXJlZCBldmVudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N0YXRlLW1hY2hpbmUuanNcIikuU3RhdGVNYWNoaW5lRGVmaW5pdGlvbn0gZGVmaW5pdGlvbiAtIFN0YXRlIG1hY2hpbmUgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgc3RhdGVNYWNoaW5lKGRlZmluaXRpb24pIHtcbiAgICBzdGF0ZU1hY2hpbmUodGhpcywgZGVmaW5pdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoaXMgbW9kZWwncyBzdGF0ZSBtYWNoaW5lIGRlZmluaXRpb24sIG9yIG51bGwgd2hlbiBpdCBkZWNsYXJlcyBub25lLlxuICAgKiBgTW9kZWwuc3RhdGVNYWNoaW5lKC4uLilgIG92ZXJyaWRlcyB0aGlzIG9uIGNsYXNzZXMgdGhhdCBkZWNsYXJlIGEgbWFjaGluZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vc3RhdGUtbWFjaGluZS5qc1wiKS5TdGF0ZU1hY2hpbmVEZWZpbml0aW9uIHwgbnVsbH0gLSBUaGUgc3RhdGUgbWFjaGluZSBkZWZpbml0aW9uLCBvciBudWxsIHdoZW4gbm9uZSBpcyBkZWNsYXJlZC5cbiAgICovXG4gIHN0YXRpYyBnZXRTdGF0ZU1hY2hpbmVEZWZpbml0aW9uKCkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGlzIG1vZGVsJ3Mgc3RhdGUgY29sdW1uLCBvciBudWxsIHdoZW4gaXQgZGVjbGFyZXMgbm8gc3RhdGUgbWFjaGluZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gVGhlIHN0YXRlIGNvbHVtbiBuYW1lLCBvciBudWxsIHdoZW4gbm8gc3RhdGUgbWFjaGluZSBpcyBkZWNsYXJlZC5cbiAgICovXG4gIHN0YXRpYyBnZXRTdGF0ZU1hY2hpbmVDb2x1bW4oKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoaXMgbW9kZWwncyBkZWNsYXJlZCBzdGF0ZSBuYW1lcyAoZW1wdHkgd2hlbiBpdCBoYXMgbm8gc3RhdGUgbWFjaGluZSkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBUaGUgZGVjbGFyZWQgc3RhdGUgbmFtZXMsIG9yIGFuIGVtcHR5IGFycmF5IHdoZW4gbm8gc3RhdGUgbWFjaGluZSBpcyBkZWNsYXJlZC5cbiAgICovXG4gIHN0YXRpYyBnZXRTdGF0ZU1hY2hpbmVTdGF0ZU5hbWVzKCkge1xuICAgIHJldHVybiBbXVxuICB9XG5cbiAgLyoqXG4gICAqIE1haW50YWlucyBhIGNvdW50ZXIgY29sdW1uIG9uIGEgYGJlbG9uZ3NUb2AgcGFyZW50IGFzIHRoZSBzdW0gb2YgYSBwZXItcmVjb3JkXG4gICAqIG1hZ25pdHVkZSwga2VwdCBjdXJyZW50IGJ5IGF0b21pYyBpbmNyZW1lbnRzIGRpZmZlZCBvbiBldmVyeSBjcmVhdGUvdXBkYXRlL1xuICAgKiBkZXN0cm95IChhbmQgbW92ZWQgYmV0d2VlbiBwYXJlbnRzIHdoZW4gdGhlIGZvcmVpZ24ga2V5IGNoYW5nZXMpLiBTZWVcbiAgICogYGNvdW50ZXItY2FjaGUtbWFnbml0dWRlLmpzYC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvdW50ZXItY2FjaGUtbWFnbml0dWRlLmpzXCIpLk1hZ25pdHVkZUNvdW50ZXJDYWNoZURlZmluaXRpb259IGRlZmluaXRpb24gLSBDb3VudGVyIGNhY2hlIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIG1hZ25pdHVkZUNvdW50ZXJDYWNoZShkZWZpbml0aW9uKSB7XG4gICAgcmVnaXN0ZXJNYWduaXR1ZGVDb3VudGVyQ2FjaGUodGhpcywgZGVmaW5pdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBjYWxsYmFjayBpbnZva2VkIGFmdGVyIHRoaXMgbW9kZWwgd3JpdGVzIGFuIGF1ZGl0IHJvdyBmb3IgdGhlIGFjdGlvbi5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEF1ZGl0IGFjdGlvbiBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYXVkaXRpbmcuanNcIikuQXVkaXRDYWxsYmFja30gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4gYWZ0ZXIgYXVkaXQgY3JlYXRpb24uXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSBVbnN1YnNjcmliZSBmdW5jdGlvbi5cbiAgICovXG4gIHN0YXRpYyBvbkF1ZGl0KGFjdGlvbiwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gcmVnaXN0ZXJBdWRpdENhbGxiYWNrKHRoaXMsIGFjdGlvbiwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyByZWNvcmRzIHRoYXQgZG8gbm90IGhhdmUgYW4gYXVkaXQgcm93IGZvciB0aGUgZ2l2ZW4gYWN0aW9uLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQXVkaXQgYWN0aW9uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSBRdWVyeSBzY29wZWQgdG8gcmVjb3JkcyB3aXRob3V0IHRoYXQgYXVkaXQgYWN0aW9uLlxuICAgKi9cbiAgc3RhdGljIHdpdGhvdXRBdWRpdChhY3Rpb24pIHtcbiAgICByZXR1cm4gd2l0aG91dEF1ZGl0KHRoaXMsIGFjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB2YWxpZGF0b3IgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZhbGlkYXRvck5hbWUgLSBWYWxpZGF0b3IgbmFtZS5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL3ZhbGlkYXRvcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSB2YWxpZGF0b3IgdHlwZS5cbiAgICovXG4gIHN0YXRpYyBnZXRWYWxpZGF0b3JUeXBlKHZhbGlkYXRvck5hbWUpIHtcbiAgICBpZiAoISh2YWxpZGF0b3JOYW1lIGluIHRoaXMudmFsaWRhdG9yVHlwZXMoKSkpIHRocm93IG5ldyBFcnJvcihgVmFsaWRhdG9yIHR5cGUgJHt2YWxpZGF0b3JOYW1lfSBub3QgZm91bmRgKVxuXG4gICAgcmV0dXJuIHRoaXMudmFsaWRhdG9yVHlwZXMoKVt2YWxpZGF0b3JOYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIGV4aXN0cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZWxhdGlvbnNoaXAgZXhpc3RzLlxuICAgKi9cbiAgc3RhdGljIF9yZWxhdGlvbnNoaXBFeGlzdHMocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXBOYW1lIGluIHRoaXMuZ2V0UmVsYXRpb25zaGlwc01hcCgpKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2sgdHlwZS5cbiAgICogQHR5cGVkZWYgeyhxdWVyeTogaW1wb3J0KFwiLi4vcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQ+KSA9PiAoaW1wb3J0KFwiLi4vcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQ+IHwgdm9pZCl9IFJlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2tcbiAgICovXG4gIC8qKlxuICAgKiBSZWxhdGlvbnNoaXBEYXRhQXJndW1lbnRUeXBlIHR5cGUuXG4gICAqIEB0eXBlZGVmIHtvYmplY3R9IFJlbGF0aW9uc2hpcERhdGFBcmd1bWVudFR5cGVcbiAgICogQHByb3BlcnR5IHtib29sZWFufSBbYXV0b2xvYWRdIC0gRGlzYWJsZSBhdXRvLWJhdGNoLXByZWxvYWQgZm9yIHRoaXMgcmVsYXRpb25zaGlwIGJ5IHBhc3NpbmcgZmFsc2UuIERlZmF1bHQgdHJ1ZS5cbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IFtjbGFzc05hbWVdIC0gTW9kZWwgY2xhc3MgbmFtZSBmb3IgdGhlIHJlbGF0ZWQgcmVjb3JkLlxuICAgKiBAcHJvcGVydHkge3N0cmluZ30gW2RlcGVuZGVudF0gLSBEZXBlbmRlbnQgYWN0aW9uIHdoZW4gcGFyZW50IGlzIGRlc3Ryb3llZCAoZS5nLiBcImRlc3Ryb3lcIikuXG4gICAqIEBwcm9wZXJ0eSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBba2xhc3NdIC0gTW9kZWwgY2xhc3MgZm9yIHRoZSByZWxhdGVkIHJlY29yZC5cbiAgICogQHByb3BlcnR5IHtSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrfSBbc2NvcGVdIC0gT3B0aW9uYWwgc2NvcGUgY2FsbGJhY2sgZm9yIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbdHlwZV0gLSBSZWxhdGlvbnNoaXAgdHlwZSAoZS5nLiBcImhhc01hbnlcIiwgXCJiZWxvbmdzVG9cIikuXG4gICAqL1xuICAvKipcbiAgICogUnVucyBkZWZpbmUgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge1JlbGF0aW9uc2hpcERhdGFBcmd1bWVudFR5cGV9IGRhdGEgLSBEYXRhIHBheWxvYWQuXG4gICAqL1xuICBzdGF0aWMgX2RlZmluZVJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lLCBkYXRhKSB7XG4gICAgaWYgKCFyZWxhdGlvbnNoaXBOYW1lKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcmVsYXRpb25zaGlwIG5hbWUgZ2l2ZW46ICR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIGlmICh0aGlzLl9yZWxhdGlvbnNoaXBFeGlzdHMocmVsYXRpb25zaGlwTmFtZSkpIHRocm93IG5ldyBFcnJvcihgUmVsYXRpb25zaGlwICR7cmVsYXRpb25zaGlwTmFtZX0gYWxyZWFkeSBleGlzdHNgKVxuXG4gICAgY29uc3QgYWN0dWFsRGF0YSA9IE9iamVjdC5hc3NpZ24oXG4gICAgICB7XG4gICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgIHR5cGU6IFwiaGFzTWFueVwiXG4gICAgICB9LFxuICAgICAgZGF0YVxuICAgIClcblxuICAgIGlmICghYWN0dWFsRGF0YS5jbGFzc05hbWUgJiYgIWFjdHVhbERhdGEua2xhc3MpIHtcbiAgICAgIGFjdHVhbERhdGEuY2xhc3NOYW1lID0gc2luZ3VsYXJpemVNb2RlbE5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICB9XG5cbiAgICBsZXQgcmVsYXRpb25zaGlwXG4gICAgY29uc3QgcHJvdG90eXBlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcy5wcm90b3R5cGUpKVxuXG4gICAgaWYgKGFjdHVhbERhdGEudHlwZSA9PSBcImJlbG9uZ3NUb1wiKSB7XG4gICAgICByZWxhdGlvbnNoaXAgPSBuZXcgQmVsb25nc1RvUmVsYXRpb25zaGlwKGFjdHVhbERhdGEpXG5cbiAgICAgIHByb3RvdHlwZVtyZWxhdGlvbnNoaXBOYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICAgIHJldHVybiByZWxhdGlvbnNoaXAubG9hZGVkKClcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2BidWlsZCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXBOYW1lKX1gXSA9IGZ1bmN0aW9uKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyBhdHRyaWJ1dGVzKSB7XG4gICAgICAgIHJldHVybiBidWlsZFJlbGF0ZWRSZWNvcmRXaXRoSW52ZXJzZSgvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAqLyAodGhpcyksIHJlbGF0aW9uc2hpcE5hbWUsIGF0dHJpYnV0ZXMsIHRydWUpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgbG9hZCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXBOYW1lKX1gXSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgJHtyZWxhdGlvbnNoaXBOYW1lfU9yTG9hZGBdID0gYXN5bmMgZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJlbGF0aW9uc2hpcE9yTG9hZChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXBOYW1lKX1gXSA9IGZ1bmN0aW9uKC8qKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQgfCBudWxsIHwgdW5kZWZpbmVkfSAqLyBtb2RlbCkge1xuICAgICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgICBjb25zdCBmb3JlaWduS2V5VmFsdWUgPSB0aGlzLl9iZWxvbmdzVG9Gb3JlaWduS2V5VmFsdWUoe21vZGVsLCByZWxhdGlvbnNoaXB9KVxuXG4gICAgICAgIHJlbGF0aW9uc2hpcC5zZXRMb2FkZWQobW9kZWwgfHwgdW5kZWZpbmVkKVxuICAgICAgICByZWxhdGlvbnNoaXAuc2V0UHJlbG9hZGVkKHRydWUpXG4gICAgICAgIHJlbGF0aW9uc2hpcC5zZXREaXJ0eSh0cnVlKVxuICAgICAgICB0aGlzLl9zZXRDb2x1bW5BdHRyaWJ1dGUocmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKSwgZm9yZWlnbktleVZhbHVlKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYWN0dWFsRGF0YS50eXBlID09IFwiaGFzTWFueVwiKSB7XG4gICAgICByZWxhdGlvbnNoaXAgPSBuZXcgSGFzTWFueVJlbGF0aW9uc2hpcChhY3R1YWxEYXRhKVxuXG4gICAgICBwcm90b3R5cGVbcmVsYXRpb25zaGlwTmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2hhcy1tYW55LmpzXCIpLmRlZmF1bHQ8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYCR7cmVsYXRpb25zaGlwTmFtZX1Mb2FkZWRgXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkubG9hZGVkKClcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2Bsb2FkJHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcE5hbWUpfWBdID0gYXN5bmMgZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2Ake3JlbGF0aW9uc2hpcE5hbWV9T3JMb2FkYF0gPSBhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucmVsYXRpb25zaGlwT3JMb2FkKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChhY3R1YWxEYXRhLnR5cGUgPT0gXCJoYXNPbmVcIikge1xuICAgICAgcmVsYXRpb25zaGlwID0gbmV3IEhhc09uZVJlbGF0aW9uc2hpcChhY3R1YWxEYXRhKVxuXG4gICAgICBwcm90b3R5cGVbcmVsYXRpb25zaGlwTmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpLmxvYWRlZCgpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgYnVpbGQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9YF0gPSBmdW5jdGlvbigvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gYXR0cmlidXRlcykge1xuICAgICAgICByZXR1cm4gYnVpbGRSZWxhdGVkUmVjb3JkV2l0aEludmVyc2UoLyoqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gKi8gKHRoaXMpLCByZWxhdGlvbnNoaXBOYW1lLCBhdHRyaWJ1dGVzLCBmYWxzZSlcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2Bsb2FkJHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcE5hbWUpfWBdID0gYXN5bmMgZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2Ake3JlbGF0aW9uc2hpcE5hbWV9T3JMb2FkYF0gPSBhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucmVsYXRpb25zaGlwT3JMb2FkKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biByZWxhdGlvbnNoaXAgdHlwZTogJHthY3R1YWxEYXRhLnR5cGV9YClcbiAgICB9XG5cbiAgICB0aGlzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVtyZWxhdGlvbnNoaXBOYW1lXSA9IHJlbGF0aW9uc2hpcFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIHJlbGF0aW9uc2hpcCBhcmdzLlxuICAgKiBAcGFyYW0ge1JlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2sgfCBvYmplY3QgfCB1bmRlZmluZWR9IHNjb3BlT3JPcHRpb25zIC0gU2NvcGUgY2FsbGJhY2sgb3Igb3B0aW9ucy5cbiAgICogQHBhcmFtIHtvYmplY3QgfCB1bmRlZmluZWR9IG9wdGlvbnMgLSBPcHRpb25zLlxuICAgKiBAcmV0dXJucyB7e3Njb3BlOiAoUmVsYXRpb25zaGlwU2NvcGVDYWxsYmFjayB8IHVuZGVmaW5lZCksIHJlbGF0aW9uc2hpcE9wdGlvbnM6IG9iamVjdH19IC0gTm9ybWFsaXplZCBhcmd1bWVudHMuXG4gICAqL1xuICBzdGF0aWMgX25vcm1hbGl6ZVJlbGF0aW9uc2hpcEFyZ3Moc2NvcGVPck9wdGlvbnMsIG9wdGlvbnMpIHtcbiAgICBpZiAodHlwZW9mIHNjb3BlT3JPcHRpb25zID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc2NvcGU6IC8qKiBAdHlwZSB7UmVsYXRpb25zaGlwU2NvcGVDYWxsYmFja30gKi8gKHNjb3BlT3JPcHRpb25zKSxcbiAgICAgICAgcmVsYXRpb25zaGlwT3B0aW9uczogb3B0aW9ucyB8fCB7fVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBzY29wZTogdW5kZWZpbmVkLFxuICAgICAgcmVsYXRpb25zaGlwT3B0aW9uczogc2NvcGVPck9wdGlvbnMgfHwge31cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGFmdGVyQ3JlYXRlLCBhZnRlclNhdmUsIGFuZCBhZnRlckRlc3Ryb3kgY2FsbGJhY2tzIHRvIHN5bmNcbiAgICogYSBjb3VudGVyIGNhY2hlIGNvbHVtbiBvbiB0aGUgcGFyZW50IG1vZGVsLiBUaGUgY29sdW1uIG5hbWUgZm9sbG93c1xuICAgKiB0aGUgY29udmVudGlvbiBgPGNoaWxkTW9kZWxQbHVyYWxDYW1lbENhc2U+Q291bnRgLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFRoZSBiZWxvbmdzVG8gcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgX3JlZ2lzdGVyQ291bnRlckNhY2hlQ2FsbGJhY2tzKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCBDaGlsZE1vZGVsID0gdGhpc1xuXG4gICAgLyoqXG4gICAgICogQXRvbWljYWxseSByZWNvbXB1dGVzIHRoZSBjb3VudGVyIGNhY2hlIGNvbHVtbiBvbiB0aGUgcGFyZW50IHZpYSBhXG4gICAgICogc2luZ2xlIFVQREFURSAuLi4gU0VUIGNvbCA9IChTRUxFQ1QgQ09VTlQoKikpIHNvIGNvbmN1cnJlbnRcbiAgICAgKiBjcmVhdGVzL2Rlc3Ryb3lzIGNhbm5vdCByYWNlIGludG8gYSBzdGFsZSBjb3VudC5cbiAgICAgKiBAcGFyYW0ge251bWJlciB8IHN0cmluZyB8IG51bGx9IHBhcmVudElkIC0gUGFyZW50IHByaW1hcnkta2V5IHZhbHVlLlxuICAgICAqIEBwYXJhbSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IHJlY29yZCAtIENoaWxkIHJlY29yZCBvd25pbmcgdGhlIGNvbm5lY3Rpb24uXG4gICAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY291bnRlciBjYWNoZSBoYXMgYmVlbiBzeW5jZWQuXG4gICAgICovXG4gICAgYXN5bmMgZnVuY3Rpb24gc3luY0NvdW50ZXIocGFyZW50SWQsIHJlY29yZCkge1xuICAgICAgaWYgKCFwYXJlbnRJZCkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IENoaWxkTW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCBQYXJlbnRNb2RlbCA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgaWYgKCFQYXJlbnRNb2RlbCkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSByZWxhdGlvbnNoaXAuZ2V0UHJpbWFyeUtleSgpXG4gICAgICBjb25zdCBmayA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcbiAgICAgIGNvbnN0IGNoaWxkTW9kZWxOYW1lID0gQ2hpbGRNb2RlbC5nZXRNb2RlbE5hbWUoKVxuICAgICAgY29uc3QgY291bnRlckNvbHVtbiA9IGluZmxlY3Rpb24udW5kZXJzY29yZShgJHtpbmZsZWN0aW9uLnBsdXJhbGl6ZShjaGlsZE1vZGVsTmFtZSl9Q291bnRgKVxuICAgICAgY29uc3QgcGFyZW50VGFibGUgPSBQYXJlbnRNb2RlbC50YWJsZU5hbWUoKVxuICAgICAgY29uc3QgY2hpbGRUYWJsZSA9IENoaWxkTW9kZWwudGFibGVOYW1lKClcbiAgICAgIGNvbnN0IHBrQ29sdW1uID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKHByaW1hcnlLZXkpXG4gICAgICBjb25zdCBjb25uZWN0aW9uID0gcmVjb3JkXG4gICAgICAgIC5xdWVyeUZvck1vZGVsKFBhcmVudE1vZGVsKVxuICAgICAgICAuZHJpdmVyXG4gICAgICBjb25zdCBxdW90ZWQgPSBjb25uZWN0aW9uLnF1b3RlKHBhcmVudElkKVxuXG4gICAgICBjb25zdCBzcWwgPSBgVVBEQVRFICR7Y29ubmVjdGlvbi5xdW90ZVRhYmxlKHBhcmVudFRhYmxlKX0gU0VUICR7Y29ubmVjdGlvbi5xdW90ZUNvbHVtbihjb3VudGVyQ29sdW1uKX0gPSAoU0VMRUNUIENPVU5UKCopIEZST00gJHtjb25uZWN0aW9uLnF1b3RlVGFibGUoY2hpbGRUYWJsZSl9IFdIRVJFICR7Y29ubmVjdGlvbi5xdW90ZUNvbHVtbihmayl9ID0gJHtxdW90ZWR9KSBXSEVSRSAke2Nvbm5lY3Rpb24ucXVvdGVDb2x1bW4ocGtDb2x1bW4pfSA9ICR7cXVvdGVkfWBcblxuICAgICAgYXdhaXQgY29ubmVjdGlvbi5xdWVyeShzcWwsIHtsb2dOYW1lOiBgJHtQYXJlbnRNb2RlbC5uYW1lfSBVcGRhdGVgfSlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBSdW5zIHJlYWQgZmsgYXR0cmlidXRlLlxuICAgICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIENoaWxkIHJlY29yZCBpbnN0YW5jZS5cbiAgICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQ3VycmVudCBmb3JlaWduLWtleSBhdHRyaWJ1dGUgdmFsdWUuXG4gICAgICovXG4gICAgZnVuY3Rpb24gcmVhZEZrQXR0cmlidXRlKHJlY29yZCkge1xuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gQ2hpbGRNb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIGNvbnN0IGZrQXR0cmlidXRlID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpLnJlcGxhY2UoL19pZCQvLCBcIklkXCIpLCB0cnVlKVxuXG4gICAgICByZXR1cm4gcmVjb3JkLnJlYWRBdHRyaWJ1dGUoZmtBdHRyaWJ1dGUpXG4gICAgfVxuXG4gICAgQ2hpbGRNb2RlbC5hZnRlckNyZWF0ZShhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgICBhd2FpdCBzeW5jQ291bnRlcihyZWFkRmtBdHRyaWJ1dGUocmVjb3JkKSwgcmVjb3JkKVxuICAgIH0pXG5cbiAgICBDaGlsZE1vZGVsLmFmdGVyRGVzdHJveShhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgICBhd2FpdCBzeW5jQ291bnRlcihyZWFkRmtBdHRyaWJ1dGUocmVjb3JkKSwgcmVjb3JkKVxuICAgIH0pXG5cbiAgICBDaGlsZE1vZGVsLmJlZm9yZVNhdmUoYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgY29uc3QgbW9kZWwgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocmVjb3JkKVxuXG4gICAgICBpZiAobW9kZWwuaXNOZXdSZWNvcmQoKSkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IENoaWxkTW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCBma0NvbHVtbiA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcblxuICAgICAgLy8gRGV0ZWN0IEZLIGNoYW5nZSB2aWEgZGlyZWN0IGF0dHJpYnV0ZSBhc3NpZ25tZW50IG9yIHJlbGF0aW9uc2hpcCBzZXR0ZXIuXG4gICAgICBjb25zdCBkaXJlY3RDaGFuZ2UgPSBma0NvbHVtbiBpbiBtb2RlbC5fY2hhbmdlc1xuICAgICAgY29uc3QgYmVsb25nc1RvQ2hhbmdlID0gbW9kZWwuX2luc3RhbmNlUmVsYXRpb25zaGlwcz8uW3JlbGF0aW9uc2hpcE5hbWVdPy5nZXREaXJ0eT8uKClcblxuICAgICAgaWYgKGRpcmVjdENoYW5nZSB8fCBiZWxvbmdzVG9DaGFuZ2UpIHtcbiAgICAgICAgbW9kZWxbYF9jb3VudGVyQ2FjaGVQcmV2XyR7cmVsYXRpb25zaGlwTmFtZX1gXSA9IG1vZGVsLl9hdHRyaWJ1dGVzW2ZrQ29sdW1uXVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBDaGlsZE1vZGVsLmFmdGVyU2F2ZShhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgICBjb25zdCBtb2RlbCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChyZWNvcmQpXG4gICAgICBjb25zdCBwcmV2S2V5ID0gYF9jb3VudGVyQ2FjaGVQcmV2XyR7cmVsYXRpb25zaGlwTmFtZX1gXG4gICAgICBjb25zdCBwcmV2aW91c1BhcmVudElkID0gbW9kZWxbcHJldktleV1cblxuICAgICAgaWYgKHByZXZpb3VzUGFyZW50SWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBkZWxldGUgbW9kZWxbcHJldktleV1cbiAgICAgICAgYXdhaXQgc3luY0NvdW50ZXIocHJldmlvdXNQYXJlbnRJZCwgcmVjb3JkKVxuICAgICAgICBhd2FpdCBzeW5jQ291bnRlcihyZWFkRmtBdHRyaWJ1dGUobW9kZWwpLCByZWNvcmQpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWxhdGlvbnNoaXAgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIHJlbGF0aW9uc2hpcCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgIGlmICghcmVsYXRpb25zaGlwKSB0aHJvdyBuZXcgRXJyb3IoYE5vIHJlbGF0aW9uc2hpcCBpbiAke3RoaXMubmFtZX0gY2FsbGVkIFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiIGluIGxpc3Q6ICR7T2JqZWN0LmtleXModGhpcy5nZXRSZWxhdGlvbnNoaXBzTWFwKCkpLmpvaW4oXCIsIFwiKX1gKVxuXG4gICAgcmV0dXJuIHJlbGF0aW9uc2hpcFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcHMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxpbXBvcnQoXCIuL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBUaGUgcmVsYXRpb25zaGlwcy5cbiAgICovXG4gIHN0YXRpYyBnZXRSZWxhdGlvbnNoaXBzKCkge1xuICAgIHJldHVybiBPYmplY3QudmFsdWVzKHRoaXMuZ2V0UmVsYXRpb25zaGlwc01hcCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcHMgbWFwLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb25zIGtleWVkIGJ5IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0UmVsYXRpb25zaGlwc01hcCgpIHtcbiAgICBpZiAoIU9iamVjdC5oYXNPd24odGhpcywgXCJfcmVsYXRpb25zaGlwc1wiKSB8fCAhdGhpcy5fcmVsYXRpb25zaGlwcykge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gICAgICB0aGlzLl9yZWxhdGlvbnNoaXBzID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi8gKHRoaXMuX3JlbGF0aW9uc2hpcHMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwIG5hbWVzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gLSBUaGUgcmVsYXRpb25zaGlwIG5hbWVzLlxuICAgKi9cbiAgc3RhdGljIGdldFJlbGF0aW9uc2hpcE5hbWVzKCkge1xuICAgIHJldHVybiB0aGlzLmdldFJlbGF0aW9uc2hpcHMoKS5tYXAoKHJlbGF0aW9uc2hpcCkgPT4gcmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlciBhIGNvbnN1bWVyLWRlZmluZWQgcXVlcnlEYXRhIGVudHJ5LiBUaGUgY2FsbGJhY2sgcmVjZWl2ZXNcbiAgICogYSBncm91cGVkIHF1ZXJ5IGFscmVhZHkgam9pbmVkIGRvd24gdGhlIHJlbGF0aW9uc2hpcCBjaGFpbiBmcm9tIHRoZVxuICAgKiByb290IG9mIGAucXVlcnlEYXRhKC4uLilgIHRvIHRoaXMgbW9kZWwsIGFscmVhZHkgZmlsdGVyZWQgYnkgdGhlXG4gICAqIHJvb3QgcGFyZW50IElEcywgYW5kIHdpdGggYHBhcmVudF9pZGAgcHJlLXNlbGVjdGVkIOKAlCBzbyB0aGUgZm5cbiAgICogb25seSBuZWVkcyB0byBhZGQgaXRzIG93biBTRUxFQ1QgKGFuZCBvcHRpb25hbGx5IGpvaW5zL3doZXJlKS4gQW55XG4gICAqIGFsaWFzZXMgdGhlIGZuIHNlbGVjdHMgYXJlIGF0dGFjaGVkIHRvIGVhY2ggKipyb290KiogcmVjb3JkIHZpYVxuICAgKiBgcmVjb3JkLnF1ZXJ5RGF0YShhbGlhc05hbWUpYC4gTXVsdGktY29sdW1uIHNlbGVjdHMgYXJlIGZpbmUg4oCUIG9uZVxuICAgKiBhbGlhcyBtYXBzIHRvIG9uZSBxdWVyeURhdGEga2V5LlxuICAgKlxuICAgKiAqKlF1b3RlIEFTIGFsaWFzZXMgb24gUG9zdGdyZVNRTC4qKiBQb3N0Z3JlU1FMIGZvbGRzIHVucXVvdGVkXG4gICAqIGlkZW50aWZpZXJzIChpbmNsdWRpbmcgU0VMRUNUIGFsaWFzZXMpIHRvIGxvd2VyY2FzZSwgc28gYVxuICAgKiBgLi4uIEFTIG1hbnVhbFRhc2tzQ291bnRgIGxhbmRzIGluIHRoZSByZXN1bHQgcm93IGFzXG4gICAqIGBtYW51YWx0YXNrc2NvdW50YCB3aGlsZSB0aGUgbG9va3VwIGByZWNvcmQucXVlcnlEYXRhKFwibWFudWFsVGFza3NDb3VudFwiKWBcbiAgICogbmV2ZXIgZmluZHMgaXQuIFVzZSBgZHJpdmVyLnF1b3RlQ29sdW1uKFwibWFudWFsVGFza3NDb3VudFwiKWAgZm9yIHRoZVxuICAgKiBhbGlhcyB0byBwcmVzZXJ2ZSB0aGUgY2FzZSBvbiBldmVyeSBzdXBwb3J0ZWQgZHJpdmVyOlxuICAgKiAgIHF1ZXJ5LnNlbGVjdChgQ09VTlQoLi4uKSBBUyAke2RyaXZlci5xdW90ZUNvbHVtbihcIm1hbnVhbFRhc2tzQ291bnRcIil9YClcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBJZGVudGlmaWVyIHVzZWQgaW4gdGhlIGAucXVlcnlEYXRhKC4uLilgIHNwZWMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcXVlcnkvcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFGbn0gZm4gLSBDYWxsYmFjayB0aGF0IG11dGF0ZXMgdGhlIHF1ZXJ5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBxdWVyeURhdGEobmFtZSwgZm4pIHtcbiAgICBpZiAoIW5hbWUgfHwgdHlwZW9mIG5hbWUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBxdWVyeURhdGEgbmFtZTogJHtuYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBmbiAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHF1ZXJ5RGF0YSBmbiBmb3IgJHt0aGlzLm5hbWV9LnF1ZXJ5RGF0YSgke0pTT04uc3RyaW5naWZ5KG5hbWUpfSkgbXVzdCBiZSBhIGZ1bmN0aW9uYClcbiAgICB9XG5cbiAgICBjb25zdCBtYXAgPSB0aGlzLmdldFF1ZXJ5RGF0YU1hcCgpXG5cbiAgICAvLyBVc2UgT2JqZWN0Lmhhc093biBzbyBhIG5hbWUgdGhhdCBoYXBwZW5zIHRvIG1hdGNoIGFuIGluaGVyaXRlZFxuICAgIC8vIE9iamVjdC5wcm90b3R5cGUga2V5IChlLmcuIFwidG9TdHJpbmdcIiwgXCJjb25zdHJ1Y3RvclwiKSBpc24ndFxuICAgIC8vIGZhbHNlbHkgdHJlYXRlZCBhcyBhbHJlYWR5IHJlZ2lzdGVyZWQuXG4gICAgaWYgKE9iamVjdC5oYXNPd24obWFwLCBuYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBxdWVyeURhdGEgZm9yICR7dGhpcy5uYW1lfS4ke25hbWV9IGlzIGFscmVhZHkgcmVnaXN0ZXJlZGApXG4gICAgfVxuXG4gICAgbWFwW25hbWVdID0gZm5cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBxdWVyeSBkYXRhIG1hcC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3F1ZXJ5L3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRm4+fSAtIHF1ZXJ5RGF0YSByZWdpc3RyYXRpb25zIGtleWVkIGJ5IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0UXVlcnlEYXRhTWFwKCkge1xuICAgIGlmICghT2JqZWN0Lmhhc093bih0aGlzLCBcIl9xdWVyeURhdGFSZWdpc3RyYXRpb25zXCIpIHx8ICF0aGlzLl9xdWVyeURhdGFSZWdpc3RyYXRpb25zKSB7XG4gICAgICAvLyBQcm90b3R5cGUtbGVzcyBtYXAgc28gYnJhY2tldCBhY2Nlc3MgY2FuIG9ubHkgZXZlciBzdXJmYWNlXG4gICAgICAvLyByZWdpc3RyYXRpb25zIGFjdHVhbGx5IG1hZGUgb24gdGhpcyBjbGFzcyDigJQgbmV2ZXIgaW5oZXJpdGVkXG4gICAgICAvLyBPYmplY3QucHJvdG90eXBlIG1lbWJlcnMuXG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9xdWVyeS9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUZuPn0gKi9cbiAgICAgIHRoaXMuX3F1ZXJ5RGF0YVJlZ2lzdHJhdGlvbnMgPSBPYmplY3QuY3JlYXRlKG51bGwpXG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vcXVlcnkvcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFGbj59ICovICh0aGlzLl9xdWVyeURhdGFSZWdpc3RyYXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHF1ZXJ5IGRhdGEgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBxdWVyeURhdGEgbmFtZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3F1ZXJ5L3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRm4gfCBudWxsfSAtIFJlZ2lzdGVyZWQgZm4gb3IgbnVsbCB3aGVuIG5vdCBmb3VuZC5cbiAgICovXG4gIHN0YXRpYyBnZXRRdWVyeURhdGFCeU5hbWUobmFtZSkge1xuICAgIGNvbnN0IG1hcCA9IHRoaXMuZ2V0UXVlcnlEYXRhTWFwKClcblxuICAgIC8vIE93bi1wcm9wZXJ0eSBsb29rdXAgc28gYSBzcGVjIGNvbnRhaW5pbmcgZS5nLiBcInRvU3RyaW5nXCIgZG9lc24ndFxuICAgIC8vIHJlc29sdmUgdG8gYW4gaW5oZXJpdGVkIE9iamVjdC5wcm90b3R5cGUgbWVtYmVyIOKAlCBtYXRjaGluZyB0aGVcbiAgICAvLyBPYmplY3QuaGFzT3duIGd1YXJkIHVzZWQgd2hlbiByZWdpc3RlcmluZy5cbiAgICByZXR1cm4gT2JqZWN0Lmhhc093bihtYXAsIG5hbWUpID8gbWFwW25hbWVdIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmVjb3JkQXR0YWNobWVudENvbmZpZ3VyYXRpb24+fSAtIEF0dGFjaG1lbnQgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgZ2V0QXR0YWNobWVudHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QXR0YWNobWVudHNNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYXR0YWNobWVudCBkZWZpbml0aW9ucyB0aHJvdWdoIHRoZSBtb2RlbCBjb250cmFjdCBzaGFyZWQgd2l0aFxuICAgKiBmcm9udGVuZCBtb2RlbCBjbGFzc2VzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmVjb3JkQXR0YWNobWVudENvbmZpZ3VyYXRpb24+fSAtIEF0dGFjaG1lbnQgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgYXR0YWNobWVudERlZmluaXRpb25zKCkge1xuICAgIHJldHVybiB0aGlzLmdldEF0dGFjaG1lbnRzTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50IGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHJldHVybnMge1JlY29yZEF0dGFjaG1lbnRDb25maWd1cmF0aW9ufSAtIEF0dGFjaG1lbnQgZGVmaW5pdGlvbi5cbiAgICovXG4gIHN0YXRpYyBnZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKSB7XG4gICAgY29uc3QgZGVmaW5pdGlvbiA9IHRoaXMuZ2V0QXR0YWNobWVudHNNYXAoKVthdHRhY2htZW50TmFtZV1cblxuICAgIGlmICghZGVmaW5pdGlvbikgdGhyb3cgbmV3IEVycm9yKGBObyBhdHRhY2htZW50IGluICR7dGhpcy5uYW1lfSBjYWxsZWQgXCIke2F0dGFjaG1lbnROYW1lfVwiIGluIGxpc3Q6ICR7T2JqZWN0LmtleXModGhpcy5nZXRBdHRhY2htZW50c01hcCgpKS5qb2luKFwiLCBcIil9YClcblxuICAgIHJldHVybiBkZWZpbml0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSByZWxhdGlvbnNoaXAgYnkgbmFtZS5cbiAgICovXG4gIGdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgaWYgKCEocmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpKSB7XG4gICAgICBjb25zdCBtb2RlbENsYXNzUmVsYXRpb25zaGlwID0gdGhpcy5nZXRNb2RlbENsYXNzKClcbiAgICAgICAgLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgICAucmVzb2x2ZUZvclJlY29yZCh0aGlzKVxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwVHlwZSA9IG1vZGVsQ2xhc3NSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpXG4gICAgICBsZXQgaW5zdGFuY2VSZWxhdGlvbnNoaXBcblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcFR5cGUgPT0gXCJiZWxvbmdzVG9cIikge1xuICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IG5ldyBCZWxvbmdzVG9JbnN0YW5jZVJlbGF0aW9uc2hpcCh7bW9kZWw6IHRoaXMsIHJlbGF0aW9uc2hpcDogbW9kZWxDbGFzc1JlbGF0aW9uc2hpcH0pXG4gICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uc2hpcFR5cGUgPT0gXCJoYXNNYW55XCIpIHtcbiAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSBuZXcgSGFzTWFueUluc3RhbmNlUmVsYXRpb25zaGlwKHttb2RlbDogdGhpcywgcmVsYXRpb25zaGlwOiBtb2RlbENsYXNzUmVsYXRpb25zaGlwfSlcbiAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25zaGlwVHlwZSA9PSBcImhhc09uZVwiKSB7XG4gICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwID0gbmV3IEhhc09uZUluc3RhbmNlUmVsYXRpb25zaGlwKHttb2RlbDogdGhpcywgcmVsYXRpb25zaGlwOiBtb2RlbENsYXNzUmVsYXRpb25zaGlwfSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biByZWxhdGlvbnNoaXAgdHlwZTogJHtyZWxhdGlvbnNoaXBUeXBlfWApXG4gICAgICB9XG5cbiAgICAgIHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXSA9IGluc3RhbmNlUmVsYXRpb25zaGlwXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFByZWxvYWRzIHJlbGF0aW9uc2hpcChzKSBvbnRvIHRoaXMgYWxyZWFkeS1sb2FkZWQgcmVjb3JkLiBBY2NlcHRzIGVpdGhlciBhXG4gICAqIHF1ZXJ5IGJ1aWx0IHZpYSBgTW9kZWwucHJlbG9hZCguLi4pLnNlbGVjdCguLi4pYCBvciBhIHJhdyBwcmVsb2FkIHNwZWNcbiAgICogKHN0cmluZyAvIGFycmF5IC8gbmVzdGVkIG9iamVjdCkuIEEgcmVsYXRpb25zaGlwIHRoYXQgaXMgYWxyZWFkeSBwcmVsb2FkZWRcbiAgICogd2l0aCBhbGwgdGhlIHJlcXVpcmVkIGNvbHVtbnMgcHJlc2VudCBpcyBsZWZ0IHVudG91Y2hlZCB1bmxlc3MgYGZvcmNlYCBpc1xuICAgKiBzZXQuIFByZWxvYWRpbmcgb250byB0aGUgcmVsYXRpb25zaGlwIGNhY2hlIGxldHMgbGF0ZXIgYWNjZXNzb3JzIHJldXNlIHRoZVxuICAgKiBsb2FkZWQgZGF0YSBpbnN0ZWFkIG9mIGlzc3VpbmcgaWRlbnRpY2FsIHF1ZXJpZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdCB8IGltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBzdHJpbmcgfCBBcnJheTxzdHJpbmcgfCBpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkPn0gcXVlcnlPclNwZWMgLSBQcmVsb2FkIHNvdXJjZS5cbiAgICogQHBhcmFtIHt7Zm9yY2U/OiBib29sZWFufX0gW29wdGlvbnNdIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwcmVsb2FkaW5nIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIHByZWxvYWQocXVlcnlPclNwZWMsIG9wdGlvbnMgPSB7fSkge1xuICAgIGF3YWl0IFByZWxvYWRlci5wcmVsb2FkKFt0aGlzXSwgcXVlcnlPclNwZWMsIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBhc3luYyBsb2FkUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgYXdhaXQgcmVsYXRpb25zaGlwLmxvYWQoKVxuXG4gICAgcmV0dXJuIHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsYXRpb25zaGlwIG9yIGxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7e3ByZWxvYWRUcmFuc2xhdGlvbnM/OiBib29sZWFufX0gW29wdGlvbnNdIC0gTG9hZCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIHJlbGF0aW9uc2hpcE9yTG9hZChyZWxhdGlvbnNoaXBOYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgIGxldCBsb2FkZWQgPSBhd2FpdCByZWxhdGlvbnNoaXAuYXV0b2xvYWRPckxvYWQoKVxuXG4gICAgaWYgKG9wdGlvbnMucHJlbG9hZFRyYW5zbGF0aW9ucykge1xuICAgICAgbG9hZGVkID0gYXdhaXQgdGhpcy5fcHJlbG9hZExvYWRlZFJlbGF0aW9uc2hpcFRyYW5zbGF0aW9ucyhsb2FkZWQpXG4gICAgfVxuXG4gICAgcmV0dXJuIGxvYWRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFByZWxvYWRzIHRyYW5zbGF0aW9ucyBvbiBhIGxvYWRlZCByZWxhdGlvbnNoaXAgdGFyZ2V0IHdoZW4gZXhwbGljaXRseSByZXF1ZXN0ZWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGxvYWRlZCAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZWxhdGlvbnNoaXAgdmFsdWUgYWZ0ZXIgdHJhbnNsYXRpb24gcHJlbG9hZC5cbiAgICovXG4gIGFzeW5jIF9wcmVsb2FkTG9hZGVkUmVsYXRpb25zaGlwVHJhbnNsYXRpb25zKGxvYWRlZCkge1xuICAgIGlmICghbG9hZGVkIHx8ICFsb2FkZWQuaXNQZXJzaXN0ZWQoKSB8fCAhYXdhaXQgbG9hZGVkLmdldE1vZGVsQ2xhc3MoKS5oYXNUcmFuc2xhdGlvbnNUYWJsZSgpKSByZXR1cm4gbG9hZGVkXG5cbiAgICBjb25zdCB0cmFuc2xhdGlvbnNSZWxhdGlvbnNoaXAgPSBsb2FkZWQuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKFwidHJhbnNsYXRpb25zXCIpXG5cbiAgICBpZiAodHJhbnNsYXRpb25zUmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSByZXR1cm4gbG9hZGVkXG5cbiAgICBhd2FpdCBsb2FkZWQucHJlbG9hZCh7dHJhbnNsYXRpb25zOiB7fX0pXG5cbiAgICByZXR1cm4gbG9hZGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0YWNobWVudCBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEByZXR1cm5zIHtSZWNvcmRBdHRhY2htZW50SGFuZGxlfSAtIEF0dGFjaG1lbnQgaGFuZGxlLlxuICAgKi9cbiAgZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSkge1xuICAgIGlmICghKGF0dGFjaG1lbnROYW1lIGluIHRoaXMuX2F0dGFjaG1lbnRzKSkge1xuICAgICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb24gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKVxuXG4gICAgICB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0gPSBuZXcgUmVjb3JkQXR0YWNobWVudEhhbmRsZSh7XG4gICAgICAgIG1vZGVsOiB0aGlzLFxuICAgICAgICBuYW1lOiBhdHRhY2htZW50TmFtZSxcbiAgICAgICAgdHlwZTogYXR0YWNobWVudERlZmluaXRpb24udHlwZVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogQWRkcyBhIGJlbG9uZ3MtdG8tcmVsYXRpb25zaGlwIHRvIHRoZSBtb2RlbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgVGhlIG5hbWUgb2YgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrIHwgb2JqZWN0fSBbc2NvcGVPck9wdGlvbnNdIFRoZSBzY29wZSBjYWxsYmFjayBvciBvcHRpb25zIGZvciB0aGUgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIFRoZSBvcHRpb25zIGZvciB0aGUgcmVsYXRpb25zaGlwLlxuICAgKi9cbiAgc3RhdGljIGJlbG9uZ3NUbyhyZWxhdGlvbnNoaXBOYW1lLCBzY29wZU9yT3B0aW9ucywgb3B0aW9ucykge1xuICAgIGNvbnN0IHtzY29wZSwgcmVsYXRpb25zaGlwT3B0aW9uc30gPSB0aGlzLl9ub3JtYWxpemVSZWxhdGlvbnNoaXBBcmdzKHNjb3BlT3JPcHRpb25zLCBvcHRpb25zKVxuXG4gICAgdGhpcy5fZGVmaW5lUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUsIE9iamVjdC5hc3NpZ24oe3R5cGU6IFwiYmVsb25nc1RvXCIsIHNjb3BlfSwgcmVsYXRpb25zaGlwT3B0aW9ucykpXG5cbiAgICBpZiAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlbGF0aW9uc2hpcE9wdGlvbnMpPy5jb3VudGVyQ2FjaGUpIHtcbiAgICAgIHRoaXMuX3JlZ2lzdGVyQ291bnRlckNhY2hlQ2FsbGJhY2tzKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVdIC0gV2hldGhlciB0ZW5hbnQtc3dpdGNoZWQgbW9kZWxzIG11c3QgcmVzb2x2ZSBhIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbm5lY3Rpb24uXG4gICAqL1xuICBzdGF0aWMgY29ubmVjdGlvbih7ZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGUgPSB0cnVlLCAuLi5yZXN0QXJnc30gPSB7fSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBjb25zdCBkYXRhYmFzZVBvb2wgPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGF0YWJhc2VQb29sKHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKHtlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZX0pKVxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBkYXRhYmFzZVBvb2wuZ2V0Q3VycmVudENvbm5lY3Rpb24oKVxuXG4gICAgaWYgKCFjb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb25uZWN0aW9uP1wiKVxuXG4gICAgcmV0dXJuIGNvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZS5cbiAgICogQHRlbXBsYXRlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IENyZWF0ZUF0dHJpYnV0ZXNcbiAgICogQHRlbXBsYXRlIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZDxDcmVhdGVBdHRyaWJ1dGVzPn0gTW9kZWxcbiAgICogQHRoaXMge3tuZXcgKGNoYW5nZXM/OiBDcmVhdGVBdHRyaWJ1dGVzKTogTW9kZWx9ICYgdHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfVxuICAgKiBAcGFyYW0ge0NyZWF0ZUF0dHJpYnV0ZXN9IFthdHRyaWJ1dGVzXSAtIEF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE1vZGVsPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjcmVhdGUuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY3JlYXRlKGF0dHJpYnV0ZXMpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7TW9kZWx9ICovIChuZXcgdGhpcyhhdHRyaWJ1dGVzKSlcblxuICAgIGF3YWl0IHJlY29yZC5zYXZlKClcblxuICAgIHJldHVybiByZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIF9nZXRDb25maWd1cmF0aW9uKCkge1xuICAgIGlmICghdGhpcy5fY29uZmlndXJhdGlvbikge1xuICAgICAgdGhpcy5fY29uZmlndXJhdGlvbiA9IENvbmZpZ3VyYXRpb24uY3VycmVudCgpXG5cbiAgICAgIGlmICghdGhpcy5fY29uZmlndXJhdGlvbikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uIGhhc24ndCBiZWVuIHNldCAobW9kZWwgY2xhc3MgcHJvYmFibHkgaGFzbid0IGJlZW4gaW5pdGlhbGl6ZWQpXCIpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2NvbmZpZ3VyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX2dldENvbmZpZ3VyYXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9nZXRDb25maWd1cmF0aW9uKClcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgaGFzLW1hbnktcmVsYXRpb25zaGlwIHRvIHRoZSBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgVGhlIG5hbWUgb2YgdGhlIHJlbGF0aW9uc2hpcCAoZS5nLiBcInBvc3RzXCIpXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwU2NvcGVDYWxsYmFjayB8IG9iamVjdH0gW3Njb3BlT3JPcHRpb25zXSBUaGUgc2NvcGUgY2FsbGJhY2sgb3Igb3B0aW9ucyBmb3IgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSBUaGUgb3B0aW9ucyBmb3IgdGhlIHJlbGF0aW9uc2hpcCAoZS5nLiB7Y2xhc3NOYW1lOiBcIlBvc3RcIn0pXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBoYXNNYW55KHJlbGF0aW9uc2hpcE5hbWUsIHNjb3BlT3JPcHRpb25zLCBvcHRpb25zKSB7XG4gICAgY29uc3Qge3Njb3BlLCByZWxhdGlvbnNoaXBPcHRpb25zfSA9IHRoaXMuX25vcm1hbGl6ZVJlbGF0aW9uc2hpcEFyZ3Moc2NvcGVPck9wdGlvbnMsIG9wdGlvbnMpXG5cbiAgICByZXR1cm4gdGhpcy5fZGVmaW5lUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUsIE9iamVjdC5hc3NpZ24oe3R5cGU6IFwiaGFzTWFueVwiLCBzY29wZX0sIHJlbGF0aW9uc2hpcE9wdGlvbnMpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJhaWxzLXN0eWxlIGRlY2xhcmF0aW9uIHRoYXQgdGhpcyBtb2RlbCBhY2NlcHRzIG5lc3RlZC1hdHRyaWJ1dGUgd3JpdGVzXG4gICAqIGZvciBhIHJlbGF0aW9uc2hpcCB3aGVuIHNhdmVkIHRocm91Z2ggYSBwYXJlbnQuIFJlcXVpcmVkIOKAlCBWZWxvY2lvdXNcbiAgICogd2lsbCByZWZ1c2UgbmVzdGVkIHdyaXRlcyBmb3IgYW55IHJlbGF0aW9uc2hpcCBub3QgbGlzdGVkIGhlcmUsIGV2ZW5cbiAgICogaWYgYSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBwZXJtaXRzIHRoZW0uXG4gICAqXG4gICAqIE9wdGlvbnM6XG4gICAqICAgLSBhbGxvd0Rlc3Ryb3k6IHdoZXRoZXIgYF9kZXN0cm95OiB0cnVlYCBlbnRyaWVzIGFyZSBhbGxvd2VkLiBEZWZhdWx0IGZhbHNlLlxuICAgKiAgIC0gbGltaXQ6IG9wdGlvbmFsIHVwcGVyIGJvdW5kIG9uIHRoZSBudW1iZXIgb2YgbmVzdGVkIGVudHJpZXMgcGVyIHJlcXVlc3QuXG4gICAqICAgLSByZWplY3RJZjogb3B0aW9uYWwgcHJlZGljYXRlIGAoYXR0cmlidXRlcykgPT4gYm9vbGVhbmAgdGhhdCBzaWxlbnRseSBza2lwcyBlbnRyaWVzLlxuICAgKlxuICAgKiBVc2FnZTpcbiAgICogICBjbGFzcyBQcm9qZWN0IGV4dGVuZHMgUmVjb3JkIHt9XG4gICAqICAgUHJvamVjdC5oYXNNYW55KFwidGFza3NcIilcbiAgICogICBQcm9qZWN0LmFjY2VwdHNOZXN0ZWRBdHRyaWJ1dGVzRm9yKFwidGFza3NcIiwge2FsbG93RGVzdHJveTogdHJ1ZX0pXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUgb24gdGhpcyBtb2RlbC5cbiAgICogQHBhcmFtIHt7YWxsb3dEZXN0cm95PzogYm9vbGVhbiwgbGltaXQ/OiBudW1iZXIsIHJlamVjdElmPzogKGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gYm9vbGVhbn19IFtvcHRpb25zXSAtIFBvbGljeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcihyZWxhdGlvbnNoaXBOYW1lLCBvcHRpb25zID0ge30pIHtcbiAgICBpZiAoIXJlbGF0aW9uc2hpcE5hbWUgfHwgdHlwZW9mIHJlbGF0aW9uc2hpcE5hbWUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWxhdGlvbnNoaXBOYW1lIHBhc3NlZCB0byBhY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcjogJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwodGhpcywgXCJfYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzXCIpKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7YWxsb3dEZXN0cm95PzogYm9vbGVhbiwgbGltaXQ/OiBudW1iZXIsIHJlamVjdElmPzogKGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gYm9vbGVhbn0+fSAqL1xuICAgICAgdGhpcy5fYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHthbGxvd0Rlc3Ryb3k/OiBib29sZWFuLCBsaW1pdD86IG51bWJlciwgcmVqZWN0SWY/OiAoYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBib29sZWFufT59ICovICh0aGlzLl9hY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXMpW3JlbGF0aW9uc2hpcE5hbWVdID0gey4uLm9wdGlvbnN9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY2NlcHRlZCBuZXN0ZWQgYXR0cmlidXRlcyBmb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHt7YWxsb3dEZXN0cm95PzogYm9vbGVhbiwgbGltaXQ/OiBudW1iZXIsIHJlamVjdElmPzogKGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gYm9vbGVhbn0gfCBudWxsfSAtIFBvbGljeSBkZWNsYXJlZCB2aWEgYGFjY2VwdHNOZXN0ZWRBdHRyaWJ1dGVzRm9yYCwgb3IgbnVsbCB3aGVuIG5vdCBhY2NlcHRlZC5cbiAgICovXG4gIHN0YXRpYyBhY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXNGb3IocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIHJldHVybiB0aGlzLl9hY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXM/LltyZWxhdGlvbnNoaXBOYW1lXSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogQWRkcyBhIGhhcy1vbmUtcmVsYXRpb25zaGlwIHRvIHRoZSBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgVGhlIG5hbWUgb2YgdGhlIHJlbGF0aW9uc2hpcCAoZS5nLiBcInBvc3RcIilcbiAgICogQHBhcmFtIHtSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrIHwgb2JqZWN0fSBbc2NvcGVPck9wdGlvbnNdIFRoZSBzY29wZSBjYWxsYmFjayBvciBvcHRpb25zIGZvciB0aGUgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIFRoZSBvcHRpb25zIGZvciB0aGUgcmVsYXRpb25zaGlwIChlLmcuIHtjbGFzc05hbWU6IFwiUG9zdFwifSlcbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGhhc09uZShyZWxhdGlvbnNoaXBOYW1lLCBzY29wZU9yT3B0aW9ucywgb3B0aW9ucykge1xuICAgIGNvbnN0IHtzY29wZSwgcmVsYXRpb25zaGlwT3B0aW9uc30gPSB0aGlzLl9ub3JtYWxpemVSZWxhdGlvbnNoaXBBcmdzKHNjb3BlT3JPcHRpb25zLCBvcHRpb25zKVxuXG4gICAgcmV0dXJuIHRoaXMuX2RlZmluZVJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lLCBPYmplY3QuYXNzaWduKHt0eXBlOiBcImhhc09uZVwiLCBzY29wZX0sIHJlbGF0aW9uc2hpcE9wdGlvbnMpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmaW5lIGF0dGFjaG1lbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBdHRhY2htZW50IGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5kcml2ZXJdIC0gQXR0YWNobWVudCBkcml2ZXIgbmFtZSwgY2xhc3MsIG9yIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0F0dGFjaG1lbnRTeW5jQ29uZmlndXJhdGlvbn0gW2FyZ3Muc3luY10gLSBDbGllbnQtc2FmZSBzeW5jaHJvbml6ZWQgYXNzZXQgcG9saWN5LlxuICAgKiBAcGFyYW0ge1wiaGFzT25lXCIgfCBcImhhc01hbnlcIn0gYXJncy50eXBlIC0gQXR0YWNobWVudCB0eXBlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgX2RlZmluZUF0dGFjaG1lbnQoYXR0YWNobWVudE5hbWUsIHtkcml2ZXIsIHN5bmMsIHR5cGV9KSB7XG4gICAgaWYgKCFhdHRhY2htZW50TmFtZSB8fCB0eXBlb2YgYXR0YWNobWVudE5hbWUgIT09IFwic3RyaW5nXCIpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBhdHRhY2htZW50IG5hbWU6ICR7YXR0YWNobWVudE5hbWV9YClcbiAgICBpZiAoYXR0YWNobWVudE5hbWUgaW4gdGhpcy5nZXRBdHRhY2htZW50c01hcCgpKSB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgJHthdHRhY2htZW50TmFtZX0gYWxyZWFkeSBleGlzdHNgKVxuXG4gICAgaWYgKHN5bmMpIHtcbiAgICAgIGNvbnN0IHtmZXRjaCwgb2ZmbGluZVJlcXVpcmVtZW50LCByZXRlbnRpb24sIC4uLnJlc3RTeW5jfSA9IHN5bmNcblxuICAgICAgcmVzdEFyZ3NFcnJvcihyZXN0U3luYylcblxuICAgICAgaWYgKGZldGNoICE9PSBcImVhZ2VyXCIgJiYgZmV0Y2ggIT09IFwib24tZGVtYW5kXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50ICR7YXR0YWNobWVudE5hbWV9IHN5bmMgZmV0Y2ggbXVzdCBiZSBlYWdlciBvciBvbi1kZW1hbmRgKVxuICAgICAgfVxuICAgICAgaWYgKG9mZmxpbmVSZXF1aXJlbWVudCAhPT0gXCJvcHRpb25hbFwiICYmIG9mZmxpbmVSZXF1aXJlbWVudCAhPT0gXCJyZXF1aXJlZFwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCAke2F0dGFjaG1lbnROYW1lfSBvZmZsaW5lIHJlcXVpcmVtZW50IG11c3QgYmUgb3B0aW9uYWwgb3IgcmVxdWlyZWRgKVxuICAgICAgfVxuICAgICAgaWYgKHJldGVudGlvbiAhPT0gXCJkdXJhYmxlXCIgJiYgcmV0ZW50aW9uICE9PSBcImV2aWN0YWJsZVwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCAke2F0dGFjaG1lbnROYW1lfSBzeW5jIHJldGVudGlvbiBtdXN0IGJlIGR1cmFibGUgb3IgZXZpY3RhYmxlYClcbiAgICAgIH1cbiAgICAgIGlmIChvZmZsaW5lUmVxdWlyZW1lbnQgPT09IFwicmVxdWlyZWRcIiAmJiByZXRlbnRpb24gIT09IFwiZHVyYWJsZVwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCAke2F0dGFjaG1lbnROYW1lfSByZXF1aXJlZCBvZmZsaW5lIGFzc2V0cyBtdXN0IHVzZSBkdXJhYmxlIHJldGVudGlvbmApXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5nZXRBdHRhY2htZW50c01hcCgpW2F0dGFjaG1lbnROYW1lXSA9IHtkcml2ZXIsIHN5bmMsIHR5cGV9XG5cbiAgICBjb25zdCBwcm90b3R5cGUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzLnByb3RvdHlwZSkpXG5cbiAgICBwcm90b3R5cGVbYXR0YWNobWVudE5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKVxuICAgIH1cblxuICAgICAgcHJvdG90eXBlW2BzZXQke2luZmxlY3Rpb24uY2FtZWxpemUoYXR0YWNobWVudE5hbWUpfWBdID0gZnVuY3Rpb24oLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gbmV3VmFsdWUpIHtcbiAgICAgIHRoaXMuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSkucXVldWVBdHRhY2gobmV3VmFsdWUpXG4gICAgICByZXR1cm4gbmV3VmFsdWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWRkcyBhIHNpbmdsZSBhdHRhY2htZW50IGhlbHBlciB0byB0aGUgbW9kZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHt7ZHJpdmVyPzogc3RyaW5nIHwgQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzeW5jPzogQXR0YWNobWVudFN5bmNDb25maWd1cmF0aW9ufX0gW2FyZ3NdIC0gQXR0YWNobWVudCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgaGFzT25lQXR0YWNobWVudChhdHRhY2htZW50TmFtZSwgYXJncyA9IHt9KSB7XG4gICAgdGhpcy5fZGVmaW5lQXR0YWNobWVudChhdHRhY2htZW50TmFtZSwge2RyaXZlcjogYXJncy5kcml2ZXIsIHN5bmM6IGFyZ3Muc3luYywgdHlwZTogXCJoYXNPbmVcIn0pXG4gIH1cblxuICAvKipcbiAgICogQWRkcyBhIGNvbGxlY3Rpb24gYXR0YWNobWVudCBoZWxwZXIgdG8gdGhlIG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7e2RyaXZlcj86IHN0cmluZyB8IEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc3luYz86IEF0dGFjaG1lbnRTeW5jQ29uZmlndXJhdGlvbn19IFthcmdzXSAtIEF0dGFjaG1lbnQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGhhc01hbnlBdHRhY2htZW50cyhhdHRhY2htZW50TmFtZSwgYXJncyA9IHt9KSB7XG4gICAgdGhpcy5fZGVmaW5lQXR0YWNobWVudChhdHRhY2htZW50TmFtZSwge2RyaXZlcjogYXJncy5kcml2ZXIsIHN5bmM6IGFyZ3Muc3luYywgdHlwZTogXCJoYXNNYW55XCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaHVtYW4gYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGh1bWFuIGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGh1bWFuQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKSB7XG4gICAgY29uc3QgbW9kZWxOYW1lS2V5ID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKHRoaXMuZ2V0TW9kZWxOYW1lKCkpXG5cbiAgICByZXR1cm4gdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldFRyYW5zbGF0b3IoKShgdmVsb2Npb3VzLmRhdGFiYXNlLnJlY29yZC5hdHRyaWJ1dGVzLiR7bW9kZWxOYW1lS2V5fS4ke2F0dHJpYnV0ZU5hbWV9YCwge2RlZmF1bHRWYWx1ZTogaW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRyaWJ1dGVOYW1lKX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZGF0YWJhc2UgdHlwZS5cbiAgICovXG4gIHN0YXRpYyBnZXREYXRhYmFzZVR5cGUoKSB7XG4gICAgaWYgKCF0aGlzLl9kYXRhYmFzZVR5cGUpIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlIHR5cGUgaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fZGF0YWJhc2VUeXBlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgZWFnZXIgbG9hZCByZWNvcmQgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gZWFnZXJMb2FkUmVjb3JkTWV0YWRhdGEgLSBXaGV0aGVyIHJlcXVpcmUtY29udGV4dCBpbml0aWFsaXphdGlvbiBzaG91bGQgbG9hZCB0YWJsZSBtZXRhZGF0YSBmb3IgdGhpcyBtb2RlbC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHNldEVhZ2VyTG9hZFJlY29yZE1ldGFkYXRhKGVhZ2VyTG9hZFJlY29yZE1ldGFkYXRhKSB7XG4gICAgdGhpcy5fZWFnZXJMb2FkUmVjb3JkTWV0YWRhdGEgPSBlYWdlckxvYWRSZWNvcmRNZXRhZGF0YVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVhZ2VyIGxvYWQgcmVjb3JkIG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlcXVpcmUtY29udGV4dCBpbml0aWFsaXphdGlvbiBzaG91bGQgbG9hZCB0YWJsZSBtZXRhZGF0YSBmb3IgdGhpcyBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBnZXRFYWdlckxvYWRSZWNvcmRNZXRhZGF0YSgpIHtcbiAgICBpZiAodGhpcy5fZWFnZXJMb2FkUmVjb3JkTWV0YWRhdGEgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB0aGlzLl9lYWdlckxvYWRSZWNvcmRNZXRhZGF0YVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzZXQgcmVjb3JkIG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgcmVzZXRSZWNvcmRNZXRhZGF0YSgpIHtcbiAgICB0aGlzLl9pbml0aWFsaXplZCA9IGZhbHNlXG4gICAgdGhpcy5faW5pdGlhbGl6ZVJlY29yZFByb21pc2UgPSBudWxsXG4gICAgdGhpcy5fZGF0YWJhc2VUeXBlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fdGFibGUgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9jb2x1bW5zID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fY29sdW1uc0FzSGFzaCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2NvbHVtbk5hbWVzID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fY29sdW1uVHlwZUJ5TmFtZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9jb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lID0gdW5kZWZpbmVkXG5cbiAgICBpZiAoIXRoaXMuX3JlY29yZE1ldGFkYXRhTW9kZWxDbGFzcykgdGhpcy5jbGVhclJlY29yZE1ldGFkYXRhVmFsdWVzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGF0aWMgZmllbGRzIHRoYXQgYmVsb25nIHRvIG9uZSBwaHlzaWNhbCBkYXRhYmFzZS9zY2hlbWEgZ2VuZXJhdGlvbi5cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIE1ldGFkYXRhIHByb3BlcnR5IG5hbWVzLlxuICAgKi9cbiAgc3RhdGljIHJlY29yZE1ldGFkYXRhUHJvcGVydHlOYW1lcygpIHtcbiAgICByZXR1cm4gcmVjb3JkTWV0YWRhdGFQcm9wZXJ0eU5hbWVzXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgb25lIG9wZXJhdGlvbi1ib3VuZCBtZXRhZGF0YSBmaWVsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGFkYXRhS2V5IC0gUGh5c2ljYWwgZGF0YWJhc2UgYW5kIHNjaGVtYSBnZW5lcmF0aW9uIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3BlcnR5IC0gU3RhdGljIG1ldGFkYXRhIHByb3BlcnR5LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkTWV0YWRhdGFWYWx1ZX0gLSBTdG9yZWQgbWV0YWRhdGEgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgcmVjb3JkTWV0YWRhdGFWYWx1ZShtZXRhZGF0YUtleSwgcHJvcGVydHkpIHtcbiAgICByZXR1cm4gcmVjb3JkTWV0YWRhdGFWYWx1ZXNGb3IodGhpcykuZ2V0KG1ldGFkYXRhS2V5KT8uZ2V0KHByb3BlcnR5KVxuICB9XG5cbiAgLyoqXG4gICAqIFdyaXRlcyBvbmUgb3BlcmF0aW9uLWJvdW5kIG1ldGFkYXRhIGZpZWxkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0YWRhdGFLZXkgLSBQaHlzaWNhbCBkYXRhYmFzZSBhbmQgc2NoZW1hIGdlbmVyYXRpb24ga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcHJvcGVydHkgLSBTdGF0aWMgbWV0YWRhdGEgcHJvcGVydHkuXG4gICAqIEBwYXJhbSB7UmVjb3JkTWV0YWRhdGFWYWx1ZX0gdmFsdWUgLSBNZXRhZGF0YSB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgc2V0UmVjb3JkTWV0YWRhdGFWYWx1ZShtZXRhZGF0YUtleSwgcHJvcGVydHksIHZhbHVlKSB7XG4gICAgbGV0IHZhbHVlcyA9IHJlY29yZE1ldGFkYXRhVmFsdWVzRm9yKHRoaXMpLmdldChtZXRhZGF0YUtleSlcblxuICAgIGlmICghdmFsdWVzKSB7XG4gICAgICB2YWx1ZXMgPSBuZXcgTWFwKClcbiAgICAgIHJlY29yZE1ldGFkYXRhVmFsdWVzRm9yKHRoaXMpLnNldChtZXRhZGF0YUtleSwgdmFsdWVzKVxuICAgIH1cblxuICAgIHZhbHVlcy5zZXQocHJvcGVydHksIHZhbHVlKVxuICB9XG5cbiAgLyoqIENsZWFycyBldmVyeSB0ZW5hbnQvZ2VuZXJhdGlvbiBtZXRhZGF0YSBzbmFwc2hvdCBmb3IgdGhpcyBtb2RlbC4gKi9cbiAgc3RhdGljIGNsZWFyUmVjb3JkTWV0YWRhdGFWYWx1ZXMoKSB7XG4gICAgcmVjb3JkTWV0YWRhdGFWYWx1ZXNCeU1vZGVsLmRlbGV0ZSh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBzbmFwc2hvdHMgd2hvc2Uga2V5IGJlbG9uZ3MgdG8gb25lIHBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGl0eSAtIExvZ2ljYWwgaWRlbnRpZmllciBwbHVzIHBvb2wgcmV1c2Uga2V5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBjbGVhclJlY29yZE1ldGFkYXRhVmFsdWVzRm9yRGF0YWJhc2VJZGVudGl0eShkYXRhYmFzZUlkZW50aXR5KSB7XG4gICAgY29uc3QgdmFsdWVzID0gcmVjb3JkTWV0YWRhdGFWYWx1ZXNCeU1vZGVsLmdldCh0aGlzKVxuXG4gICAgaWYgKCF2YWx1ZXMpIHJldHVyblxuXG4gICAgY29uc3QgbWV0YWRhdGFQcmVmaXggPSBgJHtkYXRhYmFzZUlkZW50aXR5Lmxlbmd0aH06JHtkYXRhYmFzZUlkZW50aXR5fTpgXG5cbiAgICBmb3IgKGNvbnN0IG1ldGFkYXRhS2V5IG9mIHZhbHVlcy5rZXlzKCkpIHtcbiAgICAgIGlmIChtZXRhZGF0YUtleS5zdGFydHNXaXRoKG1ldGFkYXRhUHJlZml4KSkgdmFsdWVzLmRlbGV0ZShtZXRhZGF0YUtleSlcbiAgICB9XG5cbiAgICBpZiAodmFsdWVzLnNpemUgPT09IDApIHJlY29yZE1ldGFkYXRhVmFsdWVzQnlNb2RlbC5kZWxldGUodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgdGhlIG1vZGVsIGNsYXNzIHdpdGggYSBjb25maWd1cmF0aW9uIHdpdGhvdXQgbG9hZGluZyB0YWJsZSBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyByZWdpc3RlclJlY29yZENsYXNzKHtjb25maWd1cmF0aW9uLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbmZpZ3VyYXRpb24gZ2l2ZW4gZm9yICR7dGhpcy5uYW1lfWApXG5cbiAgICB0aGlzLnJlc2V0UmVjb3JkTWV0YWRhdGEoKVxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLl9yZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MgfHwgdGhpc1xuXG4gICAgbW9kZWxDbGFzcy5fY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICBjb25maWd1cmF0aW9uLnJlZ2lzdGVyTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZSByZWNvcmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25uZWN0aW9uXSAtIEV4cGxpY2l0IG1ldGFkYXRhIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgaW5pdGlhbGl6ZVJlY29yZCh7Y29uZmlndXJhdGlvbiwgY29ubmVjdGlvbjogZXhwbGljaXRDb25uZWN0aW9uLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbmZpZ3VyYXRpb24gZ2l2ZW4gZm9yICR7dGhpcy5uYW1lfWApXG5cbiAgICB0aGlzLnJlZ2lzdGVyUmVjb3JkQ2xhc3Moe2NvbmZpZ3VyYXRpb259KVxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBleHBsaWNpdENvbm5lY3Rpb24gfHwgdGhpcy5jb25uZWN0aW9uKHtlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZTogZmFsc2V9KVxuXG4gICAgdGhpcy5fZGF0YWJhc2VUeXBlID0gY29ubmVjdGlvbi5nZXRUeXBlKClcblxuICAgIHRoaXMuX3RhYmxlID0gYXdhaXQgY29ubmVjdGlvbi5nZXRUYWJsZUJ5TmFtZSh0aGlzLnRhYmxlTmFtZSgpKVxuICAgIHRoaXMuX2NvbHVtbnMgPSBhd2FpdCB0aGlzLl9nZXRUYWJsZSgpLmdldENvbHVtbnMoKVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIHRoaXMuX2NvbHVtbnNBc0hhc2ggPSB7fVxuXG4gICAgY29uc3QgY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSA9IHRoaXMuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZSA9IHRoaXMuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG4gICAgY29uc3QgcHJvdG90eXBlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcy5wcm90b3R5cGUpKVxuXG4gICAgZm9yIChjb25zdCBjb2x1bW4gb2YgdGhpcy5fY29sdW1ucykge1xuICAgICAgdGhpcy5fY29sdW1uc0FzSGFzaFtjb2x1bW4uZ2V0TmFtZSgpXSA9IGNvbHVtblxuXG4gICAgICBjb25zdCBkZWJ1cnJlZENvbHVtbk5hbWUgPSBkZWJ1cnJDb2x1bW5OYW1lKGNvbHVtbi5nZXROYW1lKCkpXG4gICAgICBjb25zdCBjYW1lbGl6ZWRDb2x1bW5OYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShkZWJ1cnJlZENvbHVtbk5hbWUsIHRydWUpXG4gICAgICBjb25zdCBjYW1lbGl6ZWRDb2x1bW5OYW1lQmlnRmlyc3QgPSBpbmZsZWN0aW9uLmNhbWVsaXplKGRlYnVycmVkQ29sdW1uTmFtZSlcblxuICAgICAgYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZVtjYW1lbGl6ZWRDb2x1bW5OYW1lXSA9IGNvbHVtbi5nZXROYW1lKClcbiAgICAgIGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVbY29sdW1uLmdldE5hbWUoKV0gPSBjYW1lbGl6ZWRDb2x1bW5OYW1lXG5cbiAgICAgIGlmICghKGNhbWVsaXplZENvbHVtbk5hbWUgaW4gcHJvdG90eXBlKSkge1xuICAgICAgICBwcm90b3R5cGVbY2FtZWxpemVkQ29sdW1uTmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKGNhbWVsaXplZENvbHVtbk5hbWUpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKCEoYHNldCR7Y2FtZWxpemVkQ29sdW1uTmFtZUJpZ0ZpcnN0fWAgaW4gcHJvdG90eXBlKSkge1xuICAgICAgICBwcm90b3R5cGVbYHNldCR7Y2FtZWxpemVkQ29sdW1uTmFtZUJpZ0ZpcnN0fWBdID0gZnVuY3Rpb24oLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gbmV3VmFsdWUpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5fc2V0Q29sdW1uQXR0cmlidXRlKGNhbWVsaXplZENvbHVtbk5hbWUsIG5ld1ZhbHVlKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICghKGBoYXMke2NhbWVsaXplZENvbHVtbk5hbWVCaWdGaXJzdH1gIGluIHByb3RvdHlwZSkpIHtcbiAgICAgICAgcHJvdG90eXBlW2BoYXMke2NhbWVsaXplZENvbHVtbk5hbWVCaWdGaXJzdH1gXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNvbnN0IGR5bmFtaWNUaGlzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBkeW5hbWljVGhpc1tjYW1lbGl6ZWRDb2x1bW5OYW1lXSgpXG5cbiAgICAgICAgICByZXR1cm4gdGhpcy5faGFzQXR0cmlidXRlKHZhbHVlKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fZGVmaW5lVHJhbnNsYXRpb25NZXRob2RzKGNvbm5lY3Rpb24pXG4gICAgYXdhaXQgaW5pdGlhbGl6ZUF1ZGl0aW5nKHRoaXMpXG4gICAgdGhpcy5faW5pdGlhbGl6ZWQgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZXMgdGhlIG1vZGVsIGNsYXNzIHRoZSBmaXJzdCB0aW1lIGFuIGFzeW5jIHJlY29yZCBBUEkgbmVlZHMgdGFibGVcbiAgICogbWV0YWRhdGEuIENvbmN1cnJlbnQgY2FsbGVycyBzaGFyZSB0aGUgc2FtZSBpbml0aWFsaXphdGlvbiBwcm9taXNlLCBhbmQgYVxuICAgKiBmYWlsZWQgaW5pdGlhbGl6YXRpb24gY2FuIGJlIHJldHJpZWQgYnkgYSBsYXRlciBjYWxsLlxuICAgKiBAcGFyYW0ge3tjb25maWd1cmF0aW9uPzogaW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBjb25uZWN0aW9uPzogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9fSBbYXJnc10gLSBPcHRpb25hbCBjb25maWd1cmF0aW9uIGFuZCBleHBsaWNpdCBtZXRhZGF0YSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBtb2RlbCBjbGFzcyBpcyBpbml0aWFsaXplZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBlbnN1cmVJbml0aWFsaXplZChhcmdzID0ge30pIHtcbiAgICBjb25zdCB7Y29uZmlndXJhdGlvbiwgY29ubmVjdGlvbiwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplZCkgcmV0dXJuXG5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVJlY29yZFByb21pc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZENvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uIHx8IHRoaXMuX2NvbmZpZ3VyYXRpb24gfHwgQ29uZmlndXJhdGlvbi5jdXJyZW50KClcblxuICAgIGNvbnN0IGluaXRpYWxpemVSZWNvcmRQcm9taXNlID0gdGhpcy5pbml0aWFsaXplUmVjb3JkKHtjb25maWd1cmF0aW9uOiByZXNvbHZlZENvbmZpZ3VyYXRpb24sIGNvbm5lY3Rpb259KVxuXG4gICAgdGhpcy5faW5pdGlhbGl6ZVJlY29yZFByb21pc2UgPSBpbml0aWFsaXplUmVjb3JkUHJvbWlzZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGluaXRpYWxpemVSZWNvcmRQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplUmVjb3JkUHJvbWlzZSA9PT0gaW5pdGlhbGl6ZVJlY29yZFByb21pc2UpIHtcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVJlY29yZFByb21pc2UgPSBudWxsXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYXR0cmlidXRlLlxuICAgKi9cbiAgX2hhc0F0dHJpYnV0ZSh2YWx1ZSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT0gXCJzdHJpbmdcIikge1xuICAgICAgdmFsdWUgPSB2YWx1ZS50cmltKClcbiAgICB9XG5cbiAgICBpZiAodmFsdWUpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBpbml0aWFsaXplZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBpbml0aWFsaXplZC5cbiAgICovXG4gIHN0YXRpYyBpc0luaXRpYWxpemVkKCkge1xuICAgIGlmICh0aGlzLl9pbml0aWFsaXplZCkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXNzZXJ0IGhhcyBiZWVuIGluaXRpYWxpemVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpIHtcbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZWQpIHJldHVyblxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubmFtZX0gdXNlZCBiZWZvcmUgaW5pdGlhbGl6YXRpb24uIENhbGwgJHt0aGlzLm5hbWV9LmluaXRpYWxpemVSZWNvcmQoLi4uKSBvciBjb25maWd1cmF0aW9uLmluaXRpYWxpemUoKS5gKVxuICB9XG5cbiAgLyoqXG4gICAqIERlZmluZXMgdHJhbnNsYXRpb24gYWNjZXNzb3JzIGFuZCBpbml0aWFsaXplcyB0aGUgZ2VuZXJhdGVkIHRyYW5zbGF0aW9uXG4gICAqIGNsYXNzIHRocm91Z2ggdGhlIHNhbWUgbWV0YWRhdGEgY29ubmVjdGlvbiBhcyB0aGUgdHJhbnNsYXRlZCBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIE1ldGFkYXRhIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdHJhbnNsYXRpb24gbWV0YWRhdGEgaXMgcmVhZHkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgX2RlZmluZVRyYW5zbGF0aW9uTWV0aG9kcyhjb25uZWN0aW9uKSB7XG4gICAgaWYgKHRoaXMuX3RyYW5zbGF0aW9ucyAmJiBPYmplY3Qua2V5cyh0aGlzLl90cmFuc2xhdGlvbnMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGxvY2FsZXMgPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0TG9jYWxlcygpXG5cbiAgICAgIGlmICghbG9jYWxlcykgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWxlcyBoYXNuJ3QgYmVlbiBzZXQgaW4gdGhlIGNvbmZpZ3VyYXRpb25cIilcblxuICAgICAgY29uc3QgVHJhbnNsYXRpb25DbGFzcyA9IHRoaXMuZ2V0VHJhbnNsYXRpb25DbGFzcygpXG4gICAgICBjb25zdCBCb3VuZFRyYW5zbGF0aW9uQ2xhc3MgPSB0aGlzLl9yZWNvcmRNZXRhZGF0YUJpbmRlciA/IHRoaXMuX3JlY29yZE1ldGFkYXRhQmluZGVyKFRyYW5zbGF0aW9uQ2xhc3MpIDogVHJhbnNsYXRpb25DbGFzc1xuXG4gICAgICBhd2FpdCBCb3VuZFRyYW5zbGF0aW9uQ2xhc3MuaW5pdGlhbGl6ZVJlY29yZCh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgY29ubmVjdGlvblxuICAgICAgfSlcblxuICAgICAgZm9yIChjb25zdCBuYW1lIGluIHRoaXMuX3RyYW5zbGF0aW9ucykge1xuICAgICAgICBjb25zdCBuYW1lQ2FtZWxpemVkID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShuYW1lKVxuICAgICAgICBjb25zdCBzZXR0ZXJNZXRob2ROYW1lID0gYHNldCR7bmFtZUNhbWVsaXplZH1gXG4gICAgICAgIGNvbnN0IHByb3RvdHlwZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMucHJvdG90eXBlKSlcblxuICAgICAgICBwcm90b3R5cGVbbmFtZV0gPSBmdW5jdGlvbiBnZXRUcmFuc2xhdGVkQXR0cmlidXRlKCkge1xuICAgICAgICAgIGNvbnN0IGxvY2FsZSA9IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRMb2NhbGUoKVxuXG4gICAgICAgICAgcmV0dXJuIHRoaXMuX2dldFRyYW5zbGF0ZWRBdHRyaWJ1dGVXaXRoRmFsbGJhY2sobmFtZSwgbG9jYWxlKVxuICAgICAgICB9XG5cbiAgICAgICAgcHJvdG90eXBlW2BoYXMke25hbWVDYW1lbGl6ZWR9YF0gPSBmdW5jdGlvbiBoYXNUcmFuc2xhdGVkQXR0cmlidXRlKCkge1xuICAgICAgICAgIGNvbnN0IGR5bmFtaWNUaGlzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG4gICAgICAgICAgY29uc3QgY2FuZGlkYXRlID0gZHluYW1pY1RoaXNbbmFtZV1cblxuICAgICAgICAgIGlmICh0eXBlb2YgY2FuZGlkYXRlID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBjYW5kaWRhdGUuYmluZCh0aGlzKSgpXG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9oYXNBdHRyaWJ1dGUodmFsdWUpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgY2FuZGlkYXRlIHRvIGJlIGEgZnVuY3Rpb24gYnV0IGl0IHdhczogJHt0eXBlb2YgY2FuZGlkYXRlfWApXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcHJvdG90eXBlW3NldHRlck1ldGhvZE5hbWVdID0gZnVuY3Rpb24gc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZSgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBuZXdWYWx1ZSkge1xuICAgICAgICAgIGNvbnN0IGxvY2FsZSA9IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRMb2NhbGUoKVxuXG4gICAgICAgICAgcmV0dXJuIHRoaXMuX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGUobmFtZSwgbG9jYWxlLCBuZXdWYWx1ZSlcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3QgbG9jYWxlIG9mIGxvY2FsZXMpIHtcbiAgICAgICAgICBjb25zdCBsb2NhbGVDYW1lbGl6ZWQgPSBpbmZsZWN0aW9uLmNhbWVsaXplKGxvY2FsZSlcbiAgICAgICAgICBjb25zdCBnZXR0ZXJNZXRob2ROYW1lTG9jYWxpemVkID0gYCR7bmFtZX0ke2xvY2FsZUNhbWVsaXplZH1gXG4gICAgICAgICAgY29uc3Qgc2V0dGVyTWV0aG9kTmFtZUxvY2FsaXplZCA9IGAke3NldHRlck1ldGhvZE5hbWV9JHtsb2NhbGVDYW1lbGl6ZWR9YFxuICAgICAgICAgIGNvbnN0IGhhc01ldGhvZE5hbWVMb2NhbGl6ZWQgPSBgaGFzJHtpbmZsZWN0aW9uLmNhbWVsaXplKG5hbWUpfSR7bG9jYWxlQ2FtZWxpemVkfWBcblxuICAgICAgICAgIHByb3RvdHlwZVtnZXR0ZXJNZXRob2ROYW1lTG9jYWxpemVkXSA9IGZ1bmN0aW9uIGdldFRyYW5zbGF0ZWRBdHRyaWJ1dGVXaXRoTG9jYWxlKCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2dldFRyYW5zbGF0ZWRBdHRyaWJ1dGUobmFtZSwgbG9jYWxlKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHByb3RvdHlwZVtzZXR0ZXJNZXRob2ROYW1lTG9jYWxpemVkXSA9IGZ1bmN0aW9uIHNldFRyYW5zbGF0ZWRBdHRyaWJ1dGVXaXRoTG9jYWxlKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIG5ld1ZhbHVlKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZShuYW1lLCBsb2NhbGUsIG5ld1ZhbHVlKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHByb3RvdHlwZVtoYXNNZXRob2ROYW1lTG9jYWxpemVkXSA9IGZ1bmN0aW9uIGhhc1RyYW5zbGF0ZWRBdHRyaWJ1dGUoKSB7XG4gICAgICAgICAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuICAgICAgICAgICAgY29uc3QgY2FuZGlkYXRlID0gZHluYW1pY1RoaXNbZ2V0dGVyTWV0aG9kTmFtZUxvY2FsaXplZF1cblxuICAgICAgICAgICAgaWYgKHR5cGVvZiBjYW5kaWRhdGUgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gY2FuZGlkYXRlLmJpbmQodGhpcykoKVxuXG4gICAgICAgICAgICAgIHJldHVybiB0aGlzLl9oYXNBdHRyaWJ1dGUodmFsdWUpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGNhbmRpZGF0ZSB0byBiZSBhIGZ1bmN0aW9uIGJ1dCBpdCB3YXM6ICR7dHlwZW9mIGNhbmRpZGF0ZX1gKVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmVkIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGNvbmZpZ3VyZWQgbm9uLXRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgc3RhdGljIGdldENvbmZpZ3VyZWREYXRhYmFzZUlkZW50aWZpZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllciB8fCBcImRlZmF1bHRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlXSAtIFdoZXRoZXIgdGVuYW50LXN3aXRjaGVkIG1vZGVscyBtdXN0IHJlc29sdmUgYSB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzLnRlbmFudF0gLSBFeHBsaWNpdCB0ZW5hbnQgZGVzY3JpcHRvciBpbnN0ZWFkIG9mIHRoZSBhbWJpZW50IHRlbmFudC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIHN0YXRpYyBnZXREYXRhYmFzZUlkZW50aWZpZXIoe2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlID0gdHJ1ZSwgdGVuYW50ID0gQ3VycmVudC50ZW5hbnQoKSwgLi4ucmVzdEFyZ3N9ID0ge30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgY29uc3QgdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXRUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIodGVuYW50KVxuXG4gICAgaWYgKHRlbmFudERhdGFiYXNlSWRlbnRpZmllcikge1xuICAgICAgaWYgKFxuICAgICAgICBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZSAmJlxuICAgICAgICB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzKCkgJiZcbiAgICAgICAgIXRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZSh0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudClcbiAgICAgICkge1xuICAgICAgICB0aHJvdyBuZXcgVGVuYW50RGF0YWJhc2VTY29wZUVycm9yKFxuICAgICAgICAgIGAke3RoaXMuZ2V0TW9kZWxOYW1lKCl9IHJlc29sdmVkIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyICR7SlNPTi5zdHJpbmdpZnkodGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKX0gYnV0IHRoYXQgZGF0YWJhc2UgaWRlbnRpZmllciBpcyBub3QgYWN0aXZlIGZvciB0aGUgY3VycmVudCB0ZW5hbnQuIFdyYXAgdGhlIG1vZGVsIHF1ZXJ5IGluIGNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCguLi4pIG9yIHNldCBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXM6IGZhbHNlIHRvIGFsbG93IGxlZ2FjeSBmYWxsYmFjayBiZWhhdmlvci5gLFxuICAgICAgICAgIHttb2RlbE5hbWU6IHRoaXMuZ2V0TW9kZWxOYW1lKCl9XG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRlbmFudERhdGFiYXNlSWRlbnRpZmllclxuICAgIH1cblxuICAgIGlmIChlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZSAmJiB0aGlzLl90ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlciAmJiB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzKCkpIHtcbiAgICAgIHRocm93IG5ldyBUZW5hbnREYXRhYmFzZVNjb3BlRXJyb3IoXG4gICAgICAgIGAke3RoaXMuZ2V0TW9kZWxOYW1lKCl9IGlzIGNvbmZpZ3VyZWQgd2l0aCBzd2l0Y2hlc1RlbmFudERhdGFiYXNlKC4uLikgYnV0IG5vIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyIHJlc29sdmVkIGZvciB0aGUgY3VycmVudCB0ZW5hbnQuIFdyYXAgdGhlIG1vZGVsIHF1ZXJ5IGluIGNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCguLi4pIG9yIHNldCBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXM6IGZhbHNlIHRvIGFsbG93IGxlZ2FjeSBmYWxsYmFjayBiZWhhdmlvci5gLFxuICAgICAgICB7bW9kZWxOYW1lOiB0aGlzLmdldE1vZGVsTmFtZSgpfVxuICAgICAgKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmdldENvbmZpZ3VyZWREYXRhYmFzZUlkZW50aWZpZXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2V0RGF0YWJhc2VJZGVudGlmaWVyKGRhdGFiYXNlSWRlbnRpZmllcikge1xuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllciA9IGRhdGFiYXNlSWRlbnRpZmllclxuICB9XG5cbiAgLyoqXG4gICAqIERlY2xhcmVzIGEgdGVuYW50LWF3YXJlIGRhdGFiYXNlIGlkZW50aWZpZXIgcmVzb2x2ZXIgZm9yIHRoaXMgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgKChhcmdzOiB7bW9kZWxDbGFzczogdHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLCB0ZW5hbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCB8IHVuZGVmaW5lZH0pID0+IHN0cmluZyB8IHVuZGVmaW5lZCl9IGRhdGFiYXNlSWRlbnRpZmllck9yUmVzb2x2ZXIgLSBTdGF0aWMgaWRlbnRpZmllciBvciByZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHN3aXRjaGVzVGVuYW50RGF0YWJhc2UoZGF0YWJhc2VJZGVudGlmaWVyT3JSZXNvbHZlcikge1xuICAgIHRoaXMuX3RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyID0gZGF0YWJhc2VJZGVudGlmaWVyT3JSZXNvbHZlclxuXG4gICAgaWYgKHRoaXMuX3RyYW5zbGF0aW9uQ2xhc3MpIHtcbiAgICAgIGNvbnN0IHRyYW5zbGF0ZWRNb2RlbENsYXNzID0gdGhpc1xuXG4gICAgICB0aGlzLl90cmFuc2xhdGlvbkNsYXNzLnN3aXRjaGVzVGVuYW50RGF0YWJhc2UoKHt0ZW5hbnR9KSA9PiB0cmFuc2xhdGVkTW9kZWxDbGFzcy5nZXRUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIodGVuYW50KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBtb2RlbCByZXNvbHZlcyBpdHMgZGF0YWJhc2UgZnJvbSB0aGUgY3VycmVudCB0ZW5hbnQuXG4gICAqL1xuICBzdGF0aWMgaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSB7XG4gICAgcmV0dXJuIEJvb2xlYW4odGhpcy5fdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFt0ZW5hbnRdIC0gVGVuYW50IG92ZXJyaWRlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRlbmFudC1zY29wZWQgZGF0YWJhc2UgaWRlbnRpZmllciB3aGVuIGNvbmZpZ3VyZWQuXG4gICAqL1xuICBzdGF0aWMgZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKHRlbmFudCA9IEN1cnJlbnQudGVuYW50KCkpIHtcbiAgICBjb25zdCB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlciA9IHRoaXMuX3RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyXG5cbiAgICBpZiAoIXRlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHRlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlcih7XG4gICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICAgIHRlbmFudFxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBhdHRyaWJ1dGUuXG4gICAqL1xuICBnZXRBdHRyaWJ1dGUobmFtZSkge1xuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUobmFtZSlcblxuICAgIGlmICghdGhpcy5pc05ld1JlY29yZCgpICYmICEoY29sdW1uTmFtZSBpbiB0aGlzLl9hdHRyaWJ1dGVzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0jJHtuYW1lfSBhdHRyaWJ1dGUgaGFzbid0IGJlZW4gbG9hZGVkIHlldCBpbiAke09iamVjdC5rZXlzKHRoaXMuX2F0dHJpYnV0ZXMpLmpvaW4oXCIsIFwiKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hdHRyaWJ1dGVzW2NvbHVtbk5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAtIFRoZSBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGdldE1vZGVsQ2xhc3MoKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcblxuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbikgcmV0dXJuIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLm1vZGVsQ2xhc3MobW9kZWxDbGFzcylcblxuICAgIHJldHVybiBtb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG5ld1ZhbHVlIC0gTmV3IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRBdHRyaWJ1dGUobmFtZSwgbmV3VmFsdWUpIHtcbiAgICAvLyBSZXNvbHZlIHJhdyBjb2x1bW4gbmFtZXMgKFwiVkFfw5xiQXR0cmlidXRJRFwiLCBcIklQXCIpIGFuZCBjYXNpbmcgdmFyaWFudHMgKFwidkFGdW5rdGlvbklEXCIpIHRvIHRoZVxuICAgIC8vIGNhbm9uaWNhbCBhdHRyaWJ1dGUgdGhlIG1vZGVsIGJhc2UgZ2VuZXJhdGVzIGl0cyBzZXR0ZXIgZnJvbSAoc2V0VkFVZWJhdHRyaWJ1dGlkLCBzZXRJcCwg4oCmKS5cbiAgICBjb25zdCBjYW5vbmljYWxOYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucmVzb2x2ZUF0dHJpYnV0ZU5hbWUobmFtZSkgPz8gbmFtZVxuICAgIGNvbnN0IHJlcXVlc3RlZFNldHRlck5hbWUgPSBgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKGNhbm9uaWNhbE5hbWUpfWBcbiAgICBjb25zdCBzZXR0ZXJOYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZmluZE1lbWJlck5hbWVJbnNlbnNpdGl2ZSh0aGlzLCByZXF1ZXN0ZWRTZXR0ZXJOYW1lKVxuICAgIGNvbnN0IGR5bmFtaWNUaGlzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAodmFsdWU6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiB2b2lkPn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcblxuICAgIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIGlmICghdGhpcy5nZXRNb2RlbENsYXNzKCkuaXNJbml0aWFsaXplZCgpKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSBtb2RlbCBpc24ndCBpbml0aWFsaXplZCB5ZXRgKVxuICAgIGlmICghc2V0dGVyTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIHNldHRlciBtZXRob2Q6ICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSMke3JlcXVlc3RlZFNldHRlck5hbWV9YClcblxuICAgIGR5bmFtaWNUaGlzW3NldHRlck5hbWVdKG5ld1ZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGNvbHVtbiBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbmV3VmFsdWUgLSBOZXcgdmFsdWUuXG4gICAqL1xuICBfc2V0Q29sdW1uQXR0cmlidXRlKG5hbWUsIG5ld1ZhbHVlKSB7XG4gICAgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgaWYgKCF0aGlzLmdldE1vZGVsQ2xhc3MoKS5fYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gYXR0cmlidXRlLXRvLWNvbHVtbiBtYXBwaW5nLiBIYXMgcmVjb3JkIGJlZW4gaW5pdGlhbGl6ZWQ/XCIpXG5cbiAgICBjb25zdCByZXNvbHZlZE5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5yZXNvbHZlQXR0cmlidXRlTmFtZShuYW1lKVxuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSByZXNvbHZlZE5hbWUgPyB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClbcmVzb2x2ZWROYW1lXSA6IHVuZGVmaW5lZFxuXG4gICAgaWYgKCFjb2x1bW5OYW1lKSB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IGZpZ3VyZSBvdXQgY29sdW1uIG5hbWUgZm9yIGF0dHJpYnV0ZTogJHtuYW1lfWApXG5cbiAgICBsZXQgbm9ybWFsaXplZFZhbHVlID0gbmV3VmFsdWVcbiAgICBjb25zdCBjb2x1bW5UeXBlID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uVHlwZUJ5TmFtZShjb2x1bW5OYW1lKVxuXG4gICAgaWYgKGNvbHVtblR5cGUgJiYgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2lzRGF0ZUxpa2VUeXBlKGNvbHVtblR5cGUpKSB7XG4gICAgICBub3JtYWxpemVkVmFsdWUgPSB0aGlzLl9ub3JtYWxpemVEYXRlVmFsdWUobmV3VmFsdWUpXG4gICAgfVxuXG4gICAgbm9ybWFsaXplZFZhbHVlID0gdGhpcy5fbm9ybWFsaXplQm9vbGVhblZhbHVlRm9yV3JpdGUoe2F0dHJpYnV0ZU5hbWU6IG5hbWUsIGNvbHVtblR5cGUsIHZhbHVlOiBub3JtYWxpemVkVmFsdWV9KVxuXG4gICAgaWYgKHRoaXMuX2F0dHJpYnV0ZXNbY29sdW1uTmFtZV0gIT0gbm9ybWFsaXplZFZhbHVlKSB7XG4gICAgICB0aGlzLl9jbGVhckJlbG9uZ3NUb1JlbGF0aW9uc2hpcEZvckNoYW5nZWRGb3JlaWduS2V5KGNvbHVtbk5hbWUsIG5vcm1hbGl6ZWRWYWx1ZSlcbiAgICAgIHRoaXMuX2NoYW5nZXNbY29sdW1uTmFtZV0gPSBub3JtYWxpemVkVmFsdWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIGxvYWRlZCBiZWxvbmdzLXRvIGNhY2hlcyB3aGVuIGNhbGxlcnMgYXNzaWduIHRoZSBmb3JlaWduIGtleSBkaXJlY3RseS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDaGFuZ2VkIGRhdGFiYXNlIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBub3JtYWxpemVkVmFsdWUgLSBOZXcgbm9ybWFsaXplZCBjb2x1bW4gdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9jbGVhckJlbG9uZ3NUb1JlbGF0aW9uc2hpcEZvckNoYW5nZWRGb3JlaWduS2V5KGNvbHVtbk5hbWUsIG5vcm1hbGl6ZWRWYWx1ZSkge1xuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwIG9mIHRoaXMuX2JlbG9uZ3NUb1JlbGF0aW9uc2hpcHNGb3JGb3JlaWduS2V5KGNvbHVtbk5hbWUpKSB7XG4gICAgICBpZiAodGhpcy5fYmVsb25nc1RvUmVsYXRpb25zaGlwTWF0Y2hlc0ZvcmVpZ25LZXlWYWx1ZSh7bm9ybWFsaXplZFZhbHVlLCByZWxhdGlvbnNoaXB9KSkgY29udGludWVcblxuICAgICAgdGhpcy5fY2xlYXJMb2FkZWRCZWxvbmdzVG9SZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlbG9uZ3MgdG8gcmVsYXRpb25zaGlwcyBmb3IgZm9yZWlnbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ2hhbmdlZCBkYXRhYmFzZSBjb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIGluc3RhbmNlcyB0aGF0IHVzZSB0aGUgY2hhbmdlZCBmb3JlaWduIGtleS5cbiAgICovXG4gIF9iZWxvbmdzVG9SZWxhdGlvbnNoaXBzRm9yRm9yZWlnbktleShjb2x1bW5OYW1lKSB7XG4gICAgaWYgKCF0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHJldHVybiBbXVxuXG4gICAgcmV0dXJuIE9iamVjdFxuICAgICAgLnZhbHVlcyh0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpXG4gICAgICAuZmlsdGVyKChyZWxhdGlvbnNoaXApID0+IHRoaXMuX2JlbG9uZ3NUb1JlbGF0aW9uc2hpcFVzZXNGb3JlaWduS2V5KHtjb2x1bW5OYW1lLCByZWxhdGlvbnNoaXB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlbG9uZ3MgdG8gcmVsYXRpb25zaGlwIHVzZXMgZm9yZWlnbiBrZXkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVsYXRpb25zaGlwIG1hdGNoIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uTmFtZSAtIENoYW5nZWQgZGF0YWJhc2UgY29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZWxhdGlvbnNoaXAgaXMgYSBiZWxvbmdzLXRvIHVzaW5nIHRoZSBjaGFuZ2VkIGZvcmVpZ24ga2V5LlxuICAgKi9cbiAgX2JlbG9uZ3NUb1JlbGF0aW9uc2hpcFVzZXNGb3JlaWduS2V5KHtjb2x1bW5OYW1lLCByZWxhdGlvbnNoaXB9KSB7XG4gICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT0gXCJiZWxvbmdzVG9cIikgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBmb3JlaWduS2V5ID0gcmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKVxuICAgIGNvbnN0IGZvcmVpZ25LZXlBdHRyaWJ1dGUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbZm9yZWlnbktleV1cblxuICAgIHJldHVybiBmb3JlaWduS2V5ID09IGNvbHVtbk5hbWUgfHwgZm9yZWlnbktleUF0dHJpYnV0ZSA9PSBjb2x1bW5OYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWxvbmdzIHRvIHJlbGF0aW9uc2hpcCBtYXRjaGVzIGZvcmVpZ24ga2V5IHZhbHVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlbGF0aW9uc2hpcCBjYWNoZSBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3Mubm9ybWFsaXplZFZhbHVlIC0gTmV3IG5vcm1hbGl6ZWQgY29sdW1uIHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgbG9hZGVkIHJlbGF0ZWQgcmVjb3JkIHN0aWxsIG1hdGNoZXMgdGhlIGNoYW5nZWQgZm9yZWlnbiBrZXkuXG4gICAqL1xuICBfYmVsb25nc1RvUmVsYXRpb25zaGlwTWF0Y2hlc0ZvcmVpZ25LZXlWYWx1ZSh7bm9ybWFsaXplZFZhbHVlLCByZWxhdGlvbnNoaXB9KSB7XG4gICAgY29uc3QgbG9hZGVkID0gcmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKClcblxuICAgIGlmICghbG9hZGVkKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoQXJyYXkuaXNBcnJheShsb2FkZWQpKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoIXJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKCkpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIGxvYWRlZC5yZWFkQ29sdW1uKHJlbGF0aW9uc2hpcC5nZXRQcmltYXJ5S2V5KCkpID09IG5vcm1hbGl6ZWRWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGZvcmVpZ24ga2V5IHZhbHVlIGZvciBhIGJlbG9uZ3MtdG8gcmVsYXRpb25zaGlwIGFzc2lnbm1lbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVsYXRpb25zaGlwIGFzc2lnbm1lbnQgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5tb2RlbCAtIEFzc2lnbmVkIG1vZGVsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVsYXRpb25zaGlwIC0gQmVsb25ncy10byByZWxhdGlvbnNoaXAgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSAtIEZvcmVpZ24ga2V5IHZhbHVlIGZvciB0aGUgYXNzaWdubWVudC5cbiAgICovXG4gIF9iZWxvbmdzVG9Gb3JlaWduS2V5VmFsdWUoe21vZGVsLCByZWxhdGlvbnNoaXB9KSB7XG4gICAgaWYgKG1vZGVsID09IG51bGwpIHJldHVybiBudWxsXG4gICAgaWYgKCEobW9kZWwgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkpIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBtb2RlbCB0eXBlOiAke3R5cGVvZiBtb2RlbH1gKVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gKi8gKG1vZGVsLnJlYWRDb2x1bW4ocmVsYXRpb25zaGlwLmdldFByaW1hcnlLZXkoKSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBsb2FkZWQgYmVsb25ncyB0byByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2NsZWFyTG9hZGVkQmVsb25nc1RvUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcCkge1xuICAgIHJlbGF0aW9uc2hpcC5zZXRMb2FkZWQodW5kZWZpbmVkKVxuICAgIHJlbGF0aW9uc2hpcC5zZXRQcmVsb2FkZWQoZmFsc2UpXG4gICAgcmVsYXRpb25zaGlwLnNldERpcnR5KGZhbHNlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRhdGUgdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGRhdGUgdmFsdWUuXG4gICAqL1xuICBfbm9ybWFsaXplRGF0ZVZhbHVlKHZhbHVlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZURhdGVWYWx1ZUZvcldyaXRlKHZhbHVlLCB7dGltZVpvbmU6IHRoaXMuZ2V0TW9kZWxDbGFzcygpLl90aW1lWm9uZUZvckRhdGVXcml0ZSgpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBzcWxpdGUgYm9vbGVhbiB2YWx1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGFyZ3MuY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIF9ub3JtYWxpemVTcWxpdGVCb29sZWFuVmFsdWUoe2NvbHVtblR5cGUsIHZhbHVlfSkge1xuICAgIGlmICh0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXREYXRhYmFzZVR5cGUoKSAhPSBcInNxbGl0ZVwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAoIWNvbHVtblR5cGUpIHJldHVybiB2YWx1ZVxuICAgIGlmIChjb2x1bW5UeXBlLnRvTG93ZXJDYXNlKCkgIT09IFwiYm9vbGVhblwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiAxXG4gICAgaWYgKHZhbHVlID09PSBmYWxzZSkgcmV0dXJuIDBcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBib29sZWFuIHZhbHVlIGJlZm9yZSBzdG9yaW5nLiBBIGRlY2xhcmVkIGBcImJvb2xlYW5cImAgYXR0cmlidXRlIGNhc3Qgc3RvcmVzXG4gICAqIGJvb2xlYW5zIGFzIDEvMCBvbmx5IGZvciBpbnRlZ2VyLWJhY2tlZCBjb2x1bW5zIChlLmcuIGFuIE1TU1FMIGBiaXRgKS4gQ29sdW1ucyB3aG9zZVxuICAgKiB1bmRlcmx5aW5nIHR5cGUgaXMgYWxyZWFkeSBhIG5hdGl2ZSBib29sZWFuIChlLmcuIFBvc3RncmVzIGBib29sZWFuYCkga2VlcCBgdHJ1ZWAvYGZhbHNlYFxuICAgKiBzbyB0aGUgZHJpdmVyIGNhbiBlbWl0IHRoZSBwcm9wZXIgYm9vbGVhbiBsaXRlcmFsOyBvdGhlcndpc2UgdGhlIHNxbGl0ZS1vbmx5IG5vcm1hbGl6ZXIgYXBwbGllcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lIGJlaW5nIHdyaXR0ZW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBfbm9ybWFsaXplQm9vbGVhblZhbHVlRm9yV3JpdGUoe2F0dHJpYnV0ZU5hbWUsIGNvbHVtblR5cGUsIHZhbHVlfSkge1xuICAgIGlmICghdGhpcy5nZXRNb2RlbENsYXNzKCkuX2RlY2xhcmVkQm9vbGVhblN0b3Jlc0FzSW50ZWdlcihhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZVNxbGl0ZUJvb2xlYW5WYWx1ZSh7Y29sdW1uVHlwZSwgdmFsdWV9KVxuICAgIH1cblxuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSkgcmV0dXJuIDFcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlKSByZXR1cm4gMFxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIGRlY2xhcmVkIGBcImJvb2xlYW5cImAgYXR0cmlidXRlIGNhc3QgaXMgYmFja2VkIGJ5IGFuIGludGVnZXIgY29sdW1uIChlLmcuIGFuIE1TU1FMXG4gICAqIGBiaXRgKSwgc28gYm9vbGVhbnMgbXVzdCBiZSBzdG9yZWQgYXMgMS8wLiBBIG5hdGl2ZSBib29sZWFuIGNvbHVtbiAoZS5nLiBQb3N0Z3JlcyBgYm9vbGVhbmApXG4gICAqIHJldHVybnMgZmFsc2UgYW5kIGtlZXBzIGB0cnVlYC9gZmFsc2VgIGZvciB0aGUgZHJpdmVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBkZWNsYXJlZCBib29sZWFuIGlzIHN0b3JlZCBhcyBhbiBpbnRlZ2VyLlxuICAgKi9cbiAgc3RhdGljIF9kZWNsYXJlZEJvb2xlYW5TdG9yZXNBc0ludGVnZXIoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICh0aGlzLmdldEF0dHJpYnV0ZUNhc3QoYXR0cmlidXRlTmFtZSkgIT09IFwiYm9vbGVhblwiKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSB0aGlzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVthdHRyaWJ1dGVOYW1lXVxuICAgIGNvbnN0IGludHJvc3BlY3RlZFR5cGUgPSBjb2x1bW5OYW1lID8gdGhpcy5nZXRDb2x1bW5zSGFzaCgpW2NvbHVtbk5hbWVdPy5nZXRUeXBlKCkgOiB1bmRlZmluZWRcblxuICAgIHJldHVybiB0eXBlb2YgaW50cm9zcGVjdGVkVHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnRyb3NwZWN0ZWRUeXBlLnRvTG93ZXJDYXNlKCkgIT09IFwiYm9vbGVhblwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29sdW1ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdFtdfSAtIFRoZSBjb2x1bW5zLlxuICAgKi9cbiAgc3RhdGljIGdldENvbHVtbnMoKSB7XG4gICAgdGhpcy5fYXNzZXJ0SGFzQmVlbkluaXRpYWxpemVkKClcbiAgICBpZiAoIXRoaXMuX2NvbHVtbnMpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9IGhhc24ndCBiZWVuIGluaXRpYWxpemVkIHlldGApXG5cbiAgICByZXR1cm4gdGhpcy5fY29sdW1uc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbHVtbnMgaGFzaC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD59IC0gVGhlIGNvbHVtbnMgaGFzaC5cbiAgICovXG4gIHN0YXRpYyBnZXRDb2x1bW5zSGFzaCgpIHtcbiAgICBpZiAoIXRoaXMuX2NvbHVtbnNBc0hhc2gpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD59ICovXG4gICAgICB0aGlzLl9jb2x1bW5zQXNIYXNoID0ge31cblxuICAgICAgZm9yIChjb25zdCBjb2x1bW4gb2YgdGhpcy5nZXRDb2x1bW5zKCkpIHtcbiAgICAgICAgdGhpcy5fY29sdW1uc0FzSGFzaFtjb2x1bW4uZ2V0TmFtZSgpXSA9IGNvbHVtblxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9jb2x1bW5zQXNIYXNoXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29sdW1uIHR5cGUgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSBjb2x1bW4gdHlwZSBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldENvbHVtblR5cGVCeU5hbWUobmFtZSkge1xuICAgIGlmICghdGhpcy5fY29sdW1uVHlwZUJ5TmFtZSkge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPn0gKi9cbiAgICAgIHRoaXMuX2NvbHVtblR5cGVCeU5hbWUgPSB7fVxuXG4gICAgICBmb3IgKGNvbnN0IGNvbHVtbiBvZiB0aGlzLmdldENvbHVtbnMoKSkge1xuICAgICAgICB0aGlzLl9jb2x1bW5UeXBlQnlOYW1lW2NvbHVtbi5nZXROYW1lKCldID0gY29sdW1uLmdldFR5cGUoKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSB0aGlzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVtuYW1lXVxuXG4gICAgaWYgKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICAgIGNvbnN0IGNhc3QgPSB0aGlzLmdldEF0dHJpYnV0ZUNhc3QoYXR0cmlidXRlTmFtZSlcblxuICAgICAgaWYgKGNhc3QpIHJldHVybiBjYXN0XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2NvbHVtblR5cGVCeU5hbWVbbmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGRhdGUgbGlrZSB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIFR5cGUgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBkYXRlIGxpa2UgdHlwZS5cbiAgICovXG4gIHN0YXRpYyBfaXNEYXRlTGlrZVR5cGUodHlwZSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRUeXBlID0gdHlwZS50b0xvd2VyQ2FzZSgpXG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFR5cGUgPT0gXCJkYXRlXCIgfHxcbiAgICAgIG5vcm1hbGl6ZWRUeXBlID09IFwiZGF0ZXRpbWVcIiB8fFxuICAgICAgbm9ybWFsaXplZFR5cGUgPT0gXCJ0aW1lc3RhbXBcIiB8fFxuICAgICAgbm9ybWFsaXplZFR5cGUgPT0gXCJ0aW1lc3RhbXB0elwiIHx8XG4gICAgICBub3JtYWxpemVkVHlwZS5zdGFydHNXaXRoKFwidGltZXN0YW1wIFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbHVtbiBuYW1lcy5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IC0gVGhlIGNvbHVtbiBuYW1lcy5cbiAgICovXG4gIHN0YXRpYyBnZXRDb2x1bW5OYW1lcygpIHtcbiAgICBpZiAoIXRoaXMuX2NvbHVtbk5hbWVzKSB7XG4gICAgICB0aGlzLl9jb2x1bW5OYW1lcyA9IHRoaXMuZ2V0Q29sdW1ucygpLm1hcCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9jb2x1bW5OYW1lc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIHRhYmxlLlxuICAgKi9cbiAgc3RhdGljIF9nZXRUYWJsZSgpIHtcbiAgICBpZiAoIXRoaXMuX3RhYmxlKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5uYW1lfSBoYXNuJ3QgYmVlbiBpbml0aWFsaXplZCB5ZXRgKVxuXG4gICAgcmV0dXJuIHRoaXMuX3RhYmxlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgbXVsdGlwbGUuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gY29sdW1ucyAtIENvbHVtbiBuYW1lcy5cbiAgICogQHBhcmFtIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSByb3dzIC0gUm93cyB0byBpbnNlcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5jYXN0XSAtIFdoZXRoZXIgdG8gY2FzdCB2YWx1ZXMgYmFzZWQgb24gY29sdW1uIHR5cGVzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnJldHJ5SW5kaXZpZHVhbGx5T25GYWlsdXJlXSAtIFJldHJ5IHJvd3MgaW5kaXZpZHVhbGx5IGlmIGEgYmF0Y2ggaW5zZXJ0IGZhaWxzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnJldHVyblJlc3VsdHNdIC0gUmV0dXJuIHN1Y2NlZWRlZC9mYWlsZWQgcm93cyBpbnN0ZWFkIG9mIHRocm93aW5nIHdoZW4gcmV0cmllcyBmYWlsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkIHwge3N1Y2NlZWRlZFJvd3M6IEFycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4sIGZhaWxlZFJvd3M6IEFycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4sIGVycm9yczogQXJyYXk8e3JvdzogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgaW5zZXJ0TXVsdGlwbGUoY29sdW1ucywgcm93cywgYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge2Nhc3QgPSB0cnVlLCByZXRyeUluZGl2aWR1YWxseU9uRmFpbHVyZSA9IGZhbHNlLCByZXR1cm5SZXN1bHRzID0gZmFsc2UsIC4uLnJlc3RBcmdzfSA9IGFyZ3NcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkUm93cyA9IGNhc3RcbiAgICAgID8gdGhpcy5fbm9ybWFsaXplSW5zZXJ0TXVsdGlwbGVSb3dzKHtjb2x1bW5zLCByb3dzfSlcbiAgICAgIDogcm93c1xuICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRoaXMudGFibGVOYW1lKClcblxuICAgIGlmICghcmV0cnlJbmRpdmlkdWFsbHlPbkZhaWx1cmUpIHtcbiAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLmluc2VydE11bHRpcGxlKHRhYmxlTmFtZSwgY29sdW1ucywgbm9ybWFsaXplZFJvd3MpXG4gICAgICBpZiAocmV0dXJuUmVzdWx0cykgcmV0dXJuIHtzdWNjZWVkZWRSb3dzOiBub3JtYWxpemVkUm93cy5zbGljZSgpLCBmYWlsZWRSb3dzOiBbXSwgZXJyb3JzOiBbXX1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAvLyBXcmFwIHRoZSBiYXRjaCBpbiBhIHRyYW5zYWN0aW9uL3NhdmVwb2ludC4gT24gZGF0YWJhc2VzIHRoYXQgYWJvcnQgdGhlXG4gICAgICAvLyB3aG9sZSB0cmFuc2FjdGlvbiB3aGVuIGEgc3RhdGVtZW50IGZhaWxzIChQb3N0Z3JlU1FMKSwgYSBmYWlsZWQgYmF0Y2hcbiAgICAgIC8vIHdvdWxkIG90aGVyd2lzZSBwb2lzb24gdGhlIHN1cnJvdW5kaW5nIHRyYW5zYWN0aW9uIHNvIHRoYXQgdGhlXG4gICAgICAvLyBpbmRpdmlkdWFsIHJldHJpZXMgYmVsb3cgYWxsIGZhaWwgd2l0aCBcImN1cnJlbnQgdHJhbnNhY3Rpb24gaXMgYWJvcnRlZFwiLlxuICAgICAgLy8gdHJhbnNhY3Rpb24oKSBvcGVucyBhIHNhdmVwb2ludCB3aGVuIGFscmVhZHkgaW5zaWRlIGEgdHJhbnNhY3Rpb24gYW5kIGFcbiAgICAgIC8vIHJlYWwgdHJhbnNhY3Rpb24gb3RoZXJ3aXNlLCBzbyBhIGZhaWx1cmUgcm9sbHMgYmFjayBvbmx5IHRoaXMgYXR0ZW1wdC5cbiAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkuaW5zZXJ0TXVsdGlwbGUodGFibGVOYW1lLCBjb2x1bW5zLCBub3JtYWxpemVkUm93cylcbiAgICAgIH0pXG4gICAgICBpZiAocmV0dXJuUmVzdWx0cykgcmV0dXJuIHtzdWNjZWVkZWRSb3dzOiBub3JtYWxpemVkUm93cy5zbGljZSgpLCBmYWlsZWRSb3dzOiBbXSwgZXJyb3JzOiBbXX1cbiAgICAgIHJldHVyblxuICAgIH0gY2F0Y2gge1xuICAgICAgLyoqXG4gICAgICAgKiBSZXN1bHRzLlxuICAgICAgICogQHR5cGUge3tzdWNjZWVkZWRSb3dzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXSwgZmFpbGVkUm93czogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W10sIGVycm9yczogQXJyYXk8e3JvdzogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn19ICovXG4gICAgICBjb25zdCByZXN1bHRzID0ge1xuICAgICAgICBzdWNjZWVkZWRSb3dzOiBbXSxcbiAgICAgICAgZmFpbGVkUm93czogW10sXG4gICAgICAgIGVycm9yczogW11cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygbm9ybWFsaXplZFJvd3MpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAvLyBFYWNoIHJldHJ5IHJ1bnMgaW4gaXRzIG93biBzYXZlcG9pbnQgc28gYSBmYWlsZWQgcm93IHJvbGxzIGJhY2sgb25seVxuICAgICAgICAgIC8vIHRoYXQgcm93IGFuZCBsZWF2ZXMgdGhlIHN1cnJvdW5kaW5nIHRyYW5zYWN0aW9uIHVzYWJsZSBmb3IgdGhlIHJlc3QuXG4gICAgICAgICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkuaW5zZXJ0TXVsdGlwbGUodGFibGVOYW1lLCBjb2x1bW5zLCBbcm93XSlcbiAgICAgICAgICB9KVxuICAgICAgICAgIHJlc3VsdHMuc3VjY2VlZGVkUm93cy5wdXNoKHJvdylcbiAgICAgICAgfSBjYXRjaCAocm93RXJyb3IpIHtcbiAgICAgICAgICByZXN1bHRzLmZhaWxlZFJvd3MucHVzaChyb3cpXG4gICAgICAgICAgcmVzdWx0cy5lcnJvcnMucHVzaCh7cm93LCBlcnJvcjogcm93RXJyb3J9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChyZXN1bHRzLmZhaWxlZFJvd3MubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBjb21iaW5lZEVycm9ycyA9IHJlc3VsdHMuZXJyb3JzLm1hcCgoZW50cnksIGluZGV4KSA9PiB7XG4gICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGVudHJ5LmVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlbnRyeS5lcnJvci5tZXNzYWdlIDogU3RyaW5nKGVudHJ5LmVycm9yKVxuICAgICAgICAgIHJldHVybiBgWyR7aW5kZXh9XSAke21lc3NhZ2V9LiBSb3c6ICR7dGhpcy5fc2FmZVNlcmlhbGl6ZUluc2VydFJvdyhlbnRyeS5yb3cpfWBcbiAgICAgICAgfSkuam9pbihcIiB8IFwiKVxuICAgICAgICBjb25zdCBjb21iaW5lZEVycm9yID0gbmV3IEVycm9yKGBpbnNlcnRNdWx0aXBsZSBmYWlsZWQgZm9yICR7cmVzdWx0cy5mYWlsZWRSb3dzLmxlbmd0aH0gcm93cy4gJHtjb21iaW5lZEVycm9yc31gKVxuXG4gICAgICAgIGlmIChyZXR1cm5SZXN1bHRzKSByZXR1cm4gcmVzdWx0c1xuICAgICAgICB0aHJvdyBjb21iaW5lZEVycm9yXG4gICAgICB9XG5cbiAgICAgIGlmIChyZXR1cm5SZXN1bHRzKSByZXR1cm4gcmVzdWx0c1xuICAgICAgcmV0dXJuXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGluc2VydCBtdWx0aXBsZSByb3dzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGFyZ3MuY29sdW1ucyAtIENvbHVtbiBuYW1lcy5cbiAgICogQHBhcmFtIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBhcmdzLnJvd3MgLSBSb3dzIHRvIGluc2VydC5cbiAgICogQHJldHVybnMge0FycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gTm9ybWFsaXplZCByb3dzLlxuICAgKi9cbiAgc3RhdGljIF9ub3JtYWxpemVJbnNlcnRNdWx0aXBsZVJvd3Moe2NvbHVtbnMsIHJvd3N9KSB7XG4gICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IHtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheShyb3cpIHx8IHJvdy5sZW5ndGggIT09IGNvbHVtbnMubGVuZ3RoKSB7XG4gICAgICAgIGNvbnN0IHJvd0xlbmd0aCA9IEFycmF5LmlzQXJyYXkocm93KSA/IHJvdy5sZW5ndGggOiBcIm5vbi1hcnJheVwiXG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBpbnNlcnRNdWx0aXBsZSByb3cgbGVuZ3RoIG1pc21hdGNoLiBFeHBlY3RlZCAke2NvbHVtbnMubGVuZ3RofSB2YWx1ZXMgYnV0IGdvdCAke3Jvd0xlbmd0aH0uIFJvdzogJHtKU09OLnN0cmluZ2lmeShyb3cpfWApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRSb3cgPSBbXVxuXG4gICAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgY29sdW1ucy5sZW5ndGg7IGluZGV4KyspIHtcbiAgICAgICAgY29uc3QgY29sdW1uTmFtZSA9IGNvbHVtbnNbaW5kZXhdXG4gICAgICAgIGNvbnN0IHZhbHVlID0gcm93W2luZGV4XVxuXG4gICAgICAgIG5vcm1hbGl6ZWRSb3dbaW5kZXhdID0gdGhpcy5fbm9ybWFsaXplSW5zZXJ0VmFsdWVGb3JDb2x1bW4oe2NvbHVtbk5hbWUsIHZhbHVlfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG5vcm1hbGl6ZWRSb3dcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2FmZSBzZXJpYWxpemUgaW5zZXJ0IHJvdy5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJvdyAtIFJvdyB0byBzZXJpYWxpemUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2FmZSByb3cgcmVwcmVzZW50YXRpb24uXG4gICAqL1xuICBzdGF0aWMgX3NhZmVTZXJpYWxpemVJbnNlcnRSb3cocm93KSB7XG4gICAgcmV0dXJuIGZvcm1hdFZhbHVlKHJvdylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBpbnNlcnQgdmFsdWUgZm9yIGNvbHVtbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uTmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gQ29sdW1uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplSW5zZXJ0VmFsdWVGb3JDb2x1bW4oe2NvbHVtbk5hbWUsIHZhbHVlfSkge1xuICAgIGNvbnN0IGNvbHVtbiA9IHRoaXMuZ2V0Q29sdW1uc0hhc2goKVtjb2x1bW5OYW1lXVxuXG4gICAgaWYgKCFjb2x1bW4pIHJldHVybiB2YWx1ZVxuXG4gICAgY29uc3QgY29sdW1uVHlwZSA9IGNvbHVtbi5nZXRUeXBlKClcbiAgICBjb25zdCBub3JtYWxpemVkVHlwZSA9IHR5cGVvZiBjb2x1bW5UeXBlID09PSBcInN0cmluZ1wiID8gY29sdW1uVHlwZS50b0xvd2VyQ2FzZSgpIDogdW5kZWZpbmVkXG4gICAgbGV0IG5vcm1hbGl6ZWRWYWx1ZSA9IHZhbHVlXG5cbiAgICBpZiAobm9ybWFsaXplZFR5cGUgJiYgdGhpcy5faXNEYXRlTGlrZVR5cGUobm9ybWFsaXplZFR5cGUpKSB7XG4gICAgICBub3JtYWxpemVkVmFsdWUgPSB0aGlzLl9ub3JtYWxpemVEYXRlVmFsdWVGb3JJbnNlcnQobm9ybWFsaXplZFZhbHVlKVxuICAgIH1cblxuICAgIG5vcm1hbGl6ZWRWYWx1ZSA9IHRoaXMuX25vcm1hbGl6ZVNxbGl0ZUJvb2xlYW5WYWx1ZUZvckluc2VydCh7Y29sdW1uVHlwZSwgdmFsdWU6IG5vcm1hbGl6ZWRWYWx1ZX0pXG5cbiAgICBpZiAobm9ybWFsaXplZFZhbHVlID09PSBcIlwiICYmIGNvbHVtbi5nZXROdWxsKCkgJiYgIXRoaXMuX2lzU3RyaW5nVHlwZShub3JtYWxpemVkVHlwZSkpIHtcbiAgICAgIG5vcm1hbGl6ZWRWYWx1ZSA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAobm9ybWFsaXplZFR5cGUgJiYgdGhpcy5faXNOdW1lcmljVHlwZShub3JtYWxpemVkVHlwZSkpIHtcbiAgICAgIG5vcm1hbGl6ZWRWYWx1ZSA9IHRoaXMuX25vcm1hbGl6ZU51bWVyaWNWYWx1ZSh7Y29sdW1uVHlwZTogbm9ybWFsaXplZFR5cGUsIHZhbHVlOiBub3JtYWxpemVkVmFsdWV9KVxuICAgIH1cblxuICAgIHJldHVybiBub3JtYWxpemVkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIHN0cmluZyB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHN0cmluZy1saWtlIHR5cGUuXG4gICAqL1xuICBzdGF0aWMgX2lzU3RyaW5nVHlwZShjb2x1bW5UeXBlKSB7XG4gICAgaWYgKCFjb2x1bW5UeXBlKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHN0cmluZ1R5cGVzID0gbmV3IFNldChbXCJjaGFyXCIsIFwidmFyY2hhclwiLCBcIm52YXJjaGFyXCIsIFwic3RyaW5nXCIsIFwiZW51bVwiLCBcImpzb25cIiwgXCJqc29uYlwiLCBcImNpdGV4dFwiLCBcImJpbmFyeVwiLCBcInZhcmJpbmFyeVwiXSlcblxuICAgIHJldHVybiBjb2x1bW5UeXBlLmluY2x1ZGVzKFwidXVpZFwiKSB8fFxuICAgICAgY29sdW1uVHlwZS5pbmNsdWRlcyhcInRleHRcIikgfHxcbiAgICAgIHN0cmluZ1R5cGVzLmhhcyhjb2x1bW5UeXBlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgbnVtZXJpYyB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIG51bWVyaWMtbGlrZSB0eXBlLlxuICAgKi9cbiAgc3RhdGljIF9pc051bWVyaWNUeXBlKGNvbHVtblR5cGUpIHtcbiAgICByZXR1cm4gY29sdW1uVHlwZS5pbmNsdWRlcyhcImludFwiKSB8fFxuICAgICAgY29sdW1uVHlwZS5pbmNsdWRlcyhcImRlY2ltYWxcIikgfHxcbiAgICAgIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJudW1lcmljXCIpIHx8XG4gICAgICBjb2x1bW5UeXBlLmluY2x1ZGVzKFwiZmxvYXRcIikgfHxcbiAgICAgIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJkb3VibGVcIikgfHxcbiAgICAgIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJyZWFsXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgbnVtZXJpYyB2YWx1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplTnVtZXJpY1ZhbHVlKHtjb2x1bW5UeXBlLCB2YWx1ZX0pIHtcbiAgICBpZiAodmFsdWUgPT09IFwiXCIgfHwgdmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHZhbHVlXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIHZhbHVlXG5cbiAgICBpZiAoY29sdW1uVHlwZS5pbmNsdWRlcyhcImRlY2ltYWxcIikgfHwgY29sdW1uVHlwZS5pbmNsdWRlcyhcIm51bWVyaWNcIikpIHtcbiAgICAgIHJldHVybiB2YWx1ZVxuICAgIH1cblxuICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlcih2YWx1ZSlcblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHBhcnNlZCkpIHJldHVybiB2YWx1ZVxuXG4gICAgaWYgKGNvbHVtblR5cGUuaW5jbHVkZXMoXCJpbnRcIikpIHtcbiAgICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIocGFyc2VkKSkgcmV0dXJuIHZhbHVlXG4gICAgICBpZiAoIS9eLT9cXGQrJC8udGVzdCh2YWx1ZSkpIHJldHVybiB2YWx1ZVxuICAgIH1cblxuICAgIHJldHVybiBwYXJzZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBkYXRlIHZhbHVlIGZvciBpbnNlcnQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplRGF0ZVZhbHVlRm9ySW5zZXJ0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZURhdGVWYWx1ZUZvcldyaXRlKHZhbHVlLCB7dGltZVpvbmU6IHRoaXMuX3RpbWVab25lRm9yRGF0ZVdyaXRlKCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRhdGUgc3RyaW5nIGZvciBpbnNlcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIERhdGUgc3RyaW5nIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgRGF0ZX0gLSBQYXJzZWQgZGF0ZSBvciBvcmlnaW5hbCBzdHJpbmcuXG4gICAqL1xuICBzdGF0aWMgX25vcm1hbGl6ZURhdGVTdHJpbmdGb3JJbnNlcnQodmFsdWUpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlKHZhbHVlLCB7dGltZVpvbmU6IHRoaXMuX3RpbWVab25lRm9yRGF0ZVdyaXRlKCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGltZSB6b25lIGZvciBkYXRlIHdyaXRlcy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBBY3RpdmUgdGltZXpvbmUgaWRlbnRpZmllci5cbiAgICovXG4gIHN0YXRpYyBfdGltZVpvbmVGb3JEYXRlV3JpdGUoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKVxuXG4gICAgcmV0dXJuIGNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0VGltZVpvbmUoY29uZmlndXJhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBzcWxpdGUgYm9vbGVhbiB2YWx1ZSBmb3IgaW5zZXJ0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gYXJncy5jb2x1bW5UeXBlIC0gQ29sdW1uIHR5cGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBWYWx1ZSB0byBub3JtYWxpemUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIF9ub3JtYWxpemVTcWxpdGVCb29sZWFuVmFsdWVGb3JJbnNlcnQoe2NvbHVtblR5cGUsIHZhbHVlfSkge1xuICAgIGlmICh0aGlzLmdldERhdGFiYXNlVHlwZSgpICE9IFwic3FsaXRlXCIpIHJldHVybiB2YWx1ZVxuICAgIGlmICghY29sdW1uVHlwZSkgcmV0dXJuIHZhbHVlXG4gICAgaWYgKGNvbHVtblR5cGUudG9Mb3dlckNhc2UoKSAhPT0gXCJib29sZWFuXCIpIHJldHVybiB2YWx1ZVxuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSkgcmV0dXJuIDFcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlKSByZXR1cm4gMFxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IHByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJlc29sdmVzIHdpdGggdGhlIG5leHQgcHJpbWFyeSBrZXkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgbmV4dFByaW1hcnlLZXkoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCB0YWJsZU5hbWUgPSB0aGlzLnRhYmxlTmFtZSgpXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvbigpXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubmFtZX0ubmV4dFByaW1hcnlLZXkoKSBkb2VzIG5vdCBzdXBwb3J0IGNvbXBvc2l0ZSBwcmltYXJ5IGtleXMuYClcblxuICAgIGNvbnN0IG5ld2VzdFJlY29yZCA9IGF3YWl0IHRoaXMub3JkZXIoYCR7Y29ubmVjdGlvbi5xdW90ZVRhYmxlKHRhYmxlTmFtZSl9LiR7Y29ubmVjdGlvbi5xdW90ZUNvbHVtbihwcmltYXJ5S2V5KX1gKS5sYXN0KClcblxuICAgIGlmIChuZXdlc3RSZWNvcmQpIHtcbiAgICAgIGNvbnN0IGlkID0gbmV3ZXN0UmVjb3JkLmlkKClcblxuICAgICAgaWYgKHR5cGVvZiBpZCA9PSBcIm51bWJlclwiKSB7XG4gICAgICAgIHJldHVybiBpZCArIDFcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIklEIGZyb20gbmV3ZXN0IHJlY29yZCB3YXNuJ3QgYSBudW1iZXJcIilcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIDFcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcHJpbWFyeSBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW10gfCBudWxsfSBwcmltYXJ5S2V5IC0gUHJpbWFyeSBrZXkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzZXRQcmltYXJ5S2V5KHByaW1hcnlLZXkpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkge1xuICAgICAgaWYgKHByaW1hcnlLZXkubGVuZ3RoID09PSAwKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ29tcG9zaXRlIHByaW1hcnkga2V5cyByZXF1aXJlIGF0IGxlYXN0IG9uZSBjb2x1bW4uXCIpXG5cbiAgICAgIGNvbnN0IHNlZW5Db2x1bW5zID0gbmV3IFNldCgpXG5cbiAgICAgIGZvciAoY29uc3QgY29sdW1uTmFtZSBvZiBwcmltYXJ5S2V5KSB7XG4gICAgICAgIGlmIChzZWVuQ29sdW1ucy5oYXMoY29sdW1uTmFtZSkpIHRocm93IG5ldyBUeXBlRXJyb3IoYENvbXBvc2l0ZSBwcmltYXJ5IGtleSBoYXMgZHVwbGljYXRlIGNvbHVtbjogJHtjb2x1bW5OYW1lfS5gKVxuXG4gICAgICAgIHNlZW5Db2x1bW5zLmFkZChjb2x1bW5OYW1lKVxuICAgICAgfVxuXG4gICAgICB0aGlzLl9wcmltYXJ5S2V5ID0gWy4uLnByaW1hcnlLZXldXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9wcmltYXJ5S2V5ID0gcHJpbWFyeUtleVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhpcyBjbGFzcydzIG93biBhdHRyaWJ1dGUtY2FzdCBtYXAsIGNyZWF0aW5nIGl0IG9uIHRoZSBjbGFzcyBpdHNlbGZcbiAgICogKG5ldmVyIGluaGVyaXRlZCBmcm9tIGEgcGFyZW50KSBzbyBzdWJjbGFzc2VzIGRvbid0IHNoYXJlIHRoZSBzYW1lIG9iamVjdC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZz59IC0gRGVjbGFyZWQgY2FzdHMga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0QXR0cmlidXRlQ2FzdHNNYXAoKSB7XG4gICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwodGhpcywgXCJfYXR0cmlidXRlQ2FzdHNcIikgfHwgIXRoaXMuX2F0dHJpYnV0ZUNhc3RzKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqL1xuICAgICAgdGhpcy5fYXR0cmlidXRlQ2FzdHMgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hdHRyaWJ1dGVDYXN0c1xuICB9XG5cbiAgLyoqXG4gICAqIERlY2xhcmVzIGEgUmFpbHMtc3R5bGUgcGVyLWF0dHJpYnV0ZSBjYXN0IHNvIGEgY29sdW1uIHdob3NlIGludHJvc3BlY3RlZCB0eXBlXG4gICAqIGlzbid0IHdoYXQgdGhlIGFwcCB3YW50cyAoZS5nLiBhbiBNU1NRTCBgYml0YCBtYXBwZWQgdG8gYG51bWJlcmApIGNhbiBiZVxuICAgKiBleHBvc2VkIGFzIGFub3RoZXIgdHlwZSB3aXRoIHJlYWwgcnVudGltZSBjb252ZXJzaW9uLiBDdXJyZW50bHkgZnVsbHlcbiAgICogaW1wbGVtZW50cyB0aGUgYFwiYm9vbGVhblwiYCBjYXN0ICgwLzEgPC0+IGZhbHNlL3RydWUpOyBvdGhlciB0eXBlcyBvbmx5IHJlY29yZFxuICAgKiB0aGUgbGFiZWwgc28gdGhlIGVmZmVjdGl2ZSB0eXBlIGFuZCBnZW5lcmF0ZWQgdHlwaW5ncyByZWZsZWN0IHRoZW0uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUgKGNhbWVsQ2FzZSksIGUuZy4gYFwic2ljaHRiYXJWVktcImAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0eXBlIC0gRGVjbGFyZWQgdHlwZSwgZS5nLiBgXCJib29sZWFuXCJgLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgYXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUsIHR5cGUpIHtcbiAgICB0aGlzLmdldEF0dHJpYnV0ZUNhc3RzTWFwKClbYXR0cmlidXRlTmFtZV0gPSB0eXBlXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZGVjbGFyZWQgY2FzdCB0eXBlIGZvciBhbiBhdHRyaWJ1dGUsIGlmIGFueS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZSAoY2FtZWxDYXNlKS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBEZWNsYXJlZCBjYXN0IHR5cGUsIG9yIHVuZGVmaW5lZCB3aGVuIG5vbmUgaXMgZGVjbGFyZWQuXG4gICAqL1xuICBzdGF0aWMgZ2V0QXR0cmlidXRlQ2FzdChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QXR0cmlidXRlQ2FzdHNNYXAoKVthdHRyaWJ1dGVOYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbWFyeSBrZXkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBzdHJpbmdbXX0gLSBUaGUgcHJpbWFyeSBrZXkuXG4gICAqL1xuICBzdGF0aWMgcHJpbWFyeUtleSgpIHtcbiAgICBpZiAodGhpcy5fcHJpbWFyeUtleSkgcmV0dXJuIHRoaXMuX3ByaW1hcnlLZXlcblxuICAgIHJldHVybiBcImlkXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBtb2RlbCBoYXMgYSBzaW5nbGUgcHJpbWFyeSBrZXkgY29sdW1uLiBgc2V0UHJpbWFyeUtleShudWxsKWAgKGUuZy4gY29tcG9zaXRlLWtleVxuICAgKiBsZWdhY3kgdGFibGVzKSBkZWNsYXJlcyBubyBzaW5nbGUgcHJpbWFyeSBrZXk7IGBwcmltYXJ5S2V5KClgIHN0aWxsIGZhbGxzIGJhY2sgdG8gXCJpZFwiIGZvciB0aGVcbiAgICogZGVmYXVsdCBjYXNlLCBzbyBjYWxsZXJzIHRoYXQgbXVzdCBkaXN0aW5ndWlzaCBcIm5vIHByaW1hcnkga2V5XCIgdXNlIHRoaXMgaW5zdGVhZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gRmFsc2Ugb25seSB3aGVuIHRoZSBwcmltYXJ5IGtleSB3YXMgZXhwbGljaXRseSBzZXQgdG8gbnVsbC5cbiAgICovXG4gIHN0YXRpYyBoYXNQcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiB0aGlzLl9wcmltYXJ5S2V5ICE9PSBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzYXZlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2F2ZSgpIHtcbiAgICBjb25zdCBpc05ld1JlY29yZCA9IHRoaXMuaXNOZXdSZWNvcmQoKVxuICAgIGxldCByZXN1bHRcblxuICAgIGNvbnN0IHNhdmUgPSBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJiZWZvcmVWYWxpZGF0aW9uXCIpXG4gICAgICBhd2FpdCB0aGlzLl9ydW5WYWxpZGF0aW9ucygpXG5cbiAgICAgIGNvbnN0IHNhdmVJblRyYW5zYWN0aW9uID0gYXN5bmMgKCkgPT4ge1xuICAgICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gKi9cbiAgICAgICAgbGV0IHBlcnNpc3RlZEF0dHJpYnV0ZXNCZWZvcmVVcGRhdGVcbiAgICAgICAgbGV0IHVwZGF0ZVJlbG9hZGVkID0gZmFsc2VcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImJlZm9yZVNhdmVcIilcblxuICAgICAgICAgIC8vIElmIGFueSBiZWxvbmdzLXRvLXJlbGF0aW9uc2hpcHMgd2FzIHNhdmVkLCB0aGVuIHVwZGF0ZWQtYXQgc2hvdWxkIHN0aWxsIGJlIHNldCBvbiB0aGlzIHJlY29yZC5cbiAgICAgICAgICBjb25zdCB7c2F2ZWRDb3VudH0gPSBhd2FpdCB0aGlzLl9hdXRvU2F2ZUJlbG9uZ3NUb1JlbGF0aW9uc2hpcHMoKVxuXG4gICAgICAgICAgaWYgKHRoaXMuaXNQZXJzaXN0ZWQoKSkge1xuICAgICAgICAgICAgcGVyc2lzdGVkQXR0cmlidXRlc0JlZm9yZVVwZGF0ZSA9IHsuLi50aGlzLl9hdHRyaWJ1dGVzfVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYmVmb3JlVXBkYXRlXCIpXG5cbiAgICAgICAgICAgIC8vIElmIGFueSBoYXMtbWFueS1yZWxhdGlvbnNoaXBzIHdpbGwgYmUgc2F2ZWQsIHRoZW4gdXBkYXRlZC1hdCBzaG91bGQgc3RpbGwgYmUgc2V0IG9uIHRoaXMgcmVjb3JkLlxuICAgICAgICAgICAgY29uc3QgYXV0b1NhdmVIYXNNYW55cmVsYXRpb25zaGlwcyA9IHRoaXMuX2F1dG9TYXZlSGFzTWFueUFuZEhhc09uZVJlbGF0aW9uc2hpcHNUb1NhdmUoKVxuXG4gICAgICAgICAgICBpZiAodGhpcy5faGFzQ2hhbmdlcygpIHx8IHNhdmVkQ291bnQgPiAwIHx8IGF1dG9TYXZlSGFzTWFueXJlbGF0aW9uc2hpcHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLl91cGRhdGVSZWNvcmRXaXRoQ2hhbmdlcygpXG4gICAgICAgICAgICAgIHVwZGF0ZVJlbG9hZGVkID0gdHJ1ZVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJhZnRlclVwZGF0ZVwiKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJiZWZvcmVDcmVhdGVcIilcbiAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuX2NyZWF0ZU5ld1JlY29yZCgpXG4gICAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJhZnRlckNyZWF0ZVwiKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGF3YWl0IHRoaXMuX2F1dG9TYXZlSGFzTWFueUFuZEhhc09uZVJlbGF0aW9uc2hpcHMoe2lzTmV3UmVjb3JkfSlcbiAgICAgICAgICBhd2FpdCB0aGlzLl9hdXRvU2F2ZUF0dGFjaG1lbnRzKClcbiAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJhZnRlclNhdmVcIilcbiAgICAgICAgICBhd2FpdCB0aGlzLl9lbWl0UmVjb3JkQ2hhbmdlQWZ0ZXJDb21taXQoaXNOZXdSZWNvcmQgPyBcImNyZWF0ZVwiIDogXCJ1cGRhdGVcIilcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBpZiAodXBkYXRlUmVsb2FkZWQgJiYgcGVyc2lzdGVkQXR0cmlidXRlc0JlZm9yZVVwZGF0ZSkge1xuICAgICAgICAgICAgdGhpcy5fYXR0cmlidXRlcyA9IHBlcnNpc3RlZEF0dHJpYnV0ZXNCZWZvcmVVcGRhdGVcbiAgICAgICAgICAgIHRoaXMuX2NoYW5nZXMgPSB7fVxuICAgICAgICAgICAgdGhpcy5fYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyA9IHVuZGVmaW5lZFxuICAgICAgICAgIH1cblxuICAgICAgICAgIHRocm93IGVycm9yXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLnRyYW5zYWN0aW9uKHNhdmVJblRyYW5zYWN0aW9uKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgdGhpcy5nZXRNb2RlbENsYXNzKCkudHJhbnNhY3Rpb24oc2F2ZUluVHJhbnNhY3Rpb24pXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSB7XG4gICAgICBhd2FpdCBzYXZlKClcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBzYXZlYH0sIHNhdmUpXG4gICAgfVxuXG4gICAgdGhpcy5fYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyA9IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgYXN5bmMgX2F1dG9TYXZlQmVsb25nc1RvUmVsYXRpb25zaGlwcygpIHtcbiAgICBsZXQgc2F2ZWRDb3VudCA9IDBcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT0gXCJiZWxvbmdzVG9cIikge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0QXV0b1NhdmUoKSA9PT0gZmFsc2UpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgbW9kZWwgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG5cbiAgICAgIGlmIChtb2RlbCkge1xuICAgICAgICBpZiAobW9kZWwgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkge1xuICAgICAgICAgIGlmIChtb2RlbC5pc0NoYW5nZWQoKSkge1xuICAgICAgICAgICAgdGhpcy5iaW5kUmVsYXRlZFJlY29yZChtb2RlbClcbiAgICAgICAgICAgIGF3YWl0IG1vZGVsLnNhdmUoKVxuXG4gICAgICAgICAgICBjb25zdCBmb3JlaWduS2V5ID0gdGhpcy5fcmVsYXRpb25zaGlwRm9yZWlnbktleUF0dHJpYnV0ZShpbnN0YW5jZVJlbGF0aW9uc2hpcClcbiAgICAgICAgICAgIGNvbnN0IGZvcmVpZ25LZXlWYWx1ZSA9IHRoaXMuX2JlbG9uZ3NUb0ZvcmVpZ25LZXlWYWx1ZSh7bW9kZWwsIHJlbGF0aW9uc2hpcDogaW5zdGFuY2VSZWxhdGlvbnNoaXB9KVxuXG4gICAgICAgICAgICB0aGlzLnNldEF0dHJpYnV0ZShmb3JlaWduS2V5LCBmb3JlaWduS2V5VmFsdWUpXG5cbiAgICAgICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwLnNldFByZWxvYWRlZCh0cnVlKVxuICAgICAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0RGlydHkoZmFsc2UpXG5cbiAgICAgICAgICAgIHNhdmVkQ291bnQrK1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGEgcmVjb3JkIGJ1dCBnb3Q6ICR7dHlwZW9mIG1vZGVsfWApXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge3NhdmVkQ291bnR9XG4gIH1cblxuICBfYXV0b1NhdmVIYXNNYW55QW5kSGFzT25lUmVsYXRpb25zaGlwc1RvU2F2ZSgpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBzID0gW11cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT0gXCJoYXNNYW55XCIgJiYgaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpICE9IFwiaGFzT25lXCIpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldEF1dG9TYXZlKCkgPT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8qKlxuICAgICAgICogRGVmaW5lcyBsb2FkZWQuXG4gICAgICAgKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXX0gKi9cbiAgICAgIGxldCBsb2FkZWRcblxuICAgICAgY29uc3QgaGFzTWFueU9yT25lTG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKVxuXG4gICAgICBpZiAoaGFzTWFueU9yT25lTG9hZGVkKSB7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGhhc01hbnlPck9uZUxvYWRlZCkpIHtcbiAgICAgICAgICBsb2FkZWQgPSBoYXNNYW55T3JPbmVMb2FkZWRcbiAgICAgICAgfSBlbHNlIGlmIChoYXNNYW55T3JPbmVMb2FkZWQgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkge1xuICAgICAgICAgIGxvYWRlZCA9IFtoYXNNYW55T3JPbmVMb2FkZWRdXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBoYXNPbmVMb2FkZWQgdG8gYmUgYSByZWNvcmQgYnV0IGl0IHdhc24ndDogJHt0eXBlb2YgaGFzTWFueU9yT25lTG9hZGVkfWApXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGxldCB1c2VSZWxhdGlvbnNoaXAgPSBmYWxzZVxuXG4gICAgICBpZiAobG9hZGVkKSB7XG4gICAgICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbG9hZGVkKSB7XG4gICAgICAgICAgdGhpcy5iaW5kUmVsYXRlZFJlY29yZChtb2RlbClcbiAgICAgICAgICBjb25zdCBmb3JlaWduS2V5ID0gbW9kZWwuX3JlbGF0aW9uc2hpcEZvcmVpZ25LZXlBdHRyaWJ1dGUoaW5zdGFuY2VSZWxhdGlvbnNoaXApXG5cbiAgICAgICAgICBtb2RlbC5zZXRBdHRyaWJ1dGUoZm9yZWlnbktleSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUodGhpcy5pZCgpLCBgSGFzLW1hbnkgYXV0b3NhdmUgZm9yICR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX1gKSlcblxuICAgICAgICAgIGlmIChtb2RlbC5pc0NoYW5nZWQoKSkge1xuICAgICAgICAgICAgdXNlUmVsYXRpb25zaGlwID0gdHJ1ZVxuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHVzZVJlbGF0aW9uc2hpcCkgcmVsYXRpb25zaGlwcy5wdXNoKGluc3RhbmNlUmVsYXRpb25zaGlwKVxuICAgIH1cblxuICAgIHJldHVybiByZWxhdGlvbnNoaXBzXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSByZWxhdGlvbnNoaXAgZm9yZWlnbi1rZXkgY29sdW1uIHRvIHRoaXMgbW9kZWwncyBwdWJsaWMgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdDx0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQsIHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD59IGluc3RhbmNlUmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBBdHRyaWJ1dGUgbmFtZSBhY2NlcHRlZCBieSBzZXRBdHRyaWJ1dGUvYXNzaWduLlxuICAgKi9cbiAgX3JlbGF0aW9uc2hpcEZvcmVpZ25LZXlBdHRyaWJ1dGUoaW5zdGFuY2VSZWxhdGlvbnNoaXApIHtcbiAgICBjb25zdCBmb3JlaWduS2V5ID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG5cbiAgICByZXR1cm4gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW2ZvcmVpZ25LZXldIHx8IGZvcmVpZ25LZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF1dG8gc2F2ZSBoYXMgbWFueSBhbmQgaGFzIG9uZSByZWxhdGlvbnNoaXBzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuaXNOZXdSZWNvcmQgLSBXaGV0aGVyIGlzIG5ldyByZWNvcmQuXG4gICAqL1xuICBhc3luYyBfYXV0b1NhdmVIYXNNYW55QW5kSGFzT25lUmVsYXRpb25zaGlwcyh7aXNOZXdSZWNvcmR9KSB7XG4gICAgZm9yIChjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCBvZiB0aGlzLl9hdXRvU2F2ZUhhc01hbnlBbmRIYXNPbmVSZWxhdGlvbnNoaXBzVG9TYXZlKCkpIHtcbiAgICAgIGxldCBoYXNNYW55T3JPbmVMb2FkZWQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG5cbiAgICAgIC8qKlxuICAgICAgICogRGVmaW5lcyBsb2FkZWQuXG4gICAgICAgKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXX0gKi9cbiAgICAgIGxldCBsb2FkZWRcblxuICAgICAgaWYgKGhhc01hbnlPck9uZUxvYWRlZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGxvYWRlZCA9IFtdXG4gICAgICB9IGVsc2UgaWYgKGhhc01hbnlPck9uZUxvYWRlZCBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSB7XG4gICAgICAgIGxvYWRlZCA9IFtoYXNNYW55T3JPbmVMb2FkZWRdXG4gICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoaGFzTWFueU9yT25lTG9hZGVkKSkge1xuICAgICAgICBsb2FkZWQgPSBoYXNNYW55T3JPbmVMb2FkZWRcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCB0eXBlIGZvciBoYXNNYW55T3JPbmVMb2FkZWQ6ICR7dHlwZW9mIGhhc01hbnlPck9uZUxvYWRlZH1gKVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIGxvYWRlZCkge1xuICAgICAgICB0aGlzLmJpbmRSZWxhdGVkUmVjb3JkKG1vZGVsKVxuICAgICAgICBjb25zdCBmb3JlaWduS2V5ID0gbW9kZWwuX3JlbGF0aW9uc2hpcEZvcmVpZ25LZXlBdHRyaWJ1dGUoaW5zdGFuY2VSZWxhdGlvbnNoaXApXG5cbiAgICAgICAgbW9kZWwuc2V0QXR0cmlidXRlKGZvcmVpZ25LZXksIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKHRoaXMuaWQoKSwgYEhhcy1tYW55IGF1dG9zYXZlIGZvciAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9YCkpXG5cbiAgICAgICAgaWYgKG1vZGVsLmlzQ2hhbmdlZCgpKSB7XG4gICAgICAgICAgYXdhaXQgbW9kZWwuc2F2ZSgpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGlzTmV3UmVjb3JkKSB7XG4gICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwLnNldFByZWxvYWRlZCh0cnVlKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF1dG8gc2F2ZSBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwZW5kaW5nIGF0dGFjaG1lbnRzIGhhdmUgYmVlbiBzYXZlZC5cbiAgICovXG4gIGFzeW5jIF9hdXRvU2F2ZUF0dGFjaG1lbnRzKCkge1xuICAgIGZvciAoY29uc3QgYXR0YWNobWVudE5hbWUgaW4gdGhpcy5fYXR0YWNobWVudHMpIHtcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnQgPSB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV1cblxuICAgICAgaWYgKCFhdHRhY2htZW50Lmhhc1BlbmRpbmdBdHRhY2htZW50cygpKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCBhdHRhY2htZW50LmZsdXNoUGVuZGluZ0F0dGFjaG1lbnRzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0YWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0YWJsZSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIHRhYmxlTmFtZSgpIHtcbiAgICBpZiAoIXRoaXMuX3RhYmxlTmFtZSkgdGhpcy5fdGFibGVOYW1lID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKGluZmxlY3Rpb24ucGx1cmFsaXplKHRoaXMuZ2V0TW9kZWxOYW1lKCkpKVxuXG4gICAgcmV0dXJuIHRoaXMuX3RhYmxlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBUYWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2V0VGFibGVOYW1lKHRhYmxlTmFtZSkge1xuICAgIHRoaXMuX3RhYmxlTmFtZSA9IHRhYmxlTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHRyYW5zYWN0aW9uLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHRyYW5zYWN0aW9uKGNhbGxiYWNrKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCB1c2VUcmFuc2FjdGlvbnMgPSB0aGlzLmNvbm5lY3Rpb24oKS5nZXRBcmdzKCkucmVjb3JkPy50cmFuc2FjdGlvbnNcblxuICAgIGlmICh1c2VUcmFuc2FjdGlvbnMgIT09IGZhbHNlKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkudHJhbnNhY3Rpb24oY2FsbGJhY2spXG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIGNhbGxiYWNrIHdoaWxlIGhvbGRpbmcgYSBuYW1lZCBhZHZpc29yeSBsb2NrLiBDYWxscyB3aXRob3V0XG4gICAqIEJ5IGRlZmF1bHQgY2FsbHMgdXNlIHRoZSBjYWxsZXIgY29ubmVjdGlvbi4gQ2FsbHMgd2l0aCBgZGVkaWNhdGVkQ29ubmVjdGlvbmBcbiAgICogdXNlIGEgc3Bhd25lZCBsb2NrIGNvbm5lY3Rpb24gdGhhdCBpcyByZWxlYXNlZCBhZnRlciB0aGUgY2FsbGJhY2sgZmluaXNoZXMsXG4gICAqIHdoaWxlIHRoZSBjYWxsYmFjayBpdHNlbGYgc3RpbGwgcnVucyBhZ2FpbnN0IHRoZSBjYWxsZXIvbW9kZWwgY29ubmVjdGlvbi5cbiAgICogQ2FsbHMgd2l0aCBhIHBvc2l0aXZlIGBob2xkVGltZW91dE1zYCB1c2UgYSBkZWRpY2F0ZWQgbG9jayBjb25uZWN0aW9uIHNvXG4gICAqIHRpbWVvdXQgY2xlYW51cCBjYW4gcmVsZWFzZSB0aGUgbG9jayBldmVuIHdoZW4gY2FsbGJhY2sgZGF0YWJhc2Ugd29yayBpc1xuICAgKiBzdHVjay4gQWR2aXNvcnkgbG9ja3MgYXJlIGNvb3BlcmF0aXZlIGFuZCBzZXNzaW9uLXNjb3BlZDogdGhleSBzZXJpYWxpemVcbiAgICogY2FsbGVycyB0aGF0IG9wdCBpbnRvIHRoZSBzYW1lIGBuYW1lYCwgd2l0aG91dCB0b3VjaGluZyByb3cgb3IgdGFibGUgbG9ja3MsXG4gICAqIHNvIHVucmVsYXRlZCB0cmFmZmljIGlzIGZyZWUgdG8gcHJvY2VlZC5cbiAgICpcbiAgICogVGhlIGxvY2sgaXMgYWNxdWlyZWQgYmVmb3JlIHRoZSBjYWxsYmFjayBydW5zIGFuZCByZWxlYXNlZCBpbiBhXG4gICAqIGBmaW5hbGx5YCBibG9jayBhZnRlcndhcmRzLCBzbyB0aGUgY2FsbGJhY2sncyByZXR1cm4gdmFsdWUgaXNcbiAgICogcHJvcGFnYXRlZCBhbmQgdGhyb3duIGVycm9ycyBzdGlsbCByZWxlYXNlIHRoZSBsb2NrLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIGludm9rZSB3aGlsZSB0aGUgbG9jayBpcyBoZWxkLlxuICAgKiBAcGFyYW0ge3t0aW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBob2xkVGltZW91dE1zPzogbnVtYmVyIHwgbnVsbCwgZGVkaWNhdGVkQ29ubmVjdGlvbj86IGJvb2xlYW59fSBbYXJnc10gLSBgdGltZW91dE1zYCBjYXBzIGhvdyBsb25nIHdlIHdhaXQgdG8gYWNxdWlyZSB0aGUgbG9jazsgYGhvbGRUaW1lb3V0TXNgIGNhcHMgaG93IGxvbmcgdGhlIGNhbGxiYWNrIG1heSBob2xkIGl0IGJlZm9yZSB0aGUgbG9jayBpcyByZWxlYXNlZCBhbmQgYEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3JgIGlzIHRocm93bjsgYGRlZGljYXRlZENvbm5lY3Rpb25gIHNwYXducyBhIHNlcGFyYXRlIGxvY2sgc2Vzc2lvbiB3aXRob3V0IGVuYWJsaW5nIGEgaG9sZCB0aW1lb3V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjaydzIHJldHVybiB2YWx1ZS5cbiAgICogQHRocm93cyB7QWR2aXNvcnlMb2NrVGltZW91dEVycm9yfSAtIElmIGB0aW1lb3V0TXNgIGVsYXBzZXMgYmVmb3JlIHRoZSBsb2NrIGlzIGdyYW50ZWQuXG4gICAqIEB0aHJvd3Mge0Fkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3J9IC0gSWYgYGhvbGRUaW1lb3V0TXNgIGVsYXBzZXMgd2hpbGUgdGhlIGNhbGxiYWNrIGhvbGRzIHRoZSBsb2NrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHdpdGhBZHZpc29yeUxvY2sobmFtZSwgY2FsbGJhY2ssIGFyZ3MgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcnVubmVyID0gbmV3IEFkdmlzb3J5TG9ja1J1bm5lcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICBjb25uZWN0aW9uUHJvdmlkZXI6ICgpID0+IHRoaXMuY29ubmVjdGlvbigpLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgfSlcblxuICAgIHJldHVybiBhd2FpdCBydW5uZXIud2l0aEFkdmlzb3J5TG9jayhuYW1lLCBjYWxsYmFjaywgYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRoZSBjYWxsYmFjayBvbmx5IGlmIHRoZSBuYW1lZCBhZHZpc29yeSBsb2NrIGNhbiBiZSBhY3F1aXJlZFxuICAgKiBpbW1lZGlhdGVseS4gSWYgdGhlIGxvY2sgaXMgYWxyZWFkeSBoZWxkIGJ5IGFueSBzZXNzaW9uLCB0aHJvd3NcbiAgICogYEFkdmlzb3J5TG9ja0J1c3lFcnJvcmAgd2l0aG91dCB3YWl0aW5nLlxuICAgKiBVc2UgdGhpcyB3aGVuIGNvbnRlbnRpb24gaXMgYSBzaWduYWwgdGhhdCBzb21lYm9keSBlbHNlIGlzIGFscmVhZHlcbiAgICogZG9pbmcgdGhlIHdvcmsgYW5kIHlvdSB3YW50IHRvIGJhaWwgb3V0IHJhdGhlciB0aGFuIHF1ZXVlIHVwLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIGludm9rZSB3aGlsZSB0aGUgbG9jayBpcyBoZWxkLlxuICAgKiBAcGFyYW0ge3tob2xkVGltZW91dE1zPzogbnVtYmVyIHwgbnVsbCwgZGVkaWNhdGVkQ29ubmVjdGlvbj86IGJvb2xlYW59fSBbYXJnc10gLSBgaG9sZFRpbWVvdXRNc2AgY2FwcyBob3cgbG9uZyB0aGUgY2FsbGJhY2sgbWF5IGhvbGQgdGhlIGxvY2sgYmVmb3JlIGl0IGlzIHJlbGVhc2VkIGFuZCBgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcmAgaXMgdGhyb3duOyBgZGVkaWNhdGVkQ29ubmVjdGlvbmAgc3Bhd25zIGEgc2VwYXJhdGUgbG9jayBzZXNzaW9uIHdpdGhvdXQgZW5hYmxpbmcgYSBob2xkIHRpbWVvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrJ3MgcmV0dXJuIHZhbHVlLlxuICAgKiBAdGhyb3dzIHtBZHZpc29yeUxvY2tCdXN5RXJyb3J9IC0gSWYgdGhlIGxvY2sgaXMgYWxyZWFkeSBoZWxkLlxuICAgKiBAdGhyb3dzIHtBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yfSAtIElmIGBob2xkVGltZW91dE1zYCBlbGFwc2VzIHdoaWxlIHRoZSBjYWxsYmFjayBob2xkcyB0aGUgbG9jay5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB3aXRoQWR2aXNvcnlMb2NrT3JGYWlsKG5hbWUsIGNhbGxiYWNrLCBhcmdzID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIGNvbnN0IHJ1bm5lciA9IG5ldyBBZHZpc29yeUxvY2tSdW5uZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgY29ubmVjdGlvblByb3ZpZGVyOiAoKSA9PiB0aGlzLmNvbm5lY3Rpb24oKSxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIH0pXG5cbiAgICByZXR1cm4gYXdhaXQgcnVubmVyLndpdGhBZHZpc29yeUxvY2tPckZhaWwobmFtZSwgY2FsbGJhY2ssIGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBgY2FsbGJhY2tgLCByZWplY3Rpbmcgd2l0aCBgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcmAgaWYgaXQgaGFzXG4gICAqIG5vdCBzZXR0bGVkIHdpdGhpbiBgaG9sZFRpbWVvdXRNc2AuIFRoZSBjYWxsYmFjayBpcyBub3QgY2FuY2VsbGVkIOKAlCB0aGlzIGlzXG4gICAqIGEgc2FmZXR5IG5ldCwgbm90IGNhbmNlbGxhdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUgKGZvciB0aGUgZXJyb3IgbWVzc2FnZSkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBob2xkaW5nIHRoZSBsb2NrLlxuICAgKiBAcGFyYW0ge251bWJlciB8IG51bGx9IFtob2xkVGltZW91dE1zXSAtIE1heCBob2xkIHRpbWU7IGZhbHN5IGRpc2FibGVzIHRoZSB0aW1lb3V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQgYWZ0ZXIgdGhlIGxvY2stcHJvdGVjdGVkIG9wZXJhdGlvbi5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBydW5XaXRoQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXQobmFtZSwgY2FsbGJhY2ssIGhvbGRUaW1lb3V0TXMpIHtcbiAgICByZXR1cm4gYXdhaXQgQWR2aXNvcnlMb2NrUnVubmVyLnJ1bldpdGhBZHZpc29yeUxvY2tIb2xkVGltZW91dChuYW1lLCBjYWxsYmFjaywgaG9sZFRpbWVvdXRNcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRydWUgaWYgdGhlIG5hbWVkIGFkdmlzb3J5IGxvY2sgaXMgY3VycmVudGx5IGhlbGQgYnkgYW55XG4gICAqIHNlc3Npb24uIFByaW1hcmlseSB1c2VmdWwgYXMgYSBkaWFnbm9zdGljOyBjYWxsZXJzIHRoYXQgd2FudCB0byBhY3RcbiAgICogb24gdGhlIHJlc3VsdCBzaG91bGQgcHJlZmVyIGB3aXRoQWR2aXNvcnlMb2NrT3JGYWlsYCB0byBhdm9pZCBhXG4gICAqIFRPQ1RPVSB3aW5kb3cgYmV0d2VlbiB0aGUgY2hlY2sgYW5kIHRoZSBhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoZSBhZHZpc29yeSBsb2NrIGlzIGN1cnJlbnRseSBoZWxkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGhhc0Fkdmlzb3J5TG9jayhuYW1lKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkuaXNBZHZpc29yeUxvY2tIZWxkKG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cmFuc2xhdGVzLlxuICAgKiBAcGFyYW0gey4uLnN0cmluZ30gbmFtZXMgLSBOYW1lcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHRyYW5zbGF0ZXMoLi4ubmFtZXMpIHtcbiAgICBjb25zdCB0cmFuc2xhdGlvbnMgPSB0aGlzLmdldFRyYW5zbGF0aW9uc01hcCgpXG5cbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgbmFtZXMpIHtcbiAgICAgIGlmIChuYW1lIGluIHRyYW5zbGF0aW9ucykgdGhyb3cgbmV3IEVycm9yKGBUcmFuc2xhdGlvbiBhbHJlYWR5IGV4aXN0czogJHtuYW1lfWApXG5cbiAgICAgIHRyYW5zbGF0aW9uc1tuYW1lXSA9IHt9XG5cbiAgICAgIGlmICghdGhpcy5fcmVsYXRpb25zaGlwRXhpc3RzKFwidHJhbnNsYXRpb25zXCIpKSB7XG4gICAgICAgIHRoaXMuX2RlZmluZVJlbGF0aW9uc2hpcChcInRyYW5zbGF0aW9uc1wiLCB7ZGVwZW5kZW50OiBcImRlc3Ryb3lcIiwga2xhc3M6IHRoaXMuZ2V0VHJhbnNsYXRpb25DbGFzcygpLCB0eXBlOiBcImhhc01hbnlcIn0pXG4gICAgICB9XG5cbiAgICAgIGlmICghdGhpcy5fcmVsYXRpb25zaGlwRXhpc3RzKFwiY3VycmVudFRyYW5zbGF0aW9uXCIpKSB7XG4gICAgICAgIHRoaXMuX2RlZmluZVJlbGF0aW9uc2hpcChcImN1cnJlbnRUcmFuc2xhdGlvblwiLCB7XG4gICAgICAgICAga2xhc3M6IHRoaXMuZ2V0VHJhbnNsYXRpb25DbGFzcygpLFxuICAgICAgICAgIHNjb3BlOiAocXVlcnkpID0+IHRoaXMuY3VycmVudFRyYW5zbGF0aW9uU2NvcGUocXVlcnkpLFxuICAgICAgICAgIHR5cGU6IFwiaGFzT25lXCJcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjdXJyZW50IHRyYW5zbGF0aW9uIHNjb3BlLlxuICAgKiBAcGFyYW0ge01vZGVsQ2xhc3NRdWVyeX0gcXVlcnkgLSBUcmFuc2xhdGlvbiBxdWVyeS5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeX0gLSBTY29wZWQgcXVlcnkuXG4gICAqL1xuICBzdGF0aWMgY3VycmVudFRyYW5zbGF0aW9uU2NvcGUocXVlcnkpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgbG9jYWxlID0gY29uZmlndXJhdGlvbi5nZXRMb2NhbGUoKVxuICAgIGNvbnN0IGZhbGxiYWNrcyA9IGNvbmZpZ3VyYXRpb24uZ2V0TG9jYWxlRmFsbGJhY2tzKClcbiAgICBjb25zdCBsb2NhbGVzID0gbG9jYWxlID8gKGZhbGxiYWNrcz8uW2xvY2FsZV0gfHwgW2xvY2FsZV0pIDogW11cblxuICAgIGlmIChsb2NhbGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHF1ZXJ5LndoZXJlKFwiMT0wXCIpXG5cbiAgICBjb25zdCBkcml2ZXIgPSBxdWVyeS5kcml2ZXJcbiAgICBjb25zdCB0cmFuc2xhdGlvbkNsYXNzID0gdGhpcy5nZXRUcmFuc2xhdGlvbkNsYXNzKClcbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShcImN1cnJlbnRUcmFuc2xhdGlvblwiKVxuICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRyYW5zbGF0aW9uQ2xhc3MudGFibGVOYW1lKClcbiAgICBjb25zdCBzY29wZVRhYmxlUmVmZXJlbmNlID0gYCR7dGFibGVOYW1lfV9jdXJyZW50X3RyYW5zbGF0aW9uX3Njb3BlYFxuICAgIGNvbnN0IHRhcmdldFRhYmxlU3FsID0gZHJpdmVyLnF1b3RlVGFibGUocXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKCkpXG4gICAgY29uc3Qgc2NvcGVUYWJsZVNxbCA9IGRyaXZlci5xdW90ZVRhYmxlKHNjb3BlVGFibGVSZWZlcmVuY2UpXG4gICAgY29uc3Qgc2NvcGVUYWJsZUZyb21TcWwgPSBgJHtkcml2ZXIucXVvdGVUYWJsZSh0YWJsZU5hbWUpfSBBUyAke3Njb3BlVGFibGVTcWx9YFxuICAgIGNvbnN0IHByaW1hcnlLZXlDb2x1bW4gPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkodHJhbnNsYXRpb25DbGFzcy5wcmltYXJ5S2V5KCksIGBDdXJyZW50IHRyYW5zbGF0aW9uIHNjb3BlIGZvciAke3RyYW5zbGF0aW9uQ2xhc3MubmFtZX1gKVxuICAgIGNvbnN0IGZvcmVpZ25LZXlDb2x1bW4gPSByZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG4gICAgY29uc3QgdGFyZ2V0UHJpbWFyeUtleVNxbCA9IGAke3RhcmdldFRhYmxlU3FsfS4ke2RyaXZlci5xdW90ZUNvbHVtbihwcmltYXJ5S2V5Q29sdW1uKX1gXG4gICAgY29uc3QgdGFyZ2V0Rm9yZWlnbktleVNxbCA9IGAke3RhcmdldFRhYmxlU3FsfS4ke2RyaXZlci5xdW90ZUNvbHVtbihmb3JlaWduS2V5Q29sdW1uKX1gXG4gICAgY29uc3Qgc2NvcGVQcmltYXJ5S2V5U3FsID0gYCR7c2NvcGVUYWJsZVNxbH0uJHtkcml2ZXIucXVvdGVDb2x1bW4ocHJpbWFyeUtleUNvbHVtbil9YFxuICAgIGNvbnN0IHNjb3BlRm9yZWlnbktleVNxbCA9IGAke3Njb3BlVGFibGVTcWx9LiR7ZHJpdmVyLnF1b3RlQ29sdW1uKGZvcmVpZ25LZXlDb2x1bW4pfWBcbiAgICBjb25zdCBzY29wZUxvY2FsZVNxbCA9IGAke3Njb3BlVGFibGVTcWx9LiR7ZHJpdmVyLnF1b3RlQ29sdW1uKFwibG9jYWxlXCIpfWBcbiAgICBjb25zdCBsb2NhbGVMaXN0U3FsID0gbG9jYWxlcy5tYXAoKGZhbGxiYWNrTG9jYWxlKSA9PiBkcml2ZXIucXVvdGUoZmFsbGJhY2tMb2NhbGUpKS5qb2luKFwiLCBcIilcbiAgICBjb25zdCBsb2NhbGVPcmRlclNxbCA9IGxvY2FsZXMubWFwKChmYWxsYmFja0xvY2FsZSwgaW5kZXgpID0+IGBXSEVOICR7c2NvcGVMb2NhbGVTcWx9ID0gJHtkcml2ZXIucXVvdGUoZmFsbGJhY2tMb2NhbGUpfSBUSEVOICR7ZHJpdmVyLnF1b3RlKGluZGV4KX1gKS5qb2luKFwiIFwiKVxuICAgIGNvbnN0IGZhbGxiYWNrT3JkZXJTcWwgPSBgQ0FTRSAke2xvY2FsZU9yZGVyU3FsfSBFTFNFICR7ZHJpdmVyLnF1b3RlKGxvY2FsZXMubGVuZ3RoKX0gRU5EYFxuICAgIGNvbnN0IHNlbGVjdGVkVHJhbnNsYXRpb25TcWwgPSBkcml2ZXIuZ2V0VHlwZSgpID09IFwibXNzcWxcIlxuICAgICAgPyBgU0VMRUNUIFRPUCAxICR7c2NvcGVQcmltYXJ5S2V5U3FsfSBGUk9NICR7c2NvcGVUYWJsZUZyb21TcWx9IFdIRVJFICR7c2NvcGVGb3JlaWduS2V5U3FsfSA9ICR7dGFyZ2V0Rm9yZWlnbktleVNxbH0gQU5EICR7c2NvcGVMb2NhbGVTcWx9IElOICgke2xvY2FsZUxpc3RTcWx9KSBPUkRFUiBCWSAke2ZhbGxiYWNrT3JkZXJTcWx9LCAke3Njb3BlUHJpbWFyeUtleVNxbH0gQVNDYFxuICAgICAgOiBgU0VMRUNUICR7c2NvcGVQcmltYXJ5S2V5U3FsfSBGUk9NICR7c2NvcGVUYWJsZUZyb21TcWx9IFdIRVJFICR7c2NvcGVGb3JlaWduS2V5U3FsfSA9ICR7dGFyZ2V0Rm9yZWlnbktleVNxbH0gQU5EICR7c2NvcGVMb2NhbGVTcWx9IElOICgke2xvY2FsZUxpc3RTcWx9KSBPUkRFUiBCWSAke2ZhbGxiYWNrT3JkZXJTcWx9LCAke3Njb3BlUHJpbWFyeUtleVNxbH0gQVNDIExJTUlUIDFgXG5cbiAgICByZXR1cm4gcXVlcnkud2hlcmUoYCR7dGFyZ2V0UHJpbWFyeUtleVNxbH0gPSAoJHtzZWxlY3RlZFRyYW5zbGF0aW9uU3FsfSlgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0aW9uIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAtIFRoZSB0cmFuc2xhdGlvbiBjbGFzcy5cbiAgICovXG4gIHN0YXRpYyBnZXRUcmFuc2xhdGlvbkNsYXNzKCkge1xuICAgIGlmICh0aGlzLl90cmFuc2xhdGlvbkNsYXNzKSByZXR1cm4gdGhpcy5fdHJhbnNsYXRpb25DbGFzc1xuICAgIGlmICh0aGlzLnRhYmxlTmFtZSgpLmVuZHNXaXRoKFwiX3RyYW5zbGF0aW9uc1wiKSkgdGhyb3cgbmV3IEVycm9yKFwiVHJ5aW5nIHRvIGRlZmluZSBhIHRyYW5zbGF0aW9ucyBjbGFzcyBmb3IgYSB0cmFuc2xhdGlvbiBjbGFzc1wiKVxuXG4gICAgY29uc3QgY2xhc3NOYW1lID0gYCR7dGhpcy5nZXRNb2RlbE5hbWUoKX1UcmFuc2xhdGlvbmBcbiAgICBjb25zdCBUcmFuc2xhdGlvbkNsYXNzID0gY2xhc3MgVHJhbnNsYXRpb24gZXh0ZW5kcyBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCB7fVxuICAgIGNvbnN0IGJlbG9uZ3NUbyA9IHNpbmd1bGFyaXplTW9kZWxOYW1lKGluZmxlY3Rpb24uY2FtZWxpemUodGhpcy50YWJsZU5hbWUoKSwgdHJ1ZSkpXG5cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoVHJhbnNsYXRpb25DbGFzcywgXCJuYW1lXCIsIHt2YWx1ZTogY2xhc3NOYW1lfSlcbiAgICBUcmFuc2xhdGlvbkNsYXNzLnNldFRhYmxlTmFtZSh0aGlzLmdldFRyYW5zbGF0aW9uc1RhYmxlTmFtZSgpKVxuICAgIFRyYW5zbGF0aW9uQ2xhc3MuYmVsb25nc1RvKGJlbG9uZ3NUbylcblxuICAgIGlmICh0aGlzLmhhc1RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKCkpIHtcbiAgICAgIGNvbnN0IHRyYW5zbGF0ZWRNb2RlbENsYXNzID0gdGhpc1xuXG4gICAgICBUcmFuc2xhdGlvbkNsYXNzLnN3aXRjaGVzVGVuYW50RGF0YWJhc2UoKHt0ZW5hbnR9KSA9PiB0cmFuc2xhdGVkTW9kZWxDbGFzcy5nZXRUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIodGVuYW50KSlcbiAgICB9XG5cbiAgICB0aGlzLl90cmFuc2xhdGlvbkNsYXNzID0gVHJhbnNsYXRpb25DbGFzc1xuXG4gICAgcmV0dXJuIHRoaXMuX3RyYW5zbGF0aW9uQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0cmFuc2xhdGlvbnMgdGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgdHJhbnNsYXRpb25zIHRhYmxlIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0VHJhbnNsYXRpb25zVGFibGVOYW1lKCkge1xuICAgIGNvbnN0IHRhYmxlTmFtZVBhcnRzID0gdGhpcy50YWJsZU5hbWUoKS5zcGxpdChcIl9cIilcblxuICAgIHRhYmxlTmFtZVBhcnRzW3RhYmxlTmFtZVBhcnRzLmxlbmd0aCAtIDFdID0gaW5mbGVjdGlvbi5zaW5ndWxhcml6ZSh0YWJsZU5hbWVQYXJ0c1t0YWJsZU5hbWVQYXJ0cy5sZW5ndGggLSAxXSlcblxuICAgIHJldHVybiBgJHt0YWJsZU5hbWVQYXJ0cy5qb2luKFwiX1wiKX1fdHJhbnNsYXRpb25zYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHRyYW5zbGF0aW9ucyB0YWJsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgd2l0aCBXaGV0aGVyIGl0IGhhcyB0cmFuc2xhdGlvbnMgdGFibGUuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgaGFzVHJhbnNsYXRpb25zVGFibGUoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLmdldFRhYmxlQnlOYW1lKHRoaXMuZ2V0VHJhbnNsYXRpb25zVGFibGVOYW1lKCkpXG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWRkcyBhIHZhbGlkYXRpb24gdG8gYW4gYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSBUaGUgbmFtZSBvZiB0aGUgYXR0cmlidXRlIHRvIHZhbGlkYXRlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSB2YWxpZGF0b3JzIFRoZSB2YWxpZGF0b3JzIHRvIGFkZC4gS2V5IGlzIHRoZSB2YWxpZGF0b3IgbmFtZSwgdmFsdWUgaXMgdGhlIHZhbGlkYXRvciBhcmd1bWVudHMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgdmFsaWRhdGVzKGF0dHJpYnV0ZU5hbWUsIHZhbGlkYXRvcnMpIHtcbiAgICBmb3IgKGNvbnN0IHZhbGlkYXRvck5hbWUgaW4gdmFsaWRhdG9ycykge1xuICAgICAgLyoqXG4gICAgICAgKiBEZWZpbmVzIHZhbGlkYXRvckFyZ3MuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgbGV0IHZhbGlkYXRvckFyZ3NcblxuICAgICAgLyoqXG4gICAgICAgKiBVc2UgdmFsaWRhdG9yLlxuICAgICAgICogQHR5cGUge2Jvb2xlYW59ICovXG4gICAgICBsZXQgdXNlVmFsaWRhdG9yID0gdHJ1ZVxuXG4gICAgICBjb25zdCB2YWxpZGF0b3JBcmdzQ2FuZGlkYXRlID0gdmFsaWRhdG9yc1t2YWxpZGF0b3JOYW1lXVxuXG4gICAgICBpZiAodHlwZW9mIHZhbGlkYXRvckFyZ3NDYW5kaWRhdGUgPT0gXCJib29sZWFuXCIpIHtcbiAgICAgICAgdmFsaWRhdG9yQXJncyA9IHt9XG4gICAgICAgIHVzZVZhbGlkYXRvclxuXG4gICAgICAgIGlmICghdmFsaWRhdG9yQXJnc0NhbmRpZGF0ZSkge1xuICAgICAgICAgIHVzZVZhbGlkYXRvciA9IGZhbHNlXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhbGlkYXRvckFyZ3MgPSB2YWxpZGF0b3JBcmdzQ2FuZGlkYXRlXG4gICAgICB9XG5cbiAgICAgIGlmICghdXNlVmFsaWRhdG9yKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IFZhbGlkYXRvckNsYXNzID0gdGhpcy5nZXRWYWxpZGF0b3JUeXBlKHZhbGlkYXRvck5hbWUpXG4gICAgICBjb25zdCB2YWxpZGF0b3IgPSBuZXcgVmFsaWRhdG9yQ2xhc3Moe2F0dHJpYnV0ZU5hbWUsIGFyZ3M6IHZhbGlkYXRvckFyZ3N9KVxuXG4gICAgICBpZiAoIXRoaXMuX3ZhbGlkYXRvcnMpIHRoaXMuX3ZhbGlkYXRvcnMgPSB7fVxuICAgICAgaWYgKCEoYXR0cmlidXRlTmFtZSBpbiB0aGlzLl92YWxpZGF0b3JzKSkgdGhpcy5fdmFsaWRhdG9yc1thdHRyaWJ1dGVOYW1lXSA9IFtdXG5cbiAgICAgIHRoaXMuX3ZhbGlkYXRvcnNbYXR0cmlidXRlTmFtZV0ucHVzaCh2YWxpZGF0b3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBnYXAtbGVzcyBwb3NpdGlvbmFsIGxpc3QgY2FsbGJhY2tzIGZvciBhIGNvbHVtbiBzY29wZWQgYnlcbiAgICogYW5vdGhlciBjb2x1bW4uIEluc2VydHMgYW5kIG1vdmVzIHNoaWZ0IHN1cnJvdW5kaW5nIHBvc2l0aW9ucyBzbyB0aGVcbiAgICogbGlzdCBzdGF5cyBjb21wYWN0ICgxLDIsMywuLi4pLiBEZXN0cm95cyBjbG9zZSB0aGUgcmVzdWx0aW5nIGdhcC5cbiAgICpcbiAgICogQ2FsbGVycyBtdXN0IGVuc3VyZSBhIFVOSVFVRSBpbmRleCBvbiAoc2NvcGVDb2x1bW4sIHBvc2l0aW9uQ29sdW1uKVxuICAgKiBleGlzdHMgaW4gdGhlIGRhdGFiYXNlIOKAlCB1c2UgYE1pZ3JhdGlvbi5hZGRBY3RzQXNMaXN0KClgIGZvciB0aGVcbiAgICogc2NoZW1hIGhhbGYuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwb3NpdGlvbkNvbHVtbiAtIGNhbWVsQ2FzZSBwb3NpdGlvbiBhdHRyaWJ1dGUgKGUuZy4gXCJyb3dOdW1iZXJcIikuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBvcHRpb25zIC0gT3B0aW9ucyB3aXRoIGEgcmVxdWlyZWQgc2NvcGUgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3B0aW9ucy5zY29wZSAtIGNhbWVsQ2FzZSBzY29wZSBhdHRyaWJ1dGUgKGUuZy4gXCJib2FyZENvbHVtbklkXCIpLlxuICAgKi9cbiAgc3RhdGljIGFjdHNBc0xpc3QocG9zaXRpb25Db2x1bW4sIG9wdGlvbnMpIHtcbiAgICBjb25zdCB7c2NvcGV9ID0gb3B0aW9uc1xuXG4gICAgcmVnaXN0ZXJBY3RzQXNMaXN0Q2FsbGJhY2tzKHRoaXMsIHBvc2l0aW9uQ29sdW1uLCB7c2NvcGV9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJhbnNsYXRpb25zIGxvYWRlZC5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtUcmFuc2xhdGlvbkJhc2VbXX0gLSBUaGUgdHJhbnNsYXRpb25zIGxvYWRlZC5cbiAgICovXG4gIHRyYW5zbGF0aW9uc0xvYWRlZCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCIndHJhbnNsYXRpb25zTG9hZGVkJyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0cmFuc2xhdGVkIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbG9jYWxlIC0gTG9jYWxlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSB0cmFuc2xhdGVkIGF0dHJpYnV0ZSwgaWYgZm91bmQuXG4gICAqL1xuICBfZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZShuYW1lLCBsb2NhbGUpIHtcbiAgICBjb25zdCB0cmFuc2xhdGlvbiA9IHRoaXMudHJhbnNsYXRpb25zTG9hZGVkKCkuZmluZCgodHJhbnNsYXRpb24pID0+IHRyYW5zbGF0aW9uLmxvY2FsZSgpID09IGxvY2FsZSlcblxuICAgIGlmICh0cmFuc2xhdGlvbikge1xuICAgICAgLyoqXG4gICAgICAgKiBEaWN0LlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IGRpY3QgPSB0cmFuc2xhdGlvblxuXG4gICAgICBjb25zdCBhdHRyaWJ1dGVNZXRob2QgPSAvKiogQHR5cGUgeygpID0+IHN0cmluZyB8IHVuZGVmaW5lZH0gKi8gKGRpY3RbbmFtZV0pXG5cbiAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlTWV0aG9kID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICByZXR1cm4gYXR0cmlidXRlTWV0aG9kLmJpbmQodHJhbnNsYXRpb24pKClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCB0cmFuc2xhdGVkIG1ldGhvZDogJHtuYW1lfSAoJHt0eXBlb2YgYXR0cmlidXRlTWV0aG9kfSlgKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0cmFuc2xhdGVkIGF0dHJpYnV0ZSB3aXRoIGZhbGxiYWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsb2NhbGUgLSBMb2NhbGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIHRyYW5zbGF0ZWQgYXR0cmlidXRlIHdpdGggZmFsbGJhY2ssIGlmIGZvdW5kLlxuICAgKi9cbiAgX2dldFRyYW5zbGF0ZWRBdHRyaWJ1dGVXaXRoRmFsbGJhY2sobmFtZSwgbG9jYWxlKSB7XG4gICAgbGV0IGxvY2FsZXNJbk9yZGVyXG4gICAgY29uc3QgZmFsbGJhY2tzID0gdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldExvY2FsZUZhbGxiYWNrcygpXG5cbiAgICBpZiAoZmFsbGJhY2tzICYmIGxvY2FsZSBpbiBmYWxsYmFja3MpIHtcbiAgICAgIGxvY2FsZXNJbk9yZGVyID0gZmFsbGJhY2tzW2xvY2FsZV1cbiAgICB9IGVsc2Uge1xuICAgICAgbG9jYWxlc0luT3JkZXIgPSBbbG9jYWxlXVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZmFsbGJhY2tMb2NhbGUgb2YgbG9jYWxlc0luT3JkZXIpIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMuX2dldFRyYW5zbGF0ZWRBdHRyaWJ1dGUobmFtZSwgZmFsbGJhY2tMb2NhbGUpXG5cbiAgICAgIGlmIChyZXN1bHQgJiYgcmVzdWx0LnRyaW0oKSAhPSBcIlwiKSB7XG4gICAgICAgIHJldHVybiByZXN1bHRcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdHJhbnNsYXRlZCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2FsZSAtIExvY2FsZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbmV3VmFsdWUgLSBOZXcgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9zZXRUcmFuc2xhdGVkQXR0cmlidXRlKG5hbWUsIGxvY2FsZSwgbmV3VmFsdWUpIHtcbiAgICAvKipcbiAgICAgKiBEZWZpbmVzIHRyYW5zbGF0aW9uLlxuICAgICAqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCB8IFRyYW5zbGF0aW9uQmFzZSB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgdHJhbnNsYXRpb25cblxuICAgIHRyYW5zbGF0aW9uID0gdGhpcy50cmFuc2xhdGlvbnNMb2FkZWQoKT8uZmluZCgodHJhbnNsYXRpb24pID0+IHRyYW5zbGF0aW9uLmxvY2FsZSgpID09IGxvY2FsZSlcblxuICAgIGlmICghdHJhbnNsYXRpb24pIHtcbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoXCJ0cmFuc2xhdGlvbnNcIilcblxuICAgICAgdHJhbnNsYXRpb24gPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5idWlsZCh7bG9jYWxlfSlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBBc3NpZ25tZW50cy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGFzc2lnbm1lbnRzID0ge31cblxuICAgIGFzc2lnbm1lbnRzW25hbWVdID0gbmV3VmFsdWVcblxuICAgIHRyYW5zbGF0aW9uLmFzc2lnbihhc3NpZ25tZW50cylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5ldyBxdWVyeS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHt7ZHJpdmVyPzogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCAoKCkgPT4gaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpLCBvcGVyYXRpb24/OiBpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdH19IFthcmdzXSAtIEV4cGxpY2l0IHF1ZXJ5IG93bmVyc2hpcC5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIG5ldyBxdWVyeS5cbiAgICovXG4gIHN0YXRpYyBfbmV3UXVlcnkoYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge2RyaXZlcjogZ2l2ZW5Ecml2ZXIsIG9wZXJhdGlvbjogZ2l2ZW5PcGVyYXRpb24sIC4uLnJlc3RBcmdzfSA9IGFyZ3NcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIGNvbnN0IG9wZXJhdGlvbiA9IGdpdmVuT3BlcmF0aW9uIHx8IHRoaXMuX3JlY29yZE1ldGFkYXRhT3BlcmF0aW9uXG4gICAgY29uc3QgZHJpdmVyID0gZ2l2ZW5Ecml2ZXIgfHwgKG9wZXJhdGlvbiA/IG9wZXJhdGlvbi5jb25uZWN0aW9uKCkgOiAoKSA9PiB0aGlzLmNvbm5lY3Rpb24oKSlcbiAgICB0aGlzLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIGNvbnN0IGhhbmRsZXIgPSBuZXcgSGFuZGxlcigpXG4gICAgY29uc3QgcXVlcnkgPSBuZXcgTW9kZWxDbGFzc1F1ZXJ5KHtcbiAgICAgIGRyaXZlcixcbiAgICAgIGhhbmRsZXIsXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgb3BlcmF0aW9uXG4gICAgfSlcblxuICAgIHJldHVybiBxdWVyeS5mcm9tKG5ldyBGcm9tVGFibGUodGhpcy50YWJsZU5hbWUoKSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvcmRlcmFibGUgY29sdW1uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBvcmRlcmFibGUgY29sdW1uLlxuICAgKi9cbiAgc3RhdGljIG9yZGVyYWJsZUNvbHVtbigpIHtcbiAgICAvLyBGSVhNRTogQWxsb3cgdG8gY2hhbmdlIHRvICdjcmVhdGVkX2F0JyBpZiB1c2luZyBVVUlEP1xuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMucHJpbWFyeUtleSgpXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkgcmV0dXJuIHByaW1hcnlLZXlbMF1cblxuICAgIHJldHVybiBwcmltYXJ5S2V5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhbGwuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBhbGwuXG4gICAqL1xuICBzdGF0aWMgYWxsKCkge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY2Nlc3NpYmxlIGZvci5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEFiaWxpdHkgYWN0aW9uIHRvIHNjb3BlIGJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBbYWJpbGl0eV0gLSBBYmlsaXR5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBBdXRob3JpemVkIHF1ZXJ5LlxuICAgKi9cbiAgc3RhdGljIGFjY2Vzc2libGVGb3IoYWN0aW9uLCBhYmlsaXR5KSB7XG4gICAgY29uc3QgcXVlcnkgPSB0aGlzLl9uZXdRdWVyeSgpXG4gICAgY29uc3QgY3VycmVudEFiaWxpdHkgPSBhYmlsaXR5IHx8IEN1cnJlbnQuYWJpbGl0eSgpXG5cbiAgICBpZiAoIWN1cnJlbnRBYmlsaXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGFiaWxpdHkgaW4gY29udGV4dCBmb3IgJHt0aGlzLm5hbWV9LiBQYXNzIGFuIGFiaWxpdHkgb3IgY29uZmlndXJlIGFiaWxpdHkgcmVzb2x2ZXIgb24gdGhlIHJlcXVlc3RgKVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge01vZGVsQ2xhc3NRdWVyeTxNQz59ICovIChjdXJyZW50QWJpbGl0eS5hcHBseVRvUXVlcnkoe1xuICAgICAgYWN0aW9uLFxuICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgIHF1ZXJ5XG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY2Nlc3NpYmxlLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBbYWJpbGl0eV0gLSBBYmlsaXR5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBBdXRob3JpemVkIHF1ZXJ5LlxuICAgKi9cbiAgc3RhdGljIGFjY2Vzc2libGUoYWJpbGl0eSkge1xuICAgIHJldHVybiB0aGlzLmFjY2Vzc2libGVGb3IoXCJyZWFkXCIsIGFiaWxpdHkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY2Nlc3NpYmxlIGJ5LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0fSBhYmlsaXR5IC0gQWJpbGl0eSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gQXV0aG9yaXplZCBxdWVyeS5cbiAgICovXG4gIHN0YXRpYyBhY2Nlc3NpYmxlQnkoYWJpbGl0eSkge1xuICAgIGlmICghYWJpbGl0eSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBhYmlsaXR5IHBhc3NlZCB0byAke3RoaXMubmFtZX0uYWNjZXNzaWJsZUJ5KGFiaWxpdHkpLmApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYWNjZXNzaWJsZShhYmlsaXR5KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY291bnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY291bnQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY291bnQoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5jb3VudCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBncm91cC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtzdHJpbmd9IGdyb3VwIC0gR3JvdXAuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBncm91cC5cbiAgICovXG4gIHN0YXRpYyBncm91cChncm91cCkge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLmdyb3VwKGdyb3VwKVxuICB9XG5cbiAgc3RhdGljIGFzeW5jIGRlc3Ryb3lBbGwoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5kZXN0cm95QWxsKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBsdWNrLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0gey4uLnN0cmluZ3xzdHJpbmdbXX0gY29sdW1ucyAtIENvbHVtbiBuYW1lcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBwbHVjay5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBwbHVjayguLi5jb2x1bW5zKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5wbHVjayguLi5jb2x1bW5zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gcmVjb3JkSWQgLSBSZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGZpbmQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZChyZWNvcmRJZCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkuZmluZChyZWNvcmRJZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7e1trZXk6IHN0cmluZ106IHN0cmluZyB8IG51bWJlcn19IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIGhhc2gga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4gfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBieS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kQnkoY29uZGl0aW9ucykge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkuZmluZEJ5KGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IG9yIGZhaWwuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7e1trZXk6IHN0cmluZ106IHN0cmluZyB8IG51bWJlcn19IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIGhhc2gga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGJ5IG9yIGZhaWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmZpbmRCeU9yRmFpbChjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYW4gaW1tdXRhYmxlIHRlbmFudC1ib3VuZCBtb2RlbCBzY29wZS4gRWFnZXIgaGVscGVycyBhbmQgZXhwbGljaXRcbiAgICogZGF0YWJhc2VPcGVyYXRpb24vdHJhbnNhY3Rpb24gY2FsbGJhY2tzIGV4ZWN1dGUgZnJvbSBhIGNhcHR1cmVkIHBoeXNpY2FsXG4gICAqIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24gaW5zdGVhZCBvZiBhbWJpZW50IHRlbmFudCBzdGF0ZS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtvYmplY3R9IHRlbmFudCAtIE9yZGluYXJ5IG9yIG51bGwtcHJvdG90eXBlIEpTT04tY29tcGF0aWJsZSB0ZW5hbnQgZGVzY3JpcHRvciB0byBzY29wZSB0aGUgbW9kZWwgdG8uXG4gICAqIEByZXR1cm5zIHtUZW5hbnRNb2RlbFNjb3BlPE1DPn0gLSBNb2RlbCBzY29wZSBib3VuZCB0byB0aGUgY2FwdHVyZWQgdGVuYW50IGRhdGFiYXNlLlxuICAgKi9cbiAgc3RhdGljIHVzaW5nVGVuYW50KHRlbmFudCkge1xuICAgIHJldHVybiBuZXcgVGVuYW50TW9kZWxTY29wZSh7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgdGVuYW50XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgY3JlYXRlIGJ5LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3tba2V5OiBzdHJpbmddOiBzdHJpbmcgfCBudW1iZXJ9fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucyBoYXNoIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IFtjYWxsYmFja10gLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgb3IgY3JlYXRlIGJ5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRPckNyZWF0ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5maW5kT3JDcmVhdGVCeShjb25kaXRpb25zLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgaW5pdGlhbGl6ZSBieS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucy5cbiAgICogQHBhcmFtIHsoYXJnOiBJbnN0YW5jZVR5cGU8TUM+KSA9PiB2b2lkfSBbY2FsbGJhY2tdIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIFJlc29sdmVzIHdpdGggdGhlIG9yIGluaXRpYWxpemUgYnkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZE9ySW5pdGlhbGl6ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5maW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucywgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaXJzdC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZmlyc3QuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmlyc3QoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmZpcnN0KClcblxuICAgIGlmICghcmVzdWx0KSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5uYW1lfS5maXJzdCgpIHJldHVybmVkIG5vIHJlY29yZHNgKVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgam9pbnMuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgaW1wb3J0KFwiLi4vcXVlcnkvam9pbi1vYmplY3QuanNcIikuSm9pbk9iamVjdH0gam9pbiAtIEpvaW4gY2xhdXNlIG9yIGpvaW4gZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIGpvaW5zLlxuICAgKi9cbiAgc3RhdGljIGpvaW5zKGpvaW4pIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS5qb2lucyhqb2luKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGFzdC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgbGFzdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsYXN0KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5sYXN0KClcblxuICAgIGlmICghcmVzdWx0KSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5uYW1lfS5sYXN0KCkgcmV0dXJuZWQgbm8gcmVjb3Jkc2ApXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBsaW1pdC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgbGltaXQuXG4gICAqL1xuICBzdGF0aWMgbGltaXQodmFsdWUpIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS5saW1pdCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9yZGVyLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLk9yZGVyQXJndW1lbnRUeXBlfSBvcmRlciAtIE9yZGVyLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgb3JkZXIuXG4gICAqL1xuICBzdGF0aWMgb3JkZXIob3JkZXIpIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS5vcmRlcihvcmRlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpc3RpbmN0LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFt2YWx1ZV0gLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBkaXN0aW5jdC5cbiAgICovXG4gIHN0YXRpYyBkaXN0aW5jdCh2YWx1ZSA9IHRydWUpIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS5kaXN0aW5jdCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByZWxvYWQuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQ+fSBwcmVsb2FkIC0gUHJlbG9hZC5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIHByZWxvYWQuXG4gICAqL1xuICBzdGF0aWMgcHJlbG9hZChwcmVsb2FkKSB7XG4gICAgY29uc3QgcXVlcnkgPSAvKiogQHR5cGUge01vZGVsQ2xhc3NRdWVyeTxNQz59ICovICh0aGlzLl9uZXdRdWVyeSgpLnByZWxvYWQocHJlbG9hZCkpXG5cbiAgICByZXR1cm4gcXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5TZWxlY3RBcmd1bWVudFR5cGV9IHNlbGVjdCAtIFNlbGVjdC5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIHNlbGVjdC5cbiAgICovXG4gIHN0YXRpYyBzZWxlY3Qoc2VsZWN0KSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KCkuc2VsZWN0KHNlbGVjdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIGFycmF5LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+W10+fSAtIFJlc29sdmVzIHdpdGggdGhlIGFycmF5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS50b0FycmF5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz5bXT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYXJyYXkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgbG9hZCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmxvYWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2hlcmUuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuV2hlcmVBcmd1bWVudFR5cGV9IHdoZXJlIC0gV2hlcmUuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSB3aGVyZS5cbiAgICovXG4gIHN0YXRpYyB3aGVyZSh3aGVyZSkge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLndoZXJlKHdoZXJlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmFuc2Fjay5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJhbnNhY2stc3R5bGUgcGFyYW1zIGhhc2guXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFF1ZXJ5IHdpdGggUmFuc2FjayBmaWx0ZXJzIGFwcGxpZWQuXG4gICAqL1xuICBzdGF0aWMgcmFuc2FjayhwYXJhbXMpIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS5yYW5zYWNrKHBhcmFtcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge1dyaXRlQXR0cmlidXRlc30gY2hhbmdlcyAtIENoYW5nZXMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihjaGFuZ2VzID0gLyoqIEB0eXBlIHtXcml0ZUF0dHJpYnV0ZXN9ICovICh7fSkpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9ICovIChuZXcudGFyZ2V0KVxuXG4gICAgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24gPSBNb2RlbENsYXNzLl9yZWNvcmRNZXRhZGF0YU9wZXJhdGlvblxuICAgIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIHRoaXMuX2F0dHJpYnV0ZXMgPSB7fVxuICAgIHRoaXMuX2NoYW5nZXMgPSB7fVxuICAgIHRoaXMuX2lzTmV3UmVjb3JkID0gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCBrZXkgaW4gY2hhbmdlcykge1xuICAgICAgdGhpcy5zZXRBdHRyaWJ1dGUoa2V5LCBjaGFuZ2VzW2tleV0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJpbmRzIGZ1dHVyZSBxdWVyeSwgbGlmZWN5Y2xlLCByZWxhdGlvbnNoaXAsIGFuZCBwZXJzaXN0ZW5jZSB3b3JrIHRvIGFuIG9wZXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdH0gb3BlcmF0aW9uIC0gT3duaW5nIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge3RoaXN9IC0gQm91bmQgcmVjb3JkLlxuICAgKi9cbiAgYmluZERhdGFiYXNlT3BlcmF0aW9uKG9wZXJhdGlvbikge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbiAmJiB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbiAhPT0gb3BlcmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWNvcmQgaXMgYWxyZWFkeSBib3VuZCB0byBhbm90aGVyIGRhdGFiYXNlIG9wZXJhdGlvblwiKVxuICAgIH1cblxuICAgIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uID0gb3BlcmF0aW9uXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGFuZCB2YWxpZGF0ZXMgdGhlIHBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5IHRoYXQgb3ducyB0aGlzIHJlY29yZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpdHkgLSBPcGFxdWUgb3BlcmF0aW9uL2Nvbm5lY3Rpb24gaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHt0aGlzfSBUaGlzIHJlY29yZC5cbiAgICovXG4gIGNhcHR1cmVEYXRhYmFzZUlkZW50aXR5KGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VJZGVudGl0eSAmJiB0aGlzLl9kYXRhYmFzZUlkZW50aXR5ICE9PSBkYXRhYmFzZUlkZW50aXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWNvcmQgYmVsb25ncyB0byBhIGRpZmZlcmVudCBwaHlzaWNhbCB0ZW5hbnQgZGF0YWJhc2VcIilcbiAgICB9XG5cbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aXR5ID0gZGF0YWJhc2VJZGVudGl0eVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjYXB0dXJlZCBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gQ2FwdHVyZWQgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gICAqL1xuICBkYXRhYmFzZUlkZW50aXR5KCkge1xuICAgIHJldHVybiB0aGlzLl9kYXRhYmFzZUlkZW50aXR5XG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgdGhpcyByZWNvcmQgZnJvbSBhIGNvbXBsZXRlZCBlYWdlci1oZWxwZXIgb3BlcmF0aW9uIHdoaWxlXG4gICAqIHByZXNlcnZpbmcgdGhlIGxlZ2FjeSBhbWJpZW50IGZvbGxvdy11cCBiZWhhdmlvciBvZiBgdXNpbmdUZW5hbnRgIGZpbmRlcnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHR9IG9wZXJhdGlvbiAtIFJlbGVhc2luZyBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFJlY29yZC5cbiAgICovXG4gIHJlbGVhc2VEYXRhYmFzZU9wZXJhdGlvbihvcGVyYXRpb24pIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24gIT09IG9wZXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVjb3JkIGlzIG5vdCBib3VuZCB0byB0aGUgcmVsZWFzaW5nIGRhdGFiYXNlIG9wZXJhdGlvblwiKVxuICAgIH1cblxuICAgIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uID0gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGV4cGxpY2l0IG9wZXJhdGlvbiBvd25pbmcgdGhpcyByZWNvcmQsIGlmIGFueS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIE93bmluZyBvcGVyYXRpb24uXG4gICAqL1xuICBkYXRhYmFzZU9wZXJhdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fZGF0YWJhc2VPcGVyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBCaW5kcyBhIHJlbGF0ZWQgcmVjb3JkIHRvIHRoZSBzYW1lIG9wZXJhdGlvbiBhcyB0aGlzIHJlY29yZC5cbiAgICogQHRlbXBsYXRlIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTW9kZWxcbiAgICogQHBhcmFtIHtNb2RlbH0gcmVjb3JkIC0gUmVsYXRlZCByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtNb2RlbH0gLSBSZWxhdGVkIHJlY29yZC5cbiAgICovXG4gIGJpbmRSZWxhdGVkUmVjb3JkKHJlY29yZCkge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbikgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24uYmluZFJlY29yZChyZWNvcmQpXG5cbiAgICByZXR1cm4gcmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgbW9kZWwgcXVlcnkgcHJlc2VydmluZyB0aGlzIHJlY29yZCdzIG9wZXJhdGlvbiBvd25lcnNoaXAuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAcGFyYW0ge01DfSBNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUYXJnZXQgcXVlcnkuXG4gICAqL1xuICBxdWVyeUZvck1vZGVsKE1vZGVsQ2xhc3MpIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24pIHJldHVybiB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi5mb3JNb2RlbChNb2RlbENsYXNzKVxuXG4gICAgcmV0dXJuIE1vZGVsQ2xhc3MuX25ld1F1ZXJ5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplcyBhIHJlbGF0aW9uc2hpcC9wcmVsb2FkIHRhcmdldCB3aXRob3V0IGRyb3BwaW5nIHRoaXMgcmVjb3JkJ3NcbiAgICogZXhwbGljaXQgb3BlcmF0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIE93bmluZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGluaXRpYWxpemVkLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlTW9kZWxDbGFzc0luaXRpYWxpemVkKE1vZGVsQ2xhc3MsIGNvbmZpZ3VyYXRpb24pIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24pIHtcbiAgICAgIGF3YWl0IHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLmVuc3VyZU1vZGVsSW5pdGlhbGl6ZWQoTW9kZWxDbGFzcylcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IE1vZGVsQ2xhc3MuZW5zdXJlSW5pdGlhbGl6ZWQoe2NvbmZpZ3VyYXRpb259KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCBleGlzdGluZyByZWNvcmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhdHRyaWJ1dGVzIC0gQXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgbG9hZEV4aXN0aW5nUmVjb3JkKGF0dHJpYnV0ZXMpIHtcbiAgICB0aGlzLl9hdHRyaWJ1dGVzID0gYXR0cmlidXRlc1xuICAgIHRoaXMuX2lzTmV3UmVjb3JkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIHRoZSBnaXZlbiBhdHRyaWJ1dGVzIHRvIHRoZSByZWNvcmQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzVG9Bc3NpZ24gLSBBdHRyaWJ1dGVzIHRvIGFzc2lnbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYXNzaWduKGF0dHJpYnV0ZXNUb0Fzc2lnbikge1xuICAgIHRoaXMuX2Fzc2lnbmVkQXR0cmlidXRlTmFtZXMgfHw9IG5ldyBTZXQoKVxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlVG9Bc3NpZ24gaW4gYXR0cmlidXRlc1RvQXNzaWduKSB7XG4gICAgICB0aGlzLl9hc3NpZ25lZEF0dHJpYnV0ZU5hbWVzLmFkZChhdHRyaWJ1dGVUb0Fzc2lnbilcbiAgICAgIHRoaXMuc2V0QXR0cmlidXRlKGF0dHJpYnV0ZVRvQXNzaWduLCBhdHRyaWJ1dGVzVG9Bc3NpZ25bYXR0cmlidXRlVG9Bc3NpZ25dKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgdGhlIGN1cnJlbnQgYXR0cmlidXRlcyBvZiB0aGUgcmVjb3JkIChvcmlnaW5hbCBhdHRyaWJ1dGVzIGZyb20gZGF0YWJhc2UgcGx1cyBjaGFuZ2VzKVxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFRoZSBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgYXR0cmlidXRlcygpIHtcbiAgICBjb25zdCBkYXRhID0gdGhpcy5yYXdBdHRyaWJ1dGVzKClcbiAgICBjb25zdCBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpXG4gICAgLyoqXG4gICAgICogQXR0cmlidXRlcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBjb2x1bW5OYW1lIGluIGRhdGEpIHtcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lW2NvbHVtbk5hbWVdIHx8IGNvbHVtbk5hbWVcblxuICAgICAgYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHRoaXMucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuICAgIH1cblxuICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBjb2x1bW4tbmFtZSBrZXllZCBkYXRhIChvcmlnaW5hbCBhdHRyaWJ1dGVzIGZyb20gZGF0YWJhc2UgcGx1cyBjaGFuZ2VzKVxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFRoZSByYXcgYXR0cmlidXRlcy5cbiAgICovXG4gIHJhd0F0dHJpYnV0ZXMoKSB7XG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24oe30sIHRoaXMuX2F0dHJpYnV0ZXMsIHRoaXMuX2NoYW5nZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbm5lY3Rpb24uXG4gICAqL1xuICBfY29ubmVjdGlvbigpIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24pIHJldHVybiB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi5jb25uZWN0aW9uKClcbiAgICBpZiAodGhpcy5fX2Nvbm5lY3Rpb24pIHJldHVybiB0aGlzLl9fY29ubmVjdGlvblxuXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmNvbm5lY3Rpb24oKVxuXG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkpIHRoaXMuY2FwdHVyZURhdGFiYXNlSWRlbnRpdHkodGhpcy5fZGF0YWJhc2VJZGVudGl0eUZvckNvbm5lY3Rpb24oY29ubmVjdGlvbikpXG5cbiAgICByZXR1cm4gY29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBpZGVudGl0eSBvZiBhbiBhbHJlYWR5IHNlbGVjdGVkIGNvbmNyZXRlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25jcmV0ZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBQaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAgICovXG4gIF9kYXRhYmFzZUlkZW50aXR5Rm9yQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gbW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIGNvbnN0IHJldXNlS2V5ID0gbW9kZWxDbGFzc1xuICAgICAgLl9nZXRDb25maWd1cmF0aW9uKClcbiAgICAgIC5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgICAgLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoY29ubmVjdGlvbilcblxuICAgIHJldHVybiBgJHtkYXRhYmFzZUlkZW50aWZpZXJ9OiR7cmV1c2VLZXl9YFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNvbm5lY3Rpb24gdGhhdCBvd25zIHRoaXMgcmVjb3JkJ3MgZGF0YWJhc2Ugd29yay5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIENvbm5lY3Rpb24uXG4gICAqL1xuICBjb25uZWN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9jb25uZWN0aW9uKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgZGVwZW5kZW50IHJlY29yZHMgZm9yIGEgYGRlcGVuZGVudDogXCJyZXN0cmljdFwiYCByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7UmVzdHJpY3RJbnN0YW5jZVJlbGF0aW9uc2hpcH0gaW5zdGFuY2VSZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UgdG8gY291bnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gRGVwZW5kZW50IHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIF9kZXBlbmRlbnRSZXN0cmljdENvdW50KGluc3RhbmNlUmVsYXRpb25zaGlwKSB7XG4gICAgY29uc3QgVGFyZ2V0TW9kZWxDbGFzcyA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgaWYgKCFUYXJnZXRNb2RlbENsYXNzIHx8ICFUYXJnZXRNb2RlbENsYXNzLmhhc1RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKCkpIHtcbiAgICAgIHJldHVybiBhd2FpdCBpbnN0YW5jZVJlbGF0aW9uc2hpcC5xdWVyeSgpLmNvdW50KClcbiAgICB9XG5cbiAgICBpZiAodGhpcy5nZXRNb2RlbENsYXNzKCkuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSkge1xuICAgICAgcmV0dXJuIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLnF1ZXJ5KCkuY291bnQoKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9kZXBlbmRlbnRSZXN0cmljdFRlbmFudENvdW50KGluc3RhbmNlUmVsYXRpb25zaGlwLCBUYXJnZXRNb2RlbENsYXNzKVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyB0ZW5hbnQtc2NvcGVkIGRlcGVuZGVudCByZWNvcmRzIGFjcm9zcyBhbGwgcHJvdmlkZXItbGlzdGVkIHRlbmFudHMuXG4gICAqIEBwYXJhbSB7UmVzdHJpY3RJbnN0YW5jZVJlbGF0aW9uc2hpcH0gaW5zdGFuY2VSZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UgdG8gY291bnQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBUYXJnZXRNb2RlbENsYXNzIC0gUmVsYXRlZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBEZXBlbmRlbnQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX2RlcGVuZGVudFJlc3RyaWN0VGVuYW50Q291bnQoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuX2dldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHRlbmFudERhdGFiYXNlUHJvdmlkZXJzID0gY29uZmlndXJhdGlvbi5nZXRUZW5hbnREYXRhYmFzZVByb3ZpZGVycygpXG4gICAgY29uc3QgcHJvdmlkZXJFbnRyaWVzID0gT2JqZWN0LmVudHJpZXModGVuYW50RGF0YWJhc2VQcm92aWRlcnMpXG4gICAgY29uc3QgdGFyZ2V0SWRlbnRpZmllciA9IFRhcmdldE1vZGVsQ2xhc3MuZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKG51bGwpXG5cbiAgICBpZiAocHJvdmlkZXJFbnRyaWVzLmxlbmd0aCA9PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBjaGVjayBkZXBlbmRlbnQgJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9IGJlY2F1c2UgJHtUYXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfSBzd2l0Y2hlcyB0ZW5hbnQgZGF0YWJhc2VzIGJ1dCBubyB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXJzIGFyZSBjb25maWd1cmVkYClcbiAgICB9XG5cbiAgICBpZiAodGFyZ2V0SWRlbnRpZmllcikge1xuICAgICAgY29uc3QgcHJvdmlkZXIgPSB0ZW5hbnREYXRhYmFzZVByb3ZpZGVyc1t0YXJnZXRJZGVudGlmaWVyXVxuXG4gICAgICBpZiAoIXByb3ZpZGVyKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGNoZWNrIGRlcGVuZGVudCAke2luc3RhbmNlUmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcCgpLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gYmVjYXVzZSAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9IHN3aXRjaGVzIHRlbmFudCBkYXRhYmFzZSAke3RhcmdldElkZW50aWZpZXJ9IGJ1dCBubyB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgaXMgY29uZmlndXJlZCBmb3IgJHt0YXJnZXRJZGVudGlmaWVyfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9kZXBlbmRlbnRSZXN0cmljdFByb3ZpZGVyQ291bnQoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MsIHRhcmdldElkZW50aWZpZXIsIHByb3ZpZGVyKVxuICAgIH1cblxuICAgIGxldCBtYXRjaGluZ1Byb3ZpZGVyU2VlbiA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IFtpZGVudGlmaWVyLCBwcm92aWRlcl0gb2YgcHJvdmlkZXJFbnRyaWVzKSB7XG4gICAgICBjb25zdCB0ZW5hbnRzID0gYXdhaXQgdGhpcy5fZGVwZW5kZW50UmVzdHJpY3RQcm92aWRlclRlbmFudHMoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MsIGlkZW50aWZpZXIsIHByb3ZpZGVyKVxuXG4gICAgICBmb3IgKGNvbnN0IHRlbmFudCBvZiB0ZW5hbnRzKSB7XG4gICAgICAgIGlmIChUYXJnZXRNb2RlbENsYXNzLmdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcih0ZW5hbnQpICE9IGlkZW50aWZpZXIpIHtcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgbWF0Y2hpbmdQcm92aWRlclNlZW4gPSB0cnVlXG5cbiAgICAgICAgY29uc3QgY291bnQgPSBhd2FpdCBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQodGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgaWYgKCFjb25maWd1cmF0aW9uLmlzRGF0YWJhc2VJZGVudGlmaWVyQWN0aXZlKGlkZW50aWZpZXIpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyICR7aWRlbnRpZmllcn0gaXMgaW5hY3RpdmUgd2hpbGUgY2hlY2tpbmcgZGVwZW5kZW50ICR7aW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfWApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe2RhdGFiYXNlSWRlbnRpZmllcnM6IFtpZGVudGlmaWVyXSwgbmFtZTogYERlcGVuZGVudCByZXN0cmljdCBjb3VudDogJHtUYXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWB9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgaW5zdGFuY2VSZWxhdGlvbnNoaXAucXVlcnkoKS5jb3VudCgpXG4gICAgICAgICAgfSlcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoY291bnQgPiAwKSByZXR1cm4gY291bnRcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIW1hdGNoaW5nUHJvdmlkZXJTZWVuKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBjaGVjayBkZXBlbmRlbnQgJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9IGJlY2F1c2Ugbm8gdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyIG1hdGNoZWQgJHtUYXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIDBcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgdGVuYW50LXNjb3BlZCBkZXBlbmRlbnQgcmVjb3JkcyBmb3Igb25lIGNvbmZpZ3VyZWQgdGVuYW50IHByb3ZpZGVyLlxuICAgKiBAcGFyYW0ge1Jlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXB9IGluc3RhbmNlUmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlIHRvIGNvdW50LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gVGFyZ2V0TW9kZWxDbGFzcyAtIFJlbGF0ZWQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gVGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7VGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGV9IHByb3ZpZGVyIC0gVGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIERlcGVuZGVudCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfZGVwZW5kZW50UmVzdHJpY3RQcm92aWRlckNvdW50KGluc3RhbmNlUmVsYXRpb25zaGlwLCBUYXJnZXRNb2RlbENsYXNzLCBpZGVudGlmaWVyLCBwcm92aWRlcikge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgdGVuYW50cyA9IGF3YWl0IHRoaXMuX2RlcGVuZGVudFJlc3RyaWN0UHJvdmlkZXJUZW5hbnRzKGluc3RhbmNlUmVsYXRpb25zaGlwLCBUYXJnZXRNb2RlbENsYXNzLCBpZGVudGlmaWVyLCBwcm92aWRlcilcblxuICAgIGZvciAoY29uc3QgdGVuYW50IG9mIHRlbmFudHMpIHtcbiAgICAgIGNvbnN0IGNvdW50ID0gYXdhaXQgY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAoIWNvbmZpZ3VyYXRpb24uaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUoaWRlbnRpZmllcikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyICR7aWRlbnRpZmllcn0gaXMgaW5hY3RpdmUgd2hpbGUgY2hlY2tpbmcgZGVwZW5kZW50ICR7aW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfWApXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW2lkZW50aWZpZXJdLCBuYW1lOiBgRGVwZW5kZW50IHJlc3RyaWN0IGNvdW50OiAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgaW5zdGFuY2VSZWxhdGlvbnNoaXAucXVlcnkoKS5jb3VudCgpXG4gICAgICAgIH0pXG4gICAgICB9KVxuXG4gICAgICBpZiAoY291bnQgPiAwKSByZXR1cm4gY291bnRcbiAgICB9XG5cbiAgICByZXR1cm4gMFxuICB9XG5cbiAgLyoqXG4gICAqIExpc3RzIHJlc3RyaWN0LWNoZWNrIHRlbmFudHMgZm9yIG9uZSBjb25maWd1cmVkIHRlbmFudCBwcm92aWRlci5cbiAgICogQHBhcmFtIHtSZXN0cmljdEluc3RhbmNlUmVsYXRpb25zaGlwfSBpbnN0YW5jZVJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZSB0byBjb3VudC5cbiAgICogQHBhcmFtIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IFRhcmdldE1vZGVsQ2xhc3MgLSBSZWxhdGVkIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1RlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlfSBwcm92aWRlciAtIFRlbmFudCBkYXRhYmFzZSBwcm92aWRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBMaXN0ZWQgdGVuYW50IG9iamVjdHMuXG4gICAqL1xuICBhc3luYyBfZGVwZW5kZW50UmVzdHJpY3RQcm92aWRlclRlbmFudHMoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MsIGlkZW50aWZpZXIsIHByb3ZpZGVyKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBsaXN0VGVuYW50cyA9IHR5cGVvZiBwcm92aWRlci5saXN0UmVzdHJpY3RUZW5hbnRzID09IFwiZnVuY3Rpb25cIlxuICAgICAgPyBwcm92aWRlci5saXN0UmVzdHJpY3RUZW5hbnRzXG4gICAgICA6IHByb3ZpZGVyLmxpc3RUZW5hbnRzXG4gICAgY29uc3QgbGlzdFRlbmFudHNNZXRob2ROYW1lID0gdHlwZW9mIHByb3ZpZGVyLmxpc3RSZXN0cmljdFRlbmFudHMgPT0gXCJmdW5jdGlvblwiXG4gICAgICA/IFwibGlzdFJlc3RyaWN0VGVuYW50c1wiXG4gICAgICA6IFwibGlzdFRlbmFudHNcIlxuXG4gICAgaWYgKHR5cGVvZiBsaXN0VGVuYW50cyAhPSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyIGZvciAke2lkZW50aWZpZXJ9IG11c3QgZGVmaW5lIGxpc3RUZW5hbnRzIG9yIGxpc3RSZXN0cmljdFRlbmFudHMgYmVmb3JlIGRlcGVuZGVudCByZXN0cmljdCBjYW4gY2hlY2sgJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9YClcbiAgICB9XG5cbiAgICBjb25zdCB0ZW5hbnRzID0gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogYERlcGVuZGVudCByZXN0cmljdCB0ZW5hbnRzOiAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YH0sIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBsaXN0VGVuYW50cyh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGlkZW50aWZpZXJcbiAgICAgIH0pXG4gICAgfSlcblxuICAgIGlmICghQXJyYXkuaXNBcnJheSh0ZW5hbnRzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgZm9yICR7aWRlbnRpZmllcn0gbXVzdCByZXR1cm4gYW4gYXJyYXkgZnJvbSAke2xpc3RUZW5hbnRzTWV0aG9kTmFtZX1gKVxuICAgIH1cblxuICAgIHJldHVybiB0ZW5hbnRzXG4gIH1cblxuICAvKipcbiAgICogRGVzdHJveXMgdGhlIHJlY29yZCBpbiB0aGUgZGF0YWJhc2UgYW5kIGFsbCBvZiBpdHMgZGVwZW5kZW50IHJlY29yZHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBkZXN0cm95KCkge1xuICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImJlZm9yZURlc3Ryb3lcIilcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwIG9mIHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldFJlbGF0aW9uc2hpcHMoKSkge1xuICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXREZXBlbmRlbnQoKSA9PSBcInJlc3RyaWN0XCIpIHtcbiAgICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSAvKiogQHR5cGUge1Jlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXB9ICovICh0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpKSlcbiAgICAgICAgY29uc3QgY291bnQgPSBhd2FpdCB0aGlzLl9kZXBlbmRlbnRSZXN0cmljdENvdW50KGluc3RhbmNlUmVsYXRpb25zaGlwKVxuXG4gICAgICAgIGlmIChjb3VudCA+IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBkZWxldGUgcmVjb3JkIGJlY2F1c2UgZGVwZW5kZW50ICR7cmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gZXhpc3RgKVxuICAgICAgICB9XG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXREZXBlbmRlbnQoKSAhPSBcImRlc3Ryb3lcIikge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCkpXG5cbiAgICAgIC8qKlxuICAgICAgICogRGVmaW5lcyBtb2RlbHMuXG4gICAgICAgKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXX0gKi9cbiAgICAgIGxldCBtb2RlbHNcblxuICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImJlbG9uZ3NUb1wiKSB7XG4gICAgICAgIGlmICghaW5zdGFuY2VSZWxhdGlvbnNoaXAuaXNMb2FkZWQoKSkge1xuICAgICAgICAgIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWQoKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbW9kZWwgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChtb2RlbCBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSB7XG4gICAgICAgICAgbW9kZWxzID0gW21vZGVsXVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBsb2FkZWQgdHlwZTogJHt0eXBlb2YgbW9kZWx9YClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJoYXNNYW55XCIpIHtcbiAgICAgICAgaWYgKCFpbnN0YW5jZVJlbGF0aW9uc2hpcC5pc0xvYWRlZCgpKSB7XG4gICAgICAgICAgYXdhaXQgaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZCgpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsb2FkZWRNb2RlbHMgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGxvYWRlZE1vZGVscykpIHtcbiAgICAgICAgICBtb2RlbHMgPSBsb2FkZWRNb2RlbHNcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgbG9hZGVkIHR5cGU6ICR7dHlwZW9mIGxvYWRlZE1vZGVsc31gKVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc09uZVwiKSB7XG4gICAgICAgIGlmICghaW5zdGFuY2VSZWxhdGlvbnNoaXAuaXNMb2FkZWQoKSkge1xuICAgICAgICAgIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWQoKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbG9hZGVkTW9kZWwgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChsb2FkZWRNb2RlbCBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSB7XG4gICAgICAgICAgbW9kZWxzID0gW2xvYWRlZE1vZGVsXVxuICAgICAgICB9IGVsc2UgaWYgKGxvYWRlZE1vZGVsID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBtb2RlbHMgPSBbXVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBsb2FkZWQgdHlwZTogJHt0eXBlb2YgbG9hZGVkTW9kZWx9YClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmhhbmRsZWQgcmVsYXRpb25zaGlwIHR5cGU6ICR7aW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpfWApXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbW9kZWxzKSB7XG4gICAgICAgIGlmIChtb2RlbC5pc1BlcnNpc3RlZCgpKSB7XG4gICAgICAgICAgYXdhaXQgbW9kZWwuZGVzdHJveSgpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb25kaXRpb25zLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgY29uZGl0aW9ucyA9IHt9XG5cbiAgICBPYmplY3QuYXNzaWduKGNvbmRpdGlvbnMsIG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnModGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpLCB0aGlzLl9wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKSkpXG5cbiAgICBjb25zdCBzcWwgPSB0aGlzLl9jb25uZWN0aW9uKCkuZGVsZXRlU3FsKHtcbiAgICAgIGNvbmRpdGlvbnMsXG4gICAgICB0YWJsZU5hbWU6IHRoaXMuX3RhYmxlTmFtZSgpXG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMuX2Nvbm5lY3Rpb24oKS5xdWVyeShzcWwsIHtsb2dOYW1lOiBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBEZXN0cm95YH0pXG4gICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYWZ0ZXJEZXN0cm95XCIpXG4gICAgYXdhaXQgdGhpcy5fZW1pdFJlY29yZENoYW5nZUFmdGVyQ29tbWl0KFwiZGVzdHJveVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIEVtaXRzIGEgY29tbWl0dGVkIHJlY29yZC1jaGFuZ2UgZXZlbnQgYWZ0ZXIgdGhlIHN1cnJvdW5kaW5nIHRyYW5zYWN0aW9uXG4gICAqIGNvbW1pdHMsIHNvIGxpdmUgcXVlcmllcyByZS1ydW4gdW5pZm9ybWx5IGZvciBsb2NhbCB3cml0ZXMsIHB1bGwgYXBwbGllcywgYW5kXG4gICAqIHJlYWx0aW1lIGFwcGxpZXMgKHdoaWNoIGFsbCBlbmQgYXMgbG9jYWwgc2F2ZXMvZGVzdHJveXMpLiBSZWdpc3RlcmVkIHRocm91Z2hcbiAgICogdGhlIGNvbm5lY3Rpb24ncyBhZnRlckNvbW1pdCBob29rIHNvIGEgcm9sbGVkLWJhY2sgc2F2ZSBlbWl0cyBub3RoaW5nLCBhbmRcbiAgICogc2tpcHBlZCBlbnRpcmVseSB3aGVuIG5vdGhpbmcgb2JzZXJ2ZXMgdGhpcyBtb2RlbCBjbGFzcyBzbyBzZXJ2ZXItc2lkZSBzYXZlc1xuICAgKiBzdGF5IGZyZWUgb2YgbGl2ZS1xdWVyeSBvdmVyaGVhZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZWNvcmQtY2hhbmdlcy5qc1wiKS5SZWNvcmRDaGFuZ2VPcGVyYXRpb259IG9wZXJhdGlvbiAtIFRoZSBjb21taXR0ZWQgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9lbWl0UmVjb3JkQ2hhbmdlQWZ0ZXJDb21taXQob3BlcmF0aW9uKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIXJlY29yZENoYW5nZXMuaGFzTGlzdGVuZXJzKG1vZGVsQ2xhc3MpKSByZXR1cm5cblxuICAgIGNvbnN0IHJlY29yZCA9IHRoaXNcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aXR5ID0gdGhpcy5fZGF0YWJhc2VPcGVyYXRpb25cbiAgICAgID8gdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24uZGF0YWJhc2VJZGVudGl0eSgpXG4gICAgICA6IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHlGb3JDb25uZWN0aW9uKHRoaXMuX2Nvbm5lY3Rpb24oKSlcblxuICAgIHRoaXMuY2FwdHVyZURhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSlcblxuICAgIGF3YWl0IHRoaXMuX2Nvbm5lY3Rpb24oKS5hZnRlckNvbW1pdCgoKSA9PiB7XG4gICAgICByZWNvcmRDaGFuZ2VzLmVtaXQoe2RhdGFiYXNlSWRlbnRpdHksIG1vZGVsQ2xhc3MsIG9wZXJhdGlvbiwgcmVjb3JkfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3JlcyBhbiBhdWRpdCByb3cgZm9yIHRoaXMgcmVjb3JkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYXVkaXRpbmcuanNcIikuQ3JlYXRlQXVkaXRBcmdzfSBhcmdzIC0gQXVkaXQgcm93IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IHN0cmluZz59IENyZWF0ZWQgYXVkaXQgcm93IGlkLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlQXVkaXQoYXJncykge1xuICAgIHJldHVybiBhd2FpdCBjcmVhdGVBdWRpdCh0aGlzLCBhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGNyZWF0ZSBjaGFuZ2VzIGJlZm9yZSBwZXJzaXN0ZW5jZSBjbGVhcnMgdGhlIGNoYW5nZSBzZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY2FwdHVyZUNyZWF0ZUF1ZGl0Q2hhbmdlcygpIHtcbiAgICBjYXB0dXJlQ3JlYXRlQXVkaXRDaGFuZ2VzKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogV3JpdGVzIHRoZSBjcmVhdGUgYXVkaXQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGNyZWF0ZUNyZWF0ZUF1ZGl0KCkge1xuICAgIGF3YWl0IGNyZWF0ZUNyZWF0ZUF1ZGl0KHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgdXBkYXRlIGNoYW5nZXMgYmVmb3JlIHBlcnNpc3RlbmNlIGNsZWFycyB0aGUgY2hhbmdlIHNldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjYXB0dXJlVXBkYXRlQXVkaXRDaGFuZ2VzKCkge1xuICAgIGNhcHR1cmVVcGRhdGVBdWRpdENoYW5nZXModGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZXMgdGhlIHVwZGF0ZSBhdWRpdCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgY3JlYXRlVXBkYXRlQXVkaXQoKSB7XG4gICAgYXdhaXQgY3JlYXRlVXBkYXRlQXVkaXQodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZXMgdGhlIGRlc3Ryb3kgYXVkaXQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGNyZWF0ZURlc3Ryb3lBdWRpdCgpIHtcbiAgICBhd2FpdCBjcmVhdGVEZXN0cm95QXVkaXQodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBsaWZlY3ljbGUgY2FsbGJhY2tzLlxuICAgKiBAcGFyYW0ge1wiYWZ0ZXJDcmVhdGVcIiB8IFwiYWZ0ZXJEZXN0cm95XCIgfCBcImFmdGVyU2F2ZVwiIHwgXCJhZnRlclVwZGF0ZVwiIHwgXCJiZWZvcmVDcmVhdGVcIiB8IFwiYmVmb3JlRGVzdHJveVwiIHwgXCJiZWZvcmVTYXZlXCIgfCBcImJlZm9yZVVwZGF0ZVwiIHwgXCJiZWZvcmVWYWxpZGF0aW9uXCJ9IGNhbGxiYWNrTmFtZSAtIENhbGxiYWNrIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhjYWxsYmFja05hbWUpIHtcbiAgICBjb25zdCBjYWxsYmFja3MgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRMaWZlY3ljbGVDYWxsYmFja3NNYXAoKVtjYWxsYmFja05hbWVdIHx8IFtdXG4gICAgbGV0IGNhbGxiYWNrTmFtZVJlZ2lzdGVyZWRBc1N0cmluZyA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIGNhbGxiYWNrcykge1xuICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGlmIChjYWxsYmFjayA9PSBjYWxsYmFja05hbWUpIHtcbiAgICAgICAgICBjYWxsYmFja05hbWVSZWdpc3RlcmVkQXNTdHJpbmcgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZHluYW1pY1RoaXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcbiAgICAgICAgY29uc3QgbWV0aG9kQ2FsbGJhY2sgPSBkeW5hbWljVGhpc1tjYWxsYmFja11cblxuICAgICAgICBpZiAodHlwZW9mIG1ldGhvZENhbGxiYWNrICE9IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTGlmZWN5Y2xlIGNhbGxiYWNrIFwiJHtjYWxsYmFja31cIiBpcyBub3QgYSBmdW5jdGlvbiBvbiAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IG1ldGhvZENhbGxiYWNrLmNhbGwodGhpcylcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IGNhbGxiYWNrKHRoaXMpXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgZHluYW1pY1RoaXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcbiAgICBjb25zdCBpbnN0YW5jZUNhbGxiYWNrID0gZHluYW1pY1RoaXNbY2FsbGJhY2tOYW1lXVxuXG4gICAgaWYgKCFjYWxsYmFja05hbWVSZWdpc3RlcmVkQXNTdHJpbmcgJiYgdHlwZW9mIGluc3RhbmNlQ2FsbGJhY2sgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgYXdhaXQgaW5zdGFuY2VDYWxsYmFjay5jYWxsKHRoaXMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIGNoYW5nZXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgY2hhbmdlcy5cbiAgICovXG4gIF9oYXNDaGFuZ2VzKCkgeyByZXR1cm4gT2JqZWN0LmtleXModGhpcy5fY2hhbmdlcykubGVuZ3RoID4gMCB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdHJ1ZSBpZiB0aGUgbW9kZWwgaGFzIGJlZW4gY2hhbmdlZCBzaW5jZSBpdCB3YXMgbG9hZGVkIGZyb20gdGhlIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGNoYW5nZWQuXG4gICAqL1xuICBpc0NoYW5nZWQoKSB7XG4gICAgaWYgKHRoaXMuaXNOZXdSZWNvcmQoKSB8fCB0aGlzLl9oYXNDaGFuZ2VzKCkpe1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICAvLyBDaGVjayBpZiBhIGxvYWRlZCBzdWItbW9kZWwgb2YgYSByZWxhdGlvbnNoaXAgaXMgY2hhbmdlZCBhbmQgc2hvdWxkIGJlIHNhdmVkIGFsb25nIHdpdGggdGhpcyBtb2RlbC5cbiAgICBpZiAodGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKSB7XG4gICAgICBmb3IgKGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbaW5zdGFuY2VSZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgICBsZXQgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuX2xvYWRlZFxuXG4gICAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRBdXRvU2F2ZSgpID09PSBmYWxzZSkge1xuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWxvYWRlZCkgY29udGludWVcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGxvYWRlZCkpIGxvYWRlZCA9IFtsb2FkZWRdXG5cbiAgICAgICAgZm9yIChjb25zdCBtb2RlbCBvZiBsb2FkZWQpIHtcbiAgICAgICAgICBpZiAobW9kZWwuaXNDaGFuZ2VkKCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY2hhbmdlcyB0aGF0IGhhdmUgYmVlbiBtYWRlIHRvIHRoaXMgcmVjb3JkIHNpbmNlIGl0IHdhcyBsb2FkZWQgZnJvbSB0aGUgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFRoZSBjaGFuZ2VzLlxuICAgKi9cbiAgY2hhbmdlcygpIHtcbiAgICAvKipcbiAgICAgKiBDaGFuZ2VzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IGNoYW5nZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBjaGFuZ2VLZXkgaW4gdGhpcy5fY2hhbmdlcykge1xuICAgICAgY29uc3QgY2hhbmdlVmFsdWUgPSB0aGlzLl9jaGFuZ2VzW2NoYW5nZUtleV1cblxuICAgICAgY2hhbmdlc1tjaGFuZ2VLZXldID0gW3RoaXMuX2F0dHJpYnV0ZXNbY2hhbmdlS2V5XSwgY2hhbmdlVmFsdWVdXG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYW5nZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHRhYmxlIG5hbWUuXG4gICAqL1xuICBfdGFibGVOYW1lKCkge1xuICAgIGlmICh0aGlzLl9fdGFibGVOYW1lKSByZXR1cm4gdGhpcy5fX3RhYmxlTmFtZVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0TW9kZWxDbGFzcygpLnRhYmxlTmFtZSgpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYW4gYXR0cmlidXRlIHZhbHVlIGZyb20gdGhlIHJlY29yZC4gUmVhZCBkeW5hbWljYWxseSBieSBuYW1lLCBzbyB0aGUgdmFsdWUgY2FuIGJlIGFueVxuICAgKiBjb2x1bW4gdHlwZSBhbmQgbWF5IGJlIG92ZXJyaWRkZW4gYnkgYSB1c2VyLWRlZmluZWQgZ2V0dGVyIG9uIHRoZSBtb2RlbC5cbiAgICogQHRlbXBsYXRlIFZcbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgVGhlIG5hbWUgb2YgdGhlIGF0dHJpYnV0ZSB0byByZWFkLiBUaGlzIGlzIHRoZSBhdHRyaWJ1dGUgbmFtZSwgbm90IHRoZSBjb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge1Z9IFRoZSBhdHRyaWJ1dGUgdmFsdWUsIHR5cGVkIGJ5IHRoZSBjYWxsZXIncyBhY2Nlc3NvciBjb250cmFjdC5cbiAgICovXG4gIHJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkge1xuICAgIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIGNvbnN0IG1hcCA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpXG4gICAgY29uc3QgY29sdW1uTmFtZSA9IHJlc29sdmVkQXR0cmlidXRlTmFtZSA/IG1hcFtyZXNvbHZlZEF0dHJpYnV0ZU5hbWVdIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoIWNvbHVtbk5hbWUpIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgZmlndXJlIG91dCBjb2x1bW4gbmFtZSBmb3IgYXR0cmlidXRlOiAke2F0dHJpYnV0ZU5hbWV9IGZyb20gdGhlc2UgbWFwcGluZ3M6ICR7T2JqZWN0LmtleXMobWFwKS5qb2luKFwiLCBcIil9YClcblxuICAgIHJldHVybiAvKiogQHR5cGUge1Z9ICovICh0aGlzLnJlYWRDb2x1bW4oY29sdW1uTmFtZSkpXG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhbiBhc3NvY2lhdGlvbiBjb3VudCBhdHRhY2hlZCBieSBgLndpdGhDb3VudCguLi4pYC4gQ291bnRzIGFyZVxuICAgKiBzdG9yZWQgb24gYSBzZXBhcmF0ZSBtYXAgZnJvbSB0aGUgcmVjb3JkJ3MgYF9hdHRyaWJ1dGVzYCBzbyBhXG4gICAqIHZpcnR1YWwgY291bnQgbGlrZSBgdGFza3NDb3VudGAgY2Fubm90IHNpbGVudGx5IHNoYWRvdyBhIHJlYWxcbiAgICogY29sdW1uIG9mIHRoZSBzYW1lIG5hbWUuIFJldHVybnMgdGhlIGF0dGFjaGVkIG51bWJlciwgb3IgMCB3aGVuXG4gICAqIGAud2l0aENvdW50KC4uLilgIHdhc24ndCByZXF1ZXN0ZWQgZm9yIHRoaXMgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLCBlLmcuIGBcInRhc2tzQ291bnRcImAgb3IgYSBjdXN0b20gYFwiYWN0aXZlTWVtYmVyc0NvdW50XCJgIGZyb20gYC53aXRoQ291bnQoe2FjdGl2ZU1lbWJlcnNDb3VudDogey4uLn19KWAuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQXR0YWNoZWQgYXNzb2NpYXRpb24gY291bnQsIG9yIHplcm8gd2hlbiBhYnNlbnQuXG4gICAqL1xuICByZWFkQ291bnQoYXR0cmlidXRlTmFtZSkge1xuICAgIHJldHVybiByZWFkUGF5bG9hZEFzc29jaWF0aW9uQ291bnQoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogQXR0YWNoIGFuIGFzc29jaWF0aW9uIGNvdW50IHRvIHRoaXMgcmVjb3JkLiBJbnRlcm5hbCBoZWxwZXIgdXNlZCBieVxuICAgKiB0aGUgYHdpdGhDb3VudGAgcnVubmVyOyBvdXRzaWRlIGNvZGUgc2hvdWxkIG5vdCBjYWxsIHRoaXMgZGlyZWN0bHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIENvdW50IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRBc3NvY2lhdGlvbkNvdW50KGF0dHJpYnV0ZU5hbWUsIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZEFzc29jaWF0aW9uQ291bnQoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGF0dHJpYnV0ZU5hbWUsIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIEFsbCBhdHRhY2hlZCBhc3NvY2lhdGlvbiBjb3VudHMgYXMgYSBwbGFpbiBvYmplY3QuIFVzZWQgYnkgdGhlXG4gICAqIGZyb250ZW5kLW1vZGVsIHNlcmlhbGl6ZXIgdG8gc2hpcCBjb3VudHMgYWxvbmdzaWRlIHRoZSByZWNvcmRcbiAgICogYXR0cmlidXRlcyBvbiB0aGUgd2lyZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59IC0gQXNzb2NpYXRpb24gY291bnRzIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgYXNzb2NpYXRpb25Db3VudHMoKSB7XG4gICAgLyoqXG4gICAgICogUmVzdWx0LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgICBjb25zdCB0YXJnZXQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuXG4gICAgaWYgKCF0YXJnZXQuX2Fzc29jaWF0aW9uQ291bnRzKSByZXR1cm4gcmVzdWx0XG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgdGFyZ2V0Ll9hc3NvY2lhdGlvbkNvdW50cykge1xuICAgICAgcmVzdWx0W2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhIHZhbHVlIGF0dGFjaGVkIGJ5IGAucXVlcnlEYXRhKC4uLilgLiBTdG9yZWQgb24gYSBkZWRpY2F0ZWRcbiAgICogbWFwIHJhdGhlciB0aGFuIG9uIGBfYXR0cmlidXRlc2AsIHNvIGEgdmlydHVhbCBxdWVyeURhdGEga2V5IGxpa2VcbiAgICogYHRyYW5zcG9ydFNlY29uZHNTdW1gIGNhbm5vdCBzaWxlbnRseSBzaGFkb3cgYSByZWFsIGNvbHVtbiBvZiB0aGVcbiAgICogc2FtZSBuYW1lLiBSZXR1cm5zIGBudWxsYCB3aGVuIHRoZSBrZXkgd2Fzbid0IHByb2R1Y2VkIGJ5IGFueVxuICAgKiByZWdpc3RlcmVkIGZuIGZvciB0aGlzIHJlY29yZCAoZS5nLiBubyBjaGlsZCByb3dzIG1hdGNoZWQgdGhlXG4gICAqIGFnZ3JlZ2F0ZSkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gcXVlcnlEYXRhIGF0dHJpYnV0ZSBuYW1lIChtYXRjaGVzIGEgU0VMRUNUIGFsaWFzIGZyb20gdGhlIHJlZ2lzdGVyZWQgZm4pLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQXR0YWNoZWQgcXVlcnktZGF0YSB2YWx1ZS5cbiAgICovXG4gIHF1ZXJ5RGF0YShuYW1lKSB7XG4gICAgcmV0dXJuIHJlYWRQYXlsb2FkUXVlcnlEYXRhKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0dGFjaCBhIHF1ZXJ5RGF0YSB2YWx1ZSB0byB0aGlzIHJlY29yZC4gSW50ZXJuYWwgaGVscGVyIHVzZWQgYnlcbiAgICogdGhlIGBxdWVyeURhdGFgIHJ1bm5lciBhbmQgYnkgZnJvbnRlbmQtbW9kZWwgaHlkcmF0aW9uOyBvdXRzaWRlXG4gICAqIGNvZGUgc2hvdWxkIG5vdCBjYWxsIHRoaXMgZGlyZWN0bHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gcXVlcnlEYXRhIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIGF0dGFjaC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0UXVlcnlEYXRhKG5hbWUsIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZFF1ZXJ5RGF0YSgvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgbmFtZSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogQWxsIGF0dGFjaGVkIHF1ZXJ5RGF0YSB2YWx1ZXMgYXMgYSBwbGFpbiBvYmplY3QuIFVzZWQgYnkgdGhlXG4gICAqIGZyb250ZW5kLW1vZGVsIHNlcmlhbGl6ZXIgdG8gc2hpcCBxdWVyeURhdGEgYWxvbmdzaWRlIHRoZSByZWNvcmRcbiAgICogYXR0cmlidXRlcyBvbiB0aGUgd2lyZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBRdWVyeS1kYXRhIHZhbHVlcyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgcXVlcnlEYXRhVmFsdWVzKCkge1xuICAgIC8qKlxuICAgICAqIFJlc3VsdC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgICBjb25zdCB0YXJnZXQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuXG4gICAgaWYgKCF0YXJnZXQuX3F1ZXJ5RGF0YVZhbHVlcykgcmV0dXJuIHJlc3VsdFxuXG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIHRhcmdldC5fcXVlcnlEYXRhVmFsdWVzKSB7XG4gICAgICByZXN1bHRbbmFtZV0gPSB2YWx1ZVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGEgcGVyLXJlY29yZCBhYmlsaXR5IHJlc3VsdCBhdHRhY2hlZCBieSBgLmFiaWxpdGllcyguLi4pYC4gVGhlXG4gICAqIGJhY2tlbmQgZXZhbHVhdGVzIGVhY2ggcmVxdWVzdGVkIGFjdGlvbiBhZ2FpbnN0IHRoZSBjdXJyZW50IGFiaWxpdHlcbiAgICogZm9yIHRoaXMgcmVjb3JkIGluc3RhbmNlIGFuZCBzaGlwcyB0aGUgcmVzdWx0IGFsb25nc2lkZSB0aGVcbiAgICogcmVjb3JkJ3MgYXR0cmlidXRlcy4gUmV0dXJucyBgZmFsc2VgIHdoZW4gdGhlIGFjdGlvbiB3YXNuJ3RcbiAgICogcmVxdWVzdGVkIGZvciB0aGlzIHJlY29yZCDigJQgc28gVUkgY29kZSBjYW4gc2FmZWx5IGJyYW5jaCBvblxuICAgKiBgcmVjb3JkLmNhbihcInVwZGF0ZVwiKWAgd2l0aG91dCBmaXJzdCBjaGVja2luZyB3aGV0aGVyIHRoZSBhYmlsaXR5XG4gICAqIHdhcyBsb2FkZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbiBuYW1lLCBlLmcuIGBcInVwZGF0ZVwiYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVxdWVzdGVkIGFiaWxpdHkgaXMgYWxsb3dlZC5cbiAgICovXG4gIGNhbihhY3Rpb24pIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRDb21wdXRlZEFiaWxpdHkoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGFjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRhY2ggYSBwZXItcmVjb3JkIGFiaWxpdHkgcmVzdWx0IHRvIHRoaXMgcmVjb3JkLiBJbnRlcm5hbCBoZWxwZXJcbiAgICogdXNlZCBieSB0aGUgYGFiaWxpdGllc2AgcnVubmVyIGFuZCBieSBmcm9udGVuZC1tb2RlbCBoeWRyYXRpb247XG4gICAqIG91dHNpZGUgY29kZSBzaG91bGQgbm90IGNhbGwgdGhpcyBkaXJlY3RseS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEFiaWxpdHkgYWN0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gdmFsdWUgLSBXaGV0aGVyIHRoZSBjdXJyZW50IGFiaWxpdHkgcGVybWl0cyB0aGUgYWN0aW9uIG9uIHRoaXMgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRDb21wdXRlZEFiaWxpdHkoYWN0aW9uLCB2YWx1ZSkge1xuICAgIHNldFBheWxvYWRDb21wdXRlZEFiaWxpdHkoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGFjdGlvbiwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogQWxsIGF0dGFjaGVkIHBlci1yZWNvcmQgYWJpbGl0eSByZXN1bHRzIGFzIGEgcGxhaW4gb2JqZWN0LiBVc2VkXG4gICAqIGJ5IHRoZSBmcm9udGVuZC1tb2RlbCBzZXJpYWxpemVyIHRvIHNoaXAgcmVzdWx0cyBhbG9uZ3NpZGUgdGhlXG4gICAqIHJlY29yZCBhdHRyaWJ1dGVzIG9uIHRoZSB3aXJlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgYm9vbGVhbj59IC0gQWJpbGl0eSByZXN1bHRzIGtleWVkIGJ5IGFjdGlvbi5cbiAgICovXG4gIGNvbXB1dGVkQWJpbGl0aWVzKCkge1xuICAgIC8qKlxuICAgICAqIFJlc3VsdC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbj59ICovXG4gICAgY29uc3QgcmVzdWx0ID0ge31cblxuICAgIGNvbnN0IHRhcmdldCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG5cbiAgICBpZiAoIXRhcmdldC5fY29tcHV0ZWRBYmlsaXRpZXMpIHJldHVybiByZXN1bHRcblxuICAgIGZvciAoY29uc3QgW2FjdGlvbiwgdmFsdWVdIG9mIHRhcmdldC5fY29tcHV0ZWRBYmlsaXRpZXMpIHtcbiAgICAgIHJlc3VsdFthY3Rpb25dID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYSBjb2x1bW4gdmFsdWUgZnJvbSB0aGUgcmVjb3JkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSBUaGUgbmFtZSBvZiB0aGUgY29sdW1uIHRvIHJlYWQuIFRoaXMgaXMgdGhlIGNvbHVtbiBuYW1lLCBub3QgdGhlIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGNvbHVtbi5cbiAgICovXG4gIHJlYWRDb2x1bW4oYXR0cmlidXRlTmFtZSkge1xuICAgIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIGNvbnN0IGJlbG9uZ3NUb0NoYW5nZXMgPSB0aGlzLl9iZWxvbmdzVG9DaGFuZ2VzKClcbiAgICBsZXQgcmVzdWx0XG5cbiAgICBpZiAoYXR0cmlidXRlTmFtZSBpbiBiZWxvbmdzVG9DaGFuZ2VzKSB7XG4gICAgICByZXN1bHQgPSBiZWxvbmdzVG9DaGFuZ2VzW2F0dHJpYnV0ZU5hbWVdXG4gICAgfSBlbHNlIGlmIChhdHRyaWJ1dGVOYW1lIGluIHRoaXMuX2NoYW5nZXMpIHtcbiAgICAgIHJlc3VsdCA9IHRoaXMuX2NoYW5nZXNbYXR0cmlidXRlTmFtZV1cbiAgICB9IGVsc2UgaWYgKGF0dHJpYnV0ZU5hbWUgaW4gdGhpcy5fYXR0cmlidXRlcykge1xuICAgICAgcmVzdWx0ID0gdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuICAgIH0gZWxzZSBpZiAodGhpcy5pc1BlcnNpc3RlZCgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHN1Y2ggYXR0cmlidXRlIG9yIG5vdCBzZWxlY3RlZCAke3RoaXMuY29uc3RydWN0b3IubmFtZX0jJHthdHRyaWJ1dGVOYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgY29sdW1uVHlwZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtblR5cGVCeU5hbWUoYXR0cmlidXRlTmFtZSlcblxuICAgIGlmIChjb2x1bW5UeXBlICYmIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9pc0RhdGVMaWtlVHlwZShjb2x1bW5UeXBlKSkge1xuICAgICAgcmVzdWx0ID0gdGhpcy5fbm9ybWFsaXplRGF0ZVZhbHVlRm9yUmVhZChyZXN1bHQpXG4gICAgfVxuXG4gICAgcmVzdWx0ID0gdGhpcy5fbm9ybWFsaXplQm9vbGVhblZhbHVlRm9yUmVhZCh7Y29sdW1uTmFtZTogYXR0cmlidXRlTmFtZSwgY29sdW1uVHlwZSwgdmFsdWU6IHJlc3VsdH0pXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW55IGRlY2xhcmVkIHBlci1hdHRyaWJ1dGUgY2FzdCBmb3IgYSBkYXRhYmFzZSBjb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBEYXRhYmFzZSBjb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBEZWNsYXJlZCBjYXN0IHR5cGUsIG9yIHVuZGVmaW5lZCB3aGVuIG5vbmUgaXMgZGVjbGFyZWQuXG4gICAqL1xuICBfZGVjbGFyZWRBdHRyaWJ1dGVDYXN0Rm9yQ29sdW1uKGNvbHVtbk5hbWUpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW2NvbHVtbk5hbWVdXG5cbiAgICBpZiAoIWF0dHJpYnV0ZU5hbWUpIHJldHVybiB1bmRlZmluZWRcblxuICAgIHJldHVybiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRBdHRyaWJ1dGVDYXN0KGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgYSBzdG9yZWQgdmFsdWUgdG8gYSByZWFsIGJvb2xlYW4gZm9yIGEgZGVjbGFyZWQgYFwiYm9vbGVhblwiYCBjYXN0LlxuICAgKiBMZWF2ZXMgbnVsbC91bmRlZmluZWQgdW50b3VjaGVkOyB0cmVhdHMgMS90cnVlL1wiMVwiIGFzIHRydWUgYW5kIDAvZmFsc2UvXCIwXCIgYXMgZmFsc2UuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU3RvcmVkIGRhdGFiYXNlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQ29udmVydGVkIGJvb2xlYW4sIG9yIHRoZSBvcmlnaW5hbCB2YWx1ZSB3aGVuIG5vdCByZWNvZ25pemVkLlxuICAgKi9cbiAgX2Nhc3REZWNsYXJlZEJvb2xlYW5Gb3JSZWFkKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB2YWx1ZVxuICAgIGlmIChkZWNsYXJlZEJvb2xlYW5UcnV0aHlWYWx1ZXMuaGFzKHZhbHVlKSkgcmV0dXJuIHRydWVcbiAgICBpZiAoZGVjbGFyZWRCb29sZWFuRmFsc3lWYWx1ZXMuaGFzKHZhbHVlKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgY29sdW1uIHZhbHVlIGlzIGN1cnJlbnRseSBsb2FkZWQgb24gdGhpcyByZWNvcmQgKGVpdGhlciBhcyBhXG4gICAqIHBlcnNpc3RlZCBhdHRyaWJ1dGUgb3IgYSBwZW5kaW5nIGNoYW5nZSkuIFVzZWQgdG8gZGVjaWRlIHdoZXRoZXIgYSBwcmVsb2FkXG4gICAqIGNhbiBiZSBza2lwcGVkIGJlY2F1c2UgdGhlIHJlcXVpcmVkIGNvbHVtbnMgYXJlIGFscmVhZHkgcHJlc2VudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBUaGUgY29sdW1uIG5hbWUgdG8gY2hlY2suXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbHVtbiBpcyBsb2FkZWQuXG4gICAqL1xuICBoYXNMb2FkZWRDb2x1bW4oY29sdW1uTmFtZSkge1xuICAgIHJldHVybiBjb2x1bW5OYW1lIGluIHRoaXMuX2NoYW5nZXMgfHwgY29sdW1uTmFtZSBpbiB0aGlzLl9hdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgYm9vbGVhbiB2YWx1ZSBmb3IgcmVhZC4gQSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGF0dHJpYnV0ZSBjYXN0IGNvbnZlcnRzIHRoZVxuICAgKiBzdG9yZWQgdmFsdWUgKGUuZy4gYW4gTVNTUUwgYGJpdGAgMC8xKSB0byBhIHJlYWwgYm9vbGVhbjsgb3RoZXJ3aXNlIHRoZSBleGlzdGluZ1xuICAgKiBpbnRyb3NwZWN0ZWQtdHlwZSBub3JtYWxpemF0aW9uIGFwcGxpZXMgKG5vIGJlaGF2aW91ciBjaGFuZ2UgZm9yIG5vbi1kZWNsYXJlZCBjb2x1bW5zKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uTmFtZSAtIERhdGFiYXNlIGNvbHVtbiBuYW1lIGJlaW5nIHJlYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBfbm9ybWFsaXplQm9vbGVhblZhbHVlRm9yUmVhZCh7Y29sdW1uTmFtZSwgY29sdW1uVHlwZSwgdmFsdWV9KSB7XG4gICAgaWYgKHRoaXMuX2RlY2xhcmVkQXR0cmlidXRlQ2FzdEZvckNvbHVtbihjb2x1bW5OYW1lKSA9PT0gXCJib29sZWFuXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLl9jYXN0RGVjbGFyZWRCb29sZWFuRm9yUmVhZCh2YWx1ZSlcbiAgICB9XG5cbiAgICBpZiAoIWNvbHVtblR5cGUpIHJldHVybiB2YWx1ZVxuICAgIGlmIChjb2x1bW5UeXBlLnRvTG93ZXJDYXNlKCkgIT09IFwiYm9vbGVhblwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAodmFsdWUgPT09IDEpIHJldHVybiB0cnVlXG4gICAgaWYgKHZhbHVlID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRhdGUgdmFsdWUgZm9yIHJlYWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgZnJvbSBkYXRhYmFzZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBfbm9ybWFsaXplRGF0ZVZhbHVlRm9yUmVhZCh2YWx1ZSkge1xuICAgIHJldHVybiBub3JtYWxpemVEYXRlVmFsdWVGb3JSZWFkKHZhbHVlLCB7ZGF0YWJhc2VUeXBlOiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXREYXRhYmFzZVR5cGUoKX0pXG4gIH1cblxuICBfYmVsb25nc1RvQ2hhbmdlcygpIHtcbiAgICAvKipcbiAgICAgKiBCZWxvbmdzIHRvIGNoYW5nZXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBiZWxvbmdzVG9DaGFuZ2VzID0ge31cblxuICAgIGlmICh0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJiZWxvbmdzVG9cIiAmJiByZWxhdGlvbnNoaXAuZ2V0RGlydHkoKSkge1xuICAgICAgICAgIGNvbnN0IG1vZGVsID0gcmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKClcblxuICAgICAgICAgIGlmIChtb2RlbCkge1xuICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobW9kZWwpKSB0aHJvdyBuZXcgRXJyb3IoXCJVbmV4cGVjdGVkIGJlbG9uZ3MtdG8gbW9kZWwgYXJyYXlcIilcblxuICAgICAgICAgICAgYmVsb25nc1RvQ2hhbmdlc1tyZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXSA9IHRoaXMuX2JlbG9uZ3NUb0ZvcmVpZ25LZXlWYWx1ZSh7bW9kZWwsIHJlbGF0aW9uc2hpcH0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGJlbG9uZ3NUb0NoYW5nZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBuZXcgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2NyZWF0ZU5ld1JlY29yZCgpIHtcbiAgICAvLyBSZXNvbHZlIHRoZSBjb25uZWN0aW9uIG9uY2UgYW5kIHBpbiB0aGUgd2hvbGUgaW5zZXJ0IHBhdGggdG8gaXQ6IGEgcG9vbFxuICAgIC8vIGNhbiByZXNvbHZlIGEgZGlmZmVyZW50IGN1cnJlbnQgY29ubmVjdGlvbiBhY3Jvc3MgdGhlIGF3YWl0cyBiZWxvdywgYW5kXG4gICAgLy8gdGhlIGlkZW50aXR5LWluc2VydCB3cmFwcGVyIGlzIG9ubHkgZWZmZWN0aXZlIG9uIHRoZSBleGFjdCBzZXNzaW9uIHRoYXRcbiAgICAvLyByYW4gU0VUIElERU5USVRZX0lOU0VSVC5cbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5fY29ubmVjdGlvbigpXG5cbiAgICBpZiAoIWNvbm5lY3Rpb25bXCJpbnNlcnRTcWxcIl0pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gaW5zZXJ0U3FsIG9uICR7Y29ubmVjdGlvbi5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgZGF0YSA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuX2JlbG9uZ3NUb0NoYW5nZXMoKSwgdGhpcy5yYXdBdHRyaWJ1dGVzKCkpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IHByaW1hcnlLZXlDb2x1bW5zID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1ucygpLmZpbHRlcigoY29sdW1uKSA9PiB7XG4gICAgICByZXR1cm4gQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSA/IHByaW1hcnlLZXkuaW5jbHVkZXMoY29sdW1uLmdldE5hbWUoKSkgOiBjb2x1bW4uZ2V0TmFtZSgpID09IHByaW1hcnlLZXlcbiAgICB9KVxuICAgIGNvbnN0IHByaW1hcnlLZXlDb2x1bW4gPSBBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpID8gdW5kZWZpbmVkIDogcHJpbWFyeUtleUNvbHVtbnNbMF1cbiAgICBjb25zdCBwcmltYXJ5S2V5VHlwZSA9IHByaW1hcnlLZXlDb2x1bW4/LmdldFR5cGUoKT8udG9Mb3dlckNhc2UoKVxuICAgIGNvbnN0IGRyaXZlclN1cHBvcnRzRGVmYXVsdFVVSUQgPSB0eXBlb2YgY29ubmVjdGlvbi5zdXBwb3J0c0RlZmF1bHRQcmltYXJ5S2V5VVVJRCA9PSBcImZ1bmN0aW9uXCIgJiYgY29ubmVjdGlvbi5zdXBwb3J0c0RlZmF1bHRQcmltYXJ5S2V5VVVJRCgpXG4gICAgY29uc3QgaXNVVUlEUHJpbWFyeUtleSA9IHByaW1hcnlLZXlUeXBlPy5pbmNsdWRlcyhcInV1aWRcIilcbiAgICBjb25zdCBzaG91bGRBc3NpZ25VVUlEUHJpbWFyeUtleSA9IGlzVVVJRFByaW1hcnlLZXkgJiYgIWRyaXZlclN1cHBvcnRzRGVmYXVsdFVVSURcbiAgICB0aGlzLl9zZXREZWZhdWx0VGltZXN0YW1wVmFsdWVzKGRhdGEpXG5cbiAgICBjb25zdCBjb2x1bW5OYW1lcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbk5hbWVzKClcbiAgICBjb25zdCBoYXNVc2VyUHJvdmlkZWRQcmltYXJ5S2V5ID0gQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KVxuICAgICAgPyBwcmltYXJ5S2V5LmV2ZXJ5KChjb2x1bW5OYW1lKSA9PiBkYXRhW2NvbHVtbk5hbWVdICE9PSB1bmRlZmluZWQgJiYgZGF0YVtjb2x1bW5OYW1lXSAhPT0gbnVsbCAmJiBkYXRhW2NvbHVtbk5hbWVdICE9PSBcIlwiKVxuICAgICAgOiBkYXRhW3ByaW1hcnlLZXldICE9PSB1bmRlZmluZWQgJiYgZGF0YVtwcmltYXJ5S2V5XSAhPT0gbnVsbCAmJiBkYXRhW3ByaW1hcnlLZXldICE9PSBcIlwiXG4gICAgY29uc3QgaGFzVXNlclByb3ZpZGVkQXV0b0luY3JlbWVudFByaW1hcnlLZXkgPSBwcmltYXJ5S2V5Q29sdW1ucy5zb21lKChjb2x1bW4pID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZGF0YVtjb2x1bW4uZ2V0TmFtZSgpXVxuXG4gICAgICByZXR1cm4gY29sdW1uLmdldEF1dG9JbmNyZW1lbnQoKSA9PT0gdHJ1ZSAmJiB2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsICYmIHZhbHVlICE9PSBcIlwiXG4gICAgfSlcblxuICAgIGlmIChzaG91bGRBc3NpZ25VVUlEUHJpbWFyeUtleSAmJiAhaGFzVXNlclByb3ZpZGVkUHJpbWFyeUtleSkge1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHRocm93IG5ldyBFcnJvcihcIkNvbXBvc2l0ZSBVVUlEIHByaW1hcnkga2V5cyBtdXN0IGJlIHByb3ZpZGVkIGV4cGxpY2l0bHkuXCIpXG5cbiAgICAgIGRhdGFbcHJpbWFyeUtleV0gPSBuZXcgVVVJRCg0KS5mb3JtYXQoKVxuICAgIH1cblxuICAgIHRoaXMuX25vcm1hbGl6ZURhdGVWYWx1ZXNGb3JXcml0ZShkYXRhKVxuXG4gICAgY29uc3Qgc3FsID0gY29ubmVjdGlvbi5pbnNlcnRTcWwoe1xuICAgICAgcmV0dXJuTGFzdEluc2VydGVkQ29sdW1uTmFtZXM6IGNvbHVtbk5hbWVzLFxuICAgICAgdGFibGVOYW1lOiB0aGlzLl90YWJsZU5hbWUoKSxcbiAgICAgIGRhdGFcbiAgICB9KVxuICAgIGNvbnN0IGluc2VydE9wdGlvbnMgPSB7bG9nTmFtZTogYCR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX0gQ3JlYXRlYH1cbiAgICAvLyBFeHBsaWNpdCBwcmltYXJ5LWtleSBpbnNlcnRzIGludG8gYXV0by1pbmNyZW1lbnQgY29sdW1ucyBnbyB0aHJvdWdoIHRoZVxuICAgIC8vIGRyaXZlcidzIGV4cGxpY2l0LXByaW1hcnkta2V5IGluc2VydCAoTVNTUUwgd3JhcHMgaXQgaW4gSURFTlRJVFlfSU5TRVJUKTtcbiAgICAvLyBldmVyeXRoaW5nIGVsc2UgdXNlcyB0aGUgcGxhaW4gcXVlcnkgcGF0aC5cbiAgICBjb25zdCBpbnNlcnRSZXN1bHQgPSBoYXNVc2VyUHJvdmlkZWRBdXRvSW5jcmVtZW50UHJpbWFyeUtleVxuICAgICAgPyBhd2FpdCBjb25uZWN0aW9uLmluc2VydFdpdGhFeHBsaWNpdFByaW1hcnlLZXkoe29wdGlvbnM6IGluc2VydE9wdGlvbnMsIHNxbCwgdGFibGVOYW1lOiB0aGlzLl90YWJsZU5hbWUoKX0pXG4gICAgICA6IGF3YWl0IGNvbm5lY3Rpb24ucXVlcnkoc3FsLCBpbnNlcnRPcHRpb25zKVxuXG4gICAgYXdhaXQgdGhpcy5fYXBwbHlJbnNlcnRSZXN1bHQoe2Nvbm5lY3Rpb24sIGRhdGEsIGluc2VydFJlc3VsdCwgcHJpbWFyeUtleX0pXG4gICAgdGhpcy5zZXRJc05ld1JlY29yZChmYWxzZSlcblxuICAgIHRoaXMuX21hcmtMb2FkZWRSZWxhdGlvbnNoaXBzUHJlbG9hZGVkQWZ0ZXJDcmVhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcmtzIG9ubHkgcmVsYXRpb25zaGlwcyB3aXRoIGluLW1lbW9yeSBsb2FkZWQgdmFsdWVzIGFzIHByZWxvYWRlZCBhZnRlciBjcmVhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9tYXJrTG9hZGVkUmVsYXRpb25zaGlwc1ByZWxvYWRlZEFmdGVyQ3JlYXRlKCkge1xuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwIG9mIHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldFJlbGF0aW9uc2hpcHMoKSkge1xuICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpKVxuXG4gICAgICBpZiAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09IFwiaGFzTWFueVwiICYmIGluc3RhbmNlUmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKCkgPT09IG51bGwpIHtcbiAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0TG9hZGVkKFtdKVxuICAgICAgfVxuXG4gICAgICBpZiAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwLnNldFByZWxvYWRlZCh0cnVlKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIHRoZSBkYXRhYmFzZSBpbnNlcnQgcmVzcG9uc2UgdG8gdGhpcyByZWNvcmQuXG4gICAqIEBwYXJhbSB7e2Nvbm5lY3Rpb246IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0LCBkYXRhOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgRGF0ZSB8IG51bGwgfCB1bmRlZmluZWQ+LCBpbnNlcnRSZXN1bHQ6IEFycmF5PFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBEYXRlIHwgbnVsbCB8IHVuZGVmaW5lZD4+IHwgbnVsbCB8IHVuZGVmaW5lZCwgcHJpbWFyeUtleTogc3RyaW5nIHwgc3RyaW5nW119fSBvcHRpb25zIC0gUGlubmVkIGluc2VydCBjb25uZWN0aW9uLCBpbnNlcnRlZCBkYXRhLCBjb25uZWN0aW9uIHJlc3VsdCwgYW5kIHByaW1hcnkga2V5IGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5SW5zZXJ0UmVzdWx0KHtjb25uZWN0aW9uLCBkYXRhLCBpbnNlcnRSZXN1bHQsIHByaW1hcnlLZXl9KSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHtcbiAgICAgIGNvbnN0IGluc2VydGVkUm93ID0gQXJyYXkuaXNBcnJheShpbnNlcnRSZXN1bHQpID8gaW5zZXJ0UmVzdWx0WzBdIDogdW5kZWZpbmVkXG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlbG9hZFdpdGhJZChyZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGNvbHVtbk5hbWUpID0+IGluc2VydGVkUm93Py5bY29sdW1uTmFtZV0gPz8gZGF0YVtjb2x1bW5OYW1lXSkpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShpbnNlcnRSZXN1bHQpICYmIGluc2VydFJlc3VsdFswXSAmJiBpbnNlcnRSZXN1bHRbMF1bcHJpbWFyeUtleV0pIHtcbiAgICAgIHRoaXMuX2F0dHJpYnV0ZXMgPSBpbnNlcnRSZXN1bHRbMF1cbiAgICAgIHRoaXMuX2NoYW5nZXMgPSB7fVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBwcmltYXJ5S2V5VmFsdWUgPSBkYXRhW3ByaW1hcnlLZXldXG5cbiAgICAgIGlmIChwcmltYXJ5S2V5VmFsdWUgIT09IHVuZGVmaW5lZCAmJiBwcmltYXJ5S2V5VmFsdWUgIT09IG51bGwgJiYgcHJpbWFyeUtleVZhbHVlICE9PSBcIlwiKSB7XG4gICAgICAgIGlmICh0eXBlb2YgcHJpbWFyeUtleVZhbHVlICE9IFwic3RyaW5nXCIgJiYgdHlwZW9mIHByaW1hcnlLZXlWYWx1ZSAhPSBcIm51bWJlclwiKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnNlcnRlZCBwcmltYXJ5IGtleSAke3ByaW1hcnlLZXl9IG11c3QgYmUgYSBzdHJpbmcgb3IgbnVtYmVyLCBnb3QgJHt0eXBlb2YgcHJpbWFyeUtleVZhbHVlfWApXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLl9yZWxvYWRXaXRoSWQocHJpbWFyeUtleVZhbHVlKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgY29uc3QgaWQgPSBhd2FpdCBjb25uZWN0aW9uLmxhc3RJbnNlcnRJRCgpXG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlbG9hZFdpdGhJZChpZClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aW1lc3RhbXAgZGVmYXVsdHMgZm9yIGEgbmV3IHJlY29yZCBpbnNlcnQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBkYXRhIC0gQ29sdW1uLWtleWVkIGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9zZXREZWZhdWx0VGltZXN0YW1wVmFsdWVzKGRhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVkQXRDb2x1bW4gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5zKCkuZmluZCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09IFwiY3JlYXRlZF9hdFwiKVxuICAgIGNvbnN0IHVwZGF0ZWRBdENvbHVtbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbnMoKS5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT0gXCJ1cGRhdGVkX2F0XCIpXG4gICAgY29uc3QgY3VycmVudERhdGUgPSBuZXcgRGF0ZSgpXG5cbiAgICBpZiAoY3JlYXRlZEF0Q29sdW1uICYmIChkYXRhLmNyZWF0ZWRfYXQgPT09IHVuZGVmaW5lZCB8fCBkYXRhLmNyZWF0ZWRfYXQgPT09IG51bGwgfHwgZGF0YS5jcmVhdGVkX2F0ID09PSBcIlwiKSkge1xuICAgICAgZGF0YS5jcmVhdGVkX2F0ID0gY3VycmVudERhdGVcbiAgICB9XG4gICAgaWYgKHVwZGF0ZWRBdENvbHVtbiAmJiAoZGF0YS51cGRhdGVkX2F0ID09PSB1bmRlZmluZWQgfHwgZGF0YS51cGRhdGVkX2F0ID09PSBudWxsIHx8IGRhdGEudXBkYXRlZF9hdCA9PT0gXCJcIikpIHtcbiAgICAgIGRhdGEudXBkYXRlZF9hdCA9IGN1cnJlbnREYXRlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRhdGUgdmFsdWVzIGZvciB3cml0ZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGRhdGEgLSBDb2x1bW4ta2V5ZWQgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX25vcm1hbGl6ZURhdGVWYWx1ZXNGb3JXcml0ZShkYXRhKSB7XG4gICAgZm9yIChjb25zdCBjb2x1bW5OYW1lIGluIGRhdGEpIHtcbiAgICAgIGNvbnN0IGNvbHVtblR5cGUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5UeXBlQnlOYW1lKGNvbHVtbk5hbWUpXG5cbiAgICAgIGlmICghY29sdW1uVHlwZSB8fCAhdGhpcy5nZXRNb2RlbENsYXNzKCkuX2lzRGF0ZUxpa2VUeXBlKGNvbHVtblR5cGUpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCB2YWx1ZSA9IGRhdGFbY29sdW1uTmFtZV1cblxuICAgICAgZGF0YVtjb2x1bW5OYW1lXSA9IG5vcm1hbGl6ZURhdGVWYWx1ZUZvcldyaXRlKHZhbHVlLCB7dGltZVpvbmU6IHRoaXMuZ2V0TW9kZWxDbGFzcygpLl90aW1lWm9uZUZvckRhdGVXcml0ZSgpfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUgcmVjb3JkIHdpdGggY2hhbmdlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF91cGRhdGVSZWNvcmRXaXRoQ2hhbmdlcygpIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5fY29ubmVjdGlvbigpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IHBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSA9IHRoaXMuX3BlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpXG4gICAgY29uc3QgbmV4dFByaW1hcnlLZXlWYWx1ZSA9IHRoaXMuaWQoKVxuICAgIC8qKlxuICAgICAqIENvbmRpdGlvbnMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBjb25kaXRpb25zID0ge31cblxuICAgIE9iamVjdC5hc3NpZ24oY29uZGl0aW9ucywgbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhwcmltYXJ5S2V5LCBwZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUpKVxuXG4gICAgY29uc3QgY2hhbmdlcyA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuX2JlbG9uZ3NUb0NoYW5nZXMoKSwgdGhpcy5fY2hhbmdlcylcbiAgICBjb25zdCB1cGRhdGVkQXRDb2x1bW4gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5zKCkuZmluZCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09IFwidXBkYXRlZF9hdFwiKVxuICAgIGNvbnN0IGN1cnJlbnREYXRlID0gbmV3IERhdGUoKVxuXG4gICAgaWYgKHVwZGF0ZWRBdENvbHVtbiAmJiAoY2hhbmdlcy51cGRhdGVkX2F0ID09PSB1bmRlZmluZWQgfHwgY2hhbmdlcy51cGRhdGVkX2F0ID09PSBudWxsIHx8IGNoYW5nZXMudXBkYXRlZF9hdCA9PT0gXCJcIikpIHtcbiAgICAgIGNoYW5nZXMudXBkYXRlZF9hdCA9IGN1cnJlbnREYXRlXG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGNoYW5nZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgIHRoaXMuX25vcm1hbGl6ZURhdGVWYWx1ZXNGb3JXcml0ZShjaGFuZ2VzKVxuICAgICAgY29uc3Qgc3FsID0gY29ubmVjdGlvbi51cGRhdGVTcWwoe1xuICAgICAgICB0YWJsZU5hbWU6IHRoaXMuX3RhYmxlTmFtZSgpLFxuICAgICAgICBkYXRhOiBjaGFuZ2VzLFxuICAgICAgICBjb25kaXRpb25zXG4gICAgICB9KVxuICAgICAgYXdhaXQgY29ubmVjdGlvbi5xdWVyeShzcWwsIHtsb2dOYW1lOiBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBVcGRhdGVgfSlcblxuICAgICAgaWYgKFxuICAgICAgICBPYmplY3Qua2V5cyh0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRBdHRhY2htZW50cygpKS5sZW5ndGggPiAwXG4gICAgICAgICYmIG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSkgIT09IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIG5leHRQcmltYXJ5S2V5VmFsdWUpXG4gICAgICApIHtcbiAgICAgICAgYXdhaXQgcmVjb3JkQXR0YWNobWVudHNTdG9yZUZvck1vZGVsKHRoaXMpLm1pZ3JhdGVSZWNvcmRJZGVudGl0eSh7XG4gICAgICAgICAgY29ubmVjdGlvbixcbiAgICAgICAgICBtb2RlbDogdGhpcyxcbiAgICAgICAgICBuZXh0SWRlbnRpdHk6IG5leHRQcmltYXJ5S2V5VmFsdWUsXG4gICAgICAgICAgcHJldmlvdXNJZGVudGl0eTogcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlbG9hZFdpdGhJZChuZXh0UHJpbWFyeUtleVZhbHVlKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IC0gVGhlIGlkLlxuICAgKi9cbiAgaWQoKSB7XG4gICAgaWYgKCF0aGlzLmdldE1vZGVsQ2xhc3MoKS5fY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb2x1bW4gbmFtZXMgbWFwcGluZyBoYXNuJ3QgYmVlbiBzZXQgb24gJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9LiBIYXMgdGhlIG1vZGVsIGJlZW4gaW5pdGlhbGl6ZWQ/YClcbiAgICB9XG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkge1xuICAgICAgcmV0dXJuIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoY29sdW1uTmFtZSkgPT4gdGhpcy5yZWFkQ29sdW1uKGNvbHVtbk5hbWUpKVxuICAgIH1cblxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbcHJpbWFyeUtleV1cblxuICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUHJpbWFyeSBrZXkgJHtwcmltYXJ5S2V5fSBkb2Vzbid0IGV4aXN0IGluIGNvbHVtbnM6ICR7T2JqZWN0LmtleXModGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpKS5qb2luKFwiLCBcIil9YClcbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtudW1iZXIgfCBzdHJpbmd9ICovICh0aGlzLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgaWRlbnRpdHkgcmVwcmVzZW50ZWQgYnkgdGhlIGxhc3QgcGVyc2lzdGVkIGRhdGFiYXNlIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gLSBQZXJzaXN0ZWQgaWRlbnRpdHkuXG4gICAqL1xuICBfcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKCkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KClcblxuICAgIHJldHVybiByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGNvbHVtbk5hbWUpID0+IHRoaXMuX2F0dHJpYnV0ZXNbY29sdW1uTmFtZV0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBwZXJzaXN0ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcGVyc2lzdGVkLlxuICAgKi9cbiAgaXNQZXJzaXN0ZWQoKSB7IHJldHVybiAhdGhpcy5faXNOZXdSZWNvcmQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIG5ldyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgbmV3IHJlY29yZC5cbiAgICovXG4gIGlzTmV3UmVjb3JkKCkgeyByZXR1cm4gdGhpcy5faXNOZXdSZWNvcmQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBpcyBuZXcgcmVjb3JkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld0lzTmV3UmVjb3JkIC0gTmV3IGlzIG5ldyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldElzTmV3UmVjb3JkKG5ld0lzTmV3UmVjb3JkKSB7XG4gICAgdGhpcy5faXNOZXdSZWNvcmQgPSBuZXdJc05ld1JlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsb2FkIHdpdGggaWQuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIFJlY29yZCBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3JlbG9hZFdpdGhJZChpZCkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KClcblxuICAgIC8qKlxuICAgICAqIFdoZXJlIG9iamVjdC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHdoZXJlT2JqZWN0ID0ge31cblxuICAgIE9iamVjdC5hc3NpZ24od2hlcmVPYmplY3QsIG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMocHJpbWFyeUtleSwgaWQpKVxuXG4gICAgY29uc3QgcXVlcnkgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8TUM+fSAqLyAoXG4gICAgICB0aGlzXG4gICAgICAgIC5xdWVyeUZvck1vZGVsKHRoaXMuZ2V0TW9kZWxDbGFzcygpKVxuICAgICAgICAud2hlcmUod2hlcmVPYmplY3QpXG4gICAgKVxuICAgIGNvbnN0IHJlbG9hZGVkTW9kZWwgPSBhd2FpdCBxdWVyeS5maXJzdCgpXG5cbiAgICBpZiAoIXJlbG9hZGVkTW9kZWwpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IyR7aWR9IGNvdWxkbid0IGJlIHJlbG9hZGVkIC0gcmVjb3JkIGRpZG4ndCBleGlzdGApXG5cbiAgICB0aGlzLl9hdHRyaWJ1dGVzID0gcmVsb2FkZWRNb2RlbC5yYXdBdHRyaWJ1dGVzKClcbiAgICB0aGlzLl9jaGFuZ2VzID0ge31cbiAgICB0aGlzLl9hc3NpZ25lZEF0dHJpYnV0ZU5hbWVzID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByZWxvYWQoKSB7XG4gICAgY29uc3QgcmVjb3JkSWQgPSB0aGlzLl9wZXJzaXN0ZWRQcmltYXJ5S2V5VmFsdWUoKVxuICAgIGF3YWl0IHRoaXMuX3JlbG9hZFdpdGhJZChyZWNvcmRJZClcbiAgfVxuXG4gIGFzeW5jIF9ydW5WYWxpZGF0aW9ucygpIHtcbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHt0eXBlOiBzdHJpbmcsIG1lc3NhZ2U6IHN0cmluZ30+fSAqL1xuICAgIHRoaXMuX3ZhbGlkYXRpb25FcnJvcnMgPSB7fVxuXG4gICAgY29uc3QgdmFsaWRhdG9ycyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLl92YWxpZGF0b3JzXG5cbiAgICBpZiAodmFsaWRhdG9ycykge1xuICAgICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIGluIHZhbGlkYXRvcnMpIHtcbiAgICAgICAgY29uc3QgYXR0cmlidXRlVmFsaWRhdG9ycyA9IHZhbGlkYXRvcnNbYXR0cmlidXRlTmFtZV1cblxuICAgICAgICBmb3IgKGNvbnN0IHZhbGlkYXRvciBvZiBhdHRyaWJ1dGVWYWxpZGF0b3JzKSB7XG4gICAgICAgICAgYXdhaXQgdmFsaWRhdG9yLnZhbGlkYXRlKHttb2RlbDogdGhpcywgYXR0cmlidXRlTmFtZX0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXModGhpcy5fdmFsaWRhdGlvbkVycm9ycykubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgdmFsaWRhdGlvbkVycm9yID0gbmV3IFZhbGlkYXRpb25FcnJvcih0aGlzLmZ1bGxFcnJvck1lc3NhZ2VzKCkuam9pbihcIi4gXCIpKVxuXG4gICAgICB2YWxpZGF0aW9uRXJyb3Iuc2V0VmFsaWRhdGlvbkVycm9ycyh0aGlzLl92YWxpZGF0aW9uRXJyb3JzKVxuICAgICAgdmFsaWRhdGlvbkVycm9yLnNldE1vZGVsKHRoaXMpXG4gICAgICB2YWxpZGF0aW9uRXJyb3IudmVsb2Npb3VzID0ge3R5cGU6IFwidmFsaWRhdGlvbl9lcnJvclwifVxuXG4gICAgICB0aHJvdyB2YWxpZGF0aW9uRXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmdWxsIGVycm9yIG1lc3NhZ2VzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gVGhlIGZ1bGwgZXJyb3IgbWVzc2FnZXMuXG4gICAqL1xuICBmdWxsRXJyb3JNZXNzYWdlcygpIHtcbiAgICAvKipcbiAgICAgKiBWYWxpZGF0aW9uIGVycm9yIG1lc3NhZ2VzLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCB2YWxpZGF0aW9uRXJyb3JNZXNzYWdlcyA9IFtdXG5cbiAgICBpZiAodGhpcy5fdmFsaWRhdGlvbkVycm9ycykge1xuICAgICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIGluIHRoaXMuX3ZhbGlkYXRpb25FcnJvcnMpIHtcbiAgICAgICAgZm9yIChjb25zdCB2YWxpZGF0aW9uRXJyb3Igb2YgdGhpcy5fdmFsaWRhdGlvbkVycm9yc1thdHRyaWJ1dGVOYW1lXSkge1xuICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5odW1hbkF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSl9ICR7dmFsaWRhdGlvbkVycm9yLm1lc3NhZ2V9YFxuXG4gICAgICAgICAgdmFsaWRhdGlvbkVycm9yTWVzc2FnZXMucHVzaChtZXNzYWdlKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbGlkYXRpb25FcnJvck1lc3NhZ2VzXG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyB0aGUgYXR0cmlidXRlcyB0byB0aGUgcmVjb3JkIGFuZCBzYXZlcyBpdC5cbiAgICogQHBhcmFtIHtXcml0ZUF0dHJpYnV0ZXN9IGF0dHJpYnV0ZXNUb0Fzc2lnbiAtIFRoZSBhdHRyaWJ1dGVzIHRvIGFzc2lnbiB0byB0aGUgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgdXBkYXRlKGF0dHJpYnV0ZXNUb0Fzc2lnbikge1xuICAgIGlmIChhdHRyaWJ1dGVzVG9Bc3NpZ24pIHRoaXMuYXNzaWduKGF0dHJpYnV0ZXNUb0Fzc2lnbilcblxuICAgIGF3YWl0IHRoaXMuc2F2ZSgpXG4gIH1cbn1cblxuVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJWYWxpZGF0b3JUeXBlKFwiZm9ybWF0XCIsIFZhbGlkYXRvcnNGb3JtYXQpXG5WZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlclZhbGlkYXRvclR5cGUoXCJsZW5ndGhcIiwgVmFsaWRhdG9yc0xlbmd0aClcblZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyVmFsaWRhdG9yVHlwZShcInByZXNlbmNlXCIsIFZhbGlkYXRvcnNQcmVzZW5jZSlcblZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyVmFsaWRhdG9yVHlwZShcInVuaXF1ZW5lc3NcIiwgVmFsaWRhdG9yc1VuaXF1ZW5lc3MpXG5cbmV4cG9ydCB7QWR2aXNvcnlMb2NrQnVzeUVycm9yLCBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yLCBBZHZpc29yeUxvY2tUaW1lb3V0RXJyb3IsIFRlbmFudERhdGFiYXNlU2NvcGVFcnJvciwgVmFsaWRhdGlvbkVycm9yfVxuZXhwb3J0IGRlZmF1bHQgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRcbiJdfQ==