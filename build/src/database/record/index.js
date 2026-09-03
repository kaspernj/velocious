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
    /** @type {Record<string, {driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, type: "hasOne" | "hasMany"}> | undefined} */
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
     * @returns {Record<string, {driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, type: "hasOne" | "hasMany"}>} - Attachment definitions keyed by name.
     */
    static getAttachmentsMap() {
        if (!this._attachmentsMap) {
            /**
             * Narrows the runtime value to the documented type.
             * @type {Record<string, {driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, type: "hasOne" | "hasMany"}>} */
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
     * @returns {Record<string, {driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, type: "hasOne" | "hasMany"}>} - Attachment definitions.
     */
    static getAttachments() {
        return this.getAttachmentsMap();
    }
    /**
     * Runs get attachment by name.
     * @param {string} attachmentName - Attachment name.
     * @returns {{driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>, type: "hasOne" | "hasMany"}} - Attachment definition.
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
     * @param {"hasOne" | "hasMany"} args.type - Attachment type.
     * @returns {void} - No return value.
     */
    static _defineAttachment(attachmentName, { driver, type }) {
        if (!attachmentName || typeof attachmentName !== "string")
            throw new Error(`Invalid attachment name: ${attachmentName}`);
        if (attachmentName in this.getAttachmentsMap())
            throw new Error(`Attachment ${attachmentName} already exists`);
        this.getAttachmentsMap()[attachmentName] = { driver, type };
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
     * @param {{driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>}} [args] - Attachment options.
     * @returns {void} - No return value.
     */
    static hasOneAttachment(attachmentName, args = {}) {
        this._defineAttachment(attachmentName, { driver: args.driver, type: "hasOne" });
    }
    /**
     * Adds a collection attachment helper to the model.
     * @param {string} attachmentName - Attachment name.
     * @param {{driver?: string | AttachmentDriverConstructor | Record<string, ReturnType<typeof JSON.parse>>}} [args] - Attachment options.
     * @returns {void} - No return value.
     */
    static hasManyAttachments(attachmentName, args = {}) {
        this._defineAttachment(attachmentName, { driver: args.driver, type: "hasMany" });
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
                await this._runLifecycleCallbacks("beforeSave");
                // If any belongs-to-relationships was saved, then updated-at should still be set on this record.
                const { savedCount } = await this._autoSaveBelongsToRelationships();
                if (this.isPersisted()) {
                    await this._runLifecycleCallbacks("beforeUpdate");
                    // If any has-many-relationships will be saved, then updated-at should still be set on this record.
                    const autoSaveHasManyrelationships = this._autoSaveHasManyAndHasOneRelationshipsToSave();
                    if (this._hasChanges() || savedCount > 0 || autoSaveHasManyrelationships.length > 0) {
                        result = await this._updateRecordWithChanges();
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
        const primaryKeyColumn = Array.isArray(primaryKey) ? undefined : this.getModelClass().getColumns().find((column) => column.getName() == primaryKey);
        const primaryKeyType = primaryKeyColumn?.getType()?.toLowerCase();
        const driverSupportsDefaultUUID = typeof connection.supportsDefaultPrimaryKeyUUID == "function" && connection.supportsDefaultPrimaryKeyUUID();
        const isUUIDPrimaryKey = primaryKeyType?.includes("uuid");
        const shouldAssignUUIDPrimaryKey = isUUIDPrimaryKey && !driverSupportsDefaultUUID;
        this._setDefaultTimestampValues(data);
        const columnNames = this.getModelClass().getColumnNames();
        const hasUserProvidedPrimaryKey = Array.isArray(primaryKey)
            ? primaryKey.every((columnName) => data[columnName] !== undefined && data[columnName] !== null && data[columnName] !== "")
            : data[primaryKey] !== undefined && data[primaryKey] !== null && data[primaryKey] !== "";
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
        const insertResult = hasUserProvidedPrimaryKey && primaryKeyColumn?.getAutoIncrement() === true
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
            await this._reloadWithId(readModelPrimaryKeyValue(primaryKey, (columnName) => data[columnName]));
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
            const sql = this._connection().updateSql({
                tableName: this._tableName(),
                data: changes,
                conditions
            });
            await this._connection().query(sql, { logName: `${this.getModelClass().name} Update` });
            if (Object.keys(this.getModelClass().getAttachments()).length > 0
                && modelPrimaryKeyCacheKey(primaryKey, persistedPrimaryKeyValue) !== modelPrimaryKeyCacheKey(primaryKey, nextPrimaryKeyValue)) {
                await recordAttachmentsStoreForModel(this).migrateRecordIdentity({
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7O0dBR0c7QUFFSDs7OztHQUlHO0FBRUg7Ozs7R0FJRztBQUVIOzs7R0FHRztBQUVILDhHQUE4RztBQUU5Rzs7O0dBR0c7QUFFSCxPQUFPLGtCQUFrQixFQUFFLEVBQUMscUJBQXFCLEVBQUUsNEJBQTRCLEVBQUUsd0JBQXdCLEVBQUMsTUFBTSw0QkFBNEIsQ0FBQTtBQUM1SSxPQUFPLDZCQUE2QixNQUFNLHdDQUF3QyxDQUFBO0FBQ2xGLE9BQU8scUJBQXFCLE1BQU0sK0JBQStCLENBQUE7QUFDakUsT0FBTyxhQUFhLE1BQU0sd0JBQXdCLENBQUE7QUFDbEQsT0FBTyxPQUFPLE1BQU0sa0JBQWtCLENBQUE7QUFDdEMsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFDOUMsT0FBTyxPQUFPLE1BQU0sZUFBZSxDQUFBO0FBQ25DLE9BQU8sMkJBQTJCLE1BQU0sc0NBQXNDLENBQUE7QUFDOUUsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUM3RCxPQUFPLDBCQUEwQixNQUFNLHFDQUFxQyxDQUFBO0FBQzVFLE9BQU8sa0JBQWtCLE1BQU0sNEJBQTRCLENBQUE7QUFDM0QsT0FBTyxzQkFBc0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM1RCxPQUFPLEVBQUMsOEJBQThCLEVBQUMsTUFBTSx3QkFBd0IsQ0FBQTtBQUNyRSxPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUN4QyxPQUFPLGdCQUFnQixNQUFNLG1DQUFtQyxDQUFBO0FBQ2hFLE9BQU8sZUFBZSxNQUFNLCtCQUErQixDQUFBO0FBQzNELE9BQU8sU0FBUyxNQUFNLHVCQUF1QixDQUFBO0FBQzdDLE9BQU8sRUFBQywyQkFBMkIsRUFBRSwwQkFBMEIsRUFBRSxvQkFBb0IsRUFBRSww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LGdCQUFnQixDQUFDLENBQUE7QUFDekUsdUJBQXVCLENBQUMscUJBQXFCLENBQUMsVUFBVSxFQUFFLGtCQUFrQixDQUFDLENBQUE7QUFDN0UsdUJBQXVCLENBQUMscUJBQXFCLENBQUMsWUFBWSxFQUFFLG9CQUFvQixDQUFDLENBQUE7QUFFakYsT0FBTyxFQUFDLHFCQUFxQixFQUFFLDRCQUE0QixFQUFFLHdCQUF3QixFQUFFLHdCQUF3QixFQUFFLGVBQWUsRUFBQyxDQUFBO0FBQ2pJLGVBQWUsdUJBQXVCLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7dHlwZTogc3RyaW5nLCBtZXNzYWdlOiBzdHJpbmd9fSBWYWxpZGF0aW9uRXJyb3JPYmplY3RUeXBlXG4gKi9cblxuLyoqXG4gKiBMaWZlY3ljbGVDYWxsYmFja1R5cGUgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBbVD1WZWxvY2lvdXNEYXRhYmFzZVJlY29yZF1cbiAqIEB0eXBlZGVmIHsoKG1vZGVsOiBUKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPikgfCBzdHJpbmd9IExpZmVjeWNsZUNhbGxiYWNrVHlwZVxuICovXG5cbi8qKlxuICogTW9kZWwgY2xhc3MgY29uc3RydWN0b3IgdHlwZSB1c2VkIGZvciBzdGF0aWMgYHRoaXNgIHR5cGluZy5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAdHlwZWRlZiB7e25ldyAoY2hhbmdlcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogVH19IE1vZGVsQ29uc3RydWN0b3JcbiAqL1xuXG4vKipcbiAqIFJlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXAgdHlwZS5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0ICYge3F1ZXJ5OiAoKSA9PiBNb2RlbENsYXNzUXVlcnk8dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPn19IFJlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXBcbiAqL1xuXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGV9IFRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlICovXG5cbi8qKlxuICogU2NoZW1hIG1ldGFkYXRhIGNhY2hlZCBmb3Igb25lIHJlY29yZCBjbGFzcyBhbmQgcGh5c2ljYWwgZGF0YWJhc2UgZ2VuZXJhdGlvbi5cbiAqIEB0eXBlZGVmIHtib29sZWFuIHwgbnVsbCB8IHN0cmluZyB8IHVuZGVmaW5lZCB8IFByb21pc2U8dm9pZD4gfCBzdHJpbmdbXSB8IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdFtdIHwgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQgfCBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPiB8IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD59IFJlY29yZE1ldGFkYXRhVmFsdWVcbiAqL1xuXG5pbXBvcnQgQWR2aXNvcnlMb2NrUnVubmVyLCB7QWR2aXNvcnlMb2NrQnVzeUVycm9yLCBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yLCBBZHZpc29yeUxvY2tUaW1lb3V0RXJyb3J9IGZyb20gXCIuLi9hZHZpc29yeS1sb2NrLXJ1bm5lci5qc1wiXG5pbXBvcnQgQmVsb25nc1RvSW5zdGFuY2VSZWxhdGlvbnNoaXAgZnJvbSBcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iZWxvbmdzLXRvLmpzXCJcbmltcG9ydCBCZWxvbmdzVG9SZWxhdGlvbnNoaXAgZnJvbSBcIi4vcmVsYXRpb25zaGlwcy9iZWxvbmdzLXRvLmpzXCJcbmltcG9ydCBDb25maWd1cmF0aW9uIGZyb20gXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCJcbmltcG9ydCBDdXJyZW50IGZyb20gXCIuLi8uLi9jdXJyZW50LmpzXCJcbmltcG9ydCBGcm9tVGFibGUgZnJvbSBcIi4uL3F1ZXJ5L2Zyb20tdGFibGUuanNcIlxuaW1wb3J0IEhhbmRsZXIgZnJvbSBcIi4uL2hhbmRsZXIuanNcIlxuaW1wb3J0IEhhc01hbnlJbnN0YW5jZVJlbGF0aW9uc2hpcCBmcm9tIFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2hhcy1tYW55LmpzXCJcbmltcG9ydCBIYXNNYW55UmVsYXRpb25zaGlwIGZyb20gXCIuL3JlbGF0aW9uc2hpcHMvaGFzLW1hbnkuanNcIlxuaW1wb3J0IEhhc09uZUluc3RhbmNlUmVsYXRpb25zaGlwIGZyb20gXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvaGFzLW9uZS5qc1wiXG5pbXBvcnQgSGFzT25lUmVsYXRpb25zaGlwIGZyb20gXCIuL3JlbGF0aW9uc2hpcHMvaGFzLW9uZS5qc1wiXG5pbXBvcnQgUmVjb3JkQXR0YWNobWVudEhhbmRsZSBmcm9tIFwiLi9hdHRhY2htZW50cy9oYW5kbGUuanNcIlxuaW1wb3J0IHtyZWNvcmRBdHRhY2htZW50c1N0b3JlRm9yTW9kZWx9IGZyb20gXCIuL2F0dGFjaG1lbnRzL3N0b3JlLmpzXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IGRlYnVyckNvbHVtbk5hbWUgZnJvbSBcIi4uLy4uL3V0aWxzL2RlYnVyci1jb2x1bW4tbmFtZS5qc1wiXG5pbXBvcnQgTW9kZWxDbGFzc1F1ZXJ5IGZyb20gXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiXG5pbXBvcnQgUHJlbG9hZGVyIGZyb20gXCIuLi9xdWVyeS9wcmVsb2FkZXIuanNcIlxuaW1wb3J0IHtyZWFkUGF5bG9hZEFzc29jaWF0aW9uQ291bnQsIHJlYWRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5LCByZWFkUGF5bG9hZFF1ZXJ5RGF0YSwgc2V0UGF5bG9hZEFzc29jaWF0aW9uQ291bnQsIHNldFBheWxvYWRDb21wdXRlZEFiaWxpdHksIHNldFBheWxvYWRRdWVyeURhdGF9IGZyb20gXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIlxuaW1wb3J0IHJlY29yZENoYW5nZXMgZnJvbSBcIi4uL3JlY29yZC1jaGFuZ2VzLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi8uLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IHNpbmd1bGFyaXplTW9kZWxOYW1lIGZyb20gXCIuLi8uLi91dGlscy9zaW5ndWxhcml6ZS1tb2RlbC1uYW1lLmpzXCJcbmltcG9ydCB7ZGVmaW5lTW9kZWxTY29wZX0gZnJvbSBcIi4uLy4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCJcbmltcG9ydCB7IG5vcm1hbGl6ZURhdGVTdHJpbmdGb3JXcml0ZSwgbm9ybWFsaXplRGF0ZVZhbHVlRm9yUmVhZCwgbm9ybWFsaXplRGF0ZVZhbHVlRm9yV3JpdGUgfSBmcm9tIFwiLi4vZGF0ZXRpbWUtc3RvcmFnZS5qc1wiXG5pbXBvcnQge2Zvcm1hdFZhbHVlfSBmcm9tIFwiLi4vLi4vdXRpbHMvZm9ybWF0LXZhbHVlLmpzXCJcbmltcG9ydCB7bW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXksIG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMsIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5LCBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCB7Y2FwdHVyZUNyZWF0ZUF1ZGl0Q2hhbmdlcywgY2FwdHVyZVVwZGF0ZUF1ZGl0Q2hhbmdlcywgY3JlYXRlQXVkaXQsIGNyZWF0ZUNyZWF0ZUF1ZGl0LCBjcmVhdGVEZXN0cm95QXVkaXQsIGNyZWF0ZVVwZGF0ZUF1ZGl0LCBpbml0aWFsaXplQXVkaXRpbmcsIHJlZ2lzdGVyQXVkaXRDYWxsYmFjaywgcmVnaXN0ZXJBdWRpdGluZywgd2l0aG91dEF1ZGl0fSBmcm9tIFwiLi9hdWRpdGluZy5qc1wiXG5pbXBvcnQge3JlZ2lzdGVyTWFnbml0dWRlQ291bnRlckNhY2hlfSBmcm9tIFwiLi9jb3VudGVyLWNhY2hlLW1hZ25pdHVkZS5qc1wiXG5pbXBvcnQge3N0YXRlTWFjaGluZX0gZnJvbSBcIi4vc3RhdGUtbWFjaGluZS5qc1wiXG5pbXBvcnQgVmFsaWRhdG9yc0Zvcm1hdCBmcm9tIFwiLi92YWxpZGF0b3JzL2Zvcm1hdC5qc1wiXG5pbXBvcnQgVmFsaWRhdG9yc0xlbmd0aCBmcm9tIFwiLi92YWxpZGF0b3JzL2xlbmd0aC5qc1wiXG5pbXBvcnQgVmFsaWRhdG9yc1ByZXNlbmNlIGZyb20gXCIuL3ZhbGlkYXRvcnMvcHJlc2VuY2UuanNcIlxuaW1wb3J0IFZhbGlkYXRvcnNVbmlxdWVuZXNzIGZyb20gXCIuL3ZhbGlkYXRvcnMvdW5pcXVlbmVzcy5qc1wiXG5pbXBvcnQgcmVnaXN0ZXJBY3RzQXNMaXN0Q2FsbGJhY2tzIGZyb20gXCIuL2FjdHMtYXMtbGlzdC5qc1wiXG5pbXBvcnQgVGVuYW50TW9kZWxTY29wZSBmcm9tIFwiLi4vLi4vdGVuYW50cy90ZW5hbnQtbW9kZWwtc2NvcGUuanNcIlxuaW1wb3J0IFVVSUQgZnJvbSBcInB1cmUtdXVpZFwiXG5cbi8qKlxuICogVHJhbnNsYXRpb24gcmVjb3JkIHNoYXBlIHVzZWQgYnkgdHJhbnNsYXRlZCBhdHRyaWJ1dGVzLlxuICogQHR5cGVkZWYge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkICYge2xvY2FsZTogKCkgPT4gc3RyaW5nfX0gVHJhbnNsYXRpb25CYXNlXG4gKi9cbi8qKlxuICogQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yIHR5cGUuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5BdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3J9IEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvclxuICovXG5cbi8qKiBTdG9yZWQgdmFsdWVzIHRoYXQgYSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGNhc3QgcmVhZHMgYmFjayBhcyBgdHJ1ZWAuICovXG5jb25zdCBkZWNsYXJlZEJvb2xlYW5UcnV0aHlWYWx1ZXMgPSBuZXcgU2V0KFsxLCB0cnVlLCBcIjFcIl0pXG5cbi8qKiBTdG9yZWQgdmFsdWVzIHRoYXQgYSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGNhc3QgcmVhZHMgYmFjayBhcyBgZmFsc2VgLiAqL1xuY29uc3QgZGVjbGFyZWRCb29sZWFuRmFsc3lWYWx1ZXMgPSBuZXcgU2V0KFswLCBmYWxzZSwgXCIwXCJdKVxuXG4vKiogU3RhdGljIHJlY29yZCBtZXRhZGF0YSBmaWVsZHMgaXNvbGF0ZWQgcGVyIHBoeXNpY2FsIGRhdGFiYXNlL3NjaGVtYSBnZW5lcmF0aW9uLiAqL1xuY29uc3QgcmVjb3JkTWV0YWRhdGFQcm9wZXJ0eU5hbWVzID0gbmV3IFNldChbXG4gIFwiX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVcIixcbiAgXCJfY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVwiLFxuICBcIl9jb2x1bW5OYW1lc1wiLFxuICBcIl9jb2x1bW5zXCIsXG4gIFwiX2NvbHVtbnNBc0hhc2hcIixcbiAgXCJfY29sdW1uVHlwZUJ5TmFtZVwiLFxuICBcIl9kYXRhYmFzZVR5cGVcIixcbiAgXCJfaW5pdGlhbGl6ZWRcIixcbiAgXCJfaW5pdGlhbGl6ZVJlY29yZFByb21pc2VcIixcbiAgXCJfdGFibGVcIlxuXSlcblxuLyoqIEB0eXBlIHtXZWFrTWFwPHR5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIFJlY29yZE1ldGFkYXRhVmFsdWU+Pj59ICovXG5jb25zdCByZWNvcmRNZXRhZGF0YVZhbHVlc0J5TW9kZWwgPSBuZXcgV2Vha01hcCgpXG5cbi8qKlxuICogUmV0dXJucyB0aGUgZ2VuZXJhdGlvbi1rZXllZCBtZXRhZGF0YSBzdG9yZSBvd25lZCBieSBvbmUgY2Fub25pY2FsIG1vZGVsLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gQ2Fub25pY2FsIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge01hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIFJlY29yZE1ldGFkYXRhVmFsdWU+Pn0gLSBNZXRhZGF0YSBzdG9yZS5cbiAqL1xuZnVuY3Rpb24gcmVjb3JkTWV0YWRhdGFWYWx1ZXNGb3IobW9kZWxDbGFzcykge1xuICBsZXQgdmFsdWVzID0gcmVjb3JkTWV0YWRhdGFWYWx1ZXNCeU1vZGVsLmdldChtb2RlbENsYXNzKVxuXG4gIGlmICghdmFsdWVzKSB7XG4gICAgdmFsdWVzID0gbmV3IE1hcCgpXG4gICAgcmVjb3JkTWV0YWRhdGFWYWx1ZXNCeU1vZGVsLnNldChtb2RlbENsYXNzLCB2YWx1ZXMpXG4gIH1cblxuICByZXR1cm4gdmFsdWVzXG59XG5cbmNsYXNzIFZhbGlkYXRpb25FcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gLSBWZWxvY2lvdXMgbWV0YWRhdGEgZm9yIGZyb250ZW5kLW1vZGVsIGVycm9yIHJlcG9ydGluZy5cbiAgICovXG4gIHZlbG9jaW91c1xuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbC5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAtIFRoZSBtb2RlbC5cbiAgICovXG4gIGdldE1vZGVsKCkge1xuICAgIGlmICghdGhpcy5fbW9kZWwpIHRocm93IG5ldyBFcnJvcihcIk1vZGVsIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX21vZGVsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbW9kZWwuXG4gICAqIEBwYXJhbSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldE1vZGVsKG1vZGVsKSB7XG4gICAgdGhpcy5fbW9kZWwgPSBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHZhbGlkYXRpb24gZXJyb3JzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgVmFsaWRhdGlvbkVycm9yT2JqZWN0VHlwZVtdPn0gLSBUaGUgdmFsaWRhdGlvbiBlcnJvcnMuXG4gICAqL1xuICBnZXRWYWxpZGF0aW9uRXJyb3JzKCkge1xuICAgIGlmICghdGhpcy5fdmFsaWRhdGlvbkVycm9ycykgdGhyb3cgbmV3IEVycm9yKFwiVmFsaWRhdGlvbiBlcnJvcnMgaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGlvbkVycm9yc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHZhbGlkYXRpb24gZXJyb3JzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFZhbGlkYXRpb25FcnJvck9iamVjdFR5cGVbXT59IHZhbGlkYXRpb25FcnJvcnMgLSBWYWxpZGF0aW9uIGVycm9ycyB0byBhc3NpZ24uXG4gICAqL1xuICBzZXRWYWxpZGF0aW9uRXJyb3JzKHZhbGlkYXRpb25FcnJvcnMpIHtcbiAgICB0aGlzLl92YWxpZGF0aW9uRXJyb3JzID0gdmFsaWRhdGlvbkVycm9yc1xuICB9XG59XG5cbi8qKlxuICogUnVucyBhcHBseSBidWlsdCByZWNvcmQgaW52ZXJzZSByZWxhdGlvbnNoaXAuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBhcmdzLnBhcmVudCAtIFBhcmVudCByZWNvcmQgYmVpbmcgYnVpbHQgZnJvbS5cbiAqIEBwYXJhbSB7e2dldFJlbGF0aW9uc2hpcEJ5TmFtZTogVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXCJnZXRSZWxhdGlvbnNoaXBCeU5hbWVcIl19fSBhcmdzLnJlY29yZCAtIE5ld2x5IGJ1aWx0IHJlbGF0ZWQgcmVjb3JkLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsfSBhcmdzLmludmVyc2VPZiAtIEludmVyc2UgcmVsYXRpb25zaGlwIG5hbWUuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuYWxsb3dIYXNNYW55IC0gV2hldGhlciBhIGhhcy1tYW55IGludmVyc2Ugc2hvdWxkIGJlIGFwcGVuZGVkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFwcGx5QnVpbHRSZWNvcmRJbnZlcnNlUmVsYXRpb25zaGlwKHthbGxvd0hhc01hbnksIGludmVyc2VPZiwgcGFyZW50LCByZWNvcmR9KSB7XG4gIGlmICghaW52ZXJzZU9mKSByZXR1cm5cblxuICBjb25zdCBpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAgPSByZWNvcmQuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKGludmVyc2VPZilcblxuICBpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0QXV0b1NhdmUoZmFsc2UpXG5cbiAgaWYgKCFhbGxvd0hhc01hbnkgfHwgaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc09uZVwiKSB7XG4gICAgaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLnNldExvYWRlZChwYXJlbnQpXG4gICAgcmV0dXJuXG4gIH1cblxuICBpZiAoaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc01hbnlcIikge1xuICAgIGludmVyc2VJbnN0YW5jZVJlbGF0aW9uc2hpcC5hZGRUb0xvYWRlZChwYXJlbnQpXG4gICAgcmV0dXJuXG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVsYXRpb25zaGlwIHR5cGU6ICR7aW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKX1gKVxufVxuXG4vKipcbiAqIEJ1aWxkIGEgcmVsYXRlZCByZWNvcmQgYW5kIHdpcmUgaXRzIGludmVyc2UgcmVsYXRpb25zaGlwIHRvIHRoZSBwYXJlbnQuXG4gKiBAcGFyYW0ge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBwYXJlbnQgLSBQYXJlbnQgcmVjb3JkIGJ1aWxkaW5nIHRoZSByZWxhdGlvbnNoaXAuXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lIGJlaW5nIGJ1aWx0LlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzIGZvciB0aGUgbmV3IHJlbGF0ZWQgcmVjb3JkLlxuICogQHBhcmFtIHtib29sZWFufSBhbGxvd0hhc01hbnkgLSBXaGV0aGVyIGhhcy1tYW55IGludmVyc2UgcmVsYXRpb25zaGlwcyBzaG91bGQgYXBwZW5kIHRoZSBwYXJlbnQuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEJ1aWx0IHJlbGF0ZWQgcmVjb3JkLlxuICovXG5mdW5jdGlvbiBidWlsZFJlbGF0ZWRSZWNvcmRXaXRoSW52ZXJzZShwYXJlbnQsIHJlbGF0aW9uc2hpcE5hbWUsIGF0dHJpYnV0ZXMsIGFsbG93SGFzTWFueSkge1xuICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHBhcmVudC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgY29uc3QgcmVjb3JkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuYnVpbGQoYXR0cmlidXRlcylcbiAgY29uc3QgaW52ZXJzZU9mID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0SW52ZXJzZU9mKClcblxuICBhcHBseUJ1aWx0UmVjb3JkSW52ZXJzZVJlbGF0aW9uc2hpcCh7XG4gICAgYWxsb3dIYXNNYW55LFxuICAgIGludmVyc2VPZixcbiAgICBwYXJlbnQsXG4gICAgcmVjb3JkOiAvKiogQHR5cGUge3tnZXRSZWxhdGlvbnNoaXBCeU5hbWU6IFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkW1wiZ2V0UmVsYXRpb25zaGlwQnlOYW1lXCJdfX0gKi8gKHJlY29yZClcbiAgfSlcblxuICByZXR1cm4gcmVjb3JkXG59XG5cbmNsYXNzIFRlbmFudERhdGFiYXNlU2NvcGVFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7bW9kZWxOYW1lOiBzdHJpbmd9fSBhcmdzIC0gQ29udGV4dCBmb3IgdGhlIGZhaWxlZCB0ZW5hbnQtc2NvcGVkIG1vZGVsLlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSwge21vZGVsTmFtZX0pIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9IFwiVGVuYW50RGF0YWJhc2VTY29wZUVycm9yXCJcbiAgICB0aGlzLm1vZGVsTmFtZSA9IG1vZGVsTmFtZVxuICB9XG59XG5cbi8qKlxuICogQmFzZSBkYXRhYmFzZSByZWNvcmQuXG4gKiBAdGVtcGxhdGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW1dyaXRlQXR0cmlidXRlcz1SZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5dXG4gKi9cbmNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBvYmplY3Q+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX3RyYW5zbGF0aW9ucyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vdmFsaWRhdG9ycy9iYXNlLmpzXCIpLmRlZmF1bHRbXT4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfdmFsaWRhdG9ycyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIExpZmVjeWNsZUNhbGxiYWNrVHlwZVtdPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9saWZlY3ljbGVDYWxsYmFja3MgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB0eXBlb2YgaW1wb3J0KFwiLi92YWxpZGF0b3JzL2Jhc2UuanNcIikuZGVmYXVsdD4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfdmFsaWRhdG9yVHlwZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7ZHJpdmVyPzogc3RyaW5nIHwgQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCB0eXBlOiBcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9PiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9hdHRhY2htZW50c01hcCA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQ+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX3JlbGF0aW9uc2hpcHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9xdWVyeS9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUZuPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9xdWVyeURhdGFSZWdpc3RyYXRpb25zID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge2FsbG93RGVzdHJveT86IGJvb2xlYW4sIGxpbWl0PzogbnVtYmVyLCByZWplY3RJZj86IChhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGJvb2xlYW59PiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9hY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2F0dHJpYnV0ZUNhc3RzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0PiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9jb2x1bW5zQXNIYXNoID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7QXJyYXk8c3RyaW5nPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9jb2x1bW5OYW1lcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfY29sdW1uVHlwZUJ5TmFtZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBtb2RlbE5hbWVcblxuICAvKipcbiAgICogT3B0LWluIGNsaWVudCBzeW5jIGRlY2xhcmF0aW9uIGNvbnN1bWVkIGJ5IGBTeW5jQ2xpZW50LmZyb21Db25maWd1cmF0aW9uKC4uLilgLlxuICAgKiBEZWNsYXJlIGBzdGF0aWMgc3luYyA9IHRydWVgIChhbGwgZGVmYXVsdHMpIG9yIGEgZGVjbGFyYXRpb24gb2JqZWN0IGxpa2VcbiAgICogYHN0YXRpYyBzeW5jID0ge3RyYWNrOiBbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIl0sIHN5bmNUeXBlOiBcInVwc2VydFwifWAgdG8gaGF2ZSB0aGVcbiAgICogc3luYyBjbGllbnQgYXV0by1kaXNjb3ZlciB0aGlzIG1vZGVsIGFuZCBkZXJpdmUgaXRzIHJlc291cmNlIGNvbmZpZyBmcm9tXG4gICAqIGNvbHVtbiBtZXRhZGF0YS5cbiAgICogQHR5cGUge2ltcG9ydChcIi4uLy4uL3N5bmMvc3luYy1jbGllbnQtdHlwZXMuanNcIikuTW9kZWxTeW5jRGVjbGFyYXRpb24gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBzeW5jXG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1Byb21pc2U8dm9pZD4gfCBudWxsIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2luaXRpYWxpemVSZWNvcmRQcm9taXNlXG5cbiAgLyoqIEB0eXBlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQgfCB1bmRlZmluZWR9IENhbm9uaWNhbCBtb2RlbCBjbGFzcyBleHBvc2VkIG9ubHkgYnkgYW4gb3BlcmF0aW9uLWJvdW5kIG1ldGFkYXRhIHByb3h5LiAqL1xuICBzdGF0aWMgX3JlY29yZE1ldGFkYXRhTW9kZWxDbGFzc1xuXG4gIC8qKiBAdHlwZSB7KChtb2RlbENsYXNzOiB0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQpID0+IHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkgfCB1bmRlZmluZWR9IEJpbmRzIHJlbGF0ZWQgZ2VuZXJhdGVkIG1vZGVsIGNsYXNzZXMgdG8gdGhlIHNhbWUgb3BlcmF0aW9uIG1ldGFkYXRhIGdlbmVyYXRpb24uICovXG4gIHN0YXRpYyBfcmVjb3JkTWV0YWRhdGFCaW5kZXJcblxuICAvKiogQHR5cGUge2ltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBPcGVyYXRpb24gZXhwb3NlZCBvbmx5IGJ5IGEgY29uc3RydWN0aW5nIG1ldGFkYXRhIHByb3h5LiAqL1xuICBzdGF0aWMgX3JlY29yZE1ldGFkYXRhT3BlcmF0aW9uXG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge2Jvb2xlYW4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfZWFnZXJMb2FkUmVjb3JkTWV0YWRhdGFcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9hdWRpdGluZy5qc1wiKS5BdWRpdENhbGxiYWNrW10+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2F1ZGl0Q2FsbGJhY2tzXG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge2Jvb2xlYW4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfYXVkaXRMaWZlY3ljbGVDYWxsYmFja3NSZWdpc3RlcmVkXG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIG1vZGVsIG5hbWUsIHByZWZlcnJpbmcgYW4gZXhwbGljaXQgYHN0YXRpYyBtb2RlbE5hbWVgIGRlY2xhcmF0aW9uXG4gICAqIG92ZXIgdGhlIEphdmFTY3JpcHQgY2xhc3MgYC5uYW1lYCBwcm9wZXJ0eS4gVGhpcyBhbGxvd3MgbWluaWZpZWQgYnVpbGRzIHRvXG4gICAqIHByZXNlcnZlIGNvcnJlY3QgbW9kZWwgbmFtZXMgd2l0aG91dCByZWx5aW5nIG9uIGBrZWVwX2NsYXNzbmFtZXNgLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBtb2RlbCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldE1vZGVsTmFtZSgpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMubW9kZWxOYW1lID09PSBcInN0cmluZ1wiICYmIHRoaXMubW9kZWxOYW1lLmxlbmd0aCA+IDApIHJldHVybiB0aGlzLm1vZGVsTmFtZVxuXG4gICAgcmV0dXJuIHRoaXMubmFtZVxuICB9XG5cbiAgc3RhdGljIGdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKSB7XG4gICAgaWYgKCF0aGlzLl9hdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqL1xuICAgICAgdGhpcy5fYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZSA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZGF0YWJhc2UgY29sdW1uIG5hbWUgZm9yIGEgcmVjb3JkIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lIHRvIHJlc29sdmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTWFwcGVkIGNvbHVtbiBuYW1lLCBvciB0aGUgdW5kZXJzY29yZWQgYXR0cmlidXRlIG5hbWUgd2hlbiBubyBtYXBwaW5nIGV4aXN0cy5cbiAgICovXG4gIHN0YXRpYyBnZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKSB7XG4gICAgY29uc3QgcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID0gdGhpcy5yZXNvbHZlQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgaWYgKHJlc29sdmVkQXR0cmlidXRlTmFtZSkgcmV0dXJuIHRoaXMuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpW3Jlc29sdmVkQXR0cmlidXRlTmFtZV1cblxuICAgIHJldHVybiBpbmZsZWN0aW9uLnVuZGVyc2NvcmUoaW5mbGVjdGlvbi5jYW1lbGl6ZShkZWJ1cnJDb2x1bW5OYW1lKGF0dHJpYnV0ZU5hbWUpLCB0cnVlKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbiBpbmNvbWluZyBhdHRyaWJ1dGUgb3IgY29sdW1uIG5hbWUgdG8gdGhlIGNhbm9uaWNhbCBhdHRyaWJ1dGUgbmFtZSB0aGlzIG1vZGVsIGV4cG9zZXMuXG4gICAqIEFjY2VwdHMgdGhlIGNhbm9uaWNhbCAoZGVidXJyZWQpIGF0dHJpYnV0ZSBuYW1lLCBhIHJhdyB1bWxhdXQvYWNyb255bSBjb2x1bW4gbmFtZSwgYSBwcmUtZGVidXJyXG4gICAqIGNhbWVsaXphdGlvbiwgYW5kIGNhbWVsQ2FzZSBjYXNpbmcgdmFyaWFudHMgKGUuZy4gXCJ2QUZ1bmt0aW9uSURcIiB2cyBcInZBRnVua3Rpb25pZFwiKS4gUmV0dXJucyBudWxsXG4gICAqIHdoZW4gbm90aGluZyBtYXRjaGVzLCBzbyBjYWxsZXJzIGtlZXAgdGhlaXIgb3duIG5vdC1mb3VuZCBoYW5kbGluZy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBBdHRyaWJ1dGUgbmFtZSBvciBjb2x1bW4gbmFtZSB0byByZXNvbHZlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBDYW5vbmljYWwgYXR0cmlidXRlIG5hbWUsIG9yIG51bGwuXG4gICAqL1xuICBzdGF0aWMgcmVzb2x2ZUF0dHJpYnV0ZU5hbWUobmFtZSkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAgPSB0aGlzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuXG4gICAgaWYgKG5hbWUgaW4gYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCkgcmV0dXJuIG5hbWVcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRBdHRyaWJ1dGVOYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShkZWJ1cnJDb2x1bW5OYW1lKG5hbWUpLCB0cnVlKVxuXG4gICAgaWYgKG5vcm1hbGl6ZWRBdHRyaWJ1dGVOYW1lIGluIGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXApIHJldHVybiBub3JtYWxpemVkQXR0cmlidXRlTmFtZVxuXG4gICAgY29uc3QgY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCA9IHRoaXMuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpXG5cbiAgICBpZiAobmFtZSBpbiBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKSByZXR1cm4gY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcFtuYW1lXVxuXG4gICAgLy8gRmluYWwgZmFsbGJhY2s6IG1hdGNoIGNhbWVsQ2FzZSBjYXNpbmcgdmFyaWFudHMgYWdhaW5zdCB0aGUgbW9kZWwncyBnZW5lcmF0ZWQgYWNjZXNzb3JzLiBUaGVzZVxuICAgIC8vIGV4aXN0IG9uIHRoZSBwcm90b3R5cGUgYmVmb3JlIHJ1bnRpbWUgaW5pdGlhbGl6YXRpb24gKHVubGlrZSB0aGUgYXR0cmlidXRlIG1hcCksIHNvIHRoaXMgYWxzb1xuICAgIC8vIHJlc29sdmVzIG5hbWVzIGxvb2tlZCB1cCBkdXJpbmcgY3JlYXRlLCBiZWZvcmUgdGhlIG1hcCBpcyBidWlsdC4gaW5mbGVjdGlvbiBsb3dlci1jYXNlcyB0cmFpbGluZ1xuICAgIC8vIGFjcm9ueW1zIChcIklEXCIgLT4gXCJpZFwiKSwgc28gXCJ2QUZ1bmt0aW9uSURcIi9cIlZBX0Z1bmt0aW9uSURcIiBzdGlsbCByZXNvbHZlIHRvIFwidkFGdW5rdGlvbmlkXCIuXG4gICAgY29uc3QgbG93ZXJOb3JtYWxpemVkQXR0cmlidXRlTmFtZSA9IG5vcm1hbGl6ZWRBdHRyaWJ1dGVOYW1lLnRvTG93ZXJDYXNlKClcbiAgICBsZXQgcHJvdG90eXBlID0gdGhpcy5wcm90b3R5cGVcblxuICAgIHdoaWxlIChwcm90b3R5cGUgJiYgcHJvdG90eXBlICE9PSBPYmplY3QucHJvdG90eXBlKSB7XG4gICAgICBmb3IgKGNvbnN0IGFjY2Vzc29yTmFtZSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhwcm90b3R5cGUpKSB7XG4gICAgICAgIGlmIChhY2Nlc3Nvck5hbWUudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXJOb3JtYWxpemVkQXR0cmlidXRlTmFtZSkgcmV0dXJuIGFjY2Vzc29yTmFtZVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YocHJvdG90eXBlKVxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIG1lbWJlciBuYW1lIG9uIGEgdGFyZ2V0J3MgcHJvdG90eXBlIGNoYWluIG1hdGNoaW5nIGBtZW1iZXJOYW1lYCwgZmFsbGluZyBiYWNrIHRvIGFcbiAgICogY2FzZS1pbnNlbnNpdGl2ZSBtYXRjaC4gUmVzb2x2ZXMgc2V0dGVycyB3aGVuIGEgcmVhZC1vbmx5IGF0dHJpYnV0ZSBhbGlhcyBkaWZmZXJzIG9ubHkgaW4gY2FtZWxDYXNlXG4gICAqIGNhc2luZyBmcm9tIHRoZSBnZW5lcmF0ZWQgYWNjZXNzb3IgKGUuZy4gYSBcInZBRnVua3Rpb25JRFwiIGFsaWFzIHdob3NlIHNldHRlciBpcyBcInNldFZBRnVua3Rpb25pZFwiKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IHRhcmdldCAtIEluc3RhbmNlIG9yIHByb3RvdHlwZSB0byBzZWFyY2guXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZW1iZXJOYW1lIC0gTWVtYmVyIG5hbWUgdG8gZmluZC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gTWF0Y2hpbmcgbWVtYmVyIG5hbWUsIG9yIG51bGwgd2hlbiBhYnNlbnQuXG4gICAqL1xuICBzdGF0aWMgZmluZE1lbWJlck5hbWVJbnNlbnNpdGl2ZSh0YXJnZXQsIG1lbWJlck5hbWUpIHtcbiAgICBpZiAobWVtYmVyTmFtZSBpbiB0YXJnZXQpIHJldHVybiBtZW1iZXJOYW1lXG5cbiAgICBjb25zdCBsb3dlck1lbWJlck5hbWUgPSBtZW1iZXJOYW1lLnRvTG93ZXJDYXNlKClcbiAgICBsZXQgY3VycmVudCA9IHRhcmdldFxuXG4gICAgd2hpbGUgKGN1cnJlbnQgJiYgY3VycmVudCAhPT0gT2JqZWN0LnByb3RvdHlwZSkge1xuICAgICAgZm9yIChjb25zdCBjYW5kaWRhdGVOYW1lIG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKGN1cnJlbnQpKSB7XG4gICAgICAgIGlmIChjYW5kaWRhdGVOYW1lLnRvTG93ZXJDYXNlKCkgPT09IGxvd2VyTWVtYmVyTmFtZSkgcmV0dXJuIGNhbmRpZGF0ZU5hbWVcbiAgICAgIH1cblxuICAgICAgY3VycmVudCA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihjdXJyZW50KVxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWZpbmUgc2NvcGUuXG4gICAqIEBwYXJhbSB7KC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNhbGxiYWNrIC0gU2NvcGUgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHsoKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gaW1wb3J0KFwiLi4vcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQ+KSAmIHtzY29wZTogKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gaW1wb3J0KFwiLi4vLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIikuTW9kZWxTY29wZURlc2NyaXB0b3J9fSAtIFNjb3BlIGhlbHBlci5cbiAgICovXG4gIHN0YXRpYyBkZWZpbmVTY29wZShjYWxsYmFjaykge1xuICAgIHJldHVybiBkZWZpbmVNb2RlbFNjb3BlKHtcbiAgICAgIGNhbGxiYWNrLFxuICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgIHN0YXJ0UXVlcnk6IChtb2RlbENsYXNzID0gdGhpcykgPT4ge1xuICAgICAgICAvLyBUaGlzIGJhY2tlbmQgc2NvcGUgZmFjdG9yeSBjYW4gb25seSBiZSBpbnZva2VkIHRocm91Z2ggYSBEYXRhYmFzZVJlY29yZCBjbGFzcy5cbiAgICAgICAgY29uc3QgQmFja2VuZE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gKi8gKG1vZGVsQ2xhc3MpXG5cbiAgICAgICAgcmV0dXJuIEJhY2tlbmRNb2RlbENsYXNzLl9uZXdRdWVyeSgpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhcHBsaWNhdGlvbiBtb2RlbCBjbGFzcyBiZWhpbmQgYW4gb3BlcmF0aW9uLWJvdW5kIG1ldGFkYXRhIHZpZXcuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IC0gQ2Fub25pY2FsIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIGNhbm9uaWNhbFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcygpIHtcbiAgICByZXR1cm4gdGhpcy5fcmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzIHx8IHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBCaW5kcyBhIHJlbGF0aW9uc2hpcCB0YXJnZXQgdG8gdGhpcyBtb2RlbCBjbGFzcydzIG1ldGFkYXRhIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBtb2RlbENsYXNzIC0gUmVsYXRpb25zaGlwIHRhcmdldC5cbiAgICogQHJldHVybnMge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gLSBHZW5lcmF0aW9uLWJvdW5kIHRhcmdldCwgb3IgdGhlIHVuY2hhbmdlZCB0YXJnZXQgZm9yIGxlZ2FjeSBxdWVyaWVzLlxuICAgKi9cbiAgc3RhdGljIGJpbmRSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIHJldHVybiB0aGlzLl9yZWNvcmRNZXRhZGF0YUJpbmRlciA/IHRoaXMuX3JlY29yZE1ldGFkYXRhQmluZGVyKG1vZGVsQ2xhc3MpIDogbW9kZWxDbGFzc1xuICB9XG5cbiAgc3RhdGljIGdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKSB7XG4gICAgaWYgKCF0aGlzLl9jb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqL1xuICAgICAgdGhpcy5fY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVcbiAgfVxuXG4gIHN0YXRpYyBnZXRUcmFuc2xhdGlvbnNNYXAoKSB7XG4gICAgaWYgKCF0aGlzLl90cmFuc2xhdGlvbnMpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIG9iamVjdD59ICovXG4gICAgICB0aGlzLl90cmFuc2xhdGlvbnMgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl90cmFuc2xhdGlvbnNcbiAgfVxuXG4gIHN0YXRpYyBnZXRWYWxpZGF0b3JzTWFwKCkge1xuICAgIGlmICghdGhpcy5fdmFsaWRhdG9ycykge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi92YWxpZGF0b3JzL2Jhc2UuanNcIikuZGVmYXVsdFtdPn0gKi9cbiAgICAgIHRoaXMuX3ZhbGlkYXRvcnMgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl92YWxpZGF0b3JzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbGlmZWN5Y2xlIGNhbGxiYWNrcyBtYXAuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBMaWZlY3ljbGVDYWxsYmFja1R5cGVbXT59IC0gTGlmZWN5Y2xlIGNhbGxiYWNrcyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldExpZmVjeWNsZUNhbGxiYWNrc01hcCgpIHtcbiAgICBpZiAoIXRoaXMuX2xpZmVjeWNsZUNhbGxiYWNrcykge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgTGlmZWN5Y2xlQ2FsbGJhY2tUeXBlW10+fSAqL1xuICAgICAgdGhpcy5fbGlmZWN5Y2xlQ2FsbGJhY2tzID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fbGlmZWN5Y2xlQ2FsbGJhY2tzXG4gIH1cblxuICBzdGF0aWMgZ2V0VmFsaWRhdG9yVHlwZXNNYXAoKSB7XG4gICAgaWYgKCF0aGlzLl92YWxpZGF0b3JUeXBlcykge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vdmFsaWRhdG9ycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgICAgdGhpcy5fdmFsaWRhdG9yVHlwZXMgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl92YWxpZGF0b3JUeXBlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dGFjaG1lbnRzIG1hcC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHtkcml2ZXI/OiBzdHJpbmcgfCBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHR5cGU6IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIn0+fSAtIEF0dGFjaG1lbnQgZGVmaW5pdGlvbnMga2V5ZWQgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRBdHRhY2htZW50c01hcCgpIHtcbiAgICBpZiAoIXRoaXMuX2F0dGFjaG1lbnRzTWFwKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7ZHJpdmVyPzogc3RyaW5nIHwgQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCB0eXBlOiBcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9Pn0gKi9cbiAgICAgIHRoaXMuX2F0dGFjaG1lbnRzTWFwID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0YWNobWVudHNNYXBcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRyaWJ1dGVzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBfYXR0cmlidXRlcyA9IHt9XG5cbiAgLyoqXG4gICAqIENoYW5nZXMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIF9jaGFuZ2VzID0ge31cblxuICAvKipcbiAgICogQ2hhbmdlcyBjYXB0dXJlZCBiZWZvcmUgYSBjcmVhdGUgYXVkaXQgaXMgd3JpdHRlbi5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vYXVkaXRpbmcuanNcIikuQXVkaXRDaGFuZ2VzIHwgdW5kZWZpbmVkfSAqL1xuICBfcGVuZGluZ0NyZWF0ZUF1ZGl0Q2hhbmdlcyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBDaGFuZ2VzIGNhcHR1cmVkIGJlZm9yZSBhbiB1cGRhdGUgYXVkaXQgaXMgd3JpdHRlbi5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vYXVkaXRpbmcuanNcIikuQXVkaXRDaGFuZ2VzIHwgdW5kZWZpbmVkfSAqL1xuICBfcGVuZGluZ1VwZGF0ZUF1ZGl0Q2hhbmdlcyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBBdHRyaWJ1dGUgbmFtZXMgZXhwbGljaXRseSBhc3NpZ25lZCBpbiB0aGUgY3VycmVudCB1cGRhdGUgY2FsbC5cbiAgICogQHR5cGUge1NldDxzdHJpbmc+IHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgX2Fzc2lnbmVkQXR0cmlidXRlTmFtZXMgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogQ29sdW1ucyBhcyBoYXNoLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgX2NvbHVtbnNBc0hhc2ggPSB7fVxuXG4gIC8qKlxuICAgKiBDb25uZWN0aW9uLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gIF9fY29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBFeHBsaWNpdCBvcGVyYXRpb24gb3duaW5nIHRoaXMgcmVjb3JkJ3MgZGF0YWJhc2Ugd29yay5cbiAgICogQHR5cGUge2ltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICBfZGF0YWJhc2VPcGVyYXRpb24gPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogSW5zdGFuY2UgcmVsYXRpb25zaGlwcy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICBfaW5zdGFuY2VSZWxhdGlvbnNoaXBzID0ge31cbiAgLyoqXG4gICAqIEF0dGFjaG1lbnRzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkQXR0YWNobWVudEhhbmRsZT59ICovXG4gIF9hdHRhY2htZW50cyA9IHt9XG5cbiAgLyoqXG4gICAqIExvYWQgY29ob3J0LlxuICAgKiBAdHlwZSB7QXJyYXk8VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQ+IHwgdW5kZWZpbmVkfSAtIFNoYXJlZCByZWZlcmVuY2UgdG8gc2libGluZyByZWNvcmRzIGxvYWRlZCBpbiB0aGUgc2FtZSBiYXRjaC4gVXNlZCBieSBhdXRvLXByZWxvYWQuXG4gICAqL1xuICBfbG9hZENvaG9ydCA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBUYWJsZSBuYW1lLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBfX3RhYmxlTmFtZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBWYWxpZGF0aW9uIGVycm9ycy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFZhbGlkYXRpb25FcnJvck9iamVjdFR5cGVbXT59ICovXG4gIF92YWxpZGF0aW9uRXJyb3JzID0ge31cblxuICBzdGF0aWMgdmFsaWRhdG9yVHlwZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0VmFsaWRhdG9yVHlwZXNNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIgdmFsaWRhdG9yIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi92YWxpZGF0b3JzL2Jhc2UuanNcIikuZGVmYXVsdH0gdmFsaWRhdG9yQ2xhc3MgLSBWYWxpZGF0b3IgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgcmVnaXN0ZXJWYWxpZGF0b3JUeXBlKG5hbWUsIHZhbGlkYXRvckNsYXNzKSB7XG4gICAgdGhpcy52YWxpZGF0b3JUeXBlcygpW25hbWVdID0gdmFsaWRhdG9yQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIGxpZmVjeWNsZSBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtcImFmdGVyQ3JlYXRlXCIgfCBcImFmdGVyRGVzdHJveVwiIHwgXCJhZnRlclNhdmVcIiB8IFwiYWZ0ZXJVcGRhdGVcIiB8IFwiYmVmb3JlQ3JlYXRlXCIgfCBcImJlZm9yZURlc3Ryb3lcIiB8IFwiYmVmb3JlU2F2ZVwiIHwgXCJiZWZvcmVVcGRhdGVcIiB8IFwiYmVmb3JlVmFsaWRhdGlvblwifSBjYWxsYmFja05hbWUgLSBDYWxsYmFjayB0eXBlLlxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgcmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjayhjYWxsYmFja05hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY2FsbGJhY2tzID0gdGhpcy5nZXRMaWZlY3ljbGVDYWxsYmFja3NNYXAoKVxuXG4gICAgaWYgKCFjYWxsYmFja3NbY2FsbGJhY2tOYW1lXSkge1xuICAgICAgY2FsbGJhY2tzW2NhbGxiYWNrTmFtZV0gPSBbXVxuICAgIH1cblxuICAgIGNhbGxiYWNrc1tjYWxsYmFja05hbWVdLnB1c2goY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1bnJlZ2lzdGVyIGxpZmVjeWNsZSBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtcImFmdGVyQ3JlYXRlXCIgfCBcImFmdGVyRGVzdHJveVwiIHwgXCJhZnRlclNhdmVcIiB8IFwiYWZ0ZXJVcGRhdGVcIiB8IFwiYmVmb3JlQ3JlYXRlXCIgfCBcImJlZm9yZURlc3Ryb3lcIiB8IFwiYmVmb3JlU2F2ZVwiIHwgXCJiZWZvcmVVcGRhdGVcIiB8IFwiYmVmb3JlVmFsaWRhdGlvblwifSBjYWxsYmFja05hbWUgLSBDYWxsYmFjayB0eXBlLlxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBQcmV2aW91c2x5IHJlZ2lzdGVyZWQgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHVucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjayhjYWxsYmFja05hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY2FsbGJhY2tzID0gdGhpcy5nZXRMaWZlY3ljbGVDYWxsYmFja3NNYXAoKVtjYWxsYmFja05hbWVdXG5cbiAgICBpZiAoIWNhbGxiYWNrcykgcmV0dXJuXG5cbiAgICBjb25zdCBjYWxsYmFja0luZGV4ID0gY2FsbGJhY2tzLmluZGV4T2YoY2FsbGJhY2spXG5cbiAgICBpZiAoY2FsbGJhY2tJbmRleCA+PSAwKSBjYWxsYmFja3Muc3BsaWNlKGNhbGxiYWNrSW5kZXgsIDEpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgdmFsaWRhdGlvbi5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBiZWZvcmVWYWxpZGF0aW9uKGNhbGxiYWNrKSB7XG4gICAgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjay5jYWxsKHRoaXMsIFwiYmVmb3JlVmFsaWRhdGlvblwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBzYXZlLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGJlZm9yZVNhdmUoY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJiZWZvcmVTYXZlXCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGNyZWF0ZS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBiZWZvcmVDcmVhdGUoY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJiZWZvcmVDcmVhdGVcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgdXBkYXRlLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGJlZm9yZVVwZGF0ZShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImJlZm9yZVVwZGF0ZVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBkZXN0cm95LlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGJlZm9yZURlc3Ryb3koY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJiZWZvcmVEZXN0cm95XCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgc2F2ZS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhZnRlclNhdmUoY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJhZnRlclNhdmVcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBjcmVhdGUuXG4gICAqIEB0ZW1wbGF0ZSBSXG4gICAqIEB0aGlzIHtNb2RlbENvbnN0cnVjdG9yPFI+fVxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZTxSPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYWZ0ZXJDcmVhdGUoY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJhZnRlckNyZWF0ZVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIHVwZGF0ZS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhZnRlclVwZGF0ZShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImFmdGVyVXBkYXRlXCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgZGVzdHJveS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhZnRlckRlc3Ryb3koY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJhZnRlckRlc3Ryb3lcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogRW5hYmxlcyBhdXRvbWF0aWMgY3JlYXRlL3VwZGF0ZS9kZXN0cm95IGF1ZGl0aW5nIGZvciB0aGlzIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhdWRpdGVkKCkge1xuICAgIHJlZ2lzdGVyQXVkaXRpbmcodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhbiBhYXNtLXN0eWxlIHN0YXRlIG1hY2hpbmUgb24gdGhpcyBtb2RlbDogbmFtZWQgc3RhdGVzLCBldmVudHNcbiAgICogKGd1YXJkZWQgdHJhbnNpdGlvbnMpLCBhbmQgZW50ZXIvZXhpdCArIGJlZm9yZS9hZnRlciB0cmFuc2l0aW9uIGhvb2tzLiBTZWVcbiAgICogYHN0YXRlLW1hY2hpbmUuanNgLiBHZW5lcmF0ZXMgYGV2ZW50KClgIC8gYGV2ZW50QW5kU2F2ZSgpYCAvIGBjYW5FdmVudCgpYFxuICAgKiB0cmFuc2l0aW9uIG1ldGhvZHMgcGVyIGRlY2xhcmVkIGV2ZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3RhdGUtbWFjaGluZS5qc1wiKS5TdGF0ZU1hY2hpbmVEZWZpbml0aW9ufSBkZWZpbml0aW9uIC0gU3RhdGUgbWFjaGluZSBkZWZpbml0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBzdGF0ZU1hY2hpbmUoZGVmaW5pdGlvbikge1xuICAgIHN0YXRlTWFjaGluZSh0aGlzLCBkZWZpbml0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhpcyBtb2RlbCdzIHN0YXRlIG1hY2hpbmUgZGVmaW5pdGlvbiwgb3IgbnVsbCB3aGVuIGl0IGRlY2xhcmVzIG5vbmUuXG4gICAqIGBNb2RlbC5zdGF0ZU1hY2hpbmUoLi4uKWAgb3ZlcnJpZGVzIHRoaXMgb24gY2xhc3NlcyB0aGF0IGRlY2xhcmUgYSBtYWNoaW5lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zdGF0ZS1tYWNoaW5lLmpzXCIpLlN0YXRlTWFjaGluZURlZmluaXRpb24gfCBudWxsfSAtIFRoZSBzdGF0ZSBtYWNoaW5lIGRlZmluaXRpb24sIG9yIG51bGwgd2hlbiBub25lIGlzIGRlY2xhcmVkLlxuICAgKi9cbiAgc3RhdGljIGdldFN0YXRlTWFjaGluZURlZmluaXRpb24oKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoaXMgbW9kZWwncyBzdGF0ZSBjb2x1bW4sIG9yIG51bGwgd2hlbiBpdCBkZWNsYXJlcyBubyBzdGF0ZSBtYWNoaW5lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBUaGUgc3RhdGUgY29sdW1uIG5hbWUsIG9yIG51bGwgd2hlbiBubyBzdGF0ZSBtYWNoaW5lIGlzIGRlY2xhcmVkLlxuICAgKi9cbiAgc3RhdGljIGdldFN0YXRlTWFjaGluZUNvbHVtbigpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhpcyBtb2RlbCdzIGRlY2xhcmVkIHN0YXRlIG5hbWVzIChlbXB0eSB3aGVuIGl0IGhhcyBubyBzdGF0ZSBtYWNoaW5lKS5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFRoZSBkZWNsYXJlZCBzdGF0ZSBuYW1lcywgb3IgYW4gZW1wdHkgYXJyYXkgd2hlbiBubyBzdGF0ZSBtYWNoaW5lIGlzIGRlY2xhcmVkLlxuICAgKi9cbiAgc3RhdGljIGdldFN0YXRlTWFjaGluZVN0YXRlTmFtZXMoKSB7XG4gICAgcmV0dXJuIFtdXG4gIH1cblxuICAvKipcbiAgICogTWFpbnRhaW5zIGEgY291bnRlciBjb2x1bW4gb24gYSBgYmVsb25nc1RvYCBwYXJlbnQgYXMgdGhlIHN1bSBvZiBhIHBlci1yZWNvcmRcbiAgICogbWFnbml0dWRlLCBrZXB0IGN1cnJlbnQgYnkgYXRvbWljIGluY3JlbWVudHMgZGlmZmVkIG9uIGV2ZXJ5IGNyZWF0ZS91cGRhdGUvXG4gICAqIGRlc3Ryb3kgKGFuZCBtb3ZlZCBiZXR3ZWVuIHBhcmVudHMgd2hlbiB0aGUgZm9yZWlnbiBrZXkgY2hhbmdlcykuIFNlZVxuICAgKiBgY291bnRlci1jYWNoZS1tYWduaXR1ZGUuanNgLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY291bnRlci1jYWNoZS1tYWduaXR1ZGUuanNcIikuTWFnbml0dWRlQ291bnRlckNhY2hlRGVmaW5pdGlvbn0gZGVmaW5pdGlvbiAtIENvdW50ZXIgY2FjaGUgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgbWFnbml0dWRlQ291bnRlckNhY2hlKGRlZmluaXRpb24pIHtcbiAgICByZWdpc3Rlck1hZ25pdHVkZUNvdW50ZXJDYWNoZSh0aGlzLCBkZWZpbml0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGNhbGxiYWNrIGludm9rZWQgYWZ0ZXIgdGhpcyBtb2RlbCB3cml0ZXMgYW4gYXVkaXQgcm93IGZvciB0aGUgYWN0aW9uLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQXVkaXQgYWN0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hdWRpdGluZy5qc1wiKS5BdWRpdENhbGxiYWNrfSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1biBhZnRlciBhdWRpdCBjcmVhdGlvbi5cbiAgICogQHJldHVybnMgeygpID0+IHZvaWR9IFVuc3Vic2NyaWJlIGZ1bmN0aW9uLlxuICAgKi9cbiAgc3RhdGljIG9uQXVkaXQoYWN0aW9uLCBjYWxsYmFjaykge1xuICAgIHJldHVybiByZWdpc3RlckF1ZGl0Q2FsbGJhY2sodGhpcywgYWN0aW9uLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHJlY29yZHMgdGhhdCBkbyBub3QgaGF2ZSBhbiBhdWRpdCByb3cgZm9yIHRoZSBnaXZlbiBhY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24gbmFtZS5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IFF1ZXJ5IHNjb3BlZCB0byByZWNvcmRzIHdpdGhvdXQgdGhhdCBhdWRpdCBhY3Rpb24uXG4gICAqL1xuICBzdGF0aWMgd2l0aG91dEF1ZGl0KGFjdGlvbikge1xuICAgIHJldHVybiB3aXRob3V0QXVkaXQodGhpcywgYWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHZhbGlkYXRvciB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmFsaWRhdG9yTmFtZSAtIFZhbGlkYXRvciBuYW1lLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vdmFsaWRhdG9ycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIHZhbGlkYXRvciB0eXBlLlxuICAgKi9cbiAgc3RhdGljIGdldFZhbGlkYXRvclR5cGUodmFsaWRhdG9yTmFtZSkge1xuICAgIGlmICghKHZhbGlkYXRvck5hbWUgaW4gdGhpcy52YWxpZGF0b3JUeXBlcygpKSkgdGhyb3cgbmV3IEVycm9yKGBWYWxpZGF0b3IgdHlwZSAke3ZhbGlkYXRvck5hbWV9IG5vdCBmb3VuZGApXG5cbiAgICByZXR1cm4gdGhpcy52YWxpZGF0b3JUeXBlcygpW3ZhbGlkYXRvck5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgZXhpc3RzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlbGF0aW9uc2hpcCBleGlzdHMuXG4gICAqL1xuICBzdGF0aWMgX3JlbGF0aW9uc2hpcEV4aXN0cyhyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgaWYgKHJlbGF0aW9uc2hpcE5hbWUgaW4gdGhpcy5nZXRSZWxhdGlvbnNoaXBzTWFwKCkpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmVsYXRpb25zaGlwU2NvcGVDYWxsYmFjayB0eXBlLlxuICAgKiBAdHlwZWRlZiB7KHF1ZXJ5OiBpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD4pID0+IChpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD4gfCB2b2lkKX0gUmVsYXRpb25zaGlwU2NvcGVDYWxsYmFja1xuICAgKi9cbiAgLyoqXG4gICAqIFJlbGF0aW9uc2hpcERhdGFBcmd1bWVudFR5cGUgdHlwZS5cbiAgICogQHR5cGVkZWYge29iamVjdH0gUmVsYXRpb25zaGlwRGF0YUFyZ3VtZW50VHlwZVxuICAgKiBAcHJvcGVydHkge2Jvb2xlYW59IFthdXRvbG9hZF0gLSBEaXNhYmxlIGF1dG8tYmF0Y2gtcHJlbG9hZCBmb3IgdGhpcyByZWxhdGlvbnNoaXAgYnkgcGFzc2luZyBmYWxzZS4gRGVmYXVsdCB0cnVlLlxuICAgKiBAcHJvcGVydHkge3N0cmluZ30gW2NsYXNzTmFtZV0gLSBNb2RlbCBjbGFzcyBuYW1lIGZvciB0aGUgcmVsYXRlZCByZWNvcmQuXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGVwZW5kZW50XSAtIERlcGVuZGVudCBhY3Rpb24gd2hlbiBwYXJlbnQgaXMgZGVzdHJveWVkIChlLmcuIFwiZGVzdHJveVwiKS5cbiAgICogQHByb3BlcnR5IHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IFtrbGFzc10gLSBNb2RlbCBjbGFzcyBmb3IgdGhlIHJlbGF0ZWQgcmVjb3JkLlxuICAgKiBAcHJvcGVydHkge1JlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2t9IFtzY29wZV0gLSBPcHRpb25hbCBzY29wZSBjYWxsYmFjayBmb3IgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IFt0eXBlXSAtIFJlbGF0aW9uc2hpcCB0eXBlIChlLmcuIFwiaGFzTWFueVwiLCBcImJlbG9uZ3NUb1wiKS5cbiAgICovXG4gIC8qKlxuICAgKiBSdW5zIGRlZmluZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwRGF0YUFyZ3VtZW50VHlwZX0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBfZGVmaW5lUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUsIGRhdGEpIHtcbiAgICBpZiAoIXJlbGF0aW9uc2hpcE5hbWUpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWxhdGlvbnNoaXAgbmFtZSBnaXZlbjogJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgaWYgKHRoaXMuX3JlbGF0aW9uc2hpcEV4aXN0cyhyZWxhdGlvbnNoaXBOYW1lKSkgdGhyb3cgbmV3IEVycm9yKGBSZWxhdGlvbnNoaXAgJHtyZWxhdGlvbnNoaXBOYW1lfSBhbHJlYWR5IGV4aXN0c2ApXG5cbiAgICBjb25zdCBhY3R1YWxEYXRhID0gT2JqZWN0LmFzc2lnbihcbiAgICAgIHtcbiAgICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgdHlwZTogXCJoYXNNYW55XCJcbiAgICAgIH0sXG4gICAgICBkYXRhXG4gICAgKVxuXG4gICAgaWYgKCFhY3R1YWxEYXRhLmNsYXNzTmFtZSAmJiAhYWN0dWFsRGF0YS5rbGFzcykge1xuICAgICAgYWN0dWFsRGF0YS5jbGFzc05hbWUgPSBzaW5ndWxhcml6ZU1vZGVsTmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgIH1cblxuICAgIGxldCByZWxhdGlvbnNoaXBcbiAgICBjb25zdCBwcm90b3R5cGUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzLnByb3RvdHlwZSkpXG5cbiAgICBpZiAoYWN0dWFsRGF0YS50eXBlID09IFwiYmVsb25nc1RvXCIpIHtcbiAgICAgIHJlbGF0aW9uc2hpcCA9IG5ldyBCZWxvbmdzVG9SZWxhdGlvbnNoaXAoYWN0dWFsRGF0YSlcblxuICAgICAgcHJvdG90eXBlW3JlbGF0aW9uc2hpcE5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgICAgcmV0dXJuIHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYGJ1aWxkJHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcE5hbWUpfWBdID0gZnVuY3Rpb24oLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgcmV0dXJuIGJ1aWxkUmVsYXRlZFJlY29yZFdpdGhJbnZlcnNlKC8qKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9ICovICh0aGlzKSwgcmVsYXRpb25zaGlwTmFtZSwgYXR0cmlidXRlcywgdHJ1ZSlcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2Bsb2FkJHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcE5hbWUpfWBdID0gYXN5bmMgZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2Ake3JlbGF0aW9uc2hpcE5hbWV9T3JMb2FkYF0gPSBhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucmVsYXRpb25zaGlwT3JMb2FkKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcE5hbWUpfWBdID0gZnVuY3Rpb24oLyoqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCB8IG51bGwgfCB1bmRlZmluZWR9ICovIG1vZGVsKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICAgIGNvbnN0IGZvcmVpZ25LZXlWYWx1ZSA9IHRoaXMuX2JlbG9uZ3NUb0ZvcmVpZ25LZXlWYWx1ZSh7bW9kZWwsIHJlbGF0aW9uc2hpcH0pXG5cbiAgICAgICAgcmVsYXRpb25zaGlwLnNldExvYWRlZChtb2RlbCB8fCB1bmRlZmluZWQpXG4gICAgICAgIHJlbGF0aW9uc2hpcC5zZXRQcmVsb2FkZWQodHJ1ZSlcbiAgICAgICAgcmVsYXRpb25zaGlwLnNldERpcnR5KHRydWUpXG4gICAgICAgIHRoaXMuX3NldENvbHVtbkF0dHJpYnV0ZShyZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpLCBmb3JlaWduS2V5VmFsdWUpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChhY3R1YWxEYXRhLnR5cGUgPT0gXCJoYXNNYW55XCIpIHtcbiAgICAgIHJlbGF0aW9uc2hpcCA9IG5ldyBIYXNNYW55UmVsYXRpb25zaGlwKGFjdHVhbERhdGEpXG5cbiAgICAgIHByb3RvdHlwZVtyZWxhdGlvbnNoaXBOYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvaGFzLW1hbnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgJHtyZWxhdGlvbnNoaXBOYW1lfUxvYWRlZGBdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKS5sb2FkZWQoKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYGxvYWQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9YF0gPSBhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYCR7cmVsYXRpb25zaGlwTmFtZX1PckxvYWRgXSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZWxhdGlvbnNoaXBPckxvYWQocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGFjdHVhbERhdGEudHlwZSA9PSBcImhhc09uZVwiKSB7XG4gICAgICByZWxhdGlvbnNoaXAgPSBuZXcgSGFzT25lUmVsYXRpb25zaGlwKGFjdHVhbERhdGEpXG5cbiAgICAgIHByb3RvdHlwZVtyZWxhdGlvbnNoaXBOYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkubG9hZGVkKClcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2BidWlsZCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXBOYW1lKX1gXSA9IGZ1bmN0aW9uKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyBhdHRyaWJ1dGVzKSB7XG4gICAgICAgIHJldHVybiBidWlsZFJlbGF0ZWRSZWNvcmRXaXRoSW52ZXJzZSgvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAqLyAodGhpcyksIHJlbGF0aW9uc2hpcE5hbWUsIGF0dHJpYnV0ZXMsIGZhbHNlKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYGxvYWQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9YF0gPSBhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYCR7cmVsYXRpb25zaGlwTmFtZX1PckxvYWRgXSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZWxhdGlvbnNoaXBPckxvYWQocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHJlbGF0aW9uc2hpcCB0eXBlOiAke2FjdHVhbERhdGEudHlwZX1gKVxuICAgIH1cblxuICAgIHRoaXMuZ2V0UmVsYXRpb25zaGlwc01hcCgpW3JlbGF0aW9uc2hpcE5hbWVdID0gcmVsYXRpb25zaGlwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgcmVsYXRpb25zaGlwIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwU2NvcGVDYWxsYmFjayB8IG9iamVjdCB8IHVuZGVmaW5lZH0gc2NvcGVPck9wdGlvbnMgLSBTY29wZSBjYWxsYmFjayBvciBvcHRpb25zLlxuICAgKiBAcGFyYW0ge29iamVjdCB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt7c2NvcGU6IChSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrIHwgdW5kZWZpbmVkKSwgcmVsYXRpb25zaGlwT3B0aW9uczogb2JqZWN0fX0gLSBOb3JtYWxpemVkIGFyZ3VtZW50cy5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplUmVsYXRpb25zaGlwQXJncyhzY29wZU9yT3B0aW9ucywgb3B0aW9ucykge1xuICAgIGlmICh0eXBlb2Ygc2NvcGVPck9wdGlvbnMgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzY29wZTogLyoqIEB0eXBlIHtSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrfSAqLyAoc2NvcGVPck9wdGlvbnMpLFxuICAgICAgICByZWxhdGlvbnNoaXBPcHRpb25zOiBvcHRpb25zIHx8IHt9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNjb3BlOiB1bmRlZmluZWQsXG4gICAgICByZWxhdGlvbnNoaXBPcHRpb25zOiBzY29wZU9yT3B0aW9ucyB8fCB7fVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYWZ0ZXJDcmVhdGUsIGFmdGVyU2F2ZSwgYW5kIGFmdGVyRGVzdHJveSBjYWxsYmFja3MgdG8gc3luY1xuICAgKiBhIGNvdW50ZXIgY2FjaGUgY29sdW1uIG9uIHRoZSBwYXJlbnQgbW9kZWwuIFRoZSBjb2x1bW4gbmFtZSBmb2xsb3dzXG4gICAqIHRoZSBjb252ZW50aW9uIGA8Y2hpbGRNb2RlbFBsdXJhbENhbWVsQ2FzZT5Db3VudGAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gVGhlIGJlbG9uZ3NUbyByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBfcmVnaXN0ZXJDb3VudGVyQ2FjaGVDYWxsYmFja3MocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IENoaWxkTW9kZWwgPSB0aGlzXG5cbiAgICAvKipcbiAgICAgKiBBdG9taWNhbGx5IHJlY29tcHV0ZXMgdGhlIGNvdW50ZXIgY2FjaGUgY29sdW1uIG9uIHRoZSBwYXJlbnQgdmlhIGFcbiAgICAgKiBzaW5nbGUgVVBEQVRFIC4uLiBTRVQgY29sID0gKFNFTEVDVCBDT1VOVCgqKSkgc28gY29uY3VycmVudFxuICAgICAqIGNyZWF0ZXMvZGVzdHJveXMgY2Fubm90IHJhY2UgaW50byBhIHN0YWxlIGNvdW50LlxuICAgICAqIEBwYXJhbSB7bnVtYmVyIHwgc3RyaW5nIHwgbnVsbH0gcGFyZW50SWQgLSBQYXJlbnQgcHJpbWFyeS1rZXkgdmFsdWUuXG4gICAgICogQHBhcmFtIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gcmVjb3JkIC0gQ2hpbGQgcmVjb3JkIG93bmluZyB0aGUgY29ubmVjdGlvbi5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjb3VudGVyIGNhY2hlIGhhcyBiZWVuIHN5bmNlZC5cbiAgICAgKi9cbiAgICBhc3luYyBmdW5jdGlvbiBzeW5jQ291bnRlcihwYXJlbnRJZCwgcmVjb3JkKSB7XG4gICAgICBpZiAoIXBhcmVudElkKSByZXR1cm5cblxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gQ2hpbGRNb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIGNvbnN0IFBhcmVudE1vZGVsID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICBpZiAoIVBhcmVudE1vZGVsKSByZXR1cm5cblxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHJlbGF0aW9uc2hpcC5nZXRQcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IGZrID0gcmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKVxuICAgICAgY29uc3QgY2hpbGRNb2RlbE5hbWUgPSBDaGlsZE1vZGVsLmdldE1vZGVsTmFtZSgpXG4gICAgICBjb25zdCBjb3VudGVyQ29sdW1uID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKGAke2luZmxlY3Rpb24ucGx1cmFsaXplKGNoaWxkTW9kZWxOYW1lKX1Db3VudGApXG4gICAgICBjb25zdCBwYXJlbnRUYWJsZSA9IFBhcmVudE1vZGVsLnRhYmxlTmFtZSgpXG4gICAgICBjb25zdCBjaGlsZFRhYmxlID0gQ2hpbGRNb2RlbC50YWJsZU5hbWUoKVxuICAgICAgY29uc3QgcGtDb2x1bW4gPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUocHJpbWFyeUtleSlcbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSByZWNvcmRcbiAgICAgICAgLnF1ZXJ5Rm9yTW9kZWwoUGFyZW50TW9kZWwpXG4gICAgICAgIC5kcml2ZXJcbiAgICAgIGNvbnN0IHF1b3RlZCA9IGNvbm5lY3Rpb24ucXVvdGUocGFyZW50SWQpXG5cbiAgICAgIGNvbnN0IHNxbCA9IGBVUERBVEUgJHtjb25uZWN0aW9uLnF1b3RlVGFibGUocGFyZW50VGFibGUpfSBTRVQgJHtjb25uZWN0aW9uLnF1b3RlQ29sdW1uKGNvdW50ZXJDb2x1bW4pfSA9IChTRUxFQ1QgQ09VTlQoKikgRlJPTSAke2Nvbm5lY3Rpb24ucXVvdGVUYWJsZShjaGlsZFRhYmxlKX0gV0hFUkUgJHtjb25uZWN0aW9uLnF1b3RlQ29sdW1uKGZrKX0gPSAke3F1b3RlZH0pIFdIRVJFICR7Y29ubmVjdGlvbi5xdW90ZUNvbHVtbihwa0NvbHVtbil9ID0gJHtxdW90ZWR9YFxuXG4gICAgICBhd2FpdCBjb25uZWN0aW9uLnF1ZXJ5KHNxbCwge2xvZ05hbWU6IGAke1BhcmVudE1vZGVsLm5hbWV9IFVwZGF0ZWB9KVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1bnMgcmVhZCBmayBhdHRyaWJ1dGUuXG4gICAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gQ2hpbGQgcmVjb3JkIGluc3RhbmNlLlxuICAgICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBDdXJyZW50IGZvcmVpZ24ta2V5IGF0dHJpYnV0ZSB2YWx1ZS5cbiAgICAgKi9cbiAgICBmdW5jdGlvbiByZWFkRmtBdHRyaWJ1dGUocmVjb3JkKSB7XG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBDaGlsZE1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgZmtBdHRyaWJ1dGUgPSBpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KCkucmVwbGFjZSgvX2lkJC8sIFwiSWRcIiksIHRydWUpXG5cbiAgICAgIHJldHVybiByZWNvcmQucmVhZEF0dHJpYnV0ZShma0F0dHJpYnV0ZSlcbiAgICB9XG5cbiAgICBDaGlsZE1vZGVsLmFmdGVyQ3JlYXRlKGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgIGF3YWl0IHN5bmNDb3VudGVyKHJlYWRGa0F0dHJpYnV0ZShyZWNvcmQpLCByZWNvcmQpXG4gICAgfSlcblxuICAgIENoaWxkTW9kZWwuYWZ0ZXJEZXN0cm95KGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgIGF3YWl0IHN5bmNDb3VudGVyKHJlYWRGa0F0dHJpYnV0ZShyZWNvcmQpLCByZWNvcmQpXG4gICAgfSlcblxuICAgIENoaWxkTW9kZWwuYmVmb3JlU2F2ZShhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgICBjb25zdCBtb2RlbCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChyZWNvcmQpXG5cbiAgICAgIGlmIChtb2RlbC5pc05ld1JlY29yZCgpKSByZXR1cm5cblxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gQ2hpbGRNb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIGNvbnN0IGZrQ29sdW1uID0gcmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKVxuXG4gICAgICAvLyBEZXRlY3QgRksgY2hhbmdlIHZpYSBkaXJlY3QgYXR0cmlidXRlIGFzc2lnbm1lbnQgb3IgcmVsYXRpb25zaGlwIHNldHRlci5cbiAgICAgIGNvbnN0IGRpcmVjdENoYW5nZSA9IGZrQ29sdW1uIGluIG1vZGVsLl9jaGFuZ2VzXG4gICAgICBjb25zdCBiZWxvbmdzVG9DaGFuZ2UgPSBtb2RlbC5faW5zdGFuY2VSZWxhdGlvbnNoaXBzPy5bcmVsYXRpb25zaGlwTmFtZV0/LmdldERpcnR5Py4oKVxuXG4gICAgICBpZiAoZGlyZWN0Q2hhbmdlIHx8IGJlbG9uZ3NUb0NoYW5nZSkge1xuICAgICAgICBtb2RlbFtgX2NvdW50ZXJDYWNoZVByZXZfJHtyZWxhdGlvbnNoaXBOYW1lfWBdID0gbW9kZWwuX2F0dHJpYnV0ZXNbZmtDb2x1bW5dXG4gICAgICB9XG4gICAgfSlcblxuICAgIENoaWxkTW9kZWwuYWZ0ZXJTYXZlKGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgIGNvbnN0IG1vZGVsID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlY29yZClcbiAgICAgIGNvbnN0IHByZXZLZXkgPSBgX2NvdW50ZXJDYWNoZVByZXZfJHtyZWxhdGlvbnNoaXBOYW1lfWBcbiAgICAgIGNvbnN0IHByZXZpb3VzUGFyZW50SWQgPSBtb2RlbFtwcmV2S2V5XVxuXG4gICAgICBpZiAocHJldmlvdXNQYXJlbnRJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGRlbGV0ZSBtb2RlbFtwcmV2S2V5XVxuICAgICAgICBhd2FpdCBzeW5jQ291bnRlcihwcmV2aW91c1BhcmVudElkLCByZWNvcmQpXG4gICAgICAgIGF3YWl0IHN5bmNDb3VudGVyKHJlYWRGa0F0dHJpYnV0ZShtb2RlbCksIHJlY29yZClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcCBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgcmVsYXRpb25zaGlwIGJ5IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXApIHRocm93IG5ldyBFcnJvcihgTm8gcmVsYXRpb25zaGlwIGluICR7dGhpcy5uYW1lfSBjYWxsZWQgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIgaW4gbGlzdDogJHtPYmplY3Qua2V5cyh0aGlzLmdldFJlbGF0aW9uc2hpcHNNYXAoKSkuam9pbihcIiwgXCIpfWApXG5cbiAgICByZXR1cm4gcmVsYXRpb25zaGlwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwcy5cbiAgICogQHJldHVybnMge0FycmF5PGltcG9ydChcIi4vcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIFRoZSByZWxhdGlvbnNoaXBzLlxuICAgKi9cbiAgc3RhdGljIGdldFJlbGF0aW9uc2hpcHMoKSB7XG4gICAgcmV0dXJuIE9iamVjdC52YWx1ZXModGhpcy5nZXRSZWxhdGlvbnNoaXBzTWFwKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwcyBtYXAuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBSZWxhdGlvbnNoaXAgZGVmaW5pdGlvbnMga2V5ZWQgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRSZWxhdGlvbnNoaXBzTWFwKCkge1xuICAgIGlmICghT2JqZWN0Lmhhc093bih0aGlzLCBcIl9yZWxhdGlvbnNoaXBzXCIpIHx8ICF0aGlzLl9yZWxhdGlvbnNoaXBzKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICAgIHRoaXMuX3JlbGF0aW9uc2hpcHMgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqLyAodGhpcy5fcmVsYXRpb25zaGlwcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWxhdGlvbnNoaXAgbmFtZXMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSAtIFRoZSByZWxhdGlvbnNoaXAgbmFtZXMuXG4gICAqL1xuICBzdGF0aWMgZ2V0UmVsYXRpb25zaGlwTmFtZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0UmVsYXRpb25zaGlwcygpLm1hcCgocmVsYXRpb25zaGlwKSA9PiByZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGEgY29uc3VtZXItZGVmaW5lZCBxdWVyeURhdGEgZW50cnkuIFRoZSBjYWxsYmFjayByZWNlaXZlc1xuICAgKiBhIGdyb3VwZWQgcXVlcnkgYWxyZWFkeSBqb2luZWQgZG93biB0aGUgcmVsYXRpb25zaGlwIGNoYWluIGZyb20gdGhlXG4gICAqIHJvb3Qgb2YgYC5xdWVyeURhdGEoLi4uKWAgdG8gdGhpcyBtb2RlbCwgYWxyZWFkeSBmaWx0ZXJlZCBieSB0aGVcbiAgICogcm9vdCBwYXJlbnQgSURzLCBhbmQgd2l0aCBgcGFyZW50X2lkYCBwcmUtc2VsZWN0ZWQg4oCUIHNvIHRoZSBmblxuICAgKiBvbmx5IG5lZWRzIHRvIGFkZCBpdHMgb3duIFNFTEVDVCAoYW5kIG9wdGlvbmFsbHkgam9pbnMvd2hlcmUpLiBBbnlcbiAgICogYWxpYXNlcyB0aGUgZm4gc2VsZWN0cyBhcmUgYXR0YWNoZWQgdG8gZWFjaCAqKnJvb3QqKiByZWNvcmQgdmlhXG4gICAqIGByZWNvcmQucXVlcnlEYXRhKGFsaWFzTmFtZSlgLiBNdWx0aS1jb2x1bW4gc2VsZWN0cyBhcmUgZmluZSDigJQgb25lXG4gICAqIGFsaWFzIG1hcHMgdG8gb25lIHF1ZXJ5RGF0YSBrZXkuXG4gICAqXG4gICAqICoqUXVvdGUgQVMgYWxpYXNlcyBvbiBQb3N0Z3JlU1FMLioqIFBvc3RncmVTUUwgZm9sZHMgdW5xdW90ZWRcbiAgICogaWRlbnRpZmllcnMgKGluY2x1ZGluZyBTRUxFQ1QgYWxpYXNlcykgdG8gbG93ZXJjYXNlLCBzbyBhXG4gICAqIGAuLi4gQVMgbWFudWFsVGFza3NDb3VudGAgbGFuZHMgaW4gdGhlIHJlc3VsdCByb3cgYXNcbiAgICogYG1hbnVhbHRhc2tzY291bnRgIHdoaWxlIHRoZSBsb29rdXAgYHJlY29yZC5xdWVyeURhdGEoXCJtYW51YWxUYXNrc0NvdW50XCIpYFxuICAgKiBuZXZlciBmaW5kcyBpdC4gVXNlIGBkcml2ZXIucXVvdGVDb2x1bW4oXCJtYW51YWxUYXNrc0NvdW50XCIpYCBmb3IgdGhlXG4gICAqIGFsaWFzIHRvIHByZXNlcnZlIHRoZSBjYXNlIG9uIGV2ZXJ5IHN1cHBvcnRlZCBkcml2ZXI6XG4gICAqICAgcXVlcnkuc2VsZWN0KGBDT1VOVCguLi4pIEFTICR7ZHJpdmVyLnF1b3RlQ29sdW1uKFwibWFudWFsVGFza3NDb3VudFwiKX1gKVxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIElkZW50aWZpZXIgdXNlZCBpbiB0aGUgYC5xdWVyeURhdGEoLi4uKWAgc3BlYy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUZufSBmbiAtIENhbGxiYWNrIHRoYXQgbXV0YXRlcyB0aGUgcXVlcnkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHF1ZXJ5RGF0YShuYW1lLCBmbikge1xuICAgIGlmICghbmFtZSB8fCB0eXBlb2YgbmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHF1ZXJ5RGF0YSBuYW1lOiAke25hbWV9YClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGZuICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgcXVlcnlEYXRhIGZuIGZvciAke3RoaXMubmFtZX0ucXVlcnlEYXRhKCR7SlNPTi5zdHJpbmdpZnkobmFtZSl9KSBtdXN0IGJlIGEgZnVuY3Rpb25gKVxuICAgIH1cblxuICAgIGNvbnN0IG1hcCA9IHRoaXMuZ2V0UXVlcnlEYXRhTWFwKClcblxuICAgIC8vIFVzZSBPYmplY3QuaGFzT3duIHNvIGEgbmFtZSB0aGF0IGhhcHBlbnMgdG8gbWF0Y2ggYW4gaW5oZXJpdGVkXG4gICAgLy8gT2JqZWN0LnByb3RvdHlwZSBrZXkgKGUuZy4gXCJ0b1N0cmluZ1wiLCBcImNvbnN0cnVjdG9yXCIpIGlzbid0XG4gICAgLy8gZmFsc2VseSB0cmVhdGVkIGFzIGFscmVhZHkgcmVnaXN0ZXJlZC5cbiAgICBpZiAoT2JqZWN0Lmhhc093bihtYXAsIG5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHF1ZXJ5RGF0YSBmb3IgJHt0aGlzLm5hbWV9LiR7bmFtZX0gaXMgYWxyZWFkeSByZWdpc3RlcmVkYClcbiAgICB9XG5cbiAgICBtYXBbbmFtZV0gPSBmblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHF1ZXJ5IGRhdGEgbWFwLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vcXVlcnkvcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFGbj59IC0gcXVlcnlEYXRhIHJlZ2lzdHJhdGlvbnMga2V5ZWQgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRRdWVyeURhdGFNYXAoKSB7XG4gICAgaWYgKCFPYmplY3QuaGFzT3duKHRoaXMsIFwiX3F1ZXJ5RGF0YVJlZ2lzdHJhdGlvbnNcIikgfHwgIXRoaXMuX3F1ZXJ5RGF0YVJlZ2lzdHJhdGlvbnMpIHtcbiAgICAgIC8vIFByb3RvdHlwZS1sZXNzIG1hcCBzbyBicmFja2V0IGFjY2VzcyBjYW4gb25seSBldmVyIHN1cmZhY2VcbiAgICAgIC8vIHJlZ2lzdHJhdGlvbnMgYWN0dWFsbHkgbWFkZSBvbiB0aGlzIGNsYXNzIOKAlCBuZXZlciBpbmhlcml0ZWRcbiAgICAgIC8vIE9iamVjdC5wcm90b3R5cGUgbWVtYmVycy5cbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3F1ZXJ5L3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRm4+fSAqL1xuICAgICAgdGhpcy5fcXVlcnlEYXRhUmVnaXN0cmF0aW9ucyA9IE9iamVjdC5jcmVhdGUobnVsbClcbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9xdWVyeS9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUZuPn0gKi8gKHRoaXMuX3F1ZXJ5RGF0YVJlZ2lzdHJhdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcXVlcnkgZGF0YSBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIHF1ZXJ5RGF0YSBuYW1lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnkvcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFGbiB8IG51bGx9IC0gUmVnaXN0ZXJlZCBmbiBvciBudWxsIHdoZW4gbm90IGZvdW5kLlxuICAgKi9cbiAgc3RhdGljIGdldFF1ZXJ5RGF0YUJ5TmFtZShuYW1lKSB7XG4gICAgY29uc3QgbWFwID0gdGhpcy5nZXRRdWVyeURhdGFNYXAoKVxuXG4gICAgLy8gT3duLXByb3BlcnR5IGxvb2t1cCBzbyBhIHNwZWMgY29udGFpbmluZyBlLmcuIFwidG9TdHJpbmdcIiBkb2Vzbid0XG4gICAgLy8gcmVzb2x2ZSB0byBhbiBpbmhlcml0ZWQgT2JqZWN0LnByb3RvdHlwZSBtZW1iZXIg4oCUIG1hdGNoaW5nIHRoZVxuICAgIC8vIE9iamVjdC5oYXNPd24gZ3VhcmQgdXNlZCB3aGVuIHJlZ2lzdGVyaW5nLlxuICAgIHJldHVybiBPYmplY3QuaGFzT3duKG1hcCwgbmFtZSkgPyBtYXBbbmFtZV0gOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0YWNobWVudHMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB7ZHJpdmVyPzogc3RyaW5nIHwgQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCB0eXBlOiBcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9Pn0gLSBBdHRhY2htZW50IGRlZmluaXRpb25zLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dGFjaG1lbnRzKCkge1xuICAgIHJldHVybiB0aGlzLmdldEF0dGFjaG1lbnRzTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50IGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHJldHVybnMge3tkcml2ZXI/OiBzdHJpbmcgfCBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHR5cGU6IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIn19IC0gQXR0YWNobWVudCBkZWZpbml0aW9uLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpIHtcbiAgICBjb25zdCBkZWZpbml0aW9uID0gdGhpcy5nZXRBdHRhY2htZW50c01hcCgpW2F0dGFjaG1lbnROYW1lXVxuXG4gICAgaWYgKCFkZWZpbml0aW9uKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGF0dGFjaG1lbnQgaW4gJHt0aGlzLm5hbWV9IGNhbGxlZCBcIiR7YXR0YWNobWVudE5hbWV9XCIgaW4gbGlzdDogJHtPYmplY3Qua2V5cyh0aGlzLmdldEF0dGFjaG1lbnRzTWFwKCkpLmpvaW4oXCIsIFwiKX1gKVxuXG4gICAgcmV0dXJuIGRlZmluaXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWxhdGlvbnNoaXAgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIHJlbGF0aW9uc2hpcCBieSBuYW1lLlxuICAgKi9cbiAgZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBpZiAoIShyZWxhdGlvbnNoaXBOYW1lIGluIHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcykpIHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3NSZWxhdGlvbnNoaXAgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKVxuICAgICAgICAuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICAgIC5yZXNvbHZlRm9yUmVjb3JkKHRoaXMpXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBUeXBlID0gbW9kZWxDbGFzc1JlbGF0aW9uc2hpcC5nZXRUeXBlKClcbiAgICAgIGxldCBpbnN0YW5jZVJlbGF0aW9uc2hpcFxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwVHlwZSA9PSBcImJlbG9uZ3NUb1wiKSB7XG4gICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwID0gbmV3IEJlbG9uZ3NUb0luc3RhbmNlUmVsYXRpb25zaGlwKHttb2RlbDogdGhpcywgcmVsYXRpb25zaGlwOiBtb2RlbENsYXNzUmVsYXRpb25zaGlwfSlcbiAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25zaGlwVHlwZSA9PSBcImhhc01hbnlcIikge1xuICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IG5ldyBIYXNNYW55SW5zdGFuY2VSZWxhdGlvbnNoaXAoe21vZGVsOiB0aGlzLCByZWxhdGlvbnNoaXA6IG1vZGVsQ2xhc3NSZWxhdGlvbnNoaXB9KVxuICAgICAgfSBlbHNlIGlmIChyZWxhdGlvbnNoaXBUeXBlID09IFwiaGFzT25lXCIpIHtcbiAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSBuZXcgSGFzT25lSW5zdGFuY2VSZWxhdGlvbnNoaXAoe21vZGVsOiB0aGlzLCByZWxhdGlvbnNoaXA6IG1vZGVsQ2xhc3NSZWxhdGlvbnNoaXB9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHJlbGF0aW9uc2hpcCB0eXBlOiAke3JlbGF0aW9uc2hpcFR5cGV9YClcbiAgICAgIH1cblxuICAgICAgdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdID0gaW5zdGFuY2VSZWxhdGlvbnNoaXBcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUHJlbG9hZHMgcmVsYXRpb25zaGlwKHMpIG9udG8gdGhpcyBhbHJlYWR5LWxvYWRlZCByZWNvcmQuIEFjY2VwdHMgZWl0aGVyIGFcbiAgICogcXVlcnkgYnVpbHQgdmlhIGBNb2RlbC5wcmVsb2FkKC4uLikuc2VsZWN0KC4uLilgIG9yIGEgcmF3IHByZWxvYWQgc3BlY1xuICAgKiAoc3RyaW5nIC8gYXJyYXkgLyBuZXN0ZWQgb2JqZWN0KS4gQSByZWxhdGlvbnNoaXAgdGhhdCBpcyBhbHJlYWR5IHByZWxvYWRlZFxuICAgKiB3aXRoIGFsbCB0aGUgcmVxdWlyZWQgY29sdW1ucyBwcmVzZW50IGlzIGxlZnQgdW50b3VjaGVkIHVubGVzcyBgZm9yY2VgIGlzXG4gICAqIHNldC4gUHJlbG9hZGluZyBvbnRvIHRoZSByZWxhdGlvbnNoaXAgY2FjaGUgbGV0cyBsYXRlciBhY2Nlc3NvcnMgcmV1c2UgdGhlXG4gICAqIGxvYWRlZCBkYXRhIGluc3RlYWQgb2YgaXNzdWluZyBpZGVudGljYWwgcXVlcmllcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQ+fSBxdWVyeU9yU3BlYyAtIFByZWxvYWQgc291cmNlLlxuICAgKiBAcGFyYW0ge3tmb3JjZT86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBPcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHByZWxvYWRpbmcgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgcHJlbG9hZChxdWVyeU9yU3BlYywgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgUHJlbG9hZGVyLnByZWxvYWQoW3RoaXNdLCBxdWVyeU9yU3BlYywgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBhd2FpdCByZWxhdGlvbnNoaXAubG9hZCgpXG5cbiAgICByZXR1cm4gcmVsYXRpb25zaGlwLmxvYWRlZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgb3IgbG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHt7cHJlbG9hZFRyYW5zbGF0aW9ucz86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBMb2FkIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgcmVsYXRpb25zaGlwT3JMb2FkKHJlbGF0aW9uc2hpcE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgbGV0IGxvYWRlZCA9IGF3YWl0IHJlbGF0aW9uc2hpcC5hdXRvbG9hZE9yTG9hZCgpXG5cbiAgICBpZiAob3B0aW9ucy5wcmVsb2FkVHJhbnNsYXRpb25zKSB7XG4gICAgICBsb2FkZWQgPSBhd2FpdCB0aGlzLl9wcmVsb2FkTG9hZGVkUmVsYXRpb25zaGlwVHJhbnNsYXRpb25zKGxvYWRlZClcbiAgICB9XG5cbiAgICByZXR1cm4gbG9hZGVkXG4gIH1cblxuICAvKipcbiAgICogUHJlbG9hZHMgdHJhbnNsYXRpb25zIG9uIGEgbG9hZGVkIHJlbGF0aW9uc2hpcCB0YXJnZXQgd2hlbiBleHBsaWNpdGx5IHJlcXVlc3RlZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbG9hZGVkIC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlbGF0aW9uc2hpcCB2YWx1ZSBhZnRlciB0cmFuc2xhdGlvbiBwcmVsb2FkLlxuICAgKi9cbiAgYXN5bmMgX3ByZWxvYWRMb2FkZWRSZWxhdGlvbnNoaXBUcmFuc2xhdGlvbnMobG9hZGVkKSB7XG4gICAgaWYgKCFsb2FkZWQgfHwgIWxvYWRlZC5pc1BlcnNpc3RlZCgpIHx8ICFhd2FpdCBsb2FkZWQuZ2V0TW9kZWxDbGFzcygpLmhhc1RyYW5zbGF0aW9uc1RhYmxlKCkpIHJldHVybiBsb2FkZWRcblxuICAgIGNvbnN0IHRyYW5zbGF0aW9uc1JlbGF0aW9uc2hpcCA9IGxvYWRlZC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoXCJ0cmFuc2xhdGlvbnNcIilcblxuICAgIGlmICh0cmFuc2xhdGlvbnNSZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHJldHVybiBsb2FkZWRcblxuICAgIGF3YWl0IGxvYWRlZC5wcmVsb2FkKHt0cmFuc2xhdGlvbnM6IHt9fSlcblxuICAgIHJldHVybiBsb2FkZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50IGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHJldHVybnMge1JlY29yZEF0dGFjaG1lbnRIYW5kbGV9IC0gQXR0YWNobWVudCBoYW5kbGUuXG4gICAqL1xuICBnZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKSB7XG4gICAgaWYgKCEoYXR0YWNobWVudE5hbWUgaW4gdGhpcy5fYXR0YWNobWVudHMpKSB7XG4gICAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpXG5cbiAgICAgIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXSA9IG5ldyBSZWNvcmRBdHRhY2htZW50SGFuZGxlKHtcbiAgICAgICAgbW9kZWw6IHRoaXMsXG4gICAgICAgIG5hbWU6IGF0dGFjaG1lbnROYW1lLFxuICAgICAgICB0eXBlOiBhdHRhY2htZW50RGVmaW5pdGlvbi50eXBlXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgYmVsb25ncy10by1yZWxhdGlvbnNoaXAgdG8gdGhlIG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSBUaGUgbmFtZSBvZiB0aGUgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge1JlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2sgfCBvYmplY3R9IFtzY29wZU9yT3B0aW9uc10gVGhlIHNjb3BlIGNhbGxiYWNrIG9yIG9wdGlvbnMgZm9yIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gVGhlIG9wdGlvbnMgZm9yIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqL1xuICBzdGF0aWMgYmVsb25nc1RvKHJlbGF0aW9uc2hpcE5hbWUsIHNjb3BlT3JPcHRpb25zLCBvcHRpb25zKSB7XG4gICAgY29uc3Qge3Njb3BlLCByZWxhdGlvbnNoaXBPcHRpb25zfSA9IHRoaXMuX25vcm1hbGl6ZVJlbGF0aW9uc2hpcEFyZ3Moc2NvcGVPck9wdGlvbnMsIG9wdGlvbnMpXG5cbiAgICB0aGlzLl9kZWZpbmVSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSwgT2JqZWN0LmFzc2lnbih7dHlwZTogXCJiZWxvbmdzVG9cIiwgc2NvcGV9LCByZWxhdGlvbnNoaXBPcHRpb25zKSlcblxuICAgIGlmICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocmVsYXRpb25zaGlwT3B0aW9ucyk/LmNvdW50ZXJDYWNoZSkge1xuICAgICAgdGhpcy5fcmVnaXN0ZXJDb3VudGVyQ2FjaGVDYWxsYmFja3MocmVsYXRpb25zaGlwTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZV0gLSBXaGV0aGVyIHRlbmFudC1zd2l0Y2hlZCBtb2RlbHMgbXVzdCByZXNvbHZlIGEgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgY29ubmVjdGlvbi5cbiAgICovXG4gIHN0YXRpYyBjb25uZWN0aW9uKHtlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZSA9IHRydWUsIC4uLnJlc3RBcmdzfSA9IHt9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGNvbnN0IGRhdGFiYXNlUG9vbCA9IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXREYXRhYmFzZVBvb2wodGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoe2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlfSkpXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IGRhdGFiYXNlUG9vbC5nZXRDdXJyZW50Q29ubmVjdGlvbigpXG5cbiAgICBpZiAoIWNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbm5lY3Rpb24/XCIpXG5cbiAgICByZXR1cm4gY29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlLlxuICAgKiBAdGVtcGxhdGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gQ3JlYXRlQXR0cmlidXRlc1xuICAgKiBAdGVtcGxhdGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPENyZWF0ZUF0dHJpYnV0ZXM+fSBNb2RlbFxuICAgKiBAdGhpcyB7e25ldyAoY2hhbmdlcz86IENyZWF0ZUF0dHJpYnV0ZXMpOiBNb2RlbH0gJiB0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9XG4gICAqIEBwYXJhbSB7Q3JlYXRlQXR0cmlidXRlc30gW2F0dHJpYnV0ZXNdIC0gQXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8TW9kZWw+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNyZWF0ZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjcmVhdGUoYXR0cmlidXRlcykge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHtNb2RlbH0gKi8gKG5ldyB0aGlzKGF0dHJpYnV0ZXMpKVxuXG4gICAgYXdhaXQgcmVjb3JkLnNhdmUoKVxuXG4gICAgcmV0dXJuIHJlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBzdGF0aWMgX2dldENvbmZpZ3VyYXRpb24oKSB7XG4gICAgaWYgKCF0aGlzLl9jb25maWd1cmF0aW9uKSB7XG4gICAgICB0aGlzLl9jb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KClcblxuICAgICAgaWYgKCF0aGlzLl9jb25maWd1cmF0aW9uKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24gaGFzbid0IGJlZW4gc2V0IChtb2RlbCBjbGFzcyBwcm9iYWJseSBoYXNuJ3QgYmVlbiBpbml0aWFsaXplZClcIilcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fY29uZmlndXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfZ2V0Q29uZmlndXJhdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRNb2RlbENsYXNzKCkuX2dldENvbmZpZ3VyYXRpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBoYXMtbWFueS1yZWxhdGlvbnNoaXAgdG8gdGhlIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSBUaGUgbmFtZSBvZiB0aGUgcmVsYXRpb25zaGlwIChlLmcuIFwicG9zdHNcIilcbiAgICogQHBhcmFtIHtSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrIHwgb2JqZWN0fSBbc2NvcGVPck9wdGlvbnNdIFRoZSBzY29wZSBjYWxsYmFjayBvciBvcHRpb25zIGZvciB0aGUgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIFRoZSBvcHRpb25zIGZvciB0aGUgcmVsYXRpb25zaGlwIChlLmcuIHtjbGFzc05hbWU6IFwiUG9zdFwifSlcbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGhhc01hbnkocmVsYXRpb25zaGlwTmFtZSwgc2NvcGVPck9wdGlvbnMsIG9wdGlvbnMpIHtcbiAgICBjb25zdCB7c2NvcGUsIHJlbGF0aW9uc2hpcE9wdGlvbnN9ID0gdGhpcy5fbm9ybWFsaXplUmVsYXRpb25zaGlwQXJncyhzY29wZU9yT3B0aW9ucywgb3B0aW9ucylcblxuICAgIHJldHVybiB0aGlzLl9kZWZpbmVSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSwgT2JqZWN0LmFzc2lnbih7dHlwZTogXCJoYXNNYW55XCIsIHNjb3BlfSwgcmVsYXRpb25zaGlwT3B0aW9ucykpXG4gIH1cblxuICAvKipcbiAgICogUmFpbHMtc3R5bGUgZGVjbGFyYXRpb24gdGhhdCB0aGlzIG1vZGVsIGFjY2VwdHMgbmVzdGVkLWF0dHJpYnV0ZSB3cml0ZXNcbiAgICogZm9yIGEgcmVsYXRpb25zaGlwIHdoZW4gc2F2ZWQgdGhyb3VnaCBhIHBhcmVudC4gUmVxdWlyZWQg4oCUIFZlbG9jaW91c1xuICAgKiB3aWxsIHJlZnVzZSBuZXN0ZWQgd3JpdGVzIGZvciBhbnkgcmVsYXRpb25zaGlwIG5vdCBsaXN0ZWQgaGVyZSwgZXZlblxuICAgKiBpZiBhIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIHBlcm1pdHMgdGhlbS5cbiAgICpcbiAgICogT3B0aW9uczpcbiAgICogICAtIGFsbG93RGVzdHJveTogd2hldGhlciBgX2Rlc3Ryb3k6IHRydWVgIGVudHJpZXMgYXJlIGFsbG93ZWQuIERlZmF1bHQgZmFsc2UuXG4gICAqICAgLSBsaW1pdDogb3B0aW9uYWwgdXBwZXIgYm91bmQgb24gdGhlIG51bWJlciBvZiBuZXN0ZWQgZW50cmllcyBwZXIgcmVxdWVzdC5cbiAgICogICAtIHJlamVjdElmOiBvcHRpb25hbCBwcmVkaWNhdGUgYChhdHRyaWJ1dGVzKSA9PiBib29sZWFuYCB0aGF0IHNpbGVudGx5IHNraXBzIGVudHJpZXMuXG4gICAqXG4gICAqIFVzYWdlOlxuICAgKiAgIGNsYXNzIFByb2plY3QgZXh0ZW5kcyBSZWNvcmQge31cbiAgICogICBQcm9qZWN0Lmhhc01hbnkoXCJ0YXNrc1wiKVxuICAgKiAgIFByb2plY3QuYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3IoXCJ0YXNrc1wiLCB7YWxsb3dEZXN0cm95OiB0cnVlfSlcbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZSBvbiB0aGlzIG1vZGVsLlxuICAgKiBAcGFyYW0ge3thbGxvd0Rlc3Ryb3k/OiBib29sZWFuLCBsaW1pdD86IG51bWJlciwgcmVqZWN0SWY/OiAoYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBib29sZWFufX0gW29wdGlvbnNdIC0gUG9saWN5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFjY2VwdHNOZXN0ZWRBdHRyaWJ1dGVzRm9yKHJlbGF0aW9uc2hpcE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGlmICghcmVsYXRpb25zaGlwTmFtZSB8fCB0eXBlb2YgcmVsYXRpb25zaGlwTmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHJlbGF0aW9uc2hpcE5hbWUgcGFzc2VkIHRvIGFjY2VwdHNOZXN0ZWRBdHRyaWJ1dGVzRm9yOiAke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLCBcIl9hY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXNcIikpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHthbGxvd0Rlc3Ryb3k/OiBib29sZWFuLCBsaW1pdD86IG51bWJlciwgcmVqZWN0SWY/OiAoYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBib29sZWFufT59ICovXG4gICAgICB0aGlzLl9hY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge2FsbG93RGVzdHJveT86IGJvb2xlYW4sIGxpbWl0PzogbnVtYmVyLCByZWplY3RJZj86IChhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGJvb2xlYW59Pn0gKi8gKHRoaXMuX2FjY2VwdGVkTmVzdGVkQXR0cmlidXRlcylbcmVsYXRpb25zaGlwTmFtZV0gPSB7Li4ub3B0aW9uc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjY2VwdGVkIG5lc3RlZCBhdHRyaWJ1dGVzIGZvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge3thbGxvd0Rlc3Ryb3k/OiBib29sZWFuLCBsaW1pdD86IG51bWJlciwgcmVqZWN0SWY/OiAoYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBib29sZWFufSB8IG51bGx9IC0gUG9saWN5IGRlY2xhcmVkIHZpYSBgYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3JgLCBvciBudWxsIHdoZW4gbm90IGFjY2VwdGVkLlxuICAgKi9cbiAgc3RhdGljIGFjY2VwdGVkTmVzdGVkQXR0cmlidXRlc0ZvcihyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FjY2VwdGVkTmVzdGVkQXR0cmlidXRlcz8uW3JlbGF0aW9uc2hpcE5hbWVdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgaGFzLW9uZS1yZWxhdGlvbnNoaXAgdG8gdGhlIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSBUaGUgbmFtZSBvZiB0aGUgcmVsYXRpb25zaGlwIChlLmcuIFwicG9zdFwiKVxuICAgKiBAcGFyYW0ge1JlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2sgfCBvYmplY3R9IFtzY29wZU9yT3B0aW9uc10gVGhlIHNjb3BlIGNhbGxiYWNrIG9yIG9wdGlvbnMgZm9yIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gVGhlIG9wdGlvbnMgZm9yIHRoZSByZWxhdGlvbnNoaXAgKGUuZy4ge2NsYXNzTmFtZTogXCJQb3N0XCJ9KVxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgaGFzT25lKHJlbGF0aW9uc2hpcE5hbWUsIHNjb3BlT3JPcHRpb25zLCBvcHRpb25zKSB7XG4gICAgY29uc3Qge3Njb3BlLCByZWxhdGlvbnNoaXBPcHRpb25zfSA9IHRoaXMuX25vcm1hbGl6ZVJlbGF0aW9uc2hpcEFyZ3Moc2NvcGVPck9wdGlvbnMsIG9wdGlvbnMpXG5cbiAgICByZXR1cm4gdGhpcy5fZGVmaW5lUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUsIE9iamVjdC5hc3NpZ24oe3R5cGU6IFwiaGFzT25lXCIsIHNjb3BlfSwgcmVsYXRpb25zaGlwT3B0aW9ucykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWZpbmUgYXR0YWNobWVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEF0dGFjaG1lbnQgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmRyaXZlcl0gLSBBdHRhY2htZW50IGRyaXZlciBuYW1lLCBjbGFzcywgb3IgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7XCJoYXNPbmVcIiB8IFwiaGFzTWFueVwifSBhcmdzLnR5cGUgLSBBdHRhY2htZW50IHR5cGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBfZGVmaW5lQXR0YWNobWVudChhdHRhY2htZW50TmFtZSwge2RyaXZlciwgdHlwZX0pIHtcbiAgICBpZiAoIWF0dGFjaG1lbnROYW1lIHx8IHR5cGVvZiBhdHRhY2htZW50TmFtZSAhPT0gXCJzdHJpbmdcIikgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGF0dGFjaG1lbnQgbmFtZTogJHthdHRhY2htZW50TmFtZX1gKVxuICAgIGlmIChhdHRhY2htZW50TmFtZSBpbiB0aGlzLmdldEF0dGFjaG1lbnRzTWFwKCkpIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCAke2F0dGFjaG1lbnROYW1lfSBhbHJlYWR5IGV4aXN0c2ApXG5cbiAgICB0aGlzLmdldEF0dGFjaG1lbnRzTWFwKClbYXR0YWNobWVudE5hbWVdID0ge2RyaXZlciwgdHlwZX1cblxuICAgIGNvbnN0IHByb3RvdHlwZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMucHJvdG90eXBlKSlcblxuICAgIHByb3RvdHlwZVthdHRhY2htZW50TmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiB0aGlzLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpXG4gICAgfVxuXG4gICAgICBwcm90b3R5cGVbYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRhY2htZW50TmFtZSl9YF0gPSBmdW5jdGlvbigvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBuZXdWYWx1ZSkge1xuICAgICAgdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKS5xdWV1ZUF0dGFjaChuZXdWYWx1ZSlcbiAgICAgIHJldHVybiBuZXdWYWx1ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgc2luZ2xlIGF0dGFjaG1lbnQgaGVscGVyIHRvIHRoZSBtb2RlbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3tkcml2ZXI/OiBzdHJpbmcgfCBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBbYXJnc10gLSBBdHRhY2htZW50IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBoYXNPbmVBdHRhY2htZW50KGF0dGFjaG1lbnROYW1lLCBhcmdzID0ge30pIHtcbiAgICB0aGlzLl9kZWZpbmVBdHRhY2htZW50KGF0dGFjaG1lbnROYW1lLCB7ZHJpdmVyOiBhcmdzLmRyaXZlciwgdHlwZTogXCJoYXNPbmVcIn0pXG4gIH1cblxuICAvKipcbiAgICogQWRkcyBhIGNvbGxlY3Rpb24gYXR0YWNobWVudCBoZWxwZXIgdG8gdGhlIG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7e2RyaXZlcj86IHN0cmluZyB8IEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IFthcmdzXSAtIEF0dGFjaG1lbnQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGhhc01hbnlBdHRhY2htZW50cyhhdHRhY2htZW50TmFtZSwgYXJncyA9IHt9KSB7XG4gICAgdGhpcy5fZGVmaW5lQXR0YWNobWVudChhdHRhY2htZW50TmFtZSwge2RyaXZlcjogYXJncy5kcml2ZXIsIHR5cGU6IFwiaGFzTWFueVwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGh1bWFuIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBodW1hbiBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBodW1hbkF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSkge1xuICAgIGNvbnN0IG1vZGVsTmFtZUtleSA9IGluZmxlY3Rpb24udW5kZXJzY29yZSh0aGlzLmdldE1vZGVsTmFtZSgpKVxuXG4gICAgcmV0dXJuIHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRUcmFuc2xhdG9yKCkoYHZlbG9jaW91cy5kYXRhYmFzZS5yZWNvcmQuYXR0cmlidXRlcy4ke21vZGVsTmFtZUtleX0uJHthdHRyaWJ1dGVOYW1lfWAsIHtkZWZhdWx0VmFsdWU6IGluZmxlY3Rpb24uY2FtZWxpemUoYXR0cmlidXRlTmFtZSl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIHR5cGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGRhdGFiYXNlIHR5cGUuXG4gICAqL1xuICBzdGF0aWMgZ2V0RGF0YWJhc2VUeXBlKCkge1xuICAgIGlmICghdGhpcy5fZGF0YWJhc2VUeXBlKSB0aHJvdyBuZXcgRXJyb3IoXCJEYXRhYmFzZSB0eXBlIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX2RhdGFiYXNlVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGVhZ2VyIGxvYWQgcmVjb3JkIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGVhZ2VyTG9hZFJlY29yZE1ldGFkYXRhIC0gV2hldGhlciByZXF1aXJlLWNvbnRleHQgaW5pdGlhbGl6YXRpb24gc2hvdWxkIGxvYWQgdGFibGUgbWV0YWRhdGEgZm9yIHRoaXMgbW9kZWwuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzZXRFYWdlckxvYWRSZWNvcmRNZXRhZGF0YShlYWdlckxvYWRSZWNvcmRNZXRhZGF0YSkge1xuICAgIHRoaXMuX2VhZ2VyTG9hZFJlY29yZE1ldGFkYXRhID0gZWFnZXJMb2FkUmVjb3JkTWV0YWRhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBlYWdlciBsb2FkIHJlY29yZCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZXF1aXJlLWNvbnRleHQgaW5pdGlhbGl6YXRpb24gc2hvdWxkIGxvYWQgdGFibGUgbWV0YWRhdGEgZm9yIHRoaXMgbW9kZWwuXG4gICAqL1xuICBzdGF0aWMgZ2V0RWFnZXJMb2FkUmVjb3JkTWV0YWRhdGEoKSB7XG4gICAgaWYgKHRoaXMuX2VhZ2VyTG9hZFJlY29yZE1ldGFkYXRhID09PSB1bmRlZmluZWQpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gdGhpcy5fZWFnZXJMb2FkUmVjb3JkTWV0YWRhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc2V0IHJlY29yZCBtZXRhZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHJlc2V0UmVjb3JkTWV0YWRhdGEoKSB7XG4gICAgdGhpcy5faW5pdGlhbGl6ZWQgPSBmYWxzZVxuICAgIHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlID0gbnVsbFxuICAgIHRoaXMuX2RhdGFiYXNlVHlwZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX3RhYmxlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fY29sdW1ucyA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2NvbHVtbnNBc0hhc2ggPSB1bmRlZmluZWRcbiAgICB0aGlzLl9jb2x1bW5OYW1lcyA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2NvbHVtblR5cGVCeU5hbWUgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9hdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSA9IHVuZGVmaW5lZFxuXG4gICAgaWYgKCF0aGlzLl9yZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MpIHRoaXMuY2xlYXJSZWNvcmRNZXRhZGF0YVZhbHVlcygpXG4gIH1cblxuICAvKipcbiAgICogU3RhdGljIGZpZWxkcyB0aGF0IGJlbG9uZyB0byBvbmUgcGh5c2ljYWwgZGF0YWJhc2Uvc2NoZW1hIGdlbmVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBNZXRhZGF0YSBwcm9wZXJ0eSBuYW1lcy5cbiAgICovXG4gIHN0YXRpYyByZWNvcmRNZXRhZGF0YVByb3BlcnR5TmFtZXMoKSB7XG4gICAgcmV0dXJuIHJlY29yZE1ldGFkYXRhUHJvcGVydHlOYW1lc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIG9uZSBvcGVyYXRpb24tYm91bmQgbWV0YWRhdGEgZmllbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRhZGF0YUtleSAtIFBoeXNpY2FsIGRhdGFiYXNlIGFuZCBzY2hlbWEgZ2VuZXJhdGlvbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwcm9wZXJ0eSAtIFN0YXRpYyBtZXRhZGF0YSBwcm9wZXJ0eS5cbiAgICogQHJldHVybnMge1JlY29yZE1ldGFkYXRhVmFsdWV9IC0gU3RvcmVkIG1ldGFkYXRhIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHJlY29yZE1ldGFkYXRhVmFsdWUobWV0YWRhdGFLZXksIHByb3BlcnR5KSB7XG4gICAgcmV0dXJuIHJlY29yZE1ldGFkYXRhVmFsdWVzRm9yKHRoaXMpLmdldChtZXRhZGF0YUtleSk/LmdldChwcm9wZXJ0eSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZXMgb25lIG9wZXJhdGlvbi1ib3VuZCBtZXRhZGF0YSBmaWVsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGFkYXRhS2V5IC0gUGh5c2ljYWwgZGF0YWJhc2UgYW5kIHNjaGVtYSBnZW5lcmF0aW9uIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3BlcnR5IC0gU3RhdGljIG1ldGFkYXRhIHByb3BlcnR5LlxuICAgKiBAcGFyYW0ge1JlY29yZE1ldGFkYXRhVmFsdWV9IHZhbHVlIC0gTWV0YWRhdGEgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHNldFJlY29yZE1ldGFkYXRhVmFsdWUobWV0YWRhdGFLZXksIHByb3BlcnR5LCB2YWx1ZSkge1xuICAgIGxldCB2YWx1ZXMgPSByZWNvcmRNZXRhZGF0YVZhbHVlc0Zvcih0aGlzKS5nZXQobWV0YWRhdGFLZXkpXG5cbiAgICBpZiAoIXZhbHVlcykge1xuICAgICAgdmFsdWVzID0gbmV3IE1hcCgpXG4gICAgICByZWNvcmRNZXRhZGF0YVZhbHVlc0Zvcih0aGlzKS5zZXQobWV0YWRhdGFLZXksIHZhbHVlcylcbiAgICB9XG5cbiAgICB2YWx1ZXMuc2V0KHByb3BlcnR5LCB2YWx1ZSlcbiAgfVxuXG4gIC8qKiBDbGVhcnMgZXZlcnkgdGVuYW50L2dlbmVyYXRpb24gbWV0YWRhdGEgc25hcHNob3QgZm9yIHRoaXMgbW9kZWwuICovXG4gIHN0YXRpYyBjbGVhclJlY29yZE1ldGFkYXRhVmFsdWVzKCkge1xuICAgIHJlY29yZE1ldGFkYXRhVmFsdWVzQnlNb2RlbC5kZWxldGUodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgc25hcHNob3RzIHdob3NlIGtleSBiZWxvbmdzIHRvIG9uZSBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpdHkgLSBMb2dpY2FsIGlkZW50aWZpZXIgcGx1cyBwb29sIHJldXNlIGtleS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgY2xlYXJSZWNvcmRNZXRhZGF0YVZhbHVlc0ZvckRhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSkge1xuICAgIGNvbnN0IHZhbHVlcyA9IHJlY29yZE1ldGFkYXRhVmFsdWVzQnlNb2RlbC5nZXQodGhpcylcblxuICAgIGlmICghdmFsdWVzKSByZXR1cm5cblxuICAgIGNvbnN0IG1ldGFkYXRhUHJlZml4ID0gYCR7ZGF0YWJhc2VJZGVudGl0eS5sZW5ndGh9OiR7ZGF0YWJhc2VJZGVudGl0eX06YFxuXG4gICAgZm9yIChjb25zdCBtZXRhZGF0YUtleSBvZiB2YWx1ZXMua2V5cygpKSB7XG4gICAgICBpZiAobWV0YWRhdGFLZXkuc3RhcnRzV2l0aChtZXRhZGF0YVByZWZpeCkpIHZhbHVlcy5kZWxldGUobWV0YWRhdGFLZXkpXG4gICAgfVxuXG4gICAgaWYgKHZhbHVlcy5zaXplID09PSAwKSByZWNvcmRNZXRhZGF0YVZhbHVlc0J5TW9kZWwuZGVsZXRlKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIHRoZSBtb2RlbCBjbGFzcyB3aXRoIGEgY29uZmlndXJhdGlvbiB3aXRob3V0IGxvYWRpbmcgdGFibGUgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgcmVnaXN0ZXJSZWNvcmRDbGFzcyh7Y29uZmlndXJhdGlvbiwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKGBObyBjb25maWd1cmF0aW9uIGdpdmVuIGZvciAke3RoaXMubmFtZX1gKVxuXG4gICAgdGhpcy5yZXNldFJlY29yZE1ldGFkYXRhKClcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5fcmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzIHx8IHRoaXNcblxuICAgIG1vZGVsQ2xhc3MuX2NvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgY29uZmlndXJhdGlvbi5yZWdpc3Rlck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluaXRpYWxpemUgcmVjb3JkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2FyZ3MuY29ubmVjdGlvbl0gLSBFeHBsaWNpdCBtZXRhZGF0YSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGluaXRpYWxpemVSZWNvcmQoe2NvbmZpZ3VyYXRpb24sIGNvbm5lY3Rpb246IGV4cGxpY2l0Q29ubmVjdGlvbiwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKGBObyBjb25maWd1cmF0aW9uIGdpdmVuIGZvciAke3RoaXMubmFtZX1gKVxuXG4gICAgdGhpcy5yZWdpc3RlclJlY29yZENsYXNzKHtjb25maWd1cmF0aW9ufSlcbiAgICBjb25zdCBjb25uZWN0aW9uID0gZXhwbGljaXRDb25uZWN0aW9uIHx8IHRoaXMuY29ubmVjdGlvbih7ZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGU6IGZhbHNlfSlcblxuICAgIHRoaXMuX2RhdGFiYXNlVHlwZSA9IGNvbm5lY3Rpb24uZ2V0VHlwZSgpXG5cbiAgICB0aGlzLl90YWJsZSA9IGF3YWl0IGNvbm5lY3Rpb24uZ2V0VGFibGVCeU5hbWUodGhpcy50YWJsZU5hbWUoKSlcbiAgICB0aGlzLl9jb2x1bW5zID0gYXdhaXQgdGhpcy5fZ2V0VGFibGUoKS5nZXRDb2x1bW5zKClcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICB0aGlzLl9jb2x1bW5zQXNIYXNoID0ge31cblxuICAgIGNvbnN0IGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSB0aGlzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUgPSB0aGlzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuICAgIGNvbnN0IHByb3RvdHlwZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMucHJvdG90eXBlKSlcblxuICAgIGZvciAoY29uc3QgY29sdW1uIG9mIHRoaXMuX2NvbHVtbnMpIHtcbiAgICAgIHRoaXMuX2NvbHVtbnNBc0hhc2hbY29sdW1uLmdldE5hbWUoKV0gPSBjb2x1bW5cblxuICAgICAgY29uc3QgZGVidXJyZWRDb2x1bW5OYW1lID0gZGVidXJyQ29sdW1uTmFtZShjb2x1bW4uZ2V0TmFtZSgpKVxuICAgICAgY29uc3QgY2FtZWxpemVkQ29sdW1uTmFtZSA9IGluZmxlY3Rpb24uY2FtZWxpemUoZGVidXJyZWRDb2x1bW5OYW1lLCB0cnVlKVxuICAgICAgY29uc3QgY2FtZWxpemVkQ29sdW1uTmFtZUJpZ0ZpcnN0ID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShkZWJ1cnJlZENvbHVtbk5hbWUpXG5cbiAgICAgIGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVbY2FtZWxpemVkQ29sdW1uTmFtZV0gPSBjb2x1bW4uZ2V0TmFtZSgpXG4gICAgICBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lW2NvbHVtbi5nZXROYW1lKCldID0gY2FtZWxpemVkQ29sdW1uTmFtZVxuXG4gICAgICBpZiAoIShjYW1lbGl6ZWRDb2x1bW5OYW1lIGluIHByb3RvdHlwZSkpIHtcbiAgICAgICAgcHJvdG90eXBlW2NhbWVsaXplZENvbHVtbk5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMucmVhZEF0dHJpYnV0ZShjYW1lbGl6ZWRDb2x1bW5OYW1lKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICghKGBzZXQke2NhbWVsaXplZENvbHVtbk5hbWVCaWdGaXJzdH1gIGluIHByb3RvdHlwZSkpIHtcbiAgICAgICAgcHJvdG90eXBlW2BzZXQke2NhbWVsaXplZENvbHVtbk5hbWVCaWdGaXJzdH1gXSA9IGZ1bmN0aW9uKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIG5ld1ZhbHVlKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX3NldENvbHVtbkF0dHJpYnV0ZShjYW1lbGl6ZWRDb2x1bW5OYW1lLCBuZXdWYWx1ZSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoIShgaGFzJHtjYW1lbGl6ZWRDb2x1bW5OYW1lQmlnRmlyc3R9YCBpbiBwcm90b3R5cGUpKSB7XG4gICAgICAgIHByb3RvdHlwZVtgaGFzJHtjYW1lbGl6ZWRDb2x1bW5OYW1lQmlnRmlyc3R9YF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuICAgICAgICAgIGNvbnN0IHZhbHVlID0gZHluYW1pY1RoaXNbY2FtZWxpemVkQ29sdW1uTmFtZV0oKVxuXG4gICAgICAgICAgcmV0dXJuIHRoaXMuX2hhc0F0dHJpYnV0ZSh2YWx1ZSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX2RlZmluZVRyYW5zbGF0aW9uTWV0aG9kcyhjb25uZWN0aW9uKVxuICAgIGF3YWl0IGluaXRpYWxpemVBdWRpdGluZyh0aGlzKVxuICAgIHRoaXMuX2luaXRpYWxpemVkID0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemVzIHRoZSBtb2RlbCBjbGFzcyB0aGUgZmlyc3QgdGltZSBhbiBhc3luYyByZWNvcmQgQVBJIG5lZWRzIHRhYmxlXG4gICAqIG1ldGFkYXRhLiBDb25jdXJyZW50IGNhbGxlcnMgc2hhcmUgdGhlIHNhbWUgaW5pdGlhbGl6YXRpb24gcHJvbWlzZSwgYW5kIGFcbiAgICogZmFpbGVkIGluaXRpYWxpemF0aW9uIGNhbiBiZSByZXRyaWVkIGJ5IGEgbGF0ZXIgY2FsbC5cbiAgICogQHBhcmFtIHt7Y29uZmlndXJhdGlvbj86IGltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgY29ubmVjdGlvbj86IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fX0gW2FyZ3NdIC0gT3B0aW9uYWwgY29uZmlndXJhdGlvbiBhbmQgZXhwbGljaXQgbWV0YWRhdGEgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgbW9kZWwgY2xhc3MgaXMgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZW5zdXJlSW5pdGlhbGl6ZWQoYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge2NvbmZpZ3VyYXRpb24sIGNvbm5lY3Rpb24sIC4uLnJlc3RBcmdzfSA9IGFyZ3NcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZWQpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlKSB7XG4gICAgICBhd2FpdCB0aGlzLl9pbml0aWFsaXplUmVjb3JkUHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZWRDb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvbiB8fCB0aGlzLl9jb25maWd1cmF0aW9uIHx8IENvbmZpZ3VyYXRpb24uY3VycmVudCgpXG5cbiAgICBjb25zdCBpbml0aWFsaXplUmVjb3JkUHJvbWlzZSA9IHRoaXMuaW5pdGlhbGl6ZVJlY29yZCh7Y29uZmlndXJhdGlvbjogcmVzb2x2ZWRDb25maWd1cmF0aW9uLCBjb25uZWN0aW9ufSlcblxuICAgIHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlID0gaW5pdGlhbGl6ZVJlY29yZFByb21pc2VcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBpbml0aWFsaXplUmVjb3JkUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVJlY29yZFByb21pc2UgPT09IGluaXRpYWxpemVSZWNvcmRQcm9taXNlKSB7XG4gICAgICAgIHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlID0gbnVsbFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGF0dHJpYnV0ZS5cbiAgICovXG4gIF9oYXNBdHRyaWJ1dGUodmFsdWUpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09IFwic3RyaW5nXCIpIHtcbiAgICAgIHZhbHVlID0gdmFsdWUudHJpbSgpXG4gICAgfVxuXG4gICAgaWYgKHZhbHVlKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgaW5pdGlhbGl6ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBzdGF0aWMgaXNJbml0aWFsaXplZCgpIHtcbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZWQpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2VydCBoYXMgYmVlbiBpbml0aWFsaXplZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIF9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKSB7XG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVkKSByZXR1cm5cblxuICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9IHVzZWQgYmVmb3JlIGluaXRpYWxpemF0aW9uLiBDYWxsICR7dGhpcy5uYW1lfS5pbml0aWFsaXplUmVjb3JkKC4uLikgb3IgY29uZmlndXJhdGlvbi5pbml0aWFsaXplKCkuYClcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWZpbmVzIHRyYW5zbGF0aW9uIGFjY2Vzc29ycyBhbmQgaW5pdGlhbGl6ZXMgdGhlIGdlbmVyYXRlZCB0cmFuc2xhdGlvblxuICAgKiBjbGFzcyB0aHJvdWdoIHRoZSBzYW1lIG1ldGFkYXRhIGNvbm5lY3Rpb24gYXMgdGhlIHRyYW5zbGF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBNZXRhZGF0YSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRyYW5zbGF0aW9uIG1ldGFkYXRhIGlzIHJlYWR5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIF9kZWZpbmVUcmFuc2xhdGlvbk1ldGhvZHMoY29ubmVjdGlvbikge1xuICAgIGlmICh0aGlzLl90cmFuc2xhdGlvbnMgJiYgT2JqZWN0LmtleXModGhpcy5fdHJhbnNsYXRpb25zKS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBsb2NhbGVzID0gdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldExvY2FsZXMoKVxuXG4gICAgICBpZiAoIWxvY2FsZXMpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsZXMgaGFzbid0IGJlZW4gc2V0IGluIHRoZSBjb25maWd1cmF0aW9uXCIpXG5cbiAgICAgIGNvbnN0IFRyYW5zbGF0aW9uQ2xhc3MgPSB0aGlzLmdldFRyYW5zbGF0aW9uQ2xhc3MoKVxuICAgICAgY29uc3QgQm91bmRUcmFuc2xhdGlvbkNsYXNzID0gdGhpcy5fcmVjb3JkTWV0YWRhdGFCaW5kZXIgPyB0aGlzLl9yZWNvcmRNZXRhZGF0YUJpbmRlcihUcmFuc2xhdGlvbkNsYXNzKSA6IFRyYW5zbGF0aW9uQ2xhc3NcblxuICAgICAgYXdhaXQgQm91bmRUcmFuc2xhdGlvbkNsYXNzLmluaXRpYWxpemVSZWNvcmQoe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIGNvbm5lY3Rpb25cbiAgICAgIH0pXG5cbiAgICAgIGZvciAoY29uc3QgbmFtZSBpbiB0aGlzLl90cmFuc2xhdGlvbnMpIHtcbiAgICAgICAgY29uc3QgbmFtZUNhbWVsaXplZCA9IGluZmxlY3Rpb24uY2FtZWxpemUobmFtZSlcbiAgICAgICAgY29uc3Qgc2V0dGVyTWV0aG9kTmFtZSA9IGBzZXQke25hbWVDYW1lbGl6ZWR9YFxuICAgICAgICBjb25zdCBwcm90b3R5cGUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzLnByb3RvdHlwZSkpXG5cbiAgICAgICAgcHJvdG90eXBlW25hbWVdID0gZnVuY3Rpb24gZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZSgpIHtcbiAgICAgICAgICBjb25zdCBsb2NhbGUgPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0TG9jYWxlKClcblxuICAgICAgICAgIHJldHVybiB0aGlzLl9nZXRUcmFuc2xhdGVkQXR0cmlidXRlV2l0aEZhbGxiYWNrKG5hbWUsIGxvY2FsZSlcbiAgICAgICAgfVxuXG4gICAgICAgIHByb3RvdHlwZVtgaGFzJHtuYW1lQ2FtZWxpemVkfWBdID0gZnVuY3Rpb24gaGFzVHJhbnNsYXRlZEF0dHJpYnV0ZSgpIHtcbiAgICAgICAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGR5bmFtaWNUaGlzW25hbWVdXG5cbiAgICAgICAgICBpZiAodHlwZW9mIGNhbmRpZGF0ZSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gY2FuZGlkYXRlLmJpbmQodGhpcykoKVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5faGFzQXR0cmlidXRlKHZhbHVlKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGNhbmRpZGF0ZSB0byBiZSBhIGZ1bmN0aW9uIGJ1dCBpdCB3YXM6ICR7dHlwZW9mIGNhbmRpZGF0ZX1gKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHByb3RvdHlwZVtzZXR0ZXJNZXRob2ROYW1lXSA9IGZ1bmN0aW9uIHNldFRyYW5zbGF0ZWRBdHRyaWJ1dGUoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gbmV3VmFsdWUpIHtcbiAgICAgICAgICBjb25zdCBsb2NhbGUgPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0TG9jYWxlKClcblxuICAgICAgICAgIHJldHVybiB0aGlzLl9zZXRUcmFuc2xhdGVkQXR0cmlidXRlKG5hbWUsIGxvY2FsZSwgbmV3VmFsdWUpXG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IGxvY2FsZSBvZiBsb2NhbGVzKSB7XG4gICAgICAgICAgY29uc3QgbG9jYWxlQ2FtZWxpemVkID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShsb2NhbGUpXG4gICAgICAgICAgY29uc3QgZ2V0dGVyTWV0aG9kTmFtZUxvY2FsaXplZCA9IGAke25hbWV9JHtsb2NhbGVDYW1lbGl6ZWR9YFxuICAgICAgICAgIGNvbnN0IHNldHRlck1ldGhvZE5hbWVMb2NhbGl6ZWQgPSBgJHtzZXR0ZXJNZXRob2ROYW1lfSR7bG9jYWxlQ2FtZWxpemVkfWBcbiAgICAgICAgICBjb25zdCBoYXNNZXRob2ROYW1lTG9jYWxpemVkID0gYGhhcyR7aW5mbGVjdGlvbi5jYW1lbGl6ZShuYW1lKX0ke2xvY2FsZUNhbWVsaXplZH1gXG5cbiAgICAgICAgICBwcm90b3R5cGVbZ2V0dGVyTWV0aG9kTmFtZUxvY2FsaXplZF0gPSBmdW5jdGlvbiBnZXRUcmFuc2xhdGVkQXR0cmlidXRlV2l0aExvY2FsZSgpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9nZXRUcmFuc2xhdGVkQXR0cmlidXRlKG5hbWUsIGxvY2FsZSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwcm90b3R5cGVbc2V0dGVyTWV0aG9kTmFtZUxvY2FsaXplZF0gPSBmdW5jdGlvbiBzZXRUcmFuc2xhdGVkQXR0cmlidXRlV2l0aExvY2FsZSgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBuZXdWYWx1ZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGUobmFtZSwgbG9jYWxlLCBuZXdWYWx1ZSlcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwcm90b3R5cGVbaGFzTWV0aG9kTmFtZUxvY2FsaXplZF0gPSBmdW5jdGlvbiBoYXNUcmFuc2xhdGVkQXR0cmlidXRlKCkge1xuICAgICAgICAgICAgY29uc3QgZHluYW1pY1RoaXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcbiAgICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGR5bmFtaWNUaGlzW2dldHRlck1ldGhvZE5hbWVMb2NhbGl6ZWRdXG5cbiAgICAgICAgICAgIGlmICh0eXBlb2YgY2FuZGlkYXRlID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgICBjb25zdCB2YWx1ZSA9IGNhbmRpZGF0ZS5iaW5kKHRoaXMpKClcblxuICAgICAgICAgICAgICByZXR1cm4gdGhpcy5faGFzQXR0cmlidXRlKHZhbHVlKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBjYW5kaWRhdGUgdG8gYmUgYSBmdW5jdGlvbiBidXQgaXQgd2FzOiAke3R5cGVvZiBjYW5kaWRhdGV9YClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJlZCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBjb25maWd1cmVkIG5vbi10ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIHN0YXRpYyBnZXRDb25maWd1cmVkRGF0YWJhc2VJZGVudGlmaWVyKCkge1xuICAgIHJldHVybiB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIgfHwgXCJkZWZhdWx0XCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZV0gLSBXaGV0aGVyIHRlbmFudC1zd2l0Y2hlZCBtb2RlbHMgbXVzdCByZXNvbHZlIGEgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJncy50ZW5hbnRdIC0gRXhwbGljaXQgdGVuYW50IGRlc2NyaXB0b3IgaW5zdGVhZCBvZiB0aGUgYW1iaWVudCB0ZW5hbnQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBzdGF0aWMgZ2V0RGF0YWJhc2VJZGVudGlmaWVyKHtlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZSA9IHRydWUsIHRlbmFudCA9IEN1cnJlbnQudGVuYW50KCksIC4uLnJlc3RBcmdzfSA9IHt9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGNvbnN0IHRlbmFudERhdGFiYXNlSWRlbnRpZmllciA9IHRoaXMuZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKHRlbmFudClcblxuICAgIGlmICh0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICAgIGlmIChcbiAgICAgICAgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGUgJiZcbiAgICAgICAgdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcygpICYmXG4gICAgICAgICF0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUodGVuYW50RGF0YWJhc2VJZGVudGlmaWVyLCB0ZW5hbnQpXG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgbmV3IFRlbmFudERhdGFiYXNlU2NvcGVFcnJvcihcbiAgICAgICAgICBgJHt0aGlzLmdldE1vZGVsTmFtZSgpfSByZXNvbHZlZCB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciAke0pTT04uc3RyaW5naWZ5KHRlbmFudERhdGFiYXNlSWRlbnRpZmllcil9IGJ1dCB0aGF0IGRhdGFiYXNlIGlkZW50aWZpZXIgaXMgbm90IGFjdGl2ZSBmb3IgdGhlIGN1cnJlbnQgdGVuYW50LiBXcmFwIHRoZSBtb2RlbCBxdWVyeSBpbiBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQoLi4uKSBvciBzZXQgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzOiBmYWxzZSB0byBhbGxvdyBsZWdhY3kgZmFsbGJhY2sgYmVoYXZpb3IuYCxcbiAgICAgICAgICB7bW9kZWxOYW1lOiB0aGlzLmdldE1vZGVsTmFtZSgpfVxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJcbiAgICB9XG5cbiAgICBpZiAoZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGUgJiYgdGhpcy5fdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIgJiYgdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldEVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlcygpKSB7XG4gICAgICB0aHJvdyBuZXcgVGVuYW50RGF0YWJhc2VTY29wZUVycm9yKFxuICAgICAgICBgJHt0aGlzLmdldE1vZGVsTmFtZSgpfSBpcyBjb25maWd1cmVkIHdpdGggc3dpdGNoZXNUZW5hbnREYXRhYmFzZSguLi4pIGJ1dCBubyB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciByZXNvbHZlZCBmb3IgdGhlIGN1cnJlbnQgdGVuYW50LiBXcmFwIHRoZSBtb2RlbCBxdWVyeSBpbiBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQoLi4uKSBvciBzZXQgZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzOiBmYWxzZSB0byBhbGxvdyBsZWdhY3kgZmFsbGJhY2sgYmVoYXZpb3IuYCxcbiAgICAgICAge21vZGVsTmFtZTogdGhpcy5nZXRNb2RlbE5hbWUoKX1cbiAgICAgIClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5nZXRDb25maWd1cmVkRGF0YWJhc2VJZGVudGlmaWVyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHNldERhdGFiYXNlSWRlbnRpZmllcihkYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhIHRlbmFudC1hd2FyZSBkYXRhYmFzZSBpZGVudGlmaWVyIHJlc29sdmVyIGZvciB0aGlzIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8ICgoYXJnczoge21vZGVsQ2xhc3M6IHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCwgdGVuYW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwgfCB1bmRlZmluZWR9KSA9PiBzdHJpbmcgfCB1bmRlZmluZWQpfSBkYXRhYmFzZUlkZW50aWZpZXJPclJlc29sdmVyIC0gU3RhdGljIGlkZW50aWZpZXIgb3IgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzd2l0Y2hlc1RlbmFudERhdGFiYXNlKGRhdGFiYXNlSWRlbnRpZmllck9yUmVzb2x2ZXIpIHtcbiAgICB0aGlzLl90ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlciA9IGRhdGFiYXNlSWRlbnRpZmllck9yUmVzb2x2ZXJcblxuICAgIGlmICh0aGlzLl90cmFuc2xhdGlvbkNsYXNzKSB7XG4gICAgICBjb25zdCB0cmFuc2xhdGVkTW9kZWxDbGFzcyA9IHRoaXNcblxuICAgICAgdGhpcy5fdHJhbnNsYXRpb25DbGFzcy5zd2l0Y2hlc1RlbmFudERhdGFiYXNlKCh7dGVuYW50fSkgPT4gdHJhbnNsYXRlZE1vZGVsQ2xhc3MuZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKHRlbmFudCkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgbW9kZWwgcmVzb2x2ZXMgaXRzIGRhdGFiYXNlIGZyb20gdGhlIGN1cnJlbnQgdGVuYW50LlxuICAgKi9cbiAgc3RhdGljIGhhc1RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKCkge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMuX3RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbdGVuYW50XSAtIFRlbmFudCBvdmVycmlkZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUZW5hbnQtc2NvcGVkIGRhdGFiYXNlIGlkZW50aWZpZXIgd2hlbiBjb25maWd1cmVkLlxuICAgKi9cbiAgc3RhdGljIGdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcih0ZW5hbnQgPSBDdXJyZW50LnRlbmFudCgpKSB7XG4gICAgY29uc3QgdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIgPSB0aGlzLl90ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlclxuXG4gICAgaWYgKCF0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlcikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlciA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoe1xuICAgICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgICB0ZW5hbnRcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBUaGUgYXR0cmlidXRlLlxuICAgKi9cbiAgZ2V0QXR0cmlidXRlKG5hbWUpIHtcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKG5hbWUpXG5cbiAgICBpZiAoIXRoaXMuaXNOZXdSZWNvcmQoKSAmJiAhKGNvbHVtbk5hbWUgaW4gdGhpcy5fYXR0cmlidXRlcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IyR7bmFtZX0gYXR0cmlidXRlIGhhc24ndCBiZWVuIGxvYWRlZCB5ZXQgaW4gJHtPYmplY3Qua2V5cyh0aGlzLl9hdHRyaWJ1dGVzKS5qb2luKFwiLCBcIil9YClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0cmlidXRlc1tjb2x1bW5OYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gLSBUaGUgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBnZXRNb2RlbENsYXNzKCkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG5cbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24pIHJldHVybiB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi5tb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgICByZXR1cm4gbW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBuZXdWYWx1ZSAtIE5ldyB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0QXR0cmlidXRlKG5hbWUsIG5ld1ZhbHVlKSB7XG4gICAgLy8gUmVzb2x2ZSByYXcgY29sdW1uIG5hbWVzIChcIlZBX8OcYkF0dHJpYnV0SURcIiwgXCJJUFwiKSBhbmQgY2FzaW5nIHZhcmlhbnRzIChcInZBRnVua3Rpb25JRFwiKSB0byB0aGVcbiAgICAvLyBjYW5vbmljYWwgYXR0cmlidXRlIHRoZSBtb2RlbCBiYXNlIGdlbmVyYXRlcyBpdHMgc2V0dGVyIGZyb20gKHNldFZBVWViYXR0cmlidXRpZCwgc2V0SXAsIOKApikuXG4gICAgY29uc3QgY2Fub25pY2FsTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnJlc29sdmVBdHRyaWJ1dGVOYW1lKG5hbWUpID8/IG5hbWVcbiAgICBjb25zdCByZXF1ZXN0ZWRTZXR0ZXJOYW1lID0gYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShjYW5vbmljYWxOYW1lKX1gXG4gICAgY29uc3Qgc2V0dGVyTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmZpbmRNZW1iZXJOYW1lSW5zZW5zaXRpdmUodGhpcywgcmVxdWVzdGVkU2V0dGVyTmFtZSlcbiAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKHZhbHVlOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gdm9pZD59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG5cbiAgICB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fYXNzZXJ0SGFzQmVlbkluaXRpYWxpemVkKClcbiAgICBpZiAoIXRoaXMuZ2V0TW9kZWxDbGFzcygpLmlzSW5pdGlhbGl6ZWQoKSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gbW9kZWwgaXNuJ3QgaW5pdGlhbGl6ZWQgeWV0YClcbiAgICBpZiAoIXNldHRlck5hbWUpIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBzZXR0ZXIgbWV0aG9kOiAke3RoaXMuY29uc3RydWN0b3IubmFtZX0jJHtyZXF1ZXN0ZWRTZXR0ZXJOYW1lfWApXG5cbiAgICBkeW5hbWljVGhpc1tzZXR0ZXJOYW1lXShuZXdWYWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjb2x1bW4gYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG5ld1ZhbHVlIC0gTmV3IHZhbHVlLlxuICAgKi9cbiAgX3NldENvbHVtbkF0dHJpYnV0ZShuYW1lLCBuZXdWYWx1ZSkge1xuICAgIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIGlmICghdGhpcy5nZXRNb2RlbENsYXNzKCkuX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUpIHRocm93IG5ldyBFcnJvcihcIk5vIGF0dHJpYnV0ZS10by1jb2x1bW4gbWFwcGluZy4gSGFzIHJlY29yZCBiZWVuIGluaXRpYWxpemVkP1wiKVxuXG4gICAgY29uc3QgcmVzb2x2ZWROYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucmVzb2x2ZUF0dHJpYnV0ZU5hbWUobmFtZSlcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gcmVzb2x2ZWROYW1lID8gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpW3Jlc29sdmVkTmFtZV0gOiB1bmRlZmluZWRcblxuICAgIGlmICghY29sdW1uTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCBmaWd1cmUgb3V0IGNvbHVtbiBuYW1lIGZvciBhdHRyaWJ1dGU6ICR7bmFtZX1gKVxuXG4gICAgbGV0IG5vcm1hbGl6ZWRWYWx1ZSA9IG5ld1ZhbHVlXG4gICAgY29uc3QgY29sdW1uVHlwZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtblR5cGVCeU5hbWUoY29sdW1uTmFtZSlcblxuICAgIGlmIChjb2x1bW5UeXBlICYmIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9pc0RhdGVMaWtlVHlwZShjb2x1bW5UeXBlKSkge1xuICAgICAgbm9ybWFsaXplZFZhbHVlID0gdGhpcy5fbm9ybWFsaXplRGF0ZVZhbHVlKG5ld1ZhbHVlKVxuICAgIH1cblxuICAgIG5vcm1hbGl6ZWRWYWx1ZSA9IHRoaXMuX25vcm1hbGl6ZUJvb2xlYW5WYWx1ZUZvcldyaXRlKHthdHRyaWJ1dGVOYW1lOiBuYW1lLCBjb2x1bW5UeXBlLCB2YWx1ZTogbm9ybWFsaXplZFZhbHVlfSlcblxuICAgIGlmICh0aGlzLl9hdHRyaWJ1dGVzW2NvbHVtbk5hbWVdICE9IG5vcm1hbGl6ZWRWYWx1ZSkge1xuICAgICAgdGhpcy5fY2xlYXJCZWxvbmdzVG9SZWxhdGlvbnNoaXBGb3JDaGFuZ2VkRm9yZWlnbktleShjb2x1bW5OYW1lLCBub3JtYWxpemVkVmFsdWUpXG4gICAgICB0aGlzLl9jaGFuZ2VzW2NvbHVtbk5hbWVdID0gbm9ybWFsaXplZFZhbHVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBsb2FkZWQgYmVsb25ncy10byBjYWNoZXMgd2hlbiBjYWxsZXJzIGFzc2lnbiB0aGUgZm9yZWlnbiBrZXkgZGlyZWN0bHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ2hhbmdlZCBkYXRhYmFzZSBjb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbm9ybWFsaXplZFZhbHVlIC0gTmV3IG5vcm1hbGl6ZWQgY29sdW1uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfY2xlYXJCZWxvbmdzVG9SZWxhdGlvbnNoaXBGb3JDaGFuZ2VkRm9yZWlnbktleShjb2x1bW5OYW1lLCBub3JtYWxpemVkVmFsdWUpIHtcbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcCBvZiB0aGlzLl9iZWxvbmdzVG9SZWxhdGlvbnNoaXBzRm9yRm9yZWlnbktleShjb2x1bW5OYW1lKSkge1xuICAgICAgaWYgKHRoaXMuX2JlbG9uZ3NUb1JlbGF0aW9uc2hpcE1hdGNoZXNGb3JlaWduS2V5VmFsdWUoe25vcm1hbGl6ZWRWYWx1ZSwgcmVsYXRpb25zaGlwfSkpIGNvbnRpbnVlXG5cbiAgICAgIHRoaXMuX2NsZWFyTG9hZGVkQmVsb25nc1RvUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWxvbmdzIHRvIHJlbGF0aW9uc2hpcHMgZm9yIGZvcmVpZ24ga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENoYW5nZWQgZGF0YWJhc2UgY29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCBpbnN0YW5jZXMgdGhhdCB1c2UgdGhlIGNoYW5nZWQgZm9yZWlnbiBrZXkuXG4gICAqL1xuICBfYmVsb25nc1RvUmVsYXRpb25zaGlwc0ZvckZvcmVpZ25LZXkoY29sdW1uTmFtZSkge1xuICAgIGlmICghdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKSByZXR1cm4gW11cblxuICAgIHJldHVybiBPYmplY3RcbiAgICAgIC52YWx1ZXModGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKVxuICAgICAgLmZpbHRlcigocmVsYXRpb25zaGlwKSA9PiB0aGlzLl9iZWxvbmdzVG9SZWxhdGlvbnNoaXBVc2VzRm9yZWlnbktleSh7Y29sdW1uTmFtZSwgcmVsYXRpb25zaGlwfSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWxvbmdzIHRvIHJlbGF0aW9uc2hpcCB1c2VzIGZvcmVpZ24ga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlbGF0aW9uc2hpcCBtYXRjaCBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbk5hbWUgLSBDaGFuZ2VkIGRhdGFiYXNlIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVsYXRpb25zaGlwIGlzIGEgYmVsb25ncy10byB1c2luZyB0aGUgY2hhbmdlZCBmb3JlaWduIGtleS5cbiAgICovXG4gIF9iZWxvbmdzVG9SZWxhdGlvbnNoaXBVc2VzRm9yZWlnbktleSh7Y29sdW1uTmFtZSwgcmVsYXRpb25zaGlwfSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0VHlwZSgpICE9IFwiYmVsb25nc1RvXCIpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgZm9yZWlnbktleSA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcbiAgICBjb25zdCBmb3JlaWduS2V5QXR0cmlidXRlID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW2ZvcmVpZ25LZXldXG5cbiAgICByZXR1cm4gZm9yZWlnbktleSA9PSBjb2x1bW5OYW1lIHx8IGZvcmVpZ25LZXlBdHRyaWJ1dGUgPT0gY29sdW1uTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVsb25ncyB0byByZWxhdGlvbnNoaXAgbWF0Y2hlcyBmb3JlaWduIGtleSB2YWx1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZWxhdGlvbnNoaXAgY2FjaGUgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLm5vcm1hbGl6ZWRWYWx1ZSAtIE5ldyBub3JtYWxpemVkIGNvbHVtbiB2YWx1ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5yZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGxvYWRlZCByZWxhdGVkIHJlY29yZCBzdGlsbCBtYXRjaGVzIHRoZSBjaGFuZ2VkIGZvcmVpZ24ga2V5LlxuICAgKi9cbiAgX2JlbG9uZ3NUb1JlbGF0aW9uc2hpcE1hdGNoZXNGb3JlaWduS2V5VmFsdWUoe25vcm1hbGl6ZWRWYWx1ZSwgcmVsYXRpb25zaGlwfSkge1xuICAgIGNvbnN0IGxvYWRlZCA9IHJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG5cbiAgICBpZiAoIWxvYWRlZCkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZGVkKSkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKCFyZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiBsb2FkZWQucmVhZENvbHVtbihyZWxhdGlvbnNoaXAuZ2V0UHJpbWFyeUtleSgpKSA9PSBub3JtYWxpemVkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBmb3JlaWduIGtleSB2YWx1ZSBmb3IgYSBiZWxvbmdzLXRvIHJlbGF0aW9uc2hpcCBhc3NpZ25tZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlbGF0aW9uc2hpcCBhc3NpZ25tZW50IGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MubW9kZWwgLSBBc3NpZ25lZCBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlbGF0aW9uc2hpcCAtIEJlbG9uZ3MtdG8gcmVsYXRpb25zaGlwIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gLSBGb3JlaWduIGtleSB2YWx1ZSBmb3IgdGhlIGFzc2lnbm1lbnQuXG4gICAqL1xuICBfYmVsb25nc1RvRm9yZWlnbktleVZhbHVlKHttb2RlbCwgcmVsYXRpb25zaGlwfSkge1xuICAgIGlmIChtb2RlbCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICAgIGlmICghKG1vZGVsIGluc3RhbmNlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQpKSB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgbW9kZWwgdHlwZTogJHt0eXBlb2YgbW9kZWx9YClcblxuICAgIHJldHVybiAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9ICovIChtb2RlbC5yZWFkQ29sdW1uKHJlbGF0aW9uc2hpcC5nZXRQcmltYXJ5S2V5KCkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xlYXIgbG9hZGVkIGJlbG9uZ3MgdG8gcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9jbGVhckxvYWRlZEJlbG9uZ3NUb1JlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXApIHtcbiAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHVuZGVmaW5lZClcbiAgICByZWxhdGlvbnNoaXAuc2V0UHJlbG9hZGVkKGZhbHNlKVxuICAgIHJlbGF0aW9uc2hpcC5zZXREaXJ0eShmYWxzZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBkYXRlIHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBkYXRlIHZhbHVlLlxuICAgKi9cbiAgX25vcm1hbGl6ZURhdGVWYWx1ZSh2YWx1ZSkge1xuICAgIHJldHVybiBub3JtYWxpemVEYXRlVmFsdWVGb3JXcml0ZSh2YWx1ZSwge3RpbWVab25lOiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fdGltZVpvbmVGb3JEYXRlV3JpdGUoKX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgc3FsaXRlIGJvb2xlYW4gdmFsdWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBfbm9ybWFsaXplU3FsaXRlQm9vbGVhblZhbHVlKHtjb2x1bW5UeXBlLCB2YWx1ZX0pIHtcbiAgICBpZiAodGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0RGF0YWJhc2VUeXBlKCkgIT0gXCJzcWxpdGVcIikgcmV0dXJuIHZhbHVlXG4gICAgaWYgKCFjb2x1bW5UeXBlKSByZXR1cm4gdmFsdWVcbiAgICBpZiAoY29sdW1uVHlwZS50b0xvd2VyQ2FzZSgpICE9PSBcImJvb2xlYW5cIikgcmV0dXJuIHZhbHVlXG4gICAgaWYgKHZhbHVlID09PSB0cnVlKSByZXR1cm4gMVxuICAgIGlmICh2YWx1ZSA9PT0gZmFsc2UpIHJldHVybiAwXG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGEgYm9vbGVhbiB2YWx1ZSBiZWZvcmUgc3RvcmluZy4gQSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGF0dHJpYnV0ZSBjYXN0IHN0b3Jlc1xuICAgKiBib29sZWFucyBhcyAxLzAgb25seSBmb3IgaW50ZWdlci1iYWNrZWQgY29sdW1ucyAoZS5nLiBhbiBNU1NRTCBgYml0YCkuIENvbHVtbnMgd2hvc2VcbiAgICogdW5kZXJseWluZyB0eXBlIGlzIGFscmVhZHkgYSBuYXRpdmUgYm9vbGVhbiAoZS5nLiBQb3N0Z3JlcyBgYm9vbGVhbmApIGtlZXAgYHRydWVgL2BmYWxzZWBcbiAgICogc28gdGhlIGRyaXZlciBjYW4gZW1pdCB0aGUgcHJvcGVyIGJvb2xlYW4gbGl0ZXJhbDsgb3RoZXJ3aXNlIHRoZSBzcWxpdGUtb25seSBub3JtYWxpemVyIGFwcGxpZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZSBiZWluZyB3cml0dGVuLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gYXJncy5jb2x1bW5UeXBlIC0gQ29sdW1uIHR5cGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBWYWx1ZSB0byBub3JtYWxpemUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICAgKi9cbiAgX25vcm1hbGl6ZUJvb2xlYW5WYWx1ZUZvcldyaXRlKHthdHRyaWJ1dGVOYW1lLCBjb2x1bW5UeXBlLCB2YWx1ZX0pIHtcbiAgICBpZiAoIXRoaXMuZ2V0TW9kZWxDbGFzcygpLl9kZWNsYXJlZEJvb2xlYW5TdG9yZXNBc0ludGVnZXIoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHJldHVybiB0aGlzLl9ub3JtYWxpemVTcWxpdGVCb29sZWFuVmFsdWUoe2NvbHVtblR5cGUsIHZhbHVlfSlcbiAgICB9XG5cbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiAxXG4gICAgaWYgKHZhbHVlID09PSBmYWxzZSkgcmV0dXJuIDBcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGF0dHJpYnV0ZSBjYXN0IGlzIGJhY2tlZCBieSBhbiBpbnRlZ2VyIGNvbHVtbiAoZS5nLiBhbiBNU1NRTFxuICAgKiBgYml0YCksIHNvIGJvb2xlYW5zIG11c3QgYmUgc3RvcmVkIGFzIDEvMC4gQSBuYXRpdmUgYm9vbGVhbiBjb2x1bW4gKGUuZy4gUG9zdGdyZXMgYGJvb2xlYW5gKVxuICAgKiByZXR1cm5zIGZhbHNlIGFuZCBrZWVwcyBgdHJ1ZWAvYGZhbHNlYCBmb3IgdGhlIGRyaXZlci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgZGVjbGFyZWQgYm9vbGVhbiBpcyBzdG9yZWQgYXMgYW4gaW50ZWdlci5cbiAgICovXG4gIHN0YXRpYyBfZGVjbGFyZWRCb29sZWFuU3RvcmVzQXNJbnRlZ2VyKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBpZiAodGhpcy5nZXRBdHRyaWJ1dGVDYXN0KGF0dHJpYnV0ZU5hbWUpICE9PSBcImJvb2xlYW5cIikgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClbYXR0cmlidXRlTmFtZV1cbiAgICBjb25zdCBpbnRyb3NwZWN0ZWRUeXBlID0gY29sdW1uTmFtZSA/IHRoaXMuZ2V0Q29sdW1uc0hhc2goKVtjb2x1bW5OYW1lXT8uZ2V0VHlwZSgpIDogdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gdHlwZW9mIGludHJvc3BlY3RlZFR5cGUgPT09IFwic3RyaW5nXCIgJiYgaW50cm9zcGVjdGVkVHlwZS50b0xvd2VyQ2FzZSgpICE9PSBcImJvb2xlYW5cIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbHVtbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHRbXX0gLSBUaGUgY29sdW1ucy5cbiAgICovXG4gIHN0YXRpYyBnZXRDb2x1bW5zKCkge1xuICAgIHRoaXMuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgaWYgKCF0aGlzLl9jb2x1bW5zKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5uYW1lfSBoYXNuJ3QgYmVlbiBpbml0aWFsaXplZCB5ZXRgKVxuXG4gICAgcmV0dXJuIHRoaXMuX2NvbHVtbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb2x1bW5zIGhhc2guXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSAtIFRoZSBjb2x1bW5zIGhhc2guXG4gICAqL1xuICBzdGF0aWMgZ2V0Q29sdW1uc0hhc2goKSB7XG4gICAgaWYgKCF0aGlzLl9jb2x1bW5zQXNIYXNoKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgICAgdGhpcy5fY29sdW1uc0FzSGFzaCA9IHt9XG5cbiAgICAgIGZvciAoY29uc3QgY29sdW1uIG9mIHRoaXMuZ2V0Q29sdW1ucygpKSB7XG4gICAgICAgIHRoaXMuX2NvbHVtbnNBc0hhc2hbY29sdW1uLmdldE5hbWUoKV0gPSBjb2x1bW5cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fY29sdW1uc0FzSGFzaFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbHVtbiB0eXBlIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgY29sdW1uIHR5cGUgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRDb2x1bW5UeXBlQnlOYW1lKG5hbWUpIHtcbiAgICBpZiAoIXRoaXMuX2NvbHVtblR5cGVCeU5hbWUpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD59ICovXG4gICAgICB0aGlzLl9jb2x1bW5UeXBlQnlOYW1lID0ge31cblxuICAgICAgZm9yIChjb25zdCBjb2x1bW4gb2YgdGhpcy5nZXRDb2x1bW5zKCkpIHtcbiAgICAgICAgdGhpcy5fY29sdW1uVHlwZUJ5TmFtZVtjb2x1bW4uZ2V0TmFtZSgpXSA9IGNvbHVtbi5nZXRUeXBlKClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gdGhpcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbbmFtZV1cblxuICAgIGlmIChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgICBjb25zdCBjYXN0ID0gdGhpcy5nZXRBdHRyaWJ1dGVDYXN0KGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGlmIChjYXN0KSByZXR1cm4gY2FzdFxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9jb2x1bW5UeXBlQnlOYW1lW25hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBkYXRlIGxpa2UgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBUeXBlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZGF0ZSBsaWtlIHR5cGUuXG4gICAqL1xuICBzdGF0aWMgX2lzRGF0ZUxpa2VUeXBlKHR5cGUpIHtcbiAgICBjb25zdCBub3JtYWxpemVkVHlwZSA9IHR5cGUudG9Mb3dlckNhc2UoKVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRUeXBlID09IFwiZGF0ZVwiIHx8XG4gICAgICBub3JtYWxpemVkVHlwZSA9PSBcImRhdGV0aW1lXCIgfHxcbiAgICAgIG5vcm1hbGl6ZWRUeXBlID09IFwidGltZXN0YW1wXCIgfHxcbiAgICAgIG5vcm1hbGl6ZWRUeXBlID09IFwidGltZXN0YW1wdHpcIiB8fFxuICAgICAgbm9ybWFsaXplZFR5cGUuc3RhcnRzV2l0aChcInRpbWVzdGFtcCBcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb2x1bW4gbmFtZXMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSAtIFRoZSBjb2x1bW4gbmFtZXMuXG4gICAqL1xuICBzdGF0aWMgZ2V0Q29sdW1uTmFtZXMoKSB7XG4gICAgaWYgKCF0aGlzLl9jb2x1bW5OYW1lcykge1xuICAgICAgdGhpcy5fY29sdW1uTmFtZXMgPSB0aGlzLmdldENvbHVtbnMoKS5tYXAoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fY29sdW1uTmFtZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0YWJsZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS10YWJsZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSB0YWJsZS5cbiAgICovXG4gIHN0YXRpYyBfZ2V0VGFibGUoKSB7XG4gICAgaWYgKCF0aGlzLl90YWJsZSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubmFtZX0gaGFzbid0IGJlZW4gaW5pdGlhbGl6ZWQgeWV0YClcblxuICAgIHJldHVybiB0aGlzLl90YWJsZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5zZXJ0IG11bHRpcGxlLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEBwYXJhbSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gcm93cyAtIFJvd3MgdG8gaW5zZXJ0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuY2FzdF0gLSBXaGV0aGVyIHRvIGNhc3QgdmFsdWVzIGJhc2VkIG9uIGNvbHVtbiB0eXBlcy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5yZXRyeUluZGl2aWR1YWxseU9uRmFpbHVyZV0gLSBSZXRyeSByb3dzIGluZGl2aWR1YWxseSBpZiBhIGJhdGNoIGluc2VydCBmYWlscy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5yZXR1cm5SZXN1bHRzXSAtIFJldHVybiBzdWNjZWVkZWQvZmFpbGVkIHJvd3MgaW5zdGVhZCBvZiB0aHJvd2luZyB3aGVuIHJldHJpZXMgZmFpbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZCB8IHtzdWNjZWVkZWRSb3dzOiBBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+LCBmYWlsZWRSb3dzOiBBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+LCBlcnJvcnM6IEFycmF5PHtyb3c6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59Pn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGluc2VydE11bHRpcGxlKGNvbHVtbnMsIHJvd3MsIGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtjYXN0ID0gdHJ1ZSwgcmV0cnlJbmRpdmlkdWFsbHlPbkZhaWx1cmUgPSBmYWxzZSwgcmV0dXJuUmVzdWx0cyA9IGZhbHNlLCAuLi5yZXN0QXJnc30gPSBhcmdzXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFJvd3MgPSBjYXN0XG4gICAgICA/IHRoaXMuX25vcm1hbGl6ZUluc2VydE11bHRpcGxlUm93cyh7Y29sdW1ucywgcm93c30pXG4gICAgICA6IHJvd3NcbiAgICBjb25zdCB0YWJsZU5hbWUgPSB0aGlzLnRhYmxlTmFtZSgpXG5cbiAgICBpZiAoIXJldHJ5SW5kaXZpZHVhbGx5T25GYWlsdXJlKSB7XG4gICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS5pbnNlcnRNdWx0aXBsZSh0YWJsZU5hbWUsIGNvbHVtbnMsIG5vcm1hbGl6ZWRSb3dzKVxuICAgICAgaWYgKHJldHVyblJlc3VsdHMpIHJldHVybiB7c3VjY2VlZGVkUm93czogbm9ybWFsaXplZFJvd3Muc2xpY2UoKSwgZmFpbGVkUm93czogW10sIGVycm9yczogW119XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLy8gV3JhcCB0aGUgYmF0Y2ggaW4gYSB0cmFuc2FjdGlvbi9zYXZlcG9pbnQuIE9uIGRhdGFiYXNlcyB0aGF0IGFib3J0IHRoZVxuICAgICAgLy8gd2hvbGUgdHJhbnNhY3Rpb24gd2hlbiBhIHN0YXRlbWVudCBmYWlscyAoUG9zdGdyZVNRTCksIGEgZmFpbGVkIGJhdGNoXG4gICAgICAvLyB3b3VsZCBvdGhlcndpc2UgcG9pc29uIHRoZSBzdXJyb3VuZGluZyB0cmFuc2FjdGlvbiBzbyB0aGF0IHRoZVxuICAgICAgLy8gaW5kaXZpZHVhbCByZXRyaWVzIGJlbG93IGFsbCBmYWlsIHdpdGggXCJjdXJyZW50IHRyYW5zYWN0aW9uIGlzIGFib3J0ZWRcIi5cbiAgICAgIC8vIHRyYW5zYWN0aW9uKCkgb3BlbnMgYSBzYXZlcG9pbnQgd2hlbiBhbHJlYWR5IGluc2lkZSBhIHRyYW5zYWN0aW9uIGFuZCBhXG4gICAgICAvLyByZWFsIHRyYW5zYWN0aW9uIG90aGVyd2lzZSwgc28gYSBmYWlsdXJlIHJvbGxzIGJhY2sgb25seSB0aGlzIGF0dGVtcHQuXG4gICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLmluc2VydE11bHRpcGxlKHRhYmxlTmFtZSwgY29sdW1ucywgbm9ybWFsaXplZFJvd3MpXG4gICAgICB9KVxuICAgICAgaWYgKHJldHVyblJlc3VsdHMpIHJldHVybiB7c3VjY2VlZGVkUm93czogbm9ybWFsaXplZFJvd3Muc2xpY2UoKSwgZmFpbGVkUm93czogW10sIGVycm9yczogW119XG4gICAgICByZXR1cm5cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qKlxuICAgICAgICogUmVzdWx0cy5cbiAgICAgICAqIEB0eXBlIHt7c3VjY2VlZGVkUm93czogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W10sIGZhaWxlZFJvd3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdLCBlcnJvcnM6IEFycmF5PHtyb3c6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59fSAqL1xuICAgICAgY29uc3QgcmVzdWx0cyA9IHtcbiAgICAgICAgc3VjY2VlZGVkUm93czogW10sXG4gICAgICAgIGZhaWxlZFJvd3M6IFtdLFxuICAgICAgICBlcnJvcnM6IFtdXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIG5vcm1hbGl6ZWRSb3dzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgLy8gRWFjaCByZXRyeSBydW5zIGluIGl0cyBvd24gc2F2ZXBvaW50IHNvIGEgZmFpbGVkIHJvdyByb2xscyBiYWNrIG9ubHlcbiAgICAgICAgICAvLyB0aGF0IHJvdyBhbmQgbGVhdmVzIHRoZSBzdXJyb3VuZGluZyB0cmFuc2FjdGlvbiB1c2FibGUgZm9yIHRoZSByZXN0LlxuICAgICAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLmluc2VydE11bHRpcGxlKHRhYmxlTmFtZSwgY29sdW1ucywgW3Jvd10pXG4gICAgICAgICAgfSlcbiAgICAgICAgICByZXN1bHRzLnN1Y2NlZWRlZFJvd3MucHVzaChyb3cpXG4gICAgICAgIH0gY2F0Y2ggKHJvd0Vycm9yKSB7XG4gICAgICAgICAgcmVzdWx0cy5mYWlsZWRSb3dzLnB1c2gocm93KVxuICAgICAgICAgIHJlc3VsdHMuZXJyb3JzLnB1c2goe3JvdywgZXJyb3I6IHJvd0Vycm9yfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAocmVzdWx0cy5mYWlsZWRSb3dzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgY29tYmluZWRFcnJvcnMgPSByZXN1bHRzLmVycm9ycy5tYXAoKGVudHJ5LCBpbmRleCkgPT4ge1xuICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlbnRyeS5lcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZW50cnkuZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlbnRyeS5lcnJvcilcbiAgICAgICAgICByZXR1cm4gYFske2luZGV4fV0gJHttZXNzYWdlfS4gUm93OiAke3RoaXMuX3NhZmVTZXJpYWxpemVJbnNlcnRSb3coZW50cnkucm93KX1gXG4gICAgICAgIH0pLmpvaW4oXCIgfCBcIilcbiAgICAgICAgY29uc3QgY29tYmluZWRFcnJvciA9IG5ldyBFcnJvcihgaW5zZXJ0TXVsdGlwbGUgZmFpbGVkIGZvciAke3Jlc3VsdHMuZmFpbGVkUm93cy5sZW5ndGh9IHJvd3MuICR7Y29tYmluZWRFcnJvcnN9YClcblxuICAgICAgICBpZiAocmV0dXJuUmVzdWx0cykgcmV0dXJuIHJlc3VsdHNcbiAgICAgICAgdGhyb3cgY29tYmluZWRFcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAocmV0dXJuUmVzdWx0cykgcmV0dXJuIHJlc3VsdHNcbiAgICAgIHJldHVyblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBpbnNlcnQgbXVsdGlwbGUgcm93cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBhcmdzLmNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEBwYXJhbSB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gYXJncy5yb3dzIC0gUm93cyB0byBpbnNlcnQuXG4gICAqIEByZXR1cm5zIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIE5vcm1hbGl6ZWQgcm93cy5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplSW5zZXJ0TXVsdGlwbGVSb3dzKHtjb2x1bW5zLCByb3dzfSkge1xuICAgIHJldHVybiByb3dzLm1hcCgocm93KSA9PiB7XG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkocm93KSB8fCByb3cubGVuZ3RoICE9PSBjb2x1bW5zLmxlbmd0aCkge1xuICAgICAgICBjb25zdCByb3dMZW5ndGggPSBBcnJheS5pc0FycmF5KHJvdykgPyByb3cubGVuZ3RoIDogXCJub24tYXJyYXlcIlxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgaW5zZXJ0TXVsdGlwbGUgcm93IGxlbmd0aCBtaXNtYXRjaC4gRXhwZWN0ZWQgJHtjb2x1bW5zLmxlbmd0aH0gdmFsdWVzIGJ1dCBnb3QgJHtyb3dMZW5ndGh9LiBSb3c6ICR7SlNPTi5zdHJpbmdpZnkocm93KX1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBub3JtYWxpemVkUm93ID0gW11cblxuICAgICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGNvbHVtbnMubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBjb2x1bW5zW2luZGV4XVxuICAgICAgICBjb25zdCB2YWx1ZSA9IHJvd1tpbmRleF1cblxuICAgICAgICBub3JtYWxpemVkUm93W2luZGV4XSA9IHRoaXMuX25vcm1hbGl6ZUluc2VydFZhbHVlRm9yQ29sdW1uKHtjb2x1bW5OYW1lLCB2YWx1ZX0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBub3JtYWxpemVkUm93XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNhZmUgc2VyaWFsaXplIGluc2VydCByb3cuXG4gICAqIEBwYXJhbSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByb3cgLSBSb3cgdG8gc2VyaWFsaXplLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNhZmUgcm93IHJlcHJlc2VudGF0aW9uLlxuICAgKi9cbiAgc3RhdGljIF9zYWZlU2VyaWFsaXplSW5zZXJ0Um93KHJvdykge1xuICAgIHJldHVybiBmb3JtYXRWYWx1ZShyb3cpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgaW5zZXJ0IHZhbHVlIGZvciBjb2x1bW4uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIENvbHVtbiB2YWx1ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgX25vcm1hbGl6ZUluc2VydFZhbHVlRm9yQ29sdW1uKHtjb2x1bW5OYW1lLCB2YWx1ZX0pIHtcbiAgICBjb25zdCBjb2x1bW4gPSB0aGlzLmdldENvbHVtbnNIYXNoKClbY29sdW1uTmFtZV1cblxuICAgIGlmICghY29sdW1uKSByZXR1cm4gdmFsdWVcblxuICAgIGNvbnN0IGNvbHVtblR5cGUgPSBjb2x1bW4uZ2V0VHlwZSgpXG4gICAgY29uc3Qgbm9ybWFsaXplZFR5cGUgPSB0eXBlb2YgY29sdW1uVHlwZSA9PT0gXCJzdHJpbmdcIiA/IGNvbHVtblR5cGUudG9Mb3dlckNhc2UoKSA6IHVuZGVmaW5lZFxuICAgIGxldCBub3JtYWxpemVkVmFsdWUgPSB2YWx1ZVxuXG4gICAgaWYgKG5vcm1hbGl6ZWRUeXBlICYmIHRoaXMuX2lzRGF0ZUxpa2VUeXBlKG5vcm1hbGl6ZWRUeXBlKSkge1xuICAgICAgbm9ybWFsaXplZFZhbHVlID0gdGhpcy5fbm9ybWFsaXplRGF0ZVZhbHVlRm9ySW5zZXJ0KG5vcm1hbGl6ZWRWYWx1ZSlcbiAgICB9XG5cbiAgICBub3JtYWxpemVkVmFsdWUgPSB0aGlzLl9ub3JtYWxpemVTcWxpdGVCb29sZWFuVmFsdWVGb3JJbnNlcnQoe2NvbHVtblR5cGUsIHZhbHVlOiBub3JtYWxpemVkVmFsdWV9KVxuXG4gICAgaWYgKG5vcm1hbGl6ZWRWYWx1ZSA9PT0gXCJcIiAmJiBjb2x1bW4uZ2V0TnVsbCgpICYmICF0aGlzLl9pc1N0cmluZ1R5cGUobm9ybWFsaXplZFR5cGUpKSB7XG4gICAgICBub3JtYWxpemVkVmFsdWUgPSBudWxsXG4gICAgfVxuXG4gICAgaWYgKG5vcm1hbGl6ZWRUeXBlICYmIHRoaXMuX2lzTnVtZXJpY1R5cGUobm9ybWFsaXplZFR5cGUpKSB7XG4gICAgICBub3JtYWxpemVkVmFsdWUgPSB0aGlzLl9ub3JtYWxpemVOdW1lcmljVmFsdWUoe2NvbHVtblR5cGU6IG5vcm1hbGl6ZWRUeXBlLCB2YWx1ZTogbm9ybWFsaXplZFZhbHVlfSlcbiAgICB9XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBzdHJpbmcgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBzdHJpbmctbGlrZSB0eXBlLlxuICAgKi9cbiAgc3RhdGljIF9pc1N0cmluZ1R5cGUoY29sdW1uVHlwZSkge1xuICAgIGlmICghY29sdW1uVHlwZSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBzdHJpbmdUeXBlcyA9IG5ldyBTZXQoW1wiY2hhclwiLCBcInZhcmNoYXJcIiwgXCJudmFyY2hhclwiLCBcInN0cmluZ1wiLCBcImVudW1cIiwgXCJqc29uXCIsIFwianNvbmJcIiwgXCJjaXRleHRcIiwgXCJiaW5hcnlcIiwgXCJ2YXJiaW5hcnlcIl0pXG5cbiAgICByZXR1cm4gY29sdW1uVHlwZS5pbmNsdWRlcyhcInV1aWRcIikgfHxcbiAgICAgIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJ0ZXh0XCIpIHx8XG4gICAgICBzdHJpbmdUeXBlcy5oYXMoY29sdW1uVHlwZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIG51bWVyaWMgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBudW1lcmljLWxpa2UgdHlwZS5cbiAgICovXG4gIHN0YXRpYyBfaXNOdW1lcmljVHlwZShjb2x1bW5UeXBlKSB7XG4gICAgcmV0dXJuIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJpbnRcIikgfHxcbiAgICAgIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJkZWNpbWFsXCIpIHx8XG4gICAgICBjb2x1bW5UeXBlLmluY2x1ZGVzKFwibnVtZXJpY1wiKSB8fFxuICAgICAgY29sdW1uVHlwZS5pbmNsdWRlcyhcImZsb2F0XCIpIHx8XG4gICAgICBjb2x1bW5UeXBlLmluY2x1ZGVzKFwiZG91YmxlXCIpIHx8XG4gICAgICBjb2x1bW5UeXBlLmluY2x1ZGVzKFwicmVhbFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIG51bWVyaWMgdmFsdWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgX25vcm1hbGl6ZU51bWVyaWNWYWx1ZSh7Y29sdW1uVHlwZSwgdmFsdWV9KSB7XG4gICAgaWYgKHZhbHVlID09PSBcIlwiIHx8IHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB2YWx1ZVxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiB2YWx1ZVxuXG4gICAgaWYgKGNvbHVtblR5cGUuaW5jbHVkZXMoXCJkZWNpbWFsXCIpIHx8IGNvbHVtblR5cGUuaW5jbHVkZXMoXCJudW1lcmljXCIpKSB7XG4gICAgICByZXR1cm4gdmFsdWVcbiAgICB9XG5cbiAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShwYXJzZWQpKSByZXR1cm4gdmFsdWVcblxuICAgIGlmIChjb2x1bW5UeXBlLmluY2x1ZGVzKFwiaW50XCIpKSB7XG4gICAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKHBhcnNlZCkpIHJldHVybiB2YWx1ZVxuICAgICAgaWYgKCEvXi0/XFxkKyQvLnRlc3QodmFsdWUpKSByZXR1cm4gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gcGFyc2VkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZGF0ZSB2YWx1ZSBmb3IgaW5zZXJ0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgX25vcm1hbGl6ZURhdGVWYWx1ZUZvckluc2VydCh2YWx1ZSkge1xuICAgIHJldHVybiBub3JtYWxpemVEYXRlVmFsdWVGb3JXcml0ZSh2YWx1ZSwge3RpbWVab25lOiB0aGlzLl90aW1lWm9uZUZvckRhdGVXcml0ZSgpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBkYXRlIHN0cmluZyBmb3IgaW5zZXJ0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBEYXRlIHN0cmluZyB2YWx1ZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IERhdGV9IC0gUGFyc2VkIGRhdGUgb3Igb3JpZ2luYWwgc3RyaW5nLlxuICAgKi9cbiAgc3RhdGljIF9ub3JtYWxpemVEYXRlU3RyaW5nRm9ySW5zZXJ0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZURhdGVTdHJpbmdGb3JXcml0ZSh2YWx1ZSwge3RpbWVab25lOiB0aGlzLl90aW1lWm9uZUZvckRhdGVXcml0ZSgpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRpbWUgem9uZSBmb3IgZGF0ZSB3cml0ZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gQWN0aXZlIHRpbWV6b25lIGlkZW50aWZpZXIuXG4gICAqL1xuICBzdGF0aWMgX3RpbWVab25lRm9yRGF0ZVdyaXRlKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKClcblxuICAgIHJldHVybiBjb25maWd1cmF0aW9uLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldFRpbWVab25lKGNvbmZpZ3VyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgc3FsaXRlIGJvb2xlYW4gdmFsdWUgZm9yIGluc2VydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGFyZ3MuY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplU3FsaXRlQm9vbGVhblZhbHVlRm9ySW5zZXJ0KHtjb2x1bW5UeXBlLCB2YWx1ZX0pIHtcbiAgICBpZiAodGhpcy5nZXREYXRhYmFzZVR5cGUoKSAhPSBcInNxbGl0ZVwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAoIWNvbHVtblR5cGUpIHJldHVybiB2YWx1ZVxuICAgIGlmIChjb2x1bW5UeXBlLnRvTG93ZXJDYXNlKCkgIT09IFwiYm9vbGVhblwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiAxXG4gICAgaWYgKHZhbHVlID09PSBmYWxzZSkgcmV0dXJuIDBcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV4dCBwcmltYXJ5IGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBuZXh0IHByaW1hcnkga2V5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIG5leHRQcmltYXJ5S2V5KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMucHJpbWFyeUtleSgpXG4gICAgY29uc3QgdGFibGVOYW1lID0gdGhpcy50YWJsZU5hbWUoKVxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb24oKVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9Lm5leHRQcmltYXJ5S2V5KCkgZG9lcyBub3Qgc3VwcG9ydCBjb21wb3NpdGUgcHJpbWFyeSBrZXlzLmApXG5cbiAgICBjb25zdCBuZXdlc3RSZWNvcmQgPSBhd2FpdCB0aGlzLm9yZGVyKGAke2Nvbm5lY3Rpb24ucXVvdGVUYWJsZSh0YWJsZU5hbWUpfS4ke2Nvbm5lY3Rpb24ucXVvdGVDb2x1bW4ocHJpbWFyeUtleSl9YCkubGFzdCgpXG5cbiAgICBpZiAobmV3ZXN0UmVjb3JkKSB7XG4gICAgICBjb25zdCBpZCA9IG5ld2VzdFJlY29yZC5pZCgpXG5cbiAgICAgIGlmICh0eXBlb2YgaWQgPT0gXCJudW1iZXJcIikge1xuICAgICAgICByZXR1cm4gaWQgKyAxXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJRCBmcm9tIG5ld2VzdCByZWNvcmQgd2Fzbid0IGEgbnVtYmVyXCIpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiAxXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHByaW1hcnkga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHN0cmluZ1tdIHwgbnVsbH0gcHJpbWFyeUtleSAtIFByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2V0UHJpbWFyeUtleShwcmltYXJ5S2V5KSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHtcbiAgICAgIGlmIChwcmltYXJ5S2V5Lmxlbmd0aCA9PT0gMCkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNvbXBvc2l0ZSBwcmltYXJ5IGtleXMgcmVxdWlyZSBhdCBsZWFzdCBvbmUgY29sdW1uLlwiKVxuXG4gICAgICBjb25zdCBzZWVuQ29sdW1ucyA9IG5ldyBTZXQoKVxuXG4gICAgICBmb3IgKGNvbnN0IGNvbHVtbk5hbWUgb2YgcHJpbWFyeUtleSkge1xuICAgICAgICBpZiAoc2VlbkNvbHVtbnMuaGFzKGNvbHVtbk5hbWUpKSB0aHJvdyBuZXcgVHlwZUVycm9yKGBDb21wb3NpdGUgcHJpbWFyeSBrZXkgaGFzIGR1cGxpY2F0ZSBjb2x1bW46ICR7Y29sdW1uTmFtZX0uYClcblxuICAgICAgICBzZWVuQ29sdW1ucy5hZGQoY29sdW1uTmFtZSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5fcHJpbWFyeUtleSA9IFsuLi5wcmltYXJ5S2V5XVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fcHJpbWFyeUtleSA9IHByaW1hcnlLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoaXMgY2xhc3MncyBvd24gYXR0cmlidXRlLWNhc3QgbWFwLCBjcmVhdGluZyBpdCBvbiB0aGUgY2xhc3MgaXRzZWxmXG4gICAqIChuZXZlciBpbmhlcml0ZWQgZnJvbSBhIHBhcmVudCkgc28gc3ViY2xhc3NlcyBkb24ndCBzaGFyZSB0aGUgc2FtZSBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIERlY2xhcmVkIGNhc3RzIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dHJpYnV0ZUNhc3RzTWFwKCkge1xuICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsIFwiX2F0dHJpYnV0ZUNhc3RzXCIpIHx8ICF0aGlzLl9hdHRyaWJ1dGVDYXN0cykge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICAgIHRoaXMuX2F0dHJpYnV0ZUNhc3RzID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0cmlidXRlQ2FzdHNcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhIFJhaWxzLXN0eWxlIHBlci1hdHRyaWJ1dGUgY2FzdCBzbyBhIGNvbHVtbiB3aG9zZSBpbnRyb3NwZWN0ZWQgdHlwZVxuICAgKiBpc24ndCB3aGF0IHRoZSBhcHAgd2FudHMgKGUuZy4gYW4gTVNTUUwgYGJpdGAgbWFwcGVkIHRvIGBudW1iZXJgKSBjYW4gYmVcbiAgICogZXhwb3NlZCBhcyBhbm90aGVyIHR5cGUgd2l0aCByZWFsIHJ1bnRpbWUgY29udmVyc2lvbi4gQ3VycmVudGx5IGZ1bGx5XG4gICAqIGltcGxlbWVudHMgdGhlIGBcImJvb2xlYW5cImAgY2FzdCAoMC8xIDwtPiBmYWxzZS90cnVlKTsgb3RoZXIgdHlwZXMgb25seSByZWNvcmRcbiAgICogdGhlIGxhYmVsIHNvIHRoZSBlZmZlY3RpdmUgdHlwZSBhbmQgZ2VuZXJhdGVkIHR5cGluZ3MgcmVmbGVjdCB0aGVtLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lIChjYW1lbENhc2UpLCBlLmcuIGBcInNpY2h0YmFyVlZLXCJgLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIERlY2xhcmVkIHR5cGUsIGUuZy4gYFwiYm9vbGVhblwiYC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lLCB0eXBlKSB7XG4gICAgdGhpcy5nZXRBdHRyaWJ1dGVDYXN0c01hcCgpW2F0dHJpYnV0ZU5hbWVdID0gdHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGRlY2xhcmVkIGNhc3QgdHlwZSBmb3IgYW4gYXR0cmlidXRlLCBpZiBhbnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUgKGNhbWVsQ2FzZSkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gRGVjbGFyZWQgY2FzdCB0eXBlLCBvciB1bmRlZmluZWQgd2hlbiBub25lIGlzIGRlY2xhcmVkLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dHJpYnV0ZUNhc3QoYXR0cmlidXRlTmFtZSkge1xuICAgIHJldHVybiB0aGlzLmdldEF0dHJpYnV0ZUNhc3RzTWFwKClbYXR0cmlidXRlTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgc3RyaW5nW119IC0gVGhlIHByaW1hcnkga2V5LlxuICAgKi9cbiAgc3RhdGljIHByaW1hcnlLZXkoKSB7XG4gICAgaWYgKHRoaXMuX3ByaW1hcnlLZXkpIHJldHVybiB0aGlzLl9wcmltYXJ5S2V5XG5cbiAgICByZXR1cm4gXCJpZFwiXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgbW9kZWwgaGFzIGEgc2luZ2xlIHByaW1hcnkga2V5IGNvbHVtbi4gYHNldFByaW1hcnlLZXkobnVsbClgIChlLmcuIGNvbXBvc2l0ZS1rZXlcbiAgICogbGVnYWN5IHRhYmxlcykgZGVjbGFyZXMgbm8gc2luZ2xlIHByaW1hcnkga2V5OyBgcHJpbWFyeUtleSgpYCBzdGlsbCBmYWxscyBiYWNrIHRvIFwiaWRcIiBmb3IgdGhlXG4gICAqIGRlZmF1bHQgY2FzZSwgc28gY2FsbGVycyB0aGF0IG11c3QgZGlzdGluZ3Vpc2ggXCJubyBwcmltYXJ5IGtleVwiIHVzZSB0aGlzIGluc3RlYWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIEZhbHNlIG9ubHkgd2hlbiB0aGUgcHJpbWFyeSBrZXkgd2FzIGV4cGxpY2l0bHkgc2V0IHRvIG51bGwuXG4gICAqL1xuICBzdGF0aWMgaGFzUHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gdGhpcy5fcHJpbWFyeUtleSAhPT0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2F2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHNhdmUoKSB7XG4gICAgY29uc3QgaXNOZXdSZWNvcmQgPSB0aGlzLmlzTmV3UmVjb3JkKClcbiAgICBsZXQgcmVzdWx0XG5cbiAgICBjb25zdCBzYXZlID0gYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYmVmb3JlVmFsaWRhdGlvblwiKVxuICAgICAgYXdhaXQgdGhpcy5fcnVuVmFsaWRhdGlvbnMoKVxuXG4gICAgICBjb25zdCBzYXZlSW5UcmFuc2FjdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYmVmb3JlU2F2ZVwiKVxuXG4gICAgICAgIC8vIElmIGFueSBiZWxvbmdzLXRvLXJlbGF0aW9uc2hpcHMgd2FzIHNhdmVkLCB0aGVuIHVwZGF0ZWQtYXQgc2hvdWxkIHN0aWxsIGJlIHNldCBvbiB0aGlzIHJlY29yZC5cbiAgICAgICAgY29uc3Qge3NhdmVkQ291bnR9ID0gYXdhaXQgdGhpcy5fYXV0b1NhdmVCZWxvbmdzVG9SZWxhdGlvbnNoaXBzKClcblxuICAgICAgICBpZiAodGhpcy5pc1BlcnNpc3RlZCgpKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYmVmb3JlVXBkYXRlXCIpXG5cbiAgICAgICAgICAvLyBJZiBhbnkgaGFzLW1hbnktcmVsYXRpb25zaGlwcyB3aWxsIGJlIHNhdmVkLCB0aGVuIHVwZGF0ZWQtYXQgc2hvdWxkIHN0aWxsIGJlIHNldCBvbiB0aGlzIHJlY29yZC5cbiAgICAgICAgICBjb25zdCBhdXRvU2F2ZUhhc01hbnlyZWxhdGlvbnNoaXBzID0gdGhpcy5fYXV0b1NhdmVIYXNNYW55QW5kSGFzT25lUmVsYXRpb25zaGlwc1RvU2F2ZSgpXG5cbiAgICAgICAgICBpZiAodGhpcy5faGFzQ2hhbmdlcygpIHx8IHNhdmVkQ291bnQgPiAwIHx8IGF1dG9TYXZlSGFzTWFueXJlbGF0aW9uc2hpcHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5fdXBkYXRlUmVjb3JkV2l0aENoYW5nZXMoKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImFmdGVyVXBkYXRlXCIpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYmVmb3JlQ3JlYXRlXCIpXG4gICAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5fY3JlYXRlTmV3UmVjb3JkKClcbiAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJhZnRlckNyZWF0ZVwiKVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5fYXV0b1NhdmVIYXNNYW55QW5kSGFzT25lUmVsYXRpb25zaGlwcyh7aXNOZXdSZWNvcmR9KVxuICAgICAgICBhd2FpdCB0aGlzLl9hdXRvU2F2ZUF0dGFjaG1lbnRzKClcbiAgICAgICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYWZ0ZXJTYXZlXCIpXG4gICAgICAgIGF3YWl0IHRoaXMuX2VtaXRSZWNvcmRDaGFuZ2VBZnRlckNvbW1pdChpc05ld1JlY29yZCA/IFwiY3JlYXRlXCIgOiBcInVwZGF0ZVwiKVxuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24pIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24udHJhbnNhY3Rpb24oc2F2ZUluVHJhbnNhY3Rpb24pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCB0aGlzLmdldE1vZGVsQ2xhc3MoKS50cmFuc2FjdGlvbihzYXZlSW5UcmFuc2FjdGlvbilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24pIHtcbiAgICAgIGF3YWl0IHNhdmUoKVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IGAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9IHNhdmVgfSwgc2F2ZSlcbiAgICB9XG5cbiAgICB0aGlzLl9hc3NpZ25lZEF0dHJpYnV0ZU5hbWVzID0gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICBhc3luYyBfYXV0b1NhdmVCZWxvbmdzVG9SZWxhdGlvbnNoaXBzKCkge1xuICAgIGxldCBzYXZlZENvdW50ID0gMFxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIGluIHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcykge1xuICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSAhPSBcImJlbG9uZ3NUb1wiKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRBdXRvU2F2ZSgpID09PSBmYWxzZSkge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBtb2RlbCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKClcblxuICAgICAgaWYgKG1vZGVsKSB7XG4gICAgICAgIGlmIChtb2RlbCBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSB7XG4gICAgICAgICAgaWYgKG1vZGVsLmlzQ2hhbmdlZCgpKSB7XG4gICAgICAgICAgICB0aGlzLmJpbmRSZWxhdGVkUmVjb3JkKG1vZGVsKVxuICAgICAgICAgICAgYXdhaXQgbW9kZWwuc2F2ZSgpXG5cbiAgICAgICAgICAgIGNvbnN0IGZvcmVpZ25LZXkgPSB0aGlzLl9yZWxhdGlvbnNoaXBGb3JlaWduS2V5QXR0cmlidXRlKGluc3RhbmNlUmVsYXRpb25zaGlwKVxuICAgICAgICAgICAgY29uc3QgZm9yZWlnbktleVZhbHVlID0gdGhpcy5fYmVsb25nc1RvRm9yZWlnbktleVZhbHVlKHttb2RlbCwgcmVsYXRpb25zaGlwOiBpbnN0YW5jZVJlbGF0aW9uc2hpcH0pXG5cbiAgICAgICAgICAgIHRoaXMuc2V0QXR0cmlidXRlKGZvcmVpZ25LZXksIGZvcmVpZ25LZXlWYWx1ZSlcblxuICAgICAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0UHJlbG9hZGVkKHRydWUpXG4gICAgICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcC5zZXREaXJ0eShmYWxzZSlcblxuICAgICAgICAgICAgc2F2ZWRDb3VudCsrXG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYSByZWNvcmQgYnV0IGdvdDogJHt0eXBlb2YgbW9kZWx9YClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7c2F2ZWRDb3VudH1cbiAgfVxuXG4gIF9hdXRvU2F2ZUhhc01hbnlBbmRIYXNPbmVSZWxhdGlvbnNoaXBzVG9TYXZlKCkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIGluIHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcykge1xuICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSAhPSBcImhhc01hbnlcIiAmJiBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT0gXCJoYXNPbmVcIikge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0QXV0b1NhdmUoKSA9PT0gZmFsc2UpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLyoqXG4gICAgICAgKiBEZWZpbmVzIGxvYWRlZC5cbiAgICAgICAqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZFtdfSAqL1xuICAgICAgbGV0IGxvYWRlZFxuXG4gICAgICBjb25zdCBoYXNNYW55T3JPbmVMb2FkZWQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG5cbiAgICAgIGlmIChoYXNNYW55T3JPbmVMb2FkZWQpIHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoaGFzTWFueU9yT25lTG9hZGVkKSkge1xuICAgICAgICAgIGxvYWRlZCA9IGhhc01hbnlPck9uZUxvYWRlZFxuICAgICAgICB9IGVsc2UgaWYgKGhhc01hbnlPck9uZUxvYWRlZCBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSB7XG4gICAgICAgICAgbG9hZGVkID0gW2hhc01hbnlPck9uZUxvYWRlZF1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGhhc09uZUxvYWRlZCB0byBiZSBhIHJlY29yZCBidXQgaXQgd2Fzbid0OiAke3R5cGVvZiBoYXNNYW55T3JPbmVMb2FkZWR9YClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgbGV0IHVzZVJlbGF0aW9uc2hpcCA9IGZhbHNlXG5cbiAgICAgIGlmIChsb2FkZWQpIHtcbiAgICAgICAgZm9yIChjb25zdCBtb2RlbCBvZiBsb2FkZWQpIHtcbiAgICAgICAgICB0aGlzLmJpbmRSZWxhdGVkUmVjb3JkKG1vZGVsKVxuICAgICAgICAgIGNvbnN0IGZvcmVpZ25LZXkgPSBtb2RlbC5fcmVsYXRpb25zaGlwRm9yZWlnbktleUF0dHJpYnV0ZShpbnN0YW5jZVJlbGF0aW9uc2hpcClcblxuICAgICAgICAgIG1vZGVsLnNldEF0dHJpYnV0ZShmb3JlaWduS2V5LCBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZSh0aGlzLmlkKCksIGBIYXMtbWFueSBhdXRvc2F2ZSBmb3IgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfWApKVxuXG4gICAgICAgICAgaWYgKG1vZGVsLmlzQ2hhbmdlZCgpKSB7XG4gICAgICAgICAgICB1c2VSZWxhdGlvbnNoaXAgPSB0cnVlXG4gICAgICAgICAgICBjb250aW51ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAodXNlUmVsYXRpb25zaGlwKSByZWxhdGlvbnNoaXBzLnB1c2goaW5zdGFuY2VSZWxhdGlvbnNoaXApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlbGF0aW9uc2hpcHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHJlbGF0aW9uc2hpcCBmb3JlaWduLWtleSBjb2x1bW4gdG8gdGhpcyBtb2RlbCdzIHB1YmxpYyBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCwgdHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPn0gaW5zdGFuY2VSZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IEF0dHJpYnV0ZSBuYW1lIGFjY2VwdGVkIGJ5IHNldEF0dHJpYnV0ZS9hc3NpZ24uXG4gICAqL1xuICBfcmVsYXRpb25zaGlwRm9yZWlnbktleUF0dHJpYnV0ZShpbnN0YW5jZVJlbGF0aW9uc2hpcCkge1xuICAgIGNvbnN0IGZvcmVpZ25LZXkgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcblxuICAgIHJldHVybiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbZm9yZWlnbktleV0gfHwgZm9yZWlnbktleVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXV0byBzYXZlIGhhcyBtYW55IGFuZCBoYXMgb25lIHJlbGF0aW9uc2hpcHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5pc05ld1JlY29yZCAtIFdoZXRoZXIgaXMgbmV3IHJlY29yZC5cbiAgICovXG4gIGFzeW5jIF9hdXRvU2F2ZUhhc01hbnlBbmRIYXNPbmVSZWxhdGlvbnNoaXBzKHtpc05ld1JlY29yZH0pIHtcbiAgICBmb3IgKGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwIG9mIHRoaXMuX2F1dG9TYXZlSGFzTWFueUFuZEhhc09uZVJlbGF0aW9uc2hpcHNUb1NhdmUoKSkge1xuICAgICAgbGV0IGhhc01hbnlPck9uZUxvYWRlZCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKClcblxuICAgICAgLyoqXG4gICAgICAgKiBEZWZpbmVzIGxvYWRlZC5cbiAgICAgICAqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZFtdfSAqL1xuICAgICAgbGV0IGxvYWRlZFxuXG4gICAgICBpZiAoaGFzTWFueU9yT25lTG9hZGVkID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgbG9hZGVkID0gW11cbiAgICAgIH0gZWxzZSBpZiAoaGFzTWFueU9yT25lTG9hZGVkIGluc3RhbmNlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQpIHtcbiAgICAgICAgbG9hZGVkID0gW2hhc01hbnlPck9uZUxvYWRlZF1cbiAgICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShoYXNNYW55T3JPbmVMb2FkZWQpKSB7XG4gICAgICAgIGxvYWRlZCA9IGhhc01hbnlPck9uZUxvYWRlZFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIHR5cGUgZm9yIGhhc01hbnlPck9uZUxvYWRlZDogJHt0eXBlb2YgaGFzTWFueU9yT25lTG9hZGVkfWApXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbG9hZGVkKSB7XG4gICAgICAgIHRoaXMuYmluZFJlbGF0ZWRSZWNvcmQobW9kZWwpXG4gICAgICAgIGNvbnN0IGZvcmVpZ25LZXkgPSBtb2RlbC5fcmVsYXRpb25zaGlwRm9yZWlnbktleUF0dHJpYnV0ZShpbnN0YW5jZVJlbGF0aW9uc2hpcClcblxuICAgICAgICBtb2RlbC5zZXRBdHRyaWJ1dGUoZm9yZWlnbktleSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUodGhpcy5pZCgpLCBgSGFzLW1hbnkgYXV0b3NhdmUgZm9yICR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX1gKSlcblxuICAgICAgICBpZiAobW9kZWwuaXNDaGFuZ2VkKCkpIHtcbiAgICAgICAgICBhd2FpdCBtb2RlbC5zYXZlKClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoaXNOZXdSZWNvcmQpIHtcbiAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0UHJlbG9hZGVkKHRydWUpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXV0byBzYXZlIGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHBlbmRpbmcgYXR0YWNobWVudHMgaGF2ZSBiZWVuIHNhdmVkLlxuICAgKi9cbiAgYXN5bmMgX2F1dG9TYXZlQXR0YWNobWVudHMoKSB7XG4gICAgZm9yIChjb25zdCBhdHRhY2htZW50TmFtZSBpbiB0aGlzLl9hdHRhY2htZW50cykge1xuICAgICAgY29uc3QgYXR0YWNobWVudCA9IHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXVxuXG4gICAgICBpZiAoIWF0dGFjaG1lbnQuaGFzUGVuZGluZ0F0dGFjaG1lbnRzKCkpIGNvbnRpbnVlXG5cbiAgICAgIGF3YWl0IGF0dGFjaG1lbnQuZmx1c2hQZW5kaW5nQXR0YWNobWVudHMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHRhYmxlIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgdGFibGVOYW1lKCkge1xuICAgIGlmICghdGhpcy5fdGFibGVOYW1lKSB0aGlzLl90YWJsZU5hbWUgPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUoaW5mbGVjdGlvbi5wbHVyYWxpemUodGhpcy5nZXRNb2RlbE5hbWUoKSkpXG5cbiAgICByZXR1cm4gdGhpcy5fdGFibGVOYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzZXRUYWJsZU5hbWUodGFibGVOYW1lKSB7XG4gICAgdGhpcy5fdGFibGVOYW1lID0gdGFibGVOYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdHJhbnNhY3Rpb24uXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgdHJhbnNhY3Rpb24oY2FsbGJhY2spIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIGNvbnN0IHVzZVRyYW5zYWN0aW9ucyA9IHRoaXMuY29ubmVjdGlvbigpLmdldEFyZ3MoKS5yZWNvcmQ/LnRyYW5zYWN0aW9uc1xuXG4gICAgaWYgKHVzZVRyYW5zYWN0aW9ucyAhPT0gZmFsc2UpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS50cmFuc2FjdGlvbihjYWxsYmFjaylcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgY2FsbGJhY2sgd2hpbGUgaG9sZGluZyBhIG5hbWVkIGFkdmlzb3J5IGxvY2suIENhbGxzIHdpdGhvdXRcbiAgICogQnkgZGVmYXVsdCBjYWxscyB1c2UgdGhlIGNhbGxlciBjb25uZWN0aW9uLiBDYWxscyB3aXRoIGBkZWRpY2F0ZWRDb25uZWN0aW9uYFxuICAgKiB1c2UgYSBzcGF3bmVkIGxvY2sgY29ubmVjdGlvbiB0aGF0IGlzIHJlbGVhc2VkIGFmdGVyIHRoZSBjYWxsYmFjayBmaW5pc2hlcyxcbiAgICogd2hpbGUgdGhlIGNhbGxiYWNrIGl0c2VsZiBzdGlsbCBydW5zIGFnYWluc3QgdGhlIGNhbGxlci9tb2RlbCBjb25uZWN0aW9uLlxuICAgKiBDYWxscyB3aXRoIGEgcG9zaXRpdmUgYGhvbGRUaW1lb3V0TXNgIHVzZSBhIGRlZGljYXRlZCBsb2NrIGNvbm5lY3Rpb24gc29cbiAgICogdGltZW91dCBjbGVhbnVwIGNhbiByZWxlYXNlIHRoZSBsb2NrIGV2ZW4gd2hlbiBjYWxsYmFjayBkYXRhYmFzZSB3b3JrIGlzXG4gICAqIHN0dWNrLiBBZHZpc29yeSBsb2NrcyBhcmUgY29vcGVyYXRpdmUgYW5kIHNlc3Npb24tc2NvcGVkOiB0aGV5IHNlcmlhbGl6ZVxuICAgKiBjYWxsZXJzIHRoYXQgb3B0IGludG8gdGhlIHNhbWUgYG5hbWVgLCB3aXRob3V0IHRvdWNoaW5nIHJvdyBvciB0YWJsZSBsb2NrcyxcbiAgICogc28gdW5yZWxhdGVkIHRyYWZmaWMgaXMgZnJlZSB0byBwcm9jZWVkLlxuICAgKlxuICAgKiBUaGUgbG9jayBpcyBhY3F1aXJlZCBiZWZvcmUgdGhlIGNhbGxiYWNrIHJ1bnMgYW5kIHJlbGVhc2VkIGluIGFcbiAgICogYGZpbmFsbHlgIGJsb2NrIGFmdGVyd2FyZHMsIHNvIHRoZSBjYWxsYmFjaydzIHJldHVybiB2YWx1ZSBpc1xuICAgKiBwcm9wYWdhdGVkIGFuZCB0aHJvd24gZXJyb3JzIHN0aWxsIHJlbGVhc2UgdGhlIGxvY2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gaW52b2tlIHdoaWxlIHRoZSBsb2NrIGlzIGhlbGQuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGwsIGhvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBkZWRpY2F0ZWRDb25uZWN0aW9uPzogYm9vbGVhbn19IFthcmdzXSAtIGB0aW1lb3V0TXNgIGNhcHMgaG93IGxvbmcgd2Ugd2FpdCB0byBhY3F1aXJlIHRoZSBsb2NrOyBgaG9sZFRpbWVvdXRNc2AgY2FwcyBob3cgbG9uZyB0aGUgY2FsbGJhY2sgbWF5IGhvbGQgaXQgYmVmb3JlIHRoZSBsb2NrIGlzIHJlbGVhc2VkIGFuZCBgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcmAgaXMgdGhyb3duOyBgZGVkaWNhdGVkQ29ubmVjdGlvbmAgc3Bhd25zIGEgc2VwYXJhdGUgbG9jayBzZXNzaW9uIHdpdGhvdXQgZW5hYmxpbmcgYSBob2xkIHRpbWVvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrJ3MgcmV0dXJuIHZhbHVlLlxuICAgKiBAdGhyb3dzIHtBZHZpc29yeUxvY2tUaW1lb3V0RXJyb3J9IC0gSWYgYHRpbWVvdXRNc2AgZWxhcHNlcyBiZWZvcmUgdGhlIGxvY2sgaXMgZ3JhbnRlZC5cbiAgICogQHRocm93cyB7QWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcn0gLSBJZiBgaG9sZFRpbWVvdXRNc2AgZWxhcHNlcyB3aGlsZSB0aGUgY2FsbGJhY2sgaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgd2l0aEFkdmlzb3J5TG9jayhuYW1lLCBjYWxsYmFjaywgYXJncyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCBydW5uZXIgPSBuZXcgQWR2aXNvcnlMb2NrUnVubmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgIGNvbm5lY3Rpb25Qcm92aWRlcjogKCkgPT4gdGhpcy5jb25uZWN0aW9uKCksXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICB9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1bm5lci53aXRoQWR2aXNvcnlMb2NrKG5hbWUsIGNhbGxiYWNrLCBhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIGNhbGxiYWNrIG9ubHkgaWYgdGhlIG5hbWVkIGFkdmlzb3J5IGxvY2sgY2FuIGJlIGFjcXVpcmVkXG4gICAqIGltbWVkaWF0ZWx5LiBJZiB0aGUgbG9jayBpcyBhbHJlYWR5IGhlbGQgYnkgYW55IHNlc3Npb24sIHRocm93c1xuICAgKiBgQWR2aXNvcnlMb2NrQnVzeUVycm9yYCB3aXRob3V0IHdhaXRpbmcuXG4gICAqIFVzZSB0aGlzIHdoZW4gY29udGVudGlvbiBpcyBhIHNpZ25hbCB0aGF0IHNvbWVib2R5IGVsc2UgaXMgYWxyZWFkeVxuICAgKiBkb2luZyB0aGUgd29yayBhbmQgeW91IHdhbnQgdG8gYmFpbCBvdXQgcmF0aGVyIHRoYW4gcXVldWUgdXAuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gaW52b2tlIHdoaWxlIHRoZSBsb2NrIGlzIGhlbGQuXG4gICAqIEBwYXJhbSB7e2hvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBkZWRpY2F0ZWRDb25uZWN0aW9uPzogYm9vbGVhbn19IFthcmdzXSAtIGBob2xkVGltZW91dE1zYCBjYXBzIGhvdyBsb25nIHRoZSBjYWxsYmFjayBtYXkgaG9sZCB0aGUgbG9jayBiZWZvcmUgaXQgaXMgcmVsZWFzZWQgYW5kIGBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yYCBpcyB0aHJvd247IGBkZWRpY2F0ZWRDb25uZWN0aW9uYCBzcGF3bnMgYSBzZXBhcmF0ZSBsb2NrIHNlc3Npb24gd2l0aG91dCBlbmFibGluZyBhIGhvbGQgdGltZW91dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sncyByZXR1cm4gdmFsdWUuXG4gICAqIEB0aHJvd3Mge0Fkdmlzb3J5TG9ja0J1c3lFcnJvcn0gLSBJZiB0aGUgbG9jayBpcyBhbHJlYWR5IGhlbGQuXG4gICAqIEB0aHJvd3Mge0Fkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3J9IC0gSWYgYGhvbGRUaW1lb3V0TXNgIGVsYXBzZXMgd2hpbGUgdGhlIGNhbGxiYWNrIGhvbGRzIHRoZSBsb2NrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHdpdGhBZHZpc29yeUxvY2tPckZhaWwobmFtZSwgY2FsbGJhY2ssIGFyZ3MgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcnVubmVyID0gbmV3IEFkdmlzb3J5TG9ja1J1bm5lcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICBjb25uZWN0aW9uUHJvdmlkZXI6ICgpID0+IHRoaXMuY29ubmVjdGlvbigpLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgfSlcblxuICAgIHJldHVybiBhd2FpdCBydW5uZXIud2l0aEFkdmlzb3J5TG9ja09yRmFpbChuYW1lLCBjYWxsYmFjaywgYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGBjYWxsYmFja2AsIHJlamVjdGluZyB3aXRoIGBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yYCBpZiBpdCBoYXNcbiAgICogbm90IHNldHRsZWQgd2l0aGluIGBob2xkVGltZW91dE1zYC4gVGhlIGNhbGxiYWNrIGlzIG5vdCBjYW5jZWxsZWQg4oCUIHRoaXMgaXNcbiAgICogYSBzYWZldHkgbmV0LCBub3QgY2FuY2VsbGF0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZSAoZm9yIHRoZSBlcnJvciBtZXNzYWdlKS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGhvbGRpbmcgdGhlIGxvY2suXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2hvbGRUaW1lb3V0TXNdIC0gTWF4IGhvbGQgdGltZTsgZmFsc3kgZGlzYWJsZXMgdGhlIHRpbWVvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdCBhZnRlciB0aGUgbG9jay1wcm90ZWN0ZWQgb3BlcmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJ1bldpdGhBZHZpc29yeUxvY2tIb2xkVGltZW91dChuYW1lLCBjYWxsYmFjaywgaG9sZFRpbWVvdXRNcykge1xuICAgIHJldHVybiBhd2FpdCBBZHZpc29yeUxvY2tSdW5uZXIucnVuV2l0aEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0KG5hbWUsIGNhbGxiYWNrLCBob2xkVGltZW91dE1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdHJ1ZSBpZiB0aGUgbmFtZWQgYWR2aXNvcnkgbG9jayBpcyBjdXJyZW50bHkgaGVsZCBieSBhbnlcbiAgICogc2Vzc2lvbi4gUHJpbWFyaWx5IHVzZWZ1bCBhcyBhIGRpYWdub3N0aWM7IGNhbGxlcnMgdGhhdCB3YW50IHRvIGFjdFxuICAgKiBvbiB0aGUgcmVzdWx0IHNob3VsZCBwcmVmZXIgYHdpdGhBZHZpc29yeUxvY2tPckZhaWxgIHRvIGF2b2lkIGFcbiAgICogVE9DVE9VIHdpbmRvdyBiZXR3ZWVuIHRoZSBjaGVjayBhbmQgdGhlIGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGFkdmlzb3J5IGxvY2sgaXMgY3VycmVudGx5IGhlbGQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgaGFzQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS5pc0Fkdmlzb3J5TG9ja0hlbGQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyYW5zbGF0ZXMuXG4gICAqIEBwYXJhbSB7Li4uc3RyaW5nfSBuYW1lcyAtIE5hbWVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgdHJhbnNsYXRlcyguLi5uYW1lcykge1xuICAgIGNvbnN0IHRyYW5zbGF0aW9ucyA9IHRoaXMuZ2V0VHJhbnNsYXRpb25zTWFwKClcblxuICAgIGZvciAoY29uc3QgbmFtZSBvZiBuYW1lcykge1xuICAgICAgaWYgKG5hbWUgaW4gdHJhbnNsYXRpb25zKSB0aHJvdyBuZXcgRXJyb3IoYFRyYW5zbGF0aW9uIGFscmVhZHkgZXhpc3RzOiAke25hbWV9YClcblxuICAgICAgdHJhbnNsYXRpb25zW25hbWVdID0ge31cblxuICAgICAgaWYgKCF0aGlzLl9yZWxhdGlvbnNoaXBFeGlzdHMoXCJ0cmFuc2xhdGlvbnNcIikpIHtcbiAgICAgICAgdGhpcy5fZGVmaW5lUmVsYXRpb25zaGlwKFwidHJhbnNsYXRpb25zXCIsIHtkZXBlbmRlbnQ6IFwiZGVzdHJveVwiLCBrbGFzczogdGhpcy5nZXRUcmFuc2xhdGlvbkNsYXNzKCksIHR5cGU6IFwiaGFzTWFueVwifSlcbiAgICAgIH1cblxuICAgICAgaWYgKCF0aGlzLl9yZWxhdGlvbnNoaXBFeGlzdHMoXCJjdXJyZW50VHJhbnNsYXRpb25cIikpIHtcbiAgICAgICAgdGhpcy5fZGVmaW5lUmVsYXRpb25zaGlwKFwiY3VycmVudFRyYW5zbGF0aW9uXCIsIHtcbiAgICAgICAgICBrbGFzczogdGhpcy5nZXRUcmFuc2xhdGlvbkNsYXNzKCksXG4gICAgICAgICAgc2NvcGU6IChxdWVyeSkgPT4gdGhpcy5jdXJyZW50VHJhbnNsYXRpb25TY29wZShxdWVyeSksXG4gICAgICAgICAgdHlwZTogXCJoYXNPbmVcIlxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgdHJhbnNsYXRpb24gc2NvcGUuXG4gICAqIEBwYXJhbSB7TW9kZWxDbGFzc1F1ZXJ5fSBxdWVyeSAtIFRyYW5zbGF0aW9uIHF1ZXJ5LlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5fSAtIFNjb3BlZCBxdWVyeS5cbiAgICovXG4gIHN0YXRpYyBjdXJyZW50VHJhbnNsYXRpb25TY29wZShxdWVyeSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBsb2NhbGUgPSBjb25maWd1cmF0aW9uLmdldExvY2FsZSgpXG4gICAgY29uc3QgZmFsbGJhY2tzID0gY29uZmlndXJhdGlvbi5nZXRMb2NhbGVGYWxsYmFja3MoKVxuICAgIGNvbnN0IGxvY2FsZXMgPSBsb2NhbGUgPyAoZmFsbGJhY2tzPy5bbG9jYWxlXSB8fCBbbG9jYWxlXSkgOiBbXVxuXG4gICAgaWYgKGxvY2FsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gcXVlcnkud2hlcmUoXCIxPTBcIilcblxuICAgIGNvbnN0IGRyaXZlciA9IHF1ZXJ5LmRyaXZlclxuICAgIGNvbnN0IHRyYW5zbGF0aW9uQ2xhc3MgPSB0aGlzLmdldFRyYW5zbGF0aW9uQ2xhc3MoKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKFwiY3VycmVudFRyYW5zbGF0aW9uXCIpXG4gICAgY29uc3QgdGFibGVOYW1lID0gdHJhbnNsYXRpb25DbGFzcy50YWJsZU5hbWUoKVxuICAgIGNvbnN0IHNjb3BlVGFibGVSZWZlcmVuY2UgPSBgJHt0YWJsZU5hbWV9X2N1cnJlbnRfdHJhbnNsYXRpb25fc2NvcGVgXG4gICAgY29uc3QgdGFyZ2V0VGFibGVTcWwgPSBkcml2ZXIucXVvdGVUYWJsZShxdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oKSlcbiAgICBjb25zdCBzY29wZVRhYmxlU3FsID0gZHJpdmVyLnF1b3RlVGFibGUoc2NvcGVUYWJsZVJlZmVyZW5jZSlcbiAgICBjb25zdCBzY29wZVRhYmxlRnJvbVNxbCA9IGAke2RyaXZlci5xdW90ZVRhYmxlKHRhYmxlTmFtZSl9IEFTICR7c2NvcGVUYWJsZVNxbH1gXG4gICAgY29uc3QgcHJpbWFyeUtleUNvbHVtbiA9IHNjYWxhck1vZGVsUHJpbWFyeUtleSh0cmFuc2xhdGlvbkNsYXNzLnByaW1hcnlLZXkoKSwgYEN1cnJlbnQgdHJhbnNsYXRpb24gc2NvcGUgZm9yICR7dHJhbnNsYXRpb25DbGFzcy5uYW1lfWApXG4gICAgY29uc3QgZm9yZWlnbktleUNvbHVtbiA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcbiAgICBjb25zdCB0YXJnZXRQcmltYXJ5S2V5U3FsID0gYCR7dGFyZ2V0VGFibGVTcWx9LiR7ZHJpdmVyLnF1b3RlQ29sdW1uKHByaW1hcnlLZXlDb2x1bW4pfWBcbiAgICBjb25zdCB0YXJnZXRGb3JlaWduS2V5U3FsID0gYCR7dGFyZ2V0VGFibGVTcWx9LiR7ZHJpdmVyLnF1b3RlQ29sdW1uKGZvcmVpZ25LZXlDb2x1bW4pfWBcbiAgICBjb25zdCBzY29wZVByaW1hcnlLZXlTcWwgPSBgJHtzY29wZVRhYmxlU3FsfS4ke2RyaXZlci5xdW90ZUNvbHVtbihwcmltYXJ5S2V5Q29sdW1uKX1gXG4gICAgY29uc3Qgc2NvcGVGb3JlaWduS2V5U3FsID0gYCR7c2NvcGVUYWJsZVNxbH0uJHtkcml2ZXIucXVvdGVDb2x1bW4oZm9yZWlnbktleUNvbHVtbil9YFxuICAgIGNvbnN0IHNjb3BlTG9jYWxlU3FsID0gYCR7c2NvcGVUYWJsZVNxbH0uJHtkcml2ZXIucXVvdGVDb2x1bW4oXCJsb2NhbGVcIil9YFxuICAgIGNvbnN0IGxvY2FsZUxpc3RTcWwgPSBsb2NhbGVzLm1hcCgoZmFsbGJhY2tMb2NhbGUpID0+IGRyaXZlci5xdW90ZShmYWxsYmFja0xvY2FsZSkpLmpvaW4oXCIsIFwiKVxuICAgIGNvbnN0IGxvY2FsZU9yZGVyU3FsID0gbG9jYWxlcy5tYXAoKGZhbGxiYWNrTG9jYWxlLCBpbmRleCkgPT4gYFdIRU4gJHtzY29wZUxvY2FsZVNxbH0gPSAke2RyaXZlci5xdW90ZShmYWxsYmFja0xvY2FsZSl9IFRIRU4gJHtkcml2ZXIucXVvdGUoaW5kZXgpfWApLmpvaW4oXCIgXCIpXG4gICAgY29uc3QgZmFsbGJhY2tPcmRlclNxbCA9IGBDQVNFICR7bG9jYWxlT3JkZXJTcWx9IEVMU0UgJHtkcml2ZXIucXVvdGUobG9jYWxlcy5sZW5ndGgpfSBFTkRgXG4gICAgY29uc3Qgc2VsZWN0ZWRUcmFuc2xhdGlvblNxbCA9IGRyaXZlci5nZXRUeXBlKCkgPT0gXCJtc3NxbFwiXG4gICAgICA/IGBTRUxFQ1QgVE9QIDEgJHtzY29wZVByaW1hcnlLZXlTcWx9IEZST00gJHtzY29wZVRhYmxlRnJvbVNxbH0gV0hFUkUgJHtzY29wZUZvcmVpZ25LZXlTcWx9ID0gJHt0YXJnZXRGb3JlaWduS2V5U3FsfSBBTkQgJHtzY29wZUxvY2FsZVNxbH0gSU4gKCR7bG9jYWxlTGlzdFNxbH0pIE9SREVSIEJZICR7ZmFsbGJhY2tPcmRlclNxbH0sICR7c2NvcGVQcmltYXJ5S2V5U3FsfSBBU0NgXG4gICAgICA6IGBTRUxFQ1QgJHtzY29wZVByaW1hcnlLZXlTcWx9IEZST00gJHtzY29wZVRhYmxlRnJvbVNxbH0gV0hFUkUgJHtzY29wZUZvcmVpZ25LZXlTcWx9ID0gJHt0YXJnZXRGb3JlaWduS2V5U3FsfSBBTkQgJHtzY29wZUxvY2FsZVNxbH0gSU4gKCR7bG9jYWxlTGlzdFNxbH0pIE9SREVSIEJZICR7ZmFsbGJhY2tPcmRlclNxbH0sICR7c2NvcGVQcmltYXJ5S2V5U3FsfSBBU0MgTElNSVQgMWBcblxuICAgIHJldHVybiBxdWVyeS53aGVyZShgJHt0YXJnZXRQcmltYXJ5S2V5U3FsfSA9ICgke3NlbGVjdGVkVHJhbnNsYXRpb25TcWx9KWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHJhbnNsYXRpb24gY2xhc3MuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IC0gVGhlIHRyYW5zbGF0aW9uIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIGdldFRyYW5zbGF0aW9uQ2xhc3MoKSB7XG4gICAgaWYgKHRoaXMuX3RyYW5zbGF0aW9uQ2xhc3MpIHJldHVybiB0aGlzLl90cmFuc2xhdGlvbkNsYXNzXG4gICAgaWYgKHRoaXMudGFibGVOYW1lKCkuZW5kc1dpdGgoXCJfdHJhbnNsYXRpb25zXCIpKSB0aHJvdyBuZXcgRXJyb3IoXCJUcnlpbmcgdG8gZGVmaW5lIGEgdHJhbnNsYXRpb25zIGNsYXNzIGZvciBhIHRyYW5zbGF0aW9uIGNsYXNzXCIpXG5cbiAgICBjb25zdCBjbGFzc05hbWUgPSBgJHt0aGlzLmdldE1vZGVsTmFtZSgpfVRyYW5zbGF0aW9uYFxuICAgIGNvbnN0IFRyYW5zbGF0aW9uQ2xhc3MgPSBjbGFzcyBUcmFuc2xhdGlvbiBleHRlbmRzIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHt9XG4gICAgY29uc3QgYmVsb25nc1RvID0gc2luZ3VsYXJpemVNb2RlbE5hbWUoaW5mbGVjdGlvbi5jYW1lbGl6ZSh0aGlzLnRhYmxlTmFtZSgpLCB0cnVlKSlcblxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShUcmFuc2xhdGlvbkNsYXNzLCBcIm5hbWVcIiwge3ZhbHVlOiBjbGFzc05hbWV9KVxuICAgIFRyYW5zbGF0aW9uQ2xhc3Muc2V0VGFibGVOYW1lKHRoaXMuZ2V0VHJhbnNsYXRpb25zVGFibGVOYW1lKCkpXG4gICAgVHJhbnNsYXRpb25DbGFzcy5iZWxvbmdzVG8oYmVsb25nc1RvKVxuXG4gICAgaWYgKHRoaXMuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSkge1xuICAgICAgY29uc3QgdHJhbnNsYXRlZE1vZGVsQ2xhc3MgPSB0aGlzXG5cbiAgICAgIFRyYW5zbGF0aW9uQ2xhc3Muc3dpdGNoZXNUZW5hbnREYXRhYmFzZSgoe3RlbmFudH0pID0+IHRyYW5zbGF0ZWRNb2RlbENsYXNzLmdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcih0ZW5hbnQpKVxuICAgIH1cblxuICAgIHRoaXMuX3RyYW5zbGF0aW9uQ2xhc3MgPSBUcmFuc2xhdGlvbkNsYXNzXG5cbiAgICByZXR1cm4gdGhpcy5fdHJhbnNsYXRpb25DbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0aW9ucyB0YWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0cmFuc2xhdGlvbnMgdGFibGUgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRUcmFuc2xhdGlvbnNUYWJsZU5hbWUoKSB7XG4gICAgY29uc3QgdGFibGVOYW1lUGFydHMgPSB0aGlzLnRhYmxlTmFtZSgpLnNwbGl0KFwiX1wiKVxuXG4gICAgdGFibGVOYW1lUGFydHNbdGFibGVOYW1lUGFydHMubGVuZ3RoIC0gMV0gPSBpbmZsZWN0aW9uLnNpbmd1bGFyaXplKHRhYmxlTmFtZVBhcnRzW3RhYmxlTmFtZVBhcnRzLmxlbmd0aCAtIDFdKVxuXG4gICAgcmV0dXJuIGAke3RhYmxlTmFtZVBhcnRzLmpvaW4oXCJfXCIpfV90cmFuc2xhdGlvbnNgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgdHJhbnNsYXRpb25zIHRhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBSZXNvbHZlcyB3aXRoIFdoZXRoZXIgaXQgaGFzIHRyYW5zbGF0aW9ucyB0YWJsZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBoYXNUcmFuc2xhdGlvbnNUYWJsZSgpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkuZ2V0VGFibGVCeU5hbWUodGhpcy5nZXRUcmFuc2xhdGlvbnNUYWJsZU5hbWUoKSlcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgdmFsaWRhdGlvbiB0byBhbiBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIFRoZSBuYW1lIG9mIHRoZSBhdHRyaWJ1dGUgdG8gdmFsaWRhdGUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHZhbGlkYXRvcnMgVGhlIHZhbGlkYXRvcnMgdG8gYWRkLiBLZXkgaXMgdGhlIHZhbGlkYXRvciBuYW1lLCB2YWx1ZSBpcyB0aGUgdmFsaWRhdG9yIGFyZ3VtZW50cy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB2YWxpZGF0ZXMoYXR0cmlidXRlTmFtZSwgdmFsaWRhdG9ycykge1xuICAgIGZvciAoY29uc3QgdmFsaWRhdG9yTmFtZSBpbiB2YWxpZGF0b3JzKSB7XG4gICAgICAvKipcbiAgICAgICAqIERlZmluZXMgdmFsaWRhdG9yQXJncy5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBsZXQgdmFsaWRhdG9yQXJnc1xuXG4gICAgICAvKipcbiAgICAgICAqIFVzZSB2YWxpZGF0b3IuXG4gICAgICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICAgIGxldCB1c2VWYWxpZGF0b3IgPSB0cnVlXG5cbiAgICAgIGNvbnN0IHZhbGlkYXRvckFyZ3NDYW5kaWRhdGUgPSB2YWxpZGF0b3JzW3ZhbGlkYXRvck5hbWVdXG5cbiAgICAgIGlmICh0eXBlb2YgdmFsaWRhdG9yQXJnc0NhbmRpZGF0ZSA9PSBcImJvb2xlYW5cIikge1xuICAgICAgICB2YWxpZGF0b3JBcmdzID0ge31cbiAgICAgICAgdXNlVmFsaWRhdG9yXG5cbiAgICAgICAgaWYgKCF2YWxpZGF0b3JBcmdzQ2FuZGlkYXRlKSB7XG4gICAgICAgICAgdXNlVmFsaWRhdG9yID0gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFsaWRhdG9yQXJncyA9IHZhbGlkYXRvckFyZ3NDYW5kaWRhdGVcbiAgICAgIH1cblxuICAgICAgaWYgKCF1c2VWYWxpZGF0b3IpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgVmFsaWRhdG9yQ2xhc3MgPSB0aGlzLmdldFZhbGlkYXRvclR5cGUodmFsaWRhdG9yTmFtZSlcbiAgICAgIGNvbnN0IHZhbGlkYXRvciA9IG5ldyBWYWxpZGF0b3JDbGFzcyh7YXR0cmlidXRlTmFtZSwgYXJnczogdmFsaWRhdG9yQXJnc30pXG5cbiAgICAgIGlmICghdGhpcy5fdmFsaWRhdG9ycykgdGhpcy5fdmFsaWRhdG9ycyA9IHt9XG4gICAgICBpZiAoIShhdHRyaWJ1dGVOYW1lIGluIHRoaXMuX3ZhbGlkYXRvcnMpKSB0aGlzLl92YWxpZGF0b3JzW2F0dHJpYnV0ZU5hbWVdID0gW11cblxuICAgICAgdGhpcy5fdmFsaWRhdG9yc1thdHRyaWJ1dGVOYW1lXS5wdXNoKHZhbGlkYXRvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGdhcC1sZXNzIHBvc2l0aW9uYWwgbGlzdCBjYWxsYmFja3MgZm9yIGEgY29sdW1uIHNjb3BlZCBieVxuICAgKiBhbm90aGVyIGNvbHVtbi4gSW5zZXJ0cyBhbmQgbW92ZXMgc2hpZnQgc3Vycm91bmRpbmcgcG9zaXRpb25zIHNvIHRoZVxuICAgKiBsaXN0IHN0YXlzIGNvbXBhY3QgKDEsMiwzLC4uLikuIERlc3Ryb3lzIGNsb3NlIHRoZSByZXN1bHRpbmcgZ2FwLlxuICAgKlxuICAgKiBDYWxsZXJzIG11c3QgZW5zdXJlIGEgVU5JUVVFIGluZGV4IG9uIChzY29wZUNvbHVtbiwgcG9zaXRpb25Db2x1bW4pXG4gICAqIGV4aXN0cyBpbiB0aGUgZGF0YWJhc2Ug4oCUIHVzZSBgTWlncmF0aW9uLmFkZEFjdHNBc0xpc3QoKWAgZm9yIHRoZVxuICAgKiBzY2hlbWEgaGFsZi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHBvc2l0aW9uQ29sdW1uIC0gY2FtZWxDYXNlIHBvc2l0aW9uIGF0dHJpYnV0ZSAoZS5nLiBcInJvd051bWJlclwiKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnMgLSBPcHRpb25zIHdpdGggYSByZXF1aXJlZCBzY29wZSBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcHRpb25zLnNjb3BlIC0gY2FtZWxDYXNlIHNjb3BlIGF0dHJpYnV0ZSAoZS5nLiBcImJvYXJkQ29sdW1uSWRcIikuXG4gICAqL1xuICBzdGF0aWMgYWN0c0FzTGlzdChwb3NpdGlvbkNvbHVtbiwgb3B0aW9ucykge1xuICAgIGNvbnN0IHtzY29wZX0gPSBvcHRpb25zXG5cbiAgICByZWdpc3RlckFjdHNBc0xpc3RDYWxsYmFja3ModGhpcywgcG9zaXRpb25Db2x1bW4sIHtzY29wZX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cmFuc2xhdGlvbnMgbG9hZGVkLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1RyYW5zbGF0aW9uQmFzZVtdfSAtIFRoZSB0cmFuc2xhdGlvbnMgbG9hZGVkLlxuICAgKi9cbiAgdHJhbnNsYXRpb25zTG9hZGVkKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIid0cmFuc2xhdGlvbnNMb2FkZWQnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0ZWQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsb2NhbGUgLSBMb2NhbGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIHRyYW5zbGF0ZWQgYXR0cmlidXRlLCBpZiBmb3VuZC5cbiAgICovXG4gIF9nZXRUcmFuc2xhdGVkQXR0cmlidXRlKG5hbWUsIGxvY2FsZSkge1xuICAgIGNvbnN0IHRyYW5zbGF0aW9uID0gdGhpcy50cmFuc2xhdGlvbnNMb2FkZWQoKS5maW5kKCh0cmFuc2xhdGlvbikgPT4gdHJhbnNsYXRpb24ubG9jYWxlKCkgPT0gbG9jYWxlKVxuXG4gICAgaWYgKHRyYW5zbGF0aW9uKSB7XG4gICAgICAvKipcbiAgICAgICAqIERpY3QuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3QgZGljdCA9IHRyYW5zbGF0aW9uXG5cbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU1ldGhvZCA9IC8qKiBAdHlwZSB7KCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkfSAqLyAoZGljdFtuYW1lXSlcblxuICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVNZXRob2QgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGVNZXRob2QuYmluZCh0cmFuc2xhdGlvbikoKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIHRyYW5zbGF0ZWQgbWV0aG9kOiAke25hbWV9ICgke3R5cGVvZiBhdHRyaWJ1dGVNZXRob2R9KWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0ZWQgYXR0cmlidXRlIHdpdGggZmFsbGJhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2FsZSAtIExvY2FsZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgdHJhbnNsYXRlZCBhdHRyaWJ1dGUgd2l0aCBmYWxsYmFjaywgaWYgZm91bmQuXG4gICAqL1xuICBfZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZVdpdGhGYWxsYmFjayhuYW1lLCBsb2NhbGUpIHtcbiAgICBsZXQgbG9jYWxlc0luT3JkZXJcbiAgICBjb25zdCBmYWxsYmFja3MgPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0TG9jYWxlRmFsbGJhY2tzKClcblxuICAgIGlmIChmYWxsYmFja3MgJiYgbG9jYWxlIGluIGZhbGxiYWNrcykge1xuICAgICAgbG9jYWxlc0luT3JkZXIgPSBmYWxsYmFja3NbbG9jYWxlXVxuICAgIH0gZWxzZSB7XG4gICAgICBsb2NhbGVzSW5PcmRlciA9IFtsb2NhbGVdXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBmYWxsYmFja0xvY2FsZSBvZiBsb2NhbGVzSW5PcmRlcikge1xuICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5fZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZShuYW1lLCBmYWxsYmFja0xvY2FsZSlcblxuICAgICAgaWYgKHJlc3VsdCAmJiByZXN1bHQudHJpbSgpICE9IFwiXCIpIHtcbiAgICAgICAgcmV0dXJuIHJlc3VsdFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0cmFuc2xhdGVkIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbG9jYWxlIC0gTG9jYWxlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBuZXdWYWx1ZSAtIE5ldyB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGUobmFtZSwgbG9jYWxlLCBuZXdWYWx1ZSkge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgdHJhbnNsYXRpb24uXG4gICAgICogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHwgVHJhbnNsYXRpb25CYXNlIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCB0cmFuc2xhdGlvblxuXG4gICAgdHJhbnNsYXRpb24gPSB0aGlzLnRyYW5zbGF0aW9uc0xvYWRlZCgpPy5maW5kKCh0cmFuc2xhdGlvbikgPT4gdHJhbnNsYXRpb24ubG9jYWxlKCkgPT0gbG9jYWxlKVxuXG4gICAgaWYgKCF0cmFuc2xhdGlvbikge1xuICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShcInRyYW5zbGF0aW9uc1wiKVxuXG4gICAgICB0cmFuc2xhdGlvbiA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmJ1aWxkKHtsb2NhbGV9KVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEFzc2lnbm1lbnRzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYXNzaWdubWVudHMgPSB7fVxuXG4gICAgYXNzaWdubWVudHNbbmFtZV0gPSBuZXdWYWx1ZVxuXG4gICAgdHJhbnNsYXRpb24uYXNzaWduKGFzc2lnbm1lbnRzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV3IHF1ZXJ5LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3tkcml2ZXI/OiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8ICgoKSA9PiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCksIG9wZXJhdGlvbj86IGltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0fX0gW2FyZ3NdIC0gRXhwbGljaXQgcXVlcnkgb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgbmV3IHF1ZXJ5LlxuICAgKi9cbiAgc3RhdGljIF9uZXdRdWVyeShhcmdzID0ge30pIHtcbiAgICBjb25zdCB7ZHJpdmVyOiBnaXZlbkRyaXZlciwgb3BlcmF0aW9uOiBnaXZlbk9wZXJhdGlvbiwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgY29uc3Qgb3BlcmF0aW9uID0gZ2l2ZW5PcGVyYXRpb24gfHwgdGhpcy5fcmVjb3JkTWV0YWRhdGFPcGVyYXRpb25cbiAgICBjb25zdCBkcml2ZXIgPSBnaXZlbkRyaXZlciB8fCAob3BlcmF0aW9uID8gb3BlcmF0aW9uLmNvbm5lY3Rpb24oKSA6ICgpID0+IHRoaXMuY29ubmVjdGlvbigpKVxuICAgIHRoaXMuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgY29uc3QgaGFuZGxlciA9IG5ldyBIYW5kbGVyKClcbiAgICBjb25zdCBxdWVyeSA9IG5ldyBNb2RlbENsYXNzUXVlcnkoe1xuICAgICAgZHJpdmVyLFxuICAgICAgaGFuZGxlcixcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICBvcGVyYXRpb25cbiAgICB9KVxuXG4gICAgcmV0dXJuIHF1ZXJ5LmZyb20obmV3IEZyb21UYWJsZSh0aGlzLnRhYmxlTmFtZSgpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9yZGVyYWJsZSBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIG9yZGVyYWJsZSBjb2x1bW4uXG4gICAqL1xuICBzdGF0aWMgb3JkZXJhYmxlQ29sdW1uKCkge1xuICAgIC8vIEZJWE1FOiBBbGxvdyB0byBjaGFuZ2UgdG8gJ2NyZWF0ZWRfYXQnIGlmIHVzaW5nIFVVSUQ/XG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5wcmltYXJ5S2V5KClcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpKSByZXR1cm4gcHJpbWFyeUtleVswXVxuXG4gICAgcmV0dXJuIHByaW1hcnlLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFsbC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIGFsbC5cbiAgICovXG4gIHN0YXRpYyBhbGwoKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjY2Vzc2libGUgZm9yLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24gdG8gc2NvcGUgYnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IFthYmlsaXR5XSAtIEFiaWxpdHkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIEF1dGhvcml6ZWQgcXVlcnkuXG4gICAqL1xuICBzdGF0aWMgYWNjZXNzaWJsZUZvcihhY3Rpb24sIGFiaWxpdHkpIHtcbiAgICBjb25zdCBxdWVyeSA9IHRoaXMuX25ld1F1ZXJ5KClcbiAgICBjb25zdCBjdXJyZW50QWJpbGl0eSA9IGFiaWxpdHkgfHwgQ3VycmVudC5hYmlsaXR5KClcblxuICAgIGlmICghY3VycmVudEFiaWxpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gYWJpbGl0eSBpbiBjb250ZXh0IGZvciAke3RoaXMubmFtZX0uIFBhc3MgYW4gYWJpbGl0eSBvciBjb25maWd1cmUgYWJpbGl0eSByZXNvbHZlciBvbiB0aGUgcmVxdWVzdGApXG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gKi8gKGN1cnJlbnRBYmlsaXR5LmFwcGx5VG9RdWVyeSh7XG4gICAgICBhY3Rpb24sXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgcXVlcnlcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjY2Vzc2libGUuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IFthYmlsaXR5XSAtIEFiaWxpdHkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIEF1dGhvcml6ZWQgcXVlcnkuXG4gICAqL1xuICBzdGF0aWMgYWNjZXNzaWJsZShhYmlsaXR5KSB7XG4gICAgcmV0dXJuIHRoaXMuYWNjZXNzaWJsZUZvcihcInJlYWRcIiwgYWJpbGl0eSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjY2Vzc2libGUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHR9IGFiaWxpdHkgLSBBYmlsaXR5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBBdXRob3JpemVkIHF1ZXJ5LlxuICAgKi9cbiAgc3RhdGljIGFjY2Vzc2libGVCeShhYmlsaXR5KSB7XG4gICAgaWYgKCFhYmlsaXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGFiaWxpdHkgcGFzc2VkIHRvICR7dGhpcy5uYW1lfS5hY2Nlc3NpYmxlQnkoYWJpbGl0eSkuYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5hY2Nlc3NpYmxlKGFiaWxpdHkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb3VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb3VudC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjb3VudCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmNvdW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdyb3VwLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gZ3JvdXAgLSBHcm91cC5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIGdyb3VwLlxuICAgKi9cbiAgc3RhdGljIGdyb3VwKGdyb3VwKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KCkuZ3JvdXAoZ3JvdXApXG4gIH1cblxuICBzdGF0aWMgYXN5bmMgZGVzdHJveUFsbCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmRlc3Ryb3lBbGwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGx1Y2suXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7Li4uc3RyaW5nfHN0cmluZ1tdfSBjb2x1bW5zIC0gQ29sdW1uIG5hbWVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHBsdWNrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHBsdWNrKC4uLmNvbHVtbnMpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLnBsdWNrKC4uLmNvbHVtbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSByZWNvcmRJZCAtIFJlY29yZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZmluZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kKHJlY29yZElkKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5maW5kKHJlY29yZElkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHt7W2tleTogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyfX0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMgaGFzaCBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPiB8IG51bGw+fSAtIFJlc29sdmVzIHdpdGggdGhlIGJ5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRCeShjb25kaXRpb25zKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5maW5kQnkoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkgb3IgZmFpbC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHt7W2tleTogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyfX0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMgaGFzaCBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYnkgb3IgZmFpbC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kQnlPckZhaWwoY29uZGl0aW9ucykge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkuZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhbiBpbW11dGFibGUgdGVuYW50LWJvdW5kIG1vZGVsIHNjb3BlLiBFYWdlciBoZWxwZXJzIGFuZCBleHBsaWNpdFxuICAgKiBkYXRhYmFzZU9wZXJhdGlvbi90cmFuc2FjdGlvbiBjYWxsYmFja3MgZXhlY3V0ZSBmcm9tIGEgY2FwdHVyZWQgcGh5c2ljYWxcbiAgICogZGF0YWJhc2UgY29uZmlndXJhdGlvbiBpbnN0ZWFkIG9mIGFtYmllbnQgdGVuYW50IHN0YXRlLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge29iamVjdH0gdGVuYW50IC0gT3JkaW5hcnkgb3IgbnVsbC1wcm90b3R5cGUgSlNPTi1jb21wYXRpYmxlIHRlbmFudCBkZXNjcmlwdG9yIHRvIHNjb3BlIHRoZSBtb2RlbCB0by5cbiAgICogQHJldHVybnMge1RlbmFudE1vZGVsU2NvcGU8TUM+fSAtIE1vZGVsIHNjb3BlIGJvdW5kIHRvIHRoZSBjYXB0dXJlZCB0ZW5hbnQgZGF0YWJhc2UuXG4gICAqL1xuICBzdGF0aWMgdXNpbmdUZW5hbnQodGVuYW50KSB7XG4gICAgcmV0dXJuIG5ldyBUZW5hbnRNb2RlbFNjb3BlKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICB0ZW5hbnRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBjcmVhdGUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7e1trZXk6IHN0cmluZ106IHN0cmluZyB8IG51bWJlcn19IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIGhhc2gga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7KCkgPT4gdm9pZH0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBvciBjcmVhdGUgYnkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZE9yQ3JlYXRlQnkoY29uZGl0aW9ucywgY2FsbGJhY2spIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmZpbmRPckNyZWF0ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBvciBpbml0aWFsaXplIGJ5LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zLlxuICAgKiBAcGFyYW0geyhhcmc6IEluc3RhbmNlVHlwZTxNQz4pID0+IHZvaWR9IFtjYWxsYmFja10gLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgb3IgaW5pdGlhbGl6ZSBieS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucywgY2FsbGJhY2spIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmZpbmRPckluaXRpYWxpemVCeShjb25kaXRpb25zLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpcnN0LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBmaXJzdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaXJzdCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkuZmlyc3QoKVxuXG4gICAgaWYgKCFyZXN1bHQpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9LmZpcnN0KCkgcmV0dXJuZWQgbm8gcmVjb3Jkc2ApXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBqb2lucy5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBpbXBvcnQoXCIuLi9xdWVyeS9qb2luLW9iamVjdC5qc1wiKS5Kb2luT2JqZWN0fSBqb2luIC0gSm9pbiBjbGF1c2Ugb3Igam9pbiBkZXNjcmlwdG9yLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgam9pbnMuXG4gICAqL1xuICBzdGF0aWMgam9pbnMoam9pbikge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLmpvaW5zKGpvaW4pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsYXN0LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBsYXN0LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGxhc3QoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmxhc3QoKVxuXG4gICAgaWYgKCFyZXN1bHQpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9Lmxhc3QoKSByZXR1cm5lZCBubyByZWNvcmRzYClcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxpbWl0LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge251bWJlcn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBsaW1pdC5cbiAgICovXG4gIHN0YXRpYyBsaW1pdCh2YWx1ZSkge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLmxpbWl0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3JkZXIuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuT3JkZXJBcmd1bWVudFR5cGV9IG9yZGVyIC0gT3JkZXIuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBvcmRlci5cbiAgICovXG4gIHN0YXRpYyBvcmRlcihvcmRlcikge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLm9yZGVyKG9yZGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGlzdGluY3QuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW3ZhbHVlXSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIGRpc3RpbmN0LlxuICAgKi9cbiAgc3RhdGljIGRpc3RpbmN0KHZhbHVlID0gdHJ1ZSkge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLmRpc3RpbmN0KHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlbG9hZC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHByZWxvYWQgLSBQcmVsb2FkLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgcHJlbG9hZC5cbiAgICovXG4gIHN0YXRpYyBwcmVsb2FkKHByZWxvYWQpIHtcbiAgICBjb25zdCBxdWVyeSA9IC8qKiBAdHlwZSB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gKi8gKHRoaXMuX25ld1F1ZXJ5KCkucHJlbG9hZChwcmVsb2FkKSlcblxuICAgIHJldHVybiBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VsZWN0LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLlNlbGVjdEFyZ3VtZW50VHlwZX0gc2VsZWN0IC0gU2VsZWN0LlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgc2VsZWN0LlxuICAgKi9cbiAgc3RhdGljIHNlbGVjdChzZWxlY3QpIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS5zZWxlY3Qoc2VsZWN0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gYXJyYXkuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz5bXT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYXJyYXkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgdG9BcnJheSgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLnRvQXJyYXkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPltdPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBhcnJheS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsb2FkKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkubG9hZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGVyZS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5XaGVyZUFyZ3VtZW50VHlwZX0gd2hlcmUgLSBXaGVyZS5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIHdoZXJlLlxuICAgKi9cbiAgc3RhdGljIHdoZXJlKHdoZXJlKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KCkud2hlcmUod2hlcmUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByYW5zYWNrLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmFuc2Fjay1zdHlsZSBwYXJhbXMgaGFzaC5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gUXVlcnkgd2l0aCBSYW5zYWNrIGZpbHRlcnMgYXBwbGllZC5cbiAgICovXG4gIHN0YXRpYyByYW5zYWNrKHBhcmFtcykge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLnJhbnNhY2socGFyYW1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7V3JpdGVBdHRyaWJ1dGVzfSBjaGFuZ2VzIC0gQ2hhbmdlcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGNoYW5nZXMgPSAvKiogQHR5cGUge1dyaXRlQXR0cmlidXRlc30gKi8gKHt9KSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gKi8gKG5ldy50YXJnZXQpXG5cbiAgICB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbiA9IE1vZGVsQ2xhc3MuX3JlY29yZE1ldGFkYXRhT3BlcmF0aW9uXG4gICAgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgdGhpcy5fYXR0cmlidXRlcyA9IHt9XG4gICAgdGhpcy5fY2hhbmdlcyA9IHt9XG4gICAgdGhpcy5faXNOZXdSZWNvcmQgPSB0cnVlXG5cbiAgICBmb3IgKGNvbnN0IGtleSBpbiBjaGFuZ2VzKSB7XG4gICAgICB0aGlzLnNldEF0dHJpYnV0ZShrZXksIGNoYW5nZXNba2V5XSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQmluZHMgZnV0dXJlIHF1ZXJ5LCBsaWZlY3ljbGUsIHJlbGF0aW9uc2hpcCwgYW5kIHBlcnNpc3RlbmNlIHdvcmsgdG8gYW4gb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBvcGVyYXRpb24gLSBPd25pbmcgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBCb3VuZCByZWNvcmQuXG4gICAqL1xuICBiaW5kRGF0YWJhc2VPcGVyYXRpb24ob3BlcmF0aW9uKSB7XG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uICYmIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uICE9PSBvcGVyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlY29yZCBpcyBhbHJlYWR5IGJvdW5kIHRvIGFub3RoZXIgZGF0YWJhc2Ugb3BlcmF0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24gPSBvcGVyYXRpb25cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgYW5kIHZhbGlkYXRlcyB0aGUgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkgdGhhdCBvd25zIHRoaXMgcmVjb3JkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGl0eSAtIE9wYXF1ZSBvcGVyYXRpb24vY29ubmVjdGlvbiBpZGVudGl0eS5cbiAgICogQHJldHVybnMge3RoaXN9IFRoaXMgcmVjb3JkLlxuICAgKi9cbiAgY2FwdHVyZURhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSkge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZUlkZW50aXR5ICYmIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgIT09IGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlY29yZCBiZWxvbmdzIHRvIGEgZGlmZmVyZW50IHBoeXNpY2FsIHRlbmFudCBkYXRhYmFzZVwiKVxuICAgIH1cblxuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgPSBkYXRhYmFzZUlkZW50aXR5XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNhcHR1cmVkIHBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSBDYXB0dXJlZCBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAgICovXG4gIGRhdGFiYXNlSWRlbnRpdHkoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2RhdGFiYXNlSWRlbnRpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyB0aGlzIHJlY29yZCBmcm9tIGEgY29tcGxldGVkIGVhZ2VyLWhlbHBlciBvcGVyYXRpb24gd2hpbGVcbiAgICogcHJlc2VydmluZyB0aGUgbGVnYWN5IGFtYmllbnQgZm9sbG93LXVwIGJlaGF2aW9yIG9mIGB1c2luZ1RlbmFudGAgZmluZGVycy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdH0gb3BlcmF0aW9uIC0gUmVsZWFzaW5nIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge3RoaXN9IC0gUmVjb3JkLlxuICAgKi9cbiAgcmVsZWFzZURhdGFiYXNlT3BlcmF0aW9uKG9wZXJhdGlvbikge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbiAhPT0gb3BlcmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWNvcmQgaXMgbm90IGJvdW5kIHRvIHRoZSByZWxlYXNpbmcgZGF0YWJhc2Ugb3BlcmF0aW9uXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24gPSB1bmRlZmluZWRcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZXhwbGljaXQgb3BlcmF0aW9uIG93bmluZyB0aGlzIHJlY29yZCwgaWYgYW55LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gT3duaW5nIG9wZXJhdGlvbi5cbiAgICovXG4gIGRhdGFiYXNlT3BlcmF0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEJpbmRzIGEgcmVsYXRlZCByZWNvcmQgdG8gdGhlIHNhbWUgb3BlcmF0aW9uIGFzIHRoaXMgcmVjb3JkLlxuICAgKiBAdGVtcGxhdGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNb2RlbFxuICAgKiBAcGFyYW0ge01vZGVsfSByZWNvcmQgLSBSZWxhdGVkIHJlY29yZC5cbiAgICogQHJldHVybnMge01vZGVsfSAtIFJlbGF0ZWQgcmVjb3JkLlxuICAgKi9cbiAgYmluZFJlbGF0ZWRSZWNvcmQocmVjb3JkKSB7XG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi5iaW5kUmVjb3JkKHJlY29yZClcblxuICAgIHJldHVybiByZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBtb2RlbCBxdWVyeSBwcmVzZXJ2aW5nIHRoaXMgcmVjb3JkJ3Mgb3BlcmF0aW9uIG93bmVyc2hpcC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEBwYXJhbSB7TUN9IE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRhcmdldCBxdWVyeS5cbiAgICovXG4gIHF1ZXJ5Rm9yTW9kZWwoTW9kZWxDbGFzcykge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbikgcmV0dXJuIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLmZvck1vZGVsKE1vZGVsQ2xhc3MpXG5cbiAgICByZXR1cm4gTW9kZWxDbGFzcy5fbmV3UXVlcnkoKVxuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemVzIGEgcmVsYXRpb25zaGlwL3ByZWxvYWQgdGFyZ2V0IHdpdGhvdXQgZHJvcHBpbmcgdGhpcyByZWNvcmQnc1xuICAgKiBleHBsaWNpdCBvcGVyYXRpb24gY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gT3duaW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVNb2RlbENsYXNzSW5pdGlhbGl6ZWQoTW9kZWxDbGFzcywgY29uZmlndXJhdGlvbikge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbikge1xuICAgICAgYXdhaXQgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24uZW5zdXJlTW9kZWxJbml0aWFsaXplZChNb2RlbENsYXNzKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgTW9kZWxDbGFzcy5lbnN1cmVJbml0aWFsaXplZCh7Y29uZmlndXJhdGlvbn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkIGV4aXN0aW5nIHJlY29yZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBsb2FkRXhpc3RpbmdSZWNvcmQoYXR0cmlidXRlcykge1xuICAgIHRoaXMuX2F0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzXG4gICAgdGhpcy5faXNOZXdSZWNvcmQgPSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgdGhlIGdpdmVuIGF0dHJpYnV0ZXMgdG8gdGhlIHJlY29yZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXNUb0Fzc2lnbiAtIEF0dHJpYnV0ZXMgdG8gYXNzaWduLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhc3NpZ24oYXR0cmlidXRlc1RvQXNzaWduKSB7XG4gICAgdGhpcy5fYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyB8fD0gbmV3IFNldCgpXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVUb0Fzc2lnbiBpbiBhdHRyaWJ1dGVzVG9Bc3NpZ24pIHtcbiAgICAgIHRoaXMuX2Fzc2lnbmVkQXR0cmlidXRlTmFtZXMuYWRkKGF0dHJpYnV0ZVRvQXNzaWduKVxuICAgICAgdGhpcy5zZXRBdHRyaWJ1dGUoYXR0cmlidXRlVG9Bc3NpZ24sIGF0dHJpYnV0ZXNUb0Fzc2lnblthdHRyaWJ1dGVUb0Fzc2lnbl0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSB0aGUgY3VycmVudCBhdHRyaWJ1dGVzIG9mIHRoZSByZWNvcmQgKG9yaWdpbmFsIGF0dHJpYnV0ZXMgZnJvbSBkYXRhYmFzZSBwbHVzIGNoYW5nZXMpXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBhdHRyaWJ1dGVzKCkge1xuICAgIGNvbnN0IGRhdGEgPSB0aGlzLnJhd0F0dHJpYnV0ZXMoKVxuICAgIGNvbnN0IGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcbiAgICAvKipcbiAgICAgKiBBdHRyaWJ1dGVzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGNvbHVtbk5hbWUgaW4gZGF0YSkge1xuICAgICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVbY29sdW1uTmFtZV0gfHwgY29sdW1uTmFtZVxuXG4gICAgICBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdGhpcy5yZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGNvbHVtbi1uYW1lIGtleWVkIGRhdGEgKG9yaWdpbmFsIGF0dHJpYnV0ZXMgZnJvbSBkYXRhYmFzZSBwbHVzIGNoYW5nZXMpXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gVGhlIHJhdyBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgcmF3QXR0cmlidXRlcygpIHtcbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fYXR0cmlidXRlcywgdGhpcy5fY2hhbmdlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgY29ubmVjdGlvbi5cbiAgICovXG4gIF9jb25uZWN0aW9uKCkge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbikgcmV0dXJuIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLmNvbm5lY3Rpb24oKVxuICAgIGlmICh0aGlzLl9fY29ubmVjdGlvbikgcmV0dXJuIHRoaXMuX19jb25uZWN0aW9uXG5cbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuY29ubmVjdGlvbigpXG5cbiAgICBpZiAodGhpcy5fZGF0YWJhc2VJZGVudGl0eSkgdGhpcy5jYXB0dXJlRGF0YWJhc2VJZGVudGl0eSh0aGlzLl9kYXRhYmFzZUlkZW50aXR5Rm9yQ29ubmVjdGlvbihjb25uZWN0aW9uKSlcblxuICAgIHJldHVybiBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGlkZW50aXR5IG9mIGFuIGFscmVhZHkgc2VsZWN0ZWQgY29uY3JldGUgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIENvbmNyZXRlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5LlxuICAgKi9cbiAgX2RhdGFiYXNlSWRlbnRpdHlGb3JDb25uZWN0aW9uKGNvbm5lY3Rpb24pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgY29uc3QgcmV1c2VLZXkgPSBtb2RlbENsYXNzXG4gICAgICAuX2dldENvbmZpZ3VyYXRpb24oKVxuICAgICAgLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgICAuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleShjb25uZWN0aW9uKVxuXG4gICAgcmV0dXJuIGAke2RhdGFiYXNlSWRlbnRpZmllcn06JHtyZXVzZUtleX1gXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY29ubmVjdGlvbiB0aGF0IG93bnMgdGhpcyByZWNvcmQncyBkYXRhYmFzZSB3b3JrLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gQ29ubmVjdGlvbi5cbiAgICovXG4gIGNvbm5lY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Nvbm5lY3Rpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyBkZXBlbmRlbnQgcmVjb3JkcyBmb3IgYSBgZGVwZW5kZW50OiBcInJlc3RyaWN0XCJgIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtSZXN0cmljdEluc3RhbmNlUmVsYXRpb25zaGlwfSBpbnN0YW5jZVJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZSB0byBjb3VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBEZXBlbmRlbnQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX2RlcGVuZGVudFJlc3RyaWN0Q291bnQoaW5zdGFuY2VSZWxhdGlvbnNoaXApIHtcbiAgICBjb25zdCBUYXJnZXRNb2RlbENsYXNzID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIVRhcmdldE1vZGVsQ2xhc3MgfHwgIVRhcmdldE1vZGVsQ2xhc3MuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSkge1xuICAgICAgcmV0dXJuIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLnF1ZXJ5KCkuY291bnQoKVxuICAgIH1cblxuICAgIGlmICh0aGlzLmdldE1vZGVsQ2xhc3MoKS5oYXNUZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlcigpKSB7XG4gICAgICByZXR1cm4gYXdhaXQgaW5zdGFuY2VSZWxhdGlvbnNoaXAucXVlcnkoKS5jb3VudCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX2RlcGVuZGVudFJlc3RyaWN0VGVuYW50Q291bnQoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MpXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIHRlbmFudC1zY29wZWQgZGVwZW5kZW50IHJlY29yZHMgYWNyb3NzIGFsbCBwcm92aWRlci1saXN0ZWQgdGVuYW50cy5cbiAgICogQHBhcmFtIHtSZXN0cmljdEluc3RhbmNlUmVsYXRpb25zaGlwfSBpbnN0YW5jZVJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZSB0byBjb3VudC5cbiAgICogQHBhcmFtIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IFRhcmdldE1vZGVsQ2xhc3MgLSBSZWxhdGVkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIERlcGVuZGVudCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfZGVwZW5kZW50UmVzdHJpY3RUZW5hbnRDb3VudChpbnN0YW5jZVJlbGF0aW9uc2hpcCwgVGFyZ2V0TW9kZWxDbGFzcykge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgdGVuYW50RGF0YWJhc2VQcm92aWRlcnMgPSBjb25maWd1cmF0aW9uLmdldFRlbmFudERhdGFiYXNlUHJvdmlkZXJzKClcbiAgICBjb25zdCBwcm92aWRlckVudHJpZXMgPSBPYmplY3QuZW50cmllcyh0ZW5hbnREYXRhYmFzZVByb3ZpZGVycylcbiAgICBjb25zdCB0YXJnZXRJZGVudGlmaWVyID0gVGFyZ2V0TW9kZWxDbGFzcy5nZXRUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIobnVsbClcblxuICAgIGlmIChwcm92aWRlckVudHJpZXMubGVuZ3RoID09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGNoZWNrIGRlcGVuZGVudCAke2luc3RhbmNlUmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcCgpLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gYmVjYXVzZSAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9IHN3aXRjaGVzIHRlbmFudCBkYXRhYmFzZXMgYnV0IG5vIHRlbmFudCBkYXRhYmFzZSBwcm92aWRlcnMgYXJlIGNvbmZpZ3VyZWRgKVxuICAgIH1cblxuICAgIGlmICh0YXJnZXRJZGVudGlmaWVyKSB7XG4gICAgICBjb25zdCBwcm92aWRlciA9IHRlbmFudERhdGFiYXNlUHJvdmlkZXJzW3RhcmdldElkZW50aWZpZXJdXG5cbiAgICAgIGlmICghcHJvdmlkZXIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgY2hlY2sgZGVwZW5kZW50ICR7aW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfSBiZWNhdXNlICR7VGFyZ2V0TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gc3dpdGNoZXMgdGVuYW50IGRhdGFiYXNlICR7dGFyZ2V0SWRlbnRpZmllcn0gYnV0IG5vIHRlbmFudCBkYXRhYmFzZSBwcm92aWRlciBpcyBjb25maWd1cmVkIGZvciAke3RhcmdldElkZW50aWZpZXJ9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX2RlcGVuZGVudFJlc3RyaWN0UHJvdmlkZXJDb3VudChpbnN0YW5jZVJlbGF0aW9uc2hpcCwgVGFyZ2V0TW9kZWxDbGFzcywgdGFyZ2V0SWRlbnRpZmllciwgcHJvdmlkZXIpXG4gICAgfVxuXG4gICAgbGV0IG1hdGNoaW5nUHJvdmlkZXJTZWVuID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgW2lkZW50aWZpZXIsIHByb3ZpZGVyXSBvZiBwcm92aWRlckVudHJpZXMpIHtcbiAgICAgIGNvbnN0IHRlbmFudHMgPSBhd2FpdCB0aGlzLl9kZXBlbmRlbnRSZXN0cmljdFByb3ZpZGVyVGVuYW50cyhpbnN0YW5jZVJlbGF0aW9uc2hpcCwgVGFyZ2V0TW9kZWxDbGFzcywgaWRlbnRpZmllciwgcHJvdmlkZXIpXG5cbiAgICAgIGZvciAoY29uc3QgdGVuYW50IG9mIHRlbmFudHMpIHtcbiAgICAgICAgaWYgKFRhcmdldE1vZGVsQ2xhc3MuZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKHRlbmFudCkgIT0gaWRlbnRpZmllcikge1xuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBtYXRjaGluZ1Byb3ZpZGVyU2VlbiA9IHRydWVcblxuICAgICAgICBjb25zdCBjb3VudCA9IGF3YWl0IGNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBpZiAoIWNvbmZpZ3VyYXRpb24uaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUoaWRlbnRpZmllcikpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIgJHtpZGVudGlmaWVyfSBpcyBpbmFjdGl2ZSB3aGlsZSBjaGVja2luZyBkZXBlbmRlbnQgJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9YClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW2lkZW50aWZpZXJdLCBuYW1lOiBgRGVwZW5kZW50IHJlc3RyaWN0IGNvdW50OiAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBpbnN0YW5jZVJlbGF0aW9uc2hpcC5xdWVyeSgpLmNvdW50KClcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChjb3VudCA+IDApIHJldHVybiBjb3VudFxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghbWF0Y2hpbmdQcm92aWRlclNlZW4pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGNoZWNrIGRlcGVuZGVudCAke2luc3RhbmNlUmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcCgpLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gYmVjYXVzZSBubyB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgbWF0Y2hlZCAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gMFxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyB0ZW5hbnQtc2NvcGVkIGRlcGVuZGVudCByZWNvcmRzIGZvciBvbmUgY29uZmlndXJlZCB0ZW5hbnQgcHJvdmlkZXIuXG4gICAqIEBwYXJhbSB7UmVzdHJpY3RJbnN0YW5jZVJlbGF0aW9uc2hpcH0gaW5zdGFuY2VSZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UgdG8gY291bnQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBUYXJnZXRNb2RlbENsYXNzIC0gUmVsYXRlZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBUZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtUZW5hbnREYXRhYmFzZVByb3ZpZGVyVHlwZX0gcHJvdmlkZXIgLSBUZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gRGVwZW5kZW50IHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIF9kZXBlbmRlbnRSZXN0cmljdFByb3ZpZGVyQ291bnQoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MsIGlkZW50aWZpZXIsIHByb3ZpZGVyKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCB0ZW5hbnRzID0gYXdhaXQgdGhpcy5fZGVwZW5kZW50UmVzdHJpY3RQcm92aWRlclRlbmFudHMoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MsIGlkZW50aWZpZXIsIHByb3ZpZGVyKVxuXG4gICAgZm9yIChjb25zdCB0ZW5hbnQgb2YgdGVuYW50cykge1xuICAgICAgY29uc3QgY291bnQgPSBhd2FpdCBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQodGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmICghY29uZmlndXJhdGlvbi5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZShpZGVudGlmaWVyKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIgJHtpZGVudGlmaWVyfSBpcyBpbmFjdGl2ZSB3aGlsZSBjaGVja2luZyBkZXBlbmRlbnQgJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9YClcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBbaWRlbnRpZmllcl0sIG5hbWU6IGBEZXBlbmRlbnQgcmVzdHJpY3QgY291bnQ6ICR7VGFyZ2V0TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBpbnN0YW5jZVJlbGF0aW9uc2hpcC5xdWVyeSgpLmNvdW50KClcbiAgICAgICAgfSlcbiAgICAgIH0pXG5cbiAgICAgIGlmIChjb3VudCA+IDApIHJldHVybiBjb3VudFxuICAgIH1cblxuICAgIHJldHVybiAwXG4gIH1cblxuICAvKipcbiAgICogTGlzdHMgcmVzdHJpY3QtY2hlY2sgdGVuYW50cyBmb3Igb25lIGNvbmZpZ3VyZWQgdGVuYW50IHByb3ZpZGVyLlxuICAgKiBAcGFyYW0ge1Jlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXB9IGluc3RhbmNlUmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlIHRvIGNvdW50LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gVGFyZ2V0TW9kZWxDbGFzcyAtIFJlbGF0ZWQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gVGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7VGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGV9IHByb3ZpZGVyIC0gVGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIExpc3RlZCB0ZW5hbnQgb2JqZWN0cy5cbiAgICovXG4gIGFzeW5jIF9kZXBlbmRlbnRSZXN0cmljdFByb3ZpZGVyVGVuYW50cyhpbnN0YW5jZVJlbGF0aW9uc2hpcCwgVGFyZ2V0TW9kZWxDbGFzcywgaWRlbnRpZmllciwgcHJvdmlkZXIpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuX2dldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGxpc3RUZW5hbnRzID0gdHlwZW9mIHByb3ZpZGVyLmxpc3RSZXN0cmljdFRlbmFudHMgPT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHByb3ZpZGVyLmxpc3RSZXN0cmljdFRlbmFudHNcbiAgICAgIDogcHJvdmlkZXIubGlzdFRlbmFudHNcbiAgICBjb25zdCBsaXN0VGVuYW50c01ldGhvZE5hbWUgPSB0eXBlb2YgcHJvdmlkZXIubGlzdFJlc3RyaWN0VGVuYW50cyA9PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gXCJsaXN0UmVzdHJpY3RUZW5hbnRzXCJcbiAgICAgIDogXCJsaXN0VGVuYW50c1wiXG5cbiAgICBpZiAodHlwZW9mIGxpc3RUZW5hbnRzICE9IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgZm9yICR7aWRlbnRpZmllcn0gbXVzdCBkZWZpbmUgbGlzdFRlbmFudHMgb3IgbGlzdFJlc3RyaWN0VGVuYW50cyBiZWZvcmUgZGVwZW5kZW50IHJlc3RyaWN0IGNhbiBjaGVjayAke2luc3RhbmNlUmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcCgpLmdldFJlbGF0aW9uc2hpcE5hbWUoKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHRlbmFudHMgPSBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBgRGVwZW5kZW50IHJlc3RyaWN0IHRlbmFudHM6ICR7VGFyZ2V0TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGxpc3RUZW5hbnRzKHtcbiAgICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgICAgaWRlbnRpZmllclxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHRlbmFudHMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCBkYXRhYmFzZSBwcm92aWRlciBmb3IgJHtpZGVudGlmaWVyfSBtdXN0IHJldHVybiBhbiBhcnJheSBmcm9tICR7bGlzdFRlbmFudHNNZXRob2ROYW1lfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRlbmFudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXN0cm95cyB0aGUgcmVjb3JkIGluIHRoZSBkYXRhYmFzZSBhbmQgYWxsIG9mIGl0cyBkZXBlbmRlbnQgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGRlc3Ryb3koKSB7XG4gICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYmVmb3JlRGVzdHJveVwiKVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXAgb2YgdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0UmVsYXRpb25zaGlwcygpKSB7XG4gICAgICBpZiAocmVsYXRpb25zaGlwLmdldERlcGVuZGVudCgpID09IFwicmVzdHJpY3RcIikge1xuICAgICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IC8qKiBAdHlwZSB7UmVzdHJpY3RJbnN0YW5jZVJlbGF0aW9uc2hpcH0gKi8gKHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCkpKVxuICAgICAgICBjb25zdCBjb3VudCA9IGF3YWl0IHRoaXMuX2RlcGVuZGVudFJlc3RyaWN0Q291bnQoaW5zdGFuY2VSZWxhdGlvbnNoaXApXG5cbiAgICAgICAgaWYgKGNvdW50ID4gMCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGRlbGV0ZSByZWNvcmQgYmVjYXVzZSBkZXBlbmRlbnQgJHtyZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfSBleGlzdGApXG4gICAgICAgIH1cblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwLmdldERlcGVuZGVudCgpICE9IFwiZGVzdHJveVwiKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKSlcblxuICAgICAgLyoqXG4gICAgICAgKiBEZWZpbmVzIG1vZGVscy5cbiAgICAgICAqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZFtdfSAqL1xuICAgICAgbGV0IG1vZGVsc1xuXG4gICAgICBpZiAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09IFwiYmVsb25nc1RvXCIpIHtcbiAgICAgICAgaWYgKCFpbnN0YW5jZVJlbGF0aW9uc2hpcC5pc0xvYWRlZCgpKSB7XG4gICAgICAgICAgYXdhaXQgaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZCgpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBtb2RlbCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICAgICAgaWYgKG1vZGVsIGluc3RhbmNlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQpIHtcbiAgICAgICAgICBtb2RlbHMgPSBbbW9kZWxdXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIGxvYWRlZCB0eXBlOiAke3R5cGVvZiBtb2RlbH1gKVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc01hbnlcIikge1xuICAgICAgICBpZiAoIWluc3RhbmNlUmVsYXRpb25zaGlwLmlzTG9hZGVkKCkpIHtcbiAgICAgICAgICBhd2FpdCBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkKClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGxvYWRlZE1vZGVscyA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZGVkTW9kZWxzKSkge1xuICAgICAgICAgIG1vZGVscyA9IGxvYWRlZE1vZGVsc1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBsb2FkZWQgdHlwZTogJHt0eXBlb2YgbG9hZGVkTW9kZWxzfWApXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09IFwiaGFzT25lXCIpIHtcbiAgICAgICAgaWYgKCFpbnN0YW5jZVJlbGF0aW9uc2hpcC5pc0xvYWRlZCgpKSB7XG4gICAgICAgICAgYXdhaXQgaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZCgpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsb2FkZWRNb2RlbCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICAgICAgaWYgKGxvYWRlZE1vZGVsIGluc3RhbmNlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQpIHtcbiAgICAgICAgICBtb2RlbHMgPSBbbG9hZGVkTW9kZWxdXG4gICAgICAgIH0gZWxzZSBpZiAobG9hZGVkTW9kZWwgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIG1vZGVscyA9IFtdXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIGxvYWRlZCB0eXBlOiAke3R5cGVvZiBsb2FkZWRNb2RlbH1gKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuaGFuZGxlZCByZWxhdGlvbnNoaXAgdHlwZTogJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCl9YClcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBtb2RlbCBvZiBtb2RlbHMpIHtcbiAgICAgICAgaWYgKG1vZGVsLmlzUGVyc2lzdGVkKCkpIHtcbiAgICAgICAgICBhd2FpdCBtb2RlbC5kZXN0cm95KClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENvbmRpdGlvbnMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBjb25kaXRpb25zID0ge31cblxuICAgIE9iamVjdC5hc3NpZ24oY29uZGl0aW9ucywgbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyh0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KCksIHRoaXMuX3BlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpKSlcblxuICAgIGNvbnN0IHNxbCA9IHRoaXMuX2Nvbm5lY3Rpb24oKS5kZWxldGVTcWwoe1xuICAgICAgY29uZGl0aW9ucyxcbiAgICAgIHRhYmxlTmFtZTogdGhpcy5fdGFibGVOYW1lKClcbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5fY29ubmVjdGlvbigpLnF1ZXJ5KHNxbCwge2xvZ05hbWU6IGAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9IERlc3Ryb3lgfSlcbiAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJhZnRlckRlc3Ryb3lcIilcbiAgICBhd2FpdCB0aGlzLl9lbWl0UmVjb3JkQ2hhbmdlQWZ0ZXJDb21taXQoXCJkZXN0cm95XCIpXG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgYSBjb21taXR0ZWQgcmVjb3JkLWNoYW5nZSBldmVudCBhZnRlciB0aGUgc3Vycm91bmRpbmcgdHJhbnNhY3Rpb25cbiAgICogY29tbWl0cywgc28gbGl2ZSBxdWVyaWVzIHJlLXJ1biB1bmlmb3JtbHkgZm9yIGxvY2FsIHdyaXRlcywgcHVsbCBhcHBsaWVzLCBhbmRcbiAgICogcmVhbHRpbWUgYXBwbGllcyAod2hpY2ggYWxsIGVuZCBhcyBsb2NhbCBzYXZlcy9kZXN0cm95cykuIFJlZ2lzdGVyZWQgdGhyb3VnaFxuICAgKiB0aGUgY29ubmVjdGlvbidzIGFmdGVyQ29tbWl0IGhvb2sgc28gYSByb2xsZWQtYmFjayBzYXZlIGVtaXRzIG5vdGhpbmcsIGFuZFxuICAgKiBza2lwcGVkIGVudGlyZWx5IHdoZW4gbm90aGluZyBvYnNlcnZlcyB0aGlzIG1vZGVsIGNsYXNzIHNvIHNlcnZlci1zaWRlIHNhdmVzXG4gICAqIHN0YXkgZnJlZSBvZiBsaXZlLXF1ZXJ5IG92ZXJoZWFkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3JlY29yZC1jaGFuZ2VzLmpzXCIpLlJlY29yZENoYW5nZU9wZXJhdGlvbn0gb3BlcmF0aW9uIC0gVGhlIGNvbW1pdHRlZCBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2VtaXRSZWNvcmRDaGFuZ2VBZnRlckNvbW1pdChvcGVyYXRpb24pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5nZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghcmVjb3JkQ2hhbmdlcy5oYXNMaXN0ZW5lcnMobW9kZWxDbGFzcykpIHJldHVyblxuXG4gICAgY29uc3QgcmVjb3JkID0gdGhpc1xuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpdHkgPSB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvblxuICAgICAgPyB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi5kYXRhYmFzZUlkZW50aXR5KClcbiAgICAgIDogdGhpcy5fZGF0YWJhc2VJZGVudGl0eUZvckNvbm5lY3Rpb24odGhpcy5fY29ubmVjdGlvbigpKVxuXG4gICAgdGhpcy5jYXB0dXJlRGF0YWJhc2VJZGVudGl0eShkYXRhYmFzZUlkZW50aXR5KVxuXG4gICAgYXdhaXQgdGhpcy5fY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KCgpID0+IHtcbiAgICAgIHJlY29yZENoYW5nZXMuZW1pdCh7ZGF0YWJhc2VJZGVudGl0eSwgbW9kZWxDbGFzcywgb3BlcmF0aW9uLCByZWNvcmR9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU3RvcmVzIGFuIGF1ZGl0IHJvdyBmb3IgdGhpcyByZWNvcmQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hdWRpdGluZy5qc1wiKS5DcmVhdGVBdWRpdEFyZ3N9IGFyZ3MgLSBBdWRpdCByb3cgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyIHwgc3RyaW5nPn0gQ3JlYXRlZCBhdWRpdCByb3cgaWQuXG4gICAqL1xuICBhc3luYyBjcmVhdGVBdWRpdChhcmdzKSB7XG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUF1ZGl0KHRoaXMsIGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgY3JlYXRlIGNoYW5nZXMgYmVmb3JlIHBlcnNpc3RlbmNlIGNsZWFycyB0aGUgY2hhbmdlIHNldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjYXB0dXJlQ3JlYXRlQXVkaXRDaGFuZ2VzKCkge1xuICAgIGNhcHR1cmVDcmVhdGVBdWRpdENoYW5nZXModGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZXMgdGhlIGNyZWF0ZSBhdWRpdCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgY3JlYXRlQ3JlYXRlQXVkaXQoKSB7XG4gICAgYXdhaXQgY3JlYXRlQ3JlYXRlQXVkaXQodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyB1cGRhdGUgY2hhbmdlcyBiZWZvcmUgcGVyc2lzdGVuY2UgY2xlYXJzIHRoZSBjaGFuZ2Ugc2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNhcHR1cmVVcGRhdGVBdWRpdENoYW5nZXMoKSB7XG4gICAgY2FwdHVyZVVwZGF0ZUF1ZGl0Q2hhbmdlcyh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFdyaXRlcyB0aGUgdXBkYXRlIGF1ZGl0IHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBjcmVhdGVVcGRhdGVBdWRpdCgpIHtcbiAgICBhd2FpdCBjcmVhdGVVcGRhdGVBdWRpdCh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFdyaXRlcyB0aGUgZGVzdHJveSBhdWRpdCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgY3JlYXRlRGVzdHJveUF1ZGl0KCkge1xuICAgIGF3YWl0IGNyZWF0ZURlc3Ryb3lBdWRpdCh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGxpZmVjeWNsZSBjYWxsYmFja3MuXG4gICAqIEBwYXJhbSB7XCJhZnRlckNyZWF0ZVwiIHwgXCJhZnRlckRlc3Ryb3lcIiB8IFwiYWZ0ZXJTYXZlXCIgfCBcImFmdGVyVXBkYXRlXCIgfCBcImJlZm9yZUNyZWF0ZVwiIHwgXCJiZWZvcmVEZXN0cm95XCIgfCBcImJlZm9yZVNhdmVcIiB8IFwiYmVmb3JlVXBkYXRlXCIgfCBcImJlZm9yZVZhbGlkYXRpb25cIn0gY2FsbGJhY2tOYW1lIC0gQ2FsbGJhY2sgdHlwZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKGNhbGxiYWNrTmFtZSkge1xuICAgIGNvbnN0IGNhbGxiYWNrcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldExpZmVjeWNsZUNhbGxiYWNrc01hcCgpW2NhbGxiYWNrTmFtZV0gfHwgW11cbiAgICBsZXQgY2FsbGJhY2tOYW1lUmVnaXN0ZXJlZEFzU3RyaW5nID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgY2FsbGJhY2tzKSB7XG4gICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgaWYgKGNhbGxiYWNrID09IGNhbGxiYWNrTmFtZSkge1xuICAgICAgICAgIGNhbGxiYWNrTmFtZVJlZ2lzdGVyZWRBc1N0cmluZyA9IHRydWVcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuICAgICAgICBjb25zdCBtZXRob2RDYWxsYmFjayA9IGR5bmFtaWNUaGlzW2NhbGxiYWNrXVxuXG4gICAgICAgIGlmICh0eXBlb2YgbWV0aG9kQ2FsbGJhY2sgIT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBMaWZlY3ljbGUgY2FsbGJhY2sgXCIke2NhbGxiYWNrfVwiIGlzIG5vdCBhIGZ1bmN0aW9uIG9uICR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgbWV0aG9kQ2FsbGJhY2suY2FsbCh0aGlzKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgY2FsbGJhY2sodGhpcylcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuICAgIGNvbnN0IGluc3RhbmNlQ2FsbGJhY2sgPSBkeW5hbWljVGhpc1tjYWxsYmFja05hbWVdXG5cbiAgICBpZiAoIWNhbGxiYWNrTmFtZVJlZ2lzdGVyZWRBc1N0cmluZyAmJiB0eXBlb2YgaW5zdGFuY2VDYWxsYmFjayA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBhd2FpdCBpbnN0YW5jZUNhbGxiYWNrLmNhbGwodGhpcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgY2hhbmdlcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBjaGFuZ2VzLlxuICAgKi9cbiAgX2hhc0NoYW5nZXMoKSB7IHJldHVybiBPYmplY3Qua2V5cyh0aGlzLl9jaGFuZ2VzKS5sZW5ndGggPiAwIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0cnVlIGlmIHRoZSBtb2RlbCBoYXMgYmVlbiBjaGFuZ2VkIHNpbmNlIGl0IHdhcyBsb2FkZWQgZnJvbSB0aGUgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgY2hhbmdlZC5cbiAgICovXG4gIGlzQ2hhbmdlZCgpIHtcbiAgICBpZiAodGhpcy5pc05ld1JlY29yZCgpIHx8IHRoaXMuX2hhc0NoYW5nZXMoKSl7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIC8vIENoZWNrIGlmIGEgbG9hZGVkIHN1Yi1tb2RlbCBvZiBhIHJlbGF0aW9uc2hpcCBpcyBjaGFuZ2VkIGFuZCBzaG91bGQgYmUgc2F2ZWQgYWxvbmcgd2l0aCB0aGlzIG1vZGVsLlxuICAgIGlmICh0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGZvciAoY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXBOYW1lIGluIHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcykge1xuICAgICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwc1tpbnN0YW5jZVJlbGF0aW9uc2hpcE5hbWVdXG4gICAgICAgIGxldCBsb2FkZWQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5fbG9hZGVkXG5cbiAgICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldEF1dG9TYXZlKCkgPT09IGZhbHNlKSB7XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghbG9hZGVkKSBjb250aW51ZVxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkobG9hZGVkKSkgbG9hZGVkID0gW2xvYWRlZF1cblxuICAgICAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIGxvYWRlZCkge1xuICAgICAgICAgIGlmIChtb2RlbC5pc0NoYW5nZWQoKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjaGFuZ2VzIHRoYXQgaGF2ZSBiZWVuIG1hZGUgdG8gdGhpcyByZWNvcmQgc2luY2UgaXQgd2FzIGxvYWRlZCBmcm9tIHRoZSBkYXRhYmFzZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gVGhlIGNoYW5nZXMuXG4gICAqL1xuICBjaGFuZ2VzKCkge1xuICAgIC8qKlxuICAgICAqIENoYW5nZXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgY29uc3QgY2hhbmdlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGNoYW5nZUtleSBpbiB0aGlzLl9jaGFuZ2VzKSB7XG4gICAgICBjb25zdCBjaGFuZ2VWYWx1ZSA9IHRoaXMuX2NoYW5nZXNbY2hhbmdlS2V5XVxuXG4gICAgICBjaGFuZ2VzW2NoYW5nZUtleV0gPSBbdGhpcy5fYXR0cmlidXRlc1tjaGFuZ2VLZXldLCBjaGFuZ2VWYWx1ZV1cbiAgICB9XG5cbiAgICByZXR1cm4gY2hhbmdlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgdGFibGUgbmFtZS5cbiAgICovXG4gIF90YWJsZU5hbWUoKSB7XG4gICAgaWYgKHRoaXMuX190YWJsZU5hbWUpIHJldHVybiB0aGlzLl9fdGFibGVOYW1lXG5cbiAgICByZXR1cm4gdGhpcy5nZXRNb2RlbENsYXNzKCkudGFibGVOYW1lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBhbiBhdHRyaWJ1dGUgdmFsdWUgZnJvbSB0aGUgcmVjb3JkLiBSZWFkIGR5bmFtaWNhbGx5IGJ5IG5hbWUsIHNvIHRoZSB2YWx1ZSBjYW4gYmUgYW55XG4gICAqIGNvbHVtbiB0eXBlIGFuZCBtYXkgYmUgb3ZlcnJpZGRlbiBieSBhIHVzZXItZGVmaW5lZCBnZXR0ZXIgb24gdGhlIG1vZGVsLlxuICAgKiBAdGVtcGxhdGUgVlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSBUaGUgbmFtZSBvZiB0aGUgYXR0cmlidXRlIHRvIHJlYWQuIFRoaXMgaXMgdGhlIGF0dHJpYnV0ZSBuYW1lLCBub3QgdGhlIGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7Vn0gVGhlIGF0dHJpYnV0ZSB2YWx1ZSwgdHlwZWQgYnkgdGhlIGNhbGxlcidzIGFjY2Vzc29yIGNvbnRyYWN0LlxuICAgKi9cbiAgcmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSB7XG4gICAgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgY29uc3QgbWFwID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG4gICAgY29uc3QgcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSlcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID8gbWFwW3Jlc29sdmVkQXR0cmlidXRlTmFtZV0gOiB1bmRlZmluZWRcblxuICAgIGlmICghY29sdW1uTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCBmaWd1cmUgb3V0IGNvbHVtbiBuYW1lIGZvciBhdHRyaWJ1dGU6ICR7YXR0cmlidXRlTmFtZX0gZnJvbSB0aGVzZSBtYXBwaW5nczogJHtPYmplY3Qua2V5cyhtYXApLmpvaW4oXCIsIFwiKX1gKVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7Vn0gKi8gKHRoaXMucmVhZENvbHVtbihjb2x1bW5OYW1lKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGFuIGFzc29jaWF0aW9uIGNvdW50IGF0dGFjaGVkIGJ5IGAud2l0aENvdW50KC4uLilgLiBDb3VudHMgYXJlXG4gICAqIHN0b3JlZCBvbiBhIHNlcGFyYXRlIG1hcCBmcm9tIHRoZSByZWNvcmQncyBgX2F0dHJpYnV0ZXNgIHNvIGFcbiAgICogdmlydHVhbCBjb3VudCBsaWtlIGB0YXNrc0NvdW50YCBjYW5ub3Qgc2lsZW50bHkgc2hhZG93IGEgcmVhbFxuICAgKiBjb2x1bW4gb2YgdGhlIHNhbWUgbmFtZS4gUmV0dXJucyB0aGUgYXR0YWNoZWQgbnVtYmVyLCBvciAwIHdoZW5cbiAgICogYC53aXRoQ291bnQoLi4uKWAgd2Fzbid0IHJlcXVlc3RlZCBmb3IgdGhpcyBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUsIGUuZy4gYFwidGFza3NDb3VudFwiYCBvciBhIGN1c3RvbSBgXCJhY3RpdmVNZW1iZXJzQ291bnRcImAgZnJvbSBgLndpdGhDb3VudCh7YWN0aXZlTWVtYmVyc0NvdW50OiB7Li4ufX0pYC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBBdHRhY2hlZCBhc3NvY2lhdGlvbiBjb3VudCwgb3IgemVybyB3aGVuIGFic2VudC5cbiAgICovXG4gIHJlYWRDb3VudChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgcmV0dXJuIHJlYWRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCgvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRhY2ggYW4gYXNzb2NpYXRpb24gY291bnQgdG8gdGhpcyByZWNvcmQuIEludGVybmFsIGhlbHBlciB1c2VkIGJ5XG4gICAqIHRoZSBgd2l0aENvdW50YCBydW5uZXI7IG91dHNpZGUgY29kZSBzaG91bGQgbm90IGNhbGwgdGhpcyBkaXJlY3RseS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gQ291bnQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldEFzc29jaWF0aW9uQ291bnQoYXR0cmlidXRlTmFtZSwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCgvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYXR0cmlidXRlTmFtZSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogQWxsIGF0dGFjaGVkIGFzc29jaWF0aW9uIGNvdW50cyBhcyBhIHBsYWluIG9iamVjdC4gVXNlZCBieSB0aGVcbiAgICogZnJvbnRlbmQtbW9kZWwgc2VyaWFsaXplciB0byBzaGlwIGNvdW50cyBhbG9uZ3NpZGUgdGhlIHJlY29yZFxuICAgKiBhdHRyaWJ1dGVzIG9uIHRoZSB3aXJlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gLSBBc3NvY2lhdGlvbiBjb3VudHMga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBhc3NvY2lhdGlvbkNvdW50cygpIHtcbiAgICAvKipcbiAgICAgKiBSZXN1bHQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgcmVzdWx0ID0ge31cblxuICAgIGNvbnN0IHRhcmdldCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG5cbiAgICBpZiAoIXRhcmdldC5fYXNzb2NpYXRpb25Db3VudHMpIHJldHVybiByZXN1bHRcblxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiB0YXJnZXQuX2Fzc29jaWF0aW9uQ291bnRzKSB7XG4gICAgICByZXN1bHRbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGEgdmFsdWUgYXR0YWNoZWQgYnkgYC5xdWVyeURhdGEoLi4uKWAuIFN0b3JlZCBvbiBhIGRlZGljYXRlZFxuICAgKiBtYXAgcmF0aGVyIHRoYW4gb24gYF9hdHRyaWJ1dGVzYCwgc28gYSB2aXJ0dWFsIHF1ZXJ5RGF0YSBrZXkgbGlrZVxuICAgKiBgdHJhbnNwb3J0U2Vjb25kc1N1bWAgY2Fubm90IHNpbGVudGx5IHNoYWRvdyBhIHJlYWwgY29sdW1uIG9mIHRoZVxuICAgKiBzYW1lIG5hbWUuIFJldHVybnMgYG51bGxgIHdoZW4gdGhlIGtleSB3YXNuJ3QgcHJvZHVjZWQgYnkgYW55XG4gICAqIHJlZ2lzdGVyZWQgZm4gZm9yIHRoaXMgcmVjb3JkIChlLmcuIG5vIGNoaWxkIHJvd3MgbWF0Y2hlZCB0aGVcbiAgICogYWdncmVnYXRlKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBxdWVyeURhdGEgYXR0cmlidXRlIG5hbWUgKG1hdGNoZXMgYSBTRUxFQ1QgYWxpYXMgZnJvbSB0aGUgcmVnaXN0ZXJlZCBmbikuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBBdHRhY2hlZCBxdWVyeS1kYXRhIHZhbHVlLlxuICAgKi9cbiAgcXVlcnlEYXRhKG5hbWUpIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRRdWVyeURhdGEoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogQXR0YWNoIGEgcXVlcnlEYXRhIHZhbHVlIHRvIHRoaXMgcmVjb3JkLiBJbnRlcm5hbCBoZWxwZXIgdXNlZCBieVxuICAgKiB0aGUgYHF1ZXJ5RGF0YWAgcnVubmVyIGFuZCBieSBmcm9udGVuZC1tb2RlbCBoeWRyYXRpb247IG91dHNpZGVcbiAgICogY29kZSBzaG91bGQgbm90IGNhbGwgdGhpcyBkaXJlY3RseS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBxdWVyeURhdGEgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gYXR0YWNoLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRRdWVyeURhdGEobmFtZSwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkUXVlcnlEYXRhKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBuYW1lLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBbGwgYXR0YWNoZWQgcXVlcnlEYXRhIHZhbHVlcyBhcyBhIHBsYWluIG9iamVjdC4gVXNlZCBieSB0aGVcbiAgICogZnJvbnRlbmQtbW9kZWwgc2VyaWFsaXplciB0byBzaGlwIHF1ZXJ5RGF0YSBhbG9uZ3NpZGUgdGhlIHJlY29yZFxuICAgKiBhdHRyaWJ1dGVzIG9uIHRoZSB3aXJlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFF1ZXJ5LWRhdGEgdmFsdWVzIGtleWVkIGJ5IG5hbWUuXG4gICAqL1xuICBxdWVyeURhdGFWYWx1ZXMoKSB7XG4gICAgLyoqXG4gICAgICogUmVzdWx0LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcmVzdWx0ID0ge31cblxuICAgIGNvbnN0IHRhcmdldCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG5cbiAgICBpZiAoIXRhcmdldC5fcXVlcnlEYXRhVmFsdWVzKSByZXR1cm4gcmVzdWx0XG5cbiAgICBmb3IgKGNvbnN0IFtuYW1lLCB2YWx1ZV0gb2YgdGFyZ2V0Ll9xdWVyeURhdGFWYWx1ZXMpIHtcbiAgICAgIHJlc3VsdFtuYW1lXSA9IHZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgYSBwZXItcmVjb3JkIGFiaWxpdHkgcmVzdWx0IGF0dGFjaGVkIGJ5IGAuYWJpbGl0aWVzKC4uLilgLiBUaGVcbiAgICogYmFja2VuZCBldmFsdWF0ZXMgZWFjaCByZXF1ZXN0ZWQgYWN0aW9uIGFnYWluc3QgdGhlIGN1cnJlbnQgYWJpbGl0eVxuICAgKiBmb3IgdGhpcyByZWNvcmQgaW5zdGFuY2UgYW5kIHNoaXBzIHRoZSByZXN1bHQgYWxvbmdzaWRlIHRoZVxuICAgKiByZWNvcmQncyBhdHRyaWJ1dGVzLiBSZXR1cm5zIGBmYWxzZWAgd2hlbiB0aGUgYWN0aW9uIHdhc24ndFxuICAgKiByZXF1ZXN0ZWQgZm9yIHRoaXMgcmVjb3JkIOKAlCBzbyBVSSBjb2RlIGNhbiBzYWZlbHkgYnJhbmNoIG9uXG4gICAqIGByZWNvcmQuY2FuKFwidXBkYXRlXCIpYCB3aXRob3V0IGZpcnN0IGNoZWNraW5nIHdoZXRoZXIgdGhlIGFiaWxpdHlcbiAgICogd2FzIGxvYWRlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEFiaWxpdHkgYWN0aW9uIG5hbWUsIGUuZy4gYFwidXBkYXRlXCJgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXF1ZXN0ZWQgYWJpbGl0eSBpcyBhbGxvd2VkLlxuICAgKi9cbiAgY2FuKGFjdGlvbikge1xuICAgIHJldHVybiByZWFkUGF5bG9hZENvbXB1dGVkQWJpbGl0eSgvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0dGFjaCBhIHBlci1yZWNvcmQgYWJpbGl0eSByZXN1bHQgdG8gdGhpcyByZWNvcmQuIEludGVybmFsIGhlbHBlclxuICAgKiB1c2VkIGJ5IHRoZSBgYWJpbGl0aWVzYCBydW5uZXIgYW5kIGJ5IGZyb250ZW5kLW1vZGVsIGh5ZHJhdGlvbjtcbiAgICogb3V0c2lkZSBjb2RlIHNob3VsZCBub3QgY2FsbCB0aGlzIGRpcmVjdGx5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24gbmFtZS5cbiAgICogQHBhcmFtIHtib29sZWFufSB2YWx1ZSAtIFdoZXRoZXIgdGhlIGN1cnJlbnQgYWJpbGl0eSBwZXJtaXRzIHRoZSBhY3Rpb24gb24gdGhpcyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldENvbXB1dGVkQWJpbGl0eShhY3Rpb24sIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZENvbXB1dGVkQWJpbGl0eSgvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYWN0aW9uLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBbGwgYXR0YWNoZWQgcGVyLXJlY29yZCBhYmlsaXR5IHJlc3VsdHMgYXMgYSBwbGFpbiBvYmplY3QuIFVzZWRcbiAgICogYnkgdGhlIGZyb250ZW5kLW1vZGVsIHNlcmlhbGl6ZXIgdG8gc2hpcCByZXN1bHRzIGFsb25nc2lkZSB0aGVcbiAgICogcmVjb3JkIGF0dHJpYnV0ZXMgb24gdGhlIHdpcmUuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gLSBBYmlsaXR5IHJlc3VsdHMga2V5ZWQgYnkgYWN0aW9uLlxuICAgKi9cbiAgY29tcHV0ZWRBYmlsaXRpZXMoKSB7XG4gICAgLyoqXG4gICAgICogUmVzdWx0LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gKi9cbiAgICBjb25zdCByZXN1bHQgPSB7fVxuXG4gICAgY29uc3QgdGFyZ2V0ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcblxuICAgIGlmICghdGFyZ2V0Ll9jb21wdXRlZEFiaWxpdGllcykgcmV0dXJuIHJlc3VsdFxuXG4gICAgZm9yIChjb25zdCBbYWN0aW9uLCB2YWx1ZV0gb2YgdGFyZ2V0Ll9jb21wdXRlZEFiaWxpdGllcykge1xuICAgICAgcmVzdWx0W2FjdGlvbl0gPSB2YWx1ZVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBhIGNvbHVtbiB2YWx1ZSBmcm9tIHRoZSByZWNvcmQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIFRoZSBuYW1lIG9mIHRoZSBjb2x1bW4gdG8gcmVhZC4gVGhpcyBpcyB0aGUgY29sdW1uIG5hbWUsIG5vdCB0aGUgYXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBUaGUgY29sdW1uLlxuICAgKi9cbiAgcmVhZENvbHVtbihhdHRyaWJ1dGVOYW1lKSB7XG4gICAgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgY29uc3QgYmVsb25nc1RvQ2hhbmdlcyA9IHRoaXMuX2JlbG9uZ3NUb0NoYW5nZXMoKVxuICAgIGxldCByZXN1bHRcblxuICAgIGlmIChhdHRyaWJ1dGVOYW1lIGluIGJlbG9uZ3NUb0NoYW5nZXMpIHtcbiAgICAgIHJlc3VsdCA9IGJlbG9uZ3NUb0NoYW5nZXNbYXR0cmlidXRlTmFtZV1cbiAgICB9IGVsc2UgaWYgKGF0dHJpYnV0ZU5hbWUgaW4gdGhpcy5fY2hhbmdlcykge1xuICAgICAgcmVzdWx0ID0gdGhpcy5fY2hhbmdlc1thdHRyaWJ1dGVOYW1lXVxuICAgIH0gZWxzZSBpZiAoYXR0cmlidXRlTmFtZSBpbiB0aGlzLl9hdHRyaWJ1dGVzKSB7XG4gICAgICByZXN1bHQgPSB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gICAgfSBlbHNlIGlmICh0aGlzLmlzUGVyc2lzdGVkKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBhdHRyaWJ1dGUgb3Igbm90IHNlbGVjdGVkICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSMke2F0dHJpYnV0ZU5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBjb2x1bW5UeXBlID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uVHlwZUJ5TmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgaWYgKGNvbHVtblR5cGUgJiYgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2lzRGF0ZUxpa2VUeXBlKGNvbHVtblR5cGUpKSB7XG4gICAgICByZXN1bHQgPSB0aGlzLl9ub3JtYWxpemVEYXRlVmFsdWVGb3JSZWFkKHJlc3VsdClcbiAgICB9XG5cbiAgICByZXN1bHQgPSB0aGlzLl9ub3JtYWxpemVCb29sZWFuVmFsdWVGb3JSZWFkKHtjb2x1bW5OYW1lOiBhdHRyaWJ1dGVOYW1lLCBjb2x1bW5UeXBlLCB2YWx1ZTogcmVzdWx0fSlcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbnkgZGVjbGFyZWQgcGVyLWF0dHJpYnV0ZSBjYXN0IGZvciBhIGRhdGFiYXNlIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIERhdGFiYXNlIGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIERlY2xhcmVkIGNhc3QgdHlwZSwgb3IgdW5kZWZpbmVkIHdoZW4gbm9uZSBpcyBkZWNsYXJlZC5cbiAgICovXG4gIF9kZWNsYXJlZEF0dHJpYnV0ZUNhc3RGb3JDb2x1bW4oY29sdW1uTmFtZSkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbY29sdW1uTmFtZV1cblxuICAgIGlmICghYXR0cmlidXRlTmFtZSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldEF0dHJpYnV0ZUNhc3QoYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIHN0b3JlZCB2YWx1ZSB0byBhIHJlYWwgYm9vbGVhbiBmb3IgYSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGNhc3QuXG4gICAqIExlYXZlcyBudWxsL3VuZGVmaW5lZCB1bnRvdWNoZWQ7IHRyZWF0cyAxL3RydWUvXCIxXCIgYXMgdHJ1ZSBhbmQgMC9mYWxzZS9cIjBcIiBhcyBmYWxzZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTdG9yZWQgZGF0YWJhc2UgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBDb252ZXJ0ZWQgYm9vbGVhbiwgb3IgdGhlIG9yaWdpbmFsIHZhbHVlIHdoZW4gbm90IHJlY29nbml6ZWQuXG4gICAqL1xuICBfY2FzdERlY2xhcmVkQm9vbGVhbkZvclJlYWQodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHZhbHVlXG4gICAgaWYgKGRlY2xhcmVkQm9vbGVhblRydXRoeVZhbHVlcy5oYXModmFsdWUpKSByZXR1cm4gdHJ1ZVxuICAgIGlmIChkZWNsYXJlZEJvb2xlYW5GYWxzeVZhbHVlcy5oYXModmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBjb2x1bW4gdmFsdWUgaXMgY3VycmVudGx5IGxvYWRlZCBvbiB0aGlzIHJlY29yZCAoZWl0aGVyIGFzIGFcbiAgICogcGVyc2lzdGVkIGF0dHJpYnV0ZSBvciBhIHBlbmRpbmcgY2hhbmdlKS4gVXNlZCB0byBkZWNpZGUgd2hldGhlciBhIHByZWxvYWRcbiAgICogY2FuIGJlIHNraXBwZWQgYmVjYXVzZSB0aGUgcmVxdWlyZWQgY29sdW1ucyBhcmUgYWxyZWFkeSBwcmVzZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIFRoZSBjb2x1bW4gbmFtZSB0byBjaGVjay5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY29sdW1uIGlzIGxvYWRlZC5cbiAgICovXG4gIGhhc0xvYWRlZENvbHVtbihjb2x1bW5OYW1lKSB7XG4gICAgcmV0dXJuIGNvbHVtbk5hbWUgaW4gdGhpcy5fY2hhbmdlcyB8fCBjb2x1bW5OYW1lIGluIHRoaXMuX2F0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBib29sZWFuIHZhbHVlIGZvciByZWFkLiBBIGRlY2xhcmVkIGBcImJvb2xlYW5cImAgYXR0cmlidXRlIGNhc3QgY29udmVydHMgdGhlXG4gICAqIHN0b3JlZCB2YWx1ZSAoZS5nLiBhbiBNU1NRTCBgYml0YCAwLzEpIHRvIGEgcmVhbCBib29sZWFuOyBvdGhlcndpc2UgdGhlIGV4aXN0aW5nXG4gICAqIGludHJvc3BlY3RlZC10eXBlIG5vcm1hbGl6YXRpb24gYXBwbGllcyAobm8gYmVoYXZpb3VyIGNoYW5nZSBmb3Igbm9uLWRlY2xhcmVkIGNvbHVtbnMpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5OYW1lIC0gRGF0YWJhc2UgY29sdW1uIG5hbWUgYmVpbmcgcmVhZC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGFyZ3MuY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIF9ub3JtYWxpemVCb29sZWFuVmFsdWVGb3JSZWFkKHtjb2x1bW5OYW1lLCBjb2x1bW5UeXBlLCB2YWx1ZX0pIHtcbiAgICBpZiAodGhpcy5fZGVjbGFyZWRBdHRyaWJ1dGVDYXN0Rm9yQ29sdW1uKGNvbHVtbk5hbWUpID09PSBcImJvb2xlYW5cIikge1xuICAgICAgcmV0dXJuIHRoaXMuX2Nhc3REZWNsYXJlZEJvb2xlYW5Gb3JSZWFkKHZhbHVlKVxuICAgIH1cblxuICAgIGlmICghY29sdW1uVHlwZSkgcmV0dXJuIHZhbHVlXG4gICAgaWYgKGNvbHVtblR5cGUudG9Mb3dlckNhc2UoKSAhPT0gXCJib29sZWFuXCIpIHJldHVybiB2YWx1ZVxuICAgIGlmICh2YWx1ZSA9PT0gMSkgcmV0dXJuIHRydWVcbiAgICBpZiAodmFsdWUgPT09IDApIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZGF0ZSB2YWx1ZSBmb3IgcmVhZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSBmcm9tIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIF9ub3JtYWxpemVEYXRlVmFsdWVGb3JSZWFkKHZhbHVlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZURhdGVWYWx1ZUZvclJlYWQodmFsdWUsIHtkYXRhYmFzZVR5cGU6IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldERhdGFiYXNlVHlwZSgpfSlcbiAgfVxuXG4gIF9iZWxvbmdzVG9DaGFuZ2VzKCkge1xuICAgIC8qKlxuICAgICAqIEJlbG9uZ3MgdG8gY2hhbmdlcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGJlbG9uZ3NUb0NoYW5nZXMgPSB7fVxuXG4gICAgaWYgKHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcykge1xuICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIGluIHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcykge1xuICAgICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgICBpZiAocmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImJlbG9uZ3NUb1wiICYmIHJlbGF0aW9uc2hpcC5nZXREaXJ0eSgpKSB7XG4gICAgICAgICAgY29uc3QgbW9kZWwgPSByZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKVxuXG4gICAgICAgICAgaWYgKG1vZGVsKSB7XG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShtb2RlbCkpIHRocm93IG5ldyBFcnJvcihcIlVuZXhwZWN0ZWQgYmVsb25ncy10byBtb2RlbCBhcnJheVwiKVxuXG4gICAgICAgICAgICBiZWxvbmdzVG9DaGFuZ2VzW3JlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KCldID0gdGhpcy5fYmVsb25nc1RvRm9yZWlnbktleVZhbHVlKHttb2RlbCwgcmVsYXRpb25zaGlwfSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gYmVsb25nc1RvQ2hhbmdlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIG5ldyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfY3JlYXRlTmV3UmVjb3JkKCkge1xuICAgIC8vIFJlc29sdmUgdGhlIGNvbm5lY3Rpb24gb25jZSBhbmQgcGluIHRoZSB3aG9sZSBpbnNlcnQgcGF0aCB0byBpdDogYSBwb29sXG4gICAgLy8gY2FuIHJlc29sdmUgYSBkaWZmZXJlbnQgY3VycmVudCBjb25uZWN0aW9uIGFjcm9zcyB0aGUgYXdhaXRzIGJlbG93LCBhbmRcbiAgICAvLyB0aGUgaWRlbnRpdHktaW5zZXJ0IHdyYXBwZXIgaXMgb25seSBlZmZlY3RpdmUgb24gdGhlIGV4YWN0IHNlc3Npb24gdGhhdFxuICAgIC8vIHJhbiBTRVQgSURFTlRJVFlfSU5TRVJULlxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLl9jb25uZWN0aW9uKClcblxuICAgIGlmICghY29ubmVjdGlvbltcImluc2VydFNxbFwiXSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBpbnNlcnRTcWwgb24gJHtjb25uZWN0aW9uLmNvbnN0cnVjdG9yLm5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fYmVsb25nc1RvQ2hhbmdlcygpLCB0aGlzLnJhd0F0dHJpYnV0ZXMoKSlcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcHJpbWFyeUtleUNvbHVtbiA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgPyB1bmRlZmluZWQgOiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5zKCkuZmluZCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09IHByaW1hcnlLZXkpXG4gICAgY29uc3QgcHJpbWFyeUtleVR5cGUgPSBwcmltYXJ5S2V5Q29sdW1uPy5nZXRUeXBlKCk/LnRvTG93ZXJDYXNlKClcbiAgICBjb25zdCBkcml2ZXJTdXBwb3J0c0RlZmF1bHRVVUlEID0gdHlwZW9mIGNvbm5lY3Rpb24uc3VwcG9ydHNEZWZhdWx0UHJpbWFyeUtleVVVSUQgPT0gXCJmdW5jdGlvblwiICYmIGNvbm5lY3Rpb24uc3VwcG9ydHNEZWZhdWx0UHJpbWFyeUtleVVVSUQoKVxuICAgIGNvbnN0IGlzVVVJRFByaW1hcnlLZXkgPSBwcmltYXJ5S2V5VHlwZT8uaW5jbHVkZXMoXCJ1dWlkXCIpXG4gICAgY29uc3Qgc2hvdWxkQXNzaWduVVVJRFByaW1hcnlLZXkgPSBpc1VVSURQcmltYXJ5S2V5ICYmICFkcml2ZXJTdXBwb3J0c0RlZmF1bHRVVUlEXG4gICAgdGhpcy5fc2V0RGVmYXVsdFRpbWVzdGFtcFZhbHVlcyhkYXRhKVxuXG4gICAgY29uc3QgY29sdW1uTmFtZXMgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lcygpXG4gICAgY29uc3QgaGFzVXNlclByb3ZpZGVkUHJpbWFyeUtleSA9IEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSlcbiAgICAgID8gcHJpbWFyeUtleS5ldmVyeSgoY29sdW1uTmFtZSkgPT4gZGF0YVtjb2x1bW5OYW1lXSAhPT0gdW5kZWZpbmVkICYmIGRhdGFbY29sdW1uTmFtZV0gIT09IG51bGwgJiYgZGF0YVtjb2x1bW5OYW1lXSAhPT0gXCJcIilcbiAgICAgIDogZGF0YVtwcmltYXJ5S2V5XSAhPT0gdW5kZWZpbmVkICYmIGRhdGFbcHJpbWFyeUtleV0gIT09IG51bGwgJiYgZGF0YVtwcmltYXJ5S2V5XSAhPT0gXCJcIlxuXG4gICAgaWYgKHNob3VsZEFzc2lnblVVSURQcmltYXJ5S2V5ICYmICFoYXNVc2VyUHJvdmlkZWRQcmltYXJ5S2V5KSB7XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkgdGhyb3cgbmV3IEVycm9yKFwiQ29tcG9zaXRlIFVVSUQgcHJpbWFyeSBrZXlzIG11c3QgYmUgcHJvdmlkZWQgZXhwbGljaXRseS5cIilcblxuICAgICAgZGF0YVtwcmltYXJ5S2V5XSA9IG5ldyBVVUlEKDQpLmZvcm1hdCgpXG4gICAgfVxuXG4gICAgdGhpcy5fbm9ybWFsaXplRGF0ZVZhbHVlc0ZvcldyaXRlKGRhdGEpXG5cbiAgICBjb25zdCBzcWwgPSBjb25uZWN0aW9uLmluc2VydFNxbCh7XG4gICAgICByZXR1cm5MYXN0SW5zZXJ0ZWRDb2x1bW5OYW1lczogY29sdW1uTmFtZXMsXG4gICAgICB0YWJsZU5hbWU6IHRoaXMuX3RhYmxlTmFtZSgpLFxuICAgICAgZGF0YVxuICAgIH0pXG4gICAgY29uc3QgaW5zZXJ0T3B0aW9ucyA9IHtsb2dOYW1lOiBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBDcmVhdGVgfVxuICAgIC8vIEV4cGxpY2l0IHByaW1hcnkta2V5IGluc2VydHMgaW50byBhdXRvLWluY3JlbWVudCBjb2x1bW5zIGdvIHRocm91Z2ggdGhlXG4gICAgLy8gZHJpdmVyJ3MgZXhwbGljaXQtcHJpbWFyeS1rZXkgaW5zZXJ0IChNU1NRTCB3cmFwcyBpdCBpbiBJREVOVElUWV9JTlNFUlQpO1xuICAgIC8vIGV2ZXJ5dGhpbmcgZWxzZSB1c2VzIHRoZSBwbGFpbiBxdWVyeSBwYXRoLlxuICAgIGNvbnN0IGluc2VydFJlc3VsdCA9IGhhc1VzZXJQcm92aWRlZFByaW1hcnlLZXkgJiYgcHJpbWFyeUtleUNvbHVtbj8uZ2V0QXV0b0luY3JlbWVudCgpID09PSB0cnVlXG4gICAgICA/IGF3YWl0IGNvbm5lY3Rpb24uaW5zZXJ0V2l0aEV4cGxpY2l0UHJpbWFyeUtleSh7b3B0aW9uczogaW5zZXJ0T3B0aW9ucywgc3FsLCB0YWJsZU5hbWU6IHRoaXMuX3RhYmxlTmFtZSgpfSlcbiAgICAgIDogYXdhaXQgY29ubmVjdGlvbi5xdWVyeShzcWwsIGluc2VydE9wdGlvbnMpXG5cbiAgICBhd2FpdCB0aGlzLl9hcHBseUluc2VydFJlc3VsdCh7Y29ubmVjdGlvbiwgZGF0YSwgaW5zZXJ0UmVzdWx0LCBwcmltYXJ5S2V5fSlcbiAgICB0aGlzLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuXG4gICAgdGhpcy5fbWFya0xvYWRlZFJlbGF0aW9uc2hpcHNQcmVsb2FkZWRBZnRlckNyZWF0ZSgpXG4gIH1cblxuICAvKipcbiAgICogTWFya3Mgb25seSByZWxhdGlvbnNoaXBzIHdpdGggaW4tbWVtb3J5IGxvYWRlZCB2YWx1ZXMgYXMgcHJlbG9hZGVkIGFmdGVyIGNyZWF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX21hcmtMb2FkZWRSZWxhdGlvbnNoaXBzUHJlbG9hZGVkQWZ0ZXJDcmVhdGUoKSB7XG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXAgb2YgdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0UmVsYXRpb25zaGlwcygpKSB7XG4gICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCkpXG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJoYXNNYW55XCIgJiYgaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKSA9PT0gbnVsbCkge1xuICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcC5zZXRMb2FkZWQoW10pXG4gICAgICB9XG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0UHJlbG9hZGVkKHRydWUpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgdGhlIGRhdGFiYXNlIGluc2VydCByZXNwb25zZSB0byB0aGlzIHJlY29yZC5cbiAgICogQHBhcmFtIHt7Y29ubmVjdGlvbjogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIGRhdGE6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBEYXRlIHwgbnVsbCB8IHVuZGVmaW5lZD4sIGluc2VydFJlc3VsdDogQXJyYXk8UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IERhdGUgfCBudWxsIHwgdW5kZWZpbmVkPj4gfCBudWxsIHwgdW5kZWZpbmVkLCBwcmltYXJ5S2V5OiBzdHJpbmcgfCBzdHJpbmdbXX19IG9wdGlvbnMgLSBQaW5uZWQgaW5zZXJ0IGNvbm5lY3Rpb24sIGluc2VydGVkIGRhdGEsIGNvbm5lY3Rpb24gcmVzdWx0LCBhbmQgcHJpbWFyeSBrZXkgY29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfYXBwbHlJbnNlcnRSZXN1bHQoe2Nvbm5lY3Rpb24sIGRhdGEsIGluc2VydFJlc3VsdCwgcHJpbWFyeUtleX0pIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVsb2FkV2l0aElkKHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoY29sdW1uTmFtZSkgPT4gZGF0YVtjb2x1bW5OYW1lXSkpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShpbnNlcnRSZXN1bHQpICYmIGluc2VydFJlc3VsdFswXSAmJiBpbnNlcnRSZXN1bHRbMF1bcHJpbWFyeUtleV0pIHtcbiAgICAgIHRoaXMuX2F0dHJpYnV0ZXMgPSBpbnNlcnRSZXN1bHRbMF1cbiAgICAgIHRoaXMuX2NoYW5nZXMgPSB7fVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBwcmltYXJ5S2V5VmFsdWUgPSBkYXRhW3ByaW1hcnlLZXldXG5cbiAgICAgIGlmIChwcmltYXJ5S2V5VmFsdWUgIT09IHVuZGVmaW5lZCAmJiBwcmltYXJ5S2V5VmFsdWUgIT09IG51bGwgJiYgcHJpbWFyeUtleVZhbHVlICE9PSBcIlwiKSB7XG4gICAgICAgIGlmICh0eXBlb2YgcHJpbWFyeUtleVZhbHVlICE9IFwic3RyaW5nXCIgJiYgdHlwZW9mIHByaW1hcnlLZXlWYWx1ZSAhPSBcIm51bWJlclwiKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnNlcnRlZCBwcmltYXJ5IGtleSAke3ByaW1hcnlLZXl9IG11c3QgYmUgYSBzdHJpbmcgb3IgbnVtYmVyLCBnb3QgJHt0eXBlb2YgcHJpbWFyeUtleVZhbHVlfWApXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLl9yZWxvYWRXaXRoSWQocHJpbWFyeUtleVZhbHVlKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgY29uc3QgaWQgPSBhd2FpdCBjb25uZWN0aW9uLmxhc3RJbnNlcnRJRCgpXG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlbG9hZFdpdGhJZChpZClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aW1lc3RhbXAgZGVmYXVsdHMgZm9yIGEgbmV3IHJlY29yZCBpbnNlcnQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBkYXRhIC0gQ29sdW1uLWtleWVkIGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9zZXREZWZhdWx0VGltZXN0YW1wVmFsdWVzKGRhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVkQXRDb2x1bW4gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5zKCkuZmluZCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09IFwiY3JlYXRlZF9hdFwiKVxuICAgIGNvbnN0IHVwZGF0ZWRBdENvbHVtbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbnMoKS5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT0gXCJ1cGRhdGVkX2F0XCIpXG4gICAgY29uc3QgY3VycmVudERhdGUgPSBuZXcgRGF0ZSgpXG5cbiAgICBpZiAoY3JlYXRlZEF0Q29sdW1uICYmIChkYXRhLmNyZWF0ZWRfYXQgPT09IHVuZGVmaW5lZCB8fCBkYXRhLmNyZWF0ZWRfYXQgPT09IG51bGwgfHwgZGF0YS5jcmVhdGVkX2F0ID09PSBcIlwiKSkge1xuICAgICAgZGF0YS5jcmVhdGVkX2F0ID0gY3VycmVudERhdGVcbiAgICB9XG4gICAgaWYgKHVwZGF0ZWRBdENvbHVtbiAmJiAoZGF0YS51cGRhdGVkX2F0ID09PSB1bmRlZmluZWQgfHwgZGF0YS51cGRhdGVkX2F0ID09PSBudWxsIHx8IGRhdGEudXBkYXRlZF9hdCA9PT0gXCJcIikpIHtcbiAgICAgIGRhdGEudXBkYXRlZF9hdCA9IGN1cnJlbnREYXRlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRhdGUgdmFsdWVzIGZvciB3cml0ZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGRhdGEgLSBDb2x1bW4ta2V5ZWQgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX25vcm1hbGl6ZURhdGVWYWx1ZXNGb3JXcml0ZShkYXRhKSB7XG4gICAgZm9yIChjb25zdCBjb2x1bW5OYW1lIGluIGRhdGEpIHtcbiAgICAgIGNvbnN0IGNvbHVtblR5cGUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5UeXBlQnlOYW1lKGNvbHVtbk5hbWUpXG5cbiAgICAgIGlmICghY29sdW1uVHlwZSB8fCAhdGhpcy5nZXRNb2RlbENsYXNzKCkuX2lzRGF0ZUxpa2VUeXBlKGNvbHVtblR5cGUpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCB2YWx1ZSA9IGRhdGFbY29sdW1uTmFtZV1cblxuICAgICAgZGF0YVtjb2x1bW5OYW1lXSA9IG5vcm1hbGl6ZURhdGVWYWx1ZUZvcldyaXRlKHZhbHVlLCB7dGltZVpvbmU6IHRoaXMuZ2V0TW9kZWxDbGFzcygpLl90aW1lWm9uZUZvckRhdGVXcml0ZSgpfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUgcmVjb3JkIHdpdGggY2hhbmdlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF91cGRhdGVSZWNvcmRXaXRoQ2hhbmdlcygpIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlID0gdGhpcy5fcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKClcbiAgICBjb25zdCBuZXh0UHJpbWFyeUtleVZhbHVlID0gdGhpcy5pZCgpXG4gICAgLyoqXG4gICAgICogQ29uZGl0aW9ucy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGNvbmRpdGlvbnMgPSB7fVxuXG4gICAgT2JqZWN0LmFzc2lnbihjb25kaXRpb25zLCBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIHBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSkpXG5cbiAgICBjb25zdCBjaGFuZ2VzID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fYmVsb25nc1RvQ2hhbmdlcygpLCB0aGlzLl9jaGFuZ2VzKVxuICAgIGNvbnN0IHVwZGF0ZWRBdENvbHVtbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbnMoKS5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT0gXCJ1cGRhdGVkX2F0XCIpXG4gICAgY29uc3QgY3VycmVudERhdGUgPSBuZXcgRGF0ZSgpXG5cbiAgICBpZiAodXBkYXRlZEF0Q29sdW1uICYmIChjaGFuZ2VzLnVwZGF0ZWRfYXQgPT09IHVuZGVmaW5lZCB8fCBjaGFuZ2VzLnVwZGF0ZWRfYXQgPT09IG51bGwgfHwgY2hhbmdlcy51cGRhdGVkX2F0ID09PSBcIlwiKSkge1xuICAgICAgY2hhbmdlcy51cGRhdGVkX2F0ID0gY3VycmVudERhdGVcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoY2hhbmdlcykubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5fbm9ybWFsaXplRGF0ZVZhbHVlc0ZvcldyaXRlKGNoYW5nZXMpXG4gICAgICBjb25zdCBzcWwgPSB0aGlzLl9jb25uZWN0aW9uKCkudXBkYXRlU3FsKHtcbiAgICAgICAgdGFibGVOYW1lOiB0aGlzLl90YWJsZU5hbWUoKSxcbiAgICAgICAgZGF0YTogY2hhbmdlcyxcbiAgICAgICAgY29uZGl0aW9uc1xuICAgICAgfSlcbiAgICAgIGF3YWl0IHRoaXMuX2Nvbm5lY3Rpb24oKS5xdWVyeShzcWwsIHtsb2dOYW1lOiBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBVcGRhdGVgfSlcblxuICAgICAgaWYgKFxuICAgICAgICBPYmplY3Qua2V5cyh0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRBdHRhY2htZW50cygpKS5sZW5ndGggPiAwXG4gICAgICAgICYmIG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSkgIT09IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIG5leHRQcmltYXJ5S2V5VmFsdWUpXG4gICAgICApIHtcbiAgICAgICAgYXdhaXQgcmVjb3JkQXR0YWNobWVudHNTdG9yZUZvck1vZGVsKHRoaXMpLm1pZ3JhdGVSZWNvcmRJZGVudGl0eSh7XG4gICAgICAgICAgbW9kZWw6IHRoaXMsXG4gICAgICAgICAgbmV4dElkZW50aXR5OiBuZXh0UHJpbWFyeUtleVZhbHVlLFxuICAgICAgICAgIHByZXZpb3VzSWRlbnRpdHk6IHBlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWxvYWRXaXRoSWQobmV4dFByaW1hcnlLZXlWYWx1ZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSAtIFRoZSBpZC5cbiAgICovXG4gIGlkKCkge1xuICAgIGlmICghdGhpcy5nZXRNb2RlbENsYXNzKCkuX2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ29sdW1uIG5hbWVzIG1hcHBpbmcgaGFzbid0IGJlZW4gc2V0IG9uICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfS4gSGFzIHRoZSBtb2RlbCBiZWVuIGluaXRpYWxpemVkP2ApXG4gICAgfVxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHtcbiAgICAgIHJldHVybiByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGNvbHVtbk5hbWUpID0+IHRoaXMucmVhZENvbHVtbihjb2x1bW5OYW1lKSlcbiAgICB9XG5cbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW3ByaW1hcnlLZXldXG5cbiAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFByaW1hcnkga2V5ICR7cHJpbWFyeUtleX0gZG9lc24ndCBleGlzdCBpbiBjb2x1bW5zOiAke09iamVjdC5rZXlzKHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKSkuam9pbihcIiwgXCIpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7bnVtYmVyIHwgc3RyaW5nfSAqLyAodGhpcy5yZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGlkZW50aXR5IHJlcHJlc2VudGVkIGJ5IHRoZSBsYXN0IHBlcnNpc3RlZCBkYXRhYmFzZSBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IC0gUGVyc2lzdGVkIGlkZW50aXR5LlxuICAgKi9cbiAgX3BlcnNpc3RlZFByaW1hcnlLZXlWYWx1ZSgpIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG5cbiAgICByZXR1cm4gcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKHByaW1hcnlLZXksIChjb2x1bW5OYW1lKSA9PiB0aGlzLl9hdHRyaWJ1dGVzW2NvbHVtbk5hbWVdKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgcGVyc2lzdGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHBlcnNpc3RlZC5cbiAgICovXG4gIGlzUGVyc2lzdGVkKCkgeyByZXR1cm4gIXRoaXMuX2lzTmV3UmVjb3JkIH1cblxuICAvKipcbiAgICogUnVucyBpcyBuZXcgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIG5ldyByZWNvcmQuXG4gICAqL1xuICBpc05ld1JlY29yZCgpIHsgcmV0dXJuIHRoaXMuX2lzTmV3UmVjb3JkIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgaXMgbmV3IHJlY29yZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBuZXdJc05ld1JlY29yZCAtIE5ldyBpcyBuZXcgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRJc05ld1JlY29yZChuZXdJc05ld1JlY29yZCkge1xuICAgIHRoaXMuX2lzTmV3UmVjb3JkID0gbmV3SXNOZXdSZWNvcmRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbG9hZCB3aXRoIGlkLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBSZWNvcmQgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9yZWxvYWRXaXRoSWQoaWQpIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG5cbiAgICAvKipcbiAgICAgKiBXaGVyZSBvYmplY3QuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCB3aGVyZU9iamVjdCA9IHt9XG5cbiAgICBPYmplY3QuYXNzaWduKHdoZXJlT2JqZWN0LCBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIGlkKSlcblxuICAgIGNvbnN0IHF1ZXJ5ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PE1DPn0gKi8gKFxuICAgICAgdGhpc1xuICAgICAgICAucXVlcnlGb3JNb2RlbCh0aGlzLmdldE1vZGVsQ2xhc3MoKSlcbiAgICAgICAgLndoZXJlKHdoZXJlT2JqZWN0KVxuICAgIClcbiAgICBjb25zdCByZWxvYWRlZE1vZGVsID0gYXdhaXQgcXVlcnkuZmlyc3QoKVxuXG4gICAgaWYgKCFyZWxvYWRlZE1vZGVsKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSMke2lkfSBjb3VsZG4ndCBiZSByZWxvYWRlZCAtIHJlY29yZCBkaWRuJ3QgZXhpc3RgKVxuXG4gICAgdGhpcy5fYXR0cmlidXRlcyA9IHJlbG9hZGVkTW9kZWwucmF3QXR0cmlidXRlcygpXG4gICAgdGhpcy5fY2hhbmdlcyA9IHt9XG4gICAgdGhpcy5fYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVsb2FkKCkge1xuICAgIGNvbnN0IHJlY29yZElkID0gdGhpcy5fcGVyc2lzdGVkUHJpbWFyeUtleVZhbHVlKClcbiAgICBhd2FpdCB0aGlzLl9yZWxvYWRXaXRoSWQocmVjb3JkSWQpXG4gIH1cblxuICBhc3luYyBfcnVuVmFsaWRhdGlvbnMoKSB7XG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7dHlwZTogc3RyaW5nLCBtZXNzYWdlOiBzdHJpbmd9Pn0gKi9cbiAgICB0aGlzLl92YWxpZGF0aW9uRXJyb3JzID0ge31cblxuICAgIGNvbnN0IHZhbGlkYXRvcnMgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fdmFsaWRhdG9yc1xuXG4gICAgaWYgKHZhbGlkYXRvcnMpIHtcbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBpbiB2YWxpZGF0b3JzKSB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZVZhbGlkYXRvcnMgPSB2YWxpZGF0b3JzW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgICAgZm9yIChjb25zdCB2YWxpZGF0b3Igb2YgYXR0cmlidXRlVmFsaWRhdG9ycykge1xuICAgICAgICAgIGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZSh7bW9kZWw6IHRoaXMsIGF0dHJpYnV0ZU5hbWV9KVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKHRoaXMuX3ZhbGlkYXRpb25FcnJvcnMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvciA9IG5ldyBWYWxpZGF0aW9uRXJyb3IodGhpcy5mdWxsRXJyb3JNZXNzYWdlcygpLmpvaW4oXCIuIFwiKSlcblxuICAgICAgdmFsaWRhdGlvbkVycm9yLnNldFZhbGlkYXRpb25FcnJvcnModGhpcy5fdmFsaWRhdGlvbkVycm9ycylcbiAgICAgIHZhbGlkYXRpb25FcnJvci5zZXRNb2RlbCh0aGlzKVxuICAgICAgdmFsaWRhdGlvbkVycm9yLnZlbG9jaW91cyA9IHt0eXBlOiBcInZhbGlkYXRpb25fZXJyb3JcIn1cblxuICAgICAgdGhyb3cgdmFsaWRhdGlvbkVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnVsbCBlcnJvciBtZXNzYWdlcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFRoZSBmdWxsIGVycm9yIG1lc3NhZ2VzLlxuICAgKi9cbiAgZnVsbEVycm9yTWVzc2FnZXMoKSB7XG4gICAgLyoqXG4gICAgICogVmFsaWRhdGlvbiBlcnJvciBtZXNzYWdlcy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgdmFsaWRhdGlvbkVycm9yTWVzc2FnZXMgPSBbXVxuXG4gICAgaWYgKHRoaXMuX3ZhbGlkYXRpb25FcnJvcnMpIHtcbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBpbiB0aGlzLl92YWxpZGF0aW9uRXJyb3JzKSB7XG4gICAgICAgIGZvciAoY29uc3QgdmFsaWRhdGlvbkVycm9yIG9mIHRoaXMuX3ZhbGlkYXRpb25FcnJvcnNbYXR0cmlidXRlTmFtZV0pIHtcbiAgICAgICAgICBjb25zdCBtZXNzYWdlID0gYCR7dGhpcy5nZXRNb2RlbENsYXNzKCkuaHVtYW5BdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpfSAke3ZhbGlkYXRpb25FcnJvci5tZXNzYWdlfWBcblxuICAgICAgICAgIHZhbGlkYXRpb25FcnJvck1lc3NhZ2VzLnB1c2gobWVzc2FnZSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB2YWxpZGF0aW9uRXJyb3JNZXNzYWdlc1xuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgdGhlIGF0dHJpYnV0ZXMgdG8gdGhlIHJlY29yZCBhbmQgc2F2ZXMgaXQuXG4gICAqIEBwYXJhbSB7V3JpdGVBdHRyaWJ1dGVzfSBhdHRyaWJ1dGVzVG9Bc3NpZ24gLSBUaGUgYXR0cmlidXRlcyB0byBhc3NpZ24gdG8gdGhlIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIHVwZGF0ZShhdHRyaWJ1dGVzVG9Bc3NpZ24pIHtcbiAgICBpZiAoYXR0cmlidXRlc1RvQXNzaWduKSB0aGlzLmFzc2lnbihhdHRyaWJ1dGVzVG9Bc3NpZ24pXG5cbiAgICBhd2FpdCB0aGlzLnNhdmUoKVxuICB9XG59XG5cblZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyVmFsaWRhdG9yVHlwZShcImZvcm1hdFwiLCBWYWxpZGF0b3JzRm9ybWF0KVxuVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJWYWxpZGF0b3JUeXBlKFwibGVuZ3RoXCIsIFZhbGlkYXRvcnNMZW5ndGgpXG5WZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlclZhbGlkYXRvclR5cGUoXCJwcmVzZW5jZVwiLCBWYWxpZGF0b3JzUHJlc2VuY2UpXG5WZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlclZhbGlkYXRvclR5cGUoXCJ1bmlxdWVuZXNzXCIsIFZhbGlkYXRvcnNVbmlxdWVuZXNzKVxuXG5leHBvcnQge0Fkdmlzb3J5TG9ja0J1c3lFcnJvciwgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvciwgQWR2aXNvcnlMb2NrVGltZW91dEVycm9yLCBUZW5hbnREYXRhYmFzZVNjb3BlRXJyb3IsIFZhbGlkYXRpb25FcnJvcn1cbmV4cG9ydCBkZWZhdWx0IFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkXG4iXX0=